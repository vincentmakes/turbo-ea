/**
 * Items linked to a custom EOL product (`source: "custom"`): named by the
 * product's key rather than the raw `custom:` link, badged, and filterable.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { createRef } from "react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

const saved = vi.hoisted(() => ({ config: null as Record<string, unknown> | null }));
vi.mock("@/hooks/useSavedReport", () => ({
  useSavedReport: () => ({
    savedReport: null,
    savedReportName: null,
    saveDialogOpen: false,
    setSaveDialogOpen: () => {},
    loadedConfig: null,
    consumeConfig: () => saved.config,
    resetSavedReport: () => {},
    persistConfig: () => {},
    resetAll: () => {},
    reportType: "eol",
  }),
}));
vi.mock("@/hooks/useThumbnailCapture", () => ({
  useThumbnailCapture: () => ({ chartRef: createRef(), thumbnail: undefined, captureAndSave: () => {} }),
}));
vi.mock("./SaveReportDialog", () => ({ default: () => null }));
vi.mock("@/components/CardDetailSidePanel", () => ({ default: () => null }));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { makeCardType } from "@/test/fixtures/metamodel";
import EolReport from "./EolReport";

const TYPES = [
  makeCardType({ key: "ITComponent", label: "IT Component" }),
  makeCardType({ key: "Application", label: "Application" }),
];

const item = (over: Record<string, unknown> & { id: string; name: string }) => ({
  type: "ITComponent",
  eol_product: null,
  eol_cycle: null,
  status: "supported",
  source: "api",
  cycle_data: null,
  lifecycle: {},
  affected_apps: [],
  ...over,
});

const ITEMS = [
  item({
    id: "erp",
    name: "ERP Host",
    eol_product: "custom:acme-erp",
    eol_cycle: "1",
    status: "eol",
    source: "custom",
    cycle_data: { cycle: "1", releaseDate: "2018-01-01", eol: "2020-01-31" },
  }),
  item({
    id: "nginx",
    name: "Nginx LB",
    eol_product: "nginx",
    eol_cycle: "1.25",
    status: "eol",
    cycle_data: { releaseDate: "2018-01-01", eol: "2020-01-31", support: "2019-06-15", latest: "1.25.4" },
  }),
  item({
    id: "crm",
    name: "Legacy CRM",
    type: "Application",
    status: "eol",
    source: "manual",
    cycle_data: { eol: "2021-03-05" },
  }),
];

const SUMMARY = {
  eol: 3,
  approaching: 0,
  supported: 0,
  missing: 0,
  impacted_apps: 0,
  approaching_impacted_apps: 0,
  manual: 1,
};

function renderReport() {
  return render(
    <MemoryRouter>
      <EolReport />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel(TYPES);
  saved.config = null;
  mockApi.on("get", "/reports/eol", { items: ITEMS, summary: SUMMARY });
});

describe("EolReport — custom EOL products", () => {
  it("names the product by its key and badges the row Custom product", async () => {
    saved.config = { view: "table" };
    renderReport();
    await screen.findByRole("table");
    const erp = screen.getByRole("row", { name: /^ERP Host/ });
    expect(within(erp).getByText("acme-erp")).toBeInTheDocument();
    expect(within(erp).queryByText("custom:acme-erp")).toBeNull();
    expect(within(erp).getByText("Custom product")).toBeInTheDocument();
    const nginx = screen.getByRole("row", { name: /^Nginx LB/ });
    expect(within(nginx).queryByText("Custom product")).toBeNull();
  });

  it("badges the timeline row too", async () => {
    renderReport();
    await screen.findByText("Today");
    expect(screen.getAllByText("Custom product").length).toBeGreaterThan(0);
  });

  it("filters to custom-product items", async () => {
    saved.config = { view: "table", filterSource: "custom" };
    renderReport();
    await screen.findByRole("table");
    expect(screen.getByRole("row", { name: /^ERP Host/ })).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /^Nginx LB/ })).toBeNull();
    expect(screen.queryByRole("row", { name: /^Legacy CRM/ })).toBeNull();
  });

  it("offers Custom product in the source filter", async () => {
    saved.config = { view: "table" };
    renderReport();
    await screen.findByRole("table");
    await userEvent.click(screen.getByRole("combobox", { name: /Source/ }));
    expect(await screen.findByRole("option", { name: /Custom product/ })).toBeInTheDocument();
  });

  it("offers in its type filter exactly the types the report holds", async () => {
    withMetamodel([
      ...TYPES,
      makeCardType({ key: "Gadget", label: "Gadget", section_config: { eol: { hidden: false } } }),
    ]);
    mockApi.on("get", "/reports/eol", {
      items: [...ITEMS, item({ id: "g1", name: "Gizmo 9", type: "Gadget", status: "missing", source: "none" })],
      summary: SUMMARY,
    });
    saved.config = { view: "table" };
    renderReport();
    await screen.findByRole("table");
    await userEvent.click(screen.getByRole("combobox", { name: /^Type/ }));
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual(["All Types", "Application", "Gadget", "IT Component"]);
  });
});
