/**
 * StakeholderCoverageSection: the admin dashboard's list of card types whose
 * cards lack a stakeholder. Only types with a gap are listed (eight at most),
 * each with a coverage bar, the gap in words and a link to its inventory.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import { useLocation } from "react-router";

vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

import i18n from "@/i18n";
import { hookState, withMetamodel } from "@/test/hooks";
import { makeCardType } from "@/test/fixtures/metamodel";
import { renderWithProviders } from "@/test/render";
import StakeholderCoverageSection, { type CoverageRow } from "./StakeholderCoverageSection";

const APP = makeCardType({
  key: "Application",
  label: "Application",
  translations: { label: { de: "Anwendung" } },
});
const ORG = makeCardType({ key: "Organization", label: "Organization" });

const row = (type: string, total: number, withStakeholders: number): CoverageRow => ({
  type,
  total,
  with_stakeholders: withStakeholders,
  missing: total - withStakeholders,
});

function Where() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{pathname + search}</div>;
}

function renderSection(rows: CoverageRow[], loading = false) {
  return renderWithProviders(<StakeholderCoverageSection rows={rows} loading={loading} />, {
    routes: [{ path: "/" }, { path: "/inventory", element: <Where /> }],
  });
}

/** The visible row for a type label: the clickable box around it. */
const rowOf = (label: string) => screen.getByText(label).parentElement as HTMLElement;
/** The coloured fill inside a row's coverage bar. */
const barOf = (label: string) =>
  screen.getByText(label).nextElementSibling!.firstElementChild as HTMLElement;

beforeEach(() => {
  hookState.reset();
  withMetamodel([APP, ORG]);
});

afterEach(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

describe("StakeholderCoverageSection", () => {
  it("shows a progress bar while loading", () => {
    renderSection([row("Application", 4, 1)], true);
    expect(screen.getByText("Stakeholder coverage by type")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText("Application")).not.toBeInTheDocument();
  });

  it("says so when every type is covered", () => {
    renderSection([row("Application", 4, 4)]);
    expect(
      screen.getByText("Every card type has at least one stakeholder coverage."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Application")).not.toBeInTheDocument();
  });

  it("lists only the types with a gap, with the gap in words", () => {
    renderSection([row("Application", 10, 7), row("Organization", 5, 5)]);
    expect(screen.getByText("Application")).toBeInTheDocument();
    expect(screen.getByText("3 of 10 missing")).toBeInTheDocument();
    expect(screen.queryByText("Organization")).not.toBeInTheDocument();
  });

  it("lists eight types at most", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`Type${i}`, 2, 1));
    renderSection(rows);
    expect(screen.getAllByText("1 of 2 missing")).toHaveLength(8);
    expect(screen.getByText("Type7")).toBeInTheDocument();
    expect(screen.queryByText("Type8")).not.toBeInTheDocument();
  });

  it("names a type in the user's language, and an unknown one by its key", async () => {
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    renderSection([row("Application", 2, 1), row("Gone", 2, 1)]);
    expect(screen.getByText("Anwendung")).toBeInTheDocument();
    expect(screen.getByText("Gone")).toBeInTheDocument();
  });

  it("fills the bar to the covered share, coloured by how much is covered", () => {
    renderSection([
      row("Application", 10, 4), // 40 %: poor
      row("Organization", 10, 6), // 60 %: middling
      row("Good", 100, 95), // 95 %: good
      row("Empty", 0, -1), // nothing to cover yet counts as 0 %
      row("Edge", 10, 8), // exactly 80 %: good
      row("Half", 2, 1), // exactly 50 %: middling
    ]);
    expect(barOf("Application")).toHaveStyle({ width: "40%", backgroundColor: "#ef6c00" });
    expect(barOf("Organization")).toHaveStyle({ width: "60%", backgroundColor: "#f5a623" });
    expect(barOf("Good")).toHaveStyle({ width: "95%", backgroundColor: "#43a047" });
    expect(barOf("Empty")).toHaveStyle({ width: "0%", backgroundColor: "#ef6c00" });
    expect(barOf("Edge")).toHaveStyle({ width: "80%", backgroundColor: "#43a047" });
    expect(barOf("Half")).toHaveStyle({ width: "50%", backgroundColor: "#f5a623" });
  });

  it("rounds the covered share to a whole percent", () => {
    renderSection([row("Application", 3, 2)]);
    expect(barOf("Application")).toHaveStyle({ width: "67%" });
  });

  it("opens the type's inventory", async () => {
    const { user } = renderSection([row("Organization", 3, 1)]);
    expect(rowOf("Organization")).toHaveStyle({ cursor: "pointer" });
    await user.click(screen.getByText("Organization"));
    expect(screen.getByTestId("where")).toHaveTextContent("/inventory?type=Organization");
  });
});
