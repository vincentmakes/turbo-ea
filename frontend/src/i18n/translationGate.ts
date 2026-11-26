/**
 * The client-side gate for a custom language's strings, applied before a
 * bundle reaches i18next.
 *
 * A translated string is untrusted: it comes from a pack file, an AI provider
 * or an MCP client. The server validates it, but some English strings are
 * rendered as HTML (`dangerouslySetInnerHTML` with `<strong>` / `<1>` markup)
 * and i18next itself parses `$t(key, {options})` nesting, so the browser does
 * not rely on the server alone. A string is DROPPED — the key then falls back
 * to English — when, compared with the English string of the same key:
 *
 * - after removing every exact tag token the English string contains, the
 *   rest still opens a tag (`<` followed by a letter, `/`, `!` or `?`), so no
 *   markup the English lacks — even an unclosed `<img … onerror=…` — gets in;
 *   a bare `<` as in `(<40%)` stays legal;
 * - it has a different number of `$t(` nestings than English;
 * - its `{{` and `}}` counts differ (an unbalanced interpolation);
 * - it is not a string, or English has no such key (a plural category English
 *   lacks, `<base>_few`, is compared with `<base>_other`).
 *
 * Pure: no i18next, no API client.
 */

const ENGLISH_TAG = /<[^<>]*>/g;
const TAG_OPEN = /<[A-Za-z/!?]/;
// No `^`: a greedy `(.*)` already starts at the first character.
const PLURAL_KEY = /(.*)_(?:zero|one|two|few|many|other)$/;

/**
 * How many pieces `needle` cuts `text` into — one more than its occurrences,
 * so two texts compare equal exactly when their counts do.
 */
function pieces(text: string, needle: string): number {
  return text.split(needle).length;
}

/** Whether `value` may stand in for the English string `english`. */
export function isSafeTranslation(english: string, value: unknown): value is string {
  if (typeof value !== "string") return false;
  let rest = value;
  for (const [tag] of english.matchAll(ENGLISH_TAG)) rest = rest.split(tag).join("");
  if (TAG_OPEN.test(rest)) return false;
  if (pieces(value, "$t(") !== pieces(english, "$t(")) return false;
  return pieces(value, "{{") === pieces(value, "}}");
}

/** Every string leaf of a resource tree, keyed by its path joined with ".". */
export function flattenStrings(tree: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof tree !== "object" || tree === null || Array.isArray(tree)) return out;
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of flattenStrings(value, path)) out.set(k, v);
  }
  return out;
}

/** The English text a key is checked against: its own, or its `_other` plural sibling. */
export function englishSource(key: string, english: Map<string, string>): string | undefined {
  const own = english.get(key);
  if (own !== undefined) return own;
  const plural = PLURAL_KEY.exec(key);
  return plural ? english.get(`${plural[1]}_other`) : undefined;
}

/**
 * A copy of a namespace's resource tree keeping only the strings that pass
 * `isSafeTranslation` against `english` (the flattened English namespace).
 * The shape — nested objects or flat dotted keys — is kept; empty branches go.
 */
export function gateResources(
  tree: Record<string, unknown>,
  english: Map<string, string>,
  prefix = "",
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const branch = gateResources(value as Record<string, unknown>, english, path);
      if (Object.keys(branch).length > 0) out[key] = branch;
      continue;
    }
    const source = englishSource(path, english);
    if (source !== undefined && isSafeTranslation(source, value)) out[key] = value;
  }
  return out;
}
