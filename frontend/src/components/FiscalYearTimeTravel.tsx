import { useTranslation } from "react-i18next";
import TimelineSlider from "@/components/TimelineSlider";
import { shortFiscalYear } from "@/lib/costItems";
import { costFiscalYearName } from "@/lib/fiscalYear";
import { RAG_COLORS } from "@/theme/tokens";

/** The green Time Travel row of the cost reports: one step per fiscal year, oldest first. */
export default function FiscalYearTimeTravel({
  years,
  currentFy,
  value,
  onChange,
  servedYear,
}: {
  /** Fiscal years in ascending order: the first and last set the slider's range. */
  years: number[];
  currentFy: number;
  value: number;
  onChange: (fy: number) => void;
  /** The year the server answered, when it differs from `value`. */
  servedYear?: number;
}) {
  const { t } = useTranslation("common");
  // A one-step slider has min == max; real lists always have 5 or 6 years.
  if (years.length < 2) return null;
  return (
    <TimelineSlider
      value={value}
      onChange={onChange}
      dateRange={{ min: years[0], max: years[years.length - 1] }}
      yearMarks={[]}
      steps={years.map((fy) => ({ value: fy, label: shortFiscalYear(fy) }))}
      accentColor={RAG_COLORS.green}
      valueText={costFiscalYearName(servedYear ?? value, currentFy)}
      previousLabel={t("fiscalYearTimeTravel.previous")}
      nextLabel={t("fiscalYearTimeTravel.next")}
      ariaLabel={t("fiscalYearTimeTravel.label")}
    />
  );
}
