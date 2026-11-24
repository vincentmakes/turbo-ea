import {
  countActiveFilters,
  restoreCardFilters,
  type CardFilterValue,
} from "@/features/reports/cardFilters";
import type { TagGroupDef } from "@/features/reports/portfolioHelpers";
import { appliedConditions, filterKindOf } from "@/lib/fieldFilters";
import type { FilterKind } from "@/lib/fieldFilters";
import { isFacetField, type FacetFieldLike } from "@/lib/fieldFacets";
import type { PortalView } from "@/types";

/**
 * A card-list portal's preset as the dialog edits it: its `card_filters`, or —
 * for a portal saved before they existed — the subtypes and tags it carried.
 */
export function portalCardFilters(filters: Record<string, unknown> | null | undefined): CardFilterValue {
  const stored = filters?.card_filters;
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    return restoreCardFilters(stored as Record<string, unknown>);
  }
  return restoreCardFilters({ subtypeFilters: filters?.subtypes, tagFilterIds: filters?.tag_ids });
}

/**
 * The `filters` a save sends: a card-list portal's `card_filters`, or a
 * board's subtypes and tags — plus the approval statuses the portal already
 * had, which the dialog has no control for and must not drop. `null` when
 * nothing is left. The rows the admin added in the dialog (`filterFields`)
 * are editing state and are never sent. The text / number / date conditions
 * go in canonical shape, and only those on a field of the dialog's catalog
 * (`kindByKey`, built without cost fields): a portal never filters on costs.
 */
export function portalFiltersBody(input: {
  view: PortalView;
  cardFilters: CardFilterValue;
  subtypes: string[];
  tagIds: string[];
  approvalStatuses: string[];
  /** The dialog's catalog kinds (`catalogKinds`); absent, no condition is sent. */
  kindByKey?: ReadonlyMap<string, FilterKind>;
}): Record<string, unknown> | null {
  const { view, cardFilters, subtypes, tagIds, approvalStatuses, kindByKey } = input;
  const out: Record<string, unknown> = {};
  if (view === "cards") {
    if (countActiveFilters(cardFilters, kindByKey) > 0 || cardFilters.includeDescendants) {
      const attrConditions = Object.fromEntries(
        appliedConditions(cardFilters.attrConditions, kindByKey).map((c) => [c.key, c.condition]),
      );
      const preset: Partial<CardFilterValue> = { ...cardFilters, attrConditions };
      delete preset.filterFields;
      out.card_filters = preset;
    }
  } else {
    if (subtypes.length > 0) out.subtypes = subtypes;
    if (tagIds.length > 0) out.tag_ids = tagIds;
  }
  if (approvalStatuses.length > 0) out.approval_statuses = approvalStatuses;
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Does a portal saved before card filters carry tags from more than one tag
 * group? Its preset kept a card with any one of them; once the dialog saves
 * it as card filters, a card needs one from every group — the dialog says so
 * before that happens. A tag in no listed group counts as its own group.
 */
export function legacyTagsSpanGroups(
  filters: Record<string, unknown> | null | undefined,
  tagGroups: TagGroupDef[],
): boolean {
  if (!filters || filters.card_filters !== undefined) return false;
  const picked = Array.isArray(filters.tag_ids) ? filters.tag_ids : [];
  const groupOf = new Map<string, string>();
  for (const g of tagGroups) for (const tag of g.tags) groupOf.set(tag.id, g.id);
  const groups = new Set(picked.map((id) => groupOf.get(String(id)) ?? `tag:${String(id)}`));
  return groups.size > 1;
}

/* ------------------------------------------------------------------ */
/*  Visitor filters (#1425)                                            */
/* ------------------------------------------------------------------ */

/** A per-item exposure switch of `card_config.toggles`. */
export type PortalToggles = Record<string, { card: boolean; detail: boolean } | undefined>;

/**
 * Does the portal show `key` (`tags`, `field:<key>`, `rel:<key>`) on the
 * tile or in the detail panel? The admin's toggle when there is one; else a
 * field or built-in property is shown (its detail default is on) and a
 * relation type is not (it has no default).
 */
export function shownOnPortal(toggles: PortalToggles, key: string): boolean {
  const tog = toggles[key];
  if (tog) return tog.card || tog.detail;
  return !key.startsWith("rel:");
}

/** Can a field be a visitor filter at all: a filter kind, never a cost field. */
export function canBeVisitorFilter(field: FacetFieldLike): boolean {
  return field.type !== "cost" && filterKindOf(field) !== null;
}

/** What the visitor filter column reads about the portal being edited. */
export interface VisitorFilterInput {
  /** The card type's subtypes (a subtype filter needs one). */
  subtypes: readonly unknown[] | undefined;
  fieldsSchema: readonly { fields: readonly FacetFieldLike[]; hideInFilters?: boolean }[];
  /** The relation types the dialog lists for the card type. */
  relationKeys: readonly string[];
  toggles: PortalToggles;
}

/** Every field of the schema once, where first declared, with its section's switch. */
function schemaFields(input: VisitorFilterInput): { field: FacetFieldLike; hidden: boolean }[] {
  const seen = new Set<string>();
  const out: { field: FacetFieldLike; hidden: boolean }[] = [];
  for (const section of input.fieldsSchema) {
    for (const field of section.fields) {
      if (seen.has(field.key)) continue;
      seen.add(field.key);
      out.push({ field, hidden: section.hideInFilters === true });
    }
  }
  return out;
}

function visitorFilterKeys(
  input: VisitorFilterInput,
  keepField: (field: FacetFieldLike, hidden: boolean) => boolean,
): string[] {
  const shown = (key: string) => shownOnPortal(input.toggles, key);
  return [
    ...((input.subtypes ?? []).length > 0 ? ["subtype"] : []),
    ...(shown("tags") ? ["tags"] : []),
    ...schemaFields(input)
      .filter(({ field, hidden }) => shown(`field:${field.key}`) && keepField(field, hidden))
      .map(({ field }) => `field:${field.key}`),
    ...input.relationKeys.filter((k) => shown(`rel:${k}`)).map((k) => `rel:${k}`),
  ];
}

/**
 * The filters a visitor may be offered: the subtype (when the type has
 * subtypes) and every tags / field / relation row shown on the tile or in
 * the detail panel whose field can be a filter (`canBeVisitorFilter`). A row
 * outside it carries a disabled checkbox: a filter needs the property shown.
 */
export function eligibleVisitorFilters(input: VisitorFilterInput): string[] {
  return visitorFilterKeys(input, (field) => canBeVisitorFilter(field));
}

/**
 * The filters a visitor sees when the admin never chose — the bar every
 * portal had before the choice existed: the subtype, the tags while shown,
 * each shown single / multiple select with options (never a boolean), each
 * shown relation type, minus the fields of a section hidden from filters.
 *
 * The twin of `default_shown_filters` in
 * `backend/app/services/portal_visibility.py`, which the server falls back
 * to when `visitor_filters` is absent: change one, change both.
 */
export function defaultVisitorFilters(input: VisitorFilterInput): string[] {
  return visitorFilterKeys(
    input,
    (field, hidden) => field.type !== "boolean" && isFacetField(field) && !hidden,
  );
}

/** The checked filters: the admin's list (or the default) within what can be a filter now. */
export function effectiveVisitorFilters(
  selection: readonly string[] | null,
  input: VisitorFilterInput,
): string[] {
  const chosen = new Set(selection ?? defaultVisitorFilters(input));
  return eligibleVisitorFilters(input).filter((k) => chosen.has(k));
}

/** The selection with `key` ticked or unticked, starting from what is checked now. */
export function toggleVisitorFilter(
  selection: readonly string[] | null,
  input: VisitorFilterInput,
  key: string,
  checked: boolean,
): string[] {
  const current = effectiveVisitorFilters(selection, input).filter((k) => k !== key);
  return checked ? [...current, key] : current;
}

/**
 * The `visitor_filters` a save sends: the checked filters, or `undefined`
 * while they are the computed default — so a field added to the metamodel
 * later still follows the default rule.
 */
export function visitorFiltersBody(
  selection: readonly string[] | null,
  input: VisitorFilterInput,
): string[] | undefined {
  const effective = effectiveVisitorFilters(selection, input);
  const fallback = defaultVisitorFilters(input);
  const same = effective.length === fallback.length && effective.every((k) => fallback.includes(k));
  return same ? undefined : effective;
}

/** The admin's stored list, read back: strings only, or `null` (follow the default) when there is none. */
export function storedVisitorFilters(cardConfig: Record<string, unknown> | null | undefined): string[] | null {
  const raw = cardConfig?.visitor_filters;
  return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string") : null;
}
