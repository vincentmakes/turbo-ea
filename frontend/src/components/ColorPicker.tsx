import { useState, useEffect, useCallback } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Popover from "@mui/material/Popover";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";
import Sketch from "@uiw/react-color-sketch";

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

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  disabled?: boolean;
  /** Compact mode — smaller swatch trigger, no label. For inline option rows. */
  compact?: boolean;
  label?: string;
}

export default function ColorPicker({
  value,
  onChange,
  disabled,
  compact,
  label,
}: ColorPickerProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [draft, setDraft] = useState(value);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const open = Boolean(anchorEl);
  const size = compact ? 24 : 28;

  // Sync draft when the external value changes or popover opens
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const handleSave = useCallback(() => {
    onChange(draft);
    // Push to recent (deduplicate, most recent first)
    const updated = [draft, ...recent.filter((c) => c !== draft)].slice(0, MAX_RECENT);
    setRecent(updated);
    saveRecent(updated);
    setAnchorEl(null);
  }, [draft, onChange, recent]);

  const handleCancel = useCallback(() => {
    setDraft(value);
    setAnchorEl(null);
  }, [value]);

  const handleRecentClick = (color: string) => {
    setDraft(color);
  };

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
          if (!disabled) setAnchorEl(e.currentTarget);
        }}
      >
        <Tooltip title={disabled ? "" : "Pick color"}>
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
          {/* Recent colors row */}
          {recent.length > 0 && (
            <Box sx={{ px: 1.5, pt: 1.5, pb: 0.5 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mb: 0.5, fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: 0.5 }}
              >
                Recent
              </Typography>
              <Box sx={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                {recent.map((c) => (
                  <Tooltip key={c} title={c} placement="top" arrow>
                    <Box
                      onClick={() => handleRecentClick(c)}
                      sx={{
                        width: 18,
                        height: 18,
                        borderRadius: 0.5,
                        bgcolor: c,
                        cursor: "pointer",
                        border: c === draft ? "2px solid" : "1px solid",
                        borderColor: c === draft ? "primary.main" : "divider",
                        transition: "transform 0.1s",
                        "&:hover": { transform: "scale(1.2)" },
                      }}
                    />
                  </Tooltip>
                ))}
              </Box>
            </Box>
          )}

          {/* Sketch picker */}
          <Sketch
            color={draft}
            disableAlpha
            presetColors={PRESET_COLORS}
            onChange={(color) => setDraft(color.hex)}
          />

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
            <Button size="small" onClick={handleCancel}>
              Cancel
            </Button>
            <Button size="small" variant="contained" onClick={handleSave}>
              Save
            </Button>
          </Box>
        </Box>
      </Popover>
    </>
  );
}
