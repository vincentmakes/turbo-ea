import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSubmitOnce } from "./useSubmitOnce";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useSubmitOnce", () => {
  it("runs one submit at a time and skips a second call that lands while the first is in flight", async () => {
    const { result } = renderHook(() => useSubmitOnce());
    const first = deferred<string>();
    const fn = vi.fn(() => first.promise);

    let a: Promise<string | undefined>;
    let b: Promise<string | undefined>;
    act(() => {
      a = result.current.run(fn);
      b = result.current.run(fn);
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(true);
    expect(result.current.isBusy()).toBe(true);
    await expect(b!).resolves.toBeUndefined();

    await act(async () => {
      first.resolve("done");
      await a;
    });
    expect(result.current.busy).toBe(false);
    expect(result.current.isBusy()).toBe(false);
    await expect(a!).resolves.toBe("done");
  });

  it("accepts a new submit once the previous one settled", async () => {
    const { result } = renderHook(() => useSubmitOnce());
    const fn = vi.fn(async () => 1);
    await act(async () => {
      await result.current.run(fn);
    });
    await act(async () => {
      await result.current.run(fn);
    });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("clears busy and propagates the rejection when the submit fails", async () => {
    const { result } = renderHook(() => useSubmitOnce());
    const failing = deferred<void>();
    let p: Promise<void | undefined>;
    act(() => {
      p = result.current.run(() => failing.promise);
    });
    expect(result.current.busy).toBe(true);
    await act(async () => {
      failing.reject(new Error("boom"));
      await p.catch(() => undefined);
    });
    await expect(p!).rejects.toThrow("boom");
    expect(result.current.busy).toBe(false);
    // The next submit is accepted again.
    const fn = vi.fn(async () => "ok");
    await act(async () => {
      await result.current.run(fn);
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("keeps run and isBusy identity-stable across renders", () => {
    const { result, rerender } = renderHook(() => useSubmitOnce());
    const { run, isBusy } = result.current;
    rerender();
    expect(result.current.run).toBe(run);
    expect(result.current.isBusy).toBe(isBusy);
  });

  it("answers isBusy before the busy state has re-rendered", () => {
    const { result } = renderHook(() => useSubmitOnce());
    const pending = deferred<void>();
    const { run, isBusy } = result.current;
    let seen: boolean | undefined;
    act(() => {
      void run(() => pending.promise);
      // Read inside the same act, i.e. before React has flushed `busy`.
      seen = isBusy();
    });
    expect(seen).toBe(true);
    act(() => pending.resolve());
  });
});
