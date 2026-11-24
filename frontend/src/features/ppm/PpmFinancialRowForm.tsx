import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, api, apiErrorMessage } from "@/api/client";
import CardPicker, { type CardOption } from "@/components/CardPicker";
import { DateField } from "@/components/DateField";
import { useFiscalYearStart } from "@/hooks/useFiscalYearStart";
import { useFullScreenDialog } from "@/hooks/useFullScreenDialog";
import { useSubmitOnce } from "@/hooks/useSubmitOnce";
import { todayIsoDate } from "@/lib/dates";
import type {
  PmlFieldDefinition,
  PmlProviderChoicePage,
  PpmFinancialBudget,
  PpmFinancialCost,
  PpmFinancials,
  PpmInvoice,
} from "@/types";

import { currentFiscalYear } from "./costChartData";

type FinancialRow = PpmFinancialBudget | PpmFinancialCost | PpmInvoice;
type Value = string | number | boolean | null;
interface Props {
  initiativeId: string;
  data: PpmFinancials;
  kind: "budget" | "cost" | "invoice";
  mode: "create" | "edit" | "move";
  parentId?: string;
  row?: FinancialRow;
  onClose: () => void;
  onSaved: (destinationId?: string) => void;
  onStale?: () => void;
}
const isBudget = (row: FinancialRow | undefined): row is PpmFinancialBudget =>
  !!row && "fiscal_year" in row;
const isCost = (row: FinancialRow | undefined): row is PpmFinancialCost =>
  !!row && "budget_line_id" in row;
const isInvoice = (row: FinancialRow | undefined): row is PpmInvoice =>
  !!row && "invoice_id" in row;

export default function PpmFinancialRowForm({
  initiativeId,
  data,
  kind,
  mode,
  parentId,
  row,
  onClose,
  onSaved,
  onStale,
}: Props) {
  const { t } = useTranslation(["ppm", "common"]);
  const fullScreen = useFullScreenDialog();
  const { month: fiscalYearStart } = useFiscalYearStart();
  const submit = useSubmitOnce();
  const budget = isBudget(row) ? row : undefined;
  const cost = isCost(row) ? row : undefined;
  const invoice = isInvoice(row) ? row : undefined;
  const [description, setDescription] = useState(budget?.description ?? cost?.description ?? "");
  const [category, setCategory] = useState<string>(budget?.category ?? cost?.category ?? "opex");
  const [year, setYear] = useState(
    String(budget?.fiscal_year ?? currentFiscalYear(new Date(), fiscalYearStart)),
  );
  const [amount, setAmount] = useState(invoice?.amount ?? budget?.amount ?? "");
  const [planned, setPlanned] = useState(cost?.planned ?? "0");
  const [actual, setActual] = useState(cost?.actual ?? "0");
  const [date, setDate] = useState(
    invoice?.invoice_date ??
      (cost ? (cost.date ?? "") : kind === "cost" && mode === "create" ? todayIsoDate() : ""),
  );
  const [invoiceId, setInvoiceId] = useState(invoice?.invoice_id ?? "");
  const [destination, setDestination] = useState(
    cost?.budget_line_id ?? invoice?.cost_item_id ?? parentId ?? "",
  );
  const [fieldValues, setFieldValues] = useState<Record<string, Value>>(
    (row?.field_values ?? {}) as Record<string, Value>,
  );
  const [changedFields, setChangedFields] = useState<Set<string>>(new Set());
  const [providerChanged, setProviderChanged] = useState(false);
  const [provider, setProvider] = useState<CardOption | null>(
    cost?.provider_child_id && cost.provider?.id && cost.provider.name
      ? { id: cost.provider.id, name: cost.provider.name, type: "Provider" }
      : null,
  );
  const [error, setError] = useState<string | null>(null);
  const section = kind === "cost" ? "cost_item" : kind;
  const definitions = data.field_definitions?.[section]?.fields ?? [];
  const currentBudgetId = mode === "move" ? destination : (cost?.budget_line_id ?? parentId);
  const parentBudget = data.budget_lines.find((item) => item.id === currentBudgetId);
  const childEnabled = kind === "cost" && !!parentBudget?.provider_child_enabled;
  const searchChildren = useCallback(
    async (params: URLSearchParams) => {
      const query = new URLSearchParams(params);
      query.delete("type");
      const page = await api.get<PmlProviderChoicePage>(
        "/ppm/initiatives/" +
          initiativeId +
          "/budgets/" +
          currentBudgetId +
          "/provider-children?" +
          query,
      );
      return {
        ...page,
        items: page.items.map((item) => ({ ...item, alias: item.alias ?? undefined })),
      };
    },
    [initiativeId, currentBudgetId],
  );
  const setCustom = (key: string, value: Value) => {
    setFieldValues((previous) => ({ ...previous, [key]: value }));
    setChangedFields((previous) => new Set(previous).add(key));
  };
  const submitForm = async () => {
    setError(null);
    if (
      kind === "invoice" &&
      mode !== "move" &&
      (!amount.trim() || !Number.isFinite(Number(amount)) || Number(amount) < 0)
    ) {
      setError(t("financialForm.invalidAmount"));
      return;
    }
    const fieldPayload = Object.fromEntries(
      Object.entries(fieldValues).filter(([key]) => mode === "create" || changedFields.has(key)),
    );
    if (mode === "create") {
      for (const definition of definitions) {
        if (
          !("protected" in definition && definition.protected) &&
          definition.kind === "boolean" &&
          definition.required &&
          definition.default == null &&
          !(definition.key in fieldPayload)
        ) {
          fieldPayload[definition.key] = false;
        }
      }
    }
    let path: string;
    let body: Record<string, unknown>;
    if (mode === "move") {
      path = kind === "cost" ? "/ppm/costs/" + cost?.id : "/ppm/invoices/" + invoice?.id;
      body = kind === "cost" ? { budget_line_id: destination } : { cost_item_id: destination };
      if (kind === "cost" && providerChanged) body.provider_child_id = provider?.id ?? null;
    } else if (kind === "budget") {
      path =
        mode === "create"
          ? "/ppm/initiatives/" + initiativeId + "/budgets"
          : "/ppm/budgets/" + budget?.id;
      body = {
        fiscal_year: Number(year),
        category,
        description: description || null,
        amount: Number(amount || 0),
        field_values: fieldPayload,
      };
    } else if (kind === "cost") {
      path =
        mode === "create"
          ? "/ppm/initiatives/" + initiativeId + "/costs"
          : "/ppm/costs/" + cost?.id;
      body = {
        description,
        category,
        planned: Number(planned || 0),
        actual: Number(actual || 0),
        date: date || null,
        field_values: fieldPayload,
      };
      if (mode === "create") body.budget_line_id = parentId;
      if (providerChanged) body.provider_child_id = provider?.id ?? null;
    } else {
      path =
        mode === "create"
          ? "/ppm/initiatives/" + initiativeId + "/invoices"
          : "/ppm/invoices/" + invoice?.id;
      body = { invoice_date: date, invoice_id: invoiceId, amount, field_values: fieldPayload };
      if (mode === "create") body.cost_item_id = parentId;
    }
    try {
      await submit.run(async () => {
        if (mode === "create") await api.post(path, body);
        else await api.patch(path, body);
        onSaved(mode === "move" ? destination : undefined);
      });
    } catch (err) {
      const detail = err instanceof ApiError ? err.detail : null;
      if (
        typeof detail === "object" &&
        detail !== null &&
        "code" in detail &&
        detail.code === "provider_children_incompatible"
      ) {
        const costIds =
          "cost_ids" in detail && Array.isArray(detail.cost_ids) ? detail.cost_ids : [];
        const names = data.cost_items
          .filter((item) => costIds.includes(item.id))
          .map((item) => item.description);
        setError(
          names.length
            ? t("financialForm.providerConflictItems", { items: names.join(", ") })
            : t("financialForm.providerConflict"),
        );
        return;
      }
      setError(apiErrorMessage(err, t("financialForm.saveError")));
      if (
        err instanceof ApiError &&
        (err.status === 404 ||
          (err.status === 409 &&
            (err.detail === "Budget Provider changed; retry" ||
              err.detail === "Financial values changed; retry")))
      ) {
        onStale?.();
      }
    }
  };
  const title =
    mode === "move"
      ? t(kind === "cost" ? "financialForm.moveCost" : "financialForm.moveInvoice")
      : t(
          kind === "budget"
            ? mode === "create"
              ? "addBudgetLine"
              : "editBudgetLine"
            : kind === "cost"
              ? mode === "create"
                ? "addCostItem"
                : "editCostLine"
              : "financialForm.titleInvoice",
        );

  return (
    <Dialog
      open
      onClose={() => !submit.busy && onClose()}
      fullScreen={fullScreen}
      fullWidth
      maxWidth="sm"
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
          {mode === "move" ? (
            <TextField
              select
              label={t(kind === "cost" ? "financialForm.selectBudget" : "financialForm.selectCost")}
              value={destination}
              onChange={(event) => {
                setDestination(event.target.value);
                if (kind === "cost") {
                  setProvider(null);
                  setProviderChanged(false);
                }
              }}
              fullWidth
            >
              {(kind === "cost" ? data.budget_lines : data.cost_items).map((item) => (
                <MenuItem key={item.id} value={item.id}>
                  {item.description || item.id.slice(0, 8)}
                </MenuItem>
              ))}
            </TextField>
          ) : (
            <>
              {kind !== "invoice" && (
                <>
                  <TextField
                    label={t("common:labels.description")}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    required={kind === "cost"}
                    fullWidth
                  />
                  <TextField
                    select
                    label={t("category")}
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    fullWidth
                  >
                    <MenuItem value="capex">{t("capex")}</MenuItem>
                    <MenuItem value="opex">{t("opex")}</MenuItem>
                  </TextField>
                </>
              )}
              {kind === "budget" && (
                <>
                  <TextField
                    label={t("fiscalYear")}
                    type="number"
                    value={year}
                    onChange={(event) => setYear(event.target.value)}
                    required
                    fullWidth
                  />
                  <TextField
                    label={t("financialForm.amount")}
                    type="number"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    fullWidth
                  />
                </>
              )}
              {kind === "cost" && (
                <>
                  <TextField
                    label={t("planned")}
                    type="number"
                    value={planned}
                    onChange={(event) => setPlanned(event.target.value)}
                    fullWidth
                  />
                  <TextField
                    label={t("actual")}
                    type="number"
                    value={actual}
                    onChange={(event) => setActual(event.target.value)}
                    fullWidth
                  />
                  <DateField label={t("date")} value={date} onChange={setDate} fullWidth />
                </>
              )}
              {kind === "invoice" && (
                <>
                  <DateField
                    label={t("financialForm.invoiceDate")}
                    value={date}
                    onChange={setDate}
                    required
                    fullWidth
                  />
                  <TextField
                    label={t("financialForm.invoiceId")}
                    value={invoiceId}
                    onChange={(event) => setInvoiceId(event.target.value)}
                    required
                    fullWidth
                  />
                  <TextField
                    label={t("financialForm.amount")}
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    required
                    fullWidth
                  />
                </>
              )}
              {definitions
                .filter(
                  (field) =>
                    field.kind !== "calculated" && !("protected" in field && field.protected),
                )
                .map((field) => (
                  <CustomField
                    key={field.key}
                    field={field}
                    value={
                      Object.prototype.hasOwnProperty.call(fieldValues, field.key)
                        ? fieldValues[field.key]
                        : mode === "create"
                          ? (field.default ?? null)
                          : null
                    }
                    display={
                      mode === "create"
                        ? field.default_display
                        : row?.reference_display?.[field.key]
                    }
                    onChange={(value) => setCustom(field.key, value)}
                  />
                ))}
            </>
          )}
          {childEnabled && kind === "cost" && (
            <CardPicker
              types="Provider"
              label={t("financialForm.providerChild")}
              value={provider}
              key={currentBudgetId}
              searchSource={searchChildren}
              pageSize={50}
              onChange={(value) => {
                setProvider(value);
                setProviderChanged(true);
              }}
            />
          )}
          {kind === "cost" && cost?.provider_child_id && (!providerChanged || provider) && (
            <Button
              onClick={() => {
                setProvider(null);
                setProviderChanged(true);
              }}
            >
              {t("financialForm.inheritProvider")}
            </Button>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submit.busy}>
          {t("common:actions.cancel")}
        </Button>
        <Button
          onClick={submitForm}
          disabled={submit.busy || (mode === "move" && !destination)}
          variant="contained"
        >
          {t("common:actions.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function CustomField({
  field,
  value,
  display,
  onChange,
}: {
  field: PmlFieldDefinition;
  value: Value;
  display?: { id?: string | null; name?: string | null; status?: string };
  onChange: (value: Value) => void;
}) {
  const [selectedCard, setSelectedCard] = useState<CardOption | null>(
    display?.id && display.name
      ? { id: display.id, name: display.name, type: field.card_type ?? "" }
      : null,
  );
  if (field.kind === "boolean") {
    return (
      <FormControlLabel
        control={
          <Checkbox checked={value === true} onChange={(event) => onChange(event.target.checked)} />
        }
        label={field.label}
      />
    );
  }
  if (field.kind === "date") {
    return (
      <DateField
        label={field.label}
        value={String(value ?? "")}
        onChange={(next) => onChange(next || null)}
        required={field.required}
        fullWidth
      />
    );
  }
  if (field.kind === "card_reference") {
    return (
      <CardPicker
        types={field.card_type ?? undefined}
        label={field.label}
        value={selectedCard}
        onChange={(next) => {
          setSelectedCard(next);
          onChange(next?.id ?? null);
        }}
      />
    );
  }
  if (field.kind === "select") {
    return (
      <TextField
        select
        label={field.label}
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value || null)}
        required={field.required}
        fullWidth
      >
        <MenuItem value="">
          <em>—</em>
        </MenuItem>
        {(field.options ?? [])
          .filter((option) => option.active || option.id === value)
          .map((option) => (
            <MenuItem key={option.id} value={option.id}>
              {option.label}
            </MenuItem>
          ))}
      </TextField>
    );
  }
  return (
    <TextField
      label={field.label}
      type={field.kind === "number" ? "number" : "text"}
      value={String(value ?? "")}
      onChange={(event) => onChange(event.target.value || null)}
      required={field.required}
      fullWidth
    />
  );
}
