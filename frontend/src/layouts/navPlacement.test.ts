/**
 * Where a contributed nav entry lands.
 *
 * The frontend half of the placement grammar core already uses for manifest
 * field sections, so the two must agree on the edge cases — above all on what
 * happens when the named anchor is not there.
 */
import { describe, expect, it } from "vitest";
import { NAV_ANCHORS, resolveNavPlacement } from "./navItems";

// The bar as it stands with every module on.
const FULL = ["dashboard", "inventory", "reports", "bpm", "ppm", "diagrams", "grc", "todos"];

describe("resolveNavPlacement", () => {
  it("defaults to the end, which is what every extension had before this existed", () => {
    expect(resolveNavPlacement(FULL, undefined)).toBe(FULL.length);
    expect(resolveNavPlacement(FULL, null)).toBe(FULL.length);
    expect(resolveNavPlacement(FULL, "")).toBe(FULL.length);
    expect(resolveNavPlacement(FULL, "end")).toBe(FULL.length);
  });

  it("places before and after a named anchor", () => {
    expect(resolveNavPlacement(FULL, "before:todos")).toBe(FULL.indexOf("todos"));
    expect(resolveNavPlacement(FULL, "after:todos")).toBe(FULL.indexOf("todos") + 1);
    expect(resolveNavPlacement(FULL, "before:dashboard")).toBe(0);
    expect(resolveNavPlacement(FULL, "start")).toBe(0);
  });

  it("degrades to the default when a module has taken the anchor off the bar", () => {
    // `bpm`, `ppm` and `grc` come and go with their flags, so a placement
    // naming one is right on some instances and unresolvable on others. The
    // entry still appears — it just appears where it would have anyway.
    const noPpm = FULL.filter((key) => key !== "ppm");
    expect(resolveNavPlacement(noPpm, "before:ppm")).toBe(noPpm.length);
    // ...and the anchor still works on an instance that has it.
    expect(resolveNavPlacement(FULL, "before:ppm")).toBe(FULL.indexOf("ppm"));
  });

  it("degrades on an unresolvable ANCHOR rather than throwing", () => {
    for (const spec of ["nonsense", "before:", "before:nope"]) {
      expect(resolveNavPlacement(FULL, spec)).toBe(FULL.length);
    }
  });

  it("treats any prefix that is not `after` as `before`, exactly as the backend does", () => {
    // `resolve_placement` in field_contributions.py reads the prefix as
    // `after` or not-after, so ":todos" and "sideways:todos" both land before
    // the anchor. Mirrored rather than tightened on purpose: the value of one
    // grammar across the product is that learning it once is enough, and a
    // frontend that rejected what the backend accepts would be a second
    // grammar wearing the first one's syntax.
    expect(resolveNavPlacement(FULL, ":todos")).toBe(FULL.indexOf("todos"));
    expect(resolveNavPlacement(FULL, "sideways:todos")).toBe(FULL.indexOf("todos"));
  });

  it("keeps registration order for two entries sharing one placement", () => {
    // AppLayout recomputes the index per route against the list as it stands,
    // so inserting twice at `before:todos` must not reverse the pair.
    let order = [...FULL];
    for (const key of ["first", "second"]) {
      const at = resolveNavPlacement(order, "before:todos");
      order = [...order.slice(0, at), key, ...order.slice(at)];
    }
    expect(order.slice(order.indexOf("grc") + 1)).toEqual(["first", "second", "todos"]);
  });

  it("exposes the anchors it accepts, so an author can be told what is valid", () => {
    expect(NAV_ANCHORS).toContain("todos");
    expect(NAV_ANCHORS).toContain("dashboard");
    // Anchors are the core keys only — an extension's own label is not one.
    expect(NAV_ANCHORS.every((key) => typeof key === "string" && key.length > 0)).toBe(true);
  });
});
