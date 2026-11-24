/**
 * The public portal's display rules, as plain functions: which fields and
 * relation types the portal's administrator made visible on a tile or in the
 * detail panel, which filters a visitor sees and may add, the card query a
 * filter set sends, what the visitor's browser remembers, how a relation
 * filter is named, which relations a tile and the detail panel show, and how
 * the detail panel groups them.
 *
 * `PortalViewer.tsx` renders; this decides. Nothing here touches React or the
 * network, so each rule is unit-tested on its own (`portalViewerState.test.ts`).
 */
import {
  buildFilterCatalog,
  catalogFields,
  restoreAttrConditions,
  restoreFilterFields,
  schemaWithFields,
  type FieldFilterState,
  type FilterCatalog,
  type FilterCatalogOptions,
} from "@/lib/fieldFilters";
import type { FacetFieldLike } from "@/lib/fieldFacets";
import type {
  FieldDef,
  PortalCard,
  PortalRelationType,
  PortalVisitorFilters,
  PublicPortal,
} from "@/types";

/* ------------------------------------------------------------------ */
/*  Visibility toggles                                                 */
/* ------------------------------------------------------------------ */

export interface ToggleEntry {
  card: boolean;
  detail: boolean;
}
export type Toggles = Record<string, ToggleEntry>;

/** What a tile shows when the administrator set nothing. */
export const DEFAULT_CARD: Record<string, boolean> = {
  description: true,
  lifecycle: true,
  tags: true,
  subscribers: true,
  data_quality: true,
  approval_status: false,
};

/** What the detail panel shows when the administrator set nothing. */
export const DEFAULT_DETAIL: Record<string, boolean> = {
  description: true,
  lifecycle: true,
  tags: true,
  subscribers: true,
  data_quality: true,
  approval_status: true,
};

/**
 * Whether one item shows on a tile or in the detail panel: the
 * administrator's toggle when there is one, else the built-in default for a
 * known item, else `fallback`.
 */
export function isVisible(
  toggles: Toggles | undefined,
  key: string,
  mode: "card" | "detail",
  fallback: boolean,
): boolean {
  const entry = toggles?.[key];
  if (entry) return mode === "card" ? entry.card : entry.detail;
  const defaults = mode === "card" ? DEFAULT_CARD : DEFAULT_DETAIL;
  return defaults[key] ?? fallback;
}

/** The portal's visibility toggles, if it has any. */
export function portalToggles(portal: PublicPortal | null): Toggles | undefined {
  return (portal?.card_config as { toggles?: Toggles } | undefined)?.toggles;
}

/** The sessionStorage key marking a silent sign-in attempt for a portal. Keyed
 *  by resource kind as well as slug: the shared /auth/callback serves portals
 *  and published diagrams and writes the same key on failure. */
export function portalSilentKey(slug: string): string {
  return `portal_silent_portal_${slug}`;
}

/* ------------------------------------------------------------------ */
/*  Fields                                                             */
/* ------------------------------------------------------------------ */

export interface PortalFields {
  /** Every field of the portal's card type, in schema order. */
  all: FieldDef[];
  /** On a tile: per toggle, else the first three fields. */
  card: FieldDef[];
  /** In the detail panel: per toggle, else every field. */
  detail: FieldDef[];
}

export function portalFields(portal: PublicPortal | null): PortalFields {
  const all = portal?.type_info?.fields_schema?.flatMap((s) => s.fields) ?? [];
  const toggles = portalToggles(portal);
  const card = all.filter((f, idx) => isVisible(toggles, `field:${f.key}`, "card", idx < 3));
  const detail = all.filter((f) => isVisible(toggles, `field:${f.key}`, "detail", true));
  return { all, card, detail };
}

/** Whether an attribute holds something worth showing: not absent, null or empty text. */
export function hasAttributeValue(card: Pick<PortalCard, "attributes">, key: string): boolean {
  const v = card.attributes?.[key];
  return v !== undefined && v !== null && v !== "";
}

/** The detail-visible fields of one schema section that this card has a value for. */
export function fieldsWithValues(
  fields: FieldDef[],
  detail: FieldDef[],
  card: Pick<PortalCard, "attributes">,
): FieldDef[] {
  const shown = new Set(detail.map((f) => f.key));
  return fields.filter((f) => shown.has(f.key) && hasAttributeValue(card, f.key));
}

/* ------------------------------------------------------------------ */
/*  Relation types                                                     */
/* ------------------------------------------------------------------ */

export interface PortalRelationTypes {
  /** Shown anywhere — the relation filters on offer. */
  visible: PortalRelationType[];
  card: PortalRelationType[];
  detail: PortalRelationType[];
}

/** The relation types the administrator turned on (`rel:<key>` toggles), for tiles and the panel. */
export function portalRelationTypes(portal: PublicPortal | null): PortalRelationTypes {
  const toggles = portalToggles(portal) ?? {};
  const entry = (rt: PortalRelationType) => toggles[`rel:${rt.key}`];
  // Stryker disable next-line ArrayDeclaration: a placeholder entry has no `rel:` toggle, so the filter drops it either way
  const visible = (portal?.relation_types ?? []).filter(
    (rt) => entry(rt) && (entry(rt).card || entry(rt).detail),
  );
  return {
    visible,
    card: visible.filter((rt) => entry(rt).card),
    detail: visible.filter((rt) => entry(rt).detail),
  };
}

/** The card types the relation filters draw their options from, each once. */
export function relatedTypeKeys(types: PortalRelationType[]): string[] {
  return [...new Set(types.map((rt) => rt.other_type_key))];
}

type RelationLabel = (rt: PortalRelationType, reverse?: boolean) => string;

/**
 * A relation filter's label. A lone relation type to a card type is named by
 * that type; several reaching the same type add the verb, read from the
 * portal type's end — or both verbs for a self-referencing type, whose filter
 * matches either direction.
 */
export function relationFilterLabel(
  rt: PortalRelationType,
  visible: PortalRelationType[],
  relationLabel: RelationLabel,
): string {
  const sharesPair = visible.filter((o) => o.other_type_key === rt.other_type_key).length > 1;
  if (!sharesPair) return rt.other_type_label;
  const verb =
    rt.source_type_key === rt.target_type_key
      ? `${relationLabel(rt)} / ${relationLabel(rt, true)}`
      : relationLabel(rt, rt.source_type_key === rt.other_type_key);
  return `${rt.other_type_label} · ${verb}`;
}

/**
 * The related cards a tile names: one per card, not per relation, through the
 * tile-visible relation types only. The tile names what a card is connected
 * to; the verbs are in the detail panel.
 */
export function tileRelations(
  card: Pick<PortalCard, "relations">,
  types: PortalRelationType[],
): PortalCard["relations"] {
  const keys = new Set(types.map((r) => r.key));
  const seen = new Set<string>();
  return card.relations.filter((r) => {
    if (!keys.has(r.type) || seen.has(r.related_id)) return false;
    seen.add(r.related_id);
    return true;
  });
}

/**
 * The detail panel's relations, grouped by relation type and direction —
 * never by the rendered verb, which two types (or one translation) can share —
 * each group labelled with the verb from this card's side.
 */
export function detailRelationGroups(
  card: Pick<PortalCard, "relations">,
  detail: PortalRelationType[],
  all: PortalRelationType[],
  relationLabel: RelationLabel,
): { key: string; label: string; relations: PortalCard["relations"] }[] {
  const keys = new Set(detail.map((r) => r.key));
  const groups = new Map<string, { key: string; label: string; relations: PortalCard["relations"] }>();
  for (const rel of card.relations) {
    if (!keys.has(rel.type)) continue;
    const key = `${rel.type}|${rel.direction}`;
    const group = groups.get(key);
    if (group) {
      group.relations.push(rel);
      continue;
    }
    const rt = all.find((r) => r.key === rel.type);
    const label = rt ? relationLabel(rt, rel.direction !== "outgoing") : rel.type;
    groups.set(key, { key, label, relations: [rel] });
  }
  return [...groups.values()];
}

/* ------------------------------------------------------------------ */
/*  Visitor filters                                                    */
/* ------------------------------------------------------------------ */

/** The toggle key of a field's visitor filter. */
export const fieldFilterKey = (key: string): string => `field:${key}`;
/** The toggle key of a relation type's visitor filter. */
export const relationFilterKey = (key: string): string => `rel:${key}`;

/**
 * The filters a visitor sees and may use. The SERVER resolves them
 * (`visitor_filter_lists` in `portal_visibility.py`, the very function the
 * cards route enforces with) and the viewer reads them as they come — it
 * never derives them from the schema. A payload without them (an older
 * cached response) gets the bar every portal had before: the subtype, the
 * tags when there are any, the shown selects with options and the shown
 * relation types, nothing to add.
 */
export function visitorFilterLists(portal: PublicPortal | null): PortalVisitorFilters {
  if (portal?.visitor_filters) return portal.visitor_filters;
  const { all, card, detail } = portalFields(portal);
  const selects = all.filter(
    (f) =>
      (f.type === "single_select" || f.type === "multiple_select") &&
      (f.options ?? []).length > 0 &&
      (card.includes(f) || detail.includes(f)),
  );
  const shown = [
    ...((portal?.type_info?.subtypes ?? []).length > 0 ? ["subtype"] : []),
    ...(portal?.tag_groups?.some((g) => (g.tags ?? []).length > 0) ? ["tags"] : []),
    ...selects.map((f) => fieldFilterKey(f.key)),
    ...portalRelationTypes(portal).visible.map((rt) => relationFilterKey(rt.key)),
  ];
  return { shown, allowed: shown, can_add: false };
}

/** Whether the bar shows the filter `key` (`subtype`, `tags`, `field:<key>`, `rel:<key>`). */
export function showsFilter(lists: PortalVisitorFilters, key: string): boolean {
  return lists.shown.includes(key);
}

/** The field keys a visitor may filter on: the allowed ones, or only the shown ones while adding is off. */
export function filterableFieldKeys(lists: PortalVisitorFilters): string[] {
  const keys = lists.can_add ? lists.allowed : lists.shown;
  return keys.filter((k) => k.startsWith("field:")).map((k) => k.slice("field:".length));
}

/**
 * The Fields row's catalog: the type's fields the visitor may filter on
 * (`filterableFieldKeys`) — never a cost field, which the public schema does
 * not carry anyway — each shown by default iff the server lists it in
 * `shown`, not by the reports' "facet in a shown section" rule. With adding
 * off the catalog holds the shown fields only, so no "Add filter" chip.
 */
export function portalFilterCatalog<F extends FacetFieldLike>(
  portal: PublicPortal | null,
  lists: PortalVisitorFilters,
  labels: Omit<FilterCatalogOptions<FieldDef, F>, "canViewCosts" | "shownByDefault">,
): FilterCatalog<F> {
  const schema = schemaWithFields(portal?.type_info?.fields_schema ?? [], filterableFieldKeys(lists));
  return buildFilterCatalog<FieldDef, F>(schema, {
    ...labels,
    canViewCosts: false,
    shownByDefault: (f) => showsFilter(lists, fieldFilterKey(f.key)),
  });
}

/** A visitor's filter state: the Fields row's value, plus the subtype, relation and tag picks. */
export interface VisitorFilterState extends FieldFilterState {
  subtypeFilters: string[];
  /** Picked related card ids (or "(empty)") per relation type key. */
  relationFilters: Record<string, string[]>;
  tagFilterIds: string[];
}

export const EMPTY_VISITOR_FILTERS: VisitorFilterState = {
  subtypeFilters: [],
  attrFilters: {},
  attrConditions: {},
  filterFields: [],
  relationFilters: {},
  tagFilterIds: [],
};

/** The entries of a pick map that pick something. */
function picked(map: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(map).filter(([, v]) => v.length > 0));
}

/**
 * The `filters` parameter of the card query: the canonical `CardFilterValue`
 * subset the server reads (`normalise_visitor_filters`), every empty key left
 * out, conditions normalised (`restoreAttrConditions`), the added fields
 * (display state) never sent. `null` when nothing is set.
 */
export function visitorFiltersParam(
  f: Pick<VisitorFilterState, "subtypeFilters" | "attrFilters" | "attrConditions" | "relationFilters" | "tagFilterIds">,
): string | null {
  const out: Record<string, unknown> = {};
  if (f.subtypeFilters.length > 0) out.subtypeFilters = f.subtypeFilters;
  const attrs = picked(f.attrFilters);
  if (Object.keys(attrs).length > 0) out.attrFilters = attrs;
  const conditions = restoreAttrConditions(f.attrConditions);
  if (Object.keys(conditions).length > 0) out.attrConditions = conditions;
  const relations = picked(f.relationFilters);
  if (Object.keys(relations).length > 0) out.relationFilters = relations;
  if (f.tagFilterIds.length > 0) out.tagFilterIds = f.tagFilterIds;
  return Object.keys(out).length > 0 ? JSON.stringify(out) : null;
}

/* ------------------------------------------------------------------ */
/*  The card query                                                     */
/* ------------------------------------------------------------------ */

export interface CardQuery {
  search: string;
  filters: Pick<
    VisitorFilterState,
    "subtypeFilters" | "attrFilters" | "attrConditions" | "relationFilters" | "tagFilterIds"
  >;
  page: number;
  pageSize: number;
  sortBy: string;
  sortDir: string;
}

/** The query string for a page of cards; with no filter set, `filters` is left out entirely. */
export function cardQueryParams(q: CardQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set("search", q.search);
  const filters = visitorFiltersParam(q.filters);
  if (filters !== null) params.set("filters", filters);
  params.set("page", String(q.page));
  params.set("page_size", String(q.pageSize));
  params.set("sort_by", q.sortBy);
  params.set("sort_dir", q.sortDir);
  return params.toString();
}

/** Whether any filter beyond the search is set — what the Clear chip follows. Added rows alone are not a filter. */
export function hasActiveFilters(f: VisitorFilterState): boolean {
  return visitorFiltersParam(f) !== null;
}

/** "Clear filters": every value goes, the rows the visitor added stay. */
export function clearVisitorFilters(f: VisitorFilterState): VisitorFilterState {
  return { ...EMPTY_VISITOR_FILTERS, filterFields: f.filterFields };
}

/* ------------------------------------------------------------------ */
/*  What the visitor's browser remembers                               */
/* ------------------------------------------------------------------ */

/**
 * The fields a visitor added through "Add filter", remembered per portal in
 * their own browser (`turboea.portal.<slug>.prefs`). Never a filter VALUE: a
 * visitor coming back sees the same rows, empty.
 */
export interface PortalPrefs {
  filterFields: string[];
}

export function portalPrefsKey(slug: string): string {
  return `turboea.portal.${slug}.prefs`;
}

/** What the browser remembers for a portal; anything malformed, or storage that throws, reads as nothing. */
export function loadPortalPrefs(slug: string): PortalPrefs {
  try {
    // A missing key reads as `null`, which parses to `null` and throws below: nothing
    // remembered. Any other shape (a list, a string, a number) has no `filterFields`, and
    // `restoreFilterFields` keeps only a list of strings.
    const parsed = JSON.parse(localStorage.getItem(portalPrefsKey(slug)) as string) as {
      filterFields?: unknown;
    };
    return { filterFields: restoreFilterFields(parsed.filterFields) };
  } catch {
    return { filterFields: [] };
  }
}

/** Remember the added fields; none is remembered as nothing at all. Blocked storage is ignored. */
export function savePortalPrefs(slug: string, prefs: PortalPrefs): void {
  const filterFields = restoreFilterFields(prefs.filterFields);
  try {
    if (filterFields.length === 0) localStorage.removeItem(portalPrefsKey(slug));
    else localStorage.setItem(portalPrefsKey(slug), JSON.stringify({ filterFields }));
  } catch {
    // Storage unavailable (private mode) — the portal just won't remember.
  }
}

/** The remembered fields this portal still lets the visitor filter on; the rest are ignored. */
export function knownFilterFields(filterFields: readonly string[], catalog: FilterCatalog<{ key: string }>): string[] {
  const known = new Set(catalogFields(catalog).map((e) => e.field.key));
  return filterFields.filter((k) => known.has(k));
}
