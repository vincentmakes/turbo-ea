/**
 * Line labels wrap instead of being cut off: the verb on one line, its
 * attribute values on the next, never past three lines.
 */
import { describe, expect, it } from "vitest";
import {
  EDGE_LABEL_LINE_CHARS,
  MAX_EDGE_LABEL_LINES,
  edgeLabelRouteWidth,
  longestEdgeLabelLine,
  wrapEdgeLabel,
} from "./ldvEdgeLabel";

describe("wrapEdgeLabel", () => {
  it("draws nothing for no label", () => {
    expect(wrapEdgeLabel("")).toEqual([]);
  });

  it("keeps a label that fits one line whole", () => {
    expect(EDGE_LABEL_LINE_CHARS).toBe(34);
    expect(wrapEdgeLabel("uses")).toEqual(["uses"]);
    expect(wrapEdgeLabel("uses [Read]")).toEqual(["uses [Read]"]);
    const exact = "is supported by [Create · Read]xyz";
    expect(exact).toHaveLength(34);
    expect(wrapEdgeLabel(exact)).toEqual([exact]);
  });

  it("puts the attribute values on their own line once the label is too long", () => {
    expect(wrapEdgeLabel("is supported by [Create · Read · Update · Delete]")).toEqual([
      "is supported by",
      "[Create · Read · Update · Delete]",
    ]);
    expect(wrapEdgeLabel("CRUD [Create · Read · Update · Delete]")).toEqual([
      "CRUD",
      "[Create · Read · Update · Delete]",
    ]);
  });

  it("wraps a long part at spaces, keeping a separator at the end of its line", () => {
    expect(wrapEdgeLabel("uses [Create · Read · Update · Delete · Archive]")).toEqual([
      "uses",
      "[Create · Read · Update · Delete ·",
      "Archive]",
    ]);
  });

  it("never starts a line with a separator: it stays with the value before it", () => {
    const a = "a".repeat(15);
    const b = "b".repeat(17);
    // "a… b…" fills 33 of 34 characters; " ·" would not fit after it, so the
    // value it follows moves down with it instead of leaving "·" to open a line.
    expect(wrapEdgeLabel(`${a} ${b} · c`)).toEqual([a, `${b} · c`]);
  });

  it("wraps a long verb with no values at spaces", () => {
    expect(
      wrapEdgeLabel("is the strategic platform supporting the core business processes"),
    ).toEqual(["is the strategic platform", "supporting the core business", "processes"]);
  });

  it("keeps a separator that opens the label as a word of its own", () => {
    const a = "a".repeat(20);
    const b = "b".repeat(20);
    expect(wrapEdgeLabel(`· ${a} ${b}`)).toEqual([`· ${a}`, b]);
  });

  it("ignores runs of spaces", () => {
    expect(wrapEdgeLabel("is  supported by [Create · Read · Update]")).toEqual([
      "is supported by",
      "[Create · Read · Update]",
    ]);
  });

  it("splits a word longer than a line", () => {
    const long = "x".repeat(40);
    expect(wrapEdgeLabel(`uses [${long}]`)).toEqual([
      "uses",
      `[${"x".repeat(33)}`,
      `${"x".repeat(7)}]`,
    ]);
    expect(wrapEdgeLabel(`ab ${long}`)).toEqual(["ab", "x".repeat(34), "x".repeat(6)]);
  });

  it("splits a word of exactly two lines into two lines, with no empty third", () => {
    expect(wrapEdgeLabel("x".repeat(68))).toEqual(["x".repeat(34), "x".repeat(34)]);
    expect(wrapEdgeLabel(`${"x".repeat(68)} y`)).toEqual(["x".repeat(34), "x".repeat(34), "y"]);
  });

  it("draws no line for a part that is only spaces", () => {
    // The verb before " [" is blank: only the values are drawn.
    expect(wrapEdgeLabel(`  [${"a".repeat(40)}]`)).toEqual([`[${"a".repeat(33)}`, `${"a".repeat(7)}]`]);
  });

  it("stops at three lines, the last ending in an ellipsis", () => {
    expect(MAX_EDGE_LABEL_LINES).toBe(3);
    const w = (c: string) => c.repeat(15);
    const lines = wrapEdgeLabel([w("a"), w("b"), w("c"), w("d"), w("e"), w("f"), w("g")].join(" "));
    expect(lines).toEqual([`${w("a")} ${w("b")}`, `${w("c")} ${w("d")}`, `${w("e")} ${w("f")}…`]);
  });

  it("keeps an ellipsised line within the line length", () => {
    const full = (c: string) => c.repeat(34);
    const lines = wrapEdgeLabel([full("a"), full("b"), full("c"), full("d")].join(" "));
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe(`${"c".repeat(33)}…`);
  });

  it("lets three lines through untouched", () => {
    const w = (c: string) => c.repeat(15);
    const lines = wrapEdgeLabel([w("a"), w("b"), w("c"), w("d"), w("e"), w("f")].join(" "));
    expect(lines[2]).toBe(`${w("e")} ${w("f")}`);
  });
});

describe("longestEdgeLabelLine", () => {
  it("measures the longest line once wrapped, not the whole label", () => {
    expect(longestEdgeLabelLine("")).toBe(0);
    expect(longestEdgeLabelLine("uses")).toBe(4);
    // "is supported by" (15) over "[Create · Read · Update · Delete]" (33).
    expect(longestEdgeLabelLine("is supported by [Create · Read · Update · Delete]")).toBe(33);
    // The longer line can come first.
    expect(longestEdgeLabelLine(`${"v".repeat(32)} [x]`)).toBe(32);
  });
});

describe("edgeLabelRouteWidth", () => {
  it("allows 5.8 px a character of the longest line, plus 12 px", () => {
    expect(edgeLabelRouteWidth("")).toBe(12);
    expect(edgeLabelRouteWidth("uses")).toBeCloseTo(4 * 5.8 + 12);
    expect(edgeLabelRouteWidth("is supported by [Create · Read · Update · Delete]")).toBeCloseTo(
      33 * 5.8 + 12,
    );
  });
});
