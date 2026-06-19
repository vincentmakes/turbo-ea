/* ------------------------------------------------------------------ */
/*  Pure helpers for the App / Flexible Portfolio reports.            */
/*                                                                    */
/*  Extracted from PortfolioReport.tsx so the colour-resolution,      */
/*  relation-subtype, and filter-matching logic can be unit-tested    */
/*  without rendering the (very large) report component.              */
/* ------------------------------------------------------------------ */

import { EMPTY_FILTER_KEY } from "@/components/FilterSelect";

/* ------------------------------------------------------------------ */
/*  Data shapes                                                       */
/* ------------------------------------------------------------------ */

export interface AppRelation {
  relation_type: string;
  related_id: string;
  related_name: string;
  related_type: string;
  /** Relation attribute values keyed by attribute field key, e.g.
   * `{ usageType: "owner" }`. Drives the relation-subtype colour/filters. */
  attributes?: Record<string, unknown>;
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
   * `other_type_key`). The portfolio only offers a subtype while grouping by
   * this type, so each card chip maps to exactly one related card. */
  relatedTypeKey: string;
  /** Direction-aware "uses · Usage Type" label. */
  comboLabel: string;
  /** Resolved (localised) options carried from the attribute schema. */
  options: FieldOption[];
}

export interface FilterState {
  attributeFilters: Record<string, string[]>;
  relationFilters: Record<string, string[]>;
  /** Keyed by RelSubtype.composite. */
  relSubtypeFilters: Record<string, string[]>;
  relSubtypes: RelSubtype[];
  /** Flat list of selected tag ids (bucketed by group at filter time) */
  tagFilterIds: string[];
  tagGroups: TagGroupDef[];
  timelineDate: number;
  search: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

export const UNSET_COLOR = "#9e9e9e";
export const DEFAULT_APP_COLOR = "#0f7eb5";
/** Neutral colour for a card whose matching relations carry differing
 * subtype values (the "Multiple" bucket). */
export const MULTIPLE_COLOR = "#607d8b";

/** Color By option-key prefix that marks a relation-subtype selection,
 * distinguishing it from a card's own field key. */
export const REL_SUBTYPE_PREFIX = "rel:";

export const LIFECYCLE_PHASES = ["plan", "phaseIn", "active", "phaseOut", "endOfLife"];

/* ------------------------------------------------------------------ */
/*  Schema helpers                                                    */
/* ------------------------------------------------------------------ */

export function pickSelectFields(schema: SectionDef[]): FieldDef[] {
  const out: FieldDef[] = [];
  for (const s of schema)
    for (const f of s.fields)
      if (f.type === "single_select") out.push(f);
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
    for (const f of rt.attributes_schema ?? []) {
      if (f.type === "single_select") out.push({ relType: rt, field: f });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Lifecycle helpers                                                 */
/* ------------------------------------------------------------------ */

export function parseDate(s: string | undefined): number | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.getTime();
}

export function isAppAliveAtDate(app: AppData, dateMs: number): boolean {
  const lc = app.lifecycle;
  if (!lc) return true;
  const dates = LIFECYCLE_PHASES.map((p) => parseDate(lc[p])).filter(
    (d): d is number => d != null,
  );
  if (dates.length === 0) return true;
  if (Math.min(...dates) > dateMs) return false;
  const eol = parseDate(lc.endOfLife);
  if (eol != null && eol <= dateMs) return false;
  return true;
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
  if (!colorBy) return { kind: "none" };
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
    const val = (app.attributes || {})[res.field.key] as string | undefined;
    if (!val) return { key: "__unset__", color: UNSET_COLOR, label: labels.notSet, isUnset: true };
    const opt = res.field.options?.find((o) => o.key === val);
    return { key: val, color: opt?.color || UNSET_COLOR, label: opt?.label || val, isUnset: false };
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
  if (res.kind === "none" || apps.length === 0) return [];
  const counts = new Map<string, { color: string; label: string; n: number }>();
  for (const app of apps) {
    const b = appColorBucket(app, res, labels, memberId);
    if (!counts.has(b.key)) counts.set(b.key, { color: b.color, label: b.label, n: 0 });
    counts.get(b.key)!.n += 1;
  }
  return Array.from(counts.values()).filter((s) => s.n > 0);
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
    if (!res.field.options) return null;
    return res.field.options
      .filter((o) => o.color)
      .map((o) => ({ label: o.label, color: o.color! }));
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
      return (wantEmpty && empty) || (typeof v === "string" && realVals.includes(v));
    });
    if (!ok) return false;
  }
  return true;
}

export function matchesFilters(app: AppData, filters: FilterState): boolean {
  if (!isAppAliveAtDate(app, filters.timelineDate)) return false;
  // Attribute filters
  const attrs = app.attributes || {};
  for (const [key, vals] of Object.entries(filters.attributeFilters)) {
    if (vals.length === 0) continue;
    const v = attrs[key] as string | undefined;
    const isEmpty = v === undefined || v === null || v === "";
    const wantEmpty = vals.includes(EMPTY_FILTER_KEY);
    const realVals = vals.filter((x) => x !== EMPTY_FILTER_KEY);
    if (wantEmpty && isEmpty) continue;
    if (realVals.length > 0 && realVals.includes(v as string)) continue;
    return false;
  }
  // Relation filters (e.g. Organization, Platform, etc.)
  for (const [typeKey, ids] of Object.entries(filters.relationFilters)) {
    if (ids.length === 0) continue;
    const appRels = app.relations.filter((r) => r.related_type === typeKey);
    const wantEmpty = ids.includes(EMPTY_FILTER_KEY);
    const realIds = ids.filter((x) => x !== EMPTY_FILTER_KEY);
    if (wantEmpty && appRels.length === 0) continue;
    if (realIds.length > 0 && appRels.some((r) => realIds.includes(r.related_id))) continue;
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
    const matchesReal =
      realVals.length > 0 &&
      rels.some((r) => {
        const v = (r.attributes || {})[sub.fieldKey];
        return typeof v === "string" && realVals.includes(v);
      });
    if (matchesEmpty || matchesReal) continue;
    return false;
  }
  // Tag filters (OR within a group, AND across groups) — bucket the flat
  // selection by tag_group_id before matching.
  if (filters.tagFilterIds.length > 0) {
    const appTagIds = new Set(app.tag_ids || []);
    const selectedSet = new Set(filters.tagFilterIds);
    for (const group of filters.tagGroups) {
      const pickedInGroup = group.tags
        .filter((tag) => selectedSet.has(tag.id))
        .map((tag) => tag.id);
      if (pickedInGroup.length === 0) continue;
      if (!pickedInGroup.some((id) => appTagIds.has(id))) return false;
    }
  }
  if (
    filters.search &&
    !app.name.toLowerCase().includes(filters.search.toLowerCase())
  )
    return false;
  return true;
}
