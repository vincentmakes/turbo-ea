import { useMemo } from "react";
import Autocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";
import Chip from "@mui/material/Chip";
import Box from "@mui/material/Box";
import { useTranslation } from "react-i18next";
import type { SxProps, Theme } from "@mui/material/styles";
import type { TagGroup } from "@/types";

interface TagOption {
  id: string;
  name: string;
  color?: string;
  group_id: string;
  group_name: string;
  group_mode: string;
}

interface Props {
  groups: TagGroup[];
  value: string[];
  onChange: (ids: string[]) => void;
  typeKey?: string;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  size?: "small" | "medium";
  sx?: SxProps<Theme>;
}

export default function TagPicker({
  groups,
  value,
  onChange,
  typeKey,
  label,
  placeholder,
  disabled = false,
  size,
  sx,
}: Props) {
  const { t } = useTranslation("cards");

  const applicableGroups = useMemo(
    () =>
      typeKey
        ? groups.filter(
            (g) =>
              !g.restrict_to_types ||
              g.restrict_to_types.length === 0 ||
              g.restrict_to_types.includes(typeKey),
          )
        : groups,
    [groups, typeKey],
  );

  const options: TagOption[] = useMemo(
    () =>
      applicableGroups.flatMap((g) =>
        g.tags.map((tag) => ({
          id: tag.id,
          name: tag.name,
          color: tag.color,
          group_id: g.id,
          group_name: g.name,
          group_mode: g.mode,
        })),
      ),
    [applicableGroups],
  );

  const selected = options.filter((o) => value.includes(o.id));

  // Enforce single-mode: when a tag from a single-mode group is selected,
  // drop any previously selected tag from the same group (keep the newer).
  const handleChange = (next: TagOption[]) => {
    const multi: string[] = [];
    const singleByGroup = new Map<string, string>();
    for (const opt of next) {
      if (opt.group_mode === "single") {
        singleByGroup.set(opt.group_id, opt.id);
      } else {
        multi.push(opt.id);
      }
    }
    onChange([...multi, ...singleByGroup.values()]);
  };

  const compactSx =
    size === "small"
      ? {
          alignSelf: "flex-start",
          "& .MuiAutocomplete-inputRoot": {
            flexWrap: "wrap",
            gap: 0.5,
            py: "4px !important",
          },
        }
      : undefined;

  return (
    <Autocomplete
      multiple
      disabled={disabled}
      size={size}
      sx={[compactSx, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])] as typeof sx}
      options={options}
      value={selected}
      onChange={(_, next) => handleChange(next as TagOption[])}
      groupBy={(o) =>
        `${o.group_name}${o.group_mode === "single" ? ` · ${t("tags.singleMode")}` : ""}`
      }
      getOptionLabel={(o) => o.name}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      renderOption={(props, option) => (
        <li {...props} key={option.id}>
          {option.color && (
            <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                bgcolor: option.color,
                mr: 1,
                flexShrink: 0,
              }}
            />
          )}
          {option.name}
        </li>
      )}
      renderTags={(value, getTagProps) =>
        value.map((option, index) => {
          const { key, ...chipProps } = getTagProps({ index });
          return (
            <Chip
              key={key}
              label={`${option.group_name}: ${option.name}`}
              size="small"
              sx={{
                ...(size === "small"
                  ? { height: 20, fontSize: "0.7rem", fontWeight: 500, maxWidth: 180 }
                  : {}),
                ...(option.color ? { bgcolor: option.color, color: "#fff" } : {}),
              }}
              {...chipProps}
            />
          );
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={label ?? t("tags.pickerLabel")}
          placeholder={placeholder ?? t("tags.pickerPlaceholder")}
          sx={
            size === "small"
              ? {
                  "& .MuiInputLabel-root": {
                    fontSize: "0.8rem",
                    maxWidth: "calc(100% - 40px)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  },
                  "& .MuiInputLabel-shrink": { maxWidth: "100%" },
                  "& .MuiInputBase-input": { fontSize: "0.8rem" },
                }
              : undefined
          }
        />
      )}
    />
  );
}
