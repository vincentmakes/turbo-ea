import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import CardMultiPicker, { type PickedCard } from "@/components/CardMultiPicker";
import { useMetamodel } from "@/hooks/useMetamodel";
import type { CardType } from "@/types";

export type InsertMode = "multi" | "single";

interface Props {
  open: boolean;
  /** "multi" lets the user pick many cards via checkboxes (default).
   *  "single" closes the dialog as soon as one is picked — used for the
   *  Change-Linked-Card and Link-to-Existing-Card flows. */
  mode?: InsertMode;
  onClose: () => void;
  onInsert: (cards: PickedCard[], cardTypeKeysByCardId: Map<string, CardType>) => void;
}

/**
 * The diagram's Insert-Cards dialog — a thin adapter over the shared
 * `CardMultiPicker`.
 *
 * This used to be its own browser with its own selection model, which is
 * exactly how it acquired a bug the scope picker had already fixed: it kept a
 * bare id `Set` and resolved it against `useCardSearch`'s results, so ticking
 * a card, switching type or typing, and hitting Insert dropped the first pick
 * without a word. Sharing the picker removes the divergence rather than
 * patching the symptom.
 *
 * The card-type map it hands the editor is built here: the picker deals in
 * cards, and only the diagram needs the type's colour and icon to draw a
 * shape.
 */
export default function InsertCardsDialog({ open, mode = "multi", onClose, onInsert }: Props) {
  const { t } = useTranslation(["diagrams", "common"]);
  const { types } = useMetamodel();
  const typeMap = useMemo(() => new Map(types.map((tp) => [tp.key, tp] as const)), [types]);

  const handleChange = useCallback(
    (_ids: string[], picked: PickedCard[]) => {
      if (picked.length === 0) return;
      const byCard = new Map<string, CardType>();
      for (const c of picked) {
        const ct = typeMap.get(c.type);
        if (ct) byCard.set(c.id, ct);
      }
      onInsert(picked, byCard);
    },
    [typeMap, onInsert],
  );

  return (
    <CardMultiPicker
      open={open}
      mode={mode}
      onClose={onClose}
      // Insert always starts from an empty basket — the dialog is a way of
      // adding cards to the canvas, never of editing what is already on it.
      value={[]}
      onChange={handleChange}
      showSelectAll
      title={mode === "multi" ? t("insertDialog.titleMulti") : t("insertDialog.titleSingle")}
      applyLabel={(count) => t("insertDialog.insertSelected", { count })}
    />
  );
}
