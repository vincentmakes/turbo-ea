/**
 * Settings → EOL → Custom products: which dialog each toolbar button, row
 * menu item and hint chip opens, with which product, and what closing or
 * finishing it does to the page. The dialogs are stubbed — each has its own
 * suite — so only the page's wiring is under test here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("ag-grid-react", () => import("@/test/agGridStub").then((m) => m.agGridReactModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
vi.mock("@/hooks/useThemeMode", () => import("@/test/hooks").then((m) => m.useThemeModeModule()));
vi.mock("@/hooks/useIsRtl", () => import("@/test/hooks").then((m) => m.useIsRtlModule()));

type Cb = () => void;
vi.mock("@/components/CustomEolProductDialog", () => ({
  default: (p: { open: boolean; product: { title: string } | null; onClose: Cb; onSaved: Cb }) =>
    p.open ? (
      <div data-testid="product-dialog">
        {p.product ? p.product.title : "new product"}
        <button onClick={p.onClose}>close product</button>
        <button onClick={p.onSaved}>save product</button>
      </div>
    ) : null,
  CustomEolCycleDialog: (p: { productKey: string; productLabel: string; onClose: Cb; onSaved: Cb }) => (
    <div data-testid="cycle-dialog">
      {`${p.productKey}|${p.productLabel}`}
      <button onClick={p.onClose}>close cycle</button>
      <button onClick={p.onSaved}>save cycle</button>
    </div>
  ),
}));
vi.mock("./ProposeEolProductDialog", () => ({
  default: (p: { open: boolean; product: { key: string } | null; onClose: Cb }) =>
    p.open ? (
      <div data-testid="propose-dialog">
        {p.product?.key}
        <button onClick={p.onClose}>close propose</button>
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
        <button onClick={() => p.onSwitched({ relinked: 2, kept: 0, deleted: true })}>
          switch delete
        </button>
      </div>
    ) : null,
}));

import { mockApi } from "@/test/apiMock";
import { gridStub } from "@/test/agGridStub";
import { adminUser, renderWithProviders, userWith } from "@/test/render";
import type { EolCustomProduct } from "@/types";
import CustomEolProductsGrid from "./CustomEolProductsGrid";
import type { EolGridRow } from "./customEolGridModel";

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

const row = (id: string) =>
  (gridStub.rows() as Array<EolGridRow & { __group?: unknown }>).find((r) => !r.__group && r.id === id)!;
const loads = () => mockApi.callsOf("get", "/eol/custom-products").length;

async function renderGrid(user = adminUser()) {
  const result = renderWithProviders(<CustomEolProductsGrid />, { user });
  await waitFor(() => expect(screen.getByTestId("ag-grid")).toHaveAttribute("data-loading", "false"));
  return result;
}

async function menuItem(user: Awaited<ReturnType<typeof renderGrid>>["user"], id: string, name: RegExp) {
  const cell = gridStub.colDef("actions").cellRenderer as (p: { data: unknown }) => React.ReactElement;
  const actions = render(cell({ data: row(id) }));
  await user.click(within(actions.container).getByRole("button"));
  await user.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name }));
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
}

beforeEach(() => {
  localStorage.clear();
  mockApi.reset();
  gridStub.reset();
  mockApi.on("get", "/eol/custom-products", [ACME, BARE]);
  mockApi.on("get", "/eol/custom-products/upstream-matches", { "acme-erp": { name: "acme", score: 0.9 } });
});

describe("the product dialog", () => {
  it("opens empty from Add product; closing it reloads nothing", async () => {
    const { user } = await renderGrid();
    await user.click(screen.getByRole("button", { name: /Add product/ }));
    expect(screen.getByTestId("product-dialog")).toHaveTextContent("new product");
    const before = loads();
    await user.click(screen.getByRole("button", { name: "close product" }));
    expect(screen.queryByTestId("product-dialog")).toBeNull();
    expect(loads()).toBe(before);
  });

  it("opens on the row's product from the menu; saving closes it and reloads", async () => {
    const { user } = await renderGrid();
    await menuItem(user, "c1", /Edit product/);
    expect(screen.getByTestId("product-dialog")).toHaveTextContent("Acme ERP");
    const before = loads();
    await user.click(screen.getByRole("button", { name: "save product" }));
    expect(screen.queryByTestId("product-dialog")).toBeNull();
    await waitFor(() => expect(loads()).toBe(before + 1));
  });
});

describe("the cycle dialog", () => {
  it("adds a cycle to the row's product, reloading only on save", async () => {
    const { user } = await renderGrid();
    await menuItem(user, "product:bare", /Add cycle/);
    expect(screen.getByTestId("cycle-dialog")).toHaveTextContent("bare|Bare");
    const before = loads();
    await user.click(screen.getByRole("button", { name: "close cycle" }));
    expect(screen.queryByTestId("cycle-dialog")).toBeNull();
    expect(loads()).toBe(before);

    await menuItem(user, "c1", /Add cycle/);
    await user.click(screen.getByRole("button", { name: "save cycle" }));
    expect(screen.queryByTestId("cycle-dialog")).toBeNull();
    await waitFor(() => expect(loads()).toBe(before + 1));
  });
});

describe("the proposal dialog", () => {
  it("opens on the row's product and closes", async () => {
    const { user } = await renderGrid();
    await menuItem(user, "c1", /Propose to endoflife.date/);
    expect(screen.getByTestId("propose-dialog")).toHaveTextContent("acme-erp");
    await user.click(screen.getByRole("button", { name: "close propose" }));
    expect(screen.queryByTestId("propose-dialog")).toBeNull();
  });
});

describe("switching to endoflife.date", () => {
  it("starts from the matched upstream product, from the menu or the hint chip", async () => {
    const { user } = await renderGrid();
    await menuItem(user, "c1", /Switch to endoflife.date/);
    expect(screen.getByTestId("switch-dialog")).toHaveTextContent("acme-erp|acme");
    await user.click(screen.getByRole("button", { name: "close switch" }));
    expect(screen.queryByTestId("switch-dialog")).toBeNull();

    await menuItem(user, "product:bare", /Switch to endoflife.date/);
    expect(screen.getByTestId("switch-dialog")).toHaveTextContent("bare|none");
    await user.click(screen.getByRole("button", { name: "close switch" }));

    const cell = gridStub.colDef("product").cellRenderer as (p: { data: unknown }) => React.ReactElement;
    const rendered = render(cell({ data: row("c1") }));
    await user.click(within(rendered.container).getByText("On endoflife.date: acme"));
    expect(screen.getByTestId("switch-dialog")).toHaveTextContent("acme-erp|acme");
  });

  it("does not let a reader open it from the hint chip", async () => {
    const { user } = await renderGrid(userWith("eol.view"));
    const cell = gridStub.colDef("product").cellRenderer as (p: { data: unknown }) => React.ReactElement;
    const rendered = render(cell({ data: row("c1") }));
    await user.click(within(rendered.container).getByText("On endoflife.date: acme"));
    expect(screen.queryByTestId("switch-dialog")).toBeNull();
  });

  it("reports cards moved and cards kept, then reloads", async () => {
    const { user } = await renderGrid();
    await menuItem(user, "c1", /Switch to endoflife.date/);
    const before = loads();
    await user.click(screen.getByRole("button", { name: "switch keep" }));
    expect(screen.queryByTestId("switch-dialog")).toBeNull();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "3 cards switched to endoflife.date; 1 still on the custom product.",
    );
    await waitFor(() => expect(loads()).toBe(before + 1));
  });

  it("reports the custom product deleted when nothing was kept", async () => {
    const { user } = await renderGrid();
    await menuItem(user, "c1", /Switch to endoflife.date/);
    await user.click(screen.getByRole("button", { name: "switch delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "2 cards switched to endoflife.date and the custom product deleted.",
    );
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
});
