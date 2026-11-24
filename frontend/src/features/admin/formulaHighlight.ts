// ── Syntax highlighting ───────────────────────────────────────────

const FORMULA_FUNCTIONS = new Set([
  "IF",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "COUNT",
  "ROUND",
  "ABS",
  "LN",
  "COALESCE",
  "LOWER",
  "UPPER",
  "CONCAT",
  "CONTAINS",
  "PLUCK",
  "FILTER",
  "MAP_SCORE",
]);
const FORMULA_BUILTINS = new Set([
  "len",
  "str",
  "int",
  "float",
  "bool",
  "abs",
  "round",
  "min",
  "max",
  "sum",
]);
const FORMULA_KEYWORDS = new Set(["is", "not", "or", "and", "in"]);
const FORMULA_CONSTANTS = new Set(["None", "True", "False"]);

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Simple tokenizer that produces syntax-highlighted HTML. */
export function highlightFormula(code: string): string {
  // Process line by line to handle # comments
  return code
    .split("\n")
    .map((line) => {
      const commentIdx = findCommentStart(line);
      if (commentIdx === 0) return `<span class="hl-comment">${escapeHtml(line)}</span>`;
      const codePart = commentIdx >= 0 ? line.slice(0, commentIdx) : line;
      const commentPart = commentIdx >= 0 ? line.slice(commentIdx) : "";
      return (
        highlightLine(codePart) +
        (commentPart ? `<span class="hl-comment">${escapeHtml(commentPart)}</span>` : "")
      );
    })
    .join("\n");
}

/** Find the start of a # comment (not inside a string). */
function findCommentStart(line: string): number {
  let inStr: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inStr) {
      if (ch === inStr && line[i - 1] !== "\\") inStr = null;
    } else if (ch === '"' || ch === "'") {
      inStr = ch;
    } else if (ch === "#") {
      return i;
    }
  }
  return -1;
}

/** Highlight a single line of code (no comments). */
function highlightLine(line: string): string {
  // Regex that matches tokens in order of priority
  const rx =
    /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b\d+(?:\.\d+)?\b)|(\.?\b[a-zA-Z_]\w*\b)|([>=<!]=|[+\-*/%<>=,(){}:[\]])/g;
  let result = "";
  let lastIdx = 0;
  let m;
  while ((m = rx.exec(line)) !== null) {
    if (m.index > lastIdx) result += escapeHtml(line.slice(lastIdx, m.index));
    if (m[1]) {
      // string
      result += `<span class="hl-string">${escapeHtml(m[1])}</span>`;
    } else if (m[2]) {
      // number
      result += `<span class="hl-number">${escapeHtml(m[2])}</span>`;
    } else if (m[3]) {
      // word
      const word = m[3];
      if (word.startsWith(".")) {
        // .property access — highlight the dot as punctuation, word as property
        result += `<span class="hl-punct">.</span><span class="hl-property">${escapeHtml(word.slice(1))}</span>`;
      } else if (FORMULA_FUNCTIONS.has(word)) {
        result += `<span class="hl-function">${escapeHtml(word)}</span>`;
      } else if (FORMULA_BUILTINS.has(word)) {
        result += `<span class="hl-builtin">${escapeHtml(word)}</span>`;
      } else if (FORMULA_CONSTANTS.has(word)) {
        result += `<span class="hl-constant">${escapeHtml(word)}</span>`;
      } else if (FORMULA_KEYWORDS.has(word)) {
        result += `<span class="hl-keyword">${escapeHtml(word)}</span>`;
      } else if (
        word === "data" ||
        word === "relations" ||
        word === "relation_count" ||
        word === "children" ||
        word === "children_count" ||
        word === "parent" ||
        word === "hierarchy_level"
      ) {
        result += `<span class="hl-context">${escapeHtml(word)}</span>`;
      } else {
        result += escapeHtml(word);
      }
    } else if (m[4]) {
      // operator / punctuation
      result += `<span class="hl-punct">${escapeHtml(m[4])}</span>`;
    }
    lastIdx = rx.lastIndex;
  }
  if (lastIdx < line.length) result += escapeHtml(line.slice(lastIdx));
  return result;
}

/** CSS for syntax highlighting classes. */
export const HL_STYLES = `
  .hl-comment { color: #6a737d; font-style: italic; }
  .hl-string { color: #b31d28; }
  .hl-number { color: #005cc5; }
  .hl-function { color: #6f42c1; }
  .hl-builtin { color: #6f42c1; opacity: 0.85; }
  .hl-keyword { color: #d73a49; }
  .hl-constant { color: #005cc5; }
  .hl-context { color: #22863a; }
  .hl-property { color: #005cc5; }
  .hl-punct { color: #6a737d; }
`;
