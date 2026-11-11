import { memo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate } from "react-router";
import { sanitizeRichHtml } from "@/lib/richHtml";
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
import { alpha, useTheme } from "@mui/material/styles";
import Divider from "@mui/material/Divider";
import MaterialSymbol from "@/components/MaterialSymbol";
import { buildPreviewBody, exportToPdf, PREVIEW_CSS } from "./soawExport";
import { SoawBanners } from "./DecisionBanners";
import RevisionStrip, { showsRevisionStrip, soawRevisionItems } from "./RevisionStrip";
import { soawCurrentRevisionId } from "./soawEditorState";
import MentionContainer from "./mentions/MentionContainer";
import DocumentHistoryButton from "./collab/DocumentHistoryButton";
import DocumentSidePanel from "./collab/DocumentSidePanel";
import HtmlSectionMarkers from "./collab/HtmlSectionMarkers";
import { documentPeopleIds } from "./mentions/mentionModel";
import { sectionOptions, soawSectionOptions } from "./collab/discussionModel";
import { getTemplateSections } from "./soawTemplate";
import { api } from "@/api/client";
import { useAbortableEffect } from "@/hooks/useLatestRequest";
import { useDateFormat } from "@/hooks/useDateFormat";
import { usePageSubject } from "@/hooks/usePageTitle";
import type { SoAW, SoAWSectionData } from "@/types";
import { DELIVERABLE_COLORS, RAG_COLORS, WARNING_STRONG_COLOR } from "@/theme/tokens";

/** A revision pointer from the preview stays in the preview. */
const previewHref = (soawId: string) => `/ea-delivery/soaw/${soawId}/preview`;

const STATUS_COLORS: Record<string, "default" | "warning" | "success" | "info"> = {
  draft: "default",
  in_review: "warning",
  approved: "success",
  signed: "info",
};

/**
 * The document body, rendered from its HTML string. Memoised on that string:
 * React 19 reassigns `innerHTML` on every render that passes a new
 * `dangerouslySetInnerHTML` object, which would rebuild the body (and drop
 * the section markers' hosts) whenever anything else on the page re-renders.
 */
const PreviewBody = memo(function PreviewBody({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <MentionContainer>
      <Box
        ref={ref}
        className="soaw-preview"
        sx={{ maxWidth: 800, mx: "auto", px: { xs: 1, sm: 0 } }}
        dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(html) }}
      />
      <HtmlSectionMarkers containerRef={ref} html={html} />
    </MentionContainer>
  );
});

export default function SoAWPreview() {
  const { t } = useTranslation(["delivery", "common"]);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { formatDateTime } = useDateFormat();

  const STATUS_LABELS: Record<string, string> = {
    draft: t("status.draft"),
    in_review: t("status.inReview"),
    approved: t("status.approved"),
    signed: t("status.signed"),
  };
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down("sm"));

  const [soaw, setSoaw] = useState<SoAW | null>(null);
  usePageSubject(soaw?.name);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [snack, setSnack] = useState("");

  // Re-keyed on in-page revision navigation: only the latest load may fill
  // the page, so a late reply for the revision just left is dropped.
  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      if (!id) return;
      setLoading(true);
      setError("");
      try {
        const data = await api.get<SoAW>(`/soaw/${id}`, { signal });
        if (isCurrent()) setSoaw(data);
      } catch (e) {
        if (isCurrent()) setError(e instanceof Error ? e.message : t("editor.error.loadFailed"));
      } finally {
        if (isCurrent()) setLoading(false);
      }
    },
    [id],
  );

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

  if (error || !soaw) {
    return (
      <Box sx={{ maxWidth: 960, mx: "auto", py: 4 }}>
        <Alert severity="error">{error || t("preview.notFound")}</Alert>
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
  // On screen the section headings carry their key, for the discussion markers.
  const bodyHtml = buildPreviewBody(soaw.name, docInfo, versionHistory, templateSections, customSections, soaw.revision_number, soaw.signatories, soaw.signed_at, { sectionAnchors: true });

  const handleExportPdf = () =>
    exportToPdf(soaw.name, docInfo, versionHistory, templateSections, customSections, soaw.revision_number, soaw.signatories, soaw.signed_at);

  const stripItems = soawRevisionItems(soaw.revisions ?? [], t);
  const stripShown = showsRevisionStrip(stripItems);
  const historyButton = (placeCompact: boolean) =>
    id ? (
      <DocumentHistoryButton<SoAW>
        owner={{ kind: "soaw", id }}
        label={soaw.name}
        status={soaw.status}
        refreshKey={soaw.updated_at}
        onRestored={(restored) => setSoaw(restored)}
        compact={placeCompact}
      />
    ) : null;

  return (
    <>
      <DocumentSidePanel
        owner={id ? { kind: "soaw", id } : null}
        sections={sectionOptions("soaw", t, soawSectionOptions(getTemplateSections(), soaw.sections))}
        openThreadCount={soaw.open_thread_count}
        refreshKey={soaw.updated_at}
        mentionContext={{ priorityUserIds: documentPeopleIds(soaw) }}
      >
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
        <Tooltip title={t("preview.backTooltip")}>
          <IconButton onClick={() => navigate("/ea-delivery")}>
            <MaterialSymbol icon="arrow_back" size={22} />
          </IconButton>
        </Tooltip>
        {!compact && <MaterialSymbol icon="description" size={26} color={DELIVERABLE_COLORS.soaw} />}
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
        {!stripShown && historyButton(compact)}
        <Tooltip title={t("preview.copyLink")}>
          <IconButton onClick={handleCopyLink}>
            <MaterialSymbol icon="link" size={20} />
          </IconButton>
        </Tooltip>
        {compact ? (
          <Tooltip title={t("editor.exportPdf")}>
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
            {t("editor.pdf")}
          </Button>
        )}
        {compact ? (
          <Tooltip title={t("common:actions.edit")}>
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
            {t("common:actions.edit")}
          </Button>
        )}
      </Box>

      {/* Chain pointers and the revision strip (links open the preview). */}
      <Box
        className="no-print"
        sx={{ maxWidth: 960, mx: "auto", mb: 2, display: "flex", flexDirection: "column", gap: 1 }}
      >
        <SoawBanners soaw={soaw} mode="preview" hrefFor={previewHref} />
        {stripShown && (
          <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1 }}>
            <RevisionStrip
              items={stripItems}
              activeId={soaw.id}
              currentId={soawCurrentRevisionId(soaw)}
              hrefFor={previewHref}
            />
            {historyButton(false)}
          </Box>
        )}
      </Box>

      {/* Styled preview content */}
      <style>{PREVIEW_CSS}</style>
      <PreviewBody html={bodyHtml} />

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
              color={soaw.status === "signed" ? RAG_COLORS.green : WARNING_STRONG_COLOR}
            />
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {t("editor.signatures")}
            </Typography>
            {soaw.status === "signed" && (
              <Chip label={t("editor.fullySigned")} size="small" color="success" />
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
                    sig.status === "signed"
                      ? alpha(theme.palette.success.main, 0.08)
                      : "action.hover",
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
                      <MaterialSymbol icon="verified" size={20} color={RAG_COLORS.green} />
                      <Typography
                        variant="subtitle2"
                        sx={{ fontWeight: 700, color: "success.dark" }}
                      >
                        {t("editor.sigApproved")}
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
                      {t("editor.sigSignedAt", { date: sig.signed_at
                        ? formatDateTime(sig.signed_at)
                        : "N/A" })}
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
                      <MaterialSymbol icon="pending" size={20} color={WARNING_STRONG_COLOR} />
                      <Typography
                        variant="subtitle2"
                        sx={{ fontWeight: 700, color: "warning.dark" }}
                      >
                        {t("editor.sigPending")}
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
      </DocumentSidePanel>

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
