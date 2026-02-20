import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import InputAdornment from "@mui/material/InputAdornment";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { FieldDef } from "@/types";

// ── Data Quality Ring ───────────────────────────────────────────
export function DataQualityRing({ value }: { value: number }) {
  const size = 52;
  const sw = 5;
  const r = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (value / 100) * circ;
  const color = value >= 80 ? "#4caf50" : value >= 50 ? "#ff9800" : "#f44336";
  return (
    <Tooltip title={`${Math.round(value)}% complete`}>
      <Box
        sx={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: size,
          height: size,
        }}
      >
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="#e0e0e0"
            strokeWidth={sw}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={sw}
            strokeDasharray={circ}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        </svg>
        <Typography
          variant="caption"
          fontWeight={700}
          sx={{ position: "absolute" }}
        >
          {Math.round(value)}%
        </Typography>
      </Box>
    </Tooltip>
  );
}

// ── Lifecycle Phase Labels ──────────────────────────────────────
export const PHASES = ["plan", "phaseIn", "active", "phaseOut", "endOfLife"] as const;
export const PHASE_LABELS: Record<string, string> = {
  plan: "Plan",
  phaseIn: "Phase In",
  active: "Active",
  phaseOut: "Phase Out",
  endOfLife: "End of Life",
};

// ── Safe string coercion (never returns an object/array) ────────
export function safeString(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(safeString).join(", ");
  try { return JSON.stringify(value); } catch { return "[invalid]"; }
}

// Consistent chip style for all select fields (same fixed width for visual alignment)
// Base chip style -- width is computed per-field from the longest option label
export const SELECT_CHIP_BASE = {
  maxWidth: "100%",
  justifyContent: "center",
  "& .MuiChip-label": { overflow: "hidden", textOverflow: "ellipsis" },
} as const;

/** Compute a uniform chip width for a field based on its longest option label. */
export function chipWidthForField(options: FieldDef["options"]): number {
  if (!options || options.length === 0) return 180;
  const maxLen = Math.max(...options.map((o) => o.label.length));
  // ~7.5px per char + 28px chip padding, clamped between 180 and 300
  return Math.max(180, Math.min(300, Math.round(maxLen * 7.5 + 28)));
}

// ── Read-only field value renderer ──────────────────────────────
export function FieldValue({ field, value, currencyFmt }: { field: FieldDef; value: unknown; currencyFmt?: Intl.NumberFormat }) {

  if (value == null || value === "") {
    return <Typography variant="body2" color="text.secondary">—</Typography>;
  }

  // Guard: if value is an object/array and the field type doesn't expect it, coerce to string
  if (typeof value === "object" && !Array.isArray(value) && field.type !== "multiple_select") {
    return <Typography variant="body2">{safeString(value)}</Typography>;
  }

  if (field.type === "single_select" && field.options) {
    const w = chipWidthForField(field.options);
    const strVal = typeof value === "string" ? value : safeString(value);
    const opt = field.options.find((o) => o.key === strVal);
    return opt ? (
      <Chip size="small" label={opt.label} sx={{ ...SELECT_CHIP_BASE, width: w, ...(opt.color ? { bgcolor: opt.color, color: "#fff" } : {}) }} />
    ) : (
      <Tooltip title={`Unknown option key: ${strVal}`}>
        <Chip size="small" label={strVal} variant="outlined" color="warning" sx={{ ...SELECT_CHIP_BASE, width: w }} />
      </Tooltip>
    );
  }

  if (field.type === "multiple_select" && field.options) {
    const w = chipWidthForField(field.options);
    const arr = Array.isArray(value) ? value : [value];
    return (
      <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
        {arr.map((v, i) => {
          const key = typeof v === "string" ? v : safeString(v);
          const opt = field.options!.find((o) => o.key === key);
          return opt ? (
            <Chip key={key + i} size="small" label={opt.label} sx={{ ...SELECT_CHIP_BASE, width: w, ...(opt.color ? { bgcolor: opt.color, color: "#fff" } : {}) }} />
          ) : (
            <Chip key={key + i} size="small" label={key} variant="outlined" color="warning" sx={{ ...SELECT_CHIP_BASE, width: w }} />
          );
        })}
      </Box>
    );
  }

  if (field.type === "boolean") {
    return (
      <MaterialSymbol
        icon={value ? "check_circle" : "cancel"}
        size={18}
        color={value ? "#4caf50" : "#bdbdbd"}
      />
    );
  }
  if (field.type === "url") {
    const href = safeString(value);
    return (
      <Typography
        component="a"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        variant="body2"
        sx={{ color: "primary.main", textDecoration: "none", "&:hover": { textDecoration: "underline" }, wordBreak: "break-all" }}
      >
        {href}
      </Typography>
    );
  }
  if (field.type === "cost" && currencyFmt) {
    const num = Number(value);
    return (
      <Typography variant="body2">
        {!isNaN(num) ? currencyFmt.format(num) : safeString(value)}
      </Typography>
    );
  }
  return (
    <Typography variant="body2">{safeString(value) || "—"}</Typography>
  );
}

// ── Field editor (inline) ───────────────────────────────────────
export function FieldEditor({
  field,
  value,
  onChange,
  currencySymbol,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  currencySymbol?: string;
}) {

  // Sanitize: ensure value passed to MUI is always the expected primitive type
  const strVal = typeof value === "string" ? value : (value != null ? safeString(value) : "");
  const numVal = typeof value === "number" ? value : (value != null && value !== "" ? Number(value) : "");

  switch (field.type) {
    case "single_select":
      return (
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>{field.label}</InputLabel>
          <Select
            value={strVal}
            label={field.label}
            onChange={(e) => onChange(e.target.value || undefined)}
          >
            <MenuItem value="">
              <em>None</em>
            </MenuItem>
            {field.options?.map((opt) => (
              <MenuItem key={opt.key} value={opt.key}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  {opt.color && (
                    <Box
                      sx={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        bgcolor: opt.color,
                      }}
                    />
                  )}
                  {opt.label}
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      );
    case "multiple_select": {
      const arrVal: string[] = Array.isArray(value) ? value.map((v) => typeof v === "string" ? v : safeString(v)) : (strVal ? [strVal] : []);
      return (
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>{field.label}</InputLabel>
          <Select
            multiple
            value={arrVal}
            label={field.label}
            onChange={(e) => {
              const v = e.target.value;
              onChange(typeof v === "string" ? v.split(",") : v);
            }}
            renderValue={(selected) => (
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                {(selected as string[]).map((key) => {
                  const opt = field.options?.find((o) => o.key === key);
                  return <Chip key={key} size="small" label={opt?.label || key} sx={{ height: 22 }} />;
                })}
              </Box>
            )}
          >
            {field.options?.map((opt) => (
              <MenuItem key={opt.key} value={opt.key}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  {opt.color && (
                    <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: opt.color }} />
                  )}
                  {opt.label}
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      );
    }
    case "cost":
      return (
        <TextField
          size="small"
          label={field.label}
          type="number"
          value={numVal}
          onChange={(e) =>
            onChange(e.target.value ? Number(e.target.value) : undefined)
          }
          slotProps={{ input: { startAdornment: <InputAdornment position="start">{currencySymbol || "$"}</InputAdornment> } }}
          sx={{ minWidth: 200 }}
        />
      );
    case "number":
      return (
        <TextField
          size="small"
          label={field.label}
          type="number"
          value={numVal}
          onChange={(e) =>
            onChange(e.target.value ? Number(e.target.value) : undefined)
          }
          sx={{ minWidth: 200 }}
        />
      );
    case "boolean":
      return (
        <FormControlLabel
          control={
            <Switch
              checked={!!value}
              onChange={(e) => onChange(e.target.checked)}
            />
          }
          label={field.label}
        />
      );
    case "date":
      return (
        <TextField
          size="small"
          label={field.label}
          type="date"
          value={strVal}
          onChange={(e) => onChange(e.target.value || undefined)}
          InputLabelProps={{ shrink: true }}
          sx={{ minWidth: 200 }}
        />
      );
    case "url":
      return (
        <TextField
          size="small"
          label={field.label}
          type="url"
          placeholder="https://"
          value={strVal}
          onChange={(e) => onChange(e.target.value || undefined)}
          sx={{ minWidth: 300 }}
        />
      );
    default:
      return (
        <TextField
          size="small"
          label={field.label}
          value={strVal}
          onChange={(e) => onChange(e.target.value || undefined)}
          sx={{ minWidth: 300 }}
        />
      );
  }
}
