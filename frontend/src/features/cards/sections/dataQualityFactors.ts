/**
 * How the data-quality breakdown's factors are ordered and read (#1334).
 * Shared by the pill's tooltip and `DataQualityBreakdownContent`, the full
 * breakdown the pill and the sticky score bar open.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useFieldLabel, useRelationLabel, useTypeLabel } from "@/hooks/useResolveLabel";
import type { DataQualityFactor, FieldDef } from "@/types";

/** A field whose emptiness pins the score at 0: it unlocks every other gain. */
export function unlocksScore(f: DataQualityFactor, blocked: string[]): boolean {
  return f.kind === "field" && blocked.includes(f.key);
}

/** Unmet slots: the required fields holding the score at 0 first (nothing
 * else moves it until they are filled), then the biggest gain; ties keep the
 * server's order. */
export function rankUnmet(factors: DataQualityFactor[], blocked: string[]): DataQualityFactor[] {
  const unlocks = (f: DataQualityFactor) => (unlocksScore(f, blocked) ? 1 : 0);
  return factors
    .filter((f) => !f.filled)
    .sort(
      (a, b) => unlocks(b) - unlocks(a) || (b.gain ?? 0) - (a.gain ?? 0),
    );
}

/** A relation type mandatory on both ends of a self-referencing type is two
 * slots with one key, told apart by `side`. */
export function factorKey(f: DataQualityFactor): string {
  return `${f.kind}:${f.key}:${f.side ?? ""}`;
}

/** How each factor reads: the action that fills it, its name once it counts,
 * and what filling it adds to the score. */
export function useFactorText(cardType: string | undefined) {
  const { t } = useTranslation(["cards", "common"]);
  const { getType, relationTypes } = useMetamodel();
  const fieldLabel = useFieldLabel();
  const relLabel = useRelationLabel();
  const typeLabel = useTypeLabel();

  return useMemo(() => {
    const fields = new Map<string, FieldDef>();
    for (const section of (cardType && getType(cardType)?.fields_schema) || []) {
      for (const f of section.fields || []) fields.set(f.key, f);
    }
    const relation = (f: DataQualityFactor) => {
      const rt = relationTypes.find((r) => r.key === f.key);
      if (!rt) return null;
      return {
        verb: relLabel(rt, f.side === "target"),
        type: typeLabel(f.other_type_key ? getType(f.other_type_key) : undefined),
      };
    };
    const action = (f: DataQualityFactor): string => {
      switch (f.kind) {
        case "field": {
          const def = fields.get(f.key);
          return def ? t("dataQuality.fillField", { field: fieldLabel(def) }) : t("dataQuality.fillAField");
        }
        case "description":
          return t("dataQuality.addDescription");
        case "lifecycle":
          return t("dataQuality.setLifecycle");
        case "relation": {
          const r = relation(f);
          return r ? t("dataQuality.addRelation", r) : t("dataQuality.addRequiredRelation");
        }
        case "tag_group":
          return t("dataQuality.addTag", { group: f.name ?? "" });
        case "stakeholders":
          return t("dataQuality.assignStakeholder");
      }
    };
    const noun = (f: DataQualityFactor): string => {
      switch (f.kind) {
        case "field": {
          const def = fields.get(f.key);
          return def ? fieldLabel(def) : t("dataQuality.field");
        }
        case "description":
          return t("dataQuality.description");
        case "lifecycle":
          return t("dataQuality.lifecycle");
        case "relation": {
          const r = relation(f);
          return r ? t("dataQuality.relation", r) : t("dataQuality.requiredRelation");
        }
        case "tag_group":
          return f.name ?? "";
        case "stakeholders":
          return t("dataQuality.stakeholders");
      }
    };
    const requiredField = (key: string) => {
      const def = fields.get(key);
      return def ? fieldLabel(def) : t("dataQuality.field");
    };
    // What filling the slot adds to the score. A gating field shows no figure:
    // nothing moves the score while another required field is still empty, and
    // the breakdown's alert already says what the score would be.
    const gain = (f: DataQualityFactor, blocked: string[]) =>
      unlocksScore(f, blocked) ? t("dataQuality.required") : t("dataQuality.raiseTo", { pct: f.gain });
    return { action, noun, requiredField, gain };
  }, [cardType, getType, relationTypes, fieldLabel, relLabel, typeLabel, t]);
}
