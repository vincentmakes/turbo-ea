import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import FilterSelect from "@/components/FilterSelect";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { FacetFieldLike } from "@/lib/fieldFacets";
import { removeFilterField } from "@/lib/fieldFilters";
import type { FieldFilterState, RenderedFilterRow } from "@/lib/fieldFilters";

export interface FieldFilterControlProps<F extends FacetFieldLike> {
  row: RenderedFilterRow<F>;
  value: FieldFilterState;
  onChange: (patch: Partial<FieldFilterState>) => void;
}

/**
 * One field's filter control, by its kind: a facet field is the shared
 * `FilterSelect` (its props unchanged — it is on the extension UI SDK). A row
 * that is not shown by default carries a remove button, which also clears the
 * row's value, so a removed filter never keeps narrowing out of sight.
 */
export default function FieldFilterControl<F extends FacetFieldLike>({
  row,
  value,
  onChange,
}: FieldFilterControlProps<F>) {
  const { t } = useTranslation("common");
  const { field } = row;

  // One case per `FilterKind`; a new kind adds its control here.
  const control = (
    <FilterSelect
      label={field.label}
      options={(field.options ?? []).map((o) => ({ key: o.key, label: o.label, color: o.color }))}
      value={value.attrFilters[field.key] || []}
      onChange={(v) => onChange({ attrFilters: { ...value.attrFilters, [field.key]: v } })}
    />
  );

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
