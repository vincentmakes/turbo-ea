/**
 * The breakdown is fetched on first interest, kept for the score it was
 * fetched at, and dropped (then fetched afresh) when the score moves.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class extends Error {},
  isAbortError: () => false,
}));

import { api } from "@/api/client";
import type { DataQualityBreakdown, DataQualityFactor } from "@/types";
import { useDataQualityBreakdown } from "./useDataQualityBreakdown";

const f = (key: string, filled: boolean, gain: number | null): DataQualityFactor => ({
  kind: "field",
  key,
  weight: 1,
  filled,
  gain,
  score_if_filled: null,
});

const BREAKDOWN: DataQualityBreakdown = {
  score: 0,
  ungated_score: 50,
  total_weight: 4,
  filled_weight: 1,
  blocked_by_required: ["code"],
  factors: [f("team", true, null), f("cost", false, 30), f("code", false, 10), f("notes", false, 20)],
};

const URL = "/cards/c1/data-quality";

type Props = { cardId?: string; active: boolean; value: number };

function setup(initial: Props) {
  return renderHook((p: Props) => useDataQualityBreakdown(p.cardId, p.active, p.value), {
    initialProps: initial,
  });
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.get).mockResolvedValue(BREAKDOWN);
});

describe("useDataQualityBreakdown", () => {
  it("fetches nothing until someone looks", () => {
    const { result } = setup({ cardId: "c1", active: false, value: 40 });
    expect(api.get).not.toHaveBeenCalled();
    expect(result.current).toEqual({
      data: undefined,
      loading: false,
      error: null,
      blocked: [],
      unmet: [],
      met: [],
    });
  });

  it("never fetches without a card", () => {
    const { result } = setup({ active: true, value: 40 });
    expect(api.get).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it("fetches once on activation and ranks the slots, gating fields first", async () => {
    const { result } = setup({ cardId: "c1", active: true, value: 40 });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data).toBe(BREAKDOWN));
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.get).mock.calls[0][0]).toBe(URL);
    expect(result.current.loading).toBe(false);
    expect(result.current.blocked).toEqual(["code"]);
    expect(result.current.unmet.map((x) => x.key)).toEqual(["code", "cost", "notes"]);
    expect(result.current.met.map((x) => x.key)).toEqual(["team"]);
  });

  it("keeps the breakdown when nobody is looking any more, without refetching", async () => {
    const { result, rerender } = setup({ cardId: "c1", active: true, value: 40 });
    await waitFor(() => expect(result.current.data).toBe(BREAKDOWN));
    rerender({ cardId: "c1", active: false, value: 40 });
    rerender({ cardId: "c1", active: true, value: 40 });
    expect(result.current.data).toBe(BREAKDOWN);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("drops the breakdown when the score moves, and refetches on the next look", async () => {
    const { result, rerender } = setup({ cardId: "c1", active: true, value: 40 });
    await waitFor(() => expect(result.current.data).toBe(BREAKDOWN));
    rerender({ cardId: "c1", active: false, value: 55 });
    // The stale breakdown is gone at once …
    expect(result.current.data).toBeUndefined();
    expect(result.current.unmet).toEqual([]);
    expect(result.current.blocked).toEqual([]);
    expect(api.get).toHaveBeenCalledTimes(1);
    // … and the fresh one is fetched when someone looks again.
    const fresh = { ...BREAKDOWN, blocked_by_required: [] };
    vi.mocked(api.get).mockResolvedValue(fresh);
    rerender({ cardId: "c1", active: true, value: 55 });
    await waitFor(() => expect(result.current.data).toBe(fresh));
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.get).mock.calls[1][0]).toBe(URL);
  });

  it("refetches straight away when the score moves while someone is looking", async () => {
    const { result, rerender } = setup({ cardId: "c1", active: true, value: 40 });
    await waitFor(() => expect(result.current.data).toBe(BREAKDOWN));
    const fresh = { ...BREAKDOWN, score: 55 };
    let resolve: (v: DataQualityBreakdown) => void = () => {};
    vi.mocked(api.get).mockReturnValue(new Promise((r) => (resolve = r)));
    rerender({ cardId: "c1", active: true, value: 55 });
    // The old score's breakdown does not stand in while the new one loads.
    expect(result.current.data).toBeUndefined();
    expect(result.current.loading).toBe(true);
    resolve(fresh);
    await waitFor(() => expect(result.current.data).toBe(fresh));
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("reports a failed fetch", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("boom"));
    const { result } = setup({ cardId: "c1", active: true, value: 40 });
    await waitFor(() => expect(result.current.error?.message).toBe("boom"));
    expect(result.current.data).toBeUndefined();
    expect(result.current.loading).toBe(false);
  });

  it("forgets a failure once the score moves", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("boom"));
    const { result, rerender } = setup({ cardId: "c1", active: true, value: 40 });
    await waitFor(() => expect(result.current.error?.message).toBe("boom"));
    rerender({ cardId: "c1", active: false, value: 55 });
    expect(result.current.error).toBeNull();
  });
});
