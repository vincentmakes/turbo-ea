import { useMemo, useState } from "react";
import Box from "@mui/material/Box";
import EChart from "@/components/charts/EChart";
import { useEChartsTheme } from "@/components/charts/echartsTheme";
import { api } from "@/api/client";
import { useAbortableEffect } from "@/hooks/useLatestRequest";
import { useCurrency } from "@/hooks/useCurrency";
import { costFiscalYearName } from "@/lib/fiscalYear";
import { buildCostTrendOption, type CostTrendRow } from "./costTrendOption";

export type TrendSelection = { kind: "card"; id: string } | { kind: "group"; keys: string[] };

interface TrendResponse {
  total: number;
  items?: { id: string; cost: number; group?: string }[];
}

/** One component's value for a year: the response total, or the sum of the items that pass scope and selection. */
function rowValue(r: TrendResponse, selection?: TrendSelection, scopeIds?: Set<string> | null): number {
  if (!selection && !scopeIds) return r.total;
  return (r.items ?? []).reduce((sum, it) => {
    if (scopeIds && !scopeIds.has(it.id)) return sum;
    if (selection?.kind === "card" && it.id !== selection.id) return sum;
    if (selection?.kind === "group" && !selection.keys.includes(it.group ?? "")) return sum;
    return sum + it.cost;
  }, 0);
}

/** Stacked history of the cost field's components (the keys of its calculation), one bar per year. */
export default function CostTrendChart({
  typeParam,
  costField,
  components,
  labelOf,
  years,
  currentFiscalYear,
  groupBy,
  selection,
  scopeIds,
  refreshVersion,
}: {
  typeParam: string;
  costField: string;
  components: string[];
  /** A component's display label; the key itself when omitted. */
  labelOf?: (component: string) => string;
  years: number[];
  currentFiscalYear: number;
  /** Sent as `group_by` so group members can be told apart. */
  groupBy?: string;
  selection?: TrendSelection;
  /** Cards in scope; null/undefined = all. */
  scopeIds?: Set<string> | null;
  refreshVersion?: number;
}) {
  // Per year, each component's response; selection and scope filter it locally, without a refetch.
  const [fetched, setFetched] = useState<{ fiscalYear: number; byComponent: [string, TrendResponse][] }[]>([]);
  const chrome = useEChartsTheme();
  const { fmt } = useCurrency();

  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      const results = await Promise.all(
        years.map((year) =>
          Promise.all(
            components.map((component) =>
              api.get<TrendResponse>(
                `/reports/cost-treemap?type=${typeParam}&cost_field=${component}&fiscal_year=${year}${
                  groupBy ? `&group_by=${encodeURIComponent(groupBy)}` : ""
                }`,
                { signal },
              ),
            ),
          ).then((responses) => ({
            fiscalYear: year,
            byComponent: components.map((c, i): [string, TrendResponse] => [c, responses[i]]),
          })),
        ),
      );
      if (isCurrent()) setFetched(results);
    },
    // costField: a new field can keep the same components yet must not show the old rows.
    [typeParam, costField, components.join(","), years, groupBy, refreshVersion],
  );

  const rows = useMemo<CostTrendRow[]>(
    () =>
      fetched.map(({ fiscalYear, byComponent }) => {
        const row: CostTrendRow = { fiscalYear };
        for (const [c, r] of byComponent) row[c] = rowValue(r, selection, scopeIds);
        return row;
      }),
    [fetched, selection, scopeIds],
  );

  const option = useMemo(
    () =>
      buildCostTrendOption(rows, components, {
        chrome,
        isRtl: chrome.isRtl,
        format: (v) => fmt.format(v),
        yearLabel: (year) => costFiscalYearName(year, currentFiscalYear),
        componentLabel: labelOf,
      }),
    [rows, components, chrome, fmt, currentFiscalYear, labelOf],
  );

  return (
    <Box data-testid="cost-trend-chart">
      <EChart option={option} style={{ height: 300 }} ariaLabel={components.map((c) => labelOf?.(c) ?? c).join(", ")} />
    </Box>
  );
}
