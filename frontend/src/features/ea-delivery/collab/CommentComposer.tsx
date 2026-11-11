/**
 * Writes a comment: a new thread (with a section to tag it to), a reply, or
 * an edit. The editor is the comment variant of `RichTextEditor` — the marks
 * the server keeps (paragraphs, bold, italic, strike, code, lists, quotes,
 * links) and "@" mentions of cards, decisions and people. Ctrl/Cmd+Enter or
 * the button submits; nothing submits while a post is in flight. A refusal
 * is shown under the editor. With a `draftKey`, the unsent text (and the
 * section picked) is kept in memory until it is posted or cancelled, so it
 * comes back when the composer is shown again.
 */
import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import type { DocumentThreadWrite } from "@/types";
import RichTextEditor from "../RichTextEditor";
import { DocumentMentionContext } from "../mentions/documentMentionContext";
import { clearDraft, readDraft, writeDraft } from "./commentDrafts";
import { isBlankHtml, writeErrorMessage, type SectionOption } from "./discussionModel";

/** What "@" offers in a comment. */
const COMMENT_MENTIONS: ("card" | "decision" | "user")[] = ["card", "decision", "user"];

interface Props {
  /** Sections a new thread can be tagged to; absent on a reply or an edit. */
  sections?: SectionOption[];
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
  const [section, setSection] = useState(() => {
    const kept = draft?.section;
    return kept !== undefined && sections?.some((s) => s.key === kept) ? kept : (sections?.[0]?.key ?? "");
  });
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");

  const blank = isBlankHtml(body);

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
      {sections && sections.length > 0 && (
        <TextField
          select
          size="small"
          label={t("collab.discussion.sectionLabel")}
          value={section}
          onChange={(e) => changeSection(e.target.value)}
        >
          {sections.map((s) => (
            <MenuItem key={s.key} value={s.key}>
              {s.label}
            </MenuItem>
          ))}
        </TextField>
      )}
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
