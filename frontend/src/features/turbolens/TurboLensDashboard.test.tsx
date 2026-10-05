/**
 * TurboLens → Dashboard tab: what `GET /turbolens/overview` turns into — the
 * KPI tiles, the Bronze/Silver/Gold quality distribution, the cards-by-type
 * table (sorted by count, labelled from the metamodel, each row a deep link
 * into the inventory) and the top quality issues (each a link to the card).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { CARD_TYPES } from "@/test/fixtures/metamodel";
import { renderWithProviders } from "@/test/render";
import type { TurboLensOverview } from "@/types";
import TurboLensDashboard from "./TurboLensDashboard";

const OVERVIEW_URL = "/turbolens/overview";

const OVERVIEW: TurboLensOverview = {
  total_cards: 20,
  cards_by_type: { ITComponent: 4, Application: 12, CustomThing: 1 },
  quality_avg: 62.4,
  quality_bronze: 5,
  quality_silver: 10,
  quality_gold: 5,
  total_cost: 1_500_000,
  vendor_count: 7,
  duplicate_clusters: 3,
  modernization_count: 2,
  top_issues: [
    { id: "c-low", name: "Legacy CRM", type: "Application", data_quality: 12.4 },
    { id: "c-mid", name: "Oracle DB", type: "ITComponent", data_quality: 45 },
    { id: "c-ok", name: "Unknown Thing", type: "CustomThing", data_quality: 70 },
  ],
};

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <output data-testid="location">{`${pathname}${search}`}</output>;
}

function renderDashboard() {
  return renderWithProviders(
    <>
      <TurboLensDashboard />
      <LocationProbe />
    </>,
    { route: "/turbolens" },
  );
}

/** A KPI tile is the Paper around its label; its value is the tile's h5. */
function kpiValue(label: string): string | null {
  const tile = screen.getByText(label).closest(".MuiPaper-root") as HTMLElement;
  return tile.querySelector("h5")?.textContent ?? null;
}

/** The table under a section heading. */
function tableUnder(heading: string): HTMLElement {
  const paper = screen.getByText(heading).closest(".MuiPaper-root") as HTMLElement;
  return within(paper).getByRole("table");
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel(CARD_TYPES);
});

describe("TurboLensDashboard", () => {
  it("shows a spinner while the overview loads", async () => {
    let resolve: (v: TurboLensOverview) => void = () => {};
    mockApi.on("get", OVERVIEW_URL, () => new Promise<TurboLensOverview>((r) => (resolve = r)));
    renderDashboard();

    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    resolve(OVERVIEW);
    expect(await screen.findByText("Total Cards")).toBeInTheDocument();
  });

  it("renders the KPI tiles from the overview", async () => {
    mockApi.on("get", OVERVIEW_URL, OVERVIEW);
    renderDashboard();

    await screen.findByText("Total Cards");
    expect(kpiValue("Total Cards")).toBe("20");
    expect(kpiValue("Avg Quality")).toBe("62%");
    expect(kpiValue("Vendors")).toBe("7");
    expect(kpiValue("Duplicate Clusters")).toBe("3");
    expect(kpiValue("Modernizations")).toBe("2");
    expect(kpiValue("Annual IT Cost")).toBe("1.5M");
  });

  it("hides the cost tile when there is no cost", async () => {
    mockApi.on("get", OVERVIEW_URL, { ...OVERVIEW, total_cost: 0 });
    renderDashboard();

    await screen.findByText("Total Cards");
    expect(screen.queryByText("Annual IT Cost")).not.toBeInTheDocument();
  });

  it("renders the three quality tiers with their share of all cards", async () => {
    mockApi.on("get", OVERVIEW_URL, OVERVIEW);
    renderDashboard();

    expect(await screen.findByText("Data Quality Distribution")).toBeInTheDocument();
    for (const [tier, count, caption] of [
      ["Bronze", "5", "25% — Below 45% — Critical data gaps"],
      ["Silver", "10", "50% — 45–79% — Acceptable but needs improvement"],
      ["Gold", "5", "25% — 80%+ — High quality, well-documented"],
    ]) {
      const paper = screen.getByText(tier).closest(".MuiPaper-root") as HTMLElement;
      expect(within(paper).getByRole("heading", { level: 4 })).toHaveTextContent(count);
      expect(within(paper).getByText(caption)).toBeInTheDocument();
      expect(within(paper).getByRole("progressbar")).toHaveAttribute(
        "aria-valuenow",
        String(Math.round((Number(count) / 20) * 100)),
      );
    }
  });

  it("reports 0% for every tier when the landscape is empty", async () => {
    mockApi.on("get", OVERVIEW_URL, {
      ...OVERVIEW,
      total_cards: 0,
      quality_bronze: 0,
      quality_silver: 0,
      quality_gold: 0,
      cards_by_type: {},
      top_issues: [],
    });
    renderDashboard();

    await screen.findByText("Data Quality Distribution");
    expect(screen.getByText(/^0% — Below 45%/)).toBeInTheDocument();
    expect(screen.getByText(/^0% — 45–79%/)).toBeInTheDocument();
    expect(screen.getByText(/^0% — 80%\+/)).toBeInTheDocument();
    expect(within(tableUnder("Cards by Type")).getByText("No data")).toBeInTheDocument();
    expect(within(tableUnder("Top Quality Issues")).getByText("No quality issues found")).toBeInTheDocument();
  });

  it("lists cards by type, largest first, and deep-links each row into the inventory", async () => {
    mockApi.on("get", OVERVIEW_URL, OVERVIEW);
    const { user } = renderDashboard();

    await screen.findByText("Cards by Type");
    const rows = within(tableUnder("Cards by Type")).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([
      "Application12",
      "IT Component4",
      // A type the metamodel does not know is shown by its key.
      "CustomThing1",
    ]);

    await user.click(rows[1]);
    expect(screen.getByTestId("location")).toHaveTextContent("/inventory?type=ITComponent");
  });

  it("lists the top quality issues with a coloured bar and opens the card on click", async () => {
    mockApi.on("get", OVERVIEW_URL, OVERVIEW);
    const { user } = renderDashboard();

    await screen.findByText("Top Quality Issues");
    const table = tableUnder("Top Quality Issues");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);

    const [low, mid, ok] = rows;
    expect(within(low).getByText("Legacy CRM")).toBeInTheDocument();
    expect(within(low).getByText("Application")).toBeInTheDocument();
    expect(within(low).getByText("12%")).toBeInTheDocument();
    expect(within(low).getByRole("progressbar")).toHaveClass("MuiLinearProgress-colorError");
    expect(within(mid).getByText("IT Component")).toBeInTheDocument();
    expect(within(mid).getByRole("progressbar")).toHaveClass("MuiLinearProgress-colorWarning");
    expect(within(ok).getByText("CustomThing")).toBeInTheDocument();
    expect(within(ok).getByRole("progressbar")).toHaveClass("MuiLinearProgress-colorPrimary");

    await user.click(within(mid).getByText("Oracle DB"));
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/cards\/c-mid$/);
  });

  it("shows the no-data message when the overview cannot be loaded", async () => {
    mockApi.fail("get", OVERVIEW_URL);
    renderDashboard();

    expect(
      await screen.findByText("No data available yet. Run an analysis to get started."),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());
    expect(screen.queryByText("Total Cards")).not.toBeInTheDocument();
  });
});
