/**
 * Module series: parity with the backend's `SOURCE_SERIES`, `SERIES_SHAPES`
 * and `CHART_KINDS` (read off `dashboard_defaults.py` as text), what every
 * series reads out of its report, and how keyed series are named and
 * coloured.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { fieldLabel, typeLabel } from "@/hooks/useResolveLabel";
import { CARD_TYPES, makeCardType, makeField, makeOption, makeSection, makeSubtype } from "@/test/fixtures/metamodel";
import { describeSourceScan, itSourceScan } from "@/test/sourceScan";
import { CHART_CATEGORICAL, SEVERITY_COLORS, STATUS_COLORS } from "@/theme/tokens";
import { OTHER_KEY } from "../charts/buildOption";
import type { ResolverDeps } from "../charts/dimensions";
import { CHART_KINDS } from "./chartConfig";
import {
  HEALTH_SERIES_COLORS,
  MODULE_SOURCE_NAMES,
  MODULE_SOURCE_PATHS,
  SINGLE_SERIES,
  SOURCE_MODULES,
  SOURCE_PERMISSIONS,
  SOURCE_SERIES,
  extractSeries,
  isSourceSeries,
  keyedRows,
  seriesLabelKey,
  seriesShape,
  sourceSeriesResolver,
} from "./sourceSeries";

const DEFAULTS_FILE = path.resolve(__dirname, "../../../../../backend/app/services/dashboard_defaults.py");

/** The balanced `open … close` block that follows `name` at the start of a line. */
function block(text: string, name: string, open: string, close: string): string {
  const start = text.search(new RegExp(`^${name}\\b`, "m"));
  expect(start, `${name} is declared at the start of a line`).toBeGreaterThan(-1);
  const from = text.indexOf(open, start);
  let depth = 0;
  let end = from;
  for (; end < text.length; end++) {
    if (text[end] === open) depth++;
    else if (text[end] === close && --depth === 0) break;
  }
  return text.slice(from, end + 1).replace(/#.*$/gm, "");
}

function backend() {
  const text = fs.readFileSync(DEFAULTS_FILE, "utf-8");
  const seriesBody = block(text, "SOURCE_SERIES", "{", "}");
  const series: Record<string, string[]> = {};
  for (const m of seriesBody.matchAll(/["']([a-z_]+)["']\s*:\s*[([{]([^)\]}]*)[)\]}]/g)) {
    series[m[1]] = [...m[2].matchAll(/["']([a-z_]+)["']/g)].map((x) => x[1]);
  }
  const shapesBody = block(text, "SERIES_SHAPES", "{", "}");
  const shapes: Record<string, string> = {};
  for (const m of shapesBody.matchAll(/["']([a-z_]+)["']\s*:\s*["']([a-z_]+)["']/g)) shapes[m[1]] = m[2];
  const kinds = [...block(text, "CHART_KINDS", "(", ")").matchAll(/["']([a-z_]+)["']/g)].map((m) => m[1]).sort();
  return { series, shapes, kinds };
}

describeSourceScan("parity with the backend", () => {
  itSourceScan("knows exactly the backend's sources and series, in order", () => {
    const { series } = backend();
    expect(Object.keys(series).sort()).toEqual([...MODULE_SOURCE_NAMES].sort());
    for (const source of MODULE_SOURCE_NAMES) {
      expect([...SOURCE_SERIES[source]], source).toEqual(series[source]);
    }
  });

  itSourceScan("agrees on which series are one number", () => {
    const { shapes } = backend();
    const all = new Set(MODULE_SOURCE_NAMES.flatMap((s) => [...SOURCE_SERIES[s]]));
    for (const name of all) expect(seriesShape(name), name).toBe(shapes[name]);
    expect(Object.keys(shapes).sort()).toEqual([...all].sort());
  });

  itSourceScan("draws exactly the chart kinds the backend accepts", () => {
    expect([...CHART_KINDS].sort()).toEqual(backend().kinds);
  });
});

describe("the source table", () => {
  it("gives every source a path, a permission and a module", () => {
    expect(MODULE_SOURCE_PATHS).toEqual({
      risks_metrics: "/risks/metrics",
      compliance_overview: "/compliance/overview",
      ppm_dashboard: "/reports/ppm/dashboard",
      bpm_dashboard: "/reports/bpm/dashboard",
    });
    expect(SOURCE_PERMISSIONS).toEqual({
      risks_metrics: "risks.view",
      compliance_overview: "compliance.view",
      ppm_dashboard: "ppm.view",
      bpm_dashboard: "reports.bpm_dashboard",
    });
    expect(SOURCE_MODULES).toEqual({
      risks_metrics: "grc",
      compliance_overview: "grc",
      ppm_dashboard: "ppm",
      bpm_dashboard: "bpm",
    });
  });

  it("names every series in English", () => {
    for (const source of MODULE_SOURCE_NAMES) {
      for (const series of SOURCE_SERIES[source]) {
        expect(i18n.exists(`common:${seriesLabelKey(source, series)}`), `${source}.${series}`).toBe(true);
      }
    }
  });

  it("knows a series only under its own source", () => {
    expect(isSourceSeries("risks_metrics", "open")).toBe(true);
    expect(isSourceSeries("risks_metrics", "scores")).toBe(false);
    expect(isSourceSeries("nope", "open")).toBe(false);
    expect(isSourceSeries("risks_metrics", 3)).toBe(false);
    expect([...SINGLE_SERIES].sort()).toEqual(["at_risk", "open", "overdue", "score_avg", "total", "without_diagram"]);
  });
});

const RISKS = {
  total: 10,
  by_status: { identified: 3, closed: 2, accepted: 1, in_progress: 4 },
  by_level: { high: 4, low: 6 },
  by_category: { security: 2, strategic: 7, custom: 1 },
  overdue: 2,
  created_this_month: 1,
};
const COMPLIANCE = { compliance_scores: { gdpr: 80, nis2: 60 }, compliance_by_status: {} };
const HEALTH = (n: number) => ({ onTrack: n, atRisk: 2, offTrack: 1, noReport: 0 });
const PPM = {
  total_initiatives: 9,
  by_subtype: { project: 5, program: 4 },
  by_status: { active: 6, onHold: 3 },
  total_budget: 1,
  total_actual: 1,
  health_schedule: HEALTH(6),
  health_cost: HEALTH(5),
  health_scope: HEALTH(4),
};
const BPM = {
  total_processes: 12,
  by_process_type: { core: 8, support: 4 },
  by_maturity: { "3": 5, unknown: 7 },
  by_automation: { manual: 12 },
  by_risk: { high: 2, low: 10 },
  diagram_coverage: { with_diagram: 9, total: 12, percentage: 75 },
};

describe("extractSeries", () => {
  const single = (source: string, series: string, payload: unknown) => {
    const out = extractSeries(source, series, payload);
    expect(out?.shape).toBe("single");
    return out?.shape === "single" ? out.value : NaN;
  };
  const rows = (source: string, series: string, payload: unknown) => {
    const out = extractSeries(source, series, payload);
    expect(out?.shape).toBe("keyed");
    return out?.shape === "keyed" ? out.rows : [];
  };

  it("reads every risk series, open = total − closed − accepted", () => {
    expect(single("risks_metrics", "total", RISKS)).toBe(10);
    expect(single("risks_metrics", "open", RISKS)).toBe(7);
    expect(single("risks_metrics", "overdue", RISKS)).toBe(2);
    // Levels always show all four, most severe first.
    expect(rows("risks_metrics", "by_level", RISKS)).toEqual([
      { key: "critical", value: 0 },
      { key: "high", value: 4 },
      { key: "medium", value: 0 },
      { key: "low", value: 6 },
    ]);
    expect(rows("risks_metrics", "by_status", RISKS).map((r) => r.key)).toEqual([
      "identified",
      "in_progress",
      "accepted",
      "closed",
    ]);
    expect(rows("risks_metrics", "by_category", RISKS).map((r) => r.key)).toEqual(["security", "strategic", "custom"]);
  });

  it("reads the compliance score per regulation and their mean", () => {
    expect(single("compliance_overview", "score_avg", COMPLIANCE)).toBe(70);
    expect(single("compliance_overview", "score_avg", { compliance_scores: {} })).toBe(0);
    expect(rows("compliance_overview", "scores", COMPLIANCE)).toEqual([
      { key: "gdpr", value: 80 },
      { key: "nis2", value: 60 },
    ]);
  });

  it("reads every PPM series, at risk = schedule at risk + off track", () => {
    expect(single("ppm_dashboard", "total", PPM)).toBe(9);
    expect(single("ppm_dashboard", "at_risk", PPM)).toBe(3);
    expect(rows("ppm_dashboard", "by_status", PPM)).toEqual([
      { key: "active", value: 6 },
      { key: "onHold", value: 3 },
    ]);
    expect(rows("ppm_dashboard", "by_subtype", PPM).map((r) => r.key)).toEqual(["project", "program"]);
    for (const [series, onTrack] of [
      ["health_schedule", 6],
      ["health_cost", 5],
      ["health_scope", 4],
    ] as const) {
      expect(rows("ppm_dashboard", series, PPM)).toEqual([
        { key: "onTrack", value: onTrack },
        { key: "atRisk", value: 2 },
        { key: "offTrack", value: 1 },
        { key: "noReport", value: 0 },
      ]);
    }
  });

  it("reads every BPM series, without diagram = processes − with a diagram", () => {
    expect(single("bpm_dashboard", "total", BPM)).toBe(12);
    expect(single("bpm_dashboard", "without_diagram", BPM)).toBe(3);
    expect(rows("bpm_dashboard", "by_maturity", BPM)).toEqual([
      { key: "unknown", value: 7 },
      { key: "3", value: 5 },
    ]);
    expect(rows("bpm_dashboard", "by_process_type", BPM)).toEqual([
      { key: "core", value: 8 },
      { key: "support", value: 4 },
    ]);
    expect(rows("bpm_dashboard", "by_automation", BPM)).toEqual([{ key: "manual", value: 12 }]);
    expect(rows("bpm_dashboard", "by_risk", BPM)).toEqual([
      { key: "low", value: 10 },
      { key: "high", value: 2 },
    ]);
  });

  it("covers every (source, series) and never goes negative", () => {
    const payloads: Record<string, unknown> = {
      risks_metrics: RISKS,
      compliance_overview: COMPLIANCE,
      ppm_dashboard: PPM,
      bpm_dashboard: BPM,
    };
    for (const source of MODULE_SOURCE_NAMES) {
      for (const series of SOURCE_SERIES[source]) {
        const out = extractSeries(source, series, payloads[source]);
        expect(out?.shape, `${source}.${series}`).toBe(seriesShape(series));
      }
    }
    expect(single("risks_metrics", "open", { total: 1, by_status: { closed: 5 } })).toBe(0);
    expect(single("bpm_dashboard", "without_diagram", { diagram_coverage: { total: 1, with_diagram: 4 } })).toBe(0);
  });

  it("is null before the payload arrives or for an unknown series", () => {
    expect(extractSeries("risks_metrics", "open", undefined)).toBeNull();
    expect(extractSeries("risks_metrics", "scores", RISKS)).toBeNull();
    expect(extractSeries("nope", "total", RISKS)).toBeNull();
  });

  it("treats a malformed payload as zeros", () => {
    expect(single("risks_metrics", "total", { total: "x" })).toBe(0);
    expect(rows("ppm_dashboard", "by_status", { by_status: null })).toEqual([]);
    expect(keyedRows({ a: 1, b: 2 }, ["b"])).toEqual([
      { key: "b", value: 2 },
      { key: "a", value: 1 },
    ]);
  });
});

describe("sourceSeriesResolver", () => {
  const INITIATIVE = makeCardType({
    key: "Initiative",
    subtypes: [makeSubtype({ key: "project", label: "Project" }), makeSubtype({ key: "program", label: "Programme" })],
    fields_schema: [
      makeSection({
        fields: [
          makeField({
            key: "initiativeStatus",
            type: "single_select",
            options: [makeOption({ key: "active", label: "Active", color: "#00aa00" }), makeOption({ key: "onHold", label: "On hold" })],
          }),
        ],
      }),
    ],
  });
  const PROCESS = makeCardType({
    key: "BusinessProcess",
    fields_schema: [
      makeSection({
        fields: [
          makeField({ key: "maturity", type: "single_select", options: [makeOption({ key: "3", label: "Defined" })] }),
          makeField({ key: "riskLevel", type: "single_select", options: [makeOption({ key: "low", label: "Low risk" })] }),
        ],
      }),
    ],
  });
  const deps: ResolverDeps = {
    types: [...CARD_TYPES, INITIATIVE, PROCESS],
    t: i18n.getFixedT("en", "common"),
    locale: "en",
    typeLabel: (ct) => typeLabel(ct, "en"),
    inlineLabel: (e) => fieldLabel(e, "en"),
    categorical: CHART_CATEGORICAL.light,
  };
  const tc = (k: string) => i18n.t(`common:${k}`);

  it("names and colours risk levels on the severity scale", () => {
    const r = sourceSeriesResolver("risks_metrics", "by_level", deps);
    expect(r.label("critical")).toBe(i18n.t("grc:risks.level.critical"));
    expect(r.color("critical", 3)).toBe(SEVERITY_COLORS.critical);
    expect(r.color("low", 0)).toBe(SEVERITY_COLORS.low);
  });

  it("names risk statuses and categories from the GRC strings, in fixed hues", () => {
    const status = sourceSeriesResolver("risks_metrics", "by_status", deps);
    expect(status.label("mitigation_planned")).toBe(i18n.t("grc:risks.status.mitigation_planned"));
    expect(status.color("analysed", 7)).toBe(CHART_CATEGORICAL.light[1]);
    expect(status.label("odd")).toBe("odd");
    const category = sourceSeriesResolver("risks_metrics", "by_category", deps);
    expect(category.label("security")).toBe(i18n.t("grc:risks.category.security"));
  });

  it("names regulations through the given resolver, else the built-in label", () => {
    const own = sourceSeriesResolver("compliance_overview", "scores", { ...deps, regulationLabel: (k) => `R:${k}` });
    expect(own.label("gdpr")).toBe("R:gdpr");
    const builtIn = sourceSeriesResolver("compliance_overview", "scores", deps);
    expect(builtIn.label("gdpr")).toBe(i18n.t("admin:compliance_regulation_gdpr"));
    expect(builtIn.label("custom_reg")).toBe("custom_reg");
    expect(builtIn.colorByCategory).toBe(false);
  });

  it("colours PPM health by status", () => {
    const r = sourceSeriesResolver("ppm_dashboard", "health_cost", deps);
    expect(r.label("atRisk")).toBe(i18n.t("ppm:health_atRisk"));
    expect(r.color("onTrack", 0)).toBe(STATUS_COLORS.success);
    expect(r.color("offTrack", 0)).toBe(STATUS_COLORS.error);
    expect(r.color("noReport", 0)).toBe(HEALTH_SERIES_COLORS.noReport);
  });

  it("names PPM status and subtype, and BPM keys, from the metamodel", () => {
    const status = sourceSeriesResolver("ppm_dashboard", "by_status", deps);
    expect(status.label("active")).toBe("Active");
    expect(status.color("active", 4)).toBe("#00aa00");
    expect(status.color("onHold", 4)).toBe(CHART_CATEGORICAL.light[1]);
    const subtype = sourceSeriesResolver("ppm_dashboard", "by_subtype", deps);
    expect(subtype.label("program")).toBe("Programme");
    expect(subtype.label("Other")).toBe(tc("labels.notSet"));
    const maturity = sourceSeriesResolver("bpm_dashboard", "by_maturity", deps);
    expect(maturity.label("3")).toBe("Defined");
    expect(maturity.label("unknown")).toBe(tc("labels.notSet"));
    expect(maturity.color("unknown", 0)).toBe(STATUS_COLORS.neutral);
    const risk = sourceSeriesResolver("bpm_dashboard", "by_risk", deps);
    expect(risk.label("low")).toBe("Low risk");
    // A risk level that is not an option still reads on the severity scale.
    expect(risk.color("critical", 0)).toBe(SEVERITY_COLORS.critical);
  });

  it("names and greys the folded row everywhere", () => {
    for (const [source, series] of [
      ["risks_metrics", "by_level"],
      ["compliance_overview", "scores"],
      ["bpm_dashboard", "by_automation"],
      ["risks_metrics", "total"],
    ]) {
      const r = sourceSeriesResolver(source, series, deps);
      expect(r.label(OTHER_KEY)).toBe(tc("dashboard.query.other"));
      expect(r.color(OTHER_KEY, 0)).toBe(STATUS_COLORS.neutral);
    }
  });
});
