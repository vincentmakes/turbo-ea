import { describe, expect, it } from "vitest";
import type { Relation } from "@/types";
import {
  RELATION_LIFECYCLE_CAP,
  groupRelationLifecycles,
  outlastsCard,
  stateCounts,
  visibleGroups,
  type LifecycleGroup,
  type LifecycleRow,
} from "./relationLifecycleRows";

const TODAY = Date.UTC(2026, 6, 1);
const CURRENT = { active: "2025-01-01", endOfLife: "2030-01-01" };
const PLANNED = { plan: "2026-01-01", active: "2028-01-01" };
const ENDED = { active: "2019-01-01", endOfLife: "2024-01-01" };

const USES = { key: "uses", source_type_key: "Application", target_type_key: "ITComponent" };
const OWNS = { key: "owns", source_type_key: "Organization", target_type_key: "Application" };
const FEEDS = { key: "feeds", source_type_key: "Application", target_type_key: "Application" };
const OTHER = { key: "other", source_type_key: "Organization", target_type_key: "ITComponent" };
const RUNS = { key: "runs", source_type_key: "Application", target_type_key: "Organization" };

let n = 0;
function rel(
  type: string,
  source: [string, string, string],
  target: [string, string, string],
  lifecycle?: Record<string, string>,
): Relation {
  n += 1;
  return {
    id: `r${n}`,
    type,
    source_id: source[0],
    target_id: target[0],
    source: { id: source[0], name: source[1], type: source[2] },
    target: { id: target[0], name: target[1], type: target[2] },
    lifecycle,
  };
}

const ME: [string, string, string] = ["me", "Me", "Application"];

describe("outlastsCard", () => {
  it("is false without a card End of Life", () => {
    expect(outlastsCard({ active: "2020-01-01" }, {})).toBe(false);
    expect(outlastsCard({ active: "2020-01-01" }, undefined)).toBe(false);
    expect(outlastsCard({}, { endOfLife: "not a date" })).toBe(false);
  });

  it("is true when the relation has no end, or ends after the card", () => {
    const card = { endOfLife: "2027-06-30" };
    expect(outlastsCard({ active: "2020-01-01" }, card)).toBe(true);
    expect(outlastsCard(undefined, card)).toBe(true);
    expect(outlastsCard({ endOfLife: "garbage" }, card)).toBe(true);
    expect(outlastsCard({ endOfLife: "2027-07-01" }, card)).toBe(true);
  });

  it("is false when the relation ends on or before the card's End of Life", () => {
    const card = { endOfLife: "2027-06-30" };
    expect(outlastsCard({ endOfLife: "2027-06-30" }, card)).toBe(false);
    expect(outlastsCard({ endOfLife: "2027-06-29" }, card)).toBe(false);
  });

  it("reads a relation end that is not a date as no end, even one starting with a digit", () => {
    // "1bad" would sort before the card's date as text; it must not be read as an end.
    expect(outlastsCard({ endOfLife: "1bad" }, { endOfLife: "2027-06-30" })).toBe(true);
    expect(outlastsCard({ endOfLife: "" }, { endOfLife: "2027-06-30" })).toBe(true);
  });

  it("compares the card's End of Life by its day as well", () => {
    const card = { endOfLife: "2027-06-30T09:00:00Z" };
    expect(outlastsCard({ endOfLife: "2027-06-30" }, card)).toBe(false);
    expect(outlastsCard({ endOfLife: "2027-07-01" }, card)).toBe(true);
  });

  it("compares the day only", () => {
    expect(outlastsCard({ endOfLife: "2027-06-30T23:00:00Z" }, { endOfLife: "2027-06-30" })).toBe(false);
  });
});

describe("groupRelationLifecycles", () => {
  const base = {
    cardId: "me",
    cardTypeKey: "Application",
    cardLifecycle: { endOfLife: "2029-01-01" },
    todayMs: TODAY,
    locale: "en",
  };

  it("groups dated relations per side, in the Relations section's order", () => {
    const zed = rel("uses", ME, ["z", "zed server", "ITComponent"], CURRENT);
    const alpha = rel("uses", ME, ["a", "Alpha server", "ITComponent"], PLANNED);
    const owner = rel("owns", ["o", "Owner Org", "Organization"], ME, ENDED);
    const runs = rel("runs", ME, ["o2", "Ops Org", "Organization"], CURRENT);
    const undated = rel("uses", ME, ["u", "Undated", "ITComponent"]);
    const empty = rel("uses", ME, ["e", "Empty", "ITComponent"], {});
    const groups = groupRelationLifecycles({
      ...base,
      relations: [zed, owner, undated, alpha, runs, empty],
      // `runs` joins `owns` next to it (same other end) though listed last.
      relationTypes: [OWNS, USES, OTHER, RUNS],
    });
    expect(groups.map((g) => [g.rt.key, g.isSource, g.rows.map((r) => r.relation.id)])).toEqual([
      ["owns", false, [owner.id]],
      ["runs", true, [runs.id]],
      ["uses", true, [alpha.id, zed.id]],
    ]);
    // The other card is the far end on each side.
    expect(groups[0].rows[0].other).toEqual(owner.source);
    expect(groups[2].rows[0].other).toEqual(alpha.target);
    expect(groups[2].rows.map((r) => r.state)).toEqual(["planned", "inEffect"]);
    expect(groups[0].rows[0].state).toBe("ended");
    // Ends 2030, after the card's 2029 End of Life.
    expect(groups[2].rows[1].outlasts).toBe(true);
    expect(groups[0].rows[0].outlasts).toBe(false);
  });

  it("splits a self-referencing type into its two sides, reading each row's direction", () => {
    const out = rel("feeds", ME, ["b", "Billing", "Application"], CURRENT);
    const inc = rel("feeds", ["c", "CRM", "Application"], ME, PLANNED);
    const groups = groupRelationLifecycles({ ...base, relations: [inc, out], relationTypes: [FEEDS] });
    expect(groups.map((g) => [g.isSource, g.rows.map((r) => r.other?.name)])).toEqual([
      [true, ["Billing"]],
      [false, ["CRM"]],
    ]);
  });

  it("leaves out relation types the card is not on and sides without dated rows", () => {
    const groups = groupRelationLifecycles({
      ...base,
      relations: [rel("uses", ME, ["u", "U", "ITComponent"])],
      relationTypes: [USES, OTHER],
    });
    expect(groups).toEqual([]);
  });

  it("sorts a missing far end first by its empty name", () => {
    const named = rel("uses", ME, ["x", "Box", "ITComponent"], CURRENT);
    const bare: Relation = { ...rel("uses", ME, ["y", "", "ITComponent"], CURRENT), target: undefined };
    const [g] = groupRelationLifecycles({ ...base, relations: [named, bare], relationTypes: [USES] });
    expect(g.rows.map((r) => r.relation.id)).toEqual([bare.id, named.id]);
    expect(g.rows[0].other).toBeUndefined();
    // Whichever side of the comparison the missing end lands on.
    const alpha = rel("uses", ME, ["w", "alpha", "ITComponent"], CURRENT);
    for (const order of [[named, alpha, bare], [bare, named, alpha], [alpha, bare, named]]) {
      const [h] = groupRelationLifecycles({ ...base, relations: order, relationTypes: [USES] });
      expect(h.rows.map((r) => r.relation.id)).toEqual([bare.id, alpha.id, named.id]);
    }
  });
});

function row(id: string, state: LifecycleRow["state"]): LifecycleRow {
  return {
    relation: { id, type: "t", source_id: "a", target_id: "b" },
    other: undefined,
    state,
    outlasts: false,
  };
}
const group = (key: string, rows: LifecycleRow[]): LifecycleGroup<{ key: string }> => ({
  rt: { key },
  isSource: true,
  rows,
});

describe("stateCounts", () => {
  it("counts every row by its state", () => {
    expect(
      stateCounts([
        group("a", [row("1", "inEffect"), row("2", "ended")]),
        group("b", [row("3", "planned"), row("4", "inEffect")]),
      ]),
    ).toEqual({ inEffect: 2, planned: 1, ended: 1 });
    expect(stateCounts([])).toEqual({ inEffect: 0, planned: 0, ended: 0 });
  });
});

describe("visibleGroups", () => {
  const ids = (gs: LifecycleGroup<{ key: string }>[]) => gs.map((g) => [g.rt.key, g.rows.map((r) => r.relation.id)]);

  it("drops ended rows, and a group left empty, unless ended ones are shown", () => {
    const groups = [group("a", [row("1", "ended")]), group("b", [row("2", "inEffect"), row("3", "ended")])];
    const hidden = visibleGroups(groups, { showEnded: false, showAll: false });
    expect(ids(hidden.groups)).toEqual([["b", ["2"]]]);
    expect(hidden).toMatchObject({ shownTotal: 1, hidden: 0 });
    const shown = visibleGroups(groups, { showEnded: true, showAll: false });
    expect(ids(shown.groups)).toEqual([
      ["a", ["1"]],
      ["b", ["2", "3"]],
    ]);
    expect(shown.shownTotal).toBe(3);
  });

  it("caps the rows across groups in order, and lifts the cap on Show all", () => {
    const groups = [
      group("a", [row("1", "inEffect"), row("2", "inEffect")]),
      group("b", [row("3", "planned"), row("4", "planned")]),
      group("c", [row("5", "inEffect")]),
    ];
    const capped = visibleGroups(groups, { showEnded: false, showAll: false, cap: 3 });
    expect(ids(capped.groups)).toEqual([
      ["a", ["1", "2"]],
      ["b", ["3"]],
    ]);
    expect(capped).toMatchObject({ shownTotal: 5, hidden: 2 });
    const all = visibleGroups(groups, { showEnded: false, showAll: true, cap: 3 });
    expect(ids(all.groups)).toHaveLength(3);
    expect(all).toMatchObject({ shownTotal: 5, hidden: 0 });
    // Exactly at the cap nothing is held back.
    expect(visibleGroups(groups, { showEnded: false, showAll: false, cap: 5 }).hidden).toBe(0);
    // The cap ends exactly on a group boundary: the next group is not started.
    expect(ids(visibleGroups(groups, { showEnded: false, showAll: false, cap: 2 }).groups)).toEqual([
      ["a", ["1", "2"]],
    ]);
  });

  it("caps at eight by default", () => {
    expect(RELATION_LIFECYCLE_CAP).toBe(8);
    const rows = Array.from({ length: 9 }, (_, i) => row(String(i), "inEffect"));
    const out = visibleGroups([group("a", rows)], { showEnded: false, showAll: false });
    expect(out.groups[0].rows).toHaveLength(8);
    expect(out.hidden).toBe(1);
    expect(visibleGroups([group("a", rows.slice(0, 8))], { showEnded: false, showAll: false }).hidden).toBe(0);
  });
});
