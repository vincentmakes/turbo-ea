import type { SectionConfig, SectionDef } from "@/types";

/**
 * Reader over a card type's `section_config` (the metamodel JSONB that drives
 * card-detail section order, visibility and default expansion).
 *
 * Two subtleties this centralises, both of which were previously bugs:
 *
 * 1. **An explicit `true` must win.** The original test was
 *    `cfg?.defaultExpanded !== false ? fallback : false`, which only recognised
 *    an explicit `false` and folded an explicit `true` back into the fallback.
 *    Relations is the one section whose fallback is "collapsed", so a stored
 *    `defaultExpanded: true` was discarded and it could never be expanded from
 *    the metamodel. `fallback` must apply only when nothing is configured.
 *
 * 2. **Legacy custom-section keys.** Custom sections are keyed `custom:N`, but
 *    installs predating that scheme stored them under the section *label*. The
 *    Card Layout editor still reads both, so the renderer must too — otherwise
 *    the admin saves a setting that silently does nothing on the card.
 */
export interface SectionConfigReader {
  /**
   * The stored expansion setting: `true` / `false` when the admin configured
   * this section, `undefined` when they never touched it. Callers with a
   * smarter default than a plain boolean (the EOL section auto-expands only
   * when a product is linked) need to tell those two cases apart.
   */
  raw: (key: string) => boolean | undefined;
  /** Whether the section should start expanded; `fallback` applies only when unconfigured. */
  expanded: (key: string, fallback?: boolean) => boolean;
  /** Whether the section is hidden from card detail entirely. */
  hidden: (key: string) => boolean;
}

/**
 * Whether a section starts expanded when the metamodel says nothing about it.
 *
 * Relations is deliberately collapsed by default — it is the longest section
 * and its descendant roll-up fetch is deferred until it opens. Everything else
 * defaults to expanded.
 *
 * The Card Layout editor's "collapsed by default" switch and the card-detail
 * renderer MUST both resolve through here. While only the renderer knew about
 * the Relations default, the switch read OFF ("not collapsed") on a section the
 * card rendered collapsed, and it took two clicks to reach a matching state.
 */
export const SECTION_DEFAULT_EXPANDED: Record<string, boolean> = { relations: false };

export function sectionDefaultExpanded(key: string): boolean {
  return SECTION_DEFAULT_EXPANDED[key] ?? true;
}

/**
 * Effective "starts collapsed" state for a section — exactly what the Card
 * Layout editor's switch must show, and the inverse of what the renderer will
 * do. `??` (not `||`) so an explicitly stored `false` is preserved.
 */
export function isSectionCollapsedByDefault(
  cfg: SectionConfig | undefined,
  key: string,
): boolean {
  return !(cfg?.defaultExpanded ?? sectionDefaultExpanded(key));
}

export function makeSectionConfigReader(
  sc: Record<string, SectionConfig> | undefined,
  customSections: SectionDef[],
): SectionConfigReader {
  const cfg = (key: string): SectionConfig | undefined => {
    const direct = sc?.[key];
    if (direct) return direct;
    if (key.startsWith("custom:")) {
      const label = customSections[parseInt(key.split(":")[1], 10)]?.section;
      if (label) return sc?.[label];
    }
    return undefined;
  };

  const raw = (key: string) => cfg(key)?.defaultExpanded;

  return {
    raw,
    expanded: (key: string, fallback = true) => {
      const v = raw(key);
      return typeof v === "boolean" ? v : fallback;
    },
    hidden: (key: string) => !!cfg(key)?.hidden,
  };
}

/** A type's custom attribute sections: every section but `__description`. */
export function customSectionsOf(fieldsSchema: SectionDef[] | undefined): SectionDef[] {
  return (fieldsSchema ?? []).filter((s) => s.section !== "__description");
}

/** The built-in order for a type that never stored `section_config.__order`. */
export const DEFAULT_SECTION_ORDER = [
  "description",
  "eol",
  "lifecycle",
  "costs",
  "licensing",
  "__custom__",
  "hierarchy",
  "successors",
  "tags",
  "relations",
] as const;

/**
 * The order card detail renders a type's sections in — and the order the
 * Card Layout editor lists them in. One function for both, so the editor
 * cannot show an admin an order the card does not render.
 *
 * A stored `__order` wins. `eol` missing from it (an order imported or written
 * by an extension) is spliced in before `lifecycle`, else after
 * `description`, else before `relations`: every type can now turn End of Life
 * on, and a section absent from the order could be neither shown nor toggled.
 * Custom sections it does not name go at its end;
 * `successors` and `tags`, which postdate the orders of existing installs,
 * are spliced in just before `relations` (or appended when there is none);
 * `hierarchy` and `successors` drop out for a type that has no such section;
 * `costs` (cost-item types only) is spliced in after `lifecycle` when the stored
 * order predates it, and drops out for every other type. `licensing` (license
 * types only) is spliced in after `costs` (else after `lifecycle`) the same way.
 * With no stored order, `DEFAULT_SECTION_ORDER` applies.
 */
export function buildSectionOrder(
  sectionConfig: Record<string, unknown> | undefined,
  customCount: number,
  has: { hierarchy: boolean; successors: boolean; costs?: boolean; licensing?: boolean },
): string[] {
  const customKeys = Array.from({ length: customCount }, (_, i) => `custom:${i}`);
  const stored = sectionConfig?.__order;
  if (Array.isArray(stored) && stored.length > 0) {
    const named = new Set<string>(stored);
    const order: string[] = [...stored];
    const beforeRelations = (key: string) => {
      const at = order.indexOf("relations");
      if (at >= 0) order.splice(at, 0, key);
      else order.push(key);
    };
    if (!named.has("eol")) {
      const lifecycleAt = order.indexOf("lifecycle");
      const descriptionAt = order.indexOf("description");
      if (lifecycleAt >= 0) order.splice(lifecycleAt, 0, "eol");
      else if (descriptionAt >= 0) order.splice(descriptionAt + 1, 0, "eol");
      else beforeRelations("eol");
    }
    for (const k of customKeys) if (!named.has(k)) order.push(k);
    if (!named.has("successors") && has.successors) beforeRelations("successors");
    if (!named.has("tags")) beforeRelations("tags");
    if (has.costs && !named.has("costs")) {
      const at = order.indexOf("lifecycle");
      order.splice(at >= 0 ? at + 1 : 0, 0, "costs");
    }
    if (has.licensing && !named.has("licensing")) {
      const at = order.includes("costs") ? order.indexOf("costs") : order.indexOf("lifecycle");
      order.splice(at >= 0 ? at + 1 : 0, 0, "licensing");
    }
    return order.filter(
      (k) =>
        (k !== "hierarchy" || has.hierarchy) &&
        (k !== "successors" || has.successors) &&
        (k !== "costs" || has.costs) &&
        (k !== "licensing" || has.licensing),
    );
  }
  return DEFAULT_SECTION_ORDER.flatMap((key) => {
    if (key === "__custom__") return customKeys;
    if (key === "hierarchy" && !has.hierarchy) return [];
    if (key === "successors" && !has.successors) return [];
    if (key === "costs" && !has.costs) return [];
    if (key === "licensing" && !has.licensing) return [];
    return [key];
  });
}

/**
 * Fields hidden on this card: the active subtype's `hidden_fields`, plus the
 * keys each extension field-visibility provider currently registered has
 * reported. A report from an extension no longer registered is ignored.
 */
export function hiddenFieldKeys(
  subtypes: { key: string; hidden_fields?: string[] }[] | undefined,
  subtype: string | null | undefined,
  reportedByExtension: Record<string, string[]>,
  activeExtensions: Iterable<string>,
): Set<string> {
  const hidden = new Set<string>();
  if (subtype) {
    for (const k of subtypes?.find((s) => s.key === subtype)?.hidden_fields ?? []) hidden.add(k);
  }
  const active = new Set(activeExtensions);
  for (const [extKey, keys] of Object.entries(reportedByExtension)) {
    if (active.has(extKey)) for (const k of keys) hidden.add(k);
  }
  return hidden;
}

/** A section none of whose fields would show; a section with no fields is never "all hidden". */
export function allFieldsHidden(section: SectionDef, hidden: Set<string>): boolean {
  return section.fields.length > 0 && section.fields.every((f) => hidden.has(f.key));
}

const INITIATIVE_COST_FIELDS = ["costBudget", "costActual"];
const INITIATIVE_DATE_FIELDS = ["startDate", "actualStart", "endDate", "actualEnd"];

export function initiativeSummaryGroups(section: SectionDef, cost: string, timeline: string): SectionDef {
  if (section.section !== "Cost & Timeline") return section;
  return {
    ...section,
    fields: section.fields.map((field) => {
      if (field.group) return field;
      if (INITIATIVE_COST_FIELDS.includes(field.key)) return { ...field, group: cost };
      if (INITIATIVE_DATE_FIELDS.includes(field.key)) return { ...field, group: timeline };
      return field;
    }),
  };
}

export function initiativeSummaryAnchors(sections: SectionDef[], hidden: Set<string>) {
  const keys = new Set(sections.flatMap((section) => section.fields.map((field) => field.key)));
  const visible = (key: string) => keys.has(key) && !hidden.has(key);
  const timelineFields = sections.filter((section) =>
    section.section === "Cost & Timeline" || section.fields.some((field) => INITIATIVE_DATE_FIELDS.includes(field.key)),
  ).flatMap((section) => section.fields);
  return {
    financial: INITIATIVE_COST_FIELDS.every(visible) ? "costActual" : undefined,
    schedule: [...INITIATIVE_DATE_FIELDS].reverse().find(visible)
      ?? timelineFields.find((field) => field.type === "date" && visible(field.key))?.key,
  };
}

/**
 * Field keys rendered read-only with a "calc" badge: the calculated fields of
 * the type, then the auto-computed ones (PPM's cost roll-ups) not already
 * among them.
 */
export function calculatedFieldKeys(
  fieldsSchema: SectionDef[] | undefined,
  isCalculated: (fieldKey: string) => boolean,
  autoFieldKeys: readonly string[],
): string[] {
  const keys: string[] = [];
  for (const section of fieldsSchema ?? []) {
    for (const field of section.fields ?? []) {
      if (isCalculated(field.key)) keys.push(field.key);
    }
  }
  return [...new Set([...keys, ...autoFieldKeys])];
}
