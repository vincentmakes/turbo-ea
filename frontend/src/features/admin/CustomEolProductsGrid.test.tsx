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

  it("explains a refused delete instead of the raw error", async () => {
    mockApi.fail("delete", "/eol/custom-products/acme-erp", 409, {
      code: "cards_linked",
      count: 2,
      message: "Cards are still linked to this product",
    });
    const { user } = await renderGrid();
    const cell = gridStub.colDef("actions").cellRenderer as (p: { data: unknown }) => React.ReactElement;
    const actions = render(cell({ data: row("c1") }));
    await user.click(within(actions.container).getByRole("button"));
    await user.click(await screen.findByRole("menuitem", { name: /Delete product/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/2 cards still link this product/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    // The reload that follows the delete must not wipe the explanation.
    expect(await screen.findByText(/Cards still link this product \(2 that you can see\)/)).toBeInTheDocument();
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
