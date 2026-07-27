import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import MaterialSymbol from "@/components/MaterialSymbol";

interface Props {
  /** Renders nothing when zero — callers don't need their own guard. */
  selectedCount: number;
  /** Pre-translated "N selected" label. */
  label: string;
  /** Action buttons; use `BulkSelectionAction` for the standard styling. */
  children?: ReactNode;
  onClear: () => void;
  clearTitle?: string;
}

/**
 * The chrome of a bulk-action toolbar: primary-coloured bar, selection
 * count chip, action slot, clear button. Extracted from
 * `features/admin/users/BulkActionsToolbar` so the repository-wide
 * Resources grid gets the identical affordance without either page
 * hard-coding the other's actions.
 */
export default function BulkSelectionBar({
  selectedCount,
  label,
  children,
  onClear,
  clearTitle,
}: Props) {
  if (selectedCount === 0) return null;

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        p: 1,
        mb: 1.5,
        borderRadius: 1,
        bgcolor: "primary.main",
        color: "primary.contrastText",
        flexWrap: "wrap",
      }}
    >
      <Chip
        size="small"
        label={label}
        sx={{ bgcolor: "primary.contrastText", color: "primary.main", fontWeight: 600 }}
      />
      <Box sx={{ flex: 1 }} />
      {children}
      <Button
        size="small"
        onClick={onClear}
        sx={{ color: "inherit", minWidth: 0 }}
        title={clearTitle}
      >
        <MaterialSymbol icon="close" size={18} />
      </Button>
    </Box>
  );
}

/** An action button styled to sit inside `BulkSelectionBar`. */
export function BulkSelectionAction({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      size="small"
      variant="outlined"
      disabled={disabled}
      onClick={onClick}
      startIcon={<MaterialSymbol icon={icon} size={18} />}
      sx={{ color: "inherit", borderColor: "currentColor" }}
    >
      {label}
    </Button>
  );
}
