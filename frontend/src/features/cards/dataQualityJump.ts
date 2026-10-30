/**
 * Where on the card page a data-quality gap is filled (#1334).
 *
 * The data-quality popover lists every unmet slot; each row jumps to the
 * section that fills it. The sections carry these ids on their accordion
 * roots, and `CardDetailContent` opens the tab, expands the section and
 * scrolls the anchor into view.
 */
import type { DataQualityFactor } from "@/types";

/** Clearance above a scrolled-to section, so the app bar does not cover it. */
export const SECTION_SCROLL_MARGIN_TOP = 72;

/**
 * The CSS custom property a page may set on its root to widen that clearance:
 * the card page sets it while TurboRPG mode is on, because the sticky score
 * bar sits under the app bar and a section scrolled flush under the bar would
 * be covered. Every section's `scroll-margin-top` reads it, falling back to
 * `SECTION_SCROLL_MARGIN_TOP`.
 */
export const SECTION_SCROLL_MARGIN_VAR = "--card-section-scroll-margin";

/** The `scroll-margin-top` value every jump target carries. */
export const SECTION_SCROLL_MARGIN = `var(${SECTION_SCROLL_MARGIN_VAR}, ${SECTION_SCROLL_MARGIN_TOP}px)`;

/** A tab with nothing to scroll to, or a Card-tab anchor. For a relation
 * group `anchor` is the group and `sectionAnchor` the Relations section, which
 * is expanded and is the fallback when the group is not rendered; otherwise
 * the two are the same. */
export type DataQualityJumpTarget =
  | { tab: "stakeholders" }
  | { tab: "card"; anchor: string; sectionAnchor: string };

export type BuiltInSectionKey = "description" | "lifecycle" | "tags" | "relations" | "hierarchy";

export function sectionAnchor(key: BuiltInSectionKey): string {
  return `card-section-${key}`;
}

/** A card tab's panel id: where a save made in that tab (Stakeholders) came from. */
export function tabAnchor(key: "stakeholders"): string {
  return `card-tab-${key}`;
}

/** An attribute section's id: its name, with every run of characters outside
 * `[A-Za-z0-9_-]` turned into one `-`, lower-cased. */
export function customSectionAnchor(sectionName: string): string {
  const slug = sectionName.replace(/[^A-Za-z0-9_-]+/g, "-").toLowerCase();
  return `card-section-custom-${slug}`;
}

export function relationGroupAnchor(rtKey: string, side: "source" | "target"): string {
  return `card-relation-${rtKey}-${side}`;
}

function onCard(anchor: string): DataQualityJumpTarget {
  return { tab: "card", anchor, sectionAnchor: anchor };
}

export function jumpTargetFor(f: DataQualityFactor): DataQualityJumpTarget {
  switch (f.kind) {
    case "field":
      // Fields of the `__description` section render inside the Description section.
      return f.section === "__description"
        ? onCard(sectionAnchor("description"))
        : onCard(customSectionAnchor(f.section ?? ""));
    case "description":
      return onCard(sectionAnchor("description"));
    case "lifecycle":
      return onCard(sectionAnchor("lifecycle"));
    case "tag_group":
      return onCard(sectionAnchor("tags"));
    case "relation":
      return {
        tab: "card",
        anchor: relationGroupAnchor(f.key, f.side ?? "source"),
        sectionAnchor: sectionAnchor("relations"),
      };
    case "stakeholders":
      return { tab: "stakeholders" };
  }
}
