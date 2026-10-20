import { Fragment, useState, useMemo, lazy, Suspense } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import LinkifiedText from "@/components/LinkifiedText";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableFooter from "@mui/material/TableFooter";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
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
import LinearProgress from "@mui/material/LinearProgress";
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
import { useDateFormat } from "@/hooks/useDateFormat";
import { useFiscalYearStart } from "@/hooks/useFiscalYearStart";
import { fiscalYearLabel } from "@/lib/fiscalYear";
import { bucketFor, currentFiscalYear, fiscalYearFor } from "./costChartData";
import {
  defaultExpandedKey,
  grandTotals,
  groupBudgetLines,
  groupCostLines,
  type GroupKey,
} from "./costTableGroups";
import DerivedValue from "./DerivedValue";
import { compactAmount } from "./ppmPortfolioFormat";
import {
  derivedYearGroups,
  financialTotals,
  type DerivedSide,
  type DerivedYearRow,
} from "./derivedFinancials";
import type { PpmCostLine, PpmBudgetLine, PpmRollupOut } from "@/types";

// Lazy: PpmProjectDetail imports every tab eagerly, so a static import would
// pull Recharts into the PPM route chunk even for visitors who never open
// this tab.
const PpmCostCharts = lazy(() => import("./PpmCostCharts"));

/** Stable stand-in until the budget lines have loaded. */
const NO_BUDGET_LINES: PpmBudgetLine[] = [];
// Stryker disable next-line ObjectLiteral: spacing is presentation
const LOADING_CELL_SX = { py: 2 } as const;
// Stryker disable next-line ObjectLiteral: spacing is presentation
const EMPTY_CELL_SX = { py: 2 } as const;
// Stryker disable next-line ObjectLiteral: spacing is presentation
const LINE_COUNT_SX = { ml: 0.5 } as const;
// Stryker disable next-line ObjectLiteral: spacing is presentation
const DESCRIPTION_CELL_SX = { maxWidth: 240 } as const;
// Stryker disable next-line ObjectLiteral: typography is presentation
const NUM_SX = { fontVariantNumeric: "tabular-nums" } as const;
// Stryker disable next-line ObjectLiteral: typography is presentation
const SUBTOTAL_SX = { fontVariantNumeric: "tabular-nums", fontWeight: 700 } as const;
// Stryker disable next-line ObjectLiteral: colour is presentation
const YEAR_ROW_SX = { bgcolor: "action.hover" } as const;
// Stryker disable next-line ObjectLiteral: colour is presentation
const FOOTER_ROW_SX = { bgcolor: "action.selected" } as const;
// Stryker disable next-line ObjectLiteral: typography is presentation
const FOOTER_CELL_SX = {
  fontVariantNumeric: "tabular-nums",
  fontWeight: 700,
  color: "text.primary",
  fontSize: "0.875rem",
} as const;
/** A figure summed from the initiatives beneath reads italic. */
const DERIVED_NUM_SX = { ...NUM_SX, fontStyle: "italic" } as const;
const DERIVED_FOOTER_CELL_SX = { ...FOOTER_CELL_SX, fontStyle: "italic" } as const;
/** The caption heading a derived table: what it is and where it comes from. */
// Stryker disable next-line ObjectLiteral: layout of the glyph beside the caption is presentation
const DERIVED_CAPTION_SX = { display: "flex", alignItems: "center", gap: 0.5 } as const;

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
  const { formatDate } = useDateFormat();
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
  const budgetFigure = (n: number) => (budgetKnown ? fmt.format(n) : "\u2014");
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
  const budgetGrand = useMemo(() => grandTotals(budgetGroups), [budgetGroups]);
  const costGrand = useMemo(() => grandTotals(costGroups), [costGroups]);
  // A derived table's footer is the derived side's total, in italic.
  const budgetFooter = budgetDerived ? totals.budget : budgetGrand;
  const budgetFooterSx = budgetDerived ? DERIVED_FOOTER_CELL_SX : FOOTER_CELL_SX;
  const costFooter = actualDerived ? totals.actual : costGrand;
  const costFooterSx = actualDerived ? DERIVED_FOOTER_CELL_SX : FOOTER_CELL_SX;
  const budgetOpen = useExpandedGroups(defaultExpandedKey(budgetGroups, currentFy));
  const costOpen = useExpandedGroups(defaultExpandedKey(costGroups, currentFy));
  const groupLabel = (key: GroupKey) =>
    key === "undated" ? t("undated") : fiscalYearLabel(key, fyStart, t);

  /**
   * In place of an empty table's "no lines" row: one read-only row per fiscal
   * year of the initiatives beneath, under a caption saying so. No toggles,
   * no edit or delete — adding a line of its own is how the initiative takes
   * the figure back.
   */
  const derivedTableRows = (side: DerivedSide, rows: DerivedYearRow[], labelSpan: number) => (
    <>
      <TableRow data-derived={side}>
        <TableCell colSpan={labelSpan + 4}>
          <Box sx={DERIVED_CAPTION_SX}>
            <MaterialSymbol icon="subdirectory_arrow_right" size={18} />
            <Typography variant="body2" color="text.secondary">
              {t(side === "budget" ? "derivedBudgetCaption" : "derivedCostCaption", { count })}
            </Typography>
          </Box>
        </TableCell>
      </TableRow>
      {rows.map((row) => (
        <TableRow key={row.key} data-derived-row={side}>
          <TableCell colSpan={labelSpan}>{groupLabel(row.key)}</TableCell>
          <TableCell align="right" sx={DERIVED_NUM_SX}>
            {fmt.format(row.capex)}
          </TableCell>
          <TableCell align="right" sx={DERIVED_NUM_SX}>
            {fmt.format(row.opex)}
          </TableCell>
          <TableCell align="right" sx={DERIVED_NUM_SX}>
            {fmt.format(row.total)}
          </TableCell>
          <TableCell />
        </TableRow>
      ))}
    </>
  );

  /**
   * A line's amount under its category's column; one whose category is
   * neither shows it under Total, the only figure it counts towards.
   */
  const amountCells = (amount: number, category: string) => {
    const bucket = bucketFor(category);
    const text = fmt.format(amount);
    return (
      <>
        <TableCell align="right" sx={NUM_SX}>
          {bucket === "capex" ? text : ""}
        </TableCell>
        <TableCell align="right" sx={NUM_SX}>
          {bucket === "opex" ? text : ""}
        </TableCell>
        <TableCell align="right" sx={NUM_SX}>
          {bucket === null ? text : ""}
        </TableCell>
      </>
    );
  };

  /** The first cell of a year's header row: its toggle, name and line count. */
  const groupTitleCell = (
    key: GroupKey,
    count: number,
    open: boolean,
    onToggle: () => void,
    colSpan = 1,
  ) => {
    const label = groupLabel(key);
    return (
      <TableCell colSpan={colSpan}>
        <Box display="flex" alignItems="center" gap={0.5}>
          <IconButton
            size="small"
            aria-expanded={open}
            aria-label={t("toggleYear", { year: label })}
            onClick={onToggle}
          >
            <MaterialSymbol icon={open ? "expand_more" : "chevron_right"} size={18} />
          </IconButton>
          <Typography variant="body2" fontWeight={700}>
            {label}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={LINE_COUNT_SX}>
            {t("lineCount", { count })}
          </Typography>
        </Box>
      </TableCell>
    );
  };

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

      <TableContainer
        data-testid="ppm-budget-table"
        component={Paper}
        variant="outlined"
        sx={{ mb: 3, WebkitOverflowScrolling: "touch" }}
      >
        <Table size="small" sx={{ minWidth: { xs: 660, md: "auto" } }}>
          <TableHead>
            <TableRow>
              <TableCell>{t("common:labels.description")}</TableCell>
              <TableCell align="right">{t("capex")}</TableCell>
              <TableCell align="right">{t("opex")}</TableCell>
              <TableCell align="right">{t("total")}</TableCell>
              <TableCell width={80} />
            </TableRow>
          </TableHead>
          <TableBody>
            {budgetGroups.map((g) => {
              const open = budgetOpen.expanded.has(g.key);
              const year = g.key as number;
              return (
                <Fragment key={g.key}>
                  <TableRow sx={YEAR_ROW_SX}>
                    {groupTitleCell(g.key, g.lines.length, open, () => budgetOpen.toggle(g.key))}
                    <TableCell align="right" sx={SUBTOTAL_SX}>
                      {fmt.format(g.totals.capex)}
                    </TableCell>
                    <TableCell align="right" sx={SUBTOTAL_SX}>
                      {fmt.format(g.totals.opex)}
                    </TableCell>
                    <TableCell align="right" sx={SUBTOTAL_SX}>
                      {fmt.format(g.totals.total)}
                    </TableCell>
                    <TableCell>
                      <IconButton
                        size="small"
                        aria-label={t("addLineForYear", { year: groupLabel(g.key) })}
                        onClick={() => handleBudgetOpen(undefined, { fiscalYear: year })}
                      >
                        <MaterialSymbol icon="add" size={16} />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                  {open &&
                    g.lines.map((bl) => (
                      <TableRow key={bl.id} hover>
                        <TableCell sx={DESCRIPTION_CELL_SX}>
                          <Typography variant="body2" noWrap title={bl.description ?? ""}>
                            <LinkifiedText text={bl.description ?? ""} />
                          </Typography>
                        </TableCell>
                        {amountCells(bl.amount, bl.category)}
                        <TableCell>
                          <Box display="flex" gap={0.5}>
                            <IconButton
                              size="small"
                              aria-label={t("common:actions.edit")}
                              onClick={() => handleBudgetOpen(bl)}
                            >
                              <MaterialSymbol icon="edit" size={16} />
                            </IconButton>
                            <IconButton
                              size="small"
                              aria-label={t("common:actions.delete")}
                              onClick={() => handleBudgetDelete(bl.id)}
                            >
                              <MaterialSymbol icon="delete" size={16} />
                            </IconButton>
                          </Box>
                        </TableCell>
                      </TableRow>
                    ))}
                </Fragment>
              );
            })}
            {!budgetKnown && budgetLoading && (
              <TableRow>
                <TableCell colSpan={5} sx={LOADING_CELL_SX}>
                  <LinearProgress />
                </TableCell>
              </TableRow>
            )}
            {budgetDerived && derivedTableRows("budget", derivedYearGroups(rollup, "budget"), 1)}
            {budgetKnown && budgetLines.length === 0 && !budgetDerived && (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    {t("noBudgetLines")}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          {(!budgetKnown || budgetLines.length > 0 || budgetDerived) && (
            <TableFooter>
              <TableRow sx={FOOTER_ROW_SX}>
                <TableCell sx={FOOTER_CELL_SX}>{t("totalAllYears")}</TableCell>
                <TableCell align="right" sx={budgetFooterSx}>
                  {budgetFigure(budgetFooter.capex)}
                </TableCell>
                <TableCell align="right" sx={budgetFooterSx}>
                  {budgetFigure(budgetFooter.opex)}
                </TableCell>
                <TableCell align="right" sx={budgetFooterSx}>
                  {budgetFigure(budgetFooter.total)}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </TableContainer>

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

      <TableContainer
        data-testid="ppm-cost-table"
        component={Paper}
        variant="outlined"
        sx={{ WebkitOverflowScrolling: "touch" }}
      >
        <Table size="small" sx={{ minWidth: { xs: 660, md: "auto" } }}>
          <TableHead>
            <TableRow>
              <TableCell>{t("common:labels.description")}</TableCell>
              <TableCell>{t("date")}</TableCell>
              <TableCell align="right">{t("capex")}</TableCell>
              <TableCell align="right">{t("opex")}</TableCell>
              <TableCell align="right">{t("total")}</TableCell>
              <TableCell width={80} />
            </TableRow>
          </TableHead>
          <TableBody>
            {costGroups.map((g) => {
              const open = costOpen.expanded.has(g.key);
              return (
                <Fragment key={g.key}>
                  <TableRow sx={YEAR_ROW_SX}>
                    {groupTitleCell(g.key, g.lines.length, open, () => costOpen.toggle(g.key), 2)}
                    <TableCell align="right" sx={SUBTOTAL_SX}>
                      {fmt.format(g.totals.capex)}
                    </TableCell>
                    <TableCell align="right" sx={SUBTOTAL_SX}>
                      {fmt.format(g.totals.opex)}
                    </TableCell>
                    <TableCell align="right" sx={SUBTOTAL_SX}>
                      {fmt.format(g.totals.total)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                  {open &&
                    g.lines.map((cl) => (
                      <TableRow key={cl.id} hover>
                        <TableCell sx={DESCRIPTION_CELL_SX}>
                          <Typography variant="body2" noWrap title={cl.description}>
                            <LinkifiedText text={cl.description} />
                          </Typography>
                        </TableCell>
                        <TableCell>{cl.date ? formatDate(cl.date) : "\u2014"}</TableCell>
                        {amountCells(cl.actual, cl.category)}
                        <TableCell>
                          <Box display="flex" gap={0.5}>
                            <IconButton
                              size="small"
                              aria-label={t("common:actions.edit")}
                              onClick={() => handleCostOpen(cl)}
                            >
                              <MaterialSymbol icon="edit" size={16} />
                            </IconButton>
                            <IconButton
                              size="small"
                              aria-label={t("common:actions.delete")}
                              onClick={() => handleCostDelete(cl.id)}
                            >
                              <MaterialSymbol icon="delete" size={16} />
                            </IconButton>
                          </Box>
                        </TableCell>
                      </TableRow>
                    ))}
                </Fragment>
              );
            })}
            {actualDerived && derivedTableRows("cost", derivedYearGroups(rollup, "cost"), 2)}
            {costLines.length === 0 && !actualDerived && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={EMPTY_CELL_SX}>
                  <Typography variant="body2" color="text.secondary">
                    {t("noCostLines")}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          {(costLines.length > 0 || actualDerived) && (
            <TableFooter>
              <TableRow sx={FOOTER_ROW_SX}>
                <TableCell colSpan={2} sx={FOOTER_CELL_SX}>
                  {t("totalAllYears")}
                </TableCell>
                <TableCell align="right" sx={costFooterSx}>
                  {fmt.format(costFooter.capex)}
                </TableCell>
                <TableCell align="right" sx={costFooterSx}>
                  {fmt.format(costFooter.opex)}
                </TableCell>
                <TableCell align="right" sx={costFooterSx}>
                  {fmt.format(costFooter.total)}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </TableContainer>

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
