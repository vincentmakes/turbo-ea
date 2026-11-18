import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { api } from "@/api/client";
import { mockApi } from "@/test/apiMock";
import type { LicenseMetricItem } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

const PATH = "/metamodel/license-metrics";
const metric = (key: string): LicenseMetricItem => ({
  id: key,
  key,
  label: key,
  sort_order: 0,
  archived: false,
  translations: {},
  types: [],
});

// The hook keeps a process-wide cache, so each test starts from a fresh module.
async function load() {
  vi.resetModules();
  expect(api).toBe(mockApi.api);
  return import("./useLicenseCatalogue");
}

beforeEach(() => {
  mockApi.reset();
});

describe("useLicenseCatalogue", () => {
  it("loads the catalogue once for every consumer", async () => {
    mockApi.on("get", PATH, [metric("users")]);
    const { useLicenseCatalogue } = await load();
    const a = renderHook(() => useLicenseCatalogue());
    const b = renderHook(() => useLicenseCatalogue());
    expect(a.result.current.loading).toBe(true);
    await waitFor(() => expect(a.result.current.metrics.map((m) => m.key)).toEqual(["users"]));
    await waitFor(() => expect(b.result.current.loading).toBe(false));
    expect(mockApi.callsOf("get", PATH)).toHaveLength(1);
    renderHook(() => useLicenseCatalogue());
    expect(mockApi.callsOf("get", PATH)).toHaveLength(1);
  });

  it("does not fetch while disabled", async () => {
    mockApi.on("get", PATH, [metric("users")]);
    const { useLicenseCatalogue } = await load();
    const a = renderHook(() => useLicenseCatalogue(false));
    expect(a.result.current.loading).toBe(true);
    expect(mockApi.callsOf("get", PATH)).toHaveLength(0);
  });

  it("reloads and tells every consumer when invalidated", async () => {
    mockApi.on("get", PATH, [metric("users")]);
    const { useLicenseCatalogue, invalidateLicenseCatalogue } = await load();
    const a = renderHook(() => useLicenseCatalogue());
    await waitFor(() => expect(a.result.current.loading).toBe(false));
    mockApi.on("get", PATH, [metric("users"), metric("cores")]);
    await act(async () => {
      await invalidateLicenseCatalogue();
    });
    expect(a.result.current.metrics.map((m) => m.key)).toEqual(["users", "cores"]);
    expect(mockApi.callsOf("get", PATH)).toHaveLength(2);
  });

  it("reload() from a consumer refetches", async () => {
    mockApi.on("get", PATH, [metric("users")]);
    const { useLicenseCatalogue } = await load();
    const a = renderHook(() => useLicenseCatalogue());
    await waitFor(() => expect(a.result.current.loading).toBe(false));
    await act(async () => a.result.current.reload());
    await waitFor(() => expect(mockApi.callsOf("get", PATH)).toHaveLength(2));
  });

  it("settles with an empty list when the request fails", async () => {
    mockApi.fail("get", PATH, 500);
    const { useLicenseCatalogue } = await load();
    const a = renderHook(() => useLicenseCatalogue());
    await waitFor(() => expect(a.result.current.loading).toBe(false));
    expect(a.result.current.metrics).toEqual([]);
  });
});
