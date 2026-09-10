import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/api/client", () => ({ api: { get: vi.fn() } }));

import { api } from "@/api/client";
import { fetchCardsByIds, CARD_IDS_CHUNK } from "./cardsByIds";
import type { Card } from "@/types";

const mockGet = vi.mocked(api.get);

function card(id: string): Card {
  return { id, name: `Name of ${id}`, type: "Application" } as Card;
}

/** Decode the ids a `/cards?ids=` path carries. */
function idsOf(path: string): string[] {
  expect(path.startsWith("/cards?ids=")).toBe(true);
  return decodeURIComponent(path.slice("/cards?ids=".length)).split(",");
}

function respondWithRequested() {
  mockGet.mockImplementation(async (path: string) => ({
    items: idsOf(path).map(card),
    total: 0,
    page: 1,
    page_size: 10000,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any);
}

describe("fetchCardsByIds", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it("makes no request for an empty list", async () => {
    expect(await fetchCardsByIds([])).toEqual([]);
    expect(await fetchCardsByIds(["", ""])).toEqual([]);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("splits a large list into chunks that fit one request line (#1093)", async () => {
    respondWithRequested();
    const ids = Array.from({ length: 450 }, (_, i) => `id-${i}`);
    const items = await fetchCardsByIds(ids);
    expect(mockGet).toHaveBeenCalledTimes(3);
    const sizes = mockGet.mock.calls.map((c) => idsOf(c[0] as string).length);
    expect(sizes).toEqual([CARD_IDS_CHUNK, CARD_IDS_CHUNK, 50]);
    // 200 encoded UUIDs must stay under nginx's default 8 KB request line.
    const uuids = Array.from({ length: CARD_IDS_CHUNK }, () => crypto.randomUUID());
    const line = `GET /api/v1/cards?ids=${encodeURIComponent(uuids.join(","))} HTTP/1.1`;
    expect(line.length).toBeLessThan(8192);
    // No page_size: the server default already covers a chunk.
    for (const c of mockGet.mock.calls) expect(c[0]).not.toContain("page_size");
    // Items arrive in chunk order.
    expect(items.map((c) => c.id)).toEqual(ids);
  });

  it("dedupes, drops falsy ids and keeps first-seen order", async () => {
    respondWithRequested();
    await fetchCardsByIds(["b", "", "a", "b", "a"]);
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(decodeURIComponent(mockGet.mock.calls[0][0] as string)).toBe(
      "/cards?ids=b,a",
    );
  });

  it("encodes ids so a stray character cannot corrupt the query", async () => {
    respondWithRequested();
    await fetchCardsByIds(["a&b"]);
    expect(mockGet.mock.calls[0][0]).toBe("/cards?ids=a%26b");
  });

  it("forwards the abort signal to every chunk", async () => {
    respondWithRequested();
    const ctrl = new AbortController();
    const ids = Array.from({ length: CARD_IDS_CHUNK + 1 }, (_, i) => `id-${i}`);
    await fetchCardsByIds(ids, { signal: ctrl.signal });
    expect(mockGet).toHaveBeenCalledTimes(2);
    for (const c of mockGet.mock.calls) expect(c[1]).toEqual({ signal: ctrl.signal });
  });

  it("rejects the whole call when one chunk fails", async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (idsOf(path)[0] === `id-${CARD_IDS_CHUNK}`) throw new Error("HTTP 414");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { items: idsOf(path).map(card) } as any;
    });
    const ids = Array.from({ length: CARD_IDS_CHUNK + 1 }, (_, i) => `id-${i}`);
    await expect(fetchCardsByIds(ids)).rejects.toThrow("HTTP 414");
  });
});
