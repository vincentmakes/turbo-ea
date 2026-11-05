/**
 * Settings → EOL → Custom products. The grid is the shared stub, so what is
 * asserted is what the page hands it — one summary row per product, the
 * columns, the open-row class — and what a row click does: open the product
 * panel, which is stubbed here (it has its own suite).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
vi.mock("@/hooks/useThemeMode", () => import("@/test/hooks").then((m) => m.useThemeModeModule()));
vi.mock("@/hooks/useIsRtl", () => import("@/test/hooks").then((m) => m.useIsRtlModule()));

/** The stub grid, with one `redrawRows` that survives the api being rebuilt on every render. */
const redraw = vi.hoisted(() => vi.fn());
vi.mock("ag-grid-react", async () => {
  const m = await import("@/test/agGridStub");
  return {
    AgGridReact: (props: Record<string, unknown> & { ref?: { current: unknown } }) => {
      const inner = { current: null as null | { api: Record<string, unknown> } };
      const out = m.AgGridReactStub({ ...props, ref: inner });
      if (props.ref) {
        props.ref.current = {
          api: new Proxy(inner.current!.api, {
            get: (target, key: string) => (key === "redrawRows" ? redraw : target[key]),
          }),
        };
      }
      return out;
    },
  };
});

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
import type { EolCustomCycle, EolCustomProduct } from "@/types";
import CustomEolProductsGrid from "./CustomEolProductsGrid";
import { PREFS_STORAGE_KEY, type EolProductRow } from "./customEolGridModel";

const cycle = (over: Partial<EolCustomCycle>): EolCustomCycle => ({
  id: "c",
  cycle: "1",
  releaseDate: null,
  support: null,
  eol: false,
  latest: null,
  latestReleaseDate: null,
  sort_order: 0,
  linked_cards: 0,
  updated_at: null,
  ...over,
});

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
  updated_at: "2024-06-01",
  cycles: [
    cycle({ id: "c1", cycle: "1", releaseDate: "2020-01-01", support: false, eol: "2021-01-01", linked_cards: 2 }),
    cycle({ id: "c2", cycle: "2", releaseDate: "2024-01-01", support: true, eol: false, latest: "2.4", updated_at: "2024-06-03" }),
  ],
};
const FINE: EolCustomProduct = {
  ...ACME,
  id: "p3",
  key: "fine",
  product: "custom:fine",
  title: "Fine",
  linked_cards: 1,
  updated_at: null,
  cycles: [cycle({ id: "f1", cycle: "9", support: true, eol: false, latest: "9.1" })],
};
const BARE: EolCustomProduct = {
  ...ACME,
  id: "p2",
  key: "bare",
  product: "custom:bare",
  title: "Bare",
  linked_cards: 0,
  updated_at: null,
  cycles: [],
};

const rows = () => gridStub.rows() as EolProductRow[];
const row = (key: string) => rows().find((r) => r.key === key)!;
const loads = () => mockApi.callsOf("get", "/eol/custom-products").length;
const cellText = (col: string, key: string) => gridStub.cellValue(col, row(key), { formatted: true });

async function renderGrid(user = adminUser()) {
  const result = renderWithProviders(<CustomEolProductsGrid />, { user });
  await waitFor(() => expect(screen.getByTestId("ag-grid")).toHaveAttribute("data-loading", "false"));
  return result;
}

function clickRow(key: string, target: Element = document.createElement("div")) {
  act(() => {
    gridStub.fire("rowClicked", { data: row(key), event: { target } });
  });
}

beforeEach(() => {
  localStorage.clear();
  mockApi.reset();
  gridStub.reset();
  redraw.mockClear();
  panel.props = null;
  mockApi.on("get", "/eol/custom-products", [ACME, BARE, FINE]);
  mockApi.on("get", "/eol/custom-products/upstream-matches", { "acme-erp": { name: "acme", score: 0.9 } });
});

describe("rows", () => {
  it("lists one row per product with what its cycles add up to", async () => {
    await renderGrid();
    expect(rows().map((r) => r.key)).toEqual(["acme-erp", "bare", "fine"]);
    expect(gridStub.lastProps().getRowId({ data: row("fine") })).toBe("fine");
    expect(
      ["product", "cycles", "latestCycle", "latest", "status", "linked", "updated"].map((c) =>
        cellText(c, "acme-erp"),
      ),
    ).toEqual(["Acme ERP", 2, "2", "2.4", "End of Life", 2, "2024-06-03"]);
    expect(
      ["product", "cycles", "latestCycle", "latest", "status", "linked", "updated"].map((c) =>
        cellText(c, "bare"),
      ),
    ).toEqual(["Bare", 0, null, null, "Unknown", 0, ""]);
    expect(cellText("status", "fine")).toBe("Supported");
  });

  it("names and aligns each column", async () => {
    await renderGrid();
    const shape = (id: string) => {
      const d = gridStub.colDef(id);
      return [d.headerName, d.field ?? null, d.type ?? null];
    };
    expect(gridStub.colDefs().map((d) => d.colId)).toEqual([
      "product",
      "cycles",
      "latestCycle",
      "latest",
      "status",
      "linked",
      "updated",
      "description",
      "link",
    ]);
    expect(shape("product")).toEqual(["Product", "title", null]);
    expect(shape("cycles")).toEqual(["Cycles", "cycleCount", "rightAligned"]);
    expect(shape("latestCycle")).toEqual(["Latest cycle", "latestCycle", null]);
    expect(shape("latest")).toEqual(["Latest version", "latestVersion", null]);
    expect(shape("status")).toEqual(["Status", "status", null]);
    expect(shape("linked")).toEqual(["Linked cards", "linked", "rightAligned"]);
    expect(shape("updated")).toEqual(["Last modified", "updated", null]);
    const d = gridStub.lastProps().defaultColDef;
    expect([d.sortable, d.resizable, d.filter, d.filterParams, d.cellDataType]).toEqual([
      true,
      true,
      true,
      { buttons: ["reset"] },
      false,
    ]);
  });

  it("renders the worst status as a chip and counts every status in its tooltip", async () => {
    await renderGrid();
    const status = gridStub.colDef("status");
    const chip = render(<>{status.cellRenderer({ data: row("acme-erp") })}</>);
    expect(chip.container).toHaveTextContent("End of Life");
    expect(render(<>{status.cellRenderer({})}</>).container).toBeEmptyDOMElement();
    expect(status.tooltipValueGetter({ data: row("acme-erp") })).toBe("End of Life: 1 · Supported: 1");
    expect(status.tooltipValueGetter({ data: row("bare") })).toBe("No cycle yet");
    expect(status.filterValueGetter({ data: row("fine") })).toBe("Supported");
    expect(status.filterValueGetter({})).toBe("");
    expect(gridStub.colDef("updated").filterValueGetter({ data: row("acme-erp") })).toBe("2024-06-03");
  });

  it("freezes only the product column by default", async () => {
    await renderGrid();
    expect(gridStub.colDef("product").pinned).toBeTruthy();
    for (const id of ["cycles", "latestCycle", "status"]) expect(gridStub.colDef(id).pinned).toBeFalsy();
  });

  it("honours preferences under the new key and ignores the old one", async () => {
    localStorage.setItem(
      "turboea.eolCustomProducts.prefs",
      JSON.stringify({ frozenColumns: [], visibleColumns: ["product"] }),
    );
    const first = await renderGrid();
    expect(gridStub.colDef("product").pinned).toBeTruthy();
    expect(gridStub.colDef("status").hide).toBe(false);
    first.unmount();
    localStorage.setItem(
      PREFS_STORAGE_KEY,
      JSON.stringify({ frozenColumns: ["status"], visibleColumns: ["product", "status"] }),
    );
    await renderGrid();
    expect(gridStub.colDef("product").pinned).toBeFalsy();
    expect(gridStub.colDef("status").pinned).toBeTruthy();
    expect(gridStub.colDef("latest").hide).toBe(true);
    expect(gridStub.colDef("status").hide).toBe(false);
  });

  it("narrows rows by each product's worst status", async () => {
    const { user } = await renderGrid();
    await user.click(screen.getByRole("button", { name: "Supported" }));
    // Acme has a supported cycle too, but its chip says End of Life.
    await waitFor(() => expect(rows().map((r) => r.key)).toEqual(["fine"]));
    await user.click(screen.getByRole("button", { name: "Supported" }));
    await user.click(screen.getByRole("button", { name: "Unknown" }));
    await waitFor(() => expect(rows().map((r) => r.key)).toEqual(["bare"]));
  });

  it("offers the product's description and link, hidden by default; only http(s) links", async () => {
    mockApi.on("get", "/eol/custom-products", [
      { ...ACME, description: "Our ERP", link: "https://acme.example/erp" },
      { ...BARE, link: "javascript:alert(1)" },
    ]);
    await renderGrid();
    expect(gridStub.colDef("description").hide).toBe(true);
    expect(gridStub.colDef("link").hide).toBe(true);
    expect(gridStub.cellValue("description", row("acme-erp"))).toBe("Our ERP");
    expect(gridStub.cellValue("description", row("bare"))).toBe("");
    expect(gridStub.colDef("description").tooltipValueGetter({ value: "Our ERP" })).toBe("Our ERP");
    expect(gridStub.colDef("description").tooltipValueGetter({ value: "" })).toBeUndefined();
    const linkCell = gridStub.colDef("link").cellRenderer;
    const link = render(<>{linkCell({ value: gridStub.cellValue("link", row("acme-erp")) })}</>);
    const anchor = within(link.container).getByRole("link", { name: "https://acme.example/erp" });
    expect(anchor).toHaveAttribute("target", "_blank");
    expect(anchor).toHaveAttribute("rel", "noopener noreferrer");
    expect(
      render(<>{linkCell({ value: gridStub.cellValue("link", row("bare")) })}</>).container,
    ).toBeEmptyDOMElement();
    expect(gridStub.cellValue("link", { ...row("bare"), product: { ...BARE, link: null } })).toBe("");
  });

  it("shows the endoflife.date hint chip on a matched product only", async () => {
    await renderGrid();
    const cell = gridStub.colDef("product").cellRenderer;
    const acme = render(cell({ data: row("acme-erp") }));
    expect(within(acme.container).getByText("On endoflife.date")).toBeInTheDocument();
    expect(acme.container).toHaveTextContent("Acme ERP");
    expect(acme.container).not.toHaveTextContent("acme-erp");
    const fine = render(cell({ data: row("fine") }));
    expect(fine.container).toHaveTextContent("Fine");
    expect(fine.container).not.toHaveTextContent("On endoflife.date");
    expect(cell({})).toBeNull();
  });

  it("shows the empty text for the caller's role", async () => {
    mockApi.on("get", "/eol/custom-products", []);
    await renderGrid();
    expect(gridStub.lastProps().overlayNoRowsTemplate).toContain("No custom EOL products yet. Add one here");
  });

  it("tells a reader an EOL manager adds products, and offers no Add", async () => {
    mockApi.on("get", "/eol/custom-products", []);
    await renderGrid(userWith("eol.view"));
    expect(gridStub.lastProps().overlayNoRowsTemplate).toContain("An EOL manager can add one");
    expect(screen.queryByRole("button", { name: /Add product/ })).toBeNull();
  });
});

describe("the open product", () => {
  it("opens the panel on a row click", async () => {
    await renderGrid();
    expect(screen.queryByTestId("panel")).toBeNull();
    expect(panel.props!.product).toBeNull();
    clickRow("fine");
    expect(screen.getByTestId("panel")).toHaveTextContent("Fine");
    expect(panel.props!.canManage).toBe(true);
    expect(panel.props!.upstreamMatch).toBeUndefined();
    clickRow("acme-erp");
    expect(screen.getByTestId("panel")).toHaveTextContent("Acme ERP");
    expect(panel.props!.upstreamMatch).toEqual({ name: "acme", score: 0.9 });
  });

  it("opens the panel on Enter from the keyboard, and on no other key", async () => {
    await renderGrid();
    act(() => {
      gridStub.fire("cellKeyDown", { data: row("fine"), event: { key: " " } });
    });
    expect(screen.queryByTestId("panel")).toBeNull();
    act(() => {
      gridStub.fire("cellKeyDown", { data: row("fine"), event: { key: "Enter" } });
    });
    expect(screen.getByTestId("panel")).toHaveTextContent("Fine");
    act(() => {
      gridStub.fire("cellKeyDown", { data: undefined, event: { key: "Enter" } });
    });
    expect(screen.getByTestId("panel")).toHaveTextContent("Fine");
  });

  it("tells a reader's panel it cannot manage", async () => {
    await renderGrid(userWith("eol.view"));
    clickRow("fine");
    expect(panel.props!.canManage).toBe(false);
  });

  it("does not open on a click on a link or a button inside the row", async () => {
    await renderGrid();
    const a = document.createElement("a");
    const span = document.createElement("span");
    a.appendChild(span);
    clickRow("fine", span);
    const chip = document.createElement("div");
    chip.setAttribute("role", "button");
    clickRow("fine", chip);
    clickRow("fine", document.createElement("button"));
    expect(screen.queryByTestId("panel")).toBeNull();
    act(() => {
      gridStub.fire("rowClicked", { data: row("fine"), event: null });
    });
    expect(screen.getByTestId("panel")).toHaveTextContent("Fine");
  });

  it("marks the open row and redraws when it changes", async () => {
    await renderGrid();
    const rule = () => gridStub.lastProps().rowClassRules["eol-product-open"];
    expect(rule()({ data: row("fine") })).toBe(false);
    redraw.mockClear();
    clickRow("fine");
    expect(rule()({ data: row("fine") })).toBe(true);
    expect(rule()({ data: row("bare") })).toBe(false);
    expect(rule()({})).toBe(false);
    expect(redraw).toHaveBeenCalledTimes(1);
  });

  it("closes the panel", async () => {
    await renderGrid();
    clickRow("fine");
    act(() => {
      (panel.props!.onClose as () => void)();
    });
    expect(screen.queryByTestId("panel")).toBeNull();
    expect(gridStub.lastProps().rowClassRules["eol-product-open"]({ data: row("fine") })).toBe(false);
  });

  it("reloads when the panel changes something, and closes when the product is gone", async () => {
    await renderGrid();
    clickRow("fine");
    const before = loads();
    mockApi.on("get", "/eol/custom-products", [ACME, BARE]);
    act(() => {
      (panel.props!.onChanged as () => void)();
    });
    await waitFor(() => expect(loads()).toBe(before + 1));
    await waitFor(() => expect(screen.queryByTestId("panel")).toBeNull());
  });

  it("closes, reports and reloads after the panel deletes the product", async () => {
    await renderGrid();
    clickRow("bare");
    const before = loads();
    act(() => {
      (panel.props!.onDeleted as () => void)();
    });
    expect(screen.queryByTestId("panel")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("Deleted.");
    await waitFor(() => expect(loads()).toBe(before + 1));
  });

  it("shows the panel's errors on the page", async () => {
    await renderGrid();
    clickRow("bare");
    act(() => {
      (panel.props!.onError as (m: string) => void)("Something broke");
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Something broke");
  });
});

describe("loading", () => {
  it("shows a load failure and lets it be dismissed", async () => {
    mockApi.fail("get", "/eol/custom-products", 500);
    const { user } = renderWithProviders(<CustomEolProductsGrid />, { user: adminUser() });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("GET /eol/custom-products failed");
    await user.click(within(alert).getByRole("button", { name: /close/i }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("refreshes the endoflife.date hints with every reload, and keeps them when that fails", async () => {
    mockApi.on("get", "/eol/custom-products/upstream-matches", {});
    await renderGrid();
    const productCell = () =>
      render(gridStub.colDef("product").cellRenderer({ data: row("acme-erp") })).container;
    expect(productCell()).not.toHaveTextContent(/On endoflife.date/);
    clickRow("acme-erp");
    mockApi.on("get", "/eol/custom-products/upstream-matches", { "acme-erp": { name: "acme", score: 1 } });
    act(() => {
      (panel.props!.onChanged as () => void)();
    });
    await waitFor(() => expect(mockApi.callsOf("get", "/eol/custom-products/upstream-matches")).toHaveLength(2));
    await waitFor(() => expect(productCell()).toHaveTextContent("On endoflife.date"));
    mockApi.fail("get", "/eol/custom-products/upstream-matches", 500);
    act(() => {
      (panel.props!.onChanged as () => void)();
    });
    await waitFor(() => expect(mockApi.callsOf("get", "/eol/custom-products/upstream-matches")).toHaveLength(3));
    expect(productCell()).toHaveTextContent("On endoflife.date");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
