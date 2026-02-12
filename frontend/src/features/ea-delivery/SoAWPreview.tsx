import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import CircularProgress from "@mui/material/CircularProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import { buildPreviewBody, PREVIEW_CSS } from "./soawExport";
import { api } from "@/api/client";
import type { SoAW, SoAWSectionData } from "@/types";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  in_review: "In Review",
  approved: "Approved",
};

const STATUS_COLORS: Record<string, "default" | "warning" | "success"> = {
  draft: "default",
  in_review: "warning",
  approved: "success",
};

export default function SoAWPreview() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [soaw, setSoaw] = useState<SoAW | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [snack, setSnack] = useState("");

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      setLoading(true);
      try {
        const data = await api.get<SoAW>(`/soaw/${id}`);
        setSoaw(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href).then(
      () => setSnack("Link copied to clipboard"),
      () => setSnack("Failed to copy link"),
    );
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !soaw) {
    return (
      <Box sx={{ maxWidth: 960, mx: "auto", py: 4 }}>
        <Alert severity="error">{error || "SoAW not found"}</Alert>
      </Box>
    );
  }

  // Extract custom sections from the persisted sections record
  const customSections: { id: string; title: string; content: string; insertAfter: string }[] = [];
  const templateSections: Record<string, SoAWSectionData> = {};

  for (const [key, val] of Object.entries(soaw.sections ?? {})) {
    if (key.startsWith("custom_")) {
      const sec = val as SoAWSectionData & { title?: string; insertAfter?: string };
      customSections.push({
        id: key,
        title: sec.title ?? key,
        content: sec.content,
        insertAfter: sec.insertAfter ?? "",
      });
    } else {
      templateSections[key] = val;
    }
  }

  const docInfo = soaw.document_info ?? { prepared_by: "", reviewed_by: "", review_date: "" };
  const versionHistory = soaw.version_history ?? [];
  const bodyHtml = buildPreviewBody(soaw.name, docInfo, versionHistory, templateSections, customSections);

  return (
    <>
      {/* Toolbar (hidden when printing) */}
      <Box
        className="no-print"
        sx={{
          display: "flex",
          alignItems: "center",
          mb: 2,
          gap: 1,
          maxWidth: 960,
          mx: "auto",
        }}
      >
        <Tooltip title="Back to EA Delivery">
          <IconButton onClick={() => navigate("/ea-delivery")}>
            <MaterialSymbol icon="arrow_back" size={22} />
          </IconButton>
        </Tooltip>
        <MaterialSymbol icon="description" size={26} color="#e65100" />
        <Typography variant="h5" sx={{ fontWeight: 700, flex: 1 }} noWrap>
          {soaw.name}
        </Typography>
        <Chip
          label={STATUS_LABELS[soaw.status] ?? soaw.status}
          size="small"
          color={STATUS_COLORS[soaw.status] ?? "default"}
        />
        <Tooltip title="Copy shareable link">
          <IconButton onClick={handleCopyLink}>
            <MaterialSymbol icon="link" size={20} />
          </IconButton>
        </Tooltip>
        <Button
          size="small"
          startIcon={<MaterialSymbol icon="print" size={18} />}
          sx={{ textTransform: "none" }}
          onClick={handlePrint}
        >
          Print
        </Button>
        <Button
          size="small"
          variant="outlined"
          startIcon={<MaterialSymbol icon="edit" size={18} />}
          sx={{ textTransform: "none" }}
          onClick={() => navigate(`/ea-delivery/soaw/${id}`)}
        >
          Edit
        </Button>
      </Box>

      {/* Styled preview content */}
      <style>{PREVIEW_CSS}</style>
      <Box
        className="soaw-preview"
        sx={{ maxWidth: 800, mx: "auto", pb: 8 }}
        dangerouslySetInnerHTML={{ __html: bodyHtml }}
      />

      <Snackbar
        open={!!snack}
        autoHideDuration={3000}
        onClose={() => setSnack("")}
        message={snack}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </>
  );
}
