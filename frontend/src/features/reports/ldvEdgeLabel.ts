/**
 * How a Layered Dependency View line label is laid out on its lines. A leaf
 * module so the edge router and the edge renderer share one rule without the
 * router importing the view model.
 */

/** The longest line of a line label; a longer label wraps onto another line. */
export const EDGE_LABEL_LINE_CHARS = 34;
/** The most lines a line label takes; past them the last line ends in an ellipsis. */
export const MAX_EDGE_LABEL_LINES = 3;

/**
 * A line label as the lines it is drawn on. A label that fits one line stays
 * whole. A longer one puts its verb on the first line and the bracketed
 * attribute values (`relationAttributeSuffix`) below, so "is supported by" and
 * "[Create · Read · Update · Delete]" each read whole instead of the values
 * being cut off; either part wraps further at spaces if it is still too long,
 * a "·" between values staying at the end of the line before it. Past
 * {@link MAX_EDGE_LABEL_LINES} the last line is cut with an ellipsis, and a
 * single word longer than a line is split.
 */
export function wrapEdgeLabel(label: string): string[] {
  if (!label) return [];
  if (label.length <= EDGE_LABEL_LINE_CHARS) return [label];
  const cut = label.indexOf(" [");
  // Stryker disable next-line EqualityOperator: a label opening with " [" splits into an empty first part, which wraps to no lines, so >= 0 draws the same lines
  const parts = cut > 0 ? [label.slice(0, cut), label.slice(cut + 1)] : [label];
  const lines = parts.flatMap(wrapWords);
  if (lines.length <= MAX_EDGE_LABEL_LINES) return lines;
  const kept = lines.slice(0, MAX_EDGE_LABEL_LINES);
  const last = kept[MAX_EDGE_LABEL_LINES - 1];
  kept[MAX_EDGE_LABEL_LINES - 1] = last.slice(0, EDGE_LABEL_LINE_CHARS - 1) + "…";
  return kept;
}

function wrapWords(text: string): string[] {
  const words: string[] = [];
  for (const w of text.split(" ")) {
    if (!w) continue;
    if (w === "·" && words.length > 0) words[words.length - 1] += " ·";
    else words.push(w);
  }
  const lines: string[] = [];
  let line = "";
  for (let word of words) {
    // A word longer than a line is split into line-sized pieces. Once split,
    // `line` is empty, so a piece-less remainder ("") changes nothing below.
    // Stryker disable next-line EqualityOperator: a word of exactly one line lands on a line of its own either way
    while (word.length > EDGE_LABEL_LINE_CHARS) {
      if (line) lines.push(line);
      line = "";
      lines.push(word.slice(0, EDGE_LABEL_LINE_CHARS));
      word = word.slice(EDGE_LABEL_LINE_CHARS);
    }
    if (!line) line = word;
    else if (line.length + 1 + word.length <= EDGE_LABEL_LINE_CHARS) line += " " + word;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The length of a label's longest line once wrapped. */
export function longestEdgeLabelLine(label: string): number {
  return wrapEdgeLabel(label).reduce((m, l) => Math.max(m, l.length), 0);
}

/**
 * The edge router's estimate of a label's width, which it uses to nudge a
 * label off the cards: 5.8 px a character of the longest line, plus 12 px of
 * padding. Coarser than the renderer's own `edgeLabelWidth`, on purpose — the
 * router runs before any label is drawn.
 */
export function edgeLabelRouteWidth(label: string): number {
  return longestEdgeLabelLine(label) * 5.8 + 12;
}
