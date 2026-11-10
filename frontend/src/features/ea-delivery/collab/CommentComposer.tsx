/**
 * Writes a comment: a new thread (with a section to tag it to), a reply, or
 * an edit. The editor is the comment variant of `RichTextEditor` — the marks
 * the server keeps (paragraphs, bold, italic, strike, code, lists, quotes,
 * links) and "@" mentions of cards, decisions and people. Ctrl/Cmd+Enter or
 * the button submits; nothing submits while a post is in flight. A refusal
 * is shown under the editor.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import type { DocumentThreadWrite } from "@/types";
import RichTextEditor from "../RichTextEditor";
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
}

export default function CommentComposer({
  sections,
  initialBody = "",
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
}: Props) {
  const { t } = useTranslation(["delivery", "common"]);
  const [body, setBody] = useState(initialBody);
  // Bumped after a post to give the editor a fresh, empty document.
  const [editorKey, setEditorKey] = useState(0);
  const [section, setSection] = useState(sections?.[0]?.key ?? "");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");

  const blank = isBlankHtml(body);

  const submit = async () => {
    if (posting || blank) return;
    setPosting(true);
    setError("");
    try {
      await onSubmit(body, section);
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
          onChange={(e) => setSection(e.target.value)}
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
        content={body}
        onChange={setBody}
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
          <Button size="small" onClick={onCancel} disabled={posting}>
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
