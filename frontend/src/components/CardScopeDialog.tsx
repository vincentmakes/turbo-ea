import { useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useCardSearch } from "@/hooks/useCardSearch";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useMetamodel } from "@/hooks/useMetamodel";
import { compareByRank, searchRank } from "@/lib/searchRank";

/** Minimal card shape the scope picker needs. */
export interface CardScopeOption {
  id: string;
  name: string;
  type: string;
  parent_id?: string | null;
}

/**
 * How many *extra* pages the dialog will walk to assemble a complete tree,
 * on top of the first one — so up to 6000 cards at `TREE_PAGE_SIZE`.
 *
 * A hierarchy cannot be rendered from a partial set — a child whose parent
 * never loaded would surface as a bogus root — so browsing pulls the whole
 * type in. The cap stops a very large type from walking the entire catalogue;
 * past it the dialog degrades to a flat, server-searched list and says so.
 * No hierarchical card type in a normal install comes close.
 */
const MAX_TREE_PAGES = 5;
const TREE_PAGE_SIZE = 1000;

/**
 * Reduce a selection to subtree *roots*.
 *
 * Scope is "these cards and everything under them", so a pick that already
 * sits inside another pick's subtree adds nothing — keeping both would render
 * the inner subtree twice. The ancestor always wins, whichever order the two
 * were picked in.
 *
 * Ids whose parent chain isn't in `parentById` (a card outside the loaded set,
 * or one deleted since the scope was saved) are kept as their own roots: the
 * caller is the one that knows whether an unresolvable id should survive.
 */
export function dedupeScopeRoots(
  ids: string[],
  parentById: Map<string, string | null | undefined>,
): string[] {
  const picked = new Set(ids);
  const out: string[] = [];
  for (const id of ids) {
    let cursor = parentById.get(id) ?? null;
    let coveredByAncestor = false;
    // Bounded by the chain length; a cycle would be a data bug upstream, so
    // guard with a visited set rather than trusting the graph.
    const seen = new Set<string>([id]);
    while (cursor && !seen.has(cursor)) {
      if (picked.has(cursor)) {
        coveredByAncestor = true;
        break;
      }
      seen.add(cursor);
      cursor = parentById.get(cursor) ?? null;
    }
    if (!coveredByAncestor) out.push(id);
  }
  return out;
}

interface TreeRow {
  card: CardScopeOption;
  depth: number;
  /** Checked in its own right — this row is a scope root. */
  selected: boolean;
  /** In scope only because an ancestor is checked. */
  implied: boolean;
}

/**
 * Hierarchy-aware multi-select card picker, as a modal.
 *
 * Built for report scoping (discussion #954): pick a few cards and the report
 * narrows to those cards *and everything beneath them*. That "and everything
 * beneath them" is why selection here means something different from the
 * catalogue browser's — a checked row is a subtree **root**, and its
 * descendants render as implied rather than being added to the selection. The
 * chip row and the saved-report config therefore stay the size of what the
 * user actually picked, not the size of the subtree.
 *
 * A modal rather than an inline dropdown: chips for more than two or three
 * picks overflow a report toolbar, and the list has to be able to go
 * full-screen on a phone. The candidate list lives in normal flow inside a Box
 * we own — never a popper, which could flip or clip (same reasoning as
 * `AddRelationsDialog`).
 */
export default function CardScopeDialog({
  open,
  onClose,
  types,
  value,
  onChange,
  title,
  helperText,
  initialOptions,
}: {
  open: boolean;
  onClose: () => void;
  /** Card type key(s) to browse. */
  types: string | string[];
  /** Currently scoped ids (subtree roots). */
  value: string[];
  /** Fired on Apply with the deduped root set. */
  onChange: (ids: string[]) => void;
  title?: string;
  /** Explains what "+ descendants" means for this caller. */
  helperText?: string;
  /**
   * Cards the caller already holds. Used only to label the incoming `value`
   * chips on open, so a caller that already has the list (a report that
   * fetched it for its own chart) doesn't flash unresolved chips while this
   * dialog's own fetch is in flight.
   */
  initialOptions?: CardScopeOption[];
}) {
  const { t } = useTranslation(["common"]);
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const { getType } = useMetamodel();

  const [search, setSearch] = useState("");
  const [debouncedSearch, searchPending] = useDebouncedValue(search, 300);
  /**
   * Picked cards, not just ids — the loaded page set is volatile (it resets on
   * every filter change), so reconciling a bare id set against it silently
   * drops picks made before the change.
   */
  const [picked, setPicked] = useState<Map<string, CardScopeOption>>(new Map());
  const [pagesWalked, setPagesWalked] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const typeList = useMemo(
    () => (Array.isArray(types) ? types : types ? [types] : []),
    [types],
  );

  // Each opening starts from the caller's current scope. An id the caller
  // couldn't label lands as a placeholder (empty name) and is filled in below
  // once the fetch resolves it.
  useEffect(() => {
    if (!open) return;
    setSearch("");
    setPagesWalked(0);
    setFlatMode(false);
    const known = new Map((initialOptions ?? []).map((o) => [o.id, o]));
    const seed = new Map<string, CardScopeOption>();
    for (const id of value) {
      seed.set(id, known.get(id) ?? { id, name: "", type: typeList[0] ?? "" });
    }
    setPicked(seed);
    // Re-seeding on every `value` identity change would clobber an in-progress
    // selection; only an opening starts a new batch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /**
   * Latched, not derived: once we know the type is too big to load whole, the
   * dialog stays in flat mode for this opening. Deriving it would let the flag
   * flicker off the moment a server-filtered page reports `hasMore: false`,
   * flipping the list back to a tree built from a partial set.
   */
  const [flatMode, setFlatMode] = useState(false);

  /**
   * Browsing loads the whole type so the tree is complete, and typing filters
   * it client-side. Only the flat fallback searches server-side.
   */
  const { items, loading, hasMore, loadMore } = useCardSearch({
    types: typeList,
    search: flatMode ? debouncedSearch : "",
    enabled: open && typeList.length > 0,
    pageSize: TREE_PAGE_SIZE,
  });

  // Walk pages until the type is fully loaded, or give up on the tree.
  useEffect(() => {
    if (!open || loading || !hasMore || flatMode) return;
    if (pagesWalked >= MAX_TREE_PAGES) {
      setFlatMode(true);
      return;
    }
    setPagesWalked((n) => n + 1);
    loadMore();
  }, [open, loading, hasMore, flatMode, pagesWalked, loadMore]);

  const byId = useMemo(() => {
    const map = new Map<string, CardScopeOption>();
    for (const c of items) {
      map.set(c.id, { id: c.id, name: c.name, type: c.type, parent_id: c.parent_id ?? null });
    }
    return map;
  }, [items]);

  const parentById = useMemo(() => {
    const map = new Map<string, string | null | undefined>();
    for (const [id, c] of byId) map.set(id, c.parent_id ?? null);
    return map;
  }, [byId]);

  /**
   * Fill in placeholder labels once the fetch resolves them. This only ever
   * *replaces* an existing entry — re-deriving the set from `value` here would
   * resurrect a pick the user just removed, since `value` stays at the
   * caller's last-applied scope until Apply.
   */
  useEffect(() => {
    if (byId.size === 0) return;
    setPicked((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const [id, entry] of prev) {
        if (entry.name) continue;
        const card = byId.get(id);
        if (card) {
          next.set(id, card);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [byId]);

  const byParent = useMemo(() => {
    const map = new Map<string | null, CardScopeOption[]>();
    for (const c of byId.values()) {
      // A card whose parent is outside the loaded set is treated as a root, so
      // it stays reachable rather than disappearing into a missing branch.
      const key = c.parent_id && byId.has(c.parent_id) ? c.parent_id : null;
      const list = map.get(key) ?? [];
      list.push(c);
      map.set(key, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [byId]);

  /**
   * The live query. Filtering runs on the RAW input, never the debounced one:
   * the whole type is already in memory here, so there is no request to spare
   * and a debounce would only make the list sit unfiltered for 300ms after
   * every keystroke. `debouncedSearch` exists solely for the flat-mode server
   * query — the one place a keystroke actually reaches the backend. Same split
   * as `CardPicker`.
   */
  const query = search.trim();

  /**
   * Ids matching the query, plus the ancestor chain of every match — searching
   * for a deep sub-capability must not orphan it from its parents.
   */
  const visibleSet = useMemo(() => {
    if (!query) return null; // null = everything visible
    const ids = new Set<string>();
    for (const c of byId.values()) {
      if (searchRank(c.name, query) >= 0) ids.add(c.id);
    }
    for (const id of Array.from(ids)) {
      let cursor = byId.get(id)?.parent_id ?? null;
      while (cursor && byId.has(cursor) && !ids.has(cursor)) {
        ids.add(cursor);
        cursor = byId.get(cursor)?.parent_id ?? null;
      }
    }
    return ids;
  }, [byId, query]);

  /**
   * Best rank found anywhere in each node's subtree, itself included.
   *
   * Ordering tree siblings by their *own* rank gets this wrong: an ancestor
   * kept only for context scores "no match" on its own name, so the branch
   * holding the best match in the whole tree would sink to the bottom. Rolling
   * the best descendant rank up means a branch is ranked by the best thing
   * inside it, while a branch with nothing matching beneath it still sorts
   * last. One post-order pass over the loaded set.
   */
  const bestRank = useMemo(() => {
    if (!query) return null;
    const cache = new Map<string, number>();
    const NO_MATCH = Number.MAX_SAFE_INTEGER;
    const visit = (id: string, seen: Set<string>): number => {
      const cached = cache.get(id);
      if (cached !== undefined) return cached;
      // A cycle would be a data bug upstream; guard rather than trust it.
      if (seen.has(id)) return NO_MATCH;
      seen.add(id);
      const card = byId.get(id);
      const own = card ? searchRank(card.name, query) : -1;
      let best = own < 0 ? NO_MATCH : own;
      for (const child of byParent.get(id) ?? []) {
        best = Math.min(best, visit(child.id, seen));
      }
      seen.delete(id);
      cache.set(id, best);
      return best;
    };
    for (const id of byId.keys()) visit(id, new Set());
    return cache;
  }, [byId, byParent, query]);

  /** Depth-first flatten, so one scrolling list can render an indented tree. */
  const rows = useMemo<TreeRow[]>(() => {
    if (flatMode) {
      // Partial set: no reliable hierarchy, so offer a plain ranked list.
      return Array.from(byId.values())
        .sort(compareByRank(query))
        .map((card) => ({ card, depth: 0, selected: picked.has(card.id), implied: false }));
    }

    // While searching, each level is ordered by the best match inside it and
    // ties break alphabetically; with no query, plain alphabetical (the order
    // `byParent` already holds).
    const order = (siblings: CardScopeOption[]) => {
      if (!bestRank) return siblings;
      return [...siblings].sort((a, b) => {
        const diff =
          (bestRank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (bestRank.get(b.id) ?? Number.MAX_SAFE_INTEGER);
        return diff !== 0 ? diff : a.name.localeCompare(b.name);
      });
    };

    const out: TreeRow[] = [];
    const walk = (parent: string | null, depth: number, impliedByAncestor: boolean) => {
      for (const card of order(byParent.get(parent) ?? [])) {
        if (visibleSet && !visibleSet.has(card.id)) continue;
        const selected = picked.has(card.id);
        out.push({ card, depth, selected, implied: impliedByAncestor && !selected });
        walk(card.id, depth + 1, impliedByAncestor || selected);
      }
    };
    walk(null, 0, false);
    return out;
  }, [flatMode, byId, byParent, visibleSet, bestRank, picked, query]);

  // `searchPending` only means something in flat mode, where the query goes to
  // the server. In tree mode the filter is instant, so counting it would show
  // a spinner over a list that is already correct.
  const busy = loading || (flatMode && searchPending) || (hasMore && pagesWalked < MAX_TREE_PAGES);

  const toggle = (card: CardScopeOption) => {
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(card.id)) {
        next.delete(card.id);
        return next;
      }
      next.set(card.id, card);
      // Ancestor wins: drop any pick that this one now covers, and ignore a
      // pick already covered by an ancestor.
      const kept = new Set(dedupeScopeRoots(Array.from(next.keys()), parentById));
      for (const id of Array.from(next.keys())) {
        if (!kept.has(id)) next.delete(id);
      }
      return next;
    });
  };

  const apply = () => {
    onChange(dedupeScopeRoots(Array.from(picked.keys()), parentById));
    onClose();
  };

  const chips = Array.from(picked.values());

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth fullScreen={fullScreen}>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pr: 1 }}>
        <Box sx={{ flex: 1 }}>{title ?? t("cardScope.title")}</Box>
        <IconButton size="small" onClick={onClose} aria-label={t("actions.close")}>
          <MaterialSymbol icon="close" size={20} />
        </IconButton>
      </DialogTitle>
      <DialogContent
        // MUI zeroes DialogContent's top padding after a DialogTitle, which
        // crops the first field's floating label. Two-class specificity, so
        // `!important` is the escape — same as SaveReportDialog.
        sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "12px !important", pb: 1 }}
      >
        <Typography variant="caption" color="text.secondary">
          {helperText ?? t("cardScope.helper")}
        </Typography>

        {chips.length > 0 && (
          <Box aria-live="polite">
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              {t("cardScope.selected", { count: chips.length })}
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
              {chips.map((c) => (
                <Chip
                  key={c.id}
                  size="small"
                  label={c.name || t("labels.loading")}
                  onDelete={() =>
                    setPicked((prev) => {
                      const next = new Map(prev);
                      next.delete(c.id);
                      return next;
                    })
                  }
                />
              ))}
            </Box>
          </Box>
        )}

        <TextField
          fullWidth
          size="small"
          autoFocus={!fullScreen}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("cardScope.searchPlaceholder")}
          slotProps={{
            input: {
              startAdornment: <MaterialSymbol icon="search" size={18} />,
              endAdornment: busy ? <CircularProgress size={16} /> : undefined,
            },
          }}
        />

        {flatMode && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: -1.5 }}>
            {t("cardScope.flatFallback")}
          </Typography>
        )}

        <Box
          ref={listRef}
          onScroll={() => {
            const el = listRef.current;
            if (!el || loading || !hasMore || !flatMode) return;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) loadMore();
          }}
          sx={{
            flex: fullScreen ? 1 : "none",
            height: fullScreen ? undefined : 320,
            overflowY: "auto",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
          }}
        >
          {rows.length === 0 && !busy ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2, fontStyle: "italic" }}>
              {t("labels.noResults")}
            </Typography>
          ) : (
            rows.map((row) => {
              const tConf = getType(row.card.type);
              return (
                <Box
                  key={row.card.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => toggle(row.card)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggle(row.card);
                    }
                  }}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    pr: 1.5,
                    pl: 1 + row.depth * 2,
                    py: 0.25,
                    cursor: "pointer",
                    opacity: row.implied ? 0.6 : 1,
                    "&:hover": { bgcolor: "action.hover" },
                  }}
                >
                  <Checkbox
                    size="small"
                    checked={row.selected}
                    // An implied row is already in scope; checking it would add
                    // a redundant root that dedupe would immediately drop.
                    indeterminate={row.implied}
                    disabled={row.implied}
                    tabIndex={-1}
                    inputProps={{ "aria-label": row.card.name }}
                    sx={{ p: 0.5 }}
                  />
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
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    {row.card.name}
                  </Typography>
                  {row.implied && (
                    <Typography variant="caption" color="text.secondary">
                      {t("cardScope.included")}
                    </Typography>
                  )}
                </Box>
              );
            })
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button
          size="small"
          onClick={() => setPicked(new Map())}
          disabled={picked.size === 0}
          sx={{ mr: "auto" }}
        >
          {t("cardScope.clearAll")}
        </Button>
        <Button size="small" onClick={onClose}>
          {t("actions.cancel")}
        </Button>
        <Button size="small" variant="contained" onClick={apply}>
          {picked.size > 0 ? t("cardScope.apply", { count: picked.size }) : t("actions.apply")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
