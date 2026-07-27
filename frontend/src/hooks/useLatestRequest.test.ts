import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useLatestRequest, useAbortableEffect } from "./useLatestRequest";

/** A promise plus its resolver, so a test can control completion order. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useLatestRequest", () => {
  it("keeps a stable identity across re-renders", () => {
    // Callers put `run` in useCallback dependency arrays — a fresh object each
    // render would rebuild their fetch callback and loop the effect forever.
    const { result, rerender } = renderHook(() => useLatestRequest());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    expect(result.current.run).toBe(first.run);
  });

  it("discards the result of a superseded run when it resolves last", async () => {
    // The #882 scenario in miniature.
    const slow = deferred<string>();
    const fast = deferred<string>();
    const written: string[] = [];
    const { result } = renderHook(() => useLatestRequest());

    let slowSawCurrent = true;
    act(() => {
      void result.current.run(async ({ isCurrent }) => {
        const v = await slow.promise;
        slowSawCurrent = isCurrent();
        if (!isCurrent()) return;
        written.push(v);
      });
      void result.current.run(async ({ isCurrent }) => {
        const v = await fast.promise;
        if (!isCurrent()) return;
        written.push(v);
      });
    });

    await act(async () => {
      fast.resolve("fresh");
      await fast.promise;
    });
    await act(async () => {
      slow.resolve("stale");
      await slow.promise;
    });

    expect(slowSawCurrent).toBe(false);
    expect(written).toEqual(["fresh"]);
  });

  it("aborts the predecessor's signal when a newer run starts", async () => {
    const { result } = renderHook(() => useLatestRequest());
    let firstSignal: AbortSignal | undefined;

    act(() => {
      void result.current.run(async ({ signal }) => {
        firstSignal = signal;
        await new Promise(() => {}); // never settles
      });
    });
    expect(firstSignal?.aborted).toBe(false);

    act(() => {
      void result.current.run(async () => {});
    });

    expect(firstSignal?.aborted).toBe(true);
  });

  it("settles a superseded run instead of hanging", async () => {
    // InventoryPage has 13 `await loadData()` call sites; if a superseded run
    // never settled they would all hang.
    const slow = deferred<void>();
    const { result } = renderHook(() => useLatestRequest());
    let settled = false;

    let first: Promise<void>;
    act(() => {
      first = result.current.run(async () => {
        await slow.promise;
      });
      void first.then(() => {
        settled = true;
      });
      void result.current.run(async () => {});
    });

    await act(async () => {
      slow.resolve();
      await slow.promise;
    });
    await waitFor(() => expect(settled).toBe(true));
  });

  it("swallows an AbortError but rethrows a real error from the current run", async () => {
    const { result } = renderHook(() => useLatestRequest());

    await act(async () => {
      await expect(
        result.current.run(async () => {
          throw new DOMException("aborted", "AbortError");
        }),
      ).resolves.toBeUndefined();
    });

    await act(async () => {
      await expect(
        result.current.run(async () => {
          throw new Error("500");
        }),
      ).rejects.toThrow("500");
    });
  });

  it("swallows a real error thrown by a superseded run", async () => {
    const slow = deferred<void>();
    const { result } = renderHook(() => useLatestRequest());
    let rejected = false;

    act(() => {
      void result.current
        .run(async () => {
          await slow.promise;
          throw new Error("stale failure");
        })
        .catch(() => {
          rejected = true;
        });
      void result.current.run(async () => {});
    });

    await act(async () => {
      slow.resolve();
      await slow.promise.catch(() => {});
    });

    expect(rejected).toBe(false);
  });

  it("invalidates and aborts on unmount", async () => {
    const { result, unmount } = renderHook(() => useLatestRequest());
    let signal: AbortSignal | undefined;
    let currentAfterUnmount = true;

    act(() => {
      void result.current.run(async ({ signal: s, isCurrent }) => {
        signal = s;
        await new Promise((r) => setTimeout(r, 0));
        currentAfterUnmount = isCurrent();
      });
    });

    unmount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1));
    });

    expect(signal?.aborted).toBe(true);
    expect(currentAfterUnmount).toBe(false);
  });

  it("cancel() invalidates without starting a new request", async () => {
    const { result } = renderHook(() => useLatestRequest());
    let current = true;

    act(() => {
      void result.current.run(async ({ isCurrent }) => {
        await new Promise((r) => setTimeout(r, 0));
        current = isCurrent();
      });
      result.current.cancel();
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 1));
    });

    expect(current).toBe(false);
  });
});

describe("useAbortableEffect", () => {
  it("re-runs on dependency change and invalidates the previous run", async () => {
    const seen: string[] = [];
    const gate = deferred<void>();

    const { rerender } = renderHook(
      ({ key }: { key: string }) =>
        useAbortableEffect(
          async ({ isCurrent }) => {
            if (key === "a") await gate.promise;
            if (!isCurrent()) return;
            seen.push(key);
          },
          [key],
        ),
      { initialProps: { key: "a" } },
    );

    rerender({ key: "b" });
    await act(async () => {
      gate.resolve();
      await gate.promise;
    });

    await waitFor(() => expect(seen).toEqual(["b"]));
  });

  it("does not re-run when only the effect closure identity changes", async () => {
    const runs = vi.fn(async () => {});
    const { rerender } = renderHook(() => useAbortableEffect(() => runs(), [1]));

    rerender();
    rerender();

    await waitFor(() => expect(runs).toHaveBeenCalledTimes(1));
  });
});
