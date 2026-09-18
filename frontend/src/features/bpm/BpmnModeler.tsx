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
 * A call activity is linked to the Business Process it invokes by *picking a
 * card*, never by typing an id: placing one opens the picker, and the
 * properties panel's "Called process" group and a context-pad entry reopen it
 * (`calledProcessModule.ts`). The pick is written to the shape's
 * `calledElement` through the command stack — undoable, autosaved — and the
 * backend resolves the card id on publish.
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
import type { ProcessFlowVersion, BpmnTemplate } from "@/types";
import { bpmnCanvasSx, bpmnPropertiesPanelSx } from "./bpmnStyles";
import { calledProcessPath, collectCalledElementIds } from "./calledProcess";
import { createCalledProcessModule } from "./calledProcessModule";
import type { CalledProcessBridge } from "./calledProcessModule";

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
  // The call activity whose callee is being picked — the picker dialog is
  // open exactly while this is set.
  const [pickerTarget, setPickerTarget] = useState<unknown>(null);

  // The bridge the bpmn-js module reads at render time. One object for the
  // modeler's whole life: the didi module captures it at construction, so the
  // React side mutates it in place (names, labels) rather than replacing it.
  const bridgeRef = useRef<CalledProcessBridge>({
    open: (element) => setPickerTarget(element),
    openProcess: (cardId) => navigate(calledProcessPath(cardId)),
    names: {},
    labels: {
      group: "",
      choose: "",
      open: "",
      clear: "",
      noProcess: "",
      references: (ref) => ref,
      linkProcess: "",
    },
  });
  bridgeRef.current.openProcess = (cardId) => navigate(calledProcessPath(cardId));
  bridgeRef.current.labels = {
    group: t("modeler.calledProcess"),
    choose: t("modeler.chooseProcess"),
    open: t("modeler.openProcess"),
    clear: t("modeler.clearProcess"),
    noProcess: t("modeler.noProcessLinked"),
    references: (ref) => t("modeler.referencesProcess", { ref }),
    linkProcess: t("modeler.linkProcess"),
  };

  /**
   * Resolve the names of every process the diagram's call activities
   * reference, then re-render the panel: `propertiesPanel.providersChanged`
   * is the one public hook that re-runs every provider's `getGroups` on the
   * current selection. Runs after every import; a pick updates the map
   * itself and the command stack re-renders the panel on its own.
   */
  const resolveCalledNames = useCallback(async (modeler: any) => {
    let ids: string[] = [];
    try {
      const registry = modeler.get("elementRegistry") as { getAll: () => unknown[] };
      ids = collectCalledElementIds(registry.getAll() as never);
    } catch {
      return;
    }
    if (ids.length === 0) return;
    try {
      const cards = await fetchCardsByIds(ids);
      for (const c of cards) bridgeRef.current.names[c.id] = c.name;
      (modeler.get("eventBus") as any).fire("propertiesPanel.providersChanged");
    } catch {
      // Names stay unresolved; the entry then shows the raw id, which is
      // still a link the modeller can replace.
    }
  }, []);

  const handlePickProcess = (card: CardOption | null) => {
    const target = pickerTarget;
    const m = modelerRef.current;
    setPickerTarget(null);
    if (!card || !target || !m) return;
    bridgeRef.current.names[card.id] = card.name;
    // Through the command stack: undoable, and `commandStack.changed` trips
    // the autosave like any other edit.
    m.get("modeling").updateProperties(target, { calledElement: card.id });
  };

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
      //    the BPMN DI by core `modeling.setColor()`, so no moddle extensions
      //    are needed — bpmn-moddle already ships `bioc` and BPMN-in-Color;
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

      {/* Which process does this call activity call? Opened by the create
          prompt, the properties panel group and the context-pad entry. */}
      <Dialog
        open={pickerTarget != null}
        onClose={() => setPickerTarget(null)}
        maxWidth="sm"
        fullWidth
        disableRestoreFocus
      >
        <DialogTitle>{t("modeler.chooseProcessTitle")}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("modeler.chooseProcessHint")}
          </Typography>
          {pickerTarget != null && (
            <CardPicker
              types="BusinessProcess"
              hierarchy
              excludeIds={[processId]}
              value={null}
              onChange={handlePickProcess}
              label={t("modeler.calledProcess")}
              autoFocus
              fullWidth
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPickerTarget(null)}>{t("common:actions.cancel")}</Button>
        </DialogActions>
      </Dialog>

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
