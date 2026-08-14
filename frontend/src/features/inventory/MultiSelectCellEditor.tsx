import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Autocomplete from "@mui/material/Autocomplete";
import Checkbox from "@mui/material/Checkbox";
import { useTranslation } from "react-i18next";
import type { GridApi } from "ag-grid-community";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useOptionLabel } from "@/hooks/useResolveLabel";
import { readableTextColor } from "@/lib/color";
import type { FieldOption } from "@/types";

// AG Grid React v32+ custom editor contract — same shape as TagsCellEditor:
// — `props.value` is the initial value
// — `props.onValueChange(newValue)` must be called on every change; AG Grid
//   stores it internally and returns it from `getValue()` when edit ends
// — `props.stopEditing()` ends the edit and commits the latest value
// — `props.api.stopEditing(true)` ends the edit AND discards changes
interface Params {
  /** Normally `string[]`. A bare string when a pre-fix free-text write left
   *  the cell holding a raw value, and `""` for an unset attribute (the
   *  column's valueGetter default). */
  value: unknown;
  options: FieldOption[];
  stopEditing?: (suppressNavigateAfterEdit?: boolean) => void;
  onValueChange: (value: string[]) => void;
  api: GridApi;
}

/** Coerce whatever the cell holds into the array of option keys the editor
 *  works on. A legacy free-text string becomes a one-element array so the
 *  corrupt value is visible and repairable rather than silently dropped —
 *  the same coercion FieldEditor applies on the card-detail page. */
export function toOptionKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  return typeof value === "string" && value ? [value] : [];
}

export default function MultiSelectCellEditor(props: Params) {
  const { t } = useTranslation(["common"]);
  const optLabel = useOptionLabel();
  const [keys, setKeys] = useState<string[]>(() => toOptionKeys(props.value));

  const labelFor = (key: string) => {
    const opt = props.options.find((o) => o.key === key);
    return opt ? optLabel(opt) : key;
  };

  const handleChange = (next: string[]) => {
    setKeys(next);
    props.onValueChange(next);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      props.api.stopEditing(true);
    }
  };

  return (
    <Box
      sx={{ p: 1.5, minWidth: 340, bgcolor: "background.paper" }}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={handleKeyDown}
    >
      <Autocomplete
        multiple
        size="small"
        openOnFocus
        disableCloseOnSelect
        // A portalled listbox renders outside the popup editor, which AG Grid
        // reads as a click away from the cell and ends the edit on the first
        // option click.
        disablePortal
        options={props.options.map((o) => o.key)}
        value={keys}
        getOptionLabel={labelFor}
        onChange={(_, val) => handleChange(val as string[])}
        renderOption={(optProps, key, { selected }) => {
          const opt = props.options.find((o) => o.key === key);
          const { key: liKey, ...liProps } = optProps as React.HTMLAttributes<HTMLLIElement> & {
            key: string;
          };
          return (
            <li key={liKey} {...liProps}>
              <Checkbox size="small" checked={selected} sx={{ p: 0.5, mr: 1 }} />
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                {opt?.color && (
                  <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: opt.color }} />
                )}
                {labelFor(key)}
              </Box>
            </li>
          );
        }}
        renderTags={(vals, getTagProps) =>
          vals.map((key, i) => {
            const opt = props.options.find((o) => o.key === key);
            return (
              <Chip
                size="small"
                label={labelFor(key)}
                {...getTagProps({ index: i })}
                key={key}
                sx={
                  opt?.color
                    ? { bgcolor: opt.color, color: readableTextColor(opt.color) }
                    : undefined
                }
              />
            );
          })
        }
        renderInput={(params) => <TextField {...params} autoFocus />}
      />
      <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 1.5 }}>
        <Button
          size="small"
          onClick={() => props.api.stopEditing(true)}
          startIcon={<MaterialSymbol icon="close" size={16} />}
        >
          {t("common:actions.cancel")}
        </Button>
        <Button
          size="small"
          variant="contained"
          onClick={() => props.stopEditing?.()}
          startIcon={<MaterialSymbol icon="check" size={16} />}
        >
          {t("common:actions.save")}
        </Button>
      </Stack>
    </Box>
  );
}
