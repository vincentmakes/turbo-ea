/**
 * Which of a card type's own fields a filter block offers, and which of them
 * it shows (discussion #1425).
 *
 * One catalog, built from the type's `fields_schema`, answers both questions
 * for every filter block (the reports' shared `CardFilterSection`, the
 * Capability Map, the web portal preset dialog — and, later, the account-less
 * portal viewer):
 *
 *  - a field is **filterable** when it has a filter kind (`filterKindOf`);
 *    anything else is left out of the catalog;
 *  - a filterable field is **shown by default** when it is a facet field of a
 *    section the admin did not switch off with "Hidden from filters"
 *    (`SectionDef.hideInFilters`);
 *  - every other filterable field is **addable**: the person picks it in
 *    "Add filter", and the block remembers it in `filterFields`.
 *
 * The rows a block renders are the fields shown by default, the ones the
 * person added and any field that holds a value (`rowsToRender`), so a value
 * restored from a saved report or a link is never applied out of sight.
 *
 * The section switch shapes the filter ROWS only. Which fields colour, group
 * or match a report stays `isFacetField` / `pickFacetFields` (`fieldFacets.ts`).
 *
 * A LEAF module: it imports types and pure `lib/*` helpers only — never the
 * API client, the metamodel hook or a feature — because the account-less
 * portal viewer imports it. Labels are resolved by the caller (`resolveField`,
 * `sectionLabel`), so it stays free of hooks.
 */
import { isFacetField, type FacetFieldLike } from "@/lib/fieldFacets";
import { cardSearchRank, compareByRank } from "@/lib/searchRank";

/**
 * How a field is filtered. `facet`: pick among its options (selects with
 * options, yes/no fields). New kinds (text, number, date) extend this union,
 * `filterKindOf`, `FILTER_KIND_ICONS` and `FieldFilterControl`.
 */
export type FilterKind = "facet";

/** The glyph "Add filter" shows beside a field of each kind. */
export const FILTER_KIND_ICONS: Record<FilterKind, string> = {
  facet: "checklist",
};

/** The reserved section card detail folds into its Description section. */
export const DESCRIPTION_SECTION = "__description";

/** A field's filter kind, or `null` when it cannot be filtered on. */
export function filterKindOf(field: FacetFieldLike): FilterKind | null {
  return isFacetField(field) ? "facet" : null;
}

/** A `fields_schema` section, as much of it as the catalog reads. */
export interface FilterSchemaSection<R> {
  section: string;
  fields: readonly R[];
  hideInFilters?: boolean;
  translations?: Record<string, string>;
}

/** One filterable field of the catalog. */
export interface FilterCatalogField<F> {
  /** The field, its label and options resolved by the caller. */
  field: F;
  kind: FilterKind;
  shownByDefault: boolean;
}

/** One section of the catalog: only its filterable fields, in schema order. */
export interface FilterCatalogSection<F> {
  /** The section's stored name (`__description` for the Description section). */
  key: string;
  /** Its display label. */
  label: string;
  /** The admin switched it off with "Hidden from filters". */
  hidden: boolean;
  fields: FilterCatalogField<F>[];
}

export type FilterCatalog<F> = FilterCatalogSection<F>[];

export interface FilterCatalogOptions<R, F> {
  /**
   * Whether the reader may see cost values. Cost fields are not filterable
   * yet; once a number kind covers them, they are left out without it.
   */
  canViewCosts?: boolean;
  /** A section's display label (its translation, else its name). */
  sectionLabel: (section: FilterSchemaSection<R>) => string;
  /** The label of the `__description` section, which has no name of its own. */
  descriptionLabel: string;
  /** The field as the block shows it: label, option labels, Yes / No resolved. */
  resolveField: (field: R) => F;
}

/**
 * The catalog of a `fields_schema`: every section with a filterable field,
 * each field with its kind and whether it is shown by default.
 */
export function buildFilterCatalog<R extends FacetFieldLike, F extends FacetFieldLike>(
  schema: readonly FilterSchemaSection<R>[],
  opts: FilterCatalogOptions<R, F>,
): FilterCatalog<F> {
  const out: FilterCatalog<F> = [];
  for (const section of schema) {
    const hidden = section.hideInFilters === true;
    const fields: FilterCatalogField<F>[] = [];
    for (const raw of section.fields) {
      const kind = filterKindOf(raw);
      if (kind === null) continue;
      fields.push({ field: opts.resolveField(raw), kind, shownByDefault: !hidden });
    }
    if (fields.length === 0) continue;
    out.push({
      key: section.section,
      label: section.section === DESCRIPTION_SECTION ? opts.descriptionLabel : opts.sectionLabel(section),
      hidden,
      fields,
    });
  }
  return out;
}

/** Every field of the catalog, in schema order. */
export function catalogFields<F>(catalog: FilterCatalog<F>): FilterCatalogField<F>[] {
  return catalog.flatMap((s) => s.fields);
}

/**
 * The part of a filter value the Fields row edits. `filterFields` is display
 * state — the fields the person added — and is never counted or matched.
 */
export interface FieldFilterState {
  /** Picked option keys per facet field. */
  attrFilters: Record<string, string[]>;
  /** Fields added through "Add filter", by key. */
  filterFields: string[];
}

/** The keys of the fields that hold a value. */
export function activeFieldKeys(state: Pick<FieldFilterState, "attrFilters">): Set<string> {
  return new Set(
    Object.entries(state.attrFilters)
      .filter(([, vals]) => vals.length > 0)
      .map(([key]) => key),
  );
}

/** A row the Fields row renders. */
export interface RenderedFilterRow<F> extends FilterCatalogField<F> {
  /** Not shown by default, so the row has a remove button. */
  removable: boolean;
}

/**
 * The rows to render: the fields shown by default, the ones the person added
 * and every field with an active value, in schema order. A key the catalog
 * does not know (a field since deleted, or one the reader may not filter on)
 * renders nothing.
 */
export function rowsToRender<F extends { key: string }>(
  catalog: FilterCatalog<F>,
  filterFields: readonly string[],
  activeKeys: ReadonlySet<string>,
): RenderedFilterRow<F>[] {
  const added = new Set(filterFields);
  const out: RenderedFilterRow<F>[] = [];
  for (const entry of catalogFields(catalog)) {
    const key = entry.field.key;
    if (entry.shownByDefault) out.push({ ...entry, removable: false });
    else if (added.has(key) || activeKeys.has(key)) out.push({ ...entry, removable: true });
  }
  return out;
}

/** The catalog without the rendered fields: what "Add filter" offers. Empty sections are dropped. */
export function addableFields<F extends { key: string }>(
  catalog: FilterCatalog<F>,
  rendered: readonly { field: { key: string } }[],
): FilterCatalog<F> {
  const shown = new Set(rendered.map((r) => r.field.key));
  const out: FilterCatalog<F> = [];
  for (const section of catalog) {
    const fields = section.fields.filter((f) => !shown.has(f.field.key));
    if (fields.length > 0) out.push({ ...section, fields });
  }
  return out;
}

/**
 * "Add filter"'s list for a search: on the RAW input, a field matches on its
 * own label or its section's label, ranked like every search box
 * (`searchRank`: exact → starts with → starts a word → contains, then
 * alphabetically). Sections stay grouped and are ordered by their best match.
 * An empty search lists everything in schema order.
 */
export function searchFilterCatalog<F extends { key: string; label: string }>(
  catalog: FilterCatalog<F>,
  query: string,
  locale?: string,
): FilterCatalog<F> {
  if (!query.trim()) return catalog;
  // The section label competes as an alias: a field matches on either name.
  const rankable = (section: FilterCatalogSection<F>, f: FilterCatalogField<F>) => ({
    name: f.field.label,
    alias: section.label,
  });
  const cmp = compareByRank(query, locale);
  const ranked: { section: FilterCatalogSection<F>; best: number }[] = [];
  for (const section of catalog) {
    const matching = section.fields
      .map((f) => ({ f, r: rankable(section, f) }))
      .filter(({ r }) => cardSearchRank(r, query) >= 0)
      .sort((a, b) => cmp(a.r, b.r));
    if (matching.length === 0) continue;
    ranked.push({
      section: { ...section, fields: matching.map(({ f }) => f) },
      best: cardSearchRank(matching[0].r, query),
    });
  }
  // A stable sort keeps schema order between sections that match equally well.
  return ranked.sort((a, b) => a.best - b.best).map(({ section }) => section);
}

/** `filterFields` with `key` added once, at the end. */
export function addFilterField(filterFields: readonly string[], key: string): string[] {
  return filterFields.includes(key) ? [...filterFields] : [...filterFields, key];
}

/** Removing an added row: the field leaves `filterFields` and its value is cleared. */
export function removeFilterField(state: FieldFilterState, key: string): FieldFilterState {
  const attrFilters = { ...state.attrFilters };
  delete attrFilters[key];
  return { attrFilters, filterFields: state.filterFields.filter((k) => k !== key) };
}

/** Read `filterFields` back from a saved config or a link: strings only, each once. */
export function restoreFilterFields(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v === "string" && v !== "" && !out.includes(v)) out.push(v);
  }
  return out;
}
