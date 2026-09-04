import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import CardPicker from "@/components/CardPicker";
import { expandSides, onSide, otherEnd, sideKey, sortRelationsByName } from "@/lib/relationSort";
import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { hasTypePermission } from "@/components/RequirePermission";
import { useAuthContext } from "@/hooks/AuthContext";
import { useTypeLabel, useRelationLabel } from "@/hooks/useResolveLabel";
import type { Relation, RelationType } from "@/types";

interface RelationCellPopoverProps {
  open: boolean;
  onClose: () => void;
  cardId: string;
  cardName: string;
  /**
   * Every relation type the grid column stands for. A column is keyed by the
   * *related card type*, and the metamodel allows any number of relation types
   * per ordered card-type pair — so this may hold more than one, each with its
   * own verb, and each is edited in its own section.
   */
  relationTypes: RelationType[];
  selectedType: string;
  onRelationsChanged: () => void;
}

interface SearchResult {
  id: string;
  name: string;
  type: string;
}

/** The other end of `relationType` as seen from the grid's card type. */
function otherTypeKeyOf(relationType: RelationType, selectedType: string): string {
  return relationType.source_type_key === selectedType
    ? relationType.target_type_key
    : relationType.source_type_key;
}

interface RelationTypeSectionProps {
  relationType: RelationType;
  /**
   * Which end of `relationType` the grid's card sits at. Passed in, never
   * derived from the type: for a self-referencing type (source type ===
   * target type) that test is true at both ends, which is how the popover
   * headed both directions with the forward verb and could only ever CREATE
   * the outgoing one.
   */
  isSource: boolean;
  selectedType: string;
  cardId: string;
  relations: Relation[];
  loading: boolean;
  /** Render the verb heading — only needed when the column carries several types. */
  showHeading: boolean;
  open: boolean;
  onChanged: () => Promise<void> | void;
  onError: (message: string) => void;
}

function RelationTypeSection({
  relationType,
  isSource,
  cardId,
  relations,
  loading,
  showHeading,
  open,
  onChanged,
  onError,
}: RelationTypeSectionProps) {
  const { t, i18n } = useTranslation(["inventory", "common"]);
  const { getType } = useMetamodel();
  const typeLabel = useTypeLabel();
  const relLabel = useRelationLabel();

  const targetTypeKey = isSource ? relationType.target_type_key : relationType.source_type_key;
  const targetTypeConfig = getType(targetTypeKey);
  // Quick-create makes a card of the relation's other end (discussion #1068).
  const { user } = useAuthContext();
  const canCreateTargetType = hasTypePermission(user, "inventory.create", targetTypeKey);
  const verb = isSource ? relLabel(relationType) : relLabel(relationType, true);

  const [targetSearch, setTargetSearch] = useState("");
  const [selectedTarget, setSelectedTarget] = useState<SearchResult | null>(null);
  const [adding, setAdding] = useState(false);
  const [createMode, setCreateMode] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createLoading, setCreateLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setTargetSearch("");
      setSelectedTarget(null);
      setCreateMode(false);
      setCreateName("");
    }
  }, [open]);

  // Alphabetical by the related card's name (#918), matching the card-detail
  // Relations section.
  const sortedRelations = useMemo(
    () => sortRelationsByName(relations, cardId, i18n.language),
    [relations, cardId, i18n.language],
  );

  // Exclude the current card and the cards already related *through this relation
  // type*. Scoping it per section is what lets the same card be linked twice when
  // a column carries several relation types (e.g. "owns" and "uses").
  // Resolve the other end per row rather than from `isSource` — that flag is a
  // property of the relation *type*, so for a self-referencing type (source
  // type === target type) it is true for every row and incoming relations
  // would resolve to the wrong end.
  // `relations` is already this side's slice, so "already linked" means on
  // this side: for a self-referencing type a card linked the other way round
  // is still offered here — the reverse row is a distinct edge.
  const excludeIds = useMemo(() => {
    const ids = new Set(relations.map((r) => (r.source_id === cardId ? r.target_id : r.source_id)));
    ids.add(cardId);
    return [...ids];
  }, [relations, cardId]);

  const handleAdd = async () => {
    if (!selectedTarget) return;
    setAdding(true);
    try {
      await api.post("/relations", {
        type: relationType.key,
        source_id: isSource ? cardId : selectedTarget.id,
        target_id: isSource ? selectedTarget.id : cardId,
      });
      await onChanged();
      setSelectedTarget(null);
      setTargetSearch("");
    } catch (e) {
      onError(e instanceof Error ? e.message : t("relation.addFailed"));
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (relId: string) => {
    try {
      await api.delete(`/relations/${relId}`);
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : t("relation.removeFailed"));
    }
  };

  const handleQuickCreate = async () => {
    if (!createName.trim()) return;
    setCreateLoading(true);
    try {
      const created = await api.post<SearchResult>("/cards", {
        type: targetTypeKey,
        name: createName.trim(),
      });
      // Immediately create the relation
      await api.post("/relations", {
        type: relationType.key,
        source_id: isSource ? cardId : created.id,
        target_id: isSource ? created.id : cardId,
      });
      await onChanged();
      setCreateMode(false);
      setCreateName("");
    } catch (e) {
      onError(e instanceof Error ? e.message : t("relation.createFailed"));
    } finally {
      setCreateLoading(false);
    }
  };

  const otherType = getType(targetTypeKey);

  return (
    <Box>
      {showHeading && (
        <Typography
          variant="subtitle2"
          fontWeight={600}
          sx={{ mb: 1, display: "flex", alignItems: "center", gap: 0.75 }}
        >
          {otherType && (
            <MaterialSymbol icon={otherType.icon} size={16} color={otherType.color} />
          )}
          {verb}
        </Typography>
      )}

      {/* Current relations */}
      <Typography
        variant="caption"
        color="text.secondary"
        fontWeight={600}
        sx={{ mb: 1, display: "block" }}
      >
        {t("relation.currentRelations")}
      </Typography>
      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
          <CircularProgress size={24} />
        </Box>
      ) : (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 2.5, minHeight: 32 }}>
          {relations.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>
              {t("relation.noRelationsYet")}
            </Typography>
          )}
          {sortedRelations.map((r) => {
            const other = otherEnd(r, cardId);
            return (
              <Chip
                key={r.id}
                label={other?.name || t("relation.unknown")}
                onDelete={() => handleDelete(r.id)}
                icon={
                  otherType ? (
                    <MaterialSymbol icon={otherType.icon} size={16} color={otherType.color} />
                  ) : undefined
                }
                sx={{ maxWidth: "100%" }}
              />
            );
          })}
        </Box>
      )}

      {/* Add section */}
      <Typography
        variant="caption"
        color="text.secondary"
        fontWeight={600}
        sx={{ mb: 1, display: "block" }}
      >
        {t("relation.addRelation")}
      </Typography>
      {!createMode ? (
        <>
          <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
            <CardPicker
              fullWidth
              types={targetTypeKey}
              // Relation targets are picked by level as much as by name
              // (#1050). A dialog the user opened on purpose, so the whole-type
              // load is affordable here — unlike a grid cell editor. Each
              // relation-type section carries its own picker, so a pair joined
              // by several relation types loads the target type once per
              // section; that duplication predates the tree (every section
              // already fetched its own page) and the level context is worth
              // as much in the second section as in the first.
              hierarchy
              value={selectedTarget}
              onChange={setSelectedTarget}
              onInputChange={setTargetSearch}
              excludeIds={excludeIds}
              enabled={open}
              placeholder={t("relation.searchType", {
                type: typeLabel(targetTypeConfig) || targetTypeKey,
              })}
            />
            <Button
              variant="contained"
              size="small"
              onClick={handleAdd}
              disabled={!selectedTarget || adding}
              sx={{ textTransform: "none", whiteSpace: "nowrap", minWidth: 56, height: 40 }}
            >
              {adding ? <CircularProgress size={18} color="inherit" /> : t("common:actions.add")}
            </Button>
          </Box>
          {canCreateTargetType && (
            <Button
              size="small"
              sx={{ mt: 0.5, textTransform: "none" }}
              startIcon={<MaterialSymbol icon="add" size={16} />}
              onClick={() => {
                setCreateMode(true);
                setCreateName(targetSearch);
              }}
            >
              {t("relation.createNew", { type: typeLabel(targetTypeConfig) || targetTypeKey })}
            </Button>
          )}
        </>
      ) : (
        <Box
          sx={{
            p: 2,
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
            bgcolor: "action.hover",
          }}
        >
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
            {t("relation.createNew", { type: typeLabel(targetTypeConfig) || targetTypeKey })}
          </Typography>
          <TextField
            fullWidth
            size="small"
            placeholder={t("common:labels.name")}
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleQuickCreate()}
            autoFocus
            sx={{ mb: 1 }}
          />
          <Box sx={{ display: "flex", gap: 1 }}>
            <Button
              size="small"
              variant="contained"
              onClick={handleQuickCreate}
              disabled={!createName.trim() || createLoading}
              sx={{ textTransform: "none" }}
            >
              {createLoading ? (
                <CircularProgress size={16} color="inherit" />
              ) : (
                t("relation.createAndAdd")
              )}
            </Button>
            <Button size="small" onClick={() => setCreateMode(false)} sx={{ textTransform: "none" }}>
              {t("common:actions.back")}
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}

export default function RelationCellPopover({
  open,
  onClose,
  cardId,
  cardName,
  relationTypes,
  selectedType,
  onRelationsChanged,
}: RelationCellPopoverProps) {
  const { getType } = useMetamodel();
  const typeLabel = useTypeLabel();
  const relLabel = useRelationLabel();

  const [relations, setRelations] = useState<Relation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const primary = relationTypes[0];
  const targetTypeKey = primary ? otherTypeKeyOf(primary, selectedType) : "";
  const otherType = getType(targetTypeKey);
  // One section per SIDE: a self-referencing type contributes two ("has site"
  // and "is site of"), each with its own rows, verb and add path.
  const sides = useMemo(() => expandSides(relationTypes, selectedType), [relationTypes, selectedType]);
  const multi = sides.length > 1;

  // One un-typed round-trip for the card, partitioned client-side across the
  // column's relation types — cheaper than one request per type.
  const relTypeKeys = useMemo(
    () => relationTypes.map((rt) => rt.key).join(","),
    [relationTypes],
  );

  const loadRelations = useCallback(async () => {
    setLoading(true);
    try {
      const all = await api.get<Relation[]>(`/relations?card_id=${cardId}`);
      const keys = new Set(relTypeKeys ? relTypeKeys.split(",") : []);
      setRelations(all.filter((r) => keys.has(r.type)));
    } catch {
      setRelations([]);
    } finally {
      setLoading(false);
    }
  }, [cardId, relTypeKeys]);

  useEffect(() => {
    if (open) {
      loadRelations();
      setError("");
    }
  }, [open, loadRelations]);

  const handleChanged = useCallback(async () => {
    await loadRelations();
    onRelationsChanged();
  }, [loadRelations, onRelationsChanged]);

  const relationsBySide = useMemo(() => {
    const map = new Map<string, Relation[]>();
    for (const { rt, isSource } of sides) {
      map.set(
        sideKey(rt, isSource),
        relations.filter((r) => onSide(r, rt.key, cardId, isSource)),
      );
    }
    return map;
  }, [relations, sides, cardId]);

  if (!primary) return null;

  const singleVerb = sides[0]?.isSource ? relLabel(primary) : relLabel(primary, true);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pb: 1 }}>
        {otherType && (
          <Box
            sx={{
              width: 14,
              height: 14,
              borderRadius: "50%",
              bgcolor: otherType.color,
              flexShrink: 0,
            }}
          />
        )}
        <Typography variant="h6" component="span" sx={{ flex: 1 }}>
          {cardName}
          <Typography component="span" variant="body1" color="text.secondary" sx={{ mx: 1 }}>
            {multi ? "→" : `${singleVerb} →`}
          </Typography>
          {otherType ? typeLabel(otherType) : targetTypeKey}
        </Typography>
        <IconButton size="small" onClick={onClose} edge="end">
          <MaterialSymbol icon="close" size={20} />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
            {error}
          </Alert>
        )}

        {sides.map(({ rt, isSource }, i) => (
          <Box key={sideKey(rt, isSource)}>
            {i > 0 && <Divider sx={{ mb: 2.5 }} />}
            <RelationTypeSection
              relationType={rt}
              isSource={isSource}
              selectedType={selectedType}
              cardId={cardId}
              relations={relationsBySide.get(sideKey(rt, isSource)) || []}
              loading={loading}
              showHeading={multi}
              open={open}
              onChanged={handleChanged}
              onError={setError}
            />
          </Box>
        ))}
      </DialogContent>
    </Dialog>
  );
}
