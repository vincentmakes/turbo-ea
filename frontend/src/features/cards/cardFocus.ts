/**
 * Where the card side panel opens a card when its caller asks for a place
 * (`CardPanelFocus`, UI SDK 1.37): an extension page that lists what a card
 * still lacks can open the panel on the field, section or relation group to
 * fill — the jump the data-quality breakdown makes on the full card page.
 *
 * The anchors come from the same builders `jumpTargetFor` uses, so a field
 * asked for here lands exactly where its data-quality row would.
 */
import type { CardPanelFocus, CardType, RelationType } from "@/types";
import {
  fieldJumpTarget,
  relationJumpTarget,
  sectionJumpTarget,
  type BuiltInSectionKey,
  type CardJumpTarget,
} from "./dataQualityJump";

const SECTIONS: readonly BuiltInSectionKey[] = [
  "description",
  "lifecycle",
  "tags",
  "relations",
  "hierarchy",
];

function isSection(value: unknown): value is BuiltInSectionKey {
  return typeof value === "string" && (SECTIONS as readonly string[]).includes(value);
}

/**
 * A focus as a comparable string — equal for two equal focuses whatever their
 * identity or key order, `null` for no focus (or one that names nothing).
 * Callers pass a fresh object literal on every render; this is what lets the
 * panel tell a new place from the same one asked again.
 */
export function cardFocusKey(focus: CardPanelFocus | null | undefined): string | null {
  if (!focus || typeof focus !== "object") return null;
  const field = typeof focus.field === "string" && focus.field ? focus.field : null;
  const section = isSection(focus.section) ? focus.section : null;
  const rel = focus.relation;
  const relation =
    rel && typeof rel === "object" && typeof rel.type === "string" && rel.type
      ? [rel.type, rel.side === "source" || rel.side === "target" ? rel.side : null]
      : null;
  if (field === null && section === null && relation === null) return null;
  return JSON.stringify([field, relation, section]);
}

/**
 * Resolves a focus against the card's type: the field's section from its
 * `fields_schema`, a relation type that has the card's type at the end asked
 * for — or, with no `side`, at whichever end it is on (`source` when it is on
 * both) — or a built-in section. `field` is tried first, then `relation`, then
 * `section`; the first that resolves wins, and `null` (nothing resolves, or
 * the type is not loaded) opens the card as usual. Never throws.
 */
export function resolveCardFocus(
  focus: CardPanelFocus | null | undefined,
  type: CardType | null | undefined,
  relationTypes: readonly RelationType[] | null | undefined,
): CardJumpTarget | null {
  if (!focus || typeof focus !== "object" || !type) return null;

  const fieldKey = focus.field;
  if (typeof fieldKey === "string" && fieldKey) {
    const section = (type.fields_schema ?? []).find((s) =>
      (s.fields ?? []).some((f) => f.key === fieldKey),
    );
    if (section) return fieldJumpTarget(fieldKey, section.section);
  }

  const rel = focus.relation;
  if (rel && typeof rel === "object" && typeof rel.type === "string" && rel.type) {
    const rt = (relationTypes ?? []).find((r) => r.key === rel.type);
    if (rt) {
      const onSource = rt.source_type_key === type.key;
      const onTarget = rt.target_type_key === type.key;
      const asked = rel.side === "source" || rel.side === "target" ? rel.side : null;
      const side = asked ?? (onSource ? "source" : onTarget ? "target" : null);
      if (side === "source" ? onSource : side === "target" && onTarget) {
        return relationJumpTarget(rel.type, side);
      }
    }
  }

  if (isSection(focus.section)) return sectionJumpTarget(focus.section);
  return null;
}
