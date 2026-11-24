import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  MenuItem,
  Paper,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, api, apiErrorMessage } from "@/api/client";
import CardPicker, { type CardOption } from "@/components/CardPicker";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useRelationLabel, useTypeLabel } from "@/hooks/useResolveLabel";
import type { PmlRowKind } from "@/types";
import { FormulaEditor } from "./FormulaEditor";

type Option = { id: string; label: string; active: boolean };
type Scalar = string | number | boolean | null;
type Condition =
  | { op: "eq" | "ne" | "lt" | "lte" | "gt" | "gte"; input: string; value: Scalar }
  | { op: "all" | "any"; conditions: Condition[] }
  | { op: "not"; condition: Condition };
type Rule = { when: Condition; then: Scalar };
type Calculation = {
  result_type: "text" | "number" | "date" | "boolean";
  formula_engine?: "core" | "legacy";
  inputs: Record<string, string>;
  provider_constants?: Record<string, string>;
  expression: string | null;
  rules: Rule[] | null;
  fallback: string | number | boolean | null;
};
type Field = {
  key: string;
  label: string;
  kind: string;
  active?: boolean;
  required?: boolean;
  protected?: boolean;
  help?: string | null;
  default?: string | number | boolean | null;
  options?: Option[];
  card_type?: string | null;
  relation_type?: string | null;
  calculation?: Calculation | null;
};
type Section = {
  fields: Field[];
  visible_columns: string[];
  provider_source: { budget_field_key: string; allow_child_selection: boolean } | null;
};
type AllSections = Record<PmlRowKind, Section>;
function ReferencePicker({
  id,
  type,
  label,
  onChange,
}: {
  id: string | null;
  type: string;
  label: string;
  onChange: (value: CardOption | null) => void;
}) {
  const { t } = useTranslation("admin");
  const query = useApiQuery<CardOption>(id ? "/cards/" + encodeURIComponent(id) : null, {
    keepPreviousData: false,
  });
  return (
    <Box>
      {id && query.error && <Alert severity="warning">{t("pml.fields.unavailable")}</Alert>}
      <CardPicker
        types={type}
        label={label}
        value={query.data?.id === id ? query.data : null}
        onChange={onChange}
      />
    </Box>
  );
}
function ResultEditor({
  label,
  type,
  value,
  onChange,
}: {
  label: string;
  type: Calculation["result_type"];
  value: Scalar;
  onChange: (value: Scalar) => void;
}) {
  const { t } = useTranslation("admin");
  if (type === "boolean")
    return (
      <TextField
        select
        label={label}
        value={value == null ? "" : String(value)}
        onChange={(event) =>
          onChange(event.target.value === "" ? null : event.target.value === "true")
        }
      >
        <MenuItem value="">{t("pml.fields.none")}</MenuItem>
        <MenuItem value="true">{t("pml.fields.yes")}</MenuItem>
        <MenuItem value="false">{t("pml.fields.no")}</MenuItem>
      </TextField>
    );
  return (
    <TextField
      label={label}
      type={type === "number" ? "number" : type === "date" ? "date" : "text"}
      value={String(value ?? "")}
      onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
    />
  );
}
function ConditionEditor({
  condition,
  inputs,
  fields,
  onChange,
}: {
  condition: Condition;
  inputs: Record<string, string>;
  fields: Field[];
  onChange: (condition: Condition) => void;
}) {
  const { t } = useTranslation("admin");
  const k = (name: string) => t(`pml.fields.${name}`);
  const blank = (): Condition => ({ op: "eq", input: "", value: null });
  const group = condition.op === "all" || condition.op === "any";
  const mode = group ? condition.op : condition.op === "not" ? "not" : "comparison";
  const children = group
    ? condition.conditions
    : condition.op === "not"
      ? [condition.condition]
      : [];
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 1,
        pl: 1,
        borderLeft: 1,
        borderColor: "divider",
      }}
    >
      <TextField
        select
        label={k("conditionMode")}
        value={mode}
        onChange={(event) => {
          const value = event.target.value;
          onChange(
            value === "all" || value === "any"
              ? { op: value, conditions: [blank()] }
              : value === "not"
                ? { op: "not", condition: blank() }
                : blank(),
          );
        }}
      >
        <MenuItem value="comparison">{k("comparison")}</MenuItem>
        <MenuItem value="all">{k("all")}</MenuItem>
        <MenuItem value="any">{k("any")}</MenuItem>
        <MenuItem value="not">{k("not")}</MenuItem>
      </TextField>
      {"input" in condition &&
        (() => {
          const source = inputs[condition.input] ?? "";
          const field = fields.find((item) => item.key === source);
          const cardType = source.startsWith("provider.") ? "Provider" : field?.card_type;
          return (
            <>
              <TextField
                select
                label={k("conditionInput")}
                value={condition.input}
                onChange={(event) =>
                  onChange({ ...condition, input: event.target.value, value: null })
                }
              >
                <MenuItem value="">{k("none")}</MenuItem>
                {Object.keys(inputs).map((alias) => (
                  <MenuItem key={alias} value={alias}>
                    {alias}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label={k("conditionOperator")}
                value={condition.op}
                onChange={(event) =>
                  onChange({
                    ...condition,
                    op: event.target.value as "eq" | "ne" | "lt" | "lte" | "gt" | "gte",
                  })
                }
              >
                {["eq", "ne", "lt", "lte", "gt", "gte"].map((op) => (
                  <MenuItem value={op} key={op}>
                    {k("op_" + op)}
                  </MenuItem>
                ))}
              </TextField>
              {cardType ? (
                <ReferencePicker
                  type={cardType}
                  label={k("conditionValue")}
                  id={typeof condition.value === "string" ? condition.value : null}
                  onChange={(value) => onChange({ ...condition, value: value?.id ?? null })}
                />
              ) : (field?.calculation?.result_type ?? field?.kind) === "boolean" ? (
                <TextField
                  select
                  label={k("conditionValue")}
                  value={condition.value === null ? "" : String(condition.value)}
                  onChange={(event) =>
                    onChange({
                      ...condition,
                      value: event.target.value === "" ? null : event.target.value === "true",
                    })
                  }
                >
                  <MenuItem value="">{k("none")}</MenuItem>
                  <MenuItem value="true">{k("yes")}</MenuItem>
                  <MenuItem value="false">{k("no")}</MenuItem>
                </TextField>
              ) : field?.kind === "select" ? (
                <TextField
                  select
                  label={k("conditionValue")}
                  value={condition.value ?? ""}
                  onChange={(event) =>
                    onChange({ ...condition, value: event.target.value || null })
                  }
                >
                  <MenuItem value="">{k("none")}</MenuItem>
                  {(field.options ?? []).map((option) => (
                    <MenuItem key={option.id} value={option.id}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
              ) : (
                <TextField
                  label={k("conditionValue")}
                  value={String(condition.value ?? "")}
                  onChange={(event) =>
                    onChange({
                      ...condition,
                      value: event.target.value === "" ? null : event.target.value,
                    })
                  }
                />
              )}
            </>
          );
        })()}
      {children.map((child, index) => (
        <Box key={index}>
          <ConditionEditor
            condition={child}
            fields={fields}
            inputs={inputs}
            onChange={(next) => {
              if (condition.op === "not") onChange({ op: "not", condition: next });
              else if (condition.op === "all" || condition.op === "any")
                onChange({
                  ...condition,
                  conditions: condition.conditions.map((item, i) => (i === index ? next : item)),
                });
            }}
          />
          {group && children.length > 1 && (
            <Button
              onClick={() => {
                if (condition.op === "all" || condition.op === "any")
                  onChange({
                    ...condition,
                    conditions: condition.conditions.filter((_, i) => i !== index),
                  });
              }}
            >
              {k("remove")}
            </Button>
          )}
        </Box>
      ))}
      {group && (
        <Button
          onClick={() => {
            if (condition.op === "all" || condition.op === "any")
              onChange({ ...condition, conditions: [...condition.conditions, blank()] });
          }}
        >
          {k("addCondition")}
        </Button>
      )}
    </Box>
  );
}
const empty: Section = { fields: [], visible_columns: [], provider_source: null };
const standard: Record<PmlRowKind, string[]> = {
  budget: ["fiscal_year", "category", "description", "amount"],
  cost_item: [
    "description",
    "category",
    "date",
    "actual",
    "planned",
    "provider.effective",
    "provider.budget",
  ],
  invoice: ["invoice_date", "invoice_id", "amount"],
};
function errorText(err: unknown, fallback: string): string {
  if (
    err instanceof ApiError &&
    err.detail &&
    typeof err.detail === "object" &&
    !Array.isArray(err.detail)
  ) {
    return Object.entries(err.detail)
      .map(([key, value]) => key + ": " + String(value))
      .join(", ");
  }
  return apiErrorMessage(err, fallback);
}
const newField = (): Field => ({
  key: "",
  label: "",
  kind: "text",
  active: true,
  required: false,
  help: null,
  default: null,
  options: [],
  card_type: null,
  relation_type: null,
  calculation: null,
});
const newCalculation = (): Calculation => ({
  result_type: "text",
  formula_engine: "core",
  inputs: {},
  expression: "",
  rules: null,
  fallback: null,
});

const coreSource: Record<string, string> = {
  providerEffective: "provider.effective",
  providerBudget: "provider.budget",
  budgetAmount: "budget.amount",
  budgetFiscalYear: "budget.fiscal_year",
  budgetCategory: "budget.category",
  budgetDescription: "budget.description",
};
function calculationSources(
  calculation: Calculation,
  fields: Field[],
  section: PmlRowKind,
): string[] {
  const sources = [...Object.values(calculation.inputs)];
  if (calculation.formula_engine !== "core" || !calculation.expression) return sources;
  // Skip quoted strings and comments while recognizing dot and bracket access.
  const tokens = calculation.expression.matchAll(
    /\bdata((?:\s*\.\s*[A-Za-z_]\w*|\s*\[\s*["'][A-Za-z_]\w*["']\s*\])+)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[^\n]*)/g,
  );
  for (const token of tokens) {
    if (!token[1]) continue;
    const path = Array.from(token[1].matchAll(/\.\s*([A-Za-z_]\w*)|\[\s*["']([A-Za-z_]\w*)["']\s*\]/g),
      (match) => match[1] ?? match[2]).join(".");
    const key = path.startsWith("budget.") ? path : path.split(".")[0];
    if (section === "cost_item" && key === "budget") continue;
    sources.push(fields.some((field) => field.key === key) ? key : (coreSource[key] ?? key));
  }
  return [...new Set(sources)];
}
const fieldSettingsPath = "/settings/pml/financial-fields";

export default function PmlFieldSettings() {
  const { t } = useTranslation("admin");
  const { types, relationTypes } = useMetamodel();
  const typeLabel = useTypeLabel();
  const relationLabel = useRelationLabel();
  const query = useApiQuery<AllSections>(fieldSettingsPath, { keepPreviousData: false });
  const [configs, setConfigs] = useState<AllSections | null>(null);
  const [persisted, setPersisted] = useState<AllSections | null>(null);
  const [section, setSection] = useState<PmlRowKind>("budget");
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [samples, setSamples] = useState<Record<string, string | number | boolean | null>>({});
  const [sampleCards, setSampleCards] = useState<Record<string, CardOption | null>>({});

  const [preview, setPreview] = useState("");
  useEffect(() => {
    if (query.data) {
      setConfigs(query.data);
      setPersisted(query.data);
    }
  }, [query.data]);

  if (!configs)
    return query.error ? (
      <Alert severity="error">{query.error.message || t("pml.fields.loadError")}</Alert>
    ) : (
      <CircularProgress />
    );
  const config = configs[section] ?? empty;
  const field = editing === null ? null : config.fields[editing];
  const k = (name: string) => t(`pml.fields.${name}`);
  const update = (next: Section) => {
    setConfigs({ ...configs, [section]: next });
    setSaved(false);
    setPreview("");
  };
  const changeField = (patch: Partial<Field>) => {
    if (editing === null || !field) return;
    update({
      ...config,
      fields: config.fields.map((item, index) =>
        index === editing ? { ...item, ...patch } : item,
      ),
    });
  };
  const moveField = (index: number, delta: number) => {
    const destination = index + delta;
    if (destination < 0 || destination >= config.fields.length) return;
    const fields = [...config.fields];
    [fields[index], fields[destination]] = [fields[destination], fields[index]];
    const visibleFields = fields
      .map((item) => item.key)
      .filter((key) => config.visible_columns.includes(key));
    let position = 0;
    const visibleColumns = config.visible_columns.map((key) =>
      fields.some((item) => item.key === key) ? visibleFields[position++] : key,
    );
    update({ ...config, fields, visible_columns: visibleColumns });
    setEditing(destination);
  };
  const changeCalculation = (patch: Partial<Calculation>) =>
    changeField({ calculation: { ...(field?.calculation ?? newCalculation()), ...patch } });
  const save = async () => {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const payload = {
        ...config,
        fields: config.fields.map((item) =>
          item.protected ? { key: item.key, keep_existing: true } : item,
        ),
      };
      const result = await api.put<Section>(fieldSettingsPath + "/" + section, payload);
      setConfigs((previous) => (previous ? { ...previous, [section]: result } : previous));
      setPersisted((previous) => (previous ? { ...previous, [section]: result } : previous));
      setSaved(true);
    } catch (err) {
      setError(errorText(err, k("saveError")));
    } finally {
      setBusy(false);
    }
  };
  const runPreview = async () => {
    if (!field) return;
    const unavailable = new Set(
      config.fields.filter((item) => item.protected).map((item) => item.key),
    );
    if (
      section === "cost_item" &&
      configs.budget.fields.some(
        (item) => item.protected && item.key === config.provider_source?.budget_field_key,
      )
    ) {
      unavailable.add("provider.effective");
      unavailable.add("provider.budget");
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const item of config.fields) {
        if (
          !unavailable.has(item.key) &&
          item.calculation &&
          calculationSources(item.calculation, config.fields, section).some((source) =>
            unavailable.has(source),
          )
        ) {
          unavailable.add(item.key);
          changed = true;
        }
      }
    }
    if (unavailable.has(field.key)) {
      setError(k("previewProtected"));
      return;
    }
    const previewConfig = {
      ...config,
      fields: config.fields.filter((item) => !unavailable.has(item.key)),
      visible_columns: config.visible_columns.filter((key) => !unavailable.has(key)),
    };
    setBusy(true);
    setError("");
    try {
      const result = await api.post<{ value: unknown; errors: Record<string, string> }>(
        fieldSettingsPath + "/" + section + "/preview",
        { configuration: previewConfig, field_key: field.key, sample_values: samples },
      );
      setPreview(
        Object.keys(result.errors ?? {}).length
          ? JSON.stringify(result.errors)
          : String(result.value ?? "—"),
      );
    } catch (err) {
      setError(errorText(err, k("previewError")));
    } finally {
      setBusy(false);
    }
  };
  const sourceFields = [
    ...standard[section],
    ...(section === "cost_item"
      ? [
          "budget.amount",
          "budget.fiscal_year",
          "budget.category",
          "budget.description",
          "budget.provider",
          "budget.initiative.id",
          "budget.initiative.name",
          "budget.initiative.type",
        ]
      : []),
    ...config.fields
      .filter((item) => item.active !== false && item.key !== field?.key)
      .map((item) => item.key),
  ];
  const sourceType = (source: string) =>
    source.startsWith("provider.") || source === "budget.provider"
      ? "Provider"
      : config.fields.find((item) => item.key === source)?.card_type;
  const calc = field?.calculation;
  const typeFor = (source: string) => {
    const item = config.fields.find((field) => field.key === source);
    return (
      item?.calculation?.result_type ??
      item?.kind ??
      ([
        "fiscal_year",
        "amount",
        "actual",
        "planned",
        "budget.amount",
        "budget.fiscal_year",
      ].includes(source)
        ? "number"
        : undefined)
    );
  };
  const sampleInputs: Record<string, string> = {};
  const collectSamples = (calculation: Calculation, visited: Set<string>) => {
    for (const source of calculationSources(calculation, config.fields, section)) {
      const dependency = config.fields.find((item) => item.key === source);
      if (dependency?.kind === "calculated") {
        if (dependency.calculation && !visited.has(source)) {
          visited.add(source);
          collectSamples(dependency.calculation, visited);
        }
      } else if (source && !dependency?.protected) {
        const alias = Object.entries(calculation.inputs).find(([, value]) => value === source)?.[0];
        sampleInputs[source] = alias ?? source;
      }
    }
  };
  if (calc) collectSamples(calc, new Set());
  const financialDataFields = [
    ...standard[section]
      .filter((key) => !key.startsWith("provider."))
      .map((key) => ({ key, label: key })),
    ...(section === "cost_item"
      ? [
          { key: "budget", label: "Budget" },
          ...["providerEffective", "providerBudget"]
            .filter((key) => !config.fields.some((item) => item.key === key))
            .map((key) => ({ key, label: key })),
        ]
      : []),
    ...config.fields
      .filter(
        (item) =>
          item.active !== false &&
          !item.protected &&
          item.key !== field?.key &&
          !(section === "cost_item" && item.key === "budget"),
      )
      .map((item) => ({
        key: item.key,
        label: item.label,
        kind: item.kind,
        options: item.options,
      })),
  ];
  return (
    <Box component="fieldset" disabled={busy} sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
      <Tabs
        value={section}
        onChange={(_, value: PmlRowKind) => {
          setSection(value);
          setEditing(null);
          setError("");
          setPreview("");
          setSamples({});
        }}
      >
        <Tab value="budget" label={k("budget")} />
        <Tab value="cost_item" label={k("costItem")} />
        <Tab value="invoice" label={k("invoice")} />
      </Tabs>
      {error && <Alert severity="error">{error}</Alert>}
      {saved && <Alert severity="success">{k("saved")}</Alert>}
      {section === "cost_item" && (
        <Box sx={{ display: "flex", gap: 2, mt: 2, flexWrap: "wrap" }}>
          <TextField
            select
            label={k("providerSource")}
            value={config.provider_source?.budget_field_key ?? ""}
            onChange={(event) =>
              update({
                ...config,
                provider_source: event.target.value
                  ? {
                      budget_field_key: event.target.value,
                      allow_child_selection: config.provider_source?.allow_child_selection ?? false,
                    }
                  : null,
              })
            }
            sx={{ minWidth: 240 }}
          >
            <MenuItem value="">{k("none")}</MenuItem>
            {configs.budget.fields
              .filter(
                (item) =>
                  !item.protected &&
                  item.kind === "card_reference" &&
                  item.card_type === "Provider" &&
                  item.active !== false,
              )
              .map((item) => (
                <MenuItem value={item.key} key={item.key}>
                  {item.label}
                </MenuItem>
              ))}
          </TextField>
          <FormControlLabel
            control={
              <Checkbox
                checked={config.provider_source?.allow_child_selection ?? false}
                disabled={!config.provider_source}
                onChange={(event) =>
                  config.provider_source &&
                  update({
                    ...config,
                    provider_source: {
                      ...config.provider_source,
                      allow_child_selection: event.target.checked,
                    },
                  })
                }
              />
            }
            label={k("allowChildren")}
          />
        </Box>
      )}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mt: 2 }}>
        {config.fields.map((item, index) => (
          <Paper
            key={item.key || index}
            variant="outlined"
            sx={{ p: 1, display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}
          >
            <Typography sx={{ flex: 1 }}>
              {item.label || item.key} {item.protected && k("protected")}
            </Typography>
            <FormControlLabel
              label={k("column")}
              control={
                <Checkbox
                  checked={config.visible_columns.includes(item.key)}
                  disabled={!!item.protected || !item.key}
                  onChange={(event) =>
                    update({
                      ...config,
                      visible_columns: event.target.checked
                        ? [...config.visible_columns, item.key]
                        : config.visible_columns.filter((key) => key !== item.key),
                    })
                  }
                />
              }
            />
            <Button disabled={index === 0} onClick={() => moveField(index, -1)}>
              {k("moveUp")}
            </Button>
            <Button
              disabled={index === config.fields.length - 1}
              onClick={() => moveField(index, 1)}
            >
              {k("moveDown")}
            </Button>
            <Button
              disabled={!!item.protected}
              onClick={() => {
                setEditing(index);
                setError("");
              }}
            >
              {k("edit")}
            </Button>
            {!persisted?.[section]?.fields.some((savedField) => savedField.key === item.key) && (
              <Button
                onClick={() => {
                  update({
                    ...config,
                    fields: config.fields.filter((_, i) => i !== index),
                    visible_columns: config.visible_columns.filter((key) => key !== item.key),
                  });
                  setEditing(null);
                }}
              >
                {k("discard")}
              </Button>
            )}
          </Paper>
        ))}
        <Button
          onClick={() => {
            update({ ...config, fields: [...config.fields, newField()] });
            setEditing(config.fields.length);
          }}
        >
          {k("add")}
        </Button>
      </Box>
      {field && !field.protected && (
        <Paper
          variant="outlined"
          sx={{ mt: 2, p: 2, display: "flex", flexDirection: "column", gap: 2 }}
        >
          <TextField
            label={k("key")}
            value={field.key}
            onChange={(event) => changeField({ key: event.target.value })}
          />
          <TextField
            label={k("label")}
            value={field.label}
            onChange={(event) => changeField({ label: event.target.value })}
          />
          <TextField
            label={k("help")}
            value={field.help ?? ""}
            onChange={(event) => changeField({ help: event.target.value || null })}
          />
          <TextField
            select
            label={k("kind")}
            value={field.kind}
            onChange={(event) => {
              const kind = event.target.value;
              changeField({
                kind,
                options: [],
                card_type: null,
                relation_type: null,
                calculation: kind === "calculated" ? newCalculation() : null,
                default: null,
              });
            }}
          >
            {["text", "number", "date", "boolean", "select", "card_reference", "calculated"].map(
              (kind) => (
                <MenuItem key={kind} value={kind}>
                  {k("kind_" + kind)}
                </MenuItem>
              ),
            )}
          </TextField>
          <Box>
            <FormControlLabel
              control={
                <Checkbox
                  checked={field.active !== false}
                  onChange={(event) => changeField({ active: event.target.checked })}
                />
              }
              label={k("active")}
            />
            {field.kind !== "calculated" && (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={!!field.required}
                    onChange={(event) => changeField({ required: event.target.checked })}
                  />
                }
                label={k("required")}
              />
            )}
          </Box>
          {field.kind === "select" && (
            <Box>
              {(field.options ?? []).map((option, i) => (
                <Box key={i} sx={{ display: "flex", gap: 1, mt: 1 }}>
                  <TextField
                    label={k("optionId")}
                    value={option.id}
                    onChange={(event) =>
                      changeField({
                        options: field.options?.map((x, j) =>
                          j === i ? { ...x, id: event.target.value } : x,
                        ),
                      })
                    }
                  />
                  <TextField
                    label={k("optionLabel")}
                    value={option.label}
                    onChange={(event) =>
                      changeField({
                        options: field.options?.map((x, j) =>
                          j === i ? { ...x, label: event.target.value } : x,
                        ),
                      })
                    }
                  />
                  <FormControlLabel
                    label={k("active")}
                    control={
                      <Checkbox
                        checked={option.active}
                        onChange={(event) =>
                          changeField({
                            options: field.options?.map((x, j) =>
                              j === i ? { ...x, active: event.target.checked } : x,
                            ),
                          })
                        }
                      />
                    }
                  />
                </Box>
              ))}
              <Button
                onClick={() =>
                  changeField({
                    options: [...(field.options ?? []), { id: "", label: "", active: true }],
                  })
                }
              >
                {k("addOption")}
              </Button>
            </Box>
          )}
          {field.kind === "card_reference" && (
            <>
              <TextField
                select
                label={k("cardType")}
                value={field.card_type ?? ""}
                onChange={(event) =>
                  changeField({ card_type: event.target.value || null, relation_type: null })
                }
              >
                <MenuItem value="">{k("none")}</MenuItem>
                {types
                  .filter((item) => section !== "invoice" || item.key !== "Provider")
                  .map((item) => (
                    <MenuItem key={item.key} value={item.key}>
                      {typeLabel(item)}
                    </MenuItem>
                  ))}
              </TextField>
              <TextField
                select
                label={k("relation")}
                value={field.relation_type ?? ""}
                onChange={(event) => changeField({ relation_type: event.target.value || null })}
              >
                <MenuItem value="">{k("none")}</MenuItem>
                {relationTypes
                  .filter(
                    (item) =>
                      (item.source_type_key === field.card_type &&
                        item.target_type_key === "Initiative") ||
                      (item.target_type_key === field.card_type &&
                        item.source_type_key === "Initiative"),
                  )
                  .map((item) => (
                    <MenuItem key={item.key} value={item.key}>
                      {relationLabel(item)}
                    </MenuItem>
                  ))}
              </TextField>
            </>
          )}
          {field.kind === "card_reference" && field.card_type && (
            <ReferencePicker
              type={field.card_type}
              label={k("default")}
              id={typeof field.default === "string" ? field.default : null}
              onChange={(value) => changeField({ default: value?.id ?? null })}
            />
          )}
          {field.kind === "boolean" && (
            <TextField
              select
              label={k("default")}
              value={
                field.default === null || field.default === undefined ? "" : String(field.default)
              }
              onChange={(event) =>
                changeField({
                  default: event.target.value === "" ? null : event.target.value === "true",
                })
              }
            >
              <MenuItem value="">{k("none")}</MenuItem>
              <MenuItem value="true">{k("yes")}</MenuItem>
              <MenuItem value="false">{k("no")}</MenuItem>
            </TextField>
          )}
          {field.kind === "select" && (
            <TextField
              select
              label={k("default")}
              value={field.default ?? ""}
              onChange={(event) => changeField({ default: event.target.value || null })}
            >
              <MenuItem value="">{k("none")}</MenuItem>
              {(field.options ?? [])
                .filter((option) => option.active)
                .map((option) => (
                  <MenuItem value={option.id} key={option.id}>
                    {option.label}
                  </MenuItem>
                ))}
            </TextField>
          )}
          {["text", "number", "date"].includes(field.kind) && (
            <TextField
              label={k("default")}
              type={field.kind === "date" ? "date" : field.kind === "number" ? "number" : "text"}
              value={field.default ?? ""}
              onChange={(event) =>
                changeField({
                  default: event.target.value === "" ? null : event.target.value,
                })
              }
            />
          )}
          {calc && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <Typography>{k("calculation")}</Typography>
              <TextField
                select
                label={k("resultType")}
                value={calc.result_type}
                onChange={(event) =>
                  changeCalculation({
                    result_type: event.target.value as Calculation["result_type"],
                  })
                }
              >
                {["text", "number", "date", "boolean"].map((kind) => (
                  <MenuItem value={kind} key={kind}>
                    {k("kind_" + kind)}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label={k("calculationMode")}
                value={calc.rules === null ? "expression" : "rules"}
                onChange={(event) =>
                  changeCalculation(
                    event.target.value === "rules"
                      ? { expression: null, rules: [], provider_constants: {} }
                      : { expression: "", rules: null, formula_engine: "core" },
                  )
                }
              >
                <MenuItem value="expression">{k("expression")}</MenuItem>
                <MenuItem value="rules">{k("rules")}</MenuItem>
              </TextField>
              {Object.entries(calc.inputs).map(([alias, source], inputIndex) => (
                <Box key={inputIndex} sx={{ display: "flex", gap: 1 }}>
                  <TextField
                    label={k("inputAlias")}
                    value={alias}
                    onChange={(event) => {
                      const nextAlias = event.target.value;
                      if (
                        nextAlias !== alias &&
                        (nextAlias in calc.inputs || nextAlias in (calc.provider_constants ?? {}))
                      )
                        return;
                      const inputs = Object.fromEntries(
                        Object.entries(calc.inputs).map(([key, value]) =>
                          key === alias ? [nextAlias, value] : [key, value],
                        ),
                      );
                      changeCalculation({ inputs });
                    }}
                  />
                  <TextField
                    select
                    label={k("inputSource")}
                    value={source}
                    onChange={(event) =>
                      changeCalculation({ inputs: { ...calc.inputs, [alias]: event.target.value } })
                    }
                    sx={{ minWidth: 160 }}
                  >
                    <MenuItem value="">{k("none")}</MenuItem>
                    {sourceFields.map((key) => (
                      <MenuItem key={key} value={key}>
                        {key}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Button
                    onClick={() => {
                      const inputs = { ...calc.inputs };
                      delete inputs[alias];
                      changeCalculation({ inputs });
                    }}
                  >
                    {k("remove")}
                  </Button>
                </Box>
              ))}
              <Button
                onClick={() => {
                  let n = 1;
                  while ("input" + n in calc.inputs) n++;
                  changeCalculation({ inputs: { ...calc.inputs, ["input" + n]: "" } });
                }}
              >
                {k("addInput")}
              </Button>
              {calc.rules === null ? (
                <>
                  <TextField
                    select
                    label={k("formulaEngine")}
                    value={calc.formula_engine ?? "legacy"}
                    onChange={(event) =>
                      changeCalculation({ formula_engine: event.target.value as "core" | "legacy" })
                    }
                  >
                    <MenuItem value="core">{k("formulaEngineCore")}</MenuItem>
                    <MenuItem value="legacy">{k("formulaEngineLegacy")}</MenuItem>
                  </TextField>
                  <FormulaEditor
                    value={calc.expression ?? ""}
                    onChange={(expression) => changeCalculation({ expression })}
                    cardType={null}
                    relationTypes={[]}
                    dataFields={financialDataFields}
                    legacy={calc.formula_engine !== "core"}
                    nestedFields={
                      section === "cost_item"
                        ? {
                            "data.budget": [
                              "amount",
                              "fiscal_year",
                              "category",
                              "description",
                              "provider",
                              "initiative",
                            ].map((key) => ({ key, label: key })),
                            "data.budget.initiative": ["id", "name", "type"].map((key) => ({
                              key,
                              label: key,
                            })),
                          }
                        : undefined
                    }
                    extraNames={[
                      ...Object.keys(calc.inputs),
                      ...Object.keys(calc.provider_constants ?? {}),
                    ]}
                    textareaId="pml-formula-editor-textarea"
                  />
                  {section === "cost_item" && calc.formula_engine === "core" && <Typography variant="caption">{k("ifExample")}</Typography>}
                  {section === "cost_item" && (
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                      {Object.entries(calc.provider_constants ?? {}).map(([alias, id], index) => (
                        <Box
                          key={index}
                          sx={{
                            display: "flex",
                            gap: 1,
                            alignItems: "center",
                          }}
                        >
                          <TextField
                            label={k("providerConstantAlias")}
                            value={alias}
                            onChange={(event) => {
                              const nextAlias = event.target.value;
                              const constants = calc.provider_constants ?? {};
                              if (nextAlias !== alias && nextAlias in constants) return;
                              if (nextAlias in calc.inputs) return;
                              changeCalculation({
                                provider_constants: Object.fromEntries(
                                  Object.entries(constants).map(([key, value]) =>
                                    key === alias ? [nextAlias, value] : [key, value],
                                  ),
                                ),
                              });
                            }}
                          />
                          <ReferencePicker
                            id={id || null}
                            type="Provider"
                            label={k("providerConstant")}
                            onChange={(value) =>
                              changeCalculation({
                                provider_constants: {
                                  ...calc.provider_constants,
                                  [alias]: value?.id ?? "",
                                },
                              })
                            }
                          />
                          <Button
                            onClick={() => {
                              const constants = {
                                ...calc.provider_constants,
                              };
                              delete constants[alias];
                              changeCalculation({
                                provider_constants: constants,
                              });
                            }}
                          >
                            {k("remove")}
                          </Button>
                        </Box>
                      ))}
                      <Button
                        disabled={!config.provider_source}
                        onClick={() => {
                          const constants = calc.provider_constants ?? {};
                          let n = 1;
                          while ("provider" + n in constants || "provider" + n in calc.inputs) n++;
                          changeCalculation({
                            provider_constants: {
                              ...constants,
                              ["provider" + n]: "",
                            },
                          });
                        }}
                      >
                        {k("addProviderConstant")}
                      </Button>
                    </Box>
                  )}
                </>
              ) : (
                <Box>
                  {calc.rules.map((rule, index) => {
                    const updateRule = (patch: Partial<Rule>) =>
                      changeCalculation({
                        rules: calc.rules?.map((item, i) =>
                          i === index ? { ...item, ...patch } : item,
                        ),
                      });
                    return (
                      <Paper
                        variant="outlined"
                        key={index}
                        sx={{ p: 1, mt: 1, display: "flex", flexDirection: "column", gap: 1 }}
                      >
                        <ConditionEditor
                          condition={rule.when}
                          inputs={calc.inputs}
                          fields={config.fields}
                          onChange={(when) => updateRule({ when })}
                        />
                        <ResultEditor
                          label={k("result")}
                          type={calc.result_type}
                          value={rule.then}
                          onChange={(value) => updateRule({ then: value })}
                        />
                        <Box>
                          <Button
                            disabled={index === 0}
                            onClick={() => {
                              const rules = [...(calc.rules ?? [])];
                              [rules[index - 1], rules[index]] = [rules[index], rules[index - 1]];
                              changeCalculation({ rules });
                            }}
                          >
                            {k("moveUp")}
                          </Button>
                          <Button
                            disabled={index === calc.rules!.length - 1}
                            onClick={() => {
                              const rules = [...(calc.rules ?? [])];
                              [rules[index + 1], rules[index]] = [rules[index], rules[index + 1]];
                              changeCalculation({ rules });
                            }}
                          >
                            {k("moveDown")}
                          </Button>
                          <Button
                            onClick={() =>
                              changeCalculation({
                                rules: calc.rules?.filter((_, i) => i !== index),
                              })
                            }
                          >
                            {k("remove")}
                          </Button>
                        </Box>
                      </Paper>
                    );
                  })}
                  <Button
                    onClick={() =>
                      changeCalculation({
                        rules: [
                          ...(calc.rules ?? []),
                          { when: { op: "eq", input: "", value: null }, then: "" },
                        ],
                      })
                    }
                  >
                    {k("addRule")}
                  </Button>
                  <ResultEditor
                    label={k("fallback")}
                    type={calc.result_type}
                    value={calc.fallback}
                    onChange={(value) => changeCalculation({ fallback: value })}
                  />
                </Box>
              )}
              {Object.entries(sampleInputs)
                .filter(
                  ([source]) =>
                    !config.fields.some(
                      (item) => item.key === source && item.kind === "calculated",
                    ),
                )
                .map(([source, alias]) => {
                  const label = k("sample") + " " + (Object.values(sampleInputs).filter((value) => value === alias).length > 1 ? `${alias} (${source})` : alias);
                  return sourceType(source) ? (
                    <CardPicker
                      key={source}
                      types={sourceType(source) ?? undefined}
                      label={label}
                      value={sampleCards[source] ?? null}
                      onChange={(value) => {
                        setSampleCards({ ...sampleCards, [source]: value });
                        setSamples({ ...samples, [source]: value?.id ?? null });
                      }}
                    />
                  ) : typeFor(source) === "select" ? (
                    <TextField
                      select
                      key={source}
                      label={label}
                      value={String(samples[source] ?? "")}
                      onChange={(event) =>
                        setSamples({ ...samples, [source]: event.target.value || null })
                      }
                    >
                      <MenuItem value="">{k("none")}</MenuItem>
                      {(config.fields.find((item) => item.key === source)?.options ?? [])
                        .filter((option) => option.active)
                        .map((option) => (
                          <MenuItem key={option.id} value={option.id}>
                            {option.label}
                          </MenuItem>
                        ))}
                    </TextField>
                  ) : typeFor(source) === "boolean" ? (
                    <TextField
                      select
                      key={source}
                      label={label}
                      value={samples[source] == null ? "" : String(samples[source])}
                      onChange={(event) =>
                        setSamples({
                          ...samples,
                          [source]:
                            event.target.value === "" ? null : event.target.value === "true",
                        })
                      }
                    >
                      <MenuItem value="">{k("none")}</MenuItem>
                      <MenuItem value="true">{k("yes")}</MenuItem>
                      <MenuItem value="false">{k("no")}</MenuItem>
                    </TextField>
                  ) : (
                    <TextField
                      key={source}
                      label={label}
                      value={String(samples[source] ?? "")}
                      onChange={(event) =>
                        setSamples({
                          ...samples,
                          [source]: event.target.value === "" ? null : event.target.value,
                        })
                      }
                    />
                  );
                })}
              <Button onClick={() => void runPreview()} disabled={busy}>
                {k("preview")}
              </Button>
              {preview && (
                <Alert severity="info">
                  {k("previewValue")}: {preview}
                </Alert>
              )}
            </Box>
          )}
        </Paper>
      )}
      <Button variant="contained" sx={{ mt: 2 }} onClick={() => void save()} disabled={busy}>
        {k("save")}
      </Button>
    </Box>
  );
}
