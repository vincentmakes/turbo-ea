/**
 * The public portal's display rules, as plain functions: which fields and
 * relation types the portal's administrator made visible on a tile or in the
 * detail panel, the card query a filter set sends, how a relation filter is
 * named, which relations a tile and the detail panel show, and how the detail
 * panel groups them.
 *
 * `PortalViewer.tsx` renders; this decides. Nothing here touches React or the
 * network, so each rule is unit-tested on its own (`portalViewerState.test.ts`).
 */
import type { FieldDef, PortalCard, PortalRelationType, PublicPortal } from "@/types";

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
  /** Select fields with options, shown somewhere: the attribute filters on offer. */
  filterable: FieldDef[];
}

export function portalFields(portal: PublicPortal | null): PortalFields {
  const all = portal?.type_info?.fields_schema?.flatMap((s) => s.fields) ?? [];
  const toggles = portalToggles(portal);
  const card = all.filter((f, idx) => isVisible(toggles, `field:${f.key}`, "card", idx < 3));
  // Stryker disable next-line StringLiteral: isVisible reads any mode but "card" as the detail panel
  const detail = all.filter((f) => isVisible(toggles, `field:${f.key}`, "detail", true));
  const filterable = all.filter(
    (f) =>
      (f.type === "single_select" || f.type === "multiple_select") &&
      (f.options ?? []).length > 0 &&
      (card.includes(f) || detail.includes(f)),
  );
  return { all, card, detail, filterable };
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
/*  The card query                                                     */
/* ------------------------------------------------------------------ */

export interface CardQuery {
  search: string;
  subtype: string;
  attrFilters: Record<string, string>;
  relationFilters: Record<string, string>;
  tagFilter: string[];
  page: number;
  pageSize: number;
  sortBy: string;
  sortDir: string;
}

/** The set entries of a filter map; an emptied dropdown leaves "" behind. */
function setFilters(filters: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== ""));
}

/** The query string for a page of cards; an unset filter is left out entirely. */
export function cardQueryParams(q: CardQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set("search", q.search);
  if (q.subtype) params.set("subtype", q.subtype);
  const attrs = setFilters(q.attrFilters);
  if (Object.keys(attrs).length > 0) params.set("attr_filters", JSON.stringify(attrs));
  const rels = setFilters(q.relationFilters);
  if (Object.keys(rels).length > 0) params.set("relation_filters", JSON.stringify(rels));
  if (q.tagFilter.length > 0) params.set("tag_ids", q.tagFilter.join(","));
  params.set("page", String(q.page));
  params.set("page_size", String(q.pageSize));
  params.set("sort_by", q.sortBy);
  params.set("sort_dir", q.sortDir);
  return params.toString();
}

/** Whether any filter beyond the search is set — what the Clear button and the filter dot follow. */
export function hasActiveFilters(
  q: Pick<CardQuery, "subtype" | "attrFilters" | "relationFilters" | "tagFilter">,
): boolean {
  return (
    q.subtype !== "" ||
    Object.values(q.attrFilters).some((v) => v !== "") ||
    Object.values(q.relationFilters).some((v) => v !== "") ||
    q.tagFilter.length > 0
  );
}
