import {
  countActiveFilters,
  restoreCardFilters,
  type CardFilterValue,
} from "@/features/reports/cardFilters";
import type { TagGroupDef } from "@/features/reports/portfolioHelpers";
import { appliedConditions } from "@/lib/fieldFilters";
import type { FilterKind } from "@/lib/fieldFilters";
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
