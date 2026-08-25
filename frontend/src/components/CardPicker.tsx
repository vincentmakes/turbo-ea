import { useEffect, useMemo, useState } from "react";
import Autocomplete, { type AutocompleteRenderInputParams } from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { SxProps, Theme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useCardSearch, useFillVisible } from "@/hooks/useCardSearch";
import { compareByRank, searchRank } from "@/lib/searchRank";

/** Minimal card shape a picker needs. The full card from the API is a superset. */
export interface CardOption {
  id: string;
  name: string;
  type: string;
}

// Client-side filter + rank over the loaded options, matched on name. This
// makes the list narrow instantly from the first character typed, while the
// debounced server query broadens the loaded set across the full catalog in
// the background. Without it, the browse-on-open list would linger unfiltered
// for the debounce window after each keystroke.
//
// The ranking mirrors the server's (`searchRank.ts` ↔ `_search_rank` in
// `cards.py`), so the order doesn't jump when the debounced response lands.
//
// Known, pre-existing: the server matches name OR description while this
// filter matches name only, so a card that matched purely on its description
// is fetched and then hidden here. `CardOption` carries no description to
// match against; widening it is a separate change.
function filterAndRank(options: CardOption[], query: string): CardOption[] {
  const q = query.trim();
  if (!q) return options;
  return options.filter((o) => searchRank(o.name, q) >= 0).sort(compareByRank(q));
}

interface CardPickerBaseProps {
  /** Card type key(s) to browse/search. Empty array (or omitted) = all types. */
  types?: string | string[];
  /** Ids to hide from the list (self, ancestors, descendants, already-linked, …). */
  excludeIds?: Iterable<string>;
  /** When false, the picker clears and skips fetching. Defaults to true. */
  enabled?: boolean;
  /** Observe the typed text (e.g. to seed a "create new" card name). */
  onInputChange?: (value: string) => void;
  /** Forwarded to the Autocomplete (e.g. to close an inline-edit cell). */
  onBlur?: () => void;
  /** First-page size. Scrolling to the bottom fetches more. Defaults to 50. */
  pageSize?: number;
  placeholder?: string;
  label?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  size?: "small" | "medium";
  fullWidth?: boolean;
  error?: boolean;
  helperText?: string;
  /**
   * Overrides the "No results" text, e.g. to explain that everything on offer
   * is already linked rather than that nothing matched.
   */
  noOptionsText?: string;
  /** Opens the dropdown on focus so the list browses without typing. Defaults to true. */
  openOnFocus?: boolean;
  sx?: SxProps<Theme>;
}

/**
 * Single- and multi-select are one component on purpose: everything that makes
 * this picker worth reusing — browse-on-open, rank-as-you-type, paging past the
 * first page — is identical either way, and a second component would drift.
 * The union keeps `value`/`onChange` honest per mode, so existing single-select
 * call sites type-check unchanged.
 */
type CardPickerProps =
  | (CardPickerBaseProps & {
      multiple?: false;
      /** Currently selected card, or null. */
      value: CardOption | null;
      onChange: (value: CardOption | null) => void;
    })
  | (CardPickerBaseProps & {
      multiple: true;
      /** Currently selected cards. */
      value: CardOption[];
      onChange: (value: CardOption[]) => void;
    });

/**
 * Shared card picker, single- or multi-select (`multiple`). Browses on open
 * (shows cards alphabetically with an empty input), filters as you type, and
 * pages in more cards as the dropdown scrolls — all on top of the app-wide
 * `useCardSearch` hook so the inventory grid and every dropdown share one
 * engine (Discussion #702).
 */
export default function CardPicker(props: CardPickerProps) {
  const {
  types,
  excludeIds,
  enabled = true,
  onInputChange,
  onBlur,
  pageSize = 50,
  placeholder,
  label,
  autoFocus,
  disabled,
  size = "small",
  fullWidth,
  error,
  helperText,
  noOptionsText,
  openOnFocus = true,
  sx,
  } = props;
  // Read off `props` rather than destructuring, so TypeScript keeps the
  // discriminant and the value/onChange pair narrowed together.
  const multiple = props.multiple === true;
  const singleValue = multiple ? null : props.value;
  const multiValue = multiple ? props.value : null;
  // Memoised: the single-select branch mints a fresh array each render, which
  // would re-run the options memo below on every render.
  const selected: CardOption[] = useMemo(
    () => (multiValue ? multiValue : singleValue ? [singleValue] : []),
    [multiValue, singleValue],
  );

  const { t } = useTranslation("common");
  const { getType } = useMetamodel();

  const typeList = useMemo(
    () => (Array.isArray(types) ? types : types ? [types] : []),
    [types],
  );

  // Only the typed value drives search; selecting a card sets the input to the
  // card's label (reason "reset"), which must not trigger a fresh query.
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

  const { options, offered } = useMemo(() => {
    const exclude = excludeIds ? new Set(excludeIds) : null;
    const mapped: CardOption[] = items
      .filter((c) => !exclude || !exclude.has(c.id))
      .map((c) => ({ id: c.id, name: c.name, type: c.type }));
    // How many genuinely pickable rows survived exclusion — counted before the
    // selected value is re-injected below, so that injected row can't mask an
    // otherwise-empty list.
    const offered = mapped.length;
    // Keep every selected card resolvable so MUI doesn't warn / blank a chip
    // out when that card isn't on the current page of results.
    const present = new Set(mapped.map((o) => o.id));
    for (const sel of selected) {
      if (!present.has(sel.id)) mapped.unshift(sel);
    }
    return { options: mapped, offered };
  }, [items, excludeIds, selected]);

  // `excludeIds` is applied above, *after* paging, so hidden cards consume page
  // slots — keep fetching until the list is usable (#918). Inert when nothing
  // is excluded.
  const autoPaging = useFillVisible({
    enabled,
    loading,
    hasMore,
    visible: offered,
    pageSize,
    loadMore,
    resetKey: debouncedInput,
  });

  // Everything that doesn't depend on multiplicity. Spread into whichever
  // Autocomplete generic the mode calls for, so the two modes cannot drift.
  const shared = {
    options,
    onBlur,
    getOptionLabel: (o: CardOption) => o.name,
    isOptionEqualToValue: (a: CardOption, b: CardOption) => a.id === b.id,
    onInputChange: (_: unknown, val: string, reason: string) => {
      if (reason === "input") {
        setInput(val);
        onInputChange?.(val);
      } else if (reason === "clear") {
        setInput("");
        onInputChange?.("");
      } else if (reason === "reset" && multiple) {
        // Multi-select clears the box after each pick. Single-select instead
        // *fills* it with the chosen card's name, which must not re-query —
        // hence the mode check rather than clearing on every reset.
        setInput("");
        onInputChange?.("");
      }
    },
    // Filter + rank the loaded options by name so typing narrows the list
    // instantly (the server query refines/extends it on a debounce).
    filterOptions: (opts: CardOption[], state: { inputValue: string }) =>
      filterAndRank(opts, state.inputValue),
    loading,
    disabled,
    openOnFocus,
    fullWidth,
    size,
    sx,
    noOptionsText:
      loading || autoPaging ? t("labels.loading") : (noOptionsText ?? t("labels.noResults")),
    slotProps: {
      listbox: {
        onScroll: (event: React.UIEvent<HTMLUListElement>) => {
          const el = event.currentTarget;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
            if (hasMore && !loading) loadMore();
          }
        },
      },
    },
    renderOption: (liProps: React.HTMLAttributes<HTMLLIElement> & { key?: string }, opt: CardOption) => {
      const tConf = getType(opt.type);
      return (
        <li {...liProps} key={opt.id}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            {tConf && (
              <Box
                sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: tConf.color, flexShrink: 0 }}
              />
            )}
            <Typography variant="body2">{opt.name}</Typography>
          </Box>
        </li>
      );
    },
    renderInput: (params: AutocompleteRenderInputParams) => (
      <TextField
        {...params}
        size={size}
        label={label}
        placeholder={placeholder}
        autoFocus={autoFocus}
        error={error}
        helperText={helperText}
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
    ),
  };

  if (props.multiple) {
    const onChangeMulti = props.onChange;
    return (
      <Autocomplete<CardOption, true, false, false>
        {...shared}
        multiple
        disableCloseOnSelect
        filterSelectedOptions
        value={props.value}
        onChange={(_, val) => onChangeMulti(val)}
        renderTags={(vals, getTagProps) =>
          vals.map((v, i) => {
            const { key, ...chipProps } = getTagProps({ index: i });
            const tConf = getType(v.type);
            return (
              <Chip
                {...chipProps}
                key={key}
                label={v.name}
                size="small"
                // Tinted rather than filled: a card chip is identified by its
                // type, but a row of saturated chips would out-shout the field.
                sx={tConf ? { bgcolor: `${tConf.color}22` } : undefined}
              />
            );
          })
        }
      />
    );
  }

  const onChangeSingle = props.onChange;
  return (
    <Autocomplete<CardOption, false, false, false>
      {...shared}
      value={props.value}
      onChange={(_, val) => onChangeSingle(val)}
    />
  );
}
