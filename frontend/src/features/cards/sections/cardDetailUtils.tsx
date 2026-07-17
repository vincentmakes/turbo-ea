import { useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
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
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import type { CurrencyFormatter } from "@/hooks/useCurrency";
import { readableTextColor, readableTypeColor } from "@/lib/color";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useFieldLabel, useOptionLabel } from "@/hooks/useResolveLabel";
import { ExtensionBoundary, useExtensionFieldTypes } from "@/lib/extensionHost";
import type { FieldDef, Relation } from "@/types";

// ── Subtype grouping for the Relations panel (#792) ─────────────
export const SUBTYPE_GROUP_MIN = 8;
export const NO_SUBTYPE_KEY = "__none__";

export interface SubtypeBucket {
  /** Subtype key, or the NO_SUBTYPE_KEY sentinel for the trailing bucket. */
  key: string;
  isNoSubtype: boolean;
  rels: Relation[];
}

/**
 * Bucket a relation-type's related cards by the "other" card's subtype.
 *
 * `subtypeKeysInOrder` is the target card type's metamodel subtype order;
 * buckets are emitted in that order (empty ones skipped). A trailing
 * no-subtype bucket collects cards whose subtype is falsy OR references a key
 * no longer in the metamodel, so stale-key cards never silently vanish. Cards
 * within a bucket are sorted alphabetically by name. Label resolution is
 * intentionally left to the caller so this stays React/i18n-free and easy to
 * unit-test.
 */
export function bucketRelationsBySubtype(
  rels: Relation[],
  fsId: string,
  subtypeKeysInOrder: string[],
): SubtypeBucket[] {
  const known = new Set(subtypeKeysInOrder);
  const groups = new Map<string, Relation[]>();
  const noSubtype: Relation[] = [];
  const other = (r: Relation) => (r.source_id === fsId ? r.target : r.source);
  for (const r of rels) {
    const st = other(r)?.subtype;
    if (st && known.has(st)) {
      const arr = groups.get(st) ?? [];
      arr.push(r);
      groups.set(st, arr);
    } else {
      noSubtype.push(r);
    }
  }
  const byName = (a: Relation, b: Relation) =>
    (other(a)?.name ?? "").localeCompare(other(b)?.name ?? "", undefined, {
      sensitivity: "base",
    });
  const buckets: SubtypeBucket[] = [];
  for (const key of subtypeKeysInOrder) {
    const arr = groups.get(key);
    if (arr && arr.length > 0) {
      buckets.push({ key, isNoSubtype: false, rels: [...arr].sort(byName) });
    }
  }
  if (noSubtype.length > 0) {
    buckets.push({
      key: NO_SUBTYPE_KEY,
      isNoSubtype: true,
      rels: [...noSubtype].sort(byName),
    });
  }
  return buckets;
}

/**
 * Whether subtype grouping is worth showing for a relation section: at least
 * two real-subtype buckets AND a total large enough that a flat list is hard
 * to scan.
 */
export function shouldGroupBySubtype(
  buckets: SubtypeBucket[],
  totalCount: number,
  min: number = SUBTYPE_GROUP_MIN,
): boolean {
  const realBuckets = buckets.filter((b) => !b.isNoSubtype).length;
  return realBuckets >= 2 && totalCount >= min;
}

// ── Field help text (localized, collapsible) ────────────────────
/** Resolve a field's localized help text (helpTranslations[locale] || help). */
export function useFieldHelp(): (field: FieldDef) => string {
  const { i18n } = useTranslation();
  const locale = i18n.language;
  return (field: FieldDef) =>
    (field.helpTranslations?.[locale] as string) || field.help || "";
}

/** Collapsible guidance rendered under a field during data entry. */
export function FieldHelp({ text }: { text: string }) {
  const { t } = useTranslation(["cards", "common"]);
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <Box sx={{ mt: 0.25 }}>
      <Box
        component="button"
        type="button"
        onClick={() => setOpen((o) => !o)}
        sx={{
          all: "unset",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 0.25,
          color: "primary.main",
          "&:hover": { textDecoration: "underline" },
        }}
      >
        <MaterialSymbol icon="help" size={14} />
        <Typography variant="caption" component="span">
          {t("cards:utils.fieldHelp")}
        </Typography>
        <MaterialSymbol icon={open ? "expand_less" : "expand_more"} size={14} />
      </Box>
      <Collapse in={open}>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mt: 0.25, whiteSpace: "pre-wrap" }}
        >
          {text}
        </Typography>
      </Collapse>
    </Box>
  );
}

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

// ── Card ID Pill (human-readable reference, #811) ────────────────
/** Read-only, copy-to-clipboard pill. Colored in the card type's light tint —
 * the same scheme the Layered Dependency View uses for its nodes (raw hex text in
 * light mode / lightened in dark, over a low-alpha tint of the type color). */
export function CardIdPill({
  reference,
  typeColor,
}: {
  reference: string | null | undefined;
  typeColor?: string;
}) {
  const { t } = useTranslation(["cards", "common"]);
  const theme = useTheme();
  const [copied, setCopied] = useState(false);

  if (!reference) return null;

  const isDark = theme.palette.mode === "dark";
  // Guard non-hex metamodel colors (mirrors LayeredDependencyView's fallback).
  const hex = /^#[0-9a-fA-F]{6}$/.test(typeColor || "") ? (typeColor as string) : "#9e9e9e";
  const accent = readableTypeColor(hex, isDark);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const bg = `rgba(${r},${g},${b},${isDark ? 0.18 : 0.12})`;

  const copy = () => {
    void navigator.clipboard?.writeText(reference).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <Tooltip title={copied ? t("utils.cardId.copied") : t("utils.cardId.tooltip")}>
      <Box
        onClick={copy}
        sx={{
          height: 22,
          borderRadius: "11px",
          border: `1px solid ${accent}`,
          bgcolor: bg,
          display: "inline-flex",
          alignItems: "center",
          gap: 0.375,
          px: 0.75,
          cursor: "pointer",
          boxSizing: "border-box",
          maxWidth: "100%",
        }}
      >
        <MaterialSymbol icon="tag" size={12} color={accent} />
        <Typography
          variant="caption"
          fontWeight={700}
          noWrap
          sx={{ color: accent, lineHeight: 1, fontSize: "0.7rem", fontFamily: "monospace" }}
        >
          {reference}
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
  const optLabel = useOptionLabel();
  const extFieldTypes = useExtensionFieldTypes();

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

  // Extension-contributed custom field type: render its display component.
  // When the extension is missing/disabled/unlicensed it is absent from the
  // registry and we fall through to the plain read-only rendering below.
  const customDisplay = extFieldTypes[field.type];
  if (customDisplay?.contribution.display) {
    const Display = customDisplay.contribution.display;
    return (
      <ExtensionBoundary extensionKey={customDisplay.extKey}>
        <Display
          field={{ key: field.key, label: field.label, type: field.type, config: field.config }}
          value={value}
          config={field.config ?? customDisplay.contribution.defaultConfig}
        />
      </ExtensionBoundary>
    );
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
      <Chip size="small" label={optLabel(opt)} sx={{ ...SELECT_CHIP_BASE, width: w, ...(opt.color ? { bgcolor: opt.color, color: readableTextColor(opt.color) } : {}) }} />
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
            <Chip key={key + i} size="small" label={optLabel(opt)} sx={{ ...SELECT_CHIP_BASE, width: w, ...(opt.color ? { bgcolor: opt.color, color: readableTextColor(opt.color) } : {}) }} />
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
  const fieldLabel = useFieldLabel();
  const optLabel = useOptionLabel();
  const help = useFieldHelp()(field);
  const extFieldTypes = useExtensionFieldTypes();

  // Sanitize: ensure value passed to MUI is always the expected primitive type
  const strVal = typeof value === "string" ? value : (value != null ? safeString(value) : "");
  const numVal = typeof value === "number" ? value : (value != null && value !== "" ? Number(value) : "");

  const custom = extFieldTypes[field.type];

  const control = (() => {
    // Extension-contributed field type: render its editor. Missing/disabled/
    // unlicensed → not in the registry → falls through to the built-in switch
    // (default text input), so the stored value stays editable, never lost.
    if (custom?.contribution.editor) {
      const Editor = custom.contribution.editor;
      return (
        <ExtensionBoundary extensionKey={custom.extKey}>
          <Editor
            field={{ key: field.key, label: fieldLabel(field), type: field.type, config: field.config }}
            value={value}
            config={field.config ?? custom.contribution.defaultConfig}
            onChange={onChange}
            error={error}
          />
        </ExtensionBoundary>
      );
    }
    switch (field.type) {
    case "single_select":
      return (
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>{fieldLabel(field)}</InputLabel>
          <Select
            value={strVal}
            label={fieldLabel(field)}
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
                  {optLabel(opt)}
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      );
    case "multiple_select": {
      const arrVal: string[] = Array.isArray(value) ? value.map((v) => typeof v === "string" ? v : safeString(v)) : (strVal ? [strVal] : []);
      const labelText = fieldLabel(field);
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
                        label={opt ? optLabel(opt) : key}
                        onMouseDown={(e) => e.stopPropagation()}
                        onDelete={() => onChange(arrVal.filter((v) => v !== key))}
                        sx={{
                          height: 22,
                          ...(opt?.color
                            ? {
                                bgcolor: opt.color,
                                color: readableTextColor(opt.color),
                                "& .MuiChip-deleteIcon": { color: readableTextColor(opt.color), opacity: 0.85 },
                              }
                            : {}),
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
                    {optLabel(opt)}
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
            label={fieldLabel(field)}
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
          label={fieldLabel(field)}
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
          label={fieldLabel(field)}
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
          label={fieldLabel(field)}
        />
      );
    case "date":
      return (
        <TextField
          size="small"
          label={fieldLabel(field)}
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
          label={fieldLabel(field)}
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
          label={fieldLabel(field)}
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
          label={fieldLabel(field)}
          value={strVal}
          onChange={(e) => onChange(e.target.value || undefined)}
          sx={{ minWidth: 300 }}
        />
      );
    }
  })();

  return (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      {control}
      <FieldHelp text={help} />
    </Box>
  );
}
