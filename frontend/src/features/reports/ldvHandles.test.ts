import { describe, it, expect } from "vitest";
import {
  handleAnchor,
  LDV_HANDLE_SPECS,
  LDV_HANDLE_FRACTIONS,
  LDV_NODE_W,
  LDV_NODE_H,
  handleOffset,
} from "./ldvHandles";

describe("LDV handle geometry", () => {
  it("declares 24 handles with unique ids", () => {
    expect(LDV_HANDLE_SPECS).toHaveLength(24);
    const ids = new Set(LDV_HANDLE_SPECS.map((s) => s.id));
    expect(ids.size).toBe(24);
  });

  it("keeps the slot fractions symmetric around the center", () => {
    for (const frac of LDV_HANDLE_FRACTIONS) {
      expect(LDV_HANDLE_FRACTIONS).toContain(Math.round((1 - frac) * 100) / 100);
    }
  });

  it("mirror handles share the position of their base handle", () => {
    // ts-N sits exactly where t-N sits, bt-N where b-N sits — mirrors only
    // exist so React Flow sees the right source/target type on a flipped edge.
    for (let i = 1; i <= 5; i++) {
      expect(handleOffset(`ts-${i}`)).toEqual(handleOffset(`t-${i}`));
      expect(handleOffset(`bt-${i}`)).toEqual(handleOffset(`b-${i}`));
    }
    expect(handleOffset("left-src")).toEqual(handleOffset("left"));
    expect(handleOffset("right-tgt")).toEqual(handleOffset("right"));
  });

  it("derives offsets from the declared fraction and node size", () => {
    // b-1 sits at 12% of the width on the bottom border.
    expect(handleOffset("b-1")).toEqual({ dx: (0.12 - 0.5) * LDV_NODE_W, dy: LDV_NODE_H / 2 });
    expect(handleOffset("t-3")).toEqual({ dx: 0, dy: -LDV_NODE_H / 2 });
    expect(handleOffset("left")).toEqual({ dx: -LDV_NODE_W / 2, dy: 0 });
    expect(handleOffset("right")).toEqual({ dx: LDV_NODE_W / 2, dy: 0 });
  });

  it("returns a center offset for unknown ids", () => {
    expect(handleOffset("nope")).toEqual({ dx: 0, dy: 0 });
  });

  it("every spec id resolves through handleOffset to its own side", () => {
    for (const spec of LDV_HANDLE_SPECS) {
      const { dx, dy } = handleOffset(spec.id);
      if (spec.side === "top") expect(dy).toBe(-LDV_NODE_H / 2);
      if (spec.side === "bottom") expect(dy).toBe(LDV_NODE_H / 2);
      if (spec.side === "left") expect(dx).toBe(-LDV_NODE_W / 2);
      if (spec.side === "right") expect(dx).toBe(LDV_NODE_W / 2);
    }
  });

  it("maps every handle to a fractional anchor on the card's box", () => {
    // The generated DrawIO diagram attaches its edges with these fractions,
    // so they must agree with the pixel offsets the view routes against.
    for (const spec of LDV_HANDLE_SPECS) {
      const a = handleAnchor(spec.id)!;
      expect(a).not.toBeNull();
      const { dx, dy } = handleOffset(spec.id);
      expect((a.x - 0.5) * LDV_NODE_W).toBeCloseTo(dx, 6);
      expect((a.y - 0.5) * LDV_NODE_H).toBeCloseTo(dy, 6);
    }
  });

  it("returns null for an unknown handle", () => {
    expect(handleAnchor("nope")).toBeNull();
  });
});
