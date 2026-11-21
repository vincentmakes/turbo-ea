// Read direct commands without executing them. A nested substitution stays a
// separate command so the gates cannot mistake it for a standalone operation.
// Arbitrary scripts, shell aliases and wrappers are outside this chat hook.
function commands(text, shell = '') {
  const source = text.replace(/[\\\x60]\r?\n/g, '');
  const powerShell = /(?:^|[\\/])(?:powershell|pwsh)(?:\.exe)?$/i.test(shell);
  const result = [];
  let pos = 0;

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
      if (quote !== "'" && next !== undefined && (powerShell ? ch === '\x60'
        : ch === '\\' && /["$\x60\\]/.test(next))) {
        word = (word ?? '') + source[pos++];
      } else if (quote !== "'" && !powerShell && ch === '\x60') {
        word = (word ?? '') + '$()';
        readGroup('\x60');
      } else if (quote !== "'" && ch === '$' && next === '(') {
        word = (word ?? '') + '$()';
        pos++;
        readGroup(')');
      } else if (quote) {
        if (ch === quote) quote = '';
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
