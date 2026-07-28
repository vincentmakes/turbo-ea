import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
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
 * `attributes_schema` — `single_select` pickers and `boolean` flags. Nothing
 * here is keyed to a particular attribute: the inputs are derived from the
 * schema, so an admin-defined dimension renders exactly like a built-in one.
 * The flow-direction field renders option labels using the relation type's own
 * forward / reverse labels so the user reads concrete wording, not generic
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

  const setField = (field: FieldDef) => (next: unknown) => {
    const merged = { ...value };
    if (next === undefined || next === "" || next === null) {
      delete merged[field.key];
    } else {
      merged[field.key] = next;
    }
    onChange(merged);
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: compact ? 1 : 1.5 }}>
      {groupFields(schema).map((group, gi) =>
        group.flags ? (
          // Consecutive flags render as one wrapping row of checkboxes so a set
          // of them reads as a single control group rather than a tall stack.
          <Box key={`flags-${gi}`} sx={{ display: "flex", flexWrap: "wrap", columnGap: 1.5 }}>
            {group.fields.map((field) => (
              <FieldInput
                key={field.key}
                field={field}
                relationType={relationType}
                value={value[field.key]}
                onChange={setField(field)}
                fieldLabel={fieldLabel}
                optLabel={optLabel}
                relLabel={relLabel}
                t={t}
                disabled={disabled}
              />
            ))}
          </Box>
        ) : (
          <FieldInput
            key={group.fields[0].key}
            field={group.fields[0]}
            relationType={relationType}
            value={value[group.fields[0].key]}
            onChange={setField(group.fields[0])}
            fieldLabel={fieldLabel}
            optLabel={optLabel}
            relLabel={relLabel}
            t={t}
            disabled={disabled}
          />
        ),
      )}
    </Box>
  );
}

/** Collapse runs of consecutive `boolean` fields into one group; everything else stays alone. */
function groupFields(schema: FieldDef[]): { flags: boolean; fields: FieldDef[] }[] {
  const groups: { flags: boolean; fields: FieldDef[] }[] = [];
  for (const field of schema) {
    const flags = field.type === "boolean";
    const last = groups[groups.length - 1];
    if (flags && last?.flags) last.fields.push(field);
    else groups.push({ flags, fields: [field] });
  }
  return groups;
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

  if (field.type === "boolean") {
    return (
      <FormControlLabel
        disabled={disabled}
        control={
          <Checkbox
            size="small"
            checked={value === true}
            // A relation attribute is tri-state in storage: true / false /
            // absent. Unticking writes `undefined`, which the parent deletes
            // from the bag, so "never ticked" and "ticked then unticked" look
            // identical to every reader (badges, filters, export).
            onChange={(e) => onChange(e.target.checked ? true : undefined)}
          />
        }
        label={<Typography variant="body2">{label}</Typography>}
        sx={{ mr: 0 }}
      />
    );
  }

  // Other field types (text, number, date, …) can be added here as relation
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
 * Returns true only when a relation type declares at least one attribute the
 * user can actually edit — a `single_select` with options, or a `boolean` flag.
 * Stricter than {@link hasRelationAttributes} (which is true for any schema
 * entry, even an options-less or unrenderable field), so UI gates don't surface
 * an empty attribute editor for relations with nothing to set.
 *
 * Booleans count: a relation type whose only dimensions are flags (the seeded
 * CRUD pairs, say) still needs the editor, and gating on `single_select` alone
 * is what made those values unsettable.
 */
export function hasEditableRelationAttributes(relationType: RelationType | undefined): boolean {
  return (
    !!relationType &&
    (relationType.attributes_schema ?? []).some(
      (f) =>
        f.type === "boolean" || (f.type === "single_select" && (f.options ?? []).length > 0),
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
  /**
   * True for a `boolean` dimension that is switched on. A flag has no option
   * entity, so `optionLabel` mirrors the field label — callers that print
   * "field: value" should print just the label for these.
   */
  isFlag?: boolean;
}

/**
 * Generic counterpart to {@link flowDirectionBadge}: returns EVERY attribute
 * that carries a value — `single_select` values (other than `flowDirection`,
 * which renders as a directional icon) and `boolean` flags that are on — so the
 * caller can render one labelled chip each (e.g. both `usageType` and
 * `criticality` on a BusinessProcess→Application relation, or the flags on a
 * CRUD-style relation). Labels are returned raw (with their `translations`) so
 * the caller resolves them with the locale-aware label resolver. Returns an
 * empty array when nothing is set.
 */
export function relationAttributeBadges(
  relationType: RelationType | undefined,
  attributes: RelationAttributes | undefined,
): RelationAttributeBadge[] {
  if (!relationType) return [];
  const badges: RelationAttributeBadge[] = [];
  for (const field of relationType.attributes_schema ?? []) {
    if (field.key === "flowDirection") continue;
    const v = attributes?.[field.key];

    if (field.type === "boolean") {
      if (v !== true) continue;
      badges.push({
        fieldKey: field.key,
        fieldLabel: field.label,
        fieldTranslations: field.translations,
        optionKey: "true",
        optionLabel: field.label,
        optionTranslations: field.translations,
        isFlag: true,
      });
      continue;
    }

    if (field.type !== "single_select") continue;
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
