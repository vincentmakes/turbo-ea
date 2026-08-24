import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import MenuItem from "@mui/material/MenuItem";
import Radio from "@mui/material/Radio";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { CardType } from "@/types";

/**
 * Row primitives shared by the diagram toolbar's two card-display menus.
 *
 * Both menus file their options under the card type that owns them and use the
 * same radio-vs-checkbox grammar for "pick one" vs "pick several", so the rows
 * live here rather than being copied into each.
 */

/**
 * Sub-heading naming the card type a group of rows belongs to. Carries the
 * type's own glyph in its own colour, per UI_GUIDELINES §3.11 — a card type is
 * never a bare label. A group with no type (the shared bucket) takes a neutral
 * glyph.
 */
export function TypeHeading({ type, label }: { type?: CardType; label: string }) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        px: 2,
        pt: 0.75,
        pb: 0.25,
        fontSize: "0.7rem",
        fontWeight: 600,
        color: type ? type.color : "text.secondary",
      }}
    >
      <MaterialSymbol icon={type?.icon || "widgets"} size={14} />
      {label}
    </Box>
  );
}

/** Pick-one row. Leaves the menu open so a reader can see the effect land. */
export function ChoiceRow({
  checked,
  label,
  onSelect,
}: {
  checked: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <MenuItem selected={checked} onClick={onSelect} sx={{ pl: 1.5, py: 0.25 }}>
      <Radio size="small" checked={checked} sx={{ p: 0.5, mr: 1 }} />
      <Typography variant="body2" noWrap>
        {label}
      </Typography>
    </MenuItem>
  );
}

/** Pick-many row. */
export function CheckRow({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <MenuItem onClick={onToggle} sx={{ pl: 1.5, py: 0.25 }}>
      <Checkbox size="small" checked={checked} sx={{ p: 0.5, mr: 1 }} />
      <Typography variant="body2" noWrap>
        {label}
      </Typography>
    </MenuItem>
  );
}
