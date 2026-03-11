import { useState, useEffect, useCallback, useMemo } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
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
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useCurrency } from "@/hooks/useCurrency";
import type { PpmCostLine, PpmBudgetLine } from "@/types";

interface Props {
  initiativeId: string;
  costLines: PpmCostLine[];
  onRefresh: () => void;
}

export default function PpmCostTab({ initiativeId, costLines, onRefresh }: Props) {
  const { t } = useTranslation("ppm");
  const { fmt } = useCurrency();

  // ── Budget lines (planned) ──
  const [budgetLines, setBudgetLines] = useState<PpmBudgetLine[]>([]);
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

  const loadBudgets = useCallback(async () => {
    const data = await api.get<PpmBudgetLine[]>(
      `/ppm/initiatives/${initiativeId}/budgets`,
    );
    setBudgetLines(data);
  }, [initiativeId]);

  useEffect(() => {
    loadBudgets();
  }, [loadBudgets]);

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
    setBudgetDialog({ open: true, item });
  };

  const handleBudgetSave = async () => {
    if (budgetDialog.item) {
      await api.patch(`/ppm/budgets/${budgetDialog.item.id}`, budgetForm);
    } else {
      await api.post(`/ppm/initiatives/${initiativeId}/budgets`, budgetForm);
    }
    setBudgetDialog({ open: false });
    loadBudgets();
  };

  const handleBudgetDelete = async (id: string) => {
    await api.delete(`/ppm/budgets/${id}`);
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
        date: new Date().toISOString().slice(0, 10),
      });
    }
    setCostDialog({ open: true, item });
  };

  const handleCostSave = async () => {
    const payload = {
      description: costForm.description,
      category: costForm.category,
      actual: costForm.actual,
      date: costForm.date || null,
    };
    if (costDialog.item) {
      await api.patch(`/ppm/costs/${costDialog.item.id}`, payload);
    } else {
      await api.post(`/ppm/initiatives/${initiativeId}/costs`, payload);
    }
    setCostDialog({ open: false });
    onRefresh();
  };

  const handleCostDelete = async (id: string) => {
    await api.delete(`/ppm/costs/${id}`);
    onRefresh();
  };

  return (
    <Box>
      {/* Summary Bar */}
      <Paper
        sx={{
          display: "flex",
          gap: 4,
          px: 3,
          py: 1.5,
          mb: 3,
          flexWrap: "wrap",
          alignItems: "center",
        }}
        variant="outlined"
      >
        <Box>
          <Typography variant="caption" color="text.secondary">
            {t("totalBudget")}
          </Typography>
          <Typography variant="h6" fontWeight={600}>
            {fmt.format(totalBudget)}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            {t("totalActual")}
          </Typography>
          <Typography variant="h6" fontWeight={600}>
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
            color={totalActual > totalBudget ? "error" : "success.main"}
          >
            {fmt.format(totalBudget - totalActual)}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            {t("capex")}
          </Typography>
          <Typography variant="body2">
            {fmt.format(capexActual)} / {fmt.format(capexBudget)}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            {t("opex")}
          </Typography>
          <Typography variant="body2">
            {fmt.format(opexActual)} / {fmt.format(opexBudget)}
          </Typography>
        </Box>
      </Paper>

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

      <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
        <Table size="small">
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
                    <IconButton size="small" onClick={() => handleBudgetOpen(bl)}>
                      <MaterialSymbol icon="edit" size={16} />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => handleBudgetDelete(bl.id)}
                    >
                      <MaterialSymbol icon="delete" size={16} />
                    </IconButton>
                  </Box>
                </TableCell>
              </TableRow>
            ))}
            {budgetLines.length === 0 && (
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

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t("common:description", "Description")}</TableCell>
              <TableCell>{t("category")}</TableCell>
              <TableCell>{t("date")}</TableCell>
              <TableCell align="right">{t("amount")}</TableCell>
              <TableCell width={80} />
            </TableRow>
          </TableHead>
          <TableBody>
            {costLines.map((cl) => (
              <TableRow key={cl.id} hover>
                <TableCell>{cl.description}</TableCell>
                <TableCell>
                  <Chip
                    label={cl.category === "capex" ? t("capex") : t("opex")}
                    size="small"
                    variant="outlined"
                  />
                </TableCell>
                <TableCell>
                  {cl.date
                    ? new Date(cl.date).toLocaleDateString()
                    : "\u2014"}
                </TableCell>
                <TableCell align="right">{fmt.format(cl.actual)}</TableCell>
                <TableCell>
                  <Box display="flex" gap={0.5}>
                    <IconButton size="small" onClick={() => handleCostOpen(cl)}>
                      <MaterialSymbol icon="edit" size={16} />
                    </IconButton>
                    <IconButton
                      size="small"
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
        >
          <DialogTitle>
            {budgetDialog.item ? t("editBudgetLine") : t("addBudgetLine")}
          </DialogTitle>
          <DialogContent>
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
                <InputLabel>{t("category")}</InputLabel>
                <Select
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
            <Button variant="contained" onClick={handleBudgetSave}>
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
        >
          <DialogTitle>
            {costDialog.item ? t("editCostLine") : t("addCostItem")}
          </DialogTitle>
          <DialogContent>
            <Box display="flex" flexDirection="column" gap={2} mt={1}>
              <TextField
                label={t("common:description", "Description")}
                value={costForm.description}
                onChange={(e) =>
                  setCostForm({ ...costForm, description: e.target.value })
                }
                fullWidth
                size="small"
              />
              <FormControl size="small">
                <InputLabel>{t("category")}</InputLabel>
                <Select
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
              <TextField
                label={t("date")}
                type="date"
                value={costForm.date}
                onChange={(e) =>
                  setCostForm({ ...costForm, date: e.target.value })
                }
                size="small"
                slotProps={{ inputLabel: { shrink: true } }}
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
            <Button variant="contained" onClick={handleCostSave}>
              {t("common:actions.save", "Save")}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}
