import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Snackbar from "@mui/material/Snackbar";
import CircularProgress from "@mui/material/CircularProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import FactSheetPickerDialog from "./FactSheetPickerDialog";
import {
  buildFactSheetCellData,
  insertFactSheetIntoGraph,
  getVisibleCenter,
} from "./drawio-shapes";
import type { FactSheet, FactSheetType } from "@/types";

/**
 * DrawIO embed mode URL.
 * Defaults to self-hosted path (DrawIO static files bundled in the Docker image).
 * Override with VITE_DRAWIO_URL env var if needed (e.g. "https://embed.diagrams.net"
 * for local dev without Docker).
 */
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

/** Default empty diagram XML */
const EMPTY_DIAGRAM =
  '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';

interface DiagramData {
  id: string;
  name: string;
  type: string;
  data: {
    xml?: string;
    thumbnail?: string;
  };
}

/** Messages FROM DrawIO iframe -> host */
interface DrawIOMessage {
  event: "init" | "save" | "exit" | "export" | "configure" | "insertFactSheet";
  xml?: string;
  data?: string;
  modified?: boolean;
  x?: number;
  y?: number;
}

/**
 * Bootstrap the same-origin DrawIO iframe: store the mxGraph reference on
 * window.__turboGraph so the parent can call graph.insertVertex() directly.
 *
 * Uses Draw.loadPlugin which, when called after init, executes the callback
 * immediately with the current editor.  We also inject a right-click context
 * menu item ("Insert Fact Sheet…") that posts a message back to the parent.
 */
function bootstrapDrawIO(iframe: HTMLIFrameElement) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = iframe.contentWindow as any;
    if (!win?.Draw?.loadPlugin) return;

    win.Draw.loadPlugin((ui: /* EditorUi */ Record<string, unknown>) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = ui.editor as any;
      const graph = editor?.graph;
      if (graph) {
        win.__turboGraph = graph;
      }

      // Inject right-click "Insert Fact Sheet…" context menu item
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const menus = ui.menus as any;
      if (menus?.createPopupMenu) {
        const origFactory = menus.createPopupMenu;
        menus.createPopupMenu = function (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          menu: any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          _cell: any,
          evt: MouseEvent
        ) {
          origFactory.apply(this, arguments);
          menu.addSeparator();

          const mxEvent = win.mxEvent;
          const offset = graph.container.getBoundingClientRect();
          const s = graph.view.scale;
          const tr = graph.view.translate;
          const gx = Math.round(
            (mxEvent.getClientX(evt) - offset.left) / s - tr.x
          );
          const gy = Math.round(
            (mxEvent.getClientY(evt) - offset.top) / s - tr.y
          );

          menu.addItem("Insert Fact Sheet\u2026", null, () => {
            win.parent.postMessage(
              JSON.stringify({ event: "insertFactSheet", x: gx, y: gy }),
              "*"
            );
          });
        };
      }
    });
  } catch {
    // Cross-origin or editor not ready — fall through silently
  }
}

export default function DiagramEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [diagram, setDiagram] = useState<DiagramData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [snackMsg, setSnackMsg] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  // Track whether we're waiting for a thumbnail export after save
  const pendingSaveXmlRef = useRef<string | null>(null);
  // Graph-space coordinates from right-click context menu
  const contextInsertPosRef = useRef<{ x: number; y: number } | null>(null);

  // Load diagram from API
  useEffect(() => {
    if (!id) return;
    api
      .get<DiagramData>(`/diagrams/${id}`)
      .then(setDiagram)
      .catch(() => setSnackMsg("Failed to load diagram"))
      .finally(() => setLoading(false));
  }, [id]);

  /** Send a message to the DrawIO iframe */
  const postToDrawIO = useCallback((msg: Record<string, unknown>) => {
    const frame = iframeRef.current;
    if (frame?.contentWindow) {
      frame.contentWindow.postMessage(JSON.stringify(msg), "*");
    }
  }, []);

  /** Persist XML + thumbnail to the backend */
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
          },
        };
        await api.patch(`/diagrams/${diagram.id}`, payload);
        setDiagram((prev) =>
          prev
            ? {
                ...prev,
                data: { ...prev.data, xml, ...(thumbnail ? { thumbnail } : {}) },
              }
            : prev
        );
        setSnackMsg("Diagram saved");
      } catch {
        setSnackMsg("Save failed");
      } finally {
        setSaving(false);
      }
    },
    [diagram]
  );

  /** Insert a fact sheet shape directly into the DrawIO graph */
  const handleInsertFactSheet = useCallback(
    (fs: FactSheet, fsType: FactSheetType) => {
      const frame = iframeRef.current;
      if (!frame) return;

      // Use right-click position, or fall back to the center of the visible canvas
      let x: number;
      let y: number;
      if (contextInsertPosRef.current) {
        x = contextInsertPosRef.current.x;
        y = contextInsertPosRef.current.y;
        contextInsertPosRef.current = null;
      } else {
        const center = getVisibleCenter(frame);
        x = center ? center.x - 90 : 100;   // offset by half-width
        y = center ? center.y - 30 : 100;    // offset by half-height
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
        setSnackMsg(`Inserted "${fs.name}"`);
      } else {
        setSnackMsg("Editor not ready — try again in a moment");
      }
    },
    []
  );

  /** Handle postMessage events from DrawIO */
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      // Only accept messages that look like DrawIO JSON protocol
      if (typeof e.data !== "string") return;
      let msg: DrawIOMessage;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }

      switch (msg.event) {
        case "init":
          // Editor is ready — load the diagram XML
          postToDrawIO({
            action: "load",
            xml: diagram?.data?.xml || EMPTY_DIAGRAM,
            autosave: 0,
          });

          // Bootstrap: grab the graph reference and inject context menu.
          // Give DrawIO a tick to finish its own init processing.
          setTimeout(() => {
            if (iframeRef.current) {
              bootstrapDrawIO(iframeRef.current);
            }
          }, 300);
          break;

        case "save":
          if (msg.xml) {
            // Store XML for when thumbnail export completes
            pendingSaveXmlRef.current = msg.xml;
            // Request SVG export for thumbnail
            postToDrawIO({
              action: "export",
              format: "svg",
              spinKey: "saving",
            });
            // Acknowledge the save to DrawIO (clears modified state)
            postToDrawIO({
              action: "status",
              messageKey: "allChangesSaved",
              modified: false,
            });
          }
          break;

        case "export":
          // Thumbnail SVG arrived after a save
          if (pendingSaveXmlRef.current) {
            const xml = pendingSaveXmlRef.current;
            pendingSaveXmlRef.current = null;
            saveDiagram(xml, msg.data);
          }
          break;

        case "exit":
          // If modified, save first then navigate
          if (msg.modified && msg.xml) {
            saveDiagram(msg.xml).then(() => navigate("/diagrams"));
          } else {
            navigate("/diagrams");
          }
          break;

        case "insertFactSheet":
          // Custom event from our injected context menu item
          contextInsertPosRef.current = {
            x: msg.x ?? 100,
            y: msg.y ?? 100,
          };
          setPickerOpen(true);
          break;

        default:
          break;
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [diagram, postToDrawIO, saveDiagram, navigate]);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!diagram) {
    return <Typography color="error">Diagram not found</Typography>;
  }

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
        <Typography variant="subtitle1" fontWeight={600} noWrap>
          {diagram.name}
        </Typography>
        {saving && <CircularProgress size={16} sx={{ ml: 1 }} />}
      </Box>

      {/* DrawIO canvas */}
      <Box sx={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <Box sx={{ flex: 1, position: "relative" }}>
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              border: "none",
            }}
            title="Diagram Editor"
          />
        </Box>
      </Box>

      {/* Fact sheet picker dialog — opened from DrawIO right-click menu */}
      <FactSheetPickerDialog
        open={pickerOpen}
        onClose={() => {
          setPickerOpen(false);
          contextInsertPosRef.current = null;
        }}
        onInsert={handleInsertFactSheet}
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
