const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const script = path.join(__dirname, 'frontend-check.cjs');
const project = path.resolve(__dirname, '../..');

function fixture(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'frontend-quality-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const source = 'export const value = 1;\n';
  const file = path.join(cwd, 'frontend', 'src', 'with space.tsx');
  const biome = path.join(cwd, 'frontend', 'node_modules', '@biomejs', 'biome', 'bin', 'biome');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(path.dirname(biome), { recursive: true });
  fs.mkdirSync(path.join(cwd, 'frontend', 'directory.ts'));
  fs.writeFileSync(file, source);
  fs.writeFileSync(path.join(cwd, 'outside.ts'), source);
  fs.writeFileSync(path.join(cwd, 'frontend', 'note.js'), source);
  fs.writeFileSync(biome, 'console.log(JSON.stringify(process.argv.slice(2))); process.exitCode = 1;');
  const check = (input, ...extra) => spawnSync(process.execPath, [script, ...extra], {
    cwd, encoding: 'utf8', env: { ...process.env, TURBO_FRONTEND_FILE: input },
  });
  return { check, cwd, file, source };
}

test('runs local Biome in read-only concise mode on exactly one frontend file', t => {
  const { check, file, source } = fixture(t);
  for (const input of ['frontend/src/with space.tsx', 'src/with space.tsx', file]) {
    const result = check(input);
    assert.equal(result.status, 1, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [
      'check', '--reporter=concise', '--', path.join('src', 'with space.tsx'),
    ]);
  }
  assert.equal(fs.readFileSync(file, 'utf8'), source);
});

test('rejects empty, non-TypeScript, directory, outside and multi-file input before launching Biome', t => {
  const { check } = fixture(t);
  for (const input of ['', 'frontend/note.js', 'frontend/directory.ts', '../outside.ts',
    'src/with space.tsx src/other.ts']) {
    const result = check(input);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /FILE=frontend\/src/);
    assert.equal(result.stdout, '');
  }
  const result = check('', 'src/with space.tsx', 'src/other.ts');
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stdout, '');
});

function hookFixture(t) {
  const { cwd: root, file, check } = fixture(t);
  const scriptDir = path.join(root, 'scripts', 'quality');
  fs.mkdirSync(scriptDir, { recursive: true });
  for (const name of ['frontend-check.cjs', 'python-check.cjs', 'post-edit.cjs']) {
    fs.copyFileSync(path.join(__dirname, name), path.join(scriptDir, name));
  }
  const frontend = path.join(root, 'frontend');
  const bin = path.join('node_modules', '@biomejs', 'biome', 'bin', 'biome');
  fs.writeFileSync(path.join(frontend, bin), `require(${JSON.stringify(path.join(project, 'frontend', bin))});`);
  fs.copyFileSync(path.join(project, 'frontend/biome.json'), path.join(frontend, 'biome.json'));
  const localRequire = createRequire(path.join(project, 'frontend', 'package.json'));
  for (const name of ['eslint', 'typescript-eslint']) {
    const moduleDir = path.join(frontend, 'node_modules', name);
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.writeFileSync(path.join(moduleDir, 'index.js'),
      `module.exports = require(${JSON.stringify(localRequire.resolve(name))});`);
  }

  function git(...args) {
    const result = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.hooksPath=.git/hooks',
      '-c', 'user.name=Tooling test', '-c', 'user.email=tooling@example.invalid',
      '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  }
  git('init', '-q');
  git('commit', '-qm', 'Start fixture', '--allow-empty');
  const run = (tool, input) => spawnSync(process.execPath, [path.join(scriptDir, 'post-edit.cjs')], {
    cwd: root,
    encoding: 'utf8',
    input: JSON.stringify({ cwd: root, tool_name: tool, tool_input: input }),
  });
  return { frontend, file, run, git, check };
}

test('post-edit Biome stays silent on success and safely fixes a new file', t => {
  const { frontend, file, run, git } = hookFixture(t);
  const clean = path.join(frontend, 'src', 'clean.ts');
  fs.writeFileSync(clean, 'export const value = 1;\n');
  const success = run('Write', { file_path: clean });
  assert.equal(success.status, 0, success.stderr);
  assert.equal(success.stdout, '');
  assert.equal(success.stderr, '');

  fs.writeFileSync(file, 'export const value: any=1;\n');
  git('add', '--', 'frontend/src/with space.tsx');
  const failure = run('apply_patch', {
    command: '*** Begin Patch\n*** Update File: frontend/src/with space.tsx\n*** End Patch\n',
  });
  assert.equal(failure.status, 0, failure.stderr);
  assert.equal(failure.stderr, '');
  const { additionalContext, hookEventName } = JSON.parse(failure.stdout).hookSpecificOutput;
  assert.equal(hookEventName, 'PostToolUse');
  assert.match(additionalContext, /^[^\r\n]+with space\.tsx:[^\r\n]+noExplicitAny[^\r\n]*$/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'export const value: any = 1;\n');
});

test('post-edit Biome lints a one-line edit to a tracked TSX without rewriting the rest', t => {
  const { file, run, git } = hookFixture(t);
  const longLine = `export const details = { first: "${'x'.repeat(150)}", second: 1 };`;
  const source = `${longLine}\nexport const value: any = 1;\n`;
  fs.writeFileSync(file, source);
  git('add', '--', 'frontend/src/with space.tsx');
  git('commit', '-qm', 'Track existing TSX');
  const edited = source.replace('value: any = 1', 'value: any = 2');
  fs.writeFileSync(file, edited);

  const result = run('Edit', { file_path: file });
  assert.equal(result.status, 0, result.stderr);
  const { additionalContext } = JSON.parse(result.stdout).hookSpecificOutput;
  assert.match(additionalContext, /^[^\r\n]+with space\.tsx:[^\r\n]+noExplicitAny[^\r\n]*$/);
  assert.equal(fs.readFileSync(file, 'utf8'), edited);
  assert.match(git('diff', '--numstat', '--', 'frontend/src/with space.tsx'), /^1\t1\t/);
});

test('post-edit Biome keeps a patch rename in read-only mode', t => {
  const { frontend, file, run, git } = hookFixture(t);
  const source = 'export const value=1;\n';
  fs.writeFileSync(file, source);
  git('add', '--', 'frontend/src/with space.tsx');
  git('commit', '-qm', 'Track original TSX');
  git('mv', '--', 'frontend/src/with space.tsx', 'frontend/src/renamed.tsx');

  const result = run('apply_patch', {
    command: '*** Begin Patch\n*** Update File: frontend/src/with space.tsx\n*** Move to: frontend/src/renamed.tsx\n*** End Patch\n',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(fs.readFileSync(path.join(frontend, 'src', 'renamed.tsx'), 'utf8'), source);
});

test('Biome honors ESLint any waivers without hiding an any outside their scope', t => {
  const { file, run, git, check } = hookFixture(t);
  const waived = [
    '// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DrawIO peer API',
    'export const sameLine = ["\u{1f680}", 1 as any];',
    '/* eslint-disable @typescript-eslint/no-explicit-any */',
    'export const inBlock: any = 2;',
    '/* eslint-enable @typescript-eslint/no-explicit-any */',
    '',
  ].join('\n');
  fs.writeFileSync(file, waived);
  git('add', '--', 'frontend/src/with space.tsx');
  git('commit', '-qm', 'Track existing ESLint waivers');

  const clean = run('Edit', { file_path: file });
  assert.equal(clean.status, 0, clean.stderr);
  assert.equal(clean.stdout, '');
  const manual = check('frontend/src/with space.tsx');
  assert.equal(manual.status, 0, manual.stdout + manual.stderr);

  const edited = waived + 'export const unwaived: any = 3;\n';
  fs.writeFileSync(file, edited);
  const result = run('Edit', { file_path: file });
  const { additionalContext } = JSON.parse(result.stdout).hookSpecificOutput;
  assert.match(additionalContext, /^[^\r\n]+with space\.tsx:6:24: lint\/suspicious\/noExplicitAny:[^\r\n]+$/);
  assert.equal(fs.readFileSync(file, 'utf8'), edited);
});
