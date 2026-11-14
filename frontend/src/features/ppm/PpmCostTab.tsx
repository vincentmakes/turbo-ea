import { useState, useMemo, lazy, Suspense } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Divider from "@mui/material/Divider";
import { useTranslation } from "react-i18next";
import { DateField } from "@/components/DateField";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useSubmitOnce } from "@/hooks/useSubmitOnce";
import { todayIsoDate } from "@/lib/dates";
import { KPI_VALUE_SX } from "./ppmStyles";
import { useFullScreenDialog } from "@/hooks/useFullScreenDialog";
import { useCurrency } from "@/hooks/useCurrency";
import { useFiscalYearStart } from "@/hooks/useFiscalYearStart";
import { currentFiscalYear, fiscalYearFor } from "./costChartData";
import {
  defaultExpandedKey,
  groupBudgetLines,
  groupCostLines,
  type GroupKey,
} from "./costTableGroups";
import DerivedValue from "./DerivedValue";
import { compactAmount } from "./ppmPortfolioFormat";
import { derivedYearGroups, financialTotals } from "./derivedFinancials";
import { BudgetTable, CostTable } from "./PpmCostTables";
import type { PpmCostLine, PpmBudgetLine, PpmRollupOut } from "@/types";

// Lazy: PpmProjectDetail imports every tab eagerly, so a static import would
// pull ECharts into the PPM route chunk even for visitors who never open
// this tab.
const PpmCostCharts = lazy(() => import("./PpmCostCharts"));

/** Stable stand-in until the budget lines have loaded. */
const NO_BUDGET_LINES: PpmBudgetLine[] = [];

/**
 * Which year groups a table shows open. `null` until the user first toggles
 * one: until then the open group follows the data (`defaultExpandedKey`), so a
 * table whose lines arrive late still opens on the right year, and a reload
 * after a save never undoes what the user chose. `open` adds a group without
 * closing any, so a line just saved into a collapsed year is not hidden.
 */
function useExpandedGroups(defaultKey: GroupKey | null) {
  // A `null` default sits in the set harmlessly: no group has a null key.
  const [chosen, setChosen] = useState<Set<GroupKey | null> | null>(null);
  const expanded = chosen ?? new Set<GroupKey | null>([defaultKey]);
  const toggle = (key: GroupKey) => {
    const next = new Set(expanded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setChosen(next);
  };
  const open = (key: GroupKey) => {
    // Functional: a save resolves after its own render, so read the latest set.
    setChosen((prev) => new Set([...(prev ?? expanded), key]));
  };
  return { expanded, toggle, open };
}

interface Props {
  initiativeId: string;
  costLines: PpmCostLine[];
  /** The initiatives beneath this one (`null` while unknown or unreadable). */
  rollup: PpmRollupOut | null;
  onRefresh: () => void;
}

export default function PpmCostTab({ initiativeId, costLines, rollup, onRefresh }: Props) {
  const { t } = useTranslation("ppm");
  const fullScreen = useFullScreenDialog();
  const { fmt, currency } = useCurrency();
  const { month: fyStart } = useFiscalYearStart();

  const errorText = (err: unknown) =>
    err instanceof Error ? err.message : t("common:errors.generic");

  // ── Budget lines (planned) ──
  // The query keeps its lines while it reloads them after a save. Another
  // initiative never stands in for this one's: the parent mounts this tab with
  // `key={initiativeId}`, so a switch is a fresh tab with a fresh query.
  const {
    data: loadedBudgetLines,
    loading: budgetLoading,
    error: budgetLoadError,
    refetch: loadBudgets,
  } = useApiQuery<PpmBudgetLine[]>(`/ppm/initiatives/${initiativeId}/budgets`);
  const budgetLines = loadedBudgetLines ?? NO_BUDGET_LINES;
  // Until the budget lines have arrived, a budget figure is unknown — never $0.
  const budgetKnown = loadedBudgetLines !== undefined;
  // Summary-bar figures read in k / M so the derived glyph beside them cannot wrap them.
  const kpiAmount = (n: number) => compactAmount(n, currency, fmt.format);
  const budgetKpi = (n: number) => (budgetKnown ? kpiAmount(n) : "\u2014");
  // A failed delete, shown above the table it failed in.
  const [budgetListError, setBudgetListError] = useState<string | null>(null);
  const [costListError, setCostListError] = useState<string | null>(null);
  // A failed save, shown in the dialog it failed in.
  const [budgetSaveError, setBudgetSaveError] = useState<string | null>(null);
  const [costSaveError, setCostSaveError] = useState<string | null>(null);
  const [budgetDialog, setBudgetDialog] = useState<{
    open: boolean;
    item?: PpmBudgetLine;
  }>({ open: false });
  const [budgetForm, setBudgetForm] = useState({
    fiscal_year: currentFiscalYear(new Date(), fyStart),
    category: "capex" as "capex" | "opex",
    description: "",
    amount: 0,
  });

  // ── Cost item dialog (actuals) ──
  const [costDialog, setCostDialog] = useState<{
    open: boolean;
    item?: PpmCostLine;
  }>({ open: false });
  const [costForm, setCostForm] = useState({
    description: "",
    category: "capex" as "capex" | "opex",
    actual: 0,
    date: "",
  });
  // A dialog's save is in flight: Save is disabled, and a second click that
  // lands before that re-render is ignored. Only one dialog is open at a time.
  const { busy: saving, run: submit } = useSubmitOnce();

  // ── KPIs ──
  // Each side is this initiative's own lines, or — when it has none of that
  // kind — the initiatives' beneath it (see derivedFinancials). The budget
  // side is only ever derived once its own lines are known to be none.
  const totals = financialTotals(budgetLines, costLines, rollup);
  const budgetDerived = budgetKnown && totals.budget.derived;
  const actualDerived = totals.actual.derived;
  const count = rollup?.descendant_count;
  const budgetTip = budgetDerived ? t("derivedBudgetTooltip", { count }) : undefined;
  const actualTip = actualDerived ? t("derivedActualTooltip", { count }) : undefined;
  const varianceTip = [budgetTip, actualTip].filter(Boolean).join(" \u00b7 ") || undefined;
  const totalBudget = totals.budget.total;
  const totalActual = totals.actual.total;

  // ── Table groups ──
  const currentFy = currentFiscalYear(new Date(), fyStart);
  const budgetGroups = useMemo(() => groupBudgetLines(budgetLines), [budgetLines]);
  const costGroups = useMemo(() => groupCostLines(costLines, fyStart), [costLines, fyStart]);
  const budgetOpen = useExpandedGroups(defaultExpandedKey(budgetGroups, currentFy));
  const costOpen = useExpandedGroups(defaultExpandedKey(costGroups, currentFy));

  // ── Budget handlers ──
  const handleBudgetOpen = (item?: PpmBudgetLine, preset?: { fiscalYear?: number }) => {
    if (item) {
      setBudgetForm({
        fiscal_year: item.fiscal_year,
        category: item.category,
        description: item.description ?? "",
        amount: item.amount,
      });
    } else {
      setBudgetForm({
        fiscal_year: preset?.fiscalYear ?? currentFiscalYear(new Date(), fyStart),
        category: "capex",
        description: "",
        amount: 0,
      });
    }
    setBudgetSaveError(null);
    setBudgetDialog({ open: true, item });
  };

  const handleBudgetSave = () =>
    submit(async () => {
      // The description is optional: an empty box stores NULL, not "".
      const body = { ...budgetForm, description: budgetForm.description.trim() || null };
      try {
        if (budgetDialog.item) {
          await api.patch(`/ppm/budgets/${budgetDialog.item.id}`, body);
        } else {
          await api.post(`/ppm/initiatives/${initiativeId}/budgets`, body);
        }
      } catch (err) {
        setBudgetSaveError(errorText(err));
        return;
      }
      // Stryker disable next-line ObjectLiteral: a dialog state without `open` is closed
      setBudgetDialog({ open: false });
      budgetOpen.open(budgetForm.fiscal_year);
      loadBudgets();
    });

  const handleBudgetDelete = async (id: string) => {
    setBudgetListError(null);
    try {
      await api.delete(`/ppm/budgets/${id}`);
    } catch (err) {
      setBudgetListError(errorText(err));
      return;
    }
    loadBudgets();
  };

  // ── Cost item handlers ──
  const handleCostOpen = (item?: PpmCostLine) => {
    if (item) {
      setCostForm({
        description: item.description,
        category: item.category,
        actual: item.actual,
        date: item.date || "",
      });
    } else {
      setCostForm({
        description: "",
        category: "capex",
        actual: 0,
        date: todayIsoDate(),
      });
    }
    setCostSaveError(null);
    setCostDialog({ open: true, item });
  };

  const handleCostSave = () =>
    submit(async () => {
      const payload = {
        description: costForm.description,
        category: costForm.category,
        actual: costForm.actual,
        date: costForm.date || null,
      };
      try {
        if (costDialog.item) {
          await api.patch(`/ppm/costs/${costDialog.item.id}`, payload);
        } else {
          await api.post(`/ppm/initiatives/${initiativeId}/costs`, payload);
        }
      } catch (err) {
        setCostSaveError(errorText(err));
        return;
      }
      // Stryker disable next-line ObjectLiteral: a dialog state without `open` is closed
      setCostDialog({ open: false });
      costOpen.open(fiscalYearFor(payload.date, fyStart) ?? "undated");
      onRefresh();
    });

  const handleCostDelete = async (id: string) => {
    setCostListError(null);
    try {
      await api.delete(`/ppm/costs/${id}`);
    } catch (err) {
      setCostListError(errorText(err));
      return;
    }
    onRefresh();
  };

  return (
    <Box>
      {/* The totals below need the budget lines: say so when they failed to load. */}
      {budgetLoadError && (
        // Stryker disable next-line ObjectLiteral: spacing is presentation
        <Alert severity="error" sx={{ mb: 2 }}>
          {errorText(budgetLoadError)}
        </Alert>
      )}

      {/* Summary Bar */}
      <Paper
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
          columnGap: { xs: 2, sm: 4 },
          rowGap: 1.5,
          px: { xs: 2, sm: 3 },
          py: 1.5,
          mb: 3,
        }}
        variant="outlined"
      >
        <Box>
          <Typography variant="caption" color="text.secondary">
            {t("totalBudget")}
          </Typography>
          <Typography variant="h6" fontWeight={600} sx={KPI_VALUE_SX}>
            <DerivedValue tip={budgetTip}>{budgetKpi(totalBudget)}</DerivedValue>
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            {t("totalActual")}
          </Typography>
          <Typography variant="h6" fontWeight={600} sx={KPI_VALUE_SX}>
            <DerivedValue tip={actualTip}>{kpiAmount(totalActual)}</DerivedValue>
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            {t("variance")}
          </Typography>
          <Typography
            variant="h6"
            fontWeight={600}
            color={!budgetKnown ? undefined : totalActual > totalBudget ? "error" : "success.main"}
            sx={KPI_VALUE_SX}
          >
            <DerivedValue tip={varianceTip}>{budgetKpi(totalBudget - totalActual)}</DerivedValue>
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            {t("capex")}
          </Typography>
          <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
            <DerivedValue tip={actualTip}>{kpiAmount(totals.actual.capex)}</DerivedValue>
            {" / "}
            <DerivedValue tip={budgetTip}>{budgetKpi(totals.budget.capex)}</DerivedValue>
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            {t("opex")}
          </Typography>
          <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
            <DerivedValue tip={actualTip}>{kpiAmount(totals.actual.opex)}</DerivedValue>
            {" / "}
            <DerivedValue tip={budgetTip}>{budgetKpi(totals.budget.opex)}</DerivedValue>
          </Typography>
        </Box>
      </Paper>

      {/* Cumulative spend charts. Not before the budget lines are known: a
          chart without them would read as an initiative with no budget. */}
      {budgetKnown && (
        <Suspense fallback={null}>
          <PpmCostCharts costLines={costLines} budgetLines={budgetLines} />
        </Suspense>
      )}

      {/* ── Planned Budget ── */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
        <Typography variant="subtitle1" fontWeight={600}>
          {t("plannedBudget")}
        </Typography>
        <Button
          variant="contained"
          size="small"
          startIcon={<MaterialSymbol icon="add" size={18} />}
          onClick={() => handleBudgetOpen()}
        >
          {t("addBudgetLine")}
        </Button>
      </Box>

      {budgetListError && (
        // Stryker disable next-line ObjectLiteral: spacing is presentation
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => setBudgetListError(null)}>
          {budgetListError}
        </Alert>
      )}

      <BudgetTable
        groups={budgetGroups}
        known={budgetKnown}
        loading={budgetLoading}
        derived={
          budgetDerived
            ? { rows: derivedYearGroups(rollup, "budget"), totals: totals.budget }
            : null
        }
        derivedCount={count}
        expanded={budgetOpen.expanded}
        onToggle={budgetOpen.toggle}
        onAdd={(fiscalYear) => handleBudgetOpen(undefined, { fiscalYear })}
        onEdit={(line) => handleBudgetOpen(line)}
        onDelete={handleBudgetDelete}
      />

      <Divider sx={{ my: 2 }} />

      {/* ── Cost Items (Actuals) ── */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
        <Typography variant="subtitle1" fontWeight={600}>
          {t("costItems")}
        </Typography>
        <Button
          variant="contained"
          size="small"
          startIcon={<MaterialSymbol icon="add" size={18} />}
          onClick={() => handleCostOpen()}
        >
          {t("addCostItem")}
        </Button>
      </Box>

      {costListError && (
        // Stryker disable next-line ObjectLiteral: spacing is presentation
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => setCostListError(null)}>
          {costListError}
        </Alert>
      )}

      <CostTable
        groups={costGroups}
        derived={
          // Stryker disable next-line StringLiteral: equivalent, derivedYearGroups reads the budget figures only for side "budget" and the actuals for any other value
          actualDerived ? { rows: derivedYearGroups(rollup, "cost"), totals: totals.actual } : null
        }
        derivedCount={count}
        expanded={costOpen.expanded}
        onToggle={costOpen.toggle}
        onEdit={(line) => handleCostOpen(line)}
        onDelete={handleCostDelete}
      />

      {/* Budget Dialog */}
      {budgetDialog.open && (
        <Dialog
          open
          onClose={() => setBudgetDialog({ open: false })}
          maxWidth="sm"
          fullWidth
          fullScreen={fullScreen}
        >
          <DialogTitle>
            {budgetDialog.item ? t("editBudgetLine") : t("addBudgetLine")}
          </DialogTitle>
          <DialogContent>
            {budgetSaveError && (
              // Stryker disable next-line ObjectLiteral: spacing is presentation
              <Alert severity="error" sx={{ mb: 1 }}>
                {budgetSaveError}
              </Alert>
            )}
            <Box display="flex" flexDirection="column" gap={2} mt={1}>
              <TextField
                label={t("fiscalYear")}
                type="number"
                value={budgetForm.fiscal_year}
                onChange={(e) =>
                  setBudgetForm({
                    ...budgetForm,
                    fiscal_year: Number(e.target.value),
                  })
                }
                size="small"
              />
              <TextField
                label={t("common:labels.description")}
                value={budgetForm.description}
                onChange={(e) =>
                  setBudgetForm({ ...budgetForm, description: e.target.value })
                }
                fullWidth
                size="small"
              />
              <FormControl size="small">
                <InputLabel id="ppm-budget-category-label">{t("category")}</InputLabel>
                <Select
                  labelId="ppm-budget-category-label"
                  value={budgetForm.category}
                  label={t("category")}
                  onChange={(e) =>
                    setBudgetForm({
                      ...budgetForm,
                      category: e.target.value as "capex" | "opex",
                    })
                  }
                >
                  <MenuItem value="capex">{t("capex")}</MenuItem>
                  <MenuItem value="opex">{t("opex")}</MenuItem>
                </Select>
              </FormControl>
              <TextField
                label={t("amount")}
                type="number"
                value={budgetForm.amount || ""}
                onChange={(e) =>
                  setBudgetForm({
                    ...budgetForm,
                    amount: Number(e.target.value) || 0,
                  })
                }
                size="small"
              />
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setBudgetDialog({ open: false })}>
              {t("common:actions.cancel", "Cancel")}
            </Button>
            <Button variant="contained" onClick={handleBudgetSave} disabled={saving}>
              {t("common:actions.save", "Save")}
            </Button>
          </DialogActions>
        </Dialog>
      )}

      {/* Cost Item Dialog */}
      {costDialog.open && (
        <Dialog
          open
          onClose={() => setCostDialog({ open: false })}
          maxWidth="sm"
          fullWidth
          fullScreen={fullScreen}
        >
          <DialogTitle>
            {costDialog.item ? t("editCostLine") : t("addCostItem")}
          </DialogTitle>
          <DialogContent>
            {costSaveError && (
              // Stryker disable next-line ObjectLiteral: spacing is presentation
              <Alert severity="error" sx={{ mb: 1 }}>
                {costSaveError}
              </Alert>
            )}
            <Box display="flex" flexDirection="column" gap={2} mt={1}>
              <TextField
                label={t("common:labels.description")}
                value={costForm.description}
                onChange={(e) =>
                  setCostForm({ ...costForm, description: e.target.value })
                }
                fullWidth
                size="small"
              />
              <FormControl size="small">
                <InputLabel id="ppm-cost-category-label">{t("category")}</InputLabel>
                <Select
                  labelId="ppm-cost-category-label"
                  value={costForm.category}
                  label={t("category")}
                  onChange={(e) =>
                    setCostForm({
                      ...costForm,
                      category: e.target.value as "capex" | "opex",
                    })
                  }
                >
                  <MenuItem value="capex">{t("capex")}</MenuItem>
                  <MenuItem value="opex">{t("opex")}</MenuItem>
                </Select>
              </FormControl>
              <DateField
                label={t("date")}
                value={costForm.date}
                onChange={(v) => setCostForm({ ...costForm, date: v })}
                size="small"
              />
              <TextField
                label={t("amount")}
                type="number"
                value={costForm.actual || ""}
                onChange={(e) =>
                  setCostForm({
                    ...costForm,
                    actual: Number(e.target.value) || 0,
                  })
                }
                size="small"
              />
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCostDialog({ open: false })}>
              {t("common:actions.cancel", "Cancel")}
            </Button>
            <Button variant="contained" onClick={handleCostSave} disabled={saving}>
              {t("common:actions.save", "Save")}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}
