import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useEventStream, stopEventStream } from "./useEventStream";
import { setAuthenticated } from "@/api/client";

// ---------------------------------------------------------------------------
// Mock EventSource globally
// ---------------------------------------------------------------------------

let esInstances: Array<{
  onmessage: ((e: { data: string }) => void) | null;
  onerror: (() => void) | null;
  close: ReturnType<typeof vi.fn>;
}> = [];

const MockEventSource = vi.fn(function MockEventSource(this: unknown) {
  const inst = {
    onmessage: null as ((e: { data: string }) => void) | null,
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
});
