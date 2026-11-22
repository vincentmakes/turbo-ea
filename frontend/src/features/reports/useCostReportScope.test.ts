import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import { useCostReportScope } from "./useCostReportScope";

vi.mock("@/api/client", () => ({ api: { get: vi.fn() } }));

const nodes = [
  { id: "app", name: "App", type: "Application", parent_id: null, alias: null },
  { id: "child", name: "Child", type: "Application", parent_id: "app", alias: null },
  { id: "it", name: "IT", type: "ITComponent", parent_id: null, alias: null },
];

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.get).mockResolvedValue({ items: nodes, total: nodes.length } as never);
});

describe("useCostReportScope", () => {
  it("rejects overlapping pages instead of accepting an incomplete hierarchy", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ items: [nodes[0], nodes[1]], total: 3 } as never)
      .mockResolvedValueOnce({ items: [nodes[1]], total: 3 } as never);
    const { result } = renderHook(() => useCostReportScope(["Application"]));
    act(() => result.current.restore(["app"]));
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.closure).toBeNull();
  });

  it("reloads and blocks when a newly selected root was absent from the hierarchy", async () => {
    let resolveNext!: (value: unknown) => void;
    vi.mocked(api.get)
      .mockResolvedValueOnce({ items: nodes, total: nodes.length } as never)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNext = resolve;
          }) as never,
      );
    const { result } = renderHook(() => useCostReportScope(["Application"]));
    act(() => result.current.restore(["app"]));
    await waitFor(() => expect(result.current.closure).toEqual(new Set(["app", "child"])));
    act(() => result.current.setScopeIds(["new"]));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(resolveNext).toBeDefined());
    await act(async () =>
      resolveNext({
        items: [...nodes, { id: "new", name: "New", type: "Application", parent_id: null }],
        total: 4,
      }),
    );
    await waitFor(() => expect(result.current.closure).toEqual(new Set(["new"])));
  });

  it("retains hidden roots when clearing the active type and resets both", async () => {
    const { result, rerender } = renderHook(({ types }) => useCostReportScope(types), {
      initialProps: { types: ["Application", "ITComponent"] },
    });
    act(() => result.current.restore(["app", "it"]));
    await waitFor(() => expect(result.current.closure).toEqual(new Set(["app", "child", "it"])));
    rerender({ types: ["Application"] });
    expect(result.current.effectiveScopeIds).toEqual(["app"]);
    act(() => result.current.setScopeIds([]));
    expect(result.current.scopeIds).toEqual(["it"]);
    rerender({ types: ["ITComponent"] });
    expect(result.current.closure).toEqual(new Set(["it"]));
    act(() => result.current.clear());
    expect(result.current.scopeIds).toEqual([]);
  });

  it("restores a single root when both types are active", async () => {
    const { result } = renderHook(() => useCostReportScope(["Application", "ITComponent"]));
    act(() => result.current.restore(["app"]));
    await waitFor(() => expect(result.current.closure).toEqual(new Set(["app", "child"])));
  });
});
