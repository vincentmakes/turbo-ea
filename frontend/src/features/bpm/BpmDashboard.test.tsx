import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { ThemeProvider, createTheme } from "@mui/material/styles";

/* ── mocks ─────────────────────────────────────────────────────── */

vi.mock("@/api/client", () => ({ api: { get: vi.fn() } }));
/**
 * jsdom has no canvas: the three charts are the shared EChart double, so a
 * test reads the option the dashboard built and delivers a click the way
 * ECharts would, with the clicked datum (which carries the raw option key).
 */
vi.mock("@/components/charts/EChart", () => import("@/test/echartMock").then((m) => m.echartModule()));
vi.mock("@/hooks/useIsRtl", () => import("@/test/hooks").then((m) => m.useIsRtlModule()));
vi.mock("./ProcessNavigator", () => ({
  default: () => <div data-testid="process-navigator">ProcessNavigator</div>,
}));
vi.mock("./BpmReportPage", () => ({
  default: () => <div data-testid="bpm-reports">BpmReports</div>,
}));
vi.mock("@/components/CardDetailSidePanel", () => ({
  default: ({ cardId, open }: { cardId: string | null; open: boolean; onClose: () => void }) =>
    open ? <div data-testid="card-side-panel" data-card-id={cardId}>SidePanel</div> : null,
}));
// Metamodel-driven process-type resolution (issue #857): the pie chart must
// show the admin-customized option labels/colors, not the raw stored keys.
vi.mock("./useProcessTypeOptions", () => {
  const LABELS: Record<string, string> = {
    Core: "Core",
    Support: "Support",
    Management: "Strategic",
  };
  const COLORS: Record<string, string> = {
    Core: "#00aa55",
    Support: "#0055aa",
    Management: "#aa0055",
  };
  return {
    useProcessTypeOptions: () => ({
      options: [],
      byKey: new Map(),
      defaultKey: "core",
      loading: false,
      resolve: (key: string) => ({ key, label: LABELS[key] ?? key, color: COLORS[key] ?? "#999999" }),
    }),
  };
});
// Maturity and automation level are single_select options too: their columns
// must be labelled from the metamodel, never with the stored key, and follow
// the field's option order (the order the options are listed in here).
vi.mock("./useBpmFieldOptions", () => {
  const OPTIONS: Record<string, Record<string, { label: string; color?: string }>> = {
    // The metamodel lists Management first: the pie follows this order, not
    // the dashboard's (and not the alphabet). Labels and colours come from
    // `useProcessTypeOptions`; only the order is read from here.
    processType: { Management: { label: "Strategic" }, Core: { label: "Core" }, Support: { label: "Support" } },
    maturity: {
      initial: { label: "Initial", color: "#123456" },
      managed: { label: "Managed" },
      defined: { label: "Defined" },
    },
    automationLevel: {
      manual: { label: "Manual", color: "#d32f2f" },
      partiallyAutomated: { label: "Partially automated" },
      fullyAutomated: { label: "Fully automated", color: "#4caf50" },
    },
    // Critical defines no colour (the risk scale fills it); High defines one.
    riskLevel: {
      critical: { label: "Critical" },
      high: { label: "High", color: "#654321" },
    },
  };
  return {
    useBpmFieldOptions: (field: string) => {
      const keys = Object.keys(OPTIONS[field] ?? {});
      return {
        loading: false,
        options: keys.map((key) => ({ key, ...OPTIONS[field][key] })),
        resolve: (key: string) => ({ key, ...(OPTIONS[field]?.[key] ?? { label: key }) }),
        order: (key: string) => (keys.includes(key) ? keys.indexOf(key) : keys.length),
      };
    },
  };
});

import { api } from "@/api/client";
import { echartState } from "@/test/echartMock";
import { hookState } from "@/test/hooks";
import { BPM_COLUMN_LABEL_WIDTH, MATURITY_COLORS, RISK_COLORS } from "./bpmChartOptions";
import { ATTR_COLORS } from "./processNavigatorState";
import { SEVERITY_COLORS, STATUS_COLORS, brand } from "@/theme/tokens";
import BpmDashboard from "./BpmDashboard";

/* eslint-disable @typescript-eslint/no-explicit-any -- option trees are plain JSON here */

const PIE = "By Process Type";
const MATURITY = "Maturity Distribution";
const AUTOMATION = "Automation Level";

const mockDashboard = {
  total_processes: 42,
  diagram_coverage: { with_diagram: 30, total: 42, percentage: 71 },
  by_process_type: { Core: 20, Support: 15, Management: 7, unknown: 4 },
  // Out of option order on purpose: the columns follow the metamodel's order,
  // keys it does not define last, in data order.
  by_maturity: { custom: 2, defined: 15, unknown: 1, initial: 5, legacy: 1, managed: 12 },
  by_automation: { fullyAutomated: 12, unknown: 3, manual: 10, partiallyAutomated: 20 },
  by_risk: { low: 20, medium: 15, high: 5, critical: 2 },
  top_risk_processes: [
    { id: "p1", name: "Order Processing", risk: "critical", maturity: "initial" },
    { id: "p2", name: "Invoice Handling", risk: "high", maturity: "managed" },
    { id: "p3", name: "Expense Claims", risk: "high", maturity: "gone" },
  ],
};

function Location() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

function renderPage(route = "/bpm") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <BpmDashboard />
      <Location />
    </MemoryRouter>,
  );
}

async function renderDashboard() {
  renderPage("/bpm?tab=dashboard");
  await screen.findByText("Total Processes");
}

const series = (name: string) => echartState.byName(name).option.series[0];

beforeEach(() => {
  vi.clearAllMocks();
  echartState.reset();
  hookState.isRtl = false;
  vi.mocked(api.get).mockResolvedValue(mockDashboard);
});

describe("BpmDashboard", () => {
  it("shows page title", () => {
    renderPage();
    expect(screen.getByText("Business Process Management")).toBeInTheDocument();
  });

  it("renders three tabs", () => {
    renderPage();
    expect(screen.getByText("Process Navigator")).toBeInTheDocument();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Reports")).toBeInTheDocument();
  });

  it("shows ProcessNavigator by default (tab 0)", () => {
    renderPage();
    expect(screen.getByTestId("process-navigator")).toBeInTheDocument();
  });

  it("switches to Dashboard tab", async () => {
    renderPage();
    await userEvent.click(screen.getByText("Dashboard"));

    await waitFor(() => {
      expect(screen.getByText("Total Processes")).toBeInTheDocument();
    });
    expect(api.get).toHaveBeenCalledWith("/reports/bpm/dashboard");
  });

  it("displays KPI cards on Dashboard tab", async () => {
    renderPage();
    await userEvent.click(screen.getByText("Dashboard"));

    await waitFor(() => {
      expect(screen.getByText("42")).toBeInTheDocument();
      expect(screen.getByText("Total Processes")).toBeInTheDocument();
      expect(screen.getByText("71%")).toBeInTheDocument();
      expect(screen.getByText("High Risk")).toBeInTheDocument();
      expect(screen.getByText("Critical Risk")).toBeInTheDocument();
    });
  });

  it("shows diagram coverage stats", async () => {
    renderPage();
    await userEvent.click(screen.getByText("Dashboard"));

    await waitFor(() => {
      expect(screen.getByText(/Diagram Coverage \(30\/42\)/)).toBeInTheDocument();
    });
  });

  it("renders chart sections, each chart named by its heading", async () => {
    await renderDashboard();

    expect(screen.getByText(PIE)).toBeInTheDocument();
    expect(screen.getByText(MATURITY)).toBeInTheDocument();
    expect(screen.getByText(AUTOMATION)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: PIE })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: MATURITY })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: AUTOMATION })).toBeInTheDocument();
    expect(echartState.props).toHaveLength(3);
  });

  it("draws each chart in a 220 px box", async () => {
    await renderDashboard();
    for (const name of [PIE, MATURITY, AUTOMATION]) {
      const box = screen.getByRole("img", { name }).parentElement!;
      expect(getComputedStyle(box).height).toBe("220px");
    }
  });

  it("labels the process-type pie with resolved metamodel labels, not raw keys (issue #857)", async () => {
    await renderDashboard();

    const pie = series(PIE);
    expect(pie.type).toBe("pie");
    // "Management" resolves to the customized label "Strategic"; "unknown" is dropped.
    expect(pie.data.map((d: any) => d.name)).toEqual(["Strategic", "Core", "Support"]);
    expect(pie.data.map((d: any) => d.key)).toEqual(["Management", "Core", "Support"]);
    expect(pie.data.map((d: any) => d.value)).toEqual([7, 20, 15]);
    expect(pie.data.map((d: any) => d.itemStyle.color)).toEqual(["#aa0055", "#00aa55", "#0055aa"]);
    expect(pie.cursor).toBe("pointer");
    expect(pie.name).toBe("Processes");
    expect(echartState.byName(PIE).option.legend.data).toEqual(["Strategic", "Core", "Support"]);
  });

  it("labels the maturity columns with the resolved option labels, not raw keys", async () => {
    await renderDashboard();

    const option = echartState.byName(MATURITY).option;
    expect(option.xAxis.data).toEqual(["Initial", "Managed", "Defined", "custom", "legacy"]);
    expect(option.series[0].type).toBe("bar");
    expect(option.series[0].name).toBe("Processes");
    expect(option.series[0].cursor).toBe("pointer");
    expect(option.series[0].data.map((d: any) => d.key)).toEqual([
      "initial",
      "managed",
      "defined",
      "custom",
      "legacy",
    ]);
    expect(option.series[0].data.map((d: any) => d.value)).toEqual([5, 12, 15, 2, 1]);
  });

  it("orders the maturity and automation columns by the field's options, unknown keys last", async () => {
    await renderDashboard();

    // Data order is custom, defined, initial, legacy, managed; option order is
    // initial, managed, defined; custom and legacy are not options.
    expect(series(MATURITY).data.map((d: any) => d.key)).toEqual([
      "initial",
      "managed",
      "defined",
      "custom",
      "legacy",
    ]);
    expect(echartState.byName(AUTOMATION).option.xAxis.data).toEqual([
      "Manual",
      "Partially automated",
      "Fully automated",
    ]);
  });

  it("orders the process-type slices by the metamodel's options, unknown types last in data order", async () => {
    vi.mocked(api.get).mockResolvedValue({
      ...mockDashboard,
      by_process_type: { Legacy: 3, Support: 15, Core: 20, Retired: 1, Management: 7, unknown: 2 },
    });
    await renderDashboard();

    expect(series(PIE).data.map((d: any) => d.key)).toEqual(["Management", "Core", "Support", "Legacy", "Retired"]);
    expect(series(PIE).data.map((d: any) => d.value)).toEqual([7, 20, 15, 3, 1]);
  });

  it("keeps every column label, wrapped at a space and truncated per line", async () => {
    await renderDashboard();

    for (const name of [MATURITY, AUTOMATION]) {
      const axisLabel = echartState.byName(name).option.xAxis.axisLabel;
      expect(axisLabel).toMatchObject({
        interval: 0,
        hideOverlap: false,
        overflow: "truncate",
        width: BPM_COLUMN_LABEL_WIDTH,
      });
      expect(axisLabel.formatter("Partially automated")).toBe("Partially\nautomated");
    }
  });

  it("colours each maturity column: option colour, else the CMMI scale, else neutral", async () => {
    await renderDashboard();

    expect(series(MATURITY).data.map((d: any) => d.itemStyle.color)).toEqual([
      "#123456",
      MATURITY_COLORS.managed,
      MATURITY_COLORS.defined,
      STATUS_COLORS.neutral,
      STATUS_COLORS.neutral,
    ]);
  });

  it("labels the automation columns with the resolved option labels, in one colour", async () => {
    await renderDashboard();

    const option = echartState.byName(AUTOMATION).option;
    expect(option.xAxis.data).toEqual(["Manual", "Partially automated", "Fully automated"]);
    expect(option.series[0].name).toBe("Processes");
    expect(option.series[0].cursor).toBe("pointer");
    expect(option.series[0].data.map((d: any) => d.key)).toEqual([
      "manual",
      "partiallyAutomated",
      "fullyAutomated",
    ]);
    expect(option.series[0].data.map((d: any) => d.itemStyle.color)).toEqual([
      brand.primary,
      brand.primary,
      brand.primary,
    ]);
  });

  it("mirrors the charts in a right-to-left language", async () => {
    hookState.isRtl = true;
    await renderDashboard();

    expect(echartState.byName(MATURITY).option.xAxis.inverse).toBe(true);
    expect(echartState.byName(MATURITY).option.yAxis.position).toBe("right");
    expect(echartState.byName(AUTOMATION).option.xAxis.inverse).toBe(true);
    expect(echartState.byName(AUTOMATION).option.yAxis.position).toBe("right");
    expect(echartState.byName(PIE).option.legend.left).toBe("right");
  });

  it("drills a process-type slice down to the inventory, by raw key", async () => {
    await renderDashboard();

    act(() => echartState.click(PIE, { name: "Strategic", data: { key: "Management" } }));
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/inventory?type=BusinessProcess&attr_processType=Management",
    );
  });

  it("drills a maturity column down to the inventory, by raw key", async () => {
    await renderDashboard();

    act(() => echartState.click(MATURITY, { name: "Defined", data: { key: "defined" } }));
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/inventory?type=BusinessProcess&attr_maturity=defined",
    );
  });

  it("drills an automation column down to the inventory, by raw key", async () => {
    await renderDashboard();

    act(() => echartState.click(AUTOMATION, { name: "Fully automated", data: { key: "fullyAutomated" } }));
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/inventory?type=BusinessProcess&attr_automationLevel=fullyAutomated",
    );
  });

  it("encodes the drilled key into the inventory URL", async () => {
    await renderDashboard();

    act(() => echartState.click(PIE, { data: { key: "R&D ops" } }));
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/inventory?type=BusinessProcess&attr_processType=R%26D%20ops",
    );
  });

  it("ignores a click that names no datum key", async () => {
    await renderDashboard();

    act(() => echartState.click(PIE, { name: "Strategic" }));
    act(() => echartState.click(MATURITY, { name: "Defined", data: {} }));
    act(() => echartState.click(AUTOMATION, { name: "Manual", data: { key: "" } }));
    expect(screen.getByTestId("location")).toHaveTextContent("/bpm?tab=dashboard");
  });

  it("shows top risk processes table", async () => {
    renderPage();
    await userEvent.click(screen.getByText("Dashboard"));

    await waitFor(() => {
      expect(screen.getByText("Top Risk Processes")).toBeInTheDocument();
      expect(screen.getByText("Order Processing")).toBeInTheDocument();
      expect(screen.getByText("Invoice Handling")).toBeInTheDocument();
    });
  });

  it("labels a risk row's maturity chip with the resolved option label, not the raw key", async () => {
    await renderDashboard();

    const chips = within(screen.getByRole("table"))
      .getAllByText(/./, { selector: ".MuiChip-label" })
      .map((el) => el.textContent);
    expect(chips).toEqual(["Critical", "Initial", "High", "Managed", "High", "gone"]);
    expect(screen.queryByText("initial")).not.toBeInTheDocument();
    expect(screen.queryByText("managed")).not.toBeInTheDocument();
  });

  it("labels a risk row's risk chip with the resolved riskLevel option label, not the raw key", async () => {
    await renderDashboard();

    const table = within(screen.getByRole("table"));
    expect(table.getByText("Critical")).toBeInTheDocument();
    expect(table.getAllByText("High")).toHaveLength(2);
    expect(screen.queryByText("critical")).not.toBeInTheDocument();
    expect(screen.queryByText("high")).not.toBeInTheDocument();
  });

  it("colours a risk chip with its riskLevel option's colour when the option defines one", async () => {
    await renderDashboard();

    for (const el of screen.getAllByText("High")) {
      const chip = el.closest(".MuiChip-root") as HTMLElement;
      expect(chip).toHaveStyle({ backgroundColor: "#654321" });
      expect(chip).toHaveStyle({ color: createTheme().palette.getContrastText("#654321") });
    }
  });

  it("colours a risk row's maturity chip like its chart column: option colour, else the CMMI scale, else neutral", async () => {
    await renderDashboard();

    const chip = (label: string) => screen.getByText(label).closest(".MuiChip-root") as HTMLElement;
    expect(chip("Initial")).toHaveStyle({ backgroundColor: "#123456" });
    expect(chip("Managed")).toHaveStyle({ backgroundColor: MATURITY_COLORS.managed });
    expect(chip("gone")).toHaveStyle({ backgroundColor: STATUS_COLORS.neutral });
  });

  it("colours a critical risk chip with the severity scale's critical, as the Process Navigator does", async () => {
    await renderDashboard();

    const chip = screen.getByText("Critical").closest(".MuiChip-root") as HTMLElement;
    expect(chip).toHaveStyle({ backgroundColor: SEVERITY_COLORS.critical });
    expect(chip).toHaveStyle({ color: createTheme().palette.getContrastText(SEVERITY_COLORS.critical) });
  });

  it("writes each chip's text in the colour that contrasts with its fill", async () => {
    await renderDashboard();

    const palette = createTheme().palette;
    const chip = (label: string) => screen.getByText(label).closest(".MuiChip-root") as HTMLElement;
    // A dark fill takes light text, a light one dark text — not white on both.
    const dark = palette.getContrastText("#123456");
    const light = palette.getContrastText(STATUS_COLORS.neutral);
    expect(dark).not.toBe(light);
    expect(chip("Initial")).toHaveStyle({ color: dark });
    expect(chip("gone")).toHaveStyle({ color: light });
  });

  it("fills a risk chip whose option defines no colour from the severity scale", async () => {
    vi.mocked(api.get).mockResolvedValue({
      ...mockDashboard,
      top_risk_processes: [
        { id: "p7", name: "Low One", risk: "low", maturity: "initial" },
        { id: "p8", name: "Medium One", risk: "medium", maturity: "initial" },
      ],
    });
    await renderDashboard();

    const chip = (label: string) => screen.getByText(label).closest(".MuiChip-root") as HTMLElement;
    expect(chip("low")).toHaveStyle({ backgroundColor: SEVERITY_COLORS.low });
    expect(chip("medium")).toHaveStyle({ backgroundColor: SEVERITY_COLORS.medium });
  });

  it("colours risk levels exactly as the Process Navigator's risk overlay does", () => {
    const navigator = Object.fromEntries(
      Object.entries(ATTR_COLORS.riskLevel).map(([level, { color }]) => [level, color]),
    );
    expect(RISK_COLORS).toEqual(navigator);
    // A "high" risk is the severity scale's orange, not the error red.
    expect(RISK_COLORS.high).toBe(SEVERITY_COLORS.high);
    expect(RISK_COLORS.high).not.toBe(STATUS_COLORS.error);
  });

  it("fills a risk chip whose level the scale does not know with the neutral grey", async () => {
    vi.mocked(api.get).mockResolvedValue({
      ...mockDashboard,
      top_risk_processes: [{ id: "p9", name: "Odd One", risk: "extreme", maturity: "initial" }],
    });
    await renderDashboard();

    const chip = screen.getByText("extreme").closest(".MuiChip-root") as HTMLElement;
    expect(chip).toHaveStyle({ backgroundColor: STATUS_COLORS.neutral });
    expect(chip).toHaveStyle({ color: createTheme().palette.getContrastText(STATUS_COLORS.neutral) });
  });

  it("colours the header icon with the theme's primary colour", () => {
    const { unmount } = renderPage();
    expect(screen.getByText("route")).toHaveStyle({ color: createTheme().palette.primary.main });
    unmount();

    // Follows the theme rather than a fixed hex.
    const teal = createTheme({ palette: { primary: { main: "#00897b" } } });
    render(
      <ThemeProvider theme={teal}>
        <MemoryRouter initialEntries={["/bpm"]}>
          <BpmDashboard />
        </MemoryRouter>
      </ThemeProvider>,
    );
    expect(screen.getByText("route")).toHaveStyle({ color: teal.palette.primary.main });
  });

  it("has All Processes button", async () => {
    renderPage();
    await userEvent.click(screen.getByText("Dashboard"));

    await waitFor(() => {
      expect(screen.getByText("All Processes")).toBeInTheDocument();
    });
  });

  it("switches to Reports tab", async () => {
    renderPage();
    await userEvent.click(screen.getByText("Reports"));

    expect(screen.getByTestId("bpm-reports")).toBeInTheDocument();
  });

  it("shows loading state on dashboard", async () => {
    let resolve: (v: any) => void;
    vi.mocked(api.get).mockReturnValue(new Promise((r) => { resolve = r; }));

    renderPage();
    await userEvent.click(screen.getByText("Dashboard"));

    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(echartState.props).toHaveLength(0);

    resolve!(mockDashboard);
    await waitFor(() => {
      expect(screen.getByText("42")).toBeInTheDocument();
    });
  });

  it("shows error state when API fails", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("fail"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    renderPage();
    await userEvent.click(screen.getByText("Dashboard"));

    await waitFor(() => {
      expect(screen.getByText("Failed to load BPM dashboard.")).toBeInTheDocument();
    });
    expect(echartState.props).toHaveLength(0);
  });

  it("opens side panel when clicking a risk process row", async () => {
    renderPage();
    await userEvent.click(screen.getByText("Dashboard"));

    await waitFor(() => {
      expect(screen.getByText("Order Processing")).toBeInTheDocument();
    });

    const row = screen.getByText("Order Processing").closest("tr") as HTMLElement;
    expect(getComputedStyle(row).cursor).toBe("pointer");
    await userEvent.click(screen.getByText("Order Processing"));
    expect(screen.getByTestId("card-side-panel")).toHaveAttribute("data-card-id", "p1");
  });
});
