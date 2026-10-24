import {
  countActiveFilters,
  restoreCardFilters,
  type CardFilterValue,
} from "@/features/reports/cardFilters";
import type { TagGroupDef } from "@/features/reports/portfolioHelpers";
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
 * nothing is left.
 */
export function portalFiltersBody(input: {
  view: PortalView;
  cardFilters: CardFilterValue;
  subtypes: string[];
  tagIds: string[];
  approvalStatuses: string[];
}): Record<string, unknown> | null {
  const { view, cardFilters, subtypes, tagIds, approvalStatuses } = input;
  const out: Record<string, unknown> = {};
  if (view === "cards") {
    if (countActiveFilters(cardFilters) > 0 || cardFilters.includeDescendants) {
      out.card_filters = cardFilters;
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
