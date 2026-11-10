/**
 * The Discussion tab of a decision or SoAW: start a thread (tagged to a
 * section), reply, resolve and reopen, edit and delete your own comments.
 * Resolved threads fold behind a toggle; earlier revisions' threads load on
 * request (`scope=chain`) and sit under "Rev N" headers. A viewer without
 * the comment right reads only.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import type { DocumentOwner, DocumentThread, DocumentThreadWrite, DocumentUserRef } from "@/types";
import { revisionLabel } from "../decisionStanding";
import CommentComposer from "./CommentComposer";
import CommentThread, { type ThreadActions } from "./CommentThread";
import {
  groupThreads,
  openCount,
  sectionLabel,
  splitResolved,
  type DiscussionScope,
  type SectionOption,
} from "./discussionModel";
import { useDocumentDiscussion } from "./useDocumentDiscussion";

interface Props {
  owner: DocumentOwner;
  /** What a new thread can be tagged to (`sectionOptions`). */
  sections: SectionOption[];
  /** A thread to bring into view (a notification's `?thread=`). */
  focusThreadId?: string | null;
  /** The open-thread count of this revision, each time the list changes. */
  onOpenCountChange?: (count: number) => void;
}

export default function DiscussionPanel({ owner, sections, focusThreadId, onOpenCountChange }: Props) {
  const { t } = useTranslation(["delivery", "common"]);
  const [scope, setScope] = useState<DiscussionScope>("document");
  const discussion = useDocumentDiscussion(owner, { scope });
  const [showResolved, setShowResolved] = useState(false);
  const [unnotified, setUnnotified] = useState<DocumentUserRef[]>([]);
  const { threads } = discussion;
  const loaded = discussion.discussion !== undefined;
  const count = openCount(threads, owner.id);

  useEffect(() => {
    if (loaded) onOpenCountChange?.(count);
  }, [loaded, count, onOpenCountChange]);

  // A notification's thread: in view and drawn out once it is loaded; a
  // resolved one is unfolded first.
  const focused = focusThreadId ? threads.find((th) => th.id === focusThreadId) : undefined;
  const focusResolved = focused?.resolved_at != null;
  useEffect(() => {
    if (!focused) return;
    document.getElementById(`thread-${focused.id}`)?.scrollIntoView?.({ block: "center" });
  }, [focused, focusResolved, showResolved]);

  const noteUnnotified = (reply: DocumentThreadWrite) => {
    setUnnotified(reply.unnotified_mentions ?? []);
    return reply;
  };

  const actions: ThreadActions = {
    onReply: async (thread, body) => noteUnnotified(await discussion.post(body, { thread })),
    onEdit: async (thread, commentId, body) => noteUnnotified(await discussion.edit(thread, commentId, body)),
    onDelete: discussion.remove,
    onResolve: discussion.resolve,
    onReopen: discussion.reopen,
  };

  if (!loaded) {
    if (discussion.error) {
      return <Alert severity="error">{discussion.error.message || t("collab.discussion.error.loadFailed")}</Alert>;
    }
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  const canComment = discussion.discussion?.can?.comment ?? false;
  const grouped = groupThreads(threads, owner.id);
  const { shown, resolved } = splitResolved(grouped.current);
  const resolvedOpen = showResolved || focusResolved;

  const renderThread = (thread: DocumentThread) => (
    <CommentThread
      key={thread.id}
      thread={thread}
      sectionLabel={sectionLabel(thread.section, sections, t)}
      canComment={canComment}
      highlighted={thread.id === focusThreadId}
      {...actions}
    />
  );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      {canComment && (
        <CommentComposer
          sections={sections}
          placeholder={t("collab.discussion.newPlaceholder")}
          submitLabel={t("collab.discussion.post")}
          onSubmit={async (body, section) => noteUnnotified(await discussion.post(body, { section }))}
        />
      )}

      {unnotified.length > 0 && (
        <Alert severity="warning" onClose={() => setUnnotified([])}>
          {t("collab.discussion.unnotified", {
            count: unnotified.length,
            names: unnotified.map((u) => u.display_name).join(", "),
          })}
        </Alert>
      )}

      {shown.length === 0 && resolved.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          {t("collab.discussion.empty")}
        </Typography>
      )}
      {shown.map(renderThread)}

      {resolved.length > 0 && (
        <Button size="small" sx={{ alignSelf: "flex-start" }} onClick={() => setShowResolved(!resolvedOpen)}>
          {resolvedOpen
            ? t("collab.discussion.hideResolved")
            : t("collab.discussion.showResolved", { count: resolved.length })}
        </Button>
      )}
      {resolvedOpen && resolved.map(renderThread)}

      <FormControlLabel
        control={
          <Switch
            size="small"
            checked={scope === "chain"}
            onChange={(e) => setScope(e.target.checked ? "chain" : "document")}
          />
        }
        label={<Typography variant="body2">{t("collab.discussion.showEarlier")}</Typography>}
      />
      {scope === "chain" &&
        grouped.earlier.map((group) => (
          <Box key={group.revisionId} sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <Typography variant="overline" color="text.secondary">
              {revisionLabel(group.revisionNumber, t)}
            </Typography>
            {group.threads.map(renderThread)}
          </Box>
        ))}
      {scope === "chain" && grouped.earlier.length === 0 && !discussion.loading && (
        <Typography variant="body2" color="text.secondary">
          {t("collab.discussion.noEarlier")}
        </Typography>
      )}
    </Box>
  );
}
