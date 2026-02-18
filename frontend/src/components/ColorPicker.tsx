import { useState, useRef } from "react";
import Box from "@mui/material/Box";
import Popover from "@mui/material/Popover";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";

/**
 * Curated color palette — 12 hues x 5 shades (light → dark).
 * Inspired by Tailwind / Material palettes, tuned for EA diagrams.
 */
const PALETTE: string[][] = [
  // red
  ["#fecaca", "#f87171", "#ef4444", "#dc2626", "#991b1b"],
  // orange
  ["#fed7aa", "#fb923c", "#f97316", "#ea580c", "#9a3412"],
  // amber
  ["#fde68a", "#fbbf24", "#f59e0b", "#d97706", "#92400e"],
  // green
  ["#bbf7d0", "#4ade80", "#22c55e", "#16a34a", "#166534"],
  // teal
  ["#99f6e4", "#2dd4bf", "#14b8a6", "#0d9488", "#115e59"],
  // cyan
  ["#a5f3fc", "#22d3ee", "#06b6d4", "#0891b2", "#155e75"],
  // blue
  ["#bfdbfe", "#60a5fa", "#3b82f6", "#2563eb", "#1e3a8a"],
  // indigo
  ["#c7d2fe", "#818cf8", "#6366f1", "#4f46e5", "#312e81"],
  // violet
  ["#ddd6fe", "#a78bfa", "#8b5cf6", "#7c3aed", "#4c1d95"],
  // pink
  ["#fbcfe8", "#f472b6", "#ec4899", "#db2777", "#9d174d"],
  // slate
  ["#e2e8f0", "#94a3b8", "#64748b", "#475569", "#1e293b"],
  // neutral
  ["#f5f5f4", "#a8a29e", "#78716c", "#57534e", "#292524"],
];

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
  const [showCustom, setShowCustom] = useState(false);
  const nativeRef = useRef<HTMLInputElement>(null);

  const open = Boolean(anchorEl);
  const size = compact ? 24 : 28;

  const handleSwatchClick = (color: string) => {
    onChange(color);
    setAnchorEl(null);
  };

  return (
    <>
      {/* Trigger */}
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
            <Typography variant="body2" color="text.secondary" sx={{ fontFamily: "monospace", fontSize: "0.78rem" }}>
              {value}
            </Typography>
          </>
        )}
      </Box>

      {/* Popover */}
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => { setAnchorEl(null); setShowCustom(false); }}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{ paper: { sx: { p: 1.5, width: 228 } } }}
      >
        {/* Swatch grid */}
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: "5px",
          }}
        >
          {PALETTE.map((row) =>
            row.map((c) => (
              <Tooltip key={c} title={c} placement="top" arrow>
                <Box
                  onClick={() => handleSwatchClick(c)}
                  sx={{
                    width: 32,
                    height: 32,
                    borderRadius: 0.5,
                    bgcolor: c,
                    cursor: "pointer",
                    border: c === value ? "2px solid" : "1px solid",
                    borderColor: c === value ? "primary.main" : "divider",
                    boxShadow: c === value ? (t) => `0 0 0 1px ${t.palette.primary.main}` : "none",
                    transition: "transform 0.1s, box-shadow 0.1s",
                    "&:hover": {
                      transform: "scale(1.15)",
                      zIndex: 1,
                    },
                  }}
                />
              </Tooltip>
            )),
          )}
        </Box>

        {/* Custom color toggle */}
        <Box sx={{ mt: 1.5, display: "flex", alignItems: "center", gap: 1 }}>
          <Typography
            variant="caption"
            sx={{
              cursor: "pointer",
              color: "primary.main",
              "&:hover": { textDecoration: "underline" },
            }}
            onClick={() => {
              if (showCustom && nativeRef.current) {
                nativeRef.current.click();
              }
              setShowCustom(true);
            }}
          >
            {showCustom ? "Click the swatch to open color wheel" : "Custom color..."}
          </Typography>
          {showCustom && (
            <input
              ref={nativeRef}
              type="color"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              style={{
                width: 32,
                height: 32,
                border: "none",
                padding: 0,
                borderRadius: 4,
                cursor: "pointer",
                background: "transparent",
              }}
            />
          )}
        </Box>
      </Popover>
    </>
  );
}
