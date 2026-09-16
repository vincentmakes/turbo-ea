/**
 * Search relevance ranking (discussion #918).
 *
 * Users asked for regex anchors (`^w` = "starts with w") because typing `w`
 * buries the obvious answers under every substring match. Ranking solves the
 * same problem with no syntax to learn: exact matches first, then names that
 * start with the term, then names where the term starts a word, then plain
 * substring matches.
 *
 * This mirrors `search_rank` in `backend/app/services/search_rank.py`
 * deliberately — the server ranks the fetched page, and the picker re-ranks
 * the loaded options during the debounce window so the list never disagrees
 * with itself mid-keystroke. Change one and change the other;
 * `searchRank.test.ts` pins the contract.
 *
 * A **card** is ranked on two texts, not one: its name and its alias, matching
 * `card_search_rank` on the server (#1108). Use `cardSearchRank` for anything
 * that came out of `/cards`, so a card the server matched by alias is not
 * filtered back out by the client.
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

/** The two texts a card is known by. `alias` is optional everywhere. */
export interface RankableCard {
  name: string;
  alias?: string | null;
}

/**
 * A card's rank: the better (lower) of its name's and its alias's, `-1` when
 * neither matches.
 *
 * An alias IS a name — the internal one a company calls the thing by
 * ("CRM-v2") — so it competes on equal terms rather than as a fallback: a card
 * whose alias matches exactly should beat one that merely contains the term in
 * its name, which is exactly what the server does.
 */
export function cardSearchRank(card: RankableCard, query: string): number {
  const own = searchRank(card.name, query);
  if (!card.alias) return own;
  const viaAlias = searchRank(card.alias, query);
  if (own < 0) return viaAlias;
  if (viaAlias < 0) return own;
  return Math.min(own, viaAlias);
}

/**
 * Comparator: rank ascending, then alphabetically within a rank.
 *
 * A non-match sorts **last**, not first — `cardSearchRank` reports it as `-1`,
 * and a raw subtraction would float exactly the rows that don't match to the
 * top. Callers that pre-filter never see the difference; the ones that can't
 * are why this is handled here rather than at each call site:
 *   - a tree keeps a match's ancestors for context, and those score -1;
 *   - a server-searched list matches name OR description OR alias, while this
 *     ranks on name and alias, so a description-only hit scores -1 too.
 *
 * The tie-break stays the **name**: two cards that rank equally are listed
 * alphabetically by the label the reader actually sees.
 */
export function compareByRank(query: string, locale?: string) {
  // Any value above the "contains" tier (3) works; keep it finite so the
  // subtraction below can't produce NaN.
  const UNMATCHED = Number.MAX_SAFE_INTEGER;
  const rank = (card: RankableCard) => {
    const r = cardSearchRank(card, query);
    return r < 0 ? UNMATCHED : r;
  };
  return (a: RankableCard, b: RankableCard) => {
    const diff = rank(a) - rank(b);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name, locale, { sensitivity: "base" });
  };
}
