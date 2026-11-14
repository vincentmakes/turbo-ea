import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import ReportShell from "./ReportShell";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, useNavigate: () => mockNavigate };
});

const exportMocks = vi.hoisted(() => ({ pptx: vi.fn(), xlsx: vi.fn() }));
vi.mock("./reportExport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./reportExport")>()),
  exportReportToPptx: exportMocks.pptx,
  exportReportToXlsx: exportMocks.xlsx,
}));

const mockPrintPage = vi.fn();
vi.mock("@/lib/printPage", () => ({ printPage: () => mockPrintPage() }));

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderShell(
  props: Partial<React.ComponentProps<typeof ReportShell>> = {},
) {
  return render(
    <MemoryRouter>
      <ReportShell title="Test Report" icon="bar_chart" {...props}>
        <div data-testid="report-content">Content</div>
      </ReportShell>
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ReportShell", () => {
  it("renders title and children", () => {
    renderShell();
    expect(screen.getByText("Test Report")).toBeInTheDocument();
    expect(screen.getByTestId("report-content")).toBeInTheDocument();
  });

  it("renders chart/table toggle when hasTableToggle and onViewChange provided", () => {
    const onViewChange = vi.fn();
    renderShell({ hasTableToggle: true, onViewChange, view: "chart" });

    // ToggleButtonGroup renders two toggle buttons with values "chart" and "table"
    const toggleButtons = screen.getAllByRole("button");
    expect(toggleButtons.length).toBeGreaterThanOrEqual(2);
  });

  it("hides chart/table toggle when hasTableToggle is false", () => {
    renderShell({ hasTableToggle: false });
    // No toggle button group rendered — only print + more actions buttons remain
    const buttons = screen.getAllByRole("button");
    // With hasTableToggle=false and no onSaveReport/onReset, only print + more actions = 2 buttons
    expect(buttons.length).toBe(2);
  });

  it("renders save report button when onSaveReport provided", () => {
    const onSave = vi.fn();
    renderShell({ onSaveReport: onSave });
    // MUI Tooltip wraps the button and adds aria-label
    expect(
      screen.getByRole("button", { name: /save report/i }),
    ).toBeInTheDocument();
  });

  it("calls onSaveReport when save button is clicked", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderShell({ onSaveReport: onSave });

    await user.click(screen.getByRole("button", { name: /save report/i }));
    expect(onSave).toHaveBeenCalled();
  });

  it("renders reset button when onReset provided", () => {
    const onReset = vi.fn();
    renderShell({ onReset });
    expect(
      screen.getByRole("button", { name: /reset to defaults/i }),
    ).toBeInTheDocument();
  });

  it("calls onReset when reset button is clicked", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    renderShell({ onReset });

    await user.click(
      screen.getByRole("button", { name: /reset to defaults/i }),
    );
    expect(onReset).toHaveBeenCalled();
  });

  it("marks its container with the theme mode and its title for print", () => {
    renderShell();
    const container = document.querySelector(".report-container")!;
    expect(container).toHaveAttribute("data-theme-mode", "light");
    expect(screen.getByText("Test Report")).toHaveClass("report-title");
    render(
      <ThemeProvider theme={createTheme({ palette: { mode: "dark" } })}>
        <MemoryRouter>
          <ReportShell title="Dark" icon="bar_chart">
            <div />
          </ReportShell>
        </MemoryRouter>
      </ThemeProvider>,
    );
    expect(screen.getByText("Dark").closest(".report-container")).toHaveAttribute("data-theme-mode", "dark");
  });

  it("centres its container at the given width, 1200 px by default, and sets the title in bold", () => {
    renderShell();
    const container = document.querySelector(".report-container")!;
    expect(container).toHaveStyle({ maxWidth: "1200px", marginLeft: "auto", marginRight: "auto" });
    expect(screen.getByText("Test Report")).toHaveStyle({ fontWeight: "700", minWidth: "0" });
    render(
      <MemoryRouter>
        <ReportShell title="Narrow" icon="bar_chart" maxWidth={640}>
          <div />
        </ReportShell>
      </MemoryRouter>,
    );
    expect(screen.getByText("Narrow").closest(".report-container")).toHaveStyle({ maxWidth: "640px" });
  });

  it("renders print button", () => {
    renderShell();
    expect(screen.getByRole("button", { name: /print/i })).toBeInTheDocument();
  });

  it("prints through printPage, the Safari-safe print call", async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    renderShell();
    await user.click(screen.getByRole("button", { name: /print/i }));
    expect(mockPrintPage).toHaveBeenCalledTimes(1);
    expect(print).not.toHaveBeenCalled();
    print.mockRestore();
  });

  it("renders saved report banner when savedReportName provided", () => {
    renderShell({ savedReportName: "My Saved Report" });
    expect(screen.getByText(/viewing saved report/i)).toBeInTheDocument();
    expect(screen.getByText("My Saved Report")).toBeInTheDocument();
  });

  it("renders Reset to defaults button in saved report banner", () => {
    const onResetSaved = vi.fn();
    renderShell({
      savedReportName: "Report 1",
      onResetSavedReport: onResetSaved,
    });
    // The banner has a "Reset to defaults" button
    const resetButtons = screen.getAllByRole("button", {
      name: /reset to defaults/i,
    });
    expect(resetButtons.length).toBeGreaterThanOrEqual(1);
  });

  it("does not render saved report banner when no savedReportName", () => {
    renderShell();
    expect(screen.queryByText(/viewing saved report/i)).not.toBeInTheDocument();
  });

  it("renders toolbar when provided", () => {
    renderShell({ toolbar: <div data-testid="custom-toolbar">Filters</div> });
    expect(screen.getByTestId("custom-toolbar")).toBeInTheDocument();
  });

  it("renders legend when provided", () => {
    renderShell({ legend: <div data-testid="custom-legend">Legend</div> });
    expect(screen.getByTestId("custom-legend")).toBeInTheDocument();
  });

  it("opens more actions menu and shows Copy link / View all saved reports", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: /more actions/i }));

    await waitFor(() => {
      expect(screen.getByText("Copy link")).toBeInTheDocument();
      expect(screen.getByText("View all saved reports")).toBeInTheDocument();
    });
  });

  it("closes menu after Copy link is clicked", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: /more actions/i }));
    await waitFor(() => {
      expect(screen.getByText("Copy link")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Copy link"));

    // Menu should close after clicking Copy link
    await waitFor(() => {
      expect(screen.queryByText("Copy link")).not.toBeInTheDocument();
    });
  });

  it("drops the saved-reports entry when disableSavedReportsLink is set", async () => {
    // The shell is reused outside /reports (the PPM Portfolio), where a link
    // into the saved-report gallery points at an unrelated part of the app.
    const user = userEvent.setup();
    renderShell({ disableSavedReportsLink: true });

    await user.click(screen.getByRole("button", { name: /more actions/i }));

    await waitFor(() => {
      expect(screen.getByText("Copy link")).toBeInTheDocument();
    });
    expect(
      screen.queryByText("View all saved reports"),
    ).not.toBeInTheDocument();
  });

  it("navigates to saved reports page when View all saved reports is clicked", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: /more actions/i }));
    await waitFor(() => {
      expect(screen.getByText("View all saved reports")).toBeInTheDocument();
    });
    await user.click(screen.getByText("View all saved reports"));

    expect(mockNavigate).toHaveBeenCalledWith("/reports/saved");
  });

  it("offers Excel export for a chart-only report that supplies buildExportData", async () => {
    // A report that hands over real tabular data isn't relying on the DOM
    // scrape, so the chart/table toggle is irrelevant to whether XLSX applies.
    // Without this the Matrix report — which has no table view — could never
    // export its data.
    const user = userEvent.setup();
    renderShell({
      chartRef: { current: document.createElement("div") },
      hasTableToggle: false,
      buildExportData: () => ({ title: "Test Report", sheets: [] }),
    });

    await user.click(screen.getByRole("button", { name: /more actions/i }));

    await waitFor(() => {
      expect(screen.getByText("Export to Excel (.xlsx)")).toBeInTheDocument();
    });
  });

  it("hides Excel export for a chart-only report with no buildExportData", async () => {
    const user = userEvent.setup();
    renderShell({
      chartRef: { current: document.createElement("div") },
      hasTableToggle: false,
    });

    await user.click(screen.getByRole("button", { name: /more actions/i }));

    await waitFor(() => {
      expect(
        screen.getByText("Export to PowerPoint (.pptx)"),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByText("Export to Excel (.xlsx)"),
    ).not.toBeInTheDocument();
  });

  it("renders print params when provided", () => {
    renderShell({
      printParams: [
        { label: "Type", value: "Application" },
        { label: "View", value: "Table" },
      ],
    });
    expect(screen.getByText(/Type:/)).toBeInTheDocument();
    expect(screen.getByText(/Application/)).toBeInTheDocument();
  });

  it("renders an extra view button between chart and table, and fires onViewChange with its value", async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();
    renderShell({
      view: "chart",
      onViewChange,
      extraViews: [
        {
          value: "sankey",
          icon: "waterfall_chart",
          label: "Sankey chart view",
        },
      ],
    });

    const sankeyBtn = screen.getByRole("button", {
      name: /sankey chart view/i,
    });
    await user.click(sankeyBtn);
    expect(onViewChange).toHaveBeenCalledWith("sankey");
  });

  it("uses chartViewLabel to override the chart button's tooltip", () => {
    renderShell({
      view: "chart",
      onViewChange: vi.fn(),
      chartViewLabel: "Treemap chart view",
    });
    expect(
      screen.getByRole("button", { name: /treemap chart view/i }),
    ).toBeInTheDocument();
  });

  it("does not render empty print params", () => {
    renderShell({
      printParams: [
        { label: "Type", value: "" },
        { label: "View", value: "Table" },
      ],
    });
    // Only "View" should be rendered since "Type" has empty value
    expect(screen.queryByText(/Type:/)).not.toBeInTheDocument();
    expect(screen.getByText(/View:/)).toBeInTheDocument();
  });

  describe("export formats, progress and failure", () => {
    const chartRef = () => ({ current: document.createElement("div") });
    const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole("button", { name: /more actions/i }));
      await screen.findByText("Copy link");
    };

    it("offers only the formats exportFormats lists, even with buildExportData", async () => {
      const user = userEvent.setup();
      renderShell({
        chartRef: chartRef(),
        hasTableToggle: false,
        exportFormats: ["pptx"],
        buildExportData: () => ({ title: "T", sheets: [] }),
      });
      await openMenu(user);
      expect(screen.getByText("Export to PowerPoint (.pptx)")).toBeInTheDocument();
      expect(screen.queryByText("Export to Excel (.xlsx)")).not.toBeInTheDocument();
    });

    it("drops PowerPoint when exportFormats lists Excel alone", async () => {
      const user = userEvent.setup();
      renderShell({
        chartRef: chartRef(),
        hasTableToggle: false,
        exportFormats: ["xlsx"],
        buildExportData: () => ({ title: "T", sheets: [] }),
      });
      await openMenu(user);
      expect(screen.getByText("Export to Excel (.xlsx)")).toBeInTheDocument();
      expect(screen.queryByText("Export to PowerPoint (.pptx)")).not.toBeInTheDocument();
    });

    it("still applies the view rule to a listed format", async () => {
      // PowerPoint follows the chart view; listing it does not force it on in table view.
      const user = userEvent.setup();
      renderShell({
        chartRef: chartRef(),
        hasTableToggle: true,
        view: "table",
        onViewChange: vi.fn(),
        exportFormats: ["pptx", "xlsx"],
      });
      await openMenu(user);
      expect(screen.getByText("Export to Excel (.xlsx)")).toBeInTheDocument();
      expect(screen.queryByText("Export to PowerPoint (.pptx)")).not.toBeInTheDocument();
    });

    it("keeps PowerPoint on in an extra chart view such as sankey", async () => {
      const user = userEvent.setup();
      renderShell({
        chartRef: chartRef(),
        hasTableToggle: true,
        view: "sankey",
        onViewChange: vi.fn(),
        extraViews: [{ value: "sankey", icon: "waterfall_chart", label: "Sankey chart view" }],
        exportFormats: ["pptx", "xlsx"],
      });
      await openMenu(user);
      expect(screen.getByText("Export to PowerPoint (.pptx)")).toBeInTheDocument();
    });

    it("shows progress and refuses a second click while an export runs", async () => {
      let finish: () => void = () => {};
      exportMocks.pptx.mockImplementation(() => new Promise<void>((r) => (finish = r)));
      const data = { title: "Deck", sheets: [] };
      const user = userEvent.setup();
      renderShell({ chartRef: chartRef(), hasTableToggle: false, buildExportData: () => data });
      await openMenu(user);
      await user.click(screen.getByText("Export to PowerPoint (.pptx)"));

      expect(exportMocks.pptx).toHaveBeenCalledTimes(1);
      expect(exportMocks.pptx).toHaveBeenCalledWith(data);
      const busy = screen.getByRole("button", { name: "Exporting…" });
      expect(busy).toBeDisabled();
      expect(busy).toHaveAttribute("aria-busy", "true");
      expect(screen.getByTestId("report-export-progress")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /more actions/i })).not.toBeInTheDocument();

      finish();
      const idle = await screen.findByRole("button", { name: /more actions/i });
      expect(idle).toBeEnabled();
      expect(idle).toHaveAttribute("aria-busy", "false");
      expect(screen.queryByTestId("report-export-progress")).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("says so when an export fails, and clears the message on the next try", async () => {
      exportMocks.xlsx.mockRejectedValueOnce(new Error("disk full"));
      const user = userEvent.setup();
      renderShell({
        chartRef: chartRef(),
        hasTableToggle: false,
        buildExportData: () => ({ title: "T", sheets: [] }),
      });
      await openMenu(user);
      await user.click(screen.getByText("Export to Excel (.xlsx)"));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("The export could not be created. Please try again.");
      expect(screen.getByRole("button", { name: /more actions/i })).toBeEnabled();

      exportMocks.xlsx.mockResolvedValueOnce(undefined);
      await openMenu(user);
      await user.click(screen.getByText("Export to Excel (.xlsx)"));
      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
      expect(exportMocks.xlsx).toHaveBeenCalledTimes(2);
    });

    it("offers PowerPoint, not Excel, in the chart view of a report with a table toggle", async () => {
      const user = userEvent.setup();
      renderShell({ chartRef: chartRef(), hasTableToggle: true, view: "chart", onViewChange: vi.fn() });
      await openMenu(user);
      expect(screen.getByText("Export to PowerPoint (.pptx)")).toBeInTheDocument();
      expect(screen.queryByText("Export to Excel (.xlsx)")).not.toBeInTheDocument();
    });

    it("names the actions button's tooltip after what it does, and says so while exporting", async () => {
      let finish: () => void = () => {};
      exportMocks.pptx.mockImplementation(() => new Promise<void>((r) => (finish = r)));
      const user = userEvent.setup();
      renderShell({ chartRef: chartRef(), hasTableToggle: false });
      // The tooltip labels the span that wraps the button (it stays hoverable while disabled).
      const anchor = () => document.querySelector(".report-actions [aria-busy]")?.parentElement;
      expect(anchor()).toHaveAttribute("aria-label", "More actions");
      await openMenu(user);
      await user.click(screen.getByText("Export to PowerPoint (.pptx)"));
      expect(anchor()).toHaveAttribute("aria-label", "Exporting…");
      finish();
      await screen.findByRole("button", { name: /more actions/i });
      expect(anchor()).toHaveAttribute("aria-label", "More actions");
    });

    it("dismisses the failure message on Escape, and shows it at the bottom centre", async () => {
      exportMocks.pptx.mockRejectedValueOnce(new Error("boom"));
      const user = userEvent.setup();
      renderShell({ chartRef: chartRef(), hasTableToggle: false });
      await openMenu(user);
      await user.click(screen.getByText("Export to PowerPoint (.pptx)"));
      const alert = await screen.findByRole("alert");
      expect(alert.closest(".MuiSnackbar-root")).toHaveClass("MuiSnackbar-anchorOriginBottomCenter");
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    });

    it("closes the failure message from its close button", async () => {
      exportMocks.pptx.mockRejectedValueOnce(new Error("boom"));
      const user = userEvent.setup();
      renderShell({ chartRef: chartRef(), hasTableToggle: false });
      await openMenu(user);
      await user.click(screen.getByText("Export to PowerPoint (.pptx)"));
      const alert = await screen.findByRole("alert");
      await user.click(within(alert).getByRole("button", { name: /close/i }));
      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    });
  });
});
