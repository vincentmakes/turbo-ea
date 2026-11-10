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
  APPROVAL_STATUS_OPTIONS,
  EMPTY_VALUE,
  LIFECYCLE_PHASES,
  LOCKED_COLUMN_KEYS,
  tagEmptyToken,
  treeGroupingApplies,
  type Filters,
} from "./InventoryFilterSidebar";
import { mockApi } from "@/test/apiMock";
import i18n from "@/i18n";
import { invalidateCardTypeCategories } from "@/hooks/useCardTypeCategories";
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
import { emptyFilters } from "./viewApply";
import { relationColumnSides } from "./relationColumns";
import { createTheme } from "@mui/material/styles";
import { DATA_QUALITY_BANDS } from "@/lib/dataQualityBands";
import { EOL_STATUS_COLORS } from "@/lib/eol";

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
  origins: [],
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
        origins: ["mcp", "api"],
      },
    });
    // 1+1+1+1+1+1+1+1+1+2+1+1+1+1+1+2
    expect(screen.getByText("18")).toBeInTheDocument();
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
      initialFilters: { types: ["Application"], search: "erp", orphanedOnly: true, origins: ["mcp"] },
    });
    fireEvent.click(screen.getByRole("button", { name: /Clear all \(4\)/ }));
    expect(last()).toEqual(EMPTY_FILTERS);
    // One definition of "no filters", shared with the page's new query view.
    expect(last()).toEqual(emptyFilters());
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

  it("names and orders the layer headers from the category registry", async () => {
    invalidateCardTypeCategories([
      {
        id: "1",
        key: "Application & Data",
        label: "Application & Data",
        color: "#0f7eb5",
        sort_order: 0,
        built_in: true,
        translations: { fr: "Application et données" },
      },
      {
        id: "2",
        key: "Business Architecture",
        label: "Business Architecture",
        color: "#2889ff",
        sort_order: 1,
        built_in: true,
        translations: { fr: "Architecture métier" },
      },
    ]);
    await act(async () => {
      await i18n.changeLanguage("fr");
    });
    try {
      await renderSidebar({ types: [SITE_TYPE, SERVICE_TYPE] });
      const app = screen.getByText("Application et données");
      const business = screen.getByText("Architecture métier");
      // The registry puts Application & Data first, whatever the seed order.
      expect(app.compareDocumentPosition(business) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.queryByText("Business Architecture")).not.toBeInTheDocument();
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
      invalidateCardTypeCategories([]);
    }
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

  it("toggles origins as coloured chips, web included", async () => {
    const { last } = await renderSidebar();
    expandSection("Origin");
    const options = Array.from(document.querySelectorAll("[data-origin-option]")).map((el) =>
      el.getAttribute("data-origin-option"),
    );
    expect(options).toEqual(["web", "mcp", "api", "ext", "system"]);
    expect(chip(/MCP$/)).toHaveClass("MuiChip-outlined");

    fireEvent.click(chip(/MCP$/));
    expect(last().origins).toEqual(["mcp"]);
    expect(chip(/MCP$/)).toHaveClass("MuiChip-filled");
    fireEvent.click(chip(/Web UI$/));
    expect(last().origins).toEqual(["mcp", "web"]);
    fireEvent.click(chip(/MCP$/));
    expect(last().origins).toEqual(["web"]);
    expect(chip(/MCP$/)).toHaveClass("MuiChip-outlined");
  });

  it("starts the Origin facet from no selection on filters saved before it", async () => {
    const { last } = await renderSidebar({ initialFilters: { origins: undefined } });
    expandSection("Origin");
    fireEvent.click(chip(/Extension$/));
    expect(last().origins).toEqual(["ext"]);
  });

  it("starts the Origin section collapsed and counts its picks on the header", async () => {
    await renderSidebar({ initialFilters: { origins: ["mcp", "api"] } });
    const header = () => screen.getByText("Origin").parentElement!;
    expect(header()).toHaveTextContent("chevron_right");
    expect(within(header()).getByText("2")).toBeInTheDocument();
    expandSection("Origin");
    expect(header()).toHaveTextContent("expand_more");
  });

  it("counts origins in Clear all, also on filters saved before link types", async () => {
    await renderSidebar({ initialFilters: { linkTypes: undefined, origins: ["mcp", "api"] } });
    expect(screen.getByText("Clear all (2)")).toBeInTheDocument();
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
    expect(within(listbox).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Any",
      "Yes",
      "No",
      "(empty)",
    ]);
    fireEvent.click(within(listbox).getByRole("option", { name: "(empty)" }));
    expect(last().attributes).toEqual({ isCloud: EMPTY_VALUE });

    listbox = openSelect("Cloud Hosted");
    fireEvent.click(within(listbox).getByRole("option", { name: "Any" }));
    expect(last().attributes).toEqual({});
  });

  it("shows a report's Not-set deep link on a boolean field as (empty)", async () => {
    await renderSidebar({
      initialFilters: { types: ["Application"], attributes: { isCloud: EMPTY_VALUE } },
    });
    expandSection("Attributes");
    expect(comboboxFor("Cloud Hosted")).toHaveTextContent("(empty)");
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

  it("skips facets with no names", async () => {
    await renderSidebar({
      initialFilters: { types: ["ITComponent"] },
      allRelevantRelTypes: [REL_APP_TO_ITC, REL_PROVIDER_TO_ITC],
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
      new Set([
        "core_type",
        "core_name",
        "meta_created_at",
        "meta_updated_at",
        "meta_created_by",
        "meta_updated_by",
        "meta_created_via",
        "meta_updated_via",
      ]),
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
      relationSides: relationColumnSides([REL_APP_TO_ITC, REL_APP_TO_BC], "Application"),
      stakeholderRoles: [{ key: "applicationOwner", label: "Application Owner" }],
    });
    openTab("Columns");
    expect(screen.queryByText("Select a card type to see available columns.")).not.toBeInTheDocument();
    expect(screen.getByText("Subtype")).toBeInTheDocument();
    expect(screen.getByText("End of life")).toBeInTheDocument();
    expect(screen.getByText("Logo")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Business Criticality"));
    expect(lastColumns().has("attr_businessCriticality")).toBe(true);
    // A relation row reads "<verb> <Card type>", as the grid heads the column.
    fireEvent.click(screen.getByText("uses IT Component"));
    expect(lastColumns().has("rel_relAppToITC__out")).toBe(true);
    expect(lastColumns().has("rel_relAppToBC__out")).toBe(false);
    fireEvent.click(screen.getByText("Application Owner"));
    expect(lastColumns().has("stakeholder_applicationOwner")).toBe(true);

    const attrList = screen.getByText("Attributes").parentElement!.nextElementSibling as HTMLElement;
    fireEvent.click(within(attrList).getByText("Select all"));
    expect(lastColumns().has("attr_alias")).toBe(true);
    expect(lastColumns().has("attr_notes")).toBe(true);

    const relList = screen.getByText("Relations").parentElement!.nextElementSibling as HTMLElement;
    fireEvent.click(within(relList).getByText("Select all"));
    expect(lastColumns().has("rel_relAppToBC__out")).toBe(true);

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
      relationSides: relationColumnSides([REL_PROVIDER_TO_ITC, ghost], "ITComponent"),
    });
    openTab("Columns");
    // The selected type is the target: the reverse verb.
    fireEvent.click(screen.getByText("is provided by Provider"));
    expect(lastColumns().has("rel_relProviderToITC__in")).toBe(true);
    fireEvent.click(screen.getByText("is related to by Ghost"));
    expect(lastColumns().has("rel_relGhostToITC__in")).toBe(true);
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
      relationSides: relationColumnSides([REL_APP_TO_ITC, REL_APP_TO_BC], "Application"),
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
    expect(screen.getByText("supports Business Capability")).toBeInTheDocument();
    expect(screen.queryByText("uses IT Component")).not.toBeInTheDocument();

    // The verb is part of the label, so it is searchable too.
    fireEvent.change(search, { target: { value: "uses" } });
    expect(screen.getByText("uses IT Component")).toBeInTheDocument();
    expect(screen.queryByText("supports Business Capability")).not.toBeInTheDocument();

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
      relationSides: relationColumnSides([REL_PROVIDER_TO_ITC, ghost], "ITComponent"),
    });
    openTab("Columns");
    fireEvent.change(screen.getByPlaceholderText("Search columns..."), { target: { value: "gho" } });
    expect(screen.getByText("is related to by Ghost")).toBeInTheDocument();
    expect(screen.queryByText("is provided by Provider")).not.toBeInTheDocument();
  });

  it("lists one row per relation type on a shared pair, and both sides of a self-referencing type", async () => {
    const { lastColumns } = await renderSidebar({
      initialFilters: { types: ["Application"] },
      relationSides: relationColumnSides(
        [REL_APP_TO_ITC, REL_APP_TO_BC, REL_APP_TO_ITC_HOSTS, REL_APP_TO_APP],
        "Application",
      ),
    });
    openTab("Columns");
    const relList = screen.getByText("Relations").parentElement!.nextElementSibling as HTMLElement;
    const rows = within(relList)
      .getAllByRole("button")
      .map((b) => b.textContent)
      .filter((text) => text && !text.includes("Select all") && !/push_pin/.test(text));
    // Same-target rows sit together; the self-pair is an outgoing and an incoming row.
    expect(rows).toEqual([
      expect.stringContaining("uses IT Component"),
      expect.stringContaining("is hosted on IT Component"),
      expect.stringContaining("supports Business Capability"),
      expect.stringContaining("sends data to Application"),
      expect.stringContaining("receives data from Application"),
    ]);
    fireEvent.click(screen.getByText("is hosted on IT Component"));
    expect(lastColumns().has("rel_relAppToITCHosts__out")).toBe(true);
    expect(lastColumns().has("rel_relAppToITC__out")).toBe(false);
    fireEvent.click(screen.getByText("receives data from Application"));
    expect(lastColumns().has("rel_relAppToApp__in")).toBe(true);
    expect(lastColumns().has("rel_relAppToApp__out")).toBe(false);
    // Each row carries its own freeze pin, keyed on its own column id.
    expect(within(relList).getAllByRole("button", { name: /freeze column/i })).toHaveLength(5);
  });

  it("puts a freeze pin on every row, reporting the frozen state", async () => {
    const onToggleFrozen = vi.fn();
    await renderSidebar({ frozenColumns: new Set(["core_type"]), onToggleFrozen });
    openTab("Columns");
    const pins = screen.getAllByRole("button", { name: /freeze column/i });
    // Core rows (Type, Name, Logo, ID, Alias, Parent, Path, Description,
    // Lifecycle, Approval, Quality, Tags) plus the six metadata rows.
    expect(pins).toHaveLength(18);
    expect(pins[0]).toHaveAttribute("aria-label", "Unfreeze column");
    expect(pins[0]).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(pins[0]);
    expect(onToggleFrozen).toHaveBeenCalledWith("core_type");
    fireEvent.click(pins[pins.length - 1]);
    expect(onToggleFrozen).toHaveBeenCalledWith("meta_updated_via");
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

  it("applies a view's origins, and none for a view saved before the facet", async () => {
    const agentView = makeBookmark({
      id: "bm-9",
      name: "Agent made",
      filters: { types: ["Application"], origins: ["mcp", "api"] },
    });
    mockApi.on("get", "/bookmarks", [agentView, MY_VIEW]);
    const { last } = await renderSidebar();
    openTab("Views");
    fireEvent.click(screen.getByRole("button", { name: /Agent made/ }));
    expect(last().origins).toEqual(["mcp", "api"]);
    fireEvent.click(screen.getByRole("button", { name: /My App View/ }));
    expect(last().origins).toEqual([]);
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
  it("saves no origins for filters made before the Origin facet", async () => {
    mockApi.on("post", "/bookmarks", { id: "bm-new" });
    await renderSidebar({ initialFilters: { types: ["Application"], origins: undefined } });
    fireEvent.click(screen.getByRole("button", { name: /Save view/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("View name"), { target: { value: "Apps" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockApi.callsOf("post", "/bookmarks")).toHaveLength(1));
    const [call] = mockApi.callsOf("post", "/bookmarks");
    expect((call.body as { filters: Filters }).filters.origins).toEqual([]);
  });

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
        origins: [],
        attributes: {},
        relations: {},
        tagIds: ["t1"],
        mineScope: "stakeholder",
        groupBy: "lifecycle",
        groupTree: false,
        groupTreeLevel: null,
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
    expect((body.filters as Record<string, unknown>).groupTree).toBe(false);
    expect((body.filters as Record<string, unknown>).groupTreeLevel).toBeNull();
  });

  it("saves the indent-children option beside the grouping", async () => {
    mockApi.on("post", "/bookmarks", { id: "bm-new" });
    await renderSidebar({ groupBy: null, groupTree: true });
    fireEvent.click(screen.getByRole("button", { name: /Save view/ }));
    const name = within(screen.getByRole("dialog")).getByLabelText("View name");
    fireEvent.change(name, { target: { value: "Tree" } });
    fireEvent.keyDown(name, { key: "Enter" });
    await waitFor(() => expect(mockApi.callsOf("post")).toHaveLength(1));
    const body = mockApi.callsOf("post")[0].body as { filters: Record<string, unknown> };
    expect(body.filters.groupTree).toBe(true);
    expect(body.filters.groupBy).toBeNull();
    expect(body.filters.groupTreeLevel).toBeNull();
  });

  it("saves the chosen tree level beside the parent option", async () => {
    mockApi.on("post", "/bookmarks", { id: "bm-new" });
    await renderSidebar({ groupBy: "lifecycle", groupTree: true, groupTreeLevel: 2 });
    fireEvent.click(screen.getByRole("button", { name: /Save view/ }));
    const name = within(screen.getByRole("dialog")).getByLabelText("View name");
    fireEvent.change(name, { target: { value: "Tree L2" } });
    fireEvent.keyDown(name, { key: "Enter" });
    await waitFor(() => expect(mockApi.callsOf("post")).toHaveLength(1));
    const body = mockApi.callsOf("post")[0].body as { filters: Record<string, unknown> };
    expect(body.filters.groupTree).toBe(true);
    expect(body.filters.groupTreeLevel).toBe(2);
  });

  it("restores the tree level from a view, null for legacy or invalid levels", async () => {
    const levelView = makeBookmark({
      id: "bm-level",
      name: "Level View",
      filters: { types: ["BusinessCapability"], groupBy: null, groupTree: true, groupTreeLevel: 1 },
    });
    const badView = makeBookmark({
      id: "bm-bad",
      name: "Bad Level",
      filters: { types: ["BusinessCapability"], groupTree: true, groupTreeLevel: 0 },
    });
    mockApi.on("get", "/bookmarks", [levelView, badView, MY_VIEW]);
    const onGroupTreeLevelChange = vi.fn();
    await renderSidebar({ onGroupTreeLevelChange });
    openTab("Views");
    fireEvent.click(screen.getByRole("button", { name: /Level View/ }));
    expect(onGroupTreeLevelChange).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: /My App View/ }));
    expect(onGroupTreeLevelChange).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByRole("button", { name: /Level View/ }));
    fireEvent.click(screen.getByRole("button", { name: /Bad Level/ }));
    expect(onGroupTreeLevelChange).toHaveBeenLastCalledWith(null);
    expect(onGroupTreeLevelChange).toHaveBeenCalledTimes(4);
  });

  it("restores the indent-children option from a view, off for views saved without it", async () => {
    const treeView = makeBookmark({
      id: "bm-tree",
      name: "Tree View",
      filters: { types: ["BusinessCapability"], groupBy: null, groupTree: true },
    });
    mockApi.on("get", "/bookmarks", [treeView, MY_VIEW]);
    const onGroupTreeChange = vi.fn();
    await renderSidebar({ onGroupTreeChange });
    openTab("Views");
    fireEvent.click(screen.getByRole("button", { name: /Tree View/ }));
    expect(onGroupTreeChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: /My App View/ }));
    expect(onGroupTreeChange).toHaveBeenLastCalledWith(false);
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

/* ========================================================================= */
/*  Selected chips and view icons paint their colours                         */
/* ========================================================================= */

describe("InventoryFilterSidebar — colours", () => {
  const WHITE = createTheme().palette.common.white;
  const filled = (bg: string) => ({ backgroundColor: bg, color: WHITE, borderColor: bg });

  it.each([
    ["Approval Status", "Approved", { approvalStatuses: ["APPROVED"] }, APPROVAL_STATUS_OPTIONS[1].color],
    ["Lifecycle", "Active", { lifecyclePhases: ["active"] }, LIFECYCLE_PHASES[2].color],
    ["Data Quality", "Complete (≥80%)", { dataQualityBands: ["complete"] }, DATA_QUALITY_BANDS[0].color],
  ] as const)("fills a selected %s chip with its colour and white text", async (section, label, f, bg) => {
    await renderSidebar({ initialFilters: f as Partial<Filters> });
    expandSection(section);
    expect(chip(label)).toHaveStyle(filled(bg));
  });

  it("fills a selected EOL status and link type with their colours", async () => {
    await renderSidebar({
      types: [...CARD_TYPES, SITE_TYPE],
      initialFilters: { types: ["Site"], eolStatuses: ["approaching"], linkTypes: ["primary"] },
      showEolFacet: true,
      showLinkTypeFacet: true,
    });
    expandSection("End of life");
    expandSection("Link type");
    expect(chip("Approaching EOL")).toHaveStyle(filled(EOL_STATUS_COLORS.approaching));
    expect(chip("Primary")).toHaveStyle(filled(SITE_TYPE.hierarchy_labels![0].color!));
  });

  it("marks an OData view with a cloud and titles the dialog by its mode", async () => {
    mockApi.on("get", "/bookmarks", [MY_VIEW, MY_SHARED]);
    await renderSidebar({ canShareBookmarks: true, canOdataBookmarks: true, currentUserId: ADMIN_USER.id });
    openTab("Views");
    const titleIcon = () => within(screen.getByRole("dialog")).getByRole("heading").querySelector(".material-symbols-outlined");
    expect(screen.getByRole("button", { name: /Shared by me/ })).toHaveTextContent("cloud");
    expect(screen.getByRole("button", { name: /My App View/ })).not.toHaveTextContent("cloud");
    fireEvent.click(within(screen.getByRole("button", { name: /Shared by me/ })).getByRole("button", { name: "edit" }));
    expect(titleIcon()).toHaveTextContent(/^edit$/);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    openTab("Filters");
    fireEvent.click(screen.getByRole("button", { name: /Save view/ }));
    expect(titleIcon()).toHaveTextContent(/^bookmark_add$/);
  });
});

describe("treeGroupingApplies", () => {
  const hierarchical = CARD_TYPES.filter((ct) => ct.has_hierarchy);
  const flat = CARD_TYPES.filter((ct) => !ct.has_hierarchy);

  it("applies with no type filter when any type has a hierarchy", () => {
    expect(hierarchical.length).toBeGreaterThan(0);
    expect(flat.length).toBeGreaterThan(0);
    expect(treeGroupingApplies(CARD_TYPES, [])).toBe(true);
    expect(treeGroupingApplies(flat, [])).toBe(false);
  });

  it("follows the selected types", () => {
    expect(treeGroupingApplies(CARD_TYPES, [flat[0].key])).toBe(false);
    expect(treeGroupingApplies(CARD_TYPES, [hierarchical[0].key])).toBe(true);
    expect(treeGroupingApplies(CARD_TYPES, [flat[0].key, hierarchical[0].key])).toBe(true);
  });
});

/* ========================================================================= */
/*  Query views (an MCP-authored multi-hop query on a saved view)              */
/* ========================================================================= */

const VIEW_QUERY = {
  type: "Application",
  related: [
    { relation: "relAppToITC", type: "ITComponent", where: { lifecycle_phase: ["active"] } },
    { relation: "relAppToBC", type: "BusinessCapability", negate: true },
  ],
};
const QUERY_VIEW = makeBookmark({
  id: "bm-q",
  name: "Apps on live tech",
  query: VIEW_QUERY,
  created_via: "mcp",
  filters: { search: "erp", lifecyclePhases: ["active"], groupBy: "subtype" },
  columns: ["core_type", "core_name"],
  column_state: [{ colId: "core_name", width: 300 }],
});
const SHARED_QUERY_VIEW = makeBookmark({
  id: "bm-q2",
  name: "Team query",
  is_owner: false,
  owner_id: MEMBER_USER.id,
  owner_name: "Test Member",
  visibility: "public",
  can_edit: false,
  query: { type: "Application", related: [{ relation: "relAppToITC", type: "ITComponent" }] },
});
const QUERY_REL_TYPES = [REL_APP_TO_ITC, REL_APP_TO_BC];

describe("InventoryFilterSidebar — query views", () => {
  it("applies a query view: its start type and stored facets, and puts its query in force", async () => {
    mockApi.on("get", "/bookmarks", [QUERY_VIEW, MY_VIEW]);
    const onApplyQuery = vi.fn();
    const onGroupByChange = vi.fn();
    const { last } = await renderSidebar({
      onApplyQuery,
      onGroupByChange,
      relationTypes: QUERY_REL_TYPES,
    });
    openTab("Views");
    fireEvent.click(screen.getByRole("button", { name: /Apps on live tech/ }));
    expect(onApplyQuery).toHaveBeenCalledTimes(1);
    expect(onApplyQuery).toHaveBeenLastCalledWith({
      viewId: "bm-q",
      name: "Apps on live tech",
      query: VIEW_QUERY,
      createdVia: "mcp",
    });
    expect(last()).toEqual({
      ...EMPTY_FILTERS,
      types: ["Application"],
      search: "erp",
      lifecyclePhases: ["active"],
    });
    expect(onGroupByChange).toHaveBeenLastCalledWith("subtype");

    // A plain view drops the query.
    fireEvent.click(screen.getByRole("button", { name: /My App View/ }));
    expect(onApplyQuery).toHaveBeenCalledTimes(2);
    expect(onApplyQuery).toHaveBeenLastCalledWith(null);
  });

  it("drops the query on Clear all", async () => {
    const onApplyQuery = vi.fn();
    const { last } = await renderSidebar({
      onApplyQuery,
      initialFilters: { types: ["Application"] },
    });
    fireEvent.click(screen.getByRole("button", { name: /Clear all/ }));
    expect(last()).toEqual(EMPTY_FILTERS);
    expect(onApplyQuery).toHaveBeenCalledTimes(1);
    expect(onApplyQuery).toHaveBeenCalledWith(null);
  });

  it("badges a query view by its origin and reads it as its path", async () => {
    mockApi.on("get", "/bookmarks", [QUERY_VIEW, MY_VIEW, SHARED_QUERY_VIEW]);
    await renderSidebar({ relationTypes: QUERY_REL_TYPES });
    openTab("Views");
    const row = screen.getByRole("button", { name: /Apps on live tech/ });
    // An assistant's view carries the robot, a view built here the query-view glyph.
    expect(within(row).getByRole("img", { name: "Query view" })).toHaveTextContent(/^smart_toy$/);
    expect(row).toHaveTextContent("Application › uses IT Component +1");
    // An owned query view needs no owner tooltip.
    expect(within(row).queryByTitle(/^by /)).not.toBeInTheDocument();

    const plain = screen.getByRole("button", { name: /My App View/ });
    expect(within(plain).queryByRole("img", { name: "Query view" })).not.toBeInTheDocument();
    expect(plain).not.toHaveTextContent("›");

    // Someone else's query view keeps the path on the line; the owner moves
    // into a tooltip.
    const shared = screen.getByRole("button", { name: /Team query/ });
    expect(within(shared).getByRole("img", { name: "Query view" })).toHaveTextContent(
      /^view_in_ar$/,
    );
    expect(shared).toHaveTextContent("Application › uses IT Component");
    expect(shared).not.toHaveTextContent("+1");
    expect(shared).not.toHaveTextContent("by Test Member");
    expect(within(shared).getByTitle("by Test Member")).toHaveTextContent(
      "Application › uses IT Component",
    );
  });

  it("ends a query view's path with its condition count", async () => {
    const EOL_VIEW = makeBookmark({
      id: "bm-eol",
      name: "Apps at or near end of life",
      query: { type: "Application", where: { eol_status: ["eol", "approaching"], subtype: ["x"] } },
    });
    mockApi.on("get", "/bookmarks", [QUERY_VIEW, EOL_VIEW, SHARED_QUERY_VIEW]);
    await renderSidebar({ relationTypes: QUERY_REL_TYPES });
    openTab("Views");
    const secondary = (name: RegExp) =>
      screen.getByRole("button", { name }).querySelector(".MuiListItemText-secondary")!.textContent;
    expect(secondary(/Apps at or near end of life/)).toBe("Application · 2 conditions");
    expect(secondary(/Apps on live tech/)).toBe("Application › uses IT Component +1 · 1 condition");
    expect(secondary(/Team query/)).toBe("Application › uses IT Component");
  });

  it("reads a stacked query view as its lines joined by AND and OR, its icon by its start types", async () => {
    const STACK_VIEW = makeBookmark({
      id: "bm-s",
      name: "Stacked",
      query: {
        any_of: [
          { all_of: [{ type: "Application" }, { type: "Application" }] },
          { type: "BusinessCapability" },
        ],
      },
      filters: { types: ["Application", "BusinessCapability"] },
    });
    const ONE_TYPE_VIEW = makeBookmark({
      id: "bm-a",
      name: "Anded",
      query: { all_of: [{ type: "Application" }, { type: "Application" }] },
      filters: {},
    });
    mockApi.on("get", "/bookmarks", [STACK_VIEW, ONE_TYPE_VIEW]);
    await renderSidebar({ relationTypes: QUERY_REL_TYPES });
    openTab("Views");
    const row = screen.getByRole("button", { name: /Stacked/ });
    expect(row).toHaveTextContent("Application AND Application +1");
    // Two start types: no one type's icon.
    expect(row.querySelector(".MuiListItemIcon-root")).toHaveTextContent(/^bookmark$/);
    const anded = screen.getByRole("button", { name: /Anded/ });
    expect(anded).toHaveTextContent("Application AND Application");
    expect(anded).not.toHaveTextContent("+1");
    expect(anded.querySelector(".MuiListItemIcon-root")).toHaveTextContent(/^apps$/);
  });

  it("saves a stacked query from the strip with both start types and no card type", async () => {
    const BUILT = { any_of: [{ type: "Application" }, { type: "BusinessCapability" }] };
    mockApi.on("post", "/bookmarks", (_path, body) => ({
      ...makeBookmark({ id: "bm-built", name: "Built" }),
      ...(body as object),
      created_via: "web",
    }));
    const props = { initialFilters: { types: ["Application", "BusinessCapability"] } };
    const { rerender } = await renderSidebar(props);
    rerender(<Harness {...props} pendingSave={BUILT} />);
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("View name"), { target: { value: "Built" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockApi.callsOf("post")).toHaveLength(1));
    const body = mockApi.callsOf("post")[0].body as Record<string, unknown>;
    expect(body.query).toEqual(BUILT);
    expect(body.card_type).toBeUndefined();
    expect((body.filters as { types: string[] }).types).toEqual(["Application", "BusinessCapability"]);
  });

  it("edits a query view's name, sharing, OData and layout, never its facets or query", async () => {
    mockApi.on("get", "/bookmarks", [QUERY_VIEW]);
    mockApi.on("patch", "/bookmarks/bm-q", { ...QUERY_VIEW, name: "Renamed" });
    await renderSidebar({
      relationTypes: QUERY_REL_TYPES,
      // Facets on screen differ from the view's stored ones: they must not leak in.
      initialFilters: { types: ["ITComponent"], search: "linux", staleOnly: true },
      selectedColumns: new Set(["core_type", "core_name", "core_lifecycle"]),
      columnState: [{ colId: "core_lifecycle", width: 180 }],
      columnFilterModel: { core_name: { filter: "sap" } },
      groupBy: "lifecycle",
      groupTree: true,
      groupTreeLevel: 2,
    });
    openTab("Views");
    const row = screen.getByRole("button", { name: /Apps on live tech/ });
    fireEvent.click(within(row).getByRole("button", { name: "edit" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByText(/MCP/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/active filter/)).not.toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("View name"), { target: { value: "Renamed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Update" }));
    await waitFor(() => expect(mockApi.callsOf("patch")).toHaveLength(1));
    const [call] = mockApi.callsOf("patch");
    expect(call.path).toBe("/bookmarks/bm-q");
    expect(call.body).toEqual({
      name: "Renamed",
      visibility: "private",
      odata_enabled: false,
      shared_with: null,
      columns: ["core_type", "core_name", "core_lifecycle"],
      column_state: [{ colId: "core_lifecycle", width: 180 }],
      column_filter_model: { core_name: { filter: "sap" } },
      filters: {
        search: "erp",
        lifecyclePhases: ["active"],
        groupBy: "lifecycle",
        groupTree: true,
        groupTreeLevel: 2,
      },
    });
    expect(call.body).not.toHaveProperty("query");
    expect(mockApi.callsOf("post")).toHaveLength(0);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("get", "/bookmarks")).toHaveLength(2);
  });

  it("editing a plain view still saves the current facets", async () => {
    mockApi.on("get", "/bookmarks", [MY_VIEW]);
    mockApi.on("patch", "/bookmarks/bm-1", MY_VIEW);
    await renderSidebar({ initialFilters: { types: ["ITComponent"], search: "linux" } });
    openTab("Views");
    fireEvent.click(
      within(screen.getByRole("button", { name: /My App View/ })).getByRole("button", {
        name: "edit",
      }),
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Update" }));
    await waitFor(() => expect(mockApi.callsOf("patch")).toHaveLength(1));
    expect(mockApi.callsOf("patch")[0].body).toMatchObject({
      card_type: "ITComponent",
      filters: { types: ["ITComponent"], search: "linux" },
    });
  });

  it("highlights the view the page applied, and lets go of it when the page does", async () => {
    mockApi.on("get", "/bookmarks", [QUERY_VIEW, MY_VIEW]);
    const base = { relationTypes: QUERY_REL_TYPES };
    const { rerender } = await renderSidebar({ ...base, externalActiveViewId: "bm-q" });
    openTab("Views");
    const queryRow = () => screen.getByRole("button", { name: /Apps on live tech/ });
    const plainRow = () => screen.getByRole("button", { name: /My App View/ });
    expect(queryRow()).toHaveClass("Mui-selected");
    expect(sidebarPrefs().activeViewId).toBe("bm-q");

    rerender(<Harness {...base} externalActiveViewId={null} />);
    expect(queryRow()).not.toHaveClass("Mui-selected");
    expect(sidebarPrefs().activeViewId).toBeNull();

    // A view the user picked since is kept when the page lets go of its own.
    rerender(<Harness {...base} externalActiveViewId="bm-q" />);
    expect(queryRow()).toHaveClass("Mui-selected");
    fireEvent.click(plainRow());
    rerender(<Harness {...base} externalActiveViewId={null} />);
    expect(plainRow()).toHaveClass("Mui-selected");
    expect(queryRow()).not.toHaveClass("Mui-selected");
  });

  it("saves a copy of the query view in force from Save current, query included", async () => {
    mockApi.on("get", "/bookmarks", [QUERY_VIEW]);
    mockApi.on("post", "/bookmarks", { ...QUERY_VIEW, id: "bm-copy", name: "Copy", created_via: "web" });
    const onApplyQuery = vi.fn();
    await renderSidebar({
      relationTypes: QUERY_REL_TYPES,
      externalActiveViewId: "bm-q",
      onApplyQuery,
      initialFilters: { types: ["Application"], search: "erp" },
    });
    openTab("Views");
    const button = screen.getByRole("button", { name: /Save current/ });
    expect(button.getAttribute("title") ?? "").toBe("");
    fireEvent.click(button);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByText(/MCP/)).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("View name"), { target: { value: "Copy" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockApi.callsOf("post")).toHaveLength(1));
    const body = mockApi.callsOf("post")[0].body as Record<string, unknown>;
    expect(body.query).toEqual(VIEW_QUERY);
    expect(body.card_type).toBe("Application");
    expect(body).toMatchObject({ name: "Copy", filters: { types: ["Application"], search: "erp" } });
    expect(onApplyQuery).toHaveBeenCalledTimes(1);
    expect(onApplyQuery).toHaveBeenCalledWith({
      viewId: "bm-copy",
      name: "Copy",
      query: VIEW_QUERY,
      createdVia: "web",
    });
  });

  it("saves a plain view from Save current when the applied view is a plain one", async () => {
    mockApi.on("get", "/bookmarks", [MY_VIEW]);
    mockApi.on("post", "/bookmarks", { ...MY_VIEW, id: "bm-new" });
    const onApplyQuery = vi.fn();
    await renderSidebar({
      externalActiveViewId: "bm-1",
      onApplyQuery,
      initialFilters: { types: ["Application", "ITComponent"] },
    });
    openTab("Views");
    fireEvent.click(screen.getByRole("button", { name: /Save current/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("View name"), { target: { value: "Plain" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockApi.callsOf("post")).toHaveLength(1));
    const body = mockApi.callsOf("post")[0].body as Record<string, unknown>;
    expect(body).not.toHaveProperty("query");
    expect(body.card_type).toBeUndefined();
    expect(body).toMatchObject({ filters: { types: ["Application", "ITComponent"] } });
    expect(onApplyQuery).not.toHaveBeenCalled();
  });

  it("offers New query view only to someone who may save views", async () => {
    const onStartQueryDraft = vi.fn();
    const { unmount } = await renderSidebar({ onStartQueryDraft });
    openTab("Views");
    expect(screen.queryByTestId("new-query-view")).not.toBeInTheDocument();
    unmount();

    await renderSidebar({ onStartQueryDraft, canManageBookmarks: true });
    const button = screen.getByRole("button", { name: /New query view/ });
    expect(button).toHaveAttribute("data-testid", "new-query-view");
    expect(button).toHaveTextContent(/^view_in_ar/);
    // Two-row header: the title stands alone, the actions sit on their own
    // wrapping row, "Save current" first.
    const title = screen.getByText("Saved Views");
    const actions = screen.getByTestId("views-header-actions");
    expect(actions).not.toContainElement(title);
    expect(actions).toHaveStyle({ flexWrap: "wrap" });
    expect(within(actions).getAllByRole("button").map((b) => b.dataset.testid)).toEqual([
      "save-current-view",
      "new-query-view",
    ]);
    expect(onStartQueryDraft).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(onStartQueryDraft).toHaveBeenCalledTimes(1);
  });

  it("opens the save dialog for a query built in the strip and saves it as a new query view", async () => {
    const BUILT = { type: "ITComponent", where: { tags: ["tag-1"] } };
    mockApi.on("post", "/bookmarks", (_path, body) => ({
      ...makeBookmark({ id: "bm-built", name: "Built" }),
      ...(body as object),
      created_via: "web",
    }));
    const onPendingSaveHandled = vi.fn();
    const onApplyQuery = vi.fn();
    const props = {
      onPendingSaveHandled,
      onApplyQuery,
      initialFilters: { types: ["ITComponent"], search: "linux" },
    };
    const { rerender } = await renderSidebar(props);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onPendingSaveHandled).not.toHaveBeenCalled();

    rerender(<Harness {...props} pendingSave={BUILT} />);
    const dialog = screen.getByRole("dialog");
    expect(onPendingSaveHandled).toHaveBeenCalledTimes(1);
    fireEvent.change(within(dialog).getByLabelText("View name"), { target: { value: "Built" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockApi.callsOf("post")).toHaveLength(1));
    const body = mockApi.callsOf("post")[0].body as Record<string, unknown>;
    expect(body.query).toEqual(BUILT);
    expect(body.card_type).toBe("ITComponent");
    expect(body).toMatchObject({ name: "Built", filters: { types: ["ITComponent"], search: "linux" } });
    expect(onApplyQuery).toHaveBeenCalledWith({
      viewId: "bm-built",
      name: "Built",
      query: BUILT,
      createdVia: "web",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("get", "/bookmarks")).toHaveLength(2);
  });

  it("forgets a strip query whose save dialog was cancelled", async () => {
    mockApi.on("post", "/bookmarks", { id: "bm-x" });
    const props = { initialFilters: { types: ["ITComponent"] } };
    const { rerender } = await renderSidebar(props);
    rerender(<Harness {...props} pendingSave={{ type: "ITComponent" }} />);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    openTab("Views");
    fireEvent.click(screen.getByRole("button", { name: /Save current/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("View name"), { target: { value: "Plain" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockApi.callsOf("post")).toHaveLength(1));
    expect(mockApi.callsOf("post")[0].body).not.toHaveProperty("query");
  });

  it("saves the draft open in the strip from Save current, not the view in force", async () => {
    const DRAFT = { type: "Application", where: { lifecycle_phase: ["active"] } };
    mockApi.on("get", "/bookmarks", [QUERY_VIEW]);
    mockApi.on("post", "/bookmarks", (_path, body) => ({
      ...makeBookmark({ id: "bm-draft", name: "From draft" }),
      ...(body as object),
      created_via: "web",
    }));
    const onApplyQuery = vi.fn();
    await renderSidebar({
      relationTypes: QUERY_REL_TYPES,
      externalActiveViewId: "bm-q",
      draftQuery: DRAFT,
      onApplyQuery,
      initialFilters: { types: ["Application"] },
    });
    openTab("Views");
    const button = screen.getByRole("button", { name: /Save current/ });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("View name"), {
      target: { value: "From draft" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockApi.callsOf("post")).toHaveLength(1));
    const body = mockApi.callsOf("post")[0].body as Record<string, unknown>;
    expect(body.query).toEqual(DRAFT);
    expect(body.card_type).toBe("Application");
    expect(onApplyQuery).toHaveBeenCalledTimes(1);
    expect(onApplyQuery).toHaveBeenCalledWith({
      viewId: "bm-draft",
      name: "From draft",
      query: DRAFT,
      createdVia: "web",
    });
  });

  it.each([
    ["without a type", { type: "" }],
    ["with a condition still empty", { type: "Application", where: { lifecycle_phase: [] } }],
  ])("holds both save buttons while the draft is %s", async (_label, draft) => {
    await renderSidebar({ draftQuery: draft, initialFilters: { types: ["Application"] } });
    const saveView = screen.getByTestId("save-view");
    expect(saveView).toBeDisabled();
    fireEvent.mouseOver(saveView.parentElement as HTMLElement);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Finish the query first");

    openTab("Views");
    const saveCurrent = screen.getByRole("button", { name: /Save current/ });
    expect(saveCurrent).toBeDisabled();
    fireEvent.click(saveCurrent);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("leaves the save buttons alone without a draft or with a finished one", async () => {
    const { unmount } = await renderSidebar();
    expect(screen.getByTestId("save-view")).toBeEnabled();
    unmount();
    await renderSidebar({ draftQuery: { type: "Application" } });
    expect(screen.getByTestId("save-view")).toBeEnabled();
    openTab("Views");
    expect(screen.getByRole("button", { name: /Save current/ })).toBeEnabled();
  });

  it("locks the Types facet while a query draft is open", async () => {
    const { changes } = await renderSidebar({
      typesLocked: true,
      initialFilters: { types: ["Application"] },
    });
    const locked = screen.getAllByTestId("type-facet-locked");
    expect(locked.length).toBeGreaterThan(0);
    const row = screen.getByText("IT Component").closest(".MuiListItemButton-root") as HTMLElement;
    expect(row).toHaveClass("Mui-disabled");
    const boxes = locked.map((el) => el.querySelector("input[type=checkbox]") as HTMLInputElement);
    expect(boxes.every((b) => b.disabled)).toBe(true);
    fireEvent.click(screen.getByText("IT Component"));
    expect(changes).toHaveLength(0);
    fireEvent.mouseOver(locked[0]);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Close the query editor to change the type",
    );
  });

  it("leaves the Types facet open without a draft", async () => {
    const { last } = await renderSidebar({ initialFilters: { types: ["Application"] } });
    expect(screen.queryByTestId("type-facet-locked")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("IT Component"));
    expect(last().types).toEqual(["Application", "ITComponent"]);
  });

  it("hands every loaded list to the page and reloads when the page bumps the revision", async () => {
    mockApi.on("get", "/bookmarks", [QUERY_VIEW, MY_VIEW]);
    const onBookmarksLoaded = vi.fn();
    const { rerender } = await renderSidebar({ onBookmarksLoaded });
    expect(onBookmarksLoaded).toHaveBeenCalledTimes(1);
    expect(onBookmarksLoaded).toHaveBeenLastCalledWith([QUERY_VIEW, MY_VIEW]);

    rerender(<Harness onBookmarksLoaded={onBookmarksLoaded} bookmarksRevision={0} />);
    await act(async () => {});
    expect(mockApi.callsOf("get", "/bookmarks")).toHaveLength(1);

    mockApi.on("get", "/bookmarks", [MY_VIEW]);
    rerender(<Harness onBookmarksLoaded={onBookmarksLoaded} bookmarksRevision={1} />);
    await waitFor(() => expect(onBookmarksLoaded).toHaveBeenCalledTimes(2));
    expect(onBookmarksLoaded).toHaveBeenLastCalledWith([MY_VIEW]);
    expect(mockApi.callsOf("get", "/bookmarks")).toHaveLength(2);
  });
});

describe("InventoryFilterSidebar — matched-cards columns", () => {
  const VIA_VIEW = makeBookmark({
    ...QUERY_VIEW,
    columns: ["core_type", "core_name", "via:0:0"],
  });
  const OTHER_VIA_VIEW = makeBookmark({
    ...SHARED_QUERY_VIEW,
    id: "bm-other",
    name: "Other query",
    is_owner: true,
    can_edit: true,
    columns: ["core_name", "via:0:0"],
  });

  it("applies the picker's columns without the via: entries and hands the view to the page", async () => {
    mockApi.on("get", "/bookmarks", [VIA_VIEW]);
    const onApplyViewViaColumns = vi.fn();
    const { lastColumns } = await renderSidebar({
      relationTypes: QUERY_REL_TYPES,
      onApplyViewViaColumns,
    });
    openTab("Views");
    fireEvent.click(screen.getByRole("button", { name: /Apps on live tech/ }));
    expect([...lastColumns()]).toEqual(["core_type", "core_name"]);
    expect(onApplyViewViaColumns).toHaveBeenCalledTimes(1);
    expect(onApplyViewViaColumns).toHaveBeenCalledWith(VIA_VIEW);
  });

  it("leaves the picker alone for a view storing only via: entries", async () => {
    const onlyVia = makeBookmark({ ...QUERY_VIEW, columns: ["via:0:0"] });
    mockApi.on("get", "/bookmarks", [onlyVia]);
    const onApplyViewViaColumns = vi.fn();
    const { columnChanges } = await renderSidebar({
      relationTypes: QUERY_REL_TYPES,
      onApplyViewViaColumns,
    });
    openTab("Views");
    fireEvent.click(screen.getByRole("button", { name: /Apps on live tech/ }));
    expect(columnChanges).toHaveLength(0);
    expect(onApplyViewViaColumns).toHaveBeenCalledWith(onlyVia);
  });

  it("a new view stores the via: entries the page gives for its query", async () => {
    mockApi.on("get", "/bookmarks", [QUERY_VIEW]);
    mockApi.on("post", "/bookmarks", { ...QUERY_VIEW, id: "bm-copy", name: "Copy" });
    const viaColumnsFor = vi.fn(() => ["via:0:0"]);
    await renderSidebar({
      relationTypes: QUERY_REL_TYPES,
      externalActiveViewId: "bm-q",
      viaColumnsFor,
      selectedColumns: new Set(["core_type", "core_name"]),
    });
    openTab("Views");
    fireEvent.click(screen.getByRole("button", { name: /Save current/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("View name"), { target: { value: "Copy" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockApi.callsOf("post")).toHaveLength(1));
    expect(viaColumnsFor).toHaveBeenCalledWith(VIEW_QUERY);
    expect((mockApi.callsOf("post")[0].body as { columns: string[] }).columns).toEqual([
      "core_type",
      "core_name",
      "via:0:0",
    ]);
  });

  it("updating the view in force stores the page's via: entries for its query", async () => {
    mockApi.on("get", "/bookmarks", [VIA_VIEW]);
    mockApi.on("patch", "/bookmarks/bm-q", VIA_VIEW);
    const viaColumnsFor = vi.fn(() => ["via:0:0"]);
    await renderSidebar({
      relationTypes: QUERY_REL_TYPES,
      externalActiveViewId: "bm-q",
      viaColumnsFor,
      selectedColumns: new Set(["core_name"]),
    });
    openTab("Views");
    const row = screen.getByRole("button", { name: /Apps on live tech/ });
    fireEvent.click(within(row).getByRole("button", { name: "edit" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Update" }));
    await waitFor(() => expect(mockApi.callsOf("patch")).toHaveLength(1));
    expect(viaColumnsFor).toHaveBeenCalledWith(VIEW_QUERY);
    expect((mockApi.callsOf("patch")[0].body as { columns: string[] }).columns).toEqual([
      "core_name",
      "via:0:0",
    ]);
  });

  it("updating another query view keeps its own via: entries", async () => {
    mockApi.on("get", "/bookmarks", [VIA_VIEW, OTHER_VIA_VIEW]);
    mockApi.on("patch", "/bookmarks/bm-other", OTHER_VIA_VIEW);
    const viaColumnsFor = vi.fn(() => ["via:9:9"]);
    await renderSidebar({
      relationTypes: QUERY_REL_TYPES,
      externalActiveViewId: "bm-q",
      viaColumnsFor,
      selectedColumns: new Set(["core_name"]),
    });
    openTab("Views");
    const row = screen.getByRole("button", { name: /Other query/ });
    fireEvent.click(within(row).getByRole("button", { name: "edit" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Update" }));
    await waitFor(() => expect(mockApi.callsOf("patch")).toHaveLength(1));
    expect(viaColumnsFor).not.toHaveBeenCalled();
    expect((mockApi.callsOf("patch")[0].body as { columns: string[] }).columns).toEqual([
      "core_name",
      "via:0:0",
    ]);
  });

  const F_SAP = { filterType: "text", type: "contains", filter: "SAP" };
  const F_ERP = { filterType: "text", type: "contains", filter: "ERP" };

  it("applies a view's layout less the via: entries for steps it does not switch on", async () => {
    const stale = makeBookmark({
      ...QUERY_VIEW,
      columns: ["core_name", "via:0:0", "via:0:1"],
      column_filter_model: { core_name: F_ERP, "via:0:0": F_SAP, "via:0:1": F_SAP, "via:5:0": F_SAP },
      column_state: [
        { colId: "core_name", width: 300 },
        { colId: "via:0:0", width: 120 },
        { colId: "via:0:1", width: 140 },
      ],
    });
    mockApi.on("get", "/bookmarks", [stale]);
    const onApplyColumnState = vi.fn();
    const onApplyColumnFilters = vi.fn();
    await renderSidebar({
      relationTypes: QUERY_REL_TYPES,
      onApplyColumnState,
      onApplyColumnFilters,
    });
    openTab("Views");
    fireEvent.click(screen.getByRole("button", { name: /Apps on live tech/ }));
    // 0:1 is the "has no" hop, 5:0 no step at all: only 0:0 is on.
    expect(onApplyColumnFilters).toHaveBeenCalledWith({ core_name: F_ERP, "via:0:0": F_SAP });
    expect(onApplyColumnState).toHaveBeenCalledWith([
      { colId: "core_name", width: 300 },
      { colId: "via:0:0", width: 120 },
    ]);
  });

  it("saves the grid's layout less the via: entries for steps the view does not keep", async () => {
    mockApi.on("get", "/bookmarks", [VIA_VIEW]);
    mockApi.on("patch", "/bookmarks/bm-q", VIA_VIEW);
    await renderSidebar({
      relationTypes: QUERY_REL_TYPES,
      externalActiveViewId: "bm-q",
      viaColumnsFor: () => ["via:0:0"],
      selectedColumns: new Set(["core_name"]),
      columnFilterModel: { core_name: F_ERP, "via:0:0": F_SAP, "via:0:1": F_SAP },
      columnState: [
        { colId: "core_name", width: 300 },
        { colId: "via:0:1", width: 140 },
      ],
    });
    openTab("Views");
    const row = screen.getByRole("button", { name: /Apps on live tech/ });
    fireEvent.click(within(row).getByRole("button", { name: "edit" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Update" }));
    await waitFor(() => expect(mockApi.callsOf("patch")).toHaveLength(1));
    expect(mockApi.callsOf("patch")[0].body).toMatchObject({
      columns: ["core_name", "via:0:0"],
      column_filter_model: { core_name: F_ERP, "via:0:0": F_SAP },
      column_state: [{ colId: "core_name", width: 300 }],
    });
  });

  it("a filter model left with nothing is saved as none", async () => {
    mockApi.on("get", "/bookmarks", [VIA_VIEW]);
    mockApi.on("patch", "/bookmarks/bm-q", VIA_VIEW);
    await renderSidebar({
      relationTypes: QUERY_REL_TYPES,
      externalActiveViewId: "bm-q",
      viaColumnsFor: () => [],
      selectedColumns: new Set(["core_name"]),
      columnFilterModel: { "via:0:0": F_SAP },
    });
    openTab("Views");
    const row = screen.getByRole("button", { name: /Apps on live tech/ });
    fireEvent.click(within(row).getByRole("button", { name: "edit" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Update" }));
    await waitFor(() => expect(mockApi.callsOf("patch")).toHaveLength(1));
    expect(mockApi.callsOf("patch")[0].body).toMatchObject({
      columns: ["core_name"],
      column_filter_model: null,
      column_state: null,
    });
  });

  it("updating the view in force re-anchors the page's columns on what was saved", async () => {
    const saved = makeBookmark({ ...VIA_VIEW, columns: ["core_name", "via:0:0"] });
    mockApi.on("get", "/bookmarks", [VIA_VIEW]);
    mockApi.on("patch", "/bookmarks/bm-q", saved);
    const onApplyViewViaColumns = vi.fn();
    await renderSidebar({
      relationTypes: QUERY_REL_TYPES,
      externalActiveViewId: "bm-q",
      viaColumnsFor: () => ["via:0:0"],
      onApplyViewViaColumns,
      selectedColumns: new Set(["core_name"]),
    });
    openTab("Views");
    const row = screen.getByRole("button", { name: /Apps on live tech/ });
    fireEvent.click(within(row).getByRole("button", { name: "edit" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Update" }));
    await waitFor(() => expect(onApplyViewViaColumns).toHaveBeenCalledTimes(1));
    expect(onApplyViewViaColumns).toHaveBeenCalledWith(saved);
  });

  it("updating the view in force with no answer re-anchors on what was sent", async () => {
    mockApi.on("get", "/bookmarks", [VIA_VIEW]);
    mockApi.on("patch", "/bookmarks/bm-q", undefined);
    const onApplyViewViaColumns = vi.fn();
    await renderSidebar({
      relationTypes: QUERY_REL_TYPES,
      externalActiveViewId: "bm-q",
      viaColumnsFor: () => [],
      onApplyViewViaColumns,
      selectedColumns: new Set(["core_name"]),
    });
    openTab("Views");
    const row = screen.getByRole("button", { name: /Apps on live tech/ });
    fireEvent.click(within(row).getByRole("button", { name: "edit" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Update" }));
    await waitFor(() => expect(onApplyViewViaColumns).toHaveBeenCalledTimes(1));
    expect(onApplyViewViaColumns).toHaveBeenCalledWith({ ...VIA_VIEW, columns: ["core_name"] });
  });

  it("updating another view leaves the page's columns alone", async () => {
    mockApi.on("get", "/bookmarks", [VIA_VIEW, OTHER_VIA_VIEW]);
    mockApi.on("patch", "/bookmarks/bm-other", OTHER_VIA_VIEW);
    const onApplyViewViaColumns = vi.fn();
    await renderSidebar({
      relationTypes: QUERY_REL_TYPES,
      externalActiveViewId: "bm-q",
      viaColumnsFor: () => ["via:0:0"],
      onApplyViewViaColumns,
      selectedColumns: new Set(["core_name"]),
    });
    openTab("Views");
    const row = screen.getByRole("button", { name: /Other query/ });
    fireEvent.click(within(row).getByRole("button", { name: "edit" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Update" }));
    await waitFor(() => expect(mockApi.callsOf("patch")).toHaveLength(1));
    await act(async () => {});
    expect(onApplyViewViaColumns).not.toHaveBeenCalled();
  });

  it("a new query view is put in force anchored on the query and keys it was saved with", async () => {
    mockApi.on("get", "/bookmarks", [QUERY_VIEW]);
    mockApi.on("post", "/bookmarks", { ...QUERY_VIEW, id: "bm-copy", name: "Copy", columns: undefined });
    const onApplyViewViaColumns = vi.fn();
    const onApplyQuery = vi.fn();
    await renderSidebar({
      relationTypes: QUERY_REL_TYPES,
      externalActiveViewId: "bm-q",
      viaColumnsFor: () => ["via:0:0"],
      onApplyViewViaColumns,
      onApplyQuery,
      selectedColumns: new Set(["core_name"]),
    });
    openTab("Views");
    fireEvent.click(screen.getByRole("button", { name: /Save current/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("View name"), { target: { value: "Copy" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onApplyViewViaColumns).toHaveBeenCalledTimes(1));
    const anchored = onApplyViewViaColumns.mock.calls[0][0];
    expect(anchored.id).toBe("bm-copy");
    expect(anchored.query).toEqual(VIEW_QUERY);
    expect(anchored.columns).toEqual(["core_name", "via:0:0"]);
    expect(onApplyQuery).toHaveBeenLastCalledWith(expect.objectContaining({ viewId: "bm-copy" }));
  });

  it("updating a plain view stores no via: entries", async () => {
    mockApi.on("get", "/bookmarks", [MY_VIEW]);
    mockApi.on("patch", "/bookmarks/bm-1", MY_VIEW);
    const viaColumnsFor = vi.fn(() => ["via:0:0"]);
    await renderSidebar({ viaColumnsFor, selectedColumns: new Set(["core_name"]) });
    openTab("Views");
    fireEvent.click(
      within(screen.getByRole("button", { name: /My App View/ })).getByRole("button", {
        name: "edit",
      }),
    );
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Update" }));
    await waitFor(() => expect(mockApi.callsOf("patch")).toHaveLength(1));
    expect((mockApi.callsOf("patch")[0].body as { columns: string[] }).columns).toEqual([
      "core_name",
    ]);
  });
});
