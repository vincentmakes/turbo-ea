/**
 * PpmProjectReport — the initiative's report page. Pins what it loads and
 * shows in each section (built from the tabs' own pieces), the section chips
 * and their remembered choice, the print header, the empty and failed states,
 * the back link, the print button and the page title.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import type {
  Card,
  CardType,
  PpmBudgetLine,
  PpmCostLine,
  PpmRisk,
  PpmRollupOut,
  PpmStatusReport,
  PpmTask,
  PpmWbs,
} from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useCurrency", () => import("@/test/hooks").then((m) => m.useCurrencyModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
// The deck writer has its own tests; here it records what the page handed it.
const exportPptx = vi.hoisted(() => vi.fn(async (_data: unknown) => {}));
vi.mock("@/features/reports/reportExport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/reports/reportExport")>()),
  exportReportToPptx: exportPptx,
}));
// The print call has its own tests (Safari needs `execCommand`).
vi.mock("@/lib/printPage", () => ({ printPage: vi.fn() }));
// The charts have their own tests and draw through ECharts; here they show
// what the page handed them.
vi.mock("./PpmCostCharts", () => ({
  default: (p: { readOnly?: boolean; costLines: unknown[]; budgetLines: unknown[] }) => (
    <div data-testid="cost-charts">
      {`readOnly=${String(p.readOnly)} costs=${p.costLines.length} budgets=${p.budgetLines.length}`}
    </div>
  ),
}));

import { mockApi } from "@/test/apiMock";
import { printPage } from "@/lib/printPage";
import { hookState, withMetamodel } from "@/test/hooks";
import { resetFiscalYearStart } from "@/hooks/useFiscalYearStart";
import { resetPageTitle, usePageTitleSlots } from "@/hooks/usePageTitle";
import type { ReportExportData } from "@/features/reports/reportExport";
import { REPORT_EXPORT_ROWS, REPORT_PREFS_KEY } from "./ppmReportModel";
import { bandColor } from "./ppmRiskModel";
import PpmProjectReport from "./PpmProjectReport";

/** Each section's glyph, as the page heads it. */
const SECTION_ICONS: Record<string, string> = {
  overview: "dashboard",
  reports: "summarize",
  costs: "payments",
  risks: "shield",
  schedule: "view_timeline",
};

// ─── Fixtures ───────────────────────────────────────────────────────────────

const INITIATIVE_TYPE = {
  key: "Initiative",
  label: "Initiative",
  icon: "campaign",
  color: "#123456",
  has_hierarchy: true,
  has_successors: false,
  allow_card_logo: false,
  subtypes: [{ key: "project", label: "Project" }],
  fields_schema: [
    {
      section: "Status",
      fields: [
        {
          key: "initiativeStatus",
          label: "Initiative Status",
          type: "single_select",
          options: [{ key: "onTrack", label: "On Track (metamodel)" }],
        },
      ],
    },
  ],
} as unknown as CardType;

const CARD = {
  id: "i1",
  type: "Initiative",
  name: "ERP Migration",
  subtype: "project",
  description: "Move finance to https://erp.example.com",
  attributes: { startDate: "2025-01-15", endDate: "2026-06-30", initiativeStatus: "onTrack" },
} as unknown as Card;

const stamp = { created_at: "2026-01-01T00:00:00", updated_at: "2026-01-01T00:00:00" };

function report(id: string, date: string, over: Partial<PpmStatusReport> = {}): PpmStatusReport {
  return {
    id,
    initiative_id: "i1",
    reporter_id: "u1",
    reporter: { id: "u1", display_name: `Reporter ${id}` },
    report_date: date,
    schedule_health: "onTrack",
    cost_health: "atRisk",
    scope_health: "offTrack",
    summary: `Summary of ${id}`,
    accomplishments: null,
    next_steps: null,
    ...stamp,
    ...over,
  };
}

const REPORTS = [
  report("r3", "2026-03-01"),
  report("r2", "2026-02-01", { cost_health: "onTrack" }),
  report("r1", "2026-01-01"),
];

const BUDGETS: PpmBudgetLine[] = [
  { id: "b1", initiative_id: "i1", fiscal_year: 2025, category: "capex", description: "Licences", amount: 300_000, ...stamp },
  { id: "b2", initiative_id: "i1", fiscal_year: 2026, category: "opex", description: "Run", amount: 100_000, ...stamp },
];

const COSTS: PpmCostLine[] = [
  { id: "c1", initiative_id: "i1", description: "Partner invoice", category: "capex", planned: 0, actual: 250_000, date: "2025-05-01", ...stamp },
  { id: "c2", initiative_id: "i1", description: "Hosting", category: "opex", planned: 0, actual: 200_000, date: "2026-02-01", ...stamp },
];

function risk(id: string, title: string, p: number, i: number, over: Partial<PpmRisk> = {}): PpmRisk {
  return {
    id,
    initiative_id: "i1",
    title,
    description: `Why ${title}`,
    probability: p,
    impact: i,
    risk_score: p * i,
    mitigation: `First step for ${title}\nSecond step`,
    owner_id: null,
    owner_name: `Owner ${id}`,
    status: "open",
    ...stamp,
    ...over,
  };
}

const RISKS = [
  risk("k1", "Medium risk", 3, 4),
  risk("k2", "Low risk", 1, 2, { status: "closed", owner_name: null, mitigation: null }),
  risk("k3", "Top risk", 4, 5, { status: "mitigating" }),
];

const WBS: PpmWbs[] = [
  {
    id: "w1",
    initiative_id: "i1",
    parent_id: null,
    title: "Build phase",
    description: null,
    start_date: "2025-02-01",
    end_date: "2025-09-30",
    sort_order: 0,
    is_milestone: false,
    completion: 60,
    assignee_id: null,
    assignee_name: null,
    progress: 60,
    task_count: 1,
    ...stamp,
  },
];

const TASKS: PpmTask[] = [
  {
    id: "t1",
    initiative_id: "i1",
    title: "Configure ledger",
    description: null,
    status: "in_progress",
    priority: "high",
    assignee_id: null,
    assignee_name: null,
    start_date: "2025-03-01",
    due_date: "2025-04-01",
    sort_order: 0,
    tags: [],
    wbs_id: "w1",
    comment_count: 0,
    ...stamp,
  },
];

const NO_ROLLUP: PpmRollupOut = {
  descendant_count: 0,
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
};

/** A programme with no lines of its own: both sides come from beneath. */
const ROLLUP_BENEATH: PpmRollupOut = {
  ...NO_ROLLUP,
  descendant_count: 2,
  total_planned: 2_000_000,
  total_actual: 500_000,
  start_date: "2024-01-01",
  end_date: "2027-12-31",
  has_budget_lines: true,
  has_cost_lines: true,
  by_year: [{ year: 2025, capex_budget: 1_500_000, opex_budget: 500_000, capex_actual: 400_000, opex_actual: 100_000 }],
};

const BASE = "/ppm/initiatives/i1";

function scriptAll() {
  mockApi.on("get", "/settings/fiscal-year-start", { month: 1 });
  mockApi.on("get", "/cards/i1", CARD);
  mockApi.on("get", `${BASE}/reports`, REPORTS);
  mockApi.on("get", `${BASE}/costs`, COSTS);
  mockApi.on("get", `${BASE}/budgets`, BUDGETS);
  mockApi.on("get", `${BASE}/risks`, RISKS);
  mockApi.on("get", `${BASE}/rollup`, NO_ROLLUP);
  mockApi.on("get", `${BASE}/completion`, { completion: 42.4, wbs_count: 1 });
  mockApi.on("get", `${BASE}/wbs`, WBS);
  mockApi.on("get", `${BASE}/tasks`, TASKS);
}

/** Shows the page title's two slots, as the browser tab would read them. */
function TitleProbe() {
  const slots = usePageTitleSlots();
  return <div data-testid="title-probe">{`${slots.subject?.text ?? ""}|${slots.section?.text ?? ""}`}</div>;
}

/** Opens another initiative's report in place, as a link on the page would. */
function GoToOther() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/ppm/i2/report")}>other-initiative</button>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/ppm/i1/report"]}>
      <TitleProbe />
      <GoToOther />
      <Routes>
        <Route path="/ppm/:id/report" element={<PpmProjectReport />} />
        <Route path="/ppm/:id" element={<div data-testid="initiative-page" />} />
      </Routes>
    </MemoryRouter>,
  );
}

const section = (key: string) =>
  document.querySelector(`[data-report-section="${key}"]`) as HTMLElement | null;

async function loaded() {
  await screen.findByRole("heading", { name: "Overview" });
}

beforeEach(() => {
  vi.mocked(printPage).mockClear();
  exportPptx.mockClear();
  mockApi.reset();
  hookState.reset();
  resetFiscalYearStart();
  resetPageTitle();
  localStorage.clear();
  withMetamodel([INITIATIVE_TYPE]);
  scriptAll();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("PpmProjectReport — loading", () => {
  it("shows a spinner until the initiative has loaded", async () => {
    renderPage();
    expect(document.querySelector(".MuiCircularProgress-root")).not.toBeNull();
    expect(document.querySelector(".ppm-project-report")).toBeNull();
    await loaded();
    expect(document.querySelector(".MuiCircularProgress-root")).toBeNull();
  });

  it("reads the initiative and its PPM data, secondary reads included", async () => {
    renderPage();
    await loaded();
    const paths = mockApi.callsOf("get").map((c) => c.path);
    for (const p of [
      "/cards/i1",
      `${BASE}/reports`,
      `${BASE}/costs`,
      `${BASE}/budgets`,
      `${BASE}/risks`,
      `${BASE}/rollup`,
      `${BASE}/completion`,
      `${BASE}/wbs`,
      `${BASE}/tasks`,
    ]) {
      expect(paths).toContain(p);
    }
  });

  it("titles the report with the initiative and its type's icon", async () => {
    renderPage();
    await loaded();
    expect(screen.getAllByRole("heading", { level: 5 })[0]).toHaveTextContent("ERP Migration");
    const icon = screen.getAllByRole("heading", { level: 5 })[0].previousElementSibling!;
    expect(icon).toHaveTextContent("campaign");
    expect(icon).toHaveStyle({ color: "rgb(18, 52, 86)" });
  });

  it("falls back to the Initiative glyph and colour before the metamodel knows the type", async () => {
    withMetamodel([]);
    renderPage();
    await loaded();
    const icon = screen.getAllByRole("heading", { level: 5 })[0].previousElementSibling!;
    expect(icon).toHaveTextContent("rocket_launch");
    expect(icon).toHaveStyle({ color: "rgb(51, 204, 88)" });
  });
});

describe("PpmProjectReport — sections", () => {
  it("shows every section in report order", async () => {
    renderPage();
    await loaded();
    const order = [...document.querySelectorAll("[data-report-section]")].map((el) =>
      el.getAttribute("data-report-section"),
    );
    expect(order).toEqual(["overview", "reports", "costs", "risks", "schedule"]);
    for (const key of order) {
      const heading = within(section(key!)!).getByRole("heading", { level: 2 });
      expect(heading.parentElement).toHaveTextContent(`${SECTION_ICONS[key!]}${heading.textContent}`);
    }
    expect(document.querySelector(".ppm-project-report")).not.toBeNull();
  });

  it("shows the overview's tiles, health with ratings, bars, timeline and description", async () => {
    renderPage();
    await loaded();
    const ov = section("overview")!;
    const tiles = ov.querySelector(".ppm-report-tiles")!;
    // 400k budget, 450k actual, -50k variance, 42% completion.
    expect(tiles).toHaveTextContent("Total Budget");
    expect(tiles).toHaveTextContent("400 kUSD");
    expect(tiles).toHaveTextContent("450 kUSD");
    expect(tiles).toHaveTextContent("-50 kUSD");
    expect(tiles).toHaveTextContent("42%");
    expect(tiles).toHaveTextContent("Average completion across work packages");
    expect(tiles).toHaveTextContent("Total Actual");
    expect(tiles).toHaveTextContent("Variance");
    // Nothing is derived: no tile is marked, the variance included.
    expect(tiles.querySelectorAll("[data-derived]")).toHaveLength(0);
    expect(within(ov).queryByTestId("report-beneath")).not.toBeInTheDocument();

    const health = within(ov).getByTestId("report-health");
    expect(health).toHaveTextContent("ScheduleOn Track");
    expect(health).toHaveTextContent("CostAt Risk");
    expect(health).toHaveTextContent("ScopeOff Track");
    expect(health).toHaveTextContent("Latest report: 2026-03-01");

    expect(within(ov).getByText("Health Summary")).toBeInTheDocument();
    expect(within(ov).getByText("Financials")).toBeInTheDocument();
    const financials = within(ov).getByText("Financials").closest(".MuiPaper-root") as HTMLElement;
    for (const bar of ["Total", "CapEx", "OpEx"]) {
      expect(within(financials).getByText(bar)).toBeInTheDocument();
    }
    expect(within(ov).getAllByRole("progressbar")).toHaveLength(3);
    expect(ov).toHaveTextContent("450/400 kUSD (113%)");

    expect(ov).toHaveTextContent("2025-01-15");
    expect(ov).toHaveTextContent("2026-06-30");
    const timeline = within(ov).getByText("Timeline").closest(".MuiPaper-root") as HTMLElement;
    expect(timeline).toHaveTextContent(
      "Start Date2025-01-15End Date2026-06-30SubtypeProjectInitiative StatusOn Track (metamodel)",
    );
    expect(within(ov).getByText("Description")).toBeInTheDocument();
    expect(within(ov).getByText("Project")).toBeInTheDocument();
    expect(within(ov).getByText("On Track (metamodel)")).toBeInTheDocument();
    expect(within(ov).getByRole("link", { name: "https://erp.example.com" })).toBeInTheDocument();
    expect(within(ov).queryByTestId("report-derived-notes")).not.toBeInTheDocument();
  });

  it("colours the variance tile by its verdict", async () => {
    renderPage();
    await loaded();
    const variance = within(section("overview")!).getByText("Variance").closest(".MuiPaper-root")!;
    // Over budget: the error colour (#f44336).
    expect(getComputedStyle(variance).borderLeft).toMatch(/rgb\(211, 47, 47\)/);
  });

  it("colours an under-budget variance as a success", async () => {
    mockApi.on("get", `${BASE}/costs`, [COSTS[0]]);
    renderPage();
    await loaded();
    const variance = within(section("overview")!).getByText("Variance").closest(".MuiPaper-root")!;
    expect(getComputedStyle(variance).borderLeft).toMatch(/rgb\(46, 125, 50\)/);
  });

  it("shows the latest status report as a card and the earlier ones in a table", async () => {
    renderPage();
    await loaded();
    const rs = section("reports")!;
    expect(within(rs).getByText("Latest report")).toBeInTheDocument();
    expect(within(rs).getByText("Summary of r3")).toBeInTheDocument();
    // The latest card spells out each rating (never colour alone, §5).
    const latest = within(rs).getByText("Summary of r3").closest(".MuiPaper-root") as HTMLElement;
    expect(latest).toHaveTextContent("ScheduleOn Track");
    expect(latest).toHaveTextContent("CostAt Risk");
    expect(latest).toHaveTextContent("ScopeOff Track");
    expect(within(rs).queryByText("Summary of r2")).not.toBeInTheDocument();
    const table = within(rs).getByTestId("report-earlier-table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent(/^Report DateReporterHealth Summary$/);
    expect(rows[1]).toHaveTextContent("2026-02-01");
    expect(rows[1]).toHaveTextContent("Reporter r2");
    expect(rows[1]).toHaveTextContent("CostOn Track");
    expect(rows[2]).toHaveTextContent("2026-01-01");
    expect(rows[2]).toHaveTextContent("CostAt Risk");
  });

  it("shows only the card when there is a single status report", async () => {
    mockApi.on("get", `${BASE}/reports`, [REPORTS[0]]);
    renderPage();
    await loaded();
    expect(within(section("reports")!).getByText("Summary of r3")).toBeInTheDocument();
    expect(screen.queryByTestId("report-earlier-table")).not.toBeInTheDocument();
    expect(screen.queryByText("Earlier reports")).not.toBeInTheDocument();
  });

  it("shows the budget tiles, the read-only charts and both tables fully expanded", async () => {
    renderPage();
    await loaded();
    const cs = section("costs")!;
    const tiles = cs.querySelector(".ppm-report-tiles")!;
    expect(tiles).toHaveTextContent("Total Budget400 kUSD");
    expect(tiles).toHaveTextContent("Total Actual450 kUSD");
    expect(tiles).toHaveTextContent("Variance-50 kUSD");
    expect(tiles).toHaveTextContent("CapEx250 kUSDof 300 kUSD budget");
    expect(tiles).toHaveTextContent("OpEx200 kUSDof 100 kUSD budget");
    expect(within(cs).getByTestId("cost-charts")).toHaveTextContent(
      "readOnly=true costs=2 budgets=2",
    );
    const budget = within(cs).getByTestId("ppm-budget-table");
    expect(budget).toHaveTextContent("Licences");
    expect(budget).toHaveTextContent("Run");
    const costs = within(cs).getByTestId("ppm-cost-table");
    expect(costs).toHaveTextContent("Partner invoice");
    expect(costs).toHaveTextContent("Hosting");
    // Read-only: no toggles, no add / edit / delete.
    expect(within(cs).queryAllByRole("button")).toHaveLength(0);
  });

  it("shows the risk tiles, the matrix, the statuses and the risks by score with full text", async () => {
    renderPage();
    await loaded();
    const rk = section("risks")!;
    const tiles = rk.querySelector(".ppm-report-tiles")!;
    expect(tiles).toHaveTextContent("Total Risks3");
    expect(tiles).toHaveTextContent("Open1");
    expect(tiles).toHaveTextContent("High Risks1");
    expect(within(rk).getByText("Risk heat map")).toBeInTheDocument();
    expect(within(rk).getByText("Probability", { exact: false })).toBeInTheDocument();
    const statuses = within(rk).getByTestId("report-risk-status");
    expect(statuses).toHaveTextContent("Open1Mitigating1Mitigated0Closed1Accepted0");
    expect(statuses.closest(".MuiPaper-root")).toHaveTextContent(/^trafficBy status/);

    const rows = within(within(rk).getByTestId("report-risk-table")).getAllByRole("row");
    expect(rows.map((r) => r.querySelector("td")?.textContent ?? "header")).toEqual([
      "header",
      "Top riskWhy Top risk",
      "Medium riskWhy Medium risk",
      "Low riskWhy Low risk",
    ]);
    expect(rows[0]).toHaveTextContent(/^RiskRisk ScoreStatusOwnerMitigation$/);
    expect(rows[1]).toHaveTextContent("204 × 5");
    expect(rows[1]).toHaveTextContent("Mitigating");
    expect(rows[1]).toHaveTextContent("Owner k3");
    expect(rows[1].querySelectorAll("td")[4].textContent).toBe("First step for Top risk\nSecond step");
    expect(rows[3]).toHaveTextContent("Closed");
    expect(rows[3].querySelectorAll("td")[3]).toHaveTextContent("—");
    expect(rows[3].querySelectorAll("td")[4]).toHaveTextContent("—");
  });

  it("leaves the high-risk tile uncoloured when there is none", async () => {
    mockApi.on("get", `${BASE}/risks`, [RISKS[0]]);
    renderPage();
    await loaded();
    const high = within(section("risks")!).getByText("High Risks").closest(".MuiPaper-root")!;
    expect(high).toHaveTextContent("0");
    expect(getComputedStyle(high).borderLeftWidth).not.toBe("4px");
  });

  it("draws the schedule on its timeline", async () => {
    renderPage();
    await loaded();
    const sc = section("schedule")!;
    expect(within(sc).getByText("Build phase")).toBeInTheDocument();
    expect(within(sc).getByText("Configure ledger")).toBeInTheDocument();
    expect(sc.querySelectorAll("[data-export-row]").length).toBeGreaterThanOrEqual(2);
  });
});

describe("PpmProjectReport — empty and derived", () => {
  it("says so in each section with nothing recorded", async () => {
    mockApi.on("get", `${BASE}/reports`, []);
    mockApi.on("get", `${BASE}/risks`, []);
    mockApi.on("get", `${BASE}/wbs`, []);
    mockApi.on("get", `${BASE}/tasks`, []);
    mockApi.on("get", `${BASE}/costs`, []);
    mockApi.on("get", `${BASE}/budgets`, []);
    mockApi.on("get", `${BASE}/completion`, { completion: 0, wbs_count: 0 });
    renderPage();
    await loaded();
    expect(within(section("overview")!).getByText("No status reports yet")).toBeInTheDocument();
    expect(within(section("overview")!).getByText("No work packages yet")).toBeInTheDocument();
    // No work package: the completion reads as none, not as 0%.
    expect(
      within(section("overview")!).getByText("Completion").closest(".MuiPaper-root"),
    ).toHaveTextContent(/^donut_largeCompletion—No work packages yet$/);
    expect(within(section("reports")!).getByText("No status reports yet")).toBeInTheDocument();
    expect(within(section("risks")!).getByText("No risks yet")).toBeInTheDocument();
    expect(within(section("risks")!).queryByTestId("report-risk-table")).not.toBeInTheDocument();
    expect(within(section("schedule")!).getByText("Nothing recorded.")).toBeInTheDocument();
    expect(within(section("costs")!).getByText("No budget lines yet")).toBeInTheDocument();
    expect(within(section("costs")!).getByText("No cost items yet")).toBeInTheDocument();
  });

  it("marks derived figures and states their derivation in words", async () => {
    mockApi.on("get", "/cards/i1", { ...CARD, description: null });
    mockApi.on("get", `${BASE}/costs`, []);
    mockApi.on("get", `${BASE}/budgets`, []);
    mockApi.on("get", `${BASE}/rollup`, ROLLUP_BENEATH);
    renderPage();
    await loaded();
    const ov = section("overview")!;
    expect(within(ov).getByTestId("report-derived-notes")).toHaveTextContent(
      "subdirectory_arrow_rightNo budget lines of its own: budget of the 2 initiatives beneath it" +
        "subdirectory_arrow_rightNo cost lines of its own: actuals of the 2 initiatives beneath it",
    );
    const tiles = ov.querySelector(".ppm-report-tiles")!;
    expect(tiles.querySelectorAll("[data-derived]")).toHaveLength(3);
    expect(tiles).toHaveTextContent("2 MUSD");
    expect(tiles).toHaveTextContent("500 kUSD");
    expect(within(ov).getByTestId("report-beneath")).toHaveTextContent(
      "Beneath this initiative: 2 initiatives",
    );
    expect(within(ov).getByTestId("report-beneath")).toHaveTextContent("From 2024-01-01 to 2027-12-31");
    expect(within(ov).getByTestId("report-beneath")).not.toHaveTextContent("Budget $");
    expect(within(ov).queryByText("Description")).not.toBeInTheDocument();

    const cs = section("costs")!;
    expect(within(cs).getByTestId("report-derived-notes")).toBeInTheDocument();
    expect(cs.querySelector(".ppm-report-tiles")!.querySelectorAll("[data-derived]")).toHaveLength(5);
    expect(within(cs).getByTestId("ppm-budget-table")).toHaveTextContent(
      "the budget of the 2 initiatives beneath it",
    );
    expect(within(cs).getByTestId("ppm-cost-table")).toHaveTextContent(
      "the actuals of the 2 initiatives beneath it",
    );
  });

  it("names what lies beneath when only one side is derived", async () => {
    mockApi.on("get", `${BASE}/budgets`, []);
    mockApi.on("get", `${BASE}/rollup`, { ...ROLLUP_BENEATH, start_date: null, end_date: null });
    renderPage();
    await loaded();
    const beneath = within(section("overview")!).getByTestId("report-beneath");
    expect(beneath).toHaveTextContent(/Budget \$2,?000,?000 · Actual \$500,?000/);
    expect(beneath).not.toHaveTextContent("From");
    expect(within(section("overview")!).getByTestId("report-derived-notes")).toHaveTextContent(
      /^subdirectory_arrow_rightNo budget lines of its own: budget of the 2 initiatives beneath it$/,
    );
  });
});

describe("PpmProjectReport — section chips", () => {
  it("hides and restores a section, and remembers the choice", async () => {
    const user = userEvent.setup();
    const { unmount } = renderPage();
    await loaded();
    const chip = screen.getByRole("button", { name: /Risk Management/ });
    expect(chip).toHaveAttribute("aria-pressed", "true");

    await user.click(chip);
    expect(section("risks")).toBeNull();
    expect(screen.getByRole("button", { name: /Risk Management/ })).toHaveAttribute("aria-pressed", "false");
    expect(JSON.parse(localStorage.getItem(REPORT_PREFS_KEY)!)).toEqual([
      "overview",
      "reports",
      "costs",
      "schedule",
    ]);

    unmount();
    renderPage();
    await screen.findByRole("heading", { name: "Overview" });
    expect(section("risks")).toBeNull();
    expect(section("schedule")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: /Risk Management/ }));
    expect(section("risks")).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(REPORT_PREFS_KEY)!)).toEqual([
      "overview",
      "reports",
      "costs",
      "risks",
      "schedule",
    ]);
  });

  it("each chip toggles its own section", async () => {
    const user = userEvent.setup();
    renderPage();
    await loaded();
    for (const key of ["overview", "reports", "costs", "risks", "schedule"] as const) {
      const name = new RegExp(
        { overview: "Overview", reports: "Status Reports", costs: "Budget & Costs", risks: "Risk Management", schedule: "Tasks & Schedule" }[key],
      );
      await user.click(screen.getByRole("button", { name }));
      expect(section(key)).toBeNull();
    }
    expect(screen.getByTestId("report-no-sections")).toHaveTextContent(
      "No section is shown. Choose one or more sections above.",
    );
    expect(JSON.parse(localStorage.getItem(REPORT_PREFS_KEY)!)).toEqual([]);
  });

  it("shows only the remembered sections", async () => {
    localStorage.setItem(REPORT_PREFS_KEY, JSON.stringify(["risks"]));
    renderPage();
    await screen.findByRole("heading", { name: "Risk Management" });
    expect(document.querySelectorAll("[data-report-section]")).toHaveLength(1);
    expect(screen.queryByTestId("report-no-sections")).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Sections" })).toHaveTextContent(/^Sections/);
  });
});

describe("PpmProjectReport — print header and frame", () => {
  it("prints the subtype, status, dates and when it was printed", async () => {
    renderPage();
    await loaded();
    const params = document.querySelector(".report-print-params")!;
    expect(params).toHaveTextContent("Subtype: Project");
    expect(params).toHaveTextContent("Initiative Status: On Track (metamodel)");
    expect(params).toHaveTextContent("Start Date: 2025-01-15");
    expect(params).toHaveTextContent("End Date: 2026-06-30");
    expect(params).toHaveTextContent(/Printed: \d{4}-\d{2}-\d{2}/);
  });

  it("drops the empty print parameters", async () => {
    mockApi.on("get", "/cards/i1", { ...CARD, subtype: null, attributes: {} });
    renderPage();
    await loaded();
    const params = document.querySelector(".report-print-params")!;
    expect(params).not.toHaveTextContent("Subtype");
    expect(params).not.toHaveTextContent("Initiative Status");
    expect(params).not.toHaveTextContent("Start Date");
    expect(params).toHaveTextContent("Printed:");
    expect(within(section("overview")!).getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });

  it("shows a status the metamodel does not list as stored", async () => {
    mockApi.on("get", "/cards/i1", { ...CARD, attributes: { initiativeStatus: "paused" } });
    renderPage();
    await loaded();
    expect(document.querySelector(".report-print-params")).toHaveTextContent(
      "Initiative Status: paused",
    );
  });

  it("links back to the initiative", async () => {
    const user = userEvent.setup();
    renderPage();
    await loaded();
    const back = screen.getByRole("link", { name: "Back to the initiative" });
    expect(back).toHaveAttribute("href", "/ppm/i1");
    await user.click(back);
    expect(screen.getByTestId("initiative-page")).toBeInTheDocument();
  });

  it("prints with the report print button", async () => {
    const user = userEvent.setup();
    renderPage();
    await loaded();
    await user.click(screen.getByRole("button", { name: "Print / Save as PDF" }));
    expect(printPage).toHaveBeenCalledTimes(1);
  });

  it("names the browser tab after the initiative and the report", async () => {
    renderPage();
    await loaded();
    await waitFor(() =>
      expect(screen.getByTestId("title-probe")).toHaveTextContent("ERP Migration|Initiative Report"),
    );
  });
});

describe("PpmProjectReport — PowerPoint export", () => {
  const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: "More actions" }));
    await screen.findByText("Copy link");
  };

  /** Export the deck and return what the page handed the deck writer. */
  async function exportDeck(): Promise<ReportExportData> {
    const user = userEvent.setup();
    await openMenu(user);
    await user.click(screen.getByText("Export to PowerPoint (.pptx)"));
    await waitFor(() => expect(exportPptx).toHaveBeenCalledTimes(1));
    return exportPptx.mock.calls[0][0] as ReportExportData;
  }

  const bodyOf = (key: string) =>
    section(key)!.querySelector(":scope > [data-report-section-body]") as HTMLElement;

  it("offers PowerPoint and not Excel", async () => {
    const user = userEvent.setup();
    renderPage();
    await loaded();
    await openMenu(user);
    expect(screen.getByText("Export to PowerPoint (.pptx)")).toBeInTheDocument();
    expect(screen.queryByText("Export to Excel (.xlsx)")).not.toBeInTheDocument();
    expect(screen.queryByText("View all saved reports")).not.toBeInTheDocument();
  });

  it("hands over one section per section shown, titled, its body without its heading", async () => {
    renderPage();
    await loaded();
    const data = await exportDeck();

    expect(data.title).toBe("ERP Migration");
    // The page's own surface goes behind the pictures (dark text on a light theme here).
    expect(data.background).toBe("#fff");
    expect(data.sheets).toEqual([]);
    expect(data.chartNode).toBeUndefined();
    expect(data.sections!.map((s) => s.title)).toEqual([
      "Overview",
      "Status Reports",
      "Budget & Costs",
      "Risk Management",
      "Tasks & Schedule",
    ]);
    const keys = ["overview", "reports", "costs", "risks", "schedule"];
    data.sections!.forEach((s, i) => {
      expect(s.node).toBe(bodyOf(keys[i]));
      expect(s.paginateRowSelector).toBe(REPORT_EXPORT_ROWS);
      // The slide names the section, so the picture does not repeat its heading.
      expect(within(s.node).queryByRole("heading", { level: 2 })).toBeNull();
    });
    expect(within(bodyOf("risks")).getByTestId("report-risk-table")).toBeInTheDocument();
  });

  it("states the initiative's parameters, without when it was printed", async () => {
    renderPage();
    await loaded();
    const data = await exportDeck();
    expect(data.filterSummary).toEqual([
      { label: "Subtype", value: "Project" },
      { label: "Initiative Status", value: "On Track (metamodel)" },
      { label: "Start Date", value: "2025-01-15" },
      { label: "End Date", value: "2026-06-30" },
    ]);
  });

  it("drops the empty parameters", async () => {
    mockApi.on("get", "/cards/i1", { ...CARD, subtype: null, attributes: {} });
    renderPage();
    await loaded();
    const data = await exportDeck();
    expect(data.filterSummary).toEqual([]);
  });

  it("leaves out a section toggled off", async () => {
    const user = userEvent.setup();
    renderPage();
    await loaded();
    const chips = screen.getByRole("group", { name: "Sections" });
    await user.click(within(chips).getByText("Status Reports"));
    await user.click(within(chips).getByText("Risk Management"));
    const data = await exportDeck();
    expect(data.sections!.map((s) => s.title)).toEqual([
      "Overview",
      "Budget & Costs",
      "Tasks & Schedule",
    ]);
    expect(data.sections![2].node).toBe(bodyOf("schedule"));
  });

  it("leaves out a section with nothing recorded, and a schedule that could not be read", async () => {
    mockApi.on("get", `${BASE}/reports`, []);
    mockApi.on("get", `${BASE}/risks`, []);
    mockApi.fail("get", `${BASE}/tasks`, 500);
    renderPage();
    await loaded();
    const data = await exportDeck();
    expect(data.sections!.map((s) => s.title)).toEqual(["Overview", "Budget & Costs"]);
  });

  it("leaves out costs with no line, but keeps them when the lines are beneath", async () => {
    mockApi.on("get", `${BASE}/costs`, []);
    mockApi.on("get", `${BASE}/budgets`, []);
    const first = renderPage();
    await loaded();
    expect((await exportDeck()).sections!.map((s) => s.title)).not.toContain("Budget & Costs");
    first.unmount();

    for (const beneath of [{ has_cost_lines: true }, { has_budget_lines: true }]) {
      exportPptx.mockClear();
      mockApi.on("get", `${BASE}/rollup`, { ...NO_ROLLUP, descendant_count: 1, ...beneath });
      const view = renderPage();
      await loaded();
      expect((await exportDeck()).sections!.map((s) => s.title)).toContain("Budget & Costs");
      view.unmount();
    }
  });

  it("keeps costs with budget lines only, or cost lines only", async () => {
    mockApi.on("get", `${BASE}/costs`, []);
    const first = renderPage();
    await loaded();
    expect((await exportDeck()).sections!.map((s) => s.title)).toContain("Budget & Costs");
    first.unmount();

    exportPptx.mockClear();
    mockApi.on("get", `${BASE}/costs`, COSTS);
    mockApi.on("get", `${BASE}/budgets`, []);
    renderPage();
    await loaded();
    expect((await exportDeck()).sections!.map((s) => s.title)).toContain("Budget & Costs");
  });

  it("keeps a schedule with tasks only", async () => {
    mockApi.on("get", `${BASE}/wbs`, []);
    renderPage();
    await loaded();
    const data = await exportDeck();
    expect(data.sections!.map((s) => s.title)).toContain("Tasks & Schedule");
  });

  it("offers no export when no section is shown", async () => {
    localStorage.setItem(REPORT_PREFS_KEY, JSON.stringify(["risks"]));
    mockApi.on("get", `${BASE}/risks`, []);
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "Risk Management" });
    await openMenu(user);
    expect(screen.queryByText("Export to PowerPoint (.pptx)")).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    await user.click(within(screen.getByRole("group", { name: "Sections" })).getByText("Overview"));
    await openMenu(user);
    expect(screen.getByText("Export to PowerPoint (.pptx)")).toBeInTheDocument();
  });

  it("marks the blocks a slide never cuts through and the headings that never end one", async () => {
    renderPage();
    await loaded();
    // Every tile strip and every card of a card grid is one block.
    for (const strip of document.querySelectorAll(".ppm-report-tiles")) {
      expect(strip).toHaveAttribute("data-export-row");
    }
    for (const card of document.querySelectorAll(".ppm-report-cards > *")) {
      expect(card).toHaveAttribute("data-export-row");
    }
    expect(document.querySelectorAll(".ppm-report-cards > [data-export-row]")).toHaveLength(6);
    // The latest status report stays whole on a slide, though print may break it.
    const latest = document.querySelector(".ppm-report-latest")!;
    expect(latest).toHaveAttribute("data-export-keep");
    expect(latest).not.toHaveAttribute("data-export-row");
    // Every table heading is a heading.
    const headings = [...document.querySelectorAll("h6[data-export-heading], [data-export-heading].MuiTypography-subtitle1")].map(
      (el) => el.textContent,
    );
    expect(headings).toEqual(["Latest report", "Earlier reports", "Planned Budget", "Cost Items"]);
  });
});

describe("PpmProjectReport — failures", () => {
  it.each([
    [403, "You don't have permission to perform this action"],
    [404, "Not found"],
  ])("shows an error for a %i on the initiative", async (status, text) => {
    mockApi.fail("get", "/cards/i1", status);
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(screen.getByRole("link", { name: "Back to the initiative" })).toHaveAttribute(
      "href",
      "/ppm/i1",
    );
    expect(document.querySelector(".ppm-project-report")).toBeNull();
  });

  it("shows any other failure's message", async () => {
    mockApi.fail("get", `${BASE}/risks`, 500, "boom");
    renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toBe("");
    expect(alert).not.toHaveTextContent("Not found");
  });

  it("keeps the page when a secondary read fails", async () => {
    mockApi.fail("get", `${BASE}/rollup`, 500);
    mockApi.fail("get", `${BASE}/completion`, 500);
    mockApi.fail("get", `${BASE}/wbs`, 500);
    renderPage();
    await loaded();
    const tiles = section("overview")!.querySelector(".ppm-report-tiles")!;
    expect(within(tiles as HTMLElement).getByText("Completion").closest(".MuiPaper-root")).toHaveTextContent(
      /^donut_largeCompletion—$/,
    );
    expect(within(section("risks")!).getByTestId("report-risk-table")).toBeInTheDocument();
    expect(within(section("schedule")!).getByRole("alert")).toHaveTextContent("Something went wrong");
    expect(within(section("schedule")!).queryByText("Build phase")).not.toBeInTheDocument();
  });
});

describe("PpmProjectReport — another initiative", () => {
  it("never shows a reply for the initiative the reader has left", async () => {
    let answerFirst: (card: unknown) => void = () => {};
    mockApi.on("get", "/cards/i1", () => new Promise((resolve) => (answerFirst = resolve)));
    const other = "/ppm/initiatives/i2";
    mockApi.on("get", "/cards/i2", { ...CARD, id: "i2", name: "Second Initiative" });
    for (const [path, value] of [
      ["reports", []],
      ["costs", []],
      ["budgets", []],
      ["risks", []],
      ["rollup", NO_ROLLUP],
      ["completion", { completion: 0, wbs_count: 0 }],
      ["wbs", []],
      ["tasks", []],
    ] as const) {
      mockApi.on("get", `${other}/${path}`, value);
    }
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "other-initiative" }));
    await screen.findByText("Second Initiative");
    answerFirst(CARD);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("ERP Migration")).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 5 })[0]).toHaveTextContent("Second Initiative");
    expect(screen.getByRole("link", { name: "Back to the initiative" })).toHaveAttribute(
      "href",
      "/ppm/i2",
    );
  });
});

describe("PpmProjectReport — reading the initiative", () => {
  /** A reply the test answers by hand, to order replies across initiatives. */
  function deferred<T>() {
    let resolve: (v: T) => void = () => {};
    let reject: (e: unknown) => void = () => {};
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  /** Script the second initiative's reads, its card answered by `card`. */
  function scriptOther(card: () => Promise<unknown> | unknown) {
    const other = "/ppm/initiatives/i2";
    mockApi.on("get", "/cards/i2", card);
    for (const [path, value] of [
      ["reports", []],
      ["costs", []],
      ["budgets", []],
      ["risks", []],
      ["rollup", NO_ROLLUP],
      ["completion", { completion: 0, wbs_count: 0 }],
      ["wbs", []],
      ["tasks", []],
    ] as const) {
      mockApi.on("get", `${other}/${path}`, value);
    }
  }

  const spinner = () => document.querySelector(".MuiCircularProgress-root");

  it("waits, and reads nothing, without an initiative in the address", async () => {
    render(
      <MemoryRouter initialEntries={["/ppm-report"]}>
        <Routes>
          <Route path="/ppm-report" element={<PpmProjectReport />} />
        </Routes>
      </MemoryRouter>,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(spinner()).not.toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mockApi.callsOf("get", /^\/(cards|ppm)\//)).toEqual([]);
  });

  it("passes the request's abort signal to every read", async () => {
    renderPage();
    await loaded();
    const reads = vi
      .mocked(mockApi.api.get)
      .mock.calls.filter(([path]) => path === "/cards/i1" || path.startsWith(`${BASE}/`));
    expect(reads.map(([path]) => path).sort()).toEqual(
      [
        "/cards/i1",
        `${BASE}/budgets`,
        `${BASE}/completion`,
        `${BASE}/costs`,
        `${BASE}/reports`,
        `${BASE}/risks`,
        `${BASE}/rollup`,
        `${BASE}/tasks`,
        `${BASE}/wbs`,
      ].sort(),
    );
    for (const [, opts] of reads) {
      expect(opts).toEqual({ signal: expect.any(AbortSignal) });
    }
  });

  it("forgets the initiative it leaves while the next one loads", async () => {
    const second = deferred<unknown>();
    scriptOther(() => second.promise);
    const user = userEvent.setup();
    renderPage();
    await loaded();
    await waitFor(() =>
      expect(screen.getByTestId("title-probe")).toHaveTextContent("ERP Migration|Initiative Report"),
    );
    await user.click(screen.getByRole("button", { name: "other-initiative" }));
    expect(spinner()).not.toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId("title-probe")).toHaveTextContent(/^\|Initiative Report$/),
    );
    second.resolve({ ...CARD, id: "i2", name: "Second Initiative" });
    await waitFor(() =>
      expect(screen.getByTestId("title-probe")).toHaveTextContent("Second Initiative|Initiative Report"),
    );
  });

  it("keeps waiting for the current initiative when the one left answers first", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    mockApi.on("get", "/cards/i1", () => first.promise);
    scriptOther(() => second.promise);
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "other-initiative" }));
    first.resolve(CARD);
    await new Promise((r) => setTimeout(r, 20));
    // The reply for the initiative left neither ends the wait nor fails it.
    expect(spinner()).not.toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    second.resolve({ ...CARD, id: "i2", name: "Second Initiative" });
    expect(await screen.findByText("Second Initiative")).toBeInTheDocument();
  });

  it("never shows a failure of the initiative the reader has left", async () => {
    const first = deferred<unknown>();
    mockApi.on("get", "/cards/i1", () => first.promise);
    scriptOther({ ...CARD, id: "i2", name: "Second Initiative" });
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "other-initiative" }));
    await screen.findByText("Second Initiative");
    first.reject(new Error("late failure"));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("late failure")).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 5 })[0]).toHaveTextContent("Second Initiative");
  });

  it("says not found for a failure without a message", async () => {
    mockApi.on("get", "/cards/i1", () => Promise.reject(new Error("")));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent(/^Not found$/);
    expect(document.querySelector(".ppm-project-report")).toBeNull();
  });

  it("names the back link in its tooltip", async () => {
    const user = userEvent.setup();
    renderPage();
    await loaded();
    await user.hover(screen.getByRole("link", { name: "Back to the initiative" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Back to the initiative");
  });
});

describe("PpmProjectReport — the initiative's values", () => {
  it("leaves out a date or a status that is not text", async () => {
    mockApi.on("get", "/cards/i1", {
      ...CARD,
      attributes: { startDate: Date.UTC(2025, 0, 15), endDate: "2026-06-30", initiativeStatus: 7 },
    });
    renderPage();
    await loaded();
    const params = document.querySelector(".report-print-params")!;
    expect(params).not.toHaveTextContent("Start Date");
    expect(params).toHaveTextContent("End Date: 2026-06-30");
    expect(params).not.toHaveTextContent("Initiative Status");
    const timeline = within(section("overview")!).getByText("Timeline").closest(".MuiPaper-root");
    expect(timeline).toHaveTextContent("Start Date—End Date2026-06-30");
    expect(timeline).toHaveTextContent(/Initiative Status—$/);
  });

  it("reads a card without attributes", async () => {
    mockApi.on("get", "/cards/i1", { ...CARD, attributes: null });
    renderPage();
    await loaded();
    expect(document.querySelector(".report-print-params")).not.toHaveTextContent("Initiative Status");
    expect(
      within(section("overview")!).getByText("Timeline").closest(".MuiPaper-root"),
    ).toHaveTextContent(/Initiative Status—$/);
  });

  it("names the status from the initiativeStatus field only", async () => {
    withMetamodel([
      {
        ...INITIATIVE_TYPE,
        fields_schema: [
          {
            section: "Other",
            fields: [
              {
                key: "phase",
                label: "Phase",
                type: "single_select",
                options: [{ key: "onTrack", label: "Another field's label" }],
              },
            ],
          },
          ...INITIATIVE_TYPE.fields_schema,
        ],
      } as unknown as CardType,
    ]);
    renderPage();
    await loaded();
    expect(document.querySelector(".report-print-params")).toHaveTextContent(
      "Initiative Status: On Track (metamodel)",
    );
    expect(screen.queryByText("Another field's label")).not.toBeInTheDocument();
  });

  it("shows the stored status when its field lists no options", async () => {
    withMetamodel([
      {
        ...INITIATIVE_TYPE,
        fields_schema: [
          { section: "Status", fields: [{ key: "initiativeStatus", label: "Status", type: "text" }] },
        ],
      } as unknown as CardType,
    ]);
    renderPage();
    await loaded();
    expect(document.querySelector(".report-print-params")).toHaveTextContent(
      "Initiative Status: onTrack",
    );
  });
});

describe("PpmProjectReport — section chips state", () => {
  it("fills a shown section's chip and outlines a hidden one", async () => {
    const user = userEvent.setup();
    renderPage();
    await loaded();
    const chip = () => screen.getByRole("button", { name: /Risk Management/ });
    expect(chip()).toHaveClass("MuiChip-colorPrimary", "MuiChip-filled");
    expect(chip()).not.toHaveClass("MuiChip-outlined");
    await user.click(chip());
    expect(chip()).toHaveClass("MuiChip-colorDefault", "MuiChip-outlined");
    expect(chip()).not.toHaveClass("MuiChip-filled");
  });
});

describe("PpmProjectReport — figures", () => {
  it("colours a variance of exactly zero as a success", async () => {
    mockApi.on("get", `${BASE}/costs`, [
      { ...COSTS[0], actual: 300_000 },
      { ...COSTS[1], actual: 100_000 },
    ]);
    renderPage();
    await loaded();
    const variance = within(section("overview")!).getByText("Variance").closest(".MuiPaper-root")!;
    expect(variance).toHaveTextContent(/^balanceVariance\$0$/);
    expect(getComputedStyle(variance).borderLeft).toMatch(/rgb\(46, 125, 50\)/);
  });

  it("explains a variance from two derived sides with both derivations", async () => {
    mockApi.on("get", `${BASE}/costs`, []);
    mockApi.on("get", `${BASE}/budgets`, []);
    mockApi.on("get", `${BASE}/rollup`, ROLLUP_BENEATH);
    const user = userEvent.setup();
    renderPage();
    await loaded();
    const variance = within(section("overview")!).getByText("Variance").closest(".MuiPaper-root")!;
    await user.hover(variance.querySelector("[data-derived]")!);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      /^No budget lines of its own: budget of the 2 initiatives beneath it · No cost lines of its own: actuals of the 2 initiatives beneath it$/,
    );
  });

  it("lists the derived budget by year from the budgets beneath, not their actuals", async () => {
    mockApi.on("get", `${BASE}/budgets`, []);
    mockApi.on("get", `${BASE}/costs`, []);
    mockApi.on("get", `${BASE}/rollup`, ROLLUP_BENEATH);
    renderPage();
    await loaded();
    const cs = section("costs")!;
    const budget = within(cs).getByTestId("ppm-budget-table");
    expect(budget).toHaveTextContent("FY 2025$1500000$500000$2000000");
    expect(budget).not.toHaveTextContent("$400000");
    const costs = within(cs).getByTestId("ppm-cost-table");
    expect(costs).toHaveTextContent("$400000$100000$500000");
    expect(costs).not.toHaveTextContent("$1500000");
  });

  it("gives the span beneath with one end open", async () => {
    mockApi.on("get", `${BASE}/budgets`, []);
    mockApi.on("get", `${BASE}/rollup`, { ...ROLLUP_BENEATH, end_date: null });
    renderPage();
    await loaded();
    expect(within(section("overview")!).getByTestId("report-beneath")).toHaveTextContent(
      /From 2024-01-01 to —$/,
    );
  });

  it("colours the high-risk tile in the high band's colour", async () => {
    renderPage();
    await loaded();
    const high = within(section("risks")!).getByText("High Risks").closest(".MuiPaper-root")!;
    const probe = document.createElement("span");
    probe.style.color = bandColor("high");
    expect(getComputedStyle(high).borderLeft).toContain(probe.style.color);
  });
});

describe("PpmProjectReport — rows", () => {
  it("shows a dash for an earlier report without a reporter", async () => {
    mockApi.on("get", `${BASE}/reports`, [REPORTS[0], report("r2", "2026-02-01", { reporter: null })]);
    renderPage();
    await loaded();
    const rows = within(screen.getByTestId("report-earlier-table")).getAllByRole("row");
    expect(rows[1].querySelectorAll("td")[1]).toHaveTextContent(/^—$/);
  });

  it("links the addresses in a risk's description", async () => {
    mockApi.on("get", `${BASE}/risks`, [
      risk("k1", "Linked risk", 3, 4, { description: "See https://risk.example.com" }),
    ]);
    renderPage();
    await loaded();
    const table = within(section("risks")!).getByTestId("report-risk-table");
    expect(within(table).getByRole("link", { name: "https://risk.example.com" })).toHaveAttribute(
      "href",
      "https://risk.example.com",
    );
  });

  it("draws the schedule with work packages only, or tasks only", async () => {
    mockApi.on("get", `${BASE}/tasks`, []);
    const first = renderPage();
    await loaded();
    expect(within(section("schedule")!).getByText("Build phase")).toBeInTheDocument();
    expect(within(section("schedule")!).queryByText("Nothing recorded.")).not.toBeInTheDocument();
    first.unmount();

    mockApi.on("get", `${BASE}/tasks`, TASKS);
    mockApi.on("get", `${BASE}/wbs`, []);
    renderPage();
    await loaded();
    expect(within(section("schedule")!).getByText("Configure ledger")).toBeInTheDocument();
    expect(within(section("schedule")!).queryByText("Nothing recorded.")).not.toBeInTheDocument();
  });
});
