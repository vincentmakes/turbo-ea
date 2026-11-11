import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate } from "react-router";
import { sanitizeRichHtml } from "@/lib/richHtml";
import { fillMentionLabels } from "@/lib/mentionHtml";
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
import { alpha, useTheme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import LinkifiedText from "@/components/LinkifiedText";
import { api } from "@/api/client";
import { useAbortableEffect } from "@/hooks/useLatestRequest";
import { useDateFormat } from "@/hooks/useDateFormat";
import { usePageSubject } from "@/hooks/usePageTitle";
import { useAuth } from "@/hooks/useAuth";
import { hasPermission } from "@/components/RequirePermission";
import { ExtensionBoundary, ExtensionSlot, useExtensionAdrPanels } from "@/lib/extensionHost";
import { printAdr } from "./adrPrint";
import DecisionBanners from "./DecisionBanners";
import RevisionStrip, { decisionRevisionItems, showsRevisionStrip } from "./RevisionStrip";
import DecisionPeopleField from "./DecisionPeopleField";
import DecisionLinksBlock from "./DecisionLinksBlock";
import DecisionFilesSection from "./DecisionFilesSection";
import { DecisionStandingChip, DecisionStatusChip } from "./DecisionStandingChip";
import { DATE_LABEL_KEYS, decisionRefLabel } from "./decisionStanding";
import { currentRevisionId } from "./adrEditorModel";
import MentionContainer from "./mentions/MentionContainer";
import { useMentionLabels } from "./mentions/mentionLabels";
import DocumentHistoryButton from "./collab/DocumentHistoryButton";
import DocumentSidePanel from "./collab/DocumentSidePanel";
import SectionDiscussionMarker from "./collab/SectionDiscussionMarker";
import { documentPeopleIds } from "./mentions/mentionModel";
import MentionedInList from "./collab/MentionedInList";
import { sectionOptions } from "./collab/discussionModel";
import type { ArchitectureDecision } from "@/types";
import { RAG_COLORS, WARNING_STRONG_COLOR, brand } from "@/theme/tokens";

const DATE_FIELDS = ["decided_on", "effective_from", "valid_until"] as const;

/** Pointers on the preview open the other decision's preview. */
const previewHref = (id: string) => `/ea-delivery/adr/${id}/preview`;

export default function ADRPreview() {
  const { t } = useTranslation(["delivery", "common"]);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { formatDate, formatDateTime } = useDateFormat();
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down("sm"));
  const { user } = useAuth();
  const adrPanels = useExtensionAdrPanels();
  const mentionLabels = useMentionLabels();

  const [adr, setAdr] = useState<ArchitectureDecision | null>(null);
  usePageSubject(adr?.title);
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
        const data = await api.get<ArchitectureDecision>(`/adr/${id}`, { signal });
        if (isCurrent()) setAdr(data);
      } catch (e) {
        if (isCurrent()) setError(e instanceof Error ? e.message : t("adr.editor.error.loadFailed"));
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

  if (error || !adr) {
    return (
      <Box sx={{ maxWidth: 960, mx: "auto", py: 4 }}>
        <Alert severity="error">{error || t("adr.editor.error.notFound")}</Alert>
      </Box>
    );
  }

  const sections = [
    { key: "context", label: t("adr.context"), content: adr.context },
    { key: "decision", label: t("adr.decision"), content: adr.decision },
    { key: "alternatives_considered", label: t("adr.alternativesConsidered"), content: adr.alternatives_considered },
    { key: "consequences", label: t("adr.consequences"), content: adr.consequences },
  ];

  const stripItems = decisionRevisionItems(adr.revisions ?? [], t);
  const stripShown = showsRevisionStrip(stripItems);
  const historyButton = (placeCompact: boolean) =>
    id ? (
      <DocumentHistoryButton<ArchitectureDecision>
        owner={{ kind: "adr", id }}
        label={`${decisionRefLabel(adr, t)} · ${adr.title}`}
        status={adr.status}
        refreshKey={adr.updated_at ?? undefined}
        onRestored={(restored) => setAdr(restored)}
        compact={placeCompact}
      />
    ) : null;

  return (
    <>
      <DocumentSidePanel
        owner={id ? { kind: "adr", id } : null}
        sections={sectionOptions("adr", t)}
        openThreadCount={adr.open_thread_count}
        refreshKey={adr.updated_at ?? undefined}
        mentionContext={{
          linkedCardIds: (adr.linked_cards ?? []).map((c) => c.id),
          priorityUserIds: documentPeopleIds(adr),
        }}
      >
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
        {!compact && <MaterialSymbol icon="gavel" size={26} color={brand.primary} />}
        <Typography
          variant={compact ? "subtitle1" : "h5"}
          sx={{ fontWeight: 700, flex: 1, minWidth: 0 }}
          noWrap
        >
          {adr.title}
        </Typography>
        <Chip
          label={decisionRefLabel(adr, t)}
          size="small"
          variant="outlined"
          sx={{ fontFamily: "monospace" }}
        />
        <DecisionStatusChip adr={adr} />
        <DecisionStandingChip standing={adr.standing} />
        {id && (
          <ExtensionSlot
            name="adr.header"
            context={{
              adrId: id,
              status: adr.status,
              signed: adr.status === "signed",
              readOnly: true,
              attributes: adr.attributes ?? {},
              standing: adr.standing ?? null,
              isCurrent: adr.is_current,
            }}
          />
        )}
        {!stripShown && historyButton(compact)}
        <Tooltip title={t("preview.copyLink")}>
          <IconButton onClick={handleCopyLink}>
            <MaterialSymbol icon="link" size={20} />
          </IconButton>
        </Tooltip>
        {compact ? (
          <Tooltip title={t("editor.exportPdf")}>
            <IconButton onClick={() => printAdr(adr)}>
              <MaterialSymbol icon="picture_as_pdf" size={20} />
            </IconButton>
          </Tooltip>
        ) : (
          <Button
            size="small"
            startIcon={<MaterialSymbol icon="picture_as_pdf" size={18} />}
            sx={{ textTransform: "none" }}
            onClick={() => printAdr(adr)}
          >
            {t("editor.pdf")}
          </Button>
        )}
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
        {/* Where the decision stands, and its chain */}
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mb: 2, "&:empty": { display: "none" } }}>
          <DecisionBanners adr={adr} mode="preview" hrefFor={previewHref} />
          {stripShown && (
            <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1 }}>
              <RevisionStrip
                items={stripItems}
                activeId={adr.id}
                currentId={currentRevisionId(adr)}
                hrefFor={previewHref}
              />
              {historyButton(false)}
            </Box>
          )}
        </Box>

        {/* Reference (with its revision) */}
        <Box sx={{ mb: 3, display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            {decisionRefLabel(adr, t)}
          </Typography>
        </Box>

        <Typography variant="h5" sx={{ fontWeight: 600, mb: 3 }}>
          {adr.title}
        </Typography>

        {/* Sections */}
        <MentionContainer>
          {sections.map(({ key, label, content }) => (
            <Box key={key} sx={{ mb: 4 }}>
              <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  {label}
                </Typography>
                <SectionDiscussionMarker section={key} />
              </Box>
              {content ? (
                <Box
                  dangerouslySetInnerHTML={{
                    __html: sanitizeRichHtml(fillMentionLabels(content, mentionLabels)),
                  }}
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
        </MentionContainer>

        {/* Dates */}
        {DATE_FIELDS.some((f) => adr[f]) && (
          <Box sx={{ mb: 4 }} data-testid="preview-dates">
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
              {t("adr.dates.title")}
            </Typography>
            <Box sx={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
              {DATE_FIELDS.filter((f) => adr[f]).map((f) => (
                <Box key={f}>
                  <Typography variant="caption" color="text.secondary" component="div">
                    {t(DATE_LABEL_KEYS[f])}
                  </Typography>
                  <Typography variant="body2">{formatDate(adr[f])}</Typography>
                </Box>
              ))}
            </Box>
          </Box>
        )}

        {/* People */}
        {((adr.decision_makers ?? []).length > 0 || (adr.participants ?? []).length > 0) && (
          <Box sx={{ mb: 4, display: "flex", flexDirection: "column", gap: 1.5 }}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {t("adr.people.title")}
            </Typography>
            <DecisionPeopleField part="decision_makers" value={adr.decision_makers ?? []} readOnly />
            <DecisionPeopleField part="participants" value={adr.participants ?? []} readOnly />
          </Box>
        )}

        {/* Links to and from other decisions */}
        {((adr.links?.outgoing.length ?? 0) > 0 || (adr.links?.incoming.length ?? 0) > 0) && (
          <Box sx={{ mb: 4 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
              {t("adr.links.title")}
            </Typography>
            <DecisionLinksBlock links={adr.links} readOnly />
          </Box>
        )}

        {/* Change summary (a revision) */}
        {adr.change_summary && (
          <Box sx={{ mb: 4 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
              {t("adr.revise.changeSummary")}
            </Typography>
            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
              <LinkifiedText text={adr.change_summary} />
            </Typography>
          </Box>
        )}

        {/* Files */}
        {id && (adr.files ?? []).length > 0 && (
          <Box sx={{ mb: 4 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
              {t("adr.files.title")}
            </Typography>
            <DecisionFilesSection adrId={id} files={adr.files} editable={false} live={false} />
          </Box>
        )}

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

        {/* Decisions and SoAWs that mention this decision */}
        {id && (
          <Box sx={{ mb: 4, "&:empty": { display: "none" } }}>
            <MentionedInList target={{ kind: "decision", id }} />
          </Box>
        )}

        {/* Extension ADR panels (SDK 1.3) — read-only on the preview page */}
        {id &&
          adrPanels
            .filter(
              ({ contribution }) =>
                !contribution.permission ||
                hasPermission(user?.permissions, contribution.permission),
            )
            .map(({ extKey, contribution }) => (
              <Box
                key={`adrpanel:${extKey}:${contribution.id}`}
                sx={{ mb: 4, "&:empty": { display: "none" } }}
              >
                <ExtensionBoundary extensionKey={extKey}>
                  <contribution.component
                    adrId={id}
                    status={adr.status}
                    signed={adr.status === "signed"}
                    readOnly
                    standing={adr.standing ?? null}
                    isCurrent={adr.is_current}
                  />
                </ExtensionBoundary>
              </Box>
            ))}

        {/* Signatories */}
        {(adr.signatories ?? []).length > 0 && (
          <>
            <Divider sx={{ mb: 3 }} />
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
              <MaterialSymbol
                icon={adr.status === "signed" ? "verified" : "draw"}
                size={24}
                color={adr.status === "signed" ? RAG_COLORS.green : WARNING_STRONG_COLOR}
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
                    bgcolor:
                      sig.status === "signed"
                        ? alpha(theme.palette.success.main, 0.08)
                        : "action.hover",
                  }}
                >
                  {sig.status === "signed" ? (
                    <>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                        <MaterialSymbol icon="verified" size={20} color={RAG_COLORS.green} />
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
                          date: sig.signed_at ? formatDateTime(sig.signed_at) : "N/A",
                        })}
                      </Typography>
                    </>
                  ) : (
                    <>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                        <MaterialSymbol icon="pending" size={20} color={WARNING_STRONG_COLOR} />
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

        {/* Generic extension slot below the signature block — post-decision,
            ADR-scoped content (e.g. value-realization tracking). Read-only on
            the preview page. Renders nothing when no extension contributes. */}
        {id && (
          <ExtensionSlot
            name="adr.signature.footer"
            context={{
              adrId: id,
              status: adr.status,
              signed: adr.status === "signed",
              readOnly: true,
              attributes: adr.attributes ?? {},
              standing: adr.standing ?? null,
              isCurrent: adr.is_current,
            }}
          />
        )}
      </Box>
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
