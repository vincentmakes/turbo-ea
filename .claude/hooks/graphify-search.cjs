// Shared PreToolUse reminder for Claude Code and Codex in Turbo EA.
const fs = require('node:fs');

function isSearch(event) {
  if (event.tool_name === 'Grep' || event.tool_name === 'Glob') return true;
  if (event.tool_name !== 'Bash') return false;

  // Codex sends its shell invocation here, including "rg --files".
  const command = event.tool_input?.command;
  return typeof command === 'string' && /^\s*(?:&\s+)?(?:rg|grep)(?:\.exe)?(?=\s|$)/i.test(command);
}

function main() {
  let event;
  try {
    event = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return;
  }

  if (event?.hook_event_name !== 'PreToolUse' || !isSearch(event)) return;

  const reminder = 'Se stai cercando un testo preciso o un file di cui conosci il nome, prosegui con la ricerca. '
    + 'Se vuoi capire chi chiama una funzione, come sono collegati due componenti o cosa risente di una modifica, consulta prima Graphify.';
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: reminder },
  }) + '\n');
}

main();
