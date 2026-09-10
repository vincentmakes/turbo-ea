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
  const unique = Array.from(new Set(Array.from(ids).filter(Boolean)));
  if (unique.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += CARD_IDS_CHUNK) {
    chunks.push(unique.slice(i, i + CARD_IDS_CHUNK));
  }
  const pages = await Promise.all(
    chunks.map((chunk) =>
      api.get<CardListResponse>(
        `/cards?ids=${encodeURIComponent(chunk.join(","))}`,
        opts,
      ),
    ),
  );
  return pages.flatMap((page) => page.items);
}
