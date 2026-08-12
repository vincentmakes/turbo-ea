import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "@/api/client";
import { diffStaleItems, fetchInventoryState } from "./staleCheck";
import type { InventoryState } from "./staleCheck";
import type { ScannedSyncedEdge, ScannedSyncedFS } from "./drawio-shapes";
import type { Card, Relation } from "@/types";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
}));

const mockGet = vi.mocked(api.get);

function card(id: string, name: string, status = "ACTIVE"): Card {
  return {
    id,
    type: "Application",
    name,
    status,
    approval_status: "NONE",
    data_quality: 0,
    tags: [],
    stakeholders: [],
  };
}

function cell(
  cellId: string,
  cardId: string,
  name: string,
  type = "Application",
): ScannedSyncedFS {
  return { cellId, cardId, name, type };
}

function edge(
  edgeCellId: string,
  relationId: string,
  sourceCardId: string,
  targetCardId: string,
  flowDirection?: "forward" | "reverse" | "bidirectional",
): ScannedSyncedEdge {
  return {
    edgeCellId,
    relationId,
    relationType: "relOrgToApp",
    edgeLabel: "uses",
    sourceCardId,
    targetCardId,
    sourceName: "Src",
    targetName: "Tgt",
    flowDirection,
  };
}

function rel(
  id: string,
  source_id: string,
  target_id: string,
  attributes?: Record<string, unknown>,
): Relation {
  return { id, type: "relOrgToApp", source_id, target_id, attributes };
}

function inv(cards: Card[], relations: Relation[] = []): InventoryState {
  return {
    cardById: new Map(cards.map((c) => [c.id, c])),
    relationById: new Map(relations.map((r) => [r.id, r])),
  };
}

const color = () => "#0f7eb5";
const relLabel = (e: ScannedSyncedEdge) => e.edgeLabel;
// Mirrors the editor's relationFlowFor gate for the relOrgToApp test type:
// a flow applies only when the relation carries a valid value.
const flowOf = (
  _typeKey: string,
  attributes: Record<string, unknown> | undefined,
) => {
  const v = attributes?.flowDirection;
  return v === "forward" || v === "reverse" || v === "bidirectional"
    ? v
    : undefined;
};

describe("diffStaleItems", () => {
  it("returns nothing when canvas and inventory agree", () => {
    const items = diffStaleItems(
      [cell("c1", "id1", "NexaCore")],
      [edge("e1", "r1", "id1", "id2")],
      inv([card("id1", "NexaCore"), card("id2", "Other")], [rel("r1", "id1", "id2")]),
      color,
      relLabel,
      flowOf,
    );
    expect(items).toEqual([]);
  });

  it("flags a renamed card with old and new names", () => {
    const items = diffStaleItems(
      [cell("c1", "id1", "Old Name")],
      [],
      inv([card("id1", "New Name")]),
      color,
      relLabel,
      flowOf,
    );
    expect(items).toEqual([
      {
        kind: "renamed",
        cellId: "c1",
        cardId: "id1",
        diagramName: "Old Name",
        inventoryName: "New Name",
        typeColor: "#0f7eb5",
      },
    ]);
  });

  it("flags a hard-deleted card (absent from the batch response)", () => {
    const items = diffStaleItems(
      [cell("c1", "id1", "Gone")],
      [],
      inv([]),
      color,
      relLabel,
      flowOf,
    );
    expect(items).toEqual([
      {
        kind: "cardDeleted",
        cellId: "c1",
        cardId: "id1",
        name: "Gone",
        typeColor: "#0f7eb5",
      },
    ]);
  });

  it("flags an archived card as archived, not renamed", () => {
    const items = diffStaleItems(
      [cell("c1", "id1", "Old Name")],
      [],
      inv([card("id1", "New Name", "ARCHIVED")]),
      color,
      relLabel,
      flowOf,
    );
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("cardArchived");
  });

  it("covers expanded-group children the same as top-level cells", () => {
    const items = diffStaleItems(
      [cell("c1", "id1", "Parent"), cell("child1", "id2", "Old Child")],
      [],
      inv([card("id1", "Parent"), card("id2", "New Child")]),
      color,
      relLabel,
      flowOf,
    );
    expect(items).toEqual([
      expect.objectContaining({ kind: "renamed", cellId: "child1" }),
    ]);
  });

  it("flags a relation deleted from inventory while both endpoints live", () => {
    const items = diffStaleItems(
      [cell("c1", "id1", "A"), cell("c2", "id2", "B")],
      [edge("e1", "r1", "id1", "id2")],
      inv([card("id1", "A"), card("id2", "B")], []),
      color,
      relLabel,
      flowOf,
    );
    expect(items).toEqual([
      {
        kind: "relationDeleted",
        cellId: "e1",
        relationId: "r1",
        relationLabel: "uses",
        sourceName: "Src",
        targetName: "Tgt",
      },
    ]);
  });

  it("suppresses the relation finding when an endpoint card is flagged", () => {
    // The relations endpoint hides relations with an archived endpoint, so
    // without this suppression every such edge would read as a false
    // "deleted" positive — and removing the card cell cascades the edge
    // anyway.
    const items = diffStaleItems(
      [cell("c1", "id1", "A"), cell("c2", "id2", "B")],
      [edge("e1", "r1", "id1", "id2")],
      inv([card("id1", "A", "ARCHIVED"), card("id2", "B")], []),
      color,
      relLabel,
      flowOf,
    );
    expect(items).toEqual([
      expect.objectContaining({ kind: "cardArchived", cellId: "c1" }),
    ]);
  });

  it("skips edges whose endpoint card ids could not be resolved", () => {
    const items = diffStaleItems(
      [],
      [edge("e1", "r1", "", "id2")],
      inv([card("id2", "B")], []),
      color,
      relLabel,
      flowOf,
    );
    expect(items).toEqual([]);
  });

  it("returns empty for an empty canvas", () => {
    expect(diffStaleItems([], [], inv([]), color, relLabel, flowOf)).toEqual([]);
  });

  it("flags a flow change and derives incoming from the relation's endpoints", () => {
    const items = diffStaleItems(
      [cell("c1", "id1", "A"), cell("c2", "id2", "B")],
      // Edge drawn id1 → id2 while the relation runs id2 → id1, stamped
      // "forward" when it was drawn.
      [edge("e1", "r1", "id1", "id2", "forward")],
      inv(
        [card("id1", "A"), card("id2", "B")],
        [rel("r1", "id2", "id1", { flowDirection: "reverse" })],
      ),
      color,
      relLabel,
      flowOf,
    );
    expect(items).toEqual([
      {
        kind: "relationFlowChanged",
        cellId: "e1",
        relationId: "r1",
        relationLabel: "uses",
        sourceName: "Src",
        targetName: "Tgt",
        newFlow: "reverse",
        incoming: true,
      },
    ]);
  });

  it("flags a flow the inventory gained after the edge was drawn", () => {
    const items = diffStaleItems(
      [],
      [edge("e1", "r1", "id1", "id2")],
      inv(
        [card("id1", "A"), card("id2", "B")],
        [rel("r1", "id1", "id2", { flowDirection: "bidirectional" })],
      ),
      color,
      relLabel,
      flowOf,
    );
    expect(items).toEqual([
      expect.objectContaining({
        kind: "relationFlowChanged",
        newFlow: "bidirectional",
        incoming: false,
      }),
    ]);
  });

  it("flags a flow the inventory cleared, with newFlow undefined", () => {
    const items = diffStaleItems(
      [],
      [edge("e1", "r1", "id1", "id2", "forward")],
      inv([card("id1", "A"), card("id2", "B")], [rel("r1", "id1", "id2", {})]),
      color,
      relLabel,
      flowOf,
    );
    expect(items).toEqual([
      expect.objectContaining({
        kind: "relationFlowChanged",
        newFlow: undefined,
      }),
    ]);
  });

  it("stays silent when the stamped flow still matches the inventory", () => {
    const items = diffStaleItems(
      [],
      [edge("e1", "r1", "id1", "id2", "forward")],
      inv(
        [card("id1", "A"), card("id2", "B")],
        [rel("r1", "id1", "id2", { flowDirection: "forward" })],
      ),
      color,
      relLabel,
      flowOf,
    );
    expect(items).toEqual([]);
  });
});

describe("fetchInventoryState", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  function respond() {
    mockGet.mockImplementation(async (path: string) => {
      if (path.startsWith("/cards?ids=")) {
        const ids = decodeURIComponent(
          path.slice("/cards?ids=".length),
        ).split(",");
        return {
          items: ids
            .filter((id) => !id.startsWith("deleted"))
            .map((id) => card(id, `Name of ${id}`)),
          total: ids.length,
          page: 1,
          page_size: 10000,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;
      }
      if (path.startsWith("/relations?card_ids=")) {
        // Every chunk reports the same shared relation — the Map dedupes.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return [rel("r-shared", "a", "b"), rel("r-extra", "a", "c")] as any;
      }
      throw new Error(`unexpected path ${path}`);
    });
  }

  it("batches ids into chunks of 200 and merges the results", async () => {
    respond();
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    const state = await fetchInventoryState(ids);
    // 250 ids → 2 chunks → 2 cards calls + 2 relations calls.
    expect(mockGet).toHaveBeenCalledTimes(4);
    expect(state.cardById.size).toBe(250);
    expect(new Set(state.relationById.keys())).toEqual(
      new Set(["r-shared", "r-extra"]),
    );
  });

  it("omits deleted cards and dedupes ids before fetching", async () => {
    respond();
    const state = await fetchInventoryState(["id-1", "id-1", "deleted-1", ""]);
    expect(mockGet).toHaveBeenCalledTimes(2);
    const cardsPath = mockGet.mock.calls[0][0] as string;
    expect(decodeURIComponent(cardsPath)).toBe("/cards?ids=id-1,deleted-1");
    expect(state.cardById.has("id-1")).toBe(true);
    expect(state.cardById.has("deleted-1")).toBe(false);
  });

  it("forwards the abort signal to every request", async () => {
    respond();
    const ctrl = new AbortController();
    await fetchInventoryState(["id-1"], ctrl.signal);
    for (const call of mockGet.mock.calls) {
      expect(call[1]).toEqual({ signal: ctrl.signal });
    }
  });
});
