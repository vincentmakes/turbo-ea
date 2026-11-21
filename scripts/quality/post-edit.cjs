const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pythonFile, runRuff, compactError } = require('./python-check.cjs');
const { selectFile, runBiome, biomeFeedback } = require('./frontend-check.cjs');

function editedPaths({ tool_name, tool_input }) {
  if (['Edit', 'Write', 'MultiEdit'].includes(tool_name)) return [{ file: tool_input?.file_path }];
  if (tool_name !== 'apply_patch' || typeof tool_input?.command !== 'string') return [];
  return Array.from(
    tool_input.command.matchAll(/^\*\*\* (Add File|Update File|Move to): ([^\r\n]+)/gm),
    ([, action, file]) => ({ file, moved: action === 'Move to' }),
  );
}

function lintAndFixBiome(root, frontend, files) {
  const targets = Array.from(files, ([file, moved]) => ({
    file, moved, repoPath: `frontend/${file.split(path.sep).join('/')}`,
  }));
  const tree = spawnSync('git', [
    '--literal-pathspecs', 'ls-tree', '-rz', '--name-only', 'HEAD', '--',
    ...targets.map(({ repoPath }) => repoPath),
  ], { cwd: root, encoding: 'utf8', windowsHide: true });
  const committed = new Set(tree.stdout?.split('\0'));
  const lint = [];
  const fix = [];
  for (const { file, moved, repoPath } of targets) {
    const isNew = tree.status === 0 && !moved && !committed.has(repoPath);
    (isNew ? fix : lint).push(file);
  }
  return [
    lint.length ? biomeFeedback(runBiome(frontend, lint, 'lint')) : '',
    fix.length ? biomeFeedback(runBiome(frontend, fix, 'fix')) : '',
  ];
}

function postEdit({ pythonOnly = false } = {}) {
  const event = JSON.parse(fs.readFileSync(0, 'utf8'));
  const root = fs.realpathSync(path.resolve(__dirname, '../..'));
  const cwd = event.cwd || root;
  const edited = editedPaths(event).filter(({ file }) => typeof file === 'string')
    .map(({ file, moved }) => ({ file: path.resolve(cwd, file), moved }));
  const backend = path.join(root, 'backend');
  const frontend = path.join(root, 'frontend');
  const ruffFiles = [...new Set(edited.map(({ file }) => pythonFile(backend, cwd, file)).filter(Boolean))];
  const biomeFiles = new Map();
  if (!pythonOnly) {
    for (const { file, moved } of edited) {
      const selected = selectFile(frontend, file);
      if (selected) biomeFiles.set(selected, moved || biomeFiles.get(selected));
    }
  }

  const messages = [];
  if (ruffFiles.length) {
    const result = runRuff(backend, ruffFiles, true);
    messages.push(result.stdout?.trim(), compactError(result));
  }
  if (biomeFiles.size) messages.push(...lintAndFixBiome(root, frontend, biomeFiles));
  const additionalContext = messages.filter(Boolean).join('\n');
  if (additionalContext) {
    console.log(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext },
    }));
  }
}

module.exports = { postEdit };
if (require.main === module) postEdit();
