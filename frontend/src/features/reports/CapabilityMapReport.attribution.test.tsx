/**
 * The Capability Map's Total Cost attribution (#1362): an app linked to
 * several capabilities either counts in full on every branch, or splits its
 * cost equally between them so sibling branches add up to the parent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { createRef } from "react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useCurrency", () => import("@/test/hooks").then((m) => m.useCurrencyModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

const h = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
  /** A new object here re-runs the page's restore, as opening a saved report does. */
  loadedConfig: null as Record<string, unknown> | null,
  persistConfig: (() => {}) as (cfg: Record<string, unknown>) => void,
}));

vi.mock("@/hooks/useSavedReport", () => ({
  useSavedReport: () => ({
    savedReport: null,
    savedReportName: null,
    saveDialogOpen: false,
    setSaveDialogOpen: () => {},
    loadedConfig: h.loadedConfig,
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
import CapabilityMapReport from "./CapabilityMapReport";

const TYPES = [
  makeCardType({ key: "Application", label: "Application" }),
  makeCardType({ key: "BusinessCapability", label: "Business Capability" }),
];

const COST = { key: "costTotalAnnual", label: "Annual Cost", type: "cost" };

const app = (id: string, name: string, cost: number, capability_ids?: string[]) => ({
  id,
  name,
  attributes: { costTotalAnnual: cost },
  lifecycle: {},
  org_ids: [],
  related_by_type: {},
  related_by_rel_type: {},
  tag_ids: [],
  ...(capability_ids ? { capability_ids } : {}),
});

const cap = (id: string, name: string, parent_id: string | null, apps: unknown[] = []) => ({
  id,
  name,
  parent_id,
  app_count: apps.length,
  total_cost: 0,
  risk_count: 0,
  attributes: {},
  apps,
});

/** One app of 300 supporting two sibling capabilities under one root, and
 *  one of 90 on a third capability outside that root, linked to all three. */
const SHARED = app("shared", "Shared", 300, ["a", "b"]);
const SPREAD = app("spread", "Spread", 90, ["a", "b", "other"]);
const LEGACY = app("legacy", "Legacy", 40);
const ITEMS = [
  cap("root", "Root", null),
  cap("a", "Cap A", "root", [SHARED]),
  cap("b", "Cap B", "root", [SHARED]),
  cap("other", "Other", null, [SPREAD, LEGACY]),
];

const serve = () =>
  mockApi.on("get", "/reports/capability-heatmap*", {
    items: ITEMS,
    fields_schema: [{ section: "Cost", fields: [COST] }],
    filterable_types: {},
    relation_types: [],
    tag_groups: [],
  });

function renderMap() {
  return render(
    <MemoryRouter>
      <CapabilityMapReport />
    </MemoryRouter>,
  );
}

const chart = () => document.querySelector(".report-chart-area") as HTMLElement;
/** The metric chip beside a capability's name. */
const value = (name: string) =>
  within(chart()).getByText(name).parentElement!.querySelector(".MuiChip-label")?.textContent;
/** A capability's Total Cost as its detail drawer states it — the only place a
 *  parent capability (whose header shows an app count) shows its cost. */
async function drawerCost(name: string) {
  fireEvent.click(within(chart()).getByText(name));
  const panel = await screen.findByRole("presentation");
  return within(panel).getByText("Total Cost").previousElementSibling?.textContent;
}
const printParams = () =>
  Array.from(document.querySelectorAll(".report-print-params > *")).map((el) =>
    (el.textContent ?? "").replace(/\|$/, "").trim(),
  );
const last = <T,>(xs: T[]): T | undefined => xs[xs.length - 1];
const lastPersisted = () =>
  last(vi.mocked(h.persistConfig).mock.calls)?.[0] as Record<string, unknown> | undefined;
const heatmapPaths = () => mockApi.callsOf("get", "/reports/capability-heatmap*").map((c) => c.path);
const attributionSelect = () => screen.queryByTestId("capability-attribution");

async function pick(label: RegExp, option: RegExp) {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: label }));
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

async function loaded() {
  await waitFor(() => expect(within(chart()).getByText("Cap A")).toBeInTheDocument(), {
    timeout: 5000,
  });
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel(TYPES);
  h.config = null;
  h.loadedConfig = null;
  h.persistConfig = vi.fn();
  mockApi.on("get", "/cards*", { items: [], total: 0 });
  serve();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CapabilityMapReport cost attribution", () => {
  it("offers the attribution toggle only on Total Cost", async () => {
    renderMap();
    await loaded();
    expect(attributionSelect()).toBeNull();

    await pick(/heatmap metric/i, /Total Cost/);
    await waitFor(() => expect(attributionSelect()).not.toBeNull());
    const select = within(attributionSelect()!).getByRole("combobox", { name: "Attribution" });
    expect(select).toHaveTextContent("Full");
    expect(printParams()).toContain("Attribution: Full");

    await pick(/heatmap metric/i, /Risk \(EOL count\)/);
    await waitFor(() => expect(attributionSelect()).toBeNull());
    expect(printParams().some((p) => p.startsWith("Attribution"))).toBe(false);
  });

  it("never re-fetches when attribution changes", async () => {
    h.config = { metric: "total_cost" };
    renderMap();
    await loaded();
    await waitFor(() =>
      expect(last(heatmapPaths())).toBe("/reports/capability-heatmap?metric=total_cost"),
    );
    const before = heatmapPaths().length;

    // The split is computed client-side from `capability_ids`, so the toggle
    // changes the figures without a request.
    await pick(/^attribution$/i, /Split equally/);
    await waitFor(() => expect(value("Cap A")).toBe("$150"));
    expect(printParams()).toContain("Attribution: Split equally");
    await pick(/^attribution$/i, /^Full$/);
    await waitFor(() => expect(value("Cap A")).toBe("$300"));

    expect(heatmapPaths()).toHaveLength(before);
    // The initial mount may load the default metric first; nothing carries
    // an attribution, and the last request is still Total Cost's.
    expect(heatmapPaths().some((p) => p.includes("attribution"))).toBe(false);
    expect(last(heatmapPaths())).toBe("/reports/capability-heatmap?metric=total_cost");
  });

  it("counts a shared app in full on every capability by default", async () => {
    h.config = { metric: "total_cost" };
    renderMap();
    await loaded();
    expect(value("Cap A")).toBe("$300");
    expect(value("Cap B")).toBe("$300");
    expect(value("Other")).toBe("$130");
    expect(await drawerCost("Root")).toBe("$300");
  });

  it("splits an app's cost by the capabilities inside the branch", async () => {
    h.config = { metric: "total_cost", attribution: "split" };
    renderMap();
    await loaded();
    // Shared (300) links a and b, both inside Root: the whole 300 there, half
    // on each sibling.
    await waitFor(() => expect(value("Cap A")).toBe("$150"));
    expect(value("Cap B")).toBe("$150");
    // Spread (90) links three capabilities, one of them Other: a third, 30;
    // Legacy carries no capability_ids and counts in full, 40.
    expect(value("Other")).toBe("$70");
    expect(await drawerCost("Root")).toBe("$300");
  });

  it("restores and persists attribution", async () => {
    h.config = { metric: "total_cost", attribution: "split" };
    renderMap();
    await loaded();
    await waitFor(() => expect(lastPersisted()?.attribution).toBe("split"));
    expect(
      within(attributionSelect()!).getByRole("combobox", { name: "Attribution" }),
    ).toHaveTextContent("Split equally");
    expect(heatmapPaths()).toContain("/reports/capability-heatmap?metric=total_cost");
    expect(heatmapPaths().some((p) => p.includes("attribution"))).toBe(false);

    await pick(/^attribution$/i, /^Full$/);
    await waitFor(() => expect(lastPersisted()?.attribution).toBe("full"));
  });

  it("ignores a stored attribution it does not know", async () => {
    h.config = { metric: "total_cost", attribution: "weighted" };
    renderMap();
    await loaded();
    await waitFor(() => expect(lastPersisted()?.attribution).toBe("full"));
    expect(heatmapPaths().every((p) => !p.includes("attribution"))).toBe(true);
    expect(value("Cap A")).toBe("$300");
  });

  it("restores a config without attribution as full, over a previous split", async () => {
    h.config = { metric: "total_cost", attribution: "split" };
    const view = renderMap();
    await loaded();
    await waitFor(() => expect(value("Cap A")).toBe("$150"));
    await waitFor(() => expect(lastPersisted()?.attribution).toBe("split"));

    // Opening a saved report from before the toggle existed: no key at all.
    h.config = { metric: "total_cost" };
    h.loadedConfig = { metric: "total_cost" };
    view.rerender(
      <MemoryRouter>
        <CapabilityMapReport />
      </MemoryRouter>,
    );
    await waitFor(() => expect(lastPersisted()?.attribution).toBe("full"));
    expect(value("Cap A")).toBe("$300");
  });

  it("resets attribution to full", async () => {
    h.config = { metric: "total_cost", attribution: "split" };
    renderMap();
    await loaded();
    await waitFor(() => expect(lastPersisted()?.attribution).toBe("split"));
    fireEvent.click(screen.getByRole("button", { name: /reset/i }));
    await waitFor(() => expect(lastPersisted()?.attribution).toBe("full"));
    expect(lastPersisted()?.metric).toBe("app_count");
  });
});
