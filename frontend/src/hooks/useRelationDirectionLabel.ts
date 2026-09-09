/**
 * What a *card* calls one side of a relation type.
 *
 * For an ordinary relation type this is just the localized verb, read from the
 * side under view (`relationLabel(rt, locale, reverse)`).
 *
 * A card type's ONE lineage relation is the exception. Its verbs are "succeeds"
 * / "is succeeded by", and a list that shows them reads backwards against the
 * card page: the *outgoing* side (this card is the source, so this card
 * succeeds the others) holds the card's **Predecessors**, and the incoming side
 * holds its **Successors**. `SuccessorsSection` names them exactly that way and
 * never shows the verbs — so anywhere else that enumerates both sides, the same
 * two nouns are the honest labels, and the concept stays explained once
 * ([#1091](https://github.com/vincentmakes/turbo-ea/issues/1091)).
 *
 * No new i18n keys: `cards:successors.predecessors` and
 * `cards:successors.successorsList` are the very strings card detail renders.
 */

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useRelationLabel } from "@/hooks/useResolveLabel";
import { isSuccessorRelationType } from "@/lib/successorRelation";
import type { RelationType } from "@/types";

export type RelationDirection = "outgoing" | "incoming";

export function useRelationDirectionLabel() {
  const { t } = useTranslation("cards");
  const { relationTypes } = useMetamodel();
  const relLabel = useRelationLabel();

  return useCallback(
    (rt: RelationType, direction: RelationDirection): string => {
      if (isSuccessorRelationType(relationTypes, rt)) {
        return t(
          direction === "outgoing" ? "successors.predecessors" : "successors.successorsList",
        );
      }
      return relLabel(rt, direction === "incoming");
    },
    [relationTypes, relLabel, t],
  );
}
