/**
 * OverviewTab — the dashboard's KPI overview.
 *
 * Recharts is stubbed so each chart renders its data as plain buttons: the
 * assertions are about what `/reports/dashboard` turns into (KPI tiles, the
 * four charts' series, the browse-by-type list) and where each click goes.
 * The stub also exposes each `Cell`'s fill, a series' `name`, the tooltip and
 * legend text direction, and a "stray click" that hands a chart's handler an
 * index past the end of its data.
 * `RecentActivity` is the real component — it has its own test.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router";
import i18n from "@/i18n";
import { APPROVAL_STATUS_COLORS, DATA_QUALITY_COLORS, STATUS_COLORS } from "@/theme/tokens";
import type { DashboardData } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
vi.mock("@/hooks/useIsRtl", () => import("@/test/hooks").then((m) => m.useIsRtlModule()));

/* eslint-disable @typescript-eslint/no-explicit-any */
vi.mock("recharts", async () => {
  const { createContext, useContext } = await vi.importActual<typeof import("react")>("react");
  const DataCtx = createContext<any[]>([]);
  /** A click Recharts reports with an index past the end of the series. */
  const StrayClick = ({ onClick, index }: any) => (
    <span data-testid="stray-click" onClick={() => onClick?.(undefined, index)} />
  );
  return {
    ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
    BarChart: ({ data, children }: any) => (
      <DataCtx.Provider value={data ?? []}>
        <div data-testid="bar-chart">{children}</div>
      </DataCtx.Provider>
    ),
    Bar: ({ onClick, name, children }: any) => {
      const data = useContext(DataCtx);
      return (
        <div data-testid="bar-series" data-name={name}>
          {data.map((d: any, i: number) => (
            <button key={i} data-color={d.color} onClick={() => onClick?.(d, i)}>
              {`${d.name}: ${d.count}`}
            </button>
          ))}
          <StrayClick onClick={onClick} index={data.length} />
          {children}
        </div>
      );
    },
    PieChart: ({ children }: any) => <div data-testid="pie-chart">{children}</div>,
    Pie: ({ data, label, onClick, children }: any) => (
      <>
        {data.map((d: any, i: number) => (
          <button key={i} data-color={d.color} onClick={() => onClick?.(d, i)}>
            {`${d.name}: ${d.value}`}
          </button>
        ))}
        <StrayClick onClick={onClick} index={data.length} />
        {children}
        <svg data-testid="pie-labels">
          {/* Right of centre, left of it, straight up, then four Recharts could not place. */}
          {label({ cx: 100, cy: 100, midAngle: 0, outerRadius: 78, value: data[0]?.value })}
          {label({ cx: 100, cy: 100, midAngle: 180, outerRadius: 78 })}
          {label({ cx: 100, cy: 100, midAngle: 90, outerRadius: 78, value: 5 })}
          {label({ cy: 100, midAngle: 90, outerRadius: 78, value: 1 })}
          {label({ cx: 100, midAngle: 90, outerRadius: 78, value: 1 })}
          {label({ cx: 100, cy: 100, outerRadius: 78, value: 1 })}
          {label({ cx: 100, cy: 100, midAngle: 90, value: 1 })}
        </svg>
      </>
    ),
    Cell: ({ fill }: any) => <i data-testid="cell" data-fill={fill} />,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: ({ contentStyle }: any) => <span data-testid="tooltip" data-direction={contentStyle?.direction} />,
    Legend: ({ formatter, wrapperStyle }: any) => (
      <span data-testid="legend" data-direction={wrapperStyle?.direction}>
        {formatter("Draft")}
      </span>
    ),
  };
});
/* eslint-enable @typescript-eslint/no-explicit-any */

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { CARD_TYPES, makeCardType } from "@/test/fixtures/metamodel";
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
/** The fill of every bar / slice a chart paints, in order. */
const cellFills = (heading: string) =>
  within(section(heading))
    .queryAllByTestId("cell")
    .map((c) => c.getAttribute("data-fill"));
const colorOf = (key: string) => CARD_TYPES.find((t) => t.key === key)!.color;

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

  it("shows a failed dashboard load as an error and stops the progress bar", async () => {
    mockApi.fail("get", "/reports/dashboard", 500);
    renderTab();
    expect(await screen.findByRole("alert")).toHaveTextContent("GET /reports/dashboard failed");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText("Total Cards")).not.toBeInTheDocument();
  });

  it("falls back to a generic message when the dashboard fails without one", async () => {
    mockApi.on("get", "/reports/dashboard", () => Promise.reject("offline"));
    renderTab();
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
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
    // Every tile carries its own trend.
    expect(within(kpiTile("Total Cards")).getByText("+29.4%")).toBeInTheDocument();
    expect(within(kpiTile("Avg Completion")).getByText("+2.5%")).toBeInTheDocument();
    expect(within(kpiTile("Approved")).getByText("-9.1%")).toBeInTheDocument();
    expect(within(kpiTile("Approved")).getByText("(-1)")).toBeInTheDocument();
    expect(within(kpiTile("Broken")).getByText("+100.0%")).toBeInTheDocument();
    expect(within(kpiTile("Broken")).getByText("(+2)")).toBeInTheDocument();
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
    // The custom slice labels print the value outside the ring; a slice
    // Recharts could not place (any coordinate missing) gets no label.
    const labels = within(section("Approval Status Distribution")).getByTestId("pie-labels");
    const texts = Array.from(labels.querySelectorAll("text"));
    expect(texts.map((t) => t.textContent)).toEqual(["4", "0", "5"]);
    expect(texts.map((t) => t.getAttribute("text-anchor"))).toEqual(["start", "end", "start"]);
    expect(within(section("Approval Status Distribution")).getByTestId("legend")).toHaveTextContent("Draft");

    await user.click(within(section("Approval Status Distribution")).getByRole("button", { name: "Broken: 2" }));
    expect(await screen.findByTestId("landed")).toHaveTextContent("/inventory?approval_status=BROKEN");
  });

  it("places each slice label 14px outside the ring, at the slice's mid-angle", async () => {
    renderTab();
    await screen.findByText("Approval Status Distribution");
    const texts = Array.from(
      within(section("Approval Status Distribution")).getByTestId("pie-labels").querySelectorAll("text"),
    );
    const at = (el: Element) => [Number(el.getAttribute("x")), Number(el.getAttribute("y"))];
    // Centre (100, 100), outer radius 78 + 14; Recharts measures angles anticlockwise from 3 o'clock.
    const [right, left, top] = texts.map(at);
    expect(right[0]).toBeCloseTo(192);
    expect(right[1]).toBeCloseTo(100);
    expect(left[0]).toBeCloseTo(8);
    expect(left[1]).toBeCloseTo(100);
    expect(top[0]).toBeCloseTo(100);
    expect(top[1]).toBeCloseTo(8);
  });

  it("paints each bar and slice in its own colour and names each series", async () => {
    renderTab();
    await screen.findByText("Cards by Type");
    expect(cellFills("Cards by Type")).toEqual([
      colorOf("Application"),
      colorOf("Provider"),
      colorOf("ITComponent"),
      colorOf("Secret"),
    ]);
    expect(cellFills("Approval Status Distribution")).toEqual([
      APPROVAL_STATUS_COLORS.DRAFT,
      APPROVAL_STATUS_COLORS.APPROVED,
      APPROVAL_STATUS_COLORS.BROKEN,
    ]);
    expect(cellFills("Completion Distribution")).toEqual([
      DATA_QUALITY_COLORS["0-25"],
      DATA_QUALITY_COLORS["25-50"],
      DATA_QUALITY_COLORS["50-75"],
      DATA_QUALITY_COLORS["75-100"],
    ]);
    expect(cellFills("Lifecycle Overview")).toEqual([
      STATUS_COLORS.neutral,
      STATUS_COLORS.info,
      STATUS_COLORS.success,
      STATUS_COLORS.warning,
      STATUS_COLORS.error,
      STATUS_COLORS.neutral,
    ]);
    // The series name is what the bar tooltip prints next to the value.
    const seriesName = (heading: string) =>
      within(section(heading)).getByTestId("bar-series").getAttribute("data-name");
    expect(seriesName("Cards by Type")).toBe("Count");
    expect(seriesName("Completion Distribution")).toBe("Cards");
    expect(seriesName("Lifecycle Overview")).toBe("Cards");
    // Tooltips and the legend read left-to-right.
    expect(screen.getAllByTestId("tooltip").map((t) => t.getAttribute("data-direction"))).toEqual([
      "ltr",
      "ltr",
      "ltr",
      "ltr",
    ]);
    expect(screen.getByTestId("legend")).toHaveAttribute("data-direction", "ltr");
  });

  it("paints an approval status it has no colour for in the neutral colour", async () => {
    mockApi.on("get", "/reports/dashboard", { ...DATA, approval_statuses: { APPROVED: 3, ON_HOLD: 2 } });
    renderTab();
    await screen.findByText("Approval Status Distribution");
    expect(cellFills("Approval Status Distribution")).toEqual([
      APPROVAL_STATUS_COLORS.APPROVED,
      STATUS_COLORS.neutral,
    ]);
  });

  it("labels an approval status it has no translation for by its raw value", async () => {
    mockApi.on("get", "/reports/dashboard", { ...DATA, approval_statuses: { APPROVED: 3, ON_HOLD: 2 } });
    renderTab();
    await screen.findByText("Approval Status Distribution");
    expect(buttonsIn("Approval Status Distribution")).toEqual(["Approved: 3", "ON_HOLD: 2"]);
  });

  it("ignores a click Recharts cannot map to a bar or a slice", async () => {
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => {
      errors.push(e.error);
      e.preventDefault();
    };
    window.addEventListener("error", onError);
    try {
      renderTab();
      await screen.findByText("Cards by Type");
      fireEvent.click(within(section("Cards by Type")).getByTestId("stray-click"));
      fireEvent.click(within(section("Approval Status Distribution")).getByTestId("stray-click"));
      expect(errors).toEqual([]);
      expect(screen.queryByTestId("landed")).not.toBeInTheDocument();
      expect(screen.getByText("Cards by Type")).toBeInTheDocument();
    } finally {
      window.removeEventListener("error", onError);
    }
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

  it("counts each lifecycle phase under its own key", async () => {
    mockApi.on("get", "/reports/dashboard", {
      ...DATA,
      lifecycle_distribution: { plan: 1, phaseIn: 2, active: 3, phaseOut: 4, endOfLife: 5, none: 6 },
    });
    renderTab();
    await screen.findByText("Lifecycle Overview");
    expect(buttonsIn("Lifecycle Overview")).toEqual([
      "Plan: 1",
      "Phase In: 2",
      "Active: 3",
      "Phase Out: 4",
      "End of Life: 5",
      "Not Set: 6",
    ]);
  });

  it("relabels the lifecycle chart when the language changes", async () => {
    renderTab();
    await screen.findByText("Lifecycle Overview");
    try {
      await act(async () => {
        await i18n.changeLanguage("de");
      });
      await waitFor(() =>
        expect(buttonsIn("Lebenszyklus-Übersicht")).toEqual([
          "Planung: 2",
          "Einführung: 0",
          "Aktiv: 7",
          "Auslauf: 0",
          "End of Life: 0",
          "Nicht gesetzt: 0",
        ]),
      );
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
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
    // Tooltips and the legend read right-to-left.
    expect(screen.getAllByTestId("tooltip").map((t) => t.getAttribute("data-direction"))).toEqual([
      "rtl",
      "rtl",
      "rtl",
      "rtl",
    ]);
    expect(screen.getByTestId("legend")).toHaveAttribute("data-direction", "rtl");
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

  it("always lists Application, Business Capability, IT Component and Initiative — and nothing else empty", async () => {
    withMetamodel([
      ...CARD_TYPES,
      makeCardType({ key: "Initiative", label: "Initiative", icon: "rocket_launch", color: "#33cc58" }),
    ]);
    mockApi.on("get", "/reports/dashboard", { ...DATA, by_type: {} });
    renderTab();
    await screen.findByText("Browse by Type");
    const list = section("Browse by Type");
    const rows = within(list)
      .getAllByText(/^(Application|Business Capability|IT Component|Initiative|Provider|Secret)$/)
      .map((el) => el.textContent);
    expect(rows.sort()).toEqual(["Application", "Business Capability", "IT Component", "Initiative"]);
    for (const name of rows) {
      expect(within(within(list).getByText(name).parentElement as HTMLElement).getByText("0")).toBeInTheDocument();
    }
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
