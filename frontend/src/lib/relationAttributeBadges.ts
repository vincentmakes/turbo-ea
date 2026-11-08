/**
 * The values a relation carries, as the labelled badges card detail shows
 * beside it: every `single_select` value (other than `flowDirection`, which is
 * drawn as an arrow) and every `boolean` flag that is switched on.
 *
 * A leaf module (types only) so the Layered Dependency View's layout engine
 * and the diagram editor can read the very same values card detail does
 * without importing a component module.
 */
import type { FieldOption, RelationType } from "@/types";

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
  attributes: Record<string, unknown> | undefined,
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

/**
 * The bracketed suffix an edge label carries for a relation's values, e.g.
 * `" [Leading]"`, `" [Create · Read]"` or `" [Owner · Leading]"`: one entry
 * per badge from {@link relationAttributeBadges}, in the relation type's
 * schema order, joined by a middot. A flag contributes its own field label
 * (what card detail prints on its chip); a select contributes its option.
 * Undefined when nothing is set.
 *
 * `resolve` localises a label entity (the caller binds it to the current
 * locale), handed an option-shaped `{key, label, translations}`.
 */
export function relationAttributeSuffix(
  relationType: RelationType | undefined,
  attributes: Record<string, unknown> | undefined,
  resolve: (entity: FieldOption) => string,
): string | undefined {
  const parts = relationAttributeBadges(relationType, attributes).map((b) =>
    resolve({ key: b.optionKey, label: b.optionLabel, translations: b.optionTranslations }),
  );
  return parts.length > 0 ? ` [${parts.join(" · ")}]` : undefined;
}
