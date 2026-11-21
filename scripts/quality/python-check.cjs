const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function pythonFile(backend, cwd, input) {
  if (typeof input !== 'string' || path.extname(input) !== '.py') return;
  const target = path.resolve(cwd, input);
  const filename = path.relative(backend, target);
  if (path.isAbsolute(filename) || filename.startsWith(`..${path.sep}`) ||
      !fs.statSync(target, { throwIfNoEntry: false })?.isFile()) return;
  // An edit to a link must not trigger an in-place rewrite of its destination.
  if (path.relative(target, fs.realpathSync(target)) !== '') return;
  return filename;
}

function ruffExecutable(backend) {
  const bin = process.platform === 'win32' ? 'Scripts' : 'bin';
  const executable = process.platform === 'win32' ? 'ruff.exe' : 'ruff';
  return ['venv', '.venv'].map(venv => path.join(backend, venv, bin, executable))
    .find(file => fs.existsSync(file)) ?? 'ruff';
}

function runRuff(backend, files, fromHook = false) {
  const executable = ruffExecutable(backend);
  const shared = ['--config', 'pyproject.toml', '--target-version', 'py311', '--quiet'];
  if (fromHook) shared.push('--force-exclude');

  function run(command, options) {
    const result = spawnSync(executable, [command, ...shared, ...options, '--', ...files], {
      cwd: backend, encoding: 'utf8', windowsHide: true,
    });
    if (result.status !== null) return result;
    const stderr = result.error?.code === 'ENOENT'
      ? 'Ruff not found. Install the backend dev dependencies in backend/venv.'
      : `Ruff could not finish: ${result.error?.message ?? result.signal}`;
    return { status: 2, stdout: '', stderr: `${stderr}\n` };
  }

  let formatting;
  if (fromHook) {
    const fixes = run('check', ['--fix-only', '--no-unsafe-fixes', '--unfixable', 'F401']);
    if (fixes.status !== 0) return fixes;
    formatting = run('format', []);
  }
  const lint = run('check', [
    '--extend-select', 'B,S,C901,UP', '--extend-per-file-ignores', 'tests/**:S101',
    '--output-format', 'concise', '--no-fix',
  ]);
  // A syntax error can stop formatting; the final lint gives its concise location.
  if (formatting?.status && lint.status === 0) return formatting;
  return lint;
}

function compactError({ status, stderr }) {
  if (!status || !stderr?.trim()) return '';
  const lines = stderr.trim().split(/\r?\n/).map(line => line.trim());
  const cause = lines.findLast(line => line.startsWith('Cause:'));
  return cause && cause !== lines[0] ? `${lines[0]} ${cause}` : lines[0];
}

function main() {
  const argument = process.argv[2];
  // Sessions that already loaded the old command keep their Python-only behavior.
  if (argument === '--hook') return require('./post-edit.cjs').postEdit({ pythonOnly: true });
  const cwd = fs.realpathSync(process.cwd());
  const backend = path.join(cwd, 'backend');
  const filename = pythonFile(backend, cwd, argument ?? process.env.TURBO_PYTHON_FILE);
  if (!filename || process.argv.length > 3) {
    console.error('Pass one existing Python file as FILE=backend/path.py');
    process.exitCode = 2;
    return;
  }
  const result = runRuff(backend, [filename]);
  process.stdout.write(result.stdout ?? '');
  const error = compactError(result);
  if (error) process.stderr.write(`${error}\n`);
  process.exitCode = result.status;
}

module.exports = { pythonFile, runRuff, compactError };
if (require.main === module) main();
