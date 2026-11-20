/**
 * Shared building blocks for the left-hand filter sidebars (Inventory,
 * Compliance, Risk Register): the section header and the checkbox list.
 *
 * The house pattern, extracted from the Compliance sidebar so the GRC
 * panels can't drift apart again:
 *  - `FilterSectionHeader` — chevron + section icon + label + a primary
 *    count chip when the section holds active selections, plus — when the
 *    sidebar passes `onClear` — a per-section clear button beside it.
 *  - `FilterCheckboxList` — dense checkbox rows, with a small coloured dot
 *    (or icon) before the label where the value carries a semantic colour.
 *    Deliberately **not** chips: the dot keeps the colour visible without
 *    confusing the selected/unselected affordance.
 */
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import ColumnFreezeToggle from "@/components/grid/ColumnFreezeToggle";
import { isToggleKey, showsSectionClear } from "@/lib/filterSections";

/**
 * The toggle area is a keyboard-operable `role="button"` with
 * `aria-expanded`; `data-section-icon` names the section for tests.
 */
export function FilterSectionHeader({
  label,
  icon,
  expanded,
  onToggle,
  count,
  onClear,
}: {
  label: string;
  icon: string;
  expanded: boolean;
  onToggle: () => void;
  count?: number;
  /**
   * Clears every filter of this section. The button renders only while
   * `count > 0`, as a SIBLING of the toggle area — its own tab stop, and a
   * click on it can never fold or unfold the section (same reasoning as the
   * clear-all chip of `ReportFilterSection` and the freeze pin below).
   */
  onClear?: () => void;
}) {
  const { t } = useTranslation("common");
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        borderRadius: 1,
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <Box
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        data-section-icon={icon}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (isToggleKey(e.key)) {
            e.preventDefault();
            onToggle();
          }
        }}
        sx={{
          display: "flex",
          alignItems: "center",
          flex: 1,
          minWidth: 0,
          gap: 0.75,
          py: 0.5,
          px: 0.5,
          cursor: "pointer",
          borderRadius: 1,
          userSelect: "none",
          "&:focus-visible": {
            outline: "2px solid",
            outlineColor: "primary.main",
            outlineOffset: -2,
          },
        }}
      >
        <MaterialSymbol icon={expanded ? "expand_more" : "chevron_right"} size={16} />
        <MaterialSymbol icon={icon} size={16} />
        <Typography variant="body2" fontWeight={600} fontSize={13} sx={{ flex: 1 }}>
          {label}
        </Typography>
        {count != null && count > 0 && (
          <Chip
            label={count}
            size="small"
            color="primary"
            sx={{ height: 18, fontSize: 11 }}
            data-testid="section-count"
          />
        )}
      </Box>
      {showsSectionClear(count, onClear) && (
        <Tooltip title={t("filter.clearSection", { section: label })}>
          <IconButton
            size="small"
            aria-label={t("filter.clearSection", { section: label })}
            onClick={onClear}
            sx={{ p: 0.25, mr: 0.25, color: "text.secondary" }}
          >
            <MaterialSymbol icon="filter_alt_off" size={16} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}

export interface FilterCheckboxItem {
  key: string;
  label: string;
  checked: boolean;
  onToggle: () => void;
  /** Semantic colour rendered as a 10px dot (or as the icon colour). */
  color?: string;
  /** Material Symbol name rendered instead of the dot (e.g. card-type icon). */
  icon?: string;
  /** Second line under the label (e.g. a user's email). */
  secondary?: string;
  disabled?: boolean;
  /**
   * Column rows only: pass `onToggleFrozen` to render a freeze pin beside
   * the row (the sidebar twin of the pin on the grid's column header).
   */
  frozen?: boolean;
  onToggleFrozen?: () => void;
}

export function FilterCheckboxList({ items }: { items: FilterCheckboxItem[] }) {
  return (
    <List dense disablePadding sx={{ mb: 1 }}>
      {items.map((item) => {
        const row = (
        <ListItemButton
          key={item.key}
          dense
          disabled={item.disabled}
          onClick={item.onToggle}
          sx={{
            py: 0.25,
            px: 1,
            borderRadius: 1,
            ...(item.onToggleFrozen ? { flex: 1, minWidth: 0 } : {}),
          }}
        >
          <ListItemIcon sx={{ minWidth: 28 }}>
            <Checkbox
              size="small"
              checked={item.checked}
              disabled={item.disabled}
              disableRipple
              sx={{ p: 0 }}
            />
          </ListItemIcon>
          {item.icon ? (
            <MaterialSymbol icon={item.icon} size={14} color={item.color} />
          ) : item.color ? (
            <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                bgcolor: item.color,
                flexShrink: 0,
              }}
            />
          ) : null}
          <ListItemText
            primary={item.label}
            secondary={item.secondary}
            primaryTypographyProps={{
              fontSize: 13,
              ml: 0.75,
              noWrap: true,
            }}
            secondaryTypographyProps={{ fontSize: 11, ml: 0.75, noWrap: true }}
          />
        </ListItemButton>
        );
        // The pin sits *beside* the row button, never inside it: a disabled
        // (locked) row would otherwise swallow its clicks, and a locked
        // column is exactly the one worth freezing.
        return item.onToggleFrozen ? (
          <Box key={item.key} sx={{ display: "flex", alignItems: "center" }}>
            {row}
            <ColumnFreezeToggle frozen={!!item.frozen} onToggle={item.onToggleFrozen} />
          </Box>
        ) : (
          row
        );
      })}
    </List>
  );
}
