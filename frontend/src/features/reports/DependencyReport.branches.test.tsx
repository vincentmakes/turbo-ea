/**
 * Branch coverage for the Dependencies report beyond the time-travel, deep
 * link and picker tests in DependencyReport.test.tsx: the Layered Dependency
 * View's expand / reveal / navigation callbacks, the tree view's interactions,
 * the picker's search and type chips, the table's card clicks, and the shell
 * actions. The LDV itself is mocked (React Flow cannot lay out in jsdom); its
 * props are captured so the report's side of each callback can be driven.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { createRef } from "react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/AuthContext", () => ({
  useOptionalAuthUser: () => null,
  useAuthContext: () => ({ user: { permissions: { "*": true } } }),
}));

const saved = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
  saveDialogOpen: false,
  setSaveDialogOpen: (() => {}) as (open: boolean) => void,
  resetAll: (() => {}) as () => void,
  persistConfig: (() => {}) as (cfg: unknown) => void,
  captureAndSave: (() => {}) as () => void,
  tlReset: (() => {}) as () => void,
}));
vi.mock("@/hooks/useSavedReport", () => ({
  useSavedReport: () => ({
    savedReport: null,
    savedReportName: null,
    saveDialogOpen: saved.saveDialogOpen,
    setSaveDialogOpen: saved.setSaveDialogOpen,
    loadedConfig: null,
    consumeConfig: () => saved.config,
    resetSavedReport: () => {},
    persistConfig: saved.persistConfig,
    resetAll: saved.resetAll,
    reportType: "dependencies",
  }),
}));
vi.mock("@/hooks/useThumbnailCapture", () => ({
  useThumbnailCapture: () => ({
    chartRef: createRef(),
    thumbnail: undefined,
    captureAndSave: () => saved.captureAndSave(),
  }),
}));
vi.mock("@/hooks/useTimeline", () => ({
  useTimeline: () => {
    const now = Date.now();
    return {
      timelineDate: now,
      setTimelineDate: () => {},
      todayMs: now,
      isTimeTraveling: false,
      persistValue: undefined,
      printParam: null,
      restore: () => {},
      reset: () => saved.tlReset(),
    };
  },
}));
vi.mock("@/components/TimelineSlider", () => ({ default: () => <div data-testid="timeline-slider" /> }));
vi.mock("./SaveReportDialog", () => ({
  default: (props: { open: boolean; onClose: () => void }) =>
    props.open ? <button onClick={props.onClose}>close-save</button> : null,
}));
vi.mock("@/components/CardDetailSidePanel", () => ({
  default: (props: { cardId: string | null; open: boolean; onClose: () => void }) =>
    props.open ? (
      <div data-testid="side-panel">
        {props.cardId}
        <button onClick={props.onClose}>close-panel</button>
      </div>
    ) : null,
}));

/* eslint-disable @typescript-eslint/no-explicit-any */
const ldv = vi.hoisted(() => ({ props: null as any }));
vi.mock("./LayeredDependencyView", () => ({
  default: (props: any) => {
    ldv.props = props;
    return <div data-testid="ldv" />;
  },
  readableTypeColor: (color: string) => color,
}));
/* eslint-enable @typescript-eslint/no-explicit-any */

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { makeCardType } from "@/test/fixtures/metamodel";
import DependencyReport from "./DependencyReport";

const TYPES = [
  makeCardType({ key: "Organization", label: "Organization", color: "#2889ff", sort_order: 1, has_hierarchy: true }),
  makeCardType({ key: "Application", label: "Application", color: "#0f7eb5", sort_order: 2 }),
  makeCardType({ key: "ITComponent", label: "IT Component", color: "#d29270", sort_order: 3 }),
];

const GRAPH = {
  nodes: [
    { id: "hq", name: "Group HQ", type: "Organization", lifecycle: {} },
    { id: "fin", name: "Finance", type: "Organization", parent_id: "hq", lifecycle: {} },
    // Related to nothing: only a Reveal-children on Group HQ brings it in.
    { id: "ops", name: "Operations", type: "Organization", parent_id: "hq", lifecycle: {} },
    { id: "alpha", name: "Alpha", type: "Application", lifecycle: { active: "2020-01-01" }, path: ["Suite"] },
    { id: "beta", name: "Beta", type: "Application", lifecycle: { active: "2020-01-01" } },
    { id: "db", name: "Oracle DB", type: "ITComponent", lifecycle: { active: "2018-01-01" } },
    { id: "os", name: "Linux", type: "ITComponent", lifecycle: { active: "2018-01-01" } },
  ],
  edges: [
    { source: "alpha", target: "db", type: "relAppToITC", label: "uses", description: "Primary database" },
    { source: "alpha", target: "beta", type: "relAppToApp", label: "sends data to" },
    { source: "beta", target: "os", type: "relAppToITC", label: "uses" },
    { source: "fin", target: "alpha", type: "relOrgToApp", label: "owns" },
    { source: "db", target: "os", type: "relItcToItc", label: "runs on" },
  ],
};

function renderReport() {
  return render(
    <MemoryRouter>
      <DependencyReport />
    </MemoryRouter>,
  );
}

const ldvIds = () => (ldv.props.nodes as { id: string }[]).map((n) => n.id).sort();

async function pick(label: RegExp, option: RegExp) {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: label }));
  const listbox = await screen.findByRole("listbox");
  fireEvent.click(within(listbox).getByRole("option", { name: option }));
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel(TYPES);
  ldv.props = null;
  saved.config = null;
  saved.saveDialogOpen = false;
  saved.setSaveDialogOpen = vi.fn();
  saved.resetAll = vi.fn();
  saved.persistConfig = vi.fn();
  saved.captureAndSave = vi.fn();
  saved.tlReset = vi.fn();
  mockApi.on("get", "/reports/dependencies*", GRAPH);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DependencyReport layered view callbacks", () => {
  beforeEach(() => {
    saved.config = { view: "chart", chartMode: "c4", center: "alpha" };
  });

  it("expands a neighbour, toggles it back and resets the expansion", async () => {
    renderReport();
    await screen.findByTestId("ldv");
    await waitFor(() => expect(ldvIds()).toEqual(["alpha", "beta", "db", "fin"]));

    act(() => ldv.props.onNodeExpand("beta"));
    await waitFor(() => expect(ldvIds()).toContain("os"));
    act(() => ldv.props.onNodeExpand("beta"));
    await waitFor(() => expect(ldvIds()).not.toContain("os"));

    act(() => ldv.props.onNodeExpand("db"));
    await waitFor(() => expect(ldvIds()).toContain("os"));
    act(() => ldv.props.onExpandReset());
    await waitFor(() => expect(ldvIds()).not.toContain("os"));
  });

  it("reveals a card's hierarchy parent with a containment edge, and children too", async () => {
    renderReport();
    await screen.findByTestId("ldv");
    await waitFor(() => expect(ldvIds()).toContain("fin"));
    act(() => ldv.props.onNodeReveal("fin", "parents"));
    await waitFor(() => expect(ldvIds()).toContain("hq"));
    expect(ldv.props.edges).toContainEqual(
      expect.objectContaining({ source: "hq", target: "fin", type: "hierarchy", label: "contains", reverse_label: "part of" }),
    );
    // A card with no parent has nothing to reveal.
    const before = ldv.props.nodes;
    act(() => ldv.props.onNodeReveal("alpha", "parents"));
    expect(ldv.props.nodes).toBe(before);

    act(() => ldv.props.onReset());
    await waitFor(() => expect(ldvIds()).not.toContain("hq"));

    act(() => ldv.props.onNodeReveal("hq", "children"));
    await waitFor(() => expect(ldvIds()).toContain("ops"));
    // The parent itself is not on the canvas, so no containment line is drawn.
    expect(ldv.props.edges.some((e: { type: string }) => e.type === "hierarchy")).toBe(false);
  });

  it("navigates by shift-click with back, forward and home", async () => {
    renderReport();
    await screen.findByTestId("ldv");
    expect(ldv.props.hasPrev).toBe(false);

    act(() => ldv.props.onNodeShiftClick("db"));
    await waitFor(() => expect(ldv.props.centerId).toBe("db"));
    act(() => ldv.props.onNodeShiftClick("os"));
    await waitFor(() => expect(ldv.props.centerId).toBe("os"));
    expect(ldv.props.hasPrev).toBe(true);
    expect(ldv.props.hasNext).toBe(false);

    act(() => ldv.props.onPrev());
    await waitFor(() => expect(ldv.props.centerId).toBe("db"));
    expect(ldv.props.hasNext).toBe(true);
    act(() => ldv.props.onNext());
    await waitFor(() => expect(ldv.props.centerId).toBe("os"));
    // At the end of history, forward does nothing.
    act(() => ldv.props.onNext());
    expect(ldv.props.centerId).toBe("os");

    // Reset keeps the current centre as the only history entry.
    act(() => ldv.props.onReset());
    await waitFor(() => expect(ldv.props.hasPrev).toBe(false));
    act(() => ldv.props.onPrev());
    expect(ldv.props.centerId).toBe("os");

    act(() => ldv.props.onHome());
    expect(await screen.findByText("Select a card to explore")).toBeInTheDocument();
  });

  it("opens a clicked card in the side panel", async () => {
    renderReport();
    await screen.findByTestId("ldv");
    act(() => ldv.props.onNodeClick("db"));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("db");
    fireEvent.click(screen.getByRole("button", { name: "close-panel" }));
    expect(screen.queryByTestId("side-panel")).not.toBeInTheDocument();
  });

  it("switches to the tree view from the toggle", async () => {
    const user = userEvent.setup();
    renderReport();
    await screen.findByTestId("ldv");
    await user.click(screen.getByRole("button", { name: /tree view/i }));
    expect(await screen.findByRole("button", { name: /collapse all branches/i })).toBeInTheDocument();
  });
});

describe("DependencyReport tree view", () => {
  beforeEach(() => {
    saved.config = { view: "chart", chartMode: "tree", center: "alpha" };
  });

  it("groups the centre's neighbours under their type headers", async () => {
    renderReport();
    await screen.findByRole("button", { name: /collapse all branches/i });
    // One header per neighbouring type, each holding one card.
    expect(screen.getAllByText("(1)")).toHaveLength(3);
    expect(screen.getAllByText("Beta").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Oracle DB").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Finance").length).toBeGreaterThan(0);
  });

  it("expands a branch on click, collapses all, and re-centres on right-click", async () => {
    renderReport();
    const collapse = await screen.findByRole("button", { name: /collapse all branches/i });
    expect(screen.queryByText("Linux")).not.toBeInTheDocument();

    const beta = screen.getAllByText("Beta")[0].closest(".MuiPaper-root") as HTMLElement;
    fireEvent.mouseEnter(beta);
    fireEvent.click(beta);
    expect((await screen.findAllByText("Linux")).length).toBeGreaterThan(0);
    fireEvent.mouseLeave(beta);

    fireEvent.click(collapse);
    await waitFor(() => expect(screen.queryByText("Linux")).not.toBeInTheDocument());

    fireEvent.contextMenu(screen.getAllByText("Oracle DB")[0].closest(".MuiPaper-root") as HTMLElement);
    await waitFor(() =>
      expect(saved.persistConfig).toHaveBeenLastCalledWith(expect.objectContaining({ center: "db" })),
    );
  });

  it("opens a card in a new tab without expanding it", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderReport();
    await screen.findByRole("button", { name: /collapse all branches/i });
    const beta = screen.getAllByText("Beta")[0].closest(".MuiPaper-root") as HTMLElement;
    fireEvent.click(within(beta).getByRole("button", { name: /open card/i }));
    expect(open).toHaveBeenCalledWith("/cards/beta", "_blank");
    expect(screen.queryByText("Linux")).not.toBeInTheDocument();
  });

  it("describes a hovered connection", async () => {
    const { container } = renderReport();
    await screen.findByRole("button", { name: /collapse all branches/i });
    const hits = Array.from(container.querySelectorAll('path[stroke="transparent"]'));
    expect(hits.length).toBeGreaterThan(0);
    const toDb = hits.find((_, i) => {
      fireEvent.mouseEnter(hits[i], { clientX: 10, clientY: 10 });
      const hit = screen.queryByText("Primary database");
      if (!hit) fireEvent.mouseLeave(hits[i]);
      return !!hit;
    })!;
    expect(screen.getByText("Primary database")).toBeInTheDocument();
    fireEvent.mouseMove(toDb, { clientX: 30, clientY: 40 });
    fireEvent.mouseLeave(toDb);
    await waitFor(() => expect(screen.queryByText("Primary database")).not.toBeInTheDocument());
  });

  it("goes back to the picker from the tree's home button", async () => {
    renderReport();
    await screen.findByRole("button", { name: /collapse all branches/i });
    fireEvent.click(screen.getByRole("button", { name: /back to card picker/i }));
    expect(await screen.findByText("Select a card to explore")).toBeInTheDocument();
  });
});

describe("DependencyReport picker", () => {
  beforeEach(() => {
    saved.config = { view: "chart" };
  });

  it("searches names and hierarchy paths, and clears the search", async () => {
    const user = userEvent.setup();
    renderReport();
    await screen.findByText("Select a card to explore");
    const search = screen.getByPlaceholderText("Search cards...");
    await user.type(search, "suite");
    await waitFor(() => expect(screen.queryByText("Beta")).not.toBeInTheDocument());
    expect(screen.getByText("Alpha")).toBeInTheDocument();

    await user.click(within(search.closest(".MuiInputBase-root") as HTMLElement).getByRole("button"));
    expect(await screen.findByText("Beta")).toBeInTheDocument();
  });

  it("narrows by a type chip, toggles it off, and centres on a click", async () => {
    renderReport();
    await screen.findByText("Select a card to explore");
    fireEvent.click(screen.getByText("IT Component (2)"));
    await waitFor(() => expect(screen.queryByText("Alpha")).not.toBeInTheDocument());
    fireEvent.click(screen.getByText("IT Component (2)"));
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Organization (3)"));
    fireEvent.click(screen.getByText("All"));
    expect(await screen.findByText("Alpha")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Linux"));
    expect(await screen.findByTestId("ldv")).toBeInTheDocument();
    await waitFor(() => expect(ldv.props.centerId).toBe("os"));
  });

  it("restricts the picker to the chosen card type", async () => {
    renderReport();
    await screen.findByText("Select a card to explore");
    await pick(/^type$/i, /IT Component/);
    await waitFor(() => expect(screen.queryByText("Alpha")).not.toBeInTheDocument());
    expect(screen.getByText("Linux")).toBeInTheDocument();
  });

  it("centres from the toolbar autocomplete", async () => {
    const user = userEvent.setup();
    renderReport();
    await screen.findByText("Select a card to explore");
    await user.click(screen.getByRole("combobox", { name: /center on/i }));
    await user.click(await screen.findByRole("option", { name: /Beta/ }));
    expect(await screen.findByTestId("ldv")).toBeInTheDocument();
    await waitFor(() => expect(ldv.props.centerId).toBe("beta"));
  });
});

describe("DependencyReport table and shell", () => {
  it("opens the source and target cards of a relation row", async () => {
    saved.config = { view: "table" };
    renderReport();
    const cells = await screen.findAllByText("Oracle DB");
    fireEvent.click(cells[0].closest("td") as HTMLElement);
    expect(screen.getByTestId("side-panel")).toHaveTextContent("db");
    fireEvent.click(screen.getByRole("button", { name: "close-panel" }));
    const alphas = screen.getAllByText("Alpha");
    fireEvent.click(alphas[0].closest("td") as HTMLElement);
    expect(screen.getByTestId("side-panel")).toHaveTextContent("alpha");
  });

  it("resets every control and the timeline", async () => {
    saved.config = { view: "table", cardTypeKey: "Application", center: "alpha", chartMode: "tree" };
    renderReport();
    await screen.findAllByText("Alpha");
    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    expect(saved.resetAll).toHaveBeenCalled();
    expect(saved.tlReset).toHaveBeenCalled();
    await waitFor(() =>
      expect(saved.persistConfig).toHaveBeenLastCalledWith(
        expect.objectContaining({ cardTypeKey: "", center: "", view: "chart", chartMode: "c4" }),
      ),
    );
  });

  it("saves through the thumbnail capture and closes the dialog", async () => {
    saved.saveDialogOpen = true;
    saved.config = { view: "table" };
    renderReport();
    await screen.findAllByText("Alpha");
    fireEvent.click(screen.getByRole("button", { name: /save report/i }));
    expect(saved.captureAndSave).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "close-save" }));
    expect(saved.setSaveDialogOpen).toHaveBeenCalledWith(false);
  });
});
