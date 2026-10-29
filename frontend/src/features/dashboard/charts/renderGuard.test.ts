/**
 * Render guard: every chart kind, drawn by real ECharts (SVG renderer) with
 * deliberately long labels at a wide and a narrow widget size, keeps every
 * piece of text inside its canvas. A label that runs past the edge is clipped
 * by the widget — a sankey's right-hand names were, before `sankeyInset`.
 *
 * jsdom has no canvas to measure text, so ECharts is given the same estimate
 * the builders size their insets with (6.6 px per character at 12 px); the
 * guard measures each `<text>` the same way, so "fits" here means the layout
 * reserved room for the text it draws.
 */
import { afterEach, describe, expect, it } from "vitest";
import * as echarts from "echarts/core";
import {
  BarChart,
  GaugeChart,
  HeatmapChart,
  LineChart,
  PieChart,
  SankeyChart,
  TreemapChart,
} from "echarts/charts";
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { DashboardChartKind, DashboardQueryRow } from "@/types";
import { CHART_KINDS, VALUE_LABEL_KINDS } from "../widgets/chartConfig";
import { buildOption, type BuildContext } from "./buildOption";
import { buildEChartsChrome } from "./echartsTheme";

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GaugeChart,
  HeatmapChart,
  TreemapChart,
  SankeyChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  AriaComponent,
  SVGRenderer,
]);

/** Average glyph width at 12 px — the builders' estimate too. */
const CHAR_WIDTH_12 = 6.6;

function fontSizeOf(font: string | undefined | null): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(font ?? "");
  return m ? Number(m[1]) : 12;
}

function estimateWidth(text: string, fontSize: number): number {
  return (text.length * CHAR_WIDTH_12 * fontSize) / 12;
}

echarts.setPlatformAPI({
  measureText: (text: string, font?: string) =>
    ({ width: estimateWidth(text, fontSizeOf(font)) }) as TextMetrics,
});

const chrome = buildEChartsChrome({
  mode: "light",
  text: { primary: "#111111", secondary: "#555555" },
  divider: "#dddddd",
  background: { paper: "#ffffff" },
  action: { hover: "#eeeeee" },
});

/** A distinct 40-character name. */
function longName(prefix: string, i: number): string {
  return `${prefix} ${i} `.padEnd(40, "abcdefghij");
}

const CATEGORIES = Array.from({ length: 12 }, (_, i) => longName("Category", i));
const SERIES = Array.from({ length: 6 }, (_, i) => longName("Series", i));
const SOURCES = Array.from({ length: 8 }, (_, i) => longName("Source", i));
const TARGETS = Array.from({ length: 8 }, (_, i) => longName("Target", i));

function rowsFor(kind: DashboardChartKind): DashboardQueryRow[] {
  switch (kind) {
    case "gauge":
      return [{ key: "total", value: 73 }];
    case "heatmap":
    case "stacked_column":
      return CATEGORIES.flatMap((x, xi) => SERIES.map((y, yi) => ({ x, y, value: 1 + ((xi * 7 + yi * 3) % 11) })));
    case "sankey":
      return SOURCES.flatMap((source, si) =>
        TARGETS.map((target, ti) => ({ source, target, value: 1 + ((si * 5 + ti * 3) % 9) })),
      );
    default:
      return CATEGORIES.map((key, i) => ({ key, value: 120 - i * 9 }));
  }
}

function ctxFor(kind: DashboardChartKind, isRtl: boolean, showValues = false): BuildContext {
  const palette = chrome.categorical;
  return {
    labels: (k) => k,
    colors: (_k, i) => palette[i % palette.length],
    theme: chrome,
    isRtl,
    showValues,
    seriesName: longName("Measure", 0),
    // A printed value can be longer than the axis' own tick label (a share
    // with a decimal and a unit): the plot must keep room for it.
    ...(showValues ? { valueFormatter: (v: number) => `${v.toFixed(1)}%` } : {}),
    ...(kind === "gauge" ? { unit: "%", valueFormatter: (v: number) => `${v}%` } : {}),
  };
}

interface TextBox {
  text: string;
  left: number;
  right: number;
  y: number;
  /** The clip region the text is drawn in, when a group clips it. */
  clip: Rect | null;
}

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function num(v: string | null): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** The base point an SVG `transform` moves an element to, and its x direction. */
function transformOf(el: Element): { tx: number; ty: number; a: number; b: number } {
  const t = el.getAttribute("transform") ?? "";
  const translate = /translate\(\s*([-\d.e]+)[\s,]+([-\d.e]+)\s*\)/.exec(t);
  if (translate) return { tx: Number(translate[1]), ty: Number(translate[2]), a: 1, b: 0 };
  const matrix = /matrix\(([^)]*)\)/.exec(t);
  if (matrix) {
    const [a, b, , , e, f] = matrix[1].split(/[\s,]+/).map(Number);
    return { tx: e, ty: f, a, b };
  }
  return { tx: 0, ty: 0, a: 1, b: 0 };
}

/** Bounding box of a clip path's outline (`M`, `L`, `H`, `V`, either case). */
function pathBounds(d: string, tx: number, ty: number): Rect | null {
  const tokens = d.match(/[a-zA-Z]|-?[\d.]+(?:e-?\d+)?/g) ?? [];
  let x = 0;
  let y = 0;
  let cmd = "M";
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < tokens.length; ) {
    if (/[a-zA-Z]/.test(tokens[i])) {
      cmd = tokens[i++];
      if (cmd === "Z" || cmd === "z") continue;
    }
    const n = () => Number(tokens[i++]);
    switch (cmd) {
      case "M":
      case "L":
        x = n();
        y = n();
        break;
      case "m":
      case "l":
        x += n();
        y += n();
        break;
      case "H":
        x = n();
        break;
      case "h":
        x += n();
        break;
      case "V":
        y = n();
        break;
      case "v":
        y += n();
        break;
      default:
        // A curve: not a rectangle clip, which is all the guard models.
        return null;
    }
    xs.push(x + tx);
    ys.push(y + ty);
  }
  if (xs.length === 0) return null;
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

/** The clip region an ancestor group applies to `el`, if any. */
function clipOf(el: Element, root: Element): Rect | null {
  const holder = el.closest("[clip-path]");
  if (!holder || !root.contains(holder)) return null;
  const id = /url\(#([^)]+)\)/.exec(holder.getAttribute("clip-path") ?? "")?.[1];
  const shape = id ? root.querySelector(`[id="${id}"] path`) : null;
  if (!shape) return null;
  const { tx, ty } = transformOf(shape);
  return pathBounds(shape.getAttribute("d") ?? "", tx, ty);
}

/** Every drawn text as a horizontal extent plus its anchor's y. */
function textBoxes(root: Element): TextBox[] {
  const out: TextBox[] = [];
  for (const el of Array.from(root.querySelectorAll("text"))) {
    const { tx, ty, a, b } = transformOf(el);
    const style = el.getAttribute("style") ?? "";
    const fontSize = fontSizeOf(/font-size:\s*[\d.]+px/.exec(style)?.[0] ?? el.getAttribute("font-size"));
    const anchor = el.getAttribute("text-anchor") ?? "start";
    const clip = clipOf(el, root);
    const spans = Array.from(el.querySelectorAll("tspan"));
    const parts = spans.length
      ? spans.map((s) => ({
          text: s.textContent ?? "",
          x: num(s.getAttribute("x") ?? el.getAttribute("x")),
          y: num(s.getAttribute("y") ?? el.getAttribute("y")),
        }))
      : [{ text: el.textContent ?? "", x: num(el.getAttribute("x")), y: num(el.getAttribute("y")) }];
    for (const p of parts) {
      if (!p.text.trim()) continue;
      const w = estimateWidth(p.text, fontSize);
      const start = anchor === "end" ? -w : anchor === "middle" ? -w / 2 : 0;
      // A rotated text runs along (a, b); its horizontal reach is the projection.
      const x0 = tx + a * (p.x + start);
      const x1 = tx + a * (p.x + start + w);
      out.push({
        text: p.text,
        left: Math.min(x0, x1),
        right: Math.max(x0, x1),
        y: ty + p.y + b * (p.x + start),
        clip,
      });
    }
  }
  return out;
}

const SIZES = [
  { width: 600, height: 300 },
  { width: 320, height: 220 },
];

let chart: echarts.ECharts | null = null;
afterEach(() => {
  chart?.dispose();
  chart = null;
  document.body.innerHTML = "";
});

/** Rounding slack: positions are written with sub-pixel precision. */
const EPS = 0.5;

/**
 * The problems of one drawn chart: text past the canvas edge, and a clipped
 * group (the scroll legend's page) that shows no entry whole. Inside a clip,
 * only the visible part of a text counts: ECharts' scroll legend clips its
 * page at the available width, so the entry after the last whole one is
 * drawn cut by design (its arrows say there is more), and entries on other
 * pages are drawn wholly outside the clip.
 */
function problemsOf(boxes: TextBox[], width: number, height: number): string[] {
  const problems: string[] = [];
  const clips = new Map<string, { clip: Rect; whole: number; texts: string[] }>();
  for (const b of boxes) {
    let { left, right } = b;
    if (b.clip) {
      const key = JSON.stringify(b.clip);
      const group = clips.get(key) ?? { clip: b.clip, whole: 0, texts: [] };
      clips.set(key, group);
      left = Math.max(left, b.clip.left);
      right = Math.min(right, b.clip.right);
      if (right <= left) continue; // On another page.
      group.texts.push(b.text);
      if (b.left >= b.clip.left - EPS && b.right <= b.clip.right + EPS) group.whole += 1;
    }
    if (left < -EPS || right > width + EPS || b.y < -EPS || b.y > height + EPS) {
      problems.push(`"${b.text}" x ${left.toFixed(1)}–${right.toFixed(1)}, y ${b.y.toFixed(1)}`);
    }
  }
  for (const { whole, texts } of clips.values()) {
    if (texts.length > 0 && whole === 0) problems.push(`no whole entry in a clipped group: ${texts.join(" | ")}`);
  }
  return problems;
}

function overflowing(
  kind: DashboardChartKind,
  width: number,
  height: number,
  isRtl: boolean,
  showValues = false,
): string[] {
  const div = document.createElement("div");
  document.body.appendChild(div);
  chart = echarts.init(div, null, { renderer: "svg", width, height });
  const option = buildOption(kind, rowsFor(kind), ctxFor(kind, isRtl, showValues)) as Record<string, unknown>;
  chart.setOption({ ...option, animation: false });
  const boxes = textBoxes(div);
  // The guard must see the text it guards: the long names, or the gauge's reading.
  const drawn = kind === "gauge" ? /^73%$/ : /^(Category|Series|Source|Target) \d/;
  expect(boxes.some((b) => drawn.test(b.text))).toBe(true);
  return problemsOf(boxes, width, height);
}

describe("every chart keeps its text inside the canvas", () => {
  for (const kind of CHART_KINDS) {
    for (const { width, height } of SIZES) {
      for (const isRtl of [false, true]) {
        it(`${kind} at ${width}×${height}${isRtl ? " (RTL)" : ""}`, () => {
          expect(overflowing(kind, width, height, isRtl)).toEqual([]);
        });
      }
    }
  }
});

describe("every chart that prints its values keeps them inside the canvas", () => {
  for (const kind of CHART_KINDS.filter((k) => VALUE_LABEL_KINDS.has(k))) {
    for (const { width, height } of SIZES) {
      for (const isRtl of [false, true]) {
        it(`${kind} with values at ${width}×${height}${isRtl ? " (RTL)" : ""}`, () => {
          expect(overflowing(kind, width, height, isRtl, true)).toEqual([]);
        });
      }
    }
  }

  it("draws the figures it guards", () => {
    overflowing("bar", 600, 300, false, true);
    // The widest bar's value is drawn, through the widget's formatter, past the bar's end.
    const texts = Array.from(document.querySelectorAll("text")).map((t) => t.textContent);
    expect(texts).toContain("120.0%");
  });
});

describe("the guard itself", () => {
  it("measures anchors and translations the way the SVG renderer writes them", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.innerHTML =
      '<text text-anchor="start" style="font-size: 12px;" transform="translate(10 20)">abcde</text>' +
      '<text text-anchor="end" style="font-size: 24px;" transform="translate(100 30)">ab</text>' +
      '<text text-anchor="middle" transform="translate(50 40)">abcd</text>';
    const boxes = textBoxes(svg);
    expect(boxes[0]).toEqual({ text: "abcde", left: 10, right: 10 + 5 * 6.6, y: 20, clip: null });
    expect(boxes[1].left).toBeCloseTo(100 - 2 * 13.2);
    expect(boxes[1].right).toBe(100);
    expect(boxes[2].left).toBeCloseTo(50 - 2 * 6.6);
    expect(boxes[2].right).toBeCloseTo(50 + 2 * 6.6);
  });

  it("flags a label that runs past the right edge", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.innerHTML = `<text transform="translate(590 10)">${"x".repeat(10)}</text>`;
    expect(problemsOf(textBoxes(svg), 600, 300)).toEqual([`"xxxxxxxxxx" x 590.0–656.0, y 10.0`]);
  });

  it("flags a label above or below the canvas", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.innerHTML = '<text transform="translate(10 -4)">a</text><text transform="translate(10 305)">b</text>';
    expect(problemsOf(textBoxes(svg), 600, 300)).toHaveLength(2);
  });

  it("counts only the visible part of clipped text, and wants one whole entry per clip", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const clip = '<defs><clipPath id="c0"><path d="M0 0l100 0l0 15l-100 0Z" transform="translate(5 280)"></path></clipPath></defs>';
    // One whole entry, one cut at the page edge, one on the next page.
    svg.innerHTML =
      clip +
      '<g clip-path="url(#c0)"><text x="0" transform="translate(5 280)">abcde</text>' +
      '<text transform="translate(80 280)">abcdefghij</text>' +
      '<text transform="translate(700 280)">abcdefghij</text></g>';
    const boxes = textBoxes(svg);
    expect(boxes[0].clip).toEqual({ left: 5, right: 105, top: 280, bottom: 295 });
    expect(problemsOf(boxes, 600, 300)).toEqual([]);
    // A page whose only entry is cut is flagged.
    svg.innerHTML = clip + `<g clip-path="url(#c0)"><text transform="translate(5 280)">${"x".repeat(40)}</text></g>`;
    expect(problemsOf(textBoxes(svg), 600, 300)).toEqual([
      `no whole entry in a clipped group: ${"x".repeat(40)}`,
    ]);
  });
});
