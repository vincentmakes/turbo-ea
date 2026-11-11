/**
 * "Does the editor hold edits the server does not have?" for the decision and
 * SoAW editors. Each editor keeps the save payload built from the record as
 * last loaded or saved, and compares it with the payload its current state
 * would send. Both sides come from the same builder, so equal content gives
 * an equal payload; keys are compared in sorted order so an object rebuilt in
 * another key order is not mistaken for an edit.
 */

/** JSON with object keys sorted at every level (arrays keep their order). */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(obj)
          .sort()
          .map((k) => [k, obj[k]]),
      );
    }
    return v;
  });
}

/**
 * True when `current` differs from `saved`. With nothing saved yet (a new
 * document, or the record has not loaded) every state is unsaved.
 */
export function hasUnsavedEdits(current: unknown, saved: unknown): boolean {
  if (saved === null || saved === undefined) return true;
  return stableJson(current) !== stableJson(saved);
}
