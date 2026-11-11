/**
 * The Discussion of a decision or SoAW: start a thread (tagged to a section
 * with a chip), reply, resolve and reopen, edit and delete your own comments.
 * A row of section chips at the top, each with its thread count, filters the
 * list (any chip that is on lets its threads through; a thread's own section
 * chip turns its filter on). The filter is the panel's for the open document,
 * composes with the resolved fold, and never hides a notification's thread;
 * arriving on one starts with no filter.
 * Resolved threads fold behind a toggle; earlier revisions' threads load on
 * request (`scope=chain`) and sit under "Rev N" headers. A viewer without
 * the comment right reads only. Read again when the page's `refreshKey`
 * changes (a review action: reject, sign, recall, request signatures,
 * restore), so a rejection's thread or a signing note shows at once.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import type { DocumentOwner, DocumentThread, DocumentThreadWrite, DocumentUserRef } from "@/types";
import { revisionLabel } from "../decisionStanding";
import CommentComposer from "./CommentComposer";
import CommentThread, { type ThreadActions } from "./CommentThread";
import { draftKey } from "./commentDrafts";
import {
  addFilterKey,
  applySectionFilter,
  groupThreads,
  openCount,
  sectionFilterChips,
  sectionLabel,
  splitResolved,
  toggleFilterKey,
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
  /** The open-thread count of this revision, after every read and each time the list changes. */
  onOpenCountChange?: (count: number) => void;
  /** Read the discussion again when this changes (a review action on the page). */
  refreshKey?: string | number;
}

export default function DiscussionPanel({ owner, sections, focusThreadId, onOpenCountChange, refreshKey }: Props) {
  const { t } = useTranslation(["delivery", "common"]);
  const [scope, setScope] = useState<DiscussionScope>("document");
  const discussion = useDocumentDiscussion(owner, { scope, refetchKey: refreshKey });
  const [showResolved, setShowResolved] = useState(false);
  const [unnotified, setUnnotified] = useState<DocumentUserRef[]>([]);
  const { threads } = discussion;
  const payload = discussion.discussion;
  const loaded = payload !== undefined;
  const count = openCount(threads, owner.id);

  // The section filter: the panel's for this document, emptied when another
  // document or another notification's thread is opened.
  const [filter, setFilter] = useState<string[]>([]);
  const filterScope = `${owner.kind}:${owner.id}:${focusThreadId ?? ""}`;
  const [filterFor, setFilterFor] = useState(filterScope);
  if (filterFor !== filterScope) {
    setFilterFor(filterScope);
    setFilter([]);
  }

  // Reported after every read, not only when the number moves: the page's
  // own count may have changed meanwhile (a review action's reply).
  useEffect(() => {
    if (payload !== undefined) onOpenCountChange?.(count);
  }, [payload, count, onOpenCountChange]);

  // A notification's thread: drawn out, unfolded once if it is resolved (the
  // toggle is the reader's after that), and scrolled into view once.
  const focused = focusThreadId ? threads.find((th) => th.id === focusThreadId) : undefined;
  const focusedId = focused?.id;
  const [unfoldedFor, setUnfoldedFor] = useState<string | undefined>(undefined);
  if (focused && focused.id !== unfoldedFor) {
    setUnfoldedFor(focused.id);
    if (focused.resolved_at != null) setShowResolved(true);
  }
  const scrolledTo = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!focusedId || scrolledTo.current === focusedId) return;
    const el = document.getElementById(`thread-${focusedId}`);
    if (!el) return;
    scrolledTo.current = focusedId;
    el.scrollIntoView?.({ block: "center" });
  }, [focusedId, showResolved]);

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
  const earlier = scope === "chain" ? grouped.earlier : [];

  // What the chips count: the threads listed, resolved ones only while unfolded.
  const listed = [...shown, ...(showResolved ? resolved : []), ...earlier.flatMap((g) => g.threads)];
  const chips = sectionFilterChips(listed, sections, filter, t);
  const filtering = filter.length > 0;
  const shownF = applySectionFilter(shown, filter, focusThreadId);
  const resolvedF = applySectionFilter(resolved, filter, focusThreadId);
  const earlierF = earlier
    .map((group) => ({ ...group, threads: applySectionFilter(group.threads, filter, focusThreadId) }))
    .filter((group) => group.threads.length > 0);
  const nothingMatches = filtering && shownF.length === 0 && resolvedF.length === 0 && earlierF.length === 0;
  const clearFilter = (
    <Button size="small" onClick={() => setFilter([])}>
      {t("collab.discussion.filter.clear")}
    </Button>
  );

  const renderThread = (thread: DocumentThread) => (
    <CommentThread
      key={thread.id}
      thread={thread}
      sectionLabel={sectionLabel(thread.section, sections, t)}
      onSectionClick={() => setFilter((prev) => addFilterKey(prev, thread.section ?? ""))}
      canComment={canComment}
      highlighted={thread.id === focusThreadId}
      owner={owner}
      {...actions}
    />
  );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      {chips.length > 0 && (
        <Box
          role="group"
          aria-label={t("collab.discussion.filter.label")}
          sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.5 }}
        >
          {chips.map((chip) => (
            <Chip
              key={chip.key}
              size="small"
              label={t("collab.discussion.filter.chip", { section: chip.label, count: chip.count })}
              color={chip.active ? "primary" : "default"}
              variant={chip.active ? "filled" : "outlined"}
              aria-pressed={chip.active}
              onClick={() => setFilter((prev) => toggleFilterKey(prev, chip.key))}
            />
          ))}
          {filtering && !nothingMatches && clearFilter}
        </Box>
      )}

      {canComment && (
        <CommentComposer
          draftKey={draftKey(owner, { kind: "new" })}
          sections={sections}
          usedSections={threads.map((th) => th.section)}
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
      {nothingMatches && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t("collab.discussion.filter.noMatch")}
          </Typography>
          {clearFilter}
        </Box>
      )}
      {shownF.map(renderThread)}

      {resolvedF.length > 0 && (
        <Button size="small" sx={{ alignSelf: "flex-start" }} onClick={() => setShowResolved(!showResolved)}>
          {showResolved
            ? t("collab.discussion.hideResolved")
            : t("collab.discussion.showResolved", { count: resolvedF.length })}
        </Button>
      )}
      {showResolved && resolvedF.map(renderThread)}

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
      {earlierF.map((group) => (
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
