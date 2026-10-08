/**
 * Regression tests for Lifecycle-report bugs fixed after the mutation pass.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
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
    reportType: "lifecycle",
  }),
}));
vi.mock("@/hooks/useThumbnailCapture", () => ({
  useThumbnailCapture: () => ({ chartRef: createRef(), thumbnail: undefined, captureAndSave: () => {} }),
}));
vi.mock("./SaveReportDialog", () => ({ default: () => null }));
vi.mock("@/components/CardDetailSidePanel", () => ({ default: () => null }));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { makeCardType, makeField, makeSection } from "@/test/fixtures/metamodel";
import LifecycleReport from "./LifecycleReport";

const CONTRACT = makeCardType({
  key: "Contract",
  label: "Contract",
  fields_schema: [
    makeSection({
      section: "Terms",
      fields: [
        makeField({ key: "startDate", label: "Start", type: "date" }),
        makeField({ key: "endDate", label: "End", type: "date" }),
      ],
    }),
  ],
});

/** A range far outside the ±5-year window around today, on both sides. */
const ITEMS = [
  {
    id: "c1",
    name: "Long Contract",
    type: "Contract",
    lifecycle: {},
    attributes: { startDate: "1980-06-15", endDate: "2080-06-15" },
  },
];

const ui = () => (
  <MemoryRouter>
    <LifecycleReport />
  </MemoryRouter>
);

/** The year labels on the timeline's date axis. */
function tickLabels(): string[] {
  const paper = document.querySelector(".report-chart-area .MuiPaper-outlined") as HTMLElement;
  const flex = paper.firstElementChild as HTMLElement;
  const timeline = flex.children[1] as HTMLElement;
  const axis = (timeline.firstElementChild as HTMLElement).firstElementChild as HTMLElement;
  return Array.from(axis.children).map((c) => c.textContent ?? "");
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  saved.config = null;
  mockApi.on("get", "/reports/roadmap*", { items: ITEMS });
});

describe("LifecycleReport date-range axis", () => {
  it("widens the axis to the date fields once the metamodel resolves after the data", async () => {
    hookState.metamodel = { types: [], relationTypes: [], loading: true };
    saved.config = { cardTypeKey: "Contract", useCustomDates: true };
    let answer!: (value: unknown) => void;
    mockApi.on("get", "/reports/roadmap*", () => new Promise((r) => (answer = r)));
    const view = render(ui());
    await waitFor(() =>
      expect(mockApi.callsOf("get", "/reports/roadmap?type=Contract")).toHaveLength(1),
    );
    // The data lands while the metamodel is still loading.
    await act(async () => {
      answer({ items: ITEMS });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    withMetamodel([CONTRACT]);
    view.rerender(ui());
    await screen.findByText("Long Contract");
    expect(tickLabels()[0]).toBe("1981");
    expect(tickLabels()[tickLabels().length - 1]).toBe("2080");
  });
});
