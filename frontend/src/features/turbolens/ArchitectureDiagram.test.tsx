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
 * `edgeTypes` and records the props it was given; `Handle`, `Background`,
 * `Controls` and the provider are no-ops, and `EdgeLabelRenderer` portals into
 * the document instead of the flow's viewport.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { createPortal } from "react-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import type { ComponentProps, ComponentType, ReactNode } from "react";
import type { Edge, Node } from "@xyflow/react";
import { CARD_TYPES } from "@/test/fixtures/metamodel";
import type { ArchitectureResult } from "@/types";

const rf = vi.hoisted(() => ({
  props: null as null | {
    nodes: Node[];
    edges: Edge[];
    colorMode?: string;
    onNodeMouseEnter?: (e: unknown, n: Node) => void;
    onNodeMouseLeave?: (e: unknown, n: Node) => void;
  },
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
                    markerEnd="url(#arrow)"
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
    Controls: () => null,
    Handle: () => null,
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

beforeEach(() => {
  rf.props = null;
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
    expect(screen.getByText("1 components · 0 integrations")).toBeInTheDocument();
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

    // Same layer, left to right: side handles; a sync direction is not spelled out.
    const portalToCrm = edgeOf("arch-0", "arch-1");
    expect(portalToCrm).toMatchObject({ sourceHandle: "r", targetHandle: "l" });
    expect(portalToCrm.data).toMatchObject({ label: "GraphQL" });

    // Written bottom → top, drawn top → bottom; no protocol or direction → no label.
    const busToPortal = edgeOf("arch-0", "arch-4");
    expect(busToPortal).toMatchObject({ sourceHandle: "b", targetHandle: "t" });
    expect(busToPortal.data).toMatchObject({ label: "" });

    const replicaToBus = edgeOf("arch-2", "arch-4");
    expect(replicaToBus).toMatchObject({ sourceHandle: "r", targetHandle: "l" });
    expect(replicaToBus.data).toMatchObject({ label: "bidirectional" });

    expect(screen.getAllByTestId("edge-label").map((l) => l.textContent)).toEqual([
      "REST, async",
      "GraphQL",
      "bidirectional",
    ]);
  });

  it("connects a same-layer integration written right to left", () => {
    renderDiagram({
      layers: [{ name: "L", components: [{ name: "Left App", type: "new" }, { name: "Right App", type: "new" }] }],
      integrations: [{ from: "Right App", to: "Left App", protocol: "SOAP" }],
    });
    const [edge] = rf.props?.edges ?? [];
    expect([edge.source, edge.target].sort()).toEqual(["arch-0", "arch-1"]);
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
