const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

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

function runBiome(frontend, files, fromHook = false) {
  const biome = path.join(frontend, 'node_modules', '@biomejs', 'biome', 'bin', 'biome');
  if (!fs.existsSync(biome)) {
    return { status: 2, stderr: 'Biome not found. Install the frontend dev dependencies.\n' };
  }
  const args = ['check', '--reporter=concise'];
  if (fromHook) args.push('--write', '--colors=off', '--diagnostic-level=error');
  const result = spawnSync(process.execPath, [biome, ...args, '--', ...files], {
    cwd: frontend, encoding: 'utf8', windowsHide: true,
  });
  if (result.status === null) {
    return { status: 2, stderr: `Biome could not finish: ${result.error?.message ?? result.signal}\n` };
  }
  return result;
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
