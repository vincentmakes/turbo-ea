import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import type { ReportExportData } from "@/features/reports/reportExport";
import PpmPortfolio from "./PpmPortfolio";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const GANTT = [
  {
    id: "i1",
    name: "SAP S/4HANA Migration",
    subtype: "project",
    status: "ACTIVE",
    parent_id: null,
    start_date: "2026-01-15",
    end_date: "2026-11-30",
    cost_budget: 1350000,
    cost_actual: 578000,
    capex_planned: 1000000,
    capex_actual: 400000,
    opex_planned: 350000,
    opex_actual: 178000,
    group_id: "g1",
    group_name: "Finance",
    latest_report_id: "r1",
    latest_report: {
      id: "r1",
      report_date: "2026-05-01",
      schedule_health: "atRisk",
      cost_health: "onTrack",
      scope_health: "offTrack",
      summary: "Rollout slipping",
      reporter: { id: "u1", display_name: "Dana Ito" },
    },
    stakeholders: [
      { user_id: "u2", display_name: "Ana Ruiz", role_key: "itProjectManager" },
    ],
  },
  {
    id: "i2",
    name: "CRM Consolidation",
    subtype: null,
    status: "ACTIVE",
    parent_id: null,
    start_date: "2026-03-01",
    end_date: "2026-09-30",
    cost_budget: 0,
    cost_actual: 0,
    capex_planned: 0,
    capex_actual: 0,
    opex_planned: 200000,
    opex_actual: 90000,
    group_id: null,
    group_name: null,
    latest_report_id: null,
    latest_report: null,
    stakeholders: [],
  },
];

const DASHBOARD = {
  total_initiatives: 2,
  total_budget: 1550000,
  total_actual: 668000,
  health_schedule: { onTrack: 1, atRisk: 1, offTrack: 0 },
  health_cost: { onTrack: 2, atRisk: 0, offTrack: 0 },
  health_scope: { onTrack: 1, atRisk: 0, offTrack: 1 },
};

vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn((path: string) => {
      if (path.startsWith("/reports/ppm/gantt")) return Promise.resolve(GANTT);
      if (path.startsWith("/reports/ppm/dashboard")) return Promise.resolve(DASHBOARD);
      if (path.startsWith("/reports/ppm/group-options"))
        return Promise.resolve([
          { type_key: "Organization", type_label: "Organization" },
        ]);
      return Promise.resolve([]);
    }),
  },
  ApiError: class ApiError extends Error {},
}));

vi.mock("@/hooks/useCurrency", () => ({
  useCurrency: () => ({
    currency: "CHF",
    fmt: { format: (v: number) => `CHF ${v}` },
    fmtShort: (v: number) => `CHF${v}`,
    symbol: "CHF",
  }),
}));

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    types: [
      {
        key: "Organization",
        label: "Organization",
        translations: {},
        subtypes: [],
      },
      {
        key: "Initiative",
        label: "Initiative",
        translations: {},
        subtypes: [{ key: "project", label: "Project", translations: {} }],
      },
    ],
    relationTypes: [],
    loading: false,
    getType: (key: string) =>
      key === "Organization"
        ? { key: "Organization", label: "Organization", translations: {} }
        : undefined,
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
  }),
}));

const exportXlsx = vi.fn().mockResolvedValue(undefined);
const exportPptx = vi.fn().mockResolvedValue(undefined);
vi.mock("@/features/reports/reportExport", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/reports/reportExport")
  >("@/features/reports/reportExport");
  return {
    ...actual,
    exportReportToXlsx: (d: ReportExportData) => exportXlsx(d),
    exportReportToPptx: (d: ReportExportData) => exportPptx(d),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function renderPortfolio() {
  const view = render(
    <MemoryRouter>
      <PpmPortfolio />
    </MemoryRouter>,
  );
  await waitFor(() =>
    expect(screen.getByText("SAP S/4HANA Migration")).toBeInTheDocument(),
  );
  return view;
}

async function openExportMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /more actions/i }));
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PPM Portfolio print & export", () => {
  it("offers the same print button the reports do", async () => {
    await renderPortfolio();
    expect(
      screen.getByRole("button", { name: /print \/ save as pdf/i }),
    ).toBeInTheDocument();
  });

  it("offers both PowerPoint and Excel export", async () => {
    await renderPortfolio();
    await openExportMenu();

    await waitFor(() => {
      expect(screen.getByText("Export to PowerPoint (.pptx)")).toBeInTheDocument();
    });
    expect(screen.getByText("Export to Excel (.xlsx)")).toBeInTheDocument();
  });

  it("does not offer the saved-reports gallery, which belongs to /reports", async () => {
    await renderPortfolio();
    await openExportMenu();

    await waitFor(() => {
      expect(screen.getByText("Copy link")).toBeInTheDocument();
    });
    expect(screen.queryByText("View all saved reports")).not.toBeInTheDocument();
  });

  it("exports the grid as rows rather than scraping the Gantt DOM", async () => {
    await renderPortfolio();
    const user = await openExportMenu();
    await waitFor(() =>
      expect(screen.getByText("Export to Excel (.xlsx)")).toBeInTheDocument(),
    );
    await user.click(screen.getByText("Export to Excel (.xlsx)"));

    await waitFor(() => expect(exportXlsx).toHaveBeenCalled());
    const data = exportXlsx.mock.calls[0][0] as ReportExportData;
    expect(data.sheets).toHaveLength(1);

    const rows = data.sheets[0].rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      group: "Finance",
      name: "SAP S/4HANA Migration",
      subtype: "Project",
      pm: "Ana Ruiz",
      start: "2026-01-15",
      end: "2026-11-30",
      schedule: "At Risk",
      cost: "On Track",
      scope: "Off Track",
      capexPlanned: 1000000,
      capexActual: 400000,
      opexPlanned: 350000,
      opexActual: 178000,
      lastReport: "2026-05-01",
    });
    // An initiative with no status report still exports — with the health
    // columns reading "No Report" rather than silently blank.
    expect(rows[1]).toMatchObject({
      name: "CRM Consolidation",
      schedule: "No Report",
      pm: "",
    });
  });

  it("hands the PPTX export the chart node and a row selector so slides never cut mid-initiative", async () => {
    await renderPortfolio();
    const user = await openExportMenu();
    await waitFor(() =>
      expect(screen.getByText("Export to PowerPoint (.pptx)")).toBeInTheDocument(),
    );
    await user.click(screen.getByText("Export to PowerPoint (.pptx)"));

    await waitFor(() => expect(exportPptx).toHaveBeenCalled());
    const data = exportPptx.mock.calls[0][0] as ReportExportData;
    expect(data.paginateRowSelector).toBe("[data-export-row]");
    expect(data.chartNode).not.toBeNull();
    // Every initiative row, group header and totals row is an atomic block.
    expect(
      data.chartNode!.querySelectorAll("[data-export-row]").length,
    ).toBeGreaterThanOrEqual(GANTT.length);
  });

  it("carries the active filters into the print header", async () => {
    const { container } = await renderPortfolio();
    const params = container.querySelector(".report-print-params");
    expect(params).not.toBeNull();
    expect(within(params as HTMLElement).getByText("Group by:")).toBeInTheDocument();
    expect(params!.textContent).toContain("Organization");
  });
});
