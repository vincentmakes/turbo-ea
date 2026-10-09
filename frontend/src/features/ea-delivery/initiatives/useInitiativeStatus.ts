import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useOptionLabel } from "@/hooks/useResolveLabel";
import { STATUS_COLORS } from "@/theme/tokens";
import { INITIATIVE_STATUS_COLORS } from "./constants";

/** The Initiative type's own option for an `initiativeStatus` value, if any. */
function useInitiativeStatusOption() {
  const { types } = useMetamodel();
  return useCallback(
    (status: string) =>
      types
        .find((mt) => mt.key === "Initiative")
        ?.fields_schema.flatMap((section) => section.fields)
        .find((field) => field.key === "initiativeStatus")
        ?.options?.find((o) => o.key === status),
    [types],
  );
}

/**
 * Names an initiative's `initiativeStatus` value — the sidebar's status dot and
 * the workspace header's status chip share it. The Initiative type's own
 * option label (translated) comes first, so an admin's custom option reads as
 * its label rather than its key; the bundled wording covers a built-in key the
 * metamodel lacks, and anything else is shown as stored.
 */
export function useInitiativeStatusLabel() {
  const { t } = useTranslation("delivery");
  const statusOption = useInitiativeStatusOption();
  const optLabel = useOptionLabel();
  return useCallback(
    (status: string): string => {
      const option = statusOption(status);
      if (option) return optLabel(option);
      const builtIn: Record<string, string> = {
        onTrack: t("initiativeStatus.onTrack"),
        atRisk: t("initiativeStatus.atRisk"),
        offTrack: t("initiativeStatus.offTrack"),
        onHold: t("initiativeStatus.onHold"),
        completed: t("initiativeStatus.completed"),
      };
      return builtIn[status] ?? status;
    },
    [statusOption, optLabel, t],
  );
}

/**
 * Colours an initiative's `initiativeStatus` value, resolved like its label:
 * the Initiative type's option colour first, so an admin's custom option is
 * not grey; the bundled colour for a built-in key; grey for anything else.
 */
export function useInitiativeStatusColor() {
  const statusOption = useInitiativeStatusOption();
  return useCallback(
    (status: string): string =>
      statusOption(status)?.color || INITIATIVE_STATUS_COLORS[status] || STATUS_COLORS.neutral,
    [statusOption],
  );
}
