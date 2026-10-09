import { useState, useMemo, lazy, Suspense } from "react";
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
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Chip from "@mui/material/Chip";
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
import type { PpmCostLine, PpmBudgetLine } from "@/types";

// Lazy: PpmProjectDetail imports every tab eagerly, so a static import would
// pull Recharts into the PPM route chunk even for visitors who never open
// this tab.
const PpmCostCharts = lazy(() => import("./PpmCostCharts"));

/** Stable stand-in until the budget lines have loaded. */
const NO_BUDGET_LINES: PpmBudgetLine[] = [];
// Stryker disable next-line ObjectLiteral: spacing is presentation
const LOADING_CELL_SX = { py: 2 } as const;

interface Props {
  initiativeId: string;
  costLines: PpmCostLine[];
  onRefresh: () => void;
}

export default function PpmCostTab({ initiativeId, costLines, onRefresh }: Props) {
  const { t } = useTranslation("ppm");
  const fullScreen = useFullScreenDialog();
  const { fmt } = useCurrency();
  const { formatDate } = useDateFormat();

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
  const budgetFigure = (n: number) => (budgetKnown ? fmt.format(n) : "\u2014");
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
    fiscal_year: new Date().getFullYear(),
    category: "capex" as "capex" | "opex",
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
  const totalBudget = useMemo(
    () => budgetLines.reduce((s, bl) => s + bl.amount, 0),
    [budgetLines],
  );
  const totalActual = useMemo(
    () => costLines.reduce((s, cl) => s + cl.actual, 0),
    [costLines],
  );
  const capexBudget = useMemo(
    () => budgetLines.filter((b) => b.category === "capex").reduce((s, b) => s + b.amount, 0),
    [budgetLines],
  );
  const capexActual = useMemo(
    () => costLines.filter((c) => c.category === "capex").reduce((s, c) => s + c.actual, 0),
    [costLines],
  );
  const opexBudget = useMemo(
    () => budgetLines.filter((b) => b.category === "opex").reduce((s, b) => s + b.amount, 0),
    [budgetLines],
  );
  const opexActual = useMemo(
    () => costLines.filter((c) => c.category === "opex").reduce((s, c) => s + c.actual, 0),
    [costLines],
  );

  // ── Budget handlers ──
  const handleBudgetOpen = (item?: PpmBudgetLine) => {
    if (item) {
      setBudgetForm({
        fiscal_year: item.fiscal_year,
        category: item.category,
        amount: item.amount,
      });
    } else {
      setBudgetForm({
        fiscal_year: new Date().getFullYear(),
        category: "capex",
        amount: 0,
      });
    }
    setBudgetSaveError(null);
    setBudgetDialog({ open: true, item });
  };

  const handleBudgetSave = () =>
    submit(async () => {
      try {
        if (budgetDialog.item) {
          await api.patch(`/ppm/budgets/${budgetDialog.item.id}`, budgetForm);
        } else {
          await api.post(`/ppm/initiatives/${initiativeId}/budgets`, budgetForm);
        }
      } catch (err) {
        setBudgetSaveError(errorText(err));
        return;
      }
      // Stryker disable next-line ObjectLiteral: a dialog state without `open` is closed
      setBudgetDialog({ open: false });
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
            {budgetFigure(totalBudget)}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            {t("totalActual")}
          </Typography>
          <Typography variant="h6" fontWeight={600} sx={KPI_VALUE_SX}>
            {fmt.format(totalActual)}
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
            {budgetFigure(totalBudget - totalActual)}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            {t("capex")}
          </Typography>
          <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
            {fmt.format(capexActual)} / {budgetFigure(capexBudget)}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            {t("opex")}
          </Typography>
          <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
            {fmt.format(opexActual)} / {budgetFigure(opexBudget)}
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
        component={Paper}
        variant="outlined"
        sx={{ mb: 3, WebkitOverflowScrolling: "touch" }}
      >
        <Table size="small" sx={{ minWidth: { xs: 520, md: "auto" } }}>
          <TableHead>
            <TableRow>
              <TableCell>{t("fiscalYear")}</TableCell>
              <TableCell>{t("category")}</TableCell>
              <TableCell align="right">{t("amount")}</TableCell>
              <TableCell width={80} />
            </TableRow>
          </TableHead>
          <TableBody>
            {budgetLines.map((bl) => (
              <TableRow key={bl.id} hover>
                <TableCell>
                  <Typography variant="body2" fontWeight={500}>
                    FY {bl.fiscal_year}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    label={bl.category === "capex" ? t("capex") : t("opex")}
                    size="small"
                    variant="outlined"
                  />
                </TableCell>
                <TableCell align="right">{fmt.format(bl.amount)}</TableCell>
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
            {!budgetKnown && budgetLoading && (
              <TableRow>
                <TableCell colSpan={4} sx={LOADING_CELL_SX}>
                  <LinearProgress />
                </TableCell>
              </TableRow>
            )}
            {budgetKnown && budgetLines.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} align="center" sx={{ py: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    {t("noBudgetLines")}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
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
        component={Paper}
        variant="outlined"
        sx={{ WebkitOverflowScrolling: "touch" }}
      >
        <Table size="small" sx={{ minWidth: { xs: 660, md: "auto" } }}>
          <TableHead>
            <TableRow>
              <TableCell>{t("common:labels.description")}</TableCell>
              <TableCell>{t("category")}</TableCell>
              <TableCell>{t("date")}</TableCell>
              <TableCell align="right">{t("amount")}</TableCell>
              <TableCell width={80} />
            </TableRow>
          </TableHead>
          <TableBody>
            {costLines.map((cl) => (
              <TableRow key={cl.id} hover>
                <TableCell sx={{ maxWidth: 240 }}>
                  <Typography variant="body2" noWrap title={cl.description}>
                    <LinkifiedText text={cl.description} />
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    label={cl.category === "capex" ? t("capex") : t("opex")}
                    size="small"
                    variant="outlined"
                  />
                </TableCell>
                <TableCell>
                  {cl.date ? formatDate(cl.date) : "\u2014"}
                </TableCell>
                <TableCell align="right">{fmt.format(cl.actual)}</TableCell>
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
            {costLines.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    {t("noCostLines")}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Budget Dialog */}
      {budgetDialog.open && (
        <Dialog
          open
          onClose={() => setBudgetDialog({ open: false })}
          maxWidth="xs"
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
