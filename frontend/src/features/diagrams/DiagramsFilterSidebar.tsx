import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { DiagramGroup } from "@/types";

/** Single-select scope (like mail folders). */
export type DiagramScope =
  | { kind: "all" }
  | { kind: "mine" }
  | { kind: "favorites" }
  | { kind: "group"; id: string };

export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 360;

interface Props {
  scope: DiagramScope;
  onScopeChange: (s: DiagramScope) => void;
  groups: DiagramGroup[];
  onManageGroups: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  width: number;
  onWidthChange: (w: number) => void;
  /** Called after a scope selection — used to auto-close the mobile drawer. */
  onAfterChange?: () => void;
}

const sameScope = (a: DiagramScope, b: DiagramScope) =>
  a.kind === b.kind && (a.kind !== "group" || b.kind !== "group" || a.id === b.id);

export default function DiagramsFilterSidebar({
  scope,
  onScopeChange,
  groups,
  onManageGroups,
  collapsed,
  onToggleCollapse,
  width,
  onWidthChange,
  onAfterChange,
}: Props) {
  const { t } = useTranslation(["diagrams", "common"]);

  const activeCount = scope.kind === "all" ? 0 : 1;

  const pickScope = (s: DiagramScope) => {
    onScopeChange(s);
    onAfterChange?.();
  };

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const onMove = (ev: MouseEvent) => {
      const newW = Math.min(
        SIDEBAR_MAX_WIDTH,
        Math.max(SIDEBAR_MIN_WIDTH, startW + (ev.clientX - startX)),
      );
      onWidthChange(newW);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  /* ---- Collapsed rail ---- */
  if (collapsed) {
    return (
      <Box
        sx={{
          width: 44,
          minWidth: 44,
          borderRight: 1,
          borderColor: "divider",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          pt: 1,
          bgcolor: "action.hover",
        }}
      >
        <Tooltip title={t("gallery.filters")} placement="right">
          <IconButton size="small" onClick={onToggleCollapse}>
            <MaterialSymbol icon="chevron_right" size={20} />
          </IconButton>
        </Tooltip>
        {activeCount > 0 && (
          <Chip
            label={activeCount}
            size="small"
            color="primary"
            sx={{ mt: 1, minWidth: 24, height: 20, fontSize: 12 }}
          />
        )}
      </Box>
    );
  }

  const quick: { scope: DiagramScope; icon: string; label: string }[] = [
    { scope: { kind: "all" }, icon: "grid_view", label: t("sidebar.all") },
    { scope: { kind: "mine" }, icon: "person", label: t("sidebar.mine") },
    { scope: { kind: "favorites" }, icon: "star", label: t("sidebar.favorites") },
  ];

  /* ---- Expanded sidebar ---- */
  return (
    <Box sx={{ display: "flex", height: "100%" }}>
      <Box
        sx={{
          width,
          minWidth: SIDEBAR_MIN_WIDTH,
          borderRight: 1,
          borderColor: "divider",
          display: "flex",
          flexDirection: "column",
          bgcolor: "action.hover",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            px: 1.5,
            py: 0.5,
            minHeight: 40,
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <Typography variant="subtitle2" fontWeight={600}>
              {t("gallery.filters")}
            </Typography>
            {activeCount > 0 && (
              <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "primary.main" }} />
            )}
          </Box>
          <IconButton size="small" onClick={onToggleCollapse}>
            <MaterialSymbol icon="chevron_left" size={20} />
          </IconButton>
        </Box>

        {/* Scrollable content */}
        <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
          {/* Quick filters */}
          <Typography variant="overline" color="text.secondary" sx={{ px: 0.5 }}>
            {t("sidebar.show")}
          </Typography>
          <List dense disablePadding>
            {quick.map((q) => (
              <ListItemButton
                key={q.scope.kind}
                selected={sameScope(scope, q.scope)}
                onClick={() => pickScope(q.scope)}
                sx={{ borderRadius: 1 }}
              >
                <ListItemIcon sx={{ minWidth: 32 }}>
                  <MaterialSymbol icon={q.icon} size={18} />
                </ListItemIcon>
                <ListItemText primary={q.label} />
              </ListItemButton>
            ))}
          </List>

          <Divider sx={{ my: 1 }} />

          {/* Groups */}
          <Typography variant="overline" color="text.secondary" sx={{ px: 0.5 }}>
            {t("sidebar.groups")}
          </Typography>
          <List dense disablePadding>
            {groups.length === 0 ? (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ px: 1.5, py: 1, fontStyle: "italic" }}
              >
                {t("sidebar.noGroups")}
              </Typography>
            ) : (
              groups.map((g) => (
                <ListItemButton
                  key={g.id}
                  selected={scope.kind === "group" && scope.id === g.id}
                  onClick={() => pickScope({ kind: "group", id: g.id })}
                  sx={{ borderRadius: 1 }}
                >
                  <ListItemIcon sx={{ minWidth: 28 }}>
                    <Box
                      sx={{
                        width: 12,
                        height: 12,
                        borderRadius: "3px",
                        bgcolor: g.color || "action.selected",
                      }}
                    />
                  </ListItemIcon>
                  <ListItemText primary={g.name} primaryTypographyProps={{ noWrap: true }} />
                  <Chip size="small" label={g.diagram_count} sx={{ ml: 0.5 }} />
                </ListItemButton>
              ))
            )}
          </List>

          <Button
            size="small"
            startIcon={<MaterialSymbol icon="settings" size={16} />}
            onClick={onManageGroups}
            sx={{ textTransform: "none", justifyContent: "flex-start", mt: 0.5 }}
          >
            {t("sidebar.manageGroups")}
          </Button>
        </Box>
      </Box>

      {/* Resize handle */}
      <Box
        onMouseDown={handleResizeMouseDown}
        sx={{
          width: 5,
          cursor: "col-resize",
          bgcolor: "transparent",
          "&:hover": { bgcolor: "primary.main", opacity: 0.3 },
          transition: "background-color 0.2s",
          zIndex: 1,
        }}
      />
    </Box>
  );
}
