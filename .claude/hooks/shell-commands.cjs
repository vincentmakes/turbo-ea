// Read direct commands without executing them. A nested substitution stays a
// separate command so the gates cannot mistake it for a standalone operation.
// Arbitrary scripts, shell aliases and wrappers are outside this chat hook.
const psEscapes = { 0: '\0', a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };

function commands(source, event = {}) {
  const input = event.tool_input || {};
  // Codex calls its shell tool Bash even when exec_command runs PowerShell on Windows.
  const shell = input.shell || (typeof input.cmd === 'string' && process.platform === 'win32'
    ? 'PowerShell' : event.tool_name);
  const binary = (shell || '').split(/[\\/]/).at(-1).toLowerCase().replace(/\.exe$/, '');
  const powerShell = binary === 'powershell' || binary === 'pwsh';
  const modernPS = binary === 'pwsh' || (powerShell && !input.shell);
  const result = [];
  let pos = 0;

  function readPowerShellEscape() {
    const ch = source[pos++];
    if (modernPS && ch === 'e') return '\x1b';
    if (modernPS && ch === 'u') {
      const unicode = /^\{([0-9a-f]{1,6})\}/i.exec(source.slice(pos, pos + 8));
      if (unicode && parseInt(unicode[1], 16) <= 0x10ffff) {
        pos += unicode[0].length;
        return String.fromCodePoint(parseInt(unicode[1], 16));
      }
    }
    return psEscapes[ch] ?? ch;
  }

  function readGroup(end) {
    let args = [];
    let word;
    let quote = '';
    function finishWord() {
      if (word !== undefined) args.push(word);
      word = undefined;
    }
    function finishCommand() {
      finishWord();
      if (args.length) result.push(args);
      args = [];
    }
    while (pos < source.length) {
      const ch = source[pos++];
      const next = source[pos];
      if (!quote && ch === end) break;
      if (quote !== "'" && powerShell && ch === '\x60' && next !== undefined) {
        if (word === undefined && (next === '\n' || source.startsWith('\r\n', pos))) {
          pos += next === '\r' ? 2 : 1;
        } else {
          word = (word ?? '') + readPowerShellEscape();
        }
      } else if (quote !== "'" && !powerShell && ch === '\\' && next !== undefined
        && (!quote || /["$\x60\\\n]/.test(next))) {
        pos++;
        if (next !== '\n') word = (word ?? '') + next;
      } else if (quote !== "'" && !powerShell && ch === '\x60') {
        word = (word ?? '') + '$()';
        readGroup('\x60');
      } else if (quote !== "'" && ch === '$' && next === '(') {
        word = (word ?? '') + '$()';
        pos++;
        readGroup(')');
      } else if (quote) {
        if (powerShell && ch === quote && next === quote) word += source[pos++];
        else if (ch === quote) quote = '';
        else word += ch;
      } else if (ch === '"' || ch === "'") {
        word ??= '';
        quote = ch;
      } else if (ch === '(' || (ch === '{' && word === undefined && !args.length)) {
        finishCommand();
        readGroup(ch === '(' ? ')' : '}');
      } else if (/[;&|\n]/.test(ch)) {
        finishCommand();
      } else if (/\s/.test(ch)) {
        finishWord();
      } else {
        word = (word ?? '') + ch;
      }
    }
    finishCommand();
  }

  readGroup();
  return result;
}

module.exports = { commands };
