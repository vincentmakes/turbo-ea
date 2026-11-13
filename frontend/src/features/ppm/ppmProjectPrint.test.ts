import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPrintHtml } from "@/lib/printDocument";
import type {
  Card,
  PpmBudgetLine,
  PpmCostLine,
  PpmRisk,
  PpmRollupOut,
  PpmStatusReport,
  PpmTask,
  PpmWbs,
} from "@/types";
import {
  buildProjectPrintBody,
  loadPrintSections,
  orderedSections,
  PPM_PDF_PREFS_KEY,
  PPM_PRINT_SECTIONS,
  PROJECT_PRINT_CSS,
  RISK_COLUMN_WIDTHS,
  SCHEDULE_COLUMN_WIDTHS,
  SCHEDULE_COLUMN_WIDTHS_NO_TIMELINE,
  printProject,
  projectPrintDocument,
  savePrintSections,
  WBS_INDENT_PX,
  type ProjectPrintData,
  type ProjectPrintFormat,
} from "./ppmProjectPrint";
import {
  YEAR_BAND_TINT,
  budgetBar,
  chip,
  completionRing,
  healthDot,
  kpiTile,
  legend,
  priorityColor,
  riskHeatMap,
  riskStatusBreakdown,
  taskBarColors,
  tileRow,
  timelineLane,
  timelineModel,
  timelineScale,
} from "./ppmProjectPrintVisuals";
import { PRINT_COLORS, RAG_COLORS, STATUS_COLORS, brand } from "@/theme/tokens";

const FMT: ProjectPrintFormat = {
  amount: (n) => `$${n}`,
  date: (iso) => `D(${iso})`,
  dateTime: (v) => `DT(${typeof v === "string" ? v : v.toISOString()})`,
  fiscalYearStart: 1,
  amountCompact: (n) => `C(${n})`,
  currency: "USD",
  isRtl: false,
};

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: "i1",
    type: "Initiative",
    name: "ERP Replacement",
    subtype: "project",
    description: "Replace the ERP.\nSecond line.",
    status: "ACTIVE",
    approval_status: "DRAFT",
    data_quality: 0,
    attributes: { startDate: "2026-01-01", endDate: "2026-12-31" },
    lifecycle: {},
    parent_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as Card;
}

function report(overrides: Partial<PpmStatusReport> = {}): PpmStatusReport {
  return {
    id: "r1",
    initiative_id: "i1",
    reporter_id: "u1",
    reporter: { id: "u1", display_name: "Ada Lovelace" },
    report_date: "2026-03-01",
    schedule_health: "onTrack",
    cost_health: "atRisk",
    scope_health: "offTrack",
    summary: "Latest summary text",
    accomplishments: "Did things",
    next_steps: "Do more things",
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function budget(overrides: Partial<PpmBudgetLine> = {}): PpmBudgetLine {
  return {
    id: "b1",
    initiative_id: "i1",
    fiscal_year: 2026,
    category: "capex",
    description: "Licences",
    amount: 100,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function cost(overrides: Partial<PpmCostLine> = {}): PpmCostLine {
  return {
    id: "c1",
    initiative_id: "i1",
    description: "Invoice",
    category: "opex",
    planned: 0,
    actual: 40,
    date: "2026-02-10",
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function risk(overrides: Partial<PpmRisk> = {}): PpmRisk {
  return {
    id: "k1",
    initiative_id: "i1",
    title: "Risk",
    description: null,
    probability: 1,
    impact: 1,
    risk_score: 1,
    mitigation: null,
    owner_id: null,
    owner_name: null,
    status: "open",
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function wbs(overrides: Partial<PpmWbs> = {}): PpmWbs {
  return {
    id: "w1",
    initiative_id: "i1",
    parent_id: null,
    title: "Package",
    description: null,
    start_date: "2026-01-05",
    end_date: "2026-02-05",
    sort_order: 0,
    is_milestone: false,
    completion: 42.4,
    assignee_id: null,
    assignee_name: "Grace Hopper",
    progress: 0,
    task_count: 0,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function task(overrides: Partial<PpmTask> = {}): PpmTask {
  return {
    id: "t1",
    initiative_id: "i1",
    title: "Task",
    description: null,
    status: "in_progress",
    priority: "high",
    assignee_id: null,
    assignee_name: "Alan Turing",
    start_date: "2026-01-10",
    due_date: "2026-01-20",
    sort_order: 0,
    tags: [],
    wbs_id: null,
    comment_count: 0,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function rollup(overrides: Partial<PpmRollupOut> = {}): PpmRollupOut {
  return {
    descendant_count: 2,
    capex_planned: 0,
    capex_actual: 0,
    opex_planned: 0,
    opex_actual: 0,
    total_planned: 0,
    total_actual: 0,
    start_date: null,
    end_date: null,
    has_budget_lines: false,
    has_cost_lines: false,
    by_year: [],
    ...overrides,
  };
}

function data(overrides: Partial<ProjectPrintData> = {}): ProjectPrintData {
  return {
    card: card(),
    subtypeLabel: "Project",
    initiativeStatusLabel: "On Track",
    reports: [],
    costLines: [],
    budgetLines: [],
    risks: [],
    rollup: null,
    completion: null,
    wbs: [],
    tasks: [],
    ...overrides,
  };
}

const ALL = [...PPM_PRINT_SECTIONS];
const HEADINGS = {
  overview: "<h2>Overview</h2>",
  reports: "<h2>Status Reports</h2>",
  costs: "<h2>Budget &amp; Costs</h2>",
  risks: "<h2>Risk Management</h2>",
  schedule: "<h2>Tasks &amp; Schedule</h2>",
} as const;

/** The text between one `<h2>` and the next (or the end). */
function sectionOf(html: string, heading: string): string {
  const start = html.indexOf(heading);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = html.indexOf("<h2>", start + heading.length);
  return html.slice(start, next < 0 ? undefined : next);
}


describe("buildProjectPrintBody — sections", () => {
  it("prints only the header when nothing is ticked", () => {
    const html = buildProjectPrintBody(data(), [], FMT);
    expect(html.startsWith('<h1 style="text-align:center;border:none;">Initiative Report</h1>')).toBe(true);
    expect(html).toContain(">ERP Replacement</p>");
    expect(html).not.toContain("<h2>");
  });

  it.each(ALL)("prints the %s section alone, and no other", (s) => {
    const html = buildProjectPrintBody(data(), [s], FMT);
    for (const other of ALL) {
      if (other === s) expect(html).toContain(HEADINGS[other]);
      else expect(html).not.toContain(HEADINGS[other]);
    }
  });

  it("prints every section in the fixed order whatever order they were ticked in", () => {
    const html = buildProjectPrintBody(data(), ["schedule", "risks", "overview", "costs", "reports"], FMT);
    const positions = ALL.map((s) => html.indexOf(HEADINGS[s]));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("ignores unknown section names", () => {
    const html = buildProjectPrintBody(data(), ["bogus", "risks"], FMT);
    expect(html.match(/<h2>/g)).toHaveLength(1);
    expect(html).toContain(HEADINGS.risks);
  });

  it.each(["reports", "costs", "risks", "schedule"] as const)(
    "prints one 'nothing recorded' line for an empty %s section",
    (s) => {
      const html = buildProjectPrintBody(data(), [s], FMT);
      expect(sectionOf(html, HEADINGS[s])).toBe(
        `${HEADINGS[s]}<p class="pre">Nothing recorded.</p>`,
      );
    },
  );
});

describe("cover", () => {
  it("shows the subtype and status chips and the printed date under the name", () => {
    const now = new Date("2026-11-13T10:00:00Z");
    const html = buildProjectPrintBody(data(), [], FMT, now);
    expect(html).toContain(
      ">ERP Replacement</p>" +
        `<div class="pdf-cover-chips">${chip("Project", PRINT_COLORS.inkSecondary, "outlined")}` +
        `${chip("On Track", PRINT_COLORS.inkSecondary, "outlined")}</div>` +
        '<p class="pdf-printed">Printed: <bdi>DT(2026-11-13T10:00:00.000Z)</bdi></p>',
    );
  });

  it.each([
    [{ subtypeLabel: null }, ["On Track"], ["Project"]],
    [{ initiativeStatusLabel: null }, ["Project"], ["On Track"]],
  ])("prints only the chips it has (%o)", (overrides, present, absent) => {
    const html = buildProjectPrintBody(data(overrides), [], FMT);
    for (const p of present) expect(html).toContain(`">${p}</span>`);
    for (const a of absent) expect(html).not.toContain(`">${a}</span>`);
  });

  it("draws the status chip in the status's own colour when the dialog resolved one", () => {
    const html = buildProjectPrintBody(data({ initiativeStatusColor: RAG_COLORS.amber }), [], FMT);
    expect(html).toContain(chip("On Track", RAG_COLORS.amber, "outlined"));
    expect(html).not.toContain(chip("On Track", PRINT_COLORS.inkSecondary, "outlined"));
  });

  it("isolates the printed date so it keeps its order in a right-to-left sentence", () => {
    const out = buildPrintHtml(projectPrintDocument(data(), [], FMT, new Date("2026-11-13T10:00:00Z")));
    expect(out).toContain('<p class="pdf-printed">Printed: <bdi>DT(2026-11-13T10:00:00.000Z)</bdi></p>');
  });

  it("escapes a hostile date format around the isolated date", () => {
    const html = buildProjectPrintBody(data(), [], { ...FMT, dateTime: () => "<b>x</b>" });
    expect(html).toContain('<p class="pdf-printed">Printed: <bdi>&lt;b&gt;x&lt;/b&gt;</bdi></p>');
  });

  it("has no chip row when there is neither", () => {
    const html = buildProjectPrintBody(
      data({ subtypeLabel: null, initiativeStatusLabel: null }),
      [],
      FMT,
    );
    expect(html).not.toContain("pdf-cover-chips");
  });
});

describe("overview", () => {
  it("shows the KPI tiles, ring, health dots, budget bars, facts and description", () => {
    const html = buildProjectPrintBody(
      data({
        reports: [report(), report({ id: "r0", schedule_health: "offTrack" })],
        completion: { completion: 66.6, wbs_count: 3 },
        budgetLines: [budget(), budget({ id: "b2", category: "opex", amount: 50 })],
        costLines: [cost(), cost({ id: "c2", category: "capex", actual: 70 })],
      }),
      ["overview"],
      FMT,
    );
    const s = sectionOf(html, HEADINGS.overview);
    expect(s).toContain(
      tileRow([
        kpiTile("Total Budget", "150 USD", { derived: false }),
        kpiTile("Total Actual", "110 USD", { derived: false }),
        kpiTile("Variance", "C(40)", { color: STATUS_COLORS.success, derived: false }),
      ]),
    );
    expect(s).toContain(
      '<div class="pdf-panel"><div class="pdf-panel-title">Completion</div><div class="pdf-ring-row">' +
        completionRing(66.6, false) +
        '<span class="pdf-note">Average completion across work packages</span></div></div>',
    );
    expect(s).toContain(
      '<div class="pdf-panel"><div class="pdf-panel-title">Health Summary</div>' +
        `<div class="pdf-health-row"><span class="pdf-health-caption">Schedule</span>${healthDot("onTrack", "On Track")}</div>` +
        `<div class="pdf-health-row"><span class="pdf-health-caption">Cost</span>${healthDot("atRisk", "At Risk")}</div>` +
        `<div class="pdf-health-row"><span class="pdf-health-caption">Scope</span>${healthDot("offTrack", "Off Track")}</div></div>`,
    );
    const bar = (label: string, budgetV: number, actualV: number) =>
      budgetBar({ label, budget: budgetV, actual: actualV, currency: "USD", derivedBudget: false, derivedActual: false });
    expect(s).toContain(
      '<div class="pdf-panels"><div class="pdf-panel"><div class="pdf-panel-title">Financials</div>' +
        bar("Total", 150, 110) +
        bar("CapEx", 100, 70) +
        bar("OpEx", 50, 40) +
        "</div></div>",
    );
    expect(s).toContain(
      '<div class="pdf-facts"><div class="pdf-fact"><div class="pdf-fact-label">Start Date</div><div class="pdf-fact-value"><bdi>D(2026-01-01)</bdi></div></div>' +
        '<div class="pdf-fact"><div class="pdf-fact-label">End Date</div><div class="pdf-fact-value"><bdi>D(2026-12-31)</bdi></div></div></div>',
    );
    expect(s).toContain('<h3>Description</h3><p class="pre">Replace the ERP.\nSecond line.</p>');
    expect(s).not.toContain("pdf-note\">No ");
  });

  it("draws the ring right to left when the document reads that way", () => {
    const html = buildProjectPrintBody(
      data({ completion: { completion: 50, wbs_count: 1 } }),
      ["overview"],
      { ...FMT, isRtl: true },
    );
    expect(html).toContain(completionRing(50, true));
  });

  it("keeps the variance green at exactly zero", () => {
    const html = buildProjectPrintBody(
      data({ budgetLines: [budget({ amount: 10 })], costLines: [cost({ actual: 10 })] }),
      ["overview"],
      FMT,
    );
    expect(html).toContain(kpiTile("Variance", "C(0)", { color: STATUS_COLORS.success, derived: false }));
  });

  it("skips an empty date attribute", () => {
    const html = buildProjectPrintBody(
      data({ card: card({ attributes: { startDate: "", endDate: "" } }) }),
      ["overview"],
      FMT,
    );
    expect(html).not.toContain("pdf-facts");
  });

  it("turns the variance red once actuals exceed the budget", () => {
    const html = buildProjectPrintBody(
      data({ budgetLines: [budget({ amount: 10 })], costLines: [cost({ actual: 30 })] }),
      ["overview"],
      FMT,
    );
    expect(html).toContain(kpiTile("Variance", "C(-20)", { color: STATUS_COLORS.error, derived: false }));
  });

  it("says 'no report' and 'no work packages' and drops what the card lacks", () => {
    const html = buildProjectPrintBody(
      data({
        card: card({ description: "  ", attributes: {} }),
        completion: { completion: 0, wbs_count: 0 },
      }),
      ["overview"],
      FMT,
    );
    expect(html).toContain(
      '<div class="pdf-panel-title">Completion</div><p class="pre">No work packages yet</p></div>',
    );
    expect(html).toContain('<div class="pdf-panel-title">Health Summary</div><p class="pre">No Report</p></div>');
    expect(html).not.toContain("pdf-facts");
    expect(html).not.toContain("<h3>Description</h3>");
    expect(html).not.toContain("<svg");
  });

  it("prints only the dates the card has, and leaves completion out when it was not read", () => {
    const html = buildProjectPrintBody(
      data({ card: card({ attributes: { endDate: "2026-05-05", startDate: 7 } }), completion: null }),
      ["overview"],
      FMT,
    );
    expect(html).toContain(
      '<div class="pdf-facts"><div class="pdf-fact"><div class="pdf-fact-label">End Date</div><div class="pdf-fact-value"><bdi>D(2026-05-05)</bdi></div></div></div>',
    );
    expect(html).not.toContain(">Completion<");
    expect(html).not.toContain("Start Date");
  });

  it("outlines and italicises a derived budget and says where it comes from", () => {
    const html = buildProjectPrintBody(
      data({
        costLines: [cost()],
        rollup: rollup({
          by_year: [{ year: 2026, capex_budget: 300, opex_budget: 200, capex_actual: 0, opex_actual: 0 }],
        }),
      }),
      ["overview"],
      FMT,
    );
    expect(html).toContain(kpiTile("Total Budget", "500 USD", { derived: true }));
    expect(html).toContain(kpiTile("Total Actual", "40 USD", { derived: false }));
    expect(html).toContain(kpiTile("Variance", "C(460)", { color: STATUS_COLORS.success, derived: true }));
    expect(html).toContain(
      budgetBar({ label: "Total", budget: 500, actual: 40, currency: "USD", derivedBudget: true, derivedActual: false }),
    );
    expect(html).toContain(
      '<p class="pdf-note">No budget lines of its own: budget of the 2 initiatives beneath it</p></div></div>',
    );
    expect(html).not.toContain("No cost lines of its own");
  });

  it("notes derived actuals on their own", () => {
    const html = buildProjectPrintBody(
      data({
        budgetLines: [budget()],
        rollup: rollup({
          by_year: [{ year: 2026, capex_budget: 0, opex_budget: 0, capex_actual: 5, opex_actual: 0 }],
        }),
      }),
      ["overview"],
      FMT,
    );
    expect(html).toContain(kpiTile("Total Actual", "5 USD", { derived: true }));
    expect(html).toContain(kpiTile("Total Budget", "100 USD", { derived: false }));
    expect(html).toContain(
      budgetBar({ label: "CapEx", budget: 100, actual: 5, currency: "USD", derivedBudget: false, derivedActual: true }),
    );
    expect(html).toContain(
      '<p class="pdf-note">No cost lines of its own: actuals of the 2 initiatives beneath it</p>',
    );
    expect(html).not.toContain("No budget lines of its own");
  });
});

describe("status reports", () => {
  it("prints the newest as a card and earlier ones only as a health history", () => {
    const html = buildProjectPrintBody(
      data({
        reports: [
          report({ accomplishments: "Line one\nLine two" }),
          report({
            id: "r0",
            report_date: "2026-02-01",
            reporter: null,
            schedule_health: "atRisk",
            cost_health: "onTrack",
            scope_health: "weird",
            summary: "OLDER SUMMARY",
            accomplishments: "OLDER DONE",
            next_steps: "OLDER NEXT",
          }),
        ],
      }),
      ["reports"],
      FMT,
    );
    const s = sectionOf(html, HEADINGS.reports);
    const rating = (caption: string, value: string, label: string) =>
      `<span class="pdf-card-rating"><span class="pdf-health-caption">${caption}</span> ${healthDot(value, label)}</span>`;
    expect(s).toContain(
      '<h3>Latest report</h3><div class="pdf-card">' +
        '<div class="pdf-card-head"><strong><bdi>D(2026-03-01)</bdi></strong> · Reporter: Ada Lovelace</div>' +
        '<div class="pdf-card-health">' +
        rating("Schedule", "onTrack", "On Track") +
        rating("Cost", "atRisk", "At Risk") +
        rating("Scope", "offTrack", "Off Track") +
        "</div>" +
        '<div class="pdf-card-label">Summary</div><p class="pre">Latest summary text</p>' +
        '<div class="pdf-card-label">Accomplishments</div><p class="pre">Line one\nLine two</p>' +
        '<div class="pdf-card-label">Next Steps</div><p class="pre">Do more things</p></div>',
    );
    expect(s).toContain(
      "<h3>Earlier reports</h3><table><thead><tr>" +
        '<th class="date">Report Date</th><th>Reporter</th><th>Schedule</th><th>Cost</th><th>Scope</th></tr></thead><tbody>' +
        `<tr><td class="date">D(2026-02-01)</td><td>—</td><td>${healthDot("atRisk", "At Risk")}</td>` +
        `<td>${healthDot("onTrack", "On Track")}</td><td>${healthDot("weird", "weird")}</td></tr></tbody></table>`,
    );
    expect(s).not.toContain("OLDER");
  });

  it("has no earlier list for one report, and leaves out a missing reporter and empty texts", () => {
    const html = buildProjectPrintBody(
      data({ reports: [report({ summary: "  ", accomplishments: null, reporter: null })] }),
      ["reports"],
      FMT,
    );
    expect(html).toContain('<div class="pdf-card-head"><strong><bdi>D(2026-03-01)</bdi></strong></div>');
    expect(html).not.toContain("Earlier reports");
    expect(html).not.toContain(">Summary<");
    expect(html).not.toContain(">Accomplishments<");
    expect(html).toContain('<div class="pdf-card-label">Next Steps</div>');
  });
});

describe("budget & costs visuals", () => {
  const CHART = (name: string) => ({ src: `data:image/svg+xml;base64,${name}`, title: `${name} chart` });

  it("opens with the five tiles, then the charts, then the tables", () => {
    const html = buildProjectPrintBody(
      data({
        budgetLines: [budget(), budget({ id: "b2", category: "opex", amount: 50 })],
        costLines: [cost(), cost({ id: "c2", category: "capex", actual: 70 })],
        charts: { fiscalYear: CHART("FY"), project: CHART("PROJ") },
      }),
      ["costs"],
      FMT,
    );
    const s = sectionOf(html, HEADINGS.costs);
    expect(s).toContain(
      `${HEADINGS.costs}${tileRow([
        kpiTile("Total Budget", "150 USD", { derived: false }),
        kpiTile("Total Actual", "110 USD", { derived: false }),
        kpiTile("Variance", "C(40)", { color: STATUS_COLORS.success, derived: false }),
        kpiTile("CapEx", "70 USD", { sub: { html: "of <bdi>100 USD</bdi> budget" }, derived: false }),
        kpiTile("OpEx", "40 USD", { sub: { html: "of <bdi>50 USD</bdi> budget" }, derived: false }),
      ])}` +
        '<figure class="pdf-chart"><figcaption>FY chart</figcaption><img src="data:image/svg+xml;base64,FY" alt="FY chart"></figure>' +
        '<figure class="pdf-chart"><figcaption>PROJ chart</figcaption><img src="data:image/svg+xml;base64,PROJ" alt="PROJ chart"></figure>' +
        "<h3>Planned Budget</h3>",
    );
  });

  it.each([
    ["no charts at all", undefined, []],
    ["only the fiscal year", { fiscalYear: CHART("FY") }, ["FY chart"]],
    ["only the project", { project: CHART("PROJ") }, ["PROJ chart"]],
  ])("prints %s without an empty frame", (_label, charts, titles) => {
    const html = buildProjectPrintBody(
      data({ costLines: [cost()], charts: charts as ProjectPrintData["charts"] }),
      ["costs"],
      FMT,
    );
    expect((html.match(/<figure/g) ?? []).length).toBe(titles.length);
    for (const title of titles) expect(html).toContain(`<figcaption>${title}</figcaption>`);
  });

  it("marks the derived side's tiles italic and colours an overrun red", () => {
    const html = buildProjectPrintBody(
      data({
        budgetLines: [budget({ amount: 10 })],
        rollup: rollup({
          by_year: [{ year: 2026, capex_budget: 0, opex_budget: 0, capex_actual: 30, opex_actual: 0 }],
        }),
      }),
      ["costs"],
      FMT,
    );
    expect(html).toContain(kpiTile("Total Actual", "30 USD", { derived: true }));
    expect(html).toContain(kpiTile("Variance", "C(-20)", { color: STATUS_COLORS.error, derived: true }));
    expect(html).toContain(kpiTile("CapEx", "30 USD", { sub: { html: "of <bdi>10 USD</bdi> budget" }, derived: true }));
  });

  it("escapes a chart's title and source and keeps the image through the sanitiser", () => {
    const html = buildProjectPrintBody(
      data({ costLines: [cost()], charts: { project: { src: 'data:image/svg+xml;base64,AB"x', title: "<b>T</b>" } } }),
      ["costs"],
      FMT,
    );
    expect(html).toContain(
      '<figcaption>&lt;b&gt;T&lt;/b&gt;</figcaption><img src="data:image/svg+xml;base64,AB&quot;x" alt="&lt;b&gt;T&lt;/b&gt;">',
    );
    const out = buildPrintHtml(
      projectPrintDocument(
        data({ costLines: [cost()], charts: { project: CHART("PROJ") } }),
        ["costs"],
        FMT,
      ),
    );
    expect(out).toContain(
      '<figure class="pdf-chart"><figcaption>PROJ chart</figcaption><img src="data:image/svg+xml;base64,PROJ" alt="PROJ chart"></figure>',
    );
  });
});

describe("budget & costs", () => {
  it("groups both sides by fiscal year with subtotals and grand totals", () => {
    const html = buildProjectPrintBody(
      data({
        budgetLines: [
          budget({ id: "b3", fiscal_year: 2027, amount: 5, description: null }),
          budget(),
          budget({ id: "b2", category: "opex", amount: 50, description: "Run" }),
          budget({ id: "b4", category: "other" as never, amount: 7, description: "Misc" }),
        ],
        costLines: [
          cost({ id: "c3", date: null, description: "No date", actual: 3 }),
          cost({ id: "c2", date: "2025-06-01", category: "capex", actual: 70, description: "Old" }),
          cost(),
        ],
      }),
      ["costs"],
      FMT,
    );
    const s = sectionOf(html, HEADINGS.costs);
    expect(s).toContain(
      '<h3>Planned Budget</h3><table><thead><tr><th class="pre">Description</th><th class="num">CapEx</th><th class="num">OpEx</th><th class="num">Total</th></tr></thead><tbody>' +
        '<tr class="pdf-group"><td class="pre">FY 2026</td><td class="num">$100</td><td class="num">$50</td><td class="num">$157</td></tr>' +
        `<tr><td class="pre" style="padding-inline-start:${10 + WBS_INDENT_PX}px">Licences</td><td class="num">$100</td><td class="num"></td><td class="num"></td></tr>` +
        `<tr><td class="pre" style="padding-inline-start:${10 + WBS_INDENT_PX}px">Run</td><td class="num"></td><td class="num">$50</td><td class="num"></td></tr>` +
        `<tr><td class="pre" style="padding-inline-start:${10 + WBS_INDENT_PX}px">Misc</td><td class="num"></td><td class="num"></td><td class="num">$7</td></tr>` +
        '<tr class="pdf-group"><td class="pre">FY 2027</td><td class="num">$5</td><td class="num">$0</td><td class="num">$5</td></tr>' +
        `<tr><td class="pre" style="padding-inline-start:${10 + WBS_INDENT_PX}px">—</td><td class="num">$5</td><td class="num"></td><td class="num"></td></tr>` +
        '<tr class="pdf-total"><td class="pre">Total, all fiscal years</td><td class="num">$105</td><td class="num">$50</td><td class="num">$162</td></tr></tbody></table>',
    );
    expect(s).toContain(
      '<h3>Cost Items</h3><table><thead><tr><th class="pre">Description</th><th class="date">Date</th><th class="num">CapEx</th><th class="num">OpEx</th><th class="num">Total</th></tr></thead><tbody>' +
        '<tr class="pdf-group"><td class="pre">FY 2025</td><td class="date"></td><td class="num">$70</td><td class="num">$0</td><td class="num">$70</td></tr>' +
        `<tr><td class="pre" style="padding-inline-start:${10 + WBS_INDENT_PX}px">Old</td><td class="date">D(2025-06-01)</td><td class="num">$70</td><td class="num"></td><td class="num"></td></tr>` +
        '<tr class="pdf-group"><td class="pre">FY 2026</td><td class="date"></td><td class="num">$0</td><td class="num">$40</td><td class="num">$40</td></tr>' +
        `<tr><td class="pre" style="padding-inline-start:${10 + WBS_INDENT_PX}px">Invoice</td><td class="date">D(2026-02-10)</td><td class="num"></td><td class="num">$40</td><td class="num"></td></tr>` +
        '<tr class="pdf-group"><td class="pre">Undated</td><td class="date"></td><td class="num">$0</td><td class="num">$3</td><td class="num">$3</td></tr>' +
        `<tr><td class="pre" style="padding-inline-start:${10 + WBS_INDENT_PX}px">No date</td><td class="date">—</td><td class="num"></td><td class="num">$3</td><td class="num"></td></tr>` +
        '<tr class="pdf-total"><td class="pre">Total, all fiscal years</td><td class="date"></td><td class="num">$70</td><td class="num">$43</td><td class="num">$113</td></tr></tbody></table>',
    );
  });

  it("names a fiscal year that straddles two calendar years by both", () => {
    const html = buildProjectPrintBody(
      data({ budgetLines: [budget()] }),
      ["costs"],
      { ...FMT, fiscalYearStart: 10 },
    );
    expect(html).toContain('<tr class="pdf-group"><td class="pre">FY 2025–2026</td>');
  });

  it("files cost lines by the fiscal year start month", () => {
    const html = buildProjectPrintBody(
      data({ costLines: [cost({ date: "2025-11-01" })] }),
      ["costs"],
      { ...FMT, fiscalYearStart: 10 },
    );
    expect(html).toContain('<tr class="pdf-group"><td class="pre">FY 2025–2026</td><td class="date"></td>');
  });

  it("says which side has no lines when only the other has", () => {
    const budgetOnly = buildProjectPrintBody(data({ budgetLines: [budget()] }), ["costs"], FMT);
    expect(budgetOnly).toContain('<h3>Cost Items</h3><p class="pre">No cost items yet</p>');
    expect(budgetOnly).not.toContain("Nothing recorded.");
    const costOnly = buildProjectPrintBody(data({ costLines: [cost()] }), ["costs"], FMT);
    expect(costOnly).toContain('<h3>Planned Budget</h3><p class="pre">No budget lines yet</p>');
  });

  it("prints the derived sides as read-only year rows under their caption", () => {
    const html = buildProjectPrintBody(
      data({
        rollup: rollup({
          by_year: [
            { year: 2025, capex_budget: 10, opex_budget: 20, capex_actual: 0, opex_actual: 0 },
            { year: 2026, capex_budget: 1, opex_budget: 0, capex_actual: 4, opex_actual: 6 },
            { year: null, capex_budget: 0, opex_budget: 0, capex_actual: 0, opex_actual: 9 },
          ],
        }),
      }),
      ["costs"],
      FMT,
    );
    expect(html).toContain(
      '<h3>Planned Budget</h3><p class="pdf-note">No budget lines of its own: the budget of the 2 initiatives beneath it, by fiscal year</p>' +
        '<table><thead><tr><th>Fiscal Year</th><th class="num">CapEx</th><th class="num">OpEx</th><th class="num">Total</th></tr></thead><tbody>' +
        '<tr class="derived"><td>FY 2025</td><td class="num">$10</td><td class="num">$20</td><td class="num">$30</td></tr>' +
        '<tr class="derived"><td>FY 2026</td><td class="num">$1</td><td class="num">$0</td><td class="num">$1</td></tr>' +
        '<tr class="pdf-total derived"><td>Total, all fiscal years</td><td class="num">$11</td><td class="num">$20</td><td class="num">$31</td></tr></tbody></table>',
    );
    expect(html).toContain(
      '<h3>Cost Items</h3><p class="pdf-note">No cost lines of its own: the actuals of the 2 initiatives beneath it, by fiscal year</p>' +
        '<table><thead><tr><th>Fiscal Year</th><th class="num">CapEx</th><th class="num">OpEx</th><th class="num">Total</th></tr></thead><tbody>' +
        '<tr class="derived"><td>FY 2026</td><td class="num">$4</td><td class="num">$6</td><td class="num">$10</td></tr>' +
        '<tr class="derived"><td>Undated</td><td class="num">$0</td><td class="num">$9</td><td class="num">$9</td></tr>' +
        '<tr class="pdf-total derived"><td>Total, all fiscal years</td><td class="num">$4</td><td class="num">$15</td><td class="num">$19</td></tr></tbody></table>',
    );
  });

  it.each([
    ["budget", { capex_budget: 8, opex_budget: 0, capex_actual: 0, opex_actual: 0 }, "Cost Items", "No cost items yet", "the budget of"],
    ["cost", { capex_budget: 0, opex_budget: 0, capex_actual: 8, opex_actual: 0 }, "Planned Budget", "No budget lines yet", "the actuals of"],
  ])("prints a derived %s side alone, the other side as empty", (_side, year, otherHeading, otherEmpty, caption) => {
    const html = buildProjectPrintBody(
      data({ rollup: rollup({ by_year: [{ year: 2026, ...year }] }) }),
      ["costs"],
      FMT,
    );
    expect(html).not.toContain("Nothing recorded.");
    expect(html).toContain(caption);
    expect(html).toContain(`<h3>${otherHeading}</h3><p class="pre">${otherEmpty}</p>`);
    expect(html).toContain('<tr class="derived"><td>FY 2026</td><td class="num">$8</td>');
  });

  it("keeps a side's own lines over the figures beneath", () => {
    const html = buildProjectPrintBody(
      data({
        budgetLines: [budget()],
        rollup: rollup({
          by_year: [{ year: 2026, capex_budget: 999, opex_budget: 0, capex_actual: 0, opex_actual: 0 }],
        }),
      }),
      ["costs"],
      FMT,
    );
    expect(html).not.toContain("$999");
    expect(html).toContain('<h3>Cost Items</h3><p class="pre">No cost items yet</p>');
  });
});

describe("risks", () => {
  const RISKS = () => [
    risk({ id: "a", title: "Low one", risk_score: 2, probability: 1, impact: 2, status: "closed" }),
    risk({
      id: "b",
      title: "Top one",
      risk_score: 20,
      probability: 4,
      impact: 5,
      description: LONG,
      mitigation: "1. Book a second vendor\n2. Run https://example.com/a/very/long/unbroken/url/path\nTracking: weekly",
      owner_name: "Ada Lovelace",
      status: "mitigating",
    }),
    risk({ id: "c", title: "Mid one", risk_score: 16, probability: 4, impact: 4, description: "  " }),
  ];
  const LONG = `${"A long description. ".repeat(25)}END-OF-DESCRIPTION\nSecond paragraph`;
  const HEAT_LABELS = {
    title: "Risk heat map",
    probability: "Probability",
    impact: "Impact",
    bands: { high: "High", medium: "Medium", low: "Low" },
  };

  it("sets the heat map beside the tiles and the status breakdown, then a five-column table by score", () => {
    const risks = RISKS();
    const html = buildProjectPrintBody(data({ risks }), ["risks"], FMT);
    const s = sectionOf(html, HEADINGS.risks);
    expect(s).toContain(
      `${HEADINGS.risks}<div class="pdf-keep pdf-risk-top">` +
        riskHeatMap(risks, HEAT_LABELS) +
        '<div class="pdf-risk-side">' +
        tileRow(
          [
            kpiTile("Total Risks", "3"),
            kpiTile("Open", "1", { color: STATUS_COLORS.error }),
            kpiTile("High Risks", "2", { color: RAG_COLORS.red }),
          ],
          "Total risks: 3 · Open: 1 · High: 2",
        ) +
        riskStatusBreakdown(risks, "By status", (st) =>
          ({ open: "Open", mitigating: "Mitigating", mitigated: "Mitigated", closed: "Closed", accepted: "Accepted" })[st] ?? st,
        ) +
        "</div></div>",
    );
    const [w1, w2, w3, w4, w5] = RISK_COLUMN_WIDTHS;
    expect(s).toContain(
      '<table class="pdf-fixed"><thead><tr>' +
        `<th style="width:${w1}">Risk</th>` +
        `<th class="num" style="width:${w2}">Score</th>` +
        `<th style="width:${w3}">Status</th>` +
        `<th style="width:${w4}">Owner</th>` +
        `<th class="pre" style="width:${w5}">Mitigation</th></tr></thead><tbody>` +
        `<tr><td><strong>Top one</strong><div class="pre">${LONG}</div></td>` +
        `<td class="num">${chip("20", RAG_COLORS.red)}<div class="pdf-sub"><bdi>4 × 5</bdi></div></td>` +
        `<td>${chip("Mitigating", STATUS_COLORS.warning, "outlined")}</td><td>Ada Lovelace</td>` +
        '<td class="pre">1. Book a second vendor\n2. Run https://example.com/a/very/long/unbroken/url/path\nTracking: weekly</td></tr>',
    );
    // No description (or a blank one): the title alone; no owner or mitigation: a dash.
    expect(s).toContain(
      `<tr><td><strong>Low one</strong></td><td class="num">${chip("2", RAG_COLORS.green)}<div class="pdf-sub"><bdi>1 × 2</bdi></div></td>` +
        `<td>${chip("Closed", STATUS_COLORS.neutral, "outlined")}</td><td>—</td><td class="pre">—</td></tr>`,
    );
    expect(s).toContain("<tr><td><strong>Mid one</strong></td>");
    const order = ["Top one", "Mid one", "Low one"].map((x) => s.indexOf(`<strong>${x}</strong>`));
    expect(order.every((p) => p >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("leaves the open and high tiles uncoloured at zero", () => {
    const html = buildProjectPrintBody(data({ risks: [risk({ status: "closed" })] }), ["risks"], FMT);
    expect(html).toContain(tileRow([kpiTile("Total Risks", "1"), kpiTile("Open", "0"), kpiTile("High Risks", "0")], "Total risks: 1 · Open: 0 · High: 0"));
  });

  it("keeps the cell markup, the chips, the heat map and the line breaks through the sanitiser", () => {
    const out = buildPrintHtml(projectPrintDocument(data({ risks: RISKS() }), ["risks"], FMT));
    expect(out).toContain('<table class="pdf-fixed"><thead><tr>');
    expect(out).toContain(`<td><strong>Top one</strong><div class="pre">${LONG}</div></td>`);
    expect(out).toContain(`<td class="num">${chip("20", RAG_COLORS.red)}<div class="pdf-sub"><bdi>4 × 5</bdi></div></td>`);
    expect(out).toContain('<td class="pre">1. Book a second vendor\n2. Run <a ');
    expect(out).toContain("</a>\nTracking: weekly</td>");
    expect(out).toContain('<div class="pdf-keep pdf-risk-top"><div class="pdf-heatmap">');
    expect(out).toContain('<div class="pdf-risk-side"><div class="pdf-tiles" role="group" aria-label="Total risks: 3 · Open: 1 · High: 2">');
    // One open, one mitigating, one closed: the breakdown counts each.
    expect(out).toMatch(/Open<\/span><span class="pdf-status-count">1<\/span>/);
    expect(out).toMatch(/Mitigating<\/span><span class="pdf-status-count">1<\/span>/);
    expect(out).toMatch(/Closed<\/span><span class="pdf-status-count">1<\/span>/);
    expect(out).toMatch(/pdf-muted"><span[^>]*>Accepted<\/span><span class="pdf-status-count">0<\/span>/);
    expect(out).toContain('<td class="pdf-heat-cell" data-p="4" data-i="5" style="background:');
    expect(out).toContain('<th class="pdf-heat-axis-y" rowspan="5"><span>Probability</span></th>');
  });

  it("escapes the title, description, owner and mitigation inside built cells", () => {
    const evil = "<b>x</b>";
    const html = buildProjectPrintBody(
      data({ risks: [risk({ title: evil, description: evil, owner_name: evil, mitigation: evil })] }),
      ["risks"],
      FMT,
    );
    expect(html).toContain(
      "<tr><td><strong>&lt;b&gt;x&lt;/b&gt;</strong><div class=\"pre\">&lt;b&gt;x&lt;/b&gt;</div></td>",
    );
    expect(html).toContain("<td>&lt;b&gt;x&lt;/b&gt;</td><td class=\"pre\">&lt;b&gt;x&lt;/b&gt;</td></tr>");
    expect(html).not.toContain("<b>");
  });
});

describe("tasks & schedule", () => {
  const NOW = new Date(2026, 0, 15);
  const [c1, c2, c3] = SCHEDULE_COLUMN_WIDTHS;
  const titleHead = 'Title<div class="pdf-sub">Start Date – End / Due · Owner</div>';
  const progressHead = 'Progress<div class="pdf-sub">Priority</div>';
  const pad = (depth: number) => ` style="padding-inline-start:${10 + depth * WBS_INDENT_PX}px"`;
  const W = () => [
    wbs({ id: "w2", title: "Second root", sort_order: 2, assignee_name: null, completion: 100, end_date: "2026-05-05" }),
    wbs({ id: "w1", title: "First root", sort_order: 1 }),
    wbs({ id: "w1b", parent_id: "w1", title: "Child B", sort_order: 5, start_date: null, end_date: null }),
    wbs({ id: "w1a", parent_id: "w1", title: "Child A", sort_order: 3, is_milestone: true, start_date: "2026-01-20", end_date: "2026-01-20" }),
    wbs({ id: "orphan", parent_id: "gone", title: "Orphan", sort_order: 9 }),
  ];
  const T = () => [
    task({ id: "t2", wbs_id: "w1", title: "Task two", sort_order: 2, status: "done", priority: "low" }),
    task({ id: "t1", wbs_id: "w1", title: "Task one", sort_order: 1 }),
    task({ id: "t3", wbs_id: "w1a", title: "Deep task", status: "blocked", priority: "critical", assignee_name: null, start_date: null }),
    task({ id: "t5", wbs_id: null, title: "Loose B", sort_order: 2, status: "todo", priority: "medium" }),
    task({ id: "t4", wbs_id: "missing", title: "Loose A", sort_order: 1 }),
  ];

  it("draws one timeline row per package and task, nested and in sort order, unassigned tasks last", () => {
    const wbsList = W();
    const tasks = T();
    const html = buildProjectPrintBody(data({ wbs: wbsList, tasks }), ["schedule"], FMT, NOW);
    const s = sectionOf(html, HEADINGS.schedule);
    const model = timelineModel(
      [
        ...wbsList.map((w) => ({ start: w.start_date, end: w.end_date })),
        ...tasks.map((tk) => ({ start: tk.start_date, end: tk.due_date })),
      ],
      NOW,
    )!;
    expect(model).not.toBeNull();
    const head =
      `<table class="pdf-fixed pdf-schedule"><thead><tr><th style="width:${c1}">${titleHead}</th>` +
      `<th class="pdf-tl-cell" style="width:${c2}">${timelineScale(model)}</th>` +
      `<th style="width:${c3}">${progressHead}</th></tr></thead><tbody>`;
    const ownerLine = (owner: string) =>
      owner === "—" ? "" : `<div class="pdf-sub">Owner: <bdi>${owner}</bdi></div>`;
    const pkg = (depth: number, title: string, dates: string, w: ReturnType<typeof wbs>, pct: string, owner: string) =>
      `<tr class="pdf-wbs"><td${depth ? pad(depth) : ""}>${title}${dates}${ownerLine(owner)}</td>` +
      `<td class="pdf-tl-cell">${timelineLane(model, { start: w.start_date, end: w.end_date }, { kind: "package", completion: w.completion, milestone: w.is_milestone })}</td>` +
      `<td><div class="pdf-stack">${chip(pct, brand.primary, "outlined")}</div></td></tr>`;
    const tsk = (depth: number, tk: ReturnType<typeof task>, dates: string, status: string, owner: string, priority: string) =>
      `<tr class="pdf-task"><td${depth ? pad(depth) : ""}>${tk.title}${dates}${ownerLine(owner)}</td>` +
      `<td class="pdf-tl-cell">${timelineLane(model, { start: tk.start_date, end: tk.due_date }, { kind: "task", status: tk.status })}</td>` +
      `<td><div class="pdf-stack">${chip(status, taskBarColors(tk.status).progress, "outlined")}` +
      `${chip(priority, priorityColor(tk.priority), "soft")}</div></td></tr>`;
    const d = (a: string, b: string) => `<div class="pdf-sub"><bdi>${a}</bdi> – <bdi>${b}</bdi></div>`;
    const by = (id: string) => wbsList.find((w) => w.id === id)!;
    const tby = (id: string) => tasks.find((x) => x.id === id)!;
    expect(s).toContain(
      `<h3>Work Breakdown</h3>${head}` +
        pkg(0, "First root", d("D(2026-01-05)", "D(2026-02-05)"), by("w1"), "42%", "Grace Hopper") +
        tsk(1, tby("t1"), d("D(2026-01-10)", "D(2026-01-20)"), "In Progress", "Alan Turing", "High") +
        tsk(1, tby("t2"), d("D(2026-01-10)", "D(2026-01-20)"), "Done", "Alan Turing", "Low") +
        pkg(1, "◆ Child A (Milestone)", d("D(2026-01-20)", "D(2026-01-20)"), by("w1a"), "42%", "Grace Hopper") +
        tsk(2, tby("t3"), '<div class="pdf-sub">– <bdi>D(2026-01-20)</bdi></div>', "Blocked", "—", "Critical") +
        pkg(1, "Child B", "", by("w1b"), "42%", "Grace Hopper") +
        pkg(0, "Second root", d("D(2026-01-05)", "D(2026-05-05)"), by("w2"), "100%", "—") +
        pkg(0, "Orphan", d("D(2026-01-05)", "D(2026-02-05)"), by("orphan"), "42%", "Grace Hopper") +
        "</tbody></table>",
    );
    expect(s).toContain(
      `<h3>Unassigned Tasks</h3>${head}` +
        tsk(0, tby("t4"), d("D(2026-01-10)", "D(2026-01-20)"), "In Progress", "Alan Turing", "High") +
        tsk(0, tby("t5"), d("D(2026-01-10)", "D(2026-01-20)"), "To Do", "Alan Turing", "Medium") +
        "</tbody></table>",
    );
    expect(s.indexOf("Unassigned Tasks")).toBeGreaterThan(s.indexOf("Orphan"));
    // Q1 to Q2 2026: one quarter rule runs through each of the 10 rows (8 in the tree, 2 unassigned).
    expect(model.quarters).toHaveLength(2);
    expect(s.match(/class="pdf-tl-grid pdf-tl-grid-q"/g)).toHaveLength(10);
    // The legend closes the section, with the today line since today is on the scale.
    expect(s.endsWith(
      legend([
        { label: "Work package (fill shows completion)", color: brand.primaryLight, fill: brand.primary, shape: "track" },
        ...(["todo", "in_progress", "done", "blocked"] as const).map((st, i) => ({
          label: `Task: ${["To Do", "In Progress", "Done", "Blocked"][i]}`,
          color: taskBarColors(st).bar,
          fill: taskBarColors(st).progress,
          shape: "track" as const,
        })),
        { label: "Milestone", color: brand.primary, shape: "diamond" },
        { label: "One date only", color: brand.primary, shape: "dot" },
        { label: "Today", color: STATUS_COLORS.error, shape: "line" },
      ]),
    )).toBe(true);
  });

  it("leaves the today key out when today is off the scale", () => {
    const html = buildProjectPrintBody(data({ wbs: [wbs()] }), ["schedule"], FMT, new Date(2030, 0, 1));
    expect(html).toContain(">One date only</span></div>");
    expect(html).not.toContain(">Today<");
  });

  it("prints the rows without a timeline column, or legend, when nothing has a date", () => {
    const html = buildProjectPrintBody(
      data({
        wbs: [wbs({ start_date: null, end_date: null })],
        tasks: [task({ start_date: null, due_date: null })],
      }),
      ["schedule"],
      FMT,
      NOW,
    );
    const [n1, n2] = SCHEDULE_COLUMN_WIDTHS_NO_TIMELINE;
    expect(html).toContain(
      `<h3>Work Breakdown</h3><table class="pdf-fixed pdf-schedule"><thead><tr><th style="width:${n1}">${titleHead}</th>` +
        `<th style="width:${n2}">${progressHead}</th></tr></thead><tbody>` +
        '<tr class="pdf-wbs"><td>Package<div class="pdf-sub">Owner: <bdi>Grace Hopper</bdi></div></td>' +
        `<td><div class="pdf-stack">${chip("42%", brand.primary, "outlined")}</div></td></tr></tbody></table>`,
    );
    expect(html).not.toContain("pdf-tl-");
    expect(html).not.toContain("pdf-legend");
  });

  it("prints only the tree when every task has a package, and only tasks when there is no tree", () => {
    const treeOnly = buildProjectPrintBody(
      data({ wbs: [wbs()], tasks: [task({ wbs_id: "w1" })] }),
      ["schedule"],
      FMT,
    );
    expect(treeOnly).toContain("<h3>Work Breakdown</h3>");
    expect(treeOnly).not.toContain("Unassigned Tasks");
    const tasksOnly = buildProjectPrintBody(data({ wbs: undefined, tasks: [task()] }), ["schedule"], FMT);
    expect(tasksOnly).not.toContain("Work Breakdown");
    expect(tasksOnly).toContain("<h3>Unassigned Tasks</h3>");
  });

  it("treats data the dialog did not read as nothing recorded", () => {
    const html = buildProjectPrintBody(data({ wbs: undefined, tasks: undefined }), ["schedule"], FMT);
    expect(html).toContain(`${HEADINGS.schedule}<p class="pre">Nothing recorded.</p>`);
  });

  it("keeps an unknown task status or priority as typed", () => {
    const html = buildProjectPrintBody(
      data({ tasks: [task({ status: "parked" as never, priority: "someday" as never })] }),
      ["schedule"],
      FMT,
    );
    expect(html).toContain(chip("parked", taskBarColors("parked").progress, "outlined"));
    expect(html).toContain(chip("someday", priorityColor("someday"), "soft"));
  });

  it("keeps the indent, the scale, the bars and the chips through the sanitiser", () => {
    const out = buildPrintHtml(
      projectPrintDocument(
        data({ wbs: [wbs(), wbs({ id: "w2", parent_id: "w1", title: "Kid" })], tasks: [task({ wbs_id: "w2" })] }),
        ["schedule"],
        FMT,
        NOW,
      ),
    );
    expect(out).toContain(`<tr class="pdf-wbs"><td style="padding-inline-start:${10 + WBS_INDENT_PX}px">Kid<div class="pdf-sub">`);
    expect(out).toMatch(/<div class="pdf-tl-scale"><div class="pdf-tl-years"><span class="pdf-tl-year" style="inset-inline-start:0%;width:100%">2026<\/span>/);
    expect(out).toMatch(/<span class="pdf-tl-bar" style="inset-inline-start:[\d.]+%;width:[\d.]+%;background:[^"]+"><span class="pdf-tl-fill" style="width:42.4%;background:/);
    expect(out).toMatch(/<span class="pdf-tl-today" style="inset-inline-start:[\d.]+%;background:/);
    expect(out).toContain('<span class="pdf-chip pdf-chip-outlined" style="border-color:');
    expect(out).toContain('<div class="pdf-stack"><span class="pdf-chip pdf-chip-outlined"');
    expect(out).toContain('<div class="pdf-sub"><bdi>D(2026-01-05)</bdi> – <bdi>D(2026-02-05)</bdi></div>');
    expect(out).toContain('<div class="pdf-sub">Owner: <bdi>Grace Hopper</bdi></div>');
  });

  it("gives the timeline more than half the table and folds the rest into two columns", () => {
    const [title, timeline, progress] = SCHEDULE_COLUMN_WIDTHS;
    expect(SCHEDULE_COLUMN_WIDTHS).toHaveLength(3);
    expect(parseFloat(timeline)).toBeGreaterThanOrEqual(50);
    expect(parseFloat(title) + parseFloat(timeline) + parseFloat(progress)).toBe(100);
    expect(SCHEDULE_COLUMN_WIDTHS_NO_TIMELINE.map(parseFloat).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe("escaping", () => {
  it("escapes HTML a user typed, in the title and in every section", () => {
    const evil = "<img src=x onerror=alert(1)>";
    const html = buildProjectPrintBody(
      data({
        card: card({ name: evil, description: evil }),
        reports: [report({ summary: evil })],
        budgetLines: [budget({ description: evil })],
        risks: [risk({ title: evil, mitigation: evil })],
        tasks: [task({ title: evil })],
      }),
      ALL,
      FMT,
    );
    expect(html).not.toContain("<img");
    expect(html.match(/&lt;img src=x onerror=alert\(1\)&gt;/g)!.length).toBeGreaterThanOrEqual(7);
  });
});

describe("projectPrintDocument / printProject", () => {
  it("titles the document by the initiative, dates the cover, fixes no footer and adds the print rules", () => {
    const now = new Date("2026-11-13T10:00:00Z");
    const doc = projectPrintDocument(data(), ["risks"], FMT, now);
    expect(doc.title).toBe("ERP Replacement");
    expect(doc.footerParts).toBeUndefined();
    expect(doc.bodyHtml).toBe(buildProjectPrintBody(data(), ["risks"], FMT, now));
    expect(buildPrintHtml(doc)).not.toContain("doc-print-footer\">");
    expect(buildPrintHtml(doc)).toContain('<p class="pdf-printed">Printed: <bdi>DT(2026-11-13T10:00:00.000Z)</bdi></p>');
    expect(doc.css).toBe(PROJECT_PRINT_CSS);
    expect(PROJECT_PRINT_CSS.startsWith("\n  @page")).toBe(true);
  });

  it.each([
    // Without this the browser drops every background: dots, bars, chips, tiles, heat map.
    "html, body.doc-print, .doc-print * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }",
    ".doc-print h2, .doc-print h3 { break-after: avoid; page-break-after: avoid; }",
    ".doc-print tr { break-inside: avoid; page-break-inside: avoid; }",
    ".doc-print th, .doc-print td { overflow-wrap: anywhere; }",
    ".doc-print table.pdf-fixed { table-layout: fixed; }",
    ".doc-print td.date, .doc-print th.date { white-space: nowrap; }",
    ".doc-print .pre { white-space: pre-wrap; }",
    ".doc-print thead { display: table-header-group; break-inside: avoid; break-after: avoid; page-break-after: avoid; }",
    ".doc-print tbody tr:first-child { break-before: avoid; page-break-before: avoid; }",
    ".doc-print .pdf-keep { break-inside: avoid; page-break-inside: avoid; }",
    ".doc-print .pdf-tiles { display: flex; gap: 8px; margin: 10px 0; break-inside: avoid; page-break-inside: avoid; }",
    ".doc-print .pdf-panels { display: flex; gap: 10px; margin: 10px 0; break-inside: avoid; page-break-inside: avoid; }",
    ".doc-print figure.pdf-chart { margin: 12px 0; break-inside: avoid; page-break-inside: avoid; }",
    ".doc-print .pdf-heatmap { margin: 10px 0; break-inside: avoid; page-break-inside: avoid; }",
    ".doc-print .pdf-tl-lane { position: absolute; top: 0; bottom: 0; inset-inline: 6px; }",
    ".doc-print .pdf-tl-scale { position: relative; height: 30px; margin: 4px 6px; }",
    ".doc-print table.pdf-schedule .pdf-tl-cell { position: relative; padding: 0; }",
    // Bars are 14px tall now, milestones 12px: readable, not slivers.
    ".doc-print .pdf-tl-bar { position: absolute; top: 6px; height: 14px; min-width: 3px; border-radius: 4px; overflow: hidden; }",
    ".doc-print .pdf-tl-milestone { position: absolute; top: 7px; width: 12px; height: 12px;",
    // The scale through every row: year rules darker than quarter rules.
    ".doc-print .pdf-tl-grid { position: absolute; top: 0; bottom: 0; width: 1px; }",
    `.doc-print .pdf-tl-grid-y { background: ${PRINT_COLORS.control}; }`,
    `.doc-print .pdf-tl-grid-q { background: ${PRINT_COLORS.panel}; }`,
    ".doc-print .pdf-risk-top { display: flex; gap: 16px; align-items: flex-start; margin: 10px 0; }",
    ".doc-print .pdf-status-rows { display: grid; grid-template-columns: 1fr 1fr; column-gap: 16px; }",
    // A long report card may break, but never between its head, ratings and a label and its text.
    ".doc-print .pdf-card-head, .doc-print .pdf-card-health, .doc-print .pdf-card-label { break-after: avoid; page-break-after: avoid; }",
    `.doc-print tr.pdf-group td { font-weight: 600; background: ${YEAR_BAND_TINT}; }`,
  ])("the stylesheet holds %s", (rule) => {
    expect(PROJECT_PRINT_CSS).toContain(rule);
  });

  it("defaults the printed date to now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T08:00:00Z"));
    try {
      expect(projectPrintDocument(data(), [], FMT).bodyHtml).toContain(
        '<p class="pdf-printed">Printed: <bdi>DT(2026-05-01T08:00:00.000Z)</bdi></p>',
      );
      expect(buildProjectPrintBody(data(), [], FMT)).toContain(
        '<p class="pdf-printed">Printed: <bdi>DT(2026-05-01T08:00:00.000Z)</bdi></p>',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("printProject writes the document into the given window and prints it", () => {
    vi.useFakeTimers();
    try {
      const doc = { write: vi.fn(), close: vi.fn() };
      const win = { document: doc, print: vi.fn() } as unknown as Window;
      printProject(data(), ["risks"], FMT, win);
      expect(doc.write).toHaveBeenCalledTimes(1);
      const written = doc.write.mock.calls[0][0] as string;
      expect(written).toContain("<title>ERP Replacement</title>");
      expect(written).toContain("<h2>Risk Management</h2>");
      expect(written).not.toContain("<h2>Overview</h2>");
      vi.runAllTimers();
      expect(win.print).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("orderedSections", () => {
  it("keeps known names in print order, once each", () => {
    expect(orderedSections(["risks", "x", "overview", "risks"])).toEqual(["overview", "risks"]);
  });
});

describe("loadPrintSections / savePrintSections", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("means every section when nothing is stored", () => {
    expect(loadPrintSections()).toEqual(ALL);
  });

  it.each([
    ["garbage", "{not json"],
    ["an object", JSON.stringify({ sections: ["risks"] })],
    ["an empty list", "[]"],
    ["only unknown names", JSON.stringify(["nope", 3, null])],
    ["null", "null"],
  ])("means every section for %s", (_label, raw) => {
    localStorage.setItem(PPM_PDF_PREFS_KEY, raw);
    expect(loadPrintSections()).toEqual(ALL);
  });

  it("drops unknown names and non-strings and returns print order", () => {
    localStorage.setItem(PPM_PDF_PREFS_KEY, JSON.stringify(["schedule", 7, "nope", "reports"]));
    expect(loadPrintSections()).toEqual(["reports", "schedule"]);
  });

  it("round-trips a choice in print order", () => {
    savePrintSections(["risks", "overview"]);
    expect(localStorage.getItem(PPM_PDF_PREFS_KEY)).toBe('["overview","risks"]');
    expect(loadPrintSections()).toEqual(["overview", "risks"]);
  });

  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => savePrintSections(["risks"])).not.toThrow();
    expect(loadPrintSections()).toEqual(ALL);
  });
});
