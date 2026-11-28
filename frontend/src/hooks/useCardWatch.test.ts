import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    isAuthenticated: () => true,
    api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

import { ApiError, api } from "@/api/client";
import { stopEventStream, useEventStream } from "./useEventStream";
import {
  MAX_WATCHED_CARDS,
  RECONNECT_JITTER_MS,
  WATCH_RENEW_AT,
  WATCH_RETRY_DELAYS_MS,
  WATCH_RETRY_INTERVAL_MS,
  resetCardWatch,
  useCardWatch,
} from "./useCardWatch";

// ---------------------------------------------------------------------------
// A fake EventSource: the real `useEventStream` singleton runs on top of it.
// ---------------------------------------------------------------------------

let sources: Array<{ onmessage: ((e: { data: string }) => void) | null; onopen: (() => void) | null }> =
  [];
vi.stubGlobal(
  "EventSource",
  vi.fn(function FakeEventSource() {
    const inst = { onmessage: null, onopen: null, onerror: null, close: vi.fn() };
    sources.push(inst);
    return inst;
  }),
);

const put = vi.mocked(api.put);

function send(event: Record<string, unknown>) {
  act(() => {
    sources[0].onmessage!({ data: JSON.stringify(event) });
  });
}
function hello(streamId: string, ttl = 300) {
  send({ event: "event.stream.hello", stream_id: streamId, watch_ttl_seconds: ttl });
}
function ping(cardId: string) {
  send({ event: "event.stream.card_changed", card_id: cardId, timestamp: "2026-11-28T00:00:00Z" });
}
/** Run the coalescing timer and let the PUT promise settle. */
async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function putCalls(): Array<[string, unknown]> {
  return put.mock.calls.map((c) => [c[0], c[1]]);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  sources = [];
  stopEventStream();
  resetCardWatch();
  put.mockImplementation(async (_path: string, body?: unknown) => ({
    card_ids: (body as { card_ids: string[] }).card_ids,
    expires_in: 300,
  }));
  // The layout keeps the tab's stream open; card watches ride on it.
  renderHook(() => useEventStream(() => {}));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useCardWatch", () => {
  it("registers the watched card on the first hello", async () => {
    renderHook(() => useCardWatch("c1", vi.fn()));
    await settle();
    expect(put).not.toHaveBeenCalled();

    hello("s-1");
    await settle();
    expect(putCalls()).toEqual([["/events/stream/s-1/watch", { card_ids: ["c1"] }]]);
  });

  it("adopts a hello that arrived before the card was opened", async () => {
    // The layout opens the stream at boot; the card page mounts later.
    renderHook(() => useCardWatch(undefined, vi.fn()));
    hello("s-early");
    await settle();
    expect(put).not.toHaveBeenCalled();

    renderHook(() => useCardWatch("c1", vi.fn()));
    await settle();
    expect(putCalls()).toEqual([["/events/stream/s-early/watch", { card_ids: ["c1"] }]]);
  });

  it("does nothing at all against a backend that sends no hello", async () => {
    const onChanged = vi.fn();
    const { unmount } = renderHook(() => useCardWatch("c1", onChanged));
    send({ event: "card.updated", card_id: "c1" });
    ping("c1");
    await settle(60 * 60 * 1000);
    unmount();
    await settle();
    expect(put).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("calls the card's subscribers on a ping, and nobody for another card", async () => {
    const a = vi.fn();
    const b = vi.fn();
    renderHook(() => useCardWatch("c1", a));
    renderHook(() => useCardWatch("c2", b));
    hello("s-1");
    await settle();
    // The first registration's catch-up, one each.
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    a.mockClear();
    b.mockClear();

    ping("c1");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();

    ping("c-other");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it("shares one registration between two hooks on the same card", async () => {
    const a = vi.fn();
    const b = vi.fn();
    const first = renderHook(() => useCardWatch("c1", a));
    const second = renderHook(() => useCardWatch("c1", b));
    hello("s-1");
    await settle();
    expect(putCalls()).toEqual([["/events/stream/s-1/watch", { card_ids: ["c1"] }]]);
    // One catch-up for the card, which reaches both of its hooks.
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    a.mockClear();
    b.mockClear();

    ping("c1");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    first.unmount();
    await settle();
    // Still watched by the second: no new registration.
    expect(put).toHaveBeenCalledTimes(1);
    ping("c1");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);

    second.unmount();
    await settle();
    expect(putCalls()[1]).toEqual(["/events/stream/s-1/watch", { card_ids: [] }]);
  });

  it("coalesces a burst of mounts into one registration", async () => {
    hello("s-1");
    renderHook(() => useCardWatch("c1", vi.fn()));
    renderHook(() => useCardWatch("c2", vi.fn()));
    renderHook(() => useCardWatch("c3", vi.fn()));
    await settle();
    expect(putCalls()).toEqual([["/events/stream/s-1/watch", { card_ids: ["c1", "c2", "c3"] }]]);
  });

  it("re-registers a reconnect after a jitter, then catches up once the watch is back", async () => {
    const onChanged = vi.fn();
    renderHook(() => useCardWatch("c1", onChanged));
    hello("s-1");
    await settle();
    // The first registration's catch-up.
    expect(onChanged).toHaveBeenCalledTimes(1);
    onChanged.mockClear();
    expect(RECONNECT_JITTER_MS).toBe(1500);

    let release: (v: unknown) => void = () => {};
    put.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    hello("s-2");
    // Jitter: 0.5 × 1500 ms before the registration goes out.
    await settle(749);
    expect(put).toHaveBeenCalledTimes(1);
    await settle(1);
    expect(putCalls()[1]).toEqual(["/events/stream/s-2/watch", { card_ids: ["c1"] }]);
    // No read while the new watch does not exist yet: it could miss a change
    // committed before the watch.
    await settle(5000);
    expect(onChanged).not.toHaveBeenCalled();
    await act(async () => {
      release({ card_ids: ["c1"], expires_in: 300 });
    });
    // First accepted registration on the new stream: exactly one catch-up.
    expect(onChanged).toHaveBeenCalledTimes(1);
    await settle(60_000);
    expect(onChanged).toHaveBeenCalledTimes(1);
    vi.mocked(Math.random).mockRestore();
  });

  it("registers a first hello without a jitter", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    renderHook(() => useCardWatch("c1", vi.fn()));
    hello("s-1");
    await settle();
    expect(put).toHaveBeenCalledTimes(1);
    vi.mocked(Math.random).mockRestore();
  });

  it("refreshes the watch before it expires, while something is watched", async () => {
    const { unmount } = renderHook(() => useCardWatch("c1", vi.fn()));
    hello("s-1", 100);
    await settle();
    expect(put).toHaveBeenCalledTimes(1);

    // At half of the 100 s lifetime.
    expect(WATCH_RENEW_AT).toBe(0.5);
    await settle(49_999);
    expect(put).toHaveBeenCalledTimes(1);
    await settle(1);
    expect(putCalls()[1]).toEqual(["/events/stream/s-1/watch", { card_ids: ["c1"] }]);
    await settle(50_000);
    expect(put).toHaveBeenCalledTimes(3);

    unmount();
    await settle();
    expect(putCalls()[3]).toEqual(["/events/stream/s-1/watch", { card_ids: [] }]);
    // Nothing watched: no more refreshes.
    await settle(10 * 50_000);
    expect(put).toHaveBeenCalledTimes(4);
  });

  it("drops a stale stream id on 404 and registers again on the next hello", async () => {
    put.mockRejectedValueOnce(new ApiError("Not found", 404, null));
    const onChanged = vi.fn();
    renderHook(() => useCardWatch("c1", onChanged));
    hello("s-1");
    await settle();
    expect(put).toHaveBeenCalledTimes(1);

    // The stale id is gone: a new watcher does not reuse it.
    renderHook(() => useCardWatch("c2", vi.fn()));
    await settle(60 * 60 * 1000);
    expect(put).toHaveBeenCalledTimes(1);

    hello("s-2");
    // A reconnect hello: registered within the jitter window.
    await settle(RECONNECT_JITTER_MS);
    expect(putCalls()[1]).toEqual(["/events/stream/s-2/watch", { card_ids: ["c1", "c2"] }]);
  });

  it("retries a passing failure after 1, 2 and 5 s, then every 30 s", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    put.mockRejectedValue(new ApiError("Boom", 500, null));
    const onChanged = vi.fn();
    renderHook(() => useCardWatch("c1", onChanged));
    hello("s-1", 100);
    await settle();
    expect(put).toHaveBeenCalledTimes(1);
    expect([...WATCH_RETRY_DELAYS_MS]).toEqual([1000, 2000, 5000]);
    expect(WATCH_RETRY_INTERVAL_MS).toBe(30_000);

    await settle(999);
    expect(put).toHaveBeenCalledTimes(1);
    await settle(1);
    expect(put).toHaveBeenCalledTimes(2);
    await settle(1999);
    expect(put).toHaveBeenCalledTimes(2);
    await settle(1);
    expect(put).toHaveBeenCalledTimes(3);
    await settle(4999);
    expect(put).toHaveBeenCalledTimes(3);
    await settle(1);
    expect(put).toHaveBeenCalledTimes(4);
    // The series is spent: the next attempt is 30 s later, not a whole
    // renewal interval later; nothing logged, and no catch-up for a card that
    // was never registered.
    await settle(29_999);
    expect(put).toHaveBeenCalledTimes(4);
    await settle(1);
    expect(put).toHaveBeenCalledTimes(5);
    await settle(30_000);
    expect(put).toHaveBeenCalledTimes(6);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();

    // Once the server answers, the card is registered and catches up once.
    put.mockResolvedValue({ card_ids: ["c1"], expires_in: 100 });
    await settle(30_000);
    expect(put).toHaveBeenCalledTimes(7);
    expect(onChanged).toHaveBeenCalledTimes(1);
    // And the steady retry stops: the next send is the renewal at 50 s.
    await settle(49_999);
    expect(put).toHaveBeenCalledTimes(7);
    await settle(1);
    expect(put).toHaveBeenCalledTimes(8);
    errorSpy.mockRestore();
  });

  it("stops the steady retry once nothing is watched", async () => {
    put.mockRejectedValue(new ApiError("Boom", 500, null));
    const { unmount } = renderHook(() => useCardWatch("c1", vi.fn()));
    hello("s-1");
    await settle(1000 + 2000 + 5000);
    expect(put).toHaveBeenCalledTimes(4);
    unmount();
    await settle(10 * 30_000);
    expect(put).toHaveBeenCalledTimes(4);
  });

  it("renews in time without a catch-up", async () => {
    const onChanged = vi.fn();
    renderHook(() => useCardWatch("c1", onChanged));
    hello("s-1", 300);
    await settle();
    expect(onChanged).toHaveBeenCalledTimes(1);
    onChanged.mockClear();
    await settle(150_000);
    await settle(150_000);
    await settle(150_000);
    expect(put).toHaveBeenCalledTimes(4);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("catches up once when a renewal is accepted only after failed retries outlast the lifetime", async () => {
    const onChanged = vi.fn();
    renderHook(() => useCardWatch("c1", onChanged));
    hello("s-1", 300);
    await settle();
    onChanged.mockClear();

    // The renewal at 150 s and everything after it fail for a while.
    put.mockRejectedValue(new TypeError("Failed to fetch"));
    await settle(150_000);
    expect(put).toHaveBeenCalledTimes(2);
    // 1 + 2 + 5 s, then 30 s steps: still failing at 150 + 8 + 4 × 30 = 278 s.
    await settle(8000 + 4 * 30_000);
    expect(put).toHaveBeenCalledTimes(2 + 3 + 4);
    expect(onChanged).not.toHaveBeenCalled();

    put.mockImplementation(async (_path: string, body?: unknown) => ({
      card_ids: (body as { card_ids: string[] }).card_ids,
      expires_in: 300,
    }));
    // Accepted at 308 s, more than 300 s after the last accepted one at 0 s:
    // the watch lapsed meanwhile, so the page re-reads once.
    await settle(30_000);
    expect(put).toHaveBeenCalledTimes(10);
    expect(onChanged).toHaveBeenCalledTimes(1);
    // The next renewal is in time again.
    await settle(150_000);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("catches up after a renewal timer a background tab fired late", async () => {
    const onChanged = vi.fn();
    renderHook(() => useCardWatch("c1", onChanged));
    hello("s-1", 300);
    await settle();
    onChanged.mockClear();

    // The tab was throttled (or the laptop slept): the clock moved 250 s on
    // while the renewal timer did not fire...
    vi.setSystemTime(Date.now() + 250_000);
    await settle();
    expect(put).toHaveBeenCalledTimes(1);
    // ...and it fires 150 s "later" by its own count, 400 s after the last
    // accepted registration.
    await settle(150_000);
    expect(put).toHaveBeenCalledTimes(2);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("renews at once when the tab becomes visible with the renewal overdue", async () => {
    const onChanged = vi.fn();
    renderHook(() => useCardWatch("c1", onChanged));
    hello("s-1", 300);
    await settle();
    onChanged.mockClear();
    const visible = () =>
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });

    // Not overdue yet: nothing happens.
    await settle(100_000);
    visible();
    await settle();
    expect(put).toHaveBeenCalledTimes(1);

    // The renewal timer was throttled while hidden; the clock went past half
    // the lifetime and past the lifetime itself.
    vi.setSystemTime(Date.now() + 260_000);
    visible();
    await settle();
    expect(put).toHaveBeenCalledTimes(2);
    expect(putCalls()[1]).toEqual(["/events/stream/s-1/watch", { card_ids: ["c1"] }]);
    // 360 s since the last accepted one: the watch had lapsed.
    expect(onChanged).toHaveBeenCalledTimes(1);
    // The renewal rearmed from now: no double send when the old timer would have run.
    await settle(149_999);
    expect(put).toHaveBeenCalledTimes(2);
    await settle(1);
    expect(put).toHaveBeenCalledTimes(3);
  });

  it("renews early on visibility without a catch-up when the watch has not lapsed", async () => {
    const onChanged = vi.fn();
    renderHook(() => useCardWatch("c1", onChanged));
    hello("s-1", 300);
    await settle();
    onChanged.mockClear();
    vi.setSystemTime(Date.now() + 200_000);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await settle();
    expect(put).toHaveBeenCalledTimes(2);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("recovers from one failed registration within a second", async () => {
    put.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const onChanged = vi.fn();
    renderHook(() => useCardWatch("c1", onChanged));
    hello("s-1");
    await settle();
    expect(onChanged).not.toHaveBeenCalled();
    await settle(1000);
    expect(putCalls()[1]).toEqual(["/events/stream/s-1/watch", { card_ids: ["c1"] }]);
    // Registered at last: the card catches up once.
    expect(onChanged).toHaveBeenCalledTimes(1);
    ping("c1");
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it("drops a waiting retry once nothing is watched", async () => {
    put.mockRejectedValueOnce(new ApiError("Boom", 503, null));
    const { unmount } = renderHook(() => useCardWatch("c1", vi.fn()));
    hello("s-1");
    await settle();
    unmount();
    // Nothing was ever registered, so there is nothing to unregister either;
    // and the retry for "c1" never goes out.
    await settle(10_000);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("catches up once when the server first accepts a card, and only then", async () => {
    let release: (v: unknown) => void = () => {};
    put.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const onChanged = vi.fn();
    renderHook(() => useCardWatch("c1", onChanged));
    hello("s-1", 100);
    await settle();
    // The PUT is out: a change committed before it landed pings nobody, so
    // the page re-reads once the watch exists — not before.
    expect(onChanged).not.toHaveBeenCalled();
    await act(async () => {
      release({ card_ids: ["c1"], expires_in: 100 });
    });
    expect(onChanged).toHaveBeenCalledTimes(1);

    // A second hook on the card and the renewal bring no further catch-up.
    const other = vi.fn();
    renderHook(() => useCardWatch("c1", other));
    await settle(50_000);
    expect(put).toHaveBeenCalledTimes(2);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  it("never gives a catch-up for a card the server did not accept", async () => {
    put.mockResolvedValue({ card_ids: [], expires_in: 300 });
    const onChanged = vi.fn();
    renderHook(() => useCardWatch("c-hidden", onChanged));
    hello("s-1");
    await settle();
    expect(put).toHaveBeenCalledTimes(1);
    // Not on renewals either, however late one lands.
    vi.setSystemTime(Date.now() + 400_000);
    await settle(150_000);
    await settle(150_000);
    expect(put).toHaveBeenCalledTimes(3);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("catches up a card that comes back into the set after being left out", async () => {
    hello("s-1");
    const first = vi.fn();
    renderHook(() => useCardWatch("c1", first));
    await settle();
    expect(first).toHaveBeenCalledTimes(1);
    // Ten newer cards push c1 out of the registered set.
    const later = Array.from({ length: MAX_WATCHED_CARDS }, (_, i) =>
      renderHook(() => useCardWatch(`n${i}`, vi.fn())),
    );
    await settle();
    expect((putCalls()[1][1] as { card_ids: string[] }).card_ids).not.toContain("c1");
    // One closes: c1 is registered again, and catches up on what it missed.
    later[0].unmount();
    await settle();
    expect((putCalls()[2][1] as { card_ids: string[] }).card_ids).toContain("c1");
    expect(first).toHaveBeenCalledTimes(2);
  });

  it("renews once per tab, at half the lifetime the hello announced", async () => {
    renderHook(() => useCardWatch("c1", vi.fn()));
    renderHook(() => useCardWatch("c2", vi.fn()));
    renderHook(() => useCardWatch("c3", vi.fn()));
    hello("s-1", 300);
    await settle();
    expect(put).toHaveBeenCalledTimes(1);
    await settle(150_000 - 1);
    expect(put).toHaveBeenCalledTimes(1);
    await settle(1);
    expect(putCalls()[1]).toEqual(["/events/stream/s-1/watch", { card_ids: ["c1", "c2", "c3"] }]);
  });

  it(`watches the ${MAX_WATCHED_CARDS} most recently opened cards`, async () => {
    hello("s-1");
    for (let i = 1; i <= 12; i += 1) renderHook(() => useCardWatch(`c${i}`, vi.fn()));
    await settle();
    const ids = (putCalls()[0][1] as { card_ids: string[] }).card_ids;
    expect(ids).toHaveLength(MAX_WATCHED_CARDS);
    expect(ids[0]).toBe("c3");
    expect(ids[MAX_WATCHED_CARDS - 1]).toBe("c12");
  });

  it("follows a change of card id", async () => {
    hello("s-1");
    const onChanged = vi.fn();
    const { rerender } = renderHook(({ id }) => useCardWatch(id, onChanged), {
      initialProps: { id: "c1" as string | undefined },
    });
    await settle();
    rerender({ id: "c2" });
    await settle();
    expect(putCalls()[1]).toEqual(["/events/stream/s-1/watch", { card_ids: ["c2"] }]);
    // Each card's own catch-up on its first registration.
    expect(onChanged).toHaveBeenCalledTimes(2);
    onChanged.mockClear();
    ping("c1");
    expect(onChanged).not.toHaveBeenCalled();
    ping("c2");
    expect(onChanged).toHaveBeenCalledTimes(1);

    rerender({ id: undefined });
    await settle();
    expect(putCalls()[2]).toEqual(["/events/stream/s-1/watch", { card_ids: [] }]);
  });

  it("survives a StrictMode double mount with one registration and one call", async () => {
    const onChanged = vi.fn();
    hello("s-1");
    renderHook(() => useCardWatch("c1", onChanged), { wrapper: StrictMode });
    await settle();
    expect(putCalls()).toEqual([["/events/stream/s-1/watch", { card_ids: ["c1"] }]]);
    // One catch-up, not one per mount.
    expect(onChanged).toHaveBeenCalledTimes(1);
    ping("c1");
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it("holds one stream listener, however often cards open and close", async () => {
    hello("s-1");
    const first = renderHook(() => useCardWatch("c1", vi.fn()));
    first.unmount();
    renderHook(() => useCardWatch("c2", vi.fn()));
    const onChanged = vi.fn();
    renderHook(() => useCardWatch("c1", onChanged));
    ping("c1");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("calls the newest callback", async () => {
    hello("s-1");
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useCardWatch("c1", cb), {
      initialProps: { cb: first },
    });
    rerender({ cb: second });
    ping("c1");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("leaves the stream's other consumers untouched by its two message types", async () => {
    const other = vi.fn();
    renderHook(() => useEventStream(other));
    renderHook(() => useCardWatch("c1", vi.fn()));
    hello("s-1");
    ping("c1");
    // Delivered as plain events; the bell and the badges match on their own
    // event names and ignore these.
    expect(other.mock.calls.map((c) => (c[0] as { event: string }).event)).toEqual([
      "event.stream.hello",
      "event.stream.card_changed",
    ]);
  });
});
