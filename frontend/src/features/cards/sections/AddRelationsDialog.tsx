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
import FormControl from "@mui/material/FormControl";
import IconButton from "@mui/material/IconButton";
import InputLabel from "@mui/material/InputLabel";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
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
import { useRelationLabel, useTypeLabel } from "@/hooks/useResolveLabel";
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
  relationTypes,
  initialRelationTypeKey,
  relations,
  onAdded,
  onRemoved,
}: {
  open: boolean;
  /** `addedCount` lets the caller reconcile once per batch instead of per add. */
  onClose: (addedCount: number) => void;
  fsId: string;
  cardTypeKey: string;
  /** Every relation type this card type can hold; the picker chooses among them. */
  relationTypes: RelationType[];
  /** Pre-selected type — the group whose `+` was clicked. */
  initialRelationTypeKey?: string;
  /** The card's current relations, used to hide what is already linked. */
  relations: Relation[];
  onAdded: (rel: Relation) => void;
  onRemoved: (relId: string) => void;
}) {
  const { t } = useTranslation(["cards", "common"]);
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const { getType } = useMetamodel();
  const typeLabel = useTypeLabel();
  const relLabel = useRelationLabel();

  const [rtKey, setRtKey] = useState(initialRelationTypeKey ?? relationTypes[0]?.key ?? "");
  const [search, setSearch] = useState("");
  const [debouncedSearch, searchPending] = useDebouncedValue(search, 300);
  const [added, setAdded] = useState<Added[]>([]);
  const [attributes, setAttributes] = useState<RelationAttributes>({});
  const [createName, setCreateName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // Each *opening* is its own batch — and only an opening. Keying this on
  // `relationTypes` / `initialRelationTypeKey` as well meant any parent
  // re-render that produced a new array identity cleared the chips and the
  // selected type out from under an in-progress batch.
  useEffect(() => {
    if (!open) return;
    setRtKey(initialRelationTypeKey ?? relationTypes[0]?.key ?? "");
    setSearch("");
    setAdded([]);
    setAttributes({});
    setCreateName("");
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const rt = relationTypes.find((r) => r.key === rtKey);
  const isSource = rt ? rt.source_type_key === cardTypeKey : true;
  const otherTypeKey = rt ? (isSource ? rt.target_type_key : rt.source_type_key) : "";
  const otherType = getType(otherTypeKey);
  const otherLabel = typeLabel(otherType) || otherTypeKey;

  // Only n:m (and the "many" side of 1:n) takes a second relation; a
  // constrained type closes after one. `POST /relations` carries no
  // cardinality guard of its own — only the bulk path does.
  const allowsMany = rt ? rt.cardinality === "n:m" || (rt.cardinality === "1:n" && !isSource) : true;

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

  const candidates = useMemo(() => {
    const visible = items.filter((c) => !excluded.has(c.id));
    const q = debouncedSearch.trim();
    if (!q) return visible;
    return visible.filter((c) => searchRank(c.name, q) >= 0).sort(compareByRank(q));
  }, [items, excluded, debouncedSearch]);

  const filling = useFillVisible({
    enabled: open && !!otherTypeKey,
    loading,
    hasMore,
    visible: candidates.length,
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

  const verb = rt ? (isSource ? relLabel(rt) : relLabel(rt, true)) : "";

  return (
    <Dialog
      open={open}
      onClose={() => onClose(added.length)}
      maxWidth="sm"
      fullWidth
      fullScreen={fullScreen}
    >
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pr: 1 }}>
        <Box sx={{ flex: 1 }}>{t("relations.addMany")}</Box>
        <IconButton size="small" onClick={() => onClose(added.length)} aria-label={t("common:actions.close")}>
          <MaterialSymbol icon="close" size={20} />
        </IconButton>
      </DialogTitle>
      <DialogContent
        sx={{ display: "flex", flexDirection: "column", gap: 2, pb: 1, overflow: "hidden" }}
      >
        {error && (
          <Alert severity="error" onClose={() => setError("")}>
            {error}
          </Alert>
        )}

        {relationTypes.length > 1 && (
          <FormControl fullWidth size="small">
            <InputLabel>{t("relations.relationType")}</InputLabel>
            <Select
              value={rtKey}
              label={t("relations.relationType")}
              onChange={(e) => {
                setRtKey(e.target.value);
                setAttributes({});
                setSearch("");
              }}
            >
              {relationTypes.map((candidate) => {
                const asSource = candidate.source_type_key === cardTypeKey;
                const targetKey = asSource
                  ? candidate.target_type_key
                  : candidate.source_type_key;
                const label = typeLabel(getType(targetKey)) || targetKey;
                return (
                  <MenuItem key={candidate.key} value={candidate.key}>
                    {label} — {asSource ? relLabel(candidate) : relLabel(candidate, true)}
                  </MenuItem>
                );
              })}
            </Select>
          </FormControl>
        )}

        {relationTypes.length === 1 && rt && (
          <Typography variant="caption" color="text.secondary">
            {verb}
          </Typography>
        )}

        {rt && hasEditableRelationAttributes(rt) && (
          <Box>
            <Typography variant="caption" fontWeight={600} sx={{ display: "block", mb: 0.5 }}>
              {t("relations.optionalDetails")}
            </Typography>
            {/* Applies to each card added from here on, so a run of "Provider"
                links can be followed by a run of "Consumer" ones without
                leaving the dialog. */}
            <RelationAttributesEditor
              relationType={rt}
              value={attributes}
              onChange={setAttributes}
              compact
              disabled={busy}
            />
          </Box>
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
