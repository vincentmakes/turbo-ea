import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { Card } from "@/types";

vi.mock("@/api/cardsByIds", () => ({ fetchCardsByIdsDetailed: vi.fn() }));

import { fetchCardsByIdsDetailed } from "@/api/cardsByIds";
import { useCardNames } from "./useCardNames";

const fetchMock = vi.mocked(fetchCardsByIdsDetailed);

const card = (id: string, name: string, type = "Application") => ({ id, name, type }) as Card;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("useCardNames", () => {
  it("fetches nothing for no ids", async () => {
    const { result } = renderHook(() => useCardNames([]));
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.size).toBe(0);
  });

  it("fetches the deduped set once and classifies cards, withheld and missing ids", async () => {
    fetchMock.mockResolvedValue({
      cards: [card("a", "Alpha"), card("b", "Beta", "Organization")],
      withheldIds: ["h"],
    });
    const { result } = renderHook(() => useCardNames(["b", "a", "h", "u", "a"]));
    await waitFor(() => expect(result.current.size).toBe(4));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toEqual(["a", "b", "h", "u"]);
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    expect(Object.fromEntries(result.current)).toEqual({
      a: { kind: "card", name: "Alpha", type: "Application" },
      b: { kind: "card", name: "Beta", type: "Organization" },
      h: { kind: "hidden" },
      u: { kind: "unknown" },
    });
  });

  it("does not refetch for the same set in another order", async () => {
    fetchMock.mockResolvedValue({ cards: [card("a", "Alpha"), card("b", "Beta")], withheldIds: [] });
    const { result, rerender } = renderHook(({ ids }) => useCardNames(ids), {
      initialProps: { ids: ["a", "b"] },
    });
    await waitFor(() => expect(result.current.size).toBe(2));
    const first = result.current;
    rerender({ ids: ["b", "a"] });
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(first);
  });

  it("fetches only the ids it has not resolved before, and drops ids no longer asked for", async () => {
    fetchMock.mockResolvedValueOnce({ cards: [card("a", "Alpha")], withheldIds: [] });
    const { result, rerender } = renderHook(({ ids }) => useCardNames(ids), {
      initialProps: { ids: ["a"] },
    });
    await waitFor(() => expect(result.current.get("a")).toBeDefined());
    fetchMock.mockResolvedValueOnce({ cards: [card("c", "Gamma")], withheldIds: [] });
    rerender({ ids: ["a", "c"] });
    await waitFor(() => expect(result.current.get("c")).toBeDefined());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toEqual(["c"]);
    expect(result.current.get("a")).toEqual({ kind: "card", name: "Alpha", type: "Application" });

    rerender({ ids: ["c"] });
    expect([...result.current.keys()]).toEqual(["c"]);
    rerender({ ids: ["a"] });
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect([...result.current.keys()]).toEqual(["a"]);
  });

  it("leaves the ids absent when the fetch fails", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useCardNames(["a"]));
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.size).toBe(0);
  });

  it("ignores a response that lands after a newer set was asked for", async () => {
    const slow = deferred<{ cards: Card[]; withheldIds: string[] }>();
    fetchMock.mockReturnValueOnce(slow.promise);
    fetchMock.mockResolvedValueOnce({ cards: [card("b", "Beta")], withheldIds: [] });
    const { result, rerender } = renderHook(({ ids }) => useCardNames(ids), {
      initialProps: { ids: ["a"] },
    });
    const firstSignal = fetchMock.mock.calls[0][1]!.signal!;
    rerender({ ids: ["b"] });
    expect(firstSignal.aborted).toBe(true);
    await waitFor(() => expect(result.current.get("b")).toBeDefined());
    await act(async () => slow.resolve({ cards: [card("a", "Alpha")], withheldIds: [] }));
    // The superseded answer wrote nothing: "a" is still unresolved and is fetched again.
    fetchMock.mockResolvedValueOnce({ cards: [card("a", "Alpha 2")], withheldIds: [] });
    rerender({ ids: ["a"] });
    await waitFor(() => expect(result.current.get("a")).toBeDefined());
    expect(result.current.get("a")).toEqual({ kind: "card", name: "Alpha 2", type: "Application" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toEqual(["a"]);
  });

  it("aborts on unmount and writes nothing afterwards", async () => {
    const slow = deferred<{ cards: Card[]; withheldIds: string[] }>();
    fetchMock.mockReturnValueOnce(slow.promise);
    const errors = vi.spyOn(console, "error");
    const { unmount } = renderHook(() => useCardNames(["a"]));
    const signal = fetchMock.mock.calls[0][1]!.signal!;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => slow.resolve({ cards: [card("a", "Alpha")], withheldIds: [] }));
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
