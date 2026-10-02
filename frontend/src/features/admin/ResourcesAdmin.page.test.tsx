/**
 * Page test for Admin → Settings → Resources.
 *
 * `ResourcesAdmin.test.tsx` pins the cell-menu facet bindings in isolation;
 * this file mounts the page. The grid is the shared stub (`@/test/agGridStub`),
 * so what is asserted is what the page hands the grid — column getters and
 * formatters through `gridStub.cellValue`, the server query it builds from
 * the sidebar's filters, and what it does with a selection. The sidebar is
 * stubbed with escape hatches because the real one mounts `CardPicker` (a
 * `/cards` search) and a dnd-kit column list, neither of which is this page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import i18n from "@/i18n";
import type { ColDef } from "ag-grid-community";
import type { RepositoryResource, ResourceStats, ResourceType } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("ag-grid-react", () => import("@/test/agGridStub").then((m) => m.agGridReactModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
vi.mock("@/hooks/useThemeMode", () => import("@/test/hooks").then((m) => m.useThemeModeModule()));
vi.mock("@/hooks/useIsRtl", () => import("@/test/hooks").then((m) => m.useIsRtlModule()));
vi.mock("@/hooks/useFileUploadsEnabled", () =>
  import("@/test/hooks").then((m) => m.useFileUploadsEnabledModule()),
);

const h = vi.hoisted(() => ({
  resourceTypes: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/hooks/useResourceTypes", () => ({
  useResourceTypes: () => {
    const all = h.resourceTypes as unknown as ResourceType[];
    return {
      resourceTypes: all,
      linkTypes: all.filter((r) => r.kind === "link_type" && r.is_enabled),
      fileCategories: all.filter((r) => r.kind === "file_category" && r.is_enabled),
      byKindKey: Object.fromEntries(all.map((r) => [`${r.kind}:${r.key}`, r])),
      loaded: true,
      refresh: vi.fn(),
    };
  },
}));

// Only the component is stubbed; the module's constants (column list, empty
// filters, kind meta) stay real because the page derives its defaults from them.
vi.mock("./ResourcesFilterSidebar", async () => {
  const actual = await vi.importActual<typeof import("./ResourcesFilterSidebar")>(
    "./ResourcesFilterSidebar",
  );
  type F = import("./ResourcesFilterSidebar").ResourceFilters;
  type O = import("./ResourcesFilterSidebar").FilterOption;
  const Stub = (props: {
    filters: F;
    onFiltersChange: (f: F) => void;
    collapsed: boolean;
    onToggleCollapse: () => void;
    visibleColumns: Set<string>;
    onVisibleColumnsChange: (next: Set<string>) => void;
    onResetColumns?: () => void;
    frozenColumns: Set<string>;
    onToggleFrozen: (id: string) => void;
    columnOrderItems: { colId: string }[];
    cardTypeOptions: O[];
    categoryOptions: O[];
    creatorOptions: O[];
  }) => {
    const { filters: f, onFiltersChange: set } = props;
    return (
      <div
        data-testid="filter-sidebar"
        data-collapsed={String(props.collapsed)}
        data-card-types={props.cardTypeOptions.map((o) => o.label).join("|")}
        data-categories={props.categoryOptions.map((o) => `${o.label}:${o.icon}`).join("|")}
        data-creators={props.creatorOptions.map((o) => o.label).join("|")}
        data-visible={Array.from(props.visibleColumns).join("|")}
        data-order={props.columnOrderItems.map((c) => c.colId).join("|")}
        data-frozen={Array.from(props.frozenColumns).join("|")}
      >
        <button data-testid="apply-search" onClick={() => set({ ...f, search: " Arch " })} />
        <button data-testid="apply-kind-file" onClick={() => set({ ...f, kinds: ["file"] })} />
        <button
          data-testid="apply-archived-active"
          onClick={() => set({ ...f, archived: "active" })}
        />
        <button
          data-testid="apply-dates"
          onClick={() => set({ ...f, dateFrom: "2026-01-01", dateTo: "2026-01-31" })}
        />
        <button
          data-testid="apply-many"
          onClick={() =>
            set({
              ...f,
              cardTypes: ["Application"],
              categories: ["diagram"],
              mimeTypes: ["application/pdf"],
              createdBy: "u1",
              card: { id: "card-1", name: "NexaCore ERP", type: "Application" },
            })
          }
        />
        <button data-testid="clear-filters" onClick={() => set(actual.EMPTY_RESOURCE_FILTERS)} />
        <button data-testid="toggle-collapse" onClick={props.onToggleCollapse} />
        <button
          data-testid="hide-url"
          onClick={() => {
            const next = new Set(props.visibleColumns);
            next.delete("url");
            props.onVisibleColumnsChange(next);
          }}
        />
        <button data-testid="reset-columns" onClick={props.onResetColumns} />
      </div>
    );
  };
  return { ...actual, default: Stub };
});

import { formatDateTimeWith } from "@/hooks/useDateFormat";
import { formatBytes } from "@/lib/formatBytes";
import { mockApi } from "@/test/apiMock";
import { gridStub } from "@/test/agGridStub";
import { installConfirm, installObjectUrl, installWindowOpen } from "@/test/dom";
import { CARD_TYPES } from "@/test/fixtures/metamodel";
import { hookState, withMetamodel } from "@/test/hooks";
import { adminUser, renderWithProviders, userWith } from "@/test/render";

import ResourcesAdmin from "./ResourcesAdmin";

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`admin:${key}`, opts) as string;
const unit = (u: string) => t(`resources.units.${u}`);
const bytes = (n: number | null) => formatBytes(n, (u) => unit(u));

const FILE_ROW: RepositoryResource = {
  id: "f1",
  kind: "file",
  card_id: "card-1",
  card_name: "NexaCore ERP",
  card_type: "Application",
  card_archived: false,
  name: "Architecture.pdf",
  category: "diagram",
  mime_type: "application/pdf",
  size: 2048,
  url: null,
  created_by: "u1",
  creator_name: "Dana Lee",
  created_at: "2026-04-01T10:00:00Z",
};

const LINK_ROW: RepositoryResource = {
  id: "l1",
  kind: "link",
  card_id: "card-2",
  card_name: "Old CRM",
  card_type: "ITComponent",
  card_archived: true,
  name: "Runbook",
  category: "runbook",
  mime_type: null,
  size: null,
  url: "https://wiki.example/runbook",
  created_by: "u2",
  creator_name: "Eve Adams",
  created_at: "2026-03-01T09:00:00Z",
};

const STATS: ResourceStats = {
  file_count: 1,
  link_count: 1,
  total_bytes: 2048,
  card_count: 2,
  by_category: [{ key: "diagram", count: 1, bytes: 2048 }],
  by_link_type: [{ key: "runbook", count: 1, bytes: 0 }],
  by_card_type: [{ key: "Application", file_count: 1, link_count: 0, bytes: 2048 }],
  largest_files: [
    { id: "f1", name: "Architecture.pdf", size: 2048, card_id: "card-1", card_name: "NexaCore ERP" },
  ],
};

const RESOURCE_TYPES = [
  {
    id: "rt1",
    kind: "file_category",
    key: "diagram",
    label: "Diagram",
    description: null,
    icon: null,
    is_enabled: true,
    built_in: true,
    sort_order: 1,
    translations: {},
  },
  {
    id: "rt2",
    kind: "link_type",
    key: "runbook",
    label: "Runbook link",
    description: null,
    icon: "menu_book",
    is_enabled: true,
    built_in: true,
    sort_order: 2,
    translations: {},
  },
  // Shares the key of the file category: the sidebar must list it once.
  {
    id: "rt3",
    kind: "link_type",
    key: "diagram",
    label: "Diagram link",
    description: null,
    icon: null,
    is_enabled: true,
    built_in: false,
    sort_order: 3,
    translations: {},
  },
];

const USERS_LITE = [
  { id: "u2", display_name: "Eve Adams", email: "eve@test.local" },
  { id: "u1", display_name: "", email: "dana@test.local" },
];

function scriptList(items = [FILE_ROW, LINK_ROW], total = items.length) {
  mockApi.on("get", "/resources?*", (path) => {
    const params = new URL(`http://x${path}`).searchParams;
    return { items, total, page: Number(params.get("page")), page_size: Number(params.get("page_size")) };
  });
  mockApi.on("get", "/resources/stats?*", STATS);
  mockApi.on("get", "/users", USERS_LITE);
}

/** Query params of the most recent list (or stats) request. */
function lastQuery(prefix: "/resources?" | "/resources/stats?") {
  const calls = mockApi.callsOf("get", `${prefix}*`);
  const path = calls[calls.length - 1]?.path ?? "";
  return new URL(`http://x${path}`).searchParams;
}

function colDef(id: string): ColDef<RepositoryResource> {
  const def = gridStub.colDef(id);
  if (!def) throw new Error(`no column ${id}`);
  return def;
}

/**
 * Render a column's cellRenderer the way the grid would, inside a router.
 * Queries are scoped to the cell's own container — `render()`'s are bound to
 * `document.body`, where the page is still mounted.
 */
function renderCell(id: string, row: RepositoryResource) {
  const def = colDef(id);
  const renderer = def.cellRenderer as (p: Record<string, unknown>) => React.ReactNode;
  const result = render(
    <MemoryRouter>{renderer({ data: row, value: (row as Record<string, unknown>)[def.field ?? ""] })}</MemoryRouter>,
  );
  return Object.assign(within(result.container), { unmount: result.unmount });
}

/** The button inside a Tooltip-wrapped `<span>` (the wrapper carries the label). */
function tooltipButton(scope: ReturnType<typeof within>, label: string) {
  return within(scope.getByLabelText(label)).getByRole("button");
}

async function renderPage(opts: Parameters<typeof renderWithProviders>[1] = {}) {
  const result = renderWithProviders(<ResourcesAdmin />, { user: adminUser(), ...opts });
  await waitFor(() => expect(screen.getByTestId("ag-grid")).toHaveAttribute("data-loading", "false"));
  return result;
}

const restores: Array<() => void> = [];

beforeEach(() => {
  mockApi.reset();
  gridStub.reset();
  hookState.reset();
  vi.clearAllMocks();
  localStorage.clear();
  withMetamodel(CARD_TYPES);
  h.resourceTypes = RESOURCE_TYPES;
  scriptList();
});

afterEach(() => {
  while (restores.length) restores.pop()!();
  vi.restoreAllMocks();
});

describe("ResourcesAdmin — loading", () => {
  it("lists the page and the stats with the default query", async () => {
    await renderPage();

    expect(screen.getByTestId("ag-grid")).toHaveAttribute("data-row-count", "2");
    expect(gridStub.rows()).toEqual([FILE_ROW, LINK_ROW]);
    expect(screen.getByText(t("resources.rangeOfTotal", { start: 1, end: 2, total: 2 }))).toBeInTheDocument();

    const q = lastQuery("/resources?");
    expect(Object.fromEntries(q.entries())).toEqual({
      page: "1",
      page_size: "50",
      sort_by: "created_at",
      sort_dir: "desc",
    });
    // The stats call carries the filters but never the paging.
    expect(Array.from(lastQuery("/resources/stats?").keys())).toEqual([]);

    // Stats panel: the KPI tiles (labels also head the collapsed breakdown tables).
    expect(screen.getAllByText(t("resources.stats.storage")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(bytes(2048)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t("resources.stats.cards")).length).toBeGreaterThan(0);
  });

  it("feeds the sidebar its option lists from the metamodel, resource types and users", async () => {
    await renderPage();
    const sidebar = screen.getByTestId("filter-sidebar");
    // Hidden types are left out; labels sorted.
    expect(sidebar).toHaveAttribute("data-card-types", "Application|Business Capability|IT Component|Provider");
    // One row per key; a file category without an icon gets the folder, a link type keeps its own.
    expect(sidebar).toHaveAttribute("data-categories", "Diagram:folder|Runbook link:menu_book");
    // Uploaders sorted by label, falling back to the email when there is no display name.
    await waitFor(() => expect(sidebar).toHaveAttribute("data-creators", "dana@test.local|Eve Adams"));
    expect(mockApi.callsOf("get", "/users")).toHaveLength(1);
  });

  it("shows the empty chip and no pager for no results", async () => {
    scriptList([], 0);
    await renderPage();
    expect(screen.getByText(t("resources.empty"))).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("renders the alert when the list fails, and the refresh button retries", async () => {
    mockApi.fail("get", "/resources?*", 500, "boom");
    const { user } = await renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("failed");
    expect(screen.getByTestId("ag-grid")).toHaveAttribute("data-row-count", "0");

    scriptList();
    await user.click(tooltipButton(screen, t("resources.refresh")));
    await waitFor(() => expect(screen.getByTestId("ag-grid")).toHaveAttribute("data-row-count", "2"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("explains when file uploads are switched off", async () => {
    hookState.fileUploads = { fileUploadsEnabled: false, fileUploadsLoaded: true };
    await renderPage();
    expect(screen.getByText(t("resources.uploadsDisabled"))).toBeInTheDocument();
  });

  it("survives a non-array /users payload", async () => {
    mockApi.on("get", "/users", { detail: "nope" });
    await renderPage();
    await waitFor(() => expect(mockApi.callsOf("get", "/users")).toHaveLength(1));
    expect(screen.getByTestId("filter-sidebar")).toHaveAttribute("data-creators", "");
  });
});

describe("ResourcesAdmin — filters, paging and sorting re-query the server", () => {
  it("maps every sidebar filter onto a query parameter and resets to page 1", async () => {
    scriptList([FILE_ROW, LINK_ROW], 120);
    const { user } = await renderPage();
    await user.click(screen.getByRole("button", { name: "Go to page 2" }));
    await waitFor(() => expect(lastQuery("/resources?").get("page")).toBe("2"));

    await user.click(screen.getByTestId("apply-search"));
    await waitFor(() => expect(lastQuery("/resources?").get("search")).toBe("Arch"));
    expect(lastQuery("/resources?").get("page")).toBe("1");
    expect(lastQuery("/resources/stats?").get("search")).toBe("Arch");

    await user.click(screen.getByTestId("apply-kind-file"));
    await waitFor(() => expect(lastQuery("/resources?").getAll("kind")).toEqual(["file"]));

    await user.click(screen.getByTestId("apply-archived-active"));
    await waitFor(() => expect(lastQuery("/resources?").get("archived")).toBe("active"));

    await user.click(screen.getByTestId("apply-many"));
    await waitFor(() => expect(lastQuery("/resources?").get("card_id")).toBe("card-1"));
    const q = lastQuery("/resources?");
    expect(q.getAll("card_type")).toEqual(["Application"]);
    expect(q.getAll("category")).toEqual(["diagram"]);
    expect(q.getAll("mime_type")).toEqual(["application/pdf"]);
    expect(q.get("created_by")).toBe("u1");

    await user.click(screen.getByTestId("apply-dates"));
    await waitFor(() => expect(lastQuery("/resources?").get("since")).toBeTruthy());
    const dated = lastQuery("/resources?");
    expect(dated.get("since")).toBe(new Date("2026-01-01").toISOString());
    // The upper bound is pushed to the end of its day so the picked day counts.
    const end = new Date("2026-01-31");
    end.setHours(23, 59, 59, 999);
    expect(dated.get("until")).toBe(end.toISOString());
    // The stats tiles say they describe a subset.
    expect(screen.getByText(t("resources.stats.filtered"))).toBeInTheDocument();

    await user.click(screen.getByTestId("clear-filters"));
    await waitFor(() => expect(lastQuery("/resources?").get("search")).toBeNull());
    expect(screen.queryByText(t("resources.stats.filtered"))).toBeNull();
  });

  it("re-queries page 1 after a filter change on a later page, behind the stale page request", async () => {
    /*
     * The page-reset effect (`setPage(1)` on `[filters, …]`) and the load
     * effect run in the same commit, so the load fires once with the stale
     * page and once more after the reset. The loader runs through
     * `useLatestRequest`, so the stale `page=2` reply can no longer overwrite
     * the `page=1` rows the range chip describes, however late it lands.
     */
    scriptList([FILE_ROW, LINK_ROW], 120);
    const { user } = await renderPage();
    await user.click(screen.getByRole("button", { name: "Go to page 2" }));
    await waitFor(() => expect(lastQuery("/resources?").get("page")).toBe("2"));
    const before = mockApi.callsOf("get", "/resources?*").length;

    await user.click(screen.getByTestId("apply-kind-file"));
    await waitFor(() => expect(lastQuery("/resources?").get("page")).toBe("1"));

    const since = mockApi
      .callsOf("get", "/resources?*")
      .slice(before)
      .map((c) => new URL(`http://x${c.path}`).searchParams)
      .map((q) => `${q.get("page")}:${q.getAll("kind").join(",")}`);
    expect(since).toEqual(["2:file", "1:file"]);
  });

  it("pages and changes the page size", async () => {
    scriptList([FILE_ROW, LINK_ROW], 120);
    const { user } = await renderPage();
    expect(screen.getByText(t("resources.rangeOfTotal", { start: 1, end: 50, total: 120 }))).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Go to page 3" }));
    await waitFor(() => expect(lastQuery("/resources?").get("page")).toBe("3"));
    expect(screen.getByText(t("resources.rangeOfTotal", { start: 101, end: 120, total: 120 }))).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: t("resources.perPage") }));
    await user.click(await screen.findByRole("option", { name: "200" }));
    await waitFor(() => expect(lastQuery("/resources?").get("page_size")).toBe("200"));
    expect(lastQuery("/resources?").get("page")).toBe("1");
    // A page size that covers everything drops the pager.
    expect(screen.queryByRole("button", { name: "Go to page 2" })).toBeNull();
  });

  it("sorts server-side from the grid's column state", async () => {
    await renderPage();
    gridStub.api().applyColumnState({ state: [{ colId: "name", sort: "asc" }] });
    act(() => {
      gridStub.fire("sortChanged");
    });
    await waitFor(() => expect(lastQuery("/resources?").get("sort_by")).toBe("name"));
    expect(lastQuery("/resources?").get("sort_dir")).toBe("asc");

    // No sorted column falls back to the newest first.
    gridStub.api().applyColumnState({ state: [{ colId: "name", sort: null }] });
    act(() => {
      gridStub.fire("sortChanged");
    });
    await waitFor(() => expect(lastQuery("/resources?").get("sort_by")).toBe("created_at"));
    expect(lastQuery("/resources?").get("sort_dir")).toBe("desc");
  });
});

describe("ResourcesAdmin — columns", () => {
  it("formats card type, category, size and date through the column defs", async () => {
    await renderPage();
    const fmt = (id: string, row: RepositoryResource) => gridStub.cellValue(id, row, { formatted: true });

    expect(fmt("card_type", FILE_ROW)).toBe("Application");
    expect(fmt("card_type", { ...FILE_ROW, card_type: "Mystery" })).toBe("Mystery");

    expect(fmt("category", FILE_ROW)).toBe("Diagram");
    expect(fmt("category", LINK_ROW)).toBe("Runbook link");
    // A link's key resolves against link types, not file categories.
    expect(fmt("category", { ...LINK_ROW, category: "diagram" })).toBe("Diagram link");
    expect(fmt("category", { ...FILE_ROW, category: null })).toBe(t("resources.noCategory"));
    expect(fmt("category", { ...FILE_ROW, category: "legacy" })).toBe("legacy");

    expect(fmt("size", FILE_ROW)).toBe(bytes(2048));
    expect(fmt("size", LINK_ROW)).toBe("");

    expect(fmt("created_at", FILE_ROW)).toBe(formatDateTimeWith("YYYY-MM-DD", FILE_ROW.created_at!));
    expect(fmt("created_at", { ...FILE_ROW, created_at: null })).toBe("");

    expect(gridStub.cellValue("mime_type", FILE_ROW)).toBe("application/pdf");
    expect(gridStub.cellValue("creator_name", LINK_ROW)).toBe("Eve Adams");
    expect(gridStub.cellValue("url", LINK_ROW)).toBe(LINK_ROW.url);
  });

  it("keys rows by kind and id so a file and a link may share an id", async () => {
    await renderPage();
    const getRowId = gridStub.lastProps().getRowId as (p: { data: RepositoryResource }) => string;
    expect(getRowId({ data: FILE_ROW })).toBe("file:f1");
    expect(getRowId({ data: { ...LINK_ROW, id: "f1" } })).toBe("link:f1");
  });

  it("builds the sortable columns plus a fixed, unsortable actions column", async () => {
    await renderPage();
    expect(gridStub.colDefs().map((c) => c.colId)).toEqual([
      "kind",
      "name",
      "card_name",
      "card_type",
      "category",
      "mime_type",
      "size",
      "url",
      "creator_name",
      "created_at",
      "actions",
    ]);
    expect(colDef("actions")).toMatchObject({ sortable: false, suppressMovable: true });
    expect(colDef("created_at").sort).toBe("desc");
    expect(gridStub.lastProps().defaultColDef).toMatchObject({ sortable: true, filter: false });
  });

  it("hides and restores columns through the sidebar and persists the choice", async () => {
    const { user } = await renderPage();
    expect(colDef("url").hide).toBe(false);

    await user.click(screen.getByTestId("hide-url"));
    await waitFor(() => expect(colDef("url").hide).toBe(true));
    const sidebar = screen.getByTestId("filter-sidebar");
    expect(sidebar.getAttribute("data-visible")).not.toContain("url");
    expect(sidebar.getAttribute("data-order")).not.toContain("url");
    expect(JSON.parse(localStorage.getItem("turboea.resources.prefs")!).visibleColumns).not.toContain("url");

    await user.click(screen.getByTestId("reset-columns"));
    await waitFor(() => expect(colDef("url").hide).toBe(false));
  });

  it("renders the kind chip, the name link and the card link", async () => {
    const objectUrl = installObjectUrl();
    restores.push(objectUrl);
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    mockApi.on("getRaw", "/file-attachments/f1/download", { blob: async () => new Blob(["pdf"]) });
    const { user } = await renderPage();

    const kind = renderCell("kind", FILE_ROW);
    expect(kind.getByText(t("resources.kinds.file"))).toBeInTheDocument();
    kind.unmount();

    const link = renderCell("name", LINK_ROW);
    expect(link.getByRole("link", { name: "Runbook" })).toHaveAttribute("href", LINK_ROW.url);
    link.unmount();

    const file = renderCell("name", FILE_ROW);
    await user.click(file.getByRole("button", { name: "Architecture.pdf" }));
    await waitFor(() => expect(objectUrl.created).toHaveLength(1));
    expect(mockApi.callsOf("getRaw", "/file-attachments/f1/download")).toHaveLength(1);
    expect(anchorClick).toHaveBeenCalled();
    expect(objectUrl.revoked).toEqual(["blob:test/1"]);
    file.unmount();

    const card = renderCell("card_name", LINK_ROW);
    expect(card.getByRole("link", { name: "Old CRM" })).toHaveAttribute("href", "/cards/card-2?tab=resources");
    expect(card.getByText(t("resources.archived"))).toBeInTheDocument();
    card.unmount();

    const active = renderCell("card_name", FILE_ROW);
    expect(active.queryByText(t("resources.archived"))).toBeNull();
  });

  it("offers download, open and delete in the actions column for an admin", async () => {
    const open = installWindowOpen();
    const confirm = installConfirm(true);
    mockApi.on("delete", "/file-attachments/f1", {});
    mockApi.on("delete", "/documents/l1", {});
    mockApi.on("getRaw", "/file-attachments/f1/download", { blob: async () => new Blob(["pdf"]) });
    restores.push(installObjectUrl());
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const { user } = await renderPage();
    const listsBefore = mockApi.callsOf("get", "/resources?*").length;

    const file = renderCell("actions", FILE_ROW);
    await user.click(file.getByRole("button", { name: t("resources.actions.download") }));
    await waitFor(() => expect(mockApi.callsOf("getRaw")).toHaveLength(1));
    await user.click(file.getByRole("button", { name: i18n.t("common:actions.delete") as string }));
    expect(confirm).toHaveBeenCalledWith(t("resources.confirmDelete", { name: "Architecture.pdf" }));
    await waitFor(() => expect(mockApi.callsOf("delete", "/file-attachments/f1")).toHaveLength(1));
    await waitFor(() => expect(mockApi.callsOf("get", "/resources?*").length).toBe(listsBefore + 1));
    file.unmount();

    const link = renderCell("actions", LINK_ROW);
    await user.click(tooltipButton(link, t("resources.actions.open")));
    expect(open).toHaveBeenCalledWith(LINK_ROW.url, "_blank", "noopener");
    await user.click(link.getByRole("button", { name: i18n.t("common:actions.delete") as string }));
    await waitFor(() => expect(mockApi.callsOf("delete", "/documents/l1")).toHaveLength(1));
    link.unmount();

    // A link without a URL cannot be opened.
    const dead = renderCell("actions", { ...LINK_ROW, url: null });
    expect(tooltipButton(dead, t("resources.actions.open"))).toBeDisabled();
  });

  it("does nothing when the single delete is declined, and shows a failed delete", async () => {
    const confirm = installConfirm(false);
    const { user } = await renderPage();
    const cell = renderCell("actions", FILE_ROW);
    await user.click(cell.getByRole("button", { name: i18n.t("common:actions.delete") as string }));
    expect(confirm).toHaveBeenCalled();
    expect(mockApi.callsOf("delete")).toHaveLength(0);
    cell.unmount();

    confirm.mockReturnValue(true);
    mockApi.fail("delete", "/file-attachments/f1", 403, "denied");
    const again = renderCell("actions", FILE_ROW);
    await user.click(again.getByRole("button", { name: i18n.t("common:actions.delete") as string }));
    expect(await screen.findByRole("alert")).toHaveTextContent("DELETE /file-attachments/f1 failed");
  });
});

describe("ResourcesAdmin — bulk delete", () => {
  it("deletes the selection after confirmation, reports skips and reloads", async () => {
    mockApi.on("post", "/resources/bulk-delete", {
      deleted: 1,
      skipped: [{ id: "l1", kind: "link", reason: "forbidden" }],
    });
    const { user } = await renderPage();
    const listsBefore = mockApi.callsOf("get", "/resources?*").length;
    expect(screen.queryByText(t("resources.bulk.delete"))).toBeNull();

    act(() => {
      gridStub.selectRows([FILE_ROW, LINK_ROW]);
    });
    expect(screen.getByText(t("resources.bulk.selected", { count: 2 }))).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Delete selected$/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(t("resources.bulk.confirmTitle"))).toBeInTheDocument();
    expect(
      within(dialog).getByText(t("resources.bulk.confirmBody", { count: 2, size: bytes(2048) })),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: t("resources.bulk.delete") }));

    await waitFor(() => expect(mockApi.callsOf("post", "/resources/bulk-delete")).toHaveLength(1));
    expect(mockApi.callsOf("post", "/resources/bulk-delete")[0].body).toEqual({
      refs: [
        { kind: "file", id: "f1" },
        { kind: "link", id: "l1" },
      ],
    });
    await waitFor(() => expect(mockApi.callsOf("get", "/resources?*").length).toBe(listsBefore + 1));
    expect(await screen.findByText(t("resources.skipped.title", { count: 1 }))).toBeInTheDocument();
    expect(screen.getByText(t("resources.skipped.row", { id: "l1", reason: "forbidden" }))).toBeInTheDocument();
    // The selection bar is gone and the dialog closed.
    expect(screen.queryByText(t("resources.bulk.selected", { count: 2 }))).toBeNull();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("cancels without calling the API, and clears the selection from the bar", async () => {
    const { user } = await renderPage();
    act(() => {
      gridStub.selectRows([FILE_ROW]);
    });
    await user.click(screen.getByRole("button", { name: /Delete selected$/ }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: i18n.t("common:actions.cancel") as string }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockApi.callsOf("post")).toHaveLength(0);

    await user.click(screen.getByTitle(t("resources.bulk.clear")));
    expect(screen.queryByText(t("resources.bulk.selected", { count: 1 }))).toBeNull();
  });

  it("surfaces a failed bulk delete and keeps the selection", async () => {
    mockApi.fail("post", "/resources/bulk-delete", 500, "boom");
    const { user } = await renderPage();
    act(() => {
      gridStub.selectRows([FILE_ROW]);
    });
    await user.click(screen.getByRole("button", { name: /Delete selected$/ }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: t("resources.bulk.delete") }));
    expect(await screen.findByRole("alert")).toHaveTextContent("POST /resources/bulk-delete failed");
    expect(screen.getByText(t("resources.bulk.selected", { count: 1 }))).toBeInTheDocument();
  });
});

describe("ResourcesAdmin — permissions", () => {
  it("gives a documents.manage holder row selection and the delete action", async () => {
    await renderPage({ user: userWith("documents.view", "documents.manage") });
    expect(gridStub.lastProps().rowSelection).toMatchObject({ mode: "multiRow", headerCheckbox: true });
    const cell = renderCell("actions", FILE_ROW);
    expect(cell.getByRole("button", { name: i18n.t("common:actions.delete") as string })).toBeInTheDocument();
  });

  it("gives a viewer neither selection nor delete", async () => {
    await renderPage({ user: userWith("documents.view") });
    expect(gridStub.lastProps().rowSelection).toBeUndefined();
    const cell = renderCell("actions", FILE_ROW);
    expect(cell.getByRole("button", { name: t("resources.actions.download") })).toBeInTheDocument();
    expect(cell.queryByRole("button", { name: i18n.t("common:actions.delete") as string })).toBeNull();
  });
});

describe("ResourcesAdmin — preferences and stats panel", () => {
  it("restores stored prefs on mount and rejects what it does not recognise", async () => {
    localStorage.setItem(
      "turboea.resources.prefs",
      JSON.stringify({
        filtersCollapsed: true,
        sidebarWidth: "wide",
        visibleColumns: ["size", "bogus"],
        frozenColumns: ["card_type", 7],
        columnOrder: ["size", "nope"],
        pageSize: 100,
        statsExpanded: true,
      }),
    );
    await renderPage();
    expect(lastQuery("/resources?").get("page_size")).toBe("100");
    const sidebar = screen.getByTestId("filter-sidebar");
    expect(sidebar).toHaveAttribute("data-collapsed", "true");
    // The locked columns are forced back in; the unknown ids dropped.
    expect(sidebar.getAttribute("data-visible")!.split("|").sort()).toEqual(
      ["kind", "name", "card_name", "actions", "size"].sort(),
    );
    expect(sidebar).toHaveAttribute("data-frozen", "card_type");
    expect(colDef("card_type").pinned).toBe("left");
    // The breakdown is open, so its tables render.
    expect(screen.getByRole("button", { name: /Hide breakdown$/ })).toBeInTheDocument();
  });

  it("falls back to defaults for an unparseable or off-list pref", async () => {
    localStorage.setItem("turboea.resources.prefs", "{not json");
    const first = await renderPage();
    expect(lastQuery("/resources?").get("page_size")).toBe("50");
    expect(screen.getByTestId("filter-sidebar")).toHaveAttribute("data-collapsed", "false");
    first.unmount();

    localStorage.setItem("turboea.resources.prefs", JSON.stringify({ pageSize: 33 }));
    mockApi.reset();
    scriptList();
    gridStub.reset();
    await renderPage();
    expect(lastQuery("/resources?").get("page_size")).toBe("50");
  });

  it("persists the collapse toggle and the breakdown state", async () => {
    const { user } = await renderPage();
    await user.click(screen.getByTestId("toggle-collapse"));
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("turboea.resources.prefs")!).filtersCollapsed).toBe(true),
    );
    expect(screen.getByTestId("filter-sidebar")).toHaveAttribute("data-collapsed", "true");

    await user.click(screen.getByRole("button", { name: /Show breakdown$/ }));
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("turboea.resources.prefs")!).statsExpanded).toBe(true),
    );
    expect(screen.getByText(t("resources.stats.byCategory"))).toBeInTheDocument();
    expect(screen.getByText(t("resources.stats.largestFiles"))).toBeInTheDocument();
    // Category and card-type keys resolve through the same labellers as the grid.
    expect(screen.getByText("Diagram")).toBeInTheDocument();
    expect(screen.getByText("Runbook link")).toBeInTheDocument();
  });
});
