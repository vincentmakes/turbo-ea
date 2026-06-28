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
import MaterialSymbol from "@/components/MaterialSymbol";
import type { DiagramSection } from "@/types";

/** Single-select scope (like mail folders). */
export type DiagramScope =
  | { kind: "all" }
  | { kind: "mine" }
  | { kind: "favorites" }
  | { kind: "section"; id: string };

interface Props {
  scope: DiagramScope;
  onScopeChange: (s: DiagramScope) => void;
  sections: DiagramSection[];
  onManageSections: () => void;
  /** When set, render a "Filters" header with a close button (drawer/mobile mode). */
  onClose?: () => void;
  /** Called after any scope/section selection — used to auto-close the mobile drawer. */
  onAfterChange?: () => void;
}

const sameScope = (a: DiagramScope, b: DiagramScope) =>
  a.kind === b.kind && (a.kind !== "section" || b.kind !== "section" || a.id === b.id);

export default function DiagramsFilterSidebar({
  scope,
  onScopeChange,
  sections,
  onManageSections,
  onClose,
  onAfterChange,
}: Props) {
  const { t } = useTranslation(["diagrams", "common"]);

  const pickScope = (s: DiagramScope) => {
    onScopeChange(s);
    onAfterChange?.();
  };

  const quick: { scope: DiagramScope; icon: string; label: string }[] = [
    { scope: { kind: "all" }, icon: "grid_view", label: t("sidebar.all") },
    { scope: { kind: "mine" }, icon: "person", label: t("sidebar.mine") },
    { scope: { kind: "favorites" }, icon: "star", label: t("sidebar.favorites") },
  ];

  const drawerMode = !!onClose;

  return (
    <Box
      sx={{
        width: drawerMode ? "100%" : 220,
        flexShrink: 0,
        ...(drawerMode ? { p: 1 } : { borderRight: 1, borderColor: "divider", pr: 1 }),
        display: "flex",
        flexDirection: "column",
        gap: 1,
      }}
    >
      {drawerMode && (
        <Box sx={{ display: "flex", alignItems: "center", mb: 0.5 }}>
          <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>
            {t("gallery.filters")}
          </Typography>
          <IconButton size="small" onClick={onClose}>
            <MaterialSymbol icon="close" size={20} />
          </IconButton>
        </Box>
      )}

      {/* Quick filters */}
      <Typography variant="overline" color="text.secondary" sx={{ px: 1 }}>
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

      <Divider />

      {/* Sections */}
      <Typography variant="overline" color="text.secondary" sx={{ px: 1 }}>
        {t("sidebar.sections")}
      </Typography>
      <List dense disablePadding sx={{ flex: 1, overflowY: "auto" }}>
        {sections.length === 0 ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ px: 1.5, py: 1, fontStyle: "italic" }}
          >
            {t("sidebar.noSections")}
          </Typography>
        ) : (
          sections.map((s) => {
            const sel = scope.kind === "section" && scope.id === s.id;
            return (
              <ListItemButton
                key={s.id}
                selected={sel}
                onClick={() => pickScope({ kind: "section", id: s.id })}
                sx={{ borderRadius: 1 }}
              >
                <ListItemIcon sx={{ minWidth: 28 }}>
                  <Box
                    sx={{
                      width: 12,
                      height: 12,
                      borderRadius: "3px",
                      bgcolor: s.color || "action.selected",
                    }}
                  />
                </ListItemIcon>
                <ListItemText primary={s.name} primaryTypographyProps={{ noWrap: true }} />
                <Chip size="small" label={s.diagram_count} sx={{ ml: 0.5 }} />
              </ListItemButton>
            );
          })
        )}
      </List>

      <Button
        size="small"
        startIcon={<MaterialSymbol icon="settings" size={16} />}
        onClick={onManageSections}
        sx={{ textTransform: "none", justifyContent: "flex-start", mt: 0.5 }}
      >
        {t("sidebar.manageSections")}
      </Button>
    </Box>
  );
}
