/**
 * BpmnModeler — Wraps bpmn-js in a React component.
 *
 * Simple Mode (default): curated palette with plain-English tooltips
 * Full BPMN Mode: complete BPMN palette
 *
 * Features: auto-save (5s debounce), undo/redo, zoom, fit, keyboard shortcuts,
 * export (SVG, PNG, BPMN XML), import BPMN, template chooser.
 *
 * When `versionId` is provided, loads from and saves to the draft version endpoint.
 * Otherwise falls back to the legacy ProcessDiagram endpoint.
 */
import { useRef, useEffect, useState, useCallback } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";

import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import ToggleButton from "@mui/material/ToggleButton";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { ProcessDiagramData, ProcessFlowVersion, BpmnTemplate } from "@/types";

// bpmn-js CSS
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css";

interface Props {
  processId: string;
  versionId?: string;
  initialXml?: string;
  onSaved?: (version: number) => void;
  onBack?: () => void;
}

export default function BpmnModeler({ processId, versionId, initialXml, onSaved, onBack }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const modelerRef = useRef<any>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState<number | null>(null);
  const [snack, setSnack] = useState<{ msg: string; severity: "success" | "error" } | null>(null);
  const [mode, setMode] = useState<"simple" | "full">("full");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track which version we're editing (stable ref for save callback)
  const versionIdRef = useRef(versionId);
  versionIdRef.current = versionId;

  // Load bpmn-js dynamically (it's a CommonJS module)
  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;

    async function init() {
      const BpmnJS = (await import("bpmn-js/lib/Modeler")).default;

      if (destroyed || !containerRef.current) return;

      const modeler = new BpmnJS({
        container: containerRef.current,
      });

      modelerRef.current = modeler;

      // Load diagram — prefer draft version, fall back to legacy endpoint
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
        try {
          const data = await api.get<ProcessDiagramData | null>(`/bpm/processes/${processId}/diagram`);
          if (data && data.bpmn_xml) {
            xml = data.bpmn_xml;
            setVersion(data.version);
          }
        } catch {
          // No diagram yet
        }
      }

      if (!xml) {
        // Load blank template
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
      if (vid) {
        // Save to draft version endpoint
        await api.patch(`/bpm/processes/${processId}/flow/versions/${vid}`, {
          bpmn_xml: xml,
          svg_thumbnail: svgThumbnail,
        });
        setDirty(false);
        setSnack({ msg: "Draft saved", severity: "success" });
      } else {
        // Legacy: save to old diagram endpoint
        const result = await api.put<{ version: number; element_count: number }>(`/bpm/processes/${processId}/diagram`, {
          bpmn_xml: xml,
          svg_thumbnail: svgThumbnail,
        });
        setVersion(result.version);
        setDirty(false);
        setSnack({ msg: `Saved v${result.version} (${result.element_count} elements)`, severity: "success" });
        onSaved?.(result.version);
      }
    } catch (err) {
      setSnack({ msg: "Save failed", severity: "error" });
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
        setSnack({ msg: "BPMN imported successfully", severity: "success" });
      } catch {
        setSnack({ msg: "Invalid BPMN file", severity: "error" });
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
          {saving ? "Saving..." : "Save"}
        </Button>

        {versionId && <Chip label="Draft" size="small" color="warning" variant="outlined" />}
        {version && !versionId && <Chip label={`v${version}`} size="small" variant="outlined" />}
        {dirty && <Chip label="Unsaved" size="small" color="warning" variant="outlined" />}

        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

        <Tooltip title="Undo (Ctrl+Z)">
          <IconButton onClick={handleUndo} size="small"><MaterialSymbol icon="undo" /></IconButton>
        </Tooltip>
        <Tooltip title="Redo (Ctrl+Y)">
          <IconButton onClick={handleRedo} size="small"><MaterialSymbol icon="redo" /></IconButton>
        </Tooltip>

        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

        <Tooltip title="Zoom In">
          <IconButton onClick={handleZoomIn} size="small"><MaterialSymbol icon="zoom_in" /></IconButton>
        </Tooltip>
        <Tooltip title="Zoom Out">
          <IconButton onClick={handleZoomOut} size="small"><MaterialSymbol icon="zoom_out" /></IconButton>
        </Tooltip>
        <Tooltip title="Fit to Screen">
          <IconButton onClick={handleFit} size="small"><MaterialSymbol icon="fit_screen" /></IconButton>
        </Tooltip>

        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

        <Tooltip title="Export SVG">
          <IconButton onClick={handleExportSvg} size="small"><MaterialSymbol icon="image" /></IconButton>
        </Tooltip>
        <Tooltip title="Export BPMN XML">
          <IconButton onClick={handleExportBpmn} size="small"><MaterialSymbol icon="download" /></IconButton>
        </Tooltip>
        <Tooltip title="Import BPMN">
          <IconButton onClick={handleImport} size="small"><MaterialSymbol icon="upload" /></IconButton>
        </Tooltip>

        <Box sx={{ flex: 1 }} />

        <ToggleButtonGroup
          value={mode}
          exclusive
          onChange={(_, v) => v && setMode(v)}
          size="small"
        >
          <ToggleButton value="simple">Simple</ToggleButton>
          <ToggleButton value="full">Full BPMN</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Canvas */}
      <Box
        ref={containerRef}
        sx={{
          flex: 1,
          bgcolor: "#fafafa",
          "& .bjs-powered-by": { display: "none" },
          // Simple mode: hide advanced palette entries
          ...(mode === "simple" && {
            // Hide sub-process, data store, data object, group, participant/pool
            '& .djs-palette [data-action="create.subprocess-expanded"]': { display: "none" },
            '& .djs-palette [data-action="create.data-object"]': { display: "none" },
            '& .djs-palette [data-action="create.data-store"]': { display: "none" },
            '& .djs-palette [data-action="create.group"]': { display: "none" },
            '& .djs-palette [data-action="create.participant-expanded"]': { display: "none" },
            // Hide intermediate events (keep start/end only)
            '& .djs-palette [data-action="create.intermediate-event"]': { display: "none" },
          }),
        }}
      />

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
