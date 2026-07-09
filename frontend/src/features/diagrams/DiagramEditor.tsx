import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams, useNavigate, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Snackbar from "@mui/material/Snackbar";
import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import InsertCardsDialog from "./InsertCardsDialog";
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
  addChevronOverlay,
  expandCardGroup,
  expandCardGroupAt,
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
  attachCellLifecycleListeners,
  attachParentChangeListener,
  scanForDuplicateCells,
  collectExistingCardCellIds,
  collectExistingEdgeRelations,
  collectLiveEdgeCellIds,
  collectLiveCellIds,
  removeEdgeCellsByIds,
  describeEdgeEndpoints,
  extractCardCellIdsFromXml,
  extractEdgeRelationsFromXml,
  restoreRemovedEdge,
  revertParentChange,
  dedupClonedCell,
  unlinkCell,
  relinkCell,
  getCellLabel,
  convertShapeToPendingCard,
  convertShapeToContainer,
  drillDownInto,
  rollUpInto,
  isInsideContainer,
  findExistingCardCellId,
  getNestedCardIds,
  applyViewToGraph,
  resetViewColors,
  applyCardTypeIcons,
} from "./drawio-shapes";
import type {
  HierarchyChild,
  ParentChangeEvent,
  PendingParentChange,
  ResolvedRelationMeta,
} from "./drawio-shapes";
import type {
  ExpandChildData,
  RemovedRelationTombstone,
} from "./drawio-shapes";
import ExpandMenu from "./ExpandMenu";
import type {
  ExpandMenuPick,
  ExpandMenuTarget,
} from "./ExpandMenu";
import ViewSelector, { buildColorMap, extractCardValue } from "./ViewSelector";
import type { ColorEntry, ViewSource } from "./ViewSelector";
import DiagramViewLegend from "./DiagramViewLegend";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import { useMetamodel } from "@/hooks/useMetamodel";
import { relationLabel, useTypeLabel } from "@/hooks/useResolveLabel";
import { useAuthContext } from "@/hooks/AuthContext";
import type { Card, CardType, Relation, RelationType } from "@/types";

/* ------------------------------------------------------------------ */
/*  DrawIO configuration                                               */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _meta = import.meta as any;
const DRAWIO_BASE_URL: string =
  _meta.env?.VITE_DRAWIO_URL || "/drawio/index.html";

// Default set of enabled Draw.io "More Shapes" libraries for a user who has
// never customised them. Once a user enables "Remember this setting" in the
// More Shapes dialog, their selection is persisted to
// `user.ui_preferences.diagram_libraries` and restored here instead (see
// buildDrawioUrlParams / the `librariesChanged` message handler). We drive the
// `libs` param ourselves because the embed-mode editor re-seeds the sidebar
// from this URL param on every load, overriding Draw.io's own persistence.
export const DEFAULT_DIAGRAM_LIBS = "general;uml;c4;azure;sap";

/** Resolve the Draw.io `libs` param value from a user's remembered library
 *  list, falling back to the default set when nothing has been saved. */
export function resolveDiagramLibs(saved?: string[] | null): string {
  return saved && saved.length ? saved.join(";") : DEFAULT_DIAGRAM_LIBS;
}

function buildDrawioUrlParams(libs: string): string {
  return new URLSearchParams({
    embed: "1",
    proto: "json",
    spin: "1",
    modified: "unsavedChanges",
    saveAndExit: "1",
    noSaveBtn: "0",
    noExitBtn: "0",
    libs,
  }).toString();
}

const EMPTY_DIAGRAM =
  '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DiagramData {
  id: string;
  name: string;
  type: string;
  data: { xml?: string; thumbnail?: string; view?: ViewSource };
}


interface DrawIOMessage {
  event:
    | "init"
    | "save"
    | "exit"
    | "export"
    | "configure"
    | "librariesChanged"
    | "insertCard"
    | "createCard"
    | "edgeConnected"
    | "cardClicked"
    | "unlinkCell"
    | "relinkCell"
    | "convertCell"
    | "containerizeCell"
    | "detachCell";
  xml?: string;
  data?: string;
  libraries?: string;
  modified?: boolean;
  exit?: boolean;
  x?: number;
  y?: number;
  cardId?: string;
  cellId?: string;
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
      /* ---------- Persist "Remember this setting" shape libraries ---------- */
      // Draw.io keeps the enabled "More Shapes" libraries on window.mxSettings.
      // In embed mode it does not reliably persist them itself, so we observe
      // the enabled set and post it to the parent, which saves it to the user
      // profile and restores it via the iframe `libs` param on the next open.
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const settings = win.mxSettings as any;
        const readLibs = (): string | null => {
          try {
            const libs = settings?.getLibraries?.();
            return typeof libs === "string" ? libs : null;
          } catch {
            return null;
          }
        };
        let lastLibs = readLibs();
        const postLibs = (libs: string) => {
          win.parent.postMessage(
            JSON.stringify({ event: "librariesChanged", libraries: libs }),
            "*",
          );
        };
        // Primary: mxSettings.save() is Draw.io's "persist settings" call,
        // fired when the user ticks "Remember this setting" and clicks Apply.
        if (
          settings &&
          typeof settings.save === "function" &&
          !settings.__turboLibsHooked
        ) {
          settings.__turboLibsHooked = true;
          const origSave = settings.save;
          settings.save = function (...args: unknown[]) {
            const r = origSave.apply(this, args);
            const libs = readLibs();
            if (libs != null && libs !== lastLibs) {
              lastLibs = libs;
              postLibs(libs);
            }
            return r;
          };
        }
        // Fallback: poll the enabled set for embed builds where save() is a
        // no-op. Cheap string compare; auto-stops after 10 minutes.
        const pollId = win.setInterval(() => {
          const libs = readLibs();
          if (libs != null && libs !== lastLibs) {
            lastLibs = libs;
            postLibs(libs);
          }
        }, 3000);
        win.setTimeout(() => win.clearInterval(pollId), 600000);
      } catch {
        // mxSettings unavailable — non-fatal.
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = ui.editor as any;
      const graph = editor?.graph;
      if (graph) {
        win.__turboGraph = graph;
        // Make sure mxGraph re-parents card cells when the user drops
        // them onto a swimlane container. DrawIO loads with defaults
        // that don't always enable this — without it, drag-into-
        // container has no effect on the model and our parent-change
        // listener never fires.
        try {
          graph.swimlaneNesting = true;
          graph.dropEnabled = true;
          // IMPORTANT: extendParents must stay OFF on move, otherwise
          // mxGraph silently grows the container to follow any cell
          // dragged toward its edge — which defeats the position-based
          // drag-out safety net (the cell stays "inside" the now-
          // bigger parent). drillDownInto / rollUpInto already size
          // their containers up-front to fit the children they insert,
          // so we don't need extendParents for that path either.
          if (typeof graph.setExtendParents === "function") {
            graph.setExtendParents(false);
          }
          if (typeof graph.setExtendParentsOnAdd === "function") {
            // Programmatic adds (drillDownInto / rollUpInto) call
            // graph.resizeCell themselves, so leave this OFF as well
            // to keep the container's bounds stable.
            graph.setExtendParentsOnAdd(false);
          }
          // Force-enable drag-out-of-parent. DrawIO's default
          // mxGraphHandler.shouldRemoveCellsFromParent returns false for
          // edges and is sometimes overridden to false outright, which
          // means dragging a child OUT of a swimlane just translates it
          // without re-parenting — no model change, no listener fire.
          // We restore the documented mxGraph default: when the drop
          // lands outside the parent's bounding box, the cell is
          // re-parented to the graph's default parent.
          if (graph.graphHandler) {
            graph.graphHandler.removeCellsFromParent = true;
            graph.graphHandler.shouldRemoveCellsFromParent = function (
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              parent: any,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              _cells: any[],
              evt: MouseEvent,
            ) {
              if (!parent || !this.graph.getModel().isVertex(parent)) return false;
              const pState = this.graph.view.getState(parent);
              if (!pState) return false;
              const pt = win.mxUtils.convertPoint(
                this.graph.container,
                win.mxEvent.getClientX(evt),
                win.mxEvent.getClientY(evt),
              );
              return !win.mxUtils.contains(pState, pt.x, pt.y);
            };
          }
        } catch {
          // Defensive: some DrawIO versions don't expose every setter.
        }
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
          cell: any,
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

          // If the right-click landed on (or inside) a card cell, surface
          // the card-details shortcut. Walk up so clicks on inner labels
          // still resolve to the card.
          let cardCell = cell;
          while (cardCell && !cardCell.value?.getAttribute?.("cardId")) {
            cardCell = cardCell.parent;
          }
          const cardId = cardCell?.value?.getAttribute?.("cardId");
          const isPending = cardCell?.value?.getAttribute?.("pending") === "1";
          const isSyncedCard = !!cardId && !isPending && !cardId.startsWith("pending-");
          const isVertex = cell && !cell.edge;
          const hasNoCardId = isVertex && !cardId;

          // Only synced cards can be looked up in the inventory \u2014 pending
          // cells reference a temp id that the backend doesn't know about.
          if (isSyncedCard) {
            menu.addItem("View Card Details\u2026", null, () => {
              win.parent.postMessage(
                JSON.stringify({ event: "cardClicked", cardId }),
                "*",
              );
            });
          }
          if (isSyncedCard && cardCell) {
            menu.addItem("Change Linked Card\u2026", null, () => {
              win.parent.postMessage(
                JSON.stringify({ event: "relinkCell", cellId: cardCell.id }),
                "*",
              );
            });
            menu.addItem("Unlink Card", null, () => {
              win.parent.postMessage(
                JSON.stringify({ event: "unlinkCell", cellId: cardCell.id }),
                "*",
              );
            });
            // Move-out-of-container: only show when this cell is
            // currently nested inside another vertex (i.e. lives in a
            // drilled-down / rolled-up container). DrawIO drag-out
            // detection is unreliable so this is a guaranteed UX path
            // to fire the detach confirmation dialog.
            const parent = cardCell.parent;
            const parentIsContainer =
              parent &&
              parent.value?.getAttribute &&
              parent !== graph.getDefaultParent() &&
              typeof parent.getId === "function" &&
              parent.getId() !== "0" &&
              parent.getId() !== "1";
            if (parentIsContainer) {
              menu.addItem("Move out of container", null, () => {
                win.parent.postMessage(
                  JSON.stringify({ event: "detachCell", cellId: cardCell.id }),
                  "*",
                );
              });
            }
          }
          if (hasNoCardId && cell) {
            menu.addItem("Link to Existing Card\u2026", null, () => {
              win.parent.postMessage(
                JSON.stringify({ event: "relinkCell", cellId: cell.id }),
                "*",
              );
            });
            menu.addItem("Convert to Card\u2026", null, () => {
              win.parent.postMessage(
                JSON.stringify({ event: "convertCell", cellId: cell.id }),
                "*",
              );
            });
            menu.addItem("Convert to Container", null, () => {
              win.parent.postMessage(
                JSON.stringify({ event: "containerizeCell", cellId: cell.id }),
                "*",
              );
            });
          }
          if (isSyncedCard && cardCell) {
            menu.addItem("Convert to Container", null, () => {
              win.parent.postMessage(
                JSON.stringify({ event: "containerizeCell", cellId: cardCell.id }),
                "*",
              );
            });
          }
          if (cardId || hasNoCardId) menu.addSeparator();

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
  const { t, i18n } = useTranslation(["diagrams", "common"]);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, refreshUser } = useAuthContext();
  // Build the Draw.io `libs` param ONCE at mount from the user's remembered
  // libraries. Deliberately a lazy initial state (not reactive): persisting a
  // change calls refreshUser(), which mutates `user.ui_preferences` — if the
  // iframe `src` tracked that, the editor would reload mid-session. The freshly
  // saved value is picked up on the next editor open instead.
  const [libsParam] = useState(() =>
    resolveDiagramLibs(user?.ui_preferences?.diagram_libraries),
  );
  // Last value we persisted (or loaded), to skip redundant PATCHes when the
  // `librariesChanged` watcher re-fires with an unchanged set.
  const lastPersistedLibsRef = useRef<string>(libsParam);
  const canManage = useMemo(() => {
    const perms = user?.permissions;
    if (!perms) return false;
    return !!perms["*"] || !!perms["diagrams.manage"];
  }, [user?.permissions]);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [diagram, setDiagram] = useState<DiagramData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [snackMsg, setSnackMsg] = useState("");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  // Metamodel
  const { types: fsTypes, relationTypes } = useMetamodel();
  const typeLabel = useTypeLabel();
  const fsTypesRef = useRef(fsTypes);
  fsTypesRef.current = fsTypes;
  const relTypesRef = useRef(relationTypes);
  relTypesRef.current = relationTypes;

  // Refs
  const pendingSaveXmlRef = useRef<string | null>(null);
  // DrawIO's "Save & Exit" button fires a `save` event with `exit: true` (not an
  // `exit` event). Remember the request across the async save → export chain so we
  // can navigate away once the diagram is persisted.
  const exitAfterSaveRef = useRef(false);
  const contextInsertPosRef = useRef<{ x: number; y: number } | null>(null);

  // Expand/collapse caches — survive collapse/expand cycles so locally
  // deleted children don't reappear.
  const expandCacheRef = useRef<Map<string, ExpandChildData[]>>(new Map());
  const deletedChildrenRef = useRef<Map<string, Set<string>>>(new Map());

  // Set of cellIds we deliberately inserted ourselves. Drives the
  // copy/paste dedup: anything in the model with a cardId attribute but a
  // cellId we don't recognise must have come in via DrawIO's clipboard.
  const registeredCellIdsRef = useRef<Set<string>>(new Set());
  const registerCellId = useCallback((cellId: string) => {
    registeredCellIdsRef.current.add(cellId);
  }, []);

  // Set true while we're INTENTIONALLY re-parenting cells in code
  // (rollUpInto, drillDownInto, etc.). The diff-based parent-change
  // listener can't tell our own model.add() apart from a user drag,
  // so we explicitly suppress it during these helpers — otherwise
  // every roll-up would prompt "Add «card» as a child of «container»?"
  // for the cell we just re-parented into the new container ourselves.
  const suppressHierarchyEventsRef = useRef(false);

  /** Run an mxGraph mutation while suppressing the parent-change
   *  dialog. Clears the suppression on the next tick so the safety-net
   *  mouseup diff (which uses setTimeout(0)) still sees it. */
  const withSuppressedHierarchy = useCallback(
    <T,>(fn: () => T): T => {
      suppressHierarchyEventsRef.current = true;
      try {
        return fn();
      } finally {
        // 50 ms is conservative — long enough to cover the mouseup
        // safety net and any deferred re-emission, short enough that a
        // real drag immediately after a programmatic re-parent isn't
        // missed.
        window.setTimeout(() => {
          suppressHierarchyEventsRef.current = false;
        }, 50);
      }
    },
    [],
  );
  const edgeRelationMapRef = useRef<Map<string, ResolvedRelationMeta>>(
    new Map(),
  );
  const registerEdgeRelation = useCallback(
    (edgeCellId: string, meta: ResolvedRelationMeta) => {
      edgeRelationMapRef.current.set(edgeCellId, meta);
    },
    [],
  );

  // Dialog states
  const [pickerOpen, setPickerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [relPickerOpen, setRelPickerOpen] = useState(false);
  const pendingEdgeRef = useRef<EdgeEndpoints | null>(null);
  // Attributes captured in the relation picker for not-yet-synced edges.
  // Keyed by edgeCellId, drained by handleSyncRel on backend creation.
  const pendingEdgeAttributesRef = useRef<Map<string, Record<string, unknown>>>(new Map());

  // Sync panel
  const [syncOpen, setSyncOpen] = useState(false);
  const [pendingCards, setPendingFS] = useState<PendingCard[]>([]);
  const [pendingRels, setPendingRels] = useState<PendingRelation[]>([]);
  const [staleItems, setStaleItems] = useState<StaleItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);

  // Relation-deletion tombstones — populated when the user removes a
  // synced relation edge on the canvas. Sync All issues DELETE /relations/{id}
  // for each entry. Card-cell removals are intentionally NOT tombstoned:
  // removing a card from the diagram is treated as a visual-only "I don't
  // want to see this here" gesture; archival happens from the Inventory page.
  const [pendingRelRemovals, setPendingRelRemovals] = useState<RemovedRelationTombstone[]>([]);

  // Phase 2 context-menu actions
  const [relinkTargetCellId, setRelinkTargetCellId] = useState<string | null>(null);
  const [convertTargetCellId, setConvertTargetCellId] = useState<string | null>(null);
  const [convertPrefillName, setConvertPrefillName] = useState<string>("");

  // Phase 3 — chevron expand menu
  const [expandMenuTarget, setExpandMenuTarget] = useState<ExpandMenuTarget | null>(null);

  // Relation-deletion confirmation queue. Each canvas-side edge removal
  // that carries a real relationId surfaces a "delete from inventory?"
  // dialog. Confirming queues the tombstone for the next sync; cancelling
  // re-inserts the edge in place via restoreRemovedEdge.
  const [deleteRelationQueue, setDeleteRelationQueue] = useState<
    RemovedRelationTombstone[]
  >([]);

  // Parent-change confirmation queue. Each time the user drags a card
  // INTO a container of the same card type (or OUT of one) we surface a
  // dialog so the user can confirm whether to persist the hierarchy
  // change to the backend. Confirming queues a `parent_id` PATCH for the
  // next Sync All; cancelling reverts the cell to its old parent.
  const [parentChangeQueue, setParentChangeQueue] = useState<
    PendingParentChange[]
  >([]);
  const [pendingParentChanges, setPendingParentChanges] = useState<
    PendingParentChange[]
  >([]);

  // Phase 5 — view perspectives (color cells by attribute)
  const [view, setView] = useState<ViewSource>({ kind: "card_type" });
  const [viewLegendEntries, setViewLegendEntries] = useState<ColorEntry[]>([]);
  const [viewAppliedCount, setViewAppliedCount] = useState(0);
  const [activeTypeKeys, setActiveTypeKeys] = useState<string[]>([]);

  // Local autosave restore prompt
  const [restoreBanner, setRestoreBanner] = useState<{ xml: string; savedAt: string } | null>(null);
  const restoreCheckedRef = useRef(false);
  // True while DrawIO is mid-replace from a restored draft. CELLS_REMOVED
  // fires for every cell on the old canvas during this window — we must
  // not file tombstones for them; the user didn't ask to delete anything.
  const restoreInProgressRef = useRef(false);

  /* ---------- Load diagram ---------- */
  useEffect(() => {
    if (!id) return;
    api
      .get<DiagramData>(`/diagrams/${id}`)
      .then((d) => {
        setDiagram(d);
        if (d.data?.view) setView(d.data.view);
        // Check for a newer locally-autosaved draft once per mount.
        if (!restoreCheckedRef.current) {
          restoreCheckedRef.current = true;
          try {
            const raw = localStorage.getItem(`turbo-ea-diagram-draft-${id}`);
            if (raw) {
              const draft = JSON.parse(raw) as { xml: string; savedAt: string };
              // Only prompt when the autosave is non-trivially different from
              // what's already persisted on the server.
              if (draft.xml && draft.xml !== d.data?.xml) {
                setRestoreBanner({ xml: draft.xml, savedAt: draft.savedAt });
              } else {
                localStorage.removeItem(`turbo-ea-diagram-draft-${id}`);
              }
            }
          } catch {
            // Corrupt JSON — ignore
          }
        }
      })
      .catch(() => setSnackMsg(t("editor.errors.loadFailed")))
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
          data: {
            ...diagram.data,
            xml,
            ...(thumbnail ? { thumbnail } : {}),
            view,
          },
        };
        await api.patch(`/diagrams/${diagram.id}`, payload);
        setDiagram((prev) =>
          prev
            ? {
                ...prev,
                data: {
                  ...prev.data,
                  xml,
                  ...(thumbnail ? { thumbnail } : {}),
                  view,
                },
              }
            : prev,
        );
        // Persisted on the server — drop the local autosave snapshot so we
        // don't keep prompting to restore an older draft on reload.
        try {
          localStorage.removeItem(`turbo-ea-diagram-draft-${diagram.id}`);
        } catch {
          // localStorage may be disabled — non-fatal.
        }
        setSnackMsg(t("editor.saved"));
      } catch {
        setSnackMsg(t("editor.errors.saveFailed"));
      } finally {
        setSaving(false);
      }
    },
    [diagram, view],
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
        setSnackMsg(t("editor.noRelatedCards"));
        return;
      }

      const inserted = expandCardGroup(frame, cellId, visible);
      addExpandOverlay(frame, cellId, true, () =>
        handleCollapseGroup(cellId, cardId),
      );
      // If some children were locally removed, show resync icon
      if (deleted?.size) {
        addResyncOverlay(frame, cellId, () =>
          handleResync(cellId, cardId),
        );
      }
      // Each newly-inserted child gets its own chevron so the user can
      // recursively explore the dependency graph from any node.
      for (const child of inserted) {
        addChevronOverlay(frame, child.cellId, (anchor) =>
          openExpandMenu(child.cellId, child.cardId, anchor),
        );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** Collapse an expanded card group; called from the minus overlay. */
  const handleCollapseGroup = useCallback(
    (cellId: string, cardId: string) => {
      const frame = iframeRef.current;
      if (!frame) return;

      // Before collapsing, detect children the user removed while expanded.
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

      const { removedCellIds } = collapseCardGroup(frame, cellId);
      // Scrub the side-table for every cellId we just intentionally
      // removed. Otherwise the diff-based edge-deletion detector would
      // fire a "Delete the relation?" dialog for every connecting edge
      // that disappeared as part of the collapse.
      for (const id of removedCellIds) {
        edgeRelationMapRef.current.delete(id);
        registeredCellIdsRef.current.delete(id);
      }
      // Switch back to chevron so the user can pick a different relation
      // type or direction for the next expansion.
      addChevronOverlay(frame, cellId, (anchor) =>
        openExpandMenu(cellId, cardId, anchor),
      );
      if (deletedChildrenRef.current.get(cellId)?.size) {
        addResyncOverlay(frame, cellId, () => handleResync(cellId, cardId));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** Backwards-compatible signature still passed around as `handleToggleGroup`
   *  so callers that ask "expand from a fresh state" keep working. New code
   *  should use the chevron overlay route which opens the ExpandMenu. */
  const handleToggleGroup = useCallback(
    (cellId: string, cardId: string, currentlyExpanded: boolean) => {
      if (currentlyExpanded) {
        handleCollapseGroup(cellId, cardId);
        return;
      }
      // Default expand falls back to "all relations" — used by the
      // resync path. Newly-inserted cells get the chevron instead so the
      // user always sees the per-relation-type picker first.
      const frame = iframeRef.current;
      if (!frame) return;
      const cached = expandCacheRef.current.get(cellId);
      if (cached) {
        doExpand(frame, cellId, cardId, cached);
        return;
      }
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
            const ct = fsTypesRef.current.find((tp) => tp.key === other.type);
            children.push({
              id: other.id,
              name: other.name,
              type: other.type,
              color: ct?.color || "#999",
              icon: ct?.icon,
              relationType: r.type,
              relationId: r.id,
            });
          }
          if (children.length === 0) {
            setSnackMsg(t("editor.noRelatedCards"));
            return;
          }
          children.sort((a, b) => {
            const sa = fsTypesRef.current.find((tp) => tp.key === a.type)?.sort_order ?? 99;
            const sb = fsTypesRef.current.find((tp) => tp.key === b.type)?.sort_order ?? 99;
            if (sa !== sb) return sa - sb;
            return a.name.localeCompare(b.name);
          });
          expandCacheRef.current.set(cellId, children);
          doExpand(iframeRef.current!, cellId, cardId, children);
        })
        .catch(() => setSnackMsg(t("editor.errors.loadRelationsFailed")));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doExpand, handleCollapseGroup],
  );

  /** Open the per-relation-type ExpandMenu for a card. Snapshots the
   *  set of cards already nested as visual children of this cell so the
   *  Drill-Down section can mark them as "already in container" — that
   *  lets the user spot which hierarchy children are missing and only
   *  selects those for re-insertion. */
  const openExpandMenu = useCallback(
    (cellId: string, cardId: string, anchor: { x: number; y: number }) => {
      const frame = iframeRef.current;
      const nestedCardIds = frame ? getNestedCardIds(frame, cellId) : undefined;
      setExpandMenuTarget({ cellId, cardId, anchor, nestedCardIds });
    },
    [],
  );

  /** Wired to the chevron overlay on every collapsed synced cell. */
  const handleChevron = useCallback(
    (cellId: string, cardId: string, anchor: { x: number; y: number }) => {
      openExpandMenu(cellId, cardId, anchor);
    },
    [openExpandMenu],
  );

  /** Map a hierarchy reference to the metamodel-derived colour we use for
   *  drill-down / roll-up child cells. */
  const colorForType = useCallback((typeKey: string): string => {
    return fsTypesRef.current.find((tp) => tp.key === typeKey)?.color || "#999";
  }, []);

  /** Card-type icon name for drill-down / roll-up child cells. */
  const iconForType = useCallback((typeKey: string): string | undefined => {
    return fsTypesRef.current.find((tp) => tp.key === typeKey)?.icon;
  }, []);

  /** Resolve a relation-type key (e.g. "appUsesItc") to its human-readable
   *  label (e.g. "uses") for the delete-confirmation dialog. Falls back
   *  to the raw key when the metamodel hasn't loaded yet. */
  const humanRelationLabel = useCallback(
    (relationTypeKey: string): string => {
      if (!relationTypeKey) return "";
      const rt = relTypesRef.current.find((x) => x.key === relationTypeKey);
      return rt ? relationLabel(rt, i18n.language) : relationTypeKey;
    },
    [i18n.language],
  );

  /** Handle a commit from the ExpandMenu. Three branches:
   *    - show     : pick one or many relation types; insert matching
   *                 neighbours to the right of the current card.
   *    - drill_down: turn the current cell into a swimlane container with
   *                  the picked hierarchy children inside.
   *    - roll_up  : wrap the current cell + picked siblings inside a new
   *                 parent container.
   */
  const handleExpandPick = useCallback(
    async (pick: ExpandMenuPick, target: ExpandMenuTarget) => {
      const frame = iframeRef.current;
      if (!frame) return;

      if (pick.mode === "show") {
        // Multi-select Show Dependency: load relations for each picked
        // (type, direction) pair, dedupe by neighbour, and skip any
        // neighbour that's already on the canvas (inserting a second
        // cell with the same cardId would trigger our dedup logic and
        // unlink one of them).
        try {
          const seen = new Set<string>();
          const children: ExpandChildData[] = [];
          let skippedAlreadyPresent = 0;
          for (const entry of pick.entries) {
            const params = new URLSearchParams({
              card_id: target.cardId,
              type: entry.relation_type_key,
            });
            const rels = await api.get<Relation[]>(`/relations?${params}`);
            for (const r of rels) {
              const isOutgoing = r.source_id === target.cardId;
              if (entry.direction === "outgoing" && !isOutgoing) continue;
              if (entry.direction === "incoming" && isOutgoing) continue;
              const other = isOutgoing ? r.target : r.source;
              if (!other || seen.has(other.id)) continue;
              seen.add(other.id);
              if (findExistingCardCellId(frame, other.id)) {
                skippedAlreadyPresent += 1;
                continue;
              }
              children.push({
                id: other.id,
                name: other.name,
                type: other.type,
                color: colorForType(other.type),
                icon: iconForType(other.type),
                relationType: r.type,
                relationId: r.id,
              });
            }
          }
          if (children.length === 0) {
            setSnackMsg(
              skippedAlreadyPresent > 0
                ? t("editor.allNeighboursAlreadyOnCanvas")
                : t("editor.noRelatedCards"),
            );
            return;
          }
          children.sort((a, b) => a.name.localeCompare(b.name));
          const inserted = expandCardGroupAt(frame, target.cellId, children, "right");
          addExpandOverlay(frame, target.cellId, true, () =>
            handleCollapseGroup(target.cellId, target.cardId),
          );
          // Seed the side-table immediately — DrawIO sometimes drops the
          // edge's user-object attributes after the open transaction
          // closes, so this is the authoritative source for the
          // CELLS_REMOVED → confirm-dialog path.
          const sourceName = getCellLabel(frame, target.cellId);
          // Build a cardId → display name map for the children we just
          // inserted so we don't have to walk the graph again on delete.
          const childNameById = new Map(children.map((c) => [c.id, c.name]));
          for (const child of inserted) {
            registerCellId(child.cellId);
            if (child.edgeCellId && child.relationId) {
              // Snapshot the live edge state so a future delete +
              // restore puts the edge back with the same colour and
              // label. Show-Dependency edges have label="" so the
              // restored edge won't grow phantom text either.
              const live = describeEdgeEndpoints(frame, child.edgeCellId);
              const humanLabel = humanRelationLabel(child.relationType || "");
              registerEdgeRelation(child.edgeCellId, {
                relationId: child.relationId,
                relationType: child.relationType || "",
                relationLabel: humanLabel,
                sourceName,
                targetName: childNameById.get(child.cardId) || "",
                sourceCellId: target.cellId,
                targetCellId: child.cellId,
                style: live.style,
                edgeLabel: live.label,
              });
            }
            addChevronOverlay(frame, child.cellId, (anchor) =>
              openExpandMenu(child.cellId, child.cardId, anchor),
            );
          }
          if (skippedAlreadyPresent > 0) {
            setSnackMsg(
              t("editor.someNeighboursSkipped", { count: skippedAlreadyPresent }),
            );
          }
        } catch {
          setSnackMsg(t("editor.errors.loadRelationsFailed"));
        }
        return;
      }

      if (pick.mode === "drill_down") {
        // Drill-Down is append-aware: re-drilling on a cell that's
        // already a container backfills any children the user previously
        // removed. The ExpandMenu has already filtered out children
        // currently nested inside (via target.nestedCardIds). We still
        // filter top-level duplicates here: dropping a second copy of
        // the same cardId at the canvas root would trigger our dedup.
        const nestedInContainer =
          target.nestedCardIds ?? new Set<string>();
        const onCanvasTopLevel = new Set<string>(
          pick.children
            .filter((c) => {
              if (nestedInContainer.has(c.id)) return false;
              return !!findExistingCardCellId(frame, c.id);
            })
            .map((c) => c.id),
        );
        const hChildren: HierarchyChild[] = pick.children
          .filter(
            (c) => !nestedInContainer.has(c.id) && !onCanvasTopLevel.has(c.id),
          )
          .map((c) => ({
            id: c.id,
            name: c.name,
            type: c.type,
            color: colorForType(c.type),
            icon: iconForType(c.type),
          }));
        if (hChildren.length === 0) {
          setSnackMsg(t("editor.allChildrenAlreadyOnCanvas"));
          return;
        }
        // drillDownInto re-parents nothing (children are fresh
        // first-sight cells), but we wrap anyway so any future move
        // hooks DrawIO adds don't surprise us.
        const inserted = withSuppressedHierarchy(() =>
          drillDownInto(frame, target.cellId, hChildren),
        );
        if (inserted.length === 0) {
          setSnackMsg(t("editor.noChildren"));
          return;
        }
        for (const child of inserted) {
          registerCellId(child.cellId);
          // Each inner child gets its own chevron so the user can keep
          // exploring downward from the container.
          addChevronOverlay(frame, child.cellId, (anchor) =>
            openExpandMenu(child.cellId, child.cardId, anchor),
          );
        }
        return;
      }

      if (pick.mode === "roll_up") {
        // Guard 1: the cell already lives inside a container — rolling
        // up would create a second parent container on top of the
        // existing one. Block + explain.
        if (isInsideContainer(frame, target.cellId)) {
          setSnackMsg(t("editor.alreadyRolledUp"));
          return;
        }
        // Guard 2: the picked parent is already on the canvas as a
        // top-level card. Creating a fresh container with the same
        // cardId would either (a) cause our paste-dedup to fire and
        // unlink one of them, or (b) leave the user with two cells
        // claiming the same backend card. Block + tell the user to
        // delete the existing parent cell first.
        if (findExistingCardCellId(frame, pick.parent.id)) {
          setSnackMsg(t("editor.parentAlreadyOnCanvas"));
          return;
        }
        const parentColor = colorForType(pick.parent.type);
        // Partition the parent's children into two buckets:
        //   - already on the canvas as a top-level cell → RE-PARENT the
        //     existing cell into the new container (keeps its identity so
        //     dedup stays happy, and no duplicate cell is created).
        //   - not on the canvas AND explicitly checked → INSERT a fresh cell.
        // Everything else (not on canvas, not checked) is skipped — this is
        // what makes "Roll up to parent only" wrap just the current card plus
        // whatever siblings are already drawn, without pulling in the rest of
        // the parent's children.
        const selectedIds = new Set(pick.siblings.map((s) => s.id));
        const siblings: Array<{
          cellId: string | null;
          card: {
            id: string;
            name: string;
            type: string;
            color: string;
            icon?: string;
          };
        }> = [];
        for (const s of pick.allSiblings) {
          const existingId = findExistingCardCellId(frame, s.id);
          const card = {
            id: s.id,
            name: s.name,
            type: s.type,
            color: colorForType(s.type),
            icon: iconForType(s.type),
          };
          if (existingId) {
            // Only re-parent top-level cells. A sibling already nested in
            // another container is left where it is — moving it would
            // double-nest and trip the dedup scan.
            if (isInsideContainer(frame, existingId)) continue;
            siblings.push({ cellId: existingId, card });
          } else if (selectedIds.has(s.id)) {
            siblings.push({ cellId: null, card });
          }
        }
        // Roll-up re-parents the current cell into the new container.
        // Suppress the parent-change dialog so we don't prompt the user
        // to confirm an operation they just explicitly requested.
        const result = withSuppressedHierarchy(() =>
          rollUpInto(
            frame,
            target.cellId,
            {
              id: pick.parent.id,
              name: pick.parent.name,
              type: pick.parent.type,
              color: parentColor,
            },
            siblings,
          ),
        );
        if (!result) {
          setSnackMsg(t("editor.errors.editorNotReady"));
          return;
        }
        registerCellId(result.parentCellId);
        // The container itself can still be drilled / rolled — chevron on
        // the header.
        addChevronOverlay(frame, result.parentCellId, (anchor) =>
          openExpandMenu(result.parentCellId, pick.parent.id, anchor),
        );
        for (const child of result.insertedSiblings) {
          registerCellId(child.cellId);
          addChevronOverlay(frame, child.cellId, (anchor) =>
            openExpandMenu(child.cellId, child.cardId, anchor),
          );
        }
      }
    },
    [t, handleCollapseGroup, colorForType, registerCellId],
  );

  /** Clear local caches and re-fetch relations from inventory. */
  const handleResync = useCallback(
    (cellId: string, cardId: string) => {
      const frame = iframeRef.current;
      if (!frame) return;

      // Clear caches
      expandCacheRef.current.delete(cellId);
      deletedChildrenRef.current.delete(cellId);

      // Collapse first if currently expanded — also scrub the side-
      // table so the diff scan doesn't tombstone the edges we just
      // intentionally removed.
      const { removedCellIds } = collapseCardGroup(frame, cellId);
      for (const id of removedCellIds) {
        edgeRelationMapRef.current.delete(id);
        registeredCellIdsRef.current.delete(id);
      }

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
            const ct = fsTypesRef.current.find((tp) => tp.key === other.type);
            children.push({
              id: other.id,
              name: other.name,
              type: other.type,
              color: ct?.color || "#999",
              icon: ct?.icon,
              relationType: r.type,
              relationId: r.id,
            });
          }
          if (children.length === 0) {
            addExpandOverlay(iframeRef.current!, cellId, false, () =>
              handleToggleGroup(cellId, cardId, false),
            );
            setSnackMsg(t("editor.noRelatedCards"));
            return;
          }
          children.sort((a, b) => {
            const sa = fsTypesRef.current.find((tp) => tp.key === a.type)?.sort_order ?? 99;
            const sb = fsTypesRef.current.find((tp) => tp.key === b.type)?.sort_order ?? 99;
            if (sa !== sb) return sa - sb;
            return a.name.localeCompare(b.name);
          });
          expandCacheRef.current.set(cellId, children);
          doExpand(iframeRef.current!, cellId, cardId, children);
          setSnackMsg(t("editor.relationsRestored"));
        })
        .catch(() => setSnackMsg(t("editor.errors.resyncFailed")));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doExpand],
  );

  /* ---------- Cell lifecycle (dedup paste + tombstone deletes) ---------- */

  const lifecycleAttachedRef = useRef(false);
  const lifecycleScanIdRef = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (lifecycleScanIdRef.current != null) {
        window.clearInterval(lifecycleScanIdRef.current);
        lifecycleScanIdRef.current = null;
      }
    };
  }, []);

  const handleDuplicate = useCallback(
    (cellId: string, sharedCardId: string, wasPending: boolean) => {
      const frame = iframeRef.current;
      if (!frame) return;
      // Defer one tick so mxGraph finishes its transaction before we mutate.
      setTimeout(() => {
        // Re-check the registered set: the synchronous CELLS_ADDED listener
        // fires *during* the helper's beginUpdate/endUpdate transaction, but
        // callers like handleInsertCard only call registerCellId AFTER the
        // helper returns. So a brand-new card looks "unregistered" for a
        // single microtask and would be silently unlinked here if we didn't
        // check again now that the queue is drained.
        if (registeredCellIdsRef.current.has(cellId)) return;
        // Restore-from-draft replaces the canvas in a single
        // transaction — CELLS_ADDED fires for every restored cell. Even
        // with pre-seeding, edge cases (cell renames, mxGraph collision
        // re-numbering) can leave a few cellIds out of the registered
        // set. Suppressing dedup during the restore window means the
        // post-load re-seed gets the chance to fix things up before any
        // dedup runs.
        if (restoreInProgressRef.current) return;
        const result = dedupClonedCell(frame, cellId, wasPending);
        if (!result) return;
        if (result.mode === "regenerated") {
          setSnackMsg(t("editor.duplicate.pendingRegen"));
        } else {
          setSnackMsg(t("editor.duplicate.unlinked"));
        }
        // sharedCardId is intentionally not surfaced to the user — the snackbar
        // covers the user-facing explanation.
        void sharedCardId;
        refreshSyncPanel();
      }, 0);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleTombstones = useCallback(
    (tombstones: RemovedRelationTombstone[]) => {
      if (tombstones.length === 0) return;
      // Restore-from-draft replaces the canvas, which fires
      // CELLS_REMOVED for every previously-loaded edge. Those aren't
      // user-initiated deletes — swallow them.
      if (restoreInProgressRef.current) return;
      // Relations get the explicit confirmation step. The dialog lets
      // the user abort (re-insert the edge) before the relation is
      // touched in inventory.
      setDeleteRelationQueue((prev) => {
        const next = [...prev];
        for (const t of tombstones) {
          if (!next.some((existing) => existing.edgeCellId === t.edgeCellId)) {
            next.push(t);
          }
        }
        return next;
      });
    },
    [],
  );

  /** Listener entry point — fires whenever a card cell's parent
   *  changes in mxGraph. Decides whether to surface a confirm dialog
   *  (same-type re-parent) or silently revert (cross-type drop). */
  const handleParentChanged = useCallback((ev: ParentChangeEvent) => {
    if (suppressHierarchyEventsRef.current) return;
    if (restoreInProgressRef.current) return;
    // Pending cells don't have a real cardId yet — we can't PATCH them,
    // and re-parenting their visual cell is harmless. Ignore so the
    // user can re-arrange in-flight cards freely.
    if (!ev.cardId || ev.cardId.startsWith("pending-")) return;

    // Determine "into" vs "out of".
    const attachingTo = ev.newParentCardId;
    const detachingFrom = ev.oldParentCardId;
    // No-op when the move stayed at the graph root or shuffled between
    // non-card parents.
    if (!attachingTo && !detachingFrom) return;

    if (attachingTo) {
      // Cross-type drops snap back silently. This matches the backend's
      // strict same-type parent_id contract: we'd just get a 4xx
      // anyway, and the user usually drops by accident.
      if (ev.newParentType && ev.newParentType !== ev.cardType) {
        const frame = iframeRef.current;
        if (frame) {
          // Suppress so the revert itself doesn't re-fire the dialog.
          withSuppressedHierarchy(() =>
            revertParentChange(frame, ev.cellId, ev.oldParentCellId, ev.oldGeometry),
          );
        }
        setSnackMsg(t("editor.errors.parentTypeMismatch"));
        return;
      }
      // Same-type attach — queue the confirmation.
      setParentChangeQueue((prev) => [
        ...prev,
        {
          kind: "attach",
          cellId: ev.cellId,
          cardId: ev.cardId!,
          cardName: ev.cardName,
          cardType: ev.cardType,
          parentCardId: attachingTo,
          parentCardName: ev.newParentName,
          oldParentCellId: ev.oldParentCellId,
          oldGeometry: ev.oldGeometry,
        },
      ]);
      return;
    }

    // Detaching: child moved out of a card-shaped container back to
    // the graph root. Only meaningful when the OLD parent was a card
    // of the same type (mirrors the attach gate).
    if (detachingFrom && ev.oldParentType === ev.cardType) {
      setParentChangeQueue((prev) => [
        ...prev,
        {
          kind: "detach",
          cellId: ev.cellId,
          cardId: ev.cardId!,
          cardName: ev.cardName,
          cardType: ev.cardType,
          parentCardId: detachingFrom,
          parentCardName: ev.oldParentName,
          oldParentCellId: ev.oldParentCellId,
          oldGeometry: ev.oldGeometry,
        },
      ]);
    }
  }, [t, withSuppressedHierarchy]);

  /** Confirm: persist the hierarchy change at the next Sync All. */
  const handleConfirmParentChange = useCallback(() => {
    setParentChangeQueue((prev) => {
      if (prev.length === 0) return prev;
      const [head, ...rest] = prev;
      setPendingParentChanges((curr) => {
        // Dedup by cellId so successive drag-into / drag-out gestures
        // on the same cell don't pile up — keep the latest decision.
        const filtered = curr.filter((c) => c.cellId !== head.cellId);
        return [...filtered, head];
      });
      return rest;
    });
  }, []);

  /** Cancel: revert the mxGraph parent change so the cell goes back. */
  const handleCancelParentChange = useCallback(() => {
    setParentChangeQueue((prev) => {
      if (prev.length === 0) return prev;
      const [head, ...rest] = prev;
      const frame = iframeRef.current;
      if (frame) {
        // Suppress so the diff listener doesn't fire the dialog for
        // our own corrective re-parent.
        withSuppressedHierarchy(() =>
          revertParentChange(
            frame,
            head.cellId,
            head.oldParentCellId,
            head.oldGeometry,
          ),
        );
      }
      return rest;
    });
  }, [withSuppressedHierarchy]);

  /** Drop a single hierarchy change from the Sync drawer (user
   *  decides they don't want to PATCH after all). */
  const handleDiscardParentChange = useCallback((cellId: string) => {
    setPendingParentChanges((prev) => prev.filter((p) => p.cellId !== cellId));
  }, []);

  /** "Yes, also delete from inventory" — drop the relation into the
   *  pending-deletions bucket so Sync All fires DELETE /relations/{id}. */
  const handleConfirmDeleteRelation = useCallback(() => {
    setDeleteRelationQueue((prev) => {
      if (prev.length === 0) return prev;
      const [head, ...rest] = prev;
      setPendingRelRemovals((curr) =>
        curr.some((c) => c.edgeCellId === head.edgeCellId) ? curr : [...curr, head],
      );
      return rest;
    });
  }, []);

  /** "No, abort" — re-insert the edge in place and forget the tombstone.
   *  Also re-populates the side-table so the next deletion of the same
   *  edge still fires the confirmation dialog. */
  const handleCancelDeleteRelation = useCallback(() => {
    setDeleteRelationQueue((prev) => {
      if (prev.length === 0) return prev;
      const [head, ...rest] = prev;
      const frame = iframeRef.current;
      if (frame) {
        const ok = restoreRemovedEdge(frame, head);
        if (!ok) {
          // Endpoints no longer exist on the canvas — we can't put the
          // edge back. Tell the user; the relation stays in inventory
          // either way because we never queued the tombstone.
          setSnackMsg(t("editor.errors.restoreEdgeFailed"));
        } else {
          // Edge is back — re-register so the next delete is caught
          // again. We deliberately drop it from the side-table in the
          // diff scan to avoid re-firing the dialog every tick.
          registerEdgeRelation(head.edgeCellId, {
            relationId: head.relationId,
            relationType: head.relationType,
            relationLabel: head.relationLabel,
            sourceName: head.sourceName,
            targetName: head.targetName,
            sourceCellId: head.sourceCellId,
            targetCellId: head.targetCellId,
            style: head.style,
            edgeLabel: head.edgeLabel,
          });
        }
      }
      return rest;
    });
  }, [t, registerEdgeRelation]);

  const attachLifecycleListenersOnce = useCallback(
    (frame: HTMLIFrameElement) => {
      if (lifecycleAttachedRef.current) return;
      lifecycleAttachedRef.current = true;
      // Seed the registered-cells set from whatever was in the saved XML —
      // those cells are NOT pastes even though we didn't insert them this
      // session.
      for (const id of collectExistingCardCellIds(frame)) {
        registeredCellIdsRef.current.add(id);
      }
      // Seed the edge → relation side-table from saved diagrams that
      // carry relationId on their XML user-objects. Without this, deleting
      // an edge that was already on the canvas at load time would fall
      // through both the user-object check (mxGraph drops the attribute
      // on some round-trips) and the side-table.
      for (const meta of collectExistingEdgeRelations(frame)) {
        edgeRelationMapRef.current.set(meta.edgeCellId, {
          relationId: meta.relationId,
          relationType: meta.relationType,
          // Resolve via the metamodel so the dialog shows "uses"
          // rather than the raw relation-type key like "appUsesItc".
          relationLabel: humanRelationLabel(meta.relationType) || meta.relationLabel,
          sourceName: "",
          targetName: "",
        });
      }
      attachCellLifecycleListeners(frame, {
        onDuplicate: handleDuplicate,
        onRemoved: handleTombstones,
        isRegistered: (cellId) => registeredCellIdsRef.current.has(cellId),
        getRelationIdForEdge: (cellId) =>
          edgeRelationMapRef.current.get(cellId) ?? null,
        // Card-removal-with-edges: the edge's confirm dialog is
        // suppressed, but we still need to clean the side-table so
        // the diff scan doesn't fire a phantom tombstone 750ms later.
        onIncidentalEdgeRemoval: (edgeCellId) => {
          edgeRelationMapRef.current.delete(edgeCellId);
        },
      });
      // Parent-change listener: catches drag-into-container /
      // drag-out-of-container gestures and routes them through the
      // hierarchy confirm dialog + Sync drawer.
      attachParentChangeListener(frame, handleParentChanged);
      // Safety-net periodic scan. Does two things:
      //   (1) Detect cells inserted via DrawIO clipboard paths that don't
      //       surface through CELLS_ADDED to our listener.
      //   (2) Diff the edge → relation side-table against the live graph:
      //       any registered edge that's no longer in the model has been
      //       deleted. We don't trust mxGraph's CELLS_REMOVED to fire
      //       reliably for every deletion path DrawIO exposes (keyboard
      //       Delete, right-click Delete, edge tool, …), so this diff
      //       is the authoritative source for the confirm-dialog queue.
      const scanId = window.setInterval(() => {
        const f = iframeRef.current;
        if (!f) return;
        if (restoreInProgressRef.current) return;
        scanForDuplicateCells(
          f,
          (cellId) => registeredCellIdsRef.current.has(cellId),
          handleDuplicate,
        );
        // ── Cascade-remove dangling RELATION edges ──
        // When a card is deleted, DrawIO leaves connected
        // relation-edges dangling — visually present but pointing
        // at a vertex no longer in the model. Detect them via the
        // side-table (so hand-drawn arrows / loose lines that are
        // NOT registered relations are left untouched) and drop them
        // silently. Side-table entries are deleted BEFORE the
        // edge-deletion diff runs so the "delete this relation?"
        // modal doesn't fire for these incidental removals.
        const liveAllCellIds = collectLiveCellIds(f);
        const cascadeEdgeIds: string[] = [];
        edgeRelationMapRef.current.forEach((meta, edgeCellId) => {
          const srcGone =
            !!meta.sourceCellId && !liveAllCellIds.has(meta.sourceCellId);
          const tgtGone =
            !!meta.targetCellId && !liveAllCellIds.has(meta.targetCellId);
          if (srcGone || tgtGone) cascadeEdgeIds.push(edgeCellId);
        });
        if (cascadeEdgeIds.length > 0) {
          // Drop side-table FIRST so the diff below can't see them.
          for (const id of cascadeEdgeIds) {
            edgeRelationMapRef.current.delete(id);
          }
          removeEdgeCellsByIds(f, cascadeEdgeIds);
        }
        // ── Edge-deletion diff ──
        const liveEdgeIds = collectLiveEdgeCellIds(f);
        // Collect ids to remove + corresponding tombstones so we don't
        // mutate the Map while iterating.
        const removed: Array<{ edgeCellId: string; meta: ResolvedRelationMeta }> = [];
        edgeRelationMapRef.current.forEach((meta, edgeCellId) => {
          if (!liveEdgeIds.has(edgeCellId)) {
            removed.push({ edgeCellId, meta });
          }
        });
        if (removed.length === 0) return;
        for (const { edgeCellId } of removed) {
          edgeRelationMapRef.current.delete(edgeCellId);
        }
        // Fire tombstones through the same handler as the live listener
        // so the existing dedup-by-edgeCellId logic keeps working.
        handleTombstones(
          removed.map(({ edgeCellId, meta }) => ({
            kind: "relation" as const,
            edgeCellId,
            relationId: meta.relationId,
            relationType: meta.relationType,
            relationLabel: meta.relationLabel,
            sourceName: meta.sourceName,
            targetName: meta.targetName,
            sourceCellId: meta.sourceCellId ?? null,
            targetCellId: meta.targetCellId ?? null,
            style: meta.style ?? "",
            edgeLabel: meta.edgeLabel,
          })),
        );
      }, 750);
      // Stash the interval id on the ref so we never start two.
      lifecycleScanIdRef.current = scanId;
    },
    [handleDuplicate, handleTombstones, handleParentChanged],
  );

  /* ---------- Insert existing card(s) ---------- */
  const handleInsertCard = useCallback(
    (cards: Card[], cardTypeKeysByCardId: Map<string, CardType>) => {
      const frame = iframeRef.current;
      if (!frame || cards.length === 0) return;

      // Relink mode: rewrite the target cell instead of inserting new ones.
      // The dialog opens in mode="single" so we only ever see one card here.
      if (relinkTargetCellId) {
        const card = cards[0];
        const ct = cardTypeKeysByCardId.get(card.id);
        if (!ct) {
          setRelinkTargetCellId(null);
          return;
        }
        const ok = relinkCell(frame, relinkTargetCellId, {
          cardId: card.id,
          cardType: card.type,
          name: card.name,
          color: ct.color,
          icon: ct.icon,
        });
        if (ok) {
          const targetCellId = relinkTargetCellId;
          // Register so the periodic dedup-scan doesn't treat this newly
          // linked cell as a paste.
          registerCellId(targetCellId);
          addChevronOverlay(frame, targetCellId, (anchor) =>
            openExpandMenu(targetCellId, card.id, anchor),
          );
          setSnackMsg(t("editor.linkedTo", { name: card.name }));
        } else {
          setSnackMsg(t("editor.errors.editorNotReady"));
        }
        setRelinkTargetCellId(null);
        return;
      }

      // Multi-card insert: lay them out in a grid centered on the insertion
      // point so they don't overlap. The 4-cell-wide grid mirrors LeanIX's
      // "Insert selected" behaviour for batches.
      let baseX: number;
      let baseY: number;
      if (contextInsertPosRef.current) {
        baseX = contextInsertPosRef.current.x;
        baseY = contextInsertPosRef.current.y;
        contextInsertPosRef.current = null;
      } else {
        const center = getVisibleCenter(frame);
        baseX = center ? center.x - 90 : 100;
        baseY = center ? center.y - 30 : 100;
      }

      const cols = Math.min(4, cards.length);
      const cellW = 230;
      const cellH = 80;
      let insertedCount = 0;
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        const ct = cardTypeKeysByCardId.get(c.id);
        if (!ct) continue;
        const x = baseX + (i % cols) * cellW;
        const y = baseY + Math.floor(i / cols) * cellH;
        const data = buildCardCellData({
          cardId: c.id,
          cardType: c.type,
          name: c.name,
          color: ct.color,
          icon: ct.icon,
          x,
          y,
        });
        const ok = insertCardIntoGraph(frame, data);
        if (ok) {
          const insertedCellId = data.cellId;
          const insertedCardId = c.id;
          registerCellId(insertedCellId);
          addChevronOverlay(frame, insertedCellId, (anchor) =>
            openExpandMenu(insertedCellId, insertedCardId, anchor),
          );
          insertedCount += 1;
        }
      }
      if (insertedCount === 0) {
        setSnackMsg(t("editor.errors.editorNotReady"));
      } else if (insertedCount === 1) {
        setSnackMsg(t("editor.inserted", { name: cards[0].name }));
      } else {
        setSnackMsg(t("editor.insertedMany", { count: insertedCount }));
      }
    },
    [handleToggleGroup, relinkTargetCellId],
  );

  /* ---------- Unlink / Convert handlers (Phase 2) ---------- */

  const handleUnlinkRequest = useCallback(
    (cellId: string) => {
      const frame = iframeRef.current;
      if (!frame) return;
      const previousId = unlinkCell(frame, cellId);
      if (previousId) {
        setSnackMsg(t("editor.unlinked"));
        refreshSyncPanel();
      }
    },
    // refreshSyncPanel is a stable useCallback; declared later in the file —
    // ESLint warns about exhaustive deps but TS would also block referencing
    // it here before its declaration line, so we capture it via closure only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  );

  const handleRelinkRequest = useCallback((cellId: string) => {
    setRelinkTargetCellId(cellId);
    setPickerOpen(true);
  }, []);

  const handleConvertRequest = useCallback((cellId: string) => {
    const frame = iframeRef.current;
    if (!frame) return;
    const label = getCellLabel(frame, cellId);
    setConvertTargetCellId(cellId);
    setConvertPrefillName(label);
    setCreateOpen(true);
  }, []);

  /** Right-click → Move out of container. Force-detaches a nested
   *  child cell from its swimlane parent back to the canvas root.
   *  Guarantees the detach flow even when DrawIO's drag pipeline
   *  swallows the parent change.
   *
   *  We DON'T suppress the parent-change listener here — we WANT it
   *  to fire so the user gets the "Detach from parent?" confirmation
   *  dialog and the resulting parent_id PATCH gets queued.
   *
   *  Critically, we ALSO strip the `drillDownChild` / `rollUpChild`
   *  markers before the re-parent. Those markers cause the diff
   *  listener's `isManaged` filter to suppress the parent-change
   *  event entirely, so without this the cell would move visually
   *  but no dialog would open and no PATCH would queue. */
  const handleDetachRequest = useCallback((cellId: string) => {
    const frame = iframeRef.current;
    if (!frame) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = frame.contentWindow as any;
    const graph = win?.__turboGraph;
    if (!graph) return;
    const model = graph.getModel();
    const cell = model.getCell(cellId);
    if (!cell) return;
    const parent = cell.parent;
    if (!parent || parent === graph.getDefaultParent()) return;
    // Move the cell to absolute coordinates of its current visual
    // position so it stays where the user sees it after re-parenting.
    const cellGeo = cell.getGeometry();
    const parentGeo = parent.getGeometry();
    model.beginUpdate();
    try {
      // Strip management markers — the user has just promoted this
      // cell to a stand-alone card, so the container no longer owns
      // it. Without this clear, the listener's isManaged filter
      // silently swallows the parent-change event.
      const value = cell.value;
      if (value?.removeAttribute) {
        value.removeAttribute("drillDownChild");
        value.removeAttribute("rollUpChild");
      }
      if (cellGeo && parentGeo) {
        const newGeo = new win.mxGeometry(
          (parentGeo.x ?? 0) + (cellGeo.x ?? 0) + 40, // slight offset
          (parentGeo.y ?? 0) + (cellGeo.y ?? 0) + 40,
          cellGeo.width,
          cellGeo.height,
        );
        model.setGeometry(cell, newGeo);
      }
      model.add(graph.getDefaultParent(), cell);
    } finally {
      model.endUpdate();
    }
  }, []);

  /** Right-click → Convert to Container. Restyles the picked cell as a
   *  swimlane container so other cards can be dragged into it. The
   *  parent-change listener picks up subsequent drops and prompts to
   *  persist them as `parent_id` updates. */
  const handleContainerizeRequest = useCallback(
    (cellId: string) => {
      const frame = iframeRef.current;
      if (!frame) return;
      const ok = convertShapeToContainer(frame, cellId, t("editor.container.defaultName"));
      if (ok) {
        setSnackMsg(t("editor.containerized"));
      } else {
        setSnackMsg(t("editor.errors.editorNotReady"));
      }
    },
    [t],
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
          typeLabel: typeLabel(typeInfo) || p.type,
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
  }, [typeLabel]);

  /* ---------- Create new (pending) card ---------- */
  const handleCreateCard = useCallback(
    (data: { type: string; name: string; description?: string }) => {
      const frame = iframeRef.current;
      if (!frame) return;

      const typeInfo = fsTypesRef.current.find((t) => t.key === data.type);
      const color = typeInfo?.color || "#999";
      const tempId = `pending-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

      // Convert mode: replace an existing plain shape rather than create a
      // new one. Keeps the user's geometry intact so the shape they laid out
      // becomes the card.
      if (convertTargetCellId) {
        const ok = convertShapeToPendingCard(frame, convertTargetCellId, {
          tempId,
          type: data.type,
          name: data.name,
          color,
          icon: typeInfo?.icon,
        });
        if (ok) {
          // The shape was previously a plain DrawIO vertex with no cardId,
          // so the periodic dedup scan ignored it. Now that it owns a temp
          // cardId we must register it so paste-detection doesn't fire.
          registerCellId(convertTargetCellId);
          setSnackMsg(t("editor.convertedPending", { name: data.name }));
          refreshSyncPanel();
        }
        setConvertTargetCellId(null);
        setConvertPrefillName("");
        setCreateOpen(false);
        return;
      }

      let x: number, y: number;
      if (contextInsertPosRef.current) {
        ({ x, y } = contextInsertPosRef.current);
        contextInsertPosRef.current = null;
      } else {
        const center = getVisibleCenter(frame);
        x = center ? center.x - 90 : 100;
        y = center ? center.y - 30 : 100;
      }

      const cellId = insertPendingCard(frame, {
        tempId,
        type: data.type,
        name: data.name,
        color,
        icon: typeInfo?.icon,
        x,
        y,
      });

      if (cellId) {
        registerCellId(cellId);
        setSnackMsg(t("editor.addedPending", { name: data.name }));
        refreshSyncPanel();
      }
      setCreateOpen(false);
    },
    [refreshSyncPanel, convertTargetCellId],
  );

  /* ---------- Relation picker result ---------- */
  const handleRelationPicked = useCallback(
    (
      relType: RelationType,
      direction: "as-is" | "reversed",
      attributes?: Record<string, unknown>,
    ) => {
      const frame = iframeRef.current;
      const ep = pendingEdgeRef.current;
      if (!frame || !ep) return;

      const color = direction === "as-is" ? ep.sourceColor : ep.targetColor;

      stampEdgeAsRelation(frame, ep.edgeCellId, relType.key, relType.label, color, true);

      if (attributes && Object.keys(attributes).length > 0) {
        pendingEdgeAttributesRef.current.set(ep.edgeCellId, attributes);
      } else {
        pendingEdgeAttributesRef.current.delete(ep.edgeCellId);
      }

      setRelPickerOpen(false);
      pendingEdgeRef.current = null;
      setSnackMsg(t("editor.relationAddedPending", { label: relType.label }));
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
      pendingEdgeAttributesRef.current.delete(ep.edgeCellId);
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
        // Attach chevron now that it has a real ID and the per-relation
        // expand menu can resolve its neighbours.
        addChevronOverlay(frame, cellId, (anchor) =>
          openExpandMenu(cellId, resp.id, anchor),
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
        setSnackMsg(t("editor.pushedToInventory", { name: item.name }));
        refreshSyncPanel();
      } catch {
        setSnackMsg(t("editor.errors.createCardFailed"));
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
          setSnackMsg(t("editor.errors.syncCardsFirst"));
          return;
        }

        const stashedAttrs = pendingEdgeAttributesRef.current.get(edgeCellId);
        const payload: Record<string, unknown> = {
          type: rel.relationType,
          source_id: rel.sourceCardId,
          target_id: rel.targetCardId,
        };
        if (stashedAttrs && Object.keys(stashedAttrs).length > 0) {
          payload.attributes = stashedAttrs;
        }
        const created = await api.post<Relation>("/relations", payload);
        pendingEdgeAttributesRef.current.delete(edgeCellId);

        markEdgeSynced(frame, edgeCellId, "#666", created.id);
        // Mirror the new relation into the side-table so a later canvas
        // delete still reaches the confirm dialog. The endpoint cellIds,
        // live style and visible label come from the cell so the
        // abort-deletion path can re-insert the edge identically.
        const endpoints = describeEdgeEndpoints(frame, edgeCellId);
        registerEdgeRelation(edgeCellId, {
          relationId: created.id,
          relationType: rel.relationType,
          relationLabel: humanRelationLabel(rel.relationType) || rel.relationLabel,
          sourceName: rel.sourceName,
          targetName: rel.targetName,
          sourceCellId: endpoints.sourceCellId,
          targetCellId: endpoints.targetCellId,
          style: endpoints.style,
          edgeLabel: endpoints.label,
        });
        setSnackMsg(t("editor.relationPushed", { label: rel.relationLabel }));
        refreshSyncPanel();
      } catch {
        setSnackMsg(t("editor.errors.createRelationFailed"));
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
          const insertedCellId = p.cellId;
          const insertedCardId = resp.id;
          addChevronOverlay(frame, insertedCellId, (anchor) =>
            openExpandMenu(insertedCellId, insertedCardId, anchor),
          );
        } catch {
          setSnackMsg(t("editor.errors.syncFailed", { name: p.name }));
        }
      }

      // 2. Sync all pending relations
      const { pendingRels: prels } = scanDiagramItems(frame);
      for (const r of prels) {
        if (r.sourceCardId.startsWith("pending-") || r.targetCardId.startsWith("pending-")) {
          continue; // skip if endpoints still pending
        }
        try {
          const created = await api.post<Relation>("/relations", {
            type: r.relationType,
            source_id: r.sourceCardId,
            target_id: r.targetCardId,
          });
          markEdgeSynced(frame, r.edgeCellId, "#666", created.id);
          const endpoints = describeEdgeEndpoints(frame, r.edgeCellId);
          registerEdgeRelation(r.edgeCellId, {
            relationId: created.id,
            relationType: r.relationType,
            relationLabel: humanRelationLabel(r.relationType) || r.relationLabel,
            sourceName: r.sourceName,
            targetName: r.targetName,
            sourceCellId: endpoints.sourceCellId,
            targetCellId: endpoints.targetCellId,
            style: endpoints.style,
            edgeLabel: endpoints.label,
          });
        } catch {
          setSnackMsg(t("editor.errors.syncRelationFailed", { label: r.relationLabel }));
        }
      }

      // 3. Process relation deletions (canvas edges that were removed)
      const relRemovals = pendingRelRemovals;
      for (const r of relRemovals) {
        try {
          await api.delete(`/relations/${r.relationId}`);
        } catch {
          setSnackMsg(t("editor.errors.deleteRelationFailed", { label: r.relationLabel }));
        }
      }
      if (relRemovals.length > 0) setPendingRelRemovals([]);

      // 4. Process hierarchy changes (drag-into / drag-out of containers).
      // For `attach`, parent_id becomes the target parent's cardId.
      // For `detach`, parent_id becomes null (root card).
      const parentChanges = pendingParentChanges;
      for (const p of parentChanges) {
        try {
          await api.patch(`/cards/${p.cardId}`, {
            parent_id: p.kind === "attach" ? p.parentCardId : null,
          });
        } catch {
          setSnackMsg(
            t("editor.errors.hierarchyPatchFailed", { name: p.cardName }),
          );
        }
      }
      if (parentChanges.length > 0) setPendingParentChanges([]);

      refreshSyncPanel();
      setSnackMsg(t("editor.syncComplete"));
    } finally {
      setSyncing(false);
    }
  }, [
    handleToggleGroup,
    refreshSyncPanel,
    pendingRelRemovals,
    pendingParentChanges,
  ]);

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

  /** Discard a tombstoned relation removal — keep the relation in
   *  inventory AND restore the edge on the canvas. Without the restore
   *  the user is left with a relation in the backend but no visual on
   *  the diagram, which is confusing. Also re-registers the edge in the
   *  side-table so the next deletion attempt still hits the dialog. */
  const handleDiscardRelRemoval = useCallback(
    (edgeCellId: string) => {
      const target = pendingRelRemovals.find((r) => r.edgeCellId === edgeCellId);
      setPendingRelRemovals((prev) => prev.filter((r) => r.edgeCellId !== edgeCellId));
      if (!target) return;
      const frame = iframeRef.current;
      if (!frame) return;
      const ok = restoreRemovedEdge(frame, target);
      if (ok) {
        registerEdgeRelation(target.edgeCellId, {
          relationId: target.relationId,
          relationType: target.relationType,
          relationLabel: target.relationLabel,
          sourceName: target.sourceName,
          targetName: target.targetName,
          sourceCellId: target.sourceCellId,
          targetCellId: target.targetCellId,
          style: target.style,
          edgeLabel: target.edgeLabel,
        });
        setSnackMsg(t("editor.edgeRestored"));
      } else {
        // Endpoints disappeared too — relation stays in inventory but
        // we can't put the edge back.
        setSnackMsg(t("editor.errors.restoreEdgeFailed"));
      }
    },
    [pendingRelRemovals, registerEdgeRelation, t],
  );

  /** Sync a single relation deletion immediately. */
  const handleSyncRelRemoval = useCallback(
    async (edgeCellId: string) => {
      const target = pendingRelRemovals.find((r) => r.edgeCellId === edgeCellId);
      if (!target) return;
      setSyncing(true);
      try {
        await api.delete(`/relations/${target.relationId}`);
        setPendingRelRemovals((prev) => prev.filter((r) => r.edgeCellId !== edgeCellId));
        setSnackMsg(t("editor.relationDeleted", { label: target.relationLabel }));
      } catch {
        setSnackMsg(t("editor.errors.deleteRelationFailed", { label: target.relationLabel }));
      } finally {
        setSyncing(false);
      }
    },
    [pendingRelRemovals, t],
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
      if (stale.length === 0) setSnackMsg(t("editor.allUpToDate"));
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
      setSnackMsg(t("editor.updatedTo", { name: item.inventoryName }));
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
                  refreshCardOverlays(
                    iframeRef.current,
                    handleCollapseGroup,
                    handleChevron,
                  );
                  attachLifecycleListenersOnce(iframeRef.current);
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
            // "Save & Exit" arrives as a `save` event carrying `exit: true`.
            exitAfterSaveRef.current = !!msg.exit;
            postToDrawIO({ action: "export", format: "svg", spinKey: "saving" });
            postToDrawIO({ action: "status", messageKey: "allChangesSaved", modified: false });
          }
          break;

        case "export":
          if (pendingSaveXmlRef.current) {
            const xml = pendingSaveXmlRef.current;
            pendingSaveXmlRef.current = null;
            const shouldExit = exitAfterSaveRef.current;
            exitAfterSaveRef.current = false;
            saveDiagram(xml, msg.data).then(() => {
              if (shouldExit) navigate(`/diagrams/${id}`);
            });
          }
          break;

        case "exit":
          if (msg.modified && msg.xml) {
            saveDiagram(msg.xml).then(() => navigate(`/diagrams/${id}`));
          } else {
            navigate(`/diagrams/${id}`);
          }
          break;

        case "librariesChanged":
          if (typeof msg.libraries === "string") {
            const libs = msg.libraries;
            // Skip redundant writes when the watcher re-fires unchanged.
            if (libs !== lastPersistedLibsRef.current) {
              lastPersistedLibsRef.current = libs;
              api
                .patch("/users/me/ui-preferences", {
                  diagram_libraries: libs.split(";").filter(Boolean),
                })
                .then(() => refreshUser())
                .catch(() => {
                  // Best-effort — don't disrupt editing if the save fails.
                });
            }
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

        case "cardClicked":
          if (msg.cardId) setSelectedCardId(msg.cardId);
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

        case "unlinkCell":
          if (msg.cellId) handleUnlinkRequest(msg.cellId);
          break;

        case "relinkCell":
          if (msg.cellId) handleRelinkRequest(msg.cellId);
          break;

        case "convertCell":
          if (msg.cellId) handleConvertRequest(msg.cellId);
          break;

        case "containerizeCell":
          if (msg.cellId) handleContainerizeRequest(msg.cellId);
          break;

        case "detachCell":
          if (msg.cellId) handleDetachRequest(msg.cellId);
          break;

        default:
          break;
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [
    diagram,
    postToDrawIO,
    saveDiagram,
    navigate,
    handleToggleGroup,
    handleUnlinkRequest,
    handleRelinkRequest,
    handleConvertRequest,
    handleContainerizeRequest,
    handleDetachRequest,
    refreshUser,
  ]);

  // Refresh sync panel counts whenever it opens
  useEffect(() => {
    if (syncOpen) refreshSyncPanel();
  }, [syncOpen, refreshSyncPanel]);

  /* ---------- Derived ---------- */
  const totalPending =
    pendingCards.length +
    pendingRels.length +
    pendingRelRemovals.length +
    pendingParentChanges.length;

  /** Sync one queued hierarchy change (PATCH /cards/{id} parent_id). */
  const handleSyncParentChange = useCallback(
    async (cellId: string) => {
      const target = pendingParentChanges.find((p) => p.cellId === cellId);
      if (!target) return;
      setSyncing(true);
      try {
        await api.patch(`/cards/${target.cardId}`, {
          parent_id: target.kind === "attach" ? target.parentCardId : null,
        });
        setPendingParentChanges((prev) => prev.filter((p) => p.cellId !== cellId));
        setSnackMsg(
          target.kind === "attach"
            ? t("editor.parentChange.attachSynced", {
                child: target.cardName,
                parent: target.parentCardName,
              })
            : t("editor.parentChange.detachSynced", {
                child: target.cardName,
              }),
        );
      } catch {
        setSnackMsg(
          t("editor.errors.hierarchyPatchFailed", { name: target.cardName }),
        );
      } finally {
        setSyncing(false);
      }
    },
    [pendingParentChanges, t],
  );

  /* ---------- Warn on unload when there are unsynced changes ---------- */
  useEffect(() => {
    if (totalPending === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers ignore the message but still display a generic
      // confirmation dialog when returnValue is set.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [totalPending]);

  /* ---------- Local autosave of the in-flight XML ---------- */
  useEffect(() => {
    if (!id) return;
    const intervalId = window.setInterval(() => {
      const frame = iframeRef.current;
      if (!frame) return;
      // Pull current XML from DrawIO via its event-driven export — but for a
      // lightweight autosave we just read the serialised model directly via
      // mxGraph's codec. This avoids round-tripping through postMessage.
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const win = frame.contentWindow as any;
        if (!win?.__turboGraph || !win.mxUtils || !win.mxCodec) return;
        const enc = new win.mxCodec();
        const node = enc.encode(win.__turboGraph.getModel());
        const xml = win.mxUtils.getXml(node);
        if (!xml) return;
        const draft = { xml, savedAt: new Date().toISOString() };
        localStorage.setItem(`turbo-ea-diagram-draft-${id}`, JSON.stringify(draft));
      } catch {
        // Editor not ready — try next tick
      }
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, [id]);

  /* ---------- Phase 5 — apply view perspective to the canvas ---------- */

  /** Snapshot the synced card cells so we know which ids to fetch + recolor. */
  const collectCanvasCards = useCallback(():
    | { ids: string[]; types: Set<string> }
    | null => {
    const frame = iframeRef.current;
    if (!frame) return null;
    const { syncedFS } = scanDiagramItems(frame);
    return {
      ids: syncedFS.map((c) => c.cardId),
      types: new Set(syncedFS.map((c) => c.type)),
    };
  }, []);

  /** Recompute and apply the active view to the canvas. Pulls a batch
   *  card payload via /cards?ids=... so a single round-trip recolors
   *  every cell. */
  const applyView = useCallback(async () => {
    const frame = iframeRef.current;
    if (!frame) return;
    const snapshot = collectCanvasCards();
    if (!snapshot) return;
    setActiveTypeKeys(Array.from(snapshot.types));

    if (view.kind === "card_type") {
      // Reset to per-type colours, then drop the legend.
      const colorByType = new Map(
        fsTypesRef.current.map((tp) => [tp.key, tp.color] as const),
      );
      const touched = resetViewColors(frame, colorByType, "#999");
      setViewLegendEntries([]);
      setViewAppliedCount(touched);
      return;
    }

    if (snapshot.ids.length === 0) {
      setViewLegendEntries(Array.from(buildColorMap(view, fsTypesRef.current).values()));
      setViewAppliedCount(0);
      return;
    }

    try {
      const params = new URLSearchParams({ ids: snapshot.ids.join(",") });
      const resp = await api.get<{ items: Card[] }>(`/cards?${params.toString()}`);
      const cardById = new Map(resp.items.map((c) => [c.id, c] as const));
      const colorMap = buildColorMap(view, fsTypesRef.current);
      const colorByCardId = new Map<string, string>();
      let coverable = 0;
      for (const id of snapshot.ids) {
        const c = cardById.get(id);
        if (!c) continue;
        const value = extractCardValue(view, c);
        if (value == null) continue;
        const entry = colorMap.get(value);
        if (!entry) continue;
        colorByCardId.set(id, entry.color);
        coverable += 1;
      }
      const touched = applyViewToGraph(frame, colorByCardId, "#cbd5e1");
      setViewLegendEntries(Array.from(colorMap.values()));
      // Show how many cells the user can see colored vs total — helps debug
      // when a field isn't populated on most cards.
      setViewAppliedCount(coverable > 0 ? coverable : touched);
    } catch {
      setSnackMsg(t("editor.errors.applyViewFailed"));
    }
  }, [view, collectCanvasCards, t]);

  // Overflow ("More") menu for occasional / migration actions that don't
  // warrant a permanent toolbar button.
  const [moreMenuAnchor, setMoreMenuAnchor] = useState<null | HTMLElement>(null);

  /** Upgrade cards already on the canvas with their card-type icon. Lets users
   *  add icons to diagrams created before the icon feature existed. */
  const handleApplyIcons = useCallback(() => {
    setMoreMenuAnchor(null);
    const frame = iframeRef.current;
    if (!frame) return;
    const iconByType = new Map<string, string>(
      fsTypesRef.current
        .filter((tp) => tp.icon)
        .map((tp) => [tp.key, tp.icon] as const),
    );
    const touched = applyCardTypeIcons(frame, iconByType);
    setSnackMsg(
      touched > 0
        ? t("editor.toolbar.iconsApplied", { count: touched })
        : t("editor.toolbar.iconsNoneToApply"),
    );
  }, [t]);

  // Re-apply the view whenever the user picks a new perspective or the
  // diagram object changes (xml loaded / saved). Synced-cell additions
  // also trigger re-application via syncOpen / refreshSyncPanel hooks.
  useEffect(() => {
    if (!diagram) return;
    void applyView();
  }, [diagram, view, applyView]);

  /* ---------- Restore banner: replace the XML with the locally-saved draft ---------- */
  const acceptRestore = useCallback(() => {
    if (!restoreBanner) return;
    // First: wipe stale state from the previous canvas. Otherwise the
    // periodic edge-deletion diff scan would compare the draft's live
    // edges against a side-table still carrying entries from the
    // canvas-being-replaced, see those entries as "missing", and fire
    // false "Delete this relation?" dialogs with empty endpoint names
    // (their source/target cells have already been removed).
    registeredCellIdsRef.current.clear();
    edgeRelationMapRef.current.clear();
    setPendingRelRemovals([]);
    setDeleteRelationQueue([]);
    // Pre-seed the registered-cells set + edge → relation side-table
    // from the draft XML BEFORE handing it to DrawIO. Without this, the
    // synchronous CELLS_ADDED events fired by the load would see the
    // restored cards as "unregistered" and silently dedupe them into
    // grey unlinked stubs.
    for (const id of extractCardCellIdsFromXml(restoreBanner.xml)) {
      registeredCellIdsRef.current.add(id);
    }
    for (const meta of extractEdgeRelationsFromXml(restoreBanner.xml)) {
      edgeRelationMapRef.current.set(meta.edgeCellId, {
        relationId: meta.relationId,
        relationType: meta.relationType,
        // Resolve to the metamodel's human label so the eventual
        // delete-confirm dialog says "uses" rather than the raw key.
        relationLabel: humanRelationLabel(meta.relationType) || meta.relationLabel,
        sourceName: "",
        targetName: "",
      });
    }
    // Suppress tombstones + dedup during the load — DrawIO will fire
    // CELLS_REMOVED for every old cell as it replaces the canvas, and
    // those aren't user-initiated deletes.
    restoreInProgressRef.current = true;
    postToDrawIO({ action: "load", xml: restoreBanner.xml, autosave: 0 });
    // 400 ms gives DrawIO enough time to complete the swap on slow
    // browsers while keeping the suppression tight enough that a real
    // user deletion right after won't be missed. After the window
    // closes we re-seed from the LIVE model — pre-seed from the XML
    // is best-effort, this is the authoritative pass.
    window.setTimeout(() => {
      const f = iframeRef.current;
      if (f) {
        for (const id of collectExistingCardCellIds(f)) {
          registeredCellIdsRef.current.add(id);
        }
        for (const meta of collectExistingEdgeRelations(f)) {
          if (!edgeRelationMapRef.current.has(meta.edgeCellId)) {
            edgeRelationMapRef.current.set(meta.edgeCellId, {
              relationId: meta.relationId,
              relationType: meta.relationType,
              relationLabel:
                humanRelationLabel(meta.relationType) || meta.relationLabel,
              sourceName: "",
              targetName: "",
            });
          }
        }
        // Re-attach chevron + collapse overlays. DrawIO's load action
        // replaces the canvas, so the overlays we hung off the previous
        // cells are gone — without this re-attach the user has no way
        // to expand any card in the restored diagram.
        refreshCardOverlays(f, handleCollapseGroup, handleChevron);
      }
      restoreInProgressRef.current = false;
    }, 400);
    setRestoreBanner(null);
    setSnackMsg(t("editor.restored"));
    // handleCollapseGroup + handleChevron are stable useCallbacks; we'd
    // include them here but doing so creates a forward-ref cycle in TS
    // because acceptRestore is declared earlier in the function body.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreBanner, postToDrawIO, t]);

  const dismissRestore = useCallback(() => {
    if (id) localStorage.removeItem(`turbo-ea-diagram-draft-${id}`);
    setRestoreBanner(null);
  }, [id]);

  /* ---------- Render ---------- */
  if (!canManage) {
    return <Navigate to={`/diagrams/${id ?? ""}`} replace />;
  }
  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (!diagram) return <Typography color="error">{t("editor.notFound")}</Typography>;

  const iframeSrc = `${DRAWIO_BASE_URL}?${buildDrawioUrlParams(libsParam)}`;

  return (
    <Box
      sx={{
        // Dynamic viewport height (Safari 15.4+, Chrome, Firefox); falls back
        // to `vh` on older browsers via @supports. `100vh` on iPad Safari
        // returns the larger layout-viewport size while the URL bar is
        // visible, so the editor extended past the visible area and the
        // toolbar drifted out of reach. `dvh` tracks the actual visible
        // viewport, which keeps the toolbar inside it.
        height: "calc(100vh - 64px)",
        "@supports (height: 100dvh)": {
          height: "calc(100dvh - 64px)",
        },
        m: -3,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Toolbar */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1,
          py: 0.5,
          borderBottom: "1px solid",
          borderColor: "divider",
          minHeight: 48,
        }}
      >
        <IconButton size="small" onClick={() => navigate(`/diagrams/${id}`)}>
          <MaterialSymbol icon="arrow_back" size={20} />
        </IconButton>
        <Typography variant="subtitle1" fontWeight={600} noWrap sx={{ flex: 1 }}>
          {diagram.name}
        </Typography>
        {saving && <CircularProgress size={16} sx={{ ml: 1 }} />}

        {/* Overflow menu for occasional actions (e.g. one-off migration of an
            older diagram to show the card-type icons). */}
        <Tooltip title={t("editor.toolbar.moreActions")}>
          <IconButton size="small" onClick={(e) => setMoreMenuAnchor(e.currentTarget)}>
            <MaterialSymbol icon="more_vert" size={20} />
          </IconButton>
        </Tooltip>
        <Menu
          anchorEl={moreMenuAnchor}
          open={Boolean(moreMenuAnchor)}
          onClose={() => setMoreMenuAnchor(null)}
        >
          <MenuItem onClick={handleApplyIcons}>
            <ListItemIcon>
              <MaterialSymbol icon="emoji_symbols" size={20} />
            </ListItemIcon>
            <ListItemText>{t("editor.toolbar.applyIcons")}</ListItemText>
          </MenuItem>
        </Menu>

        {/* View perspective dropdown (Phase 5) */}
        <ViewSelector
          activeTypeKeys={activeTypeKeys}
          types={fsTypes}
          current={view}
          onChange={setView}
        />

        {/* Sync button — louder when there are unsynced changes so users
            don't accidentally walk away with pending work. */}
        <Tooltip
          title={
            totalPending > 0
              ? t("editor.toolbar.syncTooltipPending", { count: totalPending })
              : t("editor.toolbar.syncTooltip")
          }
        >
          <Button
            size="small"
            variant={totalPending > 0 ? "contained" : "outlined"}
            color={totalPending > 0 ? "warning" : "inherit"}
            startIcon={
              <MaterialSymbol
                icon={totalPending > 0 ? "warning" : "sync"}
                size={18}
              />
            }
            onClick={() => setSyncOpen(true)}
            sx={{
              textTransform: "none",
              minWidth: 0,
              px: 1.5,
              py: 0.25,
              fontSize: "0.8rem",
              fontWeight: totalPending > 0 ? 700 : 500,
              animation:
                totalPending > 0 ? "turboea-pulse 1.6s ease-in-out infinite" : "none",
              "@keyframes turboea-pulse": {
                "0%,100%": { boxShadow: "0 0 0 0 rgba(237,108,2,0.5)" },
                "50%": { boxShadow: "0 0 0 6px rgba(237,108,2,0)" },
              },
            }}
          >
            {totalPending > 0
              ? t("editor.toolbar.unsyncedCount", { count: totalPending })
              : t("editor.toolbar.sync")}
          </Button>
        </Tooltip>
      </Box>

      {restoreBanner && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 2,
            py: 1,
            bgcolor: "warning.light",
            color: "warning.contrastText",
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          <MaterialSymbol icon="history" size={20} />
          <Typography variant="body2" sx={{ flex: 1 }}>
            {t("editor.restore.banner", {
              when: new Date(restoreBanner.savedAt).toLocaleString(),
            })}
          </Typography>
          <Button size="small" variant="contained" onClick={acceptRestore}>
            {t("editor.restore.accept")}
          </Button>
          <Button size="small" onClick={dismissRestore}>
            {t("editor.restore.discard")}
          </Button>
        </Box>
      )}

      {/* DrawIO canvas */}
      <Box sx={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <Box sx={{ flex: 1, position: "relative" }}>
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" }}
            title={t("editor.title")}
          />
          {view.kind !== "card_type" && (
            <DiagramViewLegend
              title={
                view.kind === "approval_status"
                  ? t("viewSelector.approvalStatus")
                  : (() => {
                      const tp = fsTypes.find((x) => x.key === view.type_key);
                      const f = (tp?.fields_schema ?? [])
                        .flatMap((s) => s.fields ?? [])
                        .find((x) => x.key === view.field_key);
                      return tp && f ? `${tp.label} · ${f.label}` : t("viewSelector.cardType");
                    })()
              }
              entries={viewLegendEntries}
              appliedCount={viewAppliedCount}
              onReset={() => setView({ kind: "card_type" })}
            />
          )}
        </Box>
      </Box>

      {/* Dialogs */}
      <InsertCardsDialog
        open={pickerOpen}
        // Change Linked Card / Link to Existing Card open this dialog with a
        // relink target set — pick a single card and apply it immediately.
        mode={relinkTargetCellId ? "single" : "multi"}
        onClose={() => {
          setPickerOpen(false);
          contextInsertPosRef.current = null;
          setRelinkTargetCellId(null);
        }}
        onInsert={handleInsertCard}
      />

      <CreateOnDiagramDialog
        open={createOpen}
        types={fsTypes}
        prefillName={convertPrefillName}
        onClose={() => {
          setCreateOpen(false);
          contextInsertPosRef.current = null;
          setConvertTargetCellId(null);
          setConvertPrefillName("");
        }}
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
        pendingRelRemovals={pendingRelRemovals}
        pendingParentChanges={pendingParentChanges}
        staleItems={staleItems}
        syncing={syncing}
        onSyncAll={handleSyncAll}
        onSyncFS={handleSyncFS}
        onSyncRel={handleSyncRel}
        onRemoveFS={handleRemoveFS}
        onRemoveRel={handleRemoveRel}
        onSyncRelRemoval={handleSyncRelRemoval}
        onDiscardRelRemoval={handleDiscardRelRemoval}
        onSyncParentChange={handleSyncParentChange}
        onDiscardParentChange={handleDiscardParentChange}
        onAcceptStale={handleAcceptStale}
        onCheckUpdates={handleCheckUpdates}
        checkingUpdates={checkingUpdates}
      />

      <CardDetailSidePanel
        cardId={selectedCardId}
        open={!!selectedCardId}
        onClose={() => setSelectedCardId(null)}
      />

      <ExpandMenu
        target={expandMenuTarget}
        onClose={() => setExpandMenuTarget(null)}
        onPick={handleExpandPick}
      />

      {/* Parent-change confirmation. Fires when a card is dragged
          into / out of a same-type container; one dialog per event so
          the user sees a clean "this child / that parent" decision. */}
      <Dialog
        open={parentChangeQueue.length > 0}
        onClose={handleCancelParentChange}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {parentChangeQueue.length > 0 && parentChangeQueue[0].kind === "attach"
            ? t("editor.parentChange.attachTitle")
            : t("editor.parentChange.detachTitle")}
        </DialogTitle>
        <DialogContent>
          {parentChangeQueue.length > 0 && (
            <DialogContentText>
              {parentChangeQueue[0].kind === "attach"
                ? t("editor.parentChange.attachBody", {
                    child: parentChangeQueue[0].cardName || "?",
                    parent: parentChangeQueue[0].parentCardName || "?",
                  })
                : t("editor.parentChange.detachBody", {
                    child: parentChangeQueue[0].cardName || "?",
                    parent: parentChangeQueue[0].parentCardName || "?",
                  })}
            </DialogContentText>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelParentChange}>
            {t("editor.parentChange.no")}
          </Button>
          <Button
            variant="contained"
            color="primary"
            onClick={handleConfirmParentChange}
            autoFocus
          >
            {t("editor.parentChange.yes")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edge-deletion confirmation. One dialog per queued tombstone — we
          process them serially so the user sees a clear "this one"
          decision rather than a bulk dropdown. */}
      <Dialog
        open={deleteRelationQueue.length > 0}
        onClose={handleCancelDeleteRelation}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{t("editor.deleteRelation.title")}</DialogTitle>
        <DialogContent>
          {deleteRelationQueue.length > 0 && (
            <DialogContentText>
              {t("editor.deleteRelation.body", {
                source: deleteRelationQueue[0].sourceName || "?",
                target: deleteRelationQueue[0].targetName || "?",
                label:
                  deleteRelationQueue[0].relationLabel ||
                  deleteRelationQueue[0].relationType ||
                  "—",
              })}
            </DialogContentText>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelDeleteRelation}>
            {t("editor.deleteRelation.no")}
          </Button>
          <Button
            variant="contained"
            color="warning"
            onClick={handleConfirmDeleteRelation}
            autoFocus
          >
            {t("editor.deleteRelation.yes")}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!snackMsg}
        autoHideDuration={3000}
        onClose={() => setSnackMsg("")}
        message={snackMsg}
      />
    </Box>
  );
}
