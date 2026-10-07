/**
 * The inventory's filter sidebar rendered on its own, driven the way a user
 * drives it: the collapsed rail, the three tabs, every facet of the Filters
 * tab, the Columns tab's checkbox lists, the Views tab with its save / edit
 * dialog, and the resize handle.
 *
 * The component is controlled, so a tiny harness holds `filters` (and the
 * selected-column set) in state and records every `onFiltersChange` call; the
 * assertions read the last argument. Everything is driven with `fireEvent`:
 * nothing here needs real typing, and `userEvent.setup()` would shadow the
 * kit's clipboard mock with its own stub.
 */
import { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, act, waitFor } from "@testing-library/react";
import InventoryFilterSidebar, {
  EMPTY_VALUE,
  LOCKED_COLUMN_KEYS,
  tagEmptyToken,
  type Filters,
} from "./InventoryFilterSidebar";
import { mockApi } from "@/test/apiMock";
import { installClipboard } from "@/test/dom";
import {
  ADMIN_USER,
  APPLICATION_TYPE,
  CARD_IDS,
  CARD_TYPES,
  MEMBER_USER,
  REL_APP_TO_APP,
  REL_APP_TO_BC,
  REL_APP_TO_ITC,
  REL_PROVIDER_TO_ITC,
  RISK_GROUP,
  HOSTING_GROUP,
  TAG_GROUPS,
  USERS,
  VIEWER_USER,
  makeCardType,
  makeField,
  makeOption,
  makeRelationType,
  makeSection,
  makeTag,
  makeTagGroup,
} from "@/test/fixtures/metamodel";
import type { Bookmark, RelatedCardRef } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

const LS_KEY = "turboea_inventory_sidebar";

const EMPTY_FILTERS: Filters = {
  types: [],
  search: "",
  subtypes: [],
  lifecyclePhases: [],
  dataQualityBands: [],
  approvalStatuses: [],
  showArchived: false,
  attributes: {},
  relations: {},
  tagIds: [],
  mineScope: null,
  orphanedOnly: false,
  staleOnly: false,
  eolStatuses: [],
  linkTypes: [],
};

/* ------------------------------------------------------------------------- */
/*  Fixtures                                                                   */
/* ------------------------------------------------------------------------- */

/** A hierarchical type with a link-label vocabulary (none of the shared fixtures has one). */
const SITE_TYPE = makeCardType({
  key: "Site",
  label: "Site",
  icon: "location_on",
  color: "#445566",
  category: "Business Architecture",
  has_hierarchy: true,
  sort_order: 7,
  hierarchy_labels: [
    makeOption({ key: "primary", label: "Primary", color: "#123456" }),
    makeOption({ key: "backup", label: "Backup" }),
  ],
});

/** Shares exactly one field key with Application, for the common-fields path. */
const SERVICE_TYPE = makeCardType({
  key: "Service",
  label: "Service",
  category: "Application & Data",
  sort_order: 11,
  fields_schema: [
    makeSection({
      fields: [
        makeField({ key: "alias", label: "Alias", type: "text" }),
        makeField({ key: "owner", label: "Owner", type: "text" }),
      ],
    }),
  ],
});

/** A second relation type on the Application → ITComponent pair. */
const REL_APP_TO_ITC_HOSTS = makeRelationType({
  key: "relAppToITCHosts",
  label: "is hosted on",
  reverse_label: "hosts",
  source_type_key: "Application",
  target_type_key: "ITComponent",
  sort_order: 5,
});

const ref = (id: string, name: string, type: string): RelatedCardRef => ({ id, name, type });

/** `relationsMap` as the page builds it: facet key → card id → related refs. */
const RELATIONS_MAP = new Map<string, Map<string, RelatedCardRef[]>>([
  [
    "relAppToITC",
    new Map([
      [
        CARD_IDS.erp,
        [
          ref(CARD_IDS.postgres, "PostgreSQL", "ITComponent"),
          ref(CARD_IDS.linux, "Ubuntu LTS", "ITComponent"),
        ],
      ],
      [CARD_IDS.crm, [ref(CARD_IDS.postgres, "PostgreSQL", "ITComponent")]],
    ]),
  ],
  ["relAppToITCHosts", new Map([[CARD_IDS.crm, [ref(CARD_IDS.linux, "Ubuntu LTS", "ITComponent")]]])],
  ["relAppToBC", new Map([[CARD_IDS.erp, [ref(CARD_IDS.finance, "Finance", "BusinessCapability")]]])],
  ["relAppToApp__out", new Map([[CARD_IDS.erp, [ref(CARD_IDS.crm, "CRM Cloud", "Application")]]])],
  ["relAppToApp__in", new Map([[CARD_IDS.crm, [ref(CARD_IDS.erp, "ERP Core", "Application")]]])],
]);

function makeBookmark(overrides: Partial<Bookmark> & { id: string; name: string }): Bookmark {
  return {
    is_default: false,
    visibility: "private",
    odata_enabled: false,
    owner_id: ADMIN_USER.id,
    is_owner: true,
    can_edit: true,
    ...overrides,
  };
}

const MY_VIEW = makeBookmark({
  id: "bm-1",
  name: "My App View",
  filters: { types: ["Application"], search: "erp" },
  columns: ["core_type", "core_name", "attr_alias"],
  column_state: [{ colId: "core_name", width: 240 }],
  column_filter_model: { core_name: { filter: "erp" } },
});
const MY_MULTI = makeBookmark({
  id: "bm-5",
  name: "Two Types",
  filters: { types: ["Application", "ITComponent"] },
});
const MY_ALL = makeBookmark({ id: "bm-6", name: "Everything" });
const MY_SHARED = makeBookmark({
  id: "bm-7",
  name: "Shared by me",
  visibility: "shared",
  odata_enabled: true,
  odata_url: "https://ea.example/odata/bm-7",
  shared_with: [
    { user_id: MEMBER_USER.id, display_name: "Test Member", email: MEMBER_USER.email, can_edit: true },
    { user_id: VIEWER_USER.id, can_edit: false },
  ],
});
const SHARED_EDITABLE = makeBookmark({
  id: "bm-2",
  name: "Team View",
  is_owner: false,
  owner_id: MEMBER_USER.id,
  owner_name: "Test Member",
  visibility: "shared",
  can_edit: true,
  filters: { types: ["Application", "ITComponent"], dataQualityMin: 50, groupBy: "subtype" },
});
const SHARED_READONLY = makeBookmark({
  id: "bm-3",
  name: "Locked View",
  is_owner: false,
  owner_id: MEMBER_USER.id,
  visibility: "shared",
  can_edit: false,
  filters: {},
});
const PUBLIC_VIEW = makeBookmark({
  id: "bm-4",
  name: "Everyone",
  is_owner: false,
  owner_id: MEMBER_USER.id,
  owner_name: "Test Member",
  visibility: "public",
  can_edit: false,
  odata_enabled: true,
  odata_url: "https://ea.example/odata/bm-4",
});

/* ------------------------------------------------------------------------- */
/*  Harness                                                                    */
/* ------------------------------------------------------------------------- */

type SidebarProps = React.ComponentProps<typeof InventoryFilterSidebar>;

interface HarnessProps extends Partial<Omit<SidebarProps, "filters">> {
  initialFilters?: Partial<Filters>;
}

function Harness({
  initialFilters,
  onFiltersChange,
  selectedColumns: initialColumns,
  onSelectedColumnsChange,
  ...rest
}: HarnessProps) {
  const [filters, setFilters] = useState<Filters>({ ...EMPTY_FILTERS, ...initialFilters });
  const [columns, setColumns] = useState<Set<string>>(
    () => initialColumns ?? new Set(LOCKED_COLUMN_KEYS),
  );
  return (
    <InventoryFilterSidebar
      types={CARD_TYPES}
      collapsed={false}
      onToggleCollapse={() => {}}
      width={280}
      onWidthChange={() => {}}
      frozenColumns={new Set()}
      onToggleFrozen={() => {}}
      columnOrderItems={[]}
      columnOrder={[]}
      onColumnOrderChange={() => {}}
      {...rest}
      filters={filters}
      onFiltersChange={(f) => {
        onFiltersChange?.(f);
        setFilters(f);
      }}
      selectedColumns={columns}
      onSelectedColumnsChange={(c) => {
        onSelectedColumnsChange?.(c);
        setColumns(c);
      }}
    />
  );
}

async function renderSidebar(props: HarnessProps = {}) {
  const changes: Filters[] = [];
  const columnChanges: Set<string>[] = [];
  const utils = render(
    <Harness
      {...props}
      onFiltersChange={(f) => {
        changes.push(f);
        props.onFiltersChange?.(f);
      }}
      onSelectedColumnsChange={(c) => {
        columnChanges.push(c);
        props.onSelectedColumnsChange?.(c);
      }}
    />,
  );
  // Let the mount-time `GET /bookmarks` settle inside act.
  await act(async () => {});
  return {
    ...utils,
    changes,
    columnChanges,
    last: () => changes[changes.length - 1],
    lastColumns: () => columnChanges[columnChanges.length - 1],
  };
}

/* ------------------------------------------------------------------------- */
/*  DOM helpers                                                                */
/* ------------------------------------------------------------------------- */

/** The combobox of an MUI `Select` whose `InputLabel` reads `labelText`. */
function comboboxFor(labelText: string, root: HTMLElement = document.body): HTMLElement {
  const label = within(root)
    .getAllByText(labelText)
    .find((el) => el.tagName === "LABEL");
  if (!label) throw new Error(`no field labelled ${labelText}`);
  return within(label.closest(".MuiFormControl-root") as HTMLElement).getByRole("combobox");
}

function openSelect(labelText: string, root?: HTMLElement): HTMLElement {
  fireEvent.mouseDown(comboboxFor(labelText, root));
  return screen.getByRole("listbox");
}

function closeSelect() {
  fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
}

/** The `<input>` of a Switch / Checkbox whose visible label reads `labelText`. */
function switchFor(labelText: string, root: HTMLElement = document.body): HTMLInputElement {
  const label = within(root).getByText(labelText).closest("label");
  if (!label) throw new Error(`no switch labelled ${labelText}`);
  return label.querySelector("input") as HTMLInputElement;
}

function expandSection(label: string) {
  fireEvent.click(screen.getByText(label));
}

function chip(name: string | RegExp): HTMLElement {
  return screen.getByRole("button", { name });
}

function openTab(name: "Filters" | "Columns" | "Views") {
  fireEvent.click(screen.getByRole("tab", { name }));
}

function sidebarPrefs(): { tab?: number; activeViewId?: string | null } {
  return JSON.parse(localStorage.getItem(LS_KEY) ?? "{}");
}

/* ------------------------------------------------------------------------- */

let restoreClipboard: (() => void) | null = null;

beforeEach(() => {
  localStorage.clear();
  mockApi.reset();
  mockApi.on("get", "/bookmarks", []);
  mockApi.on("get", "/users", USERS);
});

afterEach(() => {
  restoreClipboard?.();
  restoreClipboard = null;
});

/* ========================================================================= */
/*  Collapsed rail                                                             */
/* ========================================================================= */

describe("InventoryFilterSidebar — collapsed rail", () => {
  it("offers an expand button and no filter chip when nothing is active", async () => {
    const onToggleCollapse = vi.fn();
    await renderSidebar({ collapsed: true, onToggleCollapse });
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand filters" }));
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("2")).not.toBeInTheDocument();
  });

  it("counts every active facet on the chip", async () => {
    await renderSidebar({
      collapsed: true,
      initialFilters: {
        types: ["Application"],
        search: "erp",
        subtypes: ["microservice"],
        lifecyclePhases: ["active"],
        dataQualityBands: ["complete"],
        approvalStatuses: ["APPROVED"],
        showArchived: true,
        attributes: { alias: "x" },
        relations: { relAppToITC: ["PostgreSQL"] },
        tagIds: ["t1", "t2"],
        mineScope: "stakeholder",
        orphanedOnly: true,
        staleOnly: true,
        eolStatuses: ["eol"],
        linkTypes: ["primary"],
      },
    });
    // 1+1+1+1+1+1+1+1+1+2+1+1+1+1+1
    expect(screen.getByText("16")).toBeInTheDocument();
  });
});

/* ========================================================================= */
/*  Header, tabs and persistence                                               */
/* ========================================================================= */

describe("InventoryFilterSidebar — header and tabs", () => {
  it("renders three tabs, opens on Filters and persists the tab", async () => {
    await renderSidebar();
    expect(screen.getByRole("tab", { name: "Filters" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Columns" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Views" })).toBeInTheDocument();
    expect(sidebarPrefs()).toEqual({ tab: 0, activeViewId: null });

    openTab("Columns");
    expect(screen.getByPlaceholderText("Search columns...")).toBeInTheDocument();
    expect(sidebarPrefs().tab).toBe(1);

    openTab("Views");
    expect(screen.getByText("Saved Views")).toBeInTheDocument();
    expect(sidebarPrefs().tab).toBe(2);
  });

  it("restores the persisted tab and ignores a corrupt entry", async () => {
    localStorage.setItem(LS_KEY, JSON.stringify({ tab: 2, activeViewId: null }));
    const first = await renderSidebar();
    expect(screen.getByRole("tab", { name: "Views" })).toHaveAttribute("aria-selected", "true");
    first.unmount();

    localStorage.setItem(LS_KEY, "{not json");
    await renderSidebar();
    expect(screen.getByRole("tab", { name: "Filters" })).toHaveAttribute("aria-selected", "true");
  });

  it("collapses from the header chevron", async () => {
    const onToggleCollapse = vi.fn();
    await renderSidebar({ onToggleCollapse });
    fireEvent.click(screen.getByRole("button", { name: "chevron_left" }));
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  it("survives a failed bookmark load", async () => {
    mockApi.fail("get", "/bookmarks", 500);
    await renderSidebar();
    openTab("Views");
    expect(screen.getByText(/No saved views yet/)).toBeInTheDocument();
  });
});

/* ========================================================================= */
/*  Filters tab — search, scopes and footer                                    */
/* ========================================================================= */

describe("InventoryFilterSidebar — search and scopes", () => {
  it("writes the search text and clears it from the end adornment", async () => {
    const { last } = await renderSidebar();
    const input = screen.getByPlaceholderText("Search cards...");
    expect(screen.queryByRole("button", { name: "close" })).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "erp" } });
    expect(last().search).toBe("erp");

    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(last().search).toBe("");
  });

  it("collapses and re-expands the search section", async () => {
    await renderSidebar();
    expandSection("Search");
    await waitFor(() => expect(screen.getByPlaceholderText("Search cards...")).not.toBeVisible());
    expandSection("Search");
    await waitFor(() => expect(screen.getByPlaceholderText("Search cards...")).toBeVisible());
  });

  it("toggles the stakeholder scope on and off", async () => {
    const { last } = await renderSidebar();
    const toggle = switchFor("Only cards I'm a stakeholder on");
    fireEvent.click(toggle);
    expect(last().mineScope).toBe("stakeholder");
    fireEvent.click(toggle);
    expect(last().mineScope).toBeNull();
  });

  it("toggles the orphaned and stale scopes", async () => {
    const { last } = await renderSidebar();
    fireEvent.click(switchFor("Only orphaned cards"));
    expect(last().orphanedOnly).toBe(true);
    fireEvent.click(switchFor("Only stale cards"));
    expect(last().staleOnly).toBe(true);
    fireEvent.click(switchFor("Only orphaned cards"));
    expect(last().orphanedOnly).toBe(false);
  });

  it("offers Show archived only to a user who may archive", async () => {
    const first = await renderSidebar();
    expect(screen.queryByText("Show archived only")).not.toBeInTheDocument();
    first.unmount();

    const { last } = await renderSidebar({ canArchive: true });
    fireEvent.click(switchFor("Show archived only"));
    expect(last().showArchived).toBe(true);
  });

  it("shows Clear all with the active count and resets every facet", async () => {
    const { last } = await renderSidebar({
      initialFilters: { types: ["Application"], search: "erp", orphanedOnly: true },
    });
    fireEvent.click(screen.getByRole("button", { name: /Clear all \(3\)/ }));
    expect(last()).toEqual(EMPTY_FILTERS);
    expect(screen.queryByRole("button", { name: /Clear all/ })).not.toBeInTheDocument();
  });
});

/* ========================================================================= */
/*  Filters tab — card types                                                   */
/* ========================================================================= */

describe("InventoryFilterSidebar — card types", () => {
  it("groups visible types by layer and hides hidden ones", async () => {
    await renderSidebar();
    expect(screen.getByText("Business Architecture")).toBeInTheDocument();
    expect(screen.getByText("Application & Data")).toBeInTheDocument();
    expect(screen.getByText("Technical Architecture")).toBeInTheDocument();
    expect(screen.getByText("Business Capability")).toBeInTheDocument();
    expect(screen.getByText("IT Component")).toBeInTheDocument();
    expect(screen.queryByText("Secret")).not.toBeInTheDocument();
  });

  it("drops the layer headers when every type shares one layer", async () => {
    await renderSidebar({ types: [APPLICATION_TYPE, SERVICE_TYPE] });
    expect(screen.queryByText("Application & Data")).not.toBeInTheDocument();
    expect(screen.getByText("Service")).toBeInTheDocument();
  });

  it("files a type without a layer under Uncategorized", async () => {
    const bare = makeCardType({ key: "Bare", label: "Bare Thing", category: "  ", sort_order: 50 });
    await renderSidebar({ types: [APPLICATION_TYPE, bare] });
    expect(screen.getByText("Uncategorized")).toBeInTheDocument();
    expect(screen.getByText("Bare Thing")).toBeInTheDocument();
  });

  it("selecting a type resets the type-specific facets but keeps the rest", async () => {
    const { last } = await renderSidebar({
      initialFilters: {
        types: ["Application"],
        subtypes: ["microservice"],
        attributes: { alias: "x" },
        relations: { relAppToITC: ["PostgreSQL"] },
        eolStatuses: ["eol"],
        linkTypes: ["primary"],
        lifecyclePhases: ["active"],
        search: "erp",
      },
    });
    fireEvent.click(screen.getByText("IT Component"));
    expect(last()).toMatchObject({
      types: ["Application", "ITComponent"],
      subtypes: [],
      attributes: {},
      relations: {},
      eolStatuses: [],
      linkTypes: [],
      lifecyclePhases: ["active"],
      search: "erp",
    });
    expect(screen.getByText("2")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Application"));
    expect(last().types).toEqual(["ITComponent"]);
  });

  it("collapses the Types section from its header", async () => {
    await renderSidebar();
    expandSection("Types");
    await waitFor(() => expect(screen.getByText("IT Component")).not.toBeVisible());
  });
});

/* ========================================================================= */
/*  Filters tab — chip facets                                                  */
/* ========================================================================= */

describe("InventoryFilterSidebar — subtype, approval, lifecycle, quality chips", () => {
  it("offers subtypes for a single type with subtypes, plus (empty)", async () => {
    const { last } = await renderSidebar({ initialFilters: { types: ["Application"] } });
    expandSection("Subtypes");
    fireEvent.click(chip("Microservice"));
    expect(last().subtypes).toEqual(["microservice"]);
    expect(chip("Microservice")).toHaveClass("MuiChip-filled");

    fireEvent.click(chip("(empty)"));
    expect(last().subtypes).toEqual(["microservice", EMPTY_VALUE]);
    fireEvent.click(chip("Microservice"));
    expect(last().subtypes).toEqual([EMPTY_VALUE]);
  });

  it("hides the Subtypes section for several types or a type without subtypes", async () => {
    const first = await renderSidebar({ initialFilters: { types: ["Application", "ITComponent"] } });
    expect(screen.queryByText("Subtypes")).not.toBeInTheDocument();
    first.unmount();
    await renderSidebar({ initialFilters: { types: ["Provider"] } });
    expect(screen.queryByText("Subtypes")).not.toBeInTheDocument();
  });

  it("toggles approval statuses", async () => {
    const { last } = await renderSidebar();
    expandSection("Approval Status");
    fireEvent.click(chip("Approved"));
    expect(last().approvalStatuses).toEqual(["APPROVED"]);
    fireEvent.click(chip("Broken"));
    expect(last().approvalStatuses).toEqual(["APPROVED", "BROKEN"]);
    fireEvent.click(chip("Approved"));
    expect(last().approvalStatuses).toEqual(["BROKEN"]);
  });

  it("toggles lifecycle phases and the (empty) phase", async () => {
    const { last } = await renderSidebar();
    expandSection("Lifecycle");
    fireEvent.click(chip("Active"));
    expect(last().lifecyclePhases).toEqual(["active"]);
    fireEvent.click(chip("(empty)"));
    expect(last().lifecyclePhases).toEqual(["active", EMPTY_VALUE]);
    fireEvent.click(chip("Active"));
    expect(last().lifecyclePhases).toEqual([EMPTY_VALUE]);
    expect(chip("(empty)")).toHaveClass("MuiChip-filled");
  });

  it("toggles data-quality bands", async () => {
    const { last } = await renderSidebar();
    expandSection("Data Quality");
    fireEvent.click(chip("Complete (≥80%)"));
    expect(last().dataQualityBands).toEqual(["complete"]);
    fireEvent.click(chip("Minimal (<40%)"));
    expect(last().dataQualityBands).toEqual(["complete", "minimal"]);
    fireEvent.click(chip("Complete (≥80%)"));
    expect(last().dataQualityBands).toEqual(["minimal"]);
  });
});

describe("InventoryFilterSidebar — end of life and link type facets", () => {
  it("offers the EOL statuses only when the facet applies", async () => {
    const first = await renderSidebar({ initialFilters: { types: ["ITComponent"] } });
    expect(screen.queryByText("End of life")).not.toBeInTheDocument();
    first.unmount();

    const { last } = await renderSidebar({
      initialFilters: { types: ["ITComponent"] },
      showEolFacet: true,
    });
    expandSection("End of life");
    fireEvent.click(chip("Approaching EOL"));
    expect(last().eolStatuses).toEqual(["approaching"]);
    fireEvent.click(chip("Supported"));
    expect(last().eolStatuses).toEqual(["approaching", "supported"]);
    fireEvent.click(chip("(empty)"));
    expect(last().eolStatuses).toEqual(["approaching", "supported", EMPTY_VALUE]);
    fireEvent.click(chip("Approaching EOL"));
    expect(last().eolStatuses).toEqual(["supported", EMPTY_VALUE]);
    expect(chip("Supported")).toHaveClass("MuiChip-filled");
    expect(chip("Unknown")).toHaveClass("MuiChip-outlined");
  });

  it("offers the link types of the one selected hierarchical type", async () => {
    const first = await renderSidebar({
      types: [...CARD_TYPES, SITE_TYPE],
      initialFilters: { types: ["Site"] },
    });
    expect(screen.queryByText("Link type")).not.toBeInTheDocument();
    first.unmount();

    const { last } = await renderSidebar({
      types: [...CARD_TYPES, SITE_TYPE],
      initialFilters: { types: ["Site"] },
      showLinkTypeFacet: true,
    });
    expandSection("Link type");
    fireEvent.click(chip("Primary"));
    expect(last().linkTypes).toEqual(["primary"]);
    fireEvent.click(chip("Backup"));
    expect(last().linkTypes).toEqual(["primary", "backup"]);
    fireEvent.click(chip("(empty)"));
    expect(last().linkTypes).toEqual(["primary", "backup", EMPTY_VALUE]);
    fireEvent.click(chip("Primary"));
    expect(last().linkTypes).toEqual(["backup", EMPTY_VALUE]);
    expect(chip("Backup")).toHaveClass("MuiChip-filled");
  });

  it("hides the link-type facet for a type without a vocabulary", async () => {
    await renderSidebar({ initialFilters: { types: ["Application"] }, showLinkTypeFacet: true });
    expect(screen.queryByText("Link type")).not.toBeInTheDocument();
  });
});

/* ========================================================================= */
/*  Filters tab — attributes                                                   */
/* ========================================================================= */

describe("InventoryFilterSidebar — attribute filters", () => {
  const single = { initialFilters: { types: ["Application"] } };

  it("renders no Attributes section without exactly one type", async () => {
    const first = await renderSidebar();
    expect(screen.queryByText("Attributes")).not.toBeInTheDocument();
    first.unmount();
    await renderSidebar({ initialFilters: { types: ["Application", "ITComponent"] } });
    expect(screen.queryByText("Attributes")).not.toBeInTheDocument();
  });

  it("filters a select field through a searchable multi-select with (empty)", async () => {
    const { last } = await renderSidebar(single);
    expandSection("Attributes");

    let listbox = openSelect("Business Criticality");
    fireEvent.click(within(listbox).getByRole("option", { name: /Mission Critical/ }));
    expect(last().attributes).toEqual({ businessCriticality: ["missionCritical"] });

    fireEvent.click(within(listbox).getByRole("option", { name: "(empty)" }));
    expect(last().attributes).toEqual({ businessCriticality: ["missionCritical", EMPTY_VALUE] });

    // The in-menu search narrows the options and hides "(empty)" unless it matches.
    const search = within(listbox).getByPlaceholderText("Search…");
    // Typing in the search box must not reach the menu's type-ahead.
    fireEvent.keyDown(search, { key: "m" });
    expect(within(listbox).getByPlaceholderText("Search…")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "miss" } });
    expect(within(listbox).getByRole("option", { name: /Mission Critical/ })).toBeInTheDocument();
    expect(within(listbox).queryByRole("option", { name: /Business Critical/ })).not.toBeInTheDocument();
    expect(within(listbox).queryByRole("option", { name: "(empty)" })).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "emp" } });
    expect(within(listbox).getByRole("option", { name: "(empty)" })).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "zzz" } });
    expect(within(listbox).getByText("No matches")).toBeInTheDocument();

    // Closing clears the search term for the next opening.
    closeSelect();
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    listbox = openSelect("Business Criticality");
    expect(within(listbox).getByPlaceholderText("Search…")).toHaveValue("");
    closeSelect();
  });

  it("removes a selected option from its chip", async () => {
    const { last } = await renderSidebar({
      initialFilters: {
        types: ["Application"],
        attributes: { businessCriticality: ["missionCritical", EMPTY_VALUE, "ghost"] },
      },
    });
    expandSection("Attributes");
    const combobox = comboboxFor("Business Criticality");
    expect(within(combobox).getByText("Mission Critical")).toBeInTheDocument();
    expect(within(combobox).getByText("(empty)")).toBeInTheDocument();
    // A stored key matching no option renders raw rather than vanishing.
    expect(within(combobox).getByText("ghost")).toBeInTheDocument();

    // Pressing a chip must not open the menu underneath it.
    fireEvent.mouseDown(within(combobox).getByText("Mission Critical"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    const deleteIcons = combobox.querySelectorAll(".MuiChip-deleteIcon");
    expect(deleteIcons).toHaveLength(3);
    fireEvent.click(deleteIcons[0]);
    expect(last().attributes).toEqual({ businessCriticality: [EMPTY_VALUE, "ghost"] });
  });

  it("drops the key when the last option is removed", async () => {
    const { last } = await renderSidebar({
      initialFilters: { types: ["Application"], attributes: { regions: ["apac"] } },
    });
    expandSection("Attributes");
    const listbox = openSelect("Regions");
    fireEvent.click(within(listbox).getByRole("option", { name: /APAC/ }));
    expect(last().attributes).toEqual({});
    closeSelect();
  });

  it("filters a boolean field with Any / Yes / No", async () => {
    const { last } = await renderSidebar(single);
    expandSection("Attributes");
    let listbox = openSelect("Cloud Hosted");
    fireEvent.click(within(listbox).getByRole("option", { name: "Yes" }));
    expect(last().attributes).toEqual({ isCloud: "true" });

    listbox = openSelect("Cloud Hosted");
    fireEvent.click(within(listbox).getByRole("option", { name: "No" }));
    expect(last().attributes).toEqual({ isCloud: "false" });

    listbox = openSelect("Cloud Hosted");
    fireEvent.click(within(listbox).getByRole("option", { name: "Any" }));
    expect(last().attributes).toEqual({});
  });

  it("filters number, cost and percentage fields by minimum", async () => {
    const { last } = await renderSidebar(single);
    expandSection("Attributes");
    const score = screen.getByLabelText("Vendor Score");
    expect(score).toHaveAttribute("type", "number");
    expect(score).toHaveAttribute("placeholder", "Min value");
    fireEvent.change(score, { target: { value: "3" } });
    expect(last().attributes).toEqual({ vendorScore: "3" });

    fireEvent.change(screen.getByLabelText("Total Annual Cost"), { target: { value: "1000" } });
    expect(last().attributes).toEqual({ vendorScore: "3", costTotalAnnual: "1000" });

    fireEvent.change(screen.getByLabelText("Test Coverage"), { target: { value: "50" } });
    expect(last().attributes).toMatchObject({ coverage: "50" });

    fireEvent.change(score, { target: { value: "" } });
    expect(last().attributes).toEqual({ costTotalAnnual: "1000", coverage: "50" });
  });

  it("filters text, url, multiline and date fields by content", async () => {
    const { last } = await renderSidebar(single);
    expandSection("Attributes");
    const alias = screen.getByLabelText("Alias");
    expect(alias).toHaveAttribute("placeholder", "Contains...");
    fireEvent.change(alias, { target: { value: "erp" } });
    expect(last().attributes).toEqual({ alias: "erp" });

    fireEvent.change(screen.getByLabelText("Documentation"), { target: { value: "wiki" } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "todo" } });
    expect(last().attributes).toMatchObject({ docsUrl: "wiki", notes: "todo" });

    const date = screen.getByLabelText("Go-Live Date");
    expect(date).toHaveAttribute("type", "date");
    expect(date).toHaveAttribute("placeholder", "");
    fireEvent.change(date, { target: { value: "2024-01-01" } });
    expect(last().attributes).toMatchObject({ goLiveDate: "2024-01-01" });
  });
});

/* ========================================================================= */
/*  Filters tab — relationships                                                */
/* ========================================================================= */

describe("InventoryFilterSidebar — relationship filters", () => {
  const relProps = {
    initialFilters: { types: ["Application"] },
    allRelevantRelTypes: [REL_APP_TO_ITC, REL_APP_TO_ITC_HOSTS, REL_APP_TO_BC, REL_APP_TO_APP],
    relationsMap: RELATIONS_MAP,
  };

  it("renders no Relationships section without a relations index", async () => {
    await renderSidebar({ initialFilters: { types: ["Application"] }, allRelevantRelTypes: [REL_APP_TO_ITC] });
    expect(screen.queryByText("Relationships")).not.toBeInTheDocument();
  });

  it("labels one facet per relation type and side, adding the verb on a shared target", async () => {
    await renderSidebar(relProps);
    expandSection("Relationships");
    expect(comboboxFor("IT Component · uses")).toBeInTheDocument();
    expect(comboboxFor("IT Component · is hosted on")).toBeInTheDocument();
    expect(comboboxFor("Business Capability")).toBeInTheDocument();
    // A self-pair is two facets, each carrying its own verb.
    expect(comboboxFor("Application · sends data to")).toBeInTheDocument();
    expect(comboboxFor("Application · receives data from")).toBeInTheDocument();
  });

  it("selects related names, searches within the facet and offers (empty)", async () => {
    const { last } = await renderSidebar(relProps);
    expandSection("Relationships");

    let listbox = openSelect("IT Component · uses");
    // MUI clones every child of a Select with `role="option"`, the search
    // subheader included — the real items are the ones carrying a value.
    const names = within(listbox)
      .getAllByRole("option")
      .filter((o) => o.hasAttribute("data-value"))
      .map((o) => o.textContent);
    // Sorted, deduplicated across cards, "(empty)" first.
    expect(names).toEqual(["(empty)", "memoryPostgreSQL", "memoryUbuntu LTS"]);

    fireEvent.click(within(listbox).getByRole("option", { name: /PostgreSQL/ }));
    expect(last().relations).toEqual({ relAppToITC: ["PostgreSQL"] });
    fireEvent.click(within(listbox).getByRole("option", { name: "(empty)" }));
    expect(last().relations).toEqual({ relAppToITC: ["PostgreSQL", EMPTY_VALUE] });

    const search = within(listbox).getByPlaceholderText("Search…");
    fireEvent.keyDown(search, { key: "u" });
    expect(within(listbox).getByPlaceholderText("Search…")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "ubu" } });
    expect(within(listbox).queryByRole("option", { name: /PostgreSQL/ })).not.toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: /Ubuntu/ })).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "nothing" } });
    expect(within(listbox).getByText("No matches")).toBeInTheDocument();

    closeSelect();
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    listbox = openSelect("IT Component · uses");
    expect(within(listbox).getByPlaceholderText("Search…")).toHaveValue("");
    closeSelect();
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());

    // The incoming side of the self-pair reads its own index.
    listbox = openSelect("Application · receives data from");
    fireEvent.click(within(listbox).getByRole("option", { name: /ERP Core/ }));
    expect(last().relations).toEqual({
      relAppToITC: ["PostgreSQL", EMPTY_VALUE],
      relAppToApp__in: ["ERP Core"],
    });
    closeSelect();
  });

  it("removes a related name from its chip and drops an emptied facet", async () => {
    const { last } = await renderSidebar({
      ...relProps,
      initialFilters: {
        types: ["Application"],
        relations: { relAppToBC: ["Finance", EMPTY_VALUE] },
      },
    });
    expandSection("Relationships");
    const combobox = comboboxFor("Business Capability");
    expect(within(combobox).getByText("Finance")).toBeInTheDocument();
    expect(within(combobox).getByText("(empty)")).toBeInTheDocument();
    fireEvent.mouseDown(within(combobox).getByText("Finance"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    const icons = combobox.querySelectorAll(".MuiChip-deleteIcon");
    fireEvent.click(icons[0]);
    expect(last().relations).toEqual({ relAppToBC: [EMPTY_VALUE] });
    fireEvent.click(combobox.querySelectorAll(".MuiChip-deleteIcon")[0]);
    expect(last().relations).toEqual({});
  });

  it("falls back to the deduplicated list and skips facets with no names", async () => {
    await renderSidebar({
      initialFilters: { types: ["ITComponent"] },
      relevantRelTypes: [REL_APP_TO_ITC, REL_PROVIDER_TO_ITC],
      relationsMap: new Map([
        ["relAppToITC", new Map([[CARD_IDS.postgres, [ref(CARD_IDS.erp, "ERP Core", "Application")]]])],
      ]),
    });
    expandSection("Relationships");
    expect(comboboxFor("Application")).toBeInTheDocument();
    expect(screen.queryAllByText("Provider").find((el) => el.tagName === "LABEL")).toBeUndefined();
  });
});

/* ========================================================================= */
/*  Filters tab — tags                                                         */
/* ========================================================================= */

describe("InventoryFilterSidebar — tag filters", () => {
  it("renders one multi-select per applicable group", async () => {
    const first = await renderSidebar({ tagGroups: TAG_GROUPS });
    expandSection("Tags");
    expect(comboboxFor("Hosting")).toBeInTheDocument();
    expect(comboboxFor("Risk")).toBeInTheDocument();
    first.unmount();

    // Hosting is restricted to Application / ITComponent.
    await renderSidebar({ tagGroups: TAG_GROUPS, initialFilters: { types: ["Provider"] } });
    expandSection("Tags");
    expect(screen.queryAllByText("Hosting").find((el) => el.tagName === "LABEL")).toBeUndefined();
    expect(comboboxFor("Risk")).toBeInTheDocument();
  });

  it("renders nothing when no group has tags", async () => {
    await renderSidebar({ tagGroups: [makeTagGroup({ name: "Empty" })] });
    expect(screen.queryByText("Tags")).not.toBeInTheDocument();
  });

  it("selects tags per group, keeping the other group's selection", async () => {
    const { last } = await renderSidebar({
      tagGroups: TAG_GROUPS,
      initialFilters: { types: ["Application"], tagIds: [RISK_GROUP.tags[1].id] },
    });
    expandSection("Tags");
    let listbox = openSelect("Hosting");
    const labels = within(listbox)
      .getAllByRole("option")
      .filter((o) => o.hasAttribute("data-value"))
      .map((o) => o.textContent);
    expect(labels).toEqual(["(empty)", "On-Prem", "Cloud", "Critical"]);

    fireEvent.click(within(listbox).getByRole("option", { name: "Cloud" }));
    expect(last().tagIds).toEqual([RISK_GROUP.tags[1].id, HOSTING_GROUP.tags[1].id]);

    // The other group's id is kept; this group's selection lands in click order.
    fireEvent.click(within(listbox).getByRole("option", { name: "(empty)" }));
    expect(last().tagIds).toEqual([
      RISK_GROUP.tags[1].id,
      HOSTING_GROUP.tags[1].id,
      tagEmptyToken(HOSTING_GROUP.id),
    ]);

    const search = within(listbox).getByPlaceholderText("Search…");
    fireEvent.keyDown(search, { key: "c" });
    expect(within(listbox).getByPlaceholderText("Search…")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "crit" } });
    expect(within(listbox).getByRole("option", { name: "Critical" })).toBeInTheDocument();
    expect(within(listbox).queryByRole("option", { name: "Cloud" })).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "xyz" } });
    expect(within(listbox).getByText("No matches")).toBeInTheDocument();
    closeSelect();
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());

    listbox = openSelect("Hosting");
    expect(within(listbox).getByPlaceholderText("Search…")).toHaveValue("");
    closeSelect();
  });

  it("removes a tag from its chip and keeps the (empty) token", async () => {
    const { last } = await renderSidebar({
      tagGroups: TAG_GROUPS,
      initialFilters: {
        types: ["Application"],
        tagIds: [HOSTING_GROUP.tags[0].id, tagEmptyToken(HOSTING_GROUP.id), "stale-id"],
      },
    });
    expandSection("Tags");
    const combobox = comboboxFor("Hosting");
    expect(within(combobox).getByText("On-Prem")).toBeInTheDocument();
    expect(within(combobox).getByText("(empty)")).toBeInTheDocument();
    fireEvent.mouseDown(within(combobox).getByText("On-Prem"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    const icons = combobox.querySelectorAll(".MuiChip-deleteIcon");
    expect(icons).toHaveLength(2);
    fireEvent.click(icons[1]);
    expect(last().tagIds).toEqual(["stale-id", tagEmptyToken(HOSTING_GROUP.id)]);
  });

  it("renders tags without a colour too", async () => {
    const group = makeTagGroup({
      id: "7a660000-0000-4000-8000-000000000009",
      name: "Plain",
      tags: [makeTag({ name: "Uncoloured", tag_group_id: "7a660000-0000-4000-8000-000000000009" })],
    });
    const { last } = await renderSidebar({ tagGroups: [group] });
    expandSection("Tags");
    const listbox = openSelect("Plain");
    fireEvent.click(within(listbox).getByRole("option", { name: "Uncoloured" }));
    expect(last().tagIds).toEqual([group.tags[0].id]);
    closeSelect();
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    expect(within(comboboxFor("Plain")).getByText("Uncoloured")).toBeInTheDocument();
  });
});

/* ========================================================================= */
/*  Columns tab                                                                */
/* ========================================================================= */

describe("InventoryFilterSidebar — Columns tab", () => {
  it("asks for a type, lists core and metadata columns and the order section", async () => {
    await renderSidebar();
    openTab("Columns");
    expect(screen.getByText("Select a card type to see available columns.")).toBeInTheDocument();
    expect(screen.getByText("Column order")).toBeInTheDocument();
    expect(screen.getByText("Default columns")).toBeInTheDocument();
    expect(screen.getByText("Metadata")).toBeInTheDocument();
    expect(screen.getByText("2 columns shown")).toBeInTheDocument();
    // Subtype, EOL and link type need one selected type; Logo is on because
    // Application allows it and every type is in view.
    expect(screen.queryByText("Subtype")).not.toBeInTheDocument();
    expect(screen.queryByText("End of life")).not.toBeInTheDocument();
    expect(screen.queryByText("Link type")).not.toBeInTheDocument();
    expect(screen.getByText("Logo")).toBeInTheDocument();
    expect(screen.queryByText("Attributes")).not.toBeInTheDocument();
    expect(screen.queryByText("Relations")).not.toBeInTheDocument();
    expect(screen.queryByText("Stakeholders")).not.toBeInTheDocument();
  });

  it("toggles a column, ignores the locked ones and clears to the locked set", async () => {
    const { lastColumns } = await renderSidebar({
      selectedColumns: new Set(["core_type", "core_name", "core_reference"]),
    });
    openTab("Columns");
    expect(screen.getByText("3 columns shown")).toBeInTheDocument();

    fireEvent.click(screen.getByText("ID"));
    expect(lastColumns()).toEqual(new Set(["core_type", "core_name"]));
    fireEvent.click(screen.getByText("ID"));
    expect(lastColumns()).toEqual(new Set(["core_type", "core_name", "core_reference"]));
    fireEvent.click(screen.getByText("Created"));
    expect(lastColumns().has("meta_created_at")).toBe(true);
    fireEvent.click(screen.getByText("Created"));
    expect(lastColumns().has("meta_created_at")).toBe(false);

    const typeRow = screen.getByText("Type").closest('[role="button"]') as HTMLElement;
    expect(typeRow).toHaveAttribute("aria-disabled", "true");
    expect(typeRow.parentElement).toHaveAttribute("aria-label", "Always visible");
    fireEvent.click(screen.getByText("Type"));
    expect(lastColumns()).toEqual(new Set(["core_type", "core_name", "core_reference"]));

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(lastColumns()).toEqual(new Set(LOCKED_COLUMN_KEYS));
  });

  it("offers Reset only when the columns differ from the defaults", async () => {
    const onResetColumns = vi.fn();
    const first = await renderSidebar({
      selectedColumns: new Set(["core_type", "core_name"]),
      defaultColumns: new Set(["core_type", "core_name"]),
      onResetColumns,
    });
    openTab("Columns");
    expect(screen.queryByRole("button", { name: /Reset/ })).not.toBeInTheDocument();
    first.unmount();

    // Same size, different member.
    const second = await renderSidebar({
      selectedColumns: new Set(["core_type", "core_name", "core_path"]),
      defaultColumns: new Set(["core_type", "core_name", "core_reference"]),
      onResetColumns,
    });
    expect(screen.getByRole("tab", { name: "Columns" }).querySelector("div > div")).toBeInTheDocument();
    openTab("Columns");
    fireEvent.click(screen.getByRole("button", { name: /Reset/ }));
    expect(onResetColumns).toHaveBeenCalledTimes(1);
    second.unmount();

    // Different size, but no reset handler → no button.
    await renderSidebar({
      selectedColumns: new Set(["core_type", "core_name"]),
      defaultColumns: new Set(["core_type", "core_name", "core_reference"]),
    });
    openTab("Columns");
    expect(screen.queryByRole("button", { name: /Reset/ })).not.toBeInTheDocument();
  });

  it("selects and deselects a whole section, keeping the locked columns", async () => {
    const { lastColumns } = await renderSidebar({
      selectedColumns: new Set(["core_type", "core_name", "meta_created_at"]),
    });
    openTab("Columns");
    const metaHeader = screen.getByText("Metadata");
    const metaList = metaHeader.parentElement!.nextElementSibling as HTMLElement;
    const metaSelectAll = within(metaList).getByText("Select all");
    const metaCheckbox = metaSelectAll.closest('[role="button"]')!.querySelector("input") as HTMLInputElement;
    expect(metaCheckbox).toHaveAttribute("data-indeterminate", "true");

    fireEvent.click(metaSelectAll);
    expect(lastColumns()).toEqual(
      new Set(["core_type", "core_name", "meta_created_at", "meta_updated_at", "meta_created_by", "meta_updated_by"]),
    );
    fireEvent.click(metaSelectAll);
    expect(lastColumns()).toEqual(new Set(["core_type", "core_name"]));

    const coreList = screen.getByText("Default columns").parentElement!.nextElementSibling as HTMLElement;
    fireEvent.click(within(coreList).getByText("Select all"));
    expect(lastColumns().has("core_reference")).toBe(true);
    expect(lastColumns().has("core_logo")).toBe(true);
    fireEvent.click(within(coreList).getByText("Select all"));
    expect(lastColumns()).toEqual(new Set(["core_type", "core_name"]));
  });

  it("collapses a section from its header", async () => {
    await renderSidebar();
    openTab("Columns");
    expect(screen.getByText("Created")).toBeVisible();
    fireEvent.click(screen.getByText("Metadata"));
    await waitFor(() => expect(screen.getByText("Created")).not.toBeVisible());
  });

  it("lists every field of a single type, relations and stakeholder roles", async () => {
    const { lastColumns } = await renderSidebar({
      initialFilters: { types: ["Application"] },
      relevantRelTypes: [REL_APP_TO_ITC, REL_APP_TO_BC],
      stakeholderRoles: [{ key: "applicationOwner", label: "Application Owner" }],
    });
    openTab("Columns");
    expect(screen.queryByText("Select a card type to see available columns.")).not.toBeInTheDocument();
    expect(screen.getByText("Subtype")).toBeInTheDocument();
    expect(screen.getByText("End of life")).toBeInTheDocument();
    expect(screen.getByText("Logo")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Business Criticality"));
    expect(lastColumns().has("attr_businessCriticality")).toBe(true);
    fireEvent.click(screen.getByText("IT Component"));
    expect(lastColumns().has("rel_ITComponent")).toBe(true);
    fireEvent.click(screen.getByText("Application Owner"));
    expect(lastColumns().has("stakeholder_applicationOwner")).toBe(true);

    const attrList = screen.getByText("Attributes").parentElement!.nextElementSibling as HTMLElement;
    fireEvent.click(within(attrList).getByText("Select all"));
    expect(lastColumns().has("attr_alias")).toBe(true);
    expect(lastColumns().has("attr_notes")).toBe(true);

    const relList = screen.getByText("Relations").parentElement!.nextElementSibling as HTMLElement;
    fireEvent.click(within(relList).getByText("Select all"));
    expect(lastColumns().has("rel_BusinessCapability")).toBe(true);

    // The role is already on, so the section reads fully checked and the
    // first Select all turns it off; the second turns it back on.
    const stList = screen.getByText("Stakeholders").parentElement!.nextElementSibling as HTMLElement;
    fireEvent.click(within(stList).getByText("Select all"));
    expect(lastColumns().has("stakeholder_applicationOwner")).toBe(false);
    fireEvent.click(within(stList).getByText("Select all"));
    expect(lastColumns().has("stakeholder_applicationOwner")).toBe(true);

    // Every section collapses from its header; the chevron says which way it is.
    for (const label of ["Default columns", "Attributes", "Relations", "Stakeholders"]) {
      const header = screen.getByText(label).parentElement as HTMLElement;
      expect(header.firstElementChild).toHaveTextContent("expand_more");
      fireEvent.click(screen.getByText(label));
      expect(header.firstElementChild).toHaveTextContent("chevron_right");
    }
  });

  it("names an incoming relation after its source type and an unknown type after its key", async () => {
    const ghost = makeRelationType({
      key: "relGhostToITC",
      label: "haunts",
      source_type_key: "Ghost",
      target_type_key: "ITComponent",
    });
    const { lastColumns } = await renderSidebar({
      initialFilters: { types: ["ITComponent"] },
      relevantRelTypes: [REL_PROVIDER_TO_ITC, ghost],
    });
    openTab("Columns");
    fireEvent.click(screen.getByText("Provider"));
    expect(lastColumns().has("rel_Provider")).toBe(true);
    fireEvent.click(screen.getByText("Ghost"));
    expect(lastColumns().has("rel_Ghost")).toBe(true);
  });

  it("offers only the common fields of several types", async () => {
    await renderSidebar({
      types: [...CARD_TYPES, SERVICE_TYPE],
      initialFilters: { types: ["Application", "Service"] },
    });
    openTab("Columns");
    const attrList = screen.getByText("Attributes").parentElement!.nextElementSibling as HTMLElement;
    expect(within(attrList).getByText("Alias")).toBeInTheDocument();
    expect(within(attrList).queryByText("Owner")).not.toBeInTheDocument();
    expect(within(attrList).queryByText("Business Criticality")).not.toBeInTheDocument();
    // Subtype is per type and Logo needs a logo-bearing type in view.
    expect(screen.queryByText("Subtype")).not.toBeInTheDocument();
    expect(screen.getByText("Logo")).toBeInTheDocument();
  });

  it("offers the link-type column for a hierarchical type with a vocabulary and no logo for one without", async () => {
    await renderSidebar({ types: [...CARD_TYPES, SITE_TYPE], initialFilters: { types: ["Site"] } });
    openTab("Columns");
    expect(screen.getByText("Link type")).toBeInTheDocument();
    expect(screen.queryByText("Logo")).not.toBeInTheDocument();
    expect(screen.queryByText("End of life")).not.toBeInTheDocument();
  });

  it("searches every section by label and clears the query", async () => {
    await renderSidebar({
      initialFilters: { types: ["Application"] },
      relevantRelTypes: [REL_APP_TO_ITC, REL_APP_TO_BC],
      stakeholderRoles: [{ key: "applicationOwner", label: "Application Owner" }],
    });
    openTab("Columns");
    const search = screen.getByPlaceholderText("Search columns...");

    fireEvent.change(search, { target: { value: "created" } });
    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.getByText("Created by")).toBeInTheDocument();
    expect(screen.queryByText("Modified")).not.toBeInTheDocument();
    expect(screen.queryByText("Default columns")).not.toBeInTheDocument();
    expect(screen.queryByText("Attributes")).not.toBeInTheDocument();
    expect(screen.queryByText("Relations")).not.toBeInTheDocument();
    expect(screen.queryByText("Stakeholders")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "name" } });
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.queryByText("Metadata")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "criticality" } });
    expect(screen.getByText("Business Criticality")).toBeInTheDocument();
    expect(screen.queryByText("Alias")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "capab" } });
    expect(screen.getByText("Business Capability")).toBeInTheDocument();
    expect(screen.queryByText("IT Component")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "owner" } });
    expect(screen.getByText("Application Owner")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(search).toHaveValue("");
    expect(screen.getByText("Metadata")).toBeInTheDocument();
  });

  it("searches relation columns by the other end's label, falling back to its key", async () => {
    const ghost = makeRelationType({
      key: "relGhostToITC",
      label: "haunts",
      source_type_key: "Ghost",
      target_type_key: "ITComponent",
    });
    await renderSidebar({
      initialFilters: { types: ["ITComponent"] },
      relevantRelTypes: [REL_PROVIDER_TO_ITC, ghost],
    });
    openTab("Columns");
    fireEvent.change(screen.getByPlaceholderText("Search columns..."), { target: { value: "gho" } });
    expect(screen.getByText("Ghost")).toBeInTheDocument();
    expect(screen.queryByText("Provider")).not.toBeInTheDocument();
  });

  it("puts a freeze pin on every row, reporting the frozen state", async () => {
    const onToggleFrozen = vi.fn();
    await renderSidebar({ frozenColumns: new Set(["core_type"]), onToggleFrozen });
    openTab("Columns");
    const pins = screen.getAllByRole("button", { name: /freeze column/i });
    // Core rows (Type, Name, Logo, ID, Alias, Parent, Path, Description,
    // Lifecycle, Approval, Quality, Tags) plus the four metadata rows.
    expect(pins).toHaveLength(16);
    expect(pins[0]).toHaveAttribute("aria-label", "Unfreeze column");
    expect(pins[0]).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(pins[0]);
    expect(onToggleFrozen).toHaveBeenCalledWith("core_type");
    fireEvent.click(pins[pins.length - 1]);
    expect(onToggleFrozen).toHaveBeenCalledWith("meta_updated_by");
  });
});

/* ========================================================================= */
/*  Views tab                                                                  */
/* ========================================================================= */

describe("InventoryFilterSidebar — Views tab", () => {
  it("shows the empty state and opens the save dialog from Save current", async () => {
    await renderSidebar();
    openTab("Views");
    expect(screen.getByText(/No saved views yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Save current/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Save Current View")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("post")).toHaveLength(0);
  });

  it("files views under My views, Shared with me and Public with their captions", async () => {
    mockApi.on("get", "/bookmarks", [
      MY_VIEW,
      MY_MULTI,
      MY_ALL,
      SHARED_EDITABLE,
      SHARED_READONLY,
      PUBLIC_VIEW,
    ]);
    await renderSidebar();
    openTab("Views");
    expect(screen.getByText("My Views")).toBeInTheDocument();
    expect(screen.getByText("Shared with me")).toBeInTheDocument();
    expect(screen.getByText("Public")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: /My App View/ })).toHaveTextContent("Application");
    expect(screen.getByRole("button", { name: /Two Types/ })).toHaveTextContent("2 types");
    expect(screen.getByRole("button", { name: /Everything/ })).toHaveTextContent("All types");
    expect(screen.getByRole("button", { name: /Team View/ })).toHaveTextContent("by Test Member");
    expect(screen.getByRole("button", { name: /Locked View/ })).toHaveTextContent("by Unknown");

    // Owners get edit + delete; an editable share gets edit only; a public
    // view and a read-only share get neither.
    const mine = screen.getByRole("button", { name: /My App View/ });
    expect(within(mine).getByRole("button", { name: "edit" })).toBeInTheDocument();
    expect(within(mine).getByRole("button", { name: "delete" })).toBeInTheDocument();
    const team = screen.getByRole("button", { name: /Team View/ });
    expect(within(team).getByRole("button", { name: "edit" })).toBeInTheDocument();
    expect(within(team).queryByRole("button", { name: "delete" })).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("button", { name: /Locked View/ })).queryByRole("button"),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("button", { name: /Everyone/ })).queryByRole("button"),
    ).not.toBeInTheDocument();
  });

  it("applies a view: filters, grouping, columns, layout and column filters", async () => {
    mockApi.on("get", "/bookmarks", [MY_VIEW, SHARED_EDITABLE, MY_ALL]);
    const onGroupByChange = vi.fn();
    const onApplyColumnState = vi.fn();
    const onApplyColumnFilters = vi.fn();
    const { changes, last, lastColumns } = await renderSidebar({
      onGroupByChange,
      onApplyColumnState,
      onApplyColumnFilters,
    });
    openTab("Views");

    const mine = screen.getByRole("button", { name: /My App View/ });
    fireEvent.click(mine);
    expect(last()).toEqual({ ...EMPTY_FILTERS, types: ["Application"], search: "erp" });
    expect(onGroupByChange).toHaveBeenLastCalledWith(null);
    expect(lastColumns()).toEqual(new Set(["core_type", "core_name", "attr_alias"]));
    expect(onApplyColumnState).toHaveBeenLastCalledWith([{ colId: "core_name", width: 240 }]);
    expect(onApplyColumnFilters).toHaveBeenLastCalledWith({ core_name: { filter: "erp" } });
    expect(mine).toHaveClass("Mui-selected");
    expect(sidebarPrefs().activeViewId).toBe("bm-1");

    // A legacy `dataQualityMin` threshold maps to bands; the view's grouping
    // is restored; no columns means the current set is kept.
    fireEvent.click(screen.getByRole("button", { name: /Team View/ }));
    expect(last()).toMatchObject({
      types: ["Application", "ITComponent"],
      dataQualityBands: ["complete", "partial"],
    });
    expect(onGroupByChange).toHaveBeenLastCalledWith("subtype");
    expect(onApplyColumnState).toHaveBeenLastCalledWith(null);
    expect(onApplyColumnFilters).toHaveBeenLastCalledWith(null);
    expect(lastColumns()).toEqual(new Set(["core_type", "core_name", "attr_alias"]));
    expect(mine).not.toHaveClass("Mui-selected");

    // A view with no filters payload leaves the filters alone.
    const before = changes.length;
    fireEvent.click(screen.getByRole("button", { name: /Everything/ }));
    expect(changes).toHaveLength(before);
    expect(onGroupByChange).toHaveBeenLastCalledWith(null);
  });

  it("restores the persisted active view as selected", async () => {
    localStorage.setItem(LS_KEY, JSON.stringify({ tab: 2, activeViewId: "bm-1" }));
    mockApi.on("get", "/bookmarks", [MY_VIEW, MY_ALL]);
    await renderSidebar();
    expect(screen.getByRole("button", { name: /My App View/ })).toHaveClass("Mui-selected");
    expect(screen.getByRole("button", { name: /Everything/ })).not.toHaveClass("Mui-selected");
  });

  it("deletes a view, reloads the list and clears it as the active view", async () => {
    localStorage.setItem(LS_KEY, JSON.stringify({ tab: 2, activeViewId: "bm-1" }));
    mockApi.on("get", "/bookmarks", [MY_VIEW]);
    mockApi.on("delete", "/bookmarks/bm-1", null);
    const onGroupByChange = vi.fn();
    await renderSidebar({ onGroupByChange });
    const row = screen.getByRole("button", { name: /My App View/ });
    mockApi.on("get", "/bookmarks", []);
    fireEvent.click(within(row).getByRole("button", { name: "delete" }));
    await waitFor(() => expect(screen.getByText(/No saved views yet/)).toBeInTheDocument());
    expect(mockApi.callsOf("delete").map((c) => c.path)).toEqual(["/bookmarks/bm-1"]);
    expect(mockApi.callsOf("get", "/bookmarks")).toHaveLength(2);
    // Written by a passive effect, which can run after the list has rendered
    // (it did under Stryker's load): wait for it rather than read it once.
    await waitFor(() => expect(sidebarPrefs().activeViewId).toBeNull());
    // The row's action buttons never apply the view.
    expect(onGroupByChange).not.toHaveBeenCalled();
  });

  it("deleting another view keeps the active one", async () => {
    localStorage.setItem(LS_KEY, JSON.stringify({ tab: 2, activeViewId: "bm-6" }));
    mockApi.on("get", "/bookmarks", [MY_VIEW, MY_ALL]);
    mockApi.on("delete", "/bookmarks/bm-1", null);
    await renderSidebar();
    const row = screen.getByRole("button", { name: /My App View/ });
    fireEvent.click(within(row).getByRole("button", { name: "delete" }));
    await waitFor(() => expect(mockApi.callsOf("get", "/bookmarks")).toHaveLength(2));
    expect(sidebarPrefs().activeViewId).toBe("bm-6");
  });
});

/* ========================================================================= */
/*  Save / edit dialog                                                         */
/* ========================================================================= */

describe("InventoryFilterSidebar — save dialog", () => {
  it("saves the current state as a new view and reloads", async () => {
    mockApi.on("post", "/bookmarks", { id: "bm-new" });
    const { changes } = await renderSidebar({
      initialFilters: { types: ["Application"], search: "erp", tagIds: ["t1"], mineScope: "stakeholder" },
      selectedColumns: new Set(["core_type", "core_name", "attr_alias"]),
      columnState: [{ colId: "core_name", width: 300 }],
      columnFilterModel: { core_name: { filter: "x" } },
      groupBy: "lifecycle",
    });
    fireEvent.click(screen.getByRole("button", { name: /Save view/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("This will save your current 4 active filters.")).toBeInTheDocument();
    // No share / OData permission → neither control.
    expect(within(dialog).queryByText("Visibility")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Enable OData feed")).not.toBeInTheDocument();

    const save = within(dialog).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    const name = within(dialog).getByLabelText("View name");
    fireEvent.change(name, { target: { value: "   " } });
    expect(save).toBeDisabled();
    fireEvent.keyDown(name, { key: "Enter" });
    expect(mockApi.callsOf("post")).toHaveLength(0);

    fireEvent.change(name, { target: { value: "  Apps  " } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const [call] = mockApi.callsOf("post", "/bookmarks");
    expect(call.body).toEqual({
      name: "Apps",
      card_type: "Application",
      filters: {
        types: ["Application"],
        search: "erp",
        subtypes: [],
        lifecyclePhases: [],
        dataQualityBands: [],
        approvalStatuses: [],
        showArchived: false,
        orphanedOnly: false,
        staleOnly: false,
        eolStatuses: [],
        linkTypes: [],
        attributes: {},
        relations: {},
        tagIds: ["t1"],
        mineScope: "stakeholder",
        groupBy: "lifecycle",
      },
      columns: ["core_type", "core_name", "attr_alias"],
      column_state: [{ colId: "core_name", width: 300 }],
      column_filter_model: { core_name: { filter: "x" } },
      visibility: "private",
      odata_enabled: false,
      shared_with: null,
    });
    expect(mockApi.callsOf("get", "/bookmarks")).toHaveLength(2);
    // Saving never touches the live filters.
    expect(changes).toHaveLength(0);
  });

  it("saves on Enter, with no card type for a multi-type view and nulls for absent layout", async () => {
    mockApi.on("post", "/bookmarks", { id: "bm-new" });
    await renderSidebar({ initialFilters: { types: ["Application", "ITComponent"] } });
    fireEvent.click(screen.getByRole("button", { name: /Save view/ }));
    const name = within(screen.getByRole("dialog")).getByLabelText("View name");
    fireEvent.change(name, { target: { value: "Both" } });
    fireEvent.keyDown(name, { key: "Enter" });
    await waitFor(() => expect(mockApi.callsOf("post")).toHaveLength(1));
    const body = mockApi.callsOf("post")[0].body as Record<string, unknown>;
    expect(body.card_type).toBeUndefined();
    expect(body.column_state).toBeNull();
    expect(body.column_filter_model).toBeNull();
    expect((body.filters as Record<string, unknown>).groupBy).toBeNull();
  });

  it("closes on Escape without saving", async () => {
    await renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /Save view/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("View name"), { target: { value: "Draft" } });
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("post")).toHaveLength(0);
  });

  it("treats an empty column-filter model as none", async () => {
    mockApi.on("post", "/bookmarks", { id: "bm-new" });
    await renderSidebar({ columnFilterModel: {} });
    fireEvent.click(screen.getByRole("button", { name: /Save view/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByText(/active filter/)).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("View name"), { target: { value: "Plain" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockApi.callsOf("post")).toHaveLength(1));
    expect((mockApi.callsOf("post")[0].body as Record<string, unknown>).column_filter_model).toBeNull();
  });

  it("shares a view with chosen users and their edit rights", async () => {
    mockApi.on("post", "/bookmarks", { id: "bm-new" });
    await renderSidebar({ canShareBookmarks: true, currentUserId: ADMIN_USER.id });
    fireEvent.click(screen.getByRole("button", { name: /Save view/ }));
    const dialog = screen.getByRole("dialog");

    // Private by default: no user picker, no users fetched.
    expect(within(dialog).queryByLabelText("Share with")).not.toBeInTheDocument();
    expect(mockApi.callsOf("get", "/users")).toHaveLength(0);

    fireEvent.mouseDown(within(dialog).getByRole("combobox", { name: /Visibility/ }));
    fireEvent.click(screen.getByRole("option", { name: /Public/ }));
    expect(within(dialog).queryByLabelText("Share with")).not.toBeInTheDocument();

    fireEvent.mouseDown(within(dialog).getByRole("combobox", { name: /Visibility/ }));
    fireEvent.click(screen.getByRole("option", { name: /Shared/ }));
    await waitFor(() => expect(mockApi.callsOf("get", "/users")).toHaveLength(1));

    const picker = within(dialog).getByLabelText("Share with");
    fireEvent.change(picker, { target: { value: "Test" } });
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    // The signed-in user and the deactivated account are never offered.
    expect(options).toEqual(["Test Member (member@test.local)", "Test Viewer (viewer@test.local)"]);
    fireEvent.click(screen.getByRole("option", { name: "Test Member (member@test.local)" }));
    expect(within(dialog).getByText("Test Member")).toBeInTheDocument();
    // Reopening marks the picked user as selected by id.
    fireEvent.change(picker, { target: { value: "Test" } });
    expect(screen.getByRole("option", { name: "Test Member (member@test.local)" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("option", { name: "Test Viewer (viewer@test.local)" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    fireEvent.keyDown(picker, { key: "Escape" });

    expect(within(dialog).getByText("Permissions (shared users can view by default)")).toBeInTheDocument();
    const canEdit = within(dialog).getByRole("checkbox", { name: "Test Member — can edit" });
    expect(canEdit).not.toBeChecked();
    fireEvent.click(canEdit);
    expect(canEdit).toBeChecked();

    fireEvent.change(within(dialog).getByLabelText("View name"), { target: { value: "Team" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockApi.callsOf("post")).toHaveLength(1));
    expect(mockApi.callsOf("post")[0].body).toMatchObject({
      visibility: "shared",
      shared_with: [{ user_id: MEMBER_USER.id, can_edit: true }],
    });
  });

  it("offers the OData switch to a user who may publish feeds", async () => {
    mockApi.on("post", "/bookmarks", { id: "bm-new" });
    await renderSidebar({ canOdataBookmarks: true });
    fireEvent.click(screen.getByRole("button", { name: /Save view/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(switchFor("Enable OData feed", dialog));
    // No URL exists before the view is saved.
    expect(within(dialog).queryByText(/OData Feed URL/)).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("View name"), { target: { value: "Feed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockApi.callsOf("post")).toHaveLength(1));
    expect(mockApi.callsOf("post")[0].body).toMatchObject({ odata_enabled: true });
  });

  it("edits an owned view pre-filled, including shared users and the OData URL", async () => {
    restoreClipboard = installClipboard();
    const clipboard = navigator.clipboard as unknown as { writeText: ReturnType<typeof vi.fn> };
    mockApi.on("get", "/bookmarks", [MY_SHARED]);
    mockApi.on("patch", "/bookmarks/bm-7", { ...MY_SHARED, name: "Renamed" });
    await renderSidebar({
      canShareBookmarks: true,
      canOdataBookmarks: true,
      currentUserId: ADMIN_USER.id,
    });
    openTab("Views");
    const row = screen.getByRole("button", { name: /Shared by me/ });
    fireEvent.click(within(row).getByRole("button", { name: "edit" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Edit View")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("View name")).toHaveValue("Shared by me");
    expect(within(dialog).queryByText(/active filter/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: /Visibility/ })).toHaveTextContent("Shared");
    // The share list came back pre-populated, one row per user, with their rights.
    expect(within(dialog).getByRole("checkbox", { name: "Test Member — can edit" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "— can edit" })).not.toBeChecked();
    await waitFor(() => expect(mockApi.callsOf("get", "/users")).toHaveLength(1));

    expect(switchFor("Enable OData feed", dialog)).toBeChecked();
    expect(within(dialog).getByText("https://ea.example/odata/bm-7")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy URL" }));
    expect(clipboard.writeText).toHaveBeenCalledWith("https://ea.example/odata/bm-7");

    // Turning the feed off hides the URL block again.
    fireEvent.click(switchFor("Enable OData feed", dialog));
    expect(within(dialog).queryByText(/OData Feed URL/)).not.toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("View name"), { target: { value: "Renamed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Update" }));
    await waitFor(() => expect(mockApi.callsOf("patch")).toHaveLength(1));
    expect(mockApi.callsOf("patch")[0].path).toBe("/bookmarks/bm-7");
    expect(mockApi.callsOf("patch")[0].body).toMatchObject({
      name: "Renamed",
      visibility: "shared",
      odata_enabled: false,
      shared_with: [
        { user_id: MEMBER_USER.id, can_edit: true },
        { user_id: VIEWER_USER.id, can_edit: false },
      ],
    });
    expect(mockApi.callsOf("post")).toHaveLength(0);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("get", "/bookmarks")).toHaveLength(2);
  });

  it("locks visibility, sharing and OData when editing a view someone else owns", async () => {
    mockApi.on("get", "/bookmarks", [SHARED_EDITABLE]);
    await renderSidebar({ canShareBookmarks: true, canOdataBookmarks: true });
    openTab("Views");
    const row = screen.getByRole("button", { name: /Team View/ });
    fireEvent.click(within(row).getByRole("button", { name: "edit" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: /Visibility/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(within(dialog).getByLabelText("Share with")).toBeDisabled();
    expect(switchFor("Enable OData feed", dialog)).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Update" })).toBeEnabled();
  });

  it("falls back to private for a view stored without a visibility", async () => {
    const legacy = { ...MY_ALL, visibility: undefined } as unknown as Bookmark;
    mockApi.on("get", "/bookmarks", [legacy]);
    await renderSidebar({ canShareBookmarks: true });
    openTab("Views");
    const row = screen.getByRole("button", { name: /Everything/ });
    fireEvent.click(within(row).getByRole("button", { name: "edit" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: /Visibility/ })).toHaveTextContent("Private");
  });
});

/* ========================================================================= */
/*  Resize handle                                                              */
/* ========================================================================= */

describe("InventoryFilterSidebar — resize", () => {
  it("reports the dragged width clamped to its bounds and stops on mouse up", async () => {
    const onWidthChange = vi.fn();
    const { container } = await renderSidebar({ width: 280, onWidthChange });
    const handle = container.firstElementChild!.lastElementChild as HTMLElement;

    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 150 });
    expect(onWidthChange).toHaveBeenLastCalledWith(330);
    fireEvent.mouseMove(document, { clientX: -1000 });
    expect(onWidthChange).toHaveBeenLastCalledWith(220);
    fireEvent.mouseMove(document, { clientX: 1000 });
    expect(onWidthChange).toHaveBeenLastCalledWith(500);

    fireEvent.mouseUp(document);
    const calls = onWidthChange.mock.calls.length;
    fireEvent.mouseMove(document, { clientX: 120 });
    expect(onWidthChange.mock.calls).toHaveLength(calls);
  });
});
