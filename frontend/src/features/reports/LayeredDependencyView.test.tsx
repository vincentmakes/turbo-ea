/**
 * The Layered Dependency View's own contract: what it does with a click in
 * each interaction mode, what it posts when a diagram is created from it,
 * what it shows when there is nothing to draw, and which settings its View
 * options switches write.
 *
 * React Flow is NOT mounted. It cannot lay out under jsdom (no
 * `SVGPathElement.getTotalLength`, no `CSS.escape`, no `ResizeObserver`,
 * every rect 0x0), and a broad stand-in would make the view "render" while
 * every assertion checked the stand-in. The fake below is deliberately thin:
 * `<ReactFlow>` renders each node's registered component and remembers the
 * node list it was handed — which, on a controlled flow, is exactly what the
 * real `getNodes()` reads back and what "Create diagram" exports — and the
 * store-bound pieces (`Controls`, `Background`, `Handle`, `useReactFlow`) are
 * no-ops. Everything plain stays real: `ControlButton` is a `<button>`,
 * `useNodesState` is `useState`, the layout (`buildLdvFlow`, dagre) runs for
 * real. Nothing asserted below comes from the fake — only callbacks the view
 * calls, requests it makes, text it renders and settings it writes.
 *
 * Left to the browser suite on purpose: edge geometry, image export,
 * fit / zoom / fullscreen, drag preservation and hover dimming.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor, act } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import type { ComponentProps, ComponentType, ReactNode } from "react";
import type { Node } from "@xyflow/react";
import * as rf from "@xyflow/react";

import LayeredDependencyView from "./LayeredDependencyView";
import { LDV_NODE_W, type GNode, type GEdge } from "./layeredDependencyLayout";
import { LANE_INSETS } from "./ldvLaneSizing";
import {
  LDV_DEFAULT_SETTINGS,
  getLdvSettings,
  setLdvSettings,
  toCardLabels,
} from "./ldvDisplaySettings";
import { mockApi } from "@/test/apiMock";
import { withMetamodel } from "@/test/hooks";
import { CARD_TYPES, RELATION_TYPES } from "@/test/fixtures/metamodel";
import { createTheme } from "@mui/material/styles";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("html-to-image", () => ({ toBlob: vi.fn(), toSvg: vi.fn() }));
vi.mock("file-saver", () => ({ saveAs: vi.fn() }));

/** The props each `<Background>` render received, newest last. */
const backgroundProps = vi.hoisted(() => [] as Array<{ variant?: string; color?: string }>);

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  // The nodes the view last handed `<ReactFlow>`. A controlled flow's
  // `getNodes()` returns precisely this list, so the Create-diagram path
  // exports what the view built, not something the fake invented.
  const live: { nodes: Node[]; props?: ComponentProps<typeof actual.ReactFlow> } = {
    nodes: [],
  };
  const instance = {
    fitView: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    setViewport: vi.fn(),
    getNodes: () => live.nodes,
  };
  type NodeComponent = ComponentType<{ id: string; data: unknown }>;
  const ReactFlow = (props: ComponentProps<typeof actual.ReactFlow>) => {
    live.nodes = (props.nodes ?? []) as Node[];
    live.props = props;
    return (
      <div data-testid="rf">
        {live.nodes.map((n) => {
          const Comp = props.nodeTypes?.[n.type ?? ""] as NodeComponent | undefined;
          return (
            <div
              key={n.id}
              className={`react-flow__node react-flow__node-${n.type}`}
              data-id={n.id}
            >
              {Comp ? <Comp id={n.id} data={n.data} /> : null}
            </div>
          );
        })}
        {props.children}
      </div>
    );
  };
  return {
    ...actual,
    ReactFlowProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
    ReactFlow,
    Controls: ({ children }: { children?: ReactNode }) => (
      <div data-testid="rf-controls">{children}</div>
    ),
    Background: (props: { variant?: string; color?: string }) => {
      backgroundProps.push(props);
      return null;
    },
    Handle: () => null,
    useReactFlow: () => instance,
    __live: live,
  };
});

/* ---- Fixtures: one card per layer, two relations off the centre ---- */

const APP: GNode = {
  id: "app-1",
  name: "NexaCore ERP",
  type: "Application",
  subtype: "microservice",
  lifecycle: { active: "2020-01-01" },
  parent_id: null,
};
const ITC: GNode = { id: "itc-1", name: "PostgreSQL", type: "ITComponent" };
const BC: GNode = { id: "bc-1", name: "Billing", type: "BusinessCapability", hasChildren: true };
const NODES: GNode[] = [APP, ITC, BC];
const EDGES: GEdge[] = [
  {
    source: "app-1",
    target: "itc-1",
    type: "relAppToITC",
    label: "uses",
    reverse_label: "is used by",
  },
  {
    source: "app-1",
    target: "bc-1",
    type: "relAppToBC",
    label: "supports",
    reverse_label: "is supported by",
  },
];

// reports.json, dependency.*
const T = {
  noData: "No dependency data. Adjust the type filter or create relations between cards.",
  showAll: "Show all",
  highlight: "Highlight mode: click a card to highlight its connections",
  expand: "Expand mode: click a card to reveal all its relations",
  parents: "Reveal-parent mode: click a card to add its hierarchy parent",
  children: "Reveal-children mode: click a card to add its direct children",
  createDiagram: "Create diagram",
  diagramName: "Diagram name",
  createSubmit: "Create",
  createError: "Could not create the diagram. Please try again.",
  aggregatedTitle: "Create diagram from a grouped view",
  aggregatedContinue: "Continue",
  viewOptions: "View options",
  showHierarchyMarkers: "Show hierarchy markers",
  showRelationLabels: "Show relationship labels",
  showEndOfLife: "Show end-of-life cards",
};

// The button carries a MaterialSymbol glyph, whose ligature text ("filter_alt_off")
// joins its accessible name — so match the label at the end, not the whole name.
const SHOW_ALL = new RegExp(`${T.showAll}$`);

function LocationProbe() {
  const { pathname } = useLocation();
  return <output data-testid="location">{pathname}</output>;
}

type ViewProps = ComponentProps<typeof LayeredDependencyView>;

function renderView(overrides: Partial<ViewProps> = {}) {
  const handlers = {
    onNodeClick: vi.fn(),
    onNodeShiftClick: vi.fn(),
    onNodeExpand: vi.fn(),
    onExpandReset: vi.fn(),
    onNodeReveal: vi.fn(),
    onReset: vi.fn(),
    onHome: vi.fn(),
  };
  const utils = render(
    <MemoryRouter initialEntries={["/reports/dependencies"]}>
      <LocationProbe />
      <LayeredDependencyView
        nodes={NODES}
        edges={EDGES}
        types={CARD_TYPES}
        centerId="app-1"
        centerName="NexaCore ERP"
        {...handlers}
        {...overrides}
      />
    </MemoryRouter>,
  );
  return { ...handlers, ...utils };
}

/** The card for a node id: the node's own button, found through its wrapper. */
function card(id: string): HTMLElement {
  const wrap = document.querySelector(`[data-id="${id}"]`);
  if (!wrap) throw new Error(`no node ${id} on the canvas`);
  return within(wrap as HTMLElement).getByRole("button");
}

// jsdom has no PointerEvent; React dispatches on the type and the node reads
// MouseEvent fields only (see LdvNode.test.tsx).
function press(el: Element, type: "pointerdown" | "pointerup", shift: boolean) {
  fireEvent(
    el,
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 10,
      shiftKey: shift,
      button: 0,
    }),
  );
}
function clickCard(id: string, shift = false) {
  const el = card(id);
  press(el, "pointerdown", shift);
  press(el, "pointerup", shift);
}

const highlighted = () => document.querySelector(".ldv-hover-active");
const nothingCalled = (h: ReturnType<typeof renderView>) => {
  for (const fn of [h.onNodeClick, h.onNodeShiftClick, h.onNodeExpand, h.onNodeReveal]) {
    expect(fn).not.toHaveBeenCalled();
  }
};

beforeEach(() => {
  mockApi.reset();
  withMetamodel(CARD_TYPES, RELATION_TYPES);
  localStorage.clear();
  setLdvSettings({ ...LDV_DEFAULT_SETTINGS, hiddenTypeKeys: [], extraFields: [] });
});

/* ------------------------------------------------------------------ */
/*  a) Click dispatch by interaction mode                              */
/* ------------------------------------------------------------------ */

describe("LayeredDependencyView click dispatch", () => {
  it("draws one card per node and hands a plain click to onNodeClick", () => {
    const h = renderView();
    for (const n of NODES) expect(card(n.id)).toHaveAccessibleName(new RegExp(`^${n.name}`));
    expect(screen.getByText("3 nodes · 2 relations")).toBeInTheDocument();

    clickCard("itc-1");
    expect(h.onNodeClick).toHaveBeenCalledWith("itc-1");
    expect(h.onNodeShiftClick).not.toHaveBeenCalled();
    expect(h.onNodeExpand).not.toHaveBeenCalled();
    expect(h.onNodeReveal).not.toHaveBeenCalled();
  });

  it("hands a shift-click to onNodeShiftClick", () => {
    const h = renderView();
    clickCard("bc-1", true);
    expect(h.onNodeShiftClick).toHaveBeenCalledWith("bc-1");
    expect(h.onNodeClick).not.toHaveBeenCalled();
  });

  it("falls back to a plain click when the consumer offers no shift handler", () => {
    const h = renderView({ onNodeShiftClick: undefined });
    clickCard("bc-1", true);
    expect(h.onNodeClick).toHaveBeenCalledWith("bc-1");
  });

  it("routes clicks to onNodeExpand in expand mode, and leaving it resets", () => {
    const h = renderView();
    const tool = screen.getByTitle(T.expand);
    fireEvent.click(tool);
    clickCard("itc-1");
    expect(h.onNodeExpand).toHaveBeenCalledWith("itc-1");
    expect(h.onNodeClick).not.toHaveBeenCalled();

    fireEvent.click(tool);
    expect(h.onExpandReset).toHaveBeenCalledTimes(1);
    clickCard("itc-1");
    expect(h.onNodeClick).toHaveBeenCalledWith("itc-1");
    expect(h.onNodeExpand).toHaveBeenCalledTimes(1);
  });

  it("routes clicks to onNodeReveal with the kind of the active reveal mode", () => {
    const h = renderView();
    fireEvent.click(screen.getByTitle(T.parents));
    clickCard("bc-1");
    expect(h.onNodeReveal).toHaveBeenLastCalledWith("bc-1", "parents");

    // The two reveal tools swap directly; no detour through normal mode.
    fireEvent.click(screen.getByTitle(T.children));
    clickCard("bc-1");
    expect(h.onNodeReveal).toHaveBeenLastCalledWith("bc-1", "children");
    expect(h.onNodeReveal).toHaveBeenCalledTimes(2);
    expect(h.onNodeClick).not.toHaveBeenCalled();

    // Toggling the tool off returns to plain clicks.
    fireEvent.click(screen.getByTitle(T.children));
    clickCard("bc-1");
    expect(h.onNodeClick).toHaveBeenCalledWith("bc-1");
  });

  it("offers no reveal tools to a consumer that wires none", () => {
    renderView({ onNodeReveal: undefined });
    expect(screen.queryByTitle(T.parents)).toBeNull();
    expect(screen.queryByTitle(T.children)).toBeNull();
    // The other exploration tools stay.
    expect(screen.getByTitle(T.expand)).toBeInTheDocument();
    expect(screen.getByTitle(T.highlight)).toBeInTheDocument();
  });

  it("toggles a sticky highlight in highlight mode instead of calling anything", () => {
    const h = renderView();
    fireEvent.click(screen.getByTitle(T.highlight));
    expect(highlighted()).toBeNull();

    clickCard("app-1");
    expect(highlighted()).not.toBeNull();
    nothingCalled(h);

    // Clicking the same card again clears it; another card moves it.
    clickCard("app-1");
    expect(highlighted()).toBeNull();
    clickCard("itc-1");
    expect(highlighted()).not.toBeNull();
    nothingCalled(h);

    // Leaving the mode drops the highlight with it.
    fireEvent.click(screen.getByTitle(T.highlight));
    expect(highlighted()).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  b) Create diagram                                                  */
/* ------------------------------------------------------------------ */

describe("LayeredDependencyView create diagram", () => {
  const openCreate = () => fireEvent.click(screen.getByRole("button", { name: T.createDiagram }));
  const nameField = () => screen.getByLabelText(T.diagramName) as HTMLInputElement;
  const location = () => screen.getByTestId("location").textContent;

  it("is offered only to a consumer whose cards are real inventory cards", () => {
    const { unmount } = renderView();
    expect(screen.queryByRole("button", { name: T.createDiagram })).toBeNull();
    unmount();
    renderView({ canCreateDiagram: true });
    expect(screen.getByRole("button", { name: T.createDiagram })).toBeInTheDocument();
  });

  it("opens a name prompt pre-filled from the centred card, posting nothing yet", () => {
    renderView({ canCreateDiagram: true });
    openCreate();
    expect(nameField().value).toBe("NexaCore ERP dependencies");
    expect(mockApi.callsOf("post")).toHaveLength(0);
  });

  it("names the diagram after the report when there is no centred card", () => {
    renderView({ canCreateDiagram: true, centerName: undefined });
    openCreate();
    expect(nameField().value).toBe("Dependencies dependencies");
  });

  it("posts nothing for a blank name, by Enter or by button", () => {
    renderView({ canCreateDiagram: true });
    openCreate();
    fireEvent.change(nameField(), { target: { value: "   " } });
    fireEvent.keyDown(nameField(), { key: "Enter" });
    expect(screen.getByRole("button", { name: T.createSubmit })).toBeDisabled();
    expect(mockApi.callsOf("post")).toHaveLength(0);
    expect(nameField()).toBeInTheDocument();
  });

  it("Enter posts the diagram with its XML and card labels, then opens the editor", async () => {
    mockApi.on("post", "/diagrams", { id: "diag-9" });
    renderView({ canCreateDiagram: true });
    openCreate();
    fireEvent.change(nameField(), { target: { value: "My landscape" } });
    fireEvent.keyDown(nameField(), { key: "Enter" });

    await waitFor(() => expect(location()).toBe("/diagrams/diag-9/edit"));

    const posts = mockApi.callsOf("post", "/diagrams");
    expect(posts).toHaveLength(1);
    const body = posts[0].body as { name: string; data: { xml: string; cardLabels: unknown } };
    expect(body.name).toBe("My landscape");
    expect(typeof body.data.xml).toBe("string");
    // Every card on the canvas is a live shape in the diagram, by its own id.
    for (const n of NODES) expect(body.data.xml).toContain(`cardId="${n.id}"`);
    // The diagram opens showing the rows that were on screen.
    expect(body.data.cardLabels).toEqual(toCardLabels(getLdvSettings()));
  });

  it("keeps the dialog open with the error when the request fails", async () => {
    mockApi.fail("post", "/diagrams", 500);
    renderView({ canCreateDiagram: true });
    openCreate();
    fireEvent.click(screen.getByRole("button", { name: T.createSubmit }));

    expect(await screen.findByText(T.createError)).toBeInTheDocument();
    expect(nameField()).toBeInTheDocument();
    expect(nameField().value).toBe("NexaCore ERP dependencies");
    expect(location()).toBe("/reports/dependencies");
  });

  it("asks for confirmation first when the view is aggregated", () => {
    setLdvSettings({ aggregateBy: "type" });
    renderView({ canCreateDiagram: true });
    openCreate();
    expect(screen.getByText(T.aggregatedTitle)).toBeInTheDocument();
    expect(screen.queryByLabelText(T.diagramName)).toBeNull();
    expect(mockApi.callsOf("post")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: T.aggregatedContinue }));
    expect(nameField().value).toBe("NexaCore ERP dependencies");
  });
});

/* ------------------------------------------------------------------ */
/*  c) Empty state                                                     */
/* ------------------------------------------------------------------ */

describe("LayeredDependencyView empty state", () => {
  it("says there is nothing to draw, with no filter to undo", () => {
    renderView({ nodes: [], edges: [] });
    expect(screen.getByText(T.noData)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: SHOW_ALL })).toBeNull();
    expect(screen.queryByTestId("rf")).toBeNull();
  });

  it("offers to show all types when the type filter is what emptied the view", () => {
    setLdvSettings({ hiddenTypeKeys: ["Application", "ITComponent", "BusinessCapability"] });
    // No centre: the centred card is always kept, whatever its type.
    renderView({ centerId: undefined });
    expect(screen.getByText(T.noData)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: SHOW_ALL }));
    expect(getLdvSettings().hiddenTypeKeys).toEqual([]);
    // …and the cards come back, through the store the view subscribes to.
    for (const n of NODES) expect(card(n.id)).toBeInTheDocument();
    expect(screen.queryByText(T.noData)).toBeNull();
  });

  it("does not blame the filter for types that were never on the canvas", () => {
    // A key left over from another diagram hid nothing here, so there is
    // nothing to offer.
    setLdvSettings({ hiddenTypeKeys: ["Provider"] });
    renderView({ nodes: [], edges: [] });
    expect(screen.getByText(T.noData)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: SHOW_ALL })).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  d) View options                                                    */
/* ------------------------------------------------------------------ */

describe("LayeredDependencyView view options", () => {
  const openOptions = () => fireEvent.click(screen.getByRole("button", { name: T.viewOptions }));
  const toggle = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

  it("writes each switch through the shared store and leaves the rest alone", () => {
    renderView();
    openOptions();
    expect(toggle(T.showHierarchyMarkers).checked).toBe(true);
    expect(toggle(T.showRelationLabels).checked).toBe(true);

    fireEvent.click(toggle(T.showHierarchyMarkers));
    expect(getLdvSettings().showHierarchyMarkers).toBe(false);
    expect(getLdvSettings().showRelationLabels).toBe(true);

    fireEvent.click(toggle(T.showRelationLabels));
    expect(getLdvSettings().showRelationLabels).toBe(false);
    expect(getLdvSettings().showHierarchyMarkers).toBe(false);
    expect(getLdvSettings().showCardLogos).toBe(LDV_DEFAULT_SETTINGS.showCardLogos);

    // The switches read back what was written.
    expect(toggle(T.showHierarchyMarkers).checked).toBe(false);
    expect(toggle(T.showRelationLabels).checked).toBe(false);
    // Switching back on round-trips too.
    fireEvent.click(toggle(T.showRelationLabels));
    expect(getLdvSettings().showRelationLabels).toBe(true);
  });

  it("follows a change made elsewhere — the card-detail section shares the store", () => {
    renderView();
    openOptions();
    expect(toggle(T.showEndOfLife).checked).toBe(false);
    act(() => {
      setLdvSettings({ showEndOfLife: true });
    });
    expect(toggle(T.showEndOfLife).checked).toBe(true);
  });
});

describe("LayeredDependencyView canvas colours", () => {
  const DIVIDER = createTheme().palette.divider;

  it("leaves the dots in React Flow's own colour and draws grid lines in the divider colour", () => {
    renderView();
    expect(backgroundProps[backgroundProps.length - 1]).toMatchObject({ variant: "dots", color: undefined });
    fireEvent.click(screen.getByRole("button", { name: "Background: dots" }));
    expect(backgroundProps[backgroundProps.length - 1]).toMatchObject({ variant: "lines", color: DIVIDER });
  });

  it("rules the band between the control groups in the divider colour", () => {
    renderView();
    const band = within(screen.getByTestId("rf-controls")).getAllByText("", { selector: "div[aria-hidden]" })[0];
    expect(band).toHaveStyle({ borderTop: `1px solid ${DIVIDER}`, borderBottom: `1px solid ${DIVIDER}` });
  });
});

/* ------------------------------------------------------------------ */
/*  e) Lanes grow as a card is dragged against their edge (#1295)       */
/* ------------------------------------------------------------------ */

describe("LayeredDependencyView lane growth", () => {
  type Live = { nodes: Node[]; props?: ComponentProps<typeof rf.ReactFlow> };
  const live = () => (rf as unknown as { __live: Live }).__live;
  const nodeById = (id: string) => live().nodes.find((n) => n.id === id)!;
  const sizeOf = (n: Node) => ({
    w: (n.width ?? (n.style?.width as number)) as number,
    h: (n.height ?? (n.style?.height as number)) as number,
  });

  /** A whole drag, as React Flow runs it: `onNodeDragStart`, then for each
   *  stop on the way a position change and `onNodeDrag`, then the release's
   *  position change and `onNodeDragStop`. Each stop is given relative to the
   *  card's box as it stood when the drag began; React Flow reports a moving
   *  card in page coordinates, because the view takes it out of its box for
   *  the drag. */
  function drag(id: string, stops: { x: number; y: number }[]) {
    const ev = new MouseEvent("mousemove");
    const props = () => live().props!;
    const box = nodeById(nodeById(id).parentId!).position;
    act(() => {
      props().onNodeDragStart!(ev, nodeById(id), [nodeById(id)]);
    });
    let last = nodeById(id).position;
    for (const p of stops) {
      last = { x: box.x + p.x, y: box.y + p.y };
      const at = last;
      act(() => {
        props().onNodesChange!([{ id, type: "position", position: at, dragging: true }]);
      });
      act(() => {
        props().onNodeDrag!(ev, nodeById(id), live().nodes);
      });
    }
    act(() => {
      props().onNodesChange!([{ id, type: "position", position: last, dragging: false }]);
    });
    act(() => {
      props().onNodeDragStop!(ev, nodeById(id), [nodeById(id)]);
    });
  }
  const dragTo = (id: string, position: { x: number; y: number }) => drag(id, [position]);

  it("takes the dragged card out of its lane while it moves and puts it back on release", () => {
    renderView();
    const laneId = nodeById("app-1").parentId!;
    const lane = nodeById(laneId);
    const card = nodeById("app-1");
    act(() => {
      live().props!.onNodeDragStart!(new MouseEvent("mousedown"), card, [card]);
    });
    const out = nodeById("app-1");
    expect(out.parentId).toBeUndefined();
    expect(out.extent).toBeUndefined();
    // Drawn above the cards and lanes it passes over.
    expect(out.zIndex).toBeGreaterThan(1);
    expect(out.position).toEqual({
      x: lane.position.x + card.position.x,
      y: lane.position.y + card.position.y,
    });
    act(() => {
      live().props!.onNodeDragStop!(new MouseEvent("mouseup"), out, [out]);
    });
    const back = nodeById("app-1");
    expect(back.parentId).toBe(laneId);
    expect(back.extent).toBe("parent");
    expect(back.position).toEqual(card.position);
    expect(back.data).not.toHaveProperty("dragBoxId");
    expect(back.zIndex).toBeUndefined();
  });

  it("follows a card out past the left edge and back within one drag", () => {
    renderView();
    const laneId = nodeById("app-1").parentId!;
    const lane0 = nodeById(laneId);
    const card0 = { ...nodeById("app-1").position };
    // Out to 100 units left of the lane, the lane following each step, then home.
    drag("app-1", [
      { x: -40, y: card0.y },
      { x: -100, y: card0.y },
      { x: -40, y: card0.y },
      card0,
    ]);
    const lane1 = nodeById(laneId);
    expect(lane1.position).toEqual(lane0.position);
    expect(sizeOf(lane1)).toEqual(sizeOf(lane0));
    expect(nodeById("app-1").position).toEqual(card0);
  });

  it("keeps the lane's left edge with the card at the far end of the drag", () => {
    renderView();
    const laneId = nodeById("app-1").parentId!;
    const lane0 = nodeById(laneId);
    const card0 = { ...nodeById("app-1").position };
    const ev = new MouseEvent("mousemove");
    act(() => {
      live().props!.onNodeDragStart!(ev, nodeById("app-1"), [nodeById("app-1")]);
    });
    for (const x of [-40, -100]) {
      const at = { x: lane0.position.x + x, y: lane0.position.y + card0.y };
      act(() => {
        live().props!.onNodesChange!([{ id: "app-1", type: "position", position: at, dragging: true }]);
      });
      act(() => {
        live().props!.onNodeDrag!(ev, nodeById("app-1"), live().nodes);
      });
      // The card never moves under the pointer: it is not shifted with the lane.
      expect(nodeById("app-1").position).toEqual(at);
      expect(nodeById(laneId).position.x).toBe(at.x - LANE_INSETS.left);
    }
  });

  it("widens the lane when a card reaches its right edge, leaving the card in place", () => {
    renderView();
    const laneId = nodeById("app-1").parentId!;
    const before = sizeOf(nodeById(laneId));
    // React Flow clamps the card to the lane: it can at most touch the edge.
    const x = before.w - LDV_NODE_W;
    dragTo("app-1", { x, y: nodeById("app-1").position.y });

    const after = sizeOf(nodeById(laneId));
    expect(after.w).toBe(x + LDV_NODE_W + LANE_INSETS.right);
    expect(after.h).toBe(before.h);
    expect(nodeById("app-1").position.x).toBe(x);
  });

  it("grows a lane leftwards by moving it, so nothing on screen moves", () => {
    renderView();
    const laneId = nodeById("app-1").parentId!;
    const lane0 = nodeById(laneId);
    const card0 = nodeById("app-1");
    const absX = lane0.position.x + 0;
    dragTo("app-1", { x: 0, y: card0.position.y });

    const lane1 = nodeById(laneId);
    const card1 = nodeById("app-1");
    expect(lane1.position.x).toBe(lane0.position.x - LANE_INSETS.left);
    expect(card1.position.x).toBe(LANE_INSETS.left);
    // Same absolute place as where React Flow left it.
    expect(lane1.position.x + card1.position.x).toBe(absX);
    expect(sizeOf(lane1).w).toBe(sizeOf(lane0).w + LANE_INSETS.left);
  });

  it("does nothing while the card stays inside the lane", () => {
    renderView();
    const laneId = nodeById("app-1").parentId!;
    const before = nodeById(laneId);
    const { x, y } = nodeById("app-1").position;
    dragTo("app-1", { x, y });
    expect(nodeById(laneId)).toBe(before);
  });

  it("shrinks the lane back to its laid-out width when the card is moved back", () => {
    renderView();
    const laneId = nodeById("app-1").parentId!;
    const before = sizeOf(nodeById(laneId));
    const start = { ...nodeById("app-1").position };
    dragTo("app-1", { x: before.w - LDV_NODE_W, y: start.y });
    expect(sizeOf(nodeById(laneId)).w).toBeGreaterThan(before.w);

    dragTo("app-1", start);
    expect(sizeOf(nodeById(laneId))).toEqual(before);
  });

  it("brings a lane grown leftwards back to where it was, the card staying put on screen", () => {
    renderView();
    const laneId = nodeById("app-1").parentId!;
    const lane0 = nodeById(laneId);
    const size0 = sizeOf(lane0);
    const card0 = { ...nodeById("app-1").position };
    dragTo("app-1", { x: 0, y: card0.y });
    const grown = nodeById(laneId);
    expect(grown.position.x).toBe(lane0.position.x - LANE_INSETS.left);

    // The card's original screen position, relative to the moved lane.
    const absX = lane0.position.x + card0.x;
    dragTo("app-1", { x: absX - grown.position.x, y: card0.y });
    const lane1 = nodeById(laneId);
    expect(lane1.position).toEqual(lane0.position);
    expect(sizeOf(lane1)).toEqual(size0);
    expect(nodeById("app-1").position).toEqual(card0);
  });

  it("hands a lane shrunk back to Create diagram at its laid-out width", async () => {
    mockApi.on("post", "/diagrams", { id: "diag-10" });
    renderView({ canCreateDiagram: true });
    const laneId = nodeById("app-1").parentId!;
    const before = sizeOf(nodeById(laneId));
    const start = { ...nodeById("app-1").position };
    dragTo("app-1", { x: before.w - LDV_NODE_W, y: start.y });
    dragTo("app-1", start);

    fireEvent.click(screen.getByRole("button", { name: T.createDiagram }));
    fireEvent.change(screen.getByLabelText(T.diagramName), { target: { value: "Shrunk" } });
    fireEvent.keyDown(screen.getByLabelText(T.diagramName), { key: "Enter" });
    await waitFor(() => expect(mockApi.callsOf("post", "/diagrams")).toHaveLength(1));

    const xml = (mockApi.callsOf("post", "/diagrams")[0].body as { data: { xml: string } }).data
      .xml;
    const laneWidths = [...xml.matchAll(/id="layer-\d+"[^>]*>\s*<mxGeometry[^>]*width="(\d+)"/g)].map(
      (m) => Number(m[1]),
    );
    expect(laneWidths).toContain(before.w);
    expect(laneWidths).not.toContain(before.w + LANE_INSETS.right);
  });

  it("hands the grown lane's size to Create diagram", async () => {
    mockApi.on("post", "/diagrams", { id: "diag-9" });
    renderView({ canCreateDiagram: true });
    const laneId = nodeById("app-1").parentId!;
    const lane = nodeById(laneId);
    const x = sizeOf(lane).w - LDV_NODE_W;
    dragTo("app-1", { x, y: nodeById("app-1").position.y });
    const grownW = x + LDV_NODE_W + LANE_INSETS.right;

    fireEvent.click(screen.getByRole("button", { name: T.createDiagram }));
    fireEvent.change(screen.getByLabelText(T.diagramName), { target: { value: "Grown" } });
    fireEvent.keyDown(screen.getByLabelText(T.diagramName), { key: "Enter" });
    await waitFor(() => expect(mockApi.callsOf("post", "/diagrams")).toHaveLength(1));

    const xml = (mockApi.callsOf("post", "/diagrams")[0].body as { data: { xml: string } }).data
      .xml;
    const laneWidths = [...xml.matchAll(/id="layer-\d+"[^>]*>\s*<mxGeometry[^>]*width="(\d+)"/g)].map(
      (m) => Number(m[1]),
    );
    expect(laneWidths).toContain(grownW);
  });
});
