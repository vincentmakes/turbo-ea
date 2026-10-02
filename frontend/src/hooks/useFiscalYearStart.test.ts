import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
// Evaluated here, at file load, on purpose: the mock factory runs once, on the
// first import of `@/api/client`, and its result survives `vi.resetModules()`.
// Importing it statically pins that first run to the same module generation
// as the static `mockApi` below, so the `api` every re-imported copy of the
// hook receives is the instance this file scripts. Without it the factory
// would first run inside a test, after a reset, against a fresh copy of the
// kit whose routes nothing here could reach.
import { api } from "@/api/client";
import { mockApi } from "@/test/apiMock";

const PATH = "/settings/fiscal-year-start";

/** A promise the test resolves by hand, to hold a request in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// The module keeps a process-wide cache, so every test re-imports it fresh.
async function load() {
  return import("./useFiscalYearStart");
}

describe("useFiscalYearStart", () => {
  beforeEach(() => {
    mockApi.reset();
    vi.resetModules();
  });

  it("is wired to the scripted client (guards the mock plumbing itself)", () => {
    expect(api).toBe(mockApi.api);
  });

  it("starts on the January default while loading, then reads the configured month", async () => {
    const { useFiscalYearStart, DEFAULT_FISCAL_YEAR_START } = await load();
    mockApi.on("get", PATH, { month: 10 });

    const { result } = renderHook(() => useFiscalYearStart());
    expect(DEFAULT_FISCAL_YEAR_START).toBe(1);
    expect(result.current.month).toBe(DEFAULT_FISCAL_YEAR_START);
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.month).toBe(10);
    expect(mockApi.callsOf("get", PATH)).toHaveLength(1);
  });

  it("shares one in-flight request between hooks mounting in the same tick", async () => {
    const { useFiscalYearStart } = await load();
    const gate = deferred<{ month: number }>();
    mockApi.on("get", PATH, () => gate.promise);

    const a = renderHook(() => useFiscalYearStart());
    const b = renderHook(() => useFiscalYearStart());
    expect(mockApi.callsOf("get", PATH)).toHaveLength(1);

    await act(async () => {
      gate.resolve({ month: 7 });
    });
    await waitFor(() => {
      expect(a.result.current).toEqual({ month: 7, loading: false });
      expect(b.result.current).toEqual({ month: 7, loading: false });
    });
    expect(mockApi.callsOf("get", PATH)).toHaveLength(1);
  });

  it("serves a later mount from the cache without a second request", async () => {
    const { useFiscalYearStart } = await load();
    mockApi.on("get", PATH, { month: 4 });

    const first = renderHook(() => useFiscalYearStart());
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();

    const second = renderHook(() => useFiscalYearStart());
    // Synchronously settled: the cache seeds both the value and the flag.
    expect(second.result.current).toEqual({ month: 4, loading: false });
    expect(mockApi.callsOf("get", PATH)).toHaveLength(1);
  });

  it.each([
    ["out of range", { month: 13 }],
    ["zero", { month: 0 }],
    ["a fraction", { month: 2.5 }],
    ["a string", { month: "3" }],
    ["absent", {}],
    ["a null body", null],
  ])("keeps the default when the payload month is %s", async (_label, body) => {
    const { useFiscalYearStart } = await load();
    mockApi.on("get", PATH, body);

    const { result } = renderHook(() => useFiscalYearStart());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.month).toBe(1);
    // The request did go out — the default is a fallback, not a short-circuit.
    expect(mockApi.callsOf("get", PATH)).toHaveLength(1);
  });

  it("keeps the default and stops loading when the request fails", async () => {
    const { useFiscalYearStart } = await load();
    mockApi.fail("get", PATH, 500);

    const { result } = renderHook(() => useFiscalYearStart());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.month).toBe(1);
  });

  it("retries on the next mount after a failed fetch (nothing was cached)", async () => {
    const { useFiscalYearStart } = await load();
    mockApi.fail("get", PATH, 500);

    const first = renderHook(() => useFiscalYearStart());
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();

    mockApi.on("get", PATH, { month: 9 });
    const second = renderHook(() => useFiscalYearStart());
    await waitFor(() => expect(second.result.current.month).toBe(9));
    expect(mockApi.callsOf("get", PATH)).toHaveLength(2);
  });

  describe("invalidateFiscalYearStart", () => {
    it("primes the cache so a hook mounted afterwards never fetches", async () => {
      const { useFiscalYearStart, invalidateFiscalYearStart } = await load();

      invalidateFiscalYearStart(6);
      const { result } = renderHook(() => useFiscalYearStart());
      expect(result.current).toEqual({ month: 6, loading: false });
      expect(mockApi.callsOf("get", PATH)).toHaveLength(0);
    });

    it("pushes a new value into every mounted hook", async () => {
      const { useFiscalYearStart, invalidateFiscalYearStart } = await load();
      mockApi.on("get", PATH, { month: 1 });

      const a = renderHook(() => useFiscalYearStart());
      const b = renderHook(() => useFiscalYearStart());
      await waitFor(() => expect(a.result.current.loading).toBe(false));

      act(() => invalidateFiscalYearStart(11));
      expect(a.result.current.month).toBe(11);
      expect(b.result.current.month).toBe(11);
    });

    it.each([0, 13, -1, 2.5, Number.NaN])("ignores %s and keeps the current value", async (bad) => {
      const { useFiscalYearStart, invalidateFiscalYearStart } = await load();

      invalidateFiscalYearStart(3);
      const { result } = renderHook(() => useFiscalYearStart());
      act(() => invalidateFiscalYearStart(bad));
      expect(result.current.month).toBe(3);
    });

    it("stops reaching a hook once it has unmounted", async () => {
      const { useFiscalYearStart, invalidateFiscalYearStart } = await load();
      invalidateFiscalYearStart(2);

      const { result, unmount } = renderHook(() => useFiscalYearStart());
      unmount();
      // No listener left: the call must not throw or warn about an update on
      // an unmounted component, and the last rendered value is untouched.
      expect(() => invalidateFiscalYearStart(8)).not.toThrow();
      expect(result.current.month).toBe(2);

      // The cache itself did move, so the next mount sees the new month.
      const next = renderHook(() => useFiscalYearStart());
      expect(next.result.current.month).toBe(8);
    });
  });

  it("resetFiscalYearStart forgets the cache so the next mount fetches again", async () => {
    const { useFiscalYearStart, resetFiscalYearStart } = await load();
    mockApi.on("get", PATH, { month: 5 });

    const first = renderHook(() => useFiscalYearStart());
    await waitFor(() => expect(first.result.current.month).toBe(5));
    first.unmount();

    resetFiscalYearStart();
    mockApi.on("get", PATH, { month: 2 });
    const second = renderHook(() => useFiscalYearStart());
    expect(second.result.current.loading).toBe(true);
    await waitFor(() => expect(second.result.current.month).toBe(2));
    expect(mockApi.callsOf("get", PATH)).toHaveLength(2);
  });
});
