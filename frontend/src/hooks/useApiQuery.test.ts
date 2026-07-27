import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { api } from "@/api/client";
import { useApiQuery } from "./useApiQuery";

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { get: vi.fn() } };
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => vi.mocked(api.get).mockReset());

describe("useApiQuery", () => {
  it("fetches and exposes the payload", async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [1, 2] });

    const { result } = renderHook(() => useApiQuery<{ items: number[] }>("/reports/matrix"));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ items: [1, 2] });
    expect(result.current.error).toBeNull();
  });

  it("stays idle and cancels when the path is null", async () => {
    const { result } = renderHook(() => useApiQuery<unknown>(null));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api.get).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it("discards a superseded response that resolves last", async () => {
    // The #882 scenario: the request for the previous selection must never
    // overwrite the one for the current selection.
    const slow = deferred<{ id: string }>();
    vi.mocked(api.get).mockImplementationOnce(() => slow.promise as Promise<never>);
    vi.mocked(api.get).mockResolvedValueOnce({ id: "fresh" });

    const { result, rerender } = renderHook(({ p }) => useApiQuery<{ id: string }>(p), {
      initialProps: { p: "/reports/matrix?row_type=A" },
    });

    rerender({ p: "/reports/matrix?row_type=B" });
    await waitFor(() => expect(result.current.data).toEqual({ id: "fresh" }));

    await act(async () => {
      slow.resolve({ id: "stale" });
      await slow.promise;
    });

    expect(result.current.data).toEqual({ id: "fresh" });
  });

  it("keeps the loading flag on until the winning request settles", async () => {
    const slow = deferred<{ id: string }>();
    const second = deferred<{ id: string }>();
    vi.mocked(api.get).mockImplementationOnce(() => slow.promise as Promise<never>);
    vi.mocked(api.get).mockImplementationOnce(() => second.promise as Promise<never>);

    const { result, rerender } = renderHook(({ p }) => useApiQuery<{ id: string }>(p), {
      initialProps: { p: "/a" },
    });
    rerender({ p: "/b" });

    // The superseded request settling must not clear the spinner.
    await act(async () => {
      slow.resolve({ id: "stale" });
      await slow.promise;
    });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      second.resolve({ id: "fresh" });
      await second.promise;
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("surfaces a real error and clears loading", async () => {
    // `...Once` on purpose: a persistently-rejecting mock leaves an unconsumed
    // rejected promise behind, which Vitest 4 reports as a test failure.
    vi.mocked(api.get).mockRejectedValueOnce(new Error("boom")).mockResolvedValue({});

    const { result } = renderHook(() => useApiQuery<unknown>("/x"));

    await waitFor(() => expect(result.current.error?.message).toBe("boom"));
    expect(result.current.loading).toBe(false);
  });

  it("does not refetch when only the select identity changes", async () => {
    // CostReport-style call sites pass a fresh arrow every render; that must
    // not become a fetch trigger.
    vi.mocked(api.get).mockResolvedValue({ n: 1 });

    const { rerender } = renderHook(() =>
      useApiQuery<{ n: number }, number>("/x", { select: (r) => r.n }),
    );
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));

    rerender();
    rerender();

    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("applies select to the payload", async () => {
    vi.mocked(api.get).mockResolvedValue({ n: 7 });

    const { result } = renderHook(() =>
      useApiQuery<{ n: number }, number>("/x", { select: (r) => r.n }),
    );

    await waitFor(() => expect(result.current.data).toBe(7));
  });

  it("keeps previous data across a path change by default", async () => {
    const next = deferred<{ id: string }>();
    vi.mocked(api.get).mockResolvedValueOnce({ id: "first" });
    vi.mocked(api.get).mockImplementationOnce(() => next.promise as Promise<never>);

    const { result, rerender } = renderHook(({ p }) => useApiQuery<{ id: string }>(p), {
      initialProps: { p: "/a" },
    });
    await waitFor(() => expect(result.current.data).toEqual({ id: "first" }));

    rerender({ p: "/b" });
    // Still rendering the previous payload rather than blanking to a spinner.
    expect(result.current.data).toEqual({ id: "first" });

    await act(async () => {
      next.resolve({ id: "second" });
      await next.promise;
    });
    expect(result.current.data).toEqual({ id: "second" });
  });

  it("refetch() re-issues the same path", async () => {
    vi.mocked(api.get).mockResolvedValue({ n: 1 });
    const { result } = renderHook(() => useApiQuery<{ n: number }>("/x"));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));

    act(() => result.current.refetch());

    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it("forwards an abort signal to the client", async () => {
    vi.mocked(api.get).mockResolvedValue({});
    renderHook(() => useApiQuery<unknown>("/x"));

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const opts = vi.mocked(api.get).mock.calls[0][1];
    expect(opts?.signal).toBeInstanceOf(AbortSignal);
  });
});
