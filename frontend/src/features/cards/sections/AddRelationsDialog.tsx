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
import { useCardSearch, useFillVisible } from "@/hooks/useCardSearch";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useTypeLabel } from "@/hooks/useResolveLabel";
import { compareByRank, searchRank } from "@/lib/searchRank";
import type { Relation, RelationType } from "@/types";
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
 */
export default function AddRelationsDialog({
  open,
  onClose,
  fsId,
  cardTypeKey,
  relationType: rt,
  relations,
  onAdded,
  onRemoved,
  onUpdated,
}: {
  open: boolean;
  /** `addedCount` lets the caller reconcile once per batch instead of per add. */
  onClose: (addedCount: number) => void;
  fsId: string;
  cardTypeKey: string;
  /** The relation being added to. Chosen before opening — the caller's `+`
   *  already says which one, so the dialog carries no type selector. */
  relationType: RelationType | null;
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

  const [search, setSearch] = useState("");
  const [debouncedSearch, searchPending] = useDebouncedValue(search, 300);
  const [added, setAdded] = useState<Added[]>([]);
  const [attributes, setAttributes] = useState<RelationAttributes>({});
  const [createName, setCreateName] = useState("");
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
    setError("");
  }, [open]);

  const isSource = rt ? rt.source_type_key === cardTypeKey : true;
  const otherTypeKey = rt ? (isSource ? rt.target_type_key : rt.source_type_key) : "";
  const otherType = getType(otherTypeKey);
  const otherLabel = typeLabel(otherType) || otherTypeKey;

  // Only n:m (and the "many" side of 1:n) takes a second relation; a
  // constrained type closes after one. `POST /relations` carries no
  // cardinality guard of its own — only the bulk path does.
  const allowsMany = rt ? rt.cardinality === "n:m" || (rt.cardinality === "1:n" && !isSource) : true;

  const rtKey = rt?.key ?? "";
  const linkedForType = useMemo(
    () => relations.filter((r) => r.type === rtKey),
    [relations, rtKey],
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

  const { items, loading, hasMore, loadMore } = useCardSearch({
    types: useMemo(() => (otherTypeKey ? [otherTypeKey] : []), [otherTypeKey]),
    search: debouncedSearch,
    enabled: open && !!otherTypeKey,
    pageSize: 50,
  });

  /** Rows the server's current page offers, once exclusions are applied. */
  const offered = useMemo(
    () => items.filter((c) => !excluded.has(c.id)),
    [items, excluded],
  );

  // Filtered and ranked on the RAW input, not the debounced one: the loaded
  // page is already in memory, so narrowing it costs nothing and waiting would
  // only leave the previous query's rows on screen for another 300ms. The
  // debounce belongs to the server query above and nowhere else — same split
  // as `CardPicker`.
  const candidates = useMemo(() => {
    const q = search.trim();
    if (!q) return offered;
    return offered.filter((c) => searchRank(c.name, q) >= 0).sort(compareByRank(q));
  }, [offered, search]);

  // Counted on `offered`, deliberately *not* on `candidates`: this hook exists
  // to page past exclusions eating page slots (#918), and the server has not
  // seen the half-typed term yet. Feeding it the optimistically-narrowed count
  // would make every keystroke look like an exhausted page and pull more pages
  // for a query that is about to be replaced.
  const filling = useFillVisible({
    enabled: open && !!otherTypeKey,
    loading,
    hasMore,
    visible: offered.length,
    pageSize: 50,
    loadMore,
    resetKey: `${rtKey}|${debouncedSearch}`,
  });

  // The list must never look settled while it is still showing the previous
  // query's rows, so the debounce's own pending flag counts as busy.
  const busyList = loading || filling || searchPending;

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
      const card = await api.post<{ id: string; name: string; type: string }>("/cards", {
        type: otherTypeKey,
        name,
      });
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
        <Box sx={{ flex: 1 }}>{t("relations.addSpecific", { type: otherLabel })}</Box>
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
            {t("relations.alreadyLinkedHint", { count: linkedForType.length })}
          </Typography>
        )}

        {/* The candidate list scrolls inside the dialog — never a floating
            popper, so nothing can flip, clip or reposition under the cursor. */}
        <Box
          ref={listRef}
          onScroll={() => {
            const el = listRef.current;
            if (!el || loading || !hasMore) return;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) loadMore();
          }}
          sx={{
            flex: fullScreen ? 1 : "none",
            height: fullScreen ? undefined : 280,
            overflowY: "auto",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
          }}
        >
          {candidates.length === 0 && !busyList ? (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ p: 2, fontStyle: "italic" }}
            >
              {linkedForType.length > 0 && !search
                ? t("relations.allLinked", { type: otherLabel })
                : t("common:labels.noResults")}
            </Typography>
          ) : (
            <List dense disablePadding>
              {candidates.map((c) => (
                <ListItemButton key={c.id} onClick={() => add(c)} disabled={busy}>
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
                  <Typography variant="body2">{c.name}</Typography>
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
