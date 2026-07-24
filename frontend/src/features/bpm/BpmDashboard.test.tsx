import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

/* ── mocks ─────────────────────────────────────────────────────── */

vi.mock("@/api/client", () => ({ api: { get: vi.fn() } }));
vi.mock("recharts", () => ({
  PieChart: ({ children }: any) => <div data-testid="pie-chart">{children}</div>,
  Pie: ({ data }: any) => <div data-testid="pie">{data?.map((d: any) => d.name).join(",")}</div>,
  Cell: () => null,
  BarChart: ({ children }: any) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
}));
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
  return {
    useProcessTypeOptions: () => ({
      options: [],
      byKey: new Map(),
      defaultKey: "core",
      loading: false,
      resolve: (key: string) => ({ key, label: LABELS[key] ?? key, color: "#00aa55" }),
    }),
  };
});

import { api } from "@/api/client";
import BpmDashboard from "./BpmDashboard";

const mockDashboard = {
  total_processes: 42,
  diagram_coverage: { with_diagram: 30, total: 42, percentage: 71 },
  by_process_type: { Core: 20, Support: 15, Management: 7 },
  by_maturity: { initial: 5, managed: 12, defined: 15, measured: 8, optimized: 2 },
  by_automation: { none: 10, partial: 20, full: 12 },
  by_risk: { low: 20, medium: 15, high: 5, critical: 2 },
  top_risk_processes: [
    { id: "p1", name: "Order Processing", risk: "critical", maturity: "initial" },
    { id: "p2", name: "Invoice Handling", risk: "high", maturity: "managed" },
  ],
};

function renderPage(route = "/bpm") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <BpmDashboard />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
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

  it("renders chart sections", async () => {
    renderPage();
    await userEvent.click(screen.getByText("Dashboard"));

    await waitFor(() => {
      expect(screen.getByText("By Process Type")).toBeInTheDocument();
      expect(screen.getByText("Maturity Distribution")).toBeInTheDocument();
      expect(screen.getByText("Automation Level")).toBeInTheDocument();
    });
  });

  it("labels the process-type pie with resolved metamodel labels, not raw keys (issue #857)", async () => {
    renderPage();
    await userEvent.click(screen.getByText("Dashboard"));

    await waitFor(() => {
      // "Management" resolves to the customized label "Strategic".
      expect(screen.getByTestId("pie")).toHaveTextContent("Core,Support,Strategic");
    });
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

    resolve!(mockDashboard);
    await waitFor(() => {
      expect(screen.getByText("42")).toBeInTheDocument();
    });
  });

  it("shows error state when API fails", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("fail"));

    renderPage();
    await userEvent.click(screen.getByText("Dashboard"));

    await waitFor(() => {
      expect(screen.getByText("Failed to load BPM dashboard.")).toBeInTheDocument();
    });
  });

  it("opens side panel when clicking a risk process row", async () => {
    renderPage();
    await userEvent.click(screen.getByText("Dashboard"));

    await waitFor(() => {
      expect(screen.getByText("Order Processing")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Order Processing"));
    expect(screen.getByTestId("card-side-panel")).toHaveAttribute("data-card-id", "p1");
  });
});
