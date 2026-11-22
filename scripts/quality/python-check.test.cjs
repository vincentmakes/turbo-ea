const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const project = path.resolve(__dirname, '../..');
const script = path.join(__dirname, 'python-check.cjs');
const venvBin = process.platform === 'win32' ? 'Scripts' : 'bin';
const env = {
  ...process.env,
  PATH: [
    path.join(project, 'backend', 'venv', venvBin),
    path.join(project, 'backend', '.venv', venvBin),
    process.env.PATH,
  ].join(path.delimiter),
  TURBO_PYTHON_FILE: '',
};

function fixture(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'python quality '));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));

  function write(file, source) {
    const filename = path.join(cwd, file);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, source);
  }

  write('backend/pyproject.toml', fs.readFileSync(path.join(project, 'backend/pyproject.toml')));
  const hookScript = 'scripts/quality/post-edit.cjs';
  for (const name of ['frontend-check.cjs', 'python-check.cjs', 'post-edit.cjs']) {
    write(`scripts/quality/${name}`, fs.readFileSync(path.join(__dirname, name)));
  }
  const check = (...args) => spawnSync(process.execPath, [script, ...args], {
    cwd, env, encoding: 'utf8',
  });
  const hook = (tool_name, tool_input) => spawnSync(process.execPath, [hookScript], {
    cwd, env, encoding: 'utf8',
    input: JSON.stringify({ cwd, hook_event_name: 'PostToolUse', tool_name, tool_input }),
  });
  const read = file => fs.readFileSync(path.join(cwd, file), 'utf8').replaceAll('\r\n', '\n');
  return { cwd, write, check, hook, read };
}

test('reports all findings in the selected file, leaves other files alone and performs no fixes', t => {
  const { cwd, write, check } = fixture(t);
  const file = 'backend/app/with spaces.py';
  const source = 'import os\n\nassert 1 == 1\nassert 2 == 2\n';
  write(file, source);
  write('backend/app/other.py', 'assert False\n');

  const result = check(file);
  assert.equal(result.status, 1, result.stderr);
  const lines = result.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 3, result.stdout);
  assert.match(lines[0], /with spaces\.py:1:8: F401 /);
  assert.match(lines[1], /with spaces\.py:3:1: S101 /);
  assert.match(lines[2], /with spaces\.py:4:1: S101 /);
  assert.equal(fs.readFileSync(path.join(cwd, file), 'utf8'), source);
});

test('keeps pytest assertions and checks other lint rules on the same test file', t => {
  const { write, check } = fixture(t);
  const file = 'backend/tests/services/test_example.py';
  write(file, 'import os\n\n\ndef test_example():\n    assert 1 == 1\n');
  const result = check(file);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout.trim(), /^[^\n]+:1:8: F401 [^\n]+$/);
  write(file, 'def test_example():\n    assert 1 == 1\n');
  const clean = check(file);
  assert.equal(clean.status, 0, clean.stderr);
  assert.equal(clean.stdout, '');
});

test('requires an existing backend Python file before running Ruff', t => {
  const { write, check } = fixture(t);
  write('outside.py', 'assert False\n');
  for (const args of [[], ['backend'], ['outside.py'], ['backend/missing.py']]) {
    const result = check(...args);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /FILE=backend\//);
  }
});

test('Claude Edit formats the named file, preserves its unused import and reports F401', t => {
  const { cwd, write, hook, read } = fixture(t);
  const file = 'backend/app/with spaces.py';
  write(file, 'import os\n\nassert  1==1\n');
  write('backend/app/other.py', 'import sys\n');
  const result = hook('Edit', { file_path: path.join(cwd, file) });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout).hookSpecificOutput;
  assert.equal(output.hookEventName, 'PostToolUse');
  const context = output.additionalContext;
  const findings = context.split('\n');
  assert.equal(findings.length, 2);
  assert.match(findings[0], /with spaces\.py:1:8: F401 /);
  assert.match(findings[1], /with spaces\.py:3:1: S101 /);
  assert.equal(read(file), 'import os\n\nassert 1 == 1\n');
  assert.equal(read('backend/app/other.py'), 'import sys\n');
});

test('the Codex hook checks renamed Python and skips removed and non-backend files', t => {
  const { write, hook, read } = fixture(t);
  write('backend/app/renamed.py', 'VALUE=1\n');
  write('backend/app/pytest.py', 'assert  False\n');
  write('other.py', 'VALUE=0\n');
  const result = hook('apply_patch', { command: [
    '*** Begin Patch', '*** Update File: backend/app/old.py',
    '*** Move to: backend/app/renamed.py', '*** Delete File: backend/app/deleted.py',
    '*** Add File: backend/app/pytest.py', '*** Update File: other.py',
    '*** End Patch',
  ].join('\n') });
  assert.equal(result.status, 0, result.stderr);
  const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  const findings = context.split('\n');
  assert.equal(findings.length, 2);
  assert.match(findings[0], /pytest\.py:1:1: S101 /);
  assert.match(findings[1], /pytest\.py:1:8: B011 /);
  assert.equal(read('backend/app/renamed.py'), 'VALUE = 1\n');
  assert.equal(read('other.py'), 'VALUE=0\n');
});

test('Claude Write is silent for clean or irrelevant files and reports invalid Python in concise form', t => {
  const { write, hook, read } = fixture(t);
  write('backend/tests/test_new.py', 'def test_new():\n    assert  1==1\n');
  write('backend/file.md', 'do not change\n');
  assert.equal(hook('Write', { file_path: 'backend/tests/test_new.py' }).stdout, '');
  assert.equal(read('backend/tests/test_new.py'), 'def test_new():\n    assert 1 == 1\n');
  assert.equal(hook('Write', { file_path: 'backend/file.md' }).stdout, '');
  write('backend/app/incomplete.py', 'def\n');
  const result = hook('Write', { file_path: 'backend/app/incomplete.py' });
  assert.equal(result.status, 0, result.stderr);
  const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  assert.match(context, /^[^\n]*incomplete\.py:\d+:\d+: invalid-syntax/m);
});

test('reports a Ruff execution failure on one line in the hook and manual command', t => {
  const { write, hook, check } = fixture(t);
  const file = 'backend/app/example.py';
  write(file, 'VALUE = 1\n');
  write('backend/pyproject.toml', '[tool.ruff]\ninvalid syntax\n');

  const result = hook('Write', { file_path: file });
  assert.equal(result.status, 0, result.stderr);
  const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  assert.match(context, /^ruff failed[^\r\n]*TOML parse error[^\r\n]*$/);
  assert.equal(result.stderr, '');

  const manual = check(file);
  assert.equal(manual.status, 2);
  assert.match(manual.stderr.trim(), /^ruff failed[^\r\n]*TOML parse error[^\r\n]*$/);
});
