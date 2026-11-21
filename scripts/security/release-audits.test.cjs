const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const hook = path.resolve(__dirname, '../../.claude/hooks/release-audits.cjs');
const audits = ['security-audit', 'ponytail-audit'];

function setup(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'release audit '));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git('init', '-q');
  const commit = message => {
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.org',
      '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  const first = commit('first');
  const report = path.join(cwd, 'report.md');
  const run = (args, event) => spawnSync(process.execPath, [hook, ...args], {
    cwd, encoding: 'utf8', input: event && JSON.stringify(event),
  });
  const reportText = (audit, sha = first) =>
    ['Audit: ' + audit, 'Commit: ' + sha, 'Outcome: pass', '', 'Full repository review completed.'].join('\n');
  const record = (audit, sha = first, contents = reportText(audit, sha)) => {
    fs.writeFileSync(report, contents);
    return run(['record', audit, sha, report]);
  };
  const verdict = (command, input = {}, tool = 'Bash') => {
    const r = run([], { cwd, hook_event_name: 'PreToolUse', tool_name: tool,
      tool_input: { command, ...input } });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'allow';
  };
  return { cwd, git, first, commit, report, reportText, record, verdict };
}

test('requires both reviewed reports on the tagged commit and persists their contents', t => {
  const { first, commit, report, record, verdict } = setup(t);
  assert.equal(verdict('git tag v1.0.0'), 'deny');
  assert.equal(record(audits[0]).status, 0);
  assert.equal(verdict('git tag -sm "release candidate" v1.1.0-rc.2'), 'deny');
  assert.equal(record(audits[1]).status, 0);
  fs.unlinkSync(report);
  assert.equal(verdict('git tag -sm "release candidate" v1.1.0-rc.2'), 'allow');
  commit('new HEAD');
  assert.equal(verdict('git tag v1.0.1'), 'deny');
  assert.equal(verdict('git tag v1.0.1 ' + first), 'allow');
  assert.equal(verdict('git tag v1.0.1 missing-object'), 'deny');
});

test('explicit push checks the source of each release tag', t => {
  const { git, commit, record, verdict } = setup(t);
  for (const audit of audits) assert.equal(record(audit).status, 0);
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.org',
    'tag', '-a', 'v1.0.0', '-m', 'first');
  commit('second');
  git('tag', 'v1.0.1');
  for (const ref of ['v1.0.0', 'tag v1.0.0', 'refs/tags/v1.0.0',
    '+refs/tags/v1.0.0:refs/tags/v2.0.0']) {
    assert.equal(verdict('git push origin ' + ref), 'allow', ref);
  }
  for (const ref of ['v1.0.1', 'tag v1.0.1', 'v1.0.0 v1.0.1',
    'HEAD:refs/tags/v2.0.0', 'HEAD:v2.0.0', 'refs/tags/v1.2.3']) {
    assert.equal(verdict('git push origin ' + ref), 'deny', ref);
  }
});

test('common shell forms, ordinary Git commands, tag reads and deletes', t => {
  const { cwd, verdict } = setup(t);
  assert.equal(verdict(undefined, { cmd: '& git.exe tag -a v1.0.0 -m "release"' }, 'PowerShell'), 'deny');
  for (const command of ['git status', 'git tag', 'git tag -l "v*"', 'git tag -ln10 "v*"',
    'git tag --list v1.0.0', 'git tag -v v1.0.0', 'git tag -d v1.0.0',
    'git tag feature-snapshot', 'git push', 'git push origin main',
    'git push origin --delete v1.0.0', 'git push origin :refs/tags/v1.0.0',
    'git push origin refs/heads/*:refs/heads/*', 'echo "git tag v1.0.0"',
    'gh release list', 'gh release create docs-snapshot', 'gh release create v1.0.0 --verify-tag']) {
    assert.equal(verdict(command), 'allow', command);
  }
  for (const command of ['git.exe tag -a v1.0.0 -m "release"',
    '& git tag v1.0.0', 'git -C "' + cwd + '" tag v1.0.0',
    'git status && git tag v1.0.0', 'git push --tags origin', 'git push --mirror origin',
    'git push origin --follow-tags main', 'git push origin refs/tags/*:refs/tags/*',
    'git tag --sort=-taggerdate v1.1.0', 'git tag --format="%(refname)" v1.1.0',
    'git tag --column v1.1.0', 'git push origin $env:RELEASE_TAG',
    'git push origin --dry-run --no-dry-run v1.0.0',
    'gh release create v1.0.0', 'gh -R owner/repo release create --title "candidate" v1.1.0-rc.1',
    'git -c push.followTags=true push origin main', 'git \\\n tag v1.0.0']) {
    assert.equal(verdict(command), 'deny', command);
  }
  assert.equal(verdict('git ' + String.fromCharCode(96) + '\r\n tag v1.0.0', {}, 'PowerShell'), 'deny');
});

test('separate repositories containing the same commit require their own reports', t => {
  const { cwd, git, first, record, verdict } = setup(t);
  for (const audit of audits) assert.equal(record(audit).status, 0);
  const other = path.join(cwd, 'clone with spaces');
  git('init', '-q', other);
  fs.cpSync(path.join(cwd, '.git/objects'), path.join(other, '.git/objects'), { recursive: true });
  git('-C', other, 'update-ref', 'HEAD', first);
  assert.equal(verdict('git tag v1.0.0', { workdir: other }), 'deny');
  assert.equal(verdict('git -C "' + other + '" tag v1.0.0'), 'deny');
  assert.equal(verdict('git tag v1.0.0'), 'allow');
  assert.equal(verdict('git status && git tag v1.0.0'), 'deny');
});

test('publishing tag names must use the canonical stable or RC format', t => {
  const { record, verdict } = setup(t);
  for (const audit of audits) assert.equal(record(audit).status, 0);
  for (const name of ['v1.2.3-beta.1', 'vnext.release.preview', 'v01.2.3', 'v1.2.3-rc.01']) {
    for (const command of ['git tag ' + name, 'git push origin tag ' + name,
      'git push origin HEAD:refs/tags/' + name, 'gh release create ' + name,
      'gh release create --verify-tag ' + name]) assert.equal(verdict(command), 'deny', command);
  }
  for (const name of ['v1.2.3', 'v1.2.3-rc.0', 'docs.snapshot.1', 'vendor/docs.2.3']) {
    assert.equal(verdict('git tag ' + name), 'allow', name);
  }
});

test('grouped commands check the release target and quoted messages stay literal', t => {
  const { record, verdict } = setup(t);
  const grouped = '(git tag v1.2.3)';
  assert.equal(verdict(grouped), 'deny');
  assert.equal(verdict('{ git tag v1.2.3; }'), 'deny');
  assert.equal(verdict("echo '(git tag v1.2.3)'"), 'allow');
  assert.equal(verdict('(git status)'), 'allow');
  for (const audit of audits) assert.equal(record(audit).status, 0);
  assert.equal(verdict(grouped), 'allow');
  assert.equal(verdict('git tag v1.2.3 "$(git status)"'), 'deny');
});

test('recorder rejects incomplete attestations and scoped evidence fails closed on damage', t => {
  const { cwd, first, record, reportText, verdict } = setup(t);
  assert.notEqual(record('diff').status, 0);
  assert.notEqual(record(audits[0], first.slice(0, 8)).status, 0);
  assert.notEqual(record(audits[0], 'f'.repeat(40)).status, 0);
  const good = reportText(audits[0]);
  for (const bad of [' \n ', 'reviewed', reportText(audits[1]), reportText(audits[0], 'f'.repeat(40)),
    good.replace('pass', 'fail'), good.replace('Full repository review completed.', ''),
    good + '\nOutcome: fail']) assert.notEqual(record(audits[0], first, bad).status, 0, bad);
  for (const name of audits) assert.equal(record(name).status, 0);
  const evidence = path.join(cwd, '.git', 'turbo-ea-release-audits', first, audits[0] + '.json');
  const original = JSON.parse(fs.readFileSync(evidence, 'utf8'));
  for (const value of ['{', '{}', JSON.stringify({ ...original, sha: 'f'.repeat(40) }),
    JSON.stringify({ ...original, report: 'altered' })]) {
    fs.writeFileSync(evidence, value);
    assert.equal(verdict('git tag v1.0.0'), 'deny');
  }
});

test('repository push.followTags requires an explicit opt-out for a branch-only push', t => {
  const { git, verdict } = setup(t);
  git('config', '--local', 'push.followTags', 'true');
  assert.equal(verdict('git push origin main'), 'deny');
  assert.equal(verdict('git push --no-follow-tags origin main'), 'allow');
});

test('push checks mirror and refspec defaults before allowing implicit destinations', t => {
  const { cwd, git, verdict } = setup(t);
  git('config', 'remote.backup.mirror', 'true');
  git('config', 'remote.pushDefault', 'backup');
  for (const command of ['git push', 'git push backup', 'git push --repo=backup',
    'git push backup HEAD:refs/heads/main', 'git push --no-follow-tags backup']) {
    assert.equal(verdict(command), 'deny', command);
  }
  assert.equal(verdict('git push origin main'), 'allow');
  assert.equal(verdict('git push --dry-run backup'), 'allow');

  git('config', 'remote.backup.mirror', 'false');
  git('config', '--add', 'remote.backup.push', 'refs/heads/*:refs/heads/*');
  git('config', '--add', 'remote.backup.push', 'HEAD');
  assert.equal(verdict('git push backup'), 'allow');
  git('config', '--add', 'remote.backup.push', 'refs/heads/main:refs/tags/v1.0.0');
  for (const command of ['git push', 'git push backup', 'git push backup main']) {
    assert.equal(verdict(command), 'deny', command);
  }
  assert.equal(verdict('git push backup HEAD:refs/heads/main'), 'allow');
  assert.equal(verdict('git push origin main'), 'allow');
  assert.equal(verdict('git -c remote.origin.mirror=true push origin'), 'deny');
  git('config', 'branch.' + git('symbolic-ref', '--short', 'HEAD') + '.merge', 'refs/tags/v1.0.0');
  assert.equal(verdict('git push origin'), 'deny');
  assert.equal(verdict('git push origin main:refs/heads/main'), 'allow');
  const remotes = path.join(cwd, '.git', 'remotes');
  fs.mkdirSync(remotes, { recursive: true });
  fs.writeFileSync(path.join(remotes, 'archive'), 'Push: refs/tags/*:refs/tags/*\n');
  assert.equal(verdict('git push archive main'), 'deny');
  assert.equal(verdict('git push archive main:refs/heads/main'), 'allow');
  assert.equal(verdict('git push origin main'), 'allow');
});

test('Claude and Codex each register the release gate before a shell command', () => {
  for (const name of ['.claude/settings.json', '.codex/hooks.json']) {
    const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../..', name), 'utf8'));
    for (const tool of name.startsWith('.claude') ? ['Bash', 'PowerShell'] : ['Bash']) {
      const matches = config.hooks.PreToolUse.filter(group => new RegExp(group.matcher).test(tool))
        .flatMap(group => group.hooks).filter(hook => hook.command?.includes('.claude/hooks/release-audits.cjs'));
      assert.equal(matches.length, 1, name + ' ' + tool);
      assert.equal(matches[0].type, 'command');
    }
  }
});

test('Codex launches the release hook from a checkout subdirectory', t => {
  const { cwd } = setup(t);
  const hooks = path.join(cwd, '.claude/hooks');
  fs.mkdirSync(hooks, { recursive: true });
  for (const file of ['shell-commands.cjs', 'release-audits.cjs']) {
    fs.copyFileSync(path.join(path.dirname(hook), file), path.join(hooks, file));
  }
  const subdir = path.join(cwd, 'backend');
  fs.mkdirSync(subdir);
  const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../.codex/hooks.json'), 'utf8'));
  const launcher = config.hooks.PreToolUse.filter(group => new RegExp(group.matcher).test('Bash'))
    .flatMap(group => group.hooks).find(h => h.command?.includes('release-audits.cjs'));
  const result = spawnSync(launcher.command, {
    cwd: subdir, shell: true, encoding: 'utf8', input: JSON.stringify({
      cwd: subdir, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { cmd: 'git tag v1.2.3' },
    }),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
});
