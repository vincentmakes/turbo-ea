/**
 * ArchitectureDiagram — the React Flow rendering of an Architect result.
 *
 * What is asserted is what the component derives and hands React Flow: one
 * dashed group per non-empty layer, one node per component laid out in a row
 * per layer, one edge per integration whose ends resolve (exactly, by
 * containment, or by an unambiguous first word), its handles and label, the
 * summary chips, and the hover highlighting it computes. React Flow itself
 * is NOT mounted — it cannot lay out under jsdom — so the fake below renders
 * each node and edge through the component's own registered `nodeTypes` /
 * `edgeTypes` and records the props it was given; each `Handle` renders an
 * empty marker carrying its id, type, side and colour, `Controls` records its
 * props, `Background` and the provider are no-ops, and `EdgeLabelRenderer`
 * portals into the document instead of the flow's viewport.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createPortal } from "react-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import type { ComponentProps, ComponentType, ReactNode } from "react";
import { Position, type Edge, type Node } from "@xyflow/react";
import { CARD_TYPES } from "@/test/fixtures/metamodel";
import i18n from "@/i18n";
import type { ArchitectureResult } from "@/types";

const rf = vi.hoisted(() => ({
  props: null as null | {
    nodes: Node[];
    edges: Edge[];
    colorMode?: string;
    edgeTypes?: Record<string, unknown>;
    onNodeMouseEnter?: (e: unknown, n: Node) => void;
    onNodeMouseLeave?: (e: unknown, n: Node) => void;
    [key: string]: unknown;
  },
  controls: null as null | Record<string, unknown>,
}));

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  type Comp = ComponentType<Record<string, unknown>>;
  const ReactFlow = (props: ComponentProps<typeof actual.ReactFlow>) => {
    rf.props = props as unknown as NonNullable<typeof rf.props>;
    const nodes = (props.nodes ?? []) as Node[];
    const edges = (props.edges ?? []) as Edge[];
    return (
      <div data-testid="rf">
        {nodes.map((n) => {
          const NodeComp = props.nodeTypes?.[n.type ?? ""] as Comp | undefined;
          return (
            <div
              key={n.id}
              className={`react-flow__node react-flow__node-${n.type}`}
              data-id={n.id}
              onMouseEnter={(e) => props.onNodeMouseEnter?.(e, n)}
              onMouseLeave={(e) => props.onNodeMouseLeave?.(e, n)}
            >
              {NodeComp ? <NodeComp id={n.id} data={n.data} /> : null}
            </div>
          );
        })}
        <svg>
          {edges.map((e) => {
            const EdgeComp = props.edgeTypes?.[e.type ?? ""] as Comp | undefined;
            return (
              <g key={e.id} data-edge={e.id}>
                {EdgeComp ? (
                  <EdgeComp
                    id={e.id}
                    source={e.source}
                    target={e.target}
                    sourceX={0}
                    sourceY={0}
                    targetX={120}
                    targetY={200}
                    sourcePosition={actual.Position.Bottom}
                    targetPosition={actual.Position.Top}
                    data={e.data}
                    markerStart={e.markerStart ? "url(#arrow-start)" : undefined}
                    markerEnd={e.markerEnd ? "url(#arrow-end)" : undefined}
                  />
                ) : null}
              </g>
            );
          })}
        </svg>
        {props.children}
      </div>
    );
  };
  return {
    ...actual,
    ReactFlowProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
    ReactFlow,
    Background: () => null,
    Controls: (props: Record<string, unknown>) => {
      rf.controls = props;
      return null;
    },
    // A handle is drawn as an empty marker carrying the props it was given.
    Handle: (props: { id?: string; type?: string; position?: string; style?: { background?: string } }) => (
      <i
        data-handle={props.id}
        data-handle-type={props.type}
        data-position={props.position}
        data-background={props.style?.background}
      />
    ),
    EdgeLabelRenderer: ({ children }: { children?: ReactNode }) =>
      createPortal(<div data-testid="edge-label">{children}</div>, document.body),
  };
});

import ArchitectureDiagram from "./ArchitectureDiagram";

const ARCH: ArchitectureResult = {
  layers: [
    {
      name: "Experience",
      components: [
        { name: "Customer Portal", type: "new", role: "Self-service front end", cardTypeKey: "Application" },
        {
          name: "HubSpot CRM",
          type: "recommended",
          product: "HubSpot Sales Hub",
          category: "CRM",
          cardTypeKey: "Application",
        },
      ],
    },
    // An empty layer gets no group and takes no vertical space.
    { name: "Empty", components: [] },
    {
      name: "Data",
      components: [
        { name: "Postgres Cluster", type: "existing", product: "Postgres Cluster", cardTypeKey: "ITComponent" },
        { name: "An exceptionally long component name", type: "new" },
        { name: "Event Bus", type: "recommended", existsInLandscape: true },
      ],
    },
  ],
  integrations: [
    // Exact name match, cross-layer, top → bottom.
    { from: "Customer Portal", to: "Postgres Cluster", protocol: "REST", direction: "async" },
    // Same layer, left → right; "HubSpot" resolves by containment.
    { from: "customer portal", to: "HubSpot", protocol: "GraphQL", direction: "sync" },
    // Cross-layer, written bottom → top: turned to run top → bottom.
    { from: "Event Bus", to: "Customer Portal" },
    // "Postgres replica" resolves by its first word to the only "postgres…" component.
    { from: "Postgres replica", to: "Event Bus", direction: "bidirectional" },
    // Nothing resolves / a self-loop: both dropped.
    { from: "Unknown System", to: "Customer Portal" },
    { from: "Event Bus", to: "Event Bus" },
  ],
};

function renderDiagram(arch: ArchitectureResult = ARCH, opts: { dark?: boolean; types?: boolean } = {}) {
  const ui = <ArchitectureDiagram arch={arch} types={opts.types === false ? undefined : CARD_TYPES} />;
  return render(opts.dark ? <ThemeProvider theme={createTheme({ palette: { mode: "dark" } })}>{ui}</ThemeProvider> : ui);
}

function nodeEl(id: string): HTMLElement {
  const el = document.querySelector(`[data-id="${id}"]`);
  if (!el) throw new Error(`no node ${id}`);
  return el as HTMLElement;
}

function edgeOf(source: string, target: string): Edge {
  const edge = rf.props?.edges.find((e) => e.source === source && e.target === target);
  if (!edge) throw new Error(`no edge ${source} → ${target}`);
  return edge;
}

/** The closed arrowhead every integration carries at its target end. */
const ARROW = { type: "arrowclosed", color: "#888" };

beforeEach(() => {
  rf.props = null;
  rf.controls = null;
});

describe("ArchitectureDiagram", () => {
  it("shows the empty state when there are no layers", () => {
    render(<ArchitectureDiagram arch={{}} />);
    expect(screen.getByText("No diagram generated")).toBeInTheDocument();
    expect(screen.queryByTestId("rf")).not.toBeInTheDocument();
  });

  it("shows the empty state when every layer is empty", () => {
    render(<ArchitectureDiagram arch={{ layers: [{ name: "Nothing", components: [] }] }} />);
    expect(screen.getByText("No diagram generated")).toBeInTheDocument();
  });

  it("summarises the components by kind", () => {
    renderDiagram();

    // "Postgres Cluster" is existing; "Event Bus" counts as existing because it is in the landscape.
    expect(screen.getByText("2 existing reused")).toBeInTheDocument();
    expect(screen.getByText("2 new components")).toBeInTheDocument();
    expect(screen.getByText("2 Recommended")).toBeInTheDocument();
    expect(screen.getByText("5 components · 6 integrations")).toBeInTheDocument();
  });

  it("omits a kind's chip when it has no components", () => {
    renderDiagram({ layers: [{ name: "Only", components: [{ name: "Solo", type: "new" }] }] });

    expect(screen.getByText("1 new components")).toBeInTheDocument();
    expect(screen.queryByText(/existing reused/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Recommended/)).not.toBeInTheDocument();
    expect(screen.getByText("1 component · 0 integrations")).toBeInTheDocument();
  });

  it("draws one group per non-empty layer and one row of nodes per layer", () => {
    renderDiagram();
    const nodes = rf.props?.nodes ?? [];

    const groups = nodes.filter((n) => n.type === "archGroup");
    expect(groups.map((g) => [g.id, (g.data as { label: string }).label, g.position])).toEqual([
      ["layer-0", "Experience", { x: 0, y: 0 }],
      // 44 top padding + 80 node + 28 bottom padding + 48 gap; the empty layer adds nothing.
      ["layer-2", "Data", { x: 0, y: 200 }],
    ]);
    // Every group is as wide as the widest row: 3 nodes × 200 + 2 gaps × 60 + 2 × 40 padding.
    for (const g of groups) expect(g.style).toMatchObject({ width: 800, height: 152 });
    expect((groups[1].data as { color: string }).color).toBe("#8e24aa");
    expect(within(nodeEl("layer-0")).getByText("Experience")).toBeInTheDocument();

    const comps = nodes.filter((n) => n.type === "archNode");
    expect(comps.map((n) => [n.id, n.position])).toEqual([
      ["arch-0", { x: 40, y: 44 }],
      ["arch-1", { x: 300, y: 44 }],
      ["arch-2", { x: 40, y: 244 }],
      ["arch-3", { x: 300, y: 244 }],
      ["arch-4", { x: 560, y: 244 }],
    ]);
  });

  it("renders each component's badge, name, product, category, role and type icon", () => {
    renderDiagram();

    const portal = nodeEl("arch-0");
    expect(within(portal).getByText("New")).toBeInTheDocument();
    expect(within(portal).getByText("Customer Portal")).toHaveAttribute("aria-label", "Self-service front end");
    expect(within(portal).getByText("apps")).toBeInTheDocument();

    const hubspot = nodeEl("arch-1");
    expect(within(hubspot).getByText("Buy")).toBeInTheDocument();
    expect(within(hubspot).getByText("HubSpot Sales Hub")).toBeInTheDocument();
    expect(within(hubspot).getByText("[CRM]")).toBeInTheDocument();

    // A product equal to the name is not repeated.
    const postgres = nodeEl("arch-2");
    expect(within(postgres).getByText("Reuse")).toBeInTheDocument();
    expect(within(postgres).getAllByText("Postgres Cluster")).toHaveLength(1);
    expect(within(postgres).getByText("memory")).toBeInTheDocument();

    // Long names are cut at 25 characters; no card type → no icon.
    const long = nodeEl("arch-3");
    expect(within(long).getByText("An exceptionally long com…")).toBeInTheDocument();
    expect(long.querySelector(".material-symbols-outlined")).toBeNull();
  });

  it("carries the card type's colour and icon only when types are supplied", () => {
    renderDiagram(ARCH, { types: false });
    const data = rf.props?.nodes.find((n) => n.id === "arch-0")?.data as Record<string, unknown>;
    expect(data.cardTypeColor).toBeUndefined();
    expect(within(nodeEl("arch-0")).queryByText("apps")).not.toBeInTheDocument();
  });

  it("falls back to the raw kind for a component type it does not know", () => {
    renderDiagram({
      layers: [
        {
          name: "L",
          components: [{ name: "Odd", type: "legacy" as unknown as "new" }, { name: "Untyped" } as never],
        },
      ],
    });
    expect(within(nodeEl("arch-0")).getByText("legacy")).toBeInTheDocument();
    // A component with no type is drawn as new.
    expect(within(nodeEl("arch-1")).getByText("New")).toBeInTheDocument();
  });

  it("resolves integrations to edges, dropping the unresolvable and self-loops", () => {
    renderDiagram();
    const edges = rf.props?.edges ?? [];
    expect(edges).toHaveLength(4);

    const portalToDb = edgeOf("arch-0", "arch-2");
    expect(portalToDb).toMatchObject({ sourceHandle: "b", targetHandle: "t", type: "archEdge" });
    expect(portalToDb.data).toMatchObject({ label: "REST, async", protocol: "REST", direction: "async" });
    // Written top → bottom: the arrowhead is at the drawn target.
    expect(portalToDb.markerEnd).toEqual(ARROW);
    expect(portalToDb.markerStart).toBeUndefined();

    // Same layer, left to right: side handles; a sync direction is not spelled out.
    const portalToCrm = edgeOf("arch-0", "arch-1");
    expect(portalToCrm).toMatchObject({ sourceHandle: "r", targetHandle: "l" });
    expect(portalToCrm.data).toMatchObject({ label: "GraphQL" });

    // Written bottom → top, drawn top → bottom; no protocol or direction → no label.
    const busToPortal = edgeOf("arch-0", "arch-4");
    expect(busToPortal).toMatchObject({ sourceHandle: "b", targetHandle: "t" });
    expect(busToPortal.data).toMatchObject({ label: "" });
    // The arrowhead stays on the integration's real target, the portal: the
    // drawn start of the line, so Event Bus → Customer Portal still reads that way.
    expect(busToPortal.markerStart).toEqual(ARROW);
    expect(busToPortal.markerEnd).toBeUndefined();

    const replicaToBus = edgeOf("arch-2", "arch-4");
    expect(replicaToBus).toMatchObject({ sourceHandle: "r", targetHandle: "l" });
    expect(replicaToBus.data).toMatchObject({ label: "bidirectional" });
    // A bidirectional integration points both ways.
    expect(replicaToBus.markerStart).toEqual(ARROW);
    expect(replicaToBus.markerEnd).toEqual(ARROW);

    expect(screen.getAllByTestId("edge-label").map((l) => l.textContent)).toEqual([
      "REST, async",
      "GraphQL",
      "bidirectional",
    ]);
  });

  it("connects a same-layer integration written right to left, the arrowhead on its real target", () => {
    renderDiagram({
      layers: [{ name: "L", components: [{ name: "Left App", type: "new" }, { name: "Right App", type: "new" }] }],
      integrations: [{ from: "Right App", to: "Left App", protocol: "SOAP" }],
    });
    const [edge] = rf.props?.edges ?? [];
    // Drawn left to right, between the facing sides …
    expect(edge).toMatchObject({ source: "arch-0", target: "arch-1", sourceHandle: "r", targetHandle: "l" });
    // … through handles React Flow can connect: a source handle on the source
    // node, a target handle on the target node.
    expect(handlesOf("arch-0").find((h) => h.id === edge.sourceHandle)?.type).toBe("source");
    expect(handlesOf("arch-1").find((h) => h.id === edge.targetHandle)?.type).toBe("target");
    // Right App → Left App: the arrow points at Left App, the drawn start.
    expect(edge.markerStart).toEqual(ARROW);
    expect(edge.markerEnd).toBeUndefined();
    expect(edge.data).toMatchObject({ label: "SOAP" });
  });

  it("does not guess when a first word matches several components", () => {
    renderDiagram({
      layers: [
        {
          name: "L",
          components: [
            { name: "Oracle Database", type: "existing" },
            { name: "Oracle Middleware", type: "existing" },
            { name: "Billing", type: "new" },
          ],
        },
      ],
      integrations: [
        { from: "Oracle Fusion", to: "Billing" },
        // Too short a first word to match on.
        { from: "ERP Hub", to: "Billing" },
      ],
    });
    expect(rf.props?.edges).toEqual([]);
  });

  it("highlights a hovered component's neighbourhood and clears it on leave", () => {
    renderDiagram();
    const canvas = screen.getByTestId("rf").parentElement as HTMLElement;
    expect(canvas).not.toHaveClass("arch-hover-active");
    expect(canvas.querySelector("style")).toBeNull();

    // Hovering a layer group does nothing.
    fireEvent.mouseEnter(nodeEl("layer-0"));
    expect(canvas).not.toHaveClass("arch-hover-active");

    fireEvent.mouseEnter(nodeEl("arch-2"));
    expect(canvas).toHaveClass("arch-hover-active");
    const css = canvas.querySelector("style")?.textContent ?? "";
    for (const id of ["arch-2", "arch-0", "arch-4"]) {
      expect(css).toContain(`.react-flow__node[data-id="${id}"]`);
    }
    expect(css).not.toContain(`[data-id="arch-1"]`);
    const connected = (rf.props?.edges ?? []).filter(
      (e) => (e.data as { connectedToHovered?: boolean }).connectedToHovered,
    );
    expect(connected.map((e) => `${e.source}>${e.target}`).sort()).toEqual(["arch-0>arch-2", "arch-2>arch-4"]);
    // The connected edges are drawn solid and thicker.
    const solid = document.querySelector('[data-edge="arch-e-0"] .react-flow__edge-path');
    expect(solid).toHaveAttribute("style", expect.stringContaining("stroke-width: 2"));
    const dashed = document.querySelector('[data-edge="arch-e-1"] .react-flow__edge-path');
    expect(dashed).toHaveAttribute("style", expect.stringContaining("stroke-dasharray: 5 3"));

    fireEvent.mouseLeave(nodeEl("arch-2"));
    expect(canvas).not.toHaveClass("arch-hover-active");
    expect(canvas.querySelector("style")).toBeNull();
    expect(
      (rf.props?.edges ?? []).some((e) => (e.data as { connectedToHovered?: boolean }).connectedToHovered),
    ).toBe(false);
  });

  it("follows the theme's colour mode", () => {
    renderDiagram(ARCH, { dark: true });
    expect(rf.props?.colorMode).toBe("dark");
    expect(within(nodeEl("arch-0")).getByText("Customer Portal")).toBeInTheDocument();
    fireEvent.mouseEnter(nodeEl("arch-0"));
    expect(screen.getAllByTestId("edge-label")).toHaveLength(3);
  });

  it("uses the light colour mode by default", () => {
    renderDiagram(ARCH, { types: false });
    expect(rf.props?.colorMode).toBe("light");
    // Without a card-type colour the node falls back to its kind's tint.
    expect(within(nodeEl("arch-4")).getByText("Buy")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// What React Flow is handed
// ---------------------------------------------------------------------------

type HandleInfo = { id: string | null; type: string | null; position: string | null; background: string | null };

function handlesOf(id: string): HandleInfo[] {
  return Array.from(nodeEl(id).querySelectorAll("[data-handle]")).map((h) => ({
    id: h.getAttribute("data-handle"),
    type: h.getAttribute("data-handle-type"),
    position: h.getAttribute("data-position"),
    background: h.getAttribute("data-background"),
  }));
}

/** Source and target of every edge, in edge order. */
function edgeEnds(): string[] {
  return (rf.props?.edges ?? []).map((e) => `${e.source}>${e.target}`);
}

describe("ArchitectureDiagram — what React Flow is handed", () => {
  it("configures a read-only canvas that fits the diagram", () => {
    renderDiagram();
    expect(rf.props).toMatchObject({
      fitView: true,
      fitViewOptions: { padding: 0.2 },
      minZoom: 0.2,
      maxZoom: 2,
      proOptions: { hideAttribution: true },
      nodesDraggable: false,
      nodesConnectable: false,
      edgesReconnectable: false,
      elementsSelectable: false,
    });
    expect(rf.controls).toMatchObject({ showInteractive: false });
  });

  it("puts the layer groups behind the components and makes neither movable", () => {
    renderDiagram();
    const nodes = rf.props?.nodes ?? [];
    for (const g of nodes.filter((n) => n.type === "archGroup")) {
      expect(g).toMatchObject({ selectable: false, draggable: false, zIndex: -1, style: { zIndex: -1 } });
    }
    for (const n of nodes.filter((n) => n.type === "archNode")) {
      expect(n).toMatchObject({ draggable: false, zIndex: 1, style: { width: 200, height: 80 } });
    }
  });

  it("draws every edge with a closed arrow at its integration's target, at both ends when bidirectional, above the nodes, without animation", () => {
    renderDiagram();
    const edges = rf.props?.edges ?? [];
    expect(edges).toHaveLength(4);
    for (const e of edges) {
      expect(e).toMatchObject({ animated: false, zIndex: 2 });
      const arrows = (e.data as { direction?: string }).direction === "bidirectional" ? [ARROW, ARROW] : [ARROW];
      expect([e.markerStart, e.markerEnd].filter(Boolean)).toEqual(arrows);
    }
    // Besides the bidirectional one, only the integration written bottom → top
    // has its arrowhead at the drawn start.
    expect(edges.filter((e) => e.markerStart).map((e) => `${e.source}>${e.target}`)).toEqual([
      "arch-0>arch-4",
      "arch-2>arch-4",
    ]);
  });

  it("points a bidirectional integration both ways, whichever way round it was written", () => {
    renderDiagram({
      layers: [
        { name: "Top", components: [{ name: "Portal", type: "new" }] },
        { name: "Bottom", components: [{ name: "Ledger", type: "new" }, { name: "Archive", type: "new" }] },
      ],
      integrations: [
        // Written bottom → top: drawn swapped.
        { from: "Ledger", to: "Portal", direction: "bidirectional" },
        // Same layer, written right to left: drawn swapped.
        { from: "Archive", to: "Ledger", direction: "bidirectional" },
        // One-way, written bottom → top: one arrow, on the real target.
        { from: "Archive", to: "Portal", direction: "async" },
      ],
    });
    const [ledgerPortal, archiveLedger, archivePortal] = rf.props?.edges ?? [];
    expect(ledgerPortal).toMatchObject({ source: "arch-0", target: "arch-1", markerStart: ARROW, markerEnd: ARROW });
    expect(archiveLedger).toMatchObject({ source: "arch-1", target: "arch-2", markerStart: ARROW, markerEnd: ARROW });
    expect(archivePortal).toMatchObject({ source: "arch-0", target: "arch-2", markerStart: ARROW });
    expect(archivePortal.markerEnd).toBeUndefined();
  });

  it("cycles the layer colours after the seventh layer", () => {
    const layers = Array.from({ length: 8 }, (_, i) => ({
      name: `Layer ${i}`,
      components: [{ name: `Component ${i}`, type: "new" as const }],
    }));
    renderDiagram({ layers });
    const colours = (rf.props?.nodes ?? [])
      .filter((n) => n.type === "archGroup")
      .map((g) => (g.data as { color: string }).color);
    expect(colours).toEqual([
      "#1976d2",
      "#33cc58",
      "#8e24aa",
      "#d29270",
      "#0f7eb5",
      "#ffa31f",
      "#f44336",
      "#1976d2",
    ]);
  });

  it("gives every component target handles on top and left and source handles on the bottom and right", () => {
    renderDiagram();
    // The visible top/bottom pair takes the card type's colour; the side pair is invisible.
    expect(handlesOf("arch-0")).toEqual([
      { id: "t", type: "target", position: Position.Top, background: "#0f7eb5" },
      { id: "b", type: "source", position: Position.Bottom, background: "#0f7eb5" },
      { id: "l", type: "target", position: Position.Left, background: "transparent" },
      { id: "r", type: "source", position: Position.Right, background: "transparent" },
    ]);
    expect(handlesOf("arch-2")[0].background).toBe("#d29270");
  });

  it("colours the handles by kind without a card type, grey for a kind it does not know", () => {
    renderDiagram(
      {
        layers: [
          {
            name: "L",
            components: [
              { name: "Built", type: "new" },
              { name: "Bought", type: "recommended" },
              { name: "Kept", type: "existing" },
              { name: "Odd", type: "legacy" as unknown as "new" },
            ],
          },
        ],
      },
      { types: false },
    );
    expect(["arch-0", "arch-1", "arch-2", "arch-3"].map((id) => handlesOf(id)[0].background)).toEqual([
      "#1976d2",
      "#ff9800",
      "#4caf50",
      "#999",
    ]);
  });

  it("keeps a 26-character name whole and cuts a 27-character one", () => {
    renderDiagram({
      layers: [
        {
          name: "L",
          components: [
            { name: "Abcdefghijklmnopqrstuvwxyz", type: "new" },
            { name: "Abcdefghijklmnopqrstuvwxyz1", type: "new" },
          ],
        },
      ],
    });
    expect(within(nodeEl("arch-0")).getByText("Abcdefghijklmnopqrstuvwxyz")).toBeInTheDocument();
    expect(within(nodeEl("arch-1")).getByText("Abcdefghijklmnopqrstuvwxy…")).toBeInTheDocument();
  });

  it("skips a layer that has no components list at all", () => {
    renderDiagram({
      layers: [{ name: "Bare" } as never, { name: "Real", components: [{ name: "Solo", type: "new" }] }],
    });
    expect((rf.props?.nodes ?? []).map((n) => n.id)).toEqual(["layer-1", "arch-0"]);
    expect(screen.getByText("1 component · 0 integrations")).toBeInTheDocument();
  });

  it("omits the new-components chip when nothing is new", () => {
    renderDiagram({
      layers: [
        {
          name: "L",
          components: [
            { name: "Kept", type: "existing" },
            { name: "Bought", type: "recommended" },
          ],
        },
      ],
    });
    expect(screen.getByText("1 existing reused")).toBeInTheDocument();
    expect(screen.getByText("1 Recommended")).toBeInTheDocument();
    expect(screen.queryByText(/new components/)).not.toBeInTheDocument();
  });

  it("recomputes the diagram when the card types or the result change", () => {
    const { rerender } = render(<ArchitectureDiagram arch={ARCH} />);
    expect(within(nodeEl("arch-0")).queryByText("apps")).not.toBeInTheDocument();

    rerender(<ArchitectureDiagram arch={ARCH} types={CARD_TYPES} />);
    expect(within(nodeEl("arch-0")).getByText("apps")).toBeInTheDocument();

    rerender(
      <ArchitectureDiagram
        arch={{ layers: [{ name: "Next", components: [{ name: "Fresh", type: "new" }] }] }}
        types={CARD_TYPES}
      />,
    );
    expect(within(nodeEl("arch-0")).getByText("Fresh")).toBeInTheDocument();
    expect(screen.getByText("1 component · 0 integrations")).toBeInTheDocument();
  });
});

describe("ArchitectureDiagram — resolving integration ends", () => {
  it("prefers an exact name, then containment, then an unambiguous first word of four letters or more", () => {
    renderDiagram({
      layers: [
        {
          name: "L",
          components: [
            { name: "App", type: "new" }, // arch-0
            { name: "App Gateway", type: "new" }, // arch-1
            { name: "Customer Portal", type: "new" }, // arch-2
            { name: "SAP ERP", type: "existing" }, // arch-3
            { name: "Ruby Runtime", type: "existing" }, // arch-4
            { name: "Postgres Cluster", type: "existing" }, // arch-5
            { name: "Billing", type: "new" }, // arch-6
          ],
        },
      ],
      integrations: [
        // Exact wins over "App", which it also contains.
        { from: "App Gateway", to: "Billing" },
        // Surrounding spaces are ignored before matching.
        { from: "  App Gateway  ", to: "Customer Portal" },
        // Contained in a component name, but not its first word.
        { from: "Portal", to: "Billing" },
        // A three-letter first word is too short to match on.
        { from: "SAP HANA", to: "Billing" },
        // A four-letter first word is enough.
        { from: "Ruby Gems", to: "Billing" },
        // The first word only has to start a component name.
        { from: "Post Office", to: "Billing" },
      ],
    });
    // All in one row, so each edge runs left to right.
    expect(edgeEnds()).toEqual(["arch-1>arch-6", "arch-1>arch-2", "arch-2>arch-6", "arch-4>arch-6", "arch-5>arch-6"]);
  });
});

describe("ArchitectureDiagram — edge rendering", () => {
  function edgePath(edgeId: string): SVGPathElement {
    const path = document.querySelector(`[data-edge="${edgeId}"] .react-flow__edge-path`);
    if (!path) throw new Error(`no path for ${edgeId}`);
    return path as SVGPathElement;
  }

  it("puts the arrowhead on the path end the edge asks for", () => {
    renderDiagram();
    // arch-e-0: Customer Portal → Postgres Cluster, drawn as written.
    expect(edgePath("arch-e-0")).toHaveAttribute("marker-end", "url(#arrow-end)");
    expect(edgePath("arch-e-0")).not.toHaveAttribute("marker-start");
    // arch-e-2: Event Bus → Customer Portal, drawn from the portal down.
    expect(edgePath("arch-e-2")).toHaveAttribute("marker-start", "url(#arrow-start)");
    expect(edgePath("arch-e-2")).not.toHaveAttribute("marker-end");
  });

  it("routes each edge from its source point to its target point", () => {
    renderDiagram();
    const d = edgePath("arch-e-0").getAttribute("d") ?? "";
    // The fake places every source at (0, 0) and every target at (120, 200).
    expect(d).toMatch(/^M0 0/);
    expect(d).toMatch(/120 200$/);
    expect(d).not.toContain("NaN");
  });

  it("draws the hovered component's edges solid and in the highlight colour (light theme)", () => {
    renderDiagram();
    expect(edgePath("arch-e-0").style.stroke).toBe("#777");

    fireEvent.mouseEnter(nodeEl("arch-2"));
    const hot = edgePath("arch-e-0");
    expect(hot.style.stroke).toBe("#1976d2");
    expect(hot.style.strokeDasharray).toBe("none");
    // An edge not touching the hovered component keeps the resting style.
    expect(edgePath("arch-e-1").style.stroke).toBe("#777");
    expect(edgePath("arch-e-1").style.strokeDasharray).toBe("5 3");
  });

  it("uses the dark theme's edge colours", () => {
    renderDiagram(ARCH, { dark: true });
    expect(edgePath("arch-e-0").style.stroke).toBe("#aaa");

    fireEvent.mouseEnter(nodeEl("arch-2"));
    expect(edgePath("arch-e-0").style.stroke).toBe("#4fc3f7");
    expect(edgePath("arch-e-1").style.stroke).toBe("#aaa");
  });

  it("draws an edge that carries no data as a plain dashed line without a label", () => {
    const { unmount } = renderDiagram();
    const ArchEdge = rf.props?.edgeTypes?.archEdge as ComponentType<Record<string, unknown>>;
    unmount();

    render(
      <svg>
        <ArchEdge
          id="bare"
          source="a"
          target="b"
          sourceX={0}
          sourceY={0}
          targetX={50}
          targetY={50}
          sourcePosition={Position.Bottom}
          targetPosition={Position.Top}
        />
      </svg>,
    );
    const path = document.getElementById("bare") as unknown as SVGPathElement;
    expect(path.style.strokeDasharray).toBe("5 3");
    expect(path.style.stroke).toBe("#777");
    expect(screen.queryByTestId("edge-label")).not.toBeInTheDocument();
  });

  it("keeps only a hovered component's own neighbours in full view", () => {
    renderDiagram();
    const canvas = screen.getByTestId("rf").parentElement as HTMLElement;

    fireEvent.mouseEnter(nodeEl("arch-2"));
    const [dim, keep, ...rest] = (canvas.querySelector("style")?.textContent ?? "").split("\n");
    expect(rest).toEqual([]);
    // Every component fades …
    expect(dim).toContain(".arch-hover-active .react-flow__node-archNode");
    expect(dim).toContain("opacity: 0.35");
    // … except the hovered one and those it shares an edge with, as one selector list.
    expect(keep).toBe(
      '.react-flow__node[data-id="arch-2"],.react-flow__node[data-id="arch-0"],.react-flow__node[data-id="arch-4"] { opacity: 1 !important; }',
    );

    // "HubSpot CRM" is only linked to the portal: nothing else stays in view.
    fireEvent.mouseLeave(nodeEl("arch-2"));
    fireEvent.mouseEnter(nodeEl("arch-1"));
    const css = canvas.querySelector("style")?.textContent ?? "";
    expect(css).toContain('[data-id="arch-1"]');
    expect(css).toContain('[data-id="arch-0"]');
    expect(css).not.toContain('[data-id="arch-2"]');
    expect(css).not.toContain('[data-id="arch-4"]');
  });
});

describe("ArchitectureDiagram — translated labels", () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("counts one component and one integration in the singular", () => {
    renderDiagram({
      layers: [{ name: "L", components: [{ name: "Solo", type: "new" }, { name: "Duo", type: "new" }] }],
      integrations: [{ from: "Solo", to: "Duo" }],
    });
    expect(screen.getByText("2 components · 1 integration")).toBeInTheDocument();
  });

  it("names an integration's direction on its edge in the user's language", async () => {
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    renderDiagram({
      ...ARCH,
      integrations: [
        ...(ARCH.integrations ?? []),
        // A direction it has no name for is shown as it came.
        { from: "HubSpot CRM", to: "Event Bus", protocol: "Kafka", direction: "streaming" },
        { from: "Customer Portal", to: "Event Bus", direction: "batch" },
      ],
    });

    expect(screen.getAllByTestId("edge-label").map((l) => l.textContent)).toEqual([
      "REST, asynchron",
      "GraphQL",
      "bidirektional",
      "Kafka, streaming",
      "Batch",
    ]);
    expect(edgeOf("arch-0", "arch-2").data).toMatchObject({ label: "REST, asynchron", direction: "async" });
  });

  it("renames an integration's direction when the user switches language", async () => {
    renderDiagram();
    expect(screen.getAllByTestId("edge-label").map((l) => l.textContent)).toEqual([
      "REST, async",
      "GraphQL",
      "bidirectional",
    ]);

    await act(async () => {
      await i18n.changeLanguage("de");
    });
    expect(screen.getAllByTestId("edge-label").map((l) => l.textContent)).toEqual([
      "REST, asynchron",
      "GraphQL",
      "bidirektional",
    ]);
  });

  it("names the badges and the summary chip in the user's language", async () => {
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    renderDiagram();

    expect(within(nodeEl("arch-0")).getByText("Neu")).toBeInTheDocument();
    expect(within(nodeEl("arch-1")).getByText("Kaufen")).toBeInTheDocument();
    expect(within(nodeEl("arch-2")).getByText("Wiederverwenden")).toBeInTheDocument();
    expect(screen.getByText("5 Komponenten · 6 Integrationen")).toBeInTheDocument();
    expect(screen.queryByText(/components|integrations/)).not.toBeInTheDocument();
  });
});
