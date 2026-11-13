import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

vi.mock("@/lib/printDocument", async () => {
  const actual = await vi.importActual<typeof import("@/lib/printDocument")>("@/lib/printDocument");
  return { ...actual, openPrintWindow: vi.fn() };
});

vi.mock("./ppmProjectPrint", async () => {
  const actual = await vi.importActual<typeof import("./ppmProjectPrint")>("./ppmProjectPrint");
  return { ...actual, printProject: vi.fn() };
});

// The chart module the dialog imports on demand. Vitest evaluates a mock
// factory once per file, so what a test can see is whether it drew.
const chartsModule = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("./ppmProjectCharts", () => ({ renderSpendCharts: chartsModule.render }));

vi.mock("@/hooks/useIsRtl", () => import("@/test/hooks").then((m) => m.useIsRtlModule()));

vi.mock("@/features/ea-delivery/initiatives/useInitiativeStatus", () => ({
  useInitiativeStatusLabel: () => (status: string) => `status ${status} label`,
  useInitiativeStatusColor: () => (status: string) => `colour-of-${status}`,
}));

vi.mock("@/hooks/useCardSubtypeLabel", () => ({
  useCardSubtypeLabel: () => (type: string, subtype: string) => `${type}/${subtype} label`,
}));

import { mockApi } from "@/test/apiMock";
import { hookState } from "@/test/hooks";
import { renderWithProviders } from "@/test/render";
import { setViewportWidth } from "@/test/matchMedia";
import { openPrintWindow } from "@/lib/printDocument";
import type { Card, PpmBudgetLine, PpmCostLine, PpmRisk, PpmRollupOut, PpmStatusReport } from "@/types";
import {
  PPM_PDF_PREFS_KEY,
  PPM_PRINT_SECTIONS,
  printProject,
  type ProjectPrintData,
  type ProjectPrintFormat,
} from "./ppmProjectPrint";
import PpmProjectPdfDialog from "./PpmProjectPdfDialog";

const CARD = {
  id: "i1",
  type: "Initiative",
  name: "ERP Replacement",
  subtype: "project",
  description: null,
  attributes: { initiativeStatus: "onTrack" },
} as unknown as Card;

const REPORTS = [{ id: "r1" }] as unknown as PpmStatusReport[];
const COSTS = [{ id: "c1" }] as unknown as PpmCostLine[];
const BUDGETS = [{ id: "b1" }] as unknown as PpmBudgetLine[];
const RISKS = [{ id: "k1" }] as unknown as PpmRisk[];
const ROLLUP = { descendant_count: 3 } as unknown as PpmRollupOut;
const COMPLETION = { completion: 50, wbs_count: 2 };
const WBS = [{ id: "w1" }];
const TASKS = [{ id: "t1" }];

const openMock = vi.mocked(openPrintWindow);
const printMock = vi.mocked(printProject);

const LABELS = ["Overview", "Status Reports", "Budget & Costs", "Risk Management", "Tasks & Schedule"];

function fakeWindow() {
  return { close: vi.fn() } as unknown as Window & { close: ReturnType<typeof vi.fn> };
}

function renderDialog(props: { card?: Card } = {}) {
  const onClose = vi.fn();
  const result = renderWithProviders(
    <PpmProjectPdfDialog
      card={props.card ?? CARD}
      reports={REPORTS}
      costLines={COSTS}
      budgetLines={BUDGETS}
      risks={RISKS}
      rollup={ROLLUP}
      onClose={onClose}
    />,
  );
  return { ...result, onClose };
}

const box = (name: string) => screen.getByRole("checkbox", { name });
const exportButton = () => screen.getByRole("button", { name: /Export PDF/ });

describe("PpmProjectPdfDialog", () => {
  beforeEach(() => {
    localStorage.clear();
    mockApi.reset();
    mockApi.lenient({});
    mockApi.on("get", "/ppm/initiatives/i1/completion", COMPLETION);
    mockApi.on("get", "/ppm/initiatives/i1/wbs", WBS);
    mockApi.on("get", "/ppm/initiatives/i1/tasks", TASKS);
    openMock.mockReset();
    printMock.mockReset();
    hookState.reset();
    chartsModule.render.mockReset();
    chartsModule.render.mockReturnValue({});
  });
  afterEach(() => localStorage.clear());

  const ppmCalls = () => mockApi.calls.filter((c) => c.path.startsWith("/ppm/")).map((c) => c.path);

  it("ticks every section by default, in print order", () => {
    renderDialog();
    expect(screen.getByRole("dialog", { name: "Export initiative as PDF" })).toBeInTheDocument();
    expect(
      screen.getByText(/Choose the sections to include/),
    ).toBeInTheDocument();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.map((b) => b.closest("label")?.textContent)).toEqual(LABELS);
    for (const b of boxes) expect(b).toBeChecked();
    expect(exportButton()).toBeEnabled();
  });

  it("restores the choice remembered in this browser", () => {
    localStorage.setItem(PPM_PDF_PREFS_KEY, JSON.stringify(["risks"]));
    renderDialog();
    expect(box("Risk Management")).toBeChecked();
    for (const name of LABELS.filter((l) => l !== "Risk Management")) {
      expect(box(name)).not.toBeChecked();
    }
  });

  it("toggles one section and selects all or none", async () => {
    const { user } = renderDialog();
    await user.click(box("Overview"));
    expect(box("Overview")).not.toBeChecked();
    expect(box("Status Reports")).toBeChecked();
    await user.click(box("Overview"));
    expect(box("Overview")).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Deselect All" }));
    for (const name of LABELS) expect(box(name)).not.toBeChecked();
    expect(exportButton()).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Select All" }));
    for (const name of LABELS) expect(box(name)).toBeChecked();
    expect(exportButton()).toBeEnabled();
  });

  it("disables Export when nothing is ticked", async () => {
    localStorage.setItem(PPM_PDF_PREFS_KEY, JSON.stringify(["costs"]));
    const { user } = renderDialog();
    await user.click(box("Budget & Costs"));
    expect(exportButton()).toBeDisabled();
  });

  it("opens the window before any fetch, then prints what the page holds plus what it read", async () => {
    const win = fakeWindow();
    let callsWhenOpened = -1;
    openMock.mockImplementation(() => {
      callsWhenOpened = mockApi.calls.length;
      return win;
    });
    const { user, onClose } = renderDialog();
    const before = mockApi.calls.length;
    await user.click(exportButton());

    await waitFor(() => expect(printMock).toHaveBeenCalledTimes(1));
    expect(openMock).toHaveBeenCalledTimes(1);
    expect(callsWhenOpened).toBe(before);
    expect(ppmCalls().sort()).toEqual([
      "/ppm/initiatives/i1/completion",
      "/ppm/initiatives/i1/tasks",
      "/ppm/initiatives/i1/wbs",
    ]);

    const [data, sections, fmt, target] = printMock.mock.calls[0] as unknown as [
      ProjectPrintData,
      string[],
      ProjectPrintFormat,
      Window,
    ];
    expect(data).toEqual({
      card: CARD,
      subtypeLabel: "Initiative/project label",
      initiativeStatusLabel: "status onTrack label",
      initiativeStatusColor: "colour-of-onTrack",
      reports: REPORTS,
      costLines: COSTS,
      budgetLines: BUDGETS,
      risks: RISKS,
      rollup: ROLLUP,
      completion: COMPLETION,
      wbs: WBS,
      tasks: TASKS,
    });
    expect(sections).toEqual([...PPM_PRINT_SECTIONS]);
    expect(target).toBe(win);
    expect(fmt.fiscalYearStart).toBe(1);
    expect(fmt.amount(1200)).toBe("$1,200");
    expect(fmt.date("2026-03-04")).toBe("04 Mar 2026");
    expect(fmt.dateTime(new Date(2026, 2, 4, 9, 5))).toBe("04 Mar 2026 09:05");
    expect(fmt.amountCompact(1_500_000)).toBe("1.5 MUSD");
    expect(fmt.amountCompact(2_400)).toBe("2.4 kUSD");
    expect(fmt.amountCompact(950)).toBe("$950");
    expect(fmt.currency).toBe("USD");
    expect(fmt.isRtl).toBe(false);
    expect(win.close).not.toHaveBeenCalled();
    expect(localStorage.getItem(PPM_PDF_PREFS_KEY)).toBe(JSON.stringify([...PPM_PRINT_SECTIONS]));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("skips the schedule and completion reads when those sections are not ticked", async () => {
    localStorage.setItem(PPM_PDF_PREFS_KEY, JSON.stringify(["risks", "reports"]));
    openMock.mockReturnValue(fakeWindow());
    const { user } = renderDialog({ card: { ...CARD, subtype: undefined, attributes: {} } });
    await user.click(exportButton());

    await waitFor(() => expect(printMock).toHaveBeenCalledTimes(1));
    expect(ppmCalls()).toEqual([]);
    const [data, sections] = printMock.mock.calls[0] as unknown as [ProjectPrintData, string[]];
    expect(sections).toEqual(["reports", "risks"]);
    expect(data.completion).toBeNull();
    expect(data.wbs).toEqual([]);
    expect(data.tasks).toEqual([]);
    expect(data.subtypeLabel).toBeNull();
    expect(data.initiativeStatusLabel).toBeNull();
    expect(data.initiativeStatusColor).toBeNull();
  });

  it.each([
    ["a number", { initiativeStatus: 7 }],
    ["no attributes at all", undefined],
  ])("leaves the status out when it is %s", async (_label, attributes) => {
    openMock.mockReturnValue(fakeWindow());
    localStorage.setItem(PPM_PDF_PREFS_KEY, JSON.stringify(["risks"]));
    const { user } = renderDialog({ card: { ...CARD, attributes } as unknown as Card });
    await user.click(exportButton());
    await waitFor(() => expect(printMock).toHaveBeenCalledTimes(1));
    const [data] = printMock.mock.calls[0] as unknown as [ProjectPrintData];
    expect(data.initiativeStatusLabel).toBeNull();
    expect(data.initiativeStatusColor).toBeNull();
  });

  it("reads only the schedule when only the schedule is ticked", async () => {
    localStorage.setItem(PPM_PDF_PREFS_KEY, JSON.stringify(["schedule"]));
    openMock.mockReturnValue(fakeWindow());
    const { user } = renderDialog();
    await user.click(exportButton());
    await waitFor(() => expect(printMock).toHaveBeenCalledTimes(1));
    expect(ppmCalls().sort()).toEqual(["/ppm/initiatives/i1/tasks", "/ppm/initiatives/i1/wbs"]);
  });

  it("closes the window and shows the error when a read fails, and stays open", async () => {
    const win = fakeWindow();
    openMock.mockReturnValue(win);
    mockApi.fail("get", "/ppm/initiatives/i1/wbs", 500);
    localStorage.setItem(PPM_PDF_PREFS_KEY, JSON.stringify(["risks", "schedule"]));
    const { user, onClose } = renderDialog();
    await user.click(exportButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("GET /ppm/initiatives/i1/wbs failed");
    expect(win.close).toHaveBeenCalledTimes(1);
    expect(printMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(localStorage.getItem(PPM_PDF_PREFS_KEY)).toBe(JSON.stringify(["risks", "schedule"]));
    expect(exportButton()).toBeEnabled();

    // A retry that succeeds clears the error.
    mockApi.on("get", "/ppm/initiatives/i1/wbs", WBS);
    await user.click(exportButton());
    await waitFor(() => expect(printMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("falls back to the generic message when a failure carries none", async () => {
    const win = fakeWindow();
    openMock.mockReturnValue(win);
    printMock.mockImplementation(() => {
      throw "not an error";
    });
    localStorage.setItem(PPM_PDF_PREFS_KEY, JSON.stringify(["risks"]));
    const { user } = renderDialog();
    await user.click(exportButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    expect(win.close).toHaveBeenCalledTimes(1);
  });

  it("lets the user dismiss the error", async () => {
    openMock.mockReturnValue(fakeWindow());
    mockApi.fail("get", "/ppm/initiatives/i1/completion", 500, "nope");
    const { user } = renderDialog();
    await user.click(exportButton());
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("writes nothing and reads nothing when the pop-up is blocked", async () => {
    openMock.mockReturnValue(null);
    const { user, onClose } = renderDialog();
    const before = mockApi.calls.length;
    await user.click(exportButton());
    await waitFor(() => expect(openMock).toHaveBeenCalledTimes(1));
    expect(mockApi.calls.length).toBe(before);
    expect(printMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(localStorage.getItem(PPM_PDF_PREFS_KEY)).toBeNull();
    expect(exportButton()).toBeEnabled();
  });

  it("exports once on a double click", async () => {
    const win = fakeWindow();
    openMock.mockReturnValue(win);
    let release!: (v: unknown) => void;
    mockApi.on("get", "/ppm/initiatives/i1/completion", () => new Promise((r) => (release = r)));
    const { user } = renderDialog();
    await user.dblClick(exportButton());
    expect(openMock).toHaveBeenCalledTimes(1);
    expect(exportButton()).toBeDisabled();
    release(COMPLETION);
    await waitFor(() => expect(printMock).toHaveBeenCalledTimes(1));
  });

  it("is a narrow dialog on a desktop and full screen on a phone", () => {
    const { unmount } = renderDialog();
    const paper = screen.getByRole("dialog");
    expect(paper).toHaveClass("MuiDialog-paperWidthXs", "MuiDialog-paperFullWidth");
    expect(paper).not.toHaveClass("MuiDialog-paperFullScreen");
    expect(screen.getByText(/Choose the sections to include/)).toHaveStyle({ marginBottom: "12px" });
    unmount();
    setViewportWidth(375);
    renderDialog();
    expect(screen.getByRole("dialog")).toHaveClass("MuiDialog-paperFullScreen");
  });

  it("spaces the error below the sections", async () => {
    openMock.mockReturnValue(fakeWindow());
    mockApi.fail("get", "/ppm/initiatives/i1/completion", 500);
    const { user } = renderDialog();
    await user.click(exportButton());
    expect(await screen.findByRole("alert")).toHaveStyle({ marginTop: "12px" });
  });

  const CHARTS = {
    fiscalYear: { src: "data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E", title: "Cumulative spend by category · FY 2026" },
    project: { src: "data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E", title: "Project to date" },
  };

  it("draws the spend charts after opening the window and prints them with the data", async () => {
    chartsModule.render.mockReturnValue(CHARTS);
    hookState.isRtl = true;
    localStorage.setItem(PPM_PDF_PREFS_KEY, JSON.stringify(["costs"]));
    openMock.mockImplementation(() => {
      expect(chartsModule.render).not.toHaveBeenCalled();
      return fakeWindow();
    });
    const { user } = renderDialog();
    await user.click(exportButton());
    await waitFor(() => expect(printMock).toHaveBeenCalledTimes(1));

    expect(chartsModule.render).toHaveBeenCalledTimes(1);
    expect(openMock.mock.invocationCallOrder[0]).toBeLessThan(
      chartsModule.render.mock.invocationCallOrder[0],
    );
    const [input] = chartsModule.render.mock.calls[0];
    expect(input).toMatchObject({ costLines: COSTS, budgetLines: BUDGETS, fiscalYearStart: 1, isRtl: true, locale: "en" });
    expect(input.today).toBeInstanceOf(Date);
    expect(Math.abs(input.today.getTime() - Date.now())).toBeLessThan(60_000);
    expect(input.format(1200)).toBe("$1,200");
    expect(input.formatShort(2500)).toBe("$3k");
    expect(input.t("projectCumulative")).toBe("Project to date");

    const [data, , fmt] = printMock.mock.calls[0] as unknown as [ProjectPrintData, string[], ProjectPrintFormat];
    expect(data.charts).toEqual(CHARTS);
    expect(fmt.isRtl).toBe(true);
  });

  it("neither loads nor draws the charts when Budget & Costs is not ticked", async () => {
    chartsModule.render.mockReturnValue(CHARTS);
    localStorage.setItem(PPM_PDF_PREFS_KEY, JSON.stringify(["overview", "reports", "risks", "schedule"]));
    openMock.mockReturnValue(fakeWindow());
    const { user } = renderDialog();
    await user.click(exportButton());
    await waitFor(() => expect(printMock).toHaveBeenCalledTimes(1));
    expect(chartsModule.render).not.toHaveBeenCalled();
    const [data] = printMock.mock.calls[0] as unknown as [ProjectPrintData];
    expect(data).not.toHaveProperty("charts");
  });

  it("prints without charts when there is nothing to chart", async () => {
    chartsModule.render.mockReturnValue({});
    localStorage.setItem(PPM_PDF_PREFS_KEY, JSON.stringify(["costs"]));
    openMock.mockReturnValue(fakeWindow());
    const { user } = renderDialog();
    await user.click(exportButton());
    await waitFor(() => expect(printMock).toHaveBeenCalledTimes(1));
    expect(chartsModule.render).toHaveBeenCalledTimes(1);
    const [data] = printMock.mock.calls[0] as unknown as [ProjectPrintData];
    expect(data).not.toHaveProperty("charts");
  });

  it("still prints, without charts and without an error, when a chart cannot be drawn", async () => {
    chartsModule.render.mockImplementation(() => {
      throw new Error("no canvas");
    });
    const win = fakeWindow();
    openMock.mockReturnValue(win);
    const { user, onClose } = renderDialog();
    await user.click(exportButton());
    await waitFor(() => expect(printMock).toHaveBeenCalledTimes(1));
    const [data, sections] = printMock.mock.calls[0] as unknown as [ProjectPrintData, string[]];
    expect(sections).toEqual([...PPM_PRINT_SECTIONS]);
    expect(data).not.toHaveProperty("charts");
    expect(data.completion).toEqual(COMPLETION);
    expect(win.close).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Cancel without exporting", async () => {
    const { user, onClose } = renderDialog();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(openMock).not.toHaveBeenCalled();
  });
});
