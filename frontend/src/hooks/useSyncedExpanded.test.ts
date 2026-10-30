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

describe("useSyncedExpanded expandOn", () => {
  it("re-expands on each new request, even after the user collapsed it", () => {
    const { result, rerender } = renderHook(
      ({ expandOn }: { expandOn?: number }) => useSyncedExpanded(false, expandOn),
      { initialProps: { expandOn: undefined as number | undefined } },
    );
    expect(result.current[0]).toBe(false);

    rerender({ expandOn: 1 });
    expect(result.current[0]).toBe(true);

    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);

    rerender({ expandOn: 2 });
    expect(result.current[0]).toBe(true);
  });

  it("opens a section that mounts with a pending request", () => {
    const { result } = renderHook(() => useSyncedExpanded(false, 7));
    expect(result.current[0]).toBe(true);
  });

  it("does nothing while no request is made", () => {
    const { result, rerender } = renderHook(
      ({ expandOn }: { expandOn?: number }) => useSyncedExpanded(false, expandOn),
      { initialProps: { expandOn: undefined as number | undefined } },
    );
    rerender({ expandOn: undefined });
    expect(result.current[0]).toBe(false);
  });

  it("keeps a manual collapse while the same request stands", () => {
    const { result, rerender } = renderHook(
      ({ expandOn }: { expandOn?: number }) => useSyncedExpanded(false, expandOn),
      { initialProps: { expandOn: 3 as number | undefined } },
    );
    act(() => result.current[1](false));
    rerender({ expandOn: 3 });
    expect(result.current[0]).toBe(false);
  });
});
