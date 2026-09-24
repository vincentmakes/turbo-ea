/**
 * Arrowheads follow the flow direction set on the relation, however the row
 * happens to be stored (discussion #1140).
 *
 * The reported landscape: Multicash provides the `MultiCash | SAP` interface
 * and SAP FI consumes it. SAP FI's link is stored the relation type's way
 * (Application → Interface, `reverse`); Multicash's is stored the other way
 * round (Interface → Application) carrying `forward` — "Provider" in card
 * detail. Read on the stored row, that drew Multicash as a consumer in the
 * view and in the diagram created from it.
 */
import { describe, expect, it } from "vitest";
import type { Node } from "@xyflow/react";
import { buildLdvDiagramXml } from "@/features/diagrams/drawio-shapes";
import type { CardType } from "@/types";
import {
  buildLdvFlow,
  orientEdgesToRelationTypes,
  type GEdge,
  type GNode,
} from "./layeredDependencyLayout";
import { collectDiagramInputs } from "./ldvDiagramExport";

function makeType(key: string): CardType {
  return {
    key,
    label: key,
    icon: "description",
    color: "#999",
    category: "Application & Data",
    has_hierarchy: false,
    has_successors: false,
    built_in: true,
    is_hidden: false,
    sort_order: 0,
    subtypes: [],
    fields_schema: [],
    section_config: {},
    stakeholder_roles: [],
    translations: {},
  } as CardType;
}

const TYPES = [makeType("Application"), makeType("Interface")];
const REL_TYPES = new Map([
  ["relAppToInterface", { source_type_key: "Application", target_type_key: "Interface" }],
]);

// Distinct 8-char prefixes: the DrawIO serialiser derives cell ids from them.
const SAP_FI = "sapfi-card";
const IFACE = "iface-card";
const MCASH = "mcash-card";

const NODES: GNode[] = [
  { id: SAP_FI, name: "SAP FI", type: "Application" },
  { id: IFACE, name: "MultiCash | SAP", type: "Interface" },
  { id: MCASH, name: "Multicash", type: "Application" },
];

const EDGES: GEdge[] = [
  // Stored the type's way: SAP FI consumes.
  {
    source: SAP_FI,
    target: IFACE,
    type: "relAppToInterface",
    label: "provides / consumes",
    attributes: { flowDirection: "reverse" },
  },
  // Stored the other way round: Multicash provides.
  {
    source: IFACE,
    target: MCASH,
    type: "relAppToInterface",
    label: "provides / consumes",
    attributes: { flowDirection: "forward" },
  },
];

describe("orientEdgesToRelationTypes", () => {
  it("turns a row stored against its type, and only that one", () => {
    const out = orientEdgesToRelationTypes(NODES, EDGES, REL_TYPES);
    expect(out[0]).toBe(EDGES[0]);
    expect(out[1]).toMatchObject({ source: MCASH, target: IFACE });
    // Only the endpoints move — the verb and the flow are the relation's own.
    expect(out[1].label).toBe("provides / consumes");
    expect(out[1].attributes).toEqual({ flowDirection: "forward" });
  });

  it("hands back the same array when nothing needs turning", () => {
    const edges = [EDGES[0]];
    expect(orientEdgesToRelationTypes(NODES, edges, REL_TYPES)).toBe(edges);
  });

  it("leaves hierarchy lines, unknown types and off-view cards alone", () => {
    const edges: GEdge[] = [
      { source: IFACE, target: MCASH, type: "hierarchy", label: "contains" },
      { source: IFACE, target: MCASH, type: "somethingCustom" },
      { source: IFACE, target: "not-on-view", type: "relAppToInterface" },
    ];
    expect(orientEdgesToRelationTypes(NODES, edges, REL_TYPES)).toBe(edges);
  });

  it("never turns a self-referencing relation type", () => {
    const rel = new Map([["relAppToApp", { source_type_key: "Application", target_type_key: "Application" }]]);
    const edges: GEdge[] = [{ source: MCASH, target: SAP_FI, type: "relAppToApp" }];
    expect(orientEdgesToRelationTypes(NODES, edges, rel)).toBe(edges);
  });
});

describe("the reported landscape (#1140)", () => {
  const flow = buildLdvFlow(NODES, orientEdgesToRelationTypes(NODES, EDGES, REL_TYPES), TYPES);
  const byPair = (source: string, target: string) =>
    flow.edges.find((e) => e.source === source && e.target === target);

  it("draws the consumer's arrowhead at the consumer", () => {
    const e = byPair(SAP_FI, IFACE)!;
    expect(e.markerStart).toBeDefined();
    expect(e.markerEnd).toBeUndefined();
  });

  it("draws the provider's arrowhead at the interface, not at the provider", () => {
    const e = byPair(MCASH, IFACE)!;
    expect(e).toBeDefined();
    expect(e.markerEnd).toBeDefined();
    expect(e.markerStart).toBeUndefined();
  });

  it("carries the same direction onto the diagram created from the view", () => {
    const inputs = collectDiagramInputs(flow.nodes as Node[], flow.edges);
    const xml = buildLdvDiagramXml(inputs.cards, inputs.rels, inputs.layers);
    const edgeStyle = (source: string, target: string) => {
      const m = xml.match(
        new RegExp(
          `<mxCell style="([^"]*)" edge="1" parent="1" source="card-\\d+-${source.slice(0, 8)}" ` +
            `target="card-\\d+-${target.slice(0, 8)}"`,
        ),
      );
      return m?.[1];
    };
    expect(edgeStyle(MCASH, IFACE)).toContain("endArrow=block;endFill=1;startArrow=none");
    expect(edgeStyle(SAP_FI, IFACE)).toContain("startArrow=block;startFill=1;endArrow=none");
    // No line runs interface → provider any more.
    expect(edgeStyle(IFACE, MCASH)).toBeUndefined();
  });
});
