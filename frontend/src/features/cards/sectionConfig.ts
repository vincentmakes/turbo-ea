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
 * A stored `__order` wins. Custom sections it does not name go at its end;
 * `successors` and `tags`, which postdate the orders of existing installs,
 * are spliced in just before `relations` (or appended when there is none);
 * `hierarchy` and `successors` drop out for a type that has no such section.
 * With no stored order, `DEFAULT_SECTION_ORDER` applies.
 */
export function buildSectionOrder(
  sectionConfig: Record<string, unknown> | undefined,
  customCount: number,
  has: { hierarchy: boolean; successors: boolean },
): string[] {
  const customKeys = Array.from({ length: customCount }, (_, i) => `custom:${i}`);
  const stored = sectionConfig?.__order;
  if (Array.isArray(stored) && stored.length > 0) {
    const named = new Set<string>(stored);
    const order: string[] = [...stored];
    for (const k of customKeys) if (!named.has(k)) order.push(k);
    const beforeRelations = (key: string) => {
      const at = order.indexOf("relations");
      if (at >= 0) order.splice(at, 0, key);
      else order.push(key);
    };
    if (!named.has("successors") && has.successors) beforeRelations("successors");
    if (!named.has("tags")) beforeRelations("tags");
    return order.filter(
      (k) => (k !== "hierarchy" || has.hierarchy) && (k !== "successors" || has.successors),
    );
  }
  return DEFAULT_SECTION_ORDER.flatMap((key) => {
    if (key === "__custom__") return customKeys;
    if (key === "hierarchy" && !has.hierarchy) return [];
    if (key === "successors" && !has.successors) return [];
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
