import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Popover from "@mui/material/Popover";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";
import Sketch from "@uiw/react-color-sketch";
import { contrastRatio, isHexColor } from "@/lib/color";

/**
 * Curated preset colors for the Sketch picker bottom row.
 * 12 hues x 5 shades — gives a wide range of modern colors.
 */
const PRESET_COLORS = [
  // row 1: vivid primaries + accents
  "#f87171", "#fb923c", "#fbbf24", "#4ade80", "#2dd4bf",
  "#22d3ee", "#60a5fa", "#818cf8", "#a78bfa", "#f472b6",
  // row 2: deep / saturated
  "#ef4444", "#f97316", "#f59e0b", "#22c55e", "#14b8a6",
  "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899",
  // row 3: dark
  "#dc2626", "#ea580c", "#d97706", "#16a34a", "#0d9488",
  "#0891b2", "#2563eb", "#4f46e5", "#7c3aed", "#db2777",
  // row 4: extra darks + neutrals
  "#991b1b", "#9a3412", "#92400e", "#166534", "#115e59",
  "#155e75", "#1e3a8a", "#312e81", "#4c1d95", "#9d174d",
  // row 5: lights
  "#fecaca", "#fed7aa", "#fde68a", "#bbf7d0", "#99f6e4",
  "#a5f3fc", "#bfdbfe", "#c7d2fe", "#ddd6fe", "#fbcfe8",
  // row 6: neutrals
  "#f5f5f4", "#e2e8f0", "#a8a29e", "#94a3b8", "#64748b",
  "#78716c", "#475569", "#57534e", "#1e293b", "#292524",
];

const RECENT_KEY = "turboea-recent-colors";
const MAX_RECENT = 10;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRecent(colors: string[]) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(colors.slice(0, MAX_RECENT)));
}

export interface PresetSwatch {
  value: string;
  /** Tooltip text (e.g. "Business — #FFFFB5"). */
  title: string;
}

export interface PresetGroup {
  label: string;
  colors: PresetSwatch[];
}

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  disabled?: boolean;
  /** Compact mode — smaller swatch trigger, no label. For inline option rows. */
  compact?: boolean;
  label?: string;
  /**
   * Show an advisory (never blocking) caption when the draft color is nearly
   * invisible against the light or dark theme paper — mirrors the navbar
   * style card's contrast hint. Opt-in for admin-facing pickers whose colors
   * paint large surfaces (card types, tags).
   */
  warnLowContrast?: boolean;
  /**
   * Curated, labeled swatch rows rendered above the Sketch picker (same look
   * as the Recent row) — e.g. the standard ArchiMate layer palette for card
   * types. Clicking a swatch sets the draft; Save still applies it.
   */
  presetGroups?: PresetGroup[];
}

/** Caption + row of small clickable swatches (shared by Recent + preset groups). */
function SwatchRow({
  label,
  swatches,
  draft,
  onPick,
}: {
  label: string;
  swatches: PresetSwatch[];
  draft: string;
  onPick: (event: React.MouseEvent, color: string) => void;
}) {
  return (
    <Box sx={{ px: 1.5, pt: 1.5, pb: 0.5 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", mb: 0.5, fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: 0.5 }}
      >
        {label}
      </Typography>
      <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
        {swatches.map((s) => (
          <Tooltip key={s.value} title={s.title} placement="top" arrow>
            <Box
              aria-label={s.title}
              onClick={(e) => onPick(e, s.value)}
              sx={{
                width: 18,
                height: 18,
                borderRadius: 0.5,
                bgcolor: s.value,
                cursor: "pointer",
                border: s.value === draft ? "2px solid" : "1px solid",
                borderColor: s.value === draft ? "primary.main" : "divider",
                transition: "transform 0.1s",
                "&:hover": { transform: "scale(1.2)" },
              }}
            />
          </Tooltip>
        ))}
      </Box>
    </Box>
  );
}

export default function ColorPicker({
  value,
  onChange,
  disabled,
  compact,
  label,
  warnLowContrast,
  presetGroups,
}: ColorPickerProps) {
  const { t } = useTranslation("common");
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [draft, setDraft] = useState(value);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const open = Boolean(anchorEl);
  const size = compact ? 24 : 28;

  // Sync draft + recent colors when the popover opens
  useEffect(() => {
    if (open) {
      setDraft(value);
      setRecent(loadRecent());
    }
  }, [open, value]);

  const handleSave = useCallback((event?: React.MouseEvent) => {
    event?.preventDefault();
    event?.stopPropagation();
    onChange(draft);
    // Push to recent (deduplicate, most recent first)
    const updated = [draft, ...recent.filter((c) => c !== draft)].slice(0, MAX_RECENT);
    setRecent(updated);
    saveRecent(updated);
    setAnchorEl(null);
  }, [draft, onChange, recent]);

  const handleCancel = useCallback((event?: React.MouseEvent | object) => {
    if (event && "preventDefault" in event && typeof event.preventDefault === "function") {
      (event as React.MouseEvent).preventDefault();
    }
    if (event && "stopPropagation" in event && typeof event.stopPropagation === "function") {
      (event as React.MouseEvent).stopPropagation();
    }
    setDraft(value);
    setAnchorEl(null);
  }, [value]);

  const handleRecentClick = (event: React.MouseEvent, color: string) => {
    event.preventDefault();
    event.stopPropagation();
    setDraft(color);
  };

  // Advisory only — a color this close to pure white or the dark-theme paper
  // renders near-invisible accents (borders, chips) in that theme.
  const lowContrast =
    !!warnLowContrast &&
    isHexColor(draft) &&
    (contrastRatio(draft, "#ffffff") < 1.6 || contrastRatio(draft, "#121212") < 1.6);

  return (
    <>
      {/* Trigger swatch */}
      <Box
        sx={{
          display: "flex",
          gap: compact ? 0.5 : 1,
          alignItems: "center",
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.5 : 1,
        }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!disabled) setAnchorEl(e.currentTarget);
        }}
      >
        <Tooltip title={disabled ? "" : t("colorPicker.pickColor")}>
          <Box
            sx={{
              width: size,
              height: size,
              minWidth: size,
              borderRadius: compact ? 0.5 : "50%",
              bgcolor: value,
              border: "2px solid",
              borderColor: "divider",
              transition: "box-shadow 0.15s",
              "&:hover": disabled
                ? {}
                : { boxShadow: (t) => `0 0 0 2px ${t.palette.primary.main}` },
            }}
          />
        </Tooltip>
        {!compact && (
          <>
            {label && (
              <Typography variant="body2" color="text.secondary">
                {label}
              </Typography>
            )}
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ fontFamily: "monospace", fontSize: "0.78rem" }}
            >
              {value}
            </Typography>
          </>
        )}
      </Box>

      {/* Popover with Sketch picker */}
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleCancel}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{ paper: { sx: { p: 0, overflow: "visible" } } }}
      >
        <Box sx={{ display: "flex", flexDirection: "column" }}>
          {/* Curated preset groups (e.g. the ArchiMate layer palette) */}
          {presetGroups?.map((g) => (
            <SwatchRow
              key={g.label}
              label={g.label}
              swatches={g.colors}
              draft={draft}
              onPick={handleRecentClick}
            />
          ))}

          {/* Recent colors row */}
          {recent.length > 0 && (
            <SwatchRow
              label={t("colorPicker.recent")}
              swatches={recent.map((c) => ({ value: c, title: c }))}
              draft={draft}
              onPick={handleRecentClick}
            />
          )}

          {/* Sketch picker */}
          <Sketch
            color={draft}
            disableAlpha
            presetColors={PRESET_COLORS}
            onChange={(color) => setDraft(color.hex)}
          />

          {/* Advisory contrast hint (never blocks saving) */}
          {lowContrast && (
            <Typography
              variant="caption"
              color="warning.main"
              sx={{ px: 1.5, pt: 0.75, maxWidth: 220 }}
            >
              {t("colorPicker.contrastWarning")}
            </Typography>
          )}

          {/* Save / Cancel buttons */}
          <Box
            sx={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 1,
              px: 1.5,
              pb: 1.5,
              pt: 0.5,
            }}
          >
            <Button type="button" size="small" onClick={handleCancel}>
              {t("actions.cancel")}
            </Button>
            <Button type="button" size="small" variant="contained" onClick={handleSave}>
              {t("actions.save")}
            </Button>
          </Box>
        </Box>
      </Popover>
    </>
  );
}
