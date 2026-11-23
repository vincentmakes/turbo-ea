import { useState, useCallback, useEffect } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import LinkifiedText from "@/components/LinkifiedText";
import MaterialSymbol from "@/components/MaterialSymbol";
import OriginChip from "@/components/OriginChip";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import MuiCard from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import { useTranslation } from "react-i18next";
import { ApiError, api } from "@/api/client";
import { useDateFormat } from "@/hooks/useDateFormat";
import type { Comment as CommentType } from "@/types";

/** Every reply under a comment, at any depth: deleting it deletes them all. */
function countReplies(c: CommentType): number {
  return (c.replies ?? []).reduce((n, r) => n + 1 + countReplies(r), 0);
}

// ── Tab: Comments ───────────────────────────────────────────────
// Who may delete a comment is the server's answer (`can.delete`: its author,
// or anyone allowed to manage comments on the card), so the tab needs no
// permission prop and no user id of its own.
function CommentsTab({ fsId, canCreateComments = true }: { fsId: string; canCreateComments?: boolean }) {
  const { t } = useTranslation(["cards", "common"]);
  const { formatDateTime } = useDateFormat();
  const [comments, setComments] = useState<CommentType[]>([]);
  const [newComment, setNewComment] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const load = useCallback(() => {
    api
      .get<CommentType[]>(`/cards/${fsId}/comments`)
      .then(setComments)
      .catch(() => {});
  }, [fsId]);
  useEffect(load, [load]);

  const handleAdd = async () => {
    if (!newComment.trim()) return;
    await api.post(`/cards/${fsId}/comments`, { content: newComment });
    setNewComment("");
    load();
  };

  const askDelete = (id: string) => {
    setDeleteError("");
    setConfirmDelete(id);
  };

  const handleDelete = async (id: string) => {
    setBusy(true);
    setDeleteError("");
    try {
      await api.delete(`/comments/${id}`);
      setConfirmDelete(null);
      load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // Already gone (deleted elsewhere): nothing to retry, show the list as
        // it is. If even that fails (the card became hidden), say so rather
        // than close on a list that still shows the comment.
        try {
          setComments(await api.get<CommentType[]>(`/cards/${fsId}/comments`));
          setConfirmDelete(null);
        } catch {
          setDeleteError(t("comments.deleteFailed"));
        }
      } else {
        setDeleteError(t("comments.deleteFailed"));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box>
      {canCreateComments && (
        <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
          <TextField
            fullWidth
            size="small"
            placeholder={t("comments.placeholder")}
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <Button
            variant="contained"
            onClick={handleAdd}
            disabled={!newComment.trim()}
          >
            {t("comments.post")}
          </Button>
        </Box>
      )}
      {comments.length === 0 && (
        <Typography color="text.secondary" variant="body2">
          {t("comments.empty")}
        </Typography>
      )}
      {comments.map((c) => (
        <MuiCard key={c.id} sx={{ mb: 1 }}>
          <CardContent sx={{ py: 1, "&:last-child": { pb: 1 } }}>
            <Box
              sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}
            >
              <Typography variant="subtitle2">
                {c.user_display_name || t("stakeholders.user")}
              </Typography>
              <OriginChip origin={c.created_via} />
              <Typography variant="caption" color="text.secondary">
                {c.created_at ? formatDateTime(c.created_at) : ""}
              </Typography>
              {c.can?.delete && (
                // describeChild: the tooltip describes rather than names its
                // child, so no aria-label lands on the span; the button keeps
                // its own name.
                <Tooltip title={t("common:actions.delete")} describeChild>
                  {/* A disabled button fires no events: the span keeps the tooltip working. */}
                  <Box component="span" sx={{ ml: "auto" }}>
                    <IconButton
                      size="small"
                      aria-label={t("common:actions.delete")}
                      onClick={() => askDelete(c.id)}
                      disabled={busy}
                    >
                      <MaterialSymbol icon="delete_outline" size={16} />
                    </IconButton>
                  </Box>
                </Tooltip>
              )}
            </Box>
            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
              <LinkifiedText text={c.content} />
            </Typography>
            {confirmDelete === c.id && (
              <Box sx={{ mt: 0.5 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Typography variant="caption" sx={{ flex: 1 }}>
                    {countReplies(c) > 0
                      ? t("comments.confirmDeleteWithReplies", { count: countReplies(c) })
                      : t("comments.confirmDelete")}
                  </Typography>
                  <Button size="small" onClick={() => setConfirmDelete(null)} disabled={busy}>
                    {t("common:actions.cancel")}
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    disabled={busy}
                    onClick={() => void handleDelete(c.id)}
                  >
                    {t("common:actions.delete")}
                  </Button>
                </Box>
                {deleteError && (
                  <Typography variant="caption" color="error" role="alert">
                    {deleteError}
                  </Typography>
                )}
              </Box>
            )}
          </CardContent>
        </MuiCard>
      ))}
    </Box>
  );
}

export default CommentsTab;
