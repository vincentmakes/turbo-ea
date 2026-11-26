import { useTranslation } from "react-i18next";
import { useDateFormat } from "@/hooks/useDateFormat";
import { PHASES, getPhaseLabels, lifecycleOrderIssues } from "@/lib/lifecyclePhases";

/**
 * The advisory out-of-order message for each phase of `lifecycle` — Phase Out
 * dated after End of Life, say — or `null`. Never blocks a save: real
 * lifecycles do slip, and the save stays the user's call.
 */
export function useLifecycleOrderWarning(lifecycle: Record<string, string>) {
  const { t } = useTranslation(["cards", "common"]);
  const { formatDate } = useDateFormat();
  const phaseLabels = getPhaseLabels(t);
  const orderIssues = lifecycleOrderIssues(lifecycle);
  return (phase: (typeof PHASES)[number]): string | null => {
    const later = orderIssues[phase];
    if (!later) return null;
    return t("cards:lifecycle.orderWarning", {
      phase: phaseLabels[later],
      date: formatDate(lifecycle[later]),
    });
  };
}

