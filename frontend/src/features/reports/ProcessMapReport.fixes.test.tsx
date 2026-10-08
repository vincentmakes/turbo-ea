/**
 * Regression tests for Process Map bugs fixed after the mutation pass: a
 * failed load is shown, the print summary follows the scope, and a cost
 * stored as text neither concatenates nor poisons the roll-up.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useCurrency", () => import("@/test/hooks").then((m) => m.useCurrencyModule()));

const saved = vi.hoisted(() => ({ config: null as Record<string, unknown> | null }));
vi.mock("@/hooks/useSavedReport", () => ({
  useSavedReport: (reportType: string) => ({
    savedReport: null,
    savedReportName: null,
    saveDialogOpen: false,
    setSaveDialogOpen: () => {},
    loadedConfig: null,
    consumeConfig: () => saved.config,
    resetSavedReport: () => {},
    persistConfig: () => {},
    resetAll: () => {},
    reportType,
  }),
}));
vi.mock("@/components/CardDetailSidePanel", () => ({ default: () => null }));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { makeCardType } from "@/test/fixtures/metamodel";
import ProcessMapReport from "./ProcessMapReport";

const BP_TYPE = makeCardType({
  key: "BusinessProcess",
  label: "Business Process",
  has_hierarchy: true,
});

const proc = (over: Record<string, unknown> & { id: string; name: string }) => ({
  subtype: "process",
  parent_id: null,
  attributes: {},
  lifecycle: {},
  app_count: 0,
  total_cost: 0,
  apps: [],
  data_objects: [],
  org_ids: [],
  ctx_ids: [],
  ...over,
});

const ITEMS = [
  proc({ id: "otc", name: "Order to Cash", subtype: "category" }),
  proc({ id: "inv", name: "Invoicing", parent_id: "otc" }),
  proc({ id: "hire", name: "Hire to Retire", subtype: "category" }),
];

const renderMap = () =>
  render(
    <MemoryRouter>
      <ProcessMapReport />
    </MemoryRouter>,
  );

const toolbar = () => document.querySelector(".report-toolbar") as HTMLElement;
const printParams = () =>
  Array.from(document.querySelectorAll(".report-print-params > *")).map((el) =>
    (el.textContent ?? "").replace(/\|$/, "").trim(),
  );

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel([BP_TYPE]);
  saved.config = null;
  mockApi.on("get", "/reports/bpm/process-map", {
    items: ITEMS,
    organizations: [],
    business_contexts: [],
  });
});

describe("ProcessMapReport load failure", () => {
  it("shows the error instead of spinning forever", async () => {
    mockApi.fail("get", "/reports/bpm/process-map", 500, "Map is down");
    renderMap();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "GET /reports/bpm/process-map failed",
    );
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});

describe("ProcessMapReport print parameters", () => {
  it("drops the scope from the summary when the scope is cleared", async () => {
    saved.config = { scopeIds: ["otc"] };
    renderMap();
    await screen.findAllByText("Order to Cash");
    await waitFor(() => expect(printParams()).toContain("Scope: 1 process"));

    const chip = within(toolbar()).getByText("1 process").closest(".MuiChip-root") as HTMLElement;
    fireEvent.click(within(chip).getByTestId("CancelIcon"));
    await waitFor(() => expect(within(toolbar()).queryByText("1 process")).not.toBeInTheDocument());
    await waitFor(() => expect(printParams().some((p) => p.startsWith("Scope:"))).toBe(false));
  });
});

describe("ProcessMapReport cost roll-up", () => {
  it("adds a cost stored as a numeric string, and ignores one that is not a number", async () => {
    mockApi.on("get", "/reports/bpm/process-map", {
      items: [
        proc({
          id: "otc",
          name: "Order to Cash",
          apps: [
            { id: "a1", name: "Alpha App", attributes: { costTotalAnnual: "250" } },
            { id: "a2", name: "Beta App", attributes: { costTotalAnnual: 100 } },
            { id: "a3", name: "Gamma App", attributes: { costTotalAnnual: "n/a" } },
            { id: "a4", name: "Delta App", attributes: { costTotalAnnual: "tbd", totalAnnualCost: "50" } },
            { id: "a5", name: "Epsilon App", attributes: { costTotalAnnual: ["100"] } },
            { id: "a6", name: "Zeta App", attributes: { costTotalAnnual: true } },
          ],
        }),
      ],
      organizations: [],
      business_contexts: [],
    });
    renderMap();
    const chart = () => document.querySelector(".report-chart-area") as HTMLElement;
    await waitFor(() => expect(within(chart()).getByText("Order to Cash")).toBeInTheDocument());
    fireEvent.click(within(chart()).getByText("Order to Cash"));
    const panel = await screen.findByRole("presentation");
    const cost = within(panel).getByText("Cost", { selector: ".MuiTypography-caption" })
      .previousElementSibling?.textContent;
    expect(cost).toBe("$400");
  });
});
