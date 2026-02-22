import Autocomplete from "@mui/material/Autocomplete";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

/** Sentinel key used to represent "no value set" in filter selections. */
export const EMPTY_FILTER_KEY = "__empty__";

const EMPTY_OPTION = { key: EMPTY_FILTER_KEY, label: "(empty)", color: undefined as string | undefined };

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
  const allOptions = [EMPTY_OPTION, ...options];

  return (
    <Autocomplete
      multiple
      size="small"
      limitTags={1}
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
                color: opt?.color ? "#fff" : undefined,
                fontWeight: 500,
                fontStyle: isEmpty ? "italic" : undefined,
                fontSize: "0.7rem",
                height: 22,
                maxWidth: 110,
              }}
            />
          );
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={value.length === 0 ? "All" : ""}
        />
      )}
      sx={{
        width: 180,
        "& .MuiAutocomplete-inputRoot": {
          flexWrap: "nowrap",
          pr: "56px !important",
        },
        "& .MuiAutocomplete-endAdornment": {
          right: "6px !important",
        },
        "& .MuiInputLabel-root": {
          maxWidth: "calc(100% - 56px)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        },
      }}
    />
  );
}
