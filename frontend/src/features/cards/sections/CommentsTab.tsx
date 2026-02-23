import { useState, useCallback, useEffect } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import MuiCard from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import type { Comment as CommentType } from "@/types";

// ── Tab: Comments ───────────────────────────────────────────────
function CommentsTab({ fsId, canCreateComments = true, canManageComments: _canManageComments = true }: { fsId: string; canCreateComments?: boolean; canManageComments?: boolean }) {
  const { t } = useTranslation(["cards", "common"]);
  const [comments, setComments] = useState<CommentType[]>([]);
  const [newComment, setNewComment] = useState("");

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
              <Typography variant="caption" color="text.secondary">
                {c.created_at ? new Date(c.created_at).toLocaleString() : ""}
              </Typography>
            </Box>
            <Typography variant="body2">{c.content}</Typography>
          </CardContent>
        </MuiCard>
      ))}
    </Box>
  );
}

export default CommentsTab;
