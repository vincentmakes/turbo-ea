/**
 * BpmnModeler — Wraps bpmn-js in a React component.
 *
 * The full bpmn.io modeling experience: the stock palette, the searchable
 * "Create element" / "Append element" menus (`bpmn-js-create-append-anything`,
 * `N` / `A`) that reach every BPMN element type, the colour picker, and the
 * properties panel (`bpmn-js-properties-panel`, plain BPMN provider) for the
 * things a shape cannot show — documentation, the Message / Signal / Error a
 * event refers to, conditions, multi-instance markers.
 *
 * Features: auto-save (5s debounce), undo/redo, zoom, fit, keyboard shortcuts,
 * export (SVG, PNG, BPMN XML), import BPMN, template chooser.
 *
 * Any step is linked to a Business Process by *picking a card*, never by
 * typing an id: placing a call activity opens the picker, and the properties
 * panel's "Linked process" group and a context-pad entry on every flow node
 * reopen it (`calledProcessModule.ts`). The pick is written to the shape
 * through the command stack — a call activity's `calledElement`, any other
 * node's `turboea:processRef` (`turboeaModdle.ts`) — undoable, autosaved —
 * and the backend resolves the card id on publish.
 *
 * When `versionId` is provided, loads from and saves to the draft version endpoint.
 * Otherwise falls back to the legacy ProcessDiagram endpoint.
 */
import { useRef, useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { useTheme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Typography from "@mui/material/Typography";

import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import MaterialSymbol from "@/components/MaterialSymbol";
import CardPicker from "@/components/CardPicker";
import type { CardOption } from "@/components/CardPicker";
import { api } from "@/api/client";
import { fetchCardsByIds } from "@/api/cardsByIds";
import type { ProcessFlowVersion, BpmnTemplate, ProcessElement } from "@/types";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useTypeLabel } from "@/hooks/useResolveLabel";
import CardMultiPicker from "@/components/CardMultiPicker";
import type { PickedCard } from "@/components/CardMultiPicker";
import { bpmnCanvasSx, bpmnPropertiesPanelSx } from "./bpmnStyles";
import {
  LINK_BODY_KEY,
  LINK_KIND_ORDER,
  LINK_KIND_TYPE,
  calledProcessPath,
  collectProcessRefIds,
  elementIdOf,
  emptyLinks,
  isCardUuid,
  isProcessStep,
  linkDotTitles,
  linksFromDraftElements,
  processRefOf,
  processRefProperties,
  withLink,
} from "./calledProcess";
import type { LinkKind, LinkedCard } from "./calledProcess";
import { createCalledProcessModule } from "./calledProcessModule";
import type { LinkBridge, LinkLabels } from "./calledProcessModule";
import { LINK_DOTS_OVERLAY_TYPE, linkDotPlacement, linkDotsFor, linkDotsHtml } from "./linkDots";
import { useLinkTypeColors } from "./useLinkTypeColors";
import { TURBOEA_MODDLE } from "./turboeaModdle";

// bpmn-js CSS
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css";
// Lays the colour swatches out in a 3-wide grid — without it they stack in a
// single column. Required, not cosmetic.
import "bpmn-js-color-picker/colors/color-picker.css";
// The properties panel's own stylesheet (light tokens; dark mode is handled by
// `bpmnPropertiesPanelSx`).
import "@bpmn-io/properties-panel/dist/assets/properties-panel.css";

interface Props {
  processId: string;
  versionId?: string;
  initialXml?: string;
  onSaved?: (version: number) => void;
  onBack?: () => void;
}

/** Per-viewer convenience: whether the properties panel was left open. */
const PANEL_PREF_KEY = "turboea.bpmn.propertiesPanel";

function readPanelPreference(): boolean {
  try {
    return localStorage.getItem(PANEL_PREF_KEY) !== "closed";
  } catch {
    return true;
  }
}

function writePanelPreference(open: boolean): void {
  try {
    localStorage.setItem(PANEL_PREF_KEY, open ? "open" : "closed");
  } catch {
    // Storage unavailable (private window, blocked site data) — the toggle
    // still works for the session.
  }
}

const PROPERTIES_PANEL_WIDTH = 320;

export default function BpmnModeler({ processId, versionId, initialXml, onSaved, onBack }: Props) {
  const { t } = useTranslation(["bpm", "common"]);
  const theme = useTheme();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const propertiesRef = useRef<HTMLDivElement>(null);
  const modelerRef = useRef<any>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState<number | null>(null);
  const [snack, setSnack] = useState<{ msg: string; severity: "success" | "error" } | null>(null);
  const [panelOpen, setPanelOpen] = useState<boolean>(readPanelPreference);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The step whose link is being picked, and which link — the picker dialog
  // is open exactly while this is set.
  const [pickerTarget, setPickerTarget] = useState<{ element: unknown; kind: LinkKind } | null>(
    null,
  );

  // The bridge the bpmn-js module reads at render time. One object for the
  // modeler's whole life: the didi module captures it at construction, so the
  // React side mutates it in place (links, names, labels) rather than
  // replacing it.
  const bridgeRef = useRef<LinkBridge>({
    openPicker: (element, kind) => setPickerTarget({ element, kind }),
    clearLink: () => undefined,
    openCard: () => undefined,
    names: {},
    links: {},
    canLinkCards: false,
    labels: {
      group: "",
      open: "",
      clear: "",
      references: (ref) => ref,
      linkCards: "",
      kinds: {} as LinkLabels["kinds"],
    },
  });

  // Card-type colours for the link dots on the canvas, read through a ref so
  // the redraw callbacks stay stable across metamodel refreshes.
  const linkTypeColors = useLinkTypeColors();
  const linkColorsRef = useRef(linkTypeColors);
  linkColorsRef.current = linkTypeColors;

  // The four card links are draft element links, so they need a draft to live
  // in. Without one the panel offers the process link alone, which lives in
  // the diagram itself.
  bridgeRef.current.canLinkCards = Boolean(versionId);
  bridgeRef.current.openCard = (cardId, kind) =>
    navigate(kind === "process" ? calledProcessPath(cardId) : `/cards/${cardId}`);

  // Row labels are the card types' own display names, so a renamed type
  // renames the row — the i18n bundle knows nothing about the metamodel. Only
  // the plural Organizations heading is a translated string of ours.
  const { getType } = useMetamodel();
  const typeLabelOf = useTypeLabel();
  const kindLabel = useCallback(
    (kind: LinkKind) => {
      const key = LINK_KIND_TYPE[kind];
      const name = typeLabelOf(getType(key)) || key;
      return kind === "organization" ? t("modeler.organizations") : name;
    },
    [getType, typeLabelOf, t],
  );
  bridgeRef.current.labels = {
    group: t("modeler.linkedCards"),
    open: t("modeler.openProcess"),
    clear: t("modeler.clearProcess"),
    references: (ref) => t("modeler.referencesProcess", { ref }),
    linkCards: t("modeler.linkCards"),
    kinds: LINK_KIND_ORDER.reduce(
      (acc, kind) => {
        const type = kindLabel(kind);
        acc[kind] =
          kind === "process"
            ? {
                label: type,
                choose: t("modeler.chooseProcess"),
                none: t("modeler.noProcessLinked"),
              }
            : {
                label: type,
                choose: t("modeler.chooseCard", { type }),
                none: t("modeler.noCardLinked", { type }),
              };
        return acc;
      },
      {} as LinkLabels["kinds"],
    ),
  };

  /**
   * Resolve the names of every process the diagram's steps reference, then
   * re-render the panel: `propertiesPanel.providersChanged`
   * is the one public hook that re-runs every provider's `getGroups` on the
   * current selection. Runs after every import; a pick updates the map
   * itself and the command stack re-renders the panel on its own.
   *
   * Only needed for a shape the server has not seen yet — for everything in
   * the saved XML the names come resolved from `loadDraftLinks`.
   */
  /**
   * Redraw the link dots: one coloured dot per linked card type under each
   * step's name, the same renderer the read-only viewer uses (`linkDots.ts`),
   * so a draft looks on the canvas the way it will once published. Drawn from
   * `bridge.links` — the server's resolved view — plus, for a shape the server
   * has not seen yet, the diagram's own card-uuid reference (the
   * `CalledProcessEntry` read rule). Cheap enough to run on every
   * `commandStack.changed`: overlays of a deleted shape are dropped by
   * bpmn-js itself, but a label that appears when a step is first named is
   * a new element the dots must move onto.
   */
  const refreshLinkDots = useCallback((modeler: any) => {
    let overlays: any;
    let registry: any;
    try {
      overlays = modeler.get("overlays");
      registry = modeler.get("elementRegistry");
      overlays.remove({ type: LINK_DOTS_OVERLAY_TYPE });
    } catch {
      return;
    }
    const colors = linkColorsRef.current;
    const draw = (shape: any, titles: Partial<Record<LinkKind, string>>) => {
      const placement = linkDotPlacement(shape);
      const html = linkDotsHtml(linkDotsFor(titles, colors), placement.width);
      if (!html) return;
      try {
        overlays.add(placement.elementId, LINK_DOTS_OVERLAY_TYPE, {
          position: placement.position,
          html,
        });
      } catch {
        // The element may not be drawn yet; the next refresh catches it.
      }
    };
    const seen = new Set<string>();
    for (const [bpmnId, links] of Object.entries(bridgeRef.current.links)) {
      const shape = registry.get(bpmnId);
      if (!shape) continue;
      seen.add(bpmnId);
      draw(shape, linkDotTitles(links));
    }
    // Shapes placed since the last autosave: the diagram reference is all
    // there is, resolved through `names` when `resolveCalledNames` got to it.
    for (const shape of registry.getAll() as any[]) {
      if (seen.has(shape.id) || !isProcessStep(shape)) continue;
      const ref = processRefOf(shape);
      if (!isCardUuid(ref)) continue;
      draw(shape, { process: bridgeRef.current.names[ref] ?? ref });
    }
  }, []);

  const resolveCalledNames = useCallback(async (modeler: any) => {
    let ids: string[] = [];
    try {
      const registry = modeler.get("elementRegistry") as { getAll: () => unknown[] };
      ids = collectProcessRefIds(registry.getAll() as never);
    } catch {
      return;
    }
    if (ids.length === 0) return;
    try {
      const cards = await fetchCardsByIds(ids);
      for (const c of cards) bridgeRef.current.names[c.id] = c.name;
      (modeler.get("eventBus") as any).fire("propertiesPanel.providersChanged");
      refreshLinkDots(modeler);
    } catch {
      // Names stay unresolved; the entry then shows the raw id, which is
      // still a link the modeller can replace.
    }
  }, [refreshLinkDots]);

  /**
   * Load the links the server holds for this draft's steps.
   *
   * This is what makes the editor and the tables agree: the payload is the
   * same one the pre-link table renders, with the precedence rule already
   * applied server-side, so a link made in a table shows here — including a
   * process link the diagram itself says nothing about.
   */
  const loadDraftLinks = useCallback(async (modeler: any) => {
    const vid = versionIdRef.current;
    if (!vid) return;
    try {
      const rows = await api.get<ProcessElement[]>(
        `/bpm/processes/${processId}/flow/versions/${vid}/draft-elements`,
      );
      if (modelerRef.current !== modeler) return; // re-initialised meanwhile
      bridgeRef.current.links = linksFromDraftElements(rows);
      (modeler.get("eventBus") as any).fire("propertiesPanel.providersChanged");
      refreshLinkDots(modeler);
    } catch {
      // The rows stay empty; every row then reads as unlinked and a pick
      // still writes through, so the panel degrades rather than breaking.
    }
  }, [processId, refreshLinkDots]);

  /**
   * Persist one link and show it at once.
   *
   * Optimistic: the map is updated before the request so the row does not lag
   * a round trip behind the click, and restored if the write fails.
   */
  const writeLink = useCallback(
    async (element: unknown, kind: LinkKind, picked: LinkedCard | LinkedCard[] | null) => {
      const vid = versionIdRef.current;
      const bpmnId = elementIdOf(element as never);
      if (!vid || !bpmnId) return;
      const before = bridgeRef.current.links[bpmnId] ?? emptyLinks();
      const refresh = () => {
        const m = modelerRef.current;
        if (!m) return;
        (m.get("eventBus") as any).fire("propertiesPanel.providersChanged");
        refreshLinkDots(m);
      };
      bridgeRef.current.links[bpmnId] = withLink(before, kind, picked);
      refresh();
      try {
        const body =
          kind === "organization"
            ? { organization_ids: ((picked as LinkedCard[] | null) ?? []).map((c) => c.id) }
            : { [LINK_BODY_KEY[kind]]: (picked as LinkedCard | null)?.id ?? "" };
        await api.put(
          `/bpm/processes/${processId}/flow/versions/${vid}/draft-elements/${encodeURIComponent(bpmnId)}`,
          body,
        );
      } catch {
        bridgeRef.current.links[bpmnId] = before;
        refresh();
        setSnack({ msg: t("modeler.linkFailed"), severity: "error" });
      }
    },
    [processId, t, refreshLinkDots],
  );

  /**
   * The process link is written **twice**: to the diagram, because BPMN has a
   * construct for it that other tools read and Undo should cover, and to the
   * draft, because that is where every other link lives and what the tables
   * show. The four card links have no diagram half.
   */
  const writeProcessLink = useCallback(
    (element: unknown, card: LinkedCard | null) => {
      const m = modelerRef.current;
      if (m) {
        m.get("modeling").updateProperties(
          element,
          processRefProperties(element as never, card?.id ?? null),
        );
      }
      void writeLink(element, "process", card);
    },
    [writeLink],
  );

  bridgeRef.current.clearLink = (element, kind) => {
    if (kind === "process") writeProcessLink(element, null);
    else void writeLink(element, kind, null);
  };

  const handlePick = (card: CardOption | null) => {
    const target = pickerTarget;
    setPickerTarget(null);
    if (!card || !target) return;
    const picked = { id: card.id, name: card.name };
    if (target.kind === "process") {
      bridgeRef.current.names[card.id] = card.name;
      writeProcessLink(target.element, picked);
    } else {
      void writeLink(target.element, target.kind, picked);
    }
  };

  // The dialog's wording, and the organizations already picked — read from
  // the same map the panel rows render, so the basket opens on what is there.
  const pickerKind = pickerTarget?.kind ?? null;
  const pickerTitle =
    pickerKind === "process"
      ? t("modeler.chooseProcessTitle")
      : pickerKind
        ? t("modeler.chooseCardTitle", { type: kindLabel(pickerKind) })
        : "";
  const pickerHint =
    pickerKind === "process"
      ? t("modeler.chooseProcessHint")
      : pickerKind === "application"
        ? t("modeler.chooseApplicationHint")
        : pickerKind === "data_object"
          ? t("modeler.chooseDataObjectHint")
          : pickerKind === "it_component"
            ? t("modeler.chooseItComponentHint")
            : "";
  const pickedOrganizations =
    pickerTarget != null
      ? (bridgeRef.current.links[elementIdOf(pickerTarget.element as never)]?.organizations ?? [])
      : [];

  // Track which version we're editing (stable ref for save callback)
  const versionIdRef = useRef(versionId);
  versionIdRef.current = versionId;
  // The panel state the init effect should honour once the modeler exists.
  const panelOpenRef = useRef(panelOpen);
  panelOpenRef.current = panelOpen;

  // Load bpmn-js dynamically (it's a CommonJS module)
  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;

    async function init() {
      // Every bpmn.io extension rides along in the same lazy chunk as bpmn-js:
      //  - the colour picker contributes the "Set color" context-pad entry,
      //    which is not part of bpmn-js core (#910); colours are written to
      //    the BPMN DI by core `modeling.setColor()` — bpmn-moddle already
      //    ships `bioc` and BPMN-in-Color, so it needs no moddle extension;
      //  - `turboeaModdle` is the ONE moddle extension: it declares
      //    `turboea:processRef`, the step → Business Process link, so the
      //    attribute round-trips through saveXML / importXML;
      //  - create-append-anything adds the searchable "Create element" palette
      //    entry and the "Append element" context-pad entry, which is how
      //    message/signal/error events, transactions, call activities and the
      //    rest are reached without a wrench detour through a plain shape;
      //  - the properties panel with the *plain BPMN* provider (never the
      //    Camunda / Zeebe ones — this is an EA tool, not an execution engine).
      const [BpmnJS, ColorPickerModule, { CreateAppendAnythingModule }, propertiesPanel] =
        await Promise.all([
          import("bpmn-js/lib/Modeler").then((m) => m.default),
          import("bpmn-js-color-picker").then((m) => m.default),
          import("bpmn-js-create-append-anything"),
          import("bpmn-js-properties-panel"),
        ]);

      if (destroyed || !containerRef.current || !propertiesRef.current) return;

      const modeler = new BpmnJS({
        container: containerRef.current,
        propertiesPanel: { parent: propertiesRef.current },
        moddleExtensions: { turboea: TURBOEA_MODDLE },
        additionalModules: [
          ColorPickerModule,
          CreateAppendAnythingModule,
          propertiesPanel.BpmnPropertiesPanelModule,
          propertiesPanel.BpmnPropertiesProviderModule,
          createCalledProcessModule(bridgeRef.current),
        ],
      });

      modelerRef.current = modeler;

      // Load diagram from the draft version endpoint (requires versionId)
      let xml = initialXml;
      if (!xml && versionId) {
        try {
          const data = await api.get<ProcessFlowVersion>(
            `/bpm/processes/${processId}/flow/versions/${versionId}`
          );
          if (data && data.bpmn_xml) {
            xml = data.bpmn_xml;
            setVersion(data.revision);
          }
        } catch {
          // Version not found
        }
      }

      if (!xml) {
        // No draft requested — fall back to the currently-published flow so the
        // editor opens with real content instead of a blank canvas.
        try {
          const pub = await api.get<ProcessFlowVersion>(
            `/bpm/processes/${processId}/flow/published`
          );
          if (pub && pub.bpmn_xml) {
            xml = pub.bpmn_xml;
            setVersion(pub.revision);
          }
        } catch {
          // No published version yet
        }
      }

      if (!xml) {
        // Load blank template as last resort
        try {
          const tmpl = await api.get<BpmnTemplate>("/bpm/templates/blank");
          xml = tmpl.bpmn_xml;
        } catch {
          xml = defaultBlankXml();
        }
      }

      if (!xml) return;

      try {
        await modeler.importXML(xml);
        const canvas = modeler.get("canvas") as any;
        canvas.zoom("fit-viewport");
      } catch (err) {
        console.error("Failed to load BPMN diagram:", err);
      }

      if (destroyed) return;
      void resolveCalledNames(modeler);
      void loadDraftLinks(modeler);
      (modeler.get("eventBus") as any).on("commandStack.changed", () => refreshLinkDots(modeler));

      // The panel attaches itself to `propertiesPanel.parent` on import; honour
      // a "closed" preference by detaching right after.
      if (!panelOpenRef.current) {
        try {
          (modeler.get("propertiesPanel") as any).detach();
        } catch {
          // Panel not registered — nothing to detach.
        }
      }

      // Track changes for auto-save
      const eventBus = modeler.get("eventBus") as any;
      eventBus.on("commandStack.changed", () => {
        setDirty(true);
        // Debounced auto-save
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          handleSave(modeler);
        }, 5000);
      });
    }

    init();

    return () => {
      destroyed = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (modelerRef.current) {
        modelerRef.current.destroy();
        modelerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processId, versionId]);

  // The same draft's pre-link table may be open in another tab, and it edits
  // the very links this panel shows — so re-read them when the window comes
  // back rather than leaving two views of one store disagreeing.
  useEffect(() => {
    if (!versionId) return;
    const refresh = () => {
      if (document.visibilityState === "visible" && modelerRef.current) {
        void loadDraftLinks(modelerRef.current);
      }
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [versionId, loadDraftLinks]);

  // Attach / detach the properties panel when the rail is toggled. Detaching
  // (rather than hiding the rail with the panel still mounted) is what the
  // panel's own API offers, and it keeps the panel from laying out into a
  // zero-width box.
  const togglePanel = () => {
    const next = !panelOpen;
    setPanelOpen(next);
    writePanelPreference(next);
    const m = modelerRef.current;
    if (!m) return;
    try {
      const panel = m.get("propertiesPanel");
      if (next && propertiesRef.current) panel.attachTo(propertiesRef.current);
      else panel.detach();
    } catch {
      // Modeler still loading — the init effect reads the preference.
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = useCallback(async (modeler?: any) => {
    const m = modeler || modelerRef.current;
    if (!m) return;
    setSaving(true);
    try {
      const { xml } = await m.saveXML({ format: true });

      // Get SVG for thumbnail
      let svgThumbnail: string | undefined;
      try {
        const { svg } = await m.saveSVG();
        svgThumbnail = svg;
      } catch {
        // SVG export optional
      }

      const vid = versionIdRef.current;
      if (!vid) {
        setSnack({ msg: t("modeler.noDraftVersion"), severity: "error" });
        return;
      }
      // Save to draft version endpoint
      await api.patch(`/bpm/processes/${processId}/flow/versions/${vid}`, {
        bpmn_xml: xml,
        svg_thumbnail: svgThumbnail,
      });
      setDirty(false);
      setSnack({ msg: t("modeler.draftSaved"), severity: "success" });
    } catch (err) {
      setSnack({ msg: t("modeler.saveFailed"), severity: "error" });
    } finally {
      setSaving(false);
    }
  }, [processId, onSaved]);

  const handleUndo = () => {
    const m = modelerRef.current;
    if (m) m.get("commandStack").undo();
  };

  const handleRedo = () => {
    const m = modelerRef.current;
    if (m) m.get("commandStack").redo();
  };

  const handleZoomIn = () => {
    const m = modelerRef.current;
    if (m) m.get("canvas").zoom(m.get("canvas").zoom() * 1.2);
  };

  const handleZoomOut = () => {
    const m = modelerRef.current;
    if (m) m.get("canvas").zoom(m.get("canvas").zoom() / 1.2);
  };

  const handleFit = () => {
    const m = modelerRef.current;
    if (m) m.get("canvas").zoom("fit-viewport");
  };

  const handleExportSvg = async () => {
    const m = modelerRef.current;
    if (!m) return;
    const { svg } = await m.saveSVG();
    downloadFile(svg, `process-${processId}.svg`, "image/svg+xml");
  };

  const handleExportBpmn = async () => {
    const m = modelerRef.current;
    if (!m) return;
    const { xml } = await m.saveXML({ format: true });
    downloadFile(xml, `process-${processId}.bpmn`, "application/xml");
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".bpmn,.xml";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file || !modelerRef.current) return;
      const text = await file.text();
      try {
        await modelerRef.current.importXML(text);
        modelerRef.current.get("canvas").zoom("fit-viewport");
        setDirty(true);
        void resolveCalledNames(modelerRef.current);
        setSnack({ msg: t("modeler.importSuccess"), severity: "success" });
      } catch {
        setSnack({ msg: t("modeler.importInvalid"), severity: "error" });
      }
    };
    input.click();
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "calc(100vh - 64px - 48px)" }}>
      {/* Toolbar */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 2,
          py: 1,
          borderBottom: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
          flexWrap: "wrap",
        }}
      >
        {onBack && (
          <IconButton onClick={onBack} size="small">
            <MaterialSymbol icon="arrow_back" />
          </IconButton>
        )}

        <Button
          variant="contained"
          size="small"
          onClick={() => handleSave()}
          disabled={saving || !dirty}
          startIcon={<MaterialSymbol icon="save" />}
        >
          {saving ? t("modeler.saving") : t("modeler.save")}
        </Button>

        {versionId && <Chip label={t("modeler.draft")} size="small" color="warning" variant="outlined" />}
        {version != null && <Chip label={t("modeler.revision", { version })} size="small" variant="outlined" />}
        {dirty && <Chip label={t("modeler.unsaved")} size="small" color="warning" variant="outlined" />}

        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

        <Tooltip title={t("modeler.undo")}>
          <IconButton onClick={handleUndo} size="small"><MaterialSymbol icon="undo" /></IconButton>
        </Tooltip>
        <Tooltip title={t("modeler.redo")}>
          <IconButton onClick={handleRedo} size="small"><MaterialSymbol icon="redo" /></IconButton>
        </Tooltip>

        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

        <Tooltip title={t("modeler.zoomIn")}>
          <IconButton onClick={handleZoomIn} size="small"><MaterialSymbol icon="zoom_in" /></IconButton>
        </Tooltip>
        <Tooltip title={t("modeler.zoomOut")}>
          <IconButton onClick={handleZoomOut} size="small"><MaterialSymbol icon="zoom_out" /></IconButton>
        </Tooltip>
        <Tooltip title={t("modeler.fitToScreen")}>
          <IconButton onClick={handleFit} size="small" data-testid="bpmn-fit-to-screen"><MaterialSymbol icon="fit_screen" /></IconButton>
        </Tooltip>

        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

        <Tooltip title={t("modeler.exportSvg")}>
          <IconButton onClick={handleExportSvg} size="small"><MaterialSymbol icon="image" /></IconButton>
        </Tooltip>
        <Tooltip title={t("modeler.exportBpmn")}>
          <IconButton onClick={handleExportBpmn} size="small"><MaterialSymbol icon="download" /></IconButton>
        </Tooltip>
        <Tooltip title={t("modeler.importBpmn")}>
          <IconButton onClick={handleImport} size="small"><MaterialSymbol icon="upload" /></IconButton>
        </Tooltip>

        <Box sx={{ flex: 1 }} />

        <Tooltip title={panelOpen ? t("modeler.hideProperties") : t("modeler.showProperties")}>
          <IconButton
            onClick={togglePanel}
            size="small"
            color={panelOpen ? "primary" : "default"}
            data-testid="bpmn-toggle-properties"
            aria-pressed={panelOpen}
          >
            <MaterialSymbol icon="tune" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Canvas + properties rail */}
      <Box sx={{ flex: 1, display: "flex", minHeight: 0 }}>
        <Box
          ref={containerRef}
          sx={{
            flex: 1,
            minWidth: 0,
            bgcolor: "action.hover",
            ...bpmnCanvasSx,
          }}
        />
        <Box
          sx={{
            width: panelOpen ? PROPERTIES_PANEL_WIDTH : 0,
            flexShrink: 0,
            display: panelOpen ? "block" : "none",
            borderLeft: 1,
            borderColor: "divider",
            bgcolor: "background.paper",
          }}
        >
          <Box
            ref={propertiesRef}
            data-testid="bpmn-properties-panel"
            sx={bpmnPropertiesPanelSx(theme.palette.mode)}
          />
        </Box>
      </Box>

      {/* Which card does this step link to? Opened by the create prompt (a
          call activity's process), the properties-panel rows and the
          context-pad menu. Organizations are M:N, so they get the basket
          picker; every other kind picks one card. */}
      <Dialog
        open={pickerTarget != null && pickerTarget.kind !== "organization"}
        onClose={() => setPickerTarget(null)}
        maxWidth="sm"
        fullWidth
        disableRestoreFocus
      >
        <DialogTitle>{pickerTitle}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {pickerHint}
          </Typography>
          {pickerTarget != null && pickerTarget.kind !== "organization" && (
            <CardPicker
              types={LINK_KIND_TYPE[pickerTarget.kind]}
              hierarchy={pickerTarget.kind === "process"}
              // A process cannot call itself; the other kinds are other types
              // entirely, so nothing to exclude.
              excludeIds={pickerTarget.kind === "process" ? [processId] : undefined}
              value={null}
              onChange={handlePick}
              label={bridgeRef.current.labels.kinds[pickerTarget.kind].label}
              autoFocus
              fullWidth
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPickerTarget(null)}>{t("common:actions.cancel")}</Button>
        </DialogActions>
      </Dialog>

      {pickerTarget != null && pickerTarget.kind === "organization" && (
        <CardMultiPicker
          open
          onClose={() => setPickerTarget(null)}
          types="Organization"
          value={pickedOrganizations.map((o) => o.id)}
          initialOptions={pickedOrganizations.map(
            (o) => ({ id: o.id, name: o.name, type: "Organization" }) as PickedCard,
          )}
          title={t("modeler.chooseOrganizationsTitle")}
          helperText={t("modeler.chooseOrganizationsHint")}
          onChange={(_ids, picked) => {
            const target = pickerTarget;
            setPickerTarget(null);
            if (target) {
              void writeLink(
                target.element,
                "organization",
                picked.map((c) => ({ id: c.id, name: c.name })),
              );
            }
          }}
        />
      )}

      {/* Snackbar */}
      <Snackbar
        open={!!snack}
        autoHideDuration={3000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity={snack?.severity} onClose={() => setSnack(null)} variant="filled">
          {snack?.msg}
        </Alert>
      </Snackbar>
    </Box>
  );
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function defaultBlankXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  id="Definitions_1" targetNamespace="http://turbo-ea.io/bpmn">
  <bpmn:collaboration id="Collaboration_1">
    <bpmn:participant id="Participant_1" name="Process" processRef="Process_1" />
  </bpmn:collaboration>
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:laneSet id="LaneSet_1">
      <bpmn:lane id="Lane_1" name="Lane 1">
        <bpmn:flowNodeRef>StartEvent_1</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>EndEvent_1</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="StartEvent_1" name="Start">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:endEvent id="EndEvent_1" name="End">
      <bpmn:incoming>Flow_1</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="EndEvent_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collaboration_1">
      <bpmndi:BPMNShape id="Participant_1_di" bpmnElement="Participant_1" isHorizontal="true">
        <dc:Bounds x="160" y="60" width="600" height="200" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Lane_1_di" bpmnElement="Lane_1" isHorizontal="true">
        <dc:Bounds x="190" y="60" width="570" height="200" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="252" y="142" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="258" y="185" width="25" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="EndEvent_1_di" bpmnElement="EndEvent_1">
        <dc:Bounds x="612" y="142" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="620" y="185" width="20" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="288" y="160" />
        <di:waypoint x="612" y="160" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}
