/**
 * The matched-cards columns of a query view: clicking a card type pill on the
 * strip adds a column after Name listing, per row, the cards at that step that
 * made the row match (`POST /cards/query/matches`). Built on the shared kit:
 * the grid is the `@/test/agGridStub` stand-in, the API `@/test/apiMock`, and
 * the filter sidebar a stub whose buttons call the page's own callbacks.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

import InventoryPage, {
  inventoryPreviewTargets,
  isInventoryFillable,
  splitInventoryCellValues,
} from "./InventoryPage";
import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { gridStub } from "@/test/agGridStub";
import { installClipboard } from "@/test/dom";
import { makeUser } from "@/test/render";
import {
  CARD_IDS,
  CARD_TYPES,
  RELATION_TYPES,
  TAG_GROUPS,
  USERS,
  cardById,
  cardPage,
  makeCard,
} from "@/test/fixtures/metamodel";
import { exportCurrentViewToExcel } from "./excelExport";
import type { Bookmark, Card, CardQuery, CardQueryMatchesResponse } from "@/types";
import type { CellMenuContext } from "@/components/grid/useCellContextMenu";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const holder = vi.hoisted(() => ({
  /** The stubbed import dialog's `onComplete` (a write on the page). */
  importComplete: null as null | (() => void),
  /** The bookmark the stubbed sidebar applies. */
  view: null as unknown,
  /** What the stubbed sidebar asks `viaColumnsFor` about. */
  saveQuery: null as unknown,
  filters: {} as Record<string, unknown>,
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

vi.mock("./InventoryFilterSidebar", async () => {
  const actual =
    await vi.importActual<typeof import("./InventoryFilterSidebar")>("./InventoryFilterSidebar");
  const { activeQueryFromBookmark } = await import("./viewApply");
  return {
    ...actual,
    default: (props: any) => (
      <div
        data-testid="filter-sidebar"
        data-selected-columns={Array.from(props.selectedColumns as Set<string>).join(",")}
      >
        <button
          data-testid="apply-view"
          onClick={() => {
            const bm = holder.view as any;
            props.onApplyQuery(activeQueryFromBookmark(bm));
            props.onApplyViewViaColumns(bm);
          }}
        />
        <button
          data-testid="apply-view-layout"
          onClick={() => {
            // The view's layout as stored, the way an older sidebar handed it over.
            const bm = holder.view as any;
            props.onApplyQuery(activeQueryFromBookmark(bm));
            props.onApplyViewViaColumns(bm);
            props.onApplyColumnState(bm.column_state ?? null);
            props.onApplyColumnFilters(bm.column_filter_model ?? null);
          }}
        />
        <button
          data-testid="save-view"
          onClick={(e) => {
            (e.currentTarget as HTMLElement).dataset.via = JSON.stringify(
              props.viaColumnsFor(holder.saveQuery),
            );
          }}
        />
        <button
          data-testid="apply-filters"
          onClick={() => props.onFiltersChange({ ...props.filters, ...holder.filters })}
        />
      </div>
    ),
  };
});

vi.mock("@/components/CreateCardDialog", () => ({ default: () => null }));
vi.mock("./ImportDialog", () => ({
  default: (props: any) => {
    holder.importComplete = props.onComplete;
    return null;
  },
}));
vi.mock("./RelationCellPopover", () => ({
  default: ({ open, onRelationsChanged }: any) =>
    open ? <button data-testid="relation-popover-changed" onClick={onRelationsChanged} /> : null,
}));
vi.mock("@/components/CardDetailSidePanel", () => ({ default: () => null }));
vi.mock("@/components/BrandIconPicker", () => ({ default: () => null }));
vi.mock("./excelExport", () => ({
  exportToExcel: vi.fn(),
  exportCurrentViewToExcel: vi.fn(),
}));

installClipboard();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ERP = cardById(CARD_IDS.erp);
const CRM = cardById(CARD_IDS.crm);
const NEW_APP: Card = makeCard({
  id: "ca4d0000-0000-4000-8000-0000000000aa",
  type: "Application",
  name: "New App",
});

/** Applications that use an IT Component: the IT Component pill is step `0:0`. */
const QUERY: CardQuery = {
  type: "Application",
  related: [{ relation: "relAppToITC", type: "ITComponent" }],
};
/** Two steps of one type: their headers carry an ordinal. */
const TWO_ITC: CardQuery = {
  type: "Application",
  related: [
    { relation: "relAppToITC", type: "ITComponent" },
    { relation: "relAppToITC", type: "ITComponent", where: { lifecycle_phase: ["active"] } },
  ],
};

function view(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: "bm-q",
    name: "Apps on tech",
    is_default: false,
    visibility: "private",
    odata_enabled: false,
    owner_id: "u1",
    is_owner: true,
    can_edit: true,
    query: QUERY,
    filters: { types: ["Application"] },
    ...overrides,
  };
}

const PG = { id: CARD_IDS.postgres, name: "PostgreSQL" };
const LINUX = { id: CARD_IDS.linux, name: "Ubuntu LTS" };

const MATCHES: CardQueryMatchesResponse = {
  rows: {
    [ERP.id]: { "0:0": { cards: [PG, LINUX], more: false } },
    [CRM.id]: { "0:0": { cards: [LINUX], more: true } },
  },
};

const PREFS_KEY = "turboea_inventory";
const prefs = () => JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null");
const matchCalls = () => mockApi.callsOf("post", "/cards/query/matches");
const colIds = () => gridStub.colDefs().map((c: any) => c.colId ?? c.field);
const rowIds = () => gridStub.rows().map((r: any) => r.id);

let cards: Card[] = [ERP, CRM];

function renderInventory(path = "/inventory?view=bm-q") {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[path]}>
      <InventoryPage />
    </MemoryRouter>,
  );
  return { user };
}

async function openView(bm: Bookmark = view(), path?: string) {
  mockApi.on("get", /^\/bookmarks/, [bm]);
  const r = renderInventory(path);
  await screen.findByTestId("query-path-strip");
  await waitFor(() => expect(rowIds()).toEqual(cards.map((c) => c.id)));
  return r;
}

const pill = (name: RegExp) => screen.getByRole("button", { name });
/** Let pending effects, timers and promises run. */
const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
/** A reply the test settles itself. */
function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const FAILED = /The matched cards could not be loaded\.$/;
const F_SAP = { filterType: "text", type: "contains", filter: "SAP" };
const F_LINUX = { filterType: "text", type: "contains", filter: "Linux" };

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  gridStub.reset();
  localStorage.clear();
  holder.view = null;
  holder.saveQuery = null;
  holder.filters = {};
  holder.importComplete = null;
  cards = [ERP, CRM];
  vi.mocked(exportCurrentViewToExcel).mockClear();

  withMetamodel(CARD_TYPES, RELATION_TYPES);
  hookState.auth.user = makeUser();

  mockApi.lenient({});
  mockApi.on("get", "/tag-groups", TAG_GROUPS);
  mockApi.on("get", "/users", USERS);
  mockApi.on("get", /^\/stakeholder-roles/, []);
  mockApi.on("get", /^\/relations/, []);
  mockApi.on("get", /^\/eol\/card-status/, { items: {} });
  mockApi.on("get", /^\/cards\?/, (path) => {
    const search = new URLSearchParams(path.slice(path.indexOf("?") + 1)).get("search") ?? "";
    return cardPage(cards.filter((c) => c.name.includes(search)));
  });
  mockApi.on("post", "/cards/query/matches", MATCHES);
});

// ---------------------------------------------------------------------------
// The column
// ---------------------------------------------------------------------------

describe("matched-cards columns", () => {
  it("opens with no column and the pill off, and asks for nothing", async () => {
    await openView();
    expect(pill(/matched IT Component/)).toHaveAttribute("aria-pressed", "false");
    expect(colIds().some((id: string) => id.startsWith("via:"))).toBe(false);
    expect(matchCalls()).toHaveLength(0);
  });

  it("clicking the pill posts the query, the step and the loaded ids, and adds the column after Name", async () => {
    const { user } = await openView();
    await user.click(pill(/Show the matched IT Component cards/));

    await waitFor(() => expect(matchCalls()).toHaveLength(1));
    expect(matchCalls()[0].body).toEqual({ query: QUERY, nodes: ["0:0"], ids: [ERP.id, CRM.id] });
    expect(pill(/Hide the matched IT Component column/)).toHaveAttribute("aria-pressed", "true");

    const ids = colIds();
    expect(ids[ids.indexOf("core_name") + 1]).toBe("via:0:0");
    const col = gridStub.colDef("via:0:0");
    expect(col.headerName).toBe("IT Component · matched");
    expect(col.headerTooltip).toBe(
      "The IT Component cards that made each row match, along Application › uses IT Component. " +
        "Every matching card along the chain is listed, not which one leads to which.",
    );
    expect(col.suppressMovable).toBe(true);
    expect(col.editable).toBeUndefined();
    expect(col.field).toBeUndefined();
    expect(col.filter).toBe("agTextColumnFilter");
    await waitFor(() => expect(gridStub.cellValue("via:0:0", ERP)).toBe("PostgreSQL; Ubuntu LTS"));
    expect(gridStub.cellValue("via:0:0", CRM)).toBe("Ubuntu LTS; …");
  });

  it("renders the names with a full-list tooltip that says when only the first ones are listed", async () => {
    const { user } = await openView();
    await user.click(pill(/matched IT Component/));
    await waitFor(() => expect(gridStub.cellValue("via:0:0", ERP)).not.toBe(""));
    const col = gridStub.colDef("via:0:0");

    const erp = render(col.cellRenderer({ value: gridStub.cellValue("via:0:0", ERP), data: ERP }));
    expect(within(erp.container).getByText("PostgreSQL; Ubuntu LTS")).toHaveAttribute("title", "PostgreSQL; Ubuntu LTS");
    expect(within(erp.container).getByText("memory")).toBeInTheDocument();
    erp.unmount();

    const crm = render(col.cellRenderer({ value: gridStub.cellValue("via:0:0", CRM), data: CRM }));
    expect(within(crm.container).getByText("Ubuntu LTS; …")).toHaveAttribute("title", "Ubuntu LTS (first 1 shown)");
    crm.unmount();

    // A row with no match is blank.
    expect(col.cellRenderer({ value: "", data: NEW_APP })).toBe("");
  });

  it("a second click removes the column without asking again", async () => {
    const { user } = await openView();
    await user.click(pill(/matched IT Component/));
    await waitFor(() => expect(colIds()).toContain("via:0:0"));
    await user.click(pill(/matched IT Component/));
    await waitFor(() => expect(colIds()).not.toContain("via:0:0"));
    expect(pill(/Show the matched IT Component/)).toHaveAttribute("aria-pressed", "false");
    expect(matchCalls()).toHaveLength(1);
  });

  it("numbers two steps of one type in the order switched on", async () => {
    mockApi.on("post", "/cards/query/matches", { rows: {} });
    const { user } = await openView(view({ query: TWO_ITC }));
    const [first, second] = screen.getAllByTestId("query-path-match-switch");
    await user.click(second);
    await waitFor(() => expect(gridStub.colDef("via:0:1")?.headerName).toBe("IT Component · matched"));
    await user.click(first);
    await waitFor(() => expect(gridStub.colDef("via:0:0")).toBeDefined());
    expect(gridStub.colDef("via:0:1").headerName).toBe("IT Component · matched 1");
    expect(gridStub.colDef("via:0:0").headerName).toBe("IT Component · matched 2");
    const ids = colIds();
    const at = ids.indexOf("core_name");
    expect(ids.slice(at + 1, at + 3)).toEqual(["via:0:1", "via:0:0"]);
    expect(matchCalls()[matchCalls().length - 1].body).toMatchObject({ nodes: ["0:1", "0:0"] });
  });

  it("refetches only when new rows appear or the query changes, not when rows go", async () => {
    const { user } = await openView();
    await user.click(pill(/matched IT Component/));
    await waitFor(() => expect(matchCalls()).toHaveLength(1));

    // Rows shrink to a subset: the matches in hand cover them.
    holder.filters = { search: "ERP" };
    await user.click(screen.getByTestId("apply-filters"));
    await waitFor(() => expect(rowIds()).toEqual([ERP.id]));
    expect(matchCalls()).toHaveLength(1);

    // A row the last answer did not cover: ask again, for every loaded id.
    cards = [ERP, CRM, NEW_APP];
    holder.filters = { search: " " };
    await user.click(screen.getByTestId("apply-filters"));
    await waitFor(() => expect(matchCalls()).toHaveLength(2));
    expect(matchCalls()[1].body).toEqual({
      query: QUERY,
      nodes: ["0:0"],
      ids: [ERP.id, CRM.id, NEW_APP.id],
    });

    // Another query (an unrelated condition added) keeps the step on and asks again.
    const narrowed: CardQuery = {
      type: "Application",
      where: { approval_status: ["APPROVED"] },
      related: QUERY.related,
    };
    holder.view = view({ query: narrowed, columns: ["via:0:0"] });
    await user.click(screen.getByTestId("apply-view"));
    await waitFor(() => expect(matchCalls()).toHaveLength(3));
    expect(matchCalls()[2].body).toEqual({
      query: narrowed,
      nodes: ["0:0"],
      ids: [ERP.id, CRM.id, NEW_APP.id],
    });
    await flush();
    expect(matchCalls()).toHaveLength(3);
  });

  it("hides the columns while the query is edited and brings them back on cancel", async () => {
    const { user } = await openView(view({ columns: ["core_name", "via:0:0"] }));
    await waitFor(() => expect(colIds()).toContain("via:0:0"));
    await user.click(screen.getByTestId("query-path-edit"));
    await waitFor(() => expect(colIds()).not.toContain("via:0:0"));
    expect(screen.queryAllByTestId("query-path-match-switch")).toHaveLength(0);
    await user.click(screen.getByTestId("query-path-cancel"));
    await waitFor(() => expect(colIds()).toContain("via:0:0"));
    expect(pill(/matched IT Component/)).toHaveAttribute("aria-pressed", "true");
  });

  it("on a refused request leaves the cells empty and says so in the header tooltip", async () => {
    mockApi.fail("post", "/cards/query/matches", 400, "unknown_node");
    const { user } = await openView();
    await user.click(pill(/matched IT Component/));
    await waitFor(() =>
      expect(gridStub.colDef("via:0:0").headerTooltip).toMatch(
        /The matched cards could not be loaded\.$/,
      ),
    );
    expect(gridStub.cellValue("via:0:0", ERP)).toBe("");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("export awaits the matches and writes the column as shown", async () => {
    let release: (v: CardQueryMatchesResponse) => void = () => {};
    mockApi.on(
      "post",
      "/cards/query/matches",
      () => new Promise<CardQueryMatchesResponse>((r) => (release = r)),
    );
    const { user } = await openView();
    await user.click(pill(/matched IT Component/));
    await waitFor(() => expect(matchCalls()).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: /Export/ }));
    await user.click(await screen.findByText("Export current view"));
    expect(exportCurrentViewToExcel).not.toHaveBeenCalled();
    await act(async () => {
      release(MATCHES);
    });
    await waitFor(() => expect(exportCurrentViewToExcel).toHaveBeenCalledTimes(1));
    const [rows, columns] = vi.mocked(exportCurrentViewToExcel).mock.calls[0];
    expect(columns).toContainEqual({ colId: "via:0:0", headerName: "IT Component · matched" });
    expect(rows.find((r) => r.core_name === "ERP Core")?.["via:0:0"]).toBe("PostgreSQL; Ubuntu LTS");
    expect(rows.find((r) => r.core_name === "CRM Cloud")?.["via:0:0"]).toBe("Ubuntu LTS; …");
  });
});

// ---------------------------------------------------------------------------
// Saved with the view, never with the user's own columns
// ---------------------------------------------------------------------------

describe("matched-cards columns and saved views", () => {
  it("a view's via: entries turn its pills and columns on, and never reach the picker or the prefs", async () => {
    await openView(view({ columns: ["core_name", "core_type", "via:0:0", "via:9:9"] }));
    await waitFor(() => expect(colIds()).toContain("via:0:0"));
    expect(colIds()).not.toContain("via:9:9");
    expect(pill(/matched IT Component/)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("filter-sidebar")).toHaveAttribute(
      "data-selected-columns",
      "core_name,core_type",
    );
    await waitFor(() => expect(matchCalls()).toHaveLength(1));
    const stored = prefs();
    expect(stored.columns).toEqual(["core_name", "core_type"]);
    expect(JSON.stringify(stored.columnOrder ?? [])).not.toContain("via:");
  });

  it("a view without them leaves none on, even after one that had them", async () => {
    const { user } = await openView(view({ columns: ["core_name", "via:0:0"] }));
    await waitFor(() => expect(colIds()).toContain("via:0:0"));
    holder.view = view({ id: "bm-2", columns: ["core_name"] });
    await user.click(screen.getByTestId("apply-view"));
    await waitFor(() => expect(colIds()).not.toContain("via:0:0"));
    expect(pill(/matched IT Component/)).toHaveAttribute("aria-pressed", "false");
  });

  it("hands the sidebar the via: entries to save for a query, none for a plain one", async () => {
    const { user } = await openView();
    await user.click(pill(/matched IT Component/));
    const save = screen.getByTestId("save-view");
    holder.saveQuery = QUERY;
    await user.click(save);
    expect(save.dataset.via).toBe(JSON.stringify(["via:0:0"]));
    holder.saveQuery = { type: "Application", related: [{ relation: "relAppToBC", type: "BusinessCapability" }] };
    await user.click(save);
    expect(save.dataset.via).toBe("[]");
    holder.saveQuery = null;
    await user.click(save);
    expect(save.dataset.via).toBe("[]");
  });

  it("saving an edited query sends the view's columns with the steps still held", async () => {
    mockApi.on("patch", "/bookmarks/bm-q", (_p, body: any) => view({ ...body }));
    const { user } = await openView(view({ columns: ["core_name", "via:0:0"] }));
    await waitFor(() => expect(colIds()).toContain("via:0:0"));
    await user.click(screen.getByTestId("query-path-edit"));
    await user.click(screen.getByTestId("query-path-save"));
    await waitFor(() => expect(mockApi.callsOf("patch", "/bookmarks/bm-q")).toHaveLength(1));
    expect(mockApi.callsOf("patch", "/bookmarks/bm-q")[0].body).toEqual({
      query: QUERY,
      columns: ["core_name", "via:0:0"],
      column_filter_model: null,
      column_state: null,
    });
    await waitFor(() => expect(colIds()).toContain("via:0:0"));
  });

  it("saving an edited query of a view without them sends the query alone", async () => {
    mockApi.on("patch", "/bookmarks/bm-q", (_p, body: any) => view({ ...body }));
    const { user } = await openView(view({ columns: ["core_name"] }));
    await user.click(screen.getByTestId("query-path-edit"));
    await user.click(screen.getByTestId("query-path-save"));
    await waitFor(() => expect(mockApi.callsOf("patch", "/bookmarks/bm-q")).toHaveLength(1));
    expect(mockApi.callsOf("patch", "/bookmarks/bm-q")[0].body).toEqual({ query: QUERY });
  });

  it("leaving the view drops its columns", async () => {
    const { user } = await openView(view({ columns: ["core_name", "via:0:0"] }));
    await waitFor(() => expect(colIds()).toContain("via:0:0"));
    await user.click(screen.getByRole("button", { name: "Leave this view" }));
    await waitFor(() => expect(colIds()).not.toContain("via:0:0"));
  });
});

// ---------------------------------------------------------------------------
// When the matches are asked for
// ---------------------------------------------------------------------------

describe("matched-cards requests", () => {
  it("a view with a column on whose query lists no rows asks for nothing and reports no failure", async () => {
    cards = [];
    await openView(view({ columns: ["core_name", "via:0:0"] }));
    await waitFor(() => expect(colIds()).toContain("via:0:0"));
    await waitFor(() => expect(screen.getByTestId("ag-grid")).toHaveAttribute("data-loading", "false"));
    await flush();
    expect(matchCalls()).toHaveLength(0);
    expect(gridStub.colDef("via:0:0").headerTooltip).not.toMatch(FAILED);
  });

  it("a pill switched on over an empty grid asks nothing, then asks once rows appear", async () => {
    cards = [];
    const { user } = await openView();
    await user.click(pill(/matched IT Component/));
    await waitFor(() => expect(colIds()).toContain("via:0:0"));
    await flush();
    expect(matchCalls()).toHaveLength(0);
    expect(gridStub.colDef("via:0:0").headerTooltip).not.toMatch(FAILED);

    cards = [ERP];
    holder.filters = { search: "E" };
    await user.click(screen.getByTestId("apply-filters"));
    await waitFor(() => expect(matchCalls()).toHaveLength(1));
    expect(matchCalls()[0].body).toEqual({ query: QUERY, nodes: ["0:0"], ids: [ERP.id] });
  });

  it("switching views asks once, with the new view's rows", async () => {
    const { user } = await openView(view({ columns: ["core_name", "via:0:0"] }));
    await waitFor(() => expect(matchCalls()).toHaveLength(1));
    const narrowed: CardQuery = { ...QUERY, where: { approval_status: ["APPROVED"] } };
    cards = [NEW_APP];
    holder.view = view({ id: "bm-2", query: narrowed, columns: ["core_name", "via:0:0"] });
    await user.click(screen.getByTestId("apply-view"));
    await waitFor(() => expect(rowIds()).toEqual([NEW_APP.id]));
    await waitFor(() => expect(matchCalls()).toHaveLength(2));
    await flush();
    expect(matchCalls()).toHaveLength(2);
    expect(matchCalls()[1].body).toEqual({ query: narrowed, nodes: ["0:0"], ids: [NEW_APP.id] });
  });

  it("asks nothing while the rows are loading, then once with the rows that landed", async () => {
    const page = deferred<unknown>();
    mockApi.on("get", /^\/cards\?/, () => page.promise);
    mockApi.on("get", /^\/bookmarks/, [view({ columns: ["core_name", "via:0:0"] })]);
    renderInventory();
    await screen.findByTestId("query-path-strip");
    await waitFor(() => expect(colIds()).toContain("via:0:0"));
    await flush();
    expect(matchCalls()).toHaveLength(0);
    await act(async () => page.resolve(cardPage([ERP])));
    await waitFor(() => expect(matchCalls()).toHaveLength(1));
    await flush();
    expect(matchCalls()).toHaveLength(1);
    expect(matchCalls()[0].body).toEqual({ query: QUERY, nodes: ["0:0"], ids: [ERP.id] });
  });

  it("a write on the page asks again once its reload has landed, not before", async () => {
    await openView(view({ columns: ["core_name", "via:0:0"] }));
    await waitFor(() => expect(matchCalls()).toHaveLength(1));
    const page = deferred<unknown>();
    mockApi.on("get", /^\/cards\?/, () => page.promise);
    act(() => {
      // The reload it starts is left pending: do not await it.
      void holder.importComplete?.();
    });
    await flush();
    expect(matchCalls()).toHaveLength(1);
    // The same rows come back: only the write says the answer may differ.
    await act(async () => page.resolve(cardPage([ERP, CRM])));
    await waitFor(() => expect(matchCalls()).toHaveLength(2));
    await flush();
    expect(matchCalls()).toHaveLength(2);
    expect(matchCalls()[1].body).toEqual({ query: QUERY, nodes: ["0:0"], ids: [ERP.id, CRM.id] });
  });

  it("a relation edited through a relation cell asks again for the same rows", async () => {
    const { user } = await openView(view({ columns: ["core_name", "via:0:0"] }));
    await waitFor(() => expect(gridStub.cellValue("via:0:0", ERP)).toBe("PostgreSQL; Ubuntu LTS"));
    mockApi.on("post", "/cards/query/matches", { rows: { [ERP.id]: { "0:0": { cards: [PG], more: false } } } });

    await user.click(screen.getByRole("button", { name: /Grid Edit/ }));
    await waitFor(() => expect(gridStub.colDef("core_name").editable).toBe(true));
    render(
      <MemoryRouter>
        {gridStub.colDef("rel_relAppToITC__out").cellRenderer({ value: "", data: CRM })}
      </MemoryRouter>,
    );
    await user.click(screen.getByText("Click to edit"));
    await user.click(await screen.findByTestId("relation-popover-changed"));

    await waitFor(() => expect(matchCalls()).toHaveLength(2));
    expect(matchCalls()[1].body).toEqual(matchCalls()[0].body);
    await waitFor(() => expect(gridStub.cellValue("via:0:0", ERP)).toBe("PostgreSQL"));
    expect(gridStub.cellValue("via:0:0", CRM)).toBe("");
  });

  it("a failed request is asked again on the next run, even for rows it covered", async () => {
    mockApi.fail("post", "/cards/query/matches", 500, "boom");
    const { user } = await openView();
    await user.click(pill(/matched IT Component/));
    await waitFor(() => expect(gridStub.colDef("via:0:0").headerTooltip).toMatch(FAILED));
    expect(matchCalls()).toHaveLength(1);

    mockApi.on("post", "/cards/query/matches", MATCHES);
    holder.filters = { search: "ERP" };
    await user.click(screen.getByTestId("apply-filters"));
    await waitFor(() => expect(matchCalls()).toHaveLength(2));
    expect(matchCalls()[1].body).toEqual({ query: QUERY, nodes: ["0:0"], ids: [ERP.id] });
    await waitFor(() => expect(gridStub.cellValue("via:0:0", ERP)).toBe("PostgreSQL; Ubuntu LTS"));
    expect(gridStub.colDef("via:0:0").headerTooltip).not.toMatch(FAILED);
  });

  it("a failure is not carried over to a query that lists no rows", async () => {
    mockApi.fail("post", "/cards/query/matches", 500, "boom");
    const { user } = await openView(view({ columns: ["core_name", "via:0:0"] }));
    await waitFor(() => expect(gridStub.colDef("via:0:0").headerTooltip).toMatch(FAILED));
    cards = [];
    const narrowed: CardQuery = { ...QUERY, where: { approval_status: ["APPROVED"] } };
    holder.view = view({ id: "bm-2", query: narrowed, columns: ["core_name", "via:0:0"] });
    await user.click(screen.getByTestId("apply-view"));
    await waitFor(() => expect(rowIds()).toEqual([]));
    await waitFor(() => expect(gridStub.colDef("via:0:0").headerTooltip).not.toMatch(FAILED));
    expect(matchCalls()).toHaveLength(1);
  });

  it("a superseded answer landing after the newer one changes nothing", async () => {
    const replies = [deferred<CardQueryMatchesResponse>(), deferred<CardQueryMatchesResponse>()];
    let n = 0;
    mockApi.on("post", "/cards/query/matches", () => replies[n++].promise);
    const { user } = await openView();
    await user.click(pill(/matched IT Component/));
    await waitFor(() => expect(matchCalls()).toHaveLength(1));

    cards = [ERP, CRM, NEW_APP];
    holder.filters = { search: " " };
    await user.click(screen.getByTestId("apply-filters"));
    await waitFor(() => expect(matchCalls()).toHaveLength(2));

    const newer: CardQueryMatchesResponse = {
      rows: { [NEW_APP.id]: { "0:0": { cards: [PG], more: false } } },
    };
    await act(async () => replies[1].resolve(newer));
    await waitFor(() => expect(gridStub.cellValue("via:0:0", NEW_APP)).toBe("PostgreSQL"));
    await act(async () => replies[0].resolve(MATCHES));
    await flush();
    expect(gridStub.cellValue("via:0:0", NEW_APP)).toBe("PostgreSQL");
    expect(gridStub.cellValue("via:0:0", ERP)).toBe("");
  });

  it("a superseded failure landing after the newer answer changes nothing", async () => {
    const replies = [deferred<CardQueryMatchesResponse>(), deferred<CardQueryMatchesResponse>()];
    let n = 0;
    mockApi.on("post", "/cards/query/matches", () => replies[n++].promise);
    const { user } = await openView();
    await user.click(pill(/matched IT Component/));
    await waitFor(() => expect(matchCalls()).toHaveLength(1));
    cards = [ERP, CRM, NEW_APP];
    holder.filters = { search: " " };
    await user.click(screen.getByTestId("apply-filters"));
    await waitFor(() => expect(matchCalls()).toHaveLength(2));

    await act(async () => replies[1].resolve(MATCHES));
    await waitFor(() => expect(gridStub.cellValue("via:0:0", ERP)).toBe("PostgreSQL; Ubuntu LTS"));
    await act(async () => replies[0].reject(new Error("late")));
    await flush();
    expect(gridStub.cellValue("via:0:0", ERP)).toBe("PostgreSQL; Ubuntu LTS");
    expect(gridStub.colDef("via:0:0").headerTooltip).not.toMatch(FAILED);
    // The failure did not unrecord the newer answer: nothing is asked again.
    holder.filters = { search: "ERP" };
    await user.click(screen.getByTestId("apply-filters"));
    await waitFor(() => expect(rowIds()).toEqual([ERP.id]));
    await flush();
    expect(matchCalls()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// A matched column's layout never outlives its step
// ---------------------------------------------------------------------------

describe("matched-cards columns and their layout", () => {
  /** Saved with 0:0 on and filtered, then its query re-typed so 0:0 is a
   *  Business Capability: the `columns` were pruned, the layout was not. */
  const RETYPED: CardQuery = {
    type: "Application",
    related: [{ relation: "relAppToBC", type: "BusinessCapability" }],
  };

  it("a view's stale via: filter, sort, width and freeze never reach the column that takes the key", async () => {
    const { user } = await openView(
      view({
        query: RETYPED,
        columns: ["core_name"],
        column_filter_model: { core_name: F_LINUX, "via:0:0": F_SAP },
        column_state: [
          { colId: "core_name", width: 210 },
          { colId: "via:0:0", width: 333, sort: "asc", pinned: "left" },
        ],
      }),
    );
    act(() => {
      gridStub.fire("gridReady");
    });
    await waitFor(() => expect(gridStub.api().getFilterModel()).toEqual({ core_name: F_LINUX }));
    await user.click(pill(/matched Business Capability/));
    await waitFor(() => expect(colIds()).toContain("via:0:0"));
    expect(gridStub.api().getFilterModel()).toEqual({ core_name: F_LINUX });
    expect(gridStub.colDef("via:0:0").pinned).toBeFalsy();
    expect(JSON.stringify(gridStub.api().getColumnState())).not.toContain("via:0:0");
    const stored = prefs();
    expect(stored.columnFilterModel).toEqual({ core_name: F_LINUX });
    expect(JSON.stringify([stored.columnState, stored.columnOrder, stored.frozenColumns, stored.sortModel])).not.toContain("via:");
  });

  it("a column switched off drops its filter, so switching it on again starts clean", async () => {
    const { user } = await openView(
      view({
        columns: ["core_name", "via:0:0"],
        column_filter_model: { "via:0:0": F_SAP },
        column_state: [
          { colId: "core_name", width: 210 },
          { colId: "via:0:0", width: 333, pinned: "left" },
        ],
      }),
    );
    act(() => {
      gridStub.fire("gridReady");
    });
    await waitFor(() => expect(gridStub.api().getFilterModel()).toEqual({ "via:0:0": F_SAP }));
    expect(gridStub.colDef("via:0:0").pinned).toBe("left");
    // The user sorts by it.
    gridStub.api().applyColumnState({ state: [{ colId: "via:0:0", sort: "asc" }] });
    act(() => {
      gridStub.fire("sortChanged");
    });
    await waitFor(() => expect(prefs().sortModel).toEqual([{ colId: "via:0:0", sort: "asc" }]));
    expect(prefs().frozenColumns).toEqual(["via:0:0"]);
    expect(prefs().columnOrder).toContain("via:0:0");

    await user.click(pill(/matched IT Component/));
    await waitFor(() => expect(colIds()).not.toContain("via:0:0"));
    await waitFor(() => expect(prefs().columnFilterModel).toEqual({}));
    expect(prefs().columnState).toEqual([]);
    expect(prefs().sortModel).toEqual([]);
    expect(prefs().frozenColumns).toEqual([]);
    expect(prefs().columnOrder).toContain("core_name");
    expect(prefs().columnOrder).not.toContain("via:0:0");
    await user.click(pill(/matched IT Component/));
    await waitFor(() => expect(colIds()).toContain("via:0:0"));
    await flush();
    expect(gridStub.api().getFilterModel()).toEqual({});
  });

  it("a view applied over a ready grid keeps none of its stale via: entries", async () => {
    const { user } = await openView();
    act(() => {
      gridStub.fire("gridReady");
    });
    holder.view = view({
      id: "bm-2",
      columns: ["core_name"],
      column_filter_model: { core_name: F_LINUX, "via:0:0": F_SAP },
      column_state: [
        { colId: "core_name", width: 210 },
        { colId: "via:0:0", width: 333, sort: "asc" },
      ],
    });
    await user.click(screen.getByTestId("apply-view-layout"));
    await waitFor(() => expect(gridStub.api().getFilterModel()).toEqual({ core_name: F_LINUX }));
    await flush();
    expect(gridStub.api().getFilterModel()).toEqual({ core_name: F_LINUX });
    expect(JSON.stringify(gridStub.api().getColumnState())).not.toContain("via:");
  });

  it("a reload keeps the layout of the view's switched-on column", async () => {
    const bm = view({ columns: ["core_name", "via:0:0"] });
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        filters: { types: ["Application"] },
        activeQuery: { viewId: bm.id, name: bm.name, query: QUERY, createdVia: null },
        columnFilterModel: { "via:0:0": F_SAP },
        frozenColumns: ["via:0:0"],
        columnOrder: ["via:0:0", "core_name"],
      }),
    );
    mockApi.on("get", /^\/bookmarks/, [bm]);
    renderInventory("/inventory");
    await screen.findByTestId("query-path-strip");
    await waitFor(() => expect(colIds()).toContain("via:0:0"));
    await flush();
    expect(gridStub.colDef("via:0:0").pinned).toBe("left");
    expect(prefs().columnFilterModel).toEqual({ "via:0:0": F_SAP });
    expect(prefs().frozenColumns).toEqual(["via:0:0"]);
    expect(prefs().columnOrder).toContain("via:0:0");
  });

  it("saving an edited query sends the stored layout less the steps it does not keep", async () => {
    mockApi.on("patch", "/bookmarks/bm-q", (_p, body: any) => view({ ...body }));
    const { user } = await openView(
      view({
        columns: ["core_name", "via:0:0"],
        column_filter_model: { core_name: F_LINUX, "via:0:0": F_SAP, "via:0:1": F_LINUX },
        column_state: [
          { colId: "core_name", width: 210 },
          { colId: "via:0:0", width: 333 },
          { colId: "via:0:1", width: 99 },
        ],
      }),
    );
    await waitFor(() => expect(colIds()).toContain("via:0:0"));
    await user.click(screen.getByTestId("query-path-edit"));
    await user.click(screen.getByTestId("query-path-save"));
    await waitFor(() => expect(mockApi.callsOf("patch", "/bookmarks/bm-q")).toHaveLength(1));
    expect(mockApi.callsOf("patch", "/bookmarks/bm-q")[0].body).toEqual({
      query: QUERY,
      columns: ["core_name", "via:0:0"],
      column_filter_model: { core_name: F_LINUX, "via:0:0": F_SAP },
      column_state: [
        { colId: "core_name", width: 210 },
        { colId: "via:0:0", width: 333 },
      ],
    });
  });

  it("a pill switched off before the strip's Save leaves its column's layout out", async () => {
    mockApi.on("patch", "/bookmarks/bm-q", (_p, body: any) => view({ ...body }));
    const { user } = await openView(
      view({
        columns: ["core_name", "via:0:0"],
        column_filter_model: { "via:0:0": F_SAP },
        column_state: [{ colId: "core_name", width: 210 }, { colId: "via:0:0", width: 333 }],
      }),
    );
    await waitFor(() => expect(colIds()).toContain("via:0:0"));
    await user.click(pill(/matched IT Component/));
    await waitFor(() => expect(colIds()).not.toContain("via:0:0"));
    await user.click(screen.getByTestId("query-path-edit"));
    await user.click(screen.getByTestId("query-path-save"));
    await waitFor(() => expect(mockApi.callsOf("patch", "/bookmarks/bm-q")).toHaveLength(1));
    expect(mockApi.callsOf("patch", "/bookmarks/bm-q")[0].body).toEqual({
      query: QUERY,
      columns: ["core_name"],
      column_filter_model: null,
      column_state: [{ colId: "core_name", width: 210 }],
    });
  });

  it("a key a save dropped stays dropped when a later save brings its step back", async () => {
    mockApi.on("patch", "/bookmarks/bm-q", (_p, body: any) => view({ ...body }));
    const { user } = await openView(view({ columns: ["core_name", "via:0:0"] }));
    await waitFor(() => expect(colIds()).toContain("via:0:0"));

    const retype = async (pick: RegExp) => {
      await user.click(screen.getByTestId("query-path-edit"));
      await user.click(screen.getByTestId("query-path-verb"));
      await user.click(await screen.findByRole("menuitem", { name: /Remove this hop/ }));
      await user.click(screen.getByTestId("query-path-add-hop"));
      await user.click(await screen.findByRole("menuitem", { name: pick }));
      await user.click(screen.getByTestId("query-path-save"));
    };
    await retype(/Business Capability/);
    await waitFor(() => expect(mockApi.callsOf("patch", "/bookmarks/bm-q")).toHaveLength(1));
    expect(mockApi.callsOf("patch", "/bookmarks/bm-q")[0].body).toMatchObject({
      query: RETYPED,
      columns: ["core_name"],
    });
    await waitFor(() => expect(screen.queryByTestId("query-path-save")).toBeNull());
    expect(colIds()).not.toContain("via:0:0");

    await retype(/IT Component/);
    await waitFor(() => expect(mockApi.callsOf("patch", "/bookmarks/bm-q")).toHaveLength(2));
    expect(mockApi.callsOf("patch", "/bookmarks/bm-q")[1].body).toEqual({ query: QUERY });
    await waitFor(() => expect(screen.queryByTestId("query-path-save")).toBeNull());
    await flush();
    expect(colIds()).not.toContain("via:0:0");
    expect(pill(/matched IT Component/)).toHaveAttribute("aria-pressed", "false");
  });
});

// ---------------------------------------------------------------------------
// The prefix dispatches
// ---------------------------------------------------------------------------

describe("via: in the cell dispatches", () => {
  const ctx = (colId: string, displayValue: string): CellMenuContext<any> =>
    ({ colId, data: ERP, displayValue, filterValue: displayValue }) as unknown as CellMenuContext<any>;

  it("is never fillable", () => {
    expect(isInventoryFillable("via:0:0", { field: "anything" })).toBe(false);
  });

  it("splits on '; ' and leaves the more mark out", () => {
    expect(splitInventoryCellValues(ctx("via:0:0", "PostgreSQL; Ubuntu LTS; …"))).toEqual([
      { label: "PostgreSQL", filter: "PostgreSQL" },
      { label: "Ubuntu LTS", filter: "Ubuntu LTS" },
    ]);
    expect(splitInventoryCellValues(ctx("via:0:0", ""))).toBeNull();
  });

  it("previews the matched cards in the step's type", () => {
    const deps = {
      relationSides: [],
      relatedRefsOnSide: () => [],
      typeGlyph: (typeKey: string) => ({ icon: `${typeKey}-icon`, color: "c" }),
      locale: "en",
      viaCellOf: (cardId: string, key: string) =>
        cardId === ERP.id && key === "0:0"
          ? { cell: { cards: [PG, LINUX], more: false }, typeKey: "ITComponent" }
          : null,
    };
    expect(inventoryPreviewTargets(ctx("via:0:0", ""), deps)).toEqual([
      { key: PG.id, label: "PostgreSQL", icon: "ITComponent-icon", color: "c" },
      { key: LINUX.id, label: "Ubuntu LTS", icon: "ITComponent-icon", color: "c" },
    ]);
    expect(inventoryPreviewTargets(ctx("via:0:1", ""), deps)).toEqual([]);
    const withoutVia = { ...deps, viaCellOf: undefined };
    expect(inventoryPreviewTargets(ctx("via:0:0", ""), withoutVia)).toEqual([]);
  });
});

