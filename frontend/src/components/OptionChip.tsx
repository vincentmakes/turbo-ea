/**
 * The select-option pill, in one place.
 *
 * A `single_select` / `multiple_select` value renders as a coloured chip whose
 * label comes from the option's localized label and whose foreground is picked
 * for contrast against the option colour. That treatment lived inline in
 * `cardDetailUtils.tsx`; it is a leaf module now so the extension SDK can
 * re-export it without a cycle (`cardDetailUtils` imports `extensionHost`, so
 * `extensionHost` cannot statically import `cardDetailUtils` back).
 *
 * An unknown key is never dropped: it renders as an outlined warning chip
 * carrying the raw value, so a stale stored value stays visible and debuggable.
 */

import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import { useTranslation } from "react-i18next";
import { readableTextColor } from "@/lib/color";

/** Consistent chip style for all select fields (uniform width per field). */
export const SELECT_CHIP_BASE = {
  maxWidth: "100%",
  justifyContent: "center",
  "& .MuiChip-label": { overflow: "hidden", textOverflow: "ellipsis" },
} as const;

export interface ChipOptionLike {
  key: string;
  label: string;
  color?: string;
}

/** Compute a uniform chip width for a field based on its longest option label. */
export function chipWidthForField(options: ChipOptionLike[] | undefined): number {
  if (!options || options.length === 0) return 180;
  const maxLen = Math.max(...options.map((o) => o.label.length));
  // ~7.5px per char + 28px chip padding, clamped between 180 and 300
  return Math.max(180, Math.min(300, Math.round(maxLen * 7.5 + 28)));
}

export interface OptionChipProps {
  /** The resolved option, or undefined when the stored value matches none. */
  option?: ChipOptionLike;
  /** The stored value — shown when `option` is undefined. */
  value?: string;
  /** Localized label; defaults to `option.label`. */
  label?: string;
  /** Fixed width for column alignment; omit for content width (grids). */
  width?: number;
  size?: "small" | "medium";
}

export function OptionChip({ option, value, label, width, size = "small" }: OptionChipProps) {
  const { t } = useTranslation(["cards", "common"]);
  const sx = { ...SELECT_CHIP_BASE, ...(width ? { width } : {}) };
  if (!option) {
    const raw = value ?? "";
    if (!raw) return null;
    return (
      <Tooltip title={t("utils.unknownOption", { key: raw })}>
        <Chip size={size} label={raw} variant="outlined" color="warning" sx={sx} />
      </Tooltip>
    );
  }
  return (
    <Chip
      size={size}
      label={label ?? option.label}
      sx={{
        ...sx,
        ...(option.color
          ? { bgcolor: option.color, color: readableTextColor(option.color) }
          : {}),
      }}
    />
  );
}

export default OptionChip;
