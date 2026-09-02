import { useEffect, useMemo, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { onSide } from "@/lib/relationSort";
import { useCardSearch, useFillVisible } from "@/hooks/useCardSearch";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useTypeLabel, useRelationLabel } from "@/hooks/useResolveLabel";
import {
  bestRankBySubtree,
  buildChildIndex,
  flattenTree,
  visibleForQuery,
} from "@/lib/cardTree";
import { compareByRank, searchRank } from "@/lib/searchRank";
import type { Card, Relation, RelationType } from "@/types";
import RelationAttributesEditor, {
  hasEditableRelationAttributes,
  type RelationAttributes,
} from "./RelationAttributesEditor";

interface Added {
  relId: string;
  cardId: string;
  name: string;
  relationTypeKey: string;
}

/**
 * How many *extra* pages the dialog walks to assemble a complete tree, on top
 * of the first — so up to 6000 cards at `TREE_PAGE_SIZE`.
 *
 * A hierarchy cannot be rendered from a partial set (a child whose parent never
 * loaded surfaces as a bogus root), so tree mode pulls the whole type in. Past
 * the cap the list degrades to the flat, server-searched one it has always
 * been, and says so. Same budget as `CardScopeDialog` / `CardMultiPicker` —
 * change one, change all three.
 */
const MAX_TREE_PAGES = 5;
const TREE_PAGE_SIZE = 1000;
/** The historic page size, kept for the flat path so its paging is unchanged. */
const FLAT_PAGE_SIZE = 50;

/** One row of the candidate list — flat mode is just tree mode at depth 0. */
interface CandidateRow {
  card: Card;
  depth: number;
  /** Not pickable: this card itself, already linked, or added in this batch. */
  disabled: boolean;
  /** Added during this batch — worth a tick, not just a grey-out. */
  added: boolean;
  /** Why it is not pickable, in a word. */
  note?: string;
}

/**
 * Add one or many relations to a card (discussion #918).
 *
 * A dialog rather than a dropdown under the `+` button: the candidate list
 * lives in normal flow inside a container we own, so it cannot flip above the
 * field, be clipped by the accordion, or reposition as rows are added — all of
 * which made a floating list unusable for a run of adds, and unusable on a
 * phone at any length. It goes full-screen on small viewports.
 *
 * Each pick commits immediately and lands as a removable chip at the top, the
 * way tags are entered, so a batch stays visible and individually undoable
 * while you keep going.
 *
 * When the type being linked is hierarchical the candidates render as an
 * indented tree rather than an alphabetical list (discussion #1050) — with ~60
 * business capabilities, a name alone does not say which level it sits at. The
 * hierarchy logic is the one in `@/lib/cardTree`, shared with `CardScopeDialog`
 * and `CardMultiPicker`, so the three cannot drift.
 */
export default function AddRelationsDialog({
  open,
  onClose,
  fsId,
  relationType: rt,
  isSource,
  relations,
  onAdded,
  onRemoved,
  onUpdated,
}: {
  open: boolean;
  /** `addedCount` lets the caller reconcile once per batch instead of per add. */
  onClose: (addedCount: number) => void;
  fsId: string;
  /** Kept for callers; the side is `isSource`, never derived from the type. */
  cardTypeKey?: string;
  /** The relation being added to. Chosen before opening — the caller's `+`
   *  already says which one, so the dialog carries no type selector. */
  relationType: RelationType | null;
  /**
   * Which end of `relationType` the card sits at. Required, and supplied by
   * the group that opened the dialog — never derived from the type here: for a
   * self-referencing type the "am I the source" test is true at both ends,
   * which is how the dialog could only ever create the OUTGOING direction.
   */
  isSource: boolean;
  /** The card's current relations, used to hide what is already linked. */
  relations: Relation[];
  onAdded: (rel: Relation) => void;
  onRemoved: (relId: string) => void;
  onUpdated: (rel: Relation) => void;
}) {
  const { t } = useTranslation(["cards", "common"]);
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const { getType } = useMetamodel();
  const typeLabel = useTypeLabel();
  const relLabel = useRelationLabel();

  const [search, setSearch] = useState("");
  const [debouncedSearch, searchPending] = useDebouncedValue(search, 300);
  const [added, setAdded] = useState<Added[]>([]);
  const [attributes, setAttributes] = useState<RelationAttributes>({});
  const [createName, setCreateName] = useState("");
  /**
   * Cards created from this dialog. Tree mode never re-queries (its search is
   * pinned to ""), so a card created here would otherwise never appear in the
   * list at all — the chip would be its only trace.
   */
  const [created, setCreated] = useState<Card[]>([]);
  const [pagesWalked, setPagesWalked] = useState(0);
  /**
   * Latched, not derived: once the type proves too big to load whole, the
   * dialog stays flat for this opening. Deriving it would let it flicker off
   * the moment a server-filtered page reported `hasMore: false`, flipping the
   * list back to a tree built from a partial set.
   */
  const [flatMode, setFlatMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // Each *opening* is its own batch — and only an opening. Keying this on the
  // relation type too (as it briefly was) meant any parent re-render producing
  // a new object identity cleared the chips out from under an in-progress
  // batch.
  useEffect(() => {
    if (!open) return;
    setSearch("");
    setAdded([]);
    setAttributes({});
    setCreateName("");
    setCreated([]);
    setError("");
  }, [open]);

  const otherTypeKey = rt ? (isSource ? rt.target_type_key : rt.source_type_key) : "";
  const otherType = getType(otherTypeKey);
  const otherLabel = typeLabel(otherType) || otherTypeKey;
  // The tree budget belongs to the type being browsed, not to the batch of
  // chips, so it restarts on a new opening or a different relation's type.
  // `otherTypeKey` is a string, so unlike the `rt` object it cannot churn
  // on a parent re-render.
  useEffect(() => {
    setPagesWalked(0);
    setFlatMode(false);
  }, [open, otherTypeKey]);

  // Only n:m (and the "many" side of 1:n) takes a second relation; a
  // constrained type closes after one. `POST /relations` carries no
  // cardinality guard of its own — only the bulk path does.
  const allowsMany = rt ? rt.cardinality === "n:m" || (rt.cardinality === "1:n" && !isSource) : true;

  const rtKey = rt?.key ?? "";
  // On THIS side only. It feeds the exclusion set, the "N already linked"
  // caption and the empty-list text, so all three agree. For a cross-type rt
  // that is every row of the type, as before. For a self-referencing type a
  // card linked only the other way round stays pickable: the reverse row is a
  // distinct edge under the `(type, source, target)` upsert key, and the group
  // this dialog serves does not list it. (SuccessorsSection excludes both
  // ends — lineage is the one self-pair where a mutual link is nonsense.)
  const linkedForType = useMemo(
    () => relations.filter((r) => onSide(r, rtKey, fsId, isSource)),
    [relations, rtKey, fsId, isSource],
  );

  /** Self, everything already linked on this type, and this batch's adds. */
  const excluded = useMemo(() => {
    const ids = new Set(
      linkedForType.map((r) => (r.source_id === fsId ? r.target_id : r.source_id)),
    );
    for (const a of added) if (a.relationTypeKey === rtKey) ids.add(a.cardId);
    ids.add(fsId);
    return ids;
  }, [linkedForType, added, rtKey, fsId]);

  /**
   * The dialog always browses exactly one type — the relation's other end — so
   * `has_hierarchy` is the whole condition here, with no facet check as in
   * `CardMultiPicker`.
   */
  const treeAttempt = Boolean(otherType?.has_hierarchy) && !flatMode;

  const { items, loading, hasMore, loadMore } = useCardSearch({
    types: useMemo(() => (otherTypeKey ? [otherTypeKey] : []), [otherTypeKey]),
    // A tree needs the whole type in memory, so it browses unfiltered and
    // filters client-side; only the flat fallback searches server-side.
    search: treeAttempt ? "" : debouncedSearch,
    enabled: open && !!otherTypeKey,
    pageSize: treeAttempt ? TREE_PAGE_SIZE : FLAT_PAGE_SIZE,
  });

  // Walk pages until the type is fully loaded, or give up on the tree. No
  // `open` guard needed: a closed dialog has `enabled: false`, so `hasMore` is
  // false and this is inert.
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

  /** Rows the server's current page offers, once exclusions are applied. */
  const offered = useMemo(
    () => items.filter((c) => !excluded.has(c.id)),
    [items, excluded],
  );

  /**
   * The browsed set. Cards created from this dialog are folded in because tree
   * mode never re-queries — see `created` above.
   */
  const byId = useMemo(
    () => new Map<string, Card>([...items, ...created].map((c) => [c.id, c] as const)),
    [items, created],
  );
  const byParent = useMemo(() => buildChildIndex(byId), [byId]);

  // Filtered and ranked on the RAW input, not the debounced one: the loaded
  // set is already in memory, so narrowing it costs nothing and waiting would
  // only leave the previous query's rows on screen for another 300ms. The
  // debounce belongs to the server query above and nowhere else — same split
  // as `CardPicker`.
  const query = search.trim();

  /**
   * Ids matching the query plus the ancestor chain of every match — searching
   * for a deep sub-capability must not orphan it from its parents.
   */
  const visibleSet = useMemo(
    () => (treeMode ? visibleForQuery(byId, query) : null),
    [treeMode, byId, query],
  );

  /**
   * Branches rank by the best match inside them: an ancestor kept only for
   * context scores no-match on its own name, so ordering siblings by their own
   * rank would bury the branch holding the best hit.
   */
  const bestRank = useMemo(
    () => (treeMode ? bestRankBySubtree(byId, byParent, query) : null),
    [treeMode, byId, byParent, query],
  );

  /** This batch's adds, for the tree's tick and caption. */
  const addedIds = useMemo(
    () => new Set(added.filter((a) => a.relationTypeKey === rtKey).map((a) => a.cardId)),
    [added, rtKey],
  );

  const rows = useMemo<CandidateRow[]>(() => {
    if (!treeMode) {
      // Flat: exclusions are hidden, exactly as this list has always behaved.
      const base = query
        ? offered.filter((c) => searchRank(c.name, query) >= 0).sort(compareByRank(query))
        : offered;
      return base.map((card) => ({ card, depth: 0, disabled: false, added: false }));
    }
    // Tree: an excluded card stays *visible*, greyed and inert. Dropping it
    // would re-root its children — `buildChildIndex` files a card whose parent
    // is absent under `null` — silently rewriting the hierarchy the user opened
    // this dialog to read. And because every pick commits immediately, the row
    // just clicked is the one that would vanish, taking its branch with it.
    return flattenTree({
      byParent,
      selectedIds: addedIds,
      visibleSet,
      bestRank,
      // Each pick is its own relation, so a descendant of an added card stays
      // an ordinary, independently pickable row — never "implied".
      impliedRows: false,
    }).map((row) => {
      const id = row.card.id;
      const disabled = excluded.has(id);
      return {
        card: row.card,
        depth: row.depth,
        disabled,
        added: row.selected,
        note:
          id === fsId
            ? t("relations.rowSelf")
            : row.selected
              ? t("relations.rowAdded")
              : disabled
                ? t("relations.rowLinked")
                : undefined,
      };
    });
  }, [treeMode, offered, query, byParent, addedIds, visibleSet, bestRank, excluded, fsId, t]);

  /** Rows the user can actually click — the tree keeps the rest as context. */
  const pickable = useMemo(() => rows.filter((r) => !r.disabled).length, [rows]);

  // Counted on `offered`, deliberately *not* on the rendered rows: this hook exists
  // to page past exclusions eating page slots (#918), and the server has not
  // seen the half-typed term yet. Feeding it the optimistically-narrowed count
  // would make every keystroke look like an exhausted page and pull more pages
  // for a query that is about to be replaced.
  const filling = useFillVisible({
    // Inert in tree mode: nothing is excluded from a tree, so there are no
    // slots to page past, and its `loadMore` would race the walk above for the
    // page budget.
    enabled: open && !!otherTypeKey && !treeAttempt,
    loading,
    hasMore,
    visible: offered.length,
    pageSize: FLAT_PAGE_SIZE,
    loadMore,
    resetKey: `${rtKey}|${debouncedSearch}`,
  });

  // The list must never look settled while it is still showing the previous
  // query's rows, so the debounce's own pending flag counts as busy — but only
  // in flat mode, where a keystroke actually reaches the server; in tree mode
  // the filter is instant over a complete type. `useFillVisible` does not gate
  // its *return value* on its own `enabled`, hence the explicit flag here too.
  const busyList =
    loading ||
    (!treeAttempt && (filling || searchPending)) ||
    (treeAttempt && hasMore && pagesWalked < MAX_TREE_PAGES);

  const add = async (card: { id: string; name: string; type: string }) => {
    if (!rt) return;
    setBusy(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        type: rt.key,
        source_id: isSource ? fsId : card.id,
        target_id: isSource ? card.id : fsId,
      };
      if (Object.keys(attributes).length > 0) payload.attributes = attributes;
      const created = await api.post<Relation>("/relations", payload);
      // Name the row from the card that was picked rather than trusting the
      // response to carry its refs — the picked card is authoritative and
      // local, so a row can never render as "Unknown".
      const ref = { id: card.id, type: card.type, name: card.name };
      onAdded({
        ...created,
        source_id: created.source_id ?? (isSource ? fsId : card.id),
        target_id: created.target_id ?? (isSource ? card.id : fsId),
        source: isSource ? created.source : (created.source ?? ref),
        target: isSource ? (created.target ?? ref) : created.target,
      });
      setAdded((prev) => [
        { relId: created.id, cardId: card.id, name: card.name, relationTypeKey: rt.key },
        ...prev,
      ]);
      if (!allowsMany) onClose(added.length + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("relations.errors.create"));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Relation details describe the whole batch: the control sits above the
   * chips, so changing it re-applies to everything already added rather than
   * only to what comes next. Setting the value after adding the cards
   * otherwise looked like it simply hadn't saved.
   */
  const applyAttributes = async (next: RelationAttributes) => {
    setAttributes(next);
    if (added.length === 0) return;
    setBusy(true);
    setError("");
    try {
      for (const a of added) {
        const updated = await api.patch<Relation>(`/relations/${a.relId}`, {
          attributes: next,
        });
        onUpdated(updated);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("relations.errors.create"));
    } finally {
      setBusy(false);
    }
  };

  /** Undo one of this batch's adds from its chip. */
  const remove = async (relId: string) => {
    setBusy(true);
    setError("");
    try {
      await api.delete(`/relations/${relId}`);
      setAdded((prev) => prev.filter((a) => a.relId !== relId));
      onRemoved(relId);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("relations.errors.create"));
    } finally {
      setBusy(false);
    }
  };

  const createAndAdd = async () => {
    const name = createName.trim() || search.trim();
    if (!name || !otherTypeKey) return;
    setBusy(true);
    setError("");
    try {
      const card = await api.post<Card>("/cards", {
        type: otherTypeKey,
        name,
      });
      // Tree mode's query is pinned to "", so nothing refetches — fold the new
      // card into the browsed set by hand. It is parentless, so it lands at the
      // root of the tree as an "added" row.
      setCreated((prev) => [...prev, card]);
      setCreateName("");
      setSearch("");
      await add(card);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("relations.errors.createCard"));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => onClose(added.length)}
      maxWidth="sm"
      fullWidth
      fullScreen={fullScreen}
    >
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pr: 1 }}>
        {/* The verb, not just the card type: two relation types reaching the
            same type open two dialogs that would otherwise share a title. */}
        <Box sx={{ flex: 1 }}>
          {t("relations.addSpecific", {
            type: rt ? `${otherLabel} · ${isSource ? relLabel(rt) : relLabel(rt, true)}` : otherLabel,
          })}
        </Box>
        <IconButton size="small" onClick={() => onClose(added.length)} aria-label={t("common:actions.close")}>
          <MaterialSymbol icon="close" size={20} />
        </IconButton>
      </DialogTitle>
      <DialogContent
        // MUI zeroes a DialogContent's top padding when it follows a
        // DialogTitle, cropping the floating label of whatever field lands
        // first. That rule is `.MuiDialogTitle-root + .MuiDialogContent-root`,
        // two classes, so a plain sx class loses to it — hence `!important`,
        // the same escape this app already uses in `SaveReportDialog`.
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          pt: "12px !important",
          pb: 1,
        }}
      >
        {error && (
          <Alert severity="error" onClose={() => setError("")}>
            {error}
          </Alert>
        )}

        {/* Applies to each card added from here on, so a run of "Provider"
            links can be followed by a run of "Consumer" ones without leaving
            the dialog. The fields carry their own labels — no heading needed. */}
        {rt && hasEditableRelationAttributes(rt) && (
          <RelationAttributesEditor
            relationType={rt}
            value={attributes}
            onChange={applyAttributes}
            compact
            disabled={busy}
          />
        )}

        {added.length > 0 && (
          <Box aria-live="polite">
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              {t("relations.addedCount", { count: added.length })}
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
              {added.map((a) => (
                <Chip
                  key={a.relId}
                  size="small"
                  label={a.name}
                  disabled={busy}
                  onDelete={() => remove(a.relId)}
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
          placeholder={t("relations.search", { type: otherLabel })}
          slotProps={{
            input: {
              startAdornment: <MaterialSymbol icon="search" size={18} />,
              endAdornment: busyList ? <CircularProgress size={16} /> : undefined,
            },
          }}
        />

        {linkedForType.length > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: -1.5 }}>
            {/* "hidden from this list" is a lie in tree mode, where a linked
                card stays put so the levels around it still read correctly. */}
            {!treeMode
              ? t("relations.alreadyLinkedHint", { count: linkedForType.length })
              : pickable === 0 && !query
                ? t("relations.allLinked", { type: otherLabel })
                : t("relations.alreadyLinkedShown", { count: linkedForType.length })}
          </Typography>
        )}

        {flatMode && otherType?.has_hierarchy && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: -1.5 }}>
            {t("common:cardScope.flatFallback")}
          </Typography>
        )}

        {/* The candidate list scrolls inside the dialog — never a floating
            popper, so nothing can flip, clip or reposition under the cursor. */}
        <Box
          ref={listRef}
          data-testid="relation-candidates"
          onScroll={() => {
            const el = listRef.current;
            // Tree mode already holds the whole type; scroll paging here would
            // only re-enter the page walk.
            if (!el || loading || !hasMore || treeAttempt) return;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) loadMore();
          }}
          sx={{
            flex: fullScreen ? 1 : "none",
            height: fullScreen ? undefined : treeAttempt ? 320 : 280,
            overflowY: "auto",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
          }}
        >
          {rows.length === 0 && !busyList ? (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ p: 2, fontStyle: "italic" }}
            >
              {/* Tree mode hides nothing, so "everything is linked" is said
                  next to the list (above), never in place of it. */}
              {!treeMode && linkedForType.length > 0 && !search
                ? t("relations.allLinked", { type: otherLabel })
                : t("common:labels.noResults")}
            </Typography>
          ) : (
            <List dense disablePadding>
              {rows.map((row) => (
                <ListItemButton
                  key={row.card.id}
                  onClick={() => add(row.card)}
                  disabled={busy || row.disabled}
                  sx={{
                    // Same indent formula as `CardScopeDialog` and
                    // `CardMultiPicker`; a no-op in flat mode, where depth is 0.
                    pl: 1 + row.depth * 2,
                    // MUI dims a disabled row to 0.38, which is unreadable for
                    // a row that is here precisely to be read as context.
                    "&.Mui-disabled": { opacity: 0.6 },
                  }}
                >
                  {otherType && (
                    <Box
                      sx={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        bgcolor: otherType.color,
                        flexShrink: 0,
                        mr: 1,
                      }}
                    />
                  )}
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    {row.card.name}
                  </Typography>
                  {row.added && <MaterialSymbol icon="check" size={16} />}
                  {row.note && (
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                      {row.note}
                    </Typography>
                  )}
                </ListItemButton>
              ))}
            </List>
          )}
        </Box>

        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
          <TextField
            size="small"
            sx={{ flex: 1 }}
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createAndAdd()}
            placeholder={t("relations.createNew", { type: otherLabel })}
          />
          <Button
            size="small"
            onClick={createAndAdd}
            disabled={busy || !(createName.trim() || search.trim())}
            startIcon={<MaterialSymbol icon="add" size={16} />}
          >
            {t("relations.createAndAdd")}
          </Button>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={() => onClose(added.length)}>
          {t("relations.doneAdding")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
