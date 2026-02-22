import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import DOMPurify from "dompurify";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import CircularProgress from "@mui/material/CircularProgress";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import Divider from "@mui/material/Divider";
import MaterialSymbol from "@/components/MaterialSymbol";
import { buildPreviewBody, exportToPdf, PREVIEW_CSS } from "./soawExport";
import { api } from "@/api/client";
import type { SoAW, SoAWSectionData } from "@/types";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  in_review: "In Review",
  approved: "Approved",
  signed: "Signed",
};

const STATUS_COLORS: Record<string, "default" | "warning" | "success" | "info"> = {
  draft: "default",
  in_review: "warning",
  approved: "success",
  signed: "info",
};

export default function SoAWPreview() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down("sm"));

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
  const bodyHtml = buildPreviewBody(soaw.name, docInfo, versionHistory, templateSections, customSections, soaw.revision_number);

  const handleExportPdf = () =>
    exportToPdf(soaw.name, docInfo, versionHistory, templateSections, customSections, soaw.revision_number, soaw.signatories, soaw.signed_at);

  return (
    <>
      {/* Toolbar (hidden when printing) */}
      <Box
        className="no-print"
        sx={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
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
        {!compact && <MaterialSymbol icon="description" size={26} color="#e65100" />}
        <Typography
          variant={compact ? "subtitle1" : "h5"}
          sx={{ fontWeight: 700, flex: 1, minWidth: 0 }}
          noWrap
        >
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
        {compact ? (
          <Tooltip title="Export PDF">
            <IconButton onClick={handleExportPdf}>
              <MaterialSymbol icon="picture_as_pdf" size={20} />
            </IconButton>
          </Tooltip>
        ) : (
          <Button
            size="small"
            startIcon={<MaterialSymbol icon="picture_as_pdf" size={18} />}
            sx={{ textTransform: "none" }}
            onClick={handleExportPdf}
          >
            PDF
          </Button>
        )}
        {compact ? (
          <Tooltip title="Edit">
            <IconButton onClick={() => navigate(`/ea-delivery/soaw/${id}`)}>
              <MaterialSymbol icon="edit" size={20} />
            </IconButton>
          </Tooltip>
        ) : (
          <Button
            size="small"
            variant="outlined"
            startIcon={<MaterialSymbol icon="edit" size={18} />}
            sx={{ textTransform: "none" }}
            onClick={() => navigate(`/ea-delivery/soaw/${id}`)}
          >
            Edit
          </Button>
        )}
      </Box>

      {/* Styled preview content */}
      <style>{PREVIEW_CSS}</style>
      <Box
        className="soaw-preview"
        sx={{ maxWidth: 800, mx: "auto", px: { xs: 1, sm: 0 } }}
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(bodyHtml) }}
      />

      {/* Signature Block */}
      {(soaw.signatories ?? []).length > 0 && (
        <Box
          sx={{
            maxWidth: 800,
            mx: "auto",
            px: { xs: 1, sm: 0 },
            pb: 8,
            mt: 4,
          }}
        >
          <Divider sx={{ mb: 3 }} />
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
            <MaterialSymbol
              icon={soaw.status === "signed" ? "verified" : "draw"}
              size={24}
              color={soaw.status === "signed" ? "#2e7d32" : "#ed6c02"}
            />
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Signatures
            </Typography>
            {soaw.status === "signed" && (
              <Chip label="Fully Signed" size="small" color="success" />
            )}
          </Box>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
              gap: 2,
            }}
          >
            {soaw.signatories.map((sig) => (
              <Box
                key={sig.user_id}
                sx={{
                  p: 2,
                  border: "1px solid",
                  borderColor:
                    sig.status === "signed" ? "success.light" : "divider",
                  borderRadius: 1,
                  bgcolor:
                    sig.status === "signed" ? "success.50" : "action.hover",
                }}
              >
                {sig.status === "signed" ? (
                  <>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        mb: 1,
                      }}
                    >
                      <MaterialSymbol icon="verified" size={20} color="#2e7d32" />
                      <Typography
                        variant="subtitle2"
                        sx={{ fontWeight: 700, color: "success.dark" }}
                      >
                        Approved
                      </Typography>
                    </Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {sig.display_name}
                    </Typography>
                    {sig.email && (
                      <Typography variant="caption" color="text.secondary">
                        {sig.email}
                      </Typography>
                    )}
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block", mt: 0.5 }}
                    >
                      Signed:{" "}
                      {sig.signed_at
                        ? new Date(sig.signed_at).toLocaleString()
                        : "N/A"}
                    </Typography>
                  </>
                ) : (
                  <>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        mb: 1,
                      }}
                    >
                      <MaterialSymbol icon="pending" size={20} color="#ed6c02" />
                      <Typography
                        variant="subtitle2"
                        sx={{ fontWeight: 700, color: "warning.dark" }}
                      >
                        Pending
                      </Typography>
                    </Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {sig.display_name}
                    </Typography>
                    {sig.email && (
                      <Typography variant="caption" color="text.secondary">
                        {sig.email}
                      </Typography>
                    )}
                  </>
                )}
              </Box>
            ))}
          </Box>
        </Box>
      )}

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
