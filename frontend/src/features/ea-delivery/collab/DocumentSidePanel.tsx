/**
 * The Discussion panel beside a saved decision or SoAW, on its editor and on
 * its preview. From `lg` up it is an aside in the page's flex row (not a
 * persistent Drawer: that is fixed-position and would cover the app bar);
 * below `lg` a button opens it in a temporary Drawer. Whether it is open is
 * remembered per viewer. A notification's `?thread=<id>` opens it with that
 * thread in view, on arrival and whenever the parameter changes while the
 * document is open. The document's History is not here: it opens from the
 * History button at the top of the page (`DocumentHistoryButton`).
 *
 * The document (`children`) sits at the same place in the React tree at
 * every width, so crossing `lg` re-lays the page out without remounting it
 * (a dialog's typed text, editor undo history survive).
 *
 * The discussion is read here, once, whether the panel is open or not
 * (`useDiscussionView`): the panel, its badge, the open count the page's sign
 * and request dialogs warn with (`onOpenCountChange`) and the section markers
 * beside the page's headings (`SectionDiscussionContext`, read by
 * `SectionDiscussionMarker`) all come from that one read. It is re-read with
 * `refreshKey` (a save or a review action) and after every write. A marker
 * opens the panel with the filter set to its section alone and, for a reader
 * who may comment, that section chosen in the new-thread composer, which
 * takes the focus. Such a reader sees a marker on every section, one with no
 * thread yet included.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import Fab from "@mui/material/Fab";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { DocumentOwner } from "@/types";
import { DocumentMentionContext } from "../mentions/documentMentionContext";
import type { MentionContext } from "../mentions/mentionModel";
import DiscussionPanel from "./DiscussionPanel";
import { markerUnfoldsResolved, openCount, sectionThreadCounts, type SectionOption } from "./discussionModel";
import { initialPanelState, writePanelState, type PanelState } from "./panelState";
import { SectionDiscussionContext, type SectionDiscussion } from "./sectionDiscussionContext";
import { useDiscussionView } from "./useDiscussionView";

/** The aside's width from `lg` up. */
const ASIDE_WIDTH = 380;

interface Props {
  /** The saved document; null (a new one) renders the page alone. */
  owner: DocumentOwner | null;
  /** What a new thread can be tagged to (`sectionOptions`). */
  sections: SectionOption[];
  /** The count the document's detail carries, until the discussion has loaded. */
  openThreadCount?: number;
  /** The live open-thread count (for the sign / request dialogs' warnings). */
  onOpenCountChange?: (count: number) => void;
  /** Re-read the discussion when this changes (the page saved). */
  refreshKey?: string | number;
  /** What a comment's "@" lists first: the document's linked cards and people. */
  mentionContext?: MentionContext;
  /** The document itself. */
  children: ReactNode;
}

export default function DocumentSidePanel({
  owner,
  sections,
  openThreadCount,
  onOpenCountChange,
  refreshKey,
  mentionContext,
  children,
}: Props) {
  const { t } = useTranslation("delivery");
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up("lg"));
  const [searchParams] = useSearchParams();
  const focusThreadId = searchParams.get("thread");
  const [state, setState] = useState<PanelState>(() => initialPanelState(focusThreadId));
  // Below `lg` the drawer opens on request (or for a notification's thread) only.
  const [drawerOpen, setDrawerOpen] = useState(Boolean(focusThreadId));
  // A notification for this same document while it is open: only the query
  // string changes, so open the panel here.
  const [seenThread, setSeenThread] = useState(focusThreadId);
  if (focusThreadId !== seenThread) {
    setSeenThread(focusThreadId);
    if (focusThreadId) {
      setState({ open: true });
      setDrawerOpen(true);
    }
  }
  const view = useDiscussionView(owner, { focusThreadId, refreshKey });
  const payload = view.discussion.discussion;
  const { threads } = view.discussion;
  const liveCount = owner ? openCount(threads, owner.id) : 0;

  // The discussion's live count, held against the detail's count it was read
  // after: a newer detail (a review action's reply) wins until the
  // discussion has been read again or its list changes.
  const [seen, setSeen] = useState({ payload, count: liveCount, basis: openThreadCount });
  if (seen.payload !== payload || seen.count !== liveCount) {
    setSeen({ payload, count: liveCount, basis: openThreadCount });
  }
  const count = (payload !== undefined && seen.basis === openThreadCount ? liveCount : openThreadCount) ?? 0;

  // Reported after every read, not only when the number moves: the page's
  // own count may have changed meanwhile (a review action's reply).
  useEffect(() => {
    if (payload !== undefined) onOpenCountChange?.(liveCount);
  }, [payload, liveCount, onOpenCountChange]);

  const update = (next: PanelState) => {
    setState(next);
    writePanelState(next);
  };

  const counts = owner ? sectionThreadCounts(threads, owner.id, sections) : null;
  const canComment = payload?.can?.comment ?? false;
  const sectionDiscussion: SectionDiscussion | null = counts
    ? {
        counts,
        canComment,
        openSection: (section) => {
          view.setFilter([section]);
          if (canComment) view.requestComposeSection(section);
          // A muted marker promised a resolved discussion: show it unfolded.
          if (markerUnfoldsResolved(counts[section])) view.setShowResolved(true);
          if (wide) update({ open: true });
          else setDrawerOpen(true);
        },
      }
    : null;

  const panel = (owner: DocumentOwner, onClose: () => void) => (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <Box
        sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, minHeight: 44, borderBottom: 1, borderColor: "divider" }}
      >
        <MaterialSymbol icon="forum" size={18} />
        <Typography variant="subtitle2" component="h2" sx={{ flex: 1, display: "flex", alignItems: "center" }}>
          {t("collab.panel.discussion")}
          {count > 0 && (
            <Badge badgeContent={count} color="warning" sx={{ ml: 2 }} data-testid="open-thread-badge" />
          )}
        </Typography>
        <Tooltip title={t("collab.panel.close")}>
          <IconButton size="small" onClick={onClose}>
            <MaterialSymbol icon="close" size={18} />
          </IconButton>
        </Tooltip>
      </Box>
      <Box sx={{ flex: 1, overflowY: "auto", p: 1.5 }}>
        <DocumentMentionContext.Provider value={mentionContext}>
          <DiscussionPanel
            owner={owner}
            sections={sections}
            focusThreadId={focusThreadId}
            view={view}
          />
        </DocumentMentionContext.Provider>
      </Box>
    </Box>
  );

  const openLabel = t("collab.panel.open");

  // One tree for every width: the document is always the first child of the
  // same Box, only what sits beside it changes.
  return (
    <Box sx={wide ? { display: "flex", alignItems: "flex-start", gap: 2 } : undefined}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <SectionDiscussionContext.Provider value={sectionDiscussion}>{children}</SectionDiscussionContext.Provider>
      </Box>
      {owner && wide && (
        state.open ? (
          <Box
            component="aside"
            aria-label={t("collab.panel.discussion")}
            className="no-print"
            sx={{
              width: ASIDE_WIDTH,
              flexShrink: 0,
              position: "sticky",
              top: 80,
              height: "calc(100vh - 96px)",
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
              bgcolor: "background.paper",
              overflow: "hidden",
            }}
          >
            {panel(owner, () => update({ open: false }))}
          </Box>
        ) : (
          <Box className="no-print" sx={{ position: "sticky", top: 80, flexShrink: 0 }}>
            <Tooltip title={openLabel} placement="left">
              <IconButton aria-label={openLabel} onClick={() => update({ open: true })}>
                <Badge badgeContent={count} color="warning">
                  <MaterialSymbol icon="forum" size={22} />
                </Badge>
              </IconButton>
            </Tooltip>
          </Box>
        )
      )}
      {owner && !wide && (
        <>
          <Fab
            color="primary"
            size="medium"
            aria-label={openLabel}
            className="no-print"
            onClick={() => setDrawerOpen(true)}
            sx={{ position: "fixed", right: 24, bottom: 24, zIndex: (th) => th.zIndex.speedDial }}
          >
            <Badge badgeContent={count} color="warning">
              <MaterialSymbol icon="forum" size={22} />
            </Badge>
          </Fab>
          <Drawer
            anchor="right"
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            PaperProps={{ sx: { width: { xs: "100%", sm: ASIDE_WIDTH + 40 } } }}
          >
            {panel(owner, () => setDrawerOpen(false))}
          </Drawer>
        </>
      )}
    </Box>
  );
}
