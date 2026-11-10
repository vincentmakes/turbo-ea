/**
 * "Does the editor hold edits the server does not have?" for the decision and
 * SoAW editors. Each editor keeps the save payload built from the record as
 * last loaded or saved, and compares it with the payload its current state
 * would send. Both sides come from the same builder, so equal content gives
 * an equal payload; keys are compared in sorted order so an object rebuilt in
 * another key order is not mistaken for an edit.
 *
 * Mentions are compared in the form the server stores them (kind and id, or
 * kind and token; no name, no state flags). The server writes the current
 * name into each mention for the reader and the editor writes it back, so a
 * card renamed since the last load, or a load the editor re-serialised, must
 * not read as an unsaved edit; adding or removing a mention still does.
 */
import { canonicalMentionHtml } from "@/lib/mentionHtml";

/** An object with its keys sorted (arrays and plain values unchanged). */
function sortedKeys(v: unknown): unknown {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const obj = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(obj)
        .sort()
        .map((k) => [k, obj[k]]),
    );
  }
  return v;
}

/** JSON with object keys sorted at every level (arrays keep their order). */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => sortedKeys(v));
}

/** `stableJson` with every string's mention spans in their stored form. */
function comparableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    typeof v === "string" ? canonicalMentionHtml(v) : sortedKeys(v),
  );
}

/**
 * True when `current` differs from `saved`. With nothing saved yet (a new
 * document, or the record has not loaded) every state is unsaved.
 */
export function hasUnsavedEdits(current: unknown, saved: unknown): boolean {
  if (saved === null || saved === undefined) return true;
  return comparableJson(current) !== comparableJson(saved);
}
