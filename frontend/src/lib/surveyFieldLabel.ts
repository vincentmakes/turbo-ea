/**
 * The label to show for a survey's *relation* field.
 *
 * A survey stores its fields as a snapshot taken when the survey was built
 * (`SurveyBuilder`'s `toggleRelation`), and the response-form endpoint skips
 * relation fields when it enriches labels with metamodel translations
 * (`backend/app/api/v1/surveys.py`). So the stored `label` is frozen in the
 * *author's* language and shown verbatim to every respondent — and, for a
 * lineage relation, frozen with the verb #1091 corrected.
 *
 * Resolving from `relation_type_key` + `direction` against the live metamodel
 * fixes both at once: each reader sees their own language, and surveys built
 * before the correction pick it up. The stored `label` stays the fallback for
 * a relation type that has since been deleted — there is nothing live to
 * resolve then, and the snapshot is the only record of what was asked.
 */

import { useCallback } from "react";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useRelationDirectionLabel } from "@/hooks/useRelationDirectionLabel";
import type { SurveyField } from "@/types";

export function useSurveyRelationFieldLabel() {
  const { relationTypes } = useMetamodel();
  const directionLabel = useRelationDirectionLabel();

  return useCallback(
    (field: SurveyField): string => {
      const rt = relationTypes.find((r) => r.key === field.relation_type_key);
      if (!rt || (field.direction !== "outgoing" && field.direction !== "incoming")) {
        return field.label;
      }
      return directionLabel(rt, field.direction);
    },
    [relationTypes, directionLabel],
  );
}
