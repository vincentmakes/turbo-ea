import { useEffect, useMemo, useRef, useState } from "react";
import Autocomplete, { type AutocompleteProps } from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useCardSearch } from "@/hooks/useCardSearch";
import { compareByRank, searchRank } from "@/lib/searchRank";

/** Minimal card shape a picker needs. The full card from the API is a superset. */
export interface CardOption {
  id: string;
  name: string;
  type: string;
}

/** Keep auto-paging until at least this many pickable rows are on offer. */
const AUTO_PAGE_MIN_VISIBLE = 20;
/** Hard stop, so an exclude-everything case can't walk the whole catalogue. */
const AUTO_PAGE_CAP = 10;

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

interface CardPickerProps {
  /** Card type key(s) to browse/search. Empty array (or omitted) = all types. */
  types?: string | string[];
  /** Currently selected card, or null. */
  value: CardOption | null;
  onChange: (value: CardOption | null) => void;
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
  sx?: AutocompleteProps<CardOption, false, false, false>["sx"];
}

/**
 * Shared single-select card picker. Browses on open (shows cards alphabetically
 * with an empty input), filters as you type, and pages in more cards as the
 * dropdown scrolls — all on top of the app-wide `useCardSearch` hook so the
 * inventory grid and every dropdown share one engine (Discussion #702).
 */
export default function CardPicker({
  types,
  value,
  onChange,
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
}: CardPickerProps) {
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
    // Keep the selected value resolvable so MUI doesn't warn / blank it out
    // when it isn't on the current page of results.
    if (value && !mapped.some((o) => o.id === value.id)) mapped.unshift(value);
    return { options: mapped, offered };
  }, [items, excludeIds, value]);

  // Exclusion happens here, *after* paging, so excluded cards consume page
  // slots: a card already linked to 200 of 223 Organizations would fetch a
  // full page and show almost nothing. Keep paging until there is a usable
  // list, bounded so an exclude-everything case can't walk the whole catalogue
  // on each keystroke (#918).
  //
  // This is inert for every picker that passes no `excludeIds`: with none, a
  // page that reports `hasMore` always yields at least `pageSize` options, so
  // the condition never holds.
  const minVisible = Math.min(AUTO_PAGE_MIN_VISIBLE, pageSize);
  const autoPages = useRef(0);
  useEffect(() => {
    autoPages.current = 0;
  }, [debouncedInput, typeList, enabled]);
  useEffect(() => {
    if (!enabled || loading || !hasMore) return;
    if (offered >= minVisible) return;
    if (autoPages.current >= AUTO_PAGE_CAP) return;
    autoPages.current += 1;
    loadMore();
  }, [enabled, loading, hasMore, offered, minVisible, loadMore]);
  // Don't say "no results" while we're still walking pages looking for some.
  const autoPaging = offered < minVisible && hasMore && autoPages.current < AUTO_PAGE_CAP;

  return (
    <Autocomplete<CardOption, false, false, false>
      options={options}
      value={value}
      onChange={(_, val) => onChange(val)}
      onBlur={onBlur}
      getOptionLabel={(o) => o.name}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      onInputChange={(_, val, reason) => {
        if (reason === "input") {
          setInput(val);
          onInputChange?.(val);
        } else if (reason === "clear") {
          setInput("");
          onInputChange?.("");
        }
      }}
      // Filter + rank the loaded options by name so typing narrows the list
      // instantly (the server query refines/extends it on a debounce).
      filterOptions={(opts, state) => filterAndRank(opts, state.inputValue)}
      loading={loading}
      disabled={disabled}
      openOnFocus={openOnFocus}
      fullWidth={fullWidth}
      size={size}
      sx={sx}
      noOptionsText={
        loading || autoPaging
          ? t("labels.loading")
          : (noOptionsText ?? t("labels.noResults"))
      }
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
                  sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: tConf.color, flexShrink: 0 }}
                />
              )}
              <Typography variant="body2">{opt.name}</Typography>
            </Box>
          </li>
        );
      }}
      renderInput={(params) => (
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
      )}
    />
  );
}
