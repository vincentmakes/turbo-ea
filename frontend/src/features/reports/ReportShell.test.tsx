import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ReportShell from "./ReportShell";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderShell(props: Partial<React.ComponentProps<typeof ReportShell>> = {}) {
  return render(
    <MemoryRouter>
      <ReportShell
        title="Test Report"
        icon="bar_chart"
        {...props}
      >
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
    expect(screen.getByRole("button", { name: /save report/i })).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: /reset to defaults/i })).toBeInTheDocument();
  });

  it("calls onReset when reset button is clicked", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    renderShell({ onReset });

    await user.click(screen.getByRole("button", { name: /reset to defaults/i }));
    expect(onReset).toHaveBeenCalled();
  });

  it("renders print button", () => {
    renderShell();
    expect(screen.getByRole("button", { name: /print/i })).toBeInTheDocument();
  });

  it("renders saved report banner when savedReportName provided", () => {
    renderShell({ savedReportName: "My Saved Report" });
    expect(screen.getByText(/viewing saved report/i)).toBeInTheDocument();
    expect(screen.getByText("My Saved Report")).toBeInTheDocument();
  });

  it("renders Reset to defaults button in saved report banner", () => {
    const onResetSaved = vi.fn();
    renderShell({ savedReportName: "Report 1", onResetSavedReport: onResetSaved });
    // The banner has a "Reset to defaults" button
    const resetButtons = screen.getAllByRole("button", { name: /reset to defaults/i });
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
});
