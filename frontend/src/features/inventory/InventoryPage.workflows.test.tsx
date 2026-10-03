/**
 * Inventory page workflows: mass edit, archive / delete / restore, client-side
 * filtering, URL and preference handling, the column definitions the grid is
 * handed, the grid event handlers, and the toolbar chrome on desktop and mobile.
 *
 * A sibling of `InventoryPage.test.tsx`, built on the shared kit: the grid is
 * the `@/test/agGridStub` stand-in, the API is `@/test/apiMock`, the singleton
 * hooks read `@/test/hooks`. The filter sidebar and the dialogs the page
 * delegates to are stubbed with escape hatches that call the page's own
 * callbacks, so every assertion here is about what the PAGE does with them.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactElement } from "react";
import { render, screen, waitFor, within, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useParams } from "react-router";

import InventoryPage, {
  buildInventoryFacetBindings,
  currentFieldValue,
  isInventoryFillable,
} from "./InventoryPage";
import { EMPTY_VALUE, type Filters } from "./InventoryFilterSidebar";
import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { gridStub } from "@/test/agGridStub";
import { setViewportWidth } from "@/test/matchMedia";
import { installClipboard } from "@/test/dom";
import { makeUser } from "@/test/render";
import {
  APPLICATION_TYPE,
  CARDS,
  CARD_IDS,
  CARD_TYPES,
  HOSTING_GROUP,
  MEMBER_USER,
  RELATION_TYPES,
  RISK_GROUP,
  TAG_GROUPS,
  USERS,
  VIEWER_USER,
  cardById,
  cardPage,
  makeCard,
  makeCardType,
  makeField,
  makeOption,
  makeSection,
} from "@/test/fixtures/metamodel";
import { exportCurrentViewToExcel, exportToExcel } from "./excelExport";
import type { Card } from "@/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/**
 * Values the stubbed sidebar / pickers hand back to the page. `vi.mock`
 * factories are hoisted, so this lives in `vi.hoisted` and the tests set it
 * right before clicking the matching escape-hatch button.
 */
const holder = vi.hoisted(() => ({
  filters: {} as Record<string, unknown>,
  groupBy: null as string | null,
  columnState: null as unknown,
  columnFilters: null as Record<string, unknown> | null,
  columns: null as Set<string> | null,
  tagIds: [] as string[],
  cardPick: null as { id: string; name: string; type: string } | null,
}));

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useAuth", () => import("@/test/hooks").then((m) => m.useAuthModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
vi.mock("@/hooks/useCurrency", () => import("@/test/hooks").then((m) => m.useCurrencyModule()));
vi.mock("@/hooks/useCalculatedFields", () =>
  import("@/test/hooks").then((m) => m.useCalculatedFieldsModule()),
);
vi.mock("ag-grid-react", () => import("@/test/agGridStub").then((m) => m.agGridReactModule()));

// Only the component is stubbed; the module's constants and helpers stay real
// because the page derives its default column set from them.
vi.mock("./InventoryFilterSidebar", async () => {
  const actual =
    await vi.importActual<typeof import("./InventoryFilterSidebar")>("./InventoryFilterSidebar");
  return {
    ...actual,
    default: (props: any) => (
      <div
        data-testid="filter-sidebar"
        data-collapsed={String(props.collapsed)}
        data-group-by={props.groupBy ?? ""}
        data-tag-groups={props.tagGroups.length}
        data-stakeholder-roles={props.stakeholderRoles.length}
        data-rel-types={props.allRelevantRelTypes.map((rt: any) => rt.key).join(",")}
      >
        <button
          data-testid="apply-filters"
          onClick={() => props.onFiltersChange({ ...props.filters, ...holder.filters })}
        />
        <button data-testid="set-group-by" onClick={() => props.onGroupByChange(holder.groupBy)} />
        <button
          data-testid="apply-column-state"
          onClick={() => props.onApplyColumnState(holder.columnState)}
        />
        <button
          data-testid="apply-column-filters"
          onClick={() => props.onApplyColumnFilters(holder.columnFilters)}
        />
        <button data-testid="set-columns" onClick={() => props.onSelectedColumnsChange(holder.columns)} />
        <button data-testid="reset-columns" onClick={() => props.onResetColumns()} />
        <button data-testid="toggle-collapse" onClick={() => props.onToggleCollapse()} />
      </div>
    ),
  };
});

vi.mock("@/components/CreateCardDialog", () => ({
  default: ({ open, onClose, onCreate, initialType }: any) =>
    open ? (
      <div data-testid="create-dialog" data-initial-type={initialType ?? ""}>
        <button
          data-testid="create-submit"
          onClick={() => onCreate({ type: "Application", name: "Brand New" })}
        />
        <button data-testid="create-close" onClick={onClose} />
      </div>
    ) : null,
}));

vi.mock("./ImportDialog", () => ({
  default: ({ open, onClose, onComplete, preSelectedType }: any) =>
    open ? (
      <div data-testid="import-dialog" data-type={preSelectedType ?? ""}>
        <button data-testid="import-complete" onClick={onComplete} />
        <button data-testid="import-close" onClick={onClose} />
      </div>
    ) : null,
}));

vi.mock("./RelationCellPopover", () => ({
  default: ({ open, onClose, cardId, cardName, relationTypes, onRelationsChanged }: any) =>
    open ? (
      <div
        data-testid="relation-popover"
        data-card-id={cardId}
        data-card-name={cardName}
        data-rel-types={relationTypes.map((rt: any) => rt.key).join(",")}
      >
        <button data-testid="relation-popover-changed" onClick={onRelationsChanged} />
        <button data-testid="relation-popover-close" onClick={onClose} />
      </div>
    ) : null,
}));

vi.mock("@/components/CardDetailSidePanel", () => ({
  default: ({ cardId, open, onClose }: any) =>
    open ? (
      <div data-testid="card-preview" data-card-id={cardId}>
        <button data-testid="preview-close" onClick={onClose} />
      </div>
    ) : null,
}));

// The pickers inside the mass-edit dialog are real components elsewhere; here
// they only need to hand the page a choice.
vi.mock("@/components/TagPicker", () => ({
  default: ({ value, onChange, label }: any) => (
    <div data-testid="tag-picker" data-value={(value ?? []).join(",")} data-label={label}>
      <button data-testid="pick-tags" onClick={() => onChange(holder.tagIds)} />
    </div>
  ),
}));

vi.mock("@/components/CardPicker", () => ({
  default: ({ onChange, label, excludeIds }: any) => (
    <div
      data-testid="card-picker"
      data-label={label}
      data-exclude={Array.from(excludeIds ?? []).join(",")}
    >
      <button data-testid="pick-card" onClick={() => onChange(holder.cardPick)} />
    </div>
  ),
}));

// CardLogoMenu (real) renders this picker; it is not under test here.
vi.mock("@/components/BrandIconPicker", () => ({ default: () => null }));

vi.mock("./excelExport", () => ({
  exportToExcel: vi.fn(),
  exportCurrentViewToExcel: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ERP = cardById(CARD_IDS.erp);
const CRM = cardById(CARD_IDS.crm);
const ERP_ARCHIVED = cardById(CARD_IDS.erpArchived);
const POSTGRES = cardById(CARD_IDS.postgres);
const LINUX = cardById(CARD_IDS.linux);
const ON_PREM = HOSTING_GROUP.tags[0];
const CLOUD = HOSTING_GROUP.tags[1];

/** A third Application: a child of ERP, with the free-text / url / percentage
 * attributes the shared fixture leaves empty. */
const HR: Card = makeCard({
  id: "ca4d0000-0000-4000-8000-000000000014",
  type: "Application",
  name: "HR Portal",
  parent_id: CARD_IDS.erp,
  parent_label: "module",
  attributes: {
    notes: "See https://wiki.example/ledger for details",
    docsUrl: "https://docs.example/hr",
    coverage: 20,
  },
  lifecycle: {},
  created_by: MEMBER_USER.id,
  updated_by: "00000000-0000-4000-8000-00000000ffff",
  created_at: "2026-01-02T03:04:05Z",
  updated_at: "2026-02-03T04:05:06Z",
});

/** A second archived card so bulk delete / restore have two rows to act on. */
const OLD_TOOL: Card = makeCard({
  id: "ca4d0000-0000-4000-8000-000000000023",
  type: "ITComponent",
  name: "Old Tool",
  status: "ARCHIVED",
  archived_at: "2026-01-20T10:00:00Z",
});

const ALL_CARDS: Card[] = [...CARDS, HR, OLD_TOOL];
const APPS = [ERP, CRM, HR];

/** The Application type with a hierarchy-label vocabulary (#1100). */
const APPLICATION_WITH_LABELS = makeCardType({
  ...APPLICATION_TYPE,
  hierarchy_labels: [
    makeOption({ key: "module", label: "Module of" }),
    makeOption({ key: "legacy", label: "Legacy of", hidden: true }),
  ],
});

/** Two types sharing one field set, so the multi-type "common fields" columns exist. */
const FLEET_FIELDS = [
  makeField({
    key: "grade",
    label: "Grade",
    type: "single_select",
    options: [makeOption({ key: "a", label: "Alpha", color: "#111111" })],
  }),
  makeField({
    key: "zones",
    label: "Zones",
    type: "multiple_select",
    options: [makeOption({ key: "n", label: "North" })],
  }),
  makeField({ key: "memo", label: "Memo", type: "text" }),
  makeField({ key: "site", label: "Site", type: "url" }),
  makeField({ key: "pct", label: "Pct", type: "percentage" }),
  makeField({ key: "since", label: "Since", type: "date" }),
  makeField({ key: "gadget", label: "Gadget", type: "ext.acme.gadget" }),
  makeField({ key: "price", label: "Price", type: "cost" }),
];
const VEHICLE_TYPE = makeCardType({
  key: "Vehicle",
  label: "Vehicle",
  fields_schema: [makeSection({ fields: FLEET_FIELDS })],
});
const VESSEL_TYPE = makeCardType({
  key: "Vessel",
  label: "Vessel",
  fields_schema: [makeSection({ fields: FLEET_FIELDS })],
});
const BUS = makeCard({
  type: "Vehicle",
  name: "Bus",
  attributes: { grade: "a", zones: ["n"], memo: "see https://fleet.example", site: "https://bus.example", pct: 40 },
});
const SHIP = makeCard({ type: "Vessel", name: "Ship", attributes: {} });

const STAKEHOLDER_ROLES: Record<string, { key: string; label: string }[]> = {
  Application: [
    { key: "applicationOwner", label: "Application Owner" },
    { key: "technicalApplicationOwner", label: "Technical Application Owner" },
  ],
  ITComponent: [{ key: "technicalOwner", label: "Technical Owner" }],
};

const REL_ERP_PG = {
  id: "7e1a0000-0000-4000-8000-000000000001",
  type: "relAppToITC",
  source_id: CARD_IDS.erp,
  target_id: CARD_IDS.postgres,
  source: { id: CARD_IDS.erp, type: "Application", name: "ERP Core" },
  target: { id: CARD_IDS.postgres, type: "ITComponent", name: "PostgreSQL" },
};

const PREFS_KEY = "turboea_inventory";

/**
 * `MaterialSymbol` renders the icon's ligature name as text, so an icon
 * button's accessible name is "<icon> <label>". The toolbar names are spelled
 * out in full because several dialogs carry an icon-less button of the same
 * label ("Archive", "Delete Permanently"), which the exact string keeps apart.
 */
const BTN = {
  massEdit: "edit Mass Edit",
  archive: "archive Archive",
  restore: "restore Restore",
  deleteForever: "delete_forever Delete Permanently",
  gridEdit: "edit_off Grid Edit",
  editing: "edit Editing",
  importCards: "upload Import",
  create: "add Create",
  exportMenu: "download Export arrow_drop_down",
  clearColumnFilters: "filter_alt_off Clear column filters",
} as const;

// A writable clipboard must exist before the first `userEvent.setup()`, which
// otherwise installs a getter-only property later installs would throw on.
installClipboard();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Answer `GET /cards?…` from a card list, honouring type / status / search. */
function scriptCards(cards: Card[]) {
  mockApi.on("get", /^\/cards\?/, (path) => {
    const q = new URLSearchParams(path.slice(path.indexOf("?") + 1));
    const type = q.get("type");
    const status = q.get("status");
    const search = (q.get("search") ?? "").toLowerCase();
    const items = cards.filter(
      (c) =>
        (type ? type.split(",").includes(c.type) : true) &&
        (status === "ARCHIVED" ? c.status === "ARCHIVED" : c.status !== "ARCHIVED") &&
        (search ? c.name.toLowerCase().includes(search) : true),
    );
    return cardPage(items);
  });
}

function CardPageProbe() {
  const { id } = useParams();
  return <div data-testid="card-page" data-card-id={id} />;
}

function renderInventory(path = "/inventory") {
  const user = userEvent.setup();
  const result = render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/cards/:id" element={<CardPageProbe />} />
      </Routes>
    </MemoryRouter>,
  );
  return { ...result, user };
}

/** Mount a cell renderer's JSX on its own, with the router the Name cell needs. */
function mount(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

const grid = () => screen.getByTestId("ag-grid");
const rowCount = () => grid().getAttribute("data-row-count");
const prefs = () => JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null");
const cardsCalls = () => mockApi.callsOf("get", /^\/cards\?/);
const lastCardsPath = () => cardsCalls()[cardsCalls().length - 1]?.path ?? "";

async function waitForRows(n: number) {
  await waitFor(() => expect(rowCount()).toBe(String(n)));
}

/** Push a sidebar filter change through the stub, the way a user would. */
async function applyFilters(user: ReturnType<typeof userEvent.setup>, patch: Record<string, unknown>) {
  holder.filters = patch;
  await user.click(screen.getByTestId("apply-filters"));
}

/** Select rows in the stub grid and let the page react. */
function selectRows(rows: Card[]) {
  act(() => {
    gridStub.selectRows(rows);
  });
}

/** Select every loaded row and open the Mass Edit dialog. */
async function openMassEdit(user: ReturnType<typeof userEvent.setup>, rows?: Card[]) {
  selectRows(rows ?? (gridStub.rows() as Card[]));
  await user.click(await screen.findByRole("button", { name: BTN.massEdit }));
  return screen.findByRole("dialog");
}

/** Pick a field in the Mass Edit dialog's first dropdown. */
async function chooseField(user: ReturnType<typeof userEvent.setup>, name: string | RegExp) {
  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getAllByRole("combobox")[0]);
  await user.click(await screen.findByRole("option", { name }));
}

async function apply(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^Apply to/ }));
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  gridStub.reset();
  localStorage.clear();
  holder.filters = {};
  holder.groupBy = null;
  holder.columnState = null;
  holder.columnFilters = null;
  holder.columns = null;
  holder.tagIds = [];
  holder.cardPick = null;
  vi.mocked(exportToExcel).mockClear();
  vi.mocked(exportCurrentViewToExcel).mockClear();

  withMetamodel(CARD_TYPES, RELATION_TYPES);
  hookState.auth.user = makeUser();

  mockApi.lenient({});
  mockApi.on("get", "/tag-groups", TAG_GROUPS);
  mockApi.on("get", "/users", USERS);
  mockApi.on("get", /^\/stakeholder-roles/, (path) => {
    const type = new URLSearchParams(path.slice(path.indexOf("?") + 1)).get("type_key") ?? "";
    return STAKEHOLDER_ROLES[type] ?? [];
  });
  mockApi.on("get", /^\/relations\?card_type=/, []);
  mockApi.on("get", /^\/relations\?type=/, []);
  mockApi.on("get", /^\/bookmarks/, []);
  mockApi.on("get", "/settings/archive-retention-days", { days: 30 });
  mockApi.on("get", /^\/eol\/card-status/, { items: {} });
  scriptCards(ALL_CARDS);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Loading, URL parameters and persisted preferences
// ---------------------------------------------------------------------------

describe("InventoryPage loading and URL parameters", () => {
  it("forwards the server-evaluated facets as request parameters", async () => {
    renderInventory(
      "/inventory?approval_status=APPROVED&show_archived=true&mine=stakeholder&orphaned=true&stale=true",
    );
    await waitFor(() => expect(cardsCalls().length).toBeGreaterThan(0));
    const path = cardsCalls()[0].path;
    expect(path).toContain("approval_status=APPROVED");
    expect(path).toContain("status=ARCHIVED");
    expect(path).toContain("mine=stakeholder");
    expect(path).toContain("orphaned=true");
    expect(path).toContain("stale=true");
    // Archived rows come back, and the Status column exists while they do.
    await waitForRows(2);
    expect(gridStub.colDef("core_status")).toBeDefined();
  });

  it("seeds attribute, relation and tag filters from a deep link", async () => {
    mockApi.on("get", /^\/relations\?card_type=/, [REL_ERP_PG]);
    renderInventory(
      `/inventory?type=Application&attr_businessCriticality=missionCritical&attr_regions=emea&attr_regions=amer&rel_ITComponent=PostgreSQL&tag=${ON_PREM.id}`,
    );
    // Only ERP is mission critical, in EMEA/AMER, linked to PostgreSQL and On-Prem.
    await waitForRows(1);
    expect(prefs().filters.attributes).toMatchObject({
      businessCriticality: ["missionCritical"],
      regions: ["emea", "amer"],
    });
    expect(prefs().filters.tagIds).toEqual([ON_PREM.id]);
  });

  it("lets an attribute-only deep link win over the persisted filters", async () => {
    // No type/search/… in the URL: the attr_ key alone marks it as a deep link.
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ filters: { types: ["ITComponent"], search: "ignored" } }),
    );
    renderInventory("/inventory?attr_businessCriticality=missionCritical");
    await waitFor(() => expect(cardsCalls().length).toBeGreaterThan(0));
    expect(cardsCalls()[0].path).not.toContain("type=");
    expect(cardsCalls()[0].path).not.toContain("search=");
    // Without a selected type the value stays a scalar, applied as a text match.
    await waitFor(() =>
      expect(prefs().filters.attributes).toEqual({ businessCriticality: "missionCritical" }),
    );
    await waitForRows(1);
  });

  it("survives malformed persisted preferences", async () => {
    localStorage.setItem(PREFS_KEY, "{not json");
    renderInventory();
    await waitForRows(ALL_CARDS.filter((c) => c.status !== "ARCHIVED").length);
  });

  it("migrates a column selection saved before core columns were togglable", async () => {
    // No core_* keys and no coreTagsMerged flag: the core set and the Tags
    // column are merged in so the user keeps seeing what they always saw.
    localStorage.setItem(PREFS_KEY, JSON.stringify({ columns: ["attr_coverage"] }));
    renderInventory("/inventory?type=Application");
    await waitForRows(3);
    expect(gridStub.colDef("core_tags")?.hide).toBe(false);
    expect(gridStub.colDef("core_lifecycle")?.hide).toBe(false);
    expect(gridStub.colDef("core_type")?.hide).toBe(false);
    expect(gridStub.colDef("attr_coverage")?.hide).toBe(false);
    // Not in the saved set and not a core column: stays hidden.
    expect(gridStub.colDef("attr_notes")?.hide).toBe(true);
    await waitFor(() => expect(prefs().coreTagsMerged).toBe(true));
  });

  it("keeps the Tags column hidden when the migration already ran", async () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ columns: ["core_type", "core_name"], coreTagsMerged: true }),
    );
    renderInventory("/inventory?type=Application");
    await waitForRows(3);
    expect(gridStub.colDef("core_tags")?.hide).toBe(true);
    expect(gridStub.colDef("core_name")?.hide).toBe(false);
  });

  it("carries freezes and order over from a layout saved before they had their own prefs", async () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        columnState: [
          { colId: "core_name", pinned: "left", width: 220, hide: false },
          { colId: "core_type", pinned: null, width: 140, hide: false },
        ],
      }),
    );
    renderInventory();
    await waitForRows(ALL_CARDS.filter((c) => c.status !== "ARCHIVED").length);
    expect(gridStub.colDef("core_name")?.pinned).toBe("left");
    const ids = gridStub.colDefs().map((c) => c.colId ?? c.field);
    // Name leads, and precedes Type as the saved layout said; a column the
    // layout never saw (Logo) keeps its natural place next to Name.
    expect(ids[0]).toBe("core_name");
    expect(ids.indexOf("core_name")).toBeLessThan(ids.indexOf("core_type"));
  });

  it("restores a saved sort through the grid's initial state", async () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ sortModel: [{ colId: "core_name", sort: "desc" }] }),
    );
    renderInventory();
    await waitFor(() => expect(gridStub.lastProps()).not.toBeNull());
    expect(gridStub.lastProps().initialState).toEqual({
      sort: { sortModel: [{ colId: "core_name", sort: "desc" }] },
    });
  });

  it("drops a persisted search the URL no longer carries", async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ filters: { types: [], search: "SAP" } }));
    renderInventory();
    await waitFor(() => expect(prefs().filters.search).toBe(""));
    await waitFor(() => expect(lastCardsPath()).not.toContain("search="));
  });

  it("opens the create dialog from ?create=true and clears the URL on close", async () => {
    const { user } = renderInventory("/inventory?create=true&type=Application&search=ERP");
    const dialog = await screen.findByTestId("create-dialog");
    expect(dialog).toHaveAttribute("data-initial-type", "Application");
    await waitFor(() => expect(lastCardsPath()).toContain("search=ERP"));
    await user.click(screen.getByTestId("create-close"));
    await waitFor(() => expect(screen.queryByTestId("create-dialog")).toBeNull());
    // Closing clears the URL; the page re-syncs its search from the (now empty)
    // ?search= while the type filter it already holds stays in effect.
    await waitFor(() => expect(lastCardsPath()).not.toContain("search="));
    expect(lastCardsPath()).toContain("type=Application");
    expect(prefs().filters.search).toBe("");
  });

  it("creates a card through the dialog and reloads", async () => {
    mockApi.on("post", "/cards", { id: "ca4d0000-0000-4000-8000-0000000000aa" });
    const { user } = renderInventory();
    await waitForRows(ALL_CARDS.filter((c) => c.status !== "ARCHIVED").length);
    const before = cardsCalls().length;
    await user.click(screen.getByRole("button", { name: BTN.create }));
    await user.click(await screen.findByTestId("create-submit"));
    await waitFor(() =>
      expect(mockApi.callsOf("post", "/cards")[0]?.body).toEqual({
        type: "Application",
        name: "Brand New",
      }),
    );
    await waitFor(() => expect(cardsCalls().length).toBeGreaterThan(before));
  });

  it("shows an error with Retry when the load fails, and recovers", async () => {
    mockApi.fail("get", /^\/cards\?/, 500);
    const { user } = renderInventory();
    expect(await screen.findByText("An error occurred")).toBeInTheDocument();
    // A later registration wins: the retry lands.
    scriptCards(ALL_CARDS);
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitForRows(ALL_CARDS.filter((c) => c.status !== "ARCHIVED").length);
    await waitFor(() => expect(screen.queryByText("An error occurred")).toBeNull());
  });

  it("degrades to no stakeholder columns and empty relation cells when those fetches fail", async () => {
    mockApi.fail("get", /^\/stakeholder-roles/, 500);
    mockApi.fail("get", /^\/relations\?card_type=/, 500);
    renderInventory("/inventory?type=Application");
    await waitForRows(3);
    await waitFor(() =>
      expect(screen.getByTestId("filter-sidebar")).toHaveAttribute("data-stakeholder-roles", "0"),
    );
    expect(gridStub.colDef("stakeholder_applicationOwner")).toBeUndefined();
    expect(gridStub.cellValue("rel_ITComponent", ERP)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Group by
// ---------------------------------------------------------------------------

describe("InventoryPage group by", () => {
  it("groups by every axis the type offers", async () => {
    const { user } = renderInventory("/inventory?type=Application&group_by=subtype");
    // ERP: businessApplication, CRM: microservice, HR: not set → 3 headers + 3 members.
    await waitForRows(6);
    expect(screen.getByTestId("filter-sidebar")).toHaveAttribute("data-group-by", "subtype");

    const setAxis = async (axis: string | null, rows: number) => {
      holder.groupBy = axis;
      await user.click(screen.getByTestId("set-group-by"));
      await waitForRows(rows);
    };
    // ERP and CRM are active, HR has no lifecycle → 2 headers.
    await setAxis("lifecycle", 5);
    // APPROVED vs DRAFT, DRAFT → 2 headers.
    await setAxis("approval_status", 5);
    // 92 complete, 40 and 50 partial → 2 headers.
    await setAxis("data_quality", 5);
    // missionCritical, businessOperational, not set → 3 headers.
    await setAxis("attr_businessCriticality", 6);
    await setAxis(null, 3);
    expect(prefs().groupBy).toBeNull();
  });

  it("lands with only the deep-linked group expanded", async () => {
    renderInventory("/inventory?type=Application&group_by=subtype&expand_group=microservice");
    // 3 headers, but only the microservice member is in the row model.
    await waitForRows(4);
    const rows = gridStub.rows() as any[];
    const collapsedHeaders = rows.filter((r) => r.__group?.collapsed);
    expect(collapsedHeaders).toHaveLength(2);
    // getRowStyle: a header is never dimmed, an archived card is.
    const getRowStyle = gridStub.lastProps().getRowStyle;
    expect(getRowStyle({ data: rows[0] })).toBeUndefined();
    expect(getRowStyle({ data: ERP_ARCHIVED })).toEqual({ opacity: 0.6 });
    expect(getRowStyle({ data: ERP })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Client-side filtering
// ---------------------------------------------------------------------------

describe("InventoryPage client-side filters", () => {
  const ACTIVE_COUNT = ALL_CARDS.filter((c) => c.status !== "ARCHIVED").length;

  it("narrows to several types client-side", async () => {
    const { user } = renderInventory();
    await waitForRows(ACTIVE_COUNT);
    await applyFilters(user, { types: ["Application", "ITComponent"] });
    await waitForRows(5);
    // No single type → the request carries no type parameter.
    expect(lastCardsPath()).not.toContain("type=");
  });

  it("filters by subtype and lifecycle phase, with (empty) for cards lacking either", async () => {
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    await applyFilters(user, { subtypes: ["microservice"] });
    await waitForRows(1);
    await applyFilters(user, { subtypes: [EMPTY_VALUE] });
    await waitForRows(1);
    await applyFilters(user, { subtypes: [], lifecyclePhases: ["active"] });
    await waitForRows(2);
    await applyFilters(user, { lifecyclePhases: [EMPTY_VALUE] });
    await waitForRows(1);
  });

  it("matches attributes per field type", async () => {
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    // select: array of allowed keys, "(empty)" for cards without a value
    await applyFilters(user, { attributes: { businessCriticality: ["missionCritical"] } });
    await waitForRows(1);
    await applyFilters(user, { attributes: { businessCriticality: [EMPTY_VALUE] } });
    await waitForRows(1);
    await applyFilters(user, { attributes: { businessCriticality: [] } });
    await waitForRows(3);
    // multi-select: any overlap
    await applyFilters(user, { attributes: { regions: ["apac"] } });
    await waitForRows(1);
    // scalar "(empty)" from a deep link
    await applyFilters(user, { attributes: { coverage: EMPTY_VALUE } });
    await waitForRows(1);
    // number: minimum
    await applyFilters(user, { attributes: { coverage: "50" } });
    await waitForRows(1);
    // boolean: string comparison
    await applyFilters(user, { attributes: { isCloud: "true" } });
    await waitForRows(1);
    // text: case-insensitive contains
    await applyFilters(user, { attributes: { notes: "WIKI.EXAMPLE" } });
    await waitForRows(1);
    // exact-match fallback for anything else
    await applyFilters(user, { attributes: { isCloud: "maybe" } });
    await waitForRows(0);
  });

  it("filters by relation, by relation-type key and by the related card type", async () => {
    mockApi.on("get", /^\/relations\?card_type=/, [REL_ERP_PG]);
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    await waitFor(() => expect(gridStub.cellValue("rel_ITComponent", ERP)).toBe("PostgreSQL"));
    await applyFilters(user, { relations: { relAppToITC: ["PostgreSQL"] } });
    await waitForRows(1);
    await applyFilters(user, { relations: { relAppToITC: [EMPTY_VALUE] } });
    await waitForRows(2);
    await applyFilters(user, { relations: { relAppToITC: [] } });
    await waitForRows(3);
    // A deep link keyed by the related card type resolves to the union across its types.
    await applyFilters(user, { relations: { ITComponent: ["PostgreSQL"] } });
    await waitForRows(1);
    // An unknown key matches nothing but "(empty)".
    await applyFilters(user, { relations: { relNope: ["PostgreSQL"] } });
    await waitForRows(0);
  });

  it("ORs tags within a group and ANDs across groups", async () => {
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    await waitFor(() =>
      expect(screen.getByTestId("filter-sidebar")).toHaveAttribute("data-tag-groups", "2"),
    );
    await applyFilters(user, { tagIds: [ON_PREM.id] });
    await waitForRows(1);
    await applyFilters(user, { tagIds: [ON_PREM.id, CLOUD.id] });
    await waitForRows(2);
    // "(empty)" for the Hosting group: HR carries no hosting tag.
    await applyFilters(user, { tagIds: [`${EMPTY_VALUE}:${HOSTING_GROUP.id}`] });
    await waitForRows(1);
    // Every app lacks a Risk tag, so the Risk "(empty)" ANDed with On-Prem is ERP alone.
    await applyFilters(user, { tagIds: [ON_PREM.id, `${EMPTY_VALUE}:${RISK_GROUP.id}`] });
    await waitForRows(1);
    // An id that belongs to no group is ignored.
    await applyFilters(user, { tagIds: ["7a600000-0000-4000-8000-0000000000ff"] });
    await waitForRows(3);
  });
});

// ---------------------------------------------------------------------------
// Mass edit
// ---------------------------------------------------------------------------

describe("InventoryPage mass edit — approval status", () => {
  it("reports mandatory-field blockers per card and keeps the dialog open", async () => {
    mockApi.on("post", /\/approval-status\?action=approve$/, {});
    mockApi.fail("post", `/cards/${CARD_IDS.crm}/approval-status?action=approve`, 400, {
      code: "approval_blocked_mandatory_missing",
      missing_relations: [{ label: "supports Business Capability" }],
      missing_tag_groups: [{ name: "Hosting" }],
    });
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    const before = cardsCalls().length;
    await openMassEdit(user);
    await chooseField(user, "Approval Status");
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getAllByRole("combobox")[1]);
    await user.click(await screen.findByRole("option", { name: "Approved" }));
    await apply(user);

    expect(
      await screen.findByText("2 updated, 1 blocked. Resolve the items below and retry."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/missing relation: supports Business Capability; missing tag group: Hosting/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "CRM Cloud" })).toHaveAttribute(
      "href",
      `/cards/${CARD_IDS.crm}`,
    );
    // Every approve ran, and the grid reloaded regardless.
    expect(mockApi.callsOf("post", /\/approval-status/)).toHaveLength(3);
    expect(cardsCalls().length).toBeGreaterThan(before);

    // Dismissing the summary clears it without closing the dialog.
    const alert = screen.getByText(/2 updated, 1 blocked/).closest(".MuiAlert-root")!;
    await user.click(within(alert).getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.queryByText(/2 updated, 1 blocked/)).toBeNull());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("reports any other failure by its message", async () => {
    mockApi.on("post", /\/approval-status\?action=reject$/, {});
    mockApi.fail("post", `/cards/${CARD_IDS.erp}/approval-status?action=reject`, 500, "boom");
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    await openMassEdit(user, [ERP, CRM]);
    await chooseField(user, "Approval Status");
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getAllByRole("combobox")[1]);
    await user.click(await screen.findByRole("option", { name: "Rejected" }));
    await apply(user);

    expect(await screen.findByText(/1 updated, 1 blocked/)).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`POST /cards/${CARD_IDS.erp}/approval-status\\?action=reject failed`)),
    ).toBeInTheDocument();
  });

  it("closes the dialog when every card went through", async () => {
    mockApi.on("post", /\/approval-status\?action=reset$/, {});
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    await openMassEdit(user, [ERP]);
    await chooseField(user, "Approval Status");
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getAllByRole("combobox")[1]);
    await user.click(await screen.findByRole("option", { name: "Draft" }));
    await apply(user);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockApi.callsOf("post", /\/approval-status/).map((c) => c.path)).toEqual([
      `/cards/${CARD_IDS.erp}/approval-status?action=reset`,
    ]);
  });
});

describe("InventoryPage mass edit — relations", () => {
  /** Open the dialog on the given rows and pick the "uses → IT Component" field. */
  async function openRelationField(user: ReturnType<typeof userEvent.setup>, rows: Card[]) {
    await openMassEdit(user, rows);
    await chooseField(user, "uses → IT Component");
    return screen.getByRole("dialog");
  }

  /** Pick a target in the relation Autocomplete, which browses on open. */
  async function pickTarget(user: ReturnType<typeof userEvent.setup>, name: string) {
    await user.click(screen.getByRole("combobox", { name: "IT Component cards" }));
    await user.click(await screen.findByRole("option", { name }));
  }

  it("refuses to apply without a target", async () => {
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    await openRelationField(user, [ERP, CRM]);
    await apply(user);
    expect(await screen.findByText("Select at least one card to link to.")).toBeInTheDocument();
  });

  it("adds a link to every selected card that lacks it, never to itself twice", async () => {
    mockApi.on("get", /^\/relations\?type=relAppToITC/, [REL_ERP_PG]);
    mockApi.on("post", "/relations", {});
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    const dialog = await openRelationField(user, [ERP, CRM]);
    await pickTarget(user, "PostgreSQL");
    // The chosen target renders as a chip, and reads as selected when the
    // list is opened again.
    expect(within(dialog).getByText("PostgreSQL")).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "IT Component cards" }));
    expect(await screen.findByRole("option", { name: "PostgreSQL" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.keyboard("{Escape}");
    expect(within(dialog).getByText(/Each of the 2 selected cards will be linked/)).toBeInTheDocument();
    await apply(user);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // ERP is already linked → skipped; CRM gets the new row, stored source → target.
    expect(mockApi.callsOf("post", "/relations").map((c) => c.body)).toEqual([
      { type: "relAppToITC", source_id: CARD_IDS.crm, target_id: CARD_IDS.postgres },
    ]);
    // The relation fetch for the grid ran again after the write.
    expect(mockApi.callsOf("get", /^\/relations\?card_type=/).length).toBeGreaterThanOrEqual(2);
  });

  it("tells the user when every selected card is already linked", async () => {
    mockApi.on("get", /^\/relations\?type=relAppToITC/, [REL_ERP_PG]);
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    await openRelationField(user, [ERP]);
    await pickTarget(user, "PostgreSQL");
    await apply(user);
    expect(
      await screen.findByText("Every selected card is already linked to the chosen targets."),
    ).toBeInTheDocument();
    expect(mockApi.callsOf("post", "/relations")).toHaveLength(0);
  });

  it("removes the matching links, and says so when there are none", async () => {
    mockApi.on("get", /^\/relations\?type=relAppToITC/, [REL_ERP_PG]);
    mockApi.on("delete", /^\/relations\//, {});
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    const dialog = await openRelationField(user, [CRM]);
    await user.click(within(dialog).getByRole("button", { name: /Remove link$/ }));
    await pickTarget(user, "PostgreSQL");
    expect(within(dialog).getByText(/Any matching link between the selected card/)).toBeInTheDocument();
    await apply(user);
    expect(
      await screen.findByText("None of the selected cards are linked to the chosen targets."),
    ).toBeInTheDocument();

    // Now with ERP, which holds the link.
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const dialog2 = await openRelationField(user, [ERP, CRM]);
    await user.click(within(dialog2).getByRole("button", { name: /Remove link$/ }));
    await pickTarget(user, "PostgreSQL");
    await apply(user);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockApi.callsOf("delete", `/relations/${REL_ERP_PG.id}`)).toHaveLength(1);
  });

  it("aggregates write failures per card", async () => {
    mockApi.on("get", /^\/relations\?type=relAppToITC/, [REL_ERP_PG]);
    mockApi.fail("post", "/relations", 409, "already there");
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    await openRelationField(user, [ERP, CRM]);
    await pickTarget(user, "PostgreSQL");
    await apply(user);
    // ERP had nothing to do (counts as succeeded); CRM's write failed.
    expect(await screen.findByText(/1 updated, 1 blocked/)).toBeInTheDocument();
    expect(screen.getByText(/POST \/relations failed/)).toBeInTheDocument();
  });

  it("falls back to an empty relation set when the pre-fetch fails", async () => {
    mockApi.fail("get", /^\/relations\?type=relAppToITC/, 500);
    mockApi.on("post", "/relations", {});
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    await openRelationField(user, [ERP]);
    await pickTarget(user, "PostgreSQL");
    await apply(user);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockApi.callsOf("post", "/relations")).toHaveLength(1);
  });

  it("searches the target list as the user types and pages on scroll", async () => {
    // A browse page that is deliberately not the whole set, so "more" exists.
    mockApi.on("get", /^\/cards\?page=/, (path) => {
      const q = new URLSearchParams(path.slice(path.indexOf("?") + 1));
      return q.get("page") === "2"
        ? cardPage([], { total: 10, page: 2 })
        : cardPage([POSTGRES, LINUX], { total: 10 });
    });
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    await openRelationField(user, [ERP]);

    const input = screen.getByRole("combobox", { name: "IT Component cards" });
    await user.type(input, "Post");
    await waitFor(() =>
      expect(mockApi.callsOf("get", /^\/cards\?page=.*search=Post/).length).toBeGreaterThan(0),
    );

    const listbox = await screen.findByRole("listbox");
    Object.defineProperty(listbox, "scrollHeight", { value: 600, configurable: true });
    Object.defineProperty(listbox, "clientHeight", { value: 300, configurable: true });
    listbox.scrollTop = 300;
    fireEvent.scroll(listbox);
    await waitFor(() =>
      expect(mockApi.callsOf("get", /^\/cards\?page=2/).length).toBeGreaterThan(0),
    );
  });
});

describe("InventoryPage mass edit — tags, subtype, parent, attributes", () => {
  it("insists on at least one tag", async () => {
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    await openMassEdit(user, [ERP, CRM]);
    await chooseField(user, "Tags");
    await apply(user);
    const message = await screen.findByText("Pick at least one tag.");
    const alert = message.closest(".MuiAlert-root")!;
    await user.click(within(alert).getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.queryByText("Pick at least one tag.")).toBeNull());
    // Escape closes the dialog itself; the selection stays. (Closing the alert
    // dropped focus to the body, so the key is sent to the dialog directly.)
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("2 cards selected")).toBeInTheDocument();
  });

  it("adds the chosen tags to every selected card", async () => {
    mockApi.on("post", /\/tags$/, {});
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    await openMassEdit(user, [ERP, CRM]);
    await chooseField(user, "Tags");
    holder.tagIds = [CLOUD.id];
    await user.click(screen.getByTestId("pick-tags"));
    expect(screen.getByTestId("tag-picker")).toHaveAttribute("data-value", CLOUD.id);
    expect(screen.getByText(/Each of the 2 selected cards will be tagged/)).toBeInTheDocument();
    await apply(user);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockApi.callsOf("post", /\/tags$/)).toEqual([
      { method: "post", path: `/cards/${CARD_IDS.erp}/tags`, body: [CLOUD.id] },
      { method: "post", path: `/cards/${CARD_IDS.crm}/tags`, body: [CLOUD.id] },
    ]);
  });

  it("removes the chosen tags one by one, reporting the cards that refused", async () => {
    mockApi.on("delete", /\/tags\//, {});
    mockApi.fail("delete", `/cards/${CARD_IDS.crm}/tags/${ON_PREM.id}`, 403, "denied");
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    const dialog = await openMassEdit(user, [ERP, CRM]);
    await chooseField(user, "Tags");
    await user.click(within(dialog).getByRole("button", { name: /Remove tags$/ }));
    holder.tagIds = [ON_PREM.id, CLOUD.id];
    await user.click(screen.getByTestId("pick-tags"));
    expect(screen.getByText(/Any matching tag will be removed from the 2 selected cards/)).toBeInTheDocument();
    await apply(user);
    expect(await screen.findByText(/1 updated, 1 blocked/)).toBeInTheDocument();
    expect(mockApi.callsOf("delete", /\/tags\//).map((c) => c.path).sort()).toEqual(
      [
        `/cards/${CARD_IDS.erp}/tags/${ON_PREM.id}`,
        `/cards/${CARD_IDS.erp}/tags/${CLOUD.id}`,
        `/cards/${CARD_IDS.crm}/tags/${ON_PREM.id}`,
        `/cards/${CARD_IDS.crm}/tags/${CLOUD.id}`,
      ].sort(),
    );
  });

  it("writes a subtype through the bulk endpoint", async () => {
    mockApi.on("patch", "/cards/bulk", {});
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    const dialog = await openMassEdit(user, [ERP, CRM]);
    await chooseField(user, "Subtype");
    await user.click(within(dialog).getAllByRole("combobox")[1]);
    await user.click(await screen.findByRole("option", { name: "Microservice" }));
    await apply(user);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockApi.callsOf("patch", "/cards/bulk")[0].body).toEqual({
      ids: [CARD_IDS.erp, CARD_IDS.crm],
      updates: { subtype: "microservice" },
    });
  });

  it("surfaces a bulk failure as the dialog's error", async () => {
    mockApi.fail("patch", "/cards/bulk", 500, "boom");
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    const dialog = await openMassEdit(user, [ERP]);
    await chooseField(user, "Subtype");
    await user.click(within(dialog).getAllByRole("combobox")[1]);
    // "None" clears the subtype.
    await user.click(await screen.findByRole("option", { name: "None" }));
    await apply(user);
    expect(await screen.findByText("PATCH /cards/bulk failed")).toBeInTheDocument();
    expect(mockApi.callsOf("patch", "/cards/bulk")[0].body).toEqual({
      ids: [CARD_IDS.erp],
      updates: { subtype: null },
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("asks for a parent before setting one, then re-parents each card", async () => {
    mockApi.on("patch", /^\/cards\//, {});
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    const dialog = await openMassEdit(user, [ERP, CRM]);
    await chooseField(user, "Parent");
    expect(within(dialog).getByText(/Each of the 2 selected cards will be moved under/)).toBeInTheDocument();
    await apply(user);
    expect(await screen.findByText("Pick a parent card.")).toBeInTheDocument();

    const picker = screen.getByTestId("card-picker");
    expect(picker).toHaveAttribute("data-label", "Search Application");
    expect(picker).toHaveAttribute("data-exclude", `${CARD_IDS.erp},${CARD_IDS.crm}`);
    holder.cardPick = { id: HR.id, name: HR.name, type: "Application" };
    await user.click(screen.getByTestId("pick-card"));
    await apply(user);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockApi.callsOf("patch", /^\/cards\//).map((c) => [c.path, c.body])).toEqual([
      [`/cards/${CARD_IDS.erp}`, { parent_id: HR.id }],
      [`/cards/${CARD_IDS.crm}`, { parent_id: HR.id }],
    ]);
  });

  it("reports the cards whose attribute write failed", async () => {
    mockApi.on("patch", /^\/cards\//, {});
    mockApi.fail("patch", `/cards/${CARD_IDS.crm}`, 422, "required");
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    const dialog = await openMassEdit(user, [ERP, CRM, HR]);
    await chooseField(user, "Cloud Hosted");
    await user.click(within(dialog).getByRole("checkbox"));
    await apply(user);
    expect(await screen.findByText(/2 updated, 1 blocked/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`PATCH /cards/${CARD_IDS.crm} failed`))).toBeInTheDocument();
    // The merge keeps every other attribute of the card.
    const erpPatch = mockApi.callsOf("patch", `/cards/${CARD_IDS.erp}`)[0].body as any;
    expect(erpPatch.attributes).toMatchObject({ ...ERP.attributes, isCloud: true });
  });

  it("resets the field-specific state when another field is picked", async () => {
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    await openMassEdit(user, [ERP]);
    await chooseField(user, "Tags");
    holder.tagIds = [CLOUD.id];
    await user.click(screen.getByTestId("pick-tags"));
    await chooseField(user, "Parent");
    expect(screen.queryByTestId("tag-picker")).toBeNull();
    await chooseField(user, "Tags");
    expect(screen.getByTestId("tag-picker")).toHaveAttribute("data-value", "");
  });
});

// ---------------------------------------------------------------------------
// Archive / delete / restore
// ---------------------------------------------------------------------------

describe("InventoryPage archive, delete and restore", () => {
  it("archives a selection through the bulk dialog and clears the selection", async () => {
    mockApi.on("post", "/cards/bulk-archive", {
      requested: 2,
      archived_card_ids: [],
      cascaded_card_ids: [],
      skipped: [],
    });
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    selectRows([ERP, CRM]);
    expect(await screen.findByText("2 cards selected")).toBeInTheDocument();
    const before = cardsCalls().length;
    await user.click(screen.getByRole("button", { name: BTN.archive }));
    let dialog = await screen.findByRole("dialog", { name: "Archive 2 Cards" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("2 cards selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: BTN.archive }));
    dialog = await screen.findByRole("dialog", { name: "Archive 2 Cards" });
    // Nothing can be submitted until a child strategy is chosen.
    const submit = within(dialog).getByRole("button", { name: "Archive" });
    expect(submit).toBeDisabled();
    await user.click(within(dialog).getByRole("radio", { name: "Archive all descendants too" }));
    await user.click(submit);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockApi.callsOf("post", "/cards/bulk-archive")[0].body).toEqual({
      card_ids: [CARD_IDS.erp, CARD_IDS.crm],
      child_strategy: "cascade",
      cascade_all_related: false,
    });
    await waitFor(() => expect(screen.queryByText("2 cards selected")).toBeNull());
    expect(gridStub.api().getSelectedRows()).toEqual([]);
    expect(cardsCalls().length).toBeGreaterThan(before);
  });

  it("archives a single card through the impact dialog, or cancels", async () => {
    mockApi.on("get", `/cards/${CARD_IDS.erp}/archive-impact`, {
      child_count: 0,
      descendant_count: 0,
      approved_descendant_count: 0,
      grandparent: null,
      children: [],
      related_cards: [],
    });
    mockApi.on("post", `/cards/${CARD_IDS.erp}/archive`, {});
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    selectRows([ERP]);
    expect(await screen.findByText("1 card selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: BTN.archive }));
    let dialog = await screen.findByRole("dialog", { name: "Archive Card" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("1 card selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: BTN.archive }));
    dialog = await screen.findByRole("dialog", { name: "Archive Card" });
    expect(await within(dialog).findByText(/Are you sure you want to archive/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockApi.callsOf("post", `/cards/${CARD_IDS.erp}/archive`)).toHaveLength(1);
    await waitFor(() => expect(screen.queryByText("1 card selected")).toBeNull());
  });

  it("deletes archived cards permanently, in bulk or one at a time", async () => {
    mockApi.on("post", "/cards/bulk-delete", {
      requested: 2,
      deleted_card_ids: [],
      cascaded_card_ids: [],
      skipped: [],
    });
    mockApi.on("get", `/cards/${CARD_IDS.erpArchived}/archive-impact`, {
      child_count: 0,
      descendant_count: 0,
      approved_descendant_count: 0,
      grandparent: null,
      children: [],
      related_cards: [],
    });
    mockApi.on("delete", `/cards/${CARD_IDS.erpArchived}`, {});
    const { user } = renderInventory("/inventory?show_archived=true");
    await waitForRows(2);
    expect(screen.queryByRole("button", { name: BTN.archive })).toBeNull();

    selectRows([ERP_ARCHIVED, OLD_TOOL]);
    await user.click(await screen.findByRole("button", { name: BTN.deleteForever }));
    let dialog = await screen.findByRole("dialog", { name: "Permanently Delete 2 Cards" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await user.click(screen.getByRole("button", { name: BTN.deleteForever }));
    dialog = await screen.findByRole("dialog", { name: "Permanently Delete 2 Cards" });
    await user.click(within(dialog).getByRole("radio", { name: "Delete all descendants too" }));
    await user.click(within(dialog).getByRole("button", { name: "Delete Permanently" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockApi.callsOf("post", "/cards/bulk-delete")[0].body).toEqual({
      card_ids: [CARD_IDS.erpArchived, OLD_TOOL.id],
      child_strategy: "cascade",
      cascade_all_related: false,
    });

    // One card: the single-card dialog, and the card's own DELETE route.
    selectRows([ERP_ARCHIVED]);
    await user.click(await screen.findByRole("button", { name: BTN.deleteForever }));
    dialog = await screen.findByRole("dialog", { name: "Permanently Delete Card" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(screen.getByRole("button", { name: BTN.deleteForever }));
    dialog = await screen.findByRole("dialog", { name: "Permanently Delete Card" });
    await within(dialog).findByText(/Are you sure you want to permanently delete/);
    await user.click(within(dialog).getByRole("button", { name: "Delete Permanently" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockApi.callsOf("delete", `/cards/${CARD_IDS.erpArchived}`)).toHaveLength(1);
  });

  it("restores a selection of archived cards", async () => {
    mockApi.on("post", "/cards/bulk-restore", {
      requested: 2,
      restored_card_ids: [],
      skipped: [],
    });
    const { user } = renderInventory("/inventory?show_archived=true");
    await waitForRows(2);
    selectRows([ERP_ARCHIVED, OLD_TOOL]);
    await user.click(await screen.findByRole("button", { name: BTN.restore }));
    let dialog = await screen.findByRole("dialog", { name: "Restore 2 cards" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await user.click(screen.getByRole("button", { name: BTN.restore }));
    dialog = await screen.findByRole("dialog", { name: "Restore 2 cards" });
    await user.click(within(dialog).getByRole("button", { name: BTN.restore }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockApi.callsOf("post", "/cards/bulk-restore")[0].body).toEqual({
      card_ids: [CARD_IDS.erpArchived, OLD_TOOL.id],
    });
    await waitFor(() => expect(screen.queryByText("2 cards selected")).toBeNull());
  });

  it("clears the selection from the toolbar", async () => {
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    selectRows([ERP, CRM]);
    await user.click(await screen.findByRole("button", { name: "Clear Selection" }));
    expect(gridStub.api().getSelectedRows()).toEqual([]);
  });

  it("hides the destructive buttons from a user without the permissions", async () => {
    hookState.auth.user = makeUser({ permissions: { "inventory.view": true } });
    renderInventory("/inventory?show_archived=true");
    await waitForRows(2);
    selectRows([ERP_ARCHIVED]);
    expect(await screen.findByText("1 card selected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: BTN.restore })).toBeNull();
    expect(screen.queryByRole("button", { name: BTN.deleteForever })).toBeNull();
    expect(screen.queryByRole("button", { name: BTN.create })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

describe("InventoryPage column definitions", () => {
  it("renders the core cells", async () => {
    renderInventory("/inventory?type=Application");
    await waitForRows(3);

    const type = gridStub.colDef("core_type");
    mount(type.cellRenderer({ value: "Application" }));
    expect(screen.getByText("Application")).toBeInTheDocument();
    expect(type.cellRenderer({ value: "Nope" })).toBe("Nope");

    const subtype = gridStub.colDef("core_subtype");
    mount(subtype.cellRenderer({ value: "microservice" }));
    expect(screen.getByText("Microservice")).toBeInTheDocument();
    expect(subtype.cellRenderer({ value: "" })).toBe("");
    mount(subtype.cellRenderer({ value: "gone" }));
    expect(screen.getByText("gone")).toBeInTheDocument();

    const lifecycle = gridStub.colDef("core_lifecycle");
    expect(lifecycle.cellRenderer({ data: { lifecycle: undefined } })).toBe("");
    mount(lifecycle.cellRenderer({ data: ERP }));

    const approval = gridStub.colDef("core_approval_status");
    mount(approval.cellRenderer({ value: "APPROVED" }));
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(approval.cellRenderer({ value: "NONSENSE" })).toBe("");

    const dq = gridStub.colDef("core_data_quality");
    mount(dq.cellRenderer({ value: 92 }));

    const tags = gridStub.colDef("core_tags");
    mount(tags.cellRenderer({ value: ERP.tags }));
    expect(screen.getByText("On-Prem")).toBeInTheDocument();
    expect(tags.cellRenderer({ value: undefined })).toBeTruthy();
    const row = { ...ERP, tags: [] };
    expect(tags.valueSetter({ data: row, newValue: [CLOUD] })).toBe(true);
    expect(row.tags).toEqual([CLOUD]);
    expect(tags.valueSetter({ data: row, newValue: undefined })).toBe(true);
    expect(row.tags).toEqual([]);
    expect(tags.filterValueGetter({ data: ERP })).toBe("On-Prem");
  });

  it("renders the status cells when archived cards are shown", async () => {
    renderInventory("/inventory?show_archived=true");
    await waitForRows(2);
    const status = gridStub.colDef("core_status");
    mount(status.cellRenderer({ value: "ARCHIVED" }));
    expect(screen.getByText("Archived")).toBeInTheDocument();
    mount(status.cellRenderer({ value: "ACTIVE" }));
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("previews a card from the Name cell and keeps modifier-clicks for the browser", async () => {
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    const name = gridStub.colDef("core_name");
    expect(name.cellRenderer({ data: undefined, value: "x" })).toBe("x");
    expect(name.cellRenderer({ data: undefined, value: undefined })).toBe("");

    const rowClick = vi.fn();
    mount(<div onClick={rowClick}>{name.cellRenderer({ data: ERP, value: ERP.name })}</div>);
    await user.click(screen.getByRole("button", { name: "Preview card" }));
    // The preview button neither bubbles to the row nor follows the link.
    expect(rowClick).not.toHaveBeenCalled();
    expect(await screen.findByTestId("card-preview")).toHaveAttribute("data-card-id", CARD_IDS.erp);
    await user.click(screen.getByTestId("preview-close"));
    await waitFor(() => expect(screen.queryByTestId("card-preview")).toBeNull());

    const link = screen.getByRole("link", { name: "ERP Core" });
    expect(link).toHaveAttribute("href", `/cards/${CARD_IDS.erp}`);
    // A modifier-click or middle-click stops at the link: the row never sees
    // it. The router leaves those to the browser, which jsdom cannot honour,
    // so their default is cancelled on the link itself (the target phase runs
    // before React's root listener, and the cell's stopPropagation would keep
    // a document-level guard from ever running).
    const quiet = (e: Event) => e.preventDefault();
    link.addEventListener("click", quiet);
    try {
      fireEvent.click(link, { ctrlKey: true });
      fireEvent.click(link, { metaKey: true });
      fireEvent.click(link, { shiftKey: true });
      fireEvent.click(link, { button: 1 });
    } finally {
      link.removeEventListener("click", quiet);
    }
    expect(rowClick).not.toHaveBeenCalled();
    // A plain click reaches the row, which is what navigates to the card.
    fireEvent.click(link);
    expect(rowClick).toHaveBeenCalledTimes(1);
  });

  it("resolves the Parent column through the loaded rows", async () => {
    renderInventory("/inventory?type=Application");
    await waitForRows(3);
    const parent = gridStub.colDef("core_parent");
    await waitFor(() => expect(parent.valueFormatter({ value: CARD_IDS.erp })).toBe("ERP Core"));
    expect(gridStub.colDef("core_parent").filterValueGetter({ data: HR })).toBe("ERP Core");
    expect(gridStub.colDef("core_parent").filterValueGetter({ data: undefined })).toBe("");
    expect(gridStub.colDef("core_parent").comparator(CARD_IDS.erp, null)).toBeGreaterThan(0);
    const params = gridStub.colDef("core_parent").cellEditorParams({ data: ERP });
    expect(params.typeKey).toBe("Application");
    // ERP and its child HR are both excluded as parents of ERP.
    expect(params.excludeIds).toEqual([CARD_IDS.erp, HR.id]);
    expect(params.currentParent).toBeNull();
    expect(gridStub.colDef("core_parent").cellEditorParams({ data: HR }).currentParent?.name).toBe(
      "ERP Core",
    );
    expect(gridStub.cellValue("core_path", HR)).toBe("ERP Core");
  });

  it("builds the Link type column from the type's hierarchy labels", async () => {
    withMetamodel([APPLICATION_WITH_LABELS, ...CARD_TYPES.slice(2)], RELATION_TYPES);
    renderInventory("/inventory?type=Application");
    await waitForRows(3);
    const col = gridStub.colDef("core_parent_label");
    expect(col).toBeDefined();
    expect(col.headerName).toBe("Link type");
    // Hidden options are not offered, but the dropdown reads as labels.
    expect(col.cellEditorParams.values).toEqual(["", "module"]);
    expect(col.cellEditorParams.formatValue("module")).toBe("Module of");
    expect(col.cellEditorParams.formatValue("")).toBe("");
    expect(col.filterValueGetter({ data: HR })).toBe("Module of");
    expect(col.filterValueGetter({ data: undefined })).toBe("");
    expect(col.valueFormatter({ value: "module" })).toBe("Module of");
    expect(col.valueFormatter({ value: "unknown" })).toBe("unknown");
    expect(col.comparator("module", "legacy")).toBeGreaterThan(0);
    expect(col.cellRenderer({ value: null })).toBeNull();
    mount(col.cellRenderer({ value: "module" }));
    expect(screen.getByText("Module of")).toBeInTheDocument();
    mount(col.cellRenderer({ value: "stale" }));
    expect(screen.getByText("stale")).toBeInTheDocument();
    expect(gridStub.colDef("core_parent_label").editable).toBe(false);
  });

  it("renders attribute cells: select chips, percentages, free text and URLs", async () => {
    renderInventory("/inventory?type=Application");
    await waitForRows(3);

    const crit = gridStub.colDef("attr_businessCriticality");
    mount(crit.cellRenderer({ value: "missionCritical" }));
    expect(screen.getByText("Mission Critical")).toBeInTheDocument();
    expect(crit.cellRenderer({ value: "nope" })).toBe("nope");
    expect(crit.cellRenderer({ value: "" })).toBe("");
    const bare = { ...ERP, attributes: undefined } as any;
    expect(crit.valueSetter({ data: bare, newValue: "businessCritical" })).toBe(true);
    expect(bare.attributes).toEqual({ businessCriticality: "businessCritical" });

    const coverage = gridStub.colDef("attr_coverage");
    expect(coverage.valueFormatter({ value: 75 })).toBe("75%");
    expect(coverage.valueFormatter({ value: "" })).toBe("");
    expect(coverage.valueFormatter({ value: null })).toBe("");
    expect(coverage.cellRenderer({ value: "" })).toBeNull();
    mount(coverage.cellRenderer({ value: 75 }));

    const notes = gridStub.colDef("attr_notes");
    expect(notes.cellRenderer({ value: "" })).toBeNull();
    mount(notes.cellRenderer({ value: HR.attributes!.notes }));
    expect(screen.getByRole("link", { name: "https://wiki.example/ledger" })).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(notes.cellEditor).toBe("agLargeTextCellEditor");

    const docs = gridStub.colDef("attr_docsUrl");
    expect(docs.cellRenderer({ value: null })).toBeNull();
    expect(docs.cellRenderer({ value: "not a url" })).toBe("not a url");
    mount(docs.cellRenderer({ value: "https://docs.example/hr" }));
    const link = screen.getByRole("link", { name: "https://docs.example/hr" });
    expect(link).toHaveAttribute("href", "https://docs.example/hr");
    // A single click follows the link; the second click of a double-click
    // edits the cell instead of opening a second tab. jsdom would try to
    // navigate on the first, so the default is cancelled at the document
    // AFTER the renderer's own handler has decided.
    const quiet = (e: Event) => e.preventDefault();
    document.addEventListener("click", quiet);
    try {
      const single = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 });
      const seen: boolean[] = [];
      link.parentElement!.addEventListener("click", (e) => seen.push(e.defaultPrevented));
      link.dispatchEvent(single);
      const twice = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 2 });
      link.dispatchEvent(twice);
      expect(seen).toEqual([false, true]);
    } finally {
      document.removeEventListener("click", quiet);
    }

    // A readonly attribute is never editable, even in grid-edit mode.
    expect(gridStub.colDef("attr_vendorScore").editable).toBe(false);
  });

  it("builds the common-field columns for a multi-type selection", async () => {
    withMetamodel([...CARD_TYPES, VEHICLE_TYPE, VESSEL_TYPE], RELATION_TYPES);
    scriptCards([...ALL_CARDS, BUS, SHIP]);
    const { user } = renderInventory();
    await waitForRows(ALL_CARDS.filter((c) => c.status !== "ARCHIVED").length + 2);
    await applyFilters(user, { types: ["Vehicle", "Vessel"] });
    await waitForRows(2);
    await waitFor(() => expect(gridStub.colDef("attr_grade")).toBeDefined());

    const grade = gridStub.colDef("attr_grade");
    expect(grade.valueFormatter({ value: "a" })).toBe("Alpha");
    mount(grade.cellRenderer({ value: "a" }));
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(grade.cellRenderer({ value: "zz" })).toBe("zz");
    expect(grade.cellRenderer({ value: undefined })).toBe("");
    expect(gridStub.cellValue("attr_grade", BUS)).toBe("a");
    expect(gridStub.cellValue("attr_grade", SHIP)).toBe("");

    const zones = gridStub.colDef("attr_zones");
    expect(zones.valueFormatter({ value: ["n"] })).toBe("North");
    mount(zones.cellRenderer({ value: ["n", "x"] }));
    expect(screen.getByText("North")).toBeInTheDocument();
    expect(screen.getByText("x")).toBeInTheDocument();

    expect(gridStub.colDef("attr_memo").cellRenderer({ value: "" })).toBeNull();
    expect(gridStub.colDef("attr_site").cellRenderer({ value: "plain" })).toBe("plain");
    expect(gridStub.colDef("attr_pct").valueFormatter({ value: 40 })).toBe("40%");
    expect(gridStub.colDef("attr_since")).toBeDefined();
    mount(gridStub.colDef("attr_gadget").cellRenderer({ value: "widget" }));
    // Cost columns exist for a user who may see costs…
    expect(gridStub.colDef("attr_price")).toBeDefined();
    // …and no multi-type column is ever editable.
    expect(gridStub.colDef("attr_grade").editable).toBeUndefined();
  });

  it("renders an extension-typed column read-only for a single type", async () => {
    withMetamodel([...CARD_TYPES, VEHICLE_TYPE, VESSEL_TYPE], RELATION_TYPES);
    scriptCards([...ALL_CARDS, BUS, SHIP]);
    const { user } = renderInventory("/inventory?type=Vehicle");
    await waitForRows(1);
    await user.click(screen.getByRole("button", { name: BTN.gridEdit }));
    await waitFor(() => expect(gridStub.colDef("attr_memo").editable).toBe(true));
    const gadget = gridStub.colDef("attr_gadget");
    expect(gadget.editable).toBe(false);
    mount(gadget.cellRenderer({ value: "widget" }));
    expect(screen.getByText("widget")).toBeInTheDocument();
  });

  it("hides cost columns from a user without costs.view, across types too", async () => {
    hookState.auth.user = makeUser({ permissions: { "inventory.view": true } });
    withMetamodel([...CARD_TYPES, VEHICLE_TYPE, VESSEL_TYPE], RELATION_TYPES);
    scriptCards([...ALL_CARDS, BUS, SHIP]);
    const { user } = renderInventory();
    await waitFor(() => expect(gridStub.lastProps()).not.toBeNull());
    await applyFilters(user, { types: ["Vehicle", "Vessel"] });
    await waitFor(() => expect(gridStub.colDef("attr_grade")).toBeDefined());
    expect(gridStub.colDef("attr_price")).toBeUndefined();
  });

  it("builds one stakeholder column per role of the selected type", async () => {
    renderInventory("/inventory?type=Application");
    await waitForRows(3);
    await waitFor(() => expect(gridStub.colDef("stakeholder_applicationOwner")).toBeDefined());
    const col = gridStub.colDef("stakeholder_applicationOwner");
    expect(col.headerName).toBe("Stakeholders: Application Owner");
    expect(gridStub.colDef("stakeholder_technicalApplicationOwner")).toBeDefined();

    const ref = ERP.stakeholders[0];
    expect(col.valueGetter({ data: ERP })).toEqual([ref]);
    expect(col.valueGetter({ data: undefined })).toEqual([]);
    expect(col.filterValueGetter({ data: ERP })).toBe("Test Member; member@test.local");
    expect(col.valueFormatter({ value: [ref] })).toBe("member@test.local");
    expect(col.valueFormatter({ value: undefined })).toBe("");
    expect(col.comparator([ref], [])).toBeGreaterThan(0);

    const row = { ...ERP, stakeholders: [ref, { ...ref, role: "technicalApplicationOwner", user_id: "x" }] };
    const incoming = { ...ref, user_id: VIEWER_USER.id, user_display_name: "Test Viewer" };
    expect(col.valueSetter({ data: row, newValue: [incoming] })).toBe(true);
    // Other roles' refs are kept; this role's are replaced.
    expect(row.stakeholders.map((s) => s.user_id)).toEqual(["x", VIEWER_USER.id]);
    expect(col.valueSetter({ data: row, newValue: undefined })).toBe(true);
    expect(row.stakeholders.map((s) => s.user_id)).toEqual(["x"]);

    expect(col.cellRenderer({ value: [] })).toBe("");
    const many = [1, 2, 3, 4, 5].map((i) => ({
      id: `s${i}`,
      user_id: `u${i}`,
      user_display_name: i === 5 ? undefined : `Person ${i}`,
      user_email: i === 5 ? "five@test.local" : undefined,
      role: "applicationOwner",
    }));
    mount(col.cellRenderer({ value: many }));
    expect(screen.getByText("Person 1")).toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.queryByText("five@test.local")).toBeNull();
    expect(col.valueFormatter({ value: many })).toContain("five@test.local");
  });

  it("formats the metadata columns through the user directory and the date format", async () => {
    renderInventory("/inventory?type=Application");
    await waitForRows(3);
    await waitFor(() =>
      expect(gridStub.colDef("meta_created_by").valueFormatter({ value: MEMBER_USER.id })).toBe(
        "Test Member",
      ),
    );
    expect(gridStub.colDef("meta_updated_by").valueFormatter({ value: HR.updated_by })).toBe(
      HR.updated_by,
    );
    expect(gridStub.colDef("meta_created_by").valueFormatter({ value: undefined })).toBe("");
    expect(gridStub.colDef("meta_created_at").valueFormatter({ value: HR.created_at })).toContain(
      "2026-01-02",
    );
    expect(gridStub.colDef("meta_updated_at").valueFormatter({ value: HR.updated_at })).toContain(
      "2026-02-03",
    );
    expect(gridStub.colDef("meta_updated_at").valueFormatter({ value: undefined })).toBe("");
  });

  it("renders the EOL cell with its provenance", async () => {
    mockApi.on("get", /^\/eol\/card-status/, {
      items: {
        [CARD_IDS.linux]: {
          status: "supported",
          source: "manual",
          eol_date: "2029-04-30",
          support_date: "2028-01-01",
        },
        [CARD_IDS.postgres]: {
          status: "eol",
          source: "api",
          eol_product: "postgresql",
          eol_cycle: "16",
          eol_date: null,
        },
      },
    });
    renderInventory("/inventory?type=ITComponent");
    await waitForRows(2);
    await waitFor(() => expect(gridStub.cellValue("core_eol", LINUX)).toBe("2029-04-30"));
    const col = gridStub.colDef("core_eol");
    expect(col.cellRenderer({ data: undefined })).toBe("");
    expect(col.cellRenderer({ data: { ...LINUX, id: "nothing" } })).toBe("");
    mount(col.cellRenderer({ data: LINUX, value: "2029-04-30" }));
    expect(screen.getByText("2029-04-30")).toBeInTheDocument();
    mount(col.cellRenderer({ data: POSTGRES, value: "" }));
    expect(col.valueFormatter({ value: "2029-04-30" })).toBe("2029-04-30");
    expect(col.valueFormatter({ value: "" })).toBe("");
  });

  it("renders relation cells, and opens the editor from one in grid-edit mode", async () => {
    mockApi.on("get", /^\/relations\?card_type=/, [REL_ERP_PG]);
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    await waitFor(() => expect(gridStub.cellValue("rel_ITComponent", ERP)).toBe("PostgreSQL"));
    const col = gridStub.colDef("rel_ITComponent");
    expect(col.cellRenderer({ value: "", data: CRM })).toBe("");
    mount(col.cellRenderer({ value: "PostgreSQL", data: ERP }));
    expect(screen.getByText("PostgreSQL")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: BTN.gridEdit }));
    await waitFor(() => expect(gridStub.colDef("core_name").editable).toBe(true));
    mount(gridStub.colDef("rel_ITComponent").cellRenderer({ value: "", data: CRM }));
    await user.click(screen.getByText("Click to edit"));
    const popover = await screen.findByTestId("relation-popover");
    expect(popover).toHaveAttribute("data-card-id", CARD_IDS.crm);
    expect(popover).toHaveAttribute("data-card-name", "CRM Cloud");
    expect(popover).toHaveAttribute("data-rel-types", "relAppToITC");
    const relCalls = mockApi.callsOf("get", /^\/relations\?card_type=/).length;
    await user.click(screen.getByTestId("relation-popover-changed"));
    await waitFor(() =>
      expect(mockApi.callsOf("get", /^\/relations\?card_type=/).length).toBeGreaterThan(relCalls),
    );
    await user.click(screen.getByTestId("relation-popover-close"));
    await waitFor(() => expect(screen.queryByTestId("relation-popover")).toBeNull());
  });

  it("switches grid-edit mode off when the faceted type may not be edited", async () => {
    hookState.auth.user = makeUser({
      permissions: { "inventory.view": true, "inventory.edit": true },
      type_permissions: { Application: { "inventory.edit": false } },
    });
    const { user } = renderInventory();
    await waitFor(() => expect(gridStub.lastProps()).not.toBeNull());
    await user.click(screen.getByRole("button", { name: BTN.gridEdit }));
    await waitFor(() => expect(gridStub.colDef("core_name").editable).toBe(true));
    await applyFilters(user, { types: ["Application"] });
    await waitFor(() => expect(gridStub.colDef("core_name").editable).toBe(false));
    expect(screen.queryByRole("button", { name: /Grid Edit$|Editing$/ })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Grid event handlers and inline edits
// ---------------------------------------------------------------------------

describe("InventoryPage grid handlers", () => {
  it("persists the sort and the layout the grid reports", async () => {
    renderInventory("/inventory?type=Application");
    await waitForRows(3);
    gridStub.api().applyColumnState({ state: [{ colId: "core_name", sort: "asc", width: 240 }] });
    act(() => {
      gridStub.fire("sortChanged");
    });
    await waitFor(() =>
      expect(prefs().sortModel).toEqual([{ colId: "core_name", sort: "asc" }]),
    );
    expect(prefs().columnState).toEqual([{ colId: "core_name", sort: "asc", width: 240 }]);

    // A drag end captures the layout and the order/freeze prefs with it.
    gridStub.api().applyColumnState({
      state: [{ colId: "core_name", pinned: "left", width: 260 }],
    });
    act(() => {
      gridStub.fire("dragStopped");
    });
    await waitFor(() => expect(prefs().columnState[0].width).toBe(260));
  });

  it("tracks column filters and clears them from the toolbar", async () => {
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    act(() => {
      gridStub.fire("gridReady");
    });
    expect(screen.queryByRole("button", { name: BTN.clearColumnFilters })).toBeNull();
    gridStub.api().setFilterModel({ core_name: { filterType: "text", type: "contains", filter: "ERP" } });
    act(() => {
      gridStub.fire("filterChanged");
    });
    const clear = await screen.findByRole("button", { name: BTN.clearColumnFilters });
    await waitFor(() => expect(prefs().columnFilterModel).toEqual({ core_name: expect.anything() }));
    await user.click(clear);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: BTN.clearColumnFilters })).toBeNull(),
    );
    expect(prefs().columnFilterModel).toEqual({});
  });

  it("restores a saved layout and filter model once the grid is ready", async () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        columnState: [{ colId: "core_name", width: 333, hide: false, pinned: null }],
        columnFilterModel: { core_name: { filterType: "text", type: "contains", filter: "ERP" } },
      }),
    );
    renderInventory("/inventory?type=Application");
    await waitForRows(3);
    // Seeded from the prefs even before the grid reports anything.
    expect(screen.getByRole("button", { name: BTN.clearColumnFilters })).toBeInTheDocument();
    act(() => {
      gridStub.fire("gridReady");
    });
    await waitFor(() =>
      expect(gridStub.api().getColumnState()).toEqual([{ colId: "core_name", width: 333 }]),
    );
    expect(gridStub.api().getFilterModel()).toEqual({
      core_name: { filterType: "text", type: "contains", filter: "ERP" },
    });
  });

  it("counts the displayed rows from the grid's model", async () => {
    renderInventory("/inventory?type=Application&group_by=subtype&expand_group=microservice");
    await waitForRows(4);
    act(() => {
      gridStub.fire("modelUpdated");
    });
    // One expanded member plus the two collapsed headers' counts.
    expect(await screen.findByText("3 items")).toBeInTheDocument();
  });

  it("navigates on a plain row click only", async () => {
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    const fireRowClick = (payload: Record<string, unknown>) =>
      act(() => {
        gridStub.fire("rowClicked", payload);
      });

    // A group header, a click on a link, a modifier-click and a middle-click
    // all stay on the page.
    fireRowClick({ data: { ...ERP, __group: { key: "x" } }, event: new MouseEvent("click") });
    const anchor = document.createElement("a");
    fireRowClick({ data: ERP, event: { target: anchor } });
    fireRowClick({ data: ERP, event: { ctrlKey: true } });
    fireRowClick({ data: ERP, event: { button: 1 } });
    fireRowClick({ data: ERP, event: { defaultPrevented: true } });
    // …so does a click while rows are selected, or in grid-edit mode.
    selectRows([CRM]);
    fireRowClick({ data: ERP, event: new MouseEvent("click") });
    selectRows([]);
    await user.click(screen.getByRole("button", { name: BTN.gridEdit }));
    fireRowClick({ data: ERP, event: new MouseEvent("click") });
    await user.click(screen.getByRole("button", { name: BTN.editing }));
    expect(screen.queryByTestId("card-page")).toBeNull();

    fireRowClick({ data: ERP, event: new MouseEvent("click") });
    expect(await screen.findByTestId("card-page")).toHaveAttribute("data-card-id", CARD_IDS.erp);
  });

  it("persists every kind of inline edit through the right endpoint", async () => {
    withMetamodel([APPLICATION_WITH_LABELS, ...CARD_TYPES.slice(2)], RELATION_TYPES);
    mockApi.on("patch", /^\/cards\//, {});
    mockApi.on("post", /\/tags$/, {});
    mockApi.on("delete", /\/tags\//, {});
    mockApi.on("post", "/stakeholders/bulk", { failed: 0 });
    renderInventory("/inventory?type=Application");
    await waitForRows(3);
    await waitFor(() => expect(gridStub.colDef("stakeholder_applicationOwner")).toBeDefined());
    const patches = () => mockApi.callsOf("patch", /^\/cards\//).map((c) => [c.path, c.body]);
    const edit = async (col: string, row: Card, value: unknown, old?: unknown) => {
      await act(async () => {
        gridStub.editCell(col, row, value, old);
      });
    };

    await edit("core_name", ERP, "ERP Renamed");
    await edit("core_description", ERP, "A new description");
    await edit("core_alias", ERP, "");
    await edit("core_subtype", ERP, "microservice");
    await edit("core_parent_label", HR, "");
    await edit("attr_coverage", ERP, 50);
    await edit("attr_vendorScore", ERP, 1);
    await waitFor(() =>
      expect(patches()).toEqual([
        [`/cards/${CARD_IDS.erp}`, { name: "ERP Renamed" }],
        [`/cards/${CARD_IDS.erp}`, { description: "A new description" }],
        [`/cards/${CARD_IDS.erp}`, { alias: null }],
        [`/cards/${CARD_IDS.erp}`, { subtype: "microservice" }],
        [`/cards/${HR.id}`, { parent_label: null }],
        [`/cards/${CARD_IDS.erp}`, { attributes: { ...ERP.attributes, coverage: 50 } }],
      ]),
    );

    await edit("core_tags", ERP, [CLOUD], [ON_PREM]);
    await waitFor(() =>
      expect(mockApi.callsOf("post", `/cards/${CARD_IDS.erp}/tags`)[0]?.body).toEqual([CLOUD.id]),
    );
    expect(mockApi.callsOf("delete", `/cards/${CARD_IDS.erp}/tags/${ON_PREM.id}`)).toHaveLength(1);

    const ref = ERP.stakeholders[0];
    await edit("stakeholder_applicationOwner", ERP, [{ ...ref, user_id: VIEWER_USER.id }], [ref]);
    await waitFor(() =>
      expect(mockApi.callsOf("post", "/stakeholders/bulk")[0]?.body).toEqual({
        operations: [
          { action: "add", card_id: CARD_IDS.erp, user_id: VIEWER_USER.id, role: "applicationOwner" },
          { action: "remove", card_id: CARD_IDS.erp, user_id: MEMBER_USER.id, role: "applicationOwner" },
        ],
      }),
    );
    // An unchanged set sends nothing.
    await edit("stakeholder_applicationOwner", ERP, [ref], [ref]);
    expect(mockApi.callsOf("post", "/stakeholders/bulk")).toHaveLength(1);
  });

  it("reloads after a partially refused stakeholder write", async () => {
    mockApi.on("post", "/stakeholders/bulk", { failed: 1 });
    renderInventory("/inventory?type=Application");
    await waitForRows(3);
    await waitFor(() => expect(gridStub.colDef("stakeholder_applicationOwner")).toBeDefined());
    const before = cardsCalls().length;
    await act(async () => {
      gridStub.editCell("stakeholder_applicationOwner", CRM, [{ user_id: VIEWER_USER.id }], []);
    });
    await waitFor(() => expect(cardsCalls().length).toBeGreaterThan(before));
  });

  it("shows the server's reason for a refused edit, or a fallback, and reloads", async () => {
    mockApi.fail("patch", `/cards/${CARD_IDS.erp}`, 409, "taken");
    mockApi.on("patch", `/cards/${CARD_IDS.crm}`, () => {
      throw "not an Error";
    });
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    const before = cardsCalls().length;
    await act(async () => {
      gridStub.editCell("core_name", ERP, "Taken");
    });
    expect(await screen.findByText(`PATCH /cards/${CARD_IDS.erp} failed`)).toBeInTheDocument();
    await waitFor(() => expect(cardsCalls().length).toBeGreaterThan(before));
    // Escape dismisses the snackbar…
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText(`PATCH /cards/${CARD_IDS.erp} failed`)).toBeNull());

    await act(async () => {
      gridStub.editCell("core_name", CRM, "Nope");
    });
    expect(await screen.findByText("Could not save the change.")).toBeInTheDocument();
    // …and so does the alert's own close button.
    await user.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.queryByText("Could not save the change.")).toBeNull());
    await act(async () => {
      gridStub.editCell("attr_coverage", CRM, 5);
    });
    expect(await screen.findByText("Could not save the value.")).toBeInTheDocument();
    await act(async () => {
      gridStub.editCell("core_parent", CRM, CARD_IDS.erp);
    });
    expect(await screen.findByText("Could not change the parent.")).toBeInTheDocument();
  });

  it("waits for an in-flight relation fetch before exporting the current view", async () => {
    let release: (v: unknown) => void = () => {};
    mockApi.on(
      "get",
      /^\/relations\?card_type=/,
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    // While the fetch is open, an empty relation cell says so rather than
    // reading as "no relations".
    const relCol = gridStub.colDef("rel_ITComponent");
    mount(relCol.cellRenderer({ value: "", data: CRM }));
    expect(screen.getByTitle("Loading relations…")).toHaveTextContent("…");
    await user.click(screen.getByRole("button", { name: BTN.exportMenu }));
    expect(await screen.findByText("Waiting for relation columns to finish loading…")).toBeInTheDocument();
    await user.click(screen.getByText("Export current view"));
    expect(exportCurrentViewToExcel).not.toHaveBeenCalled();
    await act(async () => {
      release([REL_ERP_PG]);
    });
    await waitFor(() => expect(exportCurrentViewToExcel).toHaveBeenCalledTimes(1));
    const [rows, columns, opts] = vi.mocked(exportCurrentViewToExcel).mock.calls[0];
    expect(opts).toEqual({ sheetLabel: "Application" });
    expect(columns.map((c) => c.colId)).not.toContain("core_logo");
    expect(rows.find((r) => r.core_name === "ERP Core")?.rel_ITComponent).toBe("PostgreSQL");
  });

  it("exports every field through the full workbook writer", async () => {
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    await user.click(screen.getByRole("button", { name: BTN.exportMenu }));
    expect(await screen.findByText("Export all fields")).toBeInTheDocument();
    // Escape dismisses the menu without exporting.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("Export all fields")).toBeNull());
    expect(exportToExcel).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: BTN.exportMenu }));
    await user.click(await screen.findByText("Export all fields"));
    expect(exportToExcel).toHaveBeenCalledTimes(1);
    const [rows, typeConfig, types, relTypes, opts] = vi.mocked(exportToExcel).mock.calls[0];
    expect(rows.map((r) => r.id)).toEqual(APPS.map((c) => c.id));
    expect(typeConfig?.key).toBe("Application");
    expect(types).toBe(hookState.metamodel.types);
    expect(relTypes.map((rt) => rt.key)).toEqual(RELATION_TYPES.map((rt) => rt.key));
    expect(opts).toEqual({ canViewCosts: true });
  });

  it("applies a view's layout and filters, resets the columns, and collapses the sidebar", async () => {
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);

    holder.columnState = [
      { colId: "core_name", pinned: "left", width: 300 },
      { colId: "core_type", width: 140 },
    ];
    await user.click(screen.getByTestId("apply-column-state"));
    await waitFor(() => expect(gridStub.colDef("core_name").pinned).toBe("left"));
    const ids = gridStub.colDefs().map((c) => c.colId ?? c.field);
    expect(ids[0]).toBe("core_name");
    expect(ids.indexOf("core_name")).toBeLessThan(ids.indexOf("core_type"));
    expect(prefs().frozenColumns).toEqual(["core_name"]);
    // The stored order is self-healing: every present column is folded in,
    // around the two the view named.
    const order: string[] = prefs().columnOrder;
    expect(order[0]).toBe("core_name");
    expect(order.indexOf("core_name")).toBeLessThan(order.indexOf("core_type"));
    expect(order).toContain("attr_coverage");

    holder.columnFilters = { core_type: { filterType: "text", type: "equals", filter: "App" } };
    await user.click(screen.getByTestId("apply-column-filters"));
    await waitFor(() => expect(prefs().columnFilterModel).toEqual(holder.columnFilters));
    holder.columnState = null;
    await user.click(screen.getByTestId("apply-column-state"));
    await waitFor(() => expect(prefs().frozenColumns).toEqual([]));

    holder.columns = new Set(["core_type", "core_name"]);
    await user.click(screen.getByTestId("set-columns"));
    await waitFor(() => expect(gridStub.colDef("core_tags").hide).toBe(true));
    await user.click(screen.getByTestId("reset-columns"));
    await waitFor(() => expect(gridStub.colDef("core_tags").hide).toBe(false));
    expect(gridStub.colDef("attr_coverage").hide).toBe(false);

    expect(screen.getByTestId("filter-sidebar")).toHaveAttribute("data-collapsed", "false");
    await user.click(screen.getByTestId("toggle-collapse"));
    expect(screen.getByTestId("filter-sidebar")).toHaveAttribute("data-collapsed", "true");
  });
});

// ---------------------------------------------------------------------------
// Chrome: toolbar, mobile drawer, logo menu, import
// ---------------------------------------------------------------------------

describe("InventoryPage chrome", () => {
  it("opens and closes the import dialog, reloading on completion", async () => {
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    await user.click(screen.getByRole("button", { name: BTN.importCards }));
    const dialog = await screen.findByTestId("import-dialog");
    expect(dialog).toHaveAttribute("data-type", "Application");
    const before = cardsCalls().length;
    await user.click(screen.getByTestId("import-complete"));
    await waitFor(() => expect(cardsCalls().length).toBeGreaterThan(before));
    await user.click(screen.getByTestId("import-close"));
    await waitFor(() => expect(screen.queryByTestId("import-dialog")).toBeNull());
  });

  it("changes a logo from its cell and reports it in a snackbar", async () => {
    mockApi.on("delete", `/cards/${CARD_IDS.erp}/logo`, {});
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    const logo = gridStub.colDef("core_logo");
    expect(logo).toBeDefined();
    expect(logo.cellRenderer({ data: undefined })).toBeNull();
    mount(logo.cellRenderer({ data: { ...ERP, logo_updated_at: "2026-05-01T00:00:00Z" } }));

    await user.click(screen.getByRole("button", { name: "Change logo" }));
    const menu = await screen.findByRole("menu");
    await user.click(within(menu).getByRole("menuitem", { name: /Remove logo$/ }));
    await waitFor(() =>
      expect(mockApi.callsOf("delete", `/cards/${CARD_IDS.erp}/logo`)).toHaveLength(1),
    );
    expect(await screen.findByText("Logo removed")).toBeInTheDocument();
    // The row is refreshed in place rather than reloaded.
    expect((gridStub.rows() as Card[]).find((c) => c.id === CARD_IDS.erp)?.logo_updated_at).toBeNull();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("Logo removed")).toBeNull());
  });

  it("offers the mobile toolbar with the filters in a drawer", async () => {
    setViewportWidth(600);
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        columnFilterModel: { core_name: { filterType: "text", type: "contains", filter: "x" } },
      }),
    );
    const { user } = renderInventory("/inventory?type=Application");
    await waitForRows(3);
    expect(screen.queryByTestId("filter-sidebar")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Filters" }));
    expect(await screen.findByTestId("filter-sidebar")).toBeInTheDocument();
    // Escape closes the drawer; so does the sidebar's own collapse control.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("filter-sidebar")).toBeNull());
    await user.click(screen.getByRole("button", { name: "Filters" }));
    expect(await screen.findByTestId("filter-sidebar")).toBeInTheDocument();
    await user.click(screen.getByTestId("toggle-collapse"));
    await waitFor(() => expect(screen.queryByTestId("filter-sidebar")).toBeNull());

    await user.click(screen.getByRole("button", { name: "Clear column filters" }));
    await waitFor(() => expect(prefs().columnFilterModel).toEqual({}));

    await user.click(screen.getByRole("button", { name: "Grid Edit" }));
    await waitFor(() => expect(gridStub.colDef("core_name").editable).toBe(true));
    await user.click(screen.getByRole("button", { name: "Editing" }));
    await waitFor(() => expect(gridStub.colDef("core_name").editable).toBe(false));

    await user.click(within(screen.getByLabelText("Export")).getByRole("button"));
    await user.click(await screen.findByText("Export all fields"));
    expect(exportToExcel).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByTestId("import-dialog")).toBeInTheDocument();
    await user.click(screen.getByTestId("import-close"));

    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByTestId("create-dialog")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

describe("buildInventoryFacetBindings — subtype and lifecycle facets", () => {
  const EMPTY_FILTERS: Filters = {
    types: [],
    search: "",
    subtypes: [],
    lifecyclePhases: [],
    dataQualityBands: [],
    orphanedOnly: false,
    staleOnly: false,
    eolStatuses: [],
    linkTypes: [],
    approvalStatuses: [],
    showArchived: false,
    attributes: {},
    relations: {},
    tagIds: [],
    mineScope: null,
  };

  it("reads and writes the subtype and lifecycle facets", () => {
    const filtersRef = {
      current: { ...EMPTY_FILTERS, subtypes: ["microservice"], lifecyclePhases: ["active"] },
    };
    let next = filtersRef.current;
    const setFilters = (updater: (prev: Filters) => Filters) => {
      next = updater(next);
    };
    const bindings = buildInventoryFacetBindings(filtersRef, setFilters, undefined);

    expect(bindings.core_subtype.getValues()).toEqual(["microservice"]);
    bindings.core_subtype.setValues(["saas"]);
    expect(next.subtypes).toEqual(["saas"]);
    expect(bindings.core_subtype.toFacetValue({ filterValue: "saas" } as any)).toBe("saas");

    expect(bindings.core_lifecycle.getValues()).toEqual(["active"]);
    bindings.core_lifecycle.setValues([EMPTY_VALUE]);
    expect(next.lifecyclePhases).toEqual([EMPTY_VALUE]);
    // A blank cell maps to the facet's "(empty)" option.
    expect(bindings.core_lifecycle.toFacetValue({ filterValue: "" } as any)).toBe(EMPTY_VALUE);
  });
});

describe("inventory fill helpers", () => {
  it("reads a row's current value per field kind", () => {
    const ref = ERP.stakeholders[0];
    expect(currentFieldValue(ERP, "tags")).toEqual(ERP.tags);
    expect(currentFieldValue({ ...ERP, tags: undefined as any }, "tags")).toEqual([]);
    expect(currentFieldValue(ERP, "stakeholder_applicationOwner")).toEqual([ref]);
    expect(currentFieldValue(ERP, "stakeholder_other")).toEqual([]);
    expect(currentFieldValue(ERP, "attr_coverage")).toBe(75);
    expect(currentFieldValue({ ...ERP, attributes: undefined }, "attr_coverage")).toBeUndefined();
    expect(currentFieldValue(HR, "parent_id")).toBe(CARD_IDS.erp);
    expect(currentFieldValue(ERP, "parent_id")).toBeNull();
    expect(currentFieldValue(HR, "parent_label")).toBe("module");
    expect(currentFieldValue(ERP, "parent_label")).toBeNull();
    expect(currentFieldValue(ERP, "name")).toBe("ERP Core");
  });

  it("offers the fill handle only on columns that persist through a field", () => {
    expect(isInventoryFillable("core_name", { field: "name" })).toBe(false);
    expect(isInventoryFillable("core_logo", { field: "logo" })).toBe(false);
    expect(isInventoryFillable("rel_ITComponent", { field: "rel_ITComponent" })).toBe(false);
    expect(isInventoryFillable("ag-Grid-SelectionColumn", { field: "x" })).toBe(false);
    expect(isInventoryFillable("core_path", {})).toBe(false);
    expect(isInventoryFillable("core_description", { field: "description" })).toBe(true);
  });
});
