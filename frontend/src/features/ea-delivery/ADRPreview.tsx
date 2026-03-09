import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
import Divider from "@mui/material/Divider";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { ArchitectureDecision } from "@/types";

const STATUS_COLORS: Record<string, "default" | "warning" | "success" | "info"> = {
  draft: "default",
  in_review: "warning",
  signed: "info",
};

export default function ADRPreview() {
  const { t } = useTranslation(["delivery", "common"]);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down("sm"));

  const STATUS_LABELS: Record<string, string> = {
    draft: t("status.draft"),
    in_review: t("status.inReview"),
    signed: t("status.signed"),
  };

  const [adr, setAdr] = useState<ArchitectureDecision | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [snack, setSnack] = useState("");

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      try {
        const data = await api.get<ArchitectureDecision>(`/adr/${id}`);
        setAdr(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("adr.editor.error.loadFailed"));
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href).then(
      () => setSnack(t("preview.linkCopied")),
      () => setSnack(t("preview.linkCopyFailed")),
    );
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !adr) {
    return (
      <Box sx={{ maxWidth: 960, mx: "auto", py: 4 }}>
        <Alert severity="error">{error || t("preview.notFound")}</Alert>
      </Box>
    );
  }

  const sections = [
    { key: "context", label: t("adr.context"), content: adr.context },
    { key: "decision", label: t("adr.decision"), content: adr.decision },
    { key: "alternatives", label: t("adr.alternativesConsidered"), content: adr.alternatives_considered },
    { key: "consequences", label: t("adr.consequences"), content: adr.consequences },
  ];

  return (
    <>
      {/* Toolbar */}
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
        <Tooltip title={t("adr.editor.backTooltip")}>
          <IconButton onClick={() => navigate(-1)}>
            <MaterialSymbol icon="arrow_back" size={22} />
          </IconButton>
        </Tooltip>
        {!compact && <MaterialSymbol icon="gavel" size={26} color="#1976d2" />}
        <Typography
          variant={compact ? "subtitle1" : "h5"}
          sx={{ fontWeight: 700, flex: 1, minWidth: 0 }}
          noWrap
        >
          {adr.title}
        </Typography>
        <Chip
          label={adr.reference_number}
          size="small"
          variant="outlined"
          sx={{ fontFamily: "monospace" }}
        />
        <Chip
          label={STATUS_LABELS[adr.status] ?? adr.status}
          size="small"
          color={STATUS_COLORS[adr.status] ?? "default"}
        />
        <Tooltip title={t("preview.copyLink")}>
          <IconButton onClick={handleCopyLink}>
            <MaterialSymbol icon="link" size={20} />
          </IconButton>
        </Tooltip>
        {compact ? (
          <Tooltip title={t("common:actions.edit")}>
            <IconButton onClick={() => navigate(`/ea-delivery/adr/${id}`)}>
              <MaterialSymbol icon="edit" size={20} />
            </IconButton>
          </Tooltip>
        ) : (
          <Button
            size="small"
            variant="outlined"
            startIcon={<MaterialSymbol icon="edit" size={18} />}
            sx={{ textTransform: "none" }}
            onClick={() => navigate(`/ea-delivery/adr/${id}`)}
          >
            {t("common:actions.edit")}
          </Button>
        )}
      </Box>

      {/* Content */}
      <Box sx={{ maxWidth: 800, mx: "auto", px: { xs: 1, sm: 0 }, pb: 4 }}>
        {/* Reference + revision info */}
        <Box sx={{ mb: 3, display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            {adr.reference_number}
          </Typography>
          {adr.revision_number > 1 && (
            <Chip
              label={t("adr.editor.revisionLabel", { number: adr.revision_number })}
              size="small"
              variant="outlined"
            />
          )}
        </Box>

        <Typography variant="h5" sx={{ fontWeight: 600, mb: 3 }}>
          {adr.title}
        </Typography>

        {/* Sections */}
        {sections.map(({ key, label, content }) => (
          <Box key={key} sx={{ mb: 4 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
              {label}
            </Typography>
            {content ? (
              <Box
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content) }}
                sx={{
                  "& p": { mt: 0, mb: 1 },
                  "& ul, & ol": { pl: 3 },
                  lineHeight: 1.7,
                }}
              />
            ) : (
              <Typography variant="body2" color="text.secondary" fontStyle="italic">
                -
              </Typography>
            )}
          </Box>
        ))}

        {/* Linked Cards */}
        {(adr.linked_cards ?? []).length > 0 && (
          <Box sx={{ mb: 4 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
              {t("adr.linkedCards")}
            </Typography>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              {adr.linked_cards!.map((card) => (
                <Chip
                  key={card.id}
                  label={card.name}
                  size="small"
                  variant="outlined"
                  onClick={() => navigate(`/cards/${card.id}`)}
                  sx={{ cursor: "pointer" }}
                />
              ))}
            </Box>
          </Box>
        )}

        {/* Signatories */}
        {(adr.signatories ?? []).length > 0 && (
          <>
            <Divider sx={{ mb: 3 }} />
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
              <MaterialSymbol
                icon={adr.status === "signed" ? "verified" : "draw"}
                size={24}
                color={adr.status === "signed" ? "#2e7d32" : "#ed6c02"}
              />
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                {t("adr.editor.signatures")}
              </Typography>
              {adr.status === "signed" && (
                <Chip label={t("adr.editor.fullySigned")} size="small" color="success" />
              )}
            </Box>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                gap: 2,
              }}
            >
              {adr.signatories.map((sig) => (
                <Box
                  key={sig.user_id}
                  sx={{
                    p: 2,
                    border: "1px solid",
                    borderColor: sig.status === "signed" ? "success.light" : "divider",
                    borderRadius: 1,
                    bgcolor: sig.status === "signed" ? "success.50" : "action.hover",
                  }}
                >
                  {sig.status === "signed" ? (
                    <>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                        <MaterialSymbol icon="verified" size={20} color="#2e7d32" />
                        <Typography variant="subtitle2" sx={{ fontWeight: 700, color: "success.dark" }}>
                          {t("adr.editor.sigApproved")}
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
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                        {t("adr.editor.sigSignedAt", {
                          date: sig.signed_at ? new Date(sig.signed_at).toLocaleString() : "N/A",
                        })}
                      </Typography>
                    </>
                  ) : (
                    <>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                        <MaterialSymbol icon="pending" size={20} color="#ed6c02" />
                        <Typography variant="subtitle2" sx={{ fontWeight: 700, color: "warning.dark" }}>
                          {t("adr.editor.sigPending")}
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
          </>
        )}
      </Box>

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
