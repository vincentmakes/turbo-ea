/**
 * Line labels wrap instead of being cut off: the verb on one line, its
 * attribute values on the next, never past three lines.
 */
import { describe, expect, it } from "vitest";
import { EDGE_LABEL_LINE_CHARS, MAX_EDGE_LABEL_LINES, wrapEdgeLabel } from "./ldvEdgeLabel";

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
