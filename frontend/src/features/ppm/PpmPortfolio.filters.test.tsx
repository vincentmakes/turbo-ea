/**
 * The PPM portfolio board's Filters section, through the real container: it
 * starts folded, fetches its payload only once it is opened (or at once when
 * the URL carries a selection), narrows the rows and the KPI tiles, keeps the
 * selection in `?filters=`, and never shows unfiltered rows while a selection
 * is still loading.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { api } from "@/api/client";
import PpmPortfolio from "./PpmPortfolio";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
  isAbortError: () => false,
  ApiError: class ApiError extends Error {},
}));

vi.mock("@/hooks/useCurrency", () => ({
  useCurrency: () => ({
    currency: "CHF",
    fmt: { format: (v: number) => `CHF ${v}` },
    fmtShort: (v: number) => `CHF${v}`,
    symbol: "CHF",
  }),
}));

const TYPES = [
  {
    key: "Initiative",
    label: "Initiative",
    translations: {},
    subtypes: [{ key: "project", label: "Project", translations: {} }],
    fields_schema: [],
  },
  {
    key: "Organization",
    label: "Organization",
    icon: "corporate_fare",
    translations: {},
    has_hierarchy: true,
    subtypes: [],
    fields_schema: [],
  },
];

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    types: TYPES,
    relationTypes: [],
    loading: false,
    getType: (key: string) => TYPES.find((tp) => tp.key === key),
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
  }),
}));

const row = (id: string, name: string) => ({
  id,
  name,
  subtype: "project",
  parent_id: null,
  start_date: "2026-01-01",
  end_date: "2026-12-31",
  capex_planned: 100,
  capex_actual: 0,
  opex_planned: 0,
  opex_actual: 0,
  group_id: null,
  group_name: null,
  latest_report: null,
  stakeholders: [],
});

const GANTT = [row("i1", "Alpha Rollout"), row("i2", "Beta Upgrade"), row("i3", "Gamma Study")];

const DASHBOARD = {
  total_initiatives: 3,
  total_budget: 300,
  total_actual: 0,
  health_schedule: { onTrack: 0, atRisk: 0, offTrack: 0, noReport: 3 },
  health_cost: { onTrack: 0, atRisk: 0, offTrack: 0, noReport: 3 },
  health_scope: { onTrack: 0, atRisk: 0, offTrack: 0, noReport: 3 },
};

const affects = (id: string, name: string) => ({
  relation_type: "relInitiativeToOrganization",
  direction: "outgoing",
  related_id: id,
  related_name: name,
  related_type: "Organization",
});

const FILTER_DATA = {
  items: [
    { id: "i1", name: "Alpha Rollout", subtype: "project", attributes: {}, relations: [affects("sales", "Sales")], tag_ids: [] },
    { id: "i2", name: "Beta Upgrade", subtype: "project", attributes: {}, relations: [affects("emea", "EMEA Sales")], tag_ids: [] },
    { id: "i3", name: "Gamma Study", subtype: "project", attributes: {}, relations: [], tag_ids: [] },
  ],
  relation_types: [
    {
      key: "relInitiativeToOrganization",
      label: "affects",
      reverse_label: "is affected by",
      source_type_key: "Initiative",
      target_type_key: "Organization",
      other_type_key: "Organization",
      attributes_schema: [],
    },
  ],
  groupable_types: {
    Organization: [
      { id: "sales", name: "Sales", parent_id: null },
      { id: "emea", name: "EMEA Sales", parent_id: "sales" },
    ],
  },
  tag_groups: [],
};

/**
 * The same board with an Initiative self-relation and a third related type. The
 * payload lists the Initiative's own facets first, as the backend seeds them.
 */
const FILTER_DATA_SELF = {
  ...FILTER_DATA,
  relation_types: [
    {
      key: "relInitiativeSucceeds",
      label: "succeeds",
      reverse_label: "is succeeded by",
      source_type_key: "Initiative",
      target_type_key: "Initiative",
      other_type_key: "Initiative",
      attributes_schema: [],
    },
    ...FILTER_DATA.relation_types,
    {
      key: "relInitiativeToApplication",
      label: "affects",
      reverse_label: "is affected by",
      source_type_key: "Initiative",
      target_type_key: "Application",
      other_type_key: "Application",
      attributes_schema: [],
    },
  ],
  groupable_types: {
    Initiative: [{ id: "i1", name: "Alpha Rollout", parent_id: null }],
    ...FILTER_DATA.groupable_types,
    Application: [{ id: "crm", name: "CRM", parent_id: null }],
  },
};

const SALES = encodeURIComponent('{"relationFilters":{"Organization":["sales"]}}');

/** How the filter payload answers: at once, never (until released), or with an error. */
let filterAnswer: () => Promise<unknown> = () => Promise.resolve(FILTER_DATA);

beforeEach(() => {
  vi.clearAllMocks();
  filterAnswer = () => Promise.resolve(FILTER_DATA);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.mocked(api.get).mockImplementation(((path: string) => {
    if (path.startsWith("/reports/ppm/gantt")) return Promise.resolve(GANTT);
    if (path.startsWith("/reports/ppm/dashboard")) return Promise.resolve(DASHBOARD);
    if (path.startsWith("/reports/ppm/group-options")) return Promise.resolve([]);
    if (path === "/reports/ppm/filter-data") return filterAnswer();
    return Promise.resolve([]);
  }) as typeof api.get);
});

function LocationProbe() {
  const { search } = useLocation();
  return <output data-testid="location">{search}</output>;
}

function renderBoard(url = "/") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <PpmPortfolio />
      <LocationProbe />
    </MemoryRouter>,
  );
}

const location = () => new URLSearchParams(screen.getByTestId("location").textContent ?? "");
const filterCalls = () =>
  vi.mocked(api.get).mock.calls.filter(([p]) => p === "/reports/ppm/filter-data").length;
const header = () => screen.getByRole("button", { name: /Initiative Filters/ });
const names = () =>
  ["Alpha Rollout", "Beta Upgrade", "Gamma Study"].filter((n) => screen.queryByText(n) !== null);
const total = () => {
  const caption = screen.getByText("Total Initiatives");
  return caption.nextElementSibling?.textContent;
};

async function pickOrganization(option: string) {
  const input = await screen.findByRole("combobox", { name: "Organization" });
  fireEvent.mouseDown(input);
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

describe("PpmPortfolio Filters section", () => {
  it("offers the other card types first and the Initiative's own facets behind the more chip", async () => {
    filterAnswer = () => Promise.resolve(FILTER_DATA_SELF);
    renderBoard();
    await screen.findByText("Alpha Rollout");
    fireEvent.click(header());
    await screen.findByRole("combobox", { name: "Organization" });
    const body = document.getElementById(header().getAttribute("aria-controls")!)!;
    // Two facets before the chip: Organization and Application, in the payload's order.
    expect(within(body).getAllByRole("combobox")).toHaveLength(2);
    expect(screen.getByRole("combobox", { name: "Application" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /^Initiative/ })).toBeNull();
    fireEvent.click(screen.getByText("3 more"));
    expect(screen.getByRole("combobox", { name: "Initiative" })).toBeInTheDocument();
    expect(screen.getAllByRole("combobox", { name: /^Initiative · / })).toHaveLength(2);
  });

  it("starts folded and costs no request on the default load", async () => {
    renderBoard();
    await screen.findByText("Alpha Rollout");
    expect(header()).toHaveAttribute("aria-expanded", "false");
    expect(filterCalls()).toBe(0);
    expect(names()).toEqual(["Alpha Rollout", "Beta Upgrade", "Gamma Study"]);
  });

  it("fetches once on the first expand, and never again on fold and re-expand", async () => {
    renderBoard();
    await screen.findByText("Alpha Rollout");
    fireEvent.click(header());
    expect(header()).toHaveAttribute("aria-expanded", "true");
    await screen.findByRole("combobox", { name: "Organization" });
    fireEvent.click(header());
    expect(header()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(header());
    expect(header()).toHaveAttribute("aria-expanded", "true");
    expect(filterCalls()).toBe(1);
    expect(screen.getByRole("combobox", { name: "Organization" })).toBeInTheDocument();
  });

  it("says it is loading while the payload is on its way", async () => {
    let release: (v: unknown) => void = () => {};
    filterAnswer = () => new Promise((resolve) => (release = resolve));
    renderBoard();
    await screen.findByText("Alpha Rollout");
    fireEvent.click(header());
    expect(await screen.findByText("Loading...")).toBeInTheDocument();
    // No selection yet, so the board itself stays up.
    expect(names()).toEqual(["Alpha Rollout", "Beta Upgrade", "Gamma Study"]);
    release(FILTER_DATA);
    await screen.findByRole("combobox", { name: "Organization" });
    expect(screen.queryByText("Loading...")).toBeNull();
  });

  it("fetches at once for a selection in the URL, spinning until it lands, folded", async () => {
    let release: (v: unknown) => void = () => {};
    filterAnswer = () => new Promise((resolve) => (release = resolve));
    renderBoard(`/?filters=${SALES}`);
    await waitFor(() => expect(filterCalls()).toBe(1));
    await waitFor(() =>
      expect(vi.mocked(api.get).mock.calls.some(([p]) => p.startsWith("/reports/ppm/gantt"))).toBe(true),
    );
    // The board data has landed, but the selection has not: spinner, no rows.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(names()).toEqual([]);
    release(FILTER_DATA);
    await screen.findByText("Alpha Rollout");
    expect(names()).toEqual(["Alpha Rollout"]);
    expect(total()).toBe("1");
    expect(header()).toHaveAttribute("aria-expanded", "false");
    expect(within(header()).getByText("1")).toBeInTheDocument();
    // Folded means hidden, not just flagged: the section's controls are not visible.
    const body = document.getElementById(header().getAttribute("aria-controls")!)!;
    expect(within(body).getByText("Related By")).not.toBeVisible();
  });

  it("narrows the rows and the tile to a related card, and writes ?filters=", async () => {
    renderBoard();
    await screen.findByText("Alpha Rollout");
    expect(total()).toBe("3");
    fireEvent.click(header());
    await pickOrganization("Sales");
    await waitFor(() => expect(names()).toEqual(["Alpha Rollout"]));
    expect(total()).toBe("1");
    expect(location().get("filters")).toBe('{"relationFilters":{"Organization":["sales"]}}');
  });

  it("widens a pick to the cards beneath it with Include sub-cards", async () => {
    renderBoard(`/?filters=${SALES}`);
    await screen.findByText("Alpha Rollout");
    fireEvent.click(header());
    fireEvent.click(screen.getByRole("checkbox", { name: "Include sub-cards" }));
    await waitFor(() => expect(names()).toEqual(["Alpha Rollout", "Beta Upgrade"]));
    expect(total()).toBe("2");
    expect(location().get("filters")).toBe(
      '{"relationFilters":{"Organization":["sales"]},"includeDescendants":true}',
    );
  });

  it("clears every pick with Clear all, keeping Include sub-cards", async () => {
    renderBoard(
      `/?filters=${encodeURIComponent('{"relationFilters":{"Organization":["sales"]},"includeDescendants":true}')}`,
    );
    await waitFor(() => expect(names()).toEqual(["Alpha Rollout", "Beta Upgrade"]));
    const chip = screen.getByText("Clear all").closest(".MuiChip-root") as HTMLElement;
    fireEvent.click(within(chip).getByTestId("CancelIcon"));
    await waitFor(() =>
      expect(names()).toEqual(["Alpha Rollout", "Beta Upgrade", "Gamma Study"]),
    );
    expect(total()).toBe("3");
    expect(location().get("filters")).toBe('{"includeDescendants":true}');
  });

  it("drops the param once nothing is selected", async () => {
    renderBoard(`/?search=a&filters=${SALES}`);
    await screen.findByText("Alpha Rollout");
    const chip = screen.getByText("Clear all").closest(".MuiChip-root") as HTMLElement;
    fireEvent.click(within(chip).getByTestId("CancelIcon"));
    await waitFor(() => expect(location().has("filters")).toBe(false));
    expect(location().get("search")).toBe("a");
  });

  it("loads unfiltered on a malformed ?filters=, and cleans it from the URL", async () => {
    renderBoard("/?filters=%7Bbad");
    await screen.findByText("Alpha Rollout");
    expect(names()).toEqual(["Alpha Rollout", "Beta Upgrade", "Gamma Study"]);
    await waitFor(() => expect(location().has("filters")).toBe(false));
    expect(filterCalls()).toBe(0);
  });

  it("narrows nothing and says why when the payload fails to load", async () => {
    filterAnswer = () => Promise.reject(new Error("boom"));
    renderBoard(`/?filters=${SALES}`);
    expect(await screen.findByText("Filters could not be loaded.")).toBeInTheDocument();
    await waitFor(() =>
      expect(names()).toEqual(["Alpha Rollout", "Beta Upgrade", "Gamma Study"]),
    );
    expect(total()).toBe("3");
    expect(screen.queryByRole("combobox", { name: "Organization" })).toBeNull();
    // Shown open, so the message is seen rather than hidden under a folded header.
    expect(header()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Filters could not be loaded.")).toBeVisible();
  });

  it("names no filter in the print header when the payload fails to load", async () => {
    filterAnswer = () => Promise.reject(new Error("boom"));
    // A tag pick would print as its raw id ("Tags: t1") with no payload to name it.
    renderBoard(
      `/?filters=${encodeURIComponent('{"relationFilters":{"Organization":["sales"]},"tagFilterIds":["t1"]}')}`,
    );
    await screen.findByText("Filters could not be loaded.");
    await screen.findByText("Gamma Study");
    const printed = document.querySelector(".report-print-params")?.textContent ?? "";
    // The board's own lines only — no "Organization: sales" for a filter not applied.
    expect(printed).toBe("Group by: Organization");
  });

  it("puts each pick in the print header by name", async () => {
    renderBoard(`/?filters=${SALES}`);
    await screen.findByText("Alpha Rollout");
    await waitFor(() =>
      expect(document.querySelector(".report-print-params")?.textContent ?? "").toContain(
        "Organization: Sales",
      ),
    );
  });
});
