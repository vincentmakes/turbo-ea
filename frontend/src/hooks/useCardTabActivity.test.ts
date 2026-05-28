import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn(),
  },
}));

import { api } from "@/api/client";
import { useCardTabActivity } from "./useCardTabActivity";

const CARD_A = "card-aaaaaaaa";
const CARD_B = "card-bbbbbbbb";
const USER_ME = "user-me";
const USER_OTHER = "user-other";
const STORAGE_KEY = "turbo-ea.cardTabsSeen";

function isoMinus(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  localStorage.clear();
});

describe("useCardTabActivity", () => {
  it("returns no dots on a first-ever visit, even when activity exists", async () => {
    vi.mocked(api.get).mockResolvedValueOnce([
      { id: "1", event_type: "comment.created", created_at: isoMinus(60) },
      { id: "2", event_type: "card.updated", created_at: isoMinus(120) },
    ]);

    const { result } = renderHook(() => useCardTabActivity(CARD_A));

    await waitFor(() => {
      expect(api.get).toHaveBeenCalled();
    });

    expect(result.current.hasUpdates("comments")).toBe(false);
    expect(result.current.hasUpdates("card")).toBe(false);
  });

  it("stamps a first-visit baseline that persists across remounts", async () => {
    vi.mocked(api.get).mockResolvedValue([]);
    const { unmount } = renderHook(() => useCardTabActivity(CARD_A));
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const first = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")[CARD_A]
      .__first;
    expect(first).toBeDefined();

    unmount();

    renderHook(() => useCardTabActivity(CARD_A));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    const second = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")[CARD_A]
      .__first;
    expect(second).toBe(first);
  });

  it("shows a dot on the active tab when activity post-dates first visit", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        [CARD_A]: { __first: isoMinus(300) },
        __lru: [CARD_A],
      }),
    );

    vi.mocked(api.get).mockResolvedValueOnce([
      {
        id: "1",
        event_type: "card.updated",
        created_at: isoMinus(60),
        user_id: USER_OTHER,
      },
    ]);

    const { result } = renderHook(() => useCardTabActivity(CARD_A, USER_ME));

    await waitFor(() => {
      expect(result.current.hasUpdates("card")).toBe(true);
    });
  });

  it("dot stays visible after noteVisit; only persists on flush", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        [CARD_A]: { __first: isoMinus(300) },
        __lru: [CARD_A],
      }),
    );

    vi.mocked(api.get).mockResolvedValueOnce([
      {
        id: "1",
        event_type: "comment.created",
        created_at: isoMinus(60),
        user_id: USER_OTHER,
      },
    ]);

    const { result, unmount } = renderHook(() =>
      useCardTabActivity(CARD_A, USER_ME),
    );

    await waitFor(() => {
      expect(result.current.hasUpdates("comments")).toBe(true);
    });

    act(() => {
      result.current.noteVisit("comments");
    });

    // Dot stays visible for the rest of the visit.
    expect(result.current.hasUpdates("comments")).toBe(true);

    // localStorage untouched for the tab — only first-visit stored.
    const midVisit = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(midVisit[CARD_A].comments).toBeUndefined();

    // Leaving the card flushes pending visits.
    unmount();

    const afterLeave = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(afterLeave[CARD_A].comments).toBeDefined();
    expect(afterLeave[CARD_A].__first).toBeDefined();
  });

  it("filters out events authored by the current user", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        [CARD_A]: { __first: isoMinus(300) },
        __lru: [CARD_A],
      }),
    );

    vi.mocked(api.get).mockResolvedValueOnce([
      {
        id: "1",
        event_type: "card.updated",
        created_at: isoMinus(60),
        user_id: USER_ME,
      },
      {
        id: "2",
        event_type: "comment.created",
        created_at: isoMinus(60),
        user_id: USER_OTHER,
      },
    ]);

    const { result } = renderHook(() => useCardTabActivity(CARD_A, USER_ME));

    await waitFor(() => {
      expect(result.current.hasUpdates("comments")).toBe(true);
    });
    expect(result.current.hasUpdates("card")).toBe(false);
  });

  it("does not show a dot when activity precedes the first visit", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        [CARD_A]: { __first: isoMinus(30) },
        __lru: [CARD_A],
      }),
    );

    vi.mocked(api.get).mockResolvedValueOnce([
      {
        id: "1",
        event_type: "comment.created",
        created_at: isoMinus(120),
        user_id: USER_OTHER,
      },
    ]);

    const { result } = renderHook(() => useCardTabActivity(CARD_A, USER_ME));

    await waitFor(() => {
      expect(api.get).toHaveBeenCalled();
    });

    expect(result.current.hasUpdates("comments")).toBe(false);
  });

  it("buckets various event types into the right tabs", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        [CARD_A]: { __first: isoMinus(500) },
        __lru: [CARD_A],
      }),
    );

    vi.mocked(api.get).mockResolvedValueOnce([
      {
        id: "1",
        event_type: "relation.created",
        created_at: isoMinus(10),
        user_id: USER_OTHER,
      },
      {
        id: "2",
        event_type: "document.added",
        created_at: isoMinus(10),
        user_id: USER_OTHER,
      },
      {
        id: "3",
        event_type: "risk.updated",
        created_at: isoMinus(10),
        user_id: USER_OTHER,
      },
      {
        id: "4",
        event_type: "stakeholder.added",
        created_at: isoMinus(10),
        user_id: USER_OTHER,
      },
    ]);

    const { result } = renderHook(() => useCardTabActivity(CARD_A, USER_ME));

    await waitFor(() => {
      expect(result.current.hasUpdates("card")).toBe(true);
    });
    expect(result.current.hasUpdates("resources")).toBe(true);
    expect(result.current.hasUpdates("risks")).toBe(true);
    expect(result.current.hasUpdates("stakeholders")).toBe(true);
    expect(result.current.hasUpdates("comments")).toBe(false);
  });

  it("evicts oldest cards from the LRU when capacity is exceeded", async () => {
    vi.mocked(api.get).mockResolvedValue([]);

    const seeded: Record<string, Record<string, string>> = {};
    const lru: string[] = [];
    for (let i = 0; i < 200; i++) {
      const id = `card-${i.toString().padStart(4, "0")}`;
      seeded[id] = { __first: isoMinus(1000) };
      lru.push(id);
    }
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...seeded, __lru: lru }),
    );

    renderHook(() => useCardTabActivity("card-NEW"));

    await waitFor(() => {
      const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
      expect(persisted["card-NEW"]).toBeDefined();
    });

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(persisted["card-0000"]).toBeUndefined();
    expect(persisted.__lru.length).toBe(200);
    expect(persisted.__lru[persisted.__lru.length - 1]).toBe("card-NEW");
  });

  it("survives a malformed localStorage payload", async () => {
    localStorage.setItem(STORAGE_KEY, "{not json");

    vi.mocked(api.get).mockResolvedValueOnce([
      {
        id: "1",
        event_type: "comment.created",
        created_at: isoMinus(10),
        user_id: USER_OTHER,
      },
    ]);

    const { result, unmount } = renderHook(() =>
      useCardTabActivity(CARD_A, USER_ME),
    );

    await waitFor(() => {
      expect(api.get).toHaveBeenCalled();
    });

    expect(result.current.hasUpdates("comments")).toBe(false);

    act(() => {
      result.current.noteVisit("comments");
    });
    unmount();

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(persisted[CARD_A].comments).toBeDefined();
    expect(persisted[CARD_A].__first).toBeDefined();
  });

  it("re-fetches and flushes pending visits when cardId changes", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "1",
          event_type: "comment.created",
          created_at: isoMinus(5),
          user_id: USER_OTHER,
        },
      ]);

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        [CARD_B]: { __first: isoMinus(300) },
        __lru: [CARD_B],
      }),
    );

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useCardTabActivity(id, USER_ME),
      { initialProps: { id: CARD_A } },
    );

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledTimes(1);
    });

    act(() => {
      result.current.noteVisit("comments");
    });

    rerender({ id: CARD_B });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledTimes(2);
      expect(result.current.hasUpdates("comments")).toBe(true);
    });

    // Flush of card A on card-switch persisted the comments lastSeen.
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(persisted[CARD_A].comments).toBeDefined();
  });
});
