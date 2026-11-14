/**
 * Regression tests for cost-report bugs fixed after the mutation pass.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installResizeObserver } from "@/test/dom";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { createRef } from "react";

vi.mock("@/api/client", () =>
  import("@/test/apiMock").then((m) => m.apiClientModule()),
);
vi.mock("@/hooks/useMetamodel", () =>
  import("@/test/hooks").then((m) => m.useMetamodelModule()),
);
vi.mock("@/hooks/useCurrency", () =>
  import("@/test/hooks").then((m) => m.useCurrencyModule()),
);
vi.mock("@/hooks/useAuth", () =>
  import("@/test/hooks").then((m) => m.useAuthModule()),
);
vi.mock("@/hooks/useIsRtl", () =>
  import("@/test/hooks").then((m) => m.useIsRtlModule()),
);

const saved = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
  persistConfig: (() => {}) as (cfg: Record<string, unknown>) => void,
}));
vi.mock("@/hooks/useSavedReport", () => ({
  useSavedReport: (reportType: string) => ({
    savedReport: null,
    savedReportName: null,
    saveDialogOpen: false,
    setSaveDialogOpen: () => {},
    loadedConfig: null,
    consumeConfig: () => saved.config,
    resetSavedReport: () => {},
    persistConfig: saved.persistConfig,
    resetAll: () => {},
    reportType,
  }),
}));

vi.mock("@/hooks/useThumbnailCapture", () => ({
  useThumbnailCapture: () => ({
    chartRef: createRef(),
    thumbnail: undefined,
    captureAndSave: () => {},
  }),
}));
vi.mock("@/features/reports/SaveReportDialog", () => ({ default: () => null }));
vi.mock("@/components/CardDetailSidePanel", () => ({ default: () => null }));
// jsdom has no canvas; these tests only need to know that the chart mounted.
vi.mock("@/components/charts/EChart", () => ({
  default: () => <div data-testid="treemap" />,
  EXPORT_DPR: 2,
}));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { userWith } from "@/test/render";
import {
  makeCardType,
  makeField,
  makeSection,
} from "@/test/fixtures/metamodel";
import CostReport from "./CostReport";

/** An edited metamodel: the starting type no longer carries `costTotalAnnual`. */
const APP_WITHOUT_TOTAL = makeCardType({
  key: "Application",
  label: "Application",
  fields_schema: [
    makeSection({
      section: "Money",
      fields: [makeField({ key: "appCost", label: "App Cost", type: "cost" })],
    }),
  ],
});

const ITC_TYPE = makeCardType({
  key: "ITComponent",
  label: "IT Component",
  fields_schema: [
    makeSection({
      section: "Budget",
      fields: [
        makeField({ key: "capex", label: "Capex", type: "cost" }),
        makeField({ key: "opex", label: "Opex", type: "cost" }),
      ],
    }),
  ],
});

const params = (path: string) => new URLSearchParams(path.split("?")[1]);
const treemapCalls = () =>
  mockApi.callsOf("get", "/reports/cost-treemap*").map((c) => params(c.path));
const lastPersisted = () => {
  const calls = vi.mocked(saved.persistConfig).mock.calls;
  return calls[calls.length - 1][0];
};

function renderCost() {
  return render(
    <MemoryRouter>
      <CostReport />
    </MemoryRouter>,
  );
}

// The fiscal-year slider measures its track with a ResizeObserver, which jsdom lacks.
let restoreResizeObserver: () => void;
afterEach(() => restoreResizeObserver());
beforeEach(() => {
  restoreResizeObserver = installResizeObserver();
  mockApi.reset();
  mockApi.on("get", "/metamodel/cost-item-types", []);
  hookState.reset();
  hookState.auth.user = userWith("costs.view");
  saved.config = null;
  saved.persistConfig = vi.fn();
  mockApi.on("get", "/cards*", { items: [], total: 0 });
  mockApi.on("get", "/reports/cost-treemap*", {
    items: [{ id: "a", name: "Alpha", cost: 10 }],
    total: 10,
    fiscal_year: 2026,
    fiscal_year_start: 1,
  });
});

const CATALOGUE = [
  { id: "1", key: "opex", label: "Opex", sort_order: 1, archived: false, translations: {} },
  { id: "2", key: "runCost", label: "Run Cost", sort_order: 2, archived: false, translations: {} },
];

describe("CostReport restore", () => {
  it("keeps a restored catalogue cost item of another type", async () => {
    mockApi.on("get", "/metamodel/cost-item-types", CATALOGUE);
    withMetamodel([APP_WITHOUT_TOTAL, ITC_TYPE], []);
    saved.config = { cardTypeKey: "ITComponent", costField: "opex" };
    renderCost();
    await screen.findByTestId("treemap");
    await waitFor(() =>
      expect(lastPersisted()).toMatchObject({
        cardTypeKey: "ITComponent",
        costField: "opex",
      }),
    );
    expect(
      await screen.findByRole("combobox", { name: /cost field/i }),
    ).toHaveTextContent("Opex");
    const itcFields = treemapCalls()
      .filter((p) => p.get("type") === "ITComponent")
      .map((p) => p.get("cost_field"));
    expect(itcFields[itcFields.length - 1]).toBe("opex");
  });

  it("keeps a restored catalogue cost item of the starting type", async () => {
    mockApi.on("get", "/metamodel/cost-item-types", CATALOGUE);
    withMetamodel([APP_WITHOUT_TOTAL], []);
    saved.config = { costField: "runCost" };
    renderCost();
    await screen.findByTestId("treemap");
    await waitFor(() =>
      expect(lastPersisted()).toMatchObject({ costField: "runCost" }),
    );
    expect(
      await screen.findByRole("combobox", { name: /cost field/i }),
    ).toHaveTextContent("Run Cost");
    const fields = treemapCalls().map((p) => p.get("cost_field"));
    expect(fields[fields.length - 1]).toBe("runCost");
  });

  it("picks TCO when nothing was restored", async () => {
    mockApi.on("get", "/metamodel/cost-item-types", CATALOGUE);
    withMetamodel([APP_WITHOUT_TOTAL, ITC_TYPE], []);
    renderCost();
    await screen.findByTestId("treemap");
    await waitFor(() =>
      expect(lastPersisted()).toMatchObject({ costField: "costTotalAnnual" }),
    );
    const fields = treemapCalls().map((p) => p.get("cost_field"));
    expect(fields[fields.length - 1]).toBe("costTotalAnnual");
  });
});
