/**
 * The filter section the Portfolio, Flexible Portfolio and Lifecycle reports
 * share: what it holds, which options it offers and how a sub-card selection is
 * widened before matching. Matching itself stays `matchesStaticFilters`
 * (`portfolioHelpers.ts`), so every report reads a filter the same way.
 */
import { EMPTY_FILTER_KEY } from "@/components/FilterSelect";
import { expandScopeIds } from "@/hooks/useCardScope";
import { expandSides, parseSideKey, sideKey } from "@/lib/relationSort";
import { extractRelSubtypes, relSubtypeComposite } from "./portfolioHelpers";
import type { FieldDef, FieldOption, RelSubtype, RelTypeDef, TagGroupDef } from "./portfolioHelpers";

/** Everything the shared filter section edits. */
export interface CardFilterValue {
  /** The card's own facet fields, by field key. */
  attrFilters: Record<string, string[]>;
  /** Related card ids, keyed by a card-type key or a relation side key. */
  relationFilters: Record<string, string[]>;
  /** Relation attribute values, keyed `relTypeKey::fieldKey`. */
  relSubtypeFilters: Record<string, string[]>;
  /** The card's own subtype keys; `EMPTY_FILTER_KEY` means "no subtype". */
  subtypeFilters: string[];
  tagFilterIds: string[];
  /** A related-card pick also covers the cards beneath it in its hierarchy. */
  includeDescendants: boolean;
}

export const EMPTY_CARD_FILTERS: CardFilterValue = {
  attrFilters: {},
  relationFilters: {},
  relSubtypeFilters: {},
  subtypeFilters: [],
  tagFilterIds: [],
  includeDescendants: false,
};

/** A related card as the payload's `groupable_types` lists it. */
export interface FilterMember {
  id: string;
  name: string;
  parent_id?: string | null;
  /** Present only to complete a hierarchy: no portfolio card links to it. */
  ancestor_only?: boolean;
}

/** One "Related by" facet. */
export interface RelationFilterOption {
  /** The `relationFilters` key: a card-type key, or a relation side key. */
  typeKey: string;
  label: string;
  icon: string;
  /** Whether the related card type has a hierarchy to widen a pick over. */
  hierarchical: boolean;
  options: { key: string; label: string }[];
}

/** What the option builder needs to know about a related card type. */
export interface RelatedTypeMeta {
  label: string;
  icon?: string;
  hierarchical: boolean;
}

/**
 * One "Related by" facet per related card type, plus one per relation side
 * when several relation types reach that card type ("owned by" and "used by"
 * are different questions from "related to an Organization").
 *
 * A related card that only completes a hierarchy (`ancestor_only`) can never
 * match a direct-link filter, so it is offered only while sub-cards are
 * included — and then it must be, or a parent capability with no link of its
 * own could not be picked to cover its children.
 */
export function buildRelationFilterOptions(input: {
  groupableTypes: Record<string, FilterMember[]>;
  relationTypes: RelTypeDef[];
  cardType: string;
  includeDescendants: boolean;
  typeMeta: (typeKey: string) => RelatedTypeMeta | undefined;
  relationVerb: (rt: RelTypeDef, reverse: boolean) => string;
}): RelationFilterOption[] {
  const { groupableTypes, relationTypes, cardType, includeDescendants, typeMeta, relationVerb } =
    input;
  const out: RelationFilterOption[] = [];
  for (const [typeKey, members] of Object.entries(groupableTypes)) {
    const hasDirect = members.some((m) => !m.ancestor_only);
    if (!hasDirect) continue;
    const meta = typeMeta(typeKey);
    const label = meta?.label || typeKey;
    const icon = meta?.icon || "link";
    const hierarchical = !!meta?.hierarchical;
    const offered = includeDescendants && hierarchical ? members : members.filter((m) => !m.ancestor_only);
    const options = offered.map((m) => ({ key: m.id, label: m.name }));
    out.push({ typeKey, label, icon, hierarchical, options });

    const reaching = expandSides(
      relationTypes.filter((rt) => rt.other_type_key === typeKey),
      cardType,
    );
    if (reaching.length > 1) {
      for (const { rt, isSource } of reaching) {
        out.push({
          typeKey: sideKey(rt, isSource),
          label: `${label} · ${relationVerb(rt, !isSource)}`,
          icon,
          hierarchical,
          options,
        });
      }
    }
  }
  return out;
}

/** The card type at the far end of a `relationFilters` key. */
export function relatedTypeOfKey(key: string, relationTypes: RelTypeDef[]): string {
  const bare = parseSideKey(key).key;
  return relationTypes.find((rt) => rt.key === bare)?.other_type_key ?? key;
}

/**
 * Widen every related-card pick to the pick plus its descendants, so a filter
 * on a parent capability also matches a card linked only to a child. The
 * hierarchy is read from the payload's own `groupable_types` (each member's
 * `parent_id`, ancestors included), which holds every card that can match.
 * The "(empty)" pick is kept as it is.
 */
export function expandRelationFilters(
  relationFilters: Record<string, string[]>,
  groupableTypes: Record<string, FilterMember[]>,
  relationTypes: RelTypeDef[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, ids] of Object.entries(relationFilters)) {
    const real = ids.filter((id) => id !== EMPTY_FILTER_KEY);
    const members = groupableTypes[relatedTypeOfKey(key, relationTypes)] ?? [];
    const widened = [...expandScopeIds(real, members)];
    out[key] = real.length === ids.length ? widened : [EMPTY_FILTER_KEY, ...widened];
  }
  return out;
}

/** How many values the section has selected, for its header chip. */
export function countActiveFilters(v: CardFilterValue): number {
  const flat = (r: Record<string, string[]>) => Object.values(r).flat().length;
  return (
    flat(v.attrFilters) +
    flat(v.relationFilters) +
    flat(v.relSubtypeFilters) +
    v.subtypeFilters.length +
    v.tagFilterIds.length
  );
}

/** Whether anything narrows the cards, a search included. */
export function hasActiveFilters(v: CardFilterValue, search: string): boolean {
  return countActiveFilters(v) > 0 || search.length > 0;
}

/**
 * Every relation-type key the payload knows — bare keys plus, for a
 * self-referencing type, its two side keys — so the matcher can tell a
 * relation-type facet from a card-type one.
 */
export function relationTypeKeys(relationTypes: RelTypeDef[]): Set<string> {
  // `sideKey` is the bare key for a cross-type rt, so the set dedups it.
  return new Set(relationTypes.flatMap((rt) => [rt.key, sideKey(rt, true), sideKey(rt, false)]));
}

/**
 * The relation "subtypes" — single-select attributes on the relation types
 * touching `cardType` — labelled by the verb read from the card's side
 * ("uses · Usage Type").
 */
export function buildRelSubtypes(
  relationTypes: RelTypeDef[],
  cardType: string,
  labels: {
    relationVerb: (rt: RelTypeDef, reverse: boolean) => string;
    fieldLabel: (field: FieldDef) => string;
    optionLabel: (option: FieldOption) => string;
  },
): RelSubtype[] {
  return extractRelSubtypes(relationTypes, cardType).map(({ relType, field }) => ({
    composite: relSubtypeComposite(relType.key, field.key),
    relTypeKey: relType.key,
    fieldKey: field.key,
    relatedTypeKey: relType.other_type_key,
    comboLabel: `${labels.relationVerb(relType, relType.source_type_key !== cardType)} · ${labels.fieldLabel(field)}`,
    options: (field.options ?? []).map((o) => ({ ...o, label: labels.optionLabel(o) })),
  }));
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function stringArrayRecord(v: unknown): Record<string, string[]> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string[]> = {};
  for (const [k, vals] of Object.entries(v as Record<string, unknown>)) {
    const arr = stringArray(vals);
    if (arr.length > 0) out[k] = arr;
  }
  return out;
}

/** Read the filter keys back out of a saved report config, dropping anything malformed. */
export function restoreCardFilters(cfg: Record<string, unknown>): CardFilterValue {
  return {
    attrFilters: stringArrayRecord(cfg.attrFilters),
    relationFilters: stringArrayRecord(cfg.relationFilters),
    relSubtypeFilters: stringArrayRecord(cfg.relSubtypeFilters),
    subtypeFilters: stringArray(cfg.subtypeFilters),
    tagFilterIds: stringArray(cfg.tagFilterIds),
    includeDescendants: cfg.includeDescendants === true,
  };
}

/**
 * One `{label, value}` line per active filter, values named by their labels,
 * for the header a print or export carries — so a reader of the exported deck
 * can see what the report was narrowed to, not only that it was.
 */
export function describeActiveFilters(input: {
  value: CardFilterValue;
  relationOptions: RelationFilterOption[];
  tagGroups: TagGroupDef[];
  subtypeOptions: { key: string; label: string }[];
  fields: FieldDef[];
  relSubtypes: RelSubtype[];
  labels: { subtype: string; tags: string; empty: string; subCards: string };
}): { label: string; value: string }[] {
  const { value, relationOptions, tagGroups, subtypeOptions, fields, relSubtypes, labels } = input;
  const named = (keys: string[], options: { key: string; label: string }[]) =>
    keys
      .map((k) => (k === EMPTY_FILTER_KEY ? labels.empty : (options.find((o) => o.key === k)?.label ?? k)))
      .join(", ");
  const out: { label: string; value: string }[] = [];
  if (value.subtypeFilters.length > 0) {
    out.push({ label: labels.subtype, value: named(value.subtypeFilters, subtypeOptions) });
  }
  for (const rf of relationOptions) {
    const picked = value.relationFilters[rf.typeKey] ?? [];
    if (picked.length === 0) continue;
    const suffix = value.includeDescendants && rf.hierarchical ? ` ${labels.subCards}` : "";
    out.push({ label: rf.label, value: named(picked, rf.options) + suffix });
  }
  if (value.tagFilterIds.length > 0) {
    const tags = tagGroups.flatMap((g) => g.tags.map((tg) => ({ key: tg.id, label: tg.name })));
    out.push({ label: labels.tags, value: named(value.tagFilterIds, tags) });
  }
  for (const f of fields) {
    const picked = value.attrFilters[f.key] ?? [];
    if (picked.length > 0) out.push({ label: f.label, value: named(picked, f.options ?? []) });
  }
  for (const sub of relSubtypes) {
    const picked = value.relSubtypeFilters[sub.composite] ?? [];
    if (picked.length > 0) out.push({ label: sub.comboLabel, value: named(picked, sub.options) });
  }
  return out;
}
