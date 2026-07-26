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
