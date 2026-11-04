/**
 * Settings → EOL → Custom products. The grid is the shared stub, so what is
 * asserted is what the page hands it — grouped rows, editable columns, the
 * per-cycle write a cell edit makes — and what its row menu and toolbar do.
 * `useDragFill` is replaced by a recorder so the page's fill handler can be
 * driven directly: the gesture itself is the hook's own concern, tested there.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("ag-grid-react", () => import("@/test/agGridStub").then((m) => m.agGridReactModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
vi.mock("@/hooks/useThemeMode", () => import("@/test/hooks").then((m) => m.useThemeModeModule()));
vi.mock("@/hooks/useIsRtl", () => import("@/test/hooks").then((m) => m.useIsRtlModule()));

const fill = vi.hoisted(() => ({ options: null as null | Record<string, unknown> }));
vi.mock("@/components/grid/useDragFill", () => ({
  useDragFill: (_ref: unknown, options: Record<string, unknown>) => {
    fill.options = options;
    return { gridProps: {}, sx: {}, overlay: <></>, dialog: <></> };
  },
}));

import { mockApi } from "@/test/apiMock";
import { gridStub } from "@/test/agGridStub";
import { adminUser, renderWithProviders, userWith } from "@/test/render";
import type { EolCustomProduct } from "@/types";
import CustomEolProductsGrid from "./CustomEolProductsGrid";
import { PREFS_STORAGE_KEY, type EolGridRow } from "./customEolGridModel";

const ACME: EolCustomProduct = {
  id: "p1",
  key: "acme-erp",
  product: "custom:acme-erp",
  title: "Acme ERP",
  description: null,
  link: null,
  linked_cards: 2,
  updated_at: null,
  cycles: [
    {
      id: "c2",
      cycle: "2",
      releaseDate: "2024-01-01",
      support: true,
      eol: false,
      latest: "2.4",
      latestReleaseDate: null,
      sort_order: 0,
      linked_cards: 0,
      updated_at: null,
    },
    {
      id: "c1",
      cycle: "1",
      releaseDate: "2020-01-01",
      support: false,
      eol: "2021-01-01",
      latest: null,
      latestReleaseDate: null,
      sort_order: 0,
      linked_cards: 2,
      updated_at: null,
    },
  ],
};
const BARE: EolCustomProduct = { ...ACME, id: "p2", key: "bare", product: "custom:bare", title: "Bare", linked_cards: 0, cycles: [] };

/** Member rows (not the group headers useRowGrouping interleaves). */
const members = () => (gridStub.rows() as Array<EolGridRow & { __group?: unknown }>).filter((r) => !r.__group);
const row = (id: string) => members().find((r) => r.id === id)!;

async function renderGrid(user = adminUser()) {
  const result = renderWithProviders(<CustomEolProductsGrid />, { user });
  await waitFor(() => expect(screen.getByTestId("ag-grid")).toHaveAttribute("data-loading", "false"));
  return result;
}

beforeEach(() => {
  localStorage.clear();
  mockApi.reset();
  gridStub.reset();
  fill.options = null;
  mockApi.on("get", "/eol/custom-products", [ACME, BARE]);
  mockApi.on("get", "/eol/custom-products/upstream-matches", { "acme-erp": { name: "acme", score: 0.9 } });
});

describe("rows", () => {
  it("lists one row per cycle and a placeholder for a product without one, grouped by product", async () => {
    await renderGrid();
    expect(members().map((r) => r.id)).toEqual(["c2", "c1", "product:bare"]);
    // Two product group headers sit among them.
    expect(gridStub.rows().length).toBe(5);
    expect(gridStub.cellValue("status", row("c1"), { formatted: true })).toBe("End of Life");
    expect(gridStub.cellValue("support", row("c2"), { formatted: true })).toBe("Still supported");
    expect(gridStub.cellValue("eol", row("c2"), { formatted: true })).toBe("No end of life announced");
  });

  it("turns off AG Grid's type inference so a boolean milestone never becomes a checkbox", async () => {
    await renderGrid();
    expect(gridStub.lastProps().defaultColDef.cellDataType).toBe(false);
  });

  it("freezes product and cycle by default, and honours a stored choice", async () => {
    const first = await renderGrid();
    expect(gridStub.colDef("product").pinned).toBeTruthy();
    expect(gridStub.colDef("cycle").pinned).toBeTruthy();
    first.unmount();
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ frozenColumns: [], groupBy: null }));
    await renderGrid();
    expect(gridStub.colDef("product").pinned).toBeFalsy();
    expect(gridStub.rows().length).toBe(3);
  });

  it("narrows rows from the sidebar's status filter", async () => {
    const { user } = await renderGrid();
    await user.click(screen.getByRole("button", { name: "End of Life" }));
    await waitFor(() => expect(members().map((r) => r.id)).toEqual(["c1"]));
  });
});

describe("editing", () => {
  it("makes cells editable only in edit mode, and never on a placeholder row", async () => {
    const { user } = await renderGrid();
    const editable = () => gridStub.colDef("eol").editable as (p: { data: unknown }) => boolean;
    expect(editable()({ data: row("c2") })).toBe(false);
    await user.click(screen.getByRole("button", { name: /Edit in grid/ }));
    expect(editable()({ data: row("c2") })).toBe(true);
    expect(editable()({ data: row("product:bare") })).toBe(false);
  });

  it("writes one cell with one PATCH on its cycle, then reloads", async () => {
    mockApi.on("patch", "/eol/custom-products/acme-erp/cycles/c2", {});
    await renderGrid();
    const loads = mockApi.callsOf("get", "/eol/custom-products").length;
    gridStub.editCell("latest", row("c2"), "2.5", "2.4");
    await waitFor(() => expect(mockApi.callsOf("get", "/eol/custom-products")).toHaveLength(loads + 1));
    expect(mockApi.callsOf("patch")).toEqual([
      { method: "patch", path: "/eol/custom-products/acme-erp/cycles/c2", body: { latest: "2.5" } },
    ]);
  });

  it("does nothing for an unchanged value", async () => {
    await renderGrid();
    gridStub.editCell("latest", row("c2"), "2.4", "2.4");
    expect(mockApi.callsOf("patch")).toHaveLength(0);
  });

  it("drag-fills row by row through the same PATCH, never in bulk", async () => {
    mockApi.on("patch", /\/cycles\//, {});
    mockApi.fail("patch", "/eol/custom-products/acme-erp/cycles/c1", 422, "bad date");
    await renderGrid();
    const onFill = fill.options!.onFill as (r: unknown, p: () => void) => Promise<{ succeeded: number; failures: Array<{ label: string }> }>;
    const outcome = await onFill(
      {
        colId: "eol",
        field: "eol",
        value: "2030-01-01",
        displayValue: "",
        columnLabel: "End of life",
        source: { rowId: "c2", data: row("c2") },
        targets: [
          { rowId: "c1", data: row("c1") },
          { rowId: "product:bare", data: row("product:bare") },
          { rowId: "c2", data: row("c2") },
        ],
      },
      () => {},
    );
    expect(outcome.succeeded).toBe(1);
    expect(outcome.failures.map((f) => f.label)).toEqual(["Acme ERP 1"]);
    expect(mockApi.callsOf("patch").map((c) => [c.path, c.body])).toEqual([
      ["/eol/custom-products/acme-erp/cycles/c1", { eol: "2030-01-01" }],
      ["/eol/custom-products/acme-erp/cycles/c2", { eol: "2030-01-01" }],
    ]);
    const isFillable = fill.options!.isFillable as (id: string, def: { field?: string }) => boolean;
    expect(isFillable("cycle", { field: "cycle" })).toBe(false);
    expect(isFillable("eol", { field: "eol" })).toBe(true);
  });
});

describe("toolbar and row menu", () => {
  it("shows an EOL manager the add and edit controls and the full row menu", async () => {
    const { user } = await renderGrid();
    expect(screen.getByRole("button", { name: /Add product/ })).toBeInTheDocument();
    const cell = gridStub.colDef("actions").cellRenderer as (p: { data: unknown }) => React.ReactElement;
    const actions = render(cell({ data: row("c1") }));
    await user.click(within(actions.container).getByRole("button", { name: "Actions for Acme ERP 1" }));
    const menu = await screen.findByRole("menu");
    for (const item of [
      "Edit product",
      "Add cycle…",
      "Propose to endoflife.date",
      "Switch to endoflife.date product…",
      "Delete cycle",
      "Delete product",
    ]) {
      expect(within(menu).getByRole("menuitem", { name: new RegExp(item.replace(/[.…]/g, ".")) })).toBeInTheDocument();
    }
  });

  it("gives a reader only the proposal, and no toolbar controls", async () => {
    const { user } = await renderGrid(userWith("eol.view"));
    expect(screen.queryByRole("button", { name: /Add product/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Edit in grid/ })).toBeNull();
    const cell = gridStub.colDef("actions").cellRenderer as (p: { data: unknown }) => React.ReactElement;
    const actions = render(cell({ data: row("c2") }));
    await user.click(within(actions.container).getByRole("button"));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent)).toEqual([
      expect.stringMatching(/Propose to endoflife.date/),
    ]);
  });

  it("does not offer to delete a product cards still link", async () => {
    const { user } = await renderGrid();
    const cell = gridStub.colDef("actions").cellRenderer as (p: { data: unknown }) => React.ReactElement;
    const actions = render(cell({ data: row("c1") }));
    await user.click(within(actions.container).getByRole("button"));
    await user.click(await screen.findByRole("menuitem", { name: /Delete product/ }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/^2 cards still link this product, so it cannot be deleted/),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  it("explains a refusal for cards the caller cannot see instead of the raw error", async () => {
    mockApi.fail("delete", "/eol/custom-products/bare", 409, {
      code: "cards_linked",
      count: 0,
      message: "Cards are still linked to this product",
    });
    const { user } = await renderGrid();
    const cell = gridStub.colDef("actions").cellRenderer as (p: { data: unknown }) => React.ReactElement;
    const actions = render(cell({ data: row("product:bare") }));
    await user.click(within(actions.container).getByRole("button"));
    await user.click(await screen.findByRole("menuitem", { name: /Delete product/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    // The reload that follows the delete must not wipe the explanation.
    expect(await screen.findByText(/Cards still link this product \(0 that you can see\)/)).toBeInTheDocument();
    await waitFor(() => expect(mockApi.callsOf("get", "/eol/custom-products")).toHaveLength(2));
    expect(screen.getByText(/Cards still link this product/)).toBeInTheDocument();
  });

  it("shows the endoflife.date hint on the product cell", async () => {
    await renderGrid();
    const cell = gridStub.colDef("product").cellRenderer as (p: { data: unknown }) => React.ReactElement;
    const rendered = render(cell({ data: row("c2") }));
    expect(within(rendered.container).getByText("On endoflife.date: acme")).toBeInTheDocument();
  });
});

describe("columns", () => {
  it("names, binds and edits each column as the grid expects", async () => {
    await renderGrid();
    const shape = (id: string) => {
      const d = gridStub.colDef(id);
      return [d.headerName, d.field, d.cellEditorPopup ?? null, d.cellEditorParams ?? null];
    };
    expect(shape("product")).toEqual(["Product", "productTitle", null, null]);
    expect(shape("cycle")).toEqual(["Cycle", "cycle", null, null]);
    expect(shape("releaseDate")).toEqual(["Release date", "releaseDate", true, { mode: "date" }]);
    expect(shape("support")).toEqual(["Active support", "support", true, { mode: "support" }]);
    expect(shape("eol")).toEqual(["End of life", "eol", true, { mode: "eol" }]);
    expect(shape("latest")).toEqual(["Latest version", "latest", null, null]);
    expect(shape("latestReleaseDate")).toEqual([
      "Latest release",
      "latestReleaseDate",
      true,
      { mode: "date" },
    ]);
    expect(shape("status")).toEqual(["Status", "status", null, null]);
    expect(shape("linked")).toEqual(["Linked cards", "linked", null, null]);
    expect(gridStub.colDef("linked").type).toBe("rightAligned");
    expect(shape("updated")).toEqual(["Last modified", "updated", null, null]);
    const actions = gridStub.colDef("actions");
    expect([
      actions.headerName,
      actions.sortable,
      actions.filter,
      actions.resizable,
      actions.suppressHeaderMenuButton,
    ]).toEqual(["", false, false, false, true]);
    const d = gridStub.lastProps().defaultColDef;
    expect([d.sortable, d.resizable, d.filter, d.filterParams]).toEqual([
      true,
      true,
      true,
      { buttons: ["reset"] },
    ]);
  });

  it("formats dates, milestones and blanks", async () => {
    mockApi.on("get", "/eol/custom-products", [
      {
        ...ACME,
        updated_at: "2024-06-01T10:00:00Z",
        cycles: [
          { ...ACME.cycles[0], latestReleaseDate: "2024-05-05", updated_at: "2024-06-02" },
          { ...ACME.cycles[1], support: null, releaseDate: null },
        ],
      },
    ]);
    await renderGrid();
    const f = (col: string, id: string) => gridStub.cellValue(col, row(id), { formatted: true });
    expect(f("releaseDate", "c2")).toBe("2024-01-01");
    expect(f("releaseDate", "c1")).toBe("");
    expect(f("latestReleaseDate", "c2")).toBe("2024-05-05");
    expect(f("latestReleaseDate", "c1")).toBe("");
    expect(f("eol", "c1")).toBe("2021-01-01");
    expect(f("support", "c1")).toBe("");
    expect(f("updated", "c2")).toMatch(/^2024-06-0\d$/);
  });

  it("marks a product without cycles in the cycle cell, and gives it no status chip", async () => {
    await renderGrid();
    const cycleCell = gridStub.colDef("cycle").cellRenderer as (p: unknown) => React.ReactNode;
    const placeholder = render(<>{cycleCell({ data: row("product:bare"), value: "" })}</>);
    expect(placeholder.container).toHaveTextContent("No cycle yet");
    const real = render(<>{cycleCell({ data: row("c2"), value: "2" })}</>);
    expect(real.container.textContent).toBe("2");
    const statusCell = gridStub.colDef("status").cellRenderer as (p: unknown) => React.ReactNode;
    expect(render(<>{statusCell({ data: row("product:bare") })}</>).container).toBeEmptyDOMElement();
    expect(render(<>{statusCell({ data: row("c1") })}</>).container).toHaveTextContent("End of Life");
  });

  it("offers the product's description and link as columns, hidden by default", async () => {
    mockApi.on("get", "/eol/custom-products", [
      { ...ACME, description: "Our ERP", link: "https://acme.example/erp" },
      { ...BARE, link: "javascript:alert(1)" },
    ]);
    await renderGrid();
    expect(gridStub.colDef("description").hide).toBe(true);
    expect(gridStub.colDef("link").hide).toBe(true);
    expect(gridStub.colDef("description").headerName).toBe("Description");
    expect(gridStub.colDef("link").headerName).toBe("Link");
    expect(gridStub.cellValue("description", row("c2"))).toBe("Our ERP");
    expect(gridStub.cellValue("description", row("product:bare"))).toBe("");
    const linkCell = gridStub.colDef("link").cellRenderer as (p: { value?: string }) => React.ReactNode;
    const link = render(<>{linkCell({ value: gridStub.cellValue("link", row("c2")) as string })}</>);
    const anchor = within(link.container).getByRole("link", { name: "https://acme.example/erp" });
    expect(anchor).toHaveAttribute("href", "https://acme.example/erp");
    expect(anchor).toHaveAttribute("target", "_blank");
    expect(anchor).toHaveAttribute("rel", "noopener noreferrer");
    // Never a link to anything but http(s).
    const unsafe = render(<>{linkCell({ value: "javascript:alert(1)" })}</>);
    expect(unsafe.container).toBeEmptyDOMElement();
  });

  it("refreshes the endoflife.date hints with every reload", async () => {
    mockApi.on("get", "/eol/custom-products/upstream-matches", {});
    mockApi.on("patch", "/eol/custom-products/acme-erp/cycles/c2", {});
    await renderGrid();
    // Read the renderer afresh each time: it closes over the current hints.
    const productCell = () =>
      render(
        (gridStub.colDef("product").cellRenderer as (p: { data: unknown }) => React.ReactElement)({
          data: row("c2"),
        }),
      ).container;
    expect(productCell()).not.toHaveTextContent(/On endoflife.date/);
    mockApi.on("get", "/eol/custom-products/upstream-matches", { "acme-erp": { name: "acme", score: 1 } });
    gridStub.editCell("latest", row("c2"), "2.5", "2.4");
    await waitFor(() =>
      expect(mockApi.callsOf("get", "/eol/custom-products/upstream-matches")).toHaveLength(2),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(productCell()).toHaveTextContent("On endoflife.date: acme");
  });

  it("hides the columns the stored preference leaves out", async () => {
    localStorage.setItem(
      PREFS_STORAGE_KEY,
      JSON.stringify({ visibleColumns: ["product", "cycle", "status", "actions"] }),
    );
    await renderGrid();
    expect(gridStub.colDef("status").hide).toBe(false);
    expect(gridStub.colDef("latest").hide).toBe(true);
  });

  it("does not edit a cell for a reader, even in edit mode's absence of controls", async () => {
    await renderGrid(userWith("eol.view"));
    const editable = gridStub.colDef("eol").editable as (p: { data?: unknown }) => boolean;
    expect(editable({ data: row("c2") })).toBe(false);
    expect(editable({})).toBe(false);
  });
});

describe("toolbar and notices", () => {
  it("toggles edit mode on the toolbar button", async () => {
    const { user } = await renderGrid();
    const button = screen.getByRole("button", { name: /Edit in grid/ });
    expect(button).toHaveClass("MuiButton-outlined");
    expect(button).toHaveTextContent("edit");
    await user.click(button);
    const done = screen.getByRole("button", { name: /Done editing/ });
    expect(done).toHaveClass("MuiButton-contained");
    expect(done).toHaveTextContent("check");
    await user.click(done);
    expect(screen.getByRole("button", { name: /Edit in grid/ })).toBeInTheDocument();
  });

  it("shows a load failure and lets it be dismissed", async () => {
    mockApi.fail("get", "/eol/custom-products", 500);
    const { user } = renderWithProviders(<CustomEolProductsGrid />, { user: adminUser() });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("GET /eol/custom-products failed");
    await user.click(within(alert).getByRole("button", { name: /close/i }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  async function openMenu(user: Awaited<ReturnType<typeof renderGrid>>["user"], id: string) {
    const cell = gridStub.colDef("actions").cellRenderer as (p: { data: unknown }) => React.ReactElement;
    const actions = render(cell({ data: row(id) }));
    await user.click(within(actions.container).getByRole("button"));
    return screen.findByRole("menu");
  }

  it("does not offer to delete a cycle cards still link, and suggests renaming it", async () => {
    const { user } = await renderGrid();
    const menu = await openMenu(user, "c1");
    await user.click(within(menu).getByRole("menuitem", { name: /Delete cycle/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Delete cycle 1?")).toBeInTheDocument();
    expect(
      within(dialog).getByText(/^2 cards still link this cycle, so it cannot be deleted\. Rename/),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  it("explains a cycle delete refused by the server", async () => {
    mockApi.fail("delete", "/eol/custom-products/acme-erp/cycles/c2", 409, {
      code: "cards_linked",
      count: 1,
      message: "Cards are still linked to this cycle",
    });
    const { user } = await renderGrid();
    const menu = await openMenu(user, "c2");
    await user.click(within(menu).getByRole("menuitem", { name: /Delete cycle/ }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "1 card still links this cycle. Rename the cycle, or link the card to another cycle, first.",
    );
  });

  it("deletes a cycle after confirming, reports it, and lets the notice go", async () => {
    mockApi.on("delete", "/eol/custom-products/acme-erp/cycles/c2", {});
    const { user } = await renderGrid();
    const menu = await openMenu(user, "c2");
    await user.click(within(menu).getByRole("menuitem", { name: /Delete cycle/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Delete cycle 2?")).toBeInTheDocument();
    expect(
      within(dialog).getByText("The cycle will be deleted. This cannot be undone."),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(mockApi.callsOf("delete").map((c) => c.path)).toEqual([
        "/eol/custom-products/acme-erp/cycles/c2",
      ]),
    );
    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent("Deleted.");
    await waitFor(() => expect(mockApi.callsOf("get", "/eol/custom-products")).toHaveLength(2));
    await user.click(within(notice).getByRole("button", { name: /close/i }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("warns plainly before deleting an unlinked product, and cancel deletes nothing", async () => {
    const { user } = await renderGrid();
    const menu = await openMenu(user, "product:bare");
    // A placeholder row has no cycle to delete.
    expect(within(menu).queryByRole("menuitem", { name: /Delete cycle/ })).toBeNull();
    await user.click(within(menu).getByRole("menuitem", { name: /Delete product/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Delete Bare?")).toBeInTheDocument();
    expect(
      within(dialog).getByText("The product and all its cycles will be deleted. This cannot be undone."),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockApi.callsOf("delete")).toHaveLength(0);
  });

  it("shows a plain error when a delete fails for another reason", async () => {
    mockApi.fail("delete", "/eol/custom-products/bare", 500);
    const { user } = await renderGrid();
    const menu = await openMenu(user, "product:bare");
    await user.click(within(menu).getByRole("menuitem", { name: /Delete product/ }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("DELETE /eol/custom-products/bare failed");
  });
});
