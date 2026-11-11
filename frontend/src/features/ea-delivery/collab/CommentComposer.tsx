/**
 * Writes a comment: a new thread (tagged to a section with a row of chips,
 * none chosen being a general thread), a reply, or an edit. A long list of
 * sections (a SoAW's) shows the sections already used in the discussion and
 * the chosen one, the rest behind a "More…" chip that opens a searchable
 * list. The editor is the comment variant of `RichTextEditor` — the marks
 * the server keeps (paragraphs, bold, italic, strike, code, lists, quotes,
 * links) and "@" mentions of cards, decisions and people. Ctrl/Cmd+Enter or
 * the button submits; nothing submits while a post is in flight. A refusal
 * is shown under the editor. With a `draftKey`, the unsent text (and the
 * section picked) is kept in memory until it is posted or cancelled, so it
 * comes back when the composer is shown again.
 */
import { useContext, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Autocomplete from "@mui/material/Autocomplete";
import Chip from "@mui/material/Chip";
import Popover from "@mui/material/Popover";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { DocumentThreadWrite } from "@/types";
import RichTextEditor from "../RichTextEditor";
import { DocumentMentionContext } from "../mentions/documentMentionContext";
import { clearDraft, readDraft, writeDraft } from "./commentDrafts";
import {
  GENERAL_SECTION,
  composerSectionChips,
  isBlankHtml,
  writeErrorMessage,
  type SectionOption,
} from "./discussionModel";

/** What "@" offers in a comment. */
const COMMENT_MENTIONS: ("card" | "decision" | "user")[] = ["card", "decision", "user"];

interface Props {
  /** Sections a new thread can be tagged to; absent on a reply or an edit. */
  sections?: SectionOption[];
  /** The sections the discussion's threads already carry: a long list shows these as chips. */
  usedSections?: (string | null)[];
  initialBody?: string;
  placeholder: string;
  submitLabel: string;
  onSubmit: (body: string, section: string) => Promise<DocumentThreadWrite | void>;
  onCancel?: () => void;
  /** Where the unsent text is kept (`commentDrafts.draftKey`); none: not kept. */
  draftKey?: string;
}

export default function CommentComposer({
  sections,
  usedSections = [],
  initialBody = "",
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
  draftKey,
}: Props) {
  const { t } = useTranslation(["delivery", "common"]);
  const mentionContext = useContext(DocumentMentionContext);
  const [draft] = useState(() => (draftKey ? readDraft(draftKey) : undefined));
  const [body, setBody] = useState(draft?.body ?? initialBody);
  // Bumped after a post to give the editor a fresh, empty document.
  const [editorKey, setEditorKey] = useState(0);
  // "" is a general thread (no chip chosen).
  const [section, setSection] = useState(() => {
    const kept = draft?.section;
    return kept && kept !== GENERAL_SECTION && sections?.some((s) => s.key === kept) ? kept : "";
  });
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  const groupLabelId = useId();
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");

  const blank = isBlankHtml(body);
  const { chips, more } = composerSectionChips(sections ?? [], usedSections, section);

  const keep = (next: { body: string; section: string }) => {
    if (draftKey) writeDraft(draftKey, sections ? next : { body: next.body });
  };
  const changeBody = (next: string) => {
    setBody(next);
    keep({ body: next, section });
  };
  const changeSection = (next: string) => {
    setSection(next);
    keep({ body, section: next });
  };
  const cancel = () => {
    if (draftKey) clearDraft(draftKey);
    onCancel?.();
  };

  const submit = async () => {
    if (posting || blank) return;
    setPosting(true);
    setError("");
    try {
      await onSubmit(body, section);
      if (draftKey) clearDraft(draftKey);
      if (!onCancel) {
        setBody("");
        setEditorKey((k) => k + 1);
      }
    } catch (err) {
      setError(writeErrorMessage(err, t("collab.discussion.error.postFailed")));
    } finally {
      setPosting(false);
    }
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {(chips.length > 0 || more.length > 0) && (
        <Box
          role="group"
          aria-labelledby={groupLabelId}
          sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.5 }}
        >
          <Typography id={groupLabelId} variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
            {t("collab.discussion.sectionChips")}
          </Typography>
          {chips.map((s) => {
            const chosen = s.key === section;
            return (
              <Chip
                key={s.key}
                size="small"
                label={s.label}
                color={chosen ? "primary" : "default"}
                variant={chosen ? "filled" : "outlined"}
                aria-pressed={chosen}
                onClick={() => changeSection(chosen ? "" : s.key)}
              />
            );
          })}
          {more.length > 0 && (
            <Chip
              size="small"
              variant="outlined"
              icon={<MaterialSymbol icon="add" size={16} />}
              label={t("collab.discussion.moreSections")}
              aria-haspopup="dialog"
              onClick={(e) => setMoreAnchor(e.currentTarget)}
            />
          )}
        </Box>
      )}
      <Popover
        open={moreAnchor !== null}
        anchorEl={moreAnchor}
        onClose={() => setMoreAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        disableRestoreFocus
      >
        <Box sx={{ p: 1.5, width: 300, minHeight: 300 }}>
          <Autocomplete
            open
            disablePortal
            slotProps={{ listbox: { sx: { maxHeight: 240 } } }}
            options={more}
            getOptionLabel={(o) => o.label}
            isOptionEqualToValue={(a, b) => a.key === b.key}
            value={null}
            onChange={(_e, picked) => {
              if (!picked) return;
              changeSection(picked.key);
              setMoreAnchor(null);
            }}
            renderInput={(params) => (
              <TextField {...params} autoFocus size="small" label={t("collab.discussion.findSection")} />
            )}
          />
        </Box>
      </Popover>
      <RichTextEditor
        key={editorKey}
        variant="comment"
        mentions={COMMENT_MENTIONS}
        mentionContext={mentionContext}
        content={body}
        onChange={changeBody}
        onSubmit={() => void submit()}
        placeholder={placeholder}
      />
      {error && (
        <Alert severity="error" onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1 }}>
        {onCancel && (
          <Button size="small" onClick={cancel} disabled={posting}>
            {t("common:actions.cancel")}
          </Button>
        )}
        <Button size="small" variant="contained" onClick={() => void submit()} disabled={posting || blank}>
          {posting ? t("collab.discussion.posting") : submitLabel}
        </Button>
      </Box>
    </Box>
  );
}
