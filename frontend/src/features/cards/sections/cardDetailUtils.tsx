import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Checkbox from "@mui/material/Checkbox";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import InputAdornment from "@mui/material/InputAdornment";
import { useTranslation } from "react-i18next";
import type { CurrencyFormatter } from "@/hooks/useCurrency";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useResolveLabel } from "@/hooks/useResolveLabel";
import type { FieldDef } from "@/types";

// ── URL validation (matches backend _ALLOWED_URL_SCHEMES) ────────
const ALLOWED_URL_SCHEMES = ["http://", "https://", "mailto:"];
export function isValidUrl(value: string): boolean {
  if (!value) return true; // empty is valid (field not required)
  return ALLOWED_URL_SCHEMES.some((s) => value.trim().startsWith(s));
}
export const URL_ERROR_MSG_KEY = "cards:utils.urlError";
export const URL_ERROR_MSG = "Must use http://, https://, or mailto: scheme";
export function getUrlErrorMsg(t: (key: string) => string): string {
  return t("utils.urlError");
}

// ── Data Quality Pill ───────────────────────────────────────────
export function DataQualityPill({ value }: { value: number }) {
  const { t } = useTranslation(["cards", "common"]);
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const color = v >= 80 ? "#4caf50" : v >= 50 ? "#ff9800" : "#f44336";
  return (
    <Tooltip title={t("utils.dataQuality", { value: v })}>
      <Box
        sx={{
          position: "relative",
          height: 24,
          minWidth: 52,
          borderRadius: "12px",
          border: `1px solid ${color}`,
          overflow: "hidden",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: "transparent",
          px: 1,
          boxSizing: "border-box",
        }}
      >
        <Box
          sx={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            width: `${v}%`,
            bgcolor: color,
            opacity: 0.18,
          }}
        />
        <Typography
          variant="caption"
          fontWeight={700}
          sx={{
            position: "relative",
            color,
            lineHeight: 1,
            fontSize: "0.7rem",
          }}
        >
          {v}%
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
export function getPhaseLabels(t: (key: string) => string): Record<string, string> {
  return {
    plan: t("common:lifecycle.plan"),
    phaseIn: t("common:lifecycle.phaseIn"),
    active: t("common:lifecycle.active"),
    phaseOut: t("common:lifecycle.phaseOut"),
    endOfLife: t("common:lifecycle.endOfLife"),
  };
}

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
export function FieldValue({
  field,
  value,
  currencyFmt,
  canViewCosts = true,
}: {
  field: FieldDef;
  value: unknown;
  currencyFmt?: CurrencyFormatter;
  canViewCosts?: boolean;
}) {
  const { t } = useTranslation(["cards", "common"]);
  const rl = useResolveLabel();

  // Cost fields the user is not allowed to see render as a redacted placeholder
  // regardless of whether the backend stripped the value (defence in depth + UX).
  if (field.type === "cost" && !canViewCosts) {
    return (
      <Tooltip title={t("cards:utils.costRestricted")}>
        <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
          <MaterialSymbol icon="lock" size={14} color="#9e9e9e" />
          <Typography variant="body2" color="text.secondary">
            —
          </Typography>
        </Box>
      </Tooltip>
    );
  }

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
      <Chip size="small" label={rl(opt.label || opt.key, opt.translations)} sx={{ ...SELECT_CHIP_BASE, width: w, ...(opt.color ? { bgcolor: opt.color, color: "#fff" } : {}) }} />
    ) : (
      <Tooltip title={t("utils.unknownOption", { key: strVal })}>
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
            <Chip key={key + i} size="small" label={rl(opt.label || opt.key, opt.translations)} sx={{ ...SELECT_CHIP_BASE, width: w, ...(opt.color ? { bgcolor: opt.color, color: "#fff" } : {}) }} />
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
  if (field.type === "multiline_text") {
    return (
      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
        {safeString(value) || "—"}
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
  error,
  canViewCosts = true,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  currencySymbol?: string;
  error?: string;
  canViewCosts?: boolean;
}) {
  const { t } = useTranslation(["cards", "common"]);
  const rl = useResolveLabel();

  // Sanitize: ensure value passed to MUI is always the expected primitive type
  const strVal = typeof value === "string" ? value : (value != null ? safeString(value) : "");
  const numVal = typeof value === "number" ? value : (value != null && value !== "" ? Number(value) : "");

  switch (field.type) {
    case "single_select":
      return (
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>{rl(field.key, field.translations)}</InputLabel>
          <Select
            value={strVal}
            label={rl(field.key, field.translations)}
            onChange={(e) => onChange(e.target.value || undefined)}
          >
            <MenuItem value="">
              <em>{t("common:labels.none")}</em>
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
                  {rl(opt.label || opt.key, opt.translations)}
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      );
    case "multiple_select": {
      const arrVal: string[] = Array.isArray(value) ? value.map((v) => typeof v === "string" ? v : safeString(v)) : (strVal ? [strVal] : []);
      const labelText = rl(field.key, field.translations);
      return (
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>{labelText}</InputLabel>
          <Select
            multiple
            value={arrVal}
            label={labelText}
            onChange={(e) => {
              const v = e.target.value;
              onChange(typeof v === "string" ? v.split(",") : v);
            }}
            displayEmpty
            renderValue={(selected) => {
              const arr = selected as string[];
              if (arr.length === 0) {
                return (
                  <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>
                    {t("common:labels.selectMultiple", { defaultValue: "Select one or more…" })}
                  </Typography>
                );
              }
              return (
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                  {arr.map((key) => {
                    const opt = field.options?.find((o) => o.key === key);
                    return (
                      <Chip
                        key={key}
                        size="small"
                        label={opt ? rl(opt.label || opt.key, opt.translations) : key}
                        onMouseDown={(e) => e.stopPropagation()}
                        onDelete={() => onChange(arrVal.filter((v) => v !== key))}
                        sx={{
                          height: 22,
                          ...(opt?.color ? { bgcolor: opt.color, color: "#fff", "& .MuiChip-deleteIcon": { color: "rgba(255,255,255,0.85)" } } : {}),
                        }}
                      />
                    );
                  })}
                </Box>
              );
            }}
          >
            {field.options?.map((opt) => {
              const checked = arrVal.includes(opt.key);
              return (
                <MenuItem key={opt.key} value={opt.key}>
                  <Checkbox size="small" checked={checked} sx={{ p: 0.5, mr: 1 }} />
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    {opt.color && (
                      <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: opt.color }} />
                    )}
                    {rl(opt.label || opt.key, opt.translations)}
                  </Box>
                </MenuItem>
              );
            })}
          </Select>
        </FormControl>
      );
    }
    case "cost":
      if (!canViewCosts) {
        return (
          <TextField
            size="small"
            label={rl(field.key, field.translations)}
            value={t("cards:utils.costRestricted")}
            disabled
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <MaterialSymbol icon="lock" size={14} />
                  </InputAdornment>
                ),
              },
            }}
            sx={{ minWidth: 200 }}
          />
        );
      }
      return (
        <TextField
          size="small"
          label={rl(field.key, field.translations)}
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
          label={rl(field.key, field.translations)}
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
          label={rl(field.key, field.translations)}
        />
      );
    case "date":
      return (
        <TextField
          size="small"
          label={rl(field.key, field.translations)}
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
          label={rl(field.key, field.translations)}
          type="url"
          placeholder="https://"
          value={strVal}
          onChange={(e) => onChange(e.target.value || undefined)}
          error={!!error}
          helperText={error}
          sx={{ minWidth: 300 }}
        />
      );
    case "multiline_text":
      return (
        <TextField
          size="small"
          label={rl(field.key, field.translations)}
          value={strVal}
          onChange={(e) => onChange(e.target.value || undefined)}
          multiline
          minRows={3}
          maxRows={10}
          fullWidth
          sx={{ minWidth: 300 }}
        />
      );
    default:
      return (
        <TextField
          size="small"
          label={rl(field.key, field.translations)}
          value={strVal}
          onChange={(e) => onChange(e.target.value || undefined)}
          sx={{ minWidth: 300 }}
        />
      );
  }
}
