/**
 * How the configuration dialog names dimensions, measures, flags and
 * relation sides. Metamodel names go through the entity-aware resolvers; a
 * relation is named by its verb and the card type at its other end ("uses IT
 * Component"), read from the chosen type's side (`relationLabel(rt, reverse)`).
 */
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useFieldLabel, useRelationLabel, useTypeLabel } from "@/hooks/useResolveLabel";
import { findField } from "../../charts/dimensions";
import { fieldOfDimension, phaseOfDimension, relationOfDimension } from "../../dashboardQuery";
import { DATA_QUALITY_MEASURE, RELATIONS_MEASURE, parseSideKey } from "../widgetConfigModel";

/** The two lifecycle months on the menu, each with its own name. */
const PHASE_MONTH_KEYS: Record<string, string> = {
  active: "dashboard.query.dimension.goLiveMonth",
  endOfLife: "dashboard.query.dimension.endOfLifeMonth",
};

export interface ConfigLabels {
  relationSide: (sideKey: string, typeKey: string | null | undefined) => string;
  dimension: (dimension: string, typeKey: string | null | undefined) => string;
  measure: (measure: string, typeKey: string | null | undefined) => string;
  flag: (flag: string, typeKey: string | null | undefined) => string;
}

export function useConfigLabels(): ConfigLabels {
  const { t } = useTranslation("common");
  const { types, relationTypes } = useMetamodel();
  const typeLabel = useTypeLabel();
  const fieldLabel = useFieldLabel();
  const relationLabel = useRelationLabel();

  const relationSide = useCallback(
    (sideKey: string, typeKey: string | null | undefined) => {
      const { rt: rtKey, dir } = parseSideKey(sideKey);
      const rt = relationTypes.find((r) => r.key === rtKey);
      if (!rt) return sideKey;
      const reverse =
        dir === "in" || (dir === null && rt.target_type_key === typeKey && rt.source_type_key !== typeKey);
      const other = types.find((ct) => ct.key === (reverse ? rt.source_type_key : rt.target_type_key));
      return `${relationLabel(rt, reverse)} ${typeLabel(other)}`.trim();
    },
    [relationTypes, types, relationLabel, typeLabel],
  );

  const dimension = useCallback(
    (dim: string, typeKey: string | null | undefined) => {
      const fieldKey = fieldOfDimension(dim);
      if (fieldKey) {
        const field = findField(types, typeKey ?? null, fieldKey);
        return field ? fieldLabel(field) : fieldKey;
      }
      const side = relationOfDimension(dim);
      if (side) return t("dashboard.query.dimension.related", { relation: relationSide(side, typeKey) });
      const phase = phaseOfDimension(dim);
      if (phase) return PHASE_MONTH_KEYS[phase] ? t(PHASE_MONTH_KEYS[phase]) : t(`lifecycle.${phase}`, { defaultValue: phase });
      return t(`dashboard.query.dimension.${dim}`);
    },
    [types, fieldLabel, relationSide, t],
  );

  const measure = useCallback(
    (m: string, typeKey: string | null | undefined) => {
      if (m === DATA_QUALITY_MEASURE) return t("dashboard.query.measure.data_quality");
      if (m.startsWith(RELATIONS_MEASURE)) {
        return t("dashboard.query.measure.relations", {
          relation: relationSide(m.slice(RELATIONS_MEASURE.length), typeKey),
        });
      }
      const field = findField(types, typeKey ?? null, m);
      return field ? fieldLabel(field) : m;
    },
    [types, fieldLabel, relationSide, t],
  );

  const flag = useCallback(
    (f: string, typeKey: string | null | undefined) => {
      const m = /^(related|unrelated):(.+)$/.exec(f);
      if (m) return t(`dashboard.query.flag.${m[1]}`, { relation: relationSide(m[2], typeKey) });
      return t(`dashboard.query.flag.${f}`, { defaultValue: f });
    },
    [relationSide, t],
  );

  return useMemo(() => ({ relationSide, dimension, measure, flag }), [relationSide, dimension, measure, flag]);
}
