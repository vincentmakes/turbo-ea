import { api, type GetOptions } from "@/api/client";
import type { Card, CardListResponse } from "@/types";

/**
 * Ids per `GET /cards?ids=` request.
 *
 * The bundled edge nginx runs the default `large_client_header_buffers 4 8k`,
 * so a request line over 8 KB is refused with 414 before it ever reaches the
 * backend. An encoded UUID costs 39 bytes (36 + `%2C`): 200 of them make a
 * 7.8 KB request line, which fits; 210 do not. `GET /relations?card_ids=`
 * caps at 500 server-side, so this stays comfortably inside both (#1093).
 */
export const CARD_IDS_CHUNK = 200;

/**
 * Fetch cards by id, in chunks, so no single URL can hit a proxy's limit.
 *
 * Dedupes and drops falsy ids; resolves `[]` without a request when nothing
 * is left. Archived cards are included (the endpoint deliberately skips the
 * ACTIVE filter when `ids` is given); hard-deleted ones are simply absent.
 * Result order is per chunk, so build a `Map` by id rather than relying on
 * position. All-or-nothing: one failed chunk rejects the whole call, and one
 * `signal` aborts every chunk.
 */
export async function fetchCardsByIds(
  ids: Iterable<string>,
  opts: GetOptions = {},
): Promise<Card[]> {
  return (await fetchCardsByIdsDetailed(ids, opts)).cards;
}

/**
 * `fetchCardsByIds`, also returning the ids the server withheld.
 *
 * `withheldIds` are cards that exist but are hidden from the caller by a
 * card-type View deny. A caller that already holds the id — a diagram cell —
 * must tell "hidden from me" apart from "deleted", or it would offer to remove
 * a card that is merely not visible to this user.
 */
export async function fetchCardsByIdsDetailed(
  ids: Iterable<string>,
  opts: GetOptions = {},
): Promise<{ cards: Card[]; withheldIds: string[] }> {
  const pages = await Promise.all(chunkIds(ids).map((chunk) => fetchChunk(chunk, opts)));
  return {
    cards: pages.flatMap((page) => page.items),
    withheldIds: pages.flatMap((page) => page.withheld_ids ?? []),
  };
}

/**
 * `fetchCardsByIds` for a best-effort caller: a failed chunk is skipped, not
 * fatal.
 *
 * For callers that only enrich what they already show — a picker resolving
 * chip labels, an export naming off-sheet relation targets — where a missing
 * name falls back to something sensible and failing the whole batch would
 * lose the names that did load. `failedChunks` lists the ids of every chunk
 * that rejected (an abort included), in request order, so a caller can tell
 * "absent" from "not fetched". Same chunking, dedupe and encoding as the
 * strict version.
 */
export async function fetchCardsByIdsLenient(
  ids: Iterable<string>,
  opts: GetOptions = {},
): Promise<{ cards: Card[]; failedChunks: string[][] }> {
  const chunks = chunkIds(ids);
  const settled = await Promise.allSettled(chunks.map((chunk) => fetchChunk(chunk, opts)));
  const cards: Card[] = [];
  const failedChunks: string[][] = [];
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") cards.push(...result.value.items);
    else failedChunks.push(chunks[i]);
  });
  return { cards, failedChunks };
}

/** Dedupe, drop falsy ids and split into request-sized chunks. */
function chunkIds(ids: Iterable<string>): string[][] {
  const unique = Array.from(new Set(Array.from(ids).filter(Boolean)));
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += CARD_IDS_CHUNK) {
    chunks.push(unique.slice(i, i + CARD_IDS_CHUNK));
  }
  return chunks;
}

function fetchChunk(chunk: string[], opts: GetOptions): Promise<CardListResponse> {
  return api.get<CardListResponse>(`/cards?ids=${encodeURIComponent(chunk.join(","))}`, opts);
}
