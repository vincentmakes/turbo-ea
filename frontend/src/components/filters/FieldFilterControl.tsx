import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import { DateField } from "@/components/DateField";
import FilterSelect from "@/components/FilterSelect";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { FacetFieldLike } from "@/lib/fieldFacets";
import { removeFilterField, setCondition, shapeOfCondition } from "@/lib/fieldFilters";
import type {
  DateCondition,
  FieldFilterState,
  NumberCondition,
  RenderedFilterRow,
  TextCondition,
} from "@/lib/fieldFilters";

export interface FieldFilterControlProps<F extends FacetFieldLike> {
  row: RenderedFilterRow<F>;
  value: FieldFilterState;
  /**
   * A change to the row's value, fired on every keystroke of a text or
   * number box and when a date box is left. A report applies it at once —
   * it holds every card. A caller that sends the value to a server (the
   * portal viewer) debounces what it sends, never this control.
   */
  onChange: (patch: Partial<FieldFilterState>) => void;
}

/** What every typed box shares, sized to sit in one wrapping row with `FilterSelect`. */
const BOX_SX = {
  alignSelf: "flex-start",
  "& .MuiInputLabel-root": {
    fontSize: "0.8rem",
    maxWidth: "calc(100% - 24px)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  "& .MuiInputLabel-shrink": { maxWidth: "100%" },
  "& .MuiInputBase-input": { fontSize: "0.85rem" },
} as const;

/** A typed bound as a number, or `undefined` when blank or not a number. */
export function parseBound(text: string): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * One end of a number range. It keeps the text being typed ("1.", "-") as a
 * local draft and reports the number it reads, so a half-typed value is
 * neither lost nor applied; a new value from outside (Clear all) replaces
 * the draft unless the draft already reads as that value.
 */
function NumberBound({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (next: number | undefined) => void;
}) {
  const [draft, setDraft] = useState(value === undefined ? "" : String(value));
  useEffect(() => {
    setDraft((d) => (parseBound(d) === value ? d : value === undefined ? "" : String(value)));
  }, [value]);
  return (
    <TextField
      size="small"
      type="number"
      label={label}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(parseBound(e.target.value));
      }}
      sx={{ ...BOX_SX, width: 130 }}
    />
  );
}

/**
 * One field's filter control, by its kind: a facet field is the shared
 * `FilterSelect` (its props unchanged — it is on the extension UI SDK); a
 * text field a "contains" box with a clear button; a number field a min and
 * a max box; a date field a from and a to `DateField`. Labels are static (the
 * theme owns their placement). A row that is not shown by default carries a
 * remove button, which also clears the row's value, so a removed filter
 * never keeps narrowing out of sight.
 */
export default function FieldFilterControl<F extends FacetFieldLike>({
  row,
  value,
  onChange,
}: FieldFilterControlProps<F>) {
  const { t } = useTranslation("common");
  const { field, kind } = row;
  const conditions = value.attrConditions ?? {};
  // The stored condition only when it is of this row's kind: a leftover of
  // another shape (the field's type changed) is shown empty and never spread
  // into the next write, which would make a mixed shape no reader accepts.
  const stored = conditions[field.key];
  const current = shapeOfCondition(stored) === kind ? stored : undefined;
  const setCond = (next: TextCondition | NumberCondition | DateCondition) => {
    if (kind === "facet") return;
    onChange({ attrConditions: setCondition(conditions, field.key, kind, next) });
  };

  let control: ReactNode;
  if (kind === "text") {
    const text = current ? (current as TextCondition).contains : "";
    const clearLabel = t("fieldFilters.clearValue", { field: field.label });
    control = (
      <TextField
        size="small"
        label={field.label}
        value={text}
        placeholder={t("fieldFilters.containsPlaceholder")}
        onChange={(e) => setCond({ contains: e.target.value })}
        sx={{ ...BOX_SX, width: 180 }}
        slotProps={{
          input: {
            endAdornment: text ? (
              <IconButton size="small" aria-label={clearLabel} onClick={() => setCond({ contains: "" })} edge="end">
                <MaterialSymbol icon="close" size={16} />
              </IconButton>
            ) : undefined,
          },
        }}
      />
    );
  } else if (kind === "number") {
    const range = (current ?? {}) as NumberCondition;
    control = (
      <Box role="group" aria-label={field.label} sx={{ display: "inline-flex", gap: 0.5, alignSelf: "flex-start" }}>
        <NumberBound
          label={t("fieldFilters.rangeFrom", { field: field.label })}
          value={range.min}
          onChange={(min) => setCond({ ...range, min })}
        />
        <NumberBound
          label={t("fieldFilters.rangeTo", { field: field.label })}
          value={range.max}
          onChange={(max) => setCond({ ...range, max })}
        />
      </Box>
    );
  } else if (kind === "date") {
    const range = (current ?? {}) as DateCondition;
    const bound = (v: string) => v || undefined;
    control = (
      <Box role="group" aria-label={field.label} sx={{ display: "inline-flex", gap: 0.5, alignSelf: "flex-start" }}>
        <DateField
          size="small"
          label={t("fieldFilters.rangeFrom", { field: field.label })}
          value={range.from ?? ""}
          onChange={(v) => setCond({ ...range, from: bound(v) })}
          sx={{ ...BOX_SX, width: 160 }}
        />
        <DateField
          size="small"
          label={t("fieldFilters.rangeTo", { field: field.label })}
          value={range.to ?? ""}
          onChange={(v) => setCond({ ...range, to: bound(v) })}
          sx={{ ...BOX_SX, width: 160 }}
        />
      </Box>
    );
  } else {
    control = (
      <FilterSelect
        label={field.label}
        options={(field.options ?? []).map((o) => ({ key: o.key, label: o.label, color: o.color }))}
        value={value.attrFilters[field.key] || []}
        onChange={(v) => onChange({ attrFilters: { ...value.attrFilters, [field.key]: v } })}
      />
    );
  }

  if (!row.removable) return control;
  const removeLabel = t("fieldFilters.remove", { field: field.label });
  return (
    <Box
      data-filter-field={field.key}
      sx={{ display: "inline-flex", alignItems: "center", gap: 0.25, alignSelf: "flex-start" }}
    >
      {control}
      <Tooltip title={removeLabel}>
        <IconButton
          size="small"
          aria-label={removeLabel}
          onClick={() => onChange(removeFilterField(value, field.key))}
        >
          <MaterialSymbol icon="close" size={16} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
