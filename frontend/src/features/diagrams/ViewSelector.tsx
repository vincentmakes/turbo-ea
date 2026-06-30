import { useMemo, useState as useReactState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useTypeLabel } from "@/hooks/useResolveLabel";
import { APPROVAL_STATUS_COLORS, SEVERITY_COLORS, STATUS_COLORS } from "@/theme/tokens";
import type { CardType, FieldDef } from "@/types";

/** Identifies the chosen "color by" perspective. */
export type ViewSource =
  | { kind: "card_type" } // default: each cell takes its card-type colour
  | { kind: "card_field"; type_key: string; field_key: string }
  | { kind: "approval_status" };

export interface ColorEntry {
  value: string;
  label: string;
  color: string;
}

interface Props {
  /** Card-type keys actually present on the canvas — drives which fields are offered. */
  activeTypeKeys: string[];
  types: CardType[];
  current: ViewSource;
  onChange: (next: ViewSource) => void;
}

/**
 * "Select a view" toolbar dropdown — LeanIX-style. Lists fields the user can
 * colour the canvas by. v1 supports:
 *   - Card type (reset)
 *   - Approval status (always available)
 *   - Single-select fields from the metamodel for each type on the canvas
 *
 * Numeric / cost / lifecycle / relation-attribute perspectives are left for
 * a follow-up because they need quantile binning or extra fetches.
 */
export default function ViewSelector({
  activeTypeKeys,
  types,
  current,
  onChange,
}: Props) {
  const { t } = useTranslation(["diagrams", "common"]);
  const typeLabel = useTypeLabel();
  const [anchorEl, setAnchorEl] = useMenu();

  const typeMap = useMemo(
    () => new Map(types.map((tp) => [tp.key, tp] as const)),
    [types],
  );

  const fieldsByType = useMemo(() => {
    const result: Array<{ type: CardType; fields: FieldDef[] }> = [];
    for (const key of activeTypeKeys) {
      const tp = typeMap.get(key);
      if (!tp) continue;
      const fields: FieldDef[] = [];
      for (const section of tp.fields_schema ?? []) {
        for (const f of section.fields ?? []) {
          if (f.type === "single_select" && (f.options?.length ?? 0) > 0) {
            fields.push(f);
          }
        }
      }
      if (fields.length > 0) result.push({ type: tp, fields });
    }
    return result;
  }, [activeTypeKeys, typeMap]);

  const currentLabel = useMemo(() => {
    if (current.kind === "card_type") return t("viewSelector.cardType");
    if (current.kind === "approval_status") return t("viewSelector.approvalStatus");
    const tp = typeMap.get(current.type_key);
    if (!tp) return t("viewSelector.cardType");
    const field = (tp.fields_schema ?? [])
      .flatMap((s) => s.fields ?? [])
      .find((f) => f.key === current.field_key);
    return field
      ? `${typeLabel(tp)} · ${field.label}`
      : t("viewSelector.cardType");
  }, [current, typeMap, typeLabel, t]);

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        startIcon={<MaterialSymbol icon="palette" size={18} />}
        endIcon={<MaterialSymbol icon="expand_more" size={16} />}
        onClick={(e) => setAnchorEl(e.currentTarget)}
        sx={{
          textTransform: "none",
          fontSize: "0.8rem",
          minWidth: 0,
          maxWidth: 240,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {t("viewSelector.button", { view: currentLabel })}
      </Button>
      <Menu
        open={!!anchorEl}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        slotProps={{ paper: { sx: { minWidth: 280, maxHeight: 480 } } }}
      >
        <MenuItem
          selected={current.kind === "card_type"}
          onClick={() => {
            onChange({ kind: "card_type" });
            setAnchorEl(null);
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <MaterialSymbol icon="palette" size={16} color="#666" />
            {t("viewSelector.cardType")}
          </Box>
        </MenuItem>

        <MenuItem
          selected={current.kind === "approval_status"}
          onClick={() => {
            onChange({ kind: "approval_status" });
            setAnchorEl(null);
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <MaterialSymbol icon="check_circle" size={16} color="#666" />
            {t("viewSelector.approvalStatus")}
          </Box>
        </MenuItem>

        {fieldsByType.length > 0 && <Divider sx={{ my: 0.5 }} />}
        {fieldsByType.length > 0 && (
          <Box
            sx={{
              px: 2,
              py: 0.5,
              fontSize: "0.7rem",
              textTransform: "uppercase",
              letterSpacing: 0.5,
              color: "text.secondary",
            }}
          >
            {t("viewSelector.fieldsOnCard")}
          </Box>
        )}

        {fieldsByType.map(({ type, fields }) => [
          <Box
            key={`hdr-${type.key}`}
            sx={{
              px: 2,
              py: 0.25,
              fontSize: "0.7rem",
              color: type.color,
              fontWeight: 600,
            }}
          >
            {typeLabel(type)}
          </Box>,
          ...fields.map((f) => {
            const active =
              current.kind === "card_field" &&
              current.type_key === type.key &&
              current.field_key === f.key;
            return (
              <MenuItem
                key={`${type.key}-${f.key}`}
                selected={active}
                onClick={() => {
                  onChange({ kind: "card_field", type_key: type.key, field_key: f.key });
                  setAnchorEl(null);
                }}
                sx={{ pl: 4 }}
              >
                <Typography variant="body2">{f.label}</Typography>
              </MenuItem>
            );
          }),
        ])}
      </Menu>
    </>
  );
}

// ─── Color-mapping helpers ─────────────────────────────────────────────────

/** Build a value → ColorEntry map for the chosen view. Returns an empty map
 *  for the default (card-type) view since cells keep their type colour. */
export function buildColorMap(
  view: ViewSource,
  types: CardType[],
): Map<string, ColorEntry> {
  if (view.kind === "card_type") return new Map();
  if (view.kind === "approval_status") {
    return new Map(
      Object.entries(APPROVAL_STATUS_COLORS).map(([k, c]) => [
        k,
        { value: k, label: humanize(k), color: c },
      ]),
    );
  }
  const tp = types.find((t) => t.key === view.type_key);
  if (!tp) return new Map();
  const field = (tp.fields_schema ?? [])
    .flatMap((s) => s.fields ?? [])
    .find((f) => f.key === view.field_key);
  if (!field) return new Map();
  const opts = field.options ?? [];
  const fallbackPalette = [
    SEVERITY_COLORS.low,
    SEVERITY_COLORS.medium,
    SEVERITY_COLORS.high,
    SEVERITY_COLORS.critical,
    STATUS_COLORS.info,
    STATUS_COLORS.success,
    STATUS_COLORS.warning,
    STATUS_COLORS.error,
    STATUS_COLORS.neutral,
  ];
  const result = new Map<string, ColorEntry>();
  opts.forEach((opt, i) => {
    result.set(opt.key, {
      value: opt.key,
      label: opt.label,
      color: opt.color || fallbackPalette[i % fallbackPalette.length],
    });
  });
  return result;
}

/** Pick the right value off a card record for the chosen view. */
export function extractCardValue(
  view: ViewSource,
  card: { type: string; approval_status?: string; attributes?: Record<string, unknown> | null },
): string | null {
  if (view.kind === "card_type") return null;
  if (view.kind === "approval_status") return card.approval_status ?? null;
  if (view.kind === "card_field") {
    if (card.type !== view.type_key) return null;
    const v = card.attributes?.[view.field_key];
    if (typeof v === "string") return v;
    return v == null ? null : String(v);
  }
  return null;
}

function humanize(key: string): string {
  return key
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Small inline anchor-state hook to keep ViewSelector self-contained ───

function useMenu() {
  return useReactState<HTMLElement | null>(null);
}
