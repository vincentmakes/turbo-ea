/**
 * The category (EA layer) picker of a card type: a combobox over the category
 * registry that can also create a category inline.
 *
 * The value is always a registry key, or `null` for "uncategorized" — never
 * free text (the API refuses a category it does not know). Typing a name that
 * matches nothing offers a "Create category “…”" row, the same pattern as
 * `components/VendorField.tsx`; picking it opens `CategoryEditDialog` with the
 * name prefilled, and the new category is selected once it is saved. A stored
 * value the registry lacks (written before the registry existed) still shows,
 * under its raw name, so opening a type never blanks its category.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Autocomplete, { createFilterOptions } from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useCardTypeCategories } from "@/hooks/useCardTypeCategories";
import { categoryLabel } from "@/hooks/useResolveLabel";
import { DEFAULT_LAYER_COLOR } from "@/theme/tokens";
import CategoryEditDialog from "./CategoryEditDialog";

interface CategoryOption {
  key: string;
  label: string;
  color: string;
  /** The synthetic "Create …" row. */
  isNew?: boolean;
  /** What was typed, for the create row. */
  inputValue?: string;
}

export interface CategoryComboboxProps {
  /** A registry key, or `null` for uncategorized. */
  value: string | null;
  onChange: (key: string | null) => void;
  label?: string;
  helperText?: string;
  size?: "small" | "medium";
  disabled?: boolean;
  /** Offer the inline "Create …" row. Default `true`. */
  canCreate?: boolean;
}

const filter = createFilterOptions<CategoryOption>({
  stringify: (o) => `${o.label} ${o.key}`,
});

export default function CategoryCombobox({
  value,
  onChange,
  label,
  helperText,
  size = "medium",
  disabled = false,
  canCreate = true,
}: CategoryComboboxProps) {
  const { t, i18n } = useTranslation(["admin"]);
  const { categories } = useCardTypeCategories();
  const [createLabel, setCreateLabel] = useState<string | null>(null);

  const options = useMemo<CategoryOption[]>(() => {
    const rows = categories.map((c) => ({
      key: c.key,
      label: categoryLabel(c, i18n.language),
      color: c.color,
    }));
    const current = value?.trim();
    if (current && !rows.some((r) => r.key === current)) {
      rows.push({ key: current, label: current, color: DEFAULT_LAYER_COLOR });
    }
    return rows;
  }, [categories, i18n.language, value]);

  const selected = useMemo(
    () => options.find((o) => o.key === value?.trim()) ?? null,
    [options, value],
  );

  return (
    <>
      <Autocomplete<CategoryOption, false, false, false>
        size={size}
        fullWidth
        disabled={disabled}
        value={selected}
        options={options}
        isOptionEqualToValue={(a, b) => a.key === b.key}
        getOptionLabel={(o) => o.label}
        onChange={(_e, next) => {
          if (next?.isNew) {
            setCreateLabel(next.inputValue ?? "");
            return;
          }
          onChange(next ? next.key : null);
        }}
        filterOptions={(opts, params) => {
          const filtered = filter(opts, params);
          const typed = params.inputValue.trim();
          const folded = typed.toLowerCase();
          if (
            canCreate &&
            typed &&
            !opts.some(
              (o) => o.label.toLowerCase() === folded || o.key.toLowerCase() === folded,
            )
          ) {
            filtered.push({
              key: `__new__:${typed}`,
              label: t("metamodel.categories.createOption", { name: typed }),
              color: DEFAULT_LAYER_COLOR,
              isNew: true,
              inputValue: typed,
            });
          }
          return filtered;
        }}
        renderOption={(props, option) => {
          const { key, ...rest } = props;
          return (
            <li key={key} {...rest}>
              {option.isNew ? (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "primary.main" }}>
                  <MaterialSymbol icon="add_circle" size={18} />
                  <Typography variant="body2">{option.label}</Typography>
                </Box>
              ) : (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Box
                    data-testid="category-dot"
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      bgcolor: option.color,
                      flexShrink: 0,
                    }}
                  />
                  <Typography variant="body2">{option.label}</Typography>
                </Box>
              )}
            </li>
          );
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            label={label ?? t("metamodel.category")}
            placeholder={t("metamodel.uncategorized")}
            helperText={helperText}
            InputProps={{
              ...params.InputProps,
              startAdornment: selected ? (
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    bgcolor: selected.color,
                    flexShrink: 0,
                    ml: 0.5,
                  }}
                />
              ) : undefined,
            }}
          />
        )}
      />
      <CategoryEditDialog
        open={createLabel !== null}
        initialLabel={createLabel ?? ""}
        onClose={() => setCreateLabel(null)}
        onSaved={(created) => {
          setCreateLabel(null);
          onChange(created.key);
        }}
      />
    </>
  );
}
