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

/** A tab with nothing to scroll to, or a Card-tab anchor. For a relation
 * group `anchor` is the group and `sectionAnchor` the Relations section, which
 * is expanded and is the fallback when the group is not rendered; otherwise
 * the two are the same. */
export type DataQualityJumpTarget =
  | { tab: "stakeholders" }
  | { tab: "card"; anchor: string; sectionAnchor: string };

export type BuiltInSectionKey = "description" | "lifecycle" | "tags" | "relations";

export function sectionAnchor(key: BuiltInSectionKey): string {
  return `card-section-${key}`;
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
