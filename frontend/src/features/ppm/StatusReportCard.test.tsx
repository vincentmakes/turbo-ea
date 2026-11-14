/**
 * StatusReportCard and ReportHealth — one status report as the Status Reports
 * tab and the Initiative Report both show it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { PpmStatusReport } from "@/types";

vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

import "@/i18n";
import { hookState } from "@/test/hooks";
import { RAG_COLORS, STATUS_COLORS } from "@/theme/tokens";
import StatusReportCard, { ReportHealth } from "./StatusReportCard";

function report(overrides: Partial<PpmStatusReport> = {}): PpmStatusReport {
  return {
    id: "rep1",
    initiative_id: "i1",
    reporter_id: "u1",
    reporter: { id: "u1", display_name: "Ada Lovelace" },
    report_date: "2026-04-30",
    schedule_health: "atRisk",
    cost_health: "offTrack",
    scope_health: "onTrack",
    summary: "Going well, see https://wiki.example.com/status",
    accomplishments: "Cut over\nthe ledger",
    next_steps: "Hypercare",
    created_at: "2026-04-30T09:00:00",
    updated_at: "2026-04-30T09:00:00",
    ...overrides,
  };
}

beforeEach(() => {
  hookState.reset();
  // A format unlike the stored ISO date, so the card is seen to format it.
  hookState.dateFormat = "DD/MM/YYYY";
});

/** The block headed `title`: its heading's parent. */
const block = (title: string) => screen.getByText(title).parentElement as HTMLElement;

describe("ReportHealth", () => {
  it("draws one dot per dimension in order, each titled with its rating", () => {
    const { container } = render(<ReportHealth report={report()} />);
    expect(container).toHaveTextContent(/^ScheduleCostScope$/);
    expect(screen.getByTitle("At Risk")).toHaveStyle({ backgroundColor: RAG_COLORS.amber });
    expect(screen.getByTitle("Off Track")).toHaveStyle({ backgroundColor: RAG_COLORS.red });
    expect(screen.getByTitle("On Track")).toHaveStyle({ backgroundColor: RAG_COLORS.green });
    // Without showRating the words live only in the tooltips.
    expect(screen.queryByText("At Risk")).not.toBeInTheDocument();
  });

  it("says each rating in words beside its dimension with showRating", () => {
    const { container } = render(<ReportHealth report={report()} showRating />);
    expect(container).toHaveTextContent(/^ScheduleAt RiskCostOff TrackScopeOn Track$/);
    expect(screen.getByText("Off Track")).toBeInTheDocument();
  });

  it("says no report, in a neutral dot, for a dimension with no rating", () => {
    render(<ReportHealth report={report({ cost_health: "" })} showRating />);
    expect(screen.getByTitle("No Report")).toHaveStyle({ backgroundColor: STATUS_COLORS.neutral });
    expect(screen.getByText("No Report")).toBeInTheDocument();
  });
});

describe("StatusReportCard", () => {
  it("says each rating in words beside its dimension with showRatings", () => {
    render(<StatusReportCard report={report()} showRatings />);
    expect(screen.getByText("At Risk")).toBeInTheDocument();
    expect(screen.getByText("Off Track")).toBeInTheDocument();
    expect(screen.getByText("On Track")).toBeInTheDocument();
    // Still the same dots, titled with their rating.
    expect(screen.getByTitle("At Risk")).toHaveStyle({ backgroundColor: RAG_COLORS.amber });
  });

  it("shows the date, the health, the reporter and every block", () => {
    render(<StatusReportCard report={report()} />);
    expect(screen.getByText("30/04/2026")).toBeInTheDocument();
    expect(screen.getByTitle("At Risk")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(block("Summary")).toHaveTextContent("Going well, see https://wiki.example.com/status");
    expect(block("Accomplishments")).toHaveTextContent("Cut over the ledger");
    expect(block("Next Steps")).toHaveTextContent("Hypercare");
    // The header shows no rating text: the tab's look.
    expect(screen.queryByText("At Risk")).not.toBeInTheDocument();
    // A divider separates the summary from what was done and what comes next.
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("links an address in the text and keeps the author's line breaks", () => {
    render(<StatusReportCard report={report()} />);
    expect(screen.getByRole("link", { name: "https://wiki.example.com/status" })).toHaveAttribute(
      "href",
      "https://wiki.example.com/status",
    );
    const body = within(block("Accomplishments")).getByText(/Cut over/);
    expect(body).toHaveStyle({ whiteSpace: "pre-wrap", overflowWrap: "anywhere" });
  });

  it("leaves out the blocks a report does not have, and the divider when nothing follows the summary", () => {
    render(
      <StatusReportCard
        report={report({ accomplishments: null, next_steps: null, reporter: undefined })}
      />,
    );
    expect(screen.getByText("Summary")).toBeInTheDocument();
    expect(screen.queryByText("Accomplishments")).not.toBeInTheDocument();
    expect(screen.queryByText("Next Steps")).not.toBeInTheDocument();
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
  });

  it("keeps the divider when only next steps follow", () => {
    render(<StatusReportCard report={report({ summary: null, accomplishments: null })} />);
    expect(screen.queryByText("Summary")).not.toBeInTheDocument();
    expect(screen.getByRole("separator")).toBeInTheDocument();
    expect(screen.getByText("Next Steps")).toBeInTheDocument();
  });

  it("keeps the divider when only accomplishments follow", () => {
    render(<StatusReportCard report={report({ next_steps: null })} />);
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("spaces the summary and accomplishments from what follows them", () => {
    render(<StatusReportCard report={report()} />);
    expect(block("Summary")).toHaveStyle({ marginBottom: "16px" });
    expect(block("Accomplishments")).toHaveStyle({ marginBottom: "12px" });
  });

  it("renders the actions it is given at the header's end", () => {
    render(
      <StatusReportCard report={report()} actions={<button type="button">Edit it</button>} />,
    );
    const button = screen.getByRole("button", { name: "Edit it" });
    expect(button.parentElement).toHaveStyle({ flexShrink: "0" });
  });

  it("renders no action slot without actions", () => {
    const { container } = render(<StatusReportCard report={report()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    // The header holds only the date / health / reporter block.
    const header = container.querySelector(".MuiPaper-root > div") as HTMLElement;
    expect(header.children).toHaveLength(1);
  });

  it("is a raised card by default and an outlined one on request, spaced from the next", () => {
    const { container, rerender } = render(<StatusReportCard report={report()} />);
    const card = container.firstElementChild as HTMLElement;
    expect(card).toHaveClass("MuiPaper-elevation");
    expect(card).toHaveStyle({ marginBottom: "16px" });
    rerender(<StatusReportCard report={report()} variant="outlined" />);
    expect(container.firstElementChild).toHaveClass("MuiPaper-outlined");
  });
});
