const fs = require('node:fs');
const path = require('node:path');
const { pythonFile, runRuff, compactError } = require('./python-check.cjs');
const { selectFile, runBiome, biomeFeedback } = require('./frontend-check.cjs');

function editedPaths({ tool_name, tool_input }) {
  if (['Edit', 'Write', 'MultiEdit'].includes(tool_name)) return [tool_input?.file_path];
  if (tool_name !== 'apply_patch' || typeof tool_input?.command !== 'string') return [];
  return Array.from(
    tool_input.command.matchAll(/^\*\*\* (?:Add File|Update File|Move to): ([^\r\n]+)/gm),
    match => match[1],
  );
}

function postEdit({ pythonOnly = false } = {}) {
  const event = JSON.parse(fs.readFileSync(0, 'utf8'));
  const root = fs.realpathSync(path.resolve(__dirname, '../..'));
  const cwd = event.cwd || root;
  const edited = editedPaths(event).filter(file => typeof file === 'string')
    .map(file => path.resolve(cwd, file));
  const backend = path.join(root, 'backend');
  const frontend = path.join(root, 'frontend');
  const ruffFiles = [...new Set(edited.map(file => pythonFile(backend, cwd, file)).filter(Boolean))];
  const biomeFiles = pythonOnly ? []
    : [...new Set(edited.map(file => selectFile(frontend, file)).filter(Boolean))];

  const messages = [];
  if (ruffFiles.length) {
    const result = runRuff(backend, ruffFiles, true);
    messages.push(result.stdout?.trim(), compactError(result));
  }
  if (biomeFiles.length) messages.push(biomeFeedback(runBiome(frontend, biomeFiles, true)));
  const additionalContext = messages.filter(Boolean).join('\n');
  if (additionalContext) {
    console.log(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext },
    }));
  }
}

module.exports = { postEdit };
if (require.main === module) postEdit();
