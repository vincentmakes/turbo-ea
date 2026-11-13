import { describe, expect, it } from "vitest";
import { alpha } from "@mui/material/styles";
import { buildPrintHtml } from "@/lib/printDocument";
import {
  PPM_GANTT_COLORS,
  PRINT_COLORS,
  PRIORITY_COLORS,
  RAG_COLORS,
  STATUS_COLORS,
  brand,
} from "@/theme/tokens";
import type { PpmRisk } from "@/types";
import { COST_BAR_COLOR, COST_BAR_OVER } from "./ppmPortfolioFormat";
import {
  COMPACT_QUARTERS_OVER,
  HEAT_STEPS,
  RING_RADIUS,
  YEAR_BAND_TINT,
  barFill,
  bdi,
  budgetBar,
  chip,
  completionColor,
  completionRing,
  healthColor,
  healthDot,
  heatMapCounts,
  kpiTile,
  legend,
  pairFigures,
  priorityColor,
  riskHeatMap,
  riskStatusBreakdown,
  riskStatusColor,
  riskStatusCounts,
  ringArc,
  taskBarColors,
  tileRow,
  timelineGrid,
  timelineLane,
  timelineModel,
  timelinePosition,
  timelineScale,
} from "./ppmProjectPrintVisuals";

const EVIL = '<img src=x onerror="alert(1)">';
const ESCAPED = "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;";

/** Through the pop-up's sanitiser, as the document is written. */
const sanitised = (html: string) => buildPrintHtml({ title: "t", bodyHtml: html });

describe("colours", () => {
  it.each([
    ["onTrack", RAG_COLORS.green],
    ["atRisk", RAG_COLORS.amber],
    ["offTrack", RAG_COLORS.red],
    ["weird", STATUS_COLORS.neutral],
    [null, STATUS_COLORS.neutral],
    ["", STATUS_COLORS.neutral],
  ])("a %s rating is %s", (value, color) => {
    expect(healthColor(value)).toBe(color);
  });

  it.each([
    [0, STATUS_COLORS.error],
    [39, STATUS_COLORS.error],
    [39.9, STATUS_COLORS.error],
    [40, STATUS_COLORS.warning],
    [79, STATUS_COLORS.warning],
    [80, STATUS_COLORS.success],
    [100, STATUS_COLORS.success],
  ])("completion %s%% is %s", (pct, color) => {
    expect(completionColor(pct)).toBe(color);
  });

  it.each([
    ["open", STATUS_COLORS.error],
    ["mitigating", STATUS_COLORS.warning],
    ["mitigated", STATUS_COLORS.success],
    ["accepted", STATUS_COLORS.info],
    ["closed", STATUS_COLORS.neutral],
    ["unknown", STATUS_COLORS.neutral],
  ])("risk status %s is %s", (status, color) => {
    expect(riskStatusColor(status)).toBe(color);
  });

  it("task bars follow the Gantt colours, an unknown status reads as To Do", () => {
    for (const s of ["todo", "in_progress", "done", "blocked"] as const) {
      expect(taskBarColors(s)).toEqual({ bar: PPM_GANTT_COLORS[s].bar, progress: PPM_GANTT_COLORS[s].progress });
    }
    expect(taskBarColors("parked")).toEqual({
      bar: PPM_GANTT_COLORS.todo.bar,
      progress: PPM_GANTT_COLORS.todo.progress,
    });
  });

  it("priorities follow the priority scale, an unknown one is neutral", () => {
    expect(priorityColor("critical")).toBe(PRIORITY_COLORS.critical);
    expect(priorityColor("low")).toBe(PRIORITY_COLORS.low);
    expect(priorityColor("someday")).toBe(STATUS_COLORS.neutral);
  });

  it("the year band is a pale tint of the brand blue", () => {
    expect(YEAR_BAND_TINT).toBe(alpha(brand.primary, 0.08));
  });
});

describe("chip, dot, tile, legend", () => {
  it("draws a filled chip as the colour behind white text", () => {
    expect(chip("Open", RAG_COLORS.red)).toBe(
      `<span class="pdf-chip pdf-chip-filled" style="background:${RAG_COLORS.red};border-color:${RAG_COLORS.red};color:${PRINT_COLORS.paper}">Open</span>`,
    );
  });

  it("draws an outlined chip as coloured border and text", () => {
    expect(chip("Open", RAG_COLORS.red, "outlined")).toBe(
      `<span class="pdf-chip pdf-chip-outlined" style="border-color:${RAG_COLORS.red};color:${RAG_COLORS.red}">Open</span>`,
    );
  });

  it("draws a soft chip as a pale tint behind body ink", () => {
    expect(chip("Medium", PRIORITY_COLORS.medium, "soft")).toBe(
      `<span class="pdf-chip pdf-chip-soft" style="background:${alpha(PRIORITY_COLORS.medium, 0.25)};border-color:${PRIORITY_COLORS.medium};color:${PRINT_COLORS.ink}">Medium</span>`,
    );
  });

  it("draws a rating dot followed by its text", () => {
    expect(healthDot("atRisk", "At Risk")).toBe(
      `<span class="pdf-health"><span class="pdf-dot" style="background:${RAG_COLORS.amber}"></span>At Risk</span>`,
    );
  });

  it("draws a tile with its label, value, colour, italic and sub line", () => {
    expect(kpiTile("Budget", "1.2 MUSD")).toBe(
      '<div class="pdf-tile"><div class="pdf-tile-label">Budget</div><div class="pdf-tile-value"><bdi>1.2 MUSD</bdi></div></div>',
    );
    expect(kpiTile("Variance", "-3", { color: STATUS_COLORS.error, derived: true, sub: "of 5" })).toBe(
      '<div class="pdf-tile"><div class="pdf-tile-label">Variance</div>' +
        `<div class="pdf-tile-value derived" style="color:${STATUS_COLORS.error}"><bdi>-3</bdi></div>` +
        '<div class="pdf-tile-sub">of 5</div></div>',
    );
  });

  it("takes a sub line built as HTML as it is", () => {
    expect(kpiTile("CapEx", "1", { sub: { html: "of <bdi>2</bdi>" } })).toContain(
      '<div class="pdf-tile-sub">of <bdi>2</bdi></div>',
    );
    expect(kpiTile("CapEx", "1", { sub: { html: "" } })).not.toContain("pdf-tile-sub");
  });

  it("isolates a figure in bdi, escaped", () => {
    expect(bdi("15 Jan 2023")).toBe("<bdi>15 Jan 2023</bdi>");
    expect(bdi(EVIL)).toBe(`<bdi>${ESCAPED}</bdi>`);
    expect(sanitised(bdi("1.2 MUSD"))).toContain("<bdi>1.2 MUSD</bdi>");
  });

  it("groups tiles in a row, named for screen readers when asked", () => {
    expect(tileRow(["A", "B"])).toBe('<div class="pdf-tiles">AB</div>');
    expect(tileRow(["A"], "3 risks")).toBe('<div class="pdf-tiles" role="group" aria-label="3 risks">A</div>');
  });

  it("draws every legend shape", () => {
    expect(
      legend([
        { label: "Swatch", color: RAG_COLORS.red },
        { label: "Track", color: brand.primaryLight, fill: brand.primary, shape: "track" },
        { label: "Plain track", color: brand.primary, shape: "track" },
        { label: "Diamond", color: brand.primary, shape: "diamond" },
      ]),
    ).toBe(
      '<div class="pdf-legend">' +
        `<span class="pdf-legend-item"><span class="pdf-legend-mark pdf-legend-swatch" style="background:${RAG_COLORS.red}"></span>Swatch</span>` +
        `<span class="pdf-legend-item"><span class="pdf-legend-mark pdf-legend-track" style="background:${brand.primaryLight}"><span style="background:${brand.primary}"></span></span>Track</span>` +
        `<span class="pdf-legend-item"><span class="pdf-legend-mark pdf-legend-track" style="background:${brand.primary}"><span style="background:${brand.primary}"></span></span>Plain track</span>` +
        `<span class="pdf-legend-item"><span class="pdf-legend-mark pdf-legend-diamond" style="background:${brand.primary}"></span>Diamond</span>` +
        "</div>",
    );
  });

  it("escapes hostile text in every one", () => {
    for (const html of [
      chip(EVIL, RAG_COLORS.red),
      chip(EVIL, RAG_COLORS.red, "outlined"),
      healthDot("onTrack", EVIL),
      kpiTile(EVIL, EVIL, { sub: EVIL }),
      tileRow(["x"], EVIL),
      legend([{ label: EVIL, color: RAG_COLORS.red }]),
    ]) {
      expect(html).not.toContain("<img");
      expect(html).toContain(ESCAPED);
    }
  });

  it("survive the sanitiser", () => {
    const html = chip("A", RAG_COLORS.red) + healthDot("onTrack", "B") + kpiTile("C", "D") + legend([{ label: "E", color: RAG_COLORS.red }]);
    expect(sanitised(html)).toContain(html);
  });
});

describe("completion ring", () => {
  const C = 2 * Math.PI * RING_RADIUS;

  it.each([
    [0, 0],
    [39, (C * 39) / 100],
    [40, (C * 40) / 100],
    [79, (C * 79) / 100],
    [80, (C * 80) / 100],
    [100, C],
    [-5, 0],
    [130, C],
  ])("at %s%% the arc is %s long", (pct, dash) => {
    const arc = ringArc(pct);
    expect(arc.circumference).toBeCloseTo(C, 10);
    expect(arc.dash).toBeCloseTo(dash, 10);
  });

  it("draws the track, the arc in its colour from twelve o'clock, and the percentage", () => {
    const r = (n: number) => Math.round(n * 100) / 100;
    expect(completionRing(59.4)).toBe(
      '<svg class="pdf-ring" width="76" height="76" viewBox="0 0 76 76" role="img" aria-label="59%">' +
        `<circle cx="38" cy="38" r="30" fill="none" stroke="${PRINT_COLORS.rule}" stroke-width="9"></circle>` +
        `<circle cx="38" cy="38" r="30" fill="none" stroke="${STATUS_COLORS.warning}" stroke-width="9" ` +
        `stroke-dasharray="${r((C * 59.4) / 100)} ${r(C)}" transform="rotate(-90 38 38)"></circle>` +
        `<text x="38" y="38" text-anchor="middle" dominant-baseline="central" font-size="15" font-weight="700" fill="${PRINT_COLORS.ink}">59%</text>` +
        "</svg>",
    );
  });

  it.each([
    [0, STATUS_COLORS.error],
    [39, STATUS_COLORS.error],
    [40, STATUS_COLORS.warning],
    [79, STATUS_COLORS.warning],
    [80, STATUS_COLORS.success],
    [100, STATUS_COLORS.success],
  ])("colours %s%% %s", (pct, color) => {
    expect(completionRing(pct)).toContain(`stroke="${color}"`);
    expect(completionRing(pct)).toContain(`>${pct}%</text>`);
  });

  it("mirrors the arc when the document reads right to left", () => {
    expect(completionRing(50, true)).toContain('transform="translate(76 0) scale(-1 1) rotate(-90 38 38)"');
  });

  it("survives the sanitiser as inline SVG", () => {
    const out = sanitised(completionRing(80));
    expect(out).toContain('<svg class="pdf-ring" width="76" height="76" viewBox="0 0 76 76" role="img" aria-label="80%">');
    expect(out).toContain('stroke-dasharray="');
    expect(out).toContain('transform="rotate(-90 38 38)"');
    expect(out).toContain('text-anchor="middle" dominant-baseline="central"');
    expect(out).toContain(">80%</text>");
  });
});

describe("budget bar", () => {
  it.each([
    [0, 100, 0, false],
    [64, 100, 64, false],
    [100, 100, 100, false],
    [150, 100, 100, true],
    [5, 0, 0, false],
  ])("actual %s of budget %s fills %s%% (over: %s)", (actual, budget, pct, over) => {
    expect(barFill(actual, budget)).toEqual({ pct, over });
  });

  const base = { label: "Total", currency: "USD", derivedBudget: false, derivedActual: false };

  it("fills to the share spent, in the bar colour, with the screen's caption", () => {
    expect(budgetBar({ ...base, budget: 900_000, actual: 578_000 })).toBe(
      '<div class="pdf-budget-bar"><div class="pdf-bar-head"><span class="pdf-bar-label">Total</span>' +
        `<span class="pdf-bar-caption" style="color:${PRINT_COLORS.inkSecondary}"><bdi>578/900 kUSD (64%)</bdi></span></div>` +
        `<div class="pdf-bar-track" style="background:${PRINT_COLORS.rule}">` +
        `<div class="pdf-bar-fill" style="width:64.22%;background:${COST_BAR_COLOR}"></div></div></div>`,
    );
  });

  it("caps the fill and turns the bar and caption red when over budget", () => {
    const html = budgetBar({ ...base, budget: 100, actual: 150 });
    expect(html).toContain(`style="color:${COST_BAR_OVER}"><bdi>150/100 USD (150%)</bdi></span>`);
    expect(html).toContain(`<div class="pdf-bar-fill" style="width:100%;background:${COST_BAR_OVER}">`);
  });

  it("has no share and no fill with no budget", () => {
    const html = budgetBar({ ...base, budget: 0, actual: 50 });
    expect(html).toContain("><bdi>50/0 USD</bdi></span>");
    expect(html).toContain('style="width:0%;background:');
  });

  it("outlines a derived budget's track and italicises its figure", () => {
    const html = budgetBar({ ...base, budget: 100, actual: 50, derivedBudget: true });
    expect(html).toContain("><bdi>50/<em>100</em> USD (50%)</bdi></span>");
    expect(html).toContain(`<div class="pdf-bar-track" style="border:1px solid ${COST_BAR_COLOR};background:transparent">`);
    expect(html).toContain(`<div class="pdf-bar-fill" style="width:50%;background:${COST_BAR_COLOR}">`);
  });

  it("outlines derived actuals' fill and italicises their figure", () => {
    const html = budgetBar({ ...base, budget: 100, actual: 50, derivedActual: true });
    expect(html).toContain("><bdi><em>50</em>/100 USD (50%)</bdi></span>");
    expect(html).toContain(`<div class="pdf-bar-track" style="background:${PRINT_COLORS.rule}">`);
    expect(html).toContain(`<div class="pdf-bar-fill" style="width:50%;border:1px solid ${COST_BAR_COLOR};background:transparent">`);
  });

  it("escapes the label and currency and survives the sanitiser", () => {
    const html = budgetBar({ ...base, label: EVIL, currency: EVIL, budget: 10, actual: 5 });
    expect(html).not.toContain("<img");
    expect(html.split(ESCAPED).length).toBe(3);
    const ok = budgetBar({ ...base, budget: 10, actual: 5, derivedBudget: true });
    expect(sanitised(ok)).toContain(ok);
  });
});

describe("one rule for a budget / actual pair", () => {
  it("formats both figures of a pair in one scale, as the bar caption does", () => {
    // 4,350,000 reads 4.3 in the bar caption; the tile must not say 4.4.
    expect(pairFigures(2_520_000, 4_350_000, "USD")).toEqual({ actual: "2.5 MUSD", budget: "4.3 MUSD" });
    expect(budgetBar({ label: "CapEx", budget: 4_350_000, actual: 2_520_000, currency: "USD", derivedBudget: false, derivedActual: false })).toContain(
      "<bdi>2.5/4.3 MUSD (58%)</bdi>",
    );
    expect(pairFigures(653_000, 1_350_000, "USD")).toEqual({ actual: "0.7 MUSD", budget: "1.4 MUSD" });
    expect(pairFigures(578_000, 900_000, "CHF")).toEqual({ actual: "578 kCHF", budget: "900 kCHF" });
    expect(pairFigures(40, 50, "USD")).toEqual({ actual: "40 USD", budget: "50 USD" });
  });
});

describe("risk status breakdown", () => {
  const r = (status: string) => ({ id: status, status }) as PpmRisk;
  const label = (status: string) => `L-${status}`;

  it("counts risks per status in the tab's order, unknown statuses in none", () => {
    expect(riskStatusCounts([r("open"), r("open"), r("closed"), r("parked")])).toEqual([
      { status: "open", count: 2 },
      { status: "mitigating", count: 0 },
      { status: "mitigated", count: 0 },
      { status: "closed", count: 1 },
      { status: "accepted", count: 0 },
    ]);
  });

  it("draws each status as its chip and count, muting the empty ones", () => {
    const html = riskStatusBreakdown([r("open"), r("open"), r("accepted")], "By status", label);
    expect(html).toBe(
      '<div class="pdf-status-breakdown"><div class="pdf-heat-title">By status</div><div class="pdf-status-rows">' +
        `<div class="pdf-status-row">${chip("L-open", STATUS_COLORS.error, "outlined")}<span class="pdf-status-count">2</span></div>` +
        `<div class="pdf-status-row pdf-muted">${chip("L-mitigating", STATUS_COLORS.warning, "outlined")}<span class="pdf-status-count">0</span></div>` +
        `<div class="pdf-status-row pdf-muted">${chip("L-mitigated", STATUS_COLORS.success, "outlined")}<span class="pdf-status-count">0</span></div>` +
        `<div class="pdf-status-row pdf-muted">${chip("L-closed", STATUS_COLORS.neutral, "outlined")}<span class="pdf-status-count">0</span></div>` +
        `<div class="pdf-status-row">${chip("L-accepted", STATUS_COLORS.info, "outlined")}<span class="pdf-status-count">1</span></div>` +
        "</div></div>",
    );
  });

  it("escapes its title and labels and survives the sanitiser", () => {
    const html = riskStatusBreakdown([r("open")], EVIL, () => EVIL);
    expect(html).not.toContain("<img");
    expect(html.split(ESCAPED).length).toBe(7);
    const ok = riskStatusBreakdown([r("open")], "By status", label);
    expect(sanitised(ok)).toContain(ok);
  });
});

describe("risk heat map", () => {
  const risk = (probability: number, impact: number): PpmRisk =>
    ({ id: `${probability}-${impact}`, probability, impact, risk_score: probability * impact }) as PpmRisk;
  const LABELS = {
    title: "Heat",
    probability: "Probability",
    impact: "Impact",
    bands: { high: "High", medium: "Medium", low: "Low" },
  };
  const cell = (html: string, p: number, i: number) => {
    const m = new RegExp(`<td class="pdf-heat-cell" data-p="${p}" data-i="${i}" style="([^"]*)">([^<]*)</td>`).exec(html);
    expect(m).not.toBeNull();
    return { style: m![1], text: m![2] };
  };

  it("counts risks into their probability × impact cell, ignoring off-grid ones", () => {
    const counts = heatMapCounts([risk(4, 5), risk(4, 5), risk(1, 1), risk(5, 2), risk(0, 3), risk(6, 1), risk(2.5, 2), risk(3, 0), risk(3, 6), risk(3, 1.5)]);
    expect(counts[3][4]).toBe(2);
    expect(counts[0][0]).toBe(1);
    expect(counts[4][1]).toBe(1);
    expect(counts.flat().reduce((a, b) => a + b, 0)).toBe(4);
    expect(counts).toHaveLength(5);
    for (const row of counts) expect(row).toHaveLength(5);
  });

  it("lays out probability 5 down to 1 and impact 1 to 5", () => {
    const html = riskHeatMap([], LABELS);
    const order = [...html.matchAll(/data-p="(\d)" data-i="(\d)"/g)].map((m) => `${m[1]}${m[2]}`);
    expect(order).toEqual(
      [5, 4, 3, 2, 1].flatMap((p) => HEAT_STEPS.map((i) => `${p}${i}`)),
    );
  });

  it("fills a cell holding risks in its band colour with the count, and leaves an empty one pale", () => {
    const html = riskHeatMap([risk(4, 5), risk(4, 5), risk(1, 2)], LABELS);
    expect(cell(html, 4, 5)).toEqual({ style: `background:${RAG_COLORS.red};color:${PRINT_COLORS.paper}`, text: "2" });
    expect(cell(html, 1, 2)).toEqual({ style: `background:${RAG_COLORS.green};color:${PRINT_COLORS.paper}`, text: "1" });
    expect(cell(html, 5, 5)).toEqual({ style: `background:${alpha(RAG_COLORS.red, 0.18)};color:${PRINT_COLORS.muted}`, text: "·" });
  });

  // 14 is not on a 5×5 grid (2 × 7); its band is scoreBand's, pinned in ppmRiskModel.test.ts.
  it("puts the band edges where the grid has them: 5 low, 6 medium, 12 medium, 15 high", () => {
    const html = riskHeatMap([], LABELS);
    expect(cell(html, 1, 5).style).toContain(alpha(RAG_COLORS.green, 0.18));
    expect(cell(html, 2, 3).style).toContain(alpha(RAG_COLORS.amber, 0.18));
    expect(cell(html, 3, 4).style).toContain(alpha(RAG_COLORS.amber, 0.18));
    expect(cell(html, 3, 5).style).toContain(alpha(RAG_COLORS.red, 0.18));
  });

  it("titles the map and both axes and closes with a three-band legend", () => {
    const html = riskHeatMap([], LABELS);
    const key = legend([
      { label: "High", color: RAG_COLORS.red },
      { label: "Medium", color: RAG_COLORS.amber },
      { label: "Low", color: RAG_COLORS.green },
    ]);
    // The legend shares the title's line, which keeps the block short.
    expect(
      html.startsWith(
        `<div class="pdf-heatmap"><div class="pdf-heat-head"><div class="pdf-heat-title">Heat</div>${key}</div><table class="pdf-heat"><tbody>`,
      ),
    ).toBe(true);
    expect(html).toContain('<tr><th class="pdf-heat-axis-y" rowspan="5"><span>Probability</span></th><th class="pdf-heat-tick">5</th>');
    expect(html.match(/pdf-heat-axis-y/g)).toHaveLength(1);
    expect(html).toContain(
      '<tr><td class="pdf-heat-corner" colspan="2"></td><th class="pdf-heat-tick">1</th><th class="pdf-heat-tick">2</th><th class="pdf-heat-tick">3</th><th class="pdf-heat-tick">4</th><th class="pdf-heat-tick">5</th></tr>' +
        '<tr><td class="pdf-heat-corner" colspan="2"></td><th class="pdf-heat-axis-x" colspan="5">Impact</th></tr></tbody></table>',
    );
    expect(html.endsWith("</tbody></table></div>")).toBe(true);
  });

  it("escapes its labels and survives the sanitiser", () => {
    const html = riskHeatMap([risk(3, 3)], {
      title: EVIL,
      probability: EVIL,
      impact: EVIL,
      bands: { high: EVIL, medium: EVIL, low: EVIL },
    });
    expect(html).not.toContain("<img");
    expect(html.split(ESCAPED).length).toBe(7);
    const ok = riskHeatMap([risk(3, 3)], LABELS);
    expect(sanitised(ok)).toContain(ok);
  });
});

describe("timeline", () => {
  const NOW = new Date(2026, 1, 15);

  it("widens the range to whole quarters and lays out years and quarters", () => {
    const m = timelineModel([{ start: "2025-11-20", end: "2026-02-10" }], NOW)!;
    expect(m.start).toEqual(new Date(2025, 9, 1));
    expect(m.end).toEqual(new Date(2026, 3, 1));
    // Q4 2025 (92 days) then Q1 2026 (90 days) of 182.
    expect(m.quarters.map((q) => q.label)).toEqual(["Q4", "Q1"]);
    expect(m.quarters[0].startPct).toBe(0);
    expect(m.quarters[0].widthPct).toBeCloseTo((92 / 182) * 100, 10);
    expect(m.quarters[1].startPct).toBeCloseTo((92 / 182) * 100, 10);
    expect(m.quarters[1].widthPct).toBeCloseTo((90 / 182) * 100, 10);
    expect(m.years.map((y) => y.label)).toEqual(["2025", "2026"]);
    expect(m.years[1].startPct).toBeCloseTo((92 / 182) * 100, 10);
    expect(m.years[0].widthPct + m.years[1].widthPct).toBeCloseTo(100, 10);
    // 15 Feb 2026 is day 137 of 182.
    expect(m.todayPct).toBeCloseTo((137 / 182) * 100, 10);
  });

  it("merges a year's quarters into one year cell and keeps no quarter past the range", () => {
    const m = timelineModel([{ start: "2025-01-01", end: "2025-12-31" }], NOW)!;
    expect(m.quarters.map((q) => q.label)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(m.years).toEqual([{ label: "2025", startPct: 0, widthPct: expect.closeTo(100, 10) }]);
    expect(m.end).toEqual(new Date(2026, 0, 1));
  });

  it("uses the earliest and latest date of any item, start or end alone", () => {
    const m = timelineModel(
      [{ start: null, end: "2026-08-01" }, { start: "2025-02-01", end: null }, { start: null, end: null }, {}],
      NOW,
    )!;
    expect(m.start).toEqual(new Date(2025, 0, 1));
    expect(m.end).toEqual(new Date(2026, 9, 1));
  });

  it("has no scale when nothing has a date", () => {
    expect(timelineModel([{ start: null, end: null }, {}], NOW)).toBeNull();
    expect(timelineModel([], NOW)).toBeNull();
  });

  it("places today only when it is inside the range", () => {
    const span = [{ start: "2025-01-10", end: "2025-03-01" }];
    expect(timelineModel(span, new Date(2025, 0, 1))!.todayPct).toBe(0);
    expect(timelineModel(span, new Date(2024, 11, 31))!.todayPct).toBeNull();
    expect(timelineModel(span, new Date(2025, 3, 1))!.todayPct).toBeNull();
    expect(timelineModel(span, new Date(2025, 2, 31, 23, 0))!.todayPct).toBeCloseTo((89 / 90) * 100, 10);
  });

  // Q1 2025: 90 days, so one day is 100 / 90 %.
  const Q1 = timelineModel([{ start: "2025-01-01", end: "2025-03-31" }], new Date(2030, 0, 1))!;
  const day = 100 / 90;

  it("positions a bar from its start to the end of its last day", () => {
    const pos = timelinePosition(Q1, { start: "2025-01-11", end: "2025-01-20" });
    expect(pos).toEqual({ startPct: expect.closeTo(10 * day, 10), widthPct: expect.closeTo(10 * day, 10) });
    expect(timelinePosition(Q1, { start: "2025-01-01", end: "2025-03-31" })).toEqual({
      startPct: 0,
      widthPct: expect.closeTo(100, 10),
    });
  });

  it("orders reversed dates, and gives a one-date item a point", () => {
    expect(timelinePosition(Q1, { start: "2025-01-20", end: "2025-01-11" })).toEqual(
      timelinePosition(Q1, { start: "2025-01-11", end: "2025-01-20" }),
    );
    expect(timelinePosition(Q1, { start: null, end: "2025-01-31" })).toEqual({ atPct: expect.closeTo(30 * day, 10) });
    expect(timelinePosition(Q1, { start: "2025-01-31", end: null })).toEqual({ atPct: expect.closeTo(30 * day, 10) });
    expect(timelinePosition(Q1, { start: null, end: null })).toBeNull();
    expect(timelinePosition(Q1, {})).toBeNull();
  });

  const pct = (n: number) => `${Math.round(n * 100) / 100}%`;

  it("draws a work package as a light track filled to its completion", () => {
    expect(timelineLane(Q1, { start: "2025-01-11", end: "2025-01-20" }, { kind: "package", completion: 42.4, milestone: false })).toBe(
      '<div class="pdf-tl-lane">' +
        `<span class="pdf-tl-bar" style="inset-inline-start:${pct(10 * day)};width:${pct(10 * day)};background:${brand.primaryLight}">` +
        `<span class="pdf-tl-fill" style="width:42.4%;background:${brand.primary}"></span></span></div>`,
    );
    expect(timelineLane(Q1, { start: "2025-01-11", end: "2025-01-20" }, { kind: "package", completion: 130, milestone: false })).toContain(
      'class="pdf-tl-fill" style="width:100%;',
    );
    expect(timelineLane(Q1, { start: "2025-01-11", end: "2025-01-20" }, { kind: "package", completion: -3, milestone: false })).toContain(
      'class="pdf-tl-fill" style="width:0%;',
    );
  });

  it.each([
    ["todo", 0],
    ["in_progress", 50],
    ["done", 100],
    ["blocked", 0],
  ] as const)("draws a %s task in its status colour filled to %s%%", (status, fill) => {
    expect(timelineLane(Q1, { start: "2025-01-01", end: "2025-03-31" }, { kind: "task", status })).toBe(
      '<div class="pdf-tl-lane">' +
        `<span class="pdf-tl-bar" style="inset-inline-start:0%;width:100%;background:${PPM_GANTT_COLORS[status].bar}">` +
        `<span class="pdf-tl-fill" style="width:${fill}%;background:${PPM_GANTT_COLORS[status].progress}"></span></span></div>`,
    );
  });

  it("draws a milestone as a diamond at its date, end first", () => {
    expect(timelineLane(Q1, { start: "2025-01-01", end: "2025-01-31" }, { kind: "package", completion: 0, milestone: true })).toBe(
      `<div class="pdf-tl-lane"><span class="pdf-tl-milestone" style="inset-inline-start:${pct(30 * day)};background:${brand.primary}"></span></div>`,
    );
    expect(timelineLane(Q1, { start: "2025-01-31", end: null }, { kind: "package", completion: 0, milestone: true })).toContain(
      `inset-inline-start:${pct(30 * day)}`,
    );
    expect(timelineLane(Q1, {}, { kind: "package", completion: 0, milestone: true })).toBe('<div class="pdf-tl-lane"></div>');
  });

  it("draws a one-date task as a point in its status colour and an undated one as nothing", () => {
    expect(timelineLane(Q1, { end: "2025-01-31" }, { kind: "task", status: "done" })).toBe(
      `<div class="pdf-tl-lane"><span class="pdf-tl-point" style="inset-inline-start:${pct(30 * day)};background:${PPM_GANTT_COLORS.done.progress}"></span></div>`,
    );
    expect(timelineLane(Q1, { start: null, end: null }, { kind: "task", status: "done" })).toBe('<div class="pdf-tl-lane"></div>');
  });

  it("runs the today line through every lane and the scale when today is on the scale", () => {
    const m = timelineModel([{ start: "2025-01-01", end: "2025-03-31" }], new Date(2025, 0, 10))!;
    const line = `<span class="pdf-tl-today" style="inset-inline-start:${pct(9 * day)};background:${STATUS_COLORS.error}"></span>`;
    expect(timelineLane(m, {}, { kind: "task", status: "todo" })).toBe(`<div class="pdf-tl-lane">${line}</div>`);
    expect(timelineScale(m)).toContain(`${line}</div></div>`);
    expect(timelineScale(Q1)).not.toContain("pdf-tl-today");
  });

  it("draws the scale as years over quarters", () => {
    expect(timelineScale(Q1)).toBe(
      '<div class="pdf-tl-scale"><div class="pdf-tl-years">' +
        '<span class="pdf-tl-year" style="inset-inline-start:0%;width:100%">2025</span></div>' +
        '<div class="pdf-tl-quarters"><span class="pdf-tl-quarter" style="inset-inline-start:0%;width:100%">Q1</span></div></div>',
    );
  });

  it(`labels quarters by digit only past ${COMPACT_QUARTERS_OVER} of them`, () => {
    const eight = timelineModel([{ start: "2024-01-01", end: "2025-12-31" }], NOW)!;
    expect(eight.quarters).toHaveLength(8);
    expect(timelineScale(eight)).toContain(">Q4</span>");
    const nine = timelineModel([{ start: "2024-01-01", end: "2026-01-31" }], NOW)!;
    expect(nine.quarters).toHaveLength(9);
    const scale = timelineScale(nine);
    expect(scale).not.toContain(">Q");
    expect(scale).toContain(">4</span>");
    expect(nine.quarters[0].label).toBe("Q1");
  });

  it("rules every quarter boundary through a lane, year boundaries darker", () => {
    // Q3 2025 to Q2 2026: boundaries at Q4, Q1 (a new year) and Q2.
    const m = timelineModel([{ start: "2025-07-01", end: "2026-06-30" }], new Date(2030, 0, 1))!;
    const at = (q: number) => `${Math.round(m.quarters[q].startPct * 100) / 100}%`;
    expect(timelineGrid(m)).toBe(
      `<span class="pdf-tl-grid pdf-tl-grid-q" style="inset-inline-start:${at(1)}"></span>` +
        `<span class="pdf-tl-grid pdf-tl-grid-y" style="inset-inline-start:${at(2)}"></span>` +
        `<span class="pdf-tl-grid pdf-tl-grid-q" style="inset-inline-start:${at(3)}"></span>`,
    );
    expect(timelineLane(m, {}, { kind: "task", status: "todo" })).toBe(`<div class="pdf-tl-lane">${timelineGrid(m)}</div>`);
    // A one-quarter range has no inner boundary.
    expect(timelineGrid(Q1)).toBe("");
  });

  it("draws the grid under the bar and the today line over it", () => {
    const m = timelineModel([{ start: "2025-01-01", end: "2025-06-30" }], new Date(2025, 4, 1))!;
    const lane = timelineLane(m, { start: "2025-01-01", end: "2025-06-30" }, { kind: "task", status: "done" });
    expect(lane.indexOf("pdf-tl-grid")).toBeLessThan(lane.indexOf("pdf-tl-bar"));
    expect(lane.indexOf("pdf-tl-bar")).toBeLessThan(lane.indexOf("pdf-tl-today"));
  });

  it("survives the sanitiser with its positions", () => {
    const m = timelineModel([{ start: "2025-01-01", end: "2025-03-31" }], new Date(2025, 0, 10))!;
    const html =
      timelineScale(m) +
      timelineLane(m, { start: "2025-01-11", end: "2025-01-20" }, { kind: "task", status: "in_progress" }) +
      timelineLane(m, { end: "2025-01-31" }, { kind: "package", completion: 0, milestone: true });
    expect(sanitised(html)).toContain(html);
  });
});
