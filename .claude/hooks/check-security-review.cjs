// PreToolUse for direct GitHub CLI commands in the two chat hosts.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { commands } = require('./shell-commands.cjs');

function repoSlug(url) {
  return url.trim().replace(/^(?:https?:\/\/|ssh:\/\/)?(?:git@)?github\.com[:/]/i, '')
    .replace(/\.git$/i, '').toLowerCase();
}

function pullRequest(args) {
  const options = {};
  const words = [];
  const targetFlags = { '-R': 'repo', '--repo': 'repo', '-H': 'head', '--head': 'head', '-B': 'base', '--base': 'base' };
  const otherValues = ['--title', '-t', '--body', '-b', '--body-file', '-F', '--reviewer', '-r',
    '--assignee', '-a', '--label', '-l', '--project', '-p', '--milestone', '-m', '--template', '-T', '--recover'];
  for (let i = 0; i < args.length; i++) {
    const word = args[i];
    if (otherValues.includes(word)) { i++; continue; }
    if (word === '--help' || word === '-h') return;
    const match = /^(--(?:repo|head|base))(?:=(.*))?$|^(-[RHB])(.*)$/.exec(word);
    if (match) {
      const attached = match[2] ?? (match[4] ? match[4].replace(/^=/, '') : undefined);
      options[targetFlags[match[1] || match[3]]] = attached ?? args[++i] ?? '';
    } else if (!word.startsWith('-')) {
      words.push(word);
    }
  }
  if (words[0] === 'pr' && ['create', 'new'].includes(words[1])) return options;
}

function checkTarget(options, cwd) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  function optionalGit(...args) {
    try { return git(...args); } catch (error) {
      if (error.status === 1) return undefined;
      throw error;
    }
  }
  const branch = git('branch', '--show-current');
  if (!branch) throw Error('Select the reviewed local branch before creating a PR.');
  const origin = repoSlug(git('remote', 'get-url', 'origin'));
  const repo = options.repo ?? process.env.GH_REPO;
  if (repo !== undefined && repoSlug(repo) !== origin) {
    throw Error('The review covers the origin repository of this checkout.');
  }
  if (repo === undefined) {
    const remotes = git('remote').split(/\r?\n/);
    if (remotes.length > 1) {
      const selected = remotes.filter(name => optionalGit('config', '--get', 'remote.' + name + '.gh-resolved') === 'base');
      const candidates = selected.length ? selected : remotes;
      if (!candidates.every(name => repoSlug(git('remote', 'get-url', name)) === origin)) {
        throw Error('The default PR repository is ambiguous or differs from origin. Use --repo with the origin owner and repository.');
      }
    }
  }
  const base = options.base ?? optionalGit('config', '--get', 'branch.' + branch + '.gh-merge-base')
    ?? optionalGit('symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD')?.replace(/^refs\/remotes\/origin\//, '');
  if (base !== 'main') throw Error('The review covers origin/main. Use --base main for this PR.');
  if (options.head !== undefined && options.head !== branch) {
    const [owner, ...name] = options.head.split(':');
    if (owner.toLowerCase() !== origin.split('/')[0] || name.join(':') !== branch) {
      throw Error('The PR head must match the reviewed branch in the origin repository.');
    }
  }
}

function check(event) {
  if (event.hook_event_name !== 'PreToolUse') return;
  const input = event.tool_input || {};
  const shell = input.command ?? input.cmd;
  if (typeof shell !== 'string') throw Error('The security review hook could not read the shell command.');
  const groups = commands(shell, input.shell || event.tool_name);
  for (const argv of groups) {
    let i = 0;
    while (/^\w+=/.test(argv[i])) i++;
    if (!/(?:^|[\\/])gh(?:\.exe)?$/i.test(argv[i] || '')) continue;
    const options = pullRequest(argv.slice(i + 1));
    if (!options) continue;
    if (groups.length > 1 || i > 0) {
      throw Error('Run the PR command separately in the reviewed checkout so its diff can be verified.');
    }
    const cwd = path.resolve(event.cwd || process.cwd(), input.workdir || '.');
    checkTarget(options, cwd);
    const result = spawnSync(process.execPath, [path.join(__dirname, 'security-review.cjs'), 'check'],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (result.status !== 0) throw Error(result.stderr?.trim() || 'Could not verify the security review receipt.');
  }
}

try {
  check(JSON.parse(fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, '')));
} catch (error) {
  console.log(JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: error.message,
  } }));
}
