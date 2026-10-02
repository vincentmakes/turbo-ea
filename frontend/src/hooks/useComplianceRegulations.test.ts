import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import type { ComplianceRegulation } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
// Evaluated at file load on purpose: the mock factory runs once, on the first
// import of `@/api/client`, and its result survives `vi.resetModules()`, so a
// static import pins it to the same module generation as the `mockApi` below.
// Otherwise the factory would first run inside a test, after a reset, against
// a fresh copy of the kit whose routes nothing here could reach.
import { api } from "@/api/client";
import { mockApi } from "@/test/apiMock";

const PATH = "/metamodel/compliance-regulations";

function regulation(over: Partial<ComplianceRegulation> & { key: string }): ComplianceRegulation {
  return {
    id: `id-${over.key}`,
    label: over.key.toUpperCase(),
    description: null,
    is_enabled: true,
    built_in: true,
    sort_order: 0,
    translations: {},
    ...over,
  };
}

const GDPR = regulation({ key: "gdpr", sort_order: 1 });
const NIS2 = regulation({ key: "nis2", sort_order: 2, is_enabled: false });
const DORA = regulation({ key: "dora", sort_order: 3, built_in: false });

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
  return import("./useComplianceRegulations");
}

describe("useComplianceRegulations", () => {
  beforeEach(() => {
    mockApi.reset();
    vi.resetModules();
  });

  it("is wired to the scripted client (guards the mock plumbing itself)", () => {
    expect(api).toBe(mockApi.api);
  });

  it("fetches the list once on first mount and derives `enabled` and `byKey`", async () => {
    mockApi.on("get", PATH, [GDPR, NIS2, DORA]);
    const { useComplianceRegulations } = await load();

    const { result } = renderHook(() => useComplianceRegulations());
    expect(result.current.loaded).toBe(false);
    expect(result.current.regulations).toEqual([]);
    expect(result.current.enabled).toEqual([]);
    expect(result.current.byKey).toEqual({});

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.regulations).toEqual([GDPR, NIS2, DORA]);
    // `enabled` keeps the server's order and drops the switched-off row.
    expect(result.current.enabled.map((r) => r.key)).toEqual(["gdpr", "dora"]);
    // `byKey` indexes every row, disabled ones included.
    expect(Object.keys(result.current.byKey).sort()).toEqual(["dora", "gdpr", "nis2"]);
    expect(result.current.byKey.nis2).toBe(NIS2);
    expect(mockApi.callsOf("get", PATH)).toHaveLength(1);
  });

  it("keeps the derived views referentially stable across re-renders", async () => {
    mockApi.on("get", PATH, [GDPR]);
    const { useComplianceRegulations } = await load();

    const { result, rerender } = renderHook(() => useComplianceRegulations());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    const { enabled, byKey, refresh } = result.current;

    rerender();
    expect(result.current.enabled).toBe(enabled);
    expect(result.current.byKey).toBe(byKey);
    expect(result.current.refresh).toBe(refresh);
  });

  it("treats a non-array payload as an empty list", async () => {
    mockApi.on("get", PATH, { items: [GDPR] });
    const { useComplianceRegulations } = await load();

    const { result } = renderHook(() => useComplianceRegulations());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.regulations).toEqual([]);
  });

  it("settles on an empty list when the request fails and nothing was cached", async () => {
    mockApi.fail("get", PATH, 500);
    const { useComplianceRegulations } = await load();

    const { result } = renderHook(() => useComplianceRegulations());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.regulations).toEqual([]);
    expect(result.current.enabled).toEqual([]);
  });

  it("shares one in-flight request between hooks mounting in the same tick", async () => {
    const gate = deferred<ComplianceRegulation[]>();
    mockApi.on("get", PATH, () => gate.promise);
    const { useComplianceRegulations } = await load();

    const a = renderHook(() => useComplianceRegulations());
    const b = renderHook(() => useComplianceRegulations());
    expect(mockApi.callsOf("get", PATH)).toHaveLength(1);

    await act(async () => {
      gate.resolve([GDPR]);
    });
    await waitFor(() => {
      expect(a.result.current.loaded).toBe(true);
      expect(b.result.current.loaded).toBe(true);
    });
    expect(a.result.current.regulations).toEqual([GDPR]);
    expect(b.result.current.regulations).toEqual([GDPR]);
    expect(mockApi.callsOf("get", PATH)).toHaveLength(1);
  });

  it("serves a later mount from the cache, loaded on the first render", async () => {
    mockApi.on("get", PATH, [GDPR, DORA]);
    const { useComplianceRegulations } = await load();

    const first = renderHook(() => useComplianceRegulations());
    await waitFor(() => expect(first.result.current.loaded).toBe(true));
    first.unmount();

    const second = renderHook(() => useComplianceRegulations());
    expect(second.result.current.loaded).toBe(true);
    expect(second.result.current.regulations).toEqual([GDPR, DORA]);
    expect(mockApi.callsOf("get", PATH)).toHaveLength(1);
  });

  describe("invalidateComplianceRegulations", () => {
    it("primes the cache so a hook mounted afterwards never fetches", async () => {
      const { useComplianceRegulations, invalidateComplianceRegulations } = await load();

      invalidateComplianceRegulations([GDPR, NIS2]);
      const { result } = renderHook(() => useComplianceRegulations());
      expect(result.current.loaded).toBe(true);
      expect(result.current.regulations).toEqual([GDPR, NIS2]);
      expect(result.current.enabled).toEqual([GDPR]);
      expect(mockApi.callsOf("get", PATH)).toHaveLength(0);
    });

    it("pushes a new list into every mounted hook", async () => {
      mockApi.on("get", PATH, [GDPR]);
      const { useComplianceRegulations, invalidateComplianceRegulations } = await load();

      const a = renderHook(() => useComplianceRegulations());
      const b = renderHook(() => useComplianceRegulations());
      await waitFor(() => expect(a.result.current.loaded).toBe(true));

      act(() => invalidateComplianceRegulations([GDPR, DORA]));
      expect(a.result.current.regulations).toEqual([GDPR, DORA]);
      expect(b.result.current.regulations).toEqual([GDPR, DORA]);
      expect(b.result.current.byKey.dora).toBe(DORA);
    });

    it("stops reaching a hook once it has unmounted", async () => {
      const { useComplianceRegulations, invalidateComplianceRegulations } = await load();
      invalidateComplianceRegulations([GDPR]);

      const { result, unmount } = renderHook(() => useComplianceRegulations());
      unmount();
      expect(() => invalidateComplianceRegulations([DORA])).not.toThrow();
      expect(result.current.regulations).toEqual([GDPR]);

      // The cache itself did move, so the next mount sees the new list.
      const next = renderHook(() => useComplianceRegulations());
      expect(next.result.current.regulations).toEqual([DORA]);
    });
  });

  describe("refresh", () => {
    it("refetches even though the list is cached and updates every consumer", async () => {
      mockApi.on("get", PATH, [GDPR]);
      const { useComplianceRegulations } = await load();

      const a = renderHook(() => useComplianceRegulations());
      const b = renderHook(() => useComplianceRegulations());
      await waitFor(() => expect(a.result.current.loaded).toBe(true));

      mockApi.on("get", PATH, [GDPR, DORA]);
      await act(async () => {
        await a.result.current.refresh();
      });
      expect(a.result.current.regulations).toEqual([GDPR, DORA]);
      expect(b.result.current.regulations).toEqual([GDPR, DORA]);
      expect(mockApi.callsOf("get", PATH)).toHaveLength(2);
    });

    it("joins a request already in flight instead of starting a second one", async () => {
      const gate = deferred<ComplianceRegulation[]>();
      mockApi.on("get", PATH, () => gate.promise);
      const { useComplianceRegulations } = await load();

      const { result } = renderHook(() => useComplianceRegulations());
      let settled = false;
      act(() => {
        void result.current.refresh().then(() => {
          settled = true;
        });
      });
      expect(mockApi.callsOf("get", PATH)).toHaveLength(1);

      await act(async () => {
        gate.resolve([DORA]);
      });
      await waitFor(() => expect(settled).toBe(true));
      expect(result.current.regulations).toEqual([DORA]);
      expect(mockApi.callsOf("get", PATH)).toHaveLength(1);
    });

    it("keeps the list it had when the refetch fails", async () => {
      mockApi.on("get", PATH, [GDPR]);
      const { useComplianceRegulations } = await load();

      const { result } = renderHook(() => useComplianceRegulations());
      await waitFor(() => expect(result.current.regulations).toEqual([GDPR]));

      // A failed admin-side refresh must not empty every regulation picker
      // until the next successful fetch.
      mockApi.fail("get", PATH, 503);
      await act(async () => {
        await result.current.refresh();
      });
      expect(result.current.loaded).toBe(true);
      expect(result.current.regulations).toEqual([GDPR]);
      expect(mockApi.callsOf("get", PATH)).toHaveLength(2);
    });
  });
});
