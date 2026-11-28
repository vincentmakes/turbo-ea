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
import { MAX_WATCHED_CARDS, resetCardWatch, useCardWatch } from "./useCardWatch";

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
function hello(streamId: string, ttl = 1800) {
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
    expires_in: 1800,
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

  it("re-registers on a reconnect hello and re-reads every card once, jittered", async () => {
    const onChanged = vi.fn();
    renderHook(() => useCardWatch("c1", onChanged));
    hello("s-1");
    await settle();
    expect(onChanged).not.toHaveBeenCalled();

    vi.spyOn(Math, "random").mockReturnValue(0.5);
    hello("s-2");
    await settle();
    expect(putCalls()[1]).toEqual(["/events/stream/s-2/watch", { card_ids: ["c1"] }]);
    // Jitter: 0.5 × 1500 ms.
    await settle(749);
    expect(onChanged).not.toHaveBeenCalled();
    await settle(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
    await settle(5000);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("refreshes the watch before it expires, while something is watched", async () => {
    const { unmount } = renderHook(() => useCardWatch("c1", vi.fn()));
    hello("s-1", 100);
    await settle();
    expect(put).toHaveBeenCalledTimes(1);

    // At 80 % of the 100 s lifetime.
    await settle(79_999);
    expect(put).toHaveBeenCalledTimes(1);
    await settle(1);
    expect(putCalls()[1]).toEqual(["/events/stream/s-1/watch", { card_ids: ["c1"] }]);
    await settle(80_000);
    expect(put).toHaveBeenCalledTimes(3);

    unmount();
    await settle();
    expect(putCalls()[3]).toEqual(["/events/stream/s-1/watch", { card_ids: [] }]);
    // Nothing watched: no more refreshes.
    await settle(10 * 80_000);
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
    await settle();
    expect(putCalls()[1]).toEqual(["/events/stream/s-2/watch", { card_ids: ["c1", "c2"] }]);
  });

  it("swallows any other failure without logging or retrying in a loop", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    put.mockRejectedValue(new ApiError("Boom", 500, null));
    renderHook(() => useCardWatch("c1", vi.fn()));
    hello("s-1", 100);
    await settle();
    await settle(1000);
    expect(put).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
    // The refresh still tries again later, and that works once the server does.
    put.mockResolvedValue({ card_ids: ["c1"], expires_in: 100 });
    await settle(80_000);
    expect(put).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
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
    ping("c1");
    expect(onChanged).toHaveBeenCalledTimes(1);
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
