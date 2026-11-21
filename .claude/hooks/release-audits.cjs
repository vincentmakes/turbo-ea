// Chat PreToolUse gate for direct Git commands. The recorder is an explicit
// attestation by the reviewer; neither the hook nor Git runs either audit.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const { commands } = require('./shell-commands.cjs');

const audits = ['security-audit', 'ponytail-audit'];
const number = '(?:0|[1-9][0-9]*)';
const release = new RegExp('^v' + number + '\\.' + number + '\\.' + number + '(?:-rc\\.' + number + ')?$');
const fullSha = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const digest = report => createHash('sha256').update(report).digest('hex');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commit(cwd, ref) {
  try {
    return git(cwd, ['rev-parse', '--verify', '--end-of-options', ref + '^{commit}']);
  } catch {
    throw Error('Cannot resolve the release target to a local commit. Use an explicit local reference.');
  }
}

function evidenceDir(cwd, sha) {
  const common = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return path.join(common, 'turbo-ea-release-audits', sha);
}

function validReport(report, audit, sha) {
  if (typeof report !== 'string') return false;
  const lines = report.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const headers = ['Audit: ' + audit, 'Commit: ' + sha, 'Outcome: pass'];
  const metadata = lines.filter(line => /^(?:Audit|Commit|Outcome):/.test(line));
  return lines.length > metadata.length && metadata.length === headers.length
    && headers.every(header => metadata.includes(header));
}

function record(args) {
  const [action, audit, sha, file] = args;
  if (args.length !== 4 || action !== 'record' || !audits.includes(audit) || !fullSha.test(sha)) {
    throw Error('Usage: node .claude/hooks/release-audits.cjs record <security-audit|ponytail-audit> <full-commit-sha> <report-file>');
  }
  const cwd = process.cwd();
  if (commit(cwd, sha) !== sha) throw Error('Supply the full audited commit SHA.');
  if (!fs.statSync(file).isFile()) throw Error('The report must be a file.');
  const report = fs.readFileSync(file, 'utf8');
  if (!validReport(report, audit, sha)) throw Error('The report must include the audit findings and separate lines for Audit: '
    + audit + ', Commit: ' + sha + ' and Outcome: pass.');
  const dir = evidenceDir(cwd, sha);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, randomUUID() + '.tmp');
  try {
    fs.writeFileSync(tmp, JSON.stringify({ audit, sha, report, digest: digest(report) }), {
      flag: 'wx', mode: 0o600,
    });
    fs.renameSync(tmp, path.join(dir, audit + '.json'));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function requireAudits(cwd, ref) {
  const sha = commit(cwd, ref);
  const dir = evidenceDir(cwd, sha);
  const missing = audits.filter(audit => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, audit + '.json'), 'utf8'));
      return data.audit !== audit || data.sha !== sha || !validReport(data.report, audit, sha)
        || data.digest !== digest(data.report);
    } catch {
      return true;
    }
  });
  if (missing.length) throw Error('Release blocked for ' + sha + '. Run and review the full-repository '
    + missing.join(' and ') + ', then record each passing report with node .claude/hooks/release-audits.cjs record <audit> '
    + sha + ' <report-file>.');
}

function dynamic(value) {
  return /[$%*?]/.test(value);
}

function isRelease(name) {
  // The three publishing workflows subscribe to v*.*.*. A single * excludes '/'.
  if (!/^v[^/]*\.[^/]*\.[^/]*$/.test(name)) return false;
  if (!release.test(name)) throw Error('Use a stable vX.Y.Z or candidate vX.Y.Z-rc.N release tag with canonical numeric components.');
  return true;
}

function tagTargets(args) {
  const operands = [];
  let endOptions = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (endOptions || !arg.startsWith('-')) operands.push(arg);
    else if (arg === '--') endOptions = true;
    else if (/^--(?:list|delete|verify|contains|no-contains|merged|no-merged|points-at)(?:=|$)/.test(arg)
      || /^-[ildvn]*[ldvn][ildvn]*\d*$/.test(arg)) return [];
    else if (['--message', '--file', '--local-user', '--trailer', '--cleanup', '--sort', '--format'].includes(arg)
      || /^-[asf]*[mFu]$/.test(arg)) i++;
  }
  const [name, target = 'HEAD'] = operands;
  if (!name) return [];
  if (dynamic(name)) throw Error('Use the literal release tag name so its target can be checked.');
  return isRelease(name) ? [target] : [];
}

function followsTags(cwd) {
  try {
    return git(cwd, ['config', '--bool', '--get', 'push.followTags']) === 'true';
  } catch (error) {
    if (error.status === 1) return false;
    throw Error('Could not verify the Git push.followTags setting. Use an explicit --no-follow-tags push.');
  }
}

function pushTargets(args, cwd, followTags) {
  const operands = [];
  let remoteByOption = false;
  let bulk = false;
  let deletion = false;
  let dryRun = false;
  let endOptions = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (endOptions || !arg.startsWith('-')) operands.push(arg);
    else if (arg === '--') endOptions = true;
    else if (arg === '--repo' || arg.startsWith('--repo=')) {
      remoteByOption = true;
      if (arg === '--repo') i++;
    } else if (['--tags', '--mirror'].includes(arg)) bulk = true;
    else if (arg === '--follow-tags') followTags = true;
    else if (arg === '--no-follow-tags') followTags = false;
    else if (arg === '--delete' || /^-[fquv]*d[fquv]*$/.test(arg)) deletion = true;
    else if (arg === '--no-delete') deletion = false;
    else if (['--push-option', '-o', '--receive-pack', '--exec'].includes(arg)) i++;
    else if (arg === '--dry-run' || /^-[fquv]*n[fquv]*$/.test(arg)) dryRun = true;
    else if (arg === '--no-dry-run') dryRun = false;
  }
  if (deletion || dryRun) return [];
  if (bulk || (followTags ?? followsTags(cwd))) throw Error('Push release tags individually by explicit ref and disable automatic tag following with --no-follow-tags.');
  if (!remoteByOption) operands.shift();
  const targets = [];
  for (let i = 0; i < operands.length; i++) {
    if (operands[i] === 'tag' && operands[i + 1]) {
      const name = operands[++i];
      if (dynamic(name)) throw Error('Use an explicit local tag and destination.');
      if (isRelease(name)) targets.push('refs/tags/' + name);
      continue;
    }
    const spec = operands[i].replace(/^\+/, '');
    if (/^\$env:/i.test(spec)) throw Error('Use a literal push ref so its target can be verified.');
    const [source, dest = source] = spec.split(':');
    if (!source || dest.startsWith('refs/') && !dest.startsWith('refs/tags/') && !dynamic(dest.split('/')[1])) continue;
    const name = dest.replace(/^refs\/tags\//, '');
    if (dynamic(name)) throw Error('Push release tags by explicit ref so each audited commit can be checked.');
    if (isRelease(name)) targets.push(source === dest && !source.includes('/') ? 'refs/tags/' + source : source);
  }
  return targets;
}

function checkGh(args) {
  const words = [];
  let verifyTag = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['-R', '--repo', '--target', '-F', '--notes-file', '-n', '--notes', '-t',
      '--title', '--discussion-category', '--notes-start-tag'].includes(arg)) i++;
    else if (arg === '--verify-tag' || arg === '--verify-tag=true') verifyTag = true;
    else if (arg === '--verify-tag=false') verifyTag = false;
    else if (!arg.startsWith('-')) words.push(arg);
  }
  const [group, action, name] = words;
  if (group !== 'release' || action !== 'create') return;
  if (!name || dynamic(name)) throw Error('Specify the literal release tag name.');
  if (isRelease(name) && !verifyTag) {
    throw Error('gh release create can create a remote tag. Create and push the audited tag with Git, then use the normal release workflow.');
  }
}

function check(event) {
  if (event?.hook_event_name !== 'PreToolUse') return;
  const input = event.tool_input || {};
  const shell = input.command ?? input.cmd;
  if (typeof shell !== 'string') return;
  const groups = commands(shell, input.shell || event.tool_name);
  for (const args of groups) {
    let i = 0;
    while (/^\w+=/.test(args[i])) i++;
    const environmentOverride = i > 0;
    if (/(?:^|[\\/])gh(?:\.exe)?$/i.test(args[i] || '')) checkGh(args.slice(i + 1));
    if (!/(?:^|[\\/])git(?:\.exe)?$/i.test(args[i] || '')) continue;
    i++;
    let cwd = path.resolve(event.cwd || process.cwd(), input.workdir || '.');
    let configOverride = environmentOverride;
    let followTags;
    while (args[i]?.startsWith('-')) {
      const opt = args[i++];
      if (opt === '-C' && args[i] !== undefined) cwd = path.resolve(cwd, args[i++]);
      else if (opt === '-c' || opt === '--git-dir' || opt === '--work-tree' || opt === '--namespace') {
        if (opt === '-c' && /^push\.followtags(?:=|$)/i.test(args[i])) {
          followTags = !/^push\.followtags=(?:false|no|off|0|)$/i.test(args[i]);
        }
        i++;
        configOverride = true;
      } else if (opt !== '--no-pager' && opt !== '--no-optional-locks') configOverride = true;
    }
    const operation = args[i++];
    const refs = operation === 'tag' ? tagTargets(args.slice(i))
      : operation === 'push' ? pushTargets(args.slice(i), cwd, followTags) : [];
    if (!refs.length) continue;
    if (groups.length !== 1 || configOverride) {
      throw Error('Run the release command separately with a literal repository path and without Git overrides so its target can be verified.');
    }
    for (const ref of new Set(refs)) requireAudits(cwd, ref);
  }
}

if (process.argv.length > 2) {
  try {
    record(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
} else {
  try {
    check(JSON.parse(fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, '')));
  } catch (error) {
    console.log(JSON.stringify({ hookSpecificOutput: {
      hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: error.message,
    } }));
  }
}
