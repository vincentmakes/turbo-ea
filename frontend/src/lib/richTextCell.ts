/**
 * Rich text ⇄ spreadsheet cell.
 *
 * ADR sections are stored as HTML (the TipTap editor's output), and an HTML
 * cell is unreadable in Excel. The spreadsheet export writes plain text and
 * the importer turns it back into HTML:
 *
 * - `htmlToPlainText` — a paragraph or heading becomes a block separated by a
 *   blank line, `<br>` a line break, a bullet `- item`, a numbered item
 *   `1. item`. Formatting (bold, links) is not carried.
 * - `plainTextToHtml` — the inverse: blank lines split paragraphs, a run of
 *   `- ` / `* ` lines is a bullet list, a run of `1. ` lines a numbered list,
 *   any other line break a `<br>`. Text is escaped. A cell that already holds
 *   HTML tags is passed through as it is, so a hand-made HTML import keeps its
 *   formatting (it is sanitised on render like every stored section).
 */
import { escapeHtml } from "@/lib/escapeHtml";
import { fillMentionLabels, type MentionLabels } from "@/lib/mentionHtml";

const BLOCK_TAGS = new Set([
  "P",
  "DIV",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "BLOCKQUOTE",
  "PRE",
  "UL",
  "OL",
  "TABLE",
  "TR",
]);

const HTML_TAG_RE = /<\/?(p|br|ul|ol|li|strong|em|b|i|u|s|a|h[1-6]|div|span|blockquote|code|pre)\b[^>]*>/i;
const BULLET_RE = /^\s*[-*•]\s+(.*)$/;
const NUMBERED_RE = /^\s*\d+[.)]\s+(.*)$/;

/** Whether a cell already holds markup, rather than plain text to convert. */
export function looksLikeHtml(text: string): boolean {
  return HTML_TAG_RE.test(text);
}

function walk(node: Node, out: string[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push((node.textContent ?? "").replace(/\s+/g, " "));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  const tag = el.tagName;
  if (tag === "BR") {
    out.push("\n");
    return;
  }
  if (tag === "LI") {
    const parent = el.parentElement;
    const marker =
      parent?.tagName === "OL"
        ? `${Array.prototype.indexOf.call(parent.children, el) + 1}. `
        : "- ";
    const inner: string[] = [];
    el.childNodes.forEach((child) => walk(child, inner));
    out.push(`\n${marker}${inner.join("").trim()}`);
    return;
  }
  const block = BLOCK_TAGS.has(tag);
  if (block) out.push("\n\n");
  el.childNodes.forEach((child) => walk(child, out));
  if (block) out.push("\n\n");
}

/**
 * Stored section HTML → the plain text a spreadsheet cell shows. With
 * `labels`, a restricted or deleted mention (an empty span) reads as the
 * reader's words; a resolved one is its "@Name" text either way.
 */
export function htmlToPlainText(
  html: string | null | undefined,
  labels?: MentionLabels,
): string {
  if (!html) return "";
  const filled = labels ? fillMentionLabels(html, labels) : html;
  const doc = new DOMParser().parseFromString(filled, "text/html");
  const out: string[] = [];
  doc.body.childNodes.forEach((child) => walk(child, out));
  return out
    .join("")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, "").replace(/^ +/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type Run = { kind: "ul" | "ol" | "text"; lines: string[] };

function blockToHtml(block: string): string {
  const runs: Run[] = [];
  for (const line of block.split("\n")) {
    const bullet = BULLET_RE.exec(line);
    const numbered = bullet ? null : NUMBERED_RE.exec(line);
    const kind: Run["kind"] = bullet ? "ul" : numbered ? "ol" : "text";
    const content = bullet ? bullet[1] : numbered ? numbered[1] : line.trim();
    const last = runs[runs.length - 1];
    if (last && last.kind === kind) last.lines.push(content);
    else runs.push({ kind, lines: [content] });
  }
  return runs
    .map((run) =>
      run.kind === "text"
        ? `<p>${run.lines.map(escapeHtml).join("<br>")}</p>`
        : `<${run.kind}>${run.lines.map((l) => `<li>${escapeHtml(l.trim())}</li>`).join("")}</${run.kind}>`,
    )
    .join("");
}

/** A spreadsheet cell → the HTML an ADR section stores (`""` for a blank cell). */
export function plainTextToHtml(text: string | null | undefined): string {
  const value = (text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!value) return "";
  if (looksLikeHtml(value)) return value;
  return value
    .split(/\n[ \t]*\n+/)
    .map((block) => block.replace(/^\n+|\n+$/g, ""))
    .filter((block) => block.trim() !== "")
    .map(blockToHtml)
    .join("");
}
