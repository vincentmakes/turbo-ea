/**
 * The freeze pin shown next to a column row in a grid's Columns tab — the
 * discoverable twin of the pin that appears when you hover a column header
 * (see `useColumnFreeze`). Both drive the same `toggleFrozen()`.
 *
 * Deliberately NOT an `IconButton`: the rows it sits beside are
 * `ListItemButton`s, and nesting a `<button>` inside a `<button>` is invalid
 * markup. Render it as a *sibling* of the row button inside a flex wrapper —
 * locked rows disable their button, and a disabled MUI button swallows
 * pointer events on everything inside it, yet a locked column (Name,
 * Reference, Card…) is exactly the one a user most wants frozen.
 */
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";

interface Props {
  /** Whether the column is currently frozen to the leading edge. */
  frozen: boolean;
  onToggle: () => void;
}

export default function ColumnFreezeToggle({ frozen, onToggle }: Props) {
  const { t } = useTranslation("common");
  const label = t(frozen ? "grid.unfreezeColumn" : "grid.freezeColumn");

  const activate = (e: React.SyntheticEvent) => {
    // The row itself toggles column *visibility* — never let a pin click
    // show or hide the column as a side effect.
    e.stopPropagation();
    e.preventDefault();
    onToggle();
  };

  return (
    <Tooltip title={label} placement="right">
      <Box
        component="span"
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-pressed={frozen}
        onClick={activate}
        onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") activate(e);
        }}
        sx={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          cursor: "pointer",
          borderRadius: 1,
          p: 0.25,
          color: frozen ? "primary.main" : "text.secondary",
          opacity: frozen ? 0.9 : 0.35,
          ...(frozen ? { "& span": { fontVariationSettings: "'FILL' 1" } } : {}),
          "&:hover": { opacity: 1, color: "primary.main", bgcolor: "action.hover" },
          "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main" },
        }}
      >
        <MaterialSymbol icon="push_pin" size={16} />
      </Box>
    </Tooltip>
  );
}
