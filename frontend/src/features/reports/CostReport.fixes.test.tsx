/**
 * Regression tests for cost-report bugs fixed after the mutation pass.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { createRef } from "react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useCurrency", () => import("@/test/hooks").then((m) => m.useCurrencyModule()));
vi.mock("@/hooks/useAuth", () => import("@/test/hooks").then((m) => m.useAuthModule()));
vi.mock("@/hooks/useIsRtl", () => import("@/test/hooks").then((m) => m.useIsRtlModule()));

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
  useThumbnailCapture: () => ({ chartRef: createRef(), thumbnail: undefined, captureAndSave: () => {} }),
}));
vi.mock("@/features/reports/SaveReportDialog", () => ({ default: () => null }));
vi.mock("@/components/CardDetailSidePanel", () => ({ default: () => null }));
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Treemap: () => <div data-testid="treemap" />,
  Tooltip: () => null,
}));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { userWith } from "@/test/render";
import { makeCardType, makeField, makeSection } from "@/test/fixtures/metamodel";
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

const PROJECT_TYPE = makeCardType({
  key: "Project",
  label: "Project",
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

beforeEach(() => {
  mockApi.reset();
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

describe("CostReport restore", () => {
  it("keeps a restored cost field of another type when the starting type lacks costTotalAnnual", async () => {
    withMetamodel([APP_WITHOUT_TOTAL, PROJECT_TYPE], []);
    saved.config = { cardTypeKey: "Project", costField: "opex" };
    renderCost();
    await screen.findByTestId("treemap");
    await waitFor(() =>
      expect(lastPersisted()).toMatchObject({ cardTypeKey: "Project", costField: "opex" }),
    );
    expect(screen.getByRole("combobox", { name: /cost field/i })).toHaveTextContent("Opex");
    const projectFields = treemapCalls()
      .filter((p) => p.get("type") === "Project")
      .map((p) => p.get("cost_field"));
    expect(projectFields).toEqual(["opex"]);
  });

  it("keeps a restored cost field of the starting type when it lacks costTotalAnnual", async () => {
    const appTwo = makeCardType({
      ...APP_WITHOUT_TOTAL,
      fields_schema: [
        ...APP_WITHOUT_TOTAL.fields_schema,
        makeSection({
          section: "Run",
          fields: [makeField({ key: "runCost", label: "Run Cost", type: "cost" })],
        }),
      ],
    });
    withMetamodel([appTwo], []);
    saved.config = { costField: "runCost" };
    renderCost();
    await screen.findByTestId("treemap");
    await waitFor(() => expect(lastPersisted()).toMatchObject({ costField: "runCost" }));
    expect(screen.getByRole("combobox", { name: /cost field/i })).toHaveTextContent("Run Cost");
    const fields = treemapCalls().map((p) => p.get("cost_field"));
    expect(fields[fields.length - 1]).toBe("runCost");
    expect(fields).not.toContain("appCost");
  });

  it("still picks the type's first cost field when nothing was restored", async () => {
    withMetamodel([APP_WITHOUT_TOTAL, PROJECT_TYPE], []);
    renderCost();
    await screen.findByTestId("treemap");
    await waitFor(() => expect(lastPersisted()).toMatchObject({ costField: "appCost" }));
    const fields = treemapCalls().map((p) => p.get("cost_field"));
    expect(fields[fields.length - 1]).toBe("appCost");
  });
});
