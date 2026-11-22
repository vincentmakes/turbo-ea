const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');

const eslintAny = '@typescript-eslint/no-explicit-any';
const biomeAny = /^× (.+):(\d+):(\d+): lint\/suspicious\/noExplicitAny:/;

function selectFile(frontend, input) {
  if (!input || !/\.tsx?$/.test(input)) return;
  const normalized = path.normalize(input);
  const base = normalized.split(path.sep, 1)[0].toLowerCase() === 'frontend'
    ? process.cwd()
    : frontend;
  const target = path.resolve(base, normalized);
  let file;
  try {
    file = fs.realpathSync(target);
  } catch {
    return;
  }
  const relative = path.relative(frontend, file);
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ||
      path.relative(target, file) !== '' ||
      !/\.tsx?$/.test(relative) || !fs.statSync(file).isFile()) return;
  return relative;
}

function runBiome(frontend, files, mode = 'check') {
  const biome = path.join(frontend, 'node_modules', '@biomejs', 'biome', 'bin', 'biome');
  if (!fs.existsSync(biome)) {
    return { status: 2, stderr: 'Biome not found. Install the frontend dev dependencies.\n' };
  }
  const args = [mode === 'lint' ? 'lint' : 'check', '--reporter=concise'];
  if (mode !== 'check') args.push('--diagnostic-level=error');
  if (mode === 'fix') args.push('--write');
  const waiverFiles = new Set();
  for (const file of files) {
    const fullPath = path.resolve(frontend, file);
    try {
      if (fs.readFileSync(fullPath, 'utf8').includes('eslint-disable')) waiverFiles.add(fullPath);
    } catch {
      // Biome reports unreadable inputs itself.
    }
  }
  if (mode !== 'check' || waiverFiles.size) args.push('--colors=off');
  if (waiverFiles.size) args.push('--max-diagnostics=none');
  const result = spawnSync(process.execPath, [biome, ...args, '--', ...files], {
    cwd: frontend, encoding: 'utf8', windowsHide: true,
  });
  if (result.status === null) {
    return { status: 2, stderr: `Biome could not finish: ${result.error?.message ?? result.signal}\n` };
  }
  return honorEslintWaivers(frontend, waiverFiles, result);
}

function honorEslintWaivers(frontend, waiverFiles, result) {
  if (!waiverFiles.size || result.status !== 1) return result;
  const lines = [result.stdout, result.stderr].filter(Boolean).join('\n').split(/\r?\n/);
  const errors = lines.filter(line => line.startsWith('× '));
  const count = lines.find(line => /^Found \d+ errors?\.$/.test(line));
  // Keep the exit status when the reporter has not exposed every error.
  if (!count || Number(count.split(' ')[1]) !== errors.length) return result;

  const possible = new Map();
  for (const error of errors) {
    const match = error.match(biomeAny);
    if (!match) continue;
    const [, file, line, column] = match;
    const fullPath = path.resolve(frontend, file);
    if (waiverFiles.has(fullPath)) possible.set(error, { fullPath, position: `${line}:${column}` });
  }
  if (!possible.size) return result;

  const suppressed = new Map();
  try {
    const requireFrontend = createRequire(path.join(frontend, 'package.json'));
    const { Linter } = requireFrontend('eslint');
    const { parser, plugin } = requireFrontend('typescript-eslint');
    const linter = new Linter({ cwd: frontend });
    const config = [{
      files: ['**/*.ts', '**/*.tsx'],
      languageOptions: { parser },
      plugins: { '@typescript-eslint': plugin },
      rules: { [eslintAny]: 'error' },
    }];
    for (const file of new Set([...possible.values()].map(({ fullPath }) => fullPath))) {
      const source = fs.readFileSync(file, 'utf8');
      const sourceLines = source.split(/\r?\n/);
      linter.verify(source, config, { filename: file });
      const positions = linter.getSuppressedMessages()
        .filter(message => message.ruleId === eslintAny)
        .map(({ line, column }) => {
          // ESLint columns count UTF-16 units. Biome displays Unicode code points.
          const prefix = sourceLines[line - 1].slice(0, column - 1);
          return `${line}:${Array.from(prefix).length + 1}`;
        });
      suppressed.set(file, new Set(positions));
    }
  } catch {
    return result;
  }

  const remaining = errors.filter(error => {
    const waiver = possible.get(error);
    return !waiver || !suppressed.get(waiver.fullPath).has(waiver.position);
  });
  if (remaining.length === errors.length) return result;
  const diagnostics = [...remaining, ...lines.filter(line => line.startsWith('! '))];
  const visible = diagnostics.slice(0, 20);
  if (diagnostics.length > visible.length) {
    visible.push(`${diagnostics.length - visible.length} additional diagnostics omitted.`);
  }
  return { status: remaining.length ? 1 : 0, stdout: visible.length ? `${visible.join('\n')}\n` : '', stderr: '' };
}

function biomeFeedback({ status, stdout, stderr }) {
  if (!status) return '';
  const lines = [stdout, stderr].filter(Boolean).join('\n').split(/\r?\n/);
  const findings = lines.filter(line => line.startsWith('× '));
  if (findings.length) return findings.map(line => line.slice(2)).join('\n');
  const details = lines.map(line => line.trim()).filter(Boolean);
  const reason = details.find(line => line.startsWith('× '))?.slice(2) ?? details[0];
  return reason ? `Biome: ${reason}` : `Biome exited with code ${status}.`;
}

function check(input) {
  const frontend = fs.realpathSync('frontend');
  const file = selectFile(frontend, input);
  if (!file || process.argv.length > 3) {
    console.error('Pass one existing frontend .ts or .tsx file as FILE=frontend/src/path.ts');
    return 2;
  }
  const result = runBiome(frontend, [file]);
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  return result.status;
}

module.exports = { selectFile, runBiome, biomeFeedback };
if (require.main === module) {
  process.exitCode = check(process.argv[2] ?? process.env.TURBO_FRONTEND_FILE);
}
