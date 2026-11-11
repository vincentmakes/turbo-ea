/**
 * The Discussion and History panel beside a saved decision or SoAW, on its
 * editor and on its preview. From `lg` up it is an aside in the page's flex
 * row (not a persistent Drawer: that is fixed-position and would cover the
 * app bar); below `lg` a button opens it in a temporary Drawer. Whether it
 * is open, and on which tab, is remembered per viewer. A notification's
 * `?thread=<id>` opens it on Discussion with that thread in view, on arrival
 * and whenever the parameter changes while the document is open.
 *
 * The document (`children`) sits at the same place in the React tree at
 * every width, so crossing `lg` re-lays the page out without remounting it
 * (a dialog's typed text, editor undo history survive). The Discussion and
 * History tabs are re-read with `refreshKey` (a save or a review action).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import Fab from "@mui/material/Fab";
import IconButton from "@mui/material/IconButton";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Tooltip from "@mui/material/Tooltip";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { DocumentOwner } from "@/types";
import DiscussionPanel from "./DiscussionPanel";
import HistoryPanel from "./HistoryPanel";
import type { SectionOption } from "./discussionModel";
import { initialPanelState, writePanelState, type PanelState, type PanelTab } from "./panelState";

/** The aside's width from `lg` up. */
const ASIDE_WIDTH = 380;

interface Props<D> {
  /** The saved document; null (a new one) renders the page alone. */
  owner: DocumentOwner | null;
  /** The document's status (restore is offered on a draft only). */
  status: string;
  /** What a new thread can be tagged to (`sectionOptions`). */
  sections: SectionOption[];
  /** The count the document's detail carries, until the discussion has loaded. */
  openThreadCount?: number;
  /** The live open-thread count (for the sign / request dialogs' warnings). */
  onOpenCountChange?: (count: number) => void;
  /** Re-read the history when this changes (the page saved). */
  refreshKey?: string | number;
  isDirty?: () => boolean;
  onRestored?: (detail: D) => void;
  /** The document itself. */
  children: ReactNode;
}

export default function DocumentSidePanel<D>({
  owner,
  status,
  sections,
  openThreadCount,
  onOpenCountChange,
  refreshKey,
  isDirty,
  onRestored,
  children,
}: Props<D>) {
  const { t } = useTranslation("delivery");
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up("lg"));
  const [searchParams] = useSearchParams();
  const focusThreadId = searchParams.get("thread");
  const [state, setState] = useState<PanelState>(() => initialPanelState(focusThreadId));
  // Below `lg` the drawer opens on request (or for a notification's thread) only.
  const [drawerOpen, setDrawerOpen] = useState(Boolean(focusThreadId));
  // A notification for this same document while it is open: only the query
  // string changes, so open the panel on Discussion here.
  const [seenThread, setSeenThread] = useState(focusThreadId);
  if (focusThreadId !== seenThread) {
    setSeenThread(focusThreadId);
    if (focusThreadId) {
      setState((prev) => ({ ...prev, open: true, tab: "discussion" }));
      setDrawerOpen(true);
    }
  }
  // The discussion's live count, held against the detail's count it was read
  // after: a newer detail (a review action's reply) wins until the
  // discussion has been read again.
  const [live, setLive] = useState<{ count: number; basis: number | undefined } | null>(null);

  const update = (next: Partial<PanelState>) => {
    const merged = { ...state, ...next };
    setState(merged);
    writePanelState(merged);
  };

  // Read through a ref: the callback keeps its identity when the detail's
  // count changes, so the discussion does not report its old count again.
  const basisRef = useRef(openThreadCount);
  useEffect(() => {
    basisRef.current = openThreadCount;
  }, [openThreadCount]);
  const handleCount = useCallback(
    (count: number) => {
      setLive({ count, basis: basisRef.current });
      onOpenCountChange?.(count);
    },
    [onOpenCountChange],
  );

  const count = (live && live.basis === openThreadCount ? live.count : openThreadCount) ?? 0;
  const tabLabel = (key: string, icon: string, badge?: number) => (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
      <MaterialSymbol icon={icon} size={18} />
      {t(key)}
      {badge !== undefined && badge > 0 && (
        <Badge badgeContent={badge} color="warning" sx={{ ml: 1.5 }} data-testid="open-thread-badge" />
      )}
    </Box>
  );

  const panel = (owner: DocumentOwner, onClose: () => void) => (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <Box sx={{ display: "flex", alignItems: "center", borderBottom: 1, borderColor: "divider" }}>
        <Tabs
          value={state.tab}
          onChange={(_e, tab: PanelTab) => update({ tab })}
          sx={{ flex: 1, minHeight: 44, "& .MuiTab-root": { minHeight: 44, textTransform: "none" } }}
        >
          <Tab value="discussion" label={tabLabel("collab.panel.discussion", "forum", count)} />
          <Tab value="history" label={tabLabel("collab.panel.history", "history")} />
        </Tabs>
        <Tooltip title={t("collab.panel.close")}>
          <IconButton size="small" onClick={onClose} sx={{ mr: 0.5 }}>
            <MaterialSymbol icon="close" size={18} />
          </IconButton>
        </Tooltip>
      </Box>
      <Box sx={{ flex: 1, overflowY: "auto", p: 1.5 }}>
        <Box sx={{ display: state.tab === "discussion" ? "block" : "none" }}>
          <DiscussionPanel
            owner={owner}
            sections={sections}
            focusThreadId={focusThreadId}
            onOpenCountChange={handleCount}
            refreshKey={refreshKey}
          />
        </Box>
        {state.tab === "history" && (
          <HistoryPanel<D>
            owner={owner}
            status={status}
            refreshKey={refreshKey}
            isDirty={isDirty}
            onRestored={onRestored}
          />
        )}
      </Box>
    </Box>
  );

  const openLabel = t("collab.panel.open");

  // One tree for every width: the document is always the first child of the
  // same Box, only what sits beside it changes.
  return (
    <Box sx={wide ? { display: "flex", alignItems: "flex-start", gap: 2 } : undefined}>
      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
      {owner && wide && (
        state.open ? (
          <Box
            component="aside"
            aria-label={openLabel}
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
