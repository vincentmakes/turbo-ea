import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Slider from "@mui/material/Slider";
import Tooltip from "@mui/material/Tooltip";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";

/**
 * Discrete data-quality importance control. Four tiers, shown as a slider with
 * numeric marks plus the tier name + number, so admins see both the friendly
 * label and the exact weight:
 *   Ignore = 0, Normal = 1, Important = 2, Critical = 3.
 *
 * The underlying value is the numeric field/contributor `weight` (0 excludes).
 * Dragging updates a local value for smooth feedback; the parent `onChange`
 * (which persists + refreshes) only fires on release, so the screen does not
 * flicker mid-drag. Legacy/out-of-range weights snap to the nearest tier.
 */

export const TIER_KEYS = ["ignore", "normal", "important", "critical"] as const;
export type Tier = 0 | 1 | 2 | 3;

export function weightToTier(weight: number | undefined): Tier {
  const w = weight ?? 1;
  if (w <= 0) return 0;
  if (w < 2) return 1;
  if (w < 3) return 2;
  return 3;
}

/** Intensity ramp (grey → primary.dark) so stronger weight reads as "counts more". */
export function useTierColor(): (tier: Tier) => string {
  const theme = useTheme();
  return (tier: Tier) =>
    [
      theme.palette.action.disabled,
      theme.palette.primary.light,
      theme.palette.primary.main,
      theme.palette.primary.dark,
    ][tier];
}

interface ImportanceSliderProps {
  value: number | undefined;
  onChange: (weight: number) => void;
  /** Locks the slider, e.g. while the parent's save of a previous change is in flight. */
  disabled?: boolean;
}

/**
 * Compact read-only tier badge (the number) used to surface a field's or
 * built-in factor's data-quality weight at a glance in the layout editor.
 */
export function WeightBadge({ weight }: { weight: number | undefined }) {
  const { t } = useTranslation("admin");
  const tierColor = useTierColor();
  const tier = weightToTier(weight);
  return (
    <Tooltip
      title={t("metamodel.dataQuality.badgeTooltip", {
        tier: t(`metamodel.importance.${TIER_KEYS[tier]}`),
        value: tier,
      })}
    >
      <Box
        sx={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          flexShrink: 0,
          bgcolor: tier === 0 ? "transparent" : tierColor(tier),
          border: tier === 0 ? "1px dashed" : "none",
          borderColor: "text.disabled",
          color: "#fff",
          fontSize: "0.6rem",
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {tier}
      </Box>
    </Tooltip>
  );
}

export default function ImportanceSlider({ value, onChange, disabled = false }: ImportanceSliderProps) {
  const { t } = useTranslation("admin");
  const theme = useTheme();
  const tierColor = useTierColor();

  // Local tier mirrors the prop but updates instantly while dragging.
  const [tier, setTier] = useState<Tier>(weightToTier(value));
  useEffect(() => {
    setTier(weightToTier(value));
  }, [value]);

  const color = tierColor(tier);
  const tierLabel = t(`metamodel.importance.${TIER_KEYS[tier]}`);
  // The Ignore ramp colour is intentionally faint (semi-transparent) for the
  // track; use solid tones for the chip text and the thumb so the weight is
  // always legible and the thumb doesn't show the rail through it at zero.
  const chipColor = tier === 0 ? theme.palette.text.secondary : color;
  const thumbColor = tier === 0 ? theme.palette.grey[500] : color;

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, width: "100%" }}>
      <Slider
        value={tier}
        onChange={(_, v) => setTier(Number(v) as Tier)}
        onChangeCommitted={(_, v) => onChange(Number(v))}
        disabled={disabled}
        min={0}
        max={3}
        step={1}
        marks={[{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }]}
        size="small"
        valueLabelDisplay="off"
        aria-label={t("metamodel.importance.label")}
        sx={{
          flex: 1,
          minWidth: 80,
          color,
          py: 1,
          "& .MuiSlider-rail": { height: 6, opacity: 0.3 },
          "& .MuiSlider-track": { height: 6, border: "none" },
          "& .MuiSlider-thumb": { width: 16, height: 16, bgcolor: thumbColor, opacity: 1 },
          "& .MuiSlider-mark": { height: 6, width: 2, bgcolor: "currentColor", opacity: 0.4 },
          "& .MuiSlider-markActive": { bgcolor: "currentColor", opacity: 1 },
        }}
      />
      <Chip
        size="small"
        variant="outlined"
        label={`${tierLabel} (${tier})`}
        sx={{
          flexShrink: 0,
          fontWeight: 700,
          color: chipColor,
          borderColor: chipColor,
          minWidth: 104,
        }}
      />
    </Box>
  );
}
