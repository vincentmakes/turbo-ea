/**
 * Search relevance ranking (discussion #918).
 *
 * Users asked for regex anchors (`^w` = "starts with w") because typing `w`
 * buries the obvious answers under every substring match. Ranking solves the
 * same problem with no syntax to learn: exact matches first, then names that
 * start with the term, then names where the term starts a word, then plain
 * substring matches.
 *
 * This mirrors `_search_rank` in `backend/app/api/v1/cards.py` deliberately —
 * the server ranks the fetched page, and the picker re-ranks the loaded
 * options during the debounce window so the list never disagrees with itself
 * mid-keystroke. Change one and change the other; `searchRank.test.ts` pins
 * the contract.
 */

/** Word boundaries in card names are as often `-`, `/`, `.` or `(` as a space. */
const WORD_BOUNDARY = /[^a-z0-9]/;

/** 0 exact · 1 starts-with · 2 starts a word · 3 contains · -1 no match. */
export function searchRank(name: string, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 3;
  const n = name.toLowerCase();
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  const at = n.indexOf(q);
  if (at < 0) return -1;
  // Any occurrence preceded by a non-alphanumeric character starts a word.
  let idx = at;
  while (idx >= 0) {
    if (WORD_BOUNDARY.test(n[idx - 1])) return 2;
    idx = n.indexOf(q, idx + 1);
  }
  return 3;
}

/** Comparator: rank ascending, then alphabetically within a rank. */
export function compareByRank(query: string, locale?: string) {
  return (a: { name: string }, b: { name: string }) => {
    const diff = searchRank(a.name, query) - searchRank(b.name, query);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name, locale, { sensitivity: "base" });
  };
}
