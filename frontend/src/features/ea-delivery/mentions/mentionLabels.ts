/**
 * The reader's words for mentions the server leaves empty (restricted, gone),
 * in one place, so every surface that shows stored text fills them alike:
 * `useMentionLabels()` for components, `i18nMentionLabels()` for the print,
 * Word, spreadsheet and grid builders that read the global `i18n`.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { fillMentionLabels, type MentionLabels } from "@/lib/mentionHtml";
import type { Translate } from "../decisionStanding";

/** The labels, from the `delivery` namespace's `t`. */
export function mentionLabelsFrom(t: Translate): MentionLabels {
  return {
    restricted: {
      card: t("mention.restricted.card"),
      decision: t("mention.restricted.decision"),
      user: t("mention.restricted.other"),
      other: t("mention.restricted.other"),
    },
    missing: {
      card: t("mention.missing.card"),
      decision: t("mention.missing.decision"),
      user: t("mention.missing.user"),
      other: t("mention.missing.other"),
    },
  };
}

/** The labels in the current language, from the global `i18n`. */
export function i18nMentionLabels(): MentionLabels {
  return mentionLabelsFrom((key, opts) => String(i18n.t(`delivery:${key}`, opts as never)));
}

/** `fillMentionLabels` with the current language's labels (non-React builders). */
export function fillMentionLabelsI18n(html: string): string {
  return fillMentionLabels(html, i18nMentionLabels());
}

/** The labels for a component, rebuilt when the language changes. */
export function useMentionLabels(): MentionLabels {
  // react-i18next hands out a new `t` when the language changes.
  const { t } = useTranslation("delivery");
  return useMemo(() => mentionLabelsFrom(t), [t]);
}
