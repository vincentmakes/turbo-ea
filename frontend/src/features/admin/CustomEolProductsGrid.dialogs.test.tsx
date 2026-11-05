/**
 * Settings → EOL → Custom products: which dialog the toolbar, the hint chip
 * and the product panel open, with which product, and what closing or
 * finishing it does to the page. The dialogs and the panel are stubbed —
 * each has its own suite — so only the page's wiring is under test here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("ag-grid-react", () => import("@/test/agGridStub").then((m) => m.agGridReactModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
vi.mock("@/hooks/useThemeMode", () => import("@/test/hooks").then((m) => m.useThemeModeModule()));
vi.mock("@/hooks/useIsRtl", () => import("@/test/hooks").then((m) => m.useIsRtlModule()));

type Cb = () => void;
vi.mock("@/components/CustomEolProductDialog", () => ({
  default: (p: {
    open: boolean;
    product: { title: string } | null;
    onClose: Cb;
    onSaved: (saved: { key: string }) => void;
  }) =>
    p.open ? (
      <div data-testid="product-dialog">
        {p.product ? p.product.title : "new product"}
        <button onClick={p.onClose}>close product</button>
        <button onClick={() => p.onSaved({ key: "new-one" })}>save product</button>
      </div>
    ) : null,
}));
vi.mock("./SwitchToUpstreamDialog", () => ({
  default: (p: {
    open: boolean;
    product: { key: string } | null;
    initialTarget?: string | null;
    onClose: Cb;
    onSwitched: (r: { relinked: number; kept: number; deleted: boolean }) => void;
  }) =>
    p.open ? (
      <div data-testid="switch-dialog">
        {`${p.product?.key}|${p.initialTarget ?? "none"}`}
        <button onClick={p.onClose}>close switch</button>
        <button onClick={() => p.onSwitched({ relinked: 3, kept: 1, deleted: false })}>
          switch keep
        </button>
        <button onClick={() => p.onSwitched({ relinked: 2, kept: 0, deleted: false })}>
          switch all
        </button>
        <button onClick={() => p.onSwitched({ relinked: 2, kept: 0, deleted: true })}>
          switch delete
        </button>
      </div>
    ) : null,
}));
const panel = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock("./CustomEolProductPanel", () => ({
  default: (p: Record<string, unknown> & { product: { title: string } | null }) => {
    panel.props = p;
    return p.product ? <div data-testid="panel">{p.product.title}</div> : null;
  },
}));

import { mockApi } from "@/test/apiMock";
import { gridStub } from "@/test/agGridStub";
import { adminUser, renderWithProviders, userWith } from "@/test/render";
import type { EolCustomProduct } from "@/types";
import CustomEolProductsGrid from "./CustomEolProductsGrid";
import type { EolProductRow } from "./customEolGridModel";

const ACME: EolCustomProduct = {
  id: "p1",
  key: "acme-erp",
  product: "custom:acme-erp",
  title: "Acme ERP",
  description: null,
  link: null,
  eol_category: null,
  release_policy_note: null,
  linked_cards: 2,
  updated_at: null,
  cycles: [],
};
const BARE: EolCustomProduct = { ...ACME, id: "p2", key: "bare", product: "custom:bare", title: "Bare", linked_cards: 0 };
const NEW: EolCustomProduct = { ...ACME, id: "p9", key: "new-one", product: "custom:new-one", title: "New One", linked_cards: 0 };

const row = (key: string) => (gridStub.rows() as EolProductRow[]).find((r) => r.key === key)!;
const loads = () => mockApi.callsOf("get", "/eol/custom-products").length;

async function renderGrid(user = adminUser()) {
  const result = renderWithProviders(<CustomEolProductsGrid />, { user });
  await waitFor(() => expect(screen.getByTestId("ag-grid")).toHaveAttribute("data-loading", "false"));
  return result;
}

function openRow(key: string) {
  act(() => {
    gridStub.fire("rowClicked", { data: row(key), event: { target: document.createElement("div") } });
  });
}

beforeEach(() => {
  localStorage.clear();
  mockApi.reset();
  gridStub.reset();
  panel.props = null;
  mockApi.on("get", "/eol/custom-products", [ACME, BARE]);
  mockApi.on("get", "/eol/custom-products/upstream-matches", { "acme-erp": { name: "acme", score: 0.9 } });
});

describe("Add product", () => {
  it("opens empty; closing it reloads nothing and opens no panel", async () => {
    const { user } = await renderGrid();
    await user.click(screen.getByRole("button", { name: /Add product/ }));
    expect(screen.getByTestId("product-dialog")).toHaveTextContent("new product");
    const before = loads();
    await user.click(screen.getByRole("button", { name: "close product" }));
    expect(screen.queryByTestId("product-dialog")).toBeNull();
    expect(loads()).toBe(before);
    expect(screen.queryByTestId("panel")).toBeNull();
  });

  it("on save, reloads and opens the panel on the new product", async () => {
    const { user } = await renderGrid();
    await user.click(screen.getByRole("button", { name: /Add product/ }));
    mockApi.on("get", "/eol/custom-products", [ACME, BARE, NEW]);
    const before = loads();
    await user.click(screen.getByRole("button", { name: "save product" }));
    expect(screen.queryByTestId("product-dialog")).toBeNull();
    await waitFor(() => expect(loads()).toBe(before + 1));
    expect(await screen.findByTestId("panel")).toHaveTextContent("New One");
    expect(gridStub.lastProps().rowClassRules["eol-product-open"]({ data: row("new-one") })).toBe(true);
  });
});

describe("switching to endoflife.date", () => {
  it("starts from the matched upstream product from the hint chip", async () => {
    const { user } = await renderGrid();
    const cell = gridStub.colDef("product").cellRenderer as (p: { data: unknown }) => React.ReactElement;
    const rendered = render(cell({ data: row("acme-erp") }));
    await user.click(within(rendered.container).getByText("On endoflife.date"));
    expect(screen.getByTestId("switch-dialog")).toHaveTextContent("acme-erp|acme");
    // The chip is a button, so the same click never opens the row.
    expect(within(rendered.container).getByRole("button")).toHaveTextContent("On endoflife.date");
    await user.click(screen.getByRole("button", { name: "close switch" }));
    expect(screen.queryByTestId("switch-dialog")).toBeNull();
  });

  it("does not let a reader open it from the hint chip", async () => {
    const { user } = await renderGrid(userWith("eol.view"));
    const cell = gridStub.colDef("product").cellRenderer as (p: { data: unknown }) => React.ReactElement;
    const rendered = render(cell({ data: row("acme-erp") }));
    await user.click(within(rendered.container).getByText("On endoflife.date"));
    expect(screen.queryByTestId("switch-dialog")).toBeNull();
    expect(within(rendered.container).queryByRole("button")).toBeNull();
  });

  it("opens from the panel on the open product, with the panel's target", async () => {
    await renderGrid();
    openRow("bare");
    act(() => (panel.props!.onRequestSwitch as (t: string | null) => void)(null));
    expect(screen.getByTestId("switch-dialog")).toHaveTextContent("bare|none");
    act(() => (panel.props!.onRequestSwitch as (t: string | null) => void)("postgresql"));
    expect(screen.getByTestId("switch-dialog")).toHaveTextContent("bare|postgresql");
  });

  it("does nothing from the panel when no product is open", async () => {
    await renderGrid();
    act(() => (panel.props!.onRequestSwitch as (t: string | null) => void)("postgresql"));
    expect(screen.queryByTestId("switch-dialog")).toBeNull();
  });

  it("reports cards moved and cards kept, then reloads", async () => {
    const { user } = await renderGrid();
    openRow("acme-erp");
    act(() => (panel.props!.onRequestSwitch as (t: string | null) => void)("acme"));
    const before = loads();
    await user.click(screen.getByRole("button", { name: "switch keep" }));
    expect(screen.queryByTestId("switch-dialog")).toBeNull();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "3 cards switched to endoflife.date; 1 still on the custom product.",
    );
    await waitFor(() => expect(loads()).toBe(before + 1));
  });

  it("reports every card moved", async () => {
    const { user } = await renderGrid();
    openRow("acme-erp");
    act(() => (panel.props!.onRequestSwitch as (t: string | null) => void)("acme"));
    await user.click(screen.getByRole("button", { name: "switch all" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/^2 cards switched to endoflife\.date\.$/);
  });

  it("reports the custom product deleted, and the panel closes with it", async () => {
    const { user } = await renderGrid();
    openRow("acme-erp");
    act(() => (panel.props!.onRequestSwitch as (t: string | null) => void)("acme"));
    mockApi.on("get", "/eol/custom-products", [BARE]);
    await user.click(screen.getByRole("button", { name: "switch delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "2 cards switched to endoflife.date and the custom product deleted.",
    );
    await waitFor(() => expect(screen.queryByTestId("panel")).toBeNull());
  });
});

describe("the filter sidebar", () => {
  it("collapses to its rail and opens again", async () => {
    const { user } = await renderGrid();
    await user.click(screen.getByRole("button", { name: "Hide filters" }));
    expect(screen.queryByRole("tab", { name: /Filters/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show filters" }));
    expect(screen.getByRole("tab", { name: /Filters/ })).toBeInTheDocument();
  });

  it("narrows rows from the search box", async () => {
    const { user } = await renderGrid();
    await user.type(screen.getByPlaceholderText("Product, cycle or version"), "bar");
    await waitFor(() => expect((gridStub.rows() as EolProductRow[]).map((r) => r.key)).toEqual(["bare"]));
  });
});
