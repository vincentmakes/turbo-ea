// Recognize direct commands, quoted arguments and shell separators without
// executing any input. Arbitrary scripts, shell aliases and wrappers are outside this chat hook.
function commands(text) {
  const parts = [[]];
  const joined = text.replace(/[\\\x60]\r?\n/g, '');
  const tokens = joined.match(/(?:[^\s"';&|]+|"[^"]*"|'[^']*')+|&&|\|\||[;&|\n]/g) || [];
  for (const token of tokens) {
    if (/^(?:&&|\|\||[;&|\n])$/.test(token)) {
      if (parts.at(-1).length) parts.push([]);
    } else {
      parts.at(-1).push(token.replace(/"([^"]*)"|'([^']*)'/g, (_, dq, sq) => dq ?? sq));
    }
  }
  return parts.filter(part => part.length);
}

module.exports = { commands };
