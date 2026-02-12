import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Snackbar from "@mui/material/Snackbar";
import Badge from "@mui/material/Badge";
import Tooltip from "@mui/material/Tooltip";
import CircularProgress from "@mui/material/CircularProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import FactSheetPickerDialog from "./FactSheetPickerDialog";
import CreateOnDiagramDialog from "./CreateOnDiagramDialog";
import RelationPickerDialog from "./RelationPickerDialog";
import type { EdgeEndpoints } from "./RelationPickerDialog";
import DiagramSyncPanel from "./DiagramSyncPanel";
import type {
  PendingFactSheet,
  PendingRelation,
  StaleItem,
} from "./DiagramSyncPanel";
import {
  buildFactSheetCellData,
  insertFactSheetIntoGraph,
  getVisibleCenter,
  addExpandOverlay,
  expandFactSheetGroup,
  collapseFactSheetGroup,
  refreshFactSheetOverlays,
  insertPendingFactSheet,
  stampEdgeAsRelation,
  markCellSynced,
  markEdgeSynced,
  updateCellLabel,
  removeDiagramCell,
  scanDiagramItems,
} from "./drawio-shapes";
import type { ExpandChildData } from "./drawio-shapes";
import { useMetamodel } from "@/hooks/useMetamodel";
import type { FactSheet, FactSheetType, Relation, RelationType } from "@/types";

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
    | "insertFactSheet"
    | "createFactSheet"
    | "edgeConnected";
  xml?: string;
  data?: string;
  modified?: boolean;
  x?: number;
  y?: number;
  edgeCellId?: string;
  sourceFactSheetId?: string;
  targetFactSheetId?: string;
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
          menu: any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          _cell: any,
          evt: MouseEvent,
        ) {
          origFactory.apply(this, arguments);
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

          menu.addItem("Insert Existing Fact Sheet\u2026", null, () => {
            win.parent.postMessage(
              JSON.stringify({ event: "insertFactSheet", x: gx, y: gy }),
              "*",
            );
          });

          menu.addItem("Create New Fact Sheet\u2026", null, () => {
            win.parent.postMessage(
              JSON.stringify({ event: "createFactSheet", x: gx, y: gy }),
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

          const srcFsId = src.value?.getAttribute?.("factSheetId");
          const tgtFsId = tgt.value?.getAttribute?.("factSheetId");
          const srcType = src.value?.getAttribute?.("factSheetType");
          const tgtType = tgt.value?.getAttribute?.("factSheetType");

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
                sourceFactSheetId: srcFsId,
                targetFactSheetId: tgtFsId,
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

  // Dialog states
  const [pickerOpen, setPickerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [relPickerOpen, setRelPickerOpen] = useState(false);
  const pendingEdgeRef = useRef<EdgeEndpoints | null>(null);

  // Sync panel
  const [syncOpen, setSyncOpen] = useState(false);
  const [pendingFS, setPendingFS] = useState<PendingFactSheet[]>([]);
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
  const handleToggleGroup = useCallback(
    (cellId: string, factSheetId: string, currentlyExpanded: boolean) => {
      const frame = iframeRef.current;
      if (!frame) return;

      if (currentlyExpanded) {
        collapseFactSheetGroup(frame, cellId);
        addExpandOverlay(frame, cellId, false, () =>
          handleToggleGroup(cellId, factSheetId, false),
        );
      } else {
        api
          .get<Relation[]>(`/relations?fact_sheet_id=${factSheetId}`)
          .then((rels) => {
            if (!iframeRef.current) return;
            const seen = new Set<string>();
            const children: ExpandChildData[] = [];
            for (const r of rels) {
              const other = r.source_id === factSheetId ? r.target : r.source;
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
              setSnackMsg("No related fact sheets");
              return;
            }
            children.sort((a, b) => {
              const sa = fsTypesRef.current.find((t) => t.key === a.type)?.sort_order ?? 99;
              const sb = fsTypesRef.current.find((t) => t.key === b.type)?.sort_order ?? 99;
              if (sa !== sb) return sa - sb;
              return a.name.localeCompare(b.name);
            });
            const inserted = expandFactSheetGroup(iframeRef.current, cellId, children);
            addExpandOverlay(iframeRef.current, cellId, true, () =>
              handleToggleGroup(cellId, factSheetId, true),
            );
            for (const child of inserted) {
              addExpandOverlay(iframeRef.current, child.cellId, false, () =>
                handleToggleGroup(child.cellId, child.factSheetId, false),
              );
            }
          })
          .catch(() => setSnackMsg("Failed to load relations"));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /* ---------- Insert existing fact sheet ---------- */
  const handleInsertFactSheet = useCallback(
    (fs: FactSheet, fsType: FactSheetType) => {
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

      const data = buildFactSheetCellData({
        factSheetId: fs.id,
        factSheetType: fs.type,
        name: fs.name,
        color: fsType.color,
        x,
        y,
      });

      const ok = insertFactSheetIntoGraph(frame, data);
      if (ok) {
        addExpandOverlay(frame, data.cellId, false, () =>
          handleToggleGroup(data.cellId, fs.id, false),
        );
        setSnackMsg(`Inserted "${fs.name}"`);
      } else {
        setSnackMsg("Editor not ready — try again in a moment");
      }
    },
    [handleToggleGroup],
  );

  /* ---------- Create new (pending) fact sheet ---------- */
  const handleCreateFactSheet = useCallback(
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
      const tempId = `pending-${crypto.randomUUID()}`;

      const cellId = insertPendingFactSheet(frame, {
        tempId,
        type: data.type,
        name: data.name,
        color,
        x,
        y,
      });

      if (cellId) {
        setSnackMsg(`"${data.name}" added (pending sync)`);
      }
      setCreateOpen(false);
    },
    [],
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
    },
    [],
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

  /* ---------- Sync panel helpers ---------- */
  const refreshSyncPanel = useCallback(() => {
    const frame = iframeRef.current;
    if (!frame) return;

    const { pendingFS: pfs, pendingRels: prels, syncedFS: _ } = scanDiagramItems(frame);

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
          pfs.some((f) => f.tempId === p.sourceFactSheetId && f.type === t.key),
        );
        return {
          edgeCellId: p.edgeCellId,
          relationType: p.relationType,
          relationLabel: p.relationLabel,
          sourceName: p.sourceName,
          targetName: p.targetName,
          sourceColor: srcType?.color || "#999",
          targetColor: "#999",
          sourceFactSheetId: p.sourceFactSheetId,
          targetFactSheetId: p.targetFactSheetId,
        };
      }),
    );
  }, []);

  const handleSyncFS = useCallback(
    async (cellId: string) => {
      const frame = iframeRef.current;
      if (!frame) return;
      const item = pendingFS.find((p) => p.cellId === cellId);
      if (!item) return;

      setSyncing(true);
      try {
        const scanned = scanDiagramItems(frame);
        const raw = scanned.pendingFS.find((p) => p.cellId === cellId);
        const resp = await api.post<FactSheet>("/fact-sheets", {
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
            if (rel.sourceFactSheetId === tempId || rel.targetFactSheetId === tempId) {
              // The edge endpoints are already connected to the cell — the cell's
              // factSheetId attribute was just updated, so the next scan will pick
              // up the real ID. No extra action needed.
            }
          }
        }
        setSnackMsg(`"${item.name}" pushed to inventory`);
        refreshSyncPanel();
      } catch {
        setSnackMsg("Failed to create fact sheet");
      } finally {
        setSyncing(false);
      }
    },
    [pendingFS, handleToggleGroup, refreshSyncPanel],
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
        if (rel.sourceFactSheetId.startsWith("pending-") || rel.targetFactSheetId.startsWith("pending-")) {
          setSnackMsg("Sync the connected fact sheets first");
          return;
        }

        await api.post("/relations", {
          type: rel.relationType,
          source_id: rel.sourceFactSheetId,
          target_id: rel.targetFactSheetId,
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
      // 1. Sync all pending fact sheets first
      const { pendingFS: pfs } = scanDiagramItems(frame);
      for (const p of pfs) {
        const typeInfo = fsTypesRef.current.find((t) => t.key === p.type);
        try {
          const resp = await api.post<FactSheet>("/fact-sheets", {
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
        if (r.sourceFactSheetId.startsWith("pending-") || r.targetFactSheetId.startsWith("pending-")) {
          continue; // skip if endpoints still pending
        }
        try {
          await api.post("/relations", {
            type: r.relationType,
            source_id: r.sourceFactSheetId,
            target_id: r.targetFactSheetId,
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
          const fs = await api.get<FactSheet>(`/fact-sheets/${item.factSheetId}`);
          if (fs.name !== item.name) {
            const typeInfo = fsTypesRef.current.find((t) => t.key === item.type);
            stale.push({
              cellId: item.cellId,
              factSheetId: item.factSheetId,
              diagramName: item.name,
              inventoryName: fs.name,
              typeColor: typeInfo?.color || "#999",
            });
          }
        } catch {
          // Fact sheet may have been deleted — skip
        }
      }

      setStaleItems(stale);
      if (stale.length === 0) setSnackMsg("All fact sheets are up to date");
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
          setTimeout(() => {
            if (iframeRef.current) {
              bootstrapDrawIO(iframeRef.current);
              setTimeout(() => {
                if (iframeRef.current) {
                  refreshFactSheetOverlays(iframeRef.current, handleToggleGroup);
                }
              }, 200);
            }
          }, 300);
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

        case "insertFactSheet":
          contextInsertPosRef.current = { x: msg.x ?? 100, y: msg.y ?? 100 };
          setPickerOpen(true);
          break;

        case "createFactSheet":
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
  const totalPending = pendingFS.length + pendingRels.length;

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
          <IconButton size="small" onClick={() => setSyncOpen(true)}>
            <Badge
              badgeContent={totalPending}
              color="warning"
              max={99}
              invisible={totalPending === 0}
              sx={{ "& .MuiBadge-badge": { fontSize: "0.6rem", height: 16, minWidth: 16 } }}
            >
              <MaterialSymbol icon="sync" size={20} />
            </Badge>
          </IconButton>
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
      <FactSheetPickerDialog
        open={pickerOpen}
        onClose={() => { setPickerOpen(false); contextInsertPosRef.current = null; }}
        onInsert={handleInsertFactSheet}
      />

      <CreateOnDiagramDialog
        open={createOpen}
        types={fsTypes}
        onClose={() => { setCreateOpen(false); contextInsertPosRef.current = null; }}
        onCreate={handleCreateFactSheet}
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
        pendingFS={pendingFS}
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
