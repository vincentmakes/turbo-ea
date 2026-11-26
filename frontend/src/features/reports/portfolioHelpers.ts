/* ------------------------------------------------------------------ */
/*  Pure helpers for the App / Flexible Portfolio reports.            */
/*                                                                    */
/*  Extracted from PortfolioReport.tsx so the colour-resolution,      */
/*  relation-subtype, and filter-matching logic can be unit-tested    */
/*  without rendering the (very large) report component.              */
/* ------------------------------------------------------------------ */

import { EMPTY_FILTER_KEY } from "@/components/FilterSelect";
import { CARD_TYPE_COLORS, STATUS_COLORS } from "@/theme/tokens";
import {
  MULTIPLE_COLOR,
  MULTIPLE_KEY,
  facetBucket,
  facetLegend,
  isFacetField,
  matchesFacet,
  rawValues,
} from "@/lib/fieldFacets";
import { matchesConditions } from "@/lib/fieldFilters";
import type { FilterKind } from "@/lib/fieldFilters";
import { parseSideKey } from "@/lib/relationSort";
import { isAliveAtDate } from "@/lib/lifecycleAtDate";

/* ------------------------------------------------------------------ */
/*  Data shapes                                                       */
/* ------------------------------------------------------------------ */

export interface AppRelation {
  relation_type: string;
  /** The card's side of the row — what tells "has site" from "is site of" on
   * a self-referencing type. Absent on older payloads, which means "either". */
  direction?: "outgoing" | "incoming";
  related_id: string;
  related_name: string;
  related_type: string;
  /** Relation attribute values keyed by attribute field key, e.g.
   * `{ usageType: "owner" }`. Drives the relation-subtype colour/filters. */
  attributes?: Record<string, unknown>;
  /** The relation's own lifecycle, sent only when it has dates; absent means
   *  always in effect. `relationsAtDate` reads it. */
  lifecycle?: Record<string, string>;
}

/**
 * Does `rel` match a relation-type facet key? The key is a bare relation-type
 * key ("either side") or one side of a self-referencing type (`<key>__out` /
 * `<key>__in`), and a row only carries `direction` on payloads new enough to
 * split — an older row matches either side, as it always did.
 */
export function relationOnSide(rel: AppRelation, facetKey: string): boolean {
  const { key, isSource } = parseSideKey(facetKey);
  if (rel.relation_type !== key) return false;
  if (isSource === undefined || !rel.direction) return true;
  return (rel.direction === "outgoing") === isSource;
}

/** How the Portfolio report groups its cards. `relTypeKey` narrows a relation
 *  axis to ONE relation type; without it the axis means "related to
 *  `typeKey` at all", which is what every saved report carrying a
 *  `rel:<cardType>` key has always meant. */
export type GroupByMode =
  | { kind: "attribute"; fieldKey: string }
  | { kind: "relation"; typeKey: string; relTypeKey?: string };

/** The relations that place `app` in a relation grouping's groups. */
export function groupingRelations(
  app: { relations: AppRelation[] },
  typeKey: string,
  relTypeKey?: string,
): AppRelation[] {
  return app.relations.filter(
    (r) => r.related_type === typeKey && (!relTypeKey || relationOnSide(r, relTypeKey)),
  );
}

/** While grouped by a related card, the lifecycles of the relations behind the
 *  groups — the timeline counts one starting or ending as a card moving between
 *  groups. `undefined` for an attribute grouping: no relation moves anything. */
export function groupingRelationLifecycles(
  apps: readonly { relations: AppRelation[] }[],
  mode: GroupByMode,
): (Record<string, string> | undefined)[] | undefined {
  if (mode.kind !== "relation") return undefined;
  return apps.flatMap((a) =>
    groupingRelations(a, mode.typeKey, mode.relTypeKey).map((r) => r.lifecycle),
  );
}

export interface AppData {
  id: string;
  name: string;
  subtype?: string;
  attributes?: Record<string, unknown>;
  lifecycle?: Record<string, string>;
  relations: AppRelation[];
  org_ids: string[];
  tag_ids?: string[];
}

export interface FieldOption {
  key: string;
  label: string;
  color?: string;
  translations?: Record<string, string>;
}

export interface FieldDef {
  key: string;
  label: string;
  type: string;
  options?: FieldOption[];
  translations?: Record<string, string>;
}

export interface SectionDef {
  section: string;
  fields: FieldDef[];
  translations?: Record<string, string>;
  /** The section's fields are offered by "Add filter" only, not shown by default. */
  hideInFilters?: boolean;
}

export interface RelTypeDef {
  key: string;
  label: string;
  reverse_label?: string;
  source_type_key: string;
  target_type_key: string;
  other_type_key: string;
  translations?: Record<string, Record<string, string>>;
  /** single_select attributes on the relation type ("subtypes"). */
  attributes_schema?: FieldDef[];
}

export interface TagGroupDef {
  id: string;
  name: string;
  mode: string;
  tags: { id: string; name: string; color?: string }[];
}

/** A single (relation type, single_select attribute) pair surfaced to the
 * portfolio's Color By / filter controls as a relation "subtype". */
export interface RelSubtype {
  /** Stable id: `${relTypeKey}::${fieldKey}`. */
  composite: string;
  relTypeKey: string;
  fieldKey: string;
  /** The related card type this relation connects to (relation type's
   * `other_type_key`). Several relation types may reach the same card type, so
   * this is NOT a unique key — subtype options are keyed
   * `${relTypeKey}::${fieldKey}` and matched on `relation_type`, which keeps
   * each chip's colour exact. */
  relatedTypeKey: string;
  /** Direction-aware "uses · Usage Type" label. */
  comboLabel: string;
  /** Resolved (localised) options carried from the attribute schema. */
  options: FieldOption[];
}

export interface FilterState {
  attributeFilters: Record<string, string[]>;
  /** Keyed by CARD type (union across every relation reaching it) or by
   *  RELATION type — see the matcher. `relTypeKeys` tells the two apart. */
  relationFilters: Record<string, string[]>;
  /** Every known relation-type key, so a `relationFilters` entry can be read as
   *  a relation type rather than a card type. Absent = all keys are card types,
   *  which is how every pre-existing saved report behaves. */
  relTypeKeys?: ReadonlySet<string>;
  /** Keyed by RelSubtype.composite. */
  relSubtypeFilters: Record<string, string[]>;
  relSubtypes: RelSubtype[];
  /** The card's OWN subtype keys (not a relation attribute — that is
   *  `relSubtypeFilters`). Empty = no filter; `EMPTY_FILTER_KEY` matches a card
   *  with no subtype. */
  subtypeFilters: string[];
  /** The card's own facet fields (`pickSelectFields`). An `attributeFilters`
   *  key naming one is matched through the shared facet rule — so a boolean
   *  reads `"true"` / `"false"` and a multi-select matches any one value.
   *  Absent, or a key it does not name, keeps the plain scalar comparison. */
  facetFields?: FieldDef[];
  /** Text / number / date conditions by field key (`CardFilterValue.attrConditions`). */
  attrConditions?: Readonly<Record<string, unknown>>;
  /** The reader's catalog kinds (`catalogKinds`): a condition applies only on a
   *  field listed here with its shape's kind. Absent = no condition applies. */
  conditionKinds?: ReadonlyMap<string, FilterKind>;
  /** Flat list of selected tag ids (bucketed by group at filter time) */
  tagFilterIds: string[];
  tagGroups: TagGroupDef[];
  timelineDate: number;
  search: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

export const UNSET_COLOR = STATUS_COLORS.neutral;
export const DEFAULT_APP_COLOR = CARD_TYPE_COLORS.Application;
/** Neutral colour for a card whose matching relations carry differing
 * subtype values (the "Multiple" bucket). Owned by the shared facet helper. */
export { MULTIPLE_COLOR };

/** Color By option-key prefix that marks a relation-subtype selection,
 * distinguishing it from a card's own field key. */
export const REL_SUBTYPE_PREFIX = "rel:";

/* ------------------------------------------------------------------ */
/*  Schema helpers                                                    */
/* ------------------------------------------------------------------ */

/** The card's own fields that can colour and filter the report: selects with
 *  options and booleans (see `isFacetField`). */
export function pickSelectFields(schema: SectionDef[]): FieldDef[] {
  const out: FieldDef[] = [];
  for (const s of schema)
    for (const f of s.fields)
      if (isFacetField(f)) out.push(f);
  return out;
}

export function relSubtypeComposite(relTypeKey: string, fieldKey: string): string {
  return `${relTypeKey}::${fieldKey}`;
}

/** Find every (relation type, single_select attribute) pair for relation
 * types that touch `cardType`. The backend already filters/dedups the
 * relation_types payload to the requested card type, but we re-check the
 * endpoints here so the function is self-contained and testable. */
export function extractRelSubtypes(
  relationTypes: RelTypeDef[],
  cardType: string,
): { relType: RelTypeDef; field: FieldDef }[] {
  const out: { relType: RelTypeDef; field: FieldDef }[] = [];
  for (const rt of relationTypes) {
    if (rt.source_type_key !== cardType && rt.target_type_key !== cardType) continue;
    // Stryker disable next-line ArrayDeclaration: a string entry has no type and is skipped like none
    for (const f of rt.attributes_schema ?? []) {
      if (f.type === "single_select") out.push({ relType: rt, field: f });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Lifecycle helpers                                                 */
/* ------------------------------------------------------------------ */

// The rule itself lives in the leaf `@/lib/lifecycleAtDate` so card detail
// and the diagram can share it without importing a report feature; it is
// re-exported here so every existing import keeps resolving.
export {
  hasStartedByDate,
  isAliveAtDate,
  isRetiredByDate,
  parseDate,
  type Lifecycle,
} from "@/lib/lifecycleAtDate";

export function isAppAliveAtDate(app: AppData, dateMs: number): boolean {
  return isAliveAtDate(app.lifecycle, dateMs);
}

/* ------------------------------------------------------------------ */
/*  Colour resolution                                                 */
/* ------------------------------------------------------------------ */

export type ColorResolution =
  | { kind: "none" }
  | { kind: "field"; field: FieldDef }
  | { kind: "rel"; sub: RelSubtype };

export interface ColorLabels {
  notSet: string;
  multiple: string;
  /** A boolean field's two values. */
  yes: string;
  no: string;
}

export interface ColorBucket {
  /** Stable bucket id used to aggregate cards into stacked-bar segments. */
  key: string;
  color: string;
  label: string;
  isUnset: boolean;
}

/** Resolve a Color By selection (own field key or `rel:<composite>`) into a
 * descriptor. Returns `{ kind: "none" }` for an empty/unknown selection. */
export function resolveColorBy(
  colorBy: string,
  selectFields: FieldDef[],
  relSubtypes: RelSubtype[],
): ColorResolution {
  if (colorBy.startsWith(REL_SUBTYPE_PREFIX)) {
    const composite = colorBy.slice(REL_SUBTYPE_PREFIX.length);
    const sub = relSubtypes.find((s) => s.composite === composite);
    return sub ? { kind: "rel", sub } : { kind: "none" };
  }
  const field = selectFields.find((f) => f.key === colorBy);
  return field ? { kind: "field", field } : { kind: "none" };
}

/** Distinct, non-empty subtype values a card carries across its relations of
 * the given relation type. When `memberId` is provided, only relations to that
 * specific related card are considered — so a card grouped under one related
 * card resolves to the single value of *that* relation. */
function relSubtypeValues(app: AppData, sub: RelSubtype, memberId?: string): string[] {
  const values = new Set<string>();
  for (const r of app.relations) {
    if (r.relation_type !== sub.relTypeKey) continue;
    if (memberId !== undefined && r.related_id !== memberId) continue;
    const v = (r.attributes || {})[sub.fieldKey];
    if (typeof v === "string" && v !== "") values.add(v);
  }
  return [...values];
}

/** Resolve the colour/label bucket a single card falls into for the active
 * Color By. For relation subtypes: 0 values → unset, 1 value → that option,
 * ≥2 distinct values → the "Multiple" bucket. Pass `memberId` (the related
 * card the chip is grouped under) to colour by that single relation instead of
 * aggregating across all of the card's relations. */
export function appColorBucket(
  app: AppData,
  res: ColorResolution,
  labels: ColorLabels,
  memberId?: string,
): ColorBucket {
  if (res.kind === "none") {
    return { key: "__none__", color: DEFAULT_APP_COLOR, label: "", isUnset: false };
  }
  if (res.kind === "field") {
    const b = facetBucket(res.field, (app.attributes || {})[res.field.key], labels);
    return {
      key: b.key,
      color: b.color ?? UNSET_COLOR,
      label: b.label,
      isUnset: b.kind === "unset",
    };
  }
  const values = relSubtypeValues(app, res.sub, memberId);
  if (values.length === 0) {
    return { key: "__unset__", color: UNSET_COLOR, label: labels.notSet, isUnset: true };
  }
  if (values.length === 1) {
    const val = values[0];
    const opt = res.sub.options.find((o) => o.key === val);
    return { key: val, color: opt?.color || UNSET_COLOR, label: opt?.label || val, isUnset: false };
  }
  return { key: "__multiple__", color: MULTIPLE_COLOR, label: labels.multiple, isUnset: false };
}

export function getAppColor(
  app: AppData,
  res: ColorResolution,
  labels: ColorLabels,
  memberId?: string,
): string {
  return appColorBucket(app, res, labels, memberId).color;
}

export function getAppColorLabel(
  app: AppData,
  res: ColorResolution,
  labels: ColorLabels,
  memberId?: string,
): string | null {
  if (res.kind === "none") return null;
  const bucket = appColorBucket(app, res, labels, memberId);
  return bucket.isUnset ? null : bucket.label;
}

/** Aggregate a set of cards into stacked-bar colour segments. `memberId`
 * scopes relation-subtype colouring to a single related card (see
 * `appColorBucket`). */
export function buildColorSegments(
  apps: AppData[],
  res: ColorResolution,
  labels: ColorLabels,
  memberId?: string,
): { color: string; label: string; n: number }[] {
  if (res.kind === "none") return [];
  const counts = new Map<string, { color: string; label: string; n: number }>();
  for (const app of apps) {
    const b = appColorBucket(app, res, labels, memberId);
    if (!counts.has(b.key)) counts.set(b.key, { color: b.color, label: b.label, n: 0 });
    counts.get(b.key)!.n += 1;
  }
  return Array.from(counts.values());
}

/** The label a card's own attribute renders as in the report table: the
 * option label for a facet field (Yes / No for a boolean), the raw value(s)
 * for any other key, and `""` when the card has no value. Sorting compares
 * these, so the order matches what the reader sees — and a boolean value is
 * never handed to `localeCompare`. */
export function attributeLabel(
  app: AppData,
  key: string,
  fields: FieldDef[],
  labels: ColorLabels,
): string {
  const raw = (app.attributes || {})[key];
  const field = fields.find((f) => f.key === key);
  if (!field) return rawValues(raw).join(", ");
  const b = facetBucket(field, raw, labels);
  return b.kind === "unset" ? "" : b.label;
}

/** Build the colour legend swatches. For a relation subtype, append a
 * "Multiple" swatch only when at least one card actually carries differing
 * subtype values. */
export function buildColorLegend(
  res: ColorResolution,
  labels: ColorLabels,
  apps: AppData[],
): { label: string; color: string }[] | null {
  if (res.kind === "none") return null;
  if (res.kind === "field") {
    const field = res.field;
    if (!isFacetField(field)) return null;
    // Keyed only when a card on the report carries several values.
    const anyMultiple = apps.some((a) => appColorBucket(a, res, labels).key === MULTIPLE_KEY);
    return facetLegend(field, labels, anyMultiple).map(({ label, color }) => ({ label, color }));
  }
  const out = res.sub.options
    .filter((o) => o.color)
    .map((o) => ({ label: o.label, color: o.color! }));
  if (out.length === 0) return null;
  const hasMultiple = apps.some((a) => relSubtypeValues(a, res.sub).length >= 2);
  if (hasMultiple) out.push({ label: labels.multiple, color: MULTIPLE_COLOR });
  return out;
}

/* ------------------------------------------------------------------ */
/*  Filtering                                                         */
/* ------------------------------------------------------------------ */

/** Whether a card's relation to one specific related card (group member)
 * satisfies the active relation-subtype filters. Used to place a card under a
 * member only when *that* relationship matches — e.g. filtering "Owner" while
 * grouped by Organization shows an app under an org only if that org owns it,
 * not merely because some other org owns it. */
export function relationMemberMatchesSubtypeFilters(
  app: AppData,
  memberId: string,
  relSubtypeFilters: Record<string, string[]>,
  relSubtypes: RelSubtype[],
): boolean {
  for (const [composite, vals] of Object.entries(relSubtypeFilters)) {
    if (vals.length === 0) continue;
    const sub = relSubtypes.find((s) => s.composite === composite);
    if (!sub) continue;
    const rels = app.relations.filter(
      (r) => r.relation_type === sub.relTypeKey && r.related_id === memberId,
    );
    const wantEmpty = vals.includes(EMPTY_FILTER_KEY);
    const realVals = vals.filter((x) => x !== EMPTY_FILTER_KEY);
    const ok = rels.some((r) => {
      const v = (r.attributes || {})[sub.fieldKey];
      const empty = v === undefined || v === null || v === "";
      return (wantEmpty && empty) || realVals.includes(v as string);
    });
    if (!ok) return false;
  }
  return true;
}

/**
 * The card as it stands at `dateMs`: only the relations in effect then by
 * their own dates (`isAliveAtDate`, the one rule — `lib/relationLifecycle.ts`).
 * Everything a report places, groups, colours or filters by a RELATED card
 * reads `relations`, so projecting the card once is what makes an application
 * an organisation starts using in 2027 sit under that organisation from 2027,
 * while the card itself stays in the report throughout. A card with no dated
 * relation, or with none ended or planned at the date, is returned as the same
 * object.
 */
export function relationsAtDate<T extends { relations: AppRelation[] }>(
  app: T,
  dateMs: number,
): T {
  const relations = app.relations.filter((r) => isAliveAtDate(r.lifecycle, dateMs));
  return relations.length === app.relations.length ? app : { ...app, relations };
}

export function matchesFilters(app: AppData, filters: FilterState): boolean {
  if (!isAppAliveAtDate(app, filters.timelineDate)) return false;
  return matchesStaticFilters(app, filters);
}

/**
 * Every filter EXCEPT the timeline date. Split out so the timeline milestone
 * scope — which must stay stable while the slider is dragged — can be built
 * from the statically-filtered set without re-running per date change.
 */
export function matchesStaticFilters(
  app: AppData,
  filters: Omit<FilterState, "timelineDate">,
): boolean {
  // Card subtype filter (#1294). "(empty)" matches a card with no subtype; a
  // subtype key spelled like the sentinel is data, as with the filters below.
  if (filters.subtypeFilters.length > 0) {
    const realSubtypes = filters.subtypeFilters.filter((x) => x !== EMPTY_FILTER_KEY);
    const ok = app.subtype
      ? realSubtypes.includes(app.subtype)
      : filters.subtypeFilters.includes(EMPTY_FILTER_KEY);
    if (!ok) return false;
  }
  // Attribute filters
  const attrs = app.attributes || {};
  for (const [key, vals] of Object.entries(filters.attributeFilters)) {
    if (vals.length === 0) continue;
    const facet = filters.facetFields?.find((f) => f.key === key);
    if (facet) {
      if (matchesFacet(facet, attrs[key], vals, EMPTY_FILTER_KEY)) continue;
      return false;
    }
    const v = attrs[key] as string | undefined;
    const isEmpty = v === undefined || v === null || v === "";
    const wantEmpty = vals.includes(EMPTY_FILTER_KEY);
    const realVals = vals.filter((x) => x !== EMPTY_FILTER_KEY);
    if (wantEmpty && isEmpty) continue;
    if (realVals.includes(v as string)) continue;
    return false;
  }
  // Text / number / date conditions: the rule lives in `lib/fieldFilters.ts`.
  if (!matchesConditions(attrs, filters.attrConditions, filters.conditionKinds)) return false;
  // Relation filters. A key is a CARD type ("related to an Organization at
  // all") or a RELATION type ("owned by an Organization"), so that several
  // relation types reaching one card type can be filtered apart. Card-type keys
  // are what every existing saved report carries and keep meaning the union.
  for (const [key, ids] of Object.entries(filters.relationFilters)) {
    if (ids.length === 0) continue;
    const byRelType = filters.relTypeKeys?.has(key) ?? false;
    const appRels = app.relations.filter((r) =>
      byRelType ? relationOnSide(r, key) : r.related_type === key,
    );
    const wantEmpty = ids.includes(EMPTY_FILTER_KEY);
    const realIds = ids.filter((x) => x !== EMPTY_FILTER_KEY);
    if (wantEmpty && appRels.length === 0) continue;
    if (appRels.some((r) => realIds.includes(r.related_id))) continue;
    return false;
  }
  // Relation-subtype filters — a card matches if it has at least one relation
  // of the type whose subtype value is selected. EMPTY matches a relation of
  // that type whose subtype value is missing (not "card has no such relation").
  for (const [composite, vals] of Object.entries(filters.relSubtypeFilters)) {
    if (vals.length === 0) continue;
    const sub = filters.relSubtypes.find((s) => s.composite === composite);
    if (!sub) continue;
    const rels = app.relations.filter((r) => r.relation_type === sub.relTypeKey);
    const wantEmpty = vals.includes(EMPTY_FILTER_KEY);
    const realVals = vals.filter((x) => x !== EMPTY_FILTER_KEY);
    const matchesEmpty =
      wantEmpty &&
      rels.some((r) => {
        const v = (r.attributes || {})[sub.fieldKey];
        return v === undefined || v === null || v === "";
      });
    const matchesReal = rels.some((r) =>
      realVals.includes((r.attributes || {})[sub.fieldKey] as string),
    );
    if (matchesEmpty || matchesReal) continue;
    return false;
  }
  // Tag filters (OR within a group, AND across groups) — bucket the flat
  // selection by tag_group_id before matching. With nothing selected no group
  // has a pick, so every group is skipped.
  const appTagIds = new Set(app.tag_ids);
  const selectedSet = new Set(filters.tagFilterIds);
  for (const group of filters.tagGroups) {
    const pickedInGroup = group.tags
      .filter((tag) => selectedSet.has(tag.id))
      .map((tag) => tag.id);
    if (pickedInGroup.length === 0) continue;
    if (!pickedInGroup.some((id) => appTagIds.has(id))) return false;
  }
  if (
    filters.search &&
    !app.name.toLowerCase().includes(filters.search.toLowerCase())
  )
    return false;
  return true;
}
