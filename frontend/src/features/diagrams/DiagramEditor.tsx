import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Snackbar from "@mui/material/Snackbar";
import CircularProgress from "@mui/material/CircularProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";

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

/** Messages FROM DrawIO iframe → host */
interface DrawIOMessage {
  event: "init" | "save" | "exit" | "export" | "configure";
  xml?: string;
  data?: string;
  modified?: boolean;
}

export default function DiagramEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [diagram, setDiagram] = useState<DiagramData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [snackMsg, setSnackMsg] = useState("");
  // Track whether we're waiting for a thumbnail export after save
  const pendingSaveXmlRef = useRef<string | null>(null);

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
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
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
        {saving && (
          <CircularProgress size={16} sx={{ ml: 1 }} />
        )}
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary">
          DrawIO Editor
        </Typography>
      </Box>

      {/* DrawIO iframe */}
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

      <Snackbar
        open={!!snackMsg}
        autoHideDuration={3000}
        onClose={() => setSnackMsg("")}
        message={snackMsg}
      />
    </Box>
  );
}
