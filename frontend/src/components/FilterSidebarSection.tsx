/**
 * Shared building blocks for the left-hand filter sidebars (Inventory,
 * Compliance, Risk Register): the section header and the checkbox list.
 *
 * The house pattern, extracted from the Compliance sidebar so the GRC
 * panels can't drift apart again:
 *  - `FilterSectionHeader` — chevron + section icon + label + a primary
 *    count chip when the section holds active selections (the Inventory
 *    sidebar's header, verbatim).
 *  - `FilterCheckboxList` — dense checkbox rows, with a small coloured dot
 *    (or icon) before the label where the value carries a semantic colour.
 *    Deliberately **not** chips: the dot keeps the colour visible without
 *    confusing the selected/unselected affordance.
 */
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import ColumnFreezeToggle from "@/components/grid/ColumnFreezeToggle";

export function FilterSectionHeader({
  label,
  icon,
  expanded,
  onToggle,
  count,
}: {
  label: string;
  icon: string;
  expanded: boolean;
  onToggle: () => void;
  count?: number;
}) {
  return (
    <Box
      onClick={onToggle}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        py: 0.5,
        px: 0.5,
        cursor: "pointer",
        borderRadius: 1,
        userSelect: "none",
        "&:hover": { bgcolor: "action.hover" },
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
        />
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
