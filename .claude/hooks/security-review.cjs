// The main chat records the read-only reviewer's report. The PR hook checks it.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const skills = ['trailofbits-differential-review-static', 'getsentry-security-review-static'];
const markerPath = '.claude/.security-review-marker';
const maxAge = 30 * 60 * 1000;
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function git(cwd, args) {
  return execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args], {
    cwd, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1' },
  });
}

function lines0(buffer) {
  if (!buffer.length) return [];
  if (buffer.at(-1) !== 0) throw Error('Git returned an incomplete list of paths.');
  return utf8.decode(buffer.subarray(0, -1)).split('\0');
}

function disabledFilters(root) {
  // Even read-only Git status can invoke a configured clean/process driver.
  const names = lines0(git(root, ['config', '-z', '--name-only', '--list']));
  const options = [];
  for (const key of new Set(names)) {
    if (/^filter\..+\.(?:clean|process|required)$/.test(key)) {
      options.push('-c', key + (key.endsWith('.required') ? '=false' : '='));
    }
  }
  return options;
}

// Length-prefix every field, including paths and binary data.
function field(hash, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  hash.update(String(bytes.length) + ':').update(bytes);
}

async function workingFile(hash, root, name) {
  const file = path.join(root, name);
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) {
    field(hash, 'link');
    field(hash, fs.readlinkSync(file, { encoding: 'buffer' }));
  } else if (stat.isFile()) {
    field(hash, (stat.mode & 0o111) ? 'executable' : 'file');
    const contents = createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) contents.update(chunk);
    field(hash, contents.digest());
  } else {
    throw Error('Cannot fingerprint this changed entry: ' + name);
  }
}

async function snapshot(root) {
  const commit = git(root, ['rev-parse', '--verify', 'HEAD^{commit}']).toString().trim();
  const base = git(root, ['merge-base', 'origin/main', commit]).toString().trim();
  const hash = createHash('sha256');
  for (const value of ['turbo-ea/security-review/v1', root, base, commit]) field(hash, value);
  // Blob IDs and modes bind staged content, even when a working edit undoes it.
  field(hash, git(root, ['ls-files', '--stage', '-z']));
  const changes = lines0(git(root, [...disabledFilters(root), 'status', '--porcelain=v1', '-z',
    '--untracked-files=all', '--ignore-submodules=none', '--no-renames']));
  for (const change of changes) {
    const name = change.slice(3);
    if (name === markerPath) throw Error('The review marker must be ignored by Git.');
    field(hash, change);
    // A staged-only change is already identified by its blob. A deleted file has no bytes.
    if (change[1] !== ' ' && change[1] !== 'D') await workingFile(hash, root, name);
  }
  return { commit, scopeId: hash.digest('hex'), observedAt: Date.now() };
}

function fresh(timestamp, now) {
  return Number.isSafeInteger(timestamp) && timestamp > 0 && timestamp <= now && now - timestamp <= maxAge;
}

function validStrings(values) {
  return Array.isArray(values) && values.every(value => typeof value === 'string' && value.trim());
}

function validate(report, current) {
  if (!report || report.commit !== current.commit || report.scopeId !== current.scopeId) {
    throw Error('The report does not match the current checkout, commit and diff. Run security-reviewer again.');
  }
  if (!fresh(report.completedAt, current.observedAt)) {
    throw Error('The completion time is missing, in the future or older than 30 minutes. Run security-reviewer again.');
  }
  const passes = report.passes;
  if (!Array.isArray(passes) || passes.length !== skills.length || !skills.every(skill =>
    passes.some(pass => pass?.skill === skill && pass.status === 'completed'
      && validStrings(pass.findings) && validStrings(pass.gaps)))) {
    throw Error('A completed report with findings and gaps is required for each of the two security skills.');
  }
}

function persist(file, receipt) {
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temp, JSON.stringify(receipt) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

async function main() {
  const action = process.argv[2];
  if (process.argv.length !== 3 || !['snapshot', 'record', 'check'].includes(action)) {
    throw Error('Usage: node .claude/hooks/security-review.cjs snapshot|record|check');
  }
  const root = fs.realpathSync(git(process.cwd(), ['rev-parse', '--show-toplevel']).toString().trimEnd());
  if (action === 'snapshot') {
    console.log(JSON.stringify(await snapshot(root)));
    return;
  }
  const file = path.join(root, markerPath);
  if (fs.lstatSync(path.dirname(file)).isSymbolicLink()) throw Error('The marker directory must belong to the checkout.');
  if (action === 'record') {
    const report = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
    const current = await snapshot(root);
    validate(report, current);
    const { commit, scopeId, completedAt, passes } = report;
    persist(file, { commit, scopeId, completedAt, passes, recordedAt: current.observedAt });
    console.log('Recorded both security review passes for ' + commit + '.');
  } else {
    if (!fs.lstatSync(file, { throwIfNoEntry: false })?.isFile()) throw Error('No security review receipt. Run security-reviewer.');
    const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
    const current = await snapshot(root);
    if (!fresh(receipt?.recordedAt, current.observedAt) || receipt.completedAt > receipt.recordedAt) {
      throw Error('Invalid or expired security review receipt. Run security-reviewer again.');
    }
    validate(receipt, current);
  }
}

main().catch(error => {
  console.error('Security review: ' + error.message);
  process.exitCode = 2;
});
