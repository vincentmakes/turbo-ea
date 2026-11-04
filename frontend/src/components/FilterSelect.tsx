import Autocomplete from "@mui/material/Autocomplete";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";

/** Sentinel key used to represent "no value set" in filter selections. */
export const EMPTY_FILTER_KEY = "__empty__";

export default function FilterSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { key: string; label: string; color?: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const { t } = useTranslation("common");
  const emptyOption = { key: EMPTY_FILTER_KEY, label: t("labels.empty"), color: undefined as string | undefined };
  const allOptions = [emptyOption, ...options];

  return (
    <Autocomplete
      multiple
      size="small"
      options={allOptions.map((o) => o.key)}
      getOptionLabel={(key) => allOptions.find((o) => o.key === key)?.label ?? key}
      value={value}
      onChange={(_, v) => onChange(v)}
      disableCloseOnSelect
      renderOption={(props, key) => {
        const opt = allOptions.find((o) => o.key === key);
        const isEmpty = key === EMPTY_FILTER_KEY;
        return (
          <li {...props} key={key}>
            <Typography
              variant="body2"
              sx={{
                fontStyle: isEmpty ? "italic" : undefined,
                color: isEmpty ? "text.secondary" : undefined,
              }}
            >
              {opt?.label ?? key}
            </Typography>
          </li>
        );
      }}
      renderTags={(vals, getTagProps) =>
        vals.map((key, i) => {
          const opt = allOptions.find((o) => o.key === key);
          const isEmpty = key === EMPTY_FILTER_KEY;
          return (
            <Chip
              size="small"
              label={opt?.label ?? key}
              {...getTagProps({ index: i })}
              key={key}
              sx={{
                bgcolor: isEmpty ? "action.selected" : (opt?.color ?? undefined),
                color: opt?.color ? "common.white" : undefined,
                fontWeight: 500,
                fontStyle: isEmpty ? "italic" : undefined,
                fontSize: "0.7rem",
                height: 20,
                maxWidth: 120,
              }}
            />
          );
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={value.length === 0 ? t("labels.all") : ""}
        />
      )}
      sx={{
        minWidth: 180,
        maxWidth: 320,
        alignSelf: "flex-start",
        "& .MuiAutocomplete-inputRoot": {
          flexWrap: "wrap",
          gap: 0.5,
          py: "4px !important",
        },
        "& .MuiInputLabel-root": {
          fontSize: "0.8rem",
          maxWidth: "calc(100% - 40px)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        },
        "& .MuiInputLabel-shrink": {
          maxWidth: "100%",
        },
      }}
    />
  );
}
