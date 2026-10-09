/**
 * ApprovalPipelineSection: per card type, how many cards sit in Draft,
 * Broken and Rejected. Each type is a stacked bar whose segments open the
 * inventory filtered to that status; the type name opens it unfiltered.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import { useLocation } from "react-router";

vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

import i18n from "@/i18n";
import { hookState, withMetamodel } from "@/test/hooks";
import { makeCardType } from "@/test/fixtures/metamodel";
import { renderWithProviders } from "@/test/render";
import { APPROVAL_STATUS_COLORS } from "@/theme/tokens";
import ApprovalPipelineSection, { type PipelineRow } from "./ApprovalPipelineSection";

const APP = makeCardType({
  key: "Application",
  label: "Application",
  translations: { label: { de: "Anwendung" } },
});

const row = (type: string, draft: number, broken: number, rejected: number): PipelineRow => ({
  type,
  draft,
  broken,
  rejected,
  total: draft + broken + rejected,
});

function Where() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{pathname + search}</div>;
}

function renderSection(rows: PipelineRow[], loading = false) {
  return renderWithProviders(<ApprovalPipelineSection rows={rows} loading={loading} />, {
    routes: [{ path: "/" }, { path: "/inventory", element: <Where /> }],
  });
}

/** The stacked bar beside a type's name, and its segments. */
const segmentsOf = (label: string) =>
  Array.from(screen.getByText(label).nextElementSibling!.children) as HTMLElement[];

beforeEach(() => {
  hookState.reset();
  withMetamodel([APP]);
});

afterEach(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

describe("ApprovalPipelineSection", () => {
  it("shows a progress bar while loading", () => {
    renderSection([row("Application", 1, 0, 0)], true);
    expect(screen.getByText("Approval pipeline by type")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText("Application")).not.toBeInTheDocument();
  });

  it("says so when the pipeline is empty", () => {
    renderSection([]);
    expect(screen.getByText("Nothing in the approval pipeline right now.")).toBeInTheDocument();
    expect(screen.queryByText("Draft")).not.toBeInTheDocument();
  });

  it("shows the legend and each type's counts", () => {
    renderSection([row("Application", 3, 2, 1)]);
    for (const label of ["Draft", "Broken", "Rejected"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("3/2/1")).toBeInTheDocument();
  });

  it("colours the legend like the approval badges", () => {
    renderSection([row("Application", 1, 0, 0)]);
    const dot = (label: string) => screen.getByText(label).previousElementSibling!;
    expect(dot("Draft")).toHaveStyle({ backgroundColor: APPROVAL_STATUS_COLORS.DRAFT });
    expect(dot("Broken")).toHaveStyle({ backgroundColor: APPROVAL_STATUS_COLORS.BROKEN });
    expect(dot("Rejected")).toHaveStyle({ backgroundColor: APPROVAL_STATUS_COLORS.REJECTED });
  });

  it("lists eight types at most", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`Type${i}`, 1, 0, 0));
    renderSection(rows);
    expect(screen.getAllByText("1/0/0")).toHaveLength(8);
    expect(screen.getByText("Type7")).toBeInTheDocument();
    expect(screen.queryByText("Type8")).not.toBeInTheDocument();
  });

  it("names a type in the user's language, and an unknown one by its key", async () => {
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    renderSection([row("Application", 1, 0, 0), row("Gone", 1, 0, 0)]);
    expect(screen.getByText("Anwendung")).toBeInTheDocument();
    expect(screen.getByText("Gone")).toBeInTheDocument();
  });

  it("draws one segment per non-empty status, sized by its share", () => {
    renderSection([row("Application", 2, 0, 6)]);
    const segments = segmentsOf("Application");
    expect(segments).toHaveLength(2);
    expect(segments[0]).toHaveStyle({
      width: "25%",
      backgroundColor: APPROVAL_STATUS_COLORS.DRAFT,
    });
    expect(segments[1]).toHaveStyle({
      width: "75%",
      backgroundColor: APPROVAL_STATUS_COLORS.REJECTED,
    });
  });

  it("sizes against a total of at least one", () => {
    renderSection([{ type: "Application", draft: 1, broken: 0, rejected: 0, total: 0 }]);
    expect(segmentsOf("Application")[0]).toHaveStyle({ width: "100%" });
  });

  it("names a segment's status and count on hover", async () => {
    const { user } = renderSection([row("Application", 0, 4, 0)]);
    await user.hover(segmentsOf("Application")[0]);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Broken: 4");
  });

  it("opens the type's inventory from its name", async () => {
    const { user } = renderSection([row("Application", 1, 0, 0)]);
    await user.click(screen.getByText("Application"));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/inventory\?type=Application$/);
  });

  it.each([
    [row("Application", 1, 0, 0), "DRAFT"],
    [row("Application", 0, 1, 0), "BROKEN"],
    [row("Application", 0, 0, 1), "REJECTED"],
  ])("opens the inventory filtered to a segment's status", async (r, status) => {
    const { user } = renderSection([r]);
    await user.click(segmentsOf("Application")[0]);
    expect(screen.getByTestId("where")).toHaveTextContent(
      `/inventory?type=Application&approval_status=${status}`,
    );
  });
});
