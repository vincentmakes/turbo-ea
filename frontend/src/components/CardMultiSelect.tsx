/**
 * Shared multi-select card picker — the multi-select sibling of
 * `CardPicker`. Built on the same app-wide `useCardSearch` engine, so it
 * inherits the behaviour every card dropdown is expected to have: **browse
 * on open** (lists cards alphabetically with an empty input, never "type to
 * search"), filter-as-you-type against the server, and infinite scroll on
 * the listbox.
 *
 * `CardPicker` is single-select by contract; the sanctioned pattern for
 * genuine multi-select is to consume `useCardSearch` directly, which is what
 * this component does once so call-sites don't hand-roll it.
 */
import { useEffect, useMemo, useState } from "react";
import Autocomplete, { createFilterOptions } from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useCardSearch } from "@/hooks/useCardSearch";
import { isHexColor, readableTypeColor } from "@/lib/color";
import type { CardOption } from "@/components/CardPicker";

// Client-side filter over the loaded options so typing narrows the list
// instantly, while the debounced server query broadens the loaded set in the
// background. Mirrors CardPicker exactly.
const filterCards = createFilterOptions<CardOption>({ stringify: (o) => o.name });

interface CardMultiSelectProps {
  /** Card type key(s) to browse/search. Empty array (or omitted) = all types. */
  types?: string | string[];
  /** Currently selected cards. */
  value: CardOption[];
  onChange: (value: CardOption[]) => void;
  /** Ids to hide from the list (already-linked, self, …). */
  excludeIds?: Iterable<string>;
  /** When false, the picker skips fetching. Defaults to true. */
  enabled?: boolean;
  /** First-page size. Scrolling to the bottom fetches more. Defaults to 50. */
  pageSize?: number;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  size?: "small" | "medium";
  fullWidth?: boolean;
}

export default function CardMultiSelect({
  types,
  value,
  onChange,
  excludeIds,
  enabled = true,
  pageSize = 50,
  placeholder,
  label,
  disabled,
  size = "small",
  fullWidth = true,
}: CardMultiSelectProps) {
  const { t } = useTranslation("common");
  const { getType } = useMetamodel();
  const isDark = useTheme().palette.mode === "dark";

  const typeList = useMemo(
    () => (Array.isArray(types) ? types : types ? [types] : []),
    [types],
  );

  const [input, setInput] = useState("");
  const [debouncedInput, setDebouncedInput] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedInput(input), 250);
    return () => clearTimeout(timer);
  }, [input]);

  const { items, loading, hasMore, loadMore } = useCardSearch({
    types: typeList,
    search: debouncedInput,
    enabled,
    pageSize,
  });

  const options = useMemo(() => {
    const exclude = excludeIds ? new Set(excludeIds) : null;
    const mapped: CardOption[] = items
      .filter((c) => !exclude || !exclude.has(c.id))
      .map((c) => ({ id: c.id, name: c.name, type: c.type }));
    // Keep every selected card resolvable so MUI doesn't warn / blank a chip
    // when that card isn't on the current page of results.
    const loaded = new Set(mapped.map((o) => o.id));
    const missing = value.filter((v) => !loaded.has(v.id));
    return missing.length ? [...missing, ...mapped] : mapped;
  }, [items, excludeIds, value]);

  return (
    <Autocomplete<CardOption, true, false, false>
      multiple
      disableCloseOnSelect
      options={options}
      value={value}
      onChange={(_, next) => onChange(next)}
      getOptionLabel={(o) => o.name}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      onInputChange={(_, val, reason) => {
        if (reason === "input") setInput(val);
        else if (reason === "clear") setInput("");
      }}
      filterOptions={filterCards}
      loading={loading}
      disabled={disabled}
      openOnFocus
      fullWidth={fullWidth}
      size={size}
      noOptionsText={loading ? t("labels.loading") : t("labels.noResults")}
      slotProps={{
        listbox: {
          onScroll: (event) => {
            const el = event.currentTarget;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
              if (hasMore && !loading) loadMore();
            }
          },
        },
      }}
      renderOption={(props, opt) => {
        const tConf = getType(opt.type);
        return (
          <li {...props} key={opt.id}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              {tConf && (
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    bgcolor: tConf.color,
                    flexShrink: 0,
                  }}
                />
              )}
              <Typography variant="body2">{opt.name}</Typography>
            </Box>
          </li>
        );
      }}
      renderTags={(selected, getTagProps) =>
        selected.map((opt, index) => {
          // Card-type colours are admin-editable, so validate before painting
          // and adjust for the active theme rather than using the raw hex.
          const raw = getType(opt.type)?.color;
          const accent = isHexColor(raw) ? readableTypeColor(raw, isDark) : undefined;
          const { key, ...tagProps } = getTagProps({ index });
          return (
            <Chip
              {...tagProps}
              key={key}
              size="small"
              variant="outlined"
              label={opt.name}
              sx={accent ? { borderColor: accent } : undefined}
            />
          );
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          size={size}
          label={label}
          placeholder={value.length ? undefined : placeholder}
          slotProps={{
            input: {
              ...params.InputProps,
              endAdornment: (
                <>
                  {loading ? <CircularProgress color="inherit" size={16} /> : null}
                  {params.InputProps.endAdornment}
                </>
              ),
            },
          }}
        />
      )}
    />
  );
}
