/**
 * The Lifecycle report's card filters and sort (#1305): the Flexible
 * Portfolio's filter section, Include sub-cards, and one sort order for the
 * timeline and the table alike.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRef } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import LifecycleReport from "./LifecycleReport";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn() },
  isAbortError: () => false,
}));
vi.mock("@/hooks/useMetamodel", () => ({ useMetamodel: vi.fn() }));
vi.mock("@/hooks/useSavedReport", () => ({ useSavedReport: vi.fn() }));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
vi.mock("@/hooks/useThumbnailCapture", () => ({ useThumbnailCapture: vi.fn() }));
vi.mock("./SaveReportDialog", () => ({ default: () => null }));

import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useSavedReport } from "@/hooks/useSavedReport";
import { useThumbnailCapture } from "@/hooks/useThumbnailCapture";

const TYPES = [
  {
    key: "Application",
    label: "Application",
    icon: "apps",
    color: "#0f7eb5",
    is_hidden: false,
    has_hierarchy: true,
    subtypes: [
      { key: "business", label: "Business Application" },
      { key: "microservice", label: "Microservice" },
    ],
    fields_schema: [
      {
        section: "Details",
        fields: [
          {
            key: "businessCriticality",
            label: "Business Criticality",
            type: "single_select",
            options: [
              { key: "administrative", label: "Administrative" },
              { key: "operational", label: "Business Operational" },
              { key: "missionCritical", label: "Mission Critical" },
            ],
          },
        ],
      },
    ],
  },
  {
    key: "BusinessCapability",
    label: "Business Capability",
    icon: "account_tree",
    color: "#003399",
    is_hidden: false,
    has_hierarchy: true,
    subtypes: [],
    fields_schema: [],
  },
];

const supports = (capId: string, capName: string) => ({
  relation_type: "relAppToBC",
  direction: "outgoing",
  related_id: capId,
  related_name: capName,
  related_type: "BusinessCapability",
});

const ROADMAP = {
  items: [
    {
      id: "dispatch",
      name: "Dispatch",
      type: "Application",
      subtype: "business",
      lifecycle: { active: "2018-01-01", phaseOut: "2027-06-01" },
      attributes: { businessCriticality: "missionCritical" },
      relations: [supports("ship", "Shipping")],
      tag_ids: ["in-house"],
    },
    {
      id: "concur",
      name: "Concur",
      type: "Application",
      subtype: "business",
      lifecycle: { active: "2016-01-01" },
      attributes: { businessCriticality: "administrative" },
      relations: [supports("fin", "Finance")],
      tag_ids: [],
    },
    {
      id: "ledger",
      name: "Ledger",
      type: "Application",
      subtype: "microservice",
      lifecycle: { active: "2019-01-01", phaseOut: "2026-12-01" },
      attributes: { businessCriticality: "operational" },
      relations: [supports("fin", "Finance")],
      tag_ids: ["in-house"],
    },
    {
      id: "router",
      name: "Router",
      type: "Application",
      lifecycle: { active: "2020-01-01", phaseOut: "2029-01-01" },
      attributes: {},
      relations: [supports("ful", "Fulfilment")],
      tag_ids: ["in-house"],
    },
  ],
  fields_schema: [],
  relation_types: [
    {
      key: "relAppToBC",
      label: "supports",
      reverse_label: "is supported by",
      source_type_key: "Application",
      target_type_key: "BusinessCapability",
      other_type_key: "BusinessCapability",
      attributes_schema: [],
    },
  ],
  groupable_types: {
    BusinessCapability: [
      { id: "fin", name: "Finance", type: "BusinessCapability", parent_id: null },
      { id: "ful", name: "Fulfilment", type: "BusinessCapability", parent_id: "ops" },
      { id: "ops", name: "Operations", type: "BusinessCapability", parent_id: null, ancestor_only: true },
      { id: "ship", name: "Shipping", type: "BusinessCapability", parent_id: "ful" },
    ],
  },
  tag_groups: [
    { id: "origin", name: "Origin", mode: "multi", tags: [{ id: "in-house", name: "Internally Developed" }] },
  ],
};

const ALL_TYPES_ROADMAP = {
  items: ROADMAP.items.map(({ id, name, type, lifecycle, attributes }) => ({ id, name, type, lifecycle, attributes })),
};

let config: Record<string, unknown> | null = null;
let persistConfig = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  config = null;
  persistConfig = vi.fn();
  vi.mocked(useMetamodel).mockReturnValue({
    types: TYPES,
    relationTypes: [],
    loading: false,
    getType: (key: string) => TYPES.find((t) => t.key === key),
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
  } as unknown as ReturnType<typeof useMetamodel>);
  vi.mocked(useSavedReport).mockImplementation(
    () =>
      ({
        savedReport: null,
        savedReportName: null,
        saveDialogOpen: false,
        setSaveDialogOpen: vi.fn(),
        loadedConfig: config,
        consumeConfig: () => config,
        resetSavedReport: vi.fn(),
        persistConfig,
        resetAll: vi.fn(),
        reportType: "lifecycle",
      }) as unknown as ReturnType<typeof useSavedReport>,
  );
  vi.mocked(useThumbnailCapture).mockReturnValue({
    chartRef: createRef(),
    thumbnail: undefined,
    captureAndSave: vi.fn(),
  } as unknown as ReturnType<typeof useThumbnailCapture>);
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path.startsWith("/reports/roadmap?type=Application")) return ROADMAP;
    if (path.startsWith("/reports/roadmap")) return ALL_TYPES_ROADMAP;
    return { items: [], total: 0 };
  });
});

function renderReport() {
  return render(
    <MemoryRouter>
      <LifecycleReport />
    </MemoryRouter>,
  );
}

const tableRows = () =>
  within(screen.getAllByRole("rowgroup")[1])
    .getAllByRole("row")
    .map((r) => within(r).getAllByRole("cell")[0].textContent);
const printParams = () => document.querySelector(".report-print-params")?.textContent ?? "";
const lastPersisted = () => persistConfig.mock.calls.at(-1)?.[0] as Record<string, unknown>;

describe("LifecycleReport filters (#1305)", () => {
  it("narrows to the cards supporting a capability's subtree and carrying a tag", async () => {
    config = {
      cardTypeKey: "Application",
      view: "table",
      relationFilters: { BusinessCapability: ["ops"] },
      includeDescendants: true,
      tagFilterIds: ["in-house"],
      sortK: "phaseOut",
      sortD: "asc",
    };
    renderReport();
    // Shipping and Fulfilment sit under Operations; Ledger (Finance) does not,
    // and Concur carries no tag.
    await waitFor(() => expect(tableRows()).toEqual(["Dispatch", "Router"]));
    expect(screen.getByText("2 of 4 cards")).toBeInTheDocument();
    expect(printParams()).toContain("Business Capability: Operations (incl. sub-cards)");
    expect(printParams()).toContain("Tags: Internally Developed");
    expect(printParams()).toContain("Sort by: Phase Out ↑");

    // Without sub-cards a pick on Operations matches only a direct link: none.
    fireEvent.click(screen.getByRole("checkbox", { name: "Include sub-cards" }));
    await waitFor(() => expect(screen.queryAllByRole("rowgroup")[1]?.querySelectorAll("tr").length ?? 0).toBe(0));
    expect(lastPersisted()).toMatchObject({
      relationFilters: { BusinessCapability: ["ops"] },
      includeDescendants: false,
      tagFilterIds: ["in-house"],
      sortK: "phaseOut",
      sortD: "asc",
    });
  });

  it("filters by the card's own subtype and fields, and clears everything at once", async () => {
    config = { cardTypeKey: "Application", view: "table", subtypeFilters: ["microservice"] };
    renderReport();
    await waitFor(() => expect(tableRows()).toEqual(["Ledger"]));
    expect(printParams()).toContain("Subtype: Microservice");

    const clearChip = screen.getByText("Clear all").closest(".MuiChip-root") as HTMLElement;
    fireEvent.click(within(clearChip).getByTestId("CancelIcon"));
    await waitFor(() => expect(tableRows()).toEqual(["Concur", "Dispatch", "Ledger", "Router"]));
    expect(lastPersisted()).toMatchObject({ subtypeFilters: [], search: "" });
  });

  it("searches by name", async () => {
    config = { cardTypeKey: "Application", view: "table" };
    renderReport();
    await waitFor(() => expect(tableRows()).toHaveLength(4));
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: "led" } });
    await waitFor(() => expect(tableRows()).toEqual(["Ledger"]));
    expect(printParams()).toContain("Search: led");
  });

  it("explains the filters need a card type on All types", async () => {
    renderReport();
    expect(await screen.findByText("Pick a card type first to filter the timeline")).toBeInTheDocument();
    expect(screen.queryByText("Related By")).not.toBeInTheDocument();
  });

  it("restores the search, the folded section and ignores a sort direction it does not know", async () => {
    config = { cardTypeKey: "Application", view: "table", search: "led", filtersCollapsed: true, sortD: "sideways" };
    renderReport();
    await waitFor(() => expect(tableRows()).toEqual(["Ledger"]));
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveValue("led");
    expect(screen.getByRole("button", { name: /Application Filters/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Ascending" })).toBeInTheDocument();
    expect(lastPersisted()).toMatchObject({ search: "led", filtersCollapsed: true, sortD: "asc" });

    fireEvent.click(screen.getByRole("button", { name: /Application Filters/ }));
    await waitFor(() => expect(lastPersisted()).toMatchObject({ filtersCollapsed: false }));
  });

  it("reset to defaults clears the filters and the search", async () => {
    config = { cardTypeKey: "Application", view: "table", tagFilterIds: ["in-house"], search: "dis", includeDescendants: true };
    renderReport();
    await waitFor(() => expect(tableRows()).toEqual(["Dispatch"]));
    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    await waitFor(() =>
      expect(lastPersisted()).toMatchObject({
        cardTypeKey: "",
        tagFilterIds: [],
        search: "",
        includeDescendants: false,
        filtersCollapsed: false,
      }),
    );
  });

  it("keeps the filters when the same card type is picked again", async () => {
    config = { cardTypeKey: "Application", view: "table", tagFilterIds: ["in-house"] };
    renderReport();
    await waitFor(() => expect(tableRows()).toEqual(["Dispatch", "Ledger", "Router"]));
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Card Type" }));
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Application" }));
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    expect(tableRows()).toEqual(["Dispatch", "Ledger", "Router"]);
    expect(lastPersisted()).toMatchObject({ cardTypeKey: "Application", tagFilterIds: ["in-house"] });
  });

  it("starts a newly picked card type unfiltered, keeping the sub-card preference", async () => {
    config = {
      cardTypeKey: "Application",
      view: "table",
      tagFilterIds: ["in-house"],
      includeDescendants: true,
    };
    renderReport();
    await waitFor(() => expect(tableRows()).toEqual(["Dispatch", "Ledger", "Router"]));
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Card Type" }));
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Business Capability" }));
    await waitFor(() => expect(lastPersisted()).toMatchObject({ cardTypeKey: "BusinessCapability", tagFilterIds: [], includeDescendants: true }));
  });
});

describe("LifecycleReport sorting (#1305)", () => {
  it("orders the timeline rows by the chosen key, missing values last both ways", async () => {
    config = { cardTypeKey: "Application" };
    renderReport();
    await screen.findByText("Dispatch");
    const chartNames = () =>
      Array.from(document.querySelectorAll("[data-export-row]")).map((r) => r.textContent);
    expect(chartNames()).toEqual(["Concur", "Dispatch", "Ledger", "Router"]);

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Sort by" }));
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Phase Out" }));
    await waitFor(() => expect(chartNames()).toEqual(["Ledger", "Dispatch", "Router", "Concur"]));

    fireEvent.click(screen.getByRole("button", { name: "Ascending" }));
    await waitFor(() => expect(chartNames()).toEqual(["Router", "Dispatch", "Ledger", "Concur"]));
    expect(screen.getByRole("button", { name: "Descending" })).toBeInTheDocument();
    expect(lastPersisted()).toMatchObject({ sortK: "phaseOut", sortD: "desc" });
  });

  it("offers every sort key by its label, the select field included", async () => {
    config = { cardTypeKey: "Application" };
    renderReport();
    await screen.findByText("Dispatch");
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Sort by" }));
    const options = within(screen.getByRole("listbox"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual([
      "Name",
      "Type",
      "Subtype",
      "Current Phase",
      "Plan",
      "Phase In",
      "Active",
      "Phase Out",
      "End of Life",
      "Business Criticality",
    ]);
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Subtype" }));
    await waitFor(() => expect(lastPersisted()).toMatchObject({ sortK: "subtype" }));
    // Business Application < Microservice < no subtype, by label.
    const chartNames = () => Array.from(document.querySelectorAll("[data-export-row]")).map((r) => r.textContent);
    await waitFor(() => expect(chartNames()).toEqual(["Concur", "Dispatch", "Ledger", "Router"]));
    fireEvent.click(screen.getByRole("button", { name: "Ascending" }));
    await waitFor(() => expect(chartNames()).toEqual(["Ledger", "Concur", "Dispatch", "Router"]));
    expect(printParams()).toContain("Sort by: Subtype ↓");
  });

  it("sorts by a select field in its option order, most critical first descending", async () => {
    config = { cardTypeKey: "Application", view: "table", sortK: "attr:businessCriticality", sortD: "desc" };
    renderReport();
    await waitFor(() => expect(tableRows()).toEqual(["Dispatch", "Ledger", "Concur", "Router"]));
    expect(screen.getByRole("combobox", { name: "Sort by" })).toHaveTextContent("Business Criticality");
  });

  it("sorts the table by a phase date from its header", async () => {
    config = { cardTypeKey: "Application", view: "table" };
    renderReport();
    await waitFor(() => expect(tableRows()).toHaveLength(4));
    fireEvent.click(screen.getByRole("button", { name: "Phase Out" }));
    await waitFor(() => expect(tableRows()).toEqual(["Ledger", "Dispatch", "Router", "Concur"]));
    expect(screen.getByRole("combobox", { name: "Sort by" })).toHaveTextContent("Phase Out");
  });
});
