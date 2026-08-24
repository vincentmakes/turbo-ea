import { useMemo, useState as useReactState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Divider from "@mui/material/Divider";
import Radio from "@mui/material/Radio";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import MenuSectionHeader from "@/components/MenuSectionHeader";
import { useFieldLabel, useTypeLabel } from "@/hooks/useResolveLabel";
import {
  buildFieldCatalog,
  groupFieldCatalog,
  MAX_CARD_LINES,
  type CardLabelSettings,
  type FieldGroup,
} from "@/lib/cardDisplayFields";
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
  /** Re-scan the canvas before the menu paints, so the field lists reflect what
   *  is on it right now rather than whenever they last happened to be built. */
  onOpen?: () => void;
  types: CardType[];
  current: ViewSource;
  onChange: (next: ViewSource) => void;
  /** Which fields are rendered as detail lines on each card shape. */
  labels: CardLabelSettings;
  onLabelsChange: (next: CardLabelSettings) => void;
}

/**
 * Card display dropdown for the diagram toolbar.
 *
 * Two settings, deliberately independent and deliberately shaped differently
 * so a reader can tell them apart without trying them:
 *
 *  - **Color by** — pick ONE. Radio rows.
 *  - **Show on card** — pick MANY. Checkbox rows.
 *
 * Neither closes the menu. Two settings share this dropdown, so dismissing it
 * on a colour pick would interrupt the other one — you would have to reopen to
 * carry on. The radio-vs-checkbox affordance is what says "one" and "many";
 * the close was never carrying that meaning.
 *
 * Both field lists are filed under the card type that owns them, using the same
 * catalogue the Layered Dependency View offers, so a field reads the same in a
 * report and on the diagram exported from it.
 */
export default function ViewSelector({
  activeTypeKeys,
  onOpen,
  types,
  current,
  onChange,
  labels,
  onLabelsChange,
}: Props) {
  const { t } = useTranslation(["diagrams", "common"]);
  const typeLabel = useTypeLabel();
  const fieldLabel = useFieldLabel();
  const [anchorEl, setAnchorEl] = useMenu();

  const typeMap = useMemo(
    () => new Map(types.map((tp) => [tp.key, tp] as const)),
    [types],
  );

  /** Colour perspectives: single-select fields only, since a perspective needs
   *  a bounded set of values to map onto a palette. */
  const colorFieldsByType = useMemo(() => {
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

  /** Display fields: every attribute of every card type on the canvas, filed
   *  under its owner. Shared with the Layered Dependency View's picker. */
  const labelGroups = useMemo(() => {
    const catalog = buildFieldCatalog(types, new Set(activeTypeKeys));
    return groupFieldCatalog(catalog, types);
  }, [types, activeTypeKeys]);

  const currentLabel = useMemo(() => {
    if (current.kind === "card_type") return t("viewSelector.cardType");
    if (current.kind === "approval_status") return t("viewSelector.approvalStatus");
    const tp = typeMap.get(current.type_key);
    if (!tp) return t("viewSelector.cardType");
    const field = (tp.fields_schema ?? [])
      .flatMap((s) => s.fields ?? [])
      .find((f) => f.key === current.field_key);
    return field
      ? `${typeLabel(tp)} · ${fieldLabel(field)}`
      : t("viewSelector.cardType");
  }, [current, typeMap, typeLabel, fieldLabel, t]);

  const buttonText = t("viewSelector.button", { view: currentLabel });

  const shownCount =
    labels.fields.length + (labels.showType ? 1 : 0) + (labels.showSubtype ? 1 : 0);

  const toggleField = (key: string) => {
    const next = labels.fields.includes(key)
      ? labels.fields.filter((k) => k !== key)
      : [...labels.fields, key];
    onLabelsChange({ ...labels, fields: next });
  };

  const groupLabel = (g: FieldGroup) =>
    g.kind === "shared" ? t("viewSelector.sharedFields") : typeLabel(g.type);

  return (
    <>
      <Tooltip title={buttonText}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<MaterialSymbol icon="palette" size={18} />}
          endIcon={<MaterialSymbol icon="expand_more" size={16} />}
          onClick={(e) => {
            onOpen?.();
            setAnchorEl(e.currentTarget);
          }}
          sx={{
            textTransform: "none",
            fontSize: "0.8rem",
            minWidth: 0,
            maxWidth: 260,
            // `overflow`/`textOverflow` must NOT live on the Button root: it is
            // an inline-flex container, so `text-overflow` never applies to its
            // anonymous text child and the clip eats the icons at both ends.
            // The inner span below is the block box that can actually ellipsis.
            "& .MuiButton-startIcon, & .MuiButton-endIcon": { flexShrink: 0 },
          }}
        >
          <Box
            component="span"
            sx={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {buttonText}
          </Box>
        </Button>
      </Tooltip>
      <Menu
        open={!!anchorEl}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        slotProps={{ paper: { sx: { minWidth: 300, maxHeight: 520 } } }}
      >
        {/* ── Colour perspective: exactly one ─────────────────────────── */}
        <MenuSectionHeader icon="palette" label={t("viewSelector.colorBy")} />

        <ChoiceRow
          checked={current.kind === "card_type"}
          label={t("viewSelector.cardType")}
          onSelect={() => onChange({ kind: "card_type" })}
        />
        <ChoiceRow
          checked={current.kind === "approval_status"}
          label={t("viewSelector.approvalStatus")}
          onSelect={() => onChange({ kind: "approval_status" })}
        />

        {colorFieldsByType.map(({ type, fields }) => [
          <TypeHeading key={`color-hdr-${type.key}`} type={type} label={typeLabel(type)} />,
          ...fields.map((f) => (
            <ChoiceRow
              key={`color-${type.key}-${f.key}`}
              checked={
                current.kind === "card_field" &&
                current.type_key === type.key &&
                current.field_key === f.key
              }
              label={fieldLabel(f)}
              onSelect={() =>
                onChange({ kind: "card_field", type_key: type.key, field_key: f.key })
              }
            />
          )),
        ])}

        <Divider sx={{ my: 0.5 }} />

        {/* ── What the shape says: any number ─────────────────────────── */}
        <MenuSectionHeader
          icon="visibility"
          label={t("viewSelector.showOnCard")}
          count={shownCount}
        />
        <Box sx={{ px: 2, pb: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            {t("viewSelector.linesHint", { count: MAX_CARD_LINES })}
          </Typography>
        </Box>

        <CheckRow
          checked={!!labels.showType}
          label={t("viewSelector.cardTypeLine")}
          onToggle={() => onLabelsChange({ ...labels, showType: !labels.showType })}
        />
        <CheckRow
          checked={!!labels.showSubtype}
          label={t("viewSelector.subtypeLine")}
          onToggle={() => onLabelsChange({ ...labels, showSubtype: !labels.showSubtype })}
        />

        {labelGroups.map((g) => [
          <TypeHeading
            key={`show-hdr-${g.kind === "shared" ? "shared" : g.type.key}`}
            type={g.kind === "type" ? g.type : undefined}
            label={groupLabel(g)}
          />,
          ...g.fields.map((f) => (
            <CheckRow
              key={`show-${f.key}`}
              checked={labels.fields.includes(f.key)}
              label={fieldLabel(f)}
              onToggle={() => toggleField(f.key)}
            />
          )),
        ])}
      </Menu>
    </>
  );
}

/**
 * Sub-heading naming the card type a group of rows belongs to. Carries the
 * type's own glyph in its own colour, per UI_GUIDELINES §3.11 — a card type is
 * never a bare label. The shared bucket has no type, so it takes a neutral
 * glyph.
 */
function TypeHeading({ type, label }: { type?: CardType; label: string }) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        px: 2,
        pt: 0.75,
        pb: 0.25,
        fontSize: "0.7rem",
        fontWeight: 600,
        color: type ? type.color : "text.secondary",
      }}
    >
      <MaterialSymbol icon={type?.icon || "widgets"} size={14} />
      {label}
    </Box>
  );
}

/** Pick-one row. Deliberately leaves the menu open — see the note on the
 *  component: the other setting lives here too. */
function ChoiceRow({
  checked,
  label,
  onSelect,
}: {
  checked: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <MenuItem selected={checked} onClick={onSelect} sx={{ pl: 1.5, py: 0.25 }}>
      <Radio size="small" checked={checked} sx={{ p: 0.5, mr: 1 }} />
      <Typography variant="body2" noWrap>
        {label}
      </Typography>
    </MenuItem>
  );
}

/** Pick-many row. */
function CheckRow({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <MenuItem onClick={onToggle} sx={{ pl: 1.5, py: 0.25 }}>
      <Checkbox size="small" checked={checked} sx={{ p: 0.5, mr: 1 }} />
      <Typography variant="body2" noWrap>
        {label}
      </Typography>
    </MenuItem>
  );
}

// ─── Color-mapping helpers ─────────────────────────────────────────────────

/** Build a value → ColorEntry map for the chosen view. Returns an empty map
 *  for the default (card-type) view since cells keep their type colour.
 *
 *  `optionLabel` is passed in rather than resolved here so the map can be built
 *  outside React; pass `useOptionLabel()` from a component. */
export function buildColorMap(
  view: ViewSource,
  types: CardType[],
  optionLabel: (o: { key: string; label: string; translations?: Record<string, string> }) => string,
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
      label: optionLabel(opt),
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
