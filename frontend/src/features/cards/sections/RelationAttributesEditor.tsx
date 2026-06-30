import Box from "@mui/material/Box";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useFieldLabel, useOptionLabel, useRelationLabel } from "@/hooks/useResolveLabel";
import type { FieldDef, RelationType } from "@/types";

export type RelationAttributes = Record<string, unknown>;

interface Props {
  relationType: RelationType;
  value: RelationAttributes;
  onChange: (next: RelationAttributes) => void;
  compact?: boolean;
  disabled?: boolean;
}

/**
 * Renders the editable inputs declared by a relation type's
 * `attributes_schema`. Only the field types actually used by built-in
 * relation types are wired here (single_select today). The flow-direction
 * field renders option labels using the relation type's own forward /
 * reverse labels so the user reads concrete wording, not generic
 * "forward / reverse" keys.
 */
export default function RelationAttributesEditor({
  relationType,
  value,
  onChange,
  compact = false,
  disabled = false,
}: Props) {
  const { t } = useTranslation(["cards", "common"]);
  const fieldLabel = useFieldLabel();
  const optLabel = useOptionLabel();
  const relLabel = useRelationLabel();

  const schema = relationType.attributes_schema ?? [];
  if (schema.length === 0) return null;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: compact ? 1 : 1.5 }}>
      {schema.map((field) => (
        <FieldInput
          key={field.key}
          field={field}
          relationType={relationType}
          value={value[field.key]}
          onChange={(next) => {
            const merged = { ...value };
            if (next === undefined || next === "" || next === null) {
              delete merged[field.key];
            } else {
              merged[field.key] = next;
            }
            onChange(merged);
          }}
          fieldLabel={fieldLabel}
          optLabel={optLabel}
          relLabel={relLabel}
          t={t}
          disabled={disabled}
        />
      ))}
    </Box>
  );
}

interface FieldInputProps {
  field: FieldDef;
  relationType: RelationType;
  value: unknown;
  onChange: (next: unknown) => void;
  fieldLabel: ReturnType<typeof useFieldLabel>;
  optLabel: ReturnType<typeof useOptionLabel>;
  relLabel: ReturnType<typeof useRelationLabel>;
  t: ReturnType<typeof useTranslation>["t"];
  disabled?: boolean;
}

function FieldInput({ field, relationType, value, onChange, fieldLabel, optLabel, relLabel, t, disabled }: FieldInputProps) {
  const label = fieldLabel(field);

  if (field.type === "single_select") {
    const current = typeof value === "string" ? value : "";
    // Hidden values are dropped from the picker, but a value already set on this
    // relation stays selectable so the row still resolves its label/color.
    const options = (field.options ?? []).filter((o) => !o.hidden || o.key === current);
    return (
      <FormControl size="small" fullWidth disabled={disabled}>
        <InputLabel>{label}</InputLabel>
        <Select
          value={current}
          label={label}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <MenuItem value="">
            <Typography variant="body2" color="text.secondary" fontStyle="italic">
              {t("cards:relations.flowDirection.unset")}
            </Typography>
          </MenuItem>
          {options.map((opt) => (
            <MenuItem key={opt.key} value={opt.key}>
              {renderOptionLabel(field, opt.key, opt.label, opt.translations, relationType, optLabel, relLabel, t)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    );
  }

  // Other field types (text, boolean, etc.) can be added here as relation
  // attribute schemas grow. We deliberately keep this thin until needed.
  return null;
}

function renderOptionLabel(
  field: FieldDef,
  optionKey: string,
  optionLabel: string,
  optionTranslations: { [k: string]: string } | undefined,
  relationType: RelationType,
  optLabel: ReturnType<typeof useOptionLabel>,
  relLabel: ReturnType<typeof useRelationLabel>,
  t: ReturnType<typeof useTranslation>["t"],
) {
  if (field.key !== "flowDirection") {
    return optLabel({ key: optionKey, label: optionLabel, translations: optionTranslations });
  }
  // For Application↔Interface specifically, use the canonical EA
  // Provider / Consumer / Bidirectional wording. For any other
  // relation type that declares flowDirection (none in core today)
  // fall back to the relation type's own forward / reverse labels.
  const isAppToInterface = relationType.key === "relAppToInterface";
  let icon = "sync_alt";
  let text: string;
  if (isAppToInterface) {
    if (optionKey === "forward") {
      icon = "arrow_forward";
      text = t("cards:relations.role.provider");
    } else if (optionKey === "reverse") {
      icon = "arrow_back";
      text = t("cards:relations.role.consumer");
    } else {
      text = t("cards:relations.role.bidirectional");
    }
  } else {
    const fwd = relLabel(relationType);
    const rev = relLabel(relationType, true);
    if (optionKey === "forward") {
      icon = "arrow_forward";
      text = fwd;
    } else if (optionKey === "reverse") {
      icon = "arrow_back";
      text = rev;
    } else {
      text = t("cards:relations.flowDirection.bidirectional");
    }
  }
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
      <MaterialSymbol icon={icon} size={18} />
      <Typography variant="body2">{text}</Typography>
    </Box>
  );
}

/**
 * Helper used by callers to render a compact directional badge for a
 * relation row. Returns null if the relation type does not declare
 * `flowDirection` or the relation has no value set.
 * `icon` is a Material Symbol name (consumed by `<MaterialSymbol/>`).
 */
export function flowDirectionBadge(
  relationType: RelationType | undefined,
  attributes: RelationAttributes | undefined,
): { icon: string; value: "bidirectional" | "forward" | "reverse" } | null {
  if (!relationType) return null;
  const hasField = (relationType.attributes_schema ?? []).some((f) => f.key === "flowDirection");
  if (!hasField) return null;
  const v = attributes?.flowDirection;
  if (v === "bidirectional") return { icon: "sync_alt", value: "bidirectional" };
  if (v === "forward") return { icon: "arrow_forward", value: "forward" };
  if (v === "reverse") return { icon: "arrow_back", value: "reverse" };
  return null;
}

/**
 * Returns true if a relation type has any schema-declared attributes.
 */
export function hasRelationAttributes(relationType: RelationType | undefined): boolean {
  return !!relationType && (relationType.attributes_schema ?? []).length > 0;
}

/**
 * Returns true only when a relation type declares at least one editable
 * "subtype" — a single_select field with options. Stricter than
 * {@link hasRelationAttributes} (which is true for any schema entry, even an
 * options-less field), so UI gates don't surface an empty attribute editor /
 * "label" icon for relations that have no actual subtypes to pick.
 */
export function hasRelationSubtypes(relationType: RelationType | undefined): boolean {
  return (
    !!relationType &&
    (relationType.attributes_schema ?? []).some(
      (f) => f.type === "single_select" && (f.options ?? []).length > 0,
    )
  );
}

export interface RelationAttributeBadge {
  fieldKey: string;
  fieldLabel: string;
  fieldTranslations?: { [k: string]: string };
  optionKey: string;
  optionLabel: string;
  optionTranslations?: { [k: string]: string };
  color?: string;
}

/**
 * Generic counterpart to {@link flowDirectionBadge}: returns EVERY
 * `single_select` attribute (other than `flowDirection`, which renders as a
 * directional icon) that has a value set, so the caller can render one labelled
 * chip per value (e.g. both `usageType` and `criticality` on a
 * BusinessProcess→Application relation). Labels are returned raw (with their
 * `translations`) so the caller resolves them with the locale-aware label
 * resolver. Returns an empty array when nothing is set.
 */
export function relationAttributeBadges(
  relationType: RelationType | undefined,
  attributes: RelationAttributes | undefined,
): RelationAttributeBadge[] {
  if (!relationType) return [];
  const badges: RelationAttributeBadge[] = [];
  for (const field of relationType.attributes_schema ?? []) {
    if (field.type !== "single_select" || field.key === "flowDirection") continue;
    const v = attributes?.[field.key];
    if (typeof v !== "string" || !v) continue;
    const opt = (field.options ?? []).find((o) => o.key === v);
    if (!opt) continue;
    badges.push({
      fieldKey: field.key,
      fieldLabel: field.label,
      fieldTranslations: field.translations,
      optionKey: opt.key,
      optionLabel: opt.label,
      optionTranslations: opt.translations,
      color: opt.color,
    });
  }
  return badges;
}
