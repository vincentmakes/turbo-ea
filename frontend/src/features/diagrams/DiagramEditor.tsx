import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Snackbar from "@mui/material/Snackbar";
import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";
import CircularProgress from "@mui/material/CircularProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import CardPickerDialog from "./CardPickerDialog";
import CreateOnDiagramDialog from "./CreateOnDiagramDialog";
import RelationPickerDialog from "./RelationPickerDialog";
import type { EdgeEndpoints } from "./RelationPickerDialog";
import DiagramSyncPanel from "./DiagramSyncPanel";
import type {
  PendingCard,
  PendingRelation,
  StaleItem,
} from "./DiagramSyncPanel";
import {
  buildCardCellData,
  insertCardIntoGraph,
  getVisibleCenter,
  addExpandOverlay,
  addResyncOverlay,
  expandCardGroup,
  collapseCardGroup,
  getGroupChildCardIds,
  refreshCardOverlays,
  insertPendingCard,
  stampEdgeAsRelation,
  markCellSynced,
  markEdgeSynced,
  updateCellLabel,
  removeDiagramCell,
  scanDiagramItems,
} from "./drawio-shapes";
import type { ExpandChildData } from "./drawio-shapes";
import { useMetamodel } from "@/hooks/useMetamodel";
import type { Card, CardType, Relation, RelationType } from "@/types";

/* ------------------------------------------------------------------ */
/*  DrawIO configuration                                               */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _meta = import.meta as any;
const DRAWIO_BASE_URL: string =
  _meta.env?.VITE_DRAWIO_URL || "/drawio/index.html";

const DRAWIO_URL_PARAMS = new URLSearchParams({
  embed: "1",
  proto: "json",
  spin: "1",
  modified: "unsavedChanges",
  saveAndExit: "1",
  noSaveBtn: "0",
  noExitBtn: "0",
}).toString();

const EMPTY_DIAGRAM =
  '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DiagramData {
  id: string;
  name: string;
  type: string;
  data: { xml?: string; thumbnail?: string };
}

interface DrawIOMessage {
  event:
    | "init"
    | "save"
    | "exit"
    | "export"
    | "configure"
    | "insertCard"
    | "createCard"
    | "edgeConnected";
  xml?: string;
  data?: string;
  modified?: boolean;
  x?: number;
  y?: number;
  edgeCellId?: string;
  sourceCardId?: string;
  targetCardId?: string;
  sourceType?: string;
  targetType?: string;
  sourceName?: string;
  targetName?: string;
  sourceColor?: string;
  targetColor?: string;
}

/* ------------------------------------------------------------------ */
/*  Bootstrap: graph ref, context menu, edge interception              */
/* ------------------------------------------------------------------ */

function bootstrapDrawIO(iframe: HTMLIFrameElement) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = iframe.contentWindow as any;
    if (!win?.Draw?.loadPlugin) return;

    // Remove PWA manifest link so it doesn't trigger auth-proxy redirects
    // (e.g. Cloudflare Access) — browser manifest fetches omit cookies.
    const manifestLink = win.document.querySelector('link[rel="manifest"]');
    if (manifestLink) manifestLink.remove();

    win.Draw.loadPlugin((ui: Record<string, unknown>) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = ui.editor as any;
      const graph = editor?.graph;
      if (graph) {
        win.__turboGraph = graph;
      }

      /* ---------- Right-click context menu ---------- */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const menus = ui.menus as any;
      if (menus?.createPopupMenu) {
        const origFactory = menus.createPopupMenu;
        menus.createPopupMenu = function (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...args: any[]
        ) {
          origFactory.apply(this, args);
          const [menu, _cell, evt] = args as [any, any, MouseEvent];
          menu.addSeparator();

          const mxEvent = win.mxEvent;
          const container = graph.container;
          const offset = container.getBoundingClientRect();
          const s = graph.view.scale;
          const tr = graph.view.translate;
          const gx = Math.round(
            (mxEvent.getClientX(evt) - offset.left + container.scrollLeft) / s - tr.x,
          );
          const gy = Math.round(
            (mxEvent.getClientY(evt) - offset.top + container.scrollTop) / s - tr.y,
          );

          menu.addItem("Insert Existing Card\u2026", null, () => {
            win.parent.postMessage(
              JSON.stringify({ event: "insertCard", x: gx, y: gy }),
              "*",
            );
          });

          menu.addItem("Create New Card\u2026", null, () => {
            win.parent.postMessage(
              JSON.stringify({ event: "createCard", x: gx, y: gy }),
              "*",
            );
          });
        };
      }

      /* ---------- Edge connection interception ---------- */
      const connHandler = graph.connectionHandler;
      if (connHandler) {
        connHandler.addListener(win.mxEvent.CONNECT, function (
          _sender: unknown,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          evt: any,
        ) {
          const edge = evt.getProperty("cell");
          if (!edge) return;

          const model = graph.getModel();
          const src = model.getTerminal(edge, true);
          const tgt = model.getTerminal(edge, false);
          if (!src || !tgt) return;

          const srcFsId = src.value?.getAttribute?.("cardId");
          const tgtFsId = tgt.value?.getAttribute?.("cardId");
          const srcType = src.value?.getAttribute?.("cardType");
          const tgtType = tgt.value?.getAttribute?.("cardType");

          if (srcFsId && tgtFsId && srcType && tgtType) {
            // Resolve colors via stored style (fillColor)
            const srcStyle = model.getStyle(src) || "";
            const tgtStyle = model.getStyle(tgt) || "";
            const pick = (s: string) => {
              const m = /fillColor=([^;]+)/.exec(s);
              return m ? m[1] : "#999";
            };

            win.parent.postMessage(
              JSON.stringify({
                event: "edgeConnected",
                edgeCellId: edge.id,
                sourceCardId: srcFsId,
                targetCardId: tgtFsId,
                sourceType: srcType,
                targetType: tgtType,
                sourceName: src.value.getAttribute("label") || "",
                targetName: tgt.value.getAttribute("label") || "",
                sourceColor: pick(srcStyle),
                targetColor: pick(tgtStyle),
              }),
              "*",
            );
          }
        });
      }
    });
  } catch {
    // Cross-origin or editor not ready
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function DiagramEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [diagram, setDiagram] = useState<DiagramData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [snackMsg, setSnackMsg] = useState("");

  // Metamodel
  const { types: fsTypes, relationTypes } = useMetamodel();
  const fsTypesRef = useRef(fsTypes);
  fsTypesRef.current = fsTypes;
  const relTypesRef = useRef(relationTypes);
  relTypesRef.current = relationTypes;

  // Refs
  const pendingSaveXmlRef = useRef<string | null>(null);
  const contextInsertPosRef = useRef<{ x: number; y: number } | null>(null);

  // Expand/collapse caches — survive collapse/expand cycles so locally
  // deleted children don't reappear.
  const expandCacheRef = useRef<Map<string, ExpandChildData[]>>(new Map());
  const deletedChildrenRef = useRef<Map<string, Set<string>>>(new Map());

  // Dialog states
  const [pickerOpen, setPickerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [relPickerOpen, setRelPickerOpen] = useState(false);
  const pendingEdgeRef = useRef<EdgeEndpoints | null>(null);

  // Sync panel
  const [syncOpen, setSyncOpen] = useState(false);
  const [pendingCards, setPendingFS] = useState<PendingCard[]>([]);
  const [pendingRels, setPendingRels] = useState<PendingRelation[]>([]);
  const [staleItems, setStaleItems] = useState<StaleItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);

  /* ---------- Load diagram ---------- */
  useEffect(() => {
    if (!id) return;
    api
      .get<DiagramData>(`/diagrams/${id}`)
      .then(setDiagram)
      .catch(() => setSnackMsg("Failed to load diagram"))
      .finally(() => setLoading(false));
  }, [id]);

  const postToDrawIO = useCallback((msg: Record<string, unknown>) => {
    const frame = iframeRef.current;
    if (frame?.contentWindow) {
      frame.contentWindow.postMessage(JSON.stringify(msg), "*");
    }
  }, []);

  const saveDiagram = useCallback(
    async (xml: string, thumbnail?: string) => {
      if (!diagram) return;
      setSaving(true);
      try {
        const payload: Record<string, unknown> = {
          data: { ...diagram.data, xml, ...(thumbnail ? { thumbnail } : {}) },
        };
        await api.patch(`/diagrams/${diagram.id}`, payload);
        setDiagram((prev) =>
          prev ? { ...prev, data: { ...prev.data, xml, ...(thumbnail ? { thumbnail } : {}) } } : prev,
        );
        setSnackMsg("Diagram saved");
      } catch {
        setSnackMsg("Save failed");
      } finally {
        setSaving(false);
      }
    },
    [diagram],
  );

  /* ---------- Expand / collapse ---------- */

  /** Expand children into the graph and wire up overlays. */
  const doExpand = useCallback(
    (frame: HTMLIFrameElement, cellId: string, cardId: string, children: ExpandChildData[]) => {
      const deleted = deletedChildrenRef.current.get(cellId);
      const visible = deleted?.size
        ? children.filter((c) => !deleted.has(c.id))
        : children;

      if (visible.length === 0) {
        setSnackMsg("No related cards");
        return;
      }

      const inserted = expandCardGroup(frame, cellId, visible);
      addExpandOverlay(frame, cellId, true, () =>
        handleToggleGroup(cellId, cardId, true),
      );
      // If some children were locally removed, show resync icon
      if (deleted?.size) {
        addResyncOverlay(frame, cellId, () =>
          handleResync(cellId, cardId),
        );
      }
      for (const child of inserted) {
        addExpandOverlay(frame, child.cellId, false, () =>
          handleToggleGroup(child.cellId, child.cardId, false),
        );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleToggleGroup = useCallback(
    (cellId: string, cardId: string, currentlyExpanded: boolean) => {
      const frame = iframeRef.current;
      if (!frame) return;

      if (currentlyExpanded) {
        // Before collapsing, detect children the user removed while expanded
        const cached = expandCacheRef.current.get(cellId);
        if (cached) {
          const stillPresent = getGroupChildCardIds(frame, cellId);
          const nowDeleted = cached.filter((c) => !stillPresent.has(c.id)).map((c) => c.id);
          if (nowDeleted.length > 0) {
            const existing = deletedChildrenRef.current.get(cellId) ?? new Set<string>();
            nowDeleted.forEach((id) => existing.add(id));
            deletedChildrenRef.current.set(cellId, existing);
          }
        }

        collapseCardGroup(frame, cellId);
        addExpandOverlay(frame, cellId, false, () =>
          handleToggleGroup(cellId, cardId, false),
        );
        // Keep resync icon if there are local deletions
        if (deletedChildrenRef.current.get(cellId)?.size) {
          addResyncOverlay(frame, cellId, () =>
            handleResync(cellId, cardId),
          );
        }
      } else {
        // Use cached children if available, otherwise fetch from API
        const cached = expandCacheRef.current.get(cellId);
        if (cached) {
          doExpand(frame, cellId, cardId, cached);
        } else {
          api
            .get<Relation[]>(`/relations?card_id=${cardId}`)
            .then((rels) => {
              if (!iframeRef.current) return;
              const seen = new Set<string>();
              const children: ExpandChildData[] = [];
              for (const r of rels) {
                const other = r.source_id === cardId ? r.target : r.source;
                if (!other || seen.has(other.id)) continue;
                seen.add(other.id);
                const t = fsTypesRef.current.find((tp) => tp.key === other.type);
                children.push({
                  id: other.id,
                  name: other.name,
                  type: other.type,
                  color: t?.color || "#999",
                  relationType: r.type,
                });
              }
              if (children.length === 0) {
                setSnackMsg("No related cards");
                return;
              }
              children.sort((a, b) => {
                const sa = fsTypesRef.current.find((t) => t.key === a.type)?.sort_order ?? 99;
                const sb = fsTypesRef.current.find((t) => t.key === b.type)?.sort_order ?? 99;
                if (sa !== sb) return sa - sb;
                return a.name.localeCompare(b.name);
              });
              // Cache the full API result
              expandCacheRef.current.set(cellId, children);
              doExpand(iframeRef.current!, cellId, cardId, children);
            })
            .catch(() => setSnackMsg("Failed to load relations"));
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doExpand],
  );

  /** Clear local caches and re-fetch relations from inventory. */
  const handleResync = useCallback(
    (cellId: string, cardId: string) => {
      const frame = iframeRef.current;
      if (!frame) return;

      // Clear caches
      expandCacheRef.current.delete(cellId);
      deletedChildrenRef.current.delete(cellId);

      // Collapse first if currently expanded
      collapseCardGroup(frame, cellId);

      // Re-fetch and expand
      api
        .get<Relation[]>(`/relations?card_id=${cardId}`)
        .then((rels) => {
          if (!iframeRef.current) return;
          const seen = new Set<string>();
          const children: ExpandChildData[] = [];
          for (const r of rels) {
            const other = r.source_id === cardId ? r.target : r.source;
            if (!other || seen.has(other.id)) continue;
            seen.add(other.id);
            const t = fsTypesRef.current.find((tp) => tp.key === other.type);
            children.push({
              id: other.id,
              name: other.name,
              type: other.type,
              color: t?.color || "#999",
              relationType: r.type,
            });
          }
          if (children.length === 0) {
            addExpandOverlay(iframeRef.current!, cellId, false, () =>
              handleToggleGroup(cellId, cardId, false),
            );
            setSnackMsg("No related cards");
            return;
          }
          children.sort((a, b) => {
            const sa = fsTypesRef.current.find((t) => t.key === a.type)?.sort_order ?? 99;
            const sb = fsTypesRef.current.find((t) => t.key === b.type)?.sort_order ?? 99;
            if (sa !== sb) return sa - sb;
            return a.name.localeCompare(b.name);
          });
          expandCacheRef.current.set(cellId, children);
          doExpand(iframeRef.current!, cellId, cardId, children);
          setSnackMsg("Relations restored from inventory");
        })
        .catch(() => setSnackMsg("Failed to resync relations"));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doExpand],
  );

  /* ---------- Insert existing card ---------- */
  const handleInsertCard = useCallback(
    (card: Card, cardTypeKey: CardType) => {
      const frame = iframeRef.current;
      if (!frame) return;

      let x: number, y: number;
      if (contextInsertPosRef.current) {
        ({ x, y } = contextInsertPosRef.current);
        contextInsertPosRef.current = null;
      } else {
        const center = getVisibleCenter(frame);
        x = center ? center.x - 90 : 100;
        y = center ? center.y - 30 : 100;
      }

      const data = buildCardCellData({
        cardId: card.id,
        cardType: card.type,
        name: card.name,
        color: cardTypeKey.color,
        x,
        y,
      });

      const ok = insertCardIntoGraph(frame, data);
      if (ok) {
        addExpandOverlay(frame, data.cellId, false, () =>
          handleToggleGroup(data.cellId, card.id, false),
        );
        setSnackMsg(`Inserted "${card.name}"`);
      } else {
        setSnackMsg("Editor not ready — try again in a moment");
      }
    },
    [handleToggleGroup],
  );

  /* ---------- Sync panel helpers ---------- */
  const refreshSyncPanel = useCallback(() => {
    const frame = iframeRef.current;
    if (!frame) return;

    const { pendingCards: pfs, pendingRels: prels, syncedFS: _ } = scanDiagramItems(frame);

    setPendingFS(
      pfs.map((p) => {
        const typeInfo = fsTypesRef.current.find((t) => t.key === p.type);
        return {
          cellId: p.cellId,
          type: p.type,
          typeLabel: typeInfo?.label || p.type,
          typeColor: typeInfo?.color || "#999",
          name: p.name,
        };
      }),
    );

    setPendingRels(
      prels.map((p) => {
        const srcType = fsTypesRef.current.find((t) =>
          pfs.some((f) => f.tempId === p.sourceCardId && f.type === t.key),
        );
        return {
          edgeCellId: p.edgeCellId,
          relationType: p.relationType,
          relationLabel: p.relationLabel,
          sourceName: p.sourceName,
          targetName: p.targetName,
          sourceColor: srcType?.color || "#999",
          targetColor: "#999",
          sourceCardId: p.sourceCardId,
          targetCardId: p.targetCardId,
        };
      }),
    );
  }, []);

  /* ---------- Create new (pending) card ---------- */
  const handleCreateCard = useCallback(
    (data: { type: string; name: string; description?: string }) => {
      const frame = iframeRef.current;
      if (!frame) return;

      let x: number, y: number;
      if (contextInsertPosRef.current) {
        ({ x, y } = contextInsertPosRef.current);
        contextInsertPosRef.current = null;
      } else {
        const center = getVisibleCenter(frame);
        x = center ? center.x - 90 : 100;
        y = center ? center.y - 30 : 100;
      }

      const typeInfo = fsTypesRef.current.find((t) => t.key === data.type);
      const color = typeInfo?.color || "#999";
      const tempId = `pending-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

      const cellId = insertPendingCard(frame, {
        tempId,
        type: data.type,
        name: data.name,
        color,
        x,
        y,
      });

      if (cellId) {
        setSnackMsg(`"${data.name}" added (pending sync)`);
        refreshSyncPanel();
      }
      setCreateOpen(false);
    },
    [refreshSyncPanel],
  );

  /* ---------- Relation picker result ---------- */
  const handleRelationPicked = useCallback(
    (relType: RelationType, direction: "as-is" | "reversed") => {
      const frame = iframeRef.current;
      const ep = pendingEdgeRef.current;
      if (!frame || !ep) return;

      const color = direction === "as-is" ? ep.sourceColor : ep.targetColor;

      stampEdgeAsRelation(frame, ep.edgeCellId, relType.key, relType.label, color, true);

      setRelPickerOpen(false);
      pendingEdgeRef.current = null;
      setSnackMsg(`Relation "${relType.label}" added (pending sync)`);
      refreshSyncPanel();
    },
    [refreshSyncPanel],
  );

  const handleRelationCancelled = useCallback(() => {
    // User cancelled — remove the edge
    const frame = iframeRef.current;
    const ep = pendingEdgeRef.current;
    if (frame && ep) {
      removeDiagramCell(frame, ep.edgeCellId);
    }
    setRelPickerOpen(false);
    pendingEdgeRef.current = null;
  }, []);

  const handleSyncFS = useCallback(
    async (cellId: string) => {
      const frame = iframeRef.current;
      if (!frame) return;
      const item = pendingCards.find((p) => p.cellId === cellId);
      if (!item) return;

      setSyncing(true);
      try {
        const scanned = scanDiagramItems(frame);
        const raw = scanned.pendingCards.find((p) => p.cellId === cellId);
        const resp = await api.post<Card>("/cards", {
          type: item.type,
          name: item.name,
        });
        markCellSynced(frame, cellId, resp.id, item.typeColor);
        // Attach expand overlay now that it has a real ID
        addExpandOverlay(frame, cellId, false, () =>
          handleToggleGroup(cellId, resp.id, false),
        );
        // Update any pending relations that reference the old temp ID
        const tempId = raw?.tempId;
        if (tempId) {
          const { pendingRels: currentRels } = scanDiagramItems(frame);
          for (const rel of currentRels) {
            if (rel.sourceCardId === tempId || rel.targetCardId === tempId) {
              // The edge endpoints are already connected to the cell — the cell's
              // cardId attribute was just updated, so the next scan will pick
              // up the real ID. No extra action needed.
            }
          }
        }
        setSnackMsg(`"${item.name}" pushed to inventory`);
        refreshSyncPanel();
      } catch {
        setSnackMsg("Failed to create card");
      } finally {
        setSyncing(false);
      }
    },
    [pendingCards, handleToggleGroup, refreshSyncPanel],
  );

  const handleSyncRel = useCallback(
    async (edgeCellId: string) => {
      const frame = iframeRef.current;
      if (!frame) return;

      setSyncing(true);
      try {
        // Re-scan to get fresh IDs (in case FS was just synced)
        const { pendingRels } = scanDiagramItems(frame);
        const rel = pendingRels.find((r) => r.edgeCellId === edgeCellId);
        if (!rel) return;

        // Both endpoints must have real (non-pending) IDs
        if (rel.sourceCardId.startsWith("pending-") || rel.targetCardId.startsWith("pending-")) {
          setSnackMsg("Sync the connected cards first");
          return;
        }

        await api.post("/relations", {
          type: rel.relationType,
          source_id: rel.sourceCardId,
          target_id: rel.targetCardId,
        });

        markEdgeSynced(frame, edgeCellId, "#666");
        setSnackMsg(`Relation "${rel.relationLabel}" pushed to inventory`);
        refreshSyncPanel();
      } catch {
        setSnackMsg("Failed to create relation");
      } finally {
        setSyncing(false);
      }
    },
    [refreshSyncPanel],
  );

  const handleSyncAll = useCallback(async () => {
    const frame = iframeRef.current;
    if (!frame) return;
    setSyncing(true);

    try {
      // 1. Sync all pending cards first
      const { pendingCards: pfs } = scanDiagramItems(frame);
      for (const p of pfs) {
        const typeInfo = fsTypesRef.current.find((t) => t.key === p.type);
        try {
          const resp = await api.post<Card>("/cards", {
            type: p.type,
            name: p.name,
          });
          markCellSynced(frame, p.cellId, resp.id, typeInfo?.color || "#999");
          addExpandOverlay(frame, p.cellId, false, () =>
            handleToggleGroup(p.cellId, resp.id, false),
          );
        } catch {
          setSnackMsg(`Failed to sync "${p.name}"`);
        }
      }

      // 2. Sync all pending relations
      const { pendingRels: prels } = scanDiagramItems(frame);
      for (const r of prels) {
        if (r.sourceCardId.startsWith("pending-") || r.targetCardId.startsWith("pending-")) {
          continue; // skip if endpoints still pending
        }
        try {
          await api.post("/relations", {
            type: r.relationType,
            source_id: r.sourceCardId,
            target_id: r.targetCardId,
          });
          markEdgeSynced(frame, r.edgeCellId, "#666");
        } catch {
          setSnackMsg(`Failed to sync relation "${r.relationLabel}"`);
        }
      }

      refreshSyncPanel();
      setSnackMsg("Synchronisation complete");
    } finally {
      setSyncing(false);
    }
  }, [handleToggleGroup, refreshSyncPanel]);

  const handleRemoveFS = useCallback(
    (cellId: string) => {
      const frame = iframeRef.current;
      if (frame) removeDiagramCell(frame, cellId);
      refreshSyncPanel();
    },
    [refreshSyncPanel],
  );

  const handleRemoveRel = useCallback(
    (edgeCellId: string) => {
      const frame = iframeRef.current;
      if (frame) removeDiagramCell(frame, edgeCellId);
      refreshSyncPanel();
    },
    [refreshSyncPanel],
  );

  const handleCheckUpdates = useCallback(async () => {
    const frame = iframeRef.current;
    if (!frame) return;
    setCheckingUpdates(true);

    try {
      const { syncedFS } = scanDiagramItems(frame);
      const stale: StaleItem[] = [];

      for (const item of syncedFS) {
        try {
          const card = await api.get<Card>(`/cards/${item.cardId}`);
          if (card.name !== item.name) {
            const typeInfo = fsTypesRef.current.find((t) => t.key === item.type);
            stale.push({
              cellId: item.cellId,
              cardId: item.cardId,
              diagramName: item.name,
              inventoryName: card.name,
              typeColor: typeInfo?.color || "#999",
            });
          }
        } catch {
          // Card may have been deleted — skip
        }
      }

      setStaleItems(stale);
      if (stale.length === 0) setSnackMsg("All cards are up to date");
    } finally {
      setCheckingUpdates(false);
    }
  }, []);

  const handleAcceptStale = useCallback(
    (cellId: string) => {
      const frame = iframeRef.current;
      const item = staleItems.find((s) => s.cellId === cellId);
      if (!frame || !item) return;
      updateCellLabel(frame, cellId, item.inventoryName);
      setStaleItems((prev) => prev.filter((s) => s.cellId !== cellId));
      setSnackMsg(`Updated to "${item.inventoryName}"`);
    },
    [staleItems],
  );

  /* ---------- PostMessage handler ---------- */
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (typeof e.data !== "string") return;
      let msg: DrawIOMessage;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }

      switch (msg.event) {
        case "init":
          postToDrawIO({
            action: "load",
            xml: diagram?.data?.xml || EMPTY_DIAGRAM,
            autosave: 0,
          });
          // Poll for Draw.loadPlugin instead of a hardcoded delay — behind
          // Cloudflare (or slow networks) the iframe may need more than 300 ms.
          (function tryBootstrap(attempt: number) {
            const frame = iframeRef.current;
            if (!frame) return;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const win = frame.contentWindow as any;
            if (win?.Draw?.loadPlugin) {
              bootstrapDrawIO(frame);
              setTimeout(() => {
                if (iframeRef.current) {
                  refreshCardOverlays(iframeRef.current, handleToggleGroup);
                }
              }, 200);
            } else if (attempt < 50) {
              setTimeout(() => tryBootstrap(attempt + 1), 200);
            }
          })(0);
          break;

        case "save":
          if (msg.xml) {
            pendingSaveXmlRef.current = msg.xml;
            postToDrawIO({ action: "export", format: "svg", spinKey: "saving" });
            postToDrawIO({ action: "status", messageKey: "allChangesSaved", modified: false });
          }
          break;

        case "export":
          if (pendingSaveXmlRef.current) {
            const xml = pendingSaveXmlRef.current;
            pendingSaveXmlRef.current = null;
            saveDiagram(xml, msg.data);
          }
          break;

        case "exit":
          if (msg.modified && msg.xml) {
            saveDiagram(msg.xml).then(() => navigate("/diagrams"));
          } else {
            navigate("/diagrams");
          }
          break;

        case "insertCard":
          contextInsertPosRef.current = { x: msg.x ?? 100, y: msg.y ?? 100 };
          setPickerOpen(true);
          break;

        case "createCard":
          contextInsertPosRef.current = { x: msg.x ?? 100, y: msg.y ?? 100 };
          setCreateOpen(true);
          break;

        case "edgeConnected":
          if (msg.edgeCellId && msg.sourceType && msg.targetType) {
            pendingEdgeRef.current = {
              edgeCellId: msg.edgeCellId,
              sourceType: msg.sourceType,
              targetType: msg.targetType,
              sourceName: msg.sourceName || "?",
              targetName: msg.targetName || "?",
              sourceColor: msg.sourceColor || "#999",
              targetColor: msg.targetColor || "#999",
            };
            setRelPickerOpen(true);
          }
          break;

        default:
          break;
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [diagram, postToDrawIO, saveDiagram, navigate, handleToggleGroup]);

  // Refresh sync panel counts whenever it opens
  useEffect(() => {
    if (syncOpen) refreshSyncPanel();
  }, [syncOpen, refreshSyncPanel]);

  /* ---------- Derived ---------- */
  const totalPending = pendingCards.length + pendingRels.length;

  /* ---------- Render ---------- */
  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (!diagram) return <Typography color="error">Diagram not found</Typography>;

  const iframeSrc = `${DRAWIO_BASE_URL}?${DRAWIO_URL_PARAMS}`;

  return (
    <Box sx={{ height: "calc(100vh - 64px)", m: -3, display: "flex", flexDirection: "column" }}>
      {/* Toolbar */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1,
          py: 0.5,
          borderBottom: "1px solid #e0e0e0",
          minHeight: 48,
        }}
      >
        <IconButton size="small" onClick={() => navigate("/diagrams")}>
          <MaterialSymbol icon="arrow_back" size={20} />
        </IconButton>
        <Typography variant="subtitle1" fontWeight={600} noWrap sx={{ flex: 1 }}>
          {diagram.name}
        </Typography>
        {saving && <CircularProgress size={16} sx={{ ml: 1 }} />}

        {/* Sync button */}
        <Tooltip title="Synchronise diagram with inventory">
          <Button
            size="small"
            variant={totalPending > 0 ? "contained" : "outlined"}
            color={totalPending > 0 ? "warning" : "inherit"}
            startIcon={<MaterialSymbol icon="sync" size={18} />}
            onClick={() => setSyncOpen(true)}
            sx={{ textTransform: "none", minWidth: 0, px: 1.5, py: 0.25, fontSize: "0.8rem" }}
          >
            Sync{totalPending > 0 ? ` (${totalPending})` : ""}
          </Button>
        </Tooltip>
      </Box>

      {/* DrawIO canvas */}
      <Box sx={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <Box sx={{ flex: 1, position: "relative" }}>
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" }}
            title="Diagram Editor"
          />
        </Box>
      </Box>

      {/* Dialogs */}
      <CardPickerDialog
        open={pickerOpen}
        onClose={() => { setPickerOpen(false); contextInsertPosRef.current = null; }}
        onInsert={handleInsertCard}
      />

      <CreateOnDiagramDialog
        open={createOpen}
        types={fsTypes}
        onClose={() => { setCreateOpen(false); contextInsertPosRef.current = null; }}
        onCreate={handleCreateCard}
      />

      <RelationPickerDialog
        open={relPickerOpen}
        endpoints={pendingEdgeRef.current}
        relationTypes={relationTypes}
        onClose={handleRelationCancelled}
        onSelect={handleRelationPicked}
      />

      <DiagramSyncPanel
        open={syncOpen}
        onClose={() => setSyncOpen(false)}
        pendingCards={pendingCards}
        pendingRels={pendingRels}
        staleItems={staleItems}
        syncing={syncing}
        onSyncAll={handleSyncAll}
        onSyncFS={handleSyncFS}
        onSyncRel={handleSyncRel}
        onRemoveFS={handleRemoveFS}
        onRemoveRel={handleRemoveRel}
        onAcceptStale={handleAcceptStale}
        onCheckUpdates={handleCheckUpdates}
        checkingUpdates={checkingUpdates}
      />

      <Snackbar
        open={!!snackMsg}
        autoHideDuration={3000}
        onClose={() => setSnackMsg("")}
        message={snackMsg}
      />
    </Box>
  );
}
