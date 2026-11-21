/**
 * The PPM portfolio board's Filters section, through the real container: it
 * starts folded, fetches its payload only once it is opened (or at once when
 * the URL carries a selection), narrows the rows and the KPI tiles, keeps the
 * selection in `?filters=`, and never shows unfiltered rows while a selection
 * is still loading — and remembers the board's state in the browser, restoring
 * it onto a bare link, with Reset to return to the defaults.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEffect } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate, useNavigationType } from "react-router";
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

/** The metamodel's card types for the current test — every test starts from `TYPES`. */
let metamodelTypes: typeof TYPES = TYPES;

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    types: metamodelTypes,
    relationTypes: [],
    loading: false,
    getType: (key: string) => metamodelTypes.find((tp) => tp.key === key),
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

/**
 * The same board with one tag group: Alpha is tagged Cloud, Beta is tagged
 * Data, Gamma carries no tag.
 */
const FILTER_DATA_TAGS = {
  ...FILTER_DATA,
  items: FILTER_DATA.items.map((it) => ({
    ...it,
    tag_ids: it.id === "i1" ? ["cloud"] : it.id === "i2" ? ["data"] : [],
  })),
  tag_groups: [
    {
      id: "theme",
      name: "Theme",
      mode: "multi",
      tags: [
        { id: "cloud", name: "Cloud" },
        { id: "data", name: "Data" },
      ],
    },
  ],
};

const SALES = encodeURIComponent('{"relationFilters":{"Organization":["sales"]}}');

/** The board's rows and grouping options for the current test. */
let ganttRows: unknown[] = GANTT;
let groupOptionRows: unknown[] = [];

/** How the filter payload answers: at once, never (until released), or with an error. */
let filterAnswer: () => Promise<unknown> = () => Promise.resolve(FILTER_DATA);

beforeEach(() => {
  vi.clearAllMocks();
  // The board remembers its state in the browser, and jsdom shares one storage.
  localStorage.clear();
  filterAnswer = () => Promise.resolve(FILTER_DATA);
  ganttRows = GANTT;
  groupOptionRows = [];
  navigationTypes = [];
  metamodelTypes = TYPES;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.mocked(api.get).mockImplementation(((path: string) => {
    if (path.startsWith("/reports/ppm/gantt")) return Promise.resolve(ganttRows);
    if (path.startsWith("/reports/ppm/dashboard")) return Promise.resolve(DASHBOARD);
    if (path.startsWith("/reports/ppm/group-options")) return Promise.resolve(groupOptionRows);
    if (path === "/reports/ppm/filter-data") return filterAnswer();
    return Promise.resolve([]);
  }) as typeof api.get);
});

/** How each location the board was rendered at was reached ("POP" is the first). */
let navigationTypes: string[] = [];

function LocationProbe() {
  const { search, key } = useLocation();
  const type = useNavigationType();
  useEffect(() => {
    navigationTypes.push(type);
  }, [key, type]);
  return <output data-testid="location">{search}</output>;
}

/** Navigates to a bare link while the board stays mounted — the PPM menu entry. */
function MenuEntry() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate("/")}>
      menu
    </button>
  );
}

function renderBoard(url = "/") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <PpmPortfolio />
      <LocationProbe />
      <MenuEntry />
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

/** The toolbar's Group by select (an MUI Select whose label is not wired to it). */
const groupBySelect = () =>
  within(screen.getByText("Group by", { selector: "label" }).parentElement!).getByRole("combobox");

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

  it("offers the payload's tag group, and a tag pick narrows the rows, the tile and the print header", async () => {
    filterAnswer = () => Promise.resolve(FILTER_DATA_TAGS);
    renderBoard();
    await screen.findByText("Alpha Rollout");
    fireEvent.click(header());
    const tags = await screen.findByRole("combobox", { name: "Tags" });
    fireEvent.mouseDown(tags);
    const listbox = await screen.findByRole("listbox");
    // The group's own tags, by name.
    expect(within(listbox).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Cloud",
      "Data",
    ]);
    fireEvent.click(within(listbox).getByRole("option", { name: "Cloud" }));
    await waitFor(() => expect(names()).toEqual(["Alpha Rollout"]));
    expect(total()).toBe("1");
    expect(location().get("filters")).toBe('{"tagFilterIds":["cloud"]}');
    // Named by the tag, never by its id.
    expect(document.querySelector(".report-print-params")?.textContent ?? "").toContain(
      "Tags: Cloud",
    );
  });

  it("prints a pick widened with Include sub-cards with the sub-cards note", async () => {
    renderBoard(
      `/?filters=${encodeURIComponent('{"relationFilters":{"Organization":["sales"]},"includeDescendants":true}')}`,
    );
    await waitFor(() => expect(names()).toEqual(["Alpha Rollout", "Beta Upgrade"]));
    expect(document.querySelector(".report-print-params")?.textContent ?? "").toContain(
      "Organization: Sales (incl. sub-cards)",
    );
  });

  it("names an (empty) pick in the print header by the empty label", async () => {
    renderBoard(
      `/?filters=${encodeURIComponent('{"relationFilters":{"Organization":["__empty__"]}}')}`,
    );
    // Only the initiative related to no organization.
    await waitFor(() => expect(names()).toEqual(["Gamma Study"]));
    expect(document.querySelector(".report-print-params")?.textContent ?? "").toContain(
      "Organization: (empty)",
    );
  });

  it("falls back to a plain Filters header, and no subtype grouping, without an Initiative type", async () => {
    metamodelTypes = TYPES.filter((tp) => tp.key !== "Initiative");
    renderBoard();
    await screen.findByText("Alpha Rollout");
    expect(names()).toEqual(["Alpha Rollout", "Beta Upgrade", "Gamma Study"]);
    const plain = screen.getByRole("button", { name: /Filters$/ });
    // The header's caption is exactly the plain label (the icons add their glyph names).
    expect(within(plain).getByText("Filters")).toBeInTheDocument();
    expect(plain).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /Initiative Filters/ })).toBeNull();
    fireEvent.click(plain);
    await screen.findByRole("combobox", { name: "Organization" });
    // The Group by menu offers subtype grouping only from the type's subtypes.
    fireEvent.mouseDown(groupBySelect());
    await screen.findByRole("listbox");
    expect(screen.queryByText("Initiative subtypes")).toBeNull();
  });

  it("offers subtype grouping from the Initiative type's subtypes", async () => {
    renderBoard();
    await screen.findByText("Alpha Rollout");
    fireEvent.mouseDown(groupBySelect());
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByText("Initiative subtypes")).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "Project" })).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------ */
/* What the board remembers between visits                                   */
/* ------------------------------------------------------------------------ */

const PREFS_KEY = "turboea.ppm.portfolio.prefs";
const SALES_RAW = '{"relationFilters":{"Organization":["sales"]}}';
const remember = (value: unknown) => localStorage.setItem(PREFS_KEY, JSON.stringify(value));
const remembered = () => JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null");
const searchBox = () => screen.getByPlaceholderText("Search initiatives...") as HTMLInputElement;
const ganttCalls = () =>
  vi
    .mocked(api.get)
    .mock.calls.map(([p]) => p)
    .filter((p) => p.startsWith("/reports/ppm/gantt"));
const resetButton = () => screen.getByRole("button", { name: "Reset to defaults" });

describe("PpmPortfolio remembers its state", () => {
  it("restores the remembered search, grouping, subtype and filters onto a bare link", async () => {
    groupOptionRows = [
      { type_key: "Organization", type_label: "Organization" },
      { type_key: "Platform", type_label: "Platform" },
    ];
    remember({
      params: { search: "a", groupBy: "Platform", subtype: "project", filters: SALES_RAW },
      filtersCollapsed: true,
    });
    renderBoard("/?tab=reports");
    await waitFor(() => expect(names()).toEqual(["Alpha Rollout"]));
    expect(total()).toBe("1");
    expect(searchBox()).toHaveValue("a");
    expect(groupBySelect()).toHaveTextContent("Platform");
    // The board mounted on the restored link: it never asked for the default grouping.
    expect(ganttCalls()).toEqual(["/reports/ppm/gantt?group_by=Platform"]);
    expect(header()).toHaveAttribute("aria-expanded", "false");
    expect(within(header()).getByText("1")).toBeInTheDocument();
    expect(Object.fromEntries(location())).toEqual({
      tab: "reports",
      search: "a",
      groupBy: "Platform",
      subtype: "project",
      filters: SALES_RAW,
    });
    expect(screen.getAllByRole("combobox")[1]).toHaveTextContent("Project");
    // Written over the link, not pushed as a page of its own for Back to land on.
    expect(navigationTypes).not.toContain("PUSH");

    // Reset after a restore writes the link again, and the board starts over.
    fireEvent.click(resetButton());
    await waitFor(() =>
      expect(names()).toEqual(["Alpha Rollout", "Beta Upgrade", "Gamma Study"]),
    );
    expect(location().toString()).toBe("tab=reports");
    expect(searchBox()).toHaveValue("");
    expect(localStorage.getItem(PREFS_KEY)).toBeNull();
  });

  it("restores the hierarchy and its depth", async () => {
    ganttRows = [GANTT[0], { ...GANTT[1], parent_id: "i1" }, GANTT[2]];
    remember({ params: { hierarchy: "1", depth: "1" }, filtersCollapsed: true });
    renderBoard();
    await screen.findByText("Alpha Rollout");
    expect(screen.getByLabelText("Show hierarchy")).toBeChecked();
    expect(screen.getByRole("combobox", { name: "Display depth" })).toHaveTextContent("Level 1");
    // Depth 1 keeps the roots only.
    expect(names()).toEqual(["Alpha Rollout", "Gamma Study"]);
    expect(location().toString()).toBe("hierarchy=1&depth=1");
  });

  it("restores the sub-grouping by subtype", async () => {
    remember({ params: { bySubtype: "1" }, filtersCollapsed: true });
    renderBoard();
    await screen.findByText("Alpha Rollout");
    expect(screen.getByLabelText("Sub-group by subtype")).toBeChecked();
    expect(location().toString()).toBe("bySubtype=1");
  });

  it("opens a link with settings of its own as it says, and remembers those", async () => {
    remember({ params: { search: "Gamma", subtype: "project" }, filtersCollapsed: true });
    renderBoard("/?search=Beta");
    await waitFor(() => expect(names()).toEqual(["Beta Upgrade"]));
    expect(location().toString()).toBe("search=Beta");
    expect(remembered()).toEqual({ params: { search: "Beta" }, filtersCollapsed: true });
  });

  it("remembers each change", async () => {
    renderBoard();
    await screen.findByText("Alpha Rollout");
    expect(localStorage.getItem(PREFS_KEY)).toBeNull();
    fireEvent.change(searchBox(), { target: { value: "Beta" } });
    await waitFor(() =>
      expect(remembered()).toEqual({ params: { search: "Beta" }, filtersCollapsed: true }),
    );
    fireEvent.click(header());
    await pickOrganization("Sales");
    await waitFor(() =>
      expect(remembered()).toEqual({
        params: { search: "Beta", filters: SALES_RAW },
        filtersCollapsed: false,
      }),
    );
  });

  it("keeps the state, and the memory, when the menu opens a bare link over the board", async () => {
    renderBoard("/?search=Beta");
    await waitFor(() => expect(names()).toEqual(["Beta Upgrade"]));
    fireEvent.click(screen.getByRole("button", { name: "menu" }));
    // The board stays mounted with its state, and writes that state back onto the link.
    await waitFor(() => expect(location().toString()).toBe("search=Beta"));
    // Not remounted: the rows were fetched once.
    expect(ganttCalls()).toHaveLength(1);
    expect(names()).toEqual(["Beta Upgrade"]);
    expect(searchBox()).toHaveValue("Beta");
    expect(remembered()).toEqual({ params: { search: "Beta" }, filtersCollapsed: true });

    fireEvent.change(searchBox(), { target: { value: "Gamma" } });
    await waitFor(() =>
      expect(remembered()).toEqual({ params: { search: "Gamma" }, filtersCollapsed: true }),
    );
    expect(location().toString()).toBe("search=Gamma");
  });

  it("is folded the first time, and opens as the user last left it", async () => {
    const first = renderBoard();
    await screen.findByText("Alpha Rollout");
    expect(header()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(header());
    expect(remembered()).toEqual({ params: {}, filtersCollapsed: false });
    first.unmount();

    // Opened unfolded, and fetched at once — not a section stuck on "Loading…".
    const second = renderBoard();
    await screen.findByRole("combobox", { name: "Organization" });
    expect(header()).toHaveAttribute("aria-expanded", "true");
    expect(filterCalls()).toBe(2);
    fireEvent.click(header());
    expect(header()).toHaveAttribute("aria-expanded", "false");
    // Folded with nothing else set is the default, which leaves nothing behind.
    expect(localStorage.getItem(PREFS_KEY)).toBeNull();
    second.unmount();

    renderBoard();
    await screen.findByText("Alpha Rollout");
    expect(header()).toHaveAttribute("aria-expanded", "false");
    expect(filterCalls()).toBe(2);
  });

  it("does not remember the section open because a failed load showed it open", async () => {
    filterAnswer = () => Promise.reject(new Error("boom"));
    renderBoard(`/?filters=${SALES}`);
    await screen.findByText("Filters could not be loaded.");
    expect(header()).toHaveAttribute("aria-expanded", "true");
    await waitFor(() =>
      expect(remembered()).toEqual({ params: { filters: SALES_RAW }, filtersCollapsed: true }),
    );
  });

  it("returns to the defaults with Reset, keeping the link's other parameters", async () => {
    groupOptionRows = [
      { type_key: "Organization", type_label: "Organization" },
      { type_key: "Platform", type_label: "Platform" },
    ];
    renderBoard(`/?tab=reports&search=Beta&groupBy=Platform&filters=${SALES}`);
    // Beta matches the search, but only Alpha is related to Sales.
    await screen.findByText("No initiatives found");
    fireEvent.click(header());
    await screen.findByRole("combobox", { name: "Organization" });
    expect(remembered()).toEqual({
      params: { search: "Beta", groupBy: "Platform", filters: SALES_RAW },
      filtersCollapsed: false,
    });

    fireEvent.click(resetButton());
    await waitFor(() =>
      expect(names()).toEqual(["Alpha Rollout", "Beta Upgrade", "Gamma Study"]),
    );
    expect(searchBox()).toHaveValue("");
    expect(groupBySelect()).toHaveTextContent("Organization");
    expect(header()).toHaveAttribute("aria-expanded", "false");
    expect(within(header()).queryByText("1")).toBeNull();
    expect(total()).toBe("3");
    expect(location().toString()).toBe("tab=reports");
    expect(localStorage.getItem(PREFS_KEY)).toBeNull();
    expect(ganttCalls().at(-1)).toBe("/reports/ppm/gantt?group_by=Organization");
    expect(navigationTypes).not.toContain("PUSH");
  });

  it("returns to the defaults with Reset when the link is already bare", async () => {
    // Only the fold is remembered, so the link carries no board parameter at all.
    remember({ params: {}, filtersCollapsed: false });
    renderBoard("/?tab=reports");
    await screen.findByRole("combobox", { name: "Organization" });
    expect(header()).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(resetButton());
    await waitFor(() => expect(header()).toHaveAttribute("aria-expanded", "false"));
    expect(names()).toEqual(["Alpha Rollout", "Beta Upgrade", "Gamma Study"]);
    expect(location().toString()).toBe("tab=reports");
    expect(localStorage.getItem(PREFS_KEY)).toBeNull();
  });

  it("opens the default board over corrupt storage", async () => {
    localStorage.setItem(PREFS_KEY, "{bad");
    renderBoard();
    await screen.findByText("Alpha Rollout");
    expect(names()).toEqual(["Alpha Rollout", "Beta Upgrade", "Gamma Study"]);
    expect(location().toString()).toBe("");
  });

  it("opens on what the link shows when a remembered value cannot survive the link", async () => {
    // A lone surrogate is written to the link as U+FFFD, so the link never shows
    // exactly what was remembered: the board must open anyway, not spin for good.
    remember({ params: { search: "\ud800" }, filtersCollapsed: true });
    renderBoard();
    expect(await screen.findByText("No initiatives found")).toBeInTheDocument();
    expect(searchBox()).toHaveValue("\ufffd");
    expect(location().get("search")).toBe("\ufffd");
  });
});
