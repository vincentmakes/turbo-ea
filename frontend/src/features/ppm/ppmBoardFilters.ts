/**
 * The PPM portfolio board's Filters section: the payload it reads
 * (`GET /reports/ppm/filter-data`), how its selection travels in the URL
 * (`?filters=`), and which initiatives it keeps.
 *
 * Matching is the reports' own `matchesStaticFilters`, fed exactly as the
 * Lifecycle report feeds it, so a filter reads the same on the board as on
 * every report. Imported by the authenticated container (`PpmPortfolio.tsx`)
 * only — never by `PpmPortfolioView`, which the public portal bundle shares.
 */
import {
  countActiveFilters,
  expandRelationFilters,
  relatedTypeOfKey,
  readCardFilters,
  relationTypeKeys,
} from "@/features/reports/cardFilters";
import type {
  CardFilterValue,
  FilterMember,
  RelationFilterOption,
} from "@/features/reports/cardFilters";
import { matchesStaticFilters } from "@/features/reports/portfolioHelpers";
import { restoreAttrConditions } from "@/lib/fieldFilters";
import type { FilterKind } from "@/lib/fieldFilters";
import type {
  AppRelation,
  FieldDef,
  RelSubtype,
  RelTypeDef,
  TagGroupDef,
} from "@/features/reports/portfolioHelpers";

/** One initiative as the filter payload carries it — the same ids as `/reports/ppm/gantt`. */
export interface PpmFilterItem {
  id: string;
  name: string;
  subtype: string | null;
  attributes: Record<string, unknown>;
  relations: AppRelation[];
  tag_ids: string[];
}

/** `GET /reports/ppm/filter-data`. */
export interface PpmFilterData {
  items: PpmFilterItem[];
  relation_types: RelTypeDef[];
  groupable_types: Record<string, FilterMember[]>;
  tag_groups: TagGroupDef[];
}

/** A record with its emptied entries left out. */
function nonEmpty(r: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(r).filter(([, vals]) => vals.length > 0));
}

/**
 * The selection as the `?filters=` value: compact JSON of the keys that select
 * something, always in the same order, so one selection is one URL. Nothing
 * selected is "" (the param is then dropped). The fields the person added
 * ("Add filter") travel too, so a shared link shows the same rows. The
 * section's subtype is never written — the toolbar's `?subtype=` is the
 * board's only subtype filter.
 */
export function encodeCardFilters(v: CardFilterValue): string {
  const out: Record<string, unknown> = {};
  const records = [
    ["relationFilters", v.relationFilters],
    ["attrFilters", v.attrFilters],
    ["relSubtypeFilters", v.relSubtypeFilters],
  ] as const;
  for (const [key, record] of records) {
    const kept = nonEmpty(record);
    if (Object.keys(kept).length > 0) out[key] = kept;
  }
  if (v.tagFilterIds.length > 0) out.tagFilterIds = v.tagFilterIds;
  if (v.includeDescendants) out.includeDescendants = true;
  // Text / number / date conditions, canonical (trimmed, unusable ones
  // dropped) so one selection is one URL. After the keys older links carry,
  // so a link without conditions reads byte for byte as before.
  const conditions = restoreAttrConditions(v.attrConditions);
  if (Object.keys(conditions).length > 0) out.attrConditions = conditions;
  // Last, so a link written before "Add filter" existed reads byte for byte the same.
  if (v.filterFields.length > 0) out.filterFields = v.filterFields;
  return Object.keys(out).length > 0 ? JSON.stringify(out) : "";
}

/**
 * The selection a `?filters=` value names. Anything unreadable — no param,
 * broken JSON, a non-object — is the empty selection, and malformed members
 * are dropped by the same reader a saved report goes through. `filterFields`
 * is read as the link carries it (`readCardFilters`), never widened to the
 * fields holding a value: the board writes its state back to the link, and a
 * link that is opened must not be rewritten. The board widens it in memory
 * for the section it renders (`withActiveFilterFields`).
 */
export function decodeCardFilters(raw: string | null): CardFilterValue {
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    // Broken JSON: `parsed` stays null, the empty selection.
  }
  // The restore reads every key defensively, so an array or a scalar restores
  // to the empty selection on its own; only null (no param, broken JSON, the
  // literal `null`) has no keys to read and needs a stand-in object.
  const cfg = (parsed ?? {}) as Record<string, unknown>;
  return { ...readCardFilters(cfg), subtypeFilters: [] };
}

/**
 * The section's "Related by" facets with the other card types first and the
 * board's own type last — its bare facet and its relation sides ("Initiative ·
 * succeeds", …) — each group in the order it came. The payload lists the own
 * type first, and the section shows only the first two facets before "+N
 * more", which on a board of initiatives put the rarely useful ones in front.
 * The far end is read from each facet's key (`relatedTypeOfKey`), never its label.
 */
export function otherTypesFirst(
  options: RelationFilterOption[],
  relationTypes: RelTypeDef[],
  ownType: string,
): RelationFilterOption[] {
  const own = (o: RelationFilterOption) => relatedTypeOfKey(o.typeKey, relationTypes) === ownType;
  return [...options.filter((o) => !own(o)), ...options.filter(own)];
}

/** What the matcher needs besides the selection. */
export interface PpmFilterContext {
  facetFields: FieldDef[];
  /** The reader's catalog kinds (`catalogKinds`): a condition applies only on
   *  a field listed here. Absent = no condition applies. */
  conditionKinds?: ReadonlyMap<string, FilterKind>;
  relationTypes: RelTypeDef[];
  groupableTypes: Record<string, FilterMember[]>;
  relSubtypes: RelSubtype[];
  tagGroups: TagGroupDef[];
}

/**
 * The ids of the initiatives the selection keeps, or null when it selects
 * nothing (so the board treats the section as absent). Matched by
 * `matchesStaticFilters` exactly as `LifecycleReport` calls it; the name never
 * decides, the toolbar's search does that.
 */
export function matchingInitiativeIds(
  items: PpmFilterItem[],
  value: CardFilterValue,
  ctx: PpmFilterContext,
): ReadonlySet<string> | null {
  if (countActiveFilters(value, ctx.conditionKinds) === 0) return null;
  const matchFilters = {
    attributeFilters: value.attrFilters,
    facetFields: ctx.facetFields,
    attrConditions: value.attrConditions,
    conditionKinds: ctx.conditionKinds,
    // With sub-cards included a pick is widened to itself plus everything
    // beneath it, then matched by the very rules the portfolio uses.
    relationFilters: value.includeDescendants
      ? expandRelationFilters(value.relationFilters, ctx.groupableTypes, ctx.relationTypes)
      : value.relationFilters,
    relTypeKeys: relationTypeKeys(ctx.relationTypes),
    relSubtypeFilters: value.relSubtypeFilters,
    relSubtypes: ctx.relSubtypes,
    subtypeFilters: value.subtypeFilters,
    tagFilterIds: value.tagFilterIds,
    tagGroups: ctx.tagGroups,
    search: "",
  };
  return new Set(
    items
      .filter((item) =>
        matchesStaticFilters(
          { ...item, subtype: item.subtype ?? undefined, org_ids: [] },
          matchFilters,
        ),
      )
      .map((item) => item.id),
  );
}
