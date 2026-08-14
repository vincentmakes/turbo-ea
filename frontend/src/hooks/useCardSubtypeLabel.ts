import { useCallback } from "react";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useSubtypeLabel } from "@/hooks/useResolveLabel";

/**
 * Entity-aware resolver for a card's `subtype`, keyed by the card type it
 * belongs to: `subtypeLabel(card.type, card.subtype)` → localized display name.
 *
 * A card carries its subtype as a bare **key** (`"businessApplication"`); the
 * human label and its per-locale translations live on the card type's
 * `subtypes` array in the metamodel. Every surface that shows a subtype
 * therefore has to do the same two-step lookup, and the ones that skipped it
 * rendered the internal slug straight to the user — the recurring `.key` leak
 * documented on `useResolveLabel` (#661). This hook is the one place that
 * lookup lives, so a new call site cannot get it wrong by copying the wrong
 * neighbour.
 *
 * An unresolvable subtype falls back to the raw key rather than to an empty
 * string: a stale key left behind by a metamodel edit, or a subtype an AI
 * proposed for a card that does not exist yet, stays visible instead of
 * silently disappearing from the row it describes.
 *
 * Not part of `useResolveLabel.ts` on purpose — that module is metamodel-free
 * so `excelExport` / `excelImport` can import its pure resolvers without
 * pulling the API client into their graph.
 *
 * Two surfaces deliberately do NOT use this hook, because their subtype
 * definitions do not come from `/metamodel/types`: `PortalViewer` reads them
 * from the public, unauthenticated portal payload, and `SurveyRespond` falls
 * back to translations the survey API supplies inline.
 */
export function useCardSubtypeLabel() {
  const { types } = useMetamodel();
  const stLabel = useSubtypeLabel();

  return useCallback(
    (typeKey: string | null | undefined, subtypeKey: string | null | undefined): string => {
      if (!subtypeKey) return "";
      const def = types
        .find((t) => t.key === typeKey)
        ?.subtypes?.find((s) => s.key === subtypeKey);
      return def ? stLabel(def) : subtypeKey;
    },
    [types, stLabel],
  );
}
