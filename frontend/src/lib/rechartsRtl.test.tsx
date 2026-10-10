/**
 * The Recharts helpers that keep a chart readable right-to-left: the axis
 * tick outside a right-side axis, logical legend margins, the tooltip
 * direction and a mirrored chart margin.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import {
  makeRtlAxisTick,
  mirrorChartMargin,
  rtlLegendItemStyle,
  rtlTooltipStyle,
} from "./rechartsRtl";

function tick(props: Parameters<ReturnType<typeof makeRtlAxisTick>>[0], fontSize?: number) {
  const Tick = makeRtlAxisTick("#123456", fontSize);
  const { container } = render(
    <svg>
      <Tick {...props} />
    </svg>,
  );
  return container.querySelector("text")!;
}

describe("makeRtlAxisTick", () => {
  it("anchors the label 8px outside the axis, right-to-left", () => {
    const text = tick({ x: 100, y: "40", payload: { value: "Apps" } });
    expect(text.getAttribute("x")).toBe("108");
    expect(text.getAttribute("y")).toBe("40");
    expect(text.getAttribute("direction")).toBe("rtl");
    expect(text.getAttribute("text-anchor")).toBe("end");
    expect(text.getAttribute("dominant-baseline")).toBe("central");
    expect(text.getAttribute("font-size")).toBe("12");
    expect(text.getAttribute("fill")).toBe("#123456");
    expect(text.textContent).toBe("Apps");
  });

  it("takes a font size, and reads a missing position or value as zero / empty", () => {
    const text = tick({}, 14);
    expect(text.getAttribute("x")).toBe("8");
    expect(text.getAttribute("y")).toBe("0");
    expect(text.getAttribute("font-size")).toBe("14");
    expect(text.textContent).toBe("");
  });

  it("renders a numeric value", () => {
    expect(tick({ x: 0, y: 0, payload: { value: 0 } }).textContent).toBe("0");
  });
});

describe("rtlLegendItemStyle", () => {
  it("adds logical margins only right-to-left", () => {
    expect(rtlLegendItemStyle(true, "red")).toEqual({
      color: "red",
      marginInlineStart: 4,
      marginInlineEnd: 16,
    });
    expect(rtlLegendItemStyle(false, "red")).toEqual({ color: "red" });
  });
});

describe("rtlTooltipStyle", () => {
  it("follows the reading direction", () => {
    expect(rtlTooltipStyle(true)).toEqual({ direction: "rtl", textAlign: "right" });
    expect(rtlTooltipStyle(false)).toEqual({ direction: "ltr", textAlign: "left" });
  });
});

describe("mirrorChartMargin", () => {
  it("swaps left and right right-to-left and keeps the rest", () => {
    const margin = { top: 5, left: 10, right: 30, bottom: 0 };
    expect(mirrorChartMargin(margin, true)).toEqual({ top: 5, left: 30, right: 10, bottom: 0 });
    expect(mirrorChartMargin(margin, false)).toBe(margin);
  });
});
