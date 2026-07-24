import { useState, useEffect, useRef, useMemo } from "react";
import { useParams, useNavigate, Navigate } from "react-router";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";
import CircularProgress from "@mui/material/CircularProgress";
import Snackbar from "@mui/material/Snackbar";
import MaterialSymbol from "@/components/MaterialSymbol";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import { api } from "@/api/client";
import { useAuthContext } from "@/hooks/AuthContext";

/* ------------------------------------------------------------------ */
/*  DrawIO native lightbox viewer                                      */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _meta = import.meta as any;
const DRAWIO_BASE_URL: string =
  _meta.env?.VITE_DRAWIO_URL || "/drawio/index.html";

interface DiagramData {
  id: string;
  name: string;
  type: string;
  data: { xml?: string; thumbnail?: string };
}

const EMPTY_DIAGRAM =
  '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';

/** Build the iframe src for DrawIO's stock lightbox viewer. */
function buildViewerSrc(xml: string): string {
  // lightbox=1 = DrawIO's native viewer (the same code path as the
  //              "fullscreen" popup from a static embed).
  // chrome=0   = no editor chrome — just canvas + the floating bottom
  //              toolbar (zoom in / out / reset / fit / page nav / layers).
  // nav=1      = enable page navigation in multi-page diagrams.
  // We deliberately do NOT pass `edit=` — DrawIO only renders its own
  // edit link when that param is set, and our app toolbar already has
  // a context-aware Edit button that goes to /diagrams/:id/edit.
  const params = new URLSearchParams({
    lightbox: "1",
    chrome: "0",
    nav: "1",
  });
  return `${DRAWIO_BASE_URL}?${params.toString()}#R${encodeURIComponent(xml)}`;
}

/**
 * Click handling lives in /drawio/js/PostConfig.js, which runs INSIDE the
 * iframe BEFORE App.main constructs the graph. That's the only timing where
 * we can wrap each Graph instance's click method (chromeless mode replaces
 * it on the instance, shadowing any prototype patch applied later from the
 * parent). PostConfig.js posts {event: "cardClicked", cardId} back; this
 * function just installs the listener.
 */
function listenForCardClicks(onCardClick: (cardId: string) => void) {
  const handler = (e: MessageEvent) => {
    if (typeof e.data !== "string") return;
    try {
      const msg = JSON.parse(e.data);
      if (msg?.event === "cardClicked" && typeof msg.cardId === "string") {
        onCardClick(msg.cardId);
      }
    } catch {
      /* not our message */
    }
  };
  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function DiagramViewer() {
  const { t } = useTranslation(["diagrams", "common"]);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthContext();

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [diagram, setDiagram] = useState<DiagramData | null>(null);
  const [loading, setLoading] = useState(true);
  const [snackMsg, setSnackMsg] = useState("");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  const canEdit = useMemo(() => {
    const perms = user?.permissions;
    if (!perms) return false;
    return !!perms["*"] || !!perms["diagrams.manage"];
  }, [user?.permissions]);

  /* ---------- Listen for card clicks from the lightbox ---------- */
  useEffect(() => listenForCardClicks(setSelectedCardId), []);

  /* ---------- Load diagram ---------- */
  useEffect(() => {
    if (!id) return;
    api
      .get<DiagramData>(`/diagrams/${id}`)
      .then(setDiagram)
      .catch(() => setSnackMsg(t("editor.errors.loadFailed")))
      .finally(() => setLoading(false));
  }, [id, t]);

  /* ---------- Render ---------- */
  if (!id) return <Navigate to="/diagrams" replace />;

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (!diagram) {
    return <Typography color="error">{t("viewer.notFound")}</Typography>;
  }

  const xml = diagram.data?.xml || EMPTY_DIAGRAM;
  const iframeSrc = buildViewerSrc(xml);

  return (
    <Box
      sx={{
        // See DiagramEditor.tsx for the rationale — same iPad Safari fix.
        height: "calc(100vh - 64px)",
        "@supports (height: 100dvh)": {
          height: "calc(100dvh - 64px)",
        },
        m: -3,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* App toolbar */}
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
        <IconButton size="small" onClick={() => navigate("/diagrams")}>
          <MaterialSymbol icon="arrow_back" size={20} />
        </IconButton>
        <Typography variant="subtitle1" fontWeight={600} noWrap sx={{ flex: 1 }}>
          {diagram.name}
        </Typography>

        {canEdit && (
          <Tooltip title={t("viewer.toolbar.editTooltip")}>
            <Button
              size="small"
              variant="contained"
              startIcon={<MaterialSymbol icon="edit" size={18} />}
              onClick={() => navigate(`/diagrams/${id}/edit`)}
              sx={{ textTransform: "none", minWidth: 0, px: 1.5, py: 0.25, fontSize: "0.8rem" }}
            >
              {t("viewer.toolbar.edit")}
            </Button>
          </Tooltip>
        )}
      </Box>

      {/* DrawIO native lightbox iframe */}
      <Box sx={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <Box sx={{ flex: 1, position: "relative" }}>
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" }}
            title={t("viewer.title")}
          />
        </Box>
      </Box>

      <CardDetailSidePanel
        cardId={selectedCardId}
        open={!!selectedCardId}
        onClose={() => setSelectedCardId(null)}
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
