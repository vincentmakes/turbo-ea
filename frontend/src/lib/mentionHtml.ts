/**
 * Mention spans in stored rich text, outside the editor.
 *
 * The server owns mentions: it stores `<span data-type="mention"
 * data-kind="card|decision|user" data-id="…"></span>` with no name, and fills
 * the name in for each reader. A mention the reader may not see comes back
 * with no id and no text (`data-restricted="true" data-token="…"`), one whose
 * target is gone with no text and `data-missing="true"`. Those two are left
 * EMPTY on purpose so the client can write the words in the reader's
 * language: `fillMentionLabels` does that for every surface that shows stored
 * text (previews, print, Word, spreadsheet, grid), before sanitising.
 *
 * Pure string work (no DOM), so the Word and spreadsheet builders can call it
 * before they parse.
 */
import { escapeHtml } from "./escapeHtml";

/** What a mention points at. Users are mentioned in comments only. */
export type MentionKind = "card" | "decision" | "user";

const KINDS: readonly MentionKind[] = ["card", "decision", "user"];

/** The words an empty mention span is given, per state and kind. */
export interface MentionLabels {
  restricted: Record<MentionKind, string> & { other: string };
  missing: Record<MentionKind, string> & { other: string };
}

/** A resolved mention found in stored text. */
export interface MentionRef {
  kind: MentionKind;
  id: string;
  /** The name the server filled in, without the leading "@". */
  label: string;
}

const MARKER = 'data-type="mention"';
/** An empty span: the only ones `fillMentionLabels` writes into. */
const EMPTY_SPAN = /<span\b([^>]*)><\/span>/g;
/** Any mention span with its text (mention spans hold text only). */
const MENTION_SPAN = /<span\b([^>]*\bdata-type="mention"[^>]*)>([^<]*)<\/span>/g;
const ATTR = /([a-z][a-z0-9-]*)="([^"]*)"/g;

/** The attributes of one opening tag, by name. */
export function parseSpanAttributes(attrs: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of attrs.matchAll(ATTR)) out[m[1]] = m[2];
  return out;
}

/** A `data-kind` value narrowed to a known kind, else null. */
export function asMentionKind(value: string | null | undefined): MentionKind | null {
  return KINDS.includes(value as MentionKind) ? (value as MentionKind) : null;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Decode the entities a serialiser writes in text (named, decimal, hex). */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return String.fromCodePoint(code);
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** The localised word for an empty span, or null when it is not one to fill. */
function labelFor(attrs: Record<string, string>, labels: MentionLabels): string | null {
  if (attrs["data-type"] !== "mention") return null;
  const kind = asMentionKind(attrs["data-kind"]);
  if (attrs["data-restricted"] === "true") return labels.restricted[kind ?? "other"];
  if (attrs["data-missing"] === "true") return labels.missing[kind ?? "other"];
  return null;
}

/**
 * Write the reader's words into every EMPTY restricted or missing mention
 * span. A span that already has text (a resolved mention) is never touched,
 * and HTML without mentions comes back as the very same string.
 */
export function fillMentionLabels(html: string, labels: MentionLabels): string;
export function fillMentionLabels(
  html: string | null | undefined,
  labels: MentionLabels,
): string | null | undefined;
export function fillMentionLabels(
  html: string | null | undefined,
  labels: MentionLabels,
): string | null | undefined {
  if (!html || !html.includes(MARKER)) return html;
  return html.replace(EMPTY_SPAN, (whole, attrs: string) => {
    const label = labelFor(parseSpanAttributes(attrs), labels);
    return label === null ? whole : `<span${attrs}>${escapeHtml(label)}</span>`;
  });
}

/**
 * The resolved mentions in stored text (an id and a known kind, target not
 * gone), once each, in order of first appearance.
 */
export function mentionsIn(html: string | null | undefined): MentionRef[] {
  if (!html || !html.includes(MARKER)) return [];
  const seen = new Set<string>();
  const out: MentionRef[] = [];
  for (const m of html.matchAll(MENTION_SPAN)) {
    const attrs = parseSpanAttributes(m[1]);
    const kind = asMentionKind(attrs["data-kind"]);
    const id = attrs["data-id"];
    if (!kind || !id || attrs["data-missing"] === "true") continue;
    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind, id, label: decodeEntities(m[2]).replace(/^@/, "") });
  }
  return out;
}

/**
 * Every mention span reduced to what the server stores: kind and id (or, for
 * a restricted one, kind and token), no state flags, no text. Two versions of
 * a document that differ only in the names the server filled in, or in
 * attribute order, normalise to the same string.
 */
export function canonicalMentionHtml(html: string): string {
  if (!html.includes(MARKER)) return html;
  return html.replace(MENTION_SPAN, (_whole, raw: string) => {
    const attrs = parseSpanAttributes(raw);
    let out = '<span data-type="mention"';
    if (attrs["data-kind"]) out += ` data-kind="${attrs["data-kind"]}"`;
    if (attrs["data-id"]) out += ` data-id="${attrs["data-id"]}"`;
    else if (attrs["data-token"]) out += ` data-token="${attrs["data-token"]}"`;
    return `${out}></span>`;
  });
}
