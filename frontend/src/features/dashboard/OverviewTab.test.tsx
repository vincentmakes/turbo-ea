/**
 * OverviewTab — the dashboard's KPI overview.
 *
 * Recharts is stubbed so each chart renders its data as plain buttons: the
 * assertions are about what `/reports/dashboard` turns into (KPI tiles, the
 * four charts' series, the browse-by-type list) and where each click goes.
 * `RecentActivity` is the real component — it has its own test.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { useLocation } from "react-router";
import type { DashboardData } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
vi.mock("@/hooks/useIsRtl", () => import("@/test/hooks").then((m) => m.useIsRtlModule()));

/* eslint-disable @typescript-eslint/no-explicit-any */
vi.mock("recharts", async () => {
  const { createContext, useContext } = await vi.importActual<typeof import("react")>("react");
  const DataCtx = createContext<any[]>([]);
  return {
    ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
    BarChart: ({ data, children }: any) => (
      <DataCtx.Provider value={data ?? []}>
        <div data-testid="bar-chart">{children}</div>
      </DataCtx.Provider>
    ),
    Bar: ({ onClick }: any) => {
      const data = useContext(DataCtx);
      return (
        <>
          {data.map((d: any, i: number) => (
            <button key={i} data-color={d.color} onClick={() => onClick?.(d, i)}>
              {`${d.name}: ${d.count}`}
            </button>
          ))}
        </>
      );
    },
    PieChart: ({ children }: any) => <div data-testid="pie-chart">{children}</div>,
    Pie: ({ data, label, onClick }: any) => (
      <>
        {data.map((d: any, i: number) => (
          <button key={i} data-color={d.color} onClick={() => onClick?.(d, i)}>
            {`${d.name}: ${d.value}`}
          </button>
        ))}
        <svg data-testid="pie-labels">
          {/* One label right of centre, one left, and one Recharts could not place. */}
          {label({ cx: 100, cy: 100, midAngle: 0, outerRadius: 78, value: data[0]?.value })}
          {label({ cx: 100, cy: 100, midAngle: 180, outerRadius: 78 })}
          {label({ cy: 100, midAngle: 90, outerRadius: 78, value: 1 })}
        </svg>
      </>
    ),
    Cell: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    Legend: ({ formatter }: any) => <span data-testid="legend">{formatter("Draft")}</span>,
  };
});
/* eslint-enable @typescript-eslint/no-explicit-any */

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { CARD_TYPES } from "@/test/fixtures/metamodel";
import { makeUser, renderWithProviders } from "@/test/render";
import type { User } from "@/types";
import OverviewTab from "./OverviewTab";

const trend = (delta_abs: number | null, delta_pct: number | null) => ({
  current: 0,
  previous: 0,
  delta_abs,
  delta_pct,
});

const DATA: DashboardData = {
  total_cards: 22,
  by_type: { Application: 12, ITComponent: 3, Provider: 5, Secret: 2, BusinessCapability: 0 },
  avg_data_quality: 63,
  approval_statuses: { DRAFT: 4, APPROVED: 10, BROKEN: 2, REJECTED: 0 },
  data_quality_distribution: { "0-25": 1, "25-50": 2, "50-75": 3, "75-100": 4 },
  lifecycle_distribution: { plan: 2, active: 7 },
  recent_events: [
    {
      id: "e1",
      event_type: "card.created",
      card_id: "c1",
      card_name: "NexaCore ERP",
      user_display_name: "Ada",
      created_at: new Date().toISOString(),
    },
  ],
  trends: {
    comparison_days: 30,
    snapshot_available: true,
    snapshot_date: "2026-09-01",
    total_cards: trend(5, 29.4),
    avg_data_quality: trend(null, 2.5),
    approved_count: trend(-1, -9.1),
    broken_count: trend(2, 100),
  },
};

function Probe() {
  const { pathname, search } = useLocation();
  return <div data-testid="landed">{`${pathname}${search}`}</div>;
}

function renderTab(user: User = makeUser()) {
  return renderWithProviders(<OverviewTab />, {
    route: "/",
    user,
    routes: [
      { path: "/" },
      { path: "/inventory", element: <Probe /> },
      { path: "/reports/data-quality", element: <Probe /> },
      { path: "/reports/lifecycle", element: <Probe /> },
    ],
  });
}

/** The dashboard card under a heading. */
const section = (heading: string) =>
  screen.getByText(heading).closest(".MuiCardContent-root") as HTMLElement;
/** The value under a KPI tile's caption. */
const kpiTile = (caption: string) => screen.getByText(caption).closest(".MuiCardContent-root") as HTMLElement;
const buttonsIn = (heading: string) =>
  within(section(heading))
    .queryAllByRole("button")
    .map((b) => b.textContent);

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel(CARD_TYPES);
  mockApi.on("get", "/reports/dashboard", DATA);
});

describe("OverviewTab — loading and KPIs", () => {
  it("shows a progress bar until the dashboard arrives", async () => {
    let release!: (d: DashboardData) => void;
    mockApi.on("get", "/reports/dashboard", () => new Promise<DashboardData>((r) => (release = r)));
    renderTab();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    release(DATA);
    expect(await screen.findByText("Total Cards")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("renders the four KPI tiles with their trend indicators", async () => {
    renderTab();
    await screen.findByText("Total Cards");
    expect(within(kpiTile("Total Cards")).getByText("22")).toBeInTheDocument();
    expect(within(kpiTile("Avg Completion")).getByText("63%")).toBeInTheDocument();
    expect(within(kpiTile("Approved")).getByText("10")).toBeInTheDocument();
    expect(within(kpiTile("Broken")).getByText("2")).toBeInTheDocument();
    expect(within(kpiTile("Total Cards")).getByText(/\+5/)).toBeInTheDocument();
    expect(screen.getByText("Trend indicators are based on the last 30 days")).toBeInTheDocument();
  });

  it("drops the trend indicators and caption when no trend data exists", async () => {
    mockApi.on("get", "/reports/dashboard", { ...DATA, trends: undefined });
    renderTab();
    await screen.findByText("Total Cards");
    expect(screen.queryByText("Trend indicators are based on the last 30 days")).not.toBeInTheDocument();
    expect(within(kpiTile("Total Cards")).queryByText(/\+5/)).not.toBeInTheDocument();
  });
});

describe("OverviewTab — charts", () => {
  it("charts cards by type, largest first, and drills into the inventory", async () => {
    const { user } = renderTab();
    await screen.findByText("Cards by Type");
    expect(buttonsIn("Cards by Type")).toEqual([
      "Application: 12",
      "Provider: 5",
      "IT Component: 3",
      "Secret: 2",
    ]);
    expect(within(section("Cards by Type")).getByRole("button", { name: "Provider: 5" })).toHaveAttribute(
      "data-color",
      "#ffa31f",
    );
    await user.click(within(section("Cards by Type")).getByRole("button", { name: "Provider: 5" }));
    expect(await screen.findByTestId("landed")).toHaveTextContent("/inventory?type=Provider");
  });

  it("charts the non-zero approval statuses and drills into the inventory", async () => {
    const { user } = renderTab();
    await screen.findByText("Approval Status Distribution");
    expect(buttonsIn("Approval Status Distribution")).toEqual(["Draft: 4", "Approved: 10", "Broken: 2"]);
    // The custom slice labels print the value outside the ring.
    const labels = within(section("Approval Status Distribution")).getByTestId("pie-labels");
    expect(labels.querySelectorAll("text")).toHaveLength(2);
    expect(labels.querySelectorAll("text")[0]).toHaveTextContent("4");
    expect(labels.querySelectorAll("text")[0]).toHaveAttribute("text-anchor", "start");
    expect(labels.querySelectorAll("text")[1]).toHaveTextContent("0");
    expect(labels.querySelectorAll("text")[1]).toHaveAttribute("text-anchor", "end");
    expect(within(section("Approval Status Distribution")).getByTestId("legend")).toHaveTextContent("Draft");

    await user.click(within(section("Approval Status Distribution")).getByRole("button", { name: "Broken: 2" }));
    expect(await screen.findByTestId("landed")).toHaveTextContent("/inventory?approval_status=BROKEN");
  });

  it("charts the completion buckets and opens the data-quality report", async () => {
    const { user } = renderTab();
    await screen.findByText("Completion Distribution");
    expect(buttonsIn("Completion Distribution")).toEqual([
      "0 - 25%: 1",
      "25 - 50%: 2",
      "50 - 75%: 3",
      "75 - 100%: 4",
    ]);
    await user.click(within(section("Completion Distribution")).getByRole("button", { name: "50 - 75%: 3" }));
    expect(await screen.findByTestId("landed")).toHaveTextContent("/reports/data-quality");
  });

  it("charts every lifecycle phase, zero-filled, and opens the lifecycle report", async () => {
    const { user } = renderTab();
    await screen.findByText("Lifecycle Overview");
    expect(buttonsIn("Lifecycle Overview")).toEqual([
      "Plan: 2",
      "Phase In: 0",
      "Active: 7",
      "Phase Out: 0",
      "End of Life: 0",
      "Not Set: 0",
    ]);
    await user.click(within(section("Lifecycle Overview")).getByRole("button", { name: "Active: 7" }));
    expect(await screen.findByTestId("landed")).toHaveTextContent("/reports/lifecycle");
  });

  it("shows the empty states when there are no cards and no approval data", async () => {
    mockApi.on("get", "/reports/dashboard", {
      ...DATA,
      by_type: {},
      approval_statuses: { DRAFT: 0, APPROVED: 0 },
      data_quality_distribution: { odd: 1 },
    });
    renderTab();
    expect(await screen.findByText("No cards yet")).toBeInTheDocument();
    expect(screen.getByText("No data available.")).toBeInTheDocument();
    // An unknown completion bucket keeps its raw key.
    expect(buttonsIn("Completion Distribution")).toEqual(["odd: 1"]);
  });

  it("renders the charts right-to-left", async () => {
    hookState.isRtl = true;
    renderTab();
    expect(await screen.findAllByTestId("bar-chart")).toHaveLength(3);
    expect(within(section("Approval Status Distribution")).getByTestId("legend")).toHaveTextContent("Draft");
  });
});

describe("OverviewTab — browse by type and activity", () => {
  it("lists the always-shown types plus any with cards, never a hidden type", async () => {
    renderTab();
    await screen.findByText("Browse by Type");
    const list = section("Browse by Type");
    expect(within(list).getByText("Business Capability")).toBeInTheDocument();
    expect(within(list).getByText("Application")).toBeInTheDocument();
    expect(within(list).getByText("IT Component")).toBeInTheDocument();
    expect(within(list).getByText("Provider")).toBeInTheDocument();
    expect(within(list).queryByText("Secret")).not.toBeInTheDocument();
    // An always-shown type with no cards reads 0.
    const capability = within(list).getByText("Business Capability").parentElement as HTMLElement;
    expect(within(capability).getByText("0")).toBeInTheDocument();
  });

  it("opens the inventory filtered to a type from the list", async () => {
    const { user } = renderTab();
    await screen.findByText("Browse by Type");
    await user.click(within(section("Browse by Type")).getByText("IT Component"));
    expect(await screen.findByTestId("landed")).toHaveTextContent("/inventory?type=ITComponent");
  });

  it("omits a type the user's role may not view", async () => {
    renderTab(
      makeUser({
        role: "member",
        permissions: { "reports.ea_dashboard": true },
        type_permissions: { Provider: { "inventory.view": false } },
      }),
    );
    await screen.findByText("Browse by Type");
    expect(within(section("Browse by Type")).queryByText("Provider")).not.toBeInTheDocument();
    expect(within(section("Browse by Type")).getByText("Application")).toBeInTheDocument();
  });

  it("hands the recent events to the activity feed", async () => {
    renderTab();
    expect(await screen.findByText("Recent Activity")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "NexaCore ERP" })).toHaveAttribute("href", "/cards/c1");
  });
});
