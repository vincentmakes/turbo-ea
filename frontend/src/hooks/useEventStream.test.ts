import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useEventStream, stopEventStream } from "./useEventStream";
import { setAuthenticated } from "@/api/client";

// ---------------------------------------------------------------------------
// Mock EventSource globally
// ---------------------------------------------------------------------------

let esInstances: Array<{
  onmessage: ((e: { data: string }) => void) | null;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  close: ReturnType<typeof vi.fn>;
}> = [];

const MockEventSource = vi.fn(function MockEventSource(this: unknown) {
  const inst = {
    onmessage: null as ((e: { data: string }) => void) | null,
    // The browser fires this on the initial connection and again on every
    // silent auto-reconnect — which is what the resync tests below drive.
    onopen: null as (() => void) | null,
    onerror: null as (() => void) | null,
    close: vi.fn(),
  };
  esInstances.push(inst);
  return inst;
});

vi.stubGlobal("EventSource", MockEventSource);

beforeEach(() => {
  vi.clearAllMocks();
  esInstances = [];
  // Reset the module-level singleton state between tests.
  stopEventStream();
  setAuthenticated(false);
});

afterEach(() => {
  stopEventStream();
});

describe("useEventStream", () => {
  it("creates EventSource with correct URL when authenticated", () => {
    setAuthenticated(true);

    renderHook(() => useEventStream(vi.fn()));

    expect(MockEventSource).toHaveBeenCalledWith("/api/v1/events/stream");
  });

  it("does NOT create EventSource when not authenticated", () => {
    renderHook(() => useEventStream(vi.fn()));

    expect(MockEventSource).not.toHaveBeenCalled();
  });

  it("shares a single EventSource across multiple consumers", () => {
    setAuthenticated(true);

    renderHook(() => useEventStream(vi.fn()));
    renderHook(() => useEventStream(vi.fn()));

    expect(MockEventSource).toHaveBeenCalledTimes(1);
  });

  it("dispatches incoming messages to all subscribers", () => {
    setAuthenticated(true);
    const a = vi.fn();
    const b = vi.fn();

    renderHook(() => useEventStream(a));
    renderHook(() => useEventStream(b));

    const payload = { event: "card.updated", card_id: "abc-123" };
    esInstances[0].onmessage!({ data: JSON.stringify(payload) });

    expect(a).toHaveBeenCalledWith(payload);
    expect(b).toHaveBeenCalledWith(payload);
  });

  it("ignores messages with invalid JSON", () => {
    setAuthenticated(true);
    const cb = vi.fn();

    renderHook(() => useEventStream(cb));

    esInstances[0].onmessage!({ data: "not valid json{" });

    expect(cb).not.toHaveBeenCalled();
  });

  it("does not close the shared connection when one consumer unmounts", () => {
    setAuthenticated(true);

    renderHook(() => useEventStream(vi.fn()));
    const second = renderHook(() => useEventStream(vi.fn()));

    second.unmount();

    expect(esInstances[0].close).not.toHaveBeenCalled();
  });

  it("stopEventStream closes the connection", () => {
    setAuthenticated(true);

    renderHook(() => useEventStream(vi.fn()));

    stopEventStream();

    expect(esInstances[0].close).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Reconnect resync
  // -------------------------------------------------------------------------
  //
  // SSE has no replay, so whatever was published while the stream was down is
  // gone. The case that surfaced this: an upgrade writes its "app updated"
  // notification during backend startup, before any browser is connected to be
  // published to, so the bell badge sat at its old count until a full reload.

  it("does NOT call onReconnect for the initial connection", () => {
    // Consumers already load their state on mount; treating the first open as
    // a reconnect would double every initial fetch.
    setAuthenticated(true);
    const onReconnect = vi.fn();

    renderHook(() => useEventStream(vi.fn(), onReconnect));
    esInstances[0].onopen!();

    expect(onReconnect).not.toHaveBeenCalled();
  });

  it("calls onReconnect each time the stream comes back after a drop", () => {
    setAuthenticated(true);
    const onReconnect = vi.fn();

    renderHook(() => useEventStream(vi.fn(), onReconnect));
    esInstances[0].onopen!(); // initial connection
    esInstances[0].onopen!(); // dropped, then reopened

    expect(onReconnect).toHaveBeenCalledTimes(1);

    esInstances[0].onopen!();
    expect(onReconnect).toHaveBeenCalledTimes(2);
  });

  it("notifies every consumer on reconnect", () => {
    setAuthenticated(true);
    const a = vi.fn();
    const b = vi.fn();

    renderHook(() => useEventStream(vi.fn(), a));
    renderHook(() => useEventStream(vi.fn(), b));
    esInstances[0].onopen!();
    esInstances[0].onopen!();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("one throwing reconnect listener does not stop the others", () => {
    setAuthenticated(true);
    const boom = vi.fn(() => {
      throw new Error("boom");
    });
    const ok = vi.fn();

    renderHook(() => useEventStream(vi.fn(), boom));
    renderHook(() => useEventStream(vi.fn(), ok));
    esInstances[0].onopen!();
    esInstances[0].onopen!();

    expect(boom).toHaveBeenCalled();
    expect(ok).toHaveBeenCalled();
  });

  it("stops notifying a consumer once it unmounts", () => {
    setAuthenticated(true);
    const onReconnect = vi.fn();

    const { unmount } = renderHook(() => useEventStream(vi.fn(), onReconnect));
    esInstances[0].onopen!(); // initial
    unmount();
    esInstances[0].onopen!(); // would be a reconnect

    expect(onReconnect).not.toHaveBeenCalled();
  });

  it("treats the stream opened after a logout as a fresh connection", () => {
    // stopEventStream() runs on logout. The next login opens a new stream, and
    // that first open is an initial connection — nothing was missed in between.
    setAuthenticated(true);
    const onReconnect = vi.fn();

    const { unmount } = renderHook(() => useEventStream(vi.fn(), onReconnect));
    esInstances[0].onopen!();
    unmount();
    stopEventStream();

    renderHook(() => useEventStream(vi.fn(), onReconnect));
    esInstances[1].onopen!();

    expect(onReconnect).not.toHaveBeenCalled();
  });
});
