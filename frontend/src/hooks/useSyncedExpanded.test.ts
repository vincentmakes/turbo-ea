import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useSyncedExpanded } from "./useSyncedExpanded";

describe("useSyncedExpanded", () => {
  it("starts at the initial value", () => {
    const { result } = renderHook(() => useSyncedExpanded(true));
    expect(result.current[0]).toBe(true);

    const collapsed = renderHook(() => useSyncedExpanded(false));
    expect(collapsed.result.current[0]).toBe(false);
  });

  it("adopts a value that arrives after mount", () => {
    // The metamodel's section_config loads asynchronously, so a section can
    // mount with the fallback and only later be told it should be collapsed.
    // MUI's uncontrolled `defaultExpanded` ignored that update; this must not.
    const { result, rerender } = renderHook(
      ({ initial }) => useSyncedExpanded(initial),
      { initialProps: { initial: true } },
    );
    expect(result.current[0]).toBe(true);

    rerender({ initial: false });
    expect(result.current[0]).toBe(false);

    rerender({ initial: true });
    expect(result.current[0]).toBe(true);
  });

  it("keeps a manual toggle when the incoming value is unchanged", () => {
    const { result, rerender } = renderHook(
      ({ initial }) => useSyncedExpanded(initial),
      { initialProps: { initial: false } },
    );

    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);

    // A re-render carrying the same config must not stomp the user's toggle.
    rerender({ initial: false });
    expect(result.current[0]).toBe(true);
  });
});
