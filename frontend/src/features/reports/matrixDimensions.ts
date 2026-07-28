/**
 * Turns a relation type's `attributes_schema` into the things the Matrix report
 * can draw, filter and export.
 *
 * Everything here is derived from the schema at runtime. No attribute key is
 * ever named in code: a CRUD-style set of booleans, a usage-type select and an
 * admin's own dimension added last week all travel the same path. The seeded
 * relation types are just the ones that happen to exist today.
 *
 * Two levels:
 *
 * - a **dimension** is one field on one relation type. `flag` (boolean) and
 *   `enum` (single_select) dimensions have a bounded set of values, so they can
 *   be coded into a glyph, filtered, and given a legend entry. `scalar`
 *   dimensions (text, number, date, …) can only be shown as text.
 * - a **value** is one legend entry: a flag, or one option of an enum. This is
 *   the unit a cell renders and the legend explains.
 */

import { CATEGORICAL_COLORS } from "@/theme/tokens";
import type { FieldDef, FieldOption, RelationType } from "@/types";

export type DimensionKind = "flag" | "enum" | "scalar";

export interface MatrixDimension {
  /** `${relationTypeKey}.${fieldKey}` — unique across the axis pair. */
  id: string;
  relationTypeKey: string;
  field: FieldDef;
  kind: DimensionKind;
}

export interface MatrixValue {
  /** `${relationTypeKey}.${fieldKey}` for a flag, plus `:${optionKey}` for an enum. */
  id: string;
  dimensionId: string;
  relationTypeKey: string;
  fieldKey: string;
  /** Absent for a flag: the field itself is the value. */
  optionKey?: string;
  kind: "flag" | "enum";
  /** 1–3 characters for the dense grid. */
  code: string;
  /** Full localized text for the legend, chips, tooltips and export. */
  label: string;
  color: string;
}

export interface MatrixValueIndex {
  dimensions: MatrixDimension[];
  values: MatrixValue[];
  byId: Map<string, MatrixValue>;
  /** Values contributed by each relation type, in schema order. */
  byRelationType: Map<string, MatrixValue[]>;
}

/** Label resolvers, injected so this module stays free of React hooks. */
export interface LabelResolvers {
  fieldLabel: (field: FieldDef) => string;
  optionLabel: (option: FieldOption) => string;
}

function isEnum(field: FieldDef): boolean {
  return field.type === "single_select" && (field.options ?? []).length > 0;
}

/**
 * Classify every field of every relation type connecting the two axes.
 *
 * `flowDirection` is deliberately *not* special-cased. It is a single_select
 * like any other, and its options carry their own translated labels, so it
 * codes and filters exactly as an admin-defined dimension would. Structural
 * direction — which end of the relation the row card sits on — is a separate
 * concept the payload carries per edge, not an attribute.
 */
export function buildDimensions(relationTypes: RelationType[]): MatrixDimension[] {
  const dimensions: MatrixDimension[] = [];
  for (const rt of relationTypes) {
    for (const field of rt.attributes_schema ?? []) {
      const kind: DimensionKind =
        field.type === "boolean" ? "flag" : isEnum(field) ? "enum" : "scalar";
      dimensions.push({ id: `${rt.key}.${field.key}`, relationTypeKey: rt.key, field, kind });
    }
  }
  return dimensions;
}

/**
 * Shortest prefix of `label` not already in `taken`, up to 3 characters, then a
 * numeric suffix. Splitting by grapheme rather than by code unit keeps CJK and
 * Arabic labels intact instead of slicing a surrogate pair in half.
 */
export function shortCode(label: string, taken: Set<string>): string {
  const graphemes = Array.from(label.trim());
  if (graphemes.length === 0) return "?";
  for (let len = 1; len <= Math.min(3, graphemes.length); len++) {
    const candidate = graphemes.slice(0, len).join("");
    const cased = len === 1 ? candidate.toUpperCase() : candidate;
    if (!taken.has(cased)) return cased;
  }
  const base = graphemes[0].toUpperCase();
  for (let n = 2; ; n++) {
    const candidate = `${base}${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Colour for a value the metamodel left uncoloured, by its position within its
 * relation type.
 *
 * Assigning by position rather than by hashing the key is deliberate: the
 * values of one relation type are read side by side in a cell and in the
 * legend, so what matters is that neighbours look different. A hash gives two
 * of four CRUD flags near-identical reds often enough to matter.
 */
export function fallbackColor(index: number): string {
  return CATEGORICAL_COLORS[index % CATEGORICAL_COLORS.length];
}

/**
 * Every codeable value across the axis pair, with its glyph, label and colour.
 *
 * Codes are unique per relation type, not globally: a cell only ever shows the
 * values of the relations inside it, and the legend is grouped by relation
 * type, so scoping the uniqueness there keeps codes as short as possible.
 */
export function buildValueIndex(
  relationTypes: RelationType[],
  { fieldLabel, optionLabel }: LabelResolvers,
): MatrixValueIndex {
  const dimensions = buildDimensions(relationTypes);
  const values: MatrixValue[] = [];
  const byRelationType = new Map<string, MatrixValue[]>();

  for (const rt of relationTypes) {
    const taken = new Set<string>();
    const forType: MatrixValue[] = [];

    for (const dim of dimensions.filter((d) => d.relationTypeKey === rt.key)) {
      if (dim.kind === "flag") {
        const label = fieldLabel(dim.field);
        const code = shortCode(label, taken);
        taken.add(code);
        forType.push({
          id: dim.id,
          dimensionId: dim.id,
          relationTypeKey: rt.key,
          fieldKey: dim.field.key,
          kind: "flag",
          code,
          label,
          color: fallbackColor(forType.length),
        });
      } else if (dim.kind === "enum") {
        for (const option of dim.field.options ?? []) {
          if (option.hidden) continue;
          const label = optionLabel(option);
          const code = shortCode(label, taken);
          taken.add(code);
          forType.push({
            id: `${dim.id}:${option.key}`,
            dimensionId: dim.id,
            relationTypeKey: rt.key,
            fieldKey: dim.field.key,
            optionKey: option.key,
            kind: "enum",
            code,
            label,
            color: option.color || fallbackColor(forType.length),
          });
        }
      }
    }

    if (forType.length > 0) byRelationType.set(rt.key, forType);
    values.push(...forType);
  }

  return {
    dimensions,
    values,
    byId: new Map(values.map((v) => [v.id, v])),
    byRelationType,
  };
}

/**
 * The value ids an attribute bag carries — flags that are on, and the selected
 * option of each enum. Values the index doesn't know (an option deleted from
 * the metamodel after the relation was set) are skipped rather than guessed at.
 */
export function valueIdsForAttributes(
  relationTypeKey: string,
  attributes: Record<string, unknown> | undefined,
  index: MatrixValueIndex,
): string[] {
  if (!attributes) return [];
  const ids: string[] = [];
  for (const dim of index.dimensions) {
    if (dim.relationTypeKey !== relationTypeKey) continue;
    const raw = attributes[dim.field.key];
    if (dim.kind === "flag") {
      if (raw === true) ids.push(dim.id);
    } else if (dim.kind === "enum") {
      if (typeof raw !== "string" || !raw) continue;
      const id = `${dim.id}:${raw}`;
      if (index.byId.has(id)) ids.push(id);
    }
  }
  return ids;
}
