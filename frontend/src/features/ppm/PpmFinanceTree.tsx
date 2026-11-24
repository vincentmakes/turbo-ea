import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import LinkifiedText from "@/components/LinkifiedText";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useFiscalYearStart } from "@/hooks/useFiscalYearStart";
import { fiscalYearLabel } from "@/lib/fiscalYear";
import type {
  PpmFinancialBudget,
  PpmFinancialCost,
  PpmFinancials,
  PpmInvoice,
  PpmRollupOut,
} from "@/types";
import PpmFinancialRowForm from "./PpmFinancialRowForm";
import { usePpmFinancialAmount } from "./usePpmFinancials";

type FinancialRow = PpmFinancialBudget | PpmFinancialCost | PpmInvoice;
type FormState = {
  kind: "budget" | "cost" | "invoice";
  mode: "create" | "edit" | "move";
  parentId?: string;
  row?: FinancialRow;
};

interface Props {
  data?: PpmFinancials;
  rollup: PpmRollupOut | null;
  readOnly?: boolean;
  expandAll?: boolean;
  onChanged: () => void;
}

export default function PpmFinanceTree({
  data,
  rollup,
  readOnly = false,
  expandAll = false,
  onChanged,
}: Props) {
  const { t } = useTranslation(["ppm", "common"]);
  const amount = usePpmFinancialAmount();
  const { formatDate } = useDateFormat();
  const { month: fiscalYearStart } = useFiscalYearStart();
  const yearLabel = (year: number | null) =>
    year === null ? t("undated") : fiscalYearLabel(year, fiscalYearStart, t);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletePath, setDeletePath] = useState<string | null>(null);
  if (!data) return null;

  const costsByBudget = new Map<string, PpmFinancialCost[]>();
  const legacy: PpmFinancialCost[] = [];
  for (const cost of data.cost_items) {
    if (!cost.budget_line_id) {
      legacy.push(cost);
      continue;
    }
    const costs = costsByBudget.get(cost.budget_line_id) ?? [];
    costs.push(cost);
    costsByBudget.set(cost.budget_line_id, costs);
  }
  const invoicesByCost = new Map<string, PpmInvoice[]>();
  for (const invoice of data.invoices ?? []) {
    const invoices = invoicesByCost.get(invoice.cost_item_id) ?? [];
    invoices.push(invoice);
    invoicesByCost.set(invoice.cost_item_id, invoices);
  }

  const toggle = (id: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const open = (id: string) => expandAll || expanded.has(id);
  const show = (
    kind: FormState["kind"],
    mode: FormState["mode"],
    row?: FinancialRow,
    parentId?: string,
  ) => {
    if (parentId) setExpanded((previous) => new Set([...previous, parentId]));
    setForm({ kind, mode, row, parentId });
  };
  const remove = async () => {
    if (!deletePath) return;
    setError(null);
    try {
      await api.delete(deletePath);
      setDeletePath(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common:errors.generic"));
    }
  };
  const label = (budget: PpmFinancialBudget) => {
    if (budget.description) return budget.description;
    const prefix = budget.id.slice(0, 8);
    const duplicate = data.budget_lines.some(
      (other) => other.id !== budget.id && other.id.startsWith(prefix),
    );
    return [
      yearLabel(budget.fiscal_year),
      budget.category.toUpperCase(),
      duplicate ? budget.id : prefix,
    ].join(" · ");
  };
  const columns = (kind: "budget" | "cost_item" | "invoice") => {
    const config = data.field_definitions?.[kind];
    return (config?.visible_columns ?? [])
      .map((key) => config?.fields.find((field) => field.key === key))
      .filter((field): field is NonNullable<typeof field> => !!field);
  };
  const customCells = (
    row: FinancialRow,
    kind: "budget" | "cost_item" | "invoice",
  ) =>
    columns(kind).map((field) => {
      const reference = row.reference_display?.[field.key];
      const value =
        reference?.name ??
        row.calculated_values?.[field.key] ??
        row.field_values?.[field.key];
      const option = field.options?.find((item) => item.id === value);
      return (
        <TableCell key={field.key}>
          {value == null && !reference
            ? "—"
            : (option?.label ??
              String(value ?? t("financialForm.unavailable")))}
        </TableCell>
      );
    });
  const customHeaders = (kind: "budget" | "cost_item" | "invoice") =>
    columns(kind).map((field) => (
      <TableCell key={field.key}>{field.label}</TableCell>
    ));
  const action = (name: string, icon: string, click: () => void) =>
    !readOnly && (
      <IconButton size="small" aria-label={name} onClick={click}>
        <MaterialSymbol icon={icon} size={18} />
      </IconButton>
    );
  const expand = (id: string, name: string) =>
    !expandAll && (
      <IconButton
        size="small"
        aria-label={t(
          open(id) ? "financeTree.collapse" : "financeTree.expand",
          { name },
        )}
        aria-expanded={open(id)}
        onClick={() => toggle(id)}
      >
        <MaterialSymbol
          icon={open(id) ? "expand_less" : "expand_more"}
          size={18}
        />
      </IconButton>
    );
  const invoiceTable = (cost: PpmFinancialCost) => (
    <TableContainer sx={{ overflowX: "auto" }}>
      <Table
        size="small"
        aria-label={t("financeTree.invoices")}
        sx={expandAll ? undefined : { minWidth: 560 }}
      >
        <TableHead sx={{ bgcolor: "action.hover" }}>
          <TableRow>
            <TableCell>{t("financialForm.invoiceId")}</TableCell>
            <TableCell>{t("financialForm.invoiceDate")}</TableCell>
            <TableCell>{t("amount")}</TableCell>
            {customHeaders("invoice")}
            {!readOnly && <TableCell />}
          </TableRow>
        </TableHead>
        <TableBody>
          {(invoicesByCost.get(cost.id) ?? []).map((invoice) => (
            <TableRow key={invoice.id}>
              <TableCell>{invoice.invoice_id}</TableCell>
              <TableCell>{formatDate(invoice.invoice_date)}</TableCell>
              <TableCell>{amount(invoice.amount)}</TableCell>
              {customCells(invoice, "invoice")}
              {!readOnly && (
                <TableCell>
                  {action(
                    t("financeTree.editInvoice", { name: invoice.invoice_id }),
                    "edit",
                    () => show("invoice", "edit", invoice, cost.id),
                  )}
                  {action(
                    t("financeTree.moveInvoice", { name: invoice.invoice_id }),
                    "drive_file_move",
                    () => show("invoice", "move", invoice, cost.id),
                  )}
                  {action(
                    t("financeTree.deleteInvoice", {
                      name: invoice.invoice_id,
                    }),
                    "delete",
                    () => setDeletePath("/ppm/invoices/" + invoice.id),
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
  const costTable = (costs: PpmFinancialCost[]) => (
    <TableContainer sx={{ overflowX: "auto" }}>
      <Table
        size="small"
        aria-label={t("costItems")}
        sx={expandAll ? undefined : { minWidth: 850 }}
      >
        <TableHead sx={{ bgcolor: "action.hover" }}>
          <TableRow>
            <TableCell>{t("common:labels.description")}</TableCell>
            {customHeaders("cost_item")}
            <TableCell>{t("financialForm.providerChild")}</TableCell>
            <TableCell>{t("category")}</TableCell>
            <TableCell>{t("financeTree.costDate")}</TableCell>
            <TableCell>{t("actual")}</TableCell>
            <TableCell>{t("financeTree.invoiced")}</TableCell>
            <TableCell>{t("financeTree.remaining")}</TableCell>
            {!readOnly && <TableCell />}
          </TableRow>
        </TableHead>
        <TableBody>
          {costs.map((cost) => (
            <Fragment key={cost.id}>
              <TableRow
                sx={open(cost.id) ? { bgcolor: "action.hover" } : undefined}
              >
                <TableCell>
                  {data.invoice_access && expand(cost.id, cost.description)}{" "}
                  <LinkifiedText text={cost.description} />
                </TableCell>
                {customCells(cost, "cost_item")}
                <TableCell>{cost.provider?.name ?? "—"}</TableCell>
                <TableCell>{cost.category.toUpperCase()}</TableCell>
                <TableCell>{cost.date ? formatDate(cost.date) : "—"}</TableCell>
                <TableCell>{amount(cost.actual)}</TableCell>
                <TableCell>
                  {data.invoice_access ? amount(cost.total_invoiced) : "—"}
                </TableCell>
                <TableCell>
                  {data.invoice_access
                    ? amount(cost.remaining_to_invoice)
                    : "—"}
                </TableCell>
                {!readOnly && (
                  <TableCell>
                    {action(
                      t("financeTree.editCost", { name: cost.description }),
                      "edit",
                      () =>
                        show(
                          "cost",
                          "edit",
                          cost,
                          cost.budget_line_id ?? undefined,
                        ),
                    )}
                    {action(
                      t(
                        cost.budget_line_id
                          ? "financeTree.moveCost"
                          : "financeTree.assignCost",
                        { name: cost.description },
                      ),
                      "drive_file_move",
                      () =>
                        show(
                          "cost",
                          "move",
                          cost,
                          cost.budget_line_id ?? undefined,
                        ),
                    )}
                    {data.invoice_access &&
                      action(
                        t("financeTree.recordInvoice", {
                          name: cost.description,
                        }),
                        "receipt_long",
                        () => show("invoice", "create", undefined, cost.id),
                      )}
                    {data.invoice_access &&
                      action(
                        t("financeTree.deleteCost", { name: cost.description }),
                        "delete",
                        () => setDeletePath("/ppm/costs/" + cost.id),
                      )}
                  </TableCell>
                )}
              </TableRow>
              {data.invoice_access && (
                <TableRow>
                  <TableCell
                    colSpan={
                      7 + columns("cost_item").length + (readOnly ? 0 : 1)
                    }
                    sx={{ py: 0, borderBottom: 0 }}
                  >
                    <Collapse in={open(cost.id)} unmountOnExit>
                      <Box sx={{ ml: 3, my: 1 }}>{invoiceTable(cost)}</Box>
                    </Collapse>
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
  return (
    <Box>
      {error && !deletePath && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        mb={1}
      >
        <Typography
          variant="subtitle1"
          fontWeight={600}
          data-export-heading={expandAll || undefined}
        >
          {t("plannedBudget")}
        </Typography>
        {!readOnly && (
          <Button onClick={() => show("budget", "create")}>
            {t("addBudgetLine")}
          </Button>
        )}
      </Box>
      {!data.budget_lines.length && (
        <Alert severity="info">{t("financeTree.noBudgets")}</Alert>
      )}
      {data.invoice_access && (
        <Typography sx={{ mb: 1 }}>
          {t("financeTree.initiativeInvoiced")}: {amount(data.actual_invoiced)}
        </Typography>
      )}
      <TableContainer
        component={Paper}
        tabIndex={0}
        role="region"
        aria-label={t("financeTree.item")}
        sx={{ overflowX: "auto" }}
      >
        <Table
          size="small"
          sx={{ tableLayout: "fixed", minWidth: expandAll ? undefined : 900 }}
        >
          <TableHead>
            <TableRow>
              <TableCell>{t("financeTree.item")}</TableCell>
              <TableCell>{t("plannedBudget")}</TableCell>
              <TableCell>{t("costItems")}</TableCell>
              <TableCell>{t("financeTree.remainingBudget")}</TableCell>
              <TableCell>{t("financeTree.invoiced")}</TableCell>
              <TableCell>{t("financeTree.remaining")}</TableCell>
              {!readOnly && <TableCell />}
            </TableRow>
          </TableHead>
          <TableBody>
            {data.budget_lines.map((budget) => (
              <Fragment key={budget.id}>
                <TableRow
                  sx={open(budget.id) ? { bgcolor: "action.hover" } : undefined}
                >
                  <TableCell>
                    {expand(budget.id, label(budget))}{" "}
                    <LinkifiedText text={label(budget)} />{" "}
                    {budget.description && (
                      <Typography variant="caption" display="block">
                        {yearLabel(budget.fiscal_year)} ·{" "}
                        {budget.category.toUpperCase()}
                      </Typography>
                    )}
                    {budget.provider?.name && (
                      <Typography variant="caption" display="block">
                        {budget.provider.name}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{amount(budget.amount)}</TableCell>
                  <TableCell>{amount(budget.total_cost_items)}</TableCell>
                  <TableCell>{amount(budget.remaining_budget)}</TableCell>
                  <TableCell>
                    {data.invoice_access ? amount(budget.total_invoiced) : "—"}
                  </TableCell>
                  <TableCell>
                    {data.invoice_access
                      ? amount(budget.remaining_to_invoice)
                      : "—"}
                  </TableCell>
                  {!readOnly && (
                    <TableCell>
                      {action(
                        t("financeTree.addCost", { name: label(budget) }),
                        "add",
                        () => show("cost", "create", undefined, budget.id),
                      )}
                      {action(
                        t("financeTree.editBudget", { name: label(budget) }),
                        "edit",
                        () => show("budget", "edit", budget),
                      )}
                      {action(
                        t("financeTree.deleteBudget", { name: label(budget) }),
                        "delete",
                        () => setDeletePath("/ppm/budgets/" + budget.id),
                      )}
                    </TableCell>
                  )}
                </TableRow>
                <TableRow>
                  <TableCell
                    colSpan={readOnly ? 6 : 7}
                    sx={{ py: 0, borderBottom: 0 }}
                  >
                    <Collapse in={open(budget.id)} unmountOnExit>
                      <Box sx={{ ml: 3, my: 1 }}>
                        {columns("budget").length > 0 && (
                          <TableContainer sx={{ overflowX: "auto", mb: 1 }}>
                            <Table
                              size="small"
                              aria-label={t("financeTree.budgetDetails")}
                            >
                              <TableHead sx={{ bgcolor: "action.hover" }}>
                                <TableRow>{customHeaders("budget")}</TableRow>
                              </TableHead>
                              <TableBody>
                                <TableRow>
                                  {customCells(budget, "budget")}
                                </TableRow>
                              </TableBody>
                            </Table>
                          </TableContainer>
                        )}
                        {costTable(costsByBudget.get(budget.id) ?? [])}
                      </Box>
                    </Collapse>
                  </TableCell>
                </TableRow>
              </Fragment>
            ))}
            {legacy.length > 0 && (
              <TableRow>
                <TableCell colSpan={readOnly ? 6 : 7}>
                  {expand("legacy", t("financeTree.unassigned"))}{" "}
                  <strong>{t("financeTree.unassigned")}</strong>
                </TableCell>
              </TableRow>
            )}
            {legacy.length > 0 && (
              <TableRow>
                <TableCell
                  colSpan={readOnly ? 6 : 7}
                  sx={{ py: 0, borderBottom: 0 }}
                >
                  <Collapse in={open("legacy")} unmountOnExit>
                    <Box sx={{ ml: 3, my: 1 }}>{costTable(legacy)}</Box>
                  </Collapse>
                </TableCell>
              </TableRow>
            )}
            {data.budget_subtotals.map((subtotal) => (
              <TableRow key={String(subtotal.fiscal_year) + subtotal.category}>
                <TableCell>
                  {yearLabel(subtotal.fiscal_year)} ·{" "}
                  {subtotal.category.toUpperCase()}
                </TableCell>
                <TableCell>{amount(subtotal.amount)}</TableCell>
                <TableCell>{amount(subtotal.total_cost_items)}</TableCell>
                <TableCell>{amount(subtotal.remaining_budget)}</TableCell>
                <TableCell>
                  {data.invoice_access ? amount(subtotal.total_invoiced) : "—"}
                </TableCell>
                <TableCell>
                  {data.invoice_access
                    ? amount(subtotal.remaining_to_invoice)
                    : "—"}
                </TableCell>
                {!readOnly && <TableCell />}
              </TableRow>
            ))}
            <TableRow>
              <TableCell>
                <strong>{t("financeTree.total")}</strong>
              </TableCell>
              <TableCell>{amount(data.budget_totals.amount)}</TableCell>
              <TableCell>
                {amount(data.budget_totals.total_cost_items)}
              </TableCell>
              <TableCell>
                {amount(data.budget_totals.remaining_budget)}
              </TableCell>
              <TableCell>
                {data.invoice_access
                  ? amount(data.budget_totals.total_invoiced)
                  : "—"}
              </TableCell>
              <TableCell>
                {data.invoice_access
                  ? amount(data.budget_totals.remaining_to_invoice)
                  : "—"}
              </TableCell>
              {!readOnly && <TableCell />}
            </TableRow>
            {rollup &&
              !data.budget_lines.length &&
              rollup.by_year
                .filter((year) => year.capex_budget || year.opex_budget)
                .map((year) => (
                  <TableRow key={"derived-budget-" + year.year}>
                    <TableCell>
                      {t("financeTree.descendantBudget")} ·{" "}
                      {yearLabel(year.year)}
                    </TableCell>
                    <TableCell>
                      {amount(year.capex_budget + year.opex_budget)}
                    </TableCell>
                    <TableCell>—</TableCell>
                    <TableCell>—</TableCell>
                    <TableCell>—</TableCell>
                    <TableCell>—</TableCell>
                    {!readOnly && <TableCell />}
                  </TableRow>
                ))}
            {rollup &&
              !data.cost_items.length &&
              rollup.by_year
                .filter((year) => year.capex_actual || year.opex_actual)
                .map((year) => (
                  <TableRow key={"derived-actual-" + year.year}>
                    <TableCell>
                      {t("financeTree.descendantActual")} ·{" "}
                      {yearLabel(year.year)}
                    </TableCell>
                    <TableCell>—</TableCell>
                    <TableCell>
                      {amount(year.capex_actual + year.opex_actual)}
                    </TableCell>
                    <TableCell>—</TableCell>
                    <TableCell>—</TableCell>
                    <TableCell>—</TableCell>
                    {!readOnly && <TableCell />}
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog
        open={!!deletePath}
        disableRestoreFocus
        onClose={() => setDeletePath(null)}
      >
        <DialogTitle>{t("financeTree.deleteTitle")}</DialogTitle>
        <DialogContent>
          {error ? (
            <Alert severity="error">{error}</Alert>
          ) : (
            t("financeTree.deleteConfirm")
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeletePath(null)}>
            {t("common:actions.cancel")}
          </Button>
          <Button color="error" onClick={() => void remove()}>
            {t("common:actions.delete")}
          </Button>
        </DialogActions>
      </Dialog>
      {form && (
        <PpmFinancialRowForm
          initiativeId={data.initiative_id}
          data={data}
          {...form}
          onStale={() => {
            setForm(null);
            setError(t("financeTree.stale"));
            onChanged();
          }}
          onClose={() => setForm(null)}
          onSaved={(destinationId) => {
            if (destinationId) {
              const destinationCost = data.cost_items.find(
                (cost) => cost.id === destinationId,
              );
              setExpanded(
                (previous) =>
                  new Set([
                    ...previous,
                    destinationId,
                    ...(destinationCost?.budget_line_id
                      ? [destinationCost.budget_line_id]
                      : []),
                  ]),
              );
            }
            setForm(null);
            onChanged();
          }}
        />
      )}
    </Box>
  );
}
