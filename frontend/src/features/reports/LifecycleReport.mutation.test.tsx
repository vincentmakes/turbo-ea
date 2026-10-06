/**
 * What the Lifecycle report computes, pinned as data: where each phase bar
 * starts and ends on the time axis, where today sits, which years the axis
 * ticks, how far the timeline scrolls, what each card's current phase is,
 * how the table sorts, and what a saved report restores and persists.
 *
 * Positions are read from the computed `left` / `width` of the bars, which is
 * the only form the report renders them in. "Now" is pinned so the ±5-year
 * window around today is deterministic; every date sits mid-month so the
 * month labels hold in any time zone.
 *
 * The smoke tests live in LifecycleReport.test.tsx and the branch tests in
 * LifecycleReport.branches.test.tsx; this file runs against the real
 * `useSavedReport` (localStorage and `?saved_report_id=`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { useLocation, useNavigate } from "react-router";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useThumbnailCapture", () => ({
  // Captures nothing in jsdom, but hands the report's own "open the dialog"
  // callback straight through so the save flow is the report's.
  useThumbnailCapture: (openDialog: () => void) => ({
    chartRef: createRef(),
    thumbnail: undefined,
    captureAndSave: () => openDialog(),
  }),
}));
vi.mock("@/features/reports/SaveReportDialog", () => ({
  default: (props: { open: boolean; onClose: () => void; reportType: string; config: unknown }) =>
    props.open ? (
      <div data-testid="save-dialog" data-report-type={props.reportType}>
        <pre data-testid="save-config">{JSON.stringify(props.config)}</pre>
        <button onClick={props.onClose}>close-save</button>
      </div>
    ) : null,
}));
vi.mock("@/components/CardDetailSidePanel", () => ({
  default: (props: { cardId: string | null; open: boolean }) =>
    props.open ? <div data-testid="side-panel">{props.cardId}</div> : null,
}));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { makeCardType, makeField, makeOption, makeSection } from "@/test/fixtures/metamodel";
import { makeUser, wrapWithProviders } from "@/test/render";
import type { User } from "@/types";
import LifecycleReport from "./LifecycleReport";

// ---------------------------------------------------------------------------
// Time axis
// ---------------------------------------------------------------------------

const NOW = Date.parse("2026-07-01T00:00:00.000Z");
const FIVE_YEARS = 5 * 365.25 * 86400000;
const VIEW_MIN = NOW - FIVE_YEARS;
const VIEW_MAX = NOW + FIVE_YEARS;

/** The axis the report promises: ±5 years around today, widened to reach every date. */
function axis(...dates: string[]) {
  const ts = dates.map((d) => Date.parse(d));
  const min = Math.min(VIEW_MIN, ...ts);
  const max = Math.max(VIEW_MAX, ...ts);
  const range = max - min;
  const pct = (d: string | number) => (((typeof d === "string" ? Date.parse(d) : d) - min) / range) * 100;
  return { min, max, range, pct };
}

/** A local-midnight 1 January, as the ISO string a lifecycle date arrives in. */
const localNewYear = (y: number) => new Date(y, 0, 1).toISOString();

// ---------------------------------------------------------------------------
// Metamodel
// ---------------------------------------------------------------------------

const APP = makeCardType({ key: "Application", label: "Application" });
const SECRET = makeCardType({ key: "Secret", label: "Secret Type", is_hidden: true });
/**
 * Three date fields, and a start key that also contains "end" ("sp-end-Start"):
 * the end field must be the *other* "end" field, not the review date and not
 * the start field itself. Only two of the select fields can colour a bar.
 */
const CONTRACT = makeCardType({
  key: "Contract",
  label: "Supplier Contract",
  fields_schema: [
    makeSection({
      section: "Terms",
      fields: [
        makeField({ key: "spendStartDate", label: "Spend Start", type: "date" }),
        makeField({ key: "reviewDate", label: "Review", type: "date" }),
        makeField({ key: "spendEndDate", label: "Spend End", type: "date" }),
        makeField({ key: "notes", label: "Notes", type: "text" }),
        makeField({
          key: "regions",
          label: "Regions",
          type: "multiple_select",
          options: [makeOption({ key: "eu", label: "Europe", color: "#123456" })],
        }),
        makeField({ key: "flag", label: "Flag", type: "single_select" }),
        makeField({ key: "emptySel", label: "Empty Choice", type: "single_select", options: [] }),
        makeField({
          key: "health",
          label: "Health",
          type: "single_select",
          options: [
            makeOption({ key: "bad", label: "Bad", color: "#c62828" }),
            makeOption({ key: "good", label: "Good", color: "#2e7d32" }),
            makeOption({ key: "pending", label: "Pending" }),
          ],
        }),
        makeField({
          key: "tier",
          label: "Tier",
          type: "single_select",
          options: [makeOption({ key: "t1", label: "Tier 1", color: "#000000" })],
        }),
      ],
    }),
  ],
});
/** One date field is not a range. */
const SOLO = makeCardType({
  key: "Solo",
  label: "Solo Type",
  fields_schema: [
    makeSection({
      fields: [
        makeField({ key: "launch", label: "Launch", type: "date" }),
        makeField({
          key: "kind",
          label: "Kind",
          type: "single_select",
          options: [makeOption({ key: "a", label: "Kind A", color: "#111111" })],
        }),
      ],
    }),
  ],
});
/** Two date fields and nothing to colour by. */
const WINDOW = makeCardType({
  key: "Window",
  label: "Window",
  fields_schema: [
    makeSection({
      fields: [
        makeField({ key: "opensOn", label: "Opens", type: "date" }),
        makeField({ key: "closesOn", label: "Closes", type: "date" }),
      ],
    }),
  ],
});

// ---------------------------------------------------------------------------
// Roadmap payloads
// ---------------------------------------------------------------------------

/**
 * Wide reaches past the ±5-year window on both sides and skips Phase In; Narrow
 * enters Phase In and Active on the same day; Open has no later phase; Past is
 * at end of life.
 */
const GEO_ITEMS = [
  {
    id: "wide",
    name: "Wide Estate",
    type: "Application",
    lifecycle: { plan: "2015-03-15", active: "2019-03-15", phaseOut: "2030-03-15", endOfLife: "2036-03-15" },
  },
  {
    id: "narrow",
    name: "Narrow Tool",
    type: "Application",
    lifecycle: { phaseIn: "2024-05-15", active: "2024-05-15", endOfLife: "2028-09-15" },
  },
  { id: "open", name: "Open Ended", type: "Application", lifecycle: { active: "2023-01-15" } },
  {
    id: "past",
    name: "Past System",
    type: "Application",
    lifecycle: { active: "2017-06-15", endOfLife: "2024-01-15" },
  },
];

/**
 * Data order is not name order. Delta went Active exactly "now" and has a
 * future Phase Out; Alpha has a future end of life; Charlie only a future plan.
 */
const PHASE_TABLE_ITEMS = [
  {
    id: "delta",
    name: "Delta",
    type: "Application",
    lifecycle: { plan: "2025-02-15", active: "2026-07-01", phaseOut: "2027-03-15" },
  },
  {
    id: "bravo",
    name: "Bravo",
    type: "Contract",
    lifecycle: { active: "2019-04-15", endOfLife: "2025-08-15" },
  },
  { id: "charlie", name: "Charlie", type: "Application", lifecycle: { plan: "2030-06-15" } },
  {
    id: "alpha",
    name: "Alpha",
    type: "Solo",
    lifecycle: { phaseIn: "2026-01-15", endOfLife: "2033-11-15" },
  },
];

/** Date-range rows, in an order that matches no sort. */
const KILO_ITEMS = [
  {
    id: "k3",
    name: "Kilo Three",
    type: "Contract",
    lifecycle: {},
    attributes: { spendEndDate: "2025-10-15", health: "pending" },
  },
  {
    id: "k1",
    name: "Kilo One",
    type: "Contract",
    lifecycle: {},
    attributes: { spendStartDate: "2024-03-15", spendEndDate: "2027-03-15", health: "bad", tier: "t1" },
  },
  { id: "k4", name: "Kilo Four", type: "Contract", lifecycle: {}, attributes: {} },
  {
    id: "k2",
    name: "Kilo Two",
    type: "Contract",
    lifecycle: {},
    attributes: { spendStartDate: "2022-08-15", health: "good" },
  },
];

const HIERARCHY = [
  { id: "parent", name: "Parent App", type: "Application", parent_id: null },
  { id: "child", name: "Child App", type: "Application", parent_id: "parent" },
  { id: "other", name: "Other App", type: "Application", parent_id: null },
];
const SCOPED_ITEMS = [
  { id: "child", name: "Child App", type: "Application", lifecycle: { active: "2021-02-15" } },
  { id: "other", name: "Other App", type: "Application", lifecycle: { active: "2022-02-15" } },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = "turboea-report:lifecycle";
const LONG = { timeout: 5000 };

function renderReport(opts: { query?: string; user?: User } = {}) {
  return render(
    wrapWithProviders(<LifecycleReport />, {
      route: `/reports/lifecycle${opts.query ?? ""}`,
      user: opts.user,
    }),
  );
}

function storeConfig(cfg: Record<string, unknown>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

function persisted(): Record<string, unknown> | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

/** The timeline's parts: the date axis, one row per card, and the today line. */
function chart() {
  const paper = document.querySelector(".report-chart-area .MuiPaper-outlined") as HTMLElement;
  const flex = paper.firstElementChild as HTMLElement;
  const [names, timeline] = Array.from(flex.children) as HTMLElement[];
  const content = timeline.firstElementChild as HTMLElement;
  const [axisEl, ...rest] = Array.from(content.children) as HTMLElement[];
  return {
    names: Array.from(names.children).slice(1) as HTMLElement[],
    timeline,
    content,
    axis: axisEl,
    rows: rest.slice(0, -1),
    today: rest[rest.length - 1],
  };
}

const labelsIn = (el: Element) =>
  Array.from(el.querySelectorAll("[aria-label]")).map((e) => e.getAttribute("aria-label"));

const rowLabels = () => chart().rows.map(labelsIn);

const leftOf = (el: Element) => parseFloat(getComputedStyle(el).left);
const widthOf = (el: Element) => parseFloat(getComputedStyle(el).width);

function expectBar(label: string, left: number, width?: number) {
  const el = screen.getByLabelText(label);
  expect(leftOf(el)).toBeCloseTo(left, 6);
  if (width !== undefined) expect(widthOf(el)).toBeCloseTo(width, 6);
}

const tickLabels = () => Array.from(chart().axis.children).map((c) => c.textContent);

const printParams = () => document.querySelector(".report-print-params")?.textContent ?? null;

/** First-column text of every table body row. */
const bodyRows = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getAllByRole("cell")[0].textContent);

const sortHeader = (name: string) => screen.getByRole("button", { name });

async function pick(label: RegExp, option: RegExp) {
  // A menu closed by the previous pick may still be leaving.
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument(), LONG);
  fireEvent.mouseDown(await screen.findByRole("combobox", { name: label }, LONG));
  const listbox = await screen.findByRole("listbox");
  fireEvent.click(within(listbox).getByRole("option", { name: option }));
}

async function listOptions(label: RegExp) {
  fireEvent.mouseDown(await screen.findByRole("combobox", { name: label }, LONG));
  const listbox = await screen.findByRole("listbox");
  const names = within(listbox).getAllByRole("option").map((o) => o.textContent);
  fireEvent.keyDown(listbox, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument(), LONG);
  return names;
}

const rangeToggle = () => screen.getByRole("checkbox", { name: /date range view/i });

/** The warning glyph drawn beside an end-of-life card's name. */
const hasWarning = (name: string) => screen.getByText(name).parentElement!.textContent!.includes("warning");

async function openSaveDialog(): Promise<Record<string, unknown>> {
  fireEvent.click(screen.getByRole("button", { name: /save report/i }));
  return JSON.parse((await screen.findByTestId("save-config")).textContent!);
}

const DEFAULT_CONFIG = {
  cardTypeKey: "",
  view: "chart",
  sortK: "name",
  sortD: "asc",
  useCustomDates: false,
  customColorBy: "",
  scopeIds: [],
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  localStorage.clear();
  mockApi.reset();
  hookState.reset();
  withMetamodel([APP, SECRET, CONTRACT, SOLO, WINDOW]);
  mockApi.on("get", "/reports/roadmap", { items: GEO_ITEMS });
  mockApi.on("get", "/reports/roadmap?type=Application", { items: SCOPED_ITEMS });
  mockApi.on("get", "/reports/roadmap?type=Contract", { items: KILO_ITEMS });
  mockApi.on("get", "/reports/roadmap?type=Solo", { items: [] });
  mockApi.on("get", "/reports/roadmap?type=Window", { items: [] });
  mockApi.on("get", "/cards*", { items: HIERARCHY, total: HIERARCHY.length });
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Phase timeline geometry
// ---------------------------------------------------------------------------

describe("LifecycleReport phase timeline geometry", () => {
  const SCROLL_WIDTH = 2000;
  let scrollDesc: PropertyDescriptor | undefined;

  beforeEach(() => {
    scrollDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth");
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get: () => SCROLL_WIDTH,
    });
  });

  afterEach(() => {
    if (scrollDesc) Object.defineProperty(HTMLElement.prototype, "scrollWidth", scrollDesc);
    else delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
  });

  it("asks for every type's roadmap and draws each phase up to the next one that is set", async () => {
    renderReport();
    await screen.findByText("Wide Estate", undefined, LONG);
    expect(mockApi.callsOf("get", "/reports/roadmap*").map((c) => c.path)).toEqual(["/reports/roadmap"]);

    const g = axis("2015-03-15", "2036-03-15");
    expect(rowLabels()).toEqual([
      ["Plan: Mar 2015", "Active: Mar 2019", "Phase Out: Mar 2030", "End of Life: Mar 2036"],
      ["Phase In: May 2024", "Active: May 2024", "End of Life: Sep 2028"],
      ["Active: Jan 2023"],
      ["Active: Jun 2017", "End of Life: Jan 2024"],
    ]);

    // Plan runs to Active: the unset Phase In in between is skipped.
    expectBar("Plan: Mar 2015", g.pct("2015-03-15"), g.pct("2019-03-15") - g.pct("2015-03-15"));
    expectBar("Active: Mar 2019", g.pct("2019-03-15"), g.pct("2030-03-15") - g.pct("2019-03-15"));
    expectBar("Phase Out: Mar 2030", g.pct("2030-03-15"), g.pct("2036-03-15") - g.pct("2030-03-15"));
    // Zero-length phase keeps a sliver so it stays visible.
    expectBar("Phase In: May 2024", g.pct("2024-05-15"), 0.5);
    expectBar("Active: May 2024", g.pct("2024-05-15"), g.pct("2028-09-15") - g.pct("2024-05-15"));
    // Nothing after it: the bar runs to the end of the axis.
    expectBar("Active: Jan 2023", g.pct("2023-01-15"), 100 - g.pct("2023-01-15"));
    expectBar("Active: Jun 2017", g.pct("2017-06-15"), g.pct("2024-01-15") - g.pct("2017-06-15"));
  });

  it("marks end of life with a pin, not a bar", async () => {
    renderReport();
    await screen.findByText("Past System", undefined, LONG);
    const g = axis("2015-03-15", "2036-03-15");
    for (const [label, date] of [
      ["End of Life: Jan 2024", "2024-01-15"],
      ["End of Life: Sep 2028", "2028-09-15"],
      ["End of Life: Mar 2036", "2036-03-15"],
    ]) {
      const pin = screen.getByLabelText(label);
      expect(pin.querySelector("svg")).not.toBeNull();
      expect(leftOf(pin)).toBeCloseTo(g.pct(date), 6);
    }
  });

  it("spans the data beyond the ±5-year window and puts today where it falls", async () => {
    renderReport();
    await screen.findByText("Wide Estate", undefined, LONG);
    const g = axis("2015-03-15", "2036-03-15");
    const { content, today, timeline } = chart();
    // The drawing is as wide as the axis is long, relative to the 10-year viewport.
    expect(widthOf(content)).toBeCloseTo((g.range / (2 * FIVE_YEARS)) * 100, 6);
    expect(leftOf(today)).toBeCloseTo(g.pct(NOW), 6);
    // Scrolled so the viewport's left edge (today − 5 years) is in view.
    expect(timeline.scrollLeft).toBeCloseTo(SCROLL_WIDTH * ((VIEW_MIN - g.min) / g.range), 3);
  });

  it("ticks every 1 January inside the axis", async () => {
    renderReport();
    await screen.findByText("Wide Estate", undefined, LONG);
    const years = Array.from({ length: 21 }, (_, i) => String(2016 + i));
    expect(tickLabels()).toEqual(years);
    const g = axis("2015-03-15", "2036-03-15");
    const ticks = Array.from(chart().axis.children);
    expect(leftOf(ticks[0])).toBeCloseTo(g.pct(new Date(2016, 0, 1).getTime()), 6);
    expect(leftOf(ticks[4])).toBeCloseTo(g.pct(new Date(2020, 0, 1).getTime()), 6);
  });

  it("includes a 1 January that is exactly the first or last date", async () => {
    mockApi.on("get", "/reports/roadmap", {
      items: [
        {
          id: "x",
          name: "New Year",
          type: "Application",
          lifecycle: { plan: localNewYear(2015), endOfLife: localNewYear(2035) },
        },
      ],
    });
    renderReport();
    await screen.findByText("New Year", undefined, LONG);
    expect(tickLabels()).toEqual(Array.from({ length: 21 }, (_, i) => String(2015 + i)));
    // The end of life is still ahead, so nothing is flagged.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(hasWarning("New Year")).toBe(false);
  });

  it("keeps the ±5-year window when every date falls inside it", async () => {
    mockApi.on("get", "/reports/roadmap", {
      items: [{ id: "in", name: "Inside", type: "Application", lifecycle: { active: "2024-04-15" } }],
    });
    renderReport();
    await screen.findByText("Inside", undefined, LONG);
    const g = axis();
    const { content, today, timeline } = chart();
    expect(widthOf(content)).toBeCloseTo(100, 6);
    expect(leftOf(today)).toBeCloseTo(50, 6);
    expect(timeline.scrollLeft).toBe(0);
    expectBar("Active: Apr 2024", g.pct("2024-04-15"), 100 - g.pct("2024-04-15"));
    expect(tickLabels()).toEqual(["2022", "2023", "2024", "2025", "2026", "2027", "2028", "2029", "2030", "2031"]);
  });

  it("flags only the cards at end of life", async () => {
    renderReport();
    await screen.findByText("Past System", undefined, LONG);
    expect(screen.getByRole("alert")).toHaveTextContent("1 item at End of Life");
    expect(hasWarning("Past System")).toBe(true);
    expect(hasWarning("Wide Estate")).toBe(false);
    expect(hasWarning("Narrow Tool")).toBe(false);
    // The legend names every phase.
    const legend = document.querySelector(".report-legend") as HTMLElement;
    for (const phase of ["Plan", "Phase In", "Active", "Phase Out", "End of Life"]) {
      expect(within(legend).getByText(phase)).toBeInTheDocument();
    }
  });
});

// ---------------------------------------------------------------------------
// Date-range geometry
// ---------------------------------------------------------------------------

describe("LifecycleReport date-range geometry", () => {
  /** Start dates hold both ends of the axis; one card carries no attributes at all. */
  const START_EXTREMES = [
    {
      id: "g1",
      name: "Both Ends",
      type: "Contract",
      lifecycle: {},
      attributes: { spendStartDate: "2014-02-15", spendEndDate: "2026-02-15", health: "good" },
    },
    { id: "g2", name: "Late Start", type: "Contract", lifecycle: {}, attributes: { spendStartDate: "2037-08-15" } },
    {
      id: "g3",
      name: "Open Start",
      type: "Contract",
      lifecycle: {},
      attributes: { spendStartDate: "2027-06-15", health: "bad" },
    },
    {
      id: "g4",
      name: "End Only",
      type: "Contract",
      lifecycle: {},
      attributes: { spendEndDate: "2029-04-15", health: "pending" },
    },
    { id: "g5", name: "No Dates", type: "Contract", lifecycle: {}, attributes: {} },
    { id: "g6", name: "Bare Item", type: "Contract", lifecycle: { active: "2021-09-15" } },
  ];

  it("widens the axis to the attribute dates even in phase mode", async () => {
    mockApi.on("get", "/reports/roadmap?type=Contract", { items: START_EXTREMES });
    storeConfig({ cardTypeKey: "Contract" });
    renderReport();
    await screen.findByText("Bare Item", undefined, LONG);
    const g = axis("2014-02-15", "2037-08-15");
    expect(widthOf(chart().content)).toBeCloseTo((g.range / (2 * FIVE_YEARS)) * 100, 6);
    expect(leftOf(chart().today)).toBeCloseTo(g.pct(NOW), 6);
    // Phase mode still draws the lifecycle, not the attribute range.
    expect(rowLabels()).toEqual([[], [], [], [], [], ["Active: Sep 2021"]]);
  });

  it("draws one bar from the start field to the end field", async () => {
    mockApi.on("get", "/reports/roadmap?type=Contract", { items: START_EXTREMES });
    storeConfig({ cardTypeKey: "Contract" });
    renderReport();
    await screen.findByText("Both Ends", undefined, LONG);
    fireEvent.click(rangeToggle());
    await screen.findByLabelText("Feb 2014 → Feb 2026 · Good");

    const g = axis("2014-02-15", "2037-08-15");
    expect(rowLabels()).toEqual([
      ["Feb 2014 → Feb 2026 · Good"],
      ["Aug 2037 → — · Not set"],
      ["Jun 2027 → — · Bad"],
      ["— → Apr 2029 · Pending"],
      [],
      [],
    ]);
    expectBar("Feb 2014 → Feb 2026 · Good", g.pct("2014-02-15"), g.pct("2026-02-15") - g.pct("2014-02-15"));
    // A start with no end runs to the end of the axis.
    expectBar("Jun 2027 → — · Bad", g.pct("2027-06-15"), 100 - g.pct("2027-06-15"));
    // The latest date on the axis is that start itself: a sliver.
    expectBar("Aug 2037 → — · Not set", 100, 0.5);
    // An end with no start is a sliver at the end date.
    expectBar("— → Apr 2029 · Pending", g.pct("2029-04-15"), 0.5);
    expect(leftOf(chart().today)).toBeCloseTo(g.pct(NOW), 6);
  });

  it("widens the axis to the end dates too", async () => {
    mockApi.on("get", "/reports/roadmap?type=Contract", {
      items: [
        {
          id: "h1",
          name: "Long Tail",
          type: "Contract",
          lifecycle: {},
          attributes: { spendStartDate: "2022-01-15", spendEndDate: "2038-10-15" },
        },
        { id: "h2", name: "Early Close", type: "Contract", lifecycle: {}, attributes: { spendEndDate: "2012-12-15" } },
      ],
    });
    storeConfig({ cardTypeKey: "Contract" });
    renderReport();
    await screen.findByText("Long Tail", undefined, LONG);
    fireEvent.click(rangeToggle());
    await screen.findByLabelText("Jan 2022 → Oct 2038 · Not set");
    const g = axis("2012-12-15", "2038-10-15");
    expect(widthOf(chart().content)).toBeCloseTo((g.range / (2 * FIVE_YEARS)) * 100, 6);
    expectBar("Jan 2022 → Oct 2038 · Not set", g.pct("2022-01-15"), 100 - g.pct("2022-01-15"));
    expectBar("— → Dec 2012 · Not set", 0, 0.5);
  });
});

// ---------------------------------------------------------------------------
// Current phase and the phase table
// ---------------------------------------------------------------------------

describe("LifecycleReport current phase and phase table", () => {
  beforeEach(() => {
    mockApi.on("get", "/reports/roadmap", { items: PHASE_TABLE_ITEMS });
  });

  it("takes the latest phase that has started, today included", async () => {
    storeConfig({ view: "table" });
    renderReport();
    await screen.findByRole("table", undefined, LONG);
    const chip = (name: string) =>
      within(screen.getByRole("row", { name: new RegExp(`^${name}`) })).getAllByRole("cell")[2].textContent;
    expect(chip("Delta")).toBe("Active");
    expect(chip("Bravo")).toBe("End of Life");
    expect(chip("Charlie")).toBe("Plan");
    expect(chip("Alpha")).toBe("Phase In");
    expect(
      screen.getAllByRole("columnheader").map((h) => h.textContent),
    ).toEqual(["Name", "Type", "Current Phase", "Plan", "Phase In", "Active", "Phase Out", "End of Life"]);
  });

  it("counts the cards per current phase", async () => {
    renderReport();
    await screen.findByText("Delta", undefined, LONG);
    const chips = Array.from(document.querySelectorAll(".report-legend .MuiChip-label")).map(
      (c) => c.textContent,
    );
    expect(chips).toEqual(["1", "1", "1", "0", "1"]);
    expect(hasWarning("Bravo")).toBe(true);
    expect(hasWarning("Alpha")).toBe(false);
  });

  it("sorts a new column ascending and flips the active one", async () => {
    storeConfig({ view: "table" });
    renderReport();
    await screen.findByRole("table", undefined, LONG);
    expect(bodyRows()).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);
    expect(sortHeader("Name")).toHaveClass("Mui-active", "MuiTableSortLabel-directionAsc");
    expect(sortHeader("Type")).not.toHaveClass("Mui-active");
    expect(sortHeader("Current Phase")).not.toHaveClass("Mui-active");

    fireEvent.click(sortHeader("Name"));
    expect(bodyRows()).toEqual(["Delta", "Charlie", "Bravo", "Alpha"]);
    expect(sortHeader("Name")).toHaveClass("Mui-active", "MuiTableSortLabel-directionDesc");
    // Columns not sorted on keep the resting arrow.
    expect(sortHeader("Type")).toHaveClass("MuiTableSortLabel-directionAsc");
    expect(sortHeader("Current Phase")).toHaveClass("MuiTableSortLabel-directionAsc");

    fireEvent.click(sortHeader("Name"));
    expect(bodyRows()).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);
    expect(sortHeader("Name")).toHaveClass("MuiTableSortLabel-directionAsc");

    // A newly picked column starts ascending, even from an ascending sort.
    fireEvent.click(sortHeader("Type"));
    expect(bodyRows()).toEqual(["Delta", "Charlie", "Bravo", "Alpha"]);
    expect(sortHeader("Type")).toHaveClass("Mui-active", "MuiTableSortLabel-directionAsc");
    expect(sortHeader("Name")).not.toHaveClass("Mui-active");

    fireEvent.click(sortHeader("Type"));
    expect(bodyRows()).toEqual(["Alpha", "Bravo", "Delta", "Charlie"]);
    expect(sortHeader("Type")).toHaveClass("Mui-active", "MuiTableSortLabel-directionDesc");
    expect(sortHeader("Name")).toHaveClass("MuiTableSortLabel-directionAsc");
    expect(sortHeader("Current Phase")).toHaveClass("MuiTableSortLabel-directionAsc");

    fireEvent.click(sortHeader("Current Phase"));
    // active < endOfLife < phaseIn < plan
    expect(bodyRows()).toEqual(["Delta", "Bravo", "Alpha", "Charlie"]);
    expect(sortHeader("Current Phase")).toHaveClass("Mui-active", "MuiTableSortLabel-directionAsc");
    expect(sortHeader("Type")).not.toHaveClass("Mui-active");

    fireEvent.click(sortHeader("Current Phase"));
    expect(bodyRows()).toEqual(["Charlie", "Alpha", "Bravo", "Delta"]);
    expect(sortHeader("Current Phase")).toHaveClass("Mui-active", "MuiTableSortLabel-directionDesc");
    expect(sortHeader("Type")).toHaveClass("MuiTableSortLabel-directionAsc");
    expect(sortHeader("Name")).toHaveClass("MuiTableSortLabel-directionAsc");
  });

  it("restores an end-of-life sort with the undated cards last", async () => {
    storeConfig({ view: "table", sortK: "eol", sortD: "asc" });
    renderReport();
    await screen.findByRole("table", undefined, LONG);
    expect(bodyRows()).toEqual(["Bravo", "Alpha", "Delta", "Charlie"]);
  });

  it("restores a descending end-of-life sort", async () => {
    storeConfig({ view: "table", sortK: "eol", sortD: "desc" });
    renderReport();
    await screen.findByRole("table", undefined, LONG);
    expect(bodyRows()).toEqual(["Delta", "Charlie", "Alpha", "Bravo"]);
  });

  it("restores a descending name sort", async () => {
    storeConfig({ view: "table", sortK: "name", sortD: "desc" });
    renderReport();
    await screen.findByRole("table", undefined, LONG);
    expect(bodyRows()).toEqual(["Delta", "Charlie", "Bravo", "Alpha"]);
  });
});

// ---------------------------------------------------------------------------
// Date-range mode and its table
// ---------------------------------------------------------------------------

describe("LifecycleReport date-range mode", () => {
  it("offers only coloured single-selects to colour by, defaulting to the first", async () => {
    storeConfig({ cardTypeKey: "Contract" });
    renderReport();
    await screen.findByText("Kilo One", undefined, LONG);
    fireEvent.click(rangeToggle());
    expect(await screen.findByRole("combobox", { name: /color by/i })).toHaveTextContent("Health");
    expect(await listOptions(/color by/i)).toEqual(["Health", "Tier"]);
  });

  it("is not offered for a type with a single date field", async () => {
    renderReport();
    await screen.findByText("Wide Estate", undefined, LONG);
    await pick(/card type/i, /^Solo Type$/);
    await waitFor(() =>
      expect(mockApi.callsOf("get", "/reports/roadmap*").map((c) => c.path)).toContain(
        "/reports/roadmap?type=Solo",
      ),
    );
    expect(await screen.findByText("No lifecycle data found.", undefined, LONG)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /date range view/i })).not.toBeInTheDocument();
  });

  it("switches the chart, the alert and the warnings between phases and ranges", async () => {
    mockApi.on("get", "/reports/roadmap?type=Contract", {
      items: [
        {
          id: "p1",
          name: "Retired Feed",
          type: "Contract",
          lifecycle: { active: "2019-05-15", endOfLife: "2025-01-15" },
          attributes: { spendStartDate: "2023-03-15", spendEndDate: "2028-03-15", health: "good" },
        },
        {
          id: "p2",
          name: "Live Feed",
          type: "Contract",
          lifecycle: { active: "2022-05-15" },
          attributes: { spendStartDate: "2024-03-15", health: "bad" },
        },
      ],
    });
    storeConfig({ cardTypeKey: "Contract" });
    renderReport();
    await screen.findByText("Retired Feed", undefined, LONG);
    await waitFor(() => expect(rowLabels()).toEqual([["Active: May 2019", "End of Life: Jan 2025"], ["Active: May 2022"]]));
    expect(screen.getByRole("alert")).toHaveTextContent("1 item at End of Life");
    expect(hasWarning("Retired Feed")).toBe(true);
    expect(hasWarning("Live Feed")).toBe(false);
    expect(printParams()).toBe("Type: Supplier Contract");

    fireEvent.click(rangeToggle());
    await screen.findByLabelText("Mar 2023 → Mar 2028 · Good");
    expect(rowLabels()).toEqual([["Mar 2023 → Mar 2028 · Good"], ["Mar 2024 → — · Bad"]]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(hasWarning("Retired Feed")).toBe(false);
    expect(printParams()).toBe("Type: Supplier Contract|Mode: Date Range View|Color by: Health");
  });

  it("sorts its table by the start, end and colour columns, blanks last", async () => {
    storeConfig({ cardTypeKey: "Contract", view: "table" });
    renderReport();
    await screen.findByText("Kilo One", undefined, LONG);
    fireEvent.click(rangeToggle());
    await screen.findByRole("columnheader", { name: "Spend Start" });
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Name",
      "Type",
      "Spend Start",
      "Spend End",
      "Health",
    ]);
    expect(bodyRows()).toEqual(["Kilo Four", "Kilo One", "Kilo Three", "Kilo Two"]);

    const cells = (name: string) =>
      within(screen.getByRole("row", { name: new RegExp(`^${name}`) }))
        .getAllByRole("cell")
        .map((c) => c.textContent);
    expect(cells("Kilo One")).toEqual(["Kilo One", "Contract", "Mar 2024", "Mar 2027", "Bad"]);
    expect(cells("Kilo Three")).toEqual(["Kilo Three", "Contract", "—", "Oct 2025", "—"]);
    expect(cells("Kilo Two")).toEqual(["Kilo Two", "Contract", "Aug 2022", "—", "Good"]);

    expect(sortHeader("Name")).toHaveClass("Mui-active");
    for (const h of ["Spend Start", "Spend End", "Health"]) expect(sortHeader(h)).not.toHaveClass("Mui-active");

    fireEvent.click(sortHeader("Spend Start"));
    expect(bodyRows()).toEqual(["Kilo Two", "Kilo One", "Kilo Three", "Kilo Four"]);
    expect(sortHeader("Spend Start")).toHaveClass("Mui-active", "MuiTableSortLabel-directionAsc");
    expect(sortHeader("Name")).not.toHaveClass("Mui-active");
    fireEvent.click(sortHeader("Spend Start"));
    expect(bodyRows()).toEqual(["Kilo Three", "Kilo Four", "Kilo One", "Kilo Two"]);
    expect(sortHeader("Spend Start")).toHaveClass("Mui-active", "MuiTableSortLabel-directionDesc");
    expect(sortHeader("Spend End")).toHaveClass("MuiTableSortLabel-directionAsc");
    expect(sortHeader("Health")).toHaveClass("MuiTableSortLabel-directionAsc");

    fireEvent.click(sortHeader("Spend End"));
    expect(bodyRows()).toEqual(["Kilo Three", "Kilo One", "Kilo Four", "Kilo Two"]);
    expect(sortHeader("Spend End")).toHaveClass("Mui-active", "MuiTableSortLabel-directionAsc");
    expect(sortHeader("Spend Start")).not.toHaveClass("Mui-active");
    fireEvent.click(sortHeader("Spend End"));
    expect(bodyRows()).toEqual(["Kilo Four", "Kilo Two", "Kilo One", "Kilo Three"]);
    expect(sortHeader("Spend End")).toHaveClass("Mui-active", "MuiTableSortLabel-directionDesc");
    expect(sortHeader("Spend Start")).toHaveClass("MuiTableSortLabel-directionAsc");
    expect(sortHeader("Health")).toHaveClass("MuiTableSortLabel-directionAsc");

    fireEvent.click(sortHeader("Health"));
    expect(bodyRows()).toEqual(["Kilo One", "Kilo Two", "Kilo Three", "Kilo Four"]);
    expect(sortHeader("Health")).toHaveClass("Mui-active", "MuiTableSortLabel-directionAsc");
    expect(sortHeader("Spend End")).not.toHaveClass("Mui-active");
    fireEvent.click(sortHeader("Health"));
    expect(bodyRows()).toEqual(["Kilo Four", "Kilo Three", "Kilo Two", "Kilo One"]);
    expect(sortHeader("Health")).toHaveClass("Mui-active", "MuiTableSortLabel-directionDesc");
    expect(sortHeader("Spend End")).toHaveClass("MuiTableSortLabel-directionAsc");
    expect(sortHeader("Spend Start")).toHaveClass("MuiTableSortLabel-directionAsc");
  });

  it("sorts a card without a colour value after the coloured ones", async () => {
    mockApi.on("get", "/reports/roadmap?type=Contract", {
      items: [KILO_ITEMS[2], KILO_ITEMS[1]],
    });
    storeConfig({ cardTypeKey: "Contract", view: "table" });
    renderReport();
    await screen.findByText("Kilo One", undefined, LONG);
    fireEvent.click(rangeToggle());
    fireEvent.click(await screen.findByRole("button", { name: "Health" }));
    expect(bodyRows()).toEqual(["Kilo One", "Kilo Four"]);
    fireEvent.click(sortHeader("Health"));
    expect(bodyRows()).toEqual(["Kilo Four", "Kilo One"]);
  });

  it("colours by the field picked, not by the first one", async () => {
    storeConfig({ cardTypeKey: "Contract", view: "table" });
    renderReport();
    await screen.findByText("Kilo One", undefined, LONG);
    fireEvent.click(rangeToggle());
    await pick(/color by/i, /^Tier$/);
    await screen.findByRole("columnheader", { name: "Tier" });
    const statusCell = (name: string) =>
      within(screen.getByRole("row", { name: new RegExp(`^${name}`) })).getAllByRole("cell")[4].textContent;
    expect(statusCell("Kilo One")).toBe("Tier 1");
    expect(statusCell("Kilo Two")).toBe("—");
    expect(printParams()).toBe(
      "Type: Supplier Contract|Mode: Date Range View|Color by: Tier|View: Table",
    );
    expect(persisted()).toEqual({
      ...DEFAULT_CONFIG,
      cardTypeKey: "Contract",
      view: "table",
      useCustomDates: true,
      customColorBy: "tier",
    });
  });

  it("keeps a restored colour-by key with nothing to resolve it to", async () => {
    mockApi.on("get", "/reports/roadmap?type=Window", {
      items: [
        {
          id: "w1",
          name: "Freeze",
          type: "Window",
          lifecycle: {},
          attributes: { opensOn: "2025-11-15", closesOn: "2026-01-15", legacyKey: "x" },
        },
      ],
    });
    storeConfig({ cardTypeKey: "Window", customColorBy: "legacyKey" });
    renderReport();
    await screen.findByText("Freeze", undefined, LONG);
    fireEvent.click(rangeToggle());
    await waitFor(() =>
      expect(printParams()).toBe("Type: Window|Mode: Date Range View|Color by: legacyKey"),
    );
    // A value the colour-by key holds but no field defines is shown raw.
    expect(screen.getByLabelText("Nov 2025 → Jan 2026 · x")).toBeInTheDocument();
  });

  it("restores sorting by a column the table does not have as no sort at all", async () => {
    storeConfig({ cardTypeKey: "Contract", view: "table", sortK: "bogus" });
    renderReport();
    await screen.findByText("Kilo One", undefined, LONG);
    // Data order.
    expect(bodyRows()).toEqual(["Kilo Three", "Kilo One", "Kilo Four", "Kilo Two"]);
  });
});

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

describe("LifecycleReport toolbar", () => {
  it("offers the visible types a reports-only role may read", async () => {
    const reader = makeUser({ role: "reporter", permissions: { "reports.ea_dashboard": true } });
    renderReport({ user: reader });
    await screen.findByText("Wide Estate", undefined, LONG);
    expect(await listOptions(/card type/i)).toEqual([
      "All Types",
      "Application",
      "Supplier Contract",
      "Solo Type",
      "Window",
    ]);
  });

  it("explains why scoping needs a type", async () => {
    renderReport();
    await screen.findByText("Wide Estate", undefined, LONG);
    expect(screen.getByLabelText("Pick a card type first to scope the timeline")).toBeInTheDocument();
    expect(printParams()).toBe("Type: All Types");
  });

  it("scopes to a card and what sits beneath it", async () => {
    storeConfig({ cardTypeKey: "Application", scopeIds: ["parent", 7, null] });
    renderReport();
    await screen.findByText("Child App", undefined, LONG);
    await waitFor(() => expect(screen.queryByText("Other App")).not.toBeInTheDocument(), LONG);
    const toolbar = within(document.querySelector(".report-toolbar") as HTMLElement);
    expect(toolbar.getByText("1 card")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Show only the selected cards and everything beneath them"),
    ).toBeInTheDocument();
    expect(printParams()).toBe("Type: Application|Scope: 1 card");
    // Only the string ids survive the restore.
    expect(persisted()).toEqual({ ...DEFAULT_CONFIG, cardTypeKey: "Application", scopeIds: ["parent"] });

    fireEvent.click(toolbar.getByText("1 card"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Scope to cards")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Cards beneath a selected card are included automatically."),
    ).toBeInTheDocument();
  });

  it("does not scope across all types", async () => {
    storeConfig({ scopeIds: ["parent"] });
    renderReport();
    await screen.findByText("Wide Estate", undefined, LONG);
    expect(screen.getByText("All cards")).toBeInTheDocument();
    expect(printParams()).toBe("Type: All Types");
    expect(mockApi.callsOf("get", "/cards*")).toEqual([]);
  });

  it("names a restored type the metamodel no longer has by its key", async () => {
    mockApi.on("get", "/reports/roadmap?type=Ghost", { items: GEO_ITEMS });
    storeConfig({ cardTypeKey: "Ghost" });
    renderReport();
    await screen.findByText("Wide Estate", undefined, LONG);
    await waitFor(() => expect(printParams()).toBe("Type: Ghost"), LONG);
  });

  it("lists the table view among the parameters", async () => {
    storeConfig({ view: "table" });
    renderReport();
    await screen.findByRole("table", undefined, LONG);
    expect(printParams()).toBe("Type: All Types|View: Table");
    fireEvent.click(screen.getByRole("button", { name: /chart view/i }));
    await waitFor(() => expect(printParams()).toBe("Type: All Types"));
  });

  it("keeps the timeline of the type picked last when an earlier answer lands late", async () => {
    let release!: (v: unknown) => void;
    mockApi.on("get", "/reports/roadmap?type=Solo", () => new Promise((r) => (release = r)));
    renderReport();
    await screen.findByText("Wide Estate", undefined, LONG);
    await pick(/card type/i, /^Solo Type$/);
    await waitFor(() =>
      expect(mockApi.callsOf("get", "/reports/roadmap*").map((c) => c.path)).toContain(
        "/reports/roadmap?type=Solo",
      ),
    );
    await pick(/card type/i, /^Application$/);
    await screen.findByText("Other App", undefined, LONG);
    await act(async () => {
      release({ items: [{ id: "s", name: "Stale Solo", type: "Solo", lifecycle: { active: "2020-02-15" } }] });
    });
    expect(screen.queryByText("Stale Solo")).not.toBeInTheDocument();
    expect(screen.getByText("Other App")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Saved configuration
// ---------------------------------------------------------------------------

describe("LifecycleReport saved configuration", () => {
  it("persists the defaults on first load, never a half-initialised config", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    try {
      renderReport();
      await screen.findByText("Wide Estate", undefined, LONG);
      await waitFor(() => expect(persisted()).toEqual(DEFAULT_CONFIG), LONG);
      const writes = setItem.mock.calls
        .filter(([key]) => key === STORAGE_KEY)
        .map(([, value]) => JSON.parse(value as string));
      expect(writes.length).toBeGreaterThan(0);
      for (const w of writes) expect(w).toEqual(DEFAULT_CONFIG);
    } finally {
      setItem.mockRestore();
    }
  });

  it("restores from browser storage and keeps an absent type as all types", async () => {
    storeConfig({ view: "table", sortK: "type", sortD: "desc" });
    mockApi.on("get", "/reports/roadmap", { items: PHASE_TABLE_ITEMS });
    renderReport();
    await screen.findByRole("table", undefined, LONG);
    expect(bodyRows()).toEqual(["Alpha", "Bravo", "Delta", "Charlie"]);
    await waitFor(() =>
      expect(persisted()).toEqual({ ...DEFAULT_CONFIG, view: "table", sortK: "type", sortD: "desc" }),
    );
  });

  it("restores a saved report opened by link, date range and colour included", async () => {
    mockApi.on("get", "/saved-reports/s1", {
      id: "s1",
      name: "Quarter review",
      config: { cardTypeKey: "Contract", useCustomDates: true, customColorBy: "tier" },
    });
    renderReport({ query: "?saved_report_id=s1" });
    expect(await screen.findByText("Quarter review", undefined, LONG)).toBeInTheDocument();
    expect(screen.getByText(/Viewing saved report/)).toBeInTheDocument();
    await waitFor(() => expect(rangeToggle()).toBeChecked(), LONG);
    expect(screen.getByRole("combobox", { name: /color by/i })).toHaveTextContent("Tier");
    expect(await screen.findByLabelText("Mar 2024 → Mar 2027 · Tier 1", undefined, LONG)).toBeInTheDocument();
  });

  it("restores the legacy initiative keys of a saved report", async () => {
    mockApi.on("get", "/saved-reports/s2", {
      id: "s2",
      name: "Legacy",
      config: { cardTypeKey: "Contract", useInitiativeDates: true, initiativeColorBy: "tier" },
    });
    renderReport({ query: "?saved_report_id=s2" });
    await screen.findByText("Legacy", undefined, LONG);
    await waitFor(() => expect(rangeToggle()).toBeChecked(), LONG);
    expect(screen.getByRole("combobox", { name: /color by/i })).toHaveTextContent("Tier");
  });

  it("prefers the current key over the legacy one", async () => {
    mockApi.on("get", "/saved-reports/s3", {
      id: "s3",
      name: "Both keys",
      config: { cardTypeKey: "Contract", useCustomDates: false, useInitiativeDates: true },
    });
    renderReport({ query: "?saved_report_id=s3" });
    await screen.findByText("Both keys", undefined, LONG);
    await screen.findByText("Kilo One", undefined, LONG);
    await waitFor(() => expect(rangeToggle()).not.toBeChecked(), LONG);
    expect(await openSaveDialog()).toEqual({ ...DEFAULT_CONFIG, cardTypeKey: "Contract", customColorBy: "health" });
  });

  it("fills what a saved report leaves out with the defaults", async () => {
    mockApi.on("get", "/saved-reports/s4", {
      id: "s4",
      name: "Sparse",
      config: { view: "table", sortK: "type", sortD: "desc" },
    });
    mockApi.on("get", "/reports/roadmap", { items: PHASE_TABLE_ITEMS });
    renderReport({ query: "?saved_report_id=s4" });
    await screen.findByText("Sparse", undefined, LONG);
    await screen.findByRole("table", undefined, LONG);
    expect(bodyRows()).toEqual(["Alpha", "Bravo", "Delta", "Charlie"]);
    const cfg = await openSaveDialog();
    expect(screen.getByTestId("save-dialog")).toHaveAttribute("data-report-type", "lifecycle");
    expect(cfg).toEqual({ ...DEFAULT_CONFIG, view: "table", sortK: "type", sortD: "desc" });
  });

  it("falls back to generic headers for a date range on a type without date fields", async () => {
    mockApi.on("get", "/saved-reports/s5", {
      id: "s5",
      name: "Dateless range",
      config: { cardTypeKey: "Application", useCustomDates: true, view: "table" },
    });
    renderReport({ query: "?saved_report_id=s5" });
    await screen.findByText("Dateless range", undefined, LONG);
    await screen.findByRole("columnheader", { name: "Start" }, LONG);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Name",
      "Type",
      "Start",
      "End",
      "Status",
    ]);
  });

  it("resets to the defaults without leaving date range on", async () => {
    storeConfig({ view: "table", sortK: "type", sortD: "desc" });
    renderReport();
    await screen.findByRole("table", undefined, LONG);
    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    expect(await screen.findByText("Past System")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("1 item at End of Life");
    expect(printParams()).toBe("Type: All Types");
    expect(await openSaveDialog()).toEqual(DEFAULT_CONFIG);
    fireEvent.click(screen.getByRole("button", { name: "close-save" }));
    await waitFor(() => expect(screen.queryByTestId("save-dialog")).not.toBeInTheDocument());
  });

  it("drops a saved report opened in place from the address on reset", async () => {
    mockApi.on("get", "/saved-reports/s7", { id: "s7", name: "In place", config: { view: "chart" } });
    function AddressBar() {
      const navigate = useNavigate();
      const { search } = useLocation();
      return (
        <>
          <button onClick={() => navigate("/reports/lifecycle?saved_report_id=s7")}>open-saved</button>
          <output data-testid="search">{search}</output>
        </>
      );
    }
    render(
      wrapWithProviders(
        <>
          <LifecycleReport />
          <AddressBar />
        </>,
        { route: "/reports/lifecycle" },
      ),
    );
    await screen.findByText("Wide Estate", undefined, LONG);
    fireEvent.click(screen.getByRole("button", { name: "open-saved" }));
    expect(await screen.findByText("In place", undefined, LONG)).toBeInTheDocument();
    expect(screen.getByTestId("search")).toHaveTextContent("?saved_report_id=s7");

    // The toolbar's reset (the banner carries its own, narrower one).
    fireEvent.click(screen.getByLabelText("Reset to defaults"));
    await waitFor(() => expect(screen.getByTestId("search")).toBeEmptyDOMElement());
    expect(screen.queryByText("In place")).not.toBeInTheDocument();
  });

  it("re-applies a saved report that arrives while the page is open", async () => {
    let release!: (v: unknown) => void;
    mockApi.on("get", "/saved-reports/s6", () => new Promise((r) => (release = r)));
    renderReport({ query: "?saved_report_id=s6" });
    await screen.findByText("Wide Estate", undefined, LONG);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await act(async () => {
      release({ id: "s6", name: "Late", config: { view: "table" } });
    });
    expect(await screen.findByRole("table", undefined, LONG)).toBeInTheDocument();
  });
});
