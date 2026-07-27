import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
}));

import { api } from "@/api/client";
import { useCardSearch } from "./useCardSearch";

function page(items: { id: string; name: string; type: string }[], total: number) {
  return { items, total, page: 1, page_size: 1000 };
}

describe("useCardSearch", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it("does not fetch when disabled", () => {
    renderHook(() =>
      useCardSearch({ types: ["Application"], search: "", enabled: false }),
    );
    expect(api.get).not.toHaveBeenCalled();
  });

  it("sends comma-separated types when more than one is selected", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(page([], 0));

    renderHook(() =>
      useCardSearch({
        types: ["Application", "DataObject"],
        search: "",
        enabled: true,
      }),
    );

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledTimes(1);
    });
    const url = vi.mocked(api.get).mock.calls[0][0] as string;
    // Sort order is stable inside the hook (alphabetical) so we can assert directly.
    expect(url).toContain("type=Application%2CDataObject");
    expect(url).toContain("page=1");
    expect(url).toContain("page_size=1000");
  });

  it("appends a second page on loadMore and exposes hasMore correctly", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce(
        page([{ id: "1", name: "A", type: "Application" }], 2),
      )
      .mockResolvedValueOnce(
        page([{ id: "2", name: "B", type: "Application" }], 2),
      );

    const { result } = renderHook(() =>
      useCardSearch({ types: ["Application"], search: "", enabled: true }),
    );

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.hasMore).toBe(true);
    expect(result.current.total).toBe(2);

    act(() => {
      result.current.loadMore();
    });

    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.hasMore).toBe(false);
    expect(result.current.items.map((c) => c.id)).toEqual(["1", "2"]);
  });

  it("resets and refetches when the type filter changes", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce(
        page([{ id: "1", name: "A", type: "Application" }], 1),
      )
      .mockResolvedValueOnce(
        page([{ id: "9", name: "Z", type: "DataObject" }], 1),
      );

    const { result, rerender } = renderHook(
      ({ types }: { types: string[] }) =>
        useCardSearch({ types, search: "", enabled: true }),
      { initialProps: { types: ["Application"] } },
    );

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0].id).toBe("1");

    rerender({ types: ["DataObject"] });

    await waitFor(() => expect(result.current.items[0]?.id).toBe("9"));
    expect(result.current.items).toHaveLength(1);
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("dedups overlapping ids when paginated results shift", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce(
        page(
          [
            { id: "1", name: "A", type: "Application" },
            { id: "2", name: "B", type: "Application" },
          ],
          3,
        ),
      )
      // Backend returns id=2 again (a card was inserted between page 1 and 2).
      .mockResolvedValueOnce(
        page(
          [
            { id: "2", name: "B", type: "Application" },
            { id: "3", name: "C", type: "Application" },
          ],
          3,
        ),
      );

    const { result } = renderHook(() =>
      useCardSearch({ types: ["Application"], search: "", enabled: true }),
    );

    await waitFor(() => expect(result.current.items).toHaveLength(2));

    act(() => {
      result.current.loadMore();
    });

    await waitFor(() => expect(result.current.items).toHaveLength(3));
    expect(result.current.items.map((c) => c.id)).toEqual(["1", "2", "3"]);
  });
});

describe("useCardSearch superseding", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it("refetches when the query changes mid-flight instead of dropping it", async () => {
    // The in-flight guard used to drop the new query outright and never retry,
    // so the picker kept showing results for the query the user had already
    // replaced. This backs CardPicker, VendorField and the diagram card
    // sidebar, so it was reachable from nearly every picker in the app.
    let releaseFirst: (v: unknown) => void = () => {};
    const first = new Promise((r) => {
      releaseFirst = r;
    });
    vi.mocked(api.get)
      .mockImplementationOnce(() => first as Promise<never>)
      .mockResolvedValue(page([{ id: "b", name: "Beta", type: "Application" }], 1));

    const { result, rerender } = renderHook(
      ({ search }) => useCardSearch({ types: ["Application"], search, enabled: true }),
      { initialProps: { search: "al" } },
    );
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));

    rerender({ search: "beta" });

    // The second query must actually be issued, not swallowed.
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.get).mock.calls[1][0]).toContain("search=beta");
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0].name).toBe("Beta");

    // The superseded response landing last must not replace the fresh results.
    await act(async () => {
      releaseFirst(page([{ id: "a", name: "Alpha", type: "Application" }], 1));
      await first;
    });
    expect(result.current.items[0].name).toBe("Beta");
    expect(result.current.loading).toBe(false);
  });
});
