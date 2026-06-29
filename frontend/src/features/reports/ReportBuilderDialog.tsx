import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Checkbox from "@mui/material/Checkbox";
import ListItemText from "@mui/material/ListItemText";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useResolveLabel, useResolveMetaLabel } from "@/hooks/useResolveLabel";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { FieldDef } from "@/types";

// Keep these option lists in lockstep with backend/app/schemas/custom_report.py.
const FILTER_TARGETS = ["attribute", "subtype", "lifecycle", "tag", "name", "approval_status"];
const FILTER_OPS = [
  "eq",
  "ne",
  "in",
  "not_in",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "is_set",
  "is_empty",
];
const NO_VALUE_OPS = new Set(["is_set", "is_empty"]);
const DIM_KINDS = ["attribute", "subtype", "lifecycle", "tag_group", "relation"];
const AGGS = ["count", "sum", "avg", "min", "max"];
const VIZ_KINDS = [
  "table",
  "bar",
  "column",
  "pie",
  "donut",
  "scatter",
  "treemap",
  "line",
  "kpi",
];
const NUMERIC_TYPES = new Set(["number", "cost"]);
const MAX_DIMENSIONS = 2;
const MAX_MEASURES = 4;

interface FilterRow {
  target: string;
  key: string;
  op: string;
  value: string;
}
interface DimRow {
  kind: string;
  key: string;
}
interface MeasureRow {
  agg: string;
  field: string;
}

export interface ReportBuilderDialogProps {
  open: boolean;
  onClose: () => void;
  /** Seed the form from an existing spec (turns the dialog into an editor). */
  initialSpec?: Record<string, unknown> | null;
  onApply: (spec: Record<string, unknown>) => void;
}

export default function ReportBuilderDialog({
  open,
  onClose,
  initialSpec,
  onApply,
}: ReportBuilderDialogProps) {
  const { t } = useTranslation(["reports", "common"]);
  const { types, relationTypes } = useMetamodel();
  const rl = useResolveLabel();
  const rml = useResolveMetaLabel();

  const [title, setTitle] = useState("");
  const [cardType, setCardType] = useState("");
  const [subtypes, setSubtypes] = useState<string[]>([]);
  const [filters, setFilters] = useState<FilterRow[]>([]);
  const [dimensions, setDimensions] = useState<DimRow[]>([]);
  const [measures, setMeasures] = useState<MeasureRow[]>([{ agg: "count", field: "" }]);
  const [vizKind, setVizKind] = useState("bar");
  const [limit, setLimit] = useState(100);
  const [tagGroups, setTagGroups] = useState<{ id: string; name: string }[]>([]);

  // Seed from the incoming spec each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    const s = (initialSpec ?? {}) as Record<string, unknown>;
    const source = (s.source ?? {}) as Record<string, unknown>;
    setTitle((s.title as string) ?? "");
    setCardType((source.card_type as string) ?? "");
    setSubtypes((source.subtypes as string[]) ?? []);
    setFilters(
      ((source.filters as Record<string, unknown>[]) ?? []).map((f) => ({
        target: (f.target as string) ?? "attribute",
        key: (f.key as string) ?? "",
        op: (f.op as string) ?? "eq",
        value: Array.isArray(f.value) ? (f.value as string[]).join(", ") : ((f.value as string) ?? ""),
      })),
    );
    setDimensions(
      ((s.dimensions as Record<string, unknown>[]) ?? []).map((d) => ({
        kind: (d.kind as string) ?? "attribute",
        key: (d.key as string) ?? "",
      })),
    );
    const ms = (s.measures as Record<string, unknown>[]) ?? [];
    setMeasures(
      ms.length
        ? ms.map((m) => ({ agg: (m.agg as string) ?? "count", field: (m.field as string) ?? "" }))
        : [{ agg: "count", field: "" }],
    );
    setVizKind(((s.visualization as Record<string, unknown>)?.kind as string) ?? "bar");
    setLimit((s.limit as number) ?? 100);
  }, [open, initialSpec]);

  // Tag groups feed the tag_group dimension picker; fetched once when opened.
  useEffect(() => {
    if (!open) return;
    api
      .get<{ id: string; name: string }[]>("/tag-groups")
      .then((g) => setTagGroups(g.map((x) => ({ id: x.id, name: x.name }))))
      .catch(() => setTagGroups([]));
  }, [open]);

  const selectedType = useMemo(() => types.find((tp) => tp.key === cardType), [types, cardType]);
  const typeFields: FieldDef[] = useMemo(() => {
    const out: FieldDef[] = [];
    for (const section of selectedType?.fields_schema ?? []) {
      for (const f of section.fields ?? []) out.push(f);
    }
    return out;
  }, [selectedType]);
  const numericFields = useMemo(
    () => typeFields.filter((f) => NUMERIC_TYPES.has(f.type)),
    [typeFields],
  );
  const typeSubtypes = selectedType?.subtypes ?? [];
  const relationsForType = useMemo(
    () =>
      relationTypes.filter(
        (rt) => !rt.is_hidden && (rt.source_type_key === cardType || rt.target_type_key === cardType),
      ),
    [relationTypes, cardType],
  );

  const fieldByKey = (key: string) => typeFields.find((f) => f.key === key);

  const valid = Boolean(cardType) && measures.length > 0;

  const buildSpec = (): Record<string, unknown> => {
    const source: Record<string, unknown> = { card_type: cardType };
    if (subtypes.length) source.subtypes = subtypes;
    const cleanFilters = filters
      .filter((f) => f.target && f.op)
      .map((f) => {
        const out: Record<string, unknown> = { target: f.target, op: f.op };
        if (f.target === "attribute" && f.key) out.key = f.key;
        if (!NO_VALUE_OPS.has(f.op)) {
          out.value =
            f.op === "in" || f.op === "not_in"
              ? f.value.split(",").map((v) => v.trim()).filter(Boolean)
              : f.value;
        }
        return out;
      });
    if (cleanFilters.length) source.filters = cleanFilters;

    const spec: Record<string, unknown> = {
      title: title || t("reports:custom.title"),
      source,
      measures: measures.map((m) => {
        const out: Record<string, unknown> = { agg: m.agg };
        if (m.agg !== "count" && m.field) out.field = m.field;
        return out;
      }),
      visualization: { kind: vizKind },
      limit,
    };
    const cleanDims = dimensions
      .filter((d) => d.kind)
      .map((d) => {
        const out: Record<string, unknown> = { kind: d.kind };
        if (["attribute", "relation", "tag_group"].includes(d.kind) && d.key) out.key = d.key;
        return out;
      });
    if (cleanDims.length) spec.dimensions = cleanDims;
    return spec;
  };

  const handleApply = () => {
    onApply(buildSpec());
    onClose();
  };

  const dimKeyOptions = (kind: string) => {
    if (kind === "attribute")
      return typeFields.map((f) => ({ value: f.key, label: rl(f.key, f.translations) }));
    if (kind === "relation")
      return relationsForType.map((rt) => ({
        value: rt.key,
        label: rml(rt.key, rt.translations, "label"),
      }));
    if (kind === "tag_group")
      return tagGroups.map((g) => ({ value: g.id, label: g.name }));
    return [];
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{initialSpec ? t("reports:builder.editTitle") : t("reports:builder.title")}</DialogTitle>
      <DialogContent dividers>
        <TextField
          label={t("reports:builder.reportTitle")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          size="small"
          fullWidth
          sx={{ mb: 2 }}
        />

        {/* Source */}
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
          {t("reports:builder.sourceSection")}
        </Typography>
        <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mb: 2 }}>
          <TextField
            select
            label={t("reports:builder.cardType")}
            value={cardType}
            onChange={(e) => {
              setCardType(e.target.value);
              setSubtypes([]);
              setFilters([]);
              setDimensions([]);
              setMeasures([{ agg: "count", field: "" }]);
            }}
            size="small"
            sx={{ minWidth: 200 }}
          >
            {types
              .filter((tp) => !tp.is_hidden)
              .map((tp) => (
                <MenuItem key={tp.key} value={tp.key}>
                  {rml(tp.key, tp.translations, "label")}
                </MenuItem>
              ))}
          </TextField>
          {typeSubtypes.length > 0 && (
            <TextField
              select
              label={t("reports:builder.subtypes")}
              value={subtypes}
              onChange={(e) =>
                setSubtypes(
                  typeof e.target.value === "string"
                    ? e.target.value.split(",").filter(Boolean)
                    : (e.target.value as unknown as string[]),
                )
              }
              size="small"
              sx={{ minWidth: 200 }}
              SelectProps={{
                multiple: true,
                renderValue: (sel) => `${(sel as string[]).length} ${t("reports:builder.selected")}`,
              }}
            >
              {typeSubtypes.map((st) => (
                <MenuItem key={st.key} value={st.key}>
                  <Checkbox checked={subtypes.includes(st.key)} size="small" />
                  <ListItemText primary={rl(st.key, st.translations)} />
                </MenuItem>
              ))}
            </TextField>
          )}
        </Box>

        {/* Filters */}
        <SectionHeader
          label={t("reports:builder.filtersSection")}
          onAdd={() => setFilters([...filters, { target: "attribute", key: "", op: "eq", value: "" }])}
          addLabel={t("reports:builder.addFilter")}
          disabled={!cardType}
        />
        {filters.map((f, i) => (
          <Box key={i} sx={{ display: "flex", gap: 1, mb: 1, alignItems: "center", flexWrap: "wrap" }}>
            <TextField
              select
              label={t("reports:builder.target")}
              value={f.target}
              onChange={(e) => updateRow(filters, setFilters, i, { target: e.target.value, key: "" })}
              size="small"
              sx={{ minWidth: 140 }}
            >
              {FILTER_TARGETS.map((x) => (
                <MenuItem key={x} value={x}>
                  {t(`reports:builder.target_${x}`)}
                </MenuItem>
              ))}
            </TextField>
            {f.target === "attribute" && (
              <TextField
                select
                label={t("reports:builder.field")}
                value={f.key}
                onChange={(e) => updateRow(filters, setFilters, i, { key: e.target.value })}
                size="small"
                sx={{ minWidth: 160 }}
              >
                {typeFields.map((fld) => (
                  <MenuItem key={fld.key} value={fld.key}>
                    {rl(fld.key, fld.translations)}
                  </MenuItem>
                ))}
              </TextField>
            )}
            <TextField
              select
              label={t("reports:builder.operator")}
              value={f.op}
              onChange={(e) => updateRow(filters, setFilters, i, { op: e.target.value })}
              size="small"
              sx={{ minWidth: 130 }}
            >
              {FILTER_OPS.map((x) => (
                <MenuItem key={x} value={x}>
                  {t(`reports:builder.op_${x}`)}
                </MenuItem>
              ))}
            </TextField>
            {!NO_VALUE_OPS.has(f.op) && <FilterValueInput row={f} field={fieldByKey(f.key)} rl={rl} onChange={(v) => updateRow(filters, setFilters, i, { value: v })} t={t} />}
            <IconButton size="small" onClick={() => setFilters(filters.filter((_, idx) => idx !== i))}>
              <MaterialSymbol icon="delete" size={18} />
            </IconButton>
          </Box>
        ))}

        <Divider sx={{ my: 2 }} />

        {/* Dimensions */}
        <SectionHeader
          label={t("reports:builder.dimensionsSection")}
          onAdd={() => setDimensions([...dimensions, { kind: "attribute", key: "" }])}
          addLabel={t("reports:builder.addDimension")}
          disabled={!cardType || dimensions.length >= MAX_DIMENSIONS}
        />
        {dimensions.map((d, i) => (
          <Box key={i} sx={{ display: "flex", gap: 1, mb: 1, alignItems: "center", flexWrap: "wrap" }}>
            <TextField
              select
              label={t("reports:builder.kind")}
              value={d.kind}
              onChange={(e) => updateRow(dimensions, setDimensions, i, { kind: e.target.value, key: "" })}
              size="small"
              sx={{ minWidth: 150 }}
            >
              {DIM_KINDS.map((x) => (
                <MenuItem key={x} value={x}>
                  {t(`reports:builder.dim_${x}`)}
                </MenuItem>
              ))}
            </TextField>
            {["attribute", "relation", "tag_group"].includes(d.kind) && (
              <TextField
                select
                label={t("reports:builder.field")}
                value={d.key}
                onChange={(e) => updateRow(dimensions, setDimensions, i, { key: e.target.value })}
                size="small"
                sx={{ minWidth: 180 }}
              >
                {dimKeyOptions(d.kind).map((o) => (
                  <MenuItem key={o.value} value={o.value}>
                    {o.label}
                  </MenuItem>
                ))}
              </TextField>
            )}
            <IconButton size="small" onClick={() => setDimensions(dimensions.filter((_, idx) => idx !== i))}>
              <MaterialSymbol icon="delete" size={18} />
            </IconButton>
          </Box>
        ))}

        <Divider sx={{ my: 2 }} />

        {/* Measures */}
        <SectionHeader
          label={t("reports:builder.measuresSection")}
          onAdd={() => setMeasures([...measures, { agg: "count", field: "" }])}
          addLabel={t("reports:builder.addMeasure")}
          disabled={!cardType || measures.length >= MAX_MEASURES}
        />
        {measures.map((m, i) => (
          <Box key={i} sx={{ display: "flex", gap: 1, mb: 1, alignItems: "center", flexWrap: "wrap" }}>
            <TextField
              select
              label={t("reports:builder.aggregation")}
              value={m.agg}
              onChange={(e) => updateRow(measures, setMeasures, i, { agg: e.target.value })}
              size="small"
              sx={{ minWidth: 140 }}
            >
              {AGGS.map((x) => (
                <MenuItem key={x} value={x}>
                  {t(`reports:builder.agg_${x}`)}
                </MenuItem>
              ))}
            </TextField>
            {m.agg !== "count" && (
              <TextField
                select
                label={t("reports:builder.field")}
                value={m.field}
                onChange={(e) => updateRow(measures, setMeasures, i, { field: e.target.value })}
                size="small"
                sx={{ minWidth: 180 }}
              >
                {numericFields.map((fld) => (
                  <MenuItem key={fld.key} value={fld.key}>
                    {rl(fld.key, fld.translations)}
                  </MenuItem>
                ))}
              </TextField>
            )}
            {measures.length > 1 && (
              <IconButton size="small" onClick={() => setMeasures(measures.filter((_, idx) => idx !== i))}>
                <MaterialSymbol icon="delete" size={18} />
              </IconButton>
            )}
          </Box>
        ))}

        <Divider sx={{ my: 2 }} />

        {/* Visualization */}
        <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
          <TextField
            select
            label={t("reports:builder.visualization")}
            value={vizKind}
            onChange={(e) => setVizKind(e.target.value)}
            size="small"
            sx={{ minWidth: 160 }}
          >
            {VIZ_KINDS.map((x) => (
              <MenuItem key={x} value={x}>
                {t(`reports:builder.viz_${x}`)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            type="number"
            label={t("reports:builder.limit")}
            value={limit}
            onChange={(e) => setLimit(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
            size="small"
            sx={{ width: 120 }}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        <Button variant="contained" onClick={handleApply} disabled={!valid}>
          {t("reports:builder.apply")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function SectionHeader({
  label,
  onAdd,
  addLabel,
  disabled,
}: {
  label: string;
  onAdd: () => void;
  addLabel: string;
  disabled?: boolean;
}) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
        {label}
      </Typography>
      <Button
        size="small"
        startIcon={<MaterialSymbol icon="add" size={18} />}
        onClick={onAdd}
        disabled={disabled}
      >
        {addLabel}
      </Button>
    </Box>
  );
}

function FilterValueInput({
  row,
  field,
  rl,
  onChange,
  t,
}: {
  row: FilterRow;
  field?: FieldDef;
  rl: (key: string, tr?: FieldDef["translations"]) => string;
  onChange: (v: string) => void;
  t: (k: string) => string;
}) {
  // A single_select field offers its options; a boolean field offers true/false.
  if (row.target === "attribute" && field?.type === "single_select" && field.options) {
    return (
      <TextField
        select
        label={t("reports:builder.value")}
        value={row.value}
        onChange={(e) => onChange(e.target.value)}
        size="small"
        sx={{ minWidth: 140 }}
      >
        {field.options.map((o) => (
          <MenuItem key={o.key} value={o.key}>
            {rl(o.key, o.translations)}
          </MenuItem>
        ))}
      </TextField>
    );
  }
  if (row.target === "attribute" && field?.type === "boolean") {
    return (
      <TextField
        select
        label={t("reports:builder.value")}
        value={row.value}
        onChange={(e) => onChange(e.target.value)}
        size="small"
        sx={{ minWidth: 120 }}
      >
        <MenuItem value="true">{t("reports:builder.true")}</MenuItem>
        <MenuItem value="false">{t("reports:builder.false")}</MenuItem>
      </TextField>
    );
  }
  return (
    <TextField
      label={t("reports:builder.value")}
      value={row.value}
      onChange={(e) => onChange(e.target.value)}
      size="small"
      sx={{ minWidth: 160 }}
    />
  );
}

function updateRow<T>(rows: T[], setRows: (r: T[]) => void, i: number, patch: Partial<T>) {
  setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
}
