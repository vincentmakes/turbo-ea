/**
 * One saved version of a decision or SoAW, read-only: a decision's sections,
 * dates, people and change summary; a SoAW rendered as its preview renders
 * it. Links, linked cards and files are filing, not content, and are not
 * part of a version.
 */
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Typography from "@mui/material/Typography";
import LinkifiedText from "@/components/LinkifiedText";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useDateFormat } from "@/hooks/useDateFormat";
import { fillMentionLabels } from "@/lib/mentionHtml";
import { sanitizeRichHtml } from "@/lib/richHtml";
import type {
  DecisionVersionContent,
  DocumentHistoryEntry,
  DocumentOwner,
  DocumentVersion,
  SoawVersionContent,
} from "@/types";
import { DATE_LABEL_KEYS } from "../decisionStanding";
import MentionContainer from "../mentions/MentionContainer";
import { useMentionLabels } from "../mentions/mentionLabels";
import { buildPreviewBody, PREVIEW_CSS } from "../soawExport";
import { entryTitle, peopleLine, splitSoawSections, versionPath } from "./historyModel";

const DATE_FIELDS = ["decided_on", "effective_from", "valid_until"] as const;

function DecisionVersion({ content }: { content: DecisionVersionContent }) {
  const { t } = useTranslation("delivery");
  const { formatDate } = useDateFormat();
  const labels = useMentionLabels();
  const sections = [
    { key: "context", label: t("adr.context"), html: content.context },
    { key: "decision", label: t("adr.decision"), html: content.decision },
    { key: "alternatives", label: t("adr.alternativesConsidered"), html: content.alternatives_considered },
    { key: "consequences", label: t("adr.consequences"), html: content.consequences },
  ];
  const makers = peopleLine(content.decision_makers);
  const participants = peopleLine(content.participants);
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography variant="h6">{content.title}</Typography>
      <MentionContainer>
        {sections.map(({ key, label, html }) => (
          <Box key={key} sx={{ mb: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {label}
            </Typography>
            {html ? (
              <Box
                sx={{ "& p": { mt: 0, mb: 1 }, "& ul, & ol": { pl: 3 }, lineHeight: 1.7 }}
                dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(fillMentionLabels(html, labels)) }}
              />
            ) : (
              <Typography variant="body2" color="text.secondary">
                -
              </Typography>
            )}
          </Box>
        ))}
      </MentionContainer>
      {DATE_FIELDS.some((f) => content[f]) && (
        <Box sx={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
          {DATE_FIELDS.filter((f) => content[f]).map((f) => (
            <Box key={f}>
              <Typography variant="caption" color="text.secondary" component="div">
                {t(DATE_LABEL_KEYS[f])}
              </Typography>
              <Typography variant="body2">{formatDate(content[f])}</Typography>
            </Box>
          ))}
        </Box>
      )}
      {(makers || participants) && (
        <Box>
          {makers && (
            <Typography variant="body2">
              {t("adr.people.decisionMakers")}: {makers}
            </Typography>
          )}
          {participants && (
            <Typography variant="body2">
              {t("adr.people.participants")}: {participants}
            </Typography>
          )}
        </Box>
      )}
      {content.change_summary && (
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {t("adr.revise.changeSummary")}
          </Typography>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
            <LinkifiedText text={content.change_summary} />
          </Typography>
        </Box>
      )}
    </Box>
  );
}

function SoawVersion({ content }: { content: SoawVersionContent }) {
  const { template, custom } = splitSoawSections(content.sections);
  const html = buildPreviewBody(
    content.name,
    content.document_info ?? { prepared_by: "", reviewed_by: "", review_date: "" },
    content.version_history ?? [],
    template,
    custom,
  );
  return (
    <>
      <style>{PREVIEW_CSS}</style>
      <MentionContainer>
        <Box className="soaw-preview" dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(html) }} />
      </MentionContainer>
    </>
  );
}

interface Props {
  owner: DocumentOwner;
  entry: DocumentHistoryEntry;
  onClose: () => void;
}

export default function VersionViewDialog({ owner, entry, onClose }: Props) {
  const { t } = useTranslation(["delivery", "common"]);
  const { formatDateTime } = useDateFormat();
  const { data, error } = useApiQuery<DocumentVersion>(versionPath(owner, entry.id));

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth disableRestoreFocus>
      <DialogTitle>{entryTitle(entry, t, formatDateTime)}</DialogTitle>
      <DialogContent dividers>
        {error ? (
          <Alert severity="error">{error.message || t("collab.history.versionFailed")}</Alert>
        ) : !data ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        ) : owner.kind === "soaw" ? (
          <SoawVersion content={data.content as SoawVersionContent} />
        ) : (
          <DecisionVersion content={data.content as DecisionVersionContent} />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.close")}</Button>
      </DialogActions>
    </Dialog>
  );
}
