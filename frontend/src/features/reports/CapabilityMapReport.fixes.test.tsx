/**
 * Regression tests for Capability Map bugs a mutation pass surfaced: a
 * restored metric the report does not know, a relation filter on a card type
 * other than Organization, a colour-by field keyed like the "no colour"
 * sentinel, a heat scale over values that are all negative, and the drawer's
 * end-of-life note.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { createRef } from "react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useCurrency", () => import("@/test/hooks").then((m) => m.useCurrencyModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

const h = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
  persistConfig: (() => {}) as (cfg: Record<string, unknown>) => void,
}));

vi.mock("@/hooks/useSavedReport", () => ({
  useSavedReport: () => ({
    savedReport: null,
    savedReportName: null,
    saveDialogOpen: false,
    setSaveDialogOpen: () => {},
    loadedConfig: null,
    consumeConfig: () => h.config,
    resetSavedReport: () => {},
    persistConfig: (cfg: Record<string, unknown>) => h.persistConfig(cfg),
    resetAll: () => {},
    reportType: "capability-map",
  }),
}));
vi.mock("@/hooks/useThumbnailCapture", () => ({
  useThumbnailCapture: () => ({ chartRef: createRef(), thumbnail: undefined, captureAndSave: () => {} }),
}));
vi.mock("@/hooks/useTimeline", () => ({
  useTimeline: () => ({
    timelineDate: Date.parse("2026-08-22"),
    setTimelineDate: () => {},
    todayMs: Date.parse("2026-08-22"),
    isTimeTraveling: false,
    persistValue: undefined,
    printParam: null,
    restore: () => {},
    reset: () => {},
  }),
}));
vi.mock("@/components/TimelineSlider", () => ({ default: () => null }));
vi.mock("@/features/reports/SaveReportDialog", () => ({ default: () => null }));
vi.mock("@/components/CardDetailSidePanel", () => ({ default: () => null }));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { makeCardType } from "@/test/fixtures/metamodel";
import { EMPTY_FILTER_KEY } from "@/components/FilterSelect";
import CapabilityMapReport from "./CapabilityMapReport";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TYPES = [
  makeCardType({ key: "Organization", label: "Organization" }),
  makeCardType({ key: "Provider", label: "Provider" }),
  makeCardType({ key: "Application", label: "Application" }),
  makeCardType({ key: "BusinessCapability", label: "Business Capability" }),
];

type App = {
  id: string;
  name: string;
  attributes?: Record<string, unknown>;
  lifecycle?: Record<string, string>;
  org_ids: string[];
  related_by_type?: Record<string, string[]>;
  related_by_rel_type?: Record<string, string[]>;
  tag_ids?: string[];
};

const app = (id: string, name: string, over: Partial<App> = {}): App => ({
  id,
  name,
  attributes: {},
  lifecycle: {},
  org_ids: [],
  related_by_type: {},
  related_by_rel_type: {},
  tag_ids: [],
  ...over,
});

const cap = (id: string, name: string, parent_id: string | null, apps: App[] = []) => ({
  id,
  name,
  parent_id,
  app_count: apps.length,
  total_cost: 0,
  risk_count: 0,
  attributes: {},
  apps,
});

const CRITICALITY = {
  key: "criticality",
  label: "Criticality",
  type: "single_select",
  options: [{ key: "high", label: "High Crit", color: "#d32f2f" }],
};
/** A field whose key is the string the picker used to mean "no colour". */
const NONE_FIELD = {
  key: "none",
  label: "Nonesuch",
  type: "single_select",
  options: [{ key: "yes", label: "Is Nonesuch", color: "#123456" }],
};
const COST = { key: "costTotalAnnual", label: "Annual Cost", type: "cost" };

const payload = (items: unknown[], extra: Record<string, unknown> = {}) => ({
  items,
  fields_schema: [{ section: "Business", fields: [CRITICALITY, COST] }],
  filterable_types: {},
  relation_types: [],
  tag_groups: [],
  ...extra,
});

const serve = (body: unknown) => mockApi.on("get", "/reports/capability-heatmap*", body);

function renderMap() {
  return render(
    <MemoryRouter>
      <CapabilityMapReport />
    </MemoryRouter>,
  );
}

const chart = () => document.querySelector(".report-chart-area") as HTMLElement;
const legend = () => document.querySelector(".report-legend") as HTMLElement;
const header = (name: string) => within(chart()).getByText(name).parentElement as HTMLElement;
const bg = (el: Element) => getComputedStyle(el).backgroundColor;
/** The five heat-scale swatches between "Low" and "High". */
const swatches = () =>
  Array.from(within(legend()).getByText("Low").nextElementSibling!.children).map(
    (el) => getComputedStyle(el).backgroundColor,
  );
const printParams = () =>
  Array.from(document.querySelectorAll(".report-print-params > *")).map((el) =>
    (el.textContent ?? "").replace(/\|$/, "").trim(),
  );
/** The last element (`Array#at` is ES2022, past this project's lib). */
const last = <T,>(xs: T[]): T | undefined => xs[xs.length - 1];
const lastPersisted = () =>
  last(vi.mocked(h.persistConfig).mock.calls)?.[0] as Record<string, unknown> | undefined;
const heatmapPaths = () => mockApi.callsOf("get", "/reports/capability-heatmap*").map((c) => c.path);

async function loaded(name: string) {
  await waitFor(() => expect(within(chart()).getByText(name)).toBeInTheDocument(), {
    timeout: 5000,
  });
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel(TYPES);
  h.config = null;
  h.persistConfig = vi.fn();
  mockApi.on("get", "/cards*", { items: [], total: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Restored metric
// ---------------------------------------------------------------------------

describe("CapabilityMapReport restored metric", () => {
  it("falls back to the application count for a metric it does not know", async () => {
    h.config = { metric: "bogus" };
    serve(payload([cap("sales", "Sales", null, [app("a", "Alpha")])]));
    renderMap();
    await loaded("Sales");

    // Never asked for the unknown metric, not even once.
    expect(new Set(heatmapPaths())).toEqual(new Set(["/reports/capability-heatmap?metric=app_count"]));
    expect(screen.getByRole("combobox", { name: "Heatmap Metric" })).toHaveTextContent(
      "Application Count",
    );
    expect(printParams()[0]).toBe("Metric: Application Count");
    await waitFor(() => expect(lastPersisted()?.metric).toBe("app_count"));
  });

  it("still restores a metric it knows", async () => {
    h.config = { metric: "risk_count" };
    serve(payload([cap("sales", "Sales", null, [app("a", "Alpha")])]));
    renderMap();
    await loaded("Sales");
    await waitFor(() =>
      expect(last(heatmapPaths())).toBe("/reports/capability-heatmap?metric=risk_count"),
    );
    expect(screen.getByRole("combobox", { name: "Heatmap Metric" })).toHaveTextContent(
      "Risk (EOL count)",
    );
  });
});

// ---------------------------------------------------------------------------
// Relation filters per card type
// ---------------------------------------------------------------------------

describe("CapabilityMapReport relation filter", () => {
  const ORG_ONLY = app("org-only", "Org Only", {
    org_ids: ["o1"],
    related_by_type: { Organization: ["o1"] },
  });
  const VENDORED = app("vendored", "Vendored", { related_by_type: { Provider: ["p1"] } });
  const FILTERABLE = {
    filterable_types: {
      Organization: [{ id: "o1", name: "Org One", type: "Organization" }],
      Provider: [{ id: "p1", name: "Vendor One", type: "Provider" }],
    },
  };

  it("keeps an app with an Organization but no Provider under the Provider (empty) filter", async () => {
    h.config = { showApps: true, relationFilters: { Provider: [EMPTY_FILTER_KEY] } };
    serve(payload([cap("sales", "Sales", null, [ORG_ONLY, VENDORED])], FILTERABLE));
    renderMap();
    await loaded("Sales");

    expect(await within(chart()).findByText("Org Only")).toBeInTheDocument();
    expect(within(chart()).queryByText("Vendored")).not.toBeInTheDocument();
  });

  it("does not match a Provider pick against the app's Organizations", async () => {
    h.config = { showApps: true, relationFilters: { Provider: ["o1"] } };
    serve(payload([cap("sales", "Sales", null, [ORG_ONLY, VENDORED])], FILTERABLE));
    renderMap();
    await loaded("Sales");

    expect(within(header("Sales")).getByText("0")).toBeInTheDocument();
    expect(within(chart()).queryByText("Org Only")).not.toBeInTheDocument();
  });

  it("still reads an Organization filter off org_ids for a payload without related_by_type", async () => {
    const legacy = { id: "legacy", name: "Legacy", attributes: {}, lifecycle: {}, org_ids: ["o1"] };
    h.config = { showApps: true, relationFilters: { Organization: ["o1"] } };
    serve(payload([cap("sales", "Sales", null, [legacy as App])], FILTERABLE));
    renderMap();
    await loaded("Sales");

    expect(await within(chart()).findByText("Legacy")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Colour-by: a field keyed "none"
// ---------------------------------------------------------------------------

describe("CapabilityMapReport colour-by sentinel", () => {
  const WITH_NONE = payload(
    [cap("sales", "Sales", null, [app("a", "Alpha", { attributes: { none: "yes" } })])],
    { fields_schema: [{ section: "Business", fields: [CRITICALITY, NONE_FIELD] }] },
  );
  const colorBySelect = () => screen.getByRole("combobox", { name: "Color Apps By" });

  it("offers a field keyed 'none' as its own option, and colours by it when picked", async () => {
    const consoleError = vi.spyOn(console, "error");
    h.config = { showApps: true };
    serve(WITH_NONE);
    renderMap();
    await loaded("Sales");
    expect(colorBySelect()).toHaveTextContent("No color");

    fireEvent.mouseDown(colorBySelect());
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "No color",
      "Criticality",
      "Nonesuch",
    ]);
    fireEvent.click(within(listbox).getByRole("option", { name: "Nonesuch" }));

    expect(await within(legend()).findByText("Nonesuch:")).toBeInTheDocument();
    expect(within(legend()).getByText("Is Nonesuch")).toBeInTheDocument();
    expect(printParams()).toContain("Color by: Nonesuch");
    await waitFor(() => expect(lastPersisted()?.colorBy).toBe("none"));
    expect(
      consoleError.mock.calls.some((args) => String(args[0]).includes("same key")),
    ).toBe(false);
  });

  it("colours by a field keyed 'none' restored from a saved report", async () => {
    h.config = { showApps: true, colorBy: "none" };
    serve(WITH_NONE);
    renderMap();
    await loaded("Sales");
    expect(within(legend()).getByText("Nonesuch:")).toBeInTheDocument();
    expect(colorBySelect()).toHaveTextContent("Nonesuch");
  });

  it("names only the app on its chip when apps are not coloured", async () => {
    // An attribute under an empty key must not pass for a colour value.
    h.config = { showApps: true };
    serve(
      payload([
        cap("sales", "Sales", null, [app("a", "Alpha", { attributes: { "": "Mystery" } })]),
      ]),
    );
    renderMap();
    await loaded("Sales");
    expect(within(chart()).getByRole("button", { name: "Alpha" })).toBeInTheDocument();
    expect(within(chart()).queryByRole("button", { name: /Mystery/ })).not.toBeInTheDocument();
  });

  it("goes back to no colour from a field", async () => {
    h.config = { showApps: true, colorBy: "criticality" };
    serve(WITH_NONE);
    renderMap();
    await loaded("Sales");
    expect(within(legend()).getByText("Criticality:")).toBeInTheDocument();

    fireEvent.mouseDown(colorBySelect());
    const listbox = await screen.findByRole("listbox");
    fireEvent.click(within(listbox).getByRole("option", { name: "No color" }));

    await waitFor(() => expect(lastPersisted()?.colorBy).toBe(""));
    expect(within(legend()).queryByText("Criticality:")).not.toBeInTheDocument();
    expect(colorBySelect()).toHaveTextContent("No color");
  });
});

// ---------------------------------------------------------------------------
// Heat scale over negative values
// ---------------------------------------------------------------------------

describe("CapabilityMapReport heat scale", () => {
  it("scales a cost heatmap whose values are all negative from its real range", async () => {
    h.config = { metric: "total_cost" };
    serve(
      payload([
        cap("credits", "Credits", null, [
          app("c", "C", { attributes: { costTotalAnnual: -100 } }),
        ]),
        cap("refunds", "Refunds", null, [
          app("r", "R", { attributes: { costTotalAnnual: -500 } }),
        ]),
      ]),
    );
    renderMap();
    await loaded("Credits");

    // The highest value is the deepest shade, the lowest the palest.
    expect(bg(header("Credits"))).toBe("rgb(25, 90, 202)");
    expect(bg(header("Refunds"))).toBe("rgb(227, 242, 253)");
    expect(getComputedStyle(within(chart()).getByText("Credits")).color).toBe("rgb(255, 255, 255)");
    expect(within(legend()).getByText("Max: $-100")).toBeInTheDocument();
    // The legend's scale runs over the same range.
    expect(swatches()).toEqual([
      "rgb(227, 242, 253)",
      "rgb(177, 204, 240)",
      "rgb(126, 166, 228)",
      "rgb(76, 128, 215)",
      "rgb(25, 90, 202)",
    ]);
  });

  it("writes white on the deepest shades only, above 70% of the range", async () => {
    h.config = { metric: "total_cost" };
    const costing = (id: string, cost: number) =>
      app(id, id.toUpperCase(), { attributes: { costTotalAnnual: cost } });
    serve(
      payload([
        cap("group", "Group", null),
        cap("seven", "Seven", "group", [costing("s", 700)]),
        cap("three", "Three", "group", [costing("t", 300)]),
        cap("eight", "Eight", null, [costing("e", 800)]),
      ]),
    );
    renderMap();
    await loaded("Seven");
    const ink = (name: string) => getComputedStyle(within(chart()).getByText(name)).color;
    expect(ink("Group")).toBe("rgb(255, 255, 255)");
    expect(ink("Eight")).toBe("rgb(255, 255, 255)");
    expect(ink("Seven")).toBe("rgb(51, 51, 51)");
    expect(ink("Three")).toBe("rgb(51, 51, 51)");
  });

  it("writes dark ink on a parent capability at exactly 70% of the range", async () => {
    h.config = { metric: "total_cost" };
    const costing = (id: string, cost: number) =>
      app(id, id.toUpperCase(), { attributes: { costTotalAnnual: cost } });
    serve(
      payload([
        cap("parent", "Parent", null),
        cap("kid", "Kid", "parent", [costing("k", 700)]),
        cap("top", "Top", null, [costing("t", 1000)]),
      ]),
    );
    renderMap();
    await loaded("Kid");
    const ink = (name: string) => getComputedStyle(within(chart()).getByText(name)).color;
    expect(ink("Parent")).toBe("rgb(51, 51, 51)");
    expect(ink("Top")).toBe("rgb(255, 255, 255)");
  });

  it("spans a mixed range from the lowest value to the highest", async () => {
    h.config = { metric: "total_cost" };
    serve(
      payload([
        cap("credit", "Credit", null, [app("c", "C", { attributes: { costTotalAnnual: -500 } })]),
        cap("spend", "Spend", null, [app("s", "S", { attributes: { costTotalAnnual: 500 } })]),
      ]),
    );
    renderMap();
    await loaded("Credit");
    expect(bg(header("Spend"))).toBe("rgb(25, 90, 202)");
    expect(bg(header("Credit"))).toBe("rgb(227, 242, 253)");
    expect(within(legend()).getByText("Max: $500")).toBeInTheDocument();
  });

  it("names a zero maximum for an empty map", async () => {
    serve(payload([]));
    renderMap();
    expect(await screen.findByText(/No Business Capabilities found/)).toBeInTheDocument();
    expect(within(legend()).getByText("Max: 0")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------

describe("CapabilityMapReport drawer", () => {
  it("notes an app's end of life through the translated label", async () => {
    serve(
      payload([
        cap("billing", "Billing", null, [
          app("a", "Alpha", { lifecycle: { active: "2015-01-01", endOfLife: "2099-01-01" } }),
        ]),
      ]),
    );
    renderMap();
    await loaded("Billing");
    fireEvent.click(within(chart()).getByText("Billing"));
    const panel = await screen.findByRole("presentation");
    expect(await within(panel).findByText("End of Life: 2099-01-01")).toBeInTheDocument();
    expect(within(panel).queryByText(/EOL: /)).not.toBeInTheDocument();
  });

  it("dates an app's end of life in the workspace date format", async () => {
    hookState.dateFormat = "DD/MM/YYYY";
    serve(
      payload([
        cap("billing", "Billing", null, [
          app("a", "Alpha", { lifecycle: { active: "2015-01-01", endOfLife: "2099-03-07" } }),
        ]),
      ]),
    );
    renderMap();
    await loaded("Billing");
    fireEvent.click(within(chart()).getByText("Billing"));
    const panel = await screen.findByRole("presentation");
    expect(await within(panel).findByText("End of Life: 07/03/2099")).toBeInTheDocument();
    expect(within(panel).queryByText(/2099-03-07/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Load failure
// ---------------------------------------------------------------------------

describe("CapabilityMapReport load failure", () => {
  it("shows a failed first load instead of spinning for ever", async () => {
    mockApi.fail("get", "/reports/capability-heatmap*", 500);
    renderMap();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "GET /reports/capability-heatmap?metric=app_count failed",
    );
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows a failed metric switch, and keeps the toolbar to switch back", async () => {
    serve(payload([cap("billing", "Billing", null, [app("a", "Alpha")])]));
    mockApi.fail("get", "/reports/capability-heatmap?metric=total_cost", 500);
    renderMap();
    await loaded("Billing");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("combobox", { name: /heatmap metric/i }));
    fireEvent.click(within(await screen.findByRole("listbox")).getByRole("option", { name: "Total Cost" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "GET /reports/capability-heatmap?metric=total_cost failed",
    );
    // Spaced from the map it sits above.
    expect(screen.getByRole("alert")).toHaveStyle({ marginBottom: "16px" });
    expect(screen.getByRole("combobox", { name: /heatmap metric/i })).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("combobox", { name: /heatmap metric/i }));
    fireEvent.click(
      within(await screen.findByRole("listbox")).getByRole("option", { name: "Application Count" }),
    );
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(within(chart()).getByText("Billing")).toBeInTheDocument();
  });
});

describe("CapabilityMapReport load guards", () => {
  /** A request the test settles by hand. */
  function deferred() {
    let reject!: (err: unknown) => void;
    const promise = new Promise<never>((_, rej) => {
      reject = rej;
    });
    return { promise, reject };
  }
  /** Let a settled request's continuation run to the end. */
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const pickMetric = async (name: string) => {
    fireEvent.mouseDown(screen.getByRole("combobox", { name: /heatmap metric/i }));
    fireEvent.click(within(await screen.findByRole("listbox")).getByRole("option", { name }));
  };

  it("says something went wrong when the load fails with something other than an Error", async () => {
    mockApi.on("get", "/reports/capability-heatmap*", () => Promise.reject("boom"));
    renderMap();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong");
    // Padded like the page it stands in for.
    expect(alert.parentElement).toHaveStyle({ paddingTop: "32px", paddingBottom: "32px" });
  });

  it("stays quiet and keeps the map when a metric switch is aborted", async () => {
    serve(payload([cap("billing", "Billing", null, [app("a", "Alpha")])]));
    const pending = deferred();
    mockApi.on("get", "/reports/capability-heatmap?metric=total_cost", () => pending.promise);
    renderMap();
    await loaded("Billing");

    await pickMetric("Total Cost");
    await waitFor(() =>
      expect(last(heatmapPaths())).toBe("/reports/capability-heatmap?metric=total_cost"),
    );
    await act(async () => {
      pending.reject(new DOMException("The operation was aborted.", "AbortError"));
      await flush();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(within(chart()).getByText("Billing")).toBeInTheDocument();
  });

  it("ignores a failure that lands after a newer metric was picked", async () => {
    serve(payload([cap("billing", "Billing", null, [app("a", "Alpha")])]));
    const slow = deferred();
    mockApi.on("get", "/reports/capability-heatmap?metric=total_cost", () => slow.promise);
    mockApi.on(
      "get",
      "/reports/capability-heatmap?metric=risk_count",
      payload([cap("risky", "Risky", null, [app("r", "Rho")])]),
    );
    renderMap();
    await loaded("Billing");

    await pickMetric("Total Cost");
    await pickMetric("Risk (EOL count)");
    await loaded("Risky");
    await act(async () => {
      slow.reject(new Error("too late"));
      await flush();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(within(chart()).getByText("Risky")).toBeInTheDocument();
  });
});
