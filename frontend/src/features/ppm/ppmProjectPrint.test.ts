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
  printProject,
  projectPrintDocument,
  savePrintSections,
  WBS_INDENT_PX,
  type ProjectPrintData,
  type ProjectPrintFormat,
} from "./ppmProjectPrint";

const FMT: ProjectPrintFormat = {
  amount: (n) => `$${n}`,
  date: (iso) => `D(${iso})`,
  dateTime: (v) => `DT(${typeof v === "string" ? v : v.toISOString()})`,
  fiscalYearStart: 1,
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

const meta = (label: string, value: string) =>
  `<tr><td class="meta-label">${label}</td><td class="pre">${value}</td></tr>`;

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

describe("overview", () => {
  it("lists subtype, dates, completion, latest health, financials and description", () => {
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
    expect(html).toContain(meta("Subtype", "Project") + meta("Initiative Status", "On Track"));
    expect(html).toContain(meta("Start Date", "D(2026-01-01)"));
    expect(html).toContain(meta("End Date", "D(2026-12-31)"));
    expect(html).toContain(meta("Completion", "67%"));
    expect(html).toContain("<h3>Health Summary</h3>");
    expect(html).toContain(meta("Schedule", "On Track"));
    expect(html).toContain(meta("Cost", "At Risk"));
    expect(html).toContain(meta("Scope", "Off Track"));
    expect(html).toContain("<h3>Financials</h3>");
    expect(html).toContain(
'<table><thead><tr><th></th><th class="num">CapEx</th><th class="num">OpEx</th><th class="num">Total</th></tr></thead><tbody>' +
        '<tr><td>Total Budget</td>',
    );
    expect(html).toContain(
      '<tr><td>Total Budget</td><td class="num">$100</td><td class="num">$50</td><td class="num">$150</td></tr>',
    );
    expect(html).toContain(
      '<tr><td>Total Actual</td><td class="num">$70</td><td class="num">$40</td><td class="num">$110</td></tr>',
    );
    expect(html).toContain(
      '<tr><td>Variance</td><td class="num">$30</td><td class="num">$10</td><td class="num">$40</td></tr>',
    );
    expect(html).not.toContain("pdf-note");
    expect(html).not.toContain('class="derived"');
    expect(html).toContain("<h3>Description</h3><p class=\"pre\">Replace the ERP.\nSecond line.</p>");
  });

  it("says 'no report' and 'no work packages' and drops what the card lacks", () => {
    const html = buildProjectPrintBody(
      data({
        card: card({ subtype: undefined, description: "  ", attributes: {} }),
        subtypeLabel: null,
        initiativeStatusLabel: null,
        completion: { completion: 0, wbs_count: 0 },
      }),
      ["overview"],
      FMT,
    );
    expect(html).toContain('<h3>Health Summary</h3><p class="pre">No Report</p>');
    expect(html).toContain(meta("Completion", "No work packages yet"));
    expect(html).not.toContain("Subtype");
    expect(html).not.toContain("Initiative Status");
    expect(html).not.toContain("Start Date");
    expect(html).not.toContain("End Date");
    expect(html).not.toContain("<h3>Description</h3>");
  });

  it("leaves completion out when it was not read", () => {
    const html = buildProjectPrintBody(data({ completion: null }), ["overview"], FMT);
    expect(html).not.toContain(">Completion<");
  });

  it("marks a side derived from the initiatives beneath and says so", () => {
    const html = buildProjectPrintBody(
      data({
        costLines: [cost()],
        rollup: rollup({
          by_year: [
            { year: 2026, capex_budget: 300, opex_budget: 200, capex_actual: 0, opex_actual: 0 },
          ],
        }),
      }),
      ["overview"],
      FMT,
    );
    expect(html).toContain(
      '<tr class="derived"><td>Total Budget</td><td class="num">$300</td><td class="num">$200</td><td class="num">$500</td></tr>',
    );
    expect(html).toContain('<tr><td>Total Actual</td><td class="num">$0</td>');
    expect(html).toContain('<tr class="derived"><td>Variance</td><td class="num">$300</td>');
    expect(html).toContain(
      '<p class="pdf-note">No budget lines of its own: budget of the 2 initiatives beneath it</p>',
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
    expect(html).toContain('<tr class="derived"><td>Total Actual</td><td class="num">$5</td>');
    expect(html).toContain('<tr><td>Total Budget</td><td class="num">$100</td>');
    expect(html).toContain(
      '<p class="pdf-note">No cost lines of its own: actuals of the 2 initiatives beneath it</p>',
    );
    expect(html).not.toContain("No budget lines of its own");
  });
});

describe("status reports", () => {
  it("prints the newest in full and earlier ones only as a list", () => {
    const html = buildProjectPrintBody(
      data({
        reports: [
          report(),
          report({
            id: "r0",
            report_date: "2026-02-01",
            reporter: null,
            schedule_health: "atRisk",
            cost_health: "onTrack",
            scope_health: "onTrack",
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
    expect(s).toContain("<h3>Latest report</h3>");
    expect(s).toContain(meta("Report Date", "D(2026-03-01)"));
    expect(s).toContain(meta("Reporter", "Ada Lovelace"));
    expect(s).toContain(meta("Schedule", "On Track"));
    expect(s).toContain(meta("Cost", "At Risk"));
    expect(s).toContain(meta("Scope", "Off Track"));
    expect(s).toContain(meta("Summary", "Latest summary text"));
    expect(s).toContain(meta("Accomplishments", "Did things"));
    expect(s).toContain(meta("Next Steps", "Do more things"));
    expect(s).toContain("<h3>Earlier reports</h3>");
    expect(s).toContain(
      "<tr><th>Report Date</th><th>Reporter</th><th>Schedule</th><th>Cost</th><th>Scope</th></tr>" +
        "<tr><td>D(2026-02-01)</td><td>—</td><td>At Risk</td><td>On Track</td><td>On Track</td></tr>",
    );
    expect(s).not.toContain("OLDER");
  });

  it("has no earlier list when there is one report, and keeps an unknown rating as typed", () => {
    const html = buildProjectPrintBody(
      data({ reports: [report({ schedule_health: "weird", summary: null, reporter: null })] }),
      ["reports"],
      FMT,
    );
    expect(html).not.toContain("Earlier reports");
    expect(html).not.toContain(">Reporter<");
    expect(html).toContain(meta("Schedule", "weird"));
    expect(html).not.toContain(">Summary<");
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
    risk({ id: "a", title: "Low one", risk_score: 2, status: "closed" }),
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
    risk({ id: "c", title: "Mid one", risk_score: 16, description: "  " }),
  ];
  const LONG = `${"A long description. ".repeat(25)}END-OF-DESCRIPTION\nSecond paragraph`;

  it("prints the summary then a five-column table by score with the full text", () => {
    const html = buildProjectPrintBody(data({ risks: RISKS() }), ["risks"], FMT);
    const s = sectionOf(html, HEADINGS.risks);
    expect(s).toContain('<p class="pre">Total risks: 3 · Open: 1 · High: 2</p>');
    const [w1, w2, w3, w4, w5] = RISK_COLUMN_WIDTHS;
    expect(s).toContain(
      '<table class="pdf-fixed"><thead><tr>' +
        `<th style="width:${w1}">Risk</th>` +
        `<th class="num" style="width:${w2}">Score</th>` +
        `<th style="width:${w3}">Status</th>` +
        `<th style="width:${w4}">Owner</th>` +
        `<th class="pre" style="width:${w5}">Mitigation</th></tr></thead><tbody>` +
        `<tr><td><strong>Top one</strong><div class="pre">${LONG}</div></td>` +
        '<td class="num"><strong>20</strong><div class="pdf-sub">4 × 5</div></td>' +
        "<td>Mitigating</td><td>Ada Lovelace</td>" +
        '<td class="pre">1. Book a second vendor\n2. Run https://example.com/a/very/long/unbroken/url/path\nTracking: weekly</td></tr>',
    );
    // No description (or a blank one): the title alone; no owner or mitigation: a dash.
    expect(s).toContain(
      '<tr><td><strong>Low one</strong></td><td class="num"><strong>2</strong><div class="pdf-sub">1 × 1</div></td>' +
        '<td>Closed</td><td>—</td><td class="pre">—</td></tr>',
    );
    expect(s).toContain("<tr><td><strong>Mid one</strong></td>");
    const order = ["Top one", "Mid one", "Low one"].map((x) => s.indexOf(`<strong>${x}</strong>`));
    expect(order.every((p) => p >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("keeps the cell markup and the authors' line breaks through the sanitiser", () => {
    const out = buildPrintHtml(projectPrintDocument(data({ risks: RISKS() }), ["risks"], FMT));
    // The head and body sections survive the sanitiser, so the head repeats per page.
    expect(out).toContain('<table class="pdf-fixed"><thead><tr>');
    expect(out).toContain("</tr></thead><tbody><tr><td><strong>Top one</strong>");
    expect(out).toContain("</tr></tbody></table>");
    expect(out).toContain(`<th style="width:${RISK_COLUMN_WIDTHS[0]}">Risk</th>`);
    expect(out).toContain(`<td><strong>Top one</strong><div class="pre">${LONG}</div></td>`);
    expect(out).toContain('<td class="num"><strong>20</strong><div class="pdf-sub">4 × 5</div></td>');
    expect(out).toContain('<td class="pre">1. Book a second vendor\n2. Run <a ');
    expect(out).toContain("</a>\nTracking: weekly</td>");
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
  const [c1, c2, c3, c4, c5, c6] = SCHEDULE_COLUMN_WIDTHS;
  const W_HEAD =
    `<thead><tr><th style="width:${c1}">Title</th><th class="date" style="width:${c2}">Start Date</th>` +
    `<th class="date" style="width:${c3}">End / Due</th><th style="width:${c4}">Owner</th>` +
    `<th style="width:${c5}">Progress</th><th style="width:${c6}">Priority</th></tr></thead><tbody>`;
  const pad = (depth: number) => ` style="padding-inline-start:${10 + depth * WBS_INDENT_PX}px"`;
  const pkgRow = (depth: number, cells: string[]) =>
    `<tr class="pdf-wbs"><td${depth ? pad(depth) : ""}>${cells[0]}</td><td class="date">${cells[1]}</td><td class="date">${cells[2]}</td><td>${cells[3]}</td><td>${cells[4]}</td><td></td></tr>`;
  const taskRow = (depth: number, cells: string[]) =>
    `<tr class="pdf-task"><td${depth ? pad(depth) : ""}>${cells[0]}</td><td class="date">${cells[1]}</td><td class="date">${cells[2]}</td><td>${cells[3]}</td><td>${cells[4]}</td><td>${cells[5]}</td></tr>`;

  it("nests packages by depth in sort order with their tasks beneath and unassigned tasks last", () => {
    const html = buildProjectPrintBody(
      data({
        wbs: [
          wbs({ id: "w2", title: "Second root", sort_order: 2, assignee_name: null, completion: 100 }),
          wbs({ id: "w1", title: "First root", sort_order: 1 }),
          wbs({ id: "w1b", parent_id: "w1", title: "Child B", sort_order: 5 }),
          wbs({ id: "w1a", parent_id: "w1", title: "Child A", sort_order: 3, is_milestone: true }),
          wbs({ id: "orphan", parent_id: "gone", title: "Orphan", sort_order: 9 }),
        ],
        tasks: [
          task({ id: "t2", wbs_id: "w1", title: "Task two", sort_order: 2, status: "done", priority: "low" }),
          task({ id: "t1", wbs_id: "w1", title: "Task one", sort_order: 1 }),
          task({ id: "t3", wbs_id: "w1a", title: "Deep task", status: "blocked", priority: "critical", assignee_name: null, start_date: null }),
          task({ id: "t5", wbs_id: null, title: "Loose B", sort_order: 2, status: "todo", priority: "medium" }),
          task({ id: "t4", wbs_id: "missing", title: "Loose A", sort_order: 1 }),
        ],
      }),
      ["schedule"],
      FMT,
    );
    const s = sectionOf(html, HEADINGS.schedule);
    expect(s).toContain(
      `<h3>Work Breakdown</h3><table class="pdf-fixed pdf-schedule">${W_HEAD}` +
        pkgRow(0, ["First root", "D(2026-01-05)", "D(2026-02-05)", "Grace Hopper", "42%"]) +
        taskRow(1, ["Task one", "D(2026-01-10)", "D(2026-01-20)", "Alan Turing", "In Progress", "High"]) +
        taskRow(1, ["Task two", "D(2026-01-10)", "D(2026-01-20)", "Alan Turing", "Done", "Low"]) +
        pkgRow(1, ["◆ Child A (Milestone)", "D(2026-01-05)", "D(2026-02-05)", "Grace Hopper", "42%"]) +
        taskRow(2, ["Deep task", "—", "D(2026-01-20)", "—", "Blocked", "Critical"]) +
        pkgRow(1, ["Child B", "D(2026-01-05)", "D(2026-02-05)", "Grace Hopper", "42%"]) +
        pkgRow(0, ["Second root", "D(2026-01-05)", "D(2026-02-05)", "—", "100%"]) +
        pkgRow(0, ["Orphan", "D(2026-01-05)", "D(2026-02-05)", "Grace Hopper", "42%"]) +
        "</tbody></table>",
    );
    expect(s).toContain(
      `<h3>Unassigned Tasks</h3><table class="pdf-fixed pdf-schedule">${W_HEAD}` +
        taskRow(0, ["Loose A", "D(2026-01-10)", "D(2026-01-20)", "Alan Turing", "In Progress", "High"]) +
        taskRow(0, ["Loose B", "D(2026-01-10)", "D(2026-01-20)", "Alan Turing", "To Do", "Medium"]) +
        "</tbody></table>",
    );
    expect(s.indexOf("Unassigned Tasks")).toBeGreaterThan(s.indexOf("Orphan"));
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
    expect(html).toContain("<td>parked</td><td>someday</td>");
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

  it("keeps the WBS indent and row classes through the sanitiser", () => {
    const doc = projectPrintDocument(
      data({ wbs: [wbs(), wbs({ id: "w2", parent_id: "w1", title: "Kid" })] }),
      ["schedule"],
      FMT,
    );
    const out = buildPrintHtml(doc);
    expect(out).toContain(`<tr class="pdf-wbs"><td style="padding-inline-start:${10 + WBS_INDENT_PX}px">Kid</td>`);
  });
});

describe("projectPrintDocument / printProject", () => {
  it("titles the document by the initiative, dates the cover, fixes no footer and adds the print rules", () => {
    const now = new Date("2026-11-13T10:00:00Z");
    const doc = projectPrintDocument(data(), ["risks"], FMT, now);
    expect(doc.title).toBe("ERP Replacement");
    expect(doc.footerParts).toBeUndefined();
    expect(doc.bodyHtml).toBe(buildProjectPrintBody(data(), ["risks"], FMT, now));
    expect(doc.bodyHtml).toContain(
      '>ERP Replacement</p><p class="pdf-printed">Printed: DT(2026-11-13T10:00:00.000Z)</p>',
    );
    expect(buildPrintHtml(doc)).not.toContain("doc-print-footer\">");
    expect(buildPrintHtml(doc)).toContain('<p class="pdf-printed">Printed: DT(2026-11-13T10:00:00.000Z)</p>');
    expect(doc.css).toBe(PROJECT_PRINT_CSS);
    expect(PROJECT_PRINT_CSS).toContain(".doc-print h2, .doc-print h3 { break-after: avoid;");
    expect(PROJECT_PRINT_CSS).toContain(".doc-print tr { break-inside: avoid;");
    expect(PROJECT_PRINT_CSS).toContain(".doc-print th, .doc-print td { overflow-wrap: anywhere; }");
    expect(PROJECT_PRINT_CSS).toContain(".doc-print table.pdf-fixed { table-layout: fixed; }");
    expect(PROJECT_PRINT_CSS).toContain(".doc-print td.date, .doc-print th.date { white-space: nowrap; }");
    // `.pre` cells keep line breaks through the shared stylesheet.
    expect(PROJECT_PRINT_CSS).toContain(".doc-print .pre { white-space: pre-wrap; }");
    expect(PROJECT_PRINT_CSS).toContain(
      ".doc-print thead { display: table-header-group; break-inside: avoid; break-after: avoid; page-break-after: avoid; }",
    );
    expect(PROJECT_PRINT_CSS).toContain(
      ".doc-print tbody tr:first-child { break-before: avoid; page-break-before: avoid; }",
    );
    expect(PROJECT_PRINT_CSS).toContain(
      ".doc-print table.pdf-schedule th, .doc-print table.pdf-schedule td { font-size: 9pt; padding: 6px; }",
    );
    expect(PROJECT_PRINT_CSS).toMatch(/\.doc-print \.pdf-printed \{ text-align: center; color: #[0-9a-f]{6}; font-size: 10pt; \}/);
    expect(PROJECT_PRINT_CSS.startsWith("\n  @page")).toBe(true);
  });

  it("defaults the printed date to now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T08:00:00Z"));
    try {
      expect(projectPrintDocument(data(), [], FMT).bodyHtml).toContain(
        '<p class="pdf-printed">Printed: DT(2026-05-01T08:00:00.000Z)</p>',
      );
      expect(buildProjectPrintBody(data(), [], FMT)).toContain(
        '<p class="pdf-printed">Printed: DT(2026-05-01T08:00:00.000Z)</p>',
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
