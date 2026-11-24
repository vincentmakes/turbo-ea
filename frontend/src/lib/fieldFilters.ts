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
 * options, yes/no fields). `text`: contains. `number`: a min–max range.
 * `date`: a from–to range. A new kind extends this union, `filterKindOf`,
 * `FILTER_KIND_ICONS`, the condition helpers below and `FieldFilterControl`.
 */
export type FilterKind = "facet" | "text" | "number" | "date";

/** The glyph "Add filter" shows beside a field of each kind. */
export const FILTER_KIND_ICONS: Record<FilterKind, string> = {
  facet: "checklist",
  text: "text_fields",
  number: "123",
  date: "calendar_month",
};

/** The reserved section card detail folds into its Description section. */
export const DESCRIPTION_SECTION = "__description";

const TEXT_TYPES = new Set(["text", "multiline_text", "url"]);
const NUMBER_TYPES = new Set(["number", "percentage", "cost"]);

/**
 * A field's filter kind, or `null` when it cannot be filtered on (an
 * extension's `ext.*` type, a select without options, …). A `cost` field is
 * a number here; whether the reader may filter on it is the catalog's call.
 */
export function filterKindOf(field: FacetFieldLike): FilterKind | null {
  if (isFacetField(field)) return "facet";
  if (TEXT_TYPES.has(field.type)) return "text";
  if (NUMBER_TYPES.has(field.type)) return "number";
  return field.type === "date" ? "date" : null;
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
   * Whether the reader may see cost values. A `cost` field is left out of the
   * catalog without it — and so is a condition on one (`matchesConditions`).
   * Required, so no filter block can forget to ask. A web portal passes
   * `false`: it never filters on costs.
   */
  canViewCosts: boolean;
  /** A section's display label (its translation, else its name). */
  sectionLabel: (section: FilterSchemaSection<R>) => string;
  /** The label of the `__description` section, which has no name of its own. */
  descriptionLabel: string;
  /** The field as the block shows it: label, option labels, Yes / No resolved. */
  resolveField: (field: R) => F;
  /**
   * Whether a filterable field is shown by default. Absent: a facet field of
   * a section not hidden from filters (the reports' rule). The portal viewer
   * passes its own: shown iff the server lists the field (`visitor_filters.shown`).
   */
  shownByDefault?: (field: R, kind: FilterKind, section: FilterSchemaSection<R>) => boolean;
}

/** The reports' rule: a facet field of a section not hidden from filters. */
function defaultShownByDefault<R>(_field: R, kind: FilterKind, section: FilterSchemaSection<R>): boolean {
  return kind === "facet" && section.hideInFilters !== true;
}

/**
 * The catalog of a `fields_schema`: every section with a filterable field,
 * each field with its kind and whether it is shown by default. Shown by
 * default = a facet field of a section not hidden from filters (a text,
 * number or date field is always added by the person), unless the caller
 * decides it (`shownByDefault`).
 */
export function buildFilterCatalog<R extends FacetFieldLike, F extends FacetFieldLike>(
  schema: readonly FilterSchemaSection<R>[],
  opts: FilterCatalogOptions<R, F>,
): FilterCatalog<F> {
  const out: FilterCatalog<F> = [];
  const shownByDefault = opts.shownByDefault ?? defaultShownByDefault;
  for (const section of schema) {
    const hidden = section.hideInFilters === true;
    const fields: FilterCatalogField<F>[] = [];
    for (const raw of section.fields) {
      const kind = filterKindOf(raw);
      if (kind === null) continue;
      if (raw.type === "cost" && !opts.canViewCosts) continue;
      fields.push({ field: opts.resolveField(raw), kind, shownByDefault: shownByDefault(raw, kind, section) });
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

/**
 * `schema` with only the fields named in `allowed`, sections otherwise as
 * they are: what a surface whose filterable fields are decided elsewhere (the
 * portal viewer, from the server's allowed list) feeds `buildFilterCatalog`.
 */
export function schemaWithFields<R extends { key: string }>(
  schema: readonly FilterSchemaSection<R>[],
  allowed: Iterable<string>,
): FilterSchemaSection<R>[] {
  const keep = new Set(allowed);
  return schema.map((section) => ({ ...section, fields: section.fields.filter((f) => keep.has(f.key)) }));
}

/** Every field of the catalog, in schema order. */
export function catalogFields<F>(catalog: FilterCatalog<F>): FilterCatalogField<F>[] {
  return catalog.flatMap((s) => s.fields);
}

/** Each catalog field's kind, by key: the reader's catalog, as the matcher reads it. */
export function catalogKinds<F extends { key: string }>(catalog: FilterCatalog<F>): Map<string, FilterKind> {
  return new Map(catalogFields(catalog).map((e) => [e.field.key, e.kind]));
}

/* ------------------------------------------------------------------ */
/*  Conditions: text contains, number range, date range               */
/* ------------------------------------------------------------------ */
//
// The browser twin of `backend/app/services/portal_card_filters.py`
// (`normalise_condition`, `condition_clause`). Both suites pin the same edge
// cases. Known divergences, all outside what the UI writes:
//  - text: `toLowerCase` folds case by Unicode, Postgres `ILIKE` by the
//    database collation (the tests use ASCII only); a JSON number is printed
//    by JavaScript (`1` for a stored `1.0`, `1e+21`), by Postgres there; the
//    200-character cap counts UTF-16 units here, code points there.
//  - number: a JSON number longer than 40 characters as Postgres prints it
//    counts here and not there; past 15 significant digits this side
//    compares doubles, that side exact decimals.
//  - date: an impossible calendar date (`2026-13-45`) matches the pattern on
//    both sides and compares as its text, as `lifecycle.py` does.

/** Text: the stored value contains `contains`, case-insensitive. */
export interface TextCondition {
  contains: string;
}
/** Number: the stored value lies within the bounds, both included. */
export interface NumberCondition {
  min?: number;
  max?: number;
}
/** Date: the stored day (`YYYY-MM-DD`) lies within the bounds, both included. */
export interface DateCondition {
  from?: string;
  to?: string;
}
export type AttrCondition = TextCondition | NumberCondition | DateCondition;
export type ConditionKind = Exclude<FilterKind, "facet">;

/** The longest `contains` kept (the server cuts at the same length). */
export const CONTAINS_MAX = 200;
/** A numeric text longer than this is not read as a number. */
export const NUMBER_MAX_CHARS = 40;
/**
 * A plain decimal: optional sign, digits with an optional fraction (or a bare
 * fraction), an optional exponent of at most two digits — so every text it
 * accepts is a finite double here and a `numeric` on the server. `[0-9]`,
 * never `\d`: the server's twin must not widen past ASCII.
 */
export const NUMBER_PATTERN = /^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]{1,2})?$/;
/** A stored date: `YYYY-MM-DD`, optionally an ISO time part (`lifecycle.py`'s `_SQL_DATE_PATTERN`). */
export const DATE_VALUE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9:.,+Z-]+)?$/;
/** A date bound as the UI writes it. */
export const DATE_BOUND_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

const SHAPE_KEYS: [ConditionKind, string[]][] = [
  ["text", ["contains"]],
  ["number", ["min", "max"]],
  ["date", ["from", "to"]],
];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const own = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);

/**
 * The kind a condition's keys name, or `null` when it is not an object or
 * names keys of more than one kind (`condition_shape` on the server).
 */
export function shapeOfCondition(raw: unknown): ConditionKind | null {
  if (!isPlainObject(raw)) return null;
  const kinds = SHAPE_KEYS.filter(([, keys]) => keys.some((k) => own(raw, k)));
  return kinds.length === 1 ? kinds[0][0] : null;
}

const finiteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const dateBound = (v: unknown): v is string => typeof v === "string" && DATE_BOUND_PATTERN.test(v);

/**
 * One condition of `kind` in its canonical shape, or `null` when it narrows
 * nothing: a trimmed, non-empty `contains` (cut at `CONTAINS_MAX`); finite
 * `min` / `max`; `YYYY-MM-DD` `from` / `to`. An unusable bound is dropped;
 * no usable bound, no condition.
 */
export function normaliseCondition(kind: FilterKind, raw: unknown): AttrCondition | null {
  if (!isPlainObject(raw)) return null;
  if (kind === "text") {
    const needle = typeof raw.contains === "string" ? raw.contains.trim() : "";
    return needle ? { contains: needle.slice(0, CONTAINS_MAX) } : null;
  }
  if (kind === "number") {
    const out: NumberCondition = {};
    if (finiteNumber(raw.min)) out.min = raw.min;
    if (finiteNumber(raw.max)) out.max = raw.max;
    return Object.keys(out).length > 0 ? out : null;
  }
  if (kind === "date") {
    const out: DateCondition = {};
    if (dateBound(raw.from)) out.from = raw.from;
    if (dateBound(raw.to)) out.to = raw.to;
    return Object.keys(out).length > 0 ? out : null;
  }
  return null;
}

/** Read `attrConditions` back from a saved config or a link, every unusable condition dropped. */
export function restoreAttrConditions(raw: unknown): Record<string, AttrCondition> {
  if (!isPlainObject(raw)) return {};
  const out: Record<string, AttrCondition> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!key) continue;
    const kind = shapeOfCondition(value);
    const condition = kind ? normaliseCondition(kind, value) : null;
    if (condition) out[key] = condition;
  }
  return out;
}

/**
 * A stored value as a number: a JSON number, or a plain decimal text of at
 * most `NUMBER_MAX_CHARS` ("12.5", "-.5", "1e2"). A boolean, a list, an
 * object, null, "" or any other text is not a number. A text the pattern
 * accepts is always finite (40 characters, a two-digit exponent).
 */
export function numericValueOf(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || v.length > NUMBER_MAX_CHARS || !NUMBER_PATTERN.test(v)) return null;
  return Number(v);
}

/**
 * Does a card's stored value satisfy one condition of `kind`? A card with no
 * usable value fails an active condition. `condition` is normalised first,
 * so a draft the control holds ("ORG " while typing) matches as stored.
 */
export function matchesCondition(kind: FilterKind, condition: unknown, rawValue: unknown): boolean {
  const c = normaliseCondition(kind, condition);
  if (c === null) return true;
  if (kind === "text") {
    if (typeof rawValue !== "string" && typeof rawValue !== "number") return false;
    return String(rawValue).toLowerCase().includes((c as TextCondition).contains.toLowerCase());
  }
  if (kind === "number") {
    const n = numericValueOf(rawValue);
    const { min, max } = c as NumberCondition;
    if (n === null) return false;
    return (min === undefined || n >= min) && (max === undefined || n <= max);
  }
  if (typeof rawValue !== "string" || !DATE_VALUE_PATTERN.test(rawValue)) return false;
  const day = rawValue.slice(0, 10);
  const { from, to } = c as DateCondition;
  return (from === undefined || day >= from) && (to === undefined || day <= to);
}

/**
 * The conditions that apply for this reader, normalised: only those whose
 * field is in the reader's catalog (`kindByKey`, `catalogKinds`) with the
 * kind the condition's shape names. A condition on a field the catalog lacks
 * — a cost field for a reader without cost access, a field since deleted —
 * is ignored, so a saved report or a shared link never filters out of sight.
 */
export function appliedConditions(
  conditions: Readonly<Record<string, unknown>> | undefined,
  kindByKey: ReadonlyMap<string, FilterKind> | undefined,
): { key: string; kind: ConditionKind; condition: AttrCondition }[] {
  const out: { key: string; kind: ConditionKind; condition: AttrCondition }[] = [];
  if (!conditions || !kindByKey) return out;
  for (const [key, raw] of Object.entries(conditions)) {
    const kind = shapeOfCondition(raw);
    if (kind === null || kindByKey.get(key) !== kind) continue;
    const condition = normaliseCondition(kind, raw);
    if (condition) out.push({ key, kind, condition });
  }
  return out;
}

/** Does a card's `attributes` satisfy every condition that applies (`appliedConditions`)? */
export function matchesConditions(
  attributes: Readonly<Record<string, unknown>> | undefined,
  conditions: Readonly<Record<string, unknown>> | undefined,
  kindByKey: ReadonlyMap<string, FilterKind> | undefined,
): boolean {
  const attrs = attributes ?? {};
  return appliedConditions(conditions, kindByKey).every(({ key, kind, condition }) =>
    matchesCondition(kind, condition, attrs[key]),
  );
}

/** How many conditions apply: what a filter block's count and its print header both count. */
export function countActiveConditions(
  conditions: Readonly<Record<string, unknown>> | undefined,
  kindByKey: ReadonlyMap<string, FilterKind> | undefined,
): number {
  return appliedConditions(conditions, kindByKey).length;
}

/**
 * A condition as parts a caller words (no i18n here): `contains` its text,
 * `between` two bounds, `atLeast` / `atMost` one. Numbers are formatted by
 * `formatNumber` (the caller's locale), dates are left as stored.
 */
export type ConditionDescription =
  | { op: "contains"; value: string }
  | { op: "between"; from: string; to: string }
  | { op: "atLeast"; value: string }
  | { op: "atMost"; value: string };

export function describeCondition(
  condition: AttrCondition,
  formatNumber: (n: number) => string = String,
): ConditionDescription {
  if ("contains" in condition) return { op: "contains", value: condition.contains };
  const [low, high] =
    "min" in condition || "max" in condition
      ? [(condition as NumberCondition).min, (condition as NumberCondition).max].map((n) =>
          n === undefined ? undefined : formatNumber(n),
        )
      : [(condition as DateCondition).from, (condition as DateCondition).to];
  if (low !== undefined && high !== undefined) return { op: "between", from: low, to: high };
  return low !== undefined ? { op: "atLeast", value: low } : { op: "atMost", value: high ?? "" };
}

/**
 * The part of a filter value the Fields row edits. `filterFields` is display
 * state — the fields the person added — and is never counted or matched.
 */
export interface FieldFilterState {
  /** Picked option keys per facet field. */
  attrFilters: Record<string, string[]>;
  /**
   * Text / number / date conditions per field. The control writes what the
   * person typed (a needle may still carry a trailing space); every reader
   * normalises, and a field whose condition narrows nothing is left out.
   */
  attrConditions: Record<string, AttrCondition>;
  /** Fields added through "Add filter", by key. */
  filterFields: string[];
}

/** The keys of the fields that hold a value: a picked option or a condition that narrows. */
export function activeFieldKeys(
  state: Pick<FieldFilterState, "attrFilters"> & Partial<Pick<FieldFilterState, "attrConditions">>,
): Set<string> {
  const keys = Object.entries(state.attrFilters)
    .filter(([, vals]) => vals.length > 0)
    .map(([key]) => key);
  for (const [key, raw] of Object.entries(state.attrConditions ?? {})) {
    const kind = shapeOfCondition(raw);
    if (kind !== null && normaliseCondition(kind, raw) !== null) keys.push(key);
  }
  return new Set(keys);
}

/**
 * `state` with every field that holds a value added to `filterFields`: the
 * stored keys first, in their order, then each new key in `activeFieldKeys`'
 * order (picks, then conditions). For a value restored without its
 * `filterFields` (a portal preset, a hand-written link, an older saved
 * config): the row would otherwise exist only because of its value, and
 * clearing that value mid-edit would unmount the control. A key of a field
 * shown by default is harmless — `rowsToRender` only consults it for
 * addable fields. Returns `state` itself when nothing is missing.
 */
export function withActiveFilterFields<S extends FieldFilterState>(state: S): S {
  const missing = [...activeFieldKeys(state)].filter((k) => !state.filterFields.includes(k));
  return missing.length === 0 ? state : { ...state, filterFields: [...state.filterFields, ...missing] };
}

/** A row the Fields row renders. */
export interface RenderedFilterRow<F> extends FilterCatalogField<F> {
  /** Not shown by default, so the row has a remove button. */
  removable: boolean;
}

/**
 * The rows to render: first the fields shown by default, in schema order;
 * then the ones the person added, in the order they added them; then any
 * other field holding a value (one restored from an older link), in schema
 * order. The added rows sit together at the end, just before the "Add
 * filter" chip that added them. A key the catalog does not know (a field
 * since deleted, or one the reader may not filter on) renders nothing.
 */
export function rowsToRender<F extends { key: string }>(
  catalog: FilterCatalog<F>,
  filterFields: readonly string[],
  activeKeys: ReadonlySet<string>,
): RenderedFilterRow<F>[] {
  const entries = catalogFields(catalog);
  const shown = entries.filter((e) => e.shownByDefault).map((e) => ({ ...e, removable: false }));
  const byKey = new Map(entries.filter((e) => !e.shownByDefault).map((e) => [e.field.key, e]));
  const added: RenderedFilterRow<F>[] = [];
  const take = (key: string) => {
    const entry = byKey.get(key);
    if (!entry) return;
    byKey.delete(key);
    added.push({ ...entry, removable: true });
  };
  filterFields.forEach(take);
  entries.forEach((e) => activeKeys.has(e.field.key) && take(e.field.key));
  return [...shown, ...added];
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

/** Removing an added row: the field leaves `filterFields` and its value — picks or condition — is cleared. */
export function removeFilterField(state: FieldFilterState, key: string): FieldFilterState {
  const attrFilters = { ...state.attrFilters };
  delete attrFilters[key];
  const attrConditions = { ...state.attrConditions };
  delete attrConditions[key];
  return { attrFilters, attrConditions, filterFields: state.filterFields.filter((k) => k !== key) };
}

/**
 * `attrConditions` with `key` set to `condition`, or without `key` when the
 * condition narrows nothing (an emptied box, both bounds cleared).
 */
export function setCondition(
  conditions: Readonly<Record<string, AttrCondition>>,
  key: string,
  kind: ConditionKind,
  condition: AttrCondition,
): Record<string, AttrCondition> {
  const out = { ...conditions };
  if (normaliseCondition(kind, condition) === null) delete out[key];
  else out[key] = condition;
  return out;
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
