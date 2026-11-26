import { describe, it, expect } from "vitest";
import { edgesAtDate } from "./dependencyEdgesAtDate";
import type { GEdge } from "./layeredDependencyLayout";

const ms = (iso: string) => new Date(iso).getTime();
const AT = ms("2027-06-01");
const ALL = new Set(["org", "app", "itc"]);
const both = { persistRetired: true, previewPlanned: true };
const neither = { persistRetired: false, previewPlanned: false };

const edge = (target: string, lifecycle?: Record<string, string>): GEdge => ({
  source: "org",
  target,
  type: "relOrgToApp",
  ...(lifecycle ? { lifecycle } : {}),
});
const undated = edge("app");
const current = edge("app", { active: "2027-01-01", endOfLife: "2028-01-01" });
const planned = edge("app", { plan: "2026-01-01", active: "2027-06-02" });
const ended = edge("app", { active: "2020-01-01", endOfLife: "2027-06-01" });

describe("edgesAtDate", () => {
  it("passes an undated relation through as the same object", () => {
    const out = edgesAtDate([undated], ALL, AT, neither);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(undated);
  });

  it("draws a relation in effect plainly, with no state", () => {
    const [out] = edgesAtDate([current], ALL, AT, neither);
    expect(out).toBe(current);
    expect(out.relationState).toBeUndefined();
  });

  it("drops a planned relation unless planned cards are previewed", () => {
    expect(edgesAtDate([planned], ALL, AT, { ...both, previewPlanned: false })).toEqual([]);
    const [out] = edgesAtDate([planned], ALL, AT, { ...neither, previewPlanned: true });
    expect(out.relationState).toBe("planned");
    expect(out.target).toBe("app");
  });

  it("drops an ended relation unless retired cards are kept", () => {
    expect(edgesAtDate([ended], ALL, AT, { ...both, persistRetired: false })).toEqual([]);
    const [out] = edgesAtDate([ended], ALL, AT, { ...neither, persistRetired: true });
    expect(out.relationState).toBe("ended");
  });

  it("drops a relation whose card is not on the graph, whatever its dates", () => {
    const only = new Set(["org"]);
    expect(edgesAtDate([undated, current], only, AT, both)).toEqual([]);
    expect(edgesAtDate([edge("itc")], new Set(["itc"]), AT, both)).toEqual([]);
  });

  it("keeps a relation ending at the mark the slider stands on", () => {
    const mark = { from: ms("2027-06-01"), to: ms("2027-06-01") };
    const [out] = edgesAtDate([ended], ALL, AT, neither, mark);
    expect(out.relationState).toBe("ended");
    // A relation that ended before the mark stays dropped.
    const earlier = edge("app", { endOfLife: "2027-05-31" });
    expect(edgesAtDate([earlier], ALL, AT, neither, mark)).toEqual([]);
    // Ending after the mark's span is not ending at it.
    const later = { from: ms("2027-05-01"), to: ms("2027-05-31") };
    expect(edgesAtDate([ended], ALL, AT, neither, later)).toEqual([]);
    // A planned relation is never kept by a mark, even one whose end falls in it.
    expect(edgesAtDate([planned], ALL, AT, neither, { from: 0, to: ms("2030-01-01") })).toEqual(
      [],
    );
    const plannedToEnd = edge("app", { active: "2027-06-02", endOfLife: "2028-01-01" });
    expect(
      edgesAtDate([plannedToEnd], ALL, AT, neither, { from: 0, to: ms("2030-01-01") }),
    ).toEqual([]);
  });
});
