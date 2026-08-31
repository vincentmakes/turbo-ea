import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useAbortableEffect } from "@/hooks/useLatestRequest";
import { useCardSearch } from "@/hooks/useCardSearch";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useTypeLabel } from "@/hooks/useResolveLabel";
import {
  bestRankBySubtree,
  buildChildIndex,
  closureSize,
  dedupeScopeRoots,
  flattenTree,
  visibleForQuery,
  type FlatTreeRow,
} from "@/lib/cardTree";
import { readableTextColor } from "@/lib/color";
import { compareByRank, searchRank } from "@/lib/searchRank";
import type { Card, CardListResponse } from "@/types";

/** The card shape this picker hands back. */
export interface PickedCard {
  id: string;
  name: string;
  type: string;
  parent_id?: string | null;
  description?: string;
}

interface CountsResponse {
  by_type: { type: string; count: number }[];
  total: number;
}

/**
 * How many *extra* pages the picker walks to assemble a complete tree, on top
 * of the first — so up to 6000 cards at `TREE_PAGE_SIZE`.
 *
 * A hierarchy cannot be rendered from a partial set (a child whose parent never
 * loaded would surface as a bogus root), so tree mode pulls the whole type in.
 * Past the cap the list degrades to a flat, server-searched one and says so.
 */
const MAX_TREE_PAGES = 5;
const TREE_PAGE_SIZE = 1000;
/** `GET /cards?ids=` chunk, kept well inside a sane URL length. */
const LABEL_CHUNK = 100;

/**
 * Shared multi-select card picker.
 *
 * One dialog behind every "pick some cards" flow: the type rail with live
 * counts from the diagram Insert-Cards dialog, the subtree-root semantics and
 * hierarchy of the report scope picker, and one selection model that survives
 * both of them.
 *
 * **Selection is a `Map<id, card>` seeded once per opening, never derived from
 * the loaded page.** `useCardSearch` *replaces* its `items` array on every type
 * or search change, so a picker that reconciles a bare id set against it drops
 * every tick made before the change — silently, at Apply time. Holding the card
 * itself is what makes a pick survive re-faceting, re-searching, and paging.
 *
 * **`roots` switches on subtree semantics**: a ticked row is then a subtree
 * *root*, its descendants render as implied rather than joining the selection,
 * and Apply hands back the deduped root set. Without it every row is an
 * ordinary, independent pick.
 *
 * Choosing between this and `CardScopeDialog`: that one is the compact,
 * single-type scope control a report toolbar opens; this one is the full
 * browser for picking across types, and the one to reach for when the caller
 * doesn't already know which type the user wants.
 */
export default function CardMultiPicker({
  open,
  onClose,
  value,
  onChange,
  types,
  roots = false,
  initialOptions,
  mode = "multi",
  showSelectAll = false,
  title,
  helperText,
  applyLabel,
}: {
  open: boolean;
  onClose: () => void;
  /** Currently picked ids (subtree roots when `roots`). */
  value: string[];
  /** Fired on Apply with the picked ids and the cards behind them. */
  onChange: (ids: string[], picked: PickedCard[]) => void;
  /**
   * Card types to offer. Omitted ⇒ every visible type is offered on the rail
   * and the user picks one (or types) before anything loads — the right posture
   * over a large catalogue. Given ⇒ pre-faceted and browsable on open; exactly
   * one ⇒ the rail is hidden entirely.
   */
  types?: string | string[];
  /** Treat a pick as "this card and everything under it". */
  roots?: boolean;
  /**
   * Cards the caller already holds, used only to label the incoming `value` on
   * open so chips don't flash unresolved while the fetch is in flight.
   */
  initialOptions?: PickedCard[];
  /** "single" applies and closes the moment one card is clicked. */
  mode?: "multi" | "single";
  /** Offer a "select all shown" button (multi mode only). */
  showSelectAll?: boolean;
  title?: string;
  helperText?: string;
  /** Overrides the Apply button's label, e.g. "Insert selected (3)". */
  applyLabel?: (count: number) => string;
}) {
  const { t } = useTranslation(["common"]);
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const { types: allTypes } = useMetamodel();
  const typeLabel = useTypeLabel();

  const callerTypes = useMemo(
    () => (Array.isArray(types) ? types : types ? [types] : []),
    [types],
  );

  const visibleTypes = useMemo(() => {
    const offered = allTypes.filter((tp) => !tp.is_hidden);
    // A caller-supplied list is the whole world for this opening; the rail
    // never offers a type the caller did not ask for.
    const narrowed = callerTypes.length
      ? offered.filter((tp) => callerTypes.includes(tp.key))
      : offered;
    return narrowed.slice().sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99));
  }, [allTypes, callerTypes]);
  const typeMap = useMemo(() => new Map(visibleTypes.map((tp) => [tp.key, tp])), [visibleTypes]);
  /** With one type there is nothing to facet — drop the rail, go single-pane. */
  const railHidden = callerTypes.length === 1;

  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [facet, setFacet] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [debouncedSearch, searchPending] = useDebouncedValue(search, 300);
  const [picked, setPicked] = useState<Map<string, PickedCard>>(new Map());
  const [pagesWalked, setPagesWalked] = useState(0);
  /**
   * Latched, not derived: once the faceted type proves too big to load whole,
   * the picker stays flat for this opening. Deriving it would let the flag
   * flicker off the moment a server-filtered page reports `hasMore: false`,
   * rebuilding a tree from a partial set.
   */
  const [flatMode, setFlatMode] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Each opening starts from the caller's current selection. An id the caller
  // couldn't label lands as a placeholder and is filled in below.
  useEffect(() => {
    if (!open) return;
    setSearch("");
    setPagesWalked(0);
    setFlatMode(false);
    setFacet(new Set(callerTypes));
    const known = new Map((initialOptions ?? []).map((o) => [o.id, o]));
    const seed = new Map<string, PickedCard>();
    for (const id of value) {
      seed.set(id, known.get(id) ?? { id, name: "", type: callerTypes[0] ?? "" });
    }
    setPicked(seed);
    // Only an opening starts a new batch — re-seeding on every `value` identity
    // change would clobber a selection in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Live per-type counts for the rail.
  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      if (!open || railHidden) return;
      try {
        const r = await api.get<CountsResponse>("/cards/counts", { signal });
        if (isCurrent()) setCounts(new Map(r.by_type.map((e) => [e.type, e.count])));
      } catch {
        if (isCurrent()) setCounts(new Map());
      }
    },
    [open, railHidden],
  );

  /**
   * Resolve the labels of incoming ids the browse can't reach — a scope saved
   * over a type the caller no longer facets would otherwise show "Loading…"
   * chips forever. One pass per opening, chunked.
   */
  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      if (!open) return;
      const missing = value.filter((id) => !(initialOptions ?? []).some((o) => o.id === id));
      if (missing.length === 0) return;
      const found: Card[] = [];
      for (let i = 0; i < missing.length; i += LABEL_CHUNK) {
        const chunk = missing.slice(i, i + LABEL_CHUNK);
        try {
          const r = await api.get<CardListResponse>(
            `/cards?ids=${chunk.join(",")}&page_size=${LABEL_CHUNK}`,
            { signal },
          );
          found.push(...(r.items ?? []));
        } catch {
          // A dead id is not an error here — its chip just keeps the fallback.
        }
        if (!isCurrent()) return;
      }
      if (!isCurrent() || found.length === 0) return;
      setPicked((prev) => {
        const next = new Map(prev);
        let changed = false;
        for (const c of found) {
          const entry = next.get(c.id);
          if (entry && !entry.name) {
            next.set(c.id, {
              id: c.id,
              name: c.name,
              type: c.type,
              parent_id: c.parent_id ?? null,
              description: c.description,
            });
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    },
    [open],
  );

  const facetList = useMemo(() => Array.from(facet), [facet]);
  const facetKey = useMemo(() => [...facetList].sort().join(","), [facetList]);
  const query = search.trim();

  /**
   * A tree needs the whole type in memory, so it browses unfiltered and filters
   * client-side; the flat fallback searches server-side. Exactly one
   * hierarchical type faceted is the only case a hierarchy can be built for.
   */
  const soleHierarchical = useMemo(() => {
    if (facetList.length !== 1) return null;
    const tp = typeMap.get(facetList[0]);
    return tp?.has_hierarchy ? tp.key : null;
  }, [facetList, typeMap]);
  const treeAttempt = Boolean(soleHierarchical) && !flatMode;

  // Nothing faceted and nothing typed ⇒ ask first rather than pulling the whole
  // catalogue. A caller that named its types has already answered that.
  const searchEnabled = open && (facetList.length > 0 || debouncedSearch.trim().length > 0);

  const { items, total, loading, hasMore, loadMore } = useCardSearch({
    types: facetList,
    search: treeAttempt ? "" : debouncedSearch,
    enabled: searchEnabled,
    pageSize: treeAttempt ? TREE_PAGE_SIZE : undefined,
  });

  // Changing the facet restarts the tree budget for the new type.
  useEffect(() => {
    setPagesWalked(0);
    setFlatMode(false);
  }, [facetKey]);

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

  /** True only when the faceted type is provably complete in memory. */
  const treeMode = treeAttempt && !hasMore && !loading && items.length > 0;

  const byId = useMemo(() => {
    const map = new Map<string, PickedCard>();
    for (const c of items) {
      map.set(c.id, {
        id: c.id,
        name: c.name,
        type: c.type,
        parent_id: c.parent_id ?? null,
        description: c.description,
      });
    }
    return map;
  }, [items]);

  const parentById = useMemo(() => {
    const map = new Map<string, string | null | undefined>();
    for (const [id, c] of byId) map.set(id, c.parent_id ?? null);
    return map;
  }, [byId]);

  const byParent = useMemo(() => buildChildIndex(byId), [byId]);

  // Fill in placeholder labels the browse resolves. Only ever *replaces* an
  // existing entry — re-deriving from `value` would resurrect a pick the user
  // just removed, since `value` holds the caller's last-applied set until Apply.
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

  const visibleSet = useMemo(
    () => (treeMode ? visibleForQuery(byId, query) : null),
    [treeMode, byId, query],
  );
  const bestRank = useMemo(
    () => (treeMode ? bestRankBySubtree(byId, byParent, query) : null),
    [treeMode, byId, byParent, query],
  );

  /**
   * Rows on offer. Filtering runs on the RAW input so the list narrows on the
   * first character; `debouncedSearch` exists solely for the server query.
   */
  const rows = useMemo<FlatTreeRow<PickedCard>[]>(() => {
    if (!treeMode) {
      const base = query
        ? Array.from(byId.values()).filter((c) => searchRank(c.name, query) >= 0)
        : Array.from(byId.values());
      return base
        .sort(compareByRank(query))
        .map((card) => ({ card, depth: 0, selected: picked.has(card.id), implied: false }));
    }
    return flattenTree({
      byParent,
      selectedIds: new Set(picked.keys()),
      visibleSet,
      bestRank,
      impliedRows: roots,
    });
  }, [treeMode, byId, byParent, visibleSet, bestRank, picked, query, roots]);

  const busy =
    loading || (!treeMode && searchPending) || (treeAttempt && hasMore && pagesWalked < MAX_TREE_PAGES);

  const toggle = useCallback(
    (card: PickedCard) => {
      setPicked((prev) => {
        const next = new Map(prev);
        if (next.has(card.id)) {
          next.delete(card.id);
          return next;
        }
        next.set(card.id, card);
        if (!roots) return next;
        // Ancestor wins: drop any pick this one now covers, and ignore a pick
        // already covered by an ancestor.
        const kept = new Set(dedupeScopeRoots(Array.from(next.keys()), parentById));
        for (const id of Array.from(next.keys())) {
          if (!kept.has(id)) next.delete(id);
        }
        return next;
      });
    },
    [roots, parentById],
  );

  const emit = useCallback(
    (chosen: Map<string, PickedCard>) => {
      const ids = roots ? dedupeScopeRoots(Array.from(chosen.keys()), parentById) : Array.from(chosen.keys());
      onChange(
        ids,
        ids.map((id) => chosen.get(id) as PickedCard),
      );
      onClose();
    },
    [roots, parentById, onChange, onClose],
  );

  const rowClick = (card: PickedCard) => {
    if (mode === "single") {
      emit(new Map([[card.id, card]]));
      return;
    }
    toggle(card);
  };

  const selectAllShown = () => {
    setPicked((prev) => {
      const next = new Map(prev);
      for (const row of rows) {
        if (!row.implied) next.set(row.card.id, row.card);
      }
      if (!roots) return next;
      const kept = new Set(dedupeScopeRoots(Array.from(next.keys()), parentById));
      for (const id of Array.from(next.keys())) {
        if (!kept.has(id)) next.delete(id);
      }
      return next;
    });
  };

  /**
   * The picked count, plus the closure size **only when it is provably exact**
   * — tree mode, with every pick present in the loaded set. Anywhere else the
   * descendants of a pick may simply not have been fetched, so a number would
   * be a smaller, arbitrary one; the caption says descendants are included
   * without pretending to count them.
   */
  const countLine = useMemo(() => {
    const n = picked.size;
    if (!roots) return t("cardPicker.pickedCount", { count: n });
    const exact = treeMode && Array.from(picked.keys()).every((id) => byId.has(id));
    if (!exact) return t("cardPicker.pickedWithDescendants", { count: n });
    return t("cardPicker.pickedInScope", {
      count: n,
      scope: closureSize(picked.keys(), byParent),
    });
  }, [picked, roots, treeMode, byId, byParent, t]);

  const toggleFacet = (key: string) =>
    setFacet((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const chips = Array.from(picked.values());
  const isMulti = mode === "multi";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={railHidden ? "sm" : "lg"}
      fullWidth
      fullScreen={fullScreen}
      // Always safe: this picker is routinely opened from inside another
      // dialog, where restoring focus fights the parent's own focus trap.
      disableRestoreFocus
    >
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pr: 1 }}>
        <Box sx={{ flex: 1 }}>{title ?? t("cardPicker.title")}</Box>
        <IconButton size="small" onClick={onClose} aria-label={t("actions.close")}>
          <MaterialSymbol icon="close" size={20} />
        </IconButton>
      </DialogTitle>

      <DialogContent
        sx={{
          display: "flex",
          gap: 0,
          p: 0,
          height: fullScreen ? undefined : "min(70vh, 620px)",
          flex: fullScreen ? 1 : undefined,
          overflow: "hidden",
          borderTop: "1px solid",
          borderColor: "divider",
        }}
      >
        {!railHidden && (
          <Box
            data-testid="card-picker-rail"
            sx={{
              width: 220,
              flexShrink: 0,
              borderRight: "1px solid",
              borderColor: "divider",
              overflow: "auto",
              p: 2,
              display: { xs: "none", sm: "block" },
            }}
          >
            <Typography variant="overline" color="text.secondary">
              {t("cardPicker.typeFilter")}
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, mt: 1 }}>
              {visibleTypes.map((tp) => {
                const active = facet.has(tp.key);
                return (
                  <Chip
                    key={tp.key}
                    size="small"
                    label={
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Box sx={{ flex: 1, textAlign: "left" }}>{typeLabel(tp)}</Box>
                        <Box sx={{ fontSize: "0.7rem", opacity: active ? 0.9 : 0.65 }}>
                          {counts.get(tp.key) ?? 0}
                        </Box>
                      </Box>
                    }
                    variant={active ? "filled" : "outlined"}
                    sx={{
                      justifyContent: "flex-start",
                      bgcolor: active ? tp.color : "transparent",
                      color: active ? readableTextColor(tp.color) : "text.primary",
                      borderColor: tp.color,
                      "& .MuiChip-label": { width: "100%", px: 1 },
                      cursor: "pointer",
                    }}
                    onClick={() => toggleFacet(tp.key)}
                  />
                );
              })}
            </Box>
          </Box>
        )}

        <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <Box sx={{ p: 2, pb: 1 }}>
            {helperText && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                {helperText}
              </Typography>
            )}
            <TextField
              size="small"
              fullWidth
              autoFocus={!fullScreen}
              placeholder={t("cardPicker.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <MaterialSymbol icon="search" size={18} />
                    </InputAdornment>
                  ),
                  endAdornment: busy ? <CircularProgress size={16} /> : undefined,
                },
              }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
              {!searchEnabled
                ? t("cardPicker.selectOrSearch")
                : hasMore
                  ? t("cardPicker.showingOf", { loaded: rows.length, total })
                  : t("cardPicker.resultsCount", { count: rows.length })}
            </Typography>
            {flatMode && soleHierarchical && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                {t("cardPicker.flatTooMany")}
              </Typography>
            )}
            {!flatMode && !treeAttempt && facetList.length > 1 && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                {t("cardPicker.flatMultiType")}
              </Typography>
            )}
          </Box>

          {chips.length > 0 && isMulti && (
            <Box sx={{ px: 2, pb: 1 }} aria-live="polite">
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                {countLine}
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, maxHeight: 88, overflowY: "auto" }}>
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

          <Divider />

          <Box
            ref={listRef}
            data-testid="card-picker-list"
            onScroll={() => {
              const el = listRef.current;
              if (!el || loading || !hasMore || treeAttempt) return;
              if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) loadMore();
            }}
            sx={{ flex: 1, overflowY: "auto" }}
          >
            {rows.length === 0 ? (
              <Box sx={{ textAlign: "center", py: 6, color: "text.disabled" }}>
                <MaterialSymbol icon="search_off" size={36} />
                <Typography variant="body2" sx={{ mt: 1 }}>
                  {!searchEnabled
                    ? t("cardPicker.selectOrSearch")
                    : busy
                      ? t("labels.loading")
                      : t("labels.noResults")}
                </Typography>
              </Box>
            ) : (
              rows.map((row) => {
                const tp = typeMap.get(row.card.type);
                return (
                  <Box
                    key={row.card.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => !row.implied && rowClick(row.card)}
                    onKeyDown={(e) => {
                      if (row.implied) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        rowClick(row.card);
                      }
                    }}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1.5,
                      pr: 2,
                      pl: 2 + row.depth * 2,
                      py: 0.5,
                      cursor: row.implied ? "default" : "pointer",
                      opacity: row.implied ? 0.6 : 1,
                      borderBottom: "1px solid",
                      borderColor: "divider",
                      bgcolor: row.selected ? "action.selected" : "transparent",
                      "&:hover": { bgcolor: row.implied ? undefined : "action.hover" },
                    }}
                  >
                    {isMulti && (
                      <Checkbox
                        size="small"
                        checked={row.selected}
                        // An implied row is already in scope; ticking it would
                        // add a root the dedupe immediately drops.
                        indeterminate={row.implied}
                        disabled={row.implied}
                        tabIndex={-1}
                        inputProps={{ "aria-label": row.card.name }}
                        sx={{ p: 0.5 }}
                      />
                    )}
                    {tp && (
                      <Box
                        sx={{
                          width: 24,
                          height: 24,
                          borderRadius: "4px",
                          bgcolor: tp.color,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <MaterialSymbol icon={tp.icon} size={14} color={readableTextColor(tp.color)} />
                      </Box>
                    )}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" noWrap fontWeight={500}>
                        {row.card.name}
                      </Typography>
                      {row.card.description && (
                        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                          {row.card.description}
                        </Typography>
                      )}
                    </Box>
                    {row.implied ? (
                      <Typography variant="caption" color="text.secondary">
                        {t("cardPicker.included")}
                      </Typography>
                    ) : (
                      tp &&
                      !railHidden && (
                        <Chip
                          size="small"
                          label={typeLabel(tp)}
                          sx={{
                            height: 20,
                            fontSize: "0.7rem",
                            bgcolor: tp.color,
                            color: readableTextColor(tp.color),
                          }}
                        />
                      )
                    )}
                  </Box>
                );
              })
            )}
          </Box>
        </Box>
      </DialogContent>

      {isMulti && (
        <DialogActions sx={{ borderTop: "1px solid", borderColor: "divider", px: 2, py: 1 }}>
          <Button size="small" onClick={() => setPicked(new Map())} disabled={picked.size === 0}>
            {t("cardPicker.clearAll")}
          </Button>
          <Box sx={{ flex: 1 }} />
          {showSelectAll && (
            <Button size="small" onClick={selectAllShown} disabled={rows.length === 0}>
              {t("cardPicker.selectAllShown", { count: rows.length })}
            </Button>
          )}
          <Button size="small" onClick={onClose}>
            {t("actions.cancel")}
          </Button>
          <Button size="small" variant="contained" onClick={() => emit(picked)}>
            {applyLabel
              ? applyLabel(picked.size)
              : picked.size > 0
                ? t("cardPicker.apply", { count: picked.size })
                : t("actions.apply")}
          </Button>
        </DialogActions>
      )}
    </Dialog>
  );
}
