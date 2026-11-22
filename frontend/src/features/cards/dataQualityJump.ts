/**
 * Where on the card page a data-quality gap is filled (#1334).
 *
 * The data-quality breakdown lists every unmet slot; each row jumps to the
 * section that fills it. The sections carry these ids on their accordion
 * roots, and `CardDetailContent` opens the tab, expands the section and
 * scrolls the anchor into view. For a user who may edit it, the section also
 * opens in edit mode on the slot (`SectionEditRequest`, `useEditRequest`).
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

/** Which end of a relation type the card is on. */
export type RelationSideName = "source" | "target";

/** A tab with nothing to scroll to, or a Card-tab anchor. For a relation
 * group `anchor` is the group and `sectionAnchor` the Relations section, which
 * is expanded and is the fallback when the group is not rendered; otherwise
 * the two are the same.
 *
 * The optional keys say what to edit once there, so the section can open in
 * edit mode on the right control: the field to focus, the tag group, or the
 * relation type and side whose Add dialog to open. */
export type DataQualityJumpTarget =
  | { tab: "stakeholders" }
  | {
      tab: "card";
      anchor: string;
      sectionAnchor: string;
      fieldKey?: string;
      tagGroupId?: string;
      relation?: { type: string; side: RelationSideName };
    };

/**
 * A data-quality jump asking a Card-tab section to open for editing
 * (`CardDetailContent`'s `editOn(anchor)`): one object per jump, carrying the
 * jump's nonce and what to edit. Sections act on it through `useEditRequest`.
 */
export interface SectionEditRequest {
  /** The section it is meant for: its `sectionAnchor`. */
  anchor: string;
  nonce: number;
  fieldKey?: string;
  tagGroupId?: string;
  relation?: { type: string; side: RelationSideName };
}

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

export function relationGroupAnchor(rtKey: string, side: RelationSideName): string {
  return `card-relation-${rtKey}-${side}`;
}

export type CardJumpTarget = Extract<DataQualityJumpTarget, { tab: "card" }>;

function onCard(anchor: string): CardJumpTarget {
  return { tab: "card", anchor, sectionAnchor: anchor };
}

/** A built-in section of the Card tab, with nothing in it to single out. */
export function sectionJumpTarget(key: BuiltInSectionKey): CardJumpTarget {
  return onCard(sectionAnchor(key));
}

/** A field, in the section that renders it: its attribute section, or the
 * Description section for a field of the `__description` section. */
export function fieldJumpTarget(
  fieldKey: string,
  section: string | null | undefined,
): CardJumpTarget {
  const anchor =
    section === "__description" ? sectionAnchor("description") : customSectionAnchor(section ?? "");
  return { ...onCard(anchor), fieldKey };
}

/** A relation group, falling back to the Relations section; `source` by default. */
export function relationJumpTarget(
  type: string,
  side: RelationSideName | null | undefined,
): CardJumpTarget {
  const end = side ?? "source";
  return {
    tab: "card",
    anchor: relationGroupAnchor(type, end),
    sectionAnchor: sectionAnchor("relations"),
    relation: { type, side: end },
  };
}

export function jumpTargetFor(f: DataQualityFactor): DataQualityJumpTarget {
  switch (f.kind) {
    case "field":
      return fieldJumpTarget(f.key, f.section);
    case "description":
      return sectionJumpTarget("description");
    case "lifecycle":
      return sectionJumpTarget("lifecycle");
    case "tag_group":
      return { ...sectionJumpTarget("tags"), tagGroupId: f.key };
    case "relation":
      return relationJumpTarget(f.key, f.side);
    case "stakeholders":
      return { tab: "stakeholders" };
  }
}
