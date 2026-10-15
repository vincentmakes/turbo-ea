/**
 * The label to show for a survey's *relation* field.
 *
 * A survey stores its fields as a snapshot taken when the survey was built
 * (`SurveyBuilder`'s `toggleRelation`), and the response-form endpoint skips
 * relation fields when it enriches labels with metamodel translations
 * (`backend/app/api/v1/surveys.py`). So the stored `label` is frozen in the
 * *author's* language and shown verbatim to every respondent.
 *
 * Resolving the verb from `relation_type_key` + `direction` against the live
 * metamodel fixes that: each reader sees their own language, and a survey built
 * before a verb was corrected picks the correction up. The stored `label` stays
 * the fallback for a relation type that has since been deleted — there is
 * nothing live to resolve then, and the snapshot is the only record of what was
 * asked.
 *
 * The verb, not a noun: a relation type is named by its verb wherever it sits
 * among other relation types, and the survey's relation list is exactly that.
 * See `frontend/UI_GUIDELINES.md` §3.13.
 */

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useFieldLabel, useRelationLabel } from "@/hooks/useResolveLabel";
import { getPhaseLabels } from "@/lib/lifecyclePhases";
import type { SurveyField } from "@/types";

export function useSurveyRelationFieldLabel() {
  const { relationTypes } = useMetamodel();
  const relLabel = useRelationLabel();

  return useCallback(
    (field: SurveyField): string => {
      const rt = relationTypes.find((r) => r.key === field.relation_type_key);
      if (!rt || (field.direction !== "outgoing" && field.direction !== "incoming")) {
        return field.label;
      }
      return relLabel(rt, field.direction === "incoming");
    },
    [relationTypes, relLabel],
  );
}

/**
 * The label for any survey field, whatever it surveys.
 *
 * - relation → the live verb (`useSurveyRelationFieldLabel`);
 * - lifecycle → the phase's translated name, the same words the card's
 *   lifecycle line uses;
 * - stakeholder → the role's live label when the caller knows it (the builder
 *   loads the type's roles), else the stored label and translations — the
 *   response-form endpoint fills those from the live role definition;
 * - attribute → the field's metamodel label.
 */
export function useSurveyFieldLabel(roleLabel?: (roleKey: string) => string | undefined) {
  const relationLabel = useSurveyRelationFieldLabel();
  const fieldLabel = useFieldLabel();
  const { t } = useTranslation("common");

  return useCallback(
    (field: SurveyField): string => {
      if (field.kind === "relation") return relationLabel(field);
      if (field.kind === "lifecycle" && field.phase) {
        return getPhaseLabels(t)[field.phase] || field.label;
      }
      if (field.kind === "stakeholder" && field.role) {
        // Never the field key (`sh:<role>`): without a label, the role key.
        return roleLabel?.(field.role) || (field.label ? fieldLabel(field) : field.role);
      }
      return fieldLabel(field);
    },
    [relationLabel, fieldLabel, t, roleLabel],
  );
}
