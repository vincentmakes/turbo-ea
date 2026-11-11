/**
 * One discussion thread: its opening comment, its replies, and the actions
 * the server allows on each (`can.*`). A rejection reason is marked as one
 * (an empty reason reads "No reason given"); a signing note is marked as one
 * and has nothing to resolve; neither is ever offered for edit or delete
 * here. Its section chip, when it has one, can be clicked (the discussion
 * filters on it). A deleted comment shrinks to one small muted line (its
 * author, its date, "Comment deleted"). A thread whose first comment
 * is deleted is closed: its replies stay, but it offers no reply, resolve or
 * reopen (a reply draft kept for it is dropped); with nothing live left it is
 * that one line alone, without the card. A reply or an edit left unsent is
 * kept (`commentDrafts`) and reopens with the thread.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useDateFormat } from "@/hooks/useDateFormat";
import { fillMentionLabels } from "@/lib/mentionHtml";
import { sanitizeRichHtml } from "@/lib/richHtml";
import type { DocumentComment, DocumentOwner, DocumentThread, DocumentThreadWrite } from "@/types";
import MentionContainer from "../mentions/MentionContainer";
import { useMentionLabels } from "../mentions/mentionLabels";
import CommentComposer from "./CommentComposer";
import { clearDraft, draftKey, readDraft } from "./commentDrafts";
import {
  authorName,
  hasLiveComment,
  rejectionBodyOrFallback,
  threadClosed,
  writeErrorMessage,
} from "./discussionModel";

export interface ThreadActions {
  onReply: (thread: DocumentThread, body: string) => Promise<DocumentThreadWrite>;
  onEdit: (thread: DocumentThread, commentId: string, body: string) => Promise<DocumentThreadWrite>;
  onDelete: (thread: DocumentThread, commentId: string) => Promise<void>;
  onResolve: (thread: DocumentThread) => Promise<void>;
  onReopen: (thread: DocumentThread) => Promise<void>;
}

interface Props extends ThreadActions {
  thread: DocumentThread;
  /** The thread's section tag, already labelled; null when untagged. */
  sectionLabel: string | null;
  /** A click on the section chip (the discussion turns that section's filter on). */
  onSectionClick?: () => void;
  /** The reader may post (and so reply). */
  canComment: boolean;
  /** Opened from a notification: drawn out. */
  highlighted?: boolean;
  /** The document, to keep unsent replies and edits per document. */
  owner?: DocumentOwner;
}

/** Edit and delete are for plain comments only, as the server allows. */
function editable(comment: DocumentComment): boolean {
  return comment.kind === "comment" && !comment.deleted && comment.can.edit;
}

function deletable(comment: DocumentComment): boolean {
  return comment.kind === "comment" && !comment.deleted && comment.can.delete;
}

/** What separates the parts of a deleted comment's line. */
const DOT = " · ";

export default function CommentThread({
  thread,
  sectionLabel,
  onSectionClick,
  canComment,
  highlighted = false,
  owner,
  onReply,
  onEdit,
  onDelete,
  onResolve,
  onReopen,
}: Props) {
  const { t } = useTranslation(["delivery", "common"]);
  const { formatDateTime } = useDateFormat();
  const labels = useMentionLabels();
  const replyKey = owner ? draftKey(owner, { kind: "reply", threadId: thread.id }) : undefined;
  const editKey = (commentId: string) => (owner ? draftKey(owner, { kind: "edit", commentId }) : undefined);
  const hasDraft = (key: string | undefined) => key !== undefined && readDraft(key) !== undefined;
  // An edit or a reply left unsent reopens where it was.
  const [editing, setEditing] = useState<string | null>(
    () => [thread, ...thread.replies].find((c) => editable(c) && hasDraft(editKey(c.id)))?.id ?? null,
  );
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const closed = threadClosed(thread);
  const [replying, setReplying] = useState(() => !closed && hasDraft(replyKey));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isRejection = thread.kind === "rejection";
  const isSignNote = thread.kind === "sign_note";
  const resolved = thread.resolved_at !== null;
  const canResolve = thread.can.resolve && !isSignNote && !closed;
  const canReply = canComment && !closed;

  // A closed thread takes no reply: a draft kept for it is dropped, not reopened.
  useEffect(() => {
    if (closed && replyKey) clearDraft(replyKey);
  }, [closed, replyKey]);

  const act = async (fn: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(writeErrorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const indent = (isReply: boolean) => ({
    pl: isReply ? 2 : 0,
    borderLeft: isReply ? "2px solid" : "none",
    borderColor: "divider",
  });

  /**
   * A deleted comment: one small muted line, its author and date, nothing to
   * act on. It is running text, not a row of boxes, so it stays on one line
   * in the panel and breaks between words on a narrower one.
   */
  const renderDeleted = (comment: DocumentComment, isReply: boolean) => (
    <Typography
      key={comment.id}
      data-testid={`deleted-${comment.id}`}
      variant="caption"
      color="text.secondary"
      component="div"
      sx={{ ...indent(isReply), lineHeight: 1.5 }}
    >
      {authorName(comment, t("collab.unknownPerson"))}
      {DOT}
      {formatDateTime(comment.created_at)}
      {DOT}
      <Box component="span" sx={{ fontStyle: "italic" }}>
        {t("collab.discussion.deleted")}
      </Box>
    </Typography>
  );

  const renderComment = (comment: DocumentComment, isReply: boolean) =>
    comment.deleted ? renderDeleted(comment, isReply) : renderLive(comment, isReply);

  const renderLive = (comment: DocumentComment, isReply: boolean) => (
    <Box key={comment.id} sx={indent(isReply)}>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, flexWrap: "wrap" }}>
        <Typography variant="subtitle2" component="span">
          {authorName(comment, t("collab.unknownPerson"))}
        </Typography>
        <Typography variant="caption" color="text.secondary" component="span">
          {formatDateTime(comment.created_at)}
        </Typography>
        {comment.edited_at && (
          <Typography variant="caption" color="text.secondary" component="span">
            {t("collab.discussion.edited")}
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        {editable(comment) && (
          <Tooltip title={t("common:actions.edit")}>
            <IconButton size="small" onClick={() => setEditing(comment.id)} disabled={busy}>
              <MaterialSymbol icon="edit" size={16} />
            </IconButton>
          </Tooltip>
        )}
        {deletable(comment) && (
          <Tooltip title={t("common:actions.delete")}>
            <IconButton size="small" onClick={() => setConfirmDelete(comment.id)} disabled={busy}>
              <MaterialSymbol icon="delete_outline" size={16} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      {editing === comment.id ? (
        <CommentComposer
          initialBody={comment.body}
          draftKey={editKey(comment.id)}
          placeholder={t("collab.discussion.editPlaceholder")}
          submitLabel={t("common:actions.save")}
          onSubmit={async (body) => {
            const reply = await onEdit(thread, comment.id, body);
            setEditing(null);
            return reply;
          }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <MentionContainer>
          <Box
            sx={{ typography: "body2", "& p": { my: 0.5 }, "& ul, & ol": { pl: 3, my: 0.5 }, wordBreak: "break-word" }}
            dangerouslySetInnerHTML={{
              __html: sanitizeRichHtml(
                fillMentionLabels(rejectionBodyOrFallback(comment, t("collab.discussion.noReason")), labels),
              ),
            }}
          />
        </MentionContainer>
      )}
      {confirmDelete === comment.id && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5 }}>
          <Typography variant="caption" sx={{ flex: 1 }}>
            {t("collab.discussion.confirmDelete")}
          </Typography>
          <Button size="small" onClick={() => setConfirmDelete(null)} disabled={busy}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            size="small"
            color="error"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await onDelete(thread, comment.id);
                setConfirmDelete(null);
              }, t("collab.discussion.error.deleteFailed"))
            }
          >
            {t("common:actions.delete")}
          </Button>
        </Box>
      )}
    </Box>
  );

  // Nothing live left: the one small line alone, no card.
  if (!hasLiveComment(thread)) {
    return (
      <Box
        id={`thread-${thread.id}`}
        data-testid={`thread-${thread.id}`}
        data-compact="true"
        sx={{ px: 0.5, bgcolor: highlighted ? "action.selected" : undefined, borderRadius: 1 }}
      >
        {renderDeleted(thread, false)}
      </Box>
    );
  }

  return (
    <Box
      id={`thread-${thread.id}`}
      data-testid={`thread-${thread.id}`}
      sx={{
        p: 1.5,
        border: "1px solid",
        borderColor: highlighted ? "primary.main" : isRejection ? "error.main" : "divider",
        borderLeftWidth: isRejection || isSignNote ? 4 : 1,
        borderLeftColor: isRejection ? "error.main" : isSignNote ? "success.main" : undefined,
        borderRadius: 1,
        bgcolor: highlighted ? "action.selected" : "background.paper",
        opacity: resolved ? 0.85 : 1,
        display: "flex",
        flexDirection: "column",
        gap: 1,
      }}
    >
      {(isRejection || isSignNote || sectionLabel || resolved) && (
        <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
          {isRejection && (
            <Chip
              size="small"
              color="error"
              variant="outlined"
              icon={<MaterialSymbol icon="block" size={14} />}
              label={t("collab.discussion.rejectionReason")}
            />
          )}
          {isSignNote && (
            <Chip
              size="small"
              color="success"
              variant="outlined"
              icon={<MaterialSymbol icon="draw" size={14} />}
              label={t("collab.discussion.signNote")}
            />
          )}
          {sectionLabel && (
            <Chip size="small" variant="outlined" label={sectionLabel} onClick={onSectionClick} />
          )}
          {resolved && (
            <Chip
              size="small"
              icon={<MaterialSymbol icon="check" size={14} />}
              label={
                thread.resolved_by
                  ? t("collab.discussion.resolvedBy", { name: thread.resolved_by.display_name })
                  : t("collab.discussion.resolved")
              }
            />
          )}
        </Box>
      )}

      {renderComment(thread, false)}
      {thread.replies.map((reply) => renderComment(reply, true))}

      {error && (
        <Alert severity="error" onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {replying && !closed ? (
        <CommentComposer
          draftKey={replyKey}
          placeholder={t("collab.discussion.replyPlaceholder")}
          submitLabel={t("collab.discussion.reply")}
          onSubmit={async (body) => {
            const reply = await onReply(thread, body);
            setReplying(false);
            return reply;
          }}
          onCancel={() => setReplying(false)}
        />
      ) : (
        (canReply || canResolve) && (
          <Box sx={{ display: "flex", gap: 1 }}>
            {canReply && (
              <Button size="small" onClick={() => setReplying(true)} disabled={busy}>
                {t("collab.discussion.reply")}
              </Button>
            )}
            {canResolve && (
              <Button
                size="small"
                disabled={busy}
                onClick={() =>
                  void act(
                    () => (resolved ? onReopen(thread) : onResolve(thread)),
                    t("collab.discussion.error.resolveFailed"),
                  )
                }
              >
                {resolved ? t("collab.discussion.reopen") : t("collab.discussion.resolve")}
              </Button>
            )}
          </Box>
        )
      )}
    </Box>
  );
}
