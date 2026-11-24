import { lazy, Suspense } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import { hasPermission } from "@/components/RequirePermission";
import { useOptionalAuthUser } from "@/hooks/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import type { PpmBudgetLine, PpmCostLine, PpmRollupOut } from "@/types";
import { financialTotals } from "./derivedFinancials";
import DerivedValue from "./DerivedValue";
import PpmFinanceTree from "./PpmFinanceTree";
import { usePpmFinancialAmount, usePpmFinancials } from "./usePpmFinancials";

const PpmCostCharts = lazy(() => import("./PpmCostCharts"));

interface Props {
  initiativeId: string;
  costLines: PpmCostLine[];
  rollup: PpmRollupOut | null;
  onRefresh: () => void;
}

export default function PpmCostTab({ initiativeId, rollup, onRefresh }: Props) {
  const { t } = useTranslation(["ppm", "common"]);
  const user = useOptionalAuthUser();
  const financials = usePpmFinancials(initiativeId);
  const format = usePpmFinancialAmount();
  const { fmt } = useCurrency();
  const data = financials.data;
  const budgetLines: PpmBudgetLine[] = (data?.budget_lines ?? []).map((row) => ({
    id: row.id, initiative_id: initiativeId, fiscal_year: row.fiscal_year,
    category: row.category, description: row.description, amount: Number(row.amount),
    created_at: "", updated_at: "",
  }));
  const costLines: PpmCostLine[] = (data?.cost_items ?? []).map((row) => ({
    id: row.id, initiative_id: initiativeId, description: row.description, category: row.category,
    planned: Number(row.planned), actual: Number(row.actual), date: row.date,
    created_at: "", updated_at: "",
  }));
  const totals = financialTotals(budgetLines, costLines, rollup);
  const changed = () => { financials.refetch(); onRefresh(); };
  const budget = totals.budget.derived ? totals.budget.total : data?.budget_totals.amount;
  const actual = totals.actual.total;

  return <Box>
    {financials.error && <Alert severity="error">{financials.error.message}</Alert>}
    {financials.loading && <CircularProgress />}
    {data && <>
      <Paper variant="outlined" sx={{ display: "flex", gap: 3, p: 2, mb: 3, flexWrap: "wrap" }}>
        <Box><Typography variant="caption">{t("totalBudget")}</Typography>
          <Typography variant="h6"><DerivedValue tip={totals.budget.derived ? t("derivedBudgetTooltip", { count: rollup?.descendant_count ?? 0 }) : undefined}>{format(budget)}</DerivedValue></Typography>
        </Box>
        <Box><Typography variant="caption">{t("totalActual")}</Typography>
          <Typography variant="h6"><DerivedValue tip={totals.actual.derived ? t("derivedActualTooltip", { count: rollup?.descendant_count ?? 0 }) : undefined}>{fmt.format(actual)}</DerivedValue></Typography>
        </Box>
        <Box><Typography variant="caption">{t("variance")}</Typography>
          <Typography variant="h6">{fmt.format(totals.budget.total - actual)}</Typography></Box>
        <Box><Typography variant="caption">{t("capex")}</Typography>
          <Typography variant="body2">{fmt.format(totals.actual.capex)} / {fmt.format(totals.budget.capex)}</Typography></Box>
        <Box><Typography variant="caption">{t("opex")}</Typography>
          <Typography variant="body2">{fmt.format(totals.actual.opex)} / {fmt.format(totals.budget.opex)}</Typography></Box>
      </Paper>
      <Suspense fallback={null}><PpmCostCharts costLines={costLines} budgetLines={budgetLines} /></Suspense>
    </>}
    <PpmFinanceTree key={initiativeId} data={data} rollup={rollup}
      readOnly={!!user && !hasPermission(user.permissions, "ppm.manage")} onChanged={changed} />
  </Box>;
}
