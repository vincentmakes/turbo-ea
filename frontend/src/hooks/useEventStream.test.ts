import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useEventStream } from "./useEventStream";

// ---------------------------------------------------------------------------
// Mock EventSource globally
// ---------------------------------------------------------------------------

let mockInstance: {
  onmessage: ((e: { data: string }) => void) | null;
  onerror: (() => void) | null;
  close: ReturnType<typeof vi.fn>;
};

const MockEventSource = vi.fn().mockImplementation(() => {
  mockInstance = {
    onmessage: null,
    onerror: null,
    close: vi.fn(),
  };
  return mockInstance;
});

vi.stubGlobal("EventSource", MockEventSource);

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe("useEventStream", () => {
  it("creates EventSource with correct URL when token exists", () => {
    sessionStorage.setItem("token", "my-jwt");
    const onEvent = vi.fn();

    renderHook(() => useEventStream(onEvent));

    expect(MockEventSource).toHaveBeenCalledWith(
      "/api/v1/events/stream?token=my-jwt"
    );
  });

  it("does NOT create EventSource when no token", () => {
    const onEvent = vi.fn();

    renderHook(() => useEventStream(onEvent));

    expect(MockEventSource).not.toHaveBeenCalled();
  });

  it("encodes token in URL", () => {
    sessionStorage.setItem("token", "token with spaces&special=chars");
    const onEvent = vi.fn();

    renderHook(() => useEventStream(onEvent));

    expect(MockEventSource).toHaveBeenCalledWith(
      `/api/v1/events/stream?token=${encodeURIComponent("token with spaces&special=chars")}`
    );
  });

  it("parses incoming messages and calls onEvent", () => {
    sessionStorage.setItem("token", "jwt");
    const onEvent = vi.fn();

    renderHook(() => useEventStream(onEvent));

    // Simulate a message from the server
    const payload = { type: "card.updated", card_id: "abc-123" };
    mockInstance.onmessage!({ data: JSON.stringify(payload) });

    expect(onEvent).toHaveBeenCalledWith(payload);
  });

  it("ignores messages with invalid JSON", () => {
    sessionStorage.setItem("token", "jwt");
    const onEvent = vi.fn();

    renderHook(() => useEventStream(onEvent));

    // Should not throw
    mockInstance.onmessage!({ data: "not valid json{" });

    expect(onEvent).not.toHaveBeenCalled();
  });

  it("cleanup closes EventSource on unmount", () => {
    sessionStorage.setItem("token", "jwt");
    const onEvent = vi.fn();

    const { unmount } = renderHook(() => useEventStream(onEvent));

    expect(mockInstance.close).not.toHaveBeenCalled();

    unmount();

    expect(mockInstance.close).toHaveBeenCalled();
  });
});
