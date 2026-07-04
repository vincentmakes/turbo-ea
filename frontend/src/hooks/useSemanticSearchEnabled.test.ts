import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

describe("useSemanticSearchEnabled", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("defaults to false (feature off) until primed", async () => {
    const { useSemanticSearchEnabled } = await import("./useSemanticSearchEnabled");
    const { result } = renderHook(() => useSemanticSearchEnabled());
    expect(result.current.semanticSearchEnabled).toBe(false);
  });

  it("reflects the value pushed by invalidateSemanticSearchEnabled", async () => {
    const { useSemanticSearchEnabled, invalidateSemanticSearchEnabled } = await import(
      "./useSemanticSearchEnabled"
    );
    const { result } = renderHook(() => useSemanticSearchEnabled());

    act(() => invalidateSemanticSearchEnabled(true));
    await waitFor(() => expect(result.current.semanticSearchEnabled).toBe(true));

    act(() => invalidateSemanticSearchEnabled(false));
    await waitFor(() => expect(result.current.semanticSearchEnabled).toBe(false));
  });
});
