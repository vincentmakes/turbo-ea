/**
 * The Discussion and History panel beside a saved decision or SoAW, on its
 * editor and on its preview. From `lg` up it is an aside in the page's flex
 * row (not a persistent Drawer: that is fixed-position and would cover the
 * app bar); below `lg` a button opens it in a temporary Drawer. Whether it
 * is open, and on which tab, is remembered per viewer. A notification's
 * `?thread=<id>` opens it on Discussion with that thread in view.
 */
import { useCallback, useState, type ReactNode } from "react";
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
  const [liveCount, setLiveCount] = useState<number | null>(null);

  const update = (next: Partial<PanelState>) => {
    const merged = { ...state, ...next };
    setState(merged);
    writePanelState(merged);
  };

  const handleCount = useCallback(
    (count: number) => {
      setLiveCount(count);
      onOpenCountChange?.(count);
    },
    [onOpenCountChange],
  );

  if (!owner) return <>{children}</>;

  const count = liveCount ?? openThreadCount ?? 0;
  const tabLabel = (key: string, icon: string, badge?: number) => (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
      <MaterialSymbol icon={icon} size={18} />
      {t(key)}
      {badge !== undefined && badge > 0 && (
        <Badge badgeContent={badge} color="warning" sx={{ ml: 1.5 }} data-testid="open-thread-badge" />
      )}
    </Box>
  );

  const panel = (onClose: () => void) => (
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

  if (wide) {
    return (
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 2 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
        {state.open ? (
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
            {panel(() => update({ open: false }))}
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
        )}
      </Box>
    );
  }

  return (
    <>
      {children}
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
        {panel(() => setDrawerOpen(false))}
      </Drawer>
    </>
  );
}
