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
import {
  bestRankBySubtree,
  buildChildIndex,
  flattenTree,
  visibleForQuery,
} from "@/lib/cardTree";
import { compareByRank, searchRank } from "@/lib/searchRank";

/** Minimal card shape a picker needs. The full card from the API is a superset. */
export interface CardOption {
  id: string;
  name: string;
  type: string;
  /** Only carried in `hierarchy` mode, where the tree is built from it. */
  parent_id?: string | null;
}

/**
 * Page budget for `hierarchy` mode — the same one `AddRelationsDialog`,
 * `CardScopeDialog` and `CardMultiPicker` use. A hierarchy cannot be rendered
 * from a partial set (a child whose parent never loaded surfaces as a bogus
 * root), so it pulls the whole type in; past the cap the picker silently
 * returns to its ordinary flat, server-searched behaviour.
 */
const MAX_TREE_PAGES = 5;
const TREE_PAGE_SIZE = 1000;
/**
 * Nothing is "selected" in the tree sense here — a pick is just the field's
 * value. Shared so the flatten memo has a stable dependency.
 */
const EMPTY_IDS = new Set<string>();

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
  /**
   * Render the options as an indented tree when a single hierarchical type is
   * browsed (discussion #1050) — a sub-capability's level is not readable from
   * its name alone.
   *
   * Opt-in, and deliberately off by default: it loads the whole type up front,
   * which is right for a dialog the user opened on purpose and wrong for an
   * AG Grid cell editor that mounts on every cell edit (`ParentCellEditor`).
   * Non-hierarchical types, and types too large for the page budget, fall back
   * to the ordinary flat list with no visible difference.
   */
  hierarchy?: boolean;
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
  hierarchy = false,
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

  const [pagesWalked, setPagesWalked] = useState(0);
  /**
   * Latched, not derived: once the type proves too big to load whole, the
   * picker stays flat. Deriving it would let it flicker off the moment a
   * server-filtered page reported `hasMore: false`, rebuilding a tree from a
   * partial set.
   */
  const [flatMode, setFlatMode] = useState(false);
  const typeKey = useMemo(() => [...typeList].sort().join(","), [typeList]);

  // A tree can only be built for exactly one hierarchical type.
  const treeAttempt =
    hierarchy && typeList.length === 1 && Boolean(getType(typeList[0])?.has_hierarchy) && !flatMode;

  const { items, loading, hasMore, loadMore } = useCardSearch({
    types: typeList,
    // A tree needs the whole type in memory, so it browses unfiltered and
    // filters client-side; only the flat path searches server-side.
    search: treeAttempt ? "" : debouncedInput,
    enabled,
    pageSize: treeAttempt ? TREE_PAGE_SIZE : pageSize,
  });

  // A different type gets its own budget.
  useEffect(() => {
    setPagesWalked(0);
    setFlatMode(false);
  }, [typeKey]);

  // Walk pages until the type is fully loaded, or give up on the tree.
  useEffect(() => {
    if (!treeAttempt || loading || !hasMore) return;
    if (pagesWalked >= MAX_TREE_PAGES) {
      setFlatMode(true);
      return;
    }
    setPagesWalked((n) => n + 1);
    loadMore();
  }, [treeAttempt, loading, hasMore, pagesWalked, loadMore]);

  /** True only when the type is provably complete in memory. */
  const treeMode = treeAttempt && !hasMore && !loading && items.length > 0;

  const excludeSet = useMemo(() => (excludeIds ? new Set(excludeIds) : null), [excludeIds]);

  /**
   * The hierarchy, built once per loaded set. `depth` is query-independent —
   * `visibleForQuery` keeps a match's ancestors, so a visible option's level
   * never changes as you type.
   */
  const treeIndex = useMemo(() => {
    if (!treeMode) return null;
    const byId = new Map<string, CardOption>(
      items.map((c) => [
        c.id,
        { id: c.id, name: c.name, type: c.type, parent_id: c.parent_id ?? null },
      ]),
    );
    const byParent = buildChildIndex(byId);
    const rows = flattenTree({
      byParent,
      selectedIds: EMPTY_IDS,
      visibleSet: null,
      bestRank: null,
      impliedRows: false,
    });
    return {
      byId,
      byParent,
      order: rows.map((r) => r.card),
      depth: new Map(rows.map((r) => [r.card.id, r.depth] as const)),
    };
  }, [treeMode, items]);

  const { options, offered } = useMemo(() => {
    // A tree keeps excluded cards as inert context rows (see
    // `getOptionDisabled`): dropping one re-roots its children —
    // `buildChildIndex` files a card whose parent is absent under `null` — and
    // silently rewrites the very structure the tree exists to show.
    const mapped: CardOption[] = treeIndex
      ? [...treeIndex.order]
      : items
          .filter((c) => !excludeSet || !excludeSet.has(c.id))
          .map((c) => ({ id: c.id, name: c.name, type: c.type }));
    // How many genuinely pickable rows survived exclusion — counted before the
    // selected value is re-injected below, so that injected row can't mask an
    // otherwise-empty list.
    const offered = treeIndex
      ? mapped.filter((o) => !excludeSet || !excludeSet.has(o.id)).length
      : mapped.length;
    // Keep every selected card resolvable so MUI doesn't warn / blank a chip
    // out when that card isn't on the current page of results.
    const present = new Set(mapped.map((o) => o.id));
    for (const sel of selected) {
      if (!present.has(sel.id)) mapped.unshift(sel);
    }
    return { options: mapped, offered };
  }, [items, excludeSet, selected, treeIndex]);

  // `excludeIds` is applied above, *after* paging, so hidden cards consume page
  // slots — keep fetching until the list is usable (#918). Inert when nothing
  // is excluded.
  const autoPaging = useFillVisible({
    // Inert in tree mode: nothing is excluded from a tree, so there are no page
    // slots to page past, and its `loadMore` would race the walk above.
    enabled: enabled && !treeAttempt,
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
    // `state.inputValue` is MUI's live, un-debounced value — which is exactly
    // what the raw-input half of the search split wants.
    filterOptions: (opts: CardOption[], state: { inputValue: string }) => {
      if (!treeIndex) return filterAndRank(opts, state.inputValue);
      const q = state.inputValue.trim();
      // Same ancestor-keeping and best-descendant ranking as the other
      // hierarchy pickers, so a deep match never loses the parents that give
      // it meaning, and the branch holding the best hit sorts first.
      return flattenTree({
        byParent: treeIndex.byParent,
        selectedIds: EMPTY_IDS,
        visibleSet: visibleForQuery(treeIndex.byId, q),
        bestRank: bestRankBySubtree(treeIndex.byId, treeIndex.byParent, q),
        impliedRows: false,
      }).map((r) => r.card);
    },
    // Excluded cards are hidden outright in flat mode; in a tree they stay as
    // unpickable context.
    getOptionDisabled: (opt: CardOption) =>
      Boolean(treeIndex && excludeSet?.has(opt.id)),
    loading,
    disabled,
    openOnFocus,
    fullWidth,
    size,
    sx,
    noOptionsText:
      // `useFillVisible` does not gate its return value on its own `enabled`,
      // so tree mode has to be excluded explicitly here too.
      loading || (autoPaging && !treeAttempt)
        ? t("labels.loading")
        : (noOptionsText ?? t("labels.noResults")),
    slotProps: {
      listbox: {
        onScroll: (event: React.UIEvent<HTMLUListElement>) => {
          // Tree mode already holds the whole type.
          if (treeAttempt) return;
          const el = event.currentTarget;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
            if (hasMore && !loading) loadMore();
          }
        },
      },
    },
    renderOption: (liProps: React.HTMLAttributes<HTMLLIElement> & { key?: string }, opt: CardOption) => {
      const tConf = getType(opt.type);
      const depth = treeIndex?.depth.get(opt.id) ?? 0;
      return (
        <li
          {...liProps}
          key={opt.id}
          // MUI dims a disabled option to 0.38, which is unreadable for a row
          // that is there precisely to be read as context. Inline, so it wins
          // over the `.Mui-disabled` class.
          style={treeIndex && excludeSet?.has(opt.id) ? { opacity: 0.6 } : undefined}
        >
          {/* Same indent formula as the other hierarchy pickers; a no-op at
              depth 0, i.e. everywhere `hierarchy` is off. */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, pl: depth * 2 }}>
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
