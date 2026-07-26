/**
 * Grouping + ordering helpers for a risk's affected (linked) cards.
 *
 * A risk can link any number of cards across any number of types. Rendered
 * flat and unsorted they carry no structure; grouped by card type, ordered by
 * the metamodel's own type order and alphabetised within each group, the same
 * list becomes scannable (discussion #876).
 *
 * Pure on purpose — no React, no hooks — so both the risk detail page and the
 * register grid's Cards column share one ordering and it can be unit-tested
 * without a DOM.
 */
import { typeLabel } from "@/hooks/useResolveLabel";
import { isHexColor } from "@/lib/color";
import type { CardType, RiskCardLink } from "@/types";

export interface AffectedCardGroup {
  /** Metamodel type key, e.g. "Application". */
  typeKey: string;
  /** Translated display label — never the raw key when the type is known. */
  label: string;
  /** Raw metamodel colour. Undefined when the type is unknown or its colour
   *  is not a valid hex — callers must still run it through
   *  `readableTypeColor` before painting it against the theme paper. */
  color?: string;
  cards: RiskCardLink[];
}

/** Types the caller hasn't loaded yet (or that were deleted) sort last. */
const UNKNOWN_TYPE_ORDER = Number.MAX_SAFE_INTEGER;

function typeOrder(types: CardType[], key: string): number {
  const t = types.find((x) => x.key === key);
  return t ? t.sort_order : UNKNOWN_TYPE_ORDER;
}

/**
 * Comparator for a flat list of affected cards: metamodel type order first,
 * then card name alphabetically. Used by the register grid, where the chips
 * stay flat but should still order consistently with the detail page.
 */
export function compareAffectedCards(
  types: CardType[],
  locale?: string,
): (a: RiskCardLink, b: RiskCardLink) => number {
  return (a, b) => {
    const byType = typeOrder(types, a.card_type) - typeOrder(types, b.card_type);
    if (byType !== 0) return byType;
    if (a.card_type !== b.card_type) return a.card_type.localeCompare(b.card_type);
    return (a.card_name || "").localeCompare(b.card_name || "", locale);
  };
}

/**
 * Group affected cards by card type.
 *
 * Groups are ordered by the metamodel's `sort_order` (unknown types last,
 * tie-broken on the type key); cards inside each group are sorted by name
 * using the caller's locale collation.
 */
export function groupCardsByType(
  cards: RiskCardLink[],
  types: CardType[],
  locale?: string,
): AffectedCardGroup[] {
  const byType = new Map<string, RiskCardLink[]>();
  for (const card of cards) {
    const bucket = byType.get(card.card_type);
    if (bucket) bucket.push(card);
    else byType.set(card.card_type, [card]);
  }

  const groups: AffectedCardGroup[] = [];
  for (const [typeKey, groupCards] of byType) {
    const conf = types.find((t) => t.key === typeKey);
    groups.push({
      typeKey,
      // `typeLabel` computes the `label || key` fallback internally — passing
      // the whole entity is what keeps admin-created types (which ship with an
      // empty translations map) from leaking their slug into the UI.
      label: conf ? typeLabel(conf, locale) : typeKey,
      color: isHexColor(conf?.color) ? conf.color : undefined,
      cards: [...groupCards].sort((a, b) =>
        (a.card_name || "").localeCompare(b.card_name || "", locale),
      ),
    });
  }

  groups.sort((a, b) => {
    const byOrder = typeOrder(types, a.typeKey) - typeOrder(types, b.typeKey);
    return byOrder !== 0 ? byOrder : a.typeKey.localeCompare(b.typeKey);
  });
  return groups;
}
