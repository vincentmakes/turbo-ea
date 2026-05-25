import ELK from "elkjs/lib/elk.bundled.js";

const elk = new ELK();

export interface ElkLayoutInput {
  nodes: { id: string; width: number; height: number }[];
  edges: { id: string; source: string; target: string }[];
  algorithm?: "layered" | "force" | "stress" | "rectpacking";
}

export interface ElkLayoutResult {
  id: string;
  x: number;
  y: number;
}

export async function computeArchiMateLayout(
  input: ElkLayoutInput,
): Promise<ElkLayoutResult[]> {
  if (input.nodes.length === 0) return [];

  const graph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": input.algorithm ?? "layered",
      "elk.direction": "RIGHT",
      "elk.layered.spacing.nodeNodeBetweenLayers": "50",
      "elk.spacing.nodeNode": "30",
      "elk.padding": "[top=20, left=20, bottom=20, right=20]",
    },
    children: input.nodes.map((n) => ({
      id: n.id,
      width: n.width,
      height: n.height,
    })),
    edges: input.edges.map((e) => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    })),
  };

  const result = await elk.layout(graph);

  return (result.children ?? []).map((n) => ({
    id: n.id!,
    x: n.x ?? 0,
    y: n.y ?? 0,
  }));
}
