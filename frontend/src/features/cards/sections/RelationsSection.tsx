import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Alert from "@mui/material/Alert";
import Tooltip from "@mui/material/Tooltip";
import Popover from "@mui/material/Popover";
import Collapse from "@mui/material/Collapse";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useSyncedExpanded } from "@/hooks/useSyncedExpanded";
import {
  useResolveLabel,
  useTypeLabel,
  useRelationLabel,
  useSubtypeLabel,
} from "@/hooks/useResolveLabel";
import { api } from "@/api/client";
import type {
  DescendantRelationSummaryEntry,
  Relation,
  RelationType,
  SubtypeDef,
} from "@/types";
import AddRelationsDialog from "./AddRelationsDialog";
import DescendantRelationsDrawer from "./DescendantRelationsDrawer";
import RelationAttributesEditor, {
  flowDirectionBadge,
  relationAttributeBadges,
  hasEditableRelationAttributes,
  type RelationAttributes,
} from "./RelationAttributesEditor";
import { readableTextColor } from "@/lib/color";
import {
  bucketRelationsBySubtype,
  shouldGroupBySubtype,
  sortRelationsByName,
  type SubtypeBucket,
} from "./cardDetailUtils";

/* ── helpers ────────────────────────────────────────────────── */

/** Determine visibility/mandatory from the perspective of the current card type. */
function sideFlags(rt: RelationType, cardTypeKey: string) {
  const isSource = rt.source_type_key === cardTypeKey;
  return {
    isSource,
    visible: isSource ? rt.source_visible : rt.target_visible,
    mandatory: isSource ? rt.source_mandatory : rt.target_mandatory,
  };
}

/* ── Relation Attributes Popover ────────────────────────────── */
function RelationAttrsPopover({
  anchorEl,
  open,
  onClose,
  rt,
  relation,
  onSaved,
}: {
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  rt: RelationType;
  relation: Relation;
  onSaved: (updated: Relation) => void;
}) {
  const { t } = useTranslation(["cards", "common"]);
  const [draft, setDraft] = useState<RelationAttributes>(
    (relation.attributes as RelationAttributes) ?? {},
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setDraft((relation.attributes as RelationAttributes) ?? {});
      setError("");
    }
  }, [open, relation.attributes]);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const updated = await api.patch<Relation>(`/relations/${relation.id}`, {
        attributes: draft,
      });
      onSaved(updated);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("relations.errors.create"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      slotProps={{ paper: { sx: { p: 2, minWidth: 280 } } }}
    >
      <Typography variant="caption" fontWeight={600} sx={{ display: "block", mb: 1 }}>
        {t("relations.optionalDetails")}
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      <RelationAttributesEditor
        relationType={rt}
        value={draft}
        onChange={setDraft}
        compact
        disabled={saving}
      />
      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 1.5 }}>
        <Button size="small" onClick={onClose} disabled={saving}>
          {t("common:actions.cancel")}
        </Button>
        <Button size="small" variant="contained" onClick={handleSave} disabled={saving}>
          {t("common:actions.save")}
        </Button>
      </Box>
    </Popover>
  );
}

/* ── Relation Group ─────────────────────────────────────────── */
function RelationGroup({
  rt,
  isSource,
  mandatory,
  rels,
  fsId,
  canManageRelations,
  onReload,
  onRequestAdd,
  onRelationUpdated,
  rollupCount = 0,
}: {
  rt: RelationType;
  isSource: boolean;
  mandatory: boolean;
  rels: Relation[];
  fsId: string;
  canManageRelations: boolean;
  onReload: () => void;
  /** Opens the section's add dialog with this relation type pre-selected. */
  onRequestAdd: () => void;
  onRelationUpdated: (updated: Relation) => void;
  /** Cards reachable only through descendants (#863). 0 hides the chip. */
  rollupCount?: number;
}) {
  const { t, i18n } = useTranslation(["cards", "common"]);
  const rl = useResolveLabel();
  const typeLabel = useTypeLabel();
  const relLabel = useRelationLabel();
  const subtypeLabel = useSubtypeLabel();
  const { getType } = useMetamodel();
  const navigate = useNavigate();
  const [attrsAnchor, setAttrsAnchor] = useState<HTMLElement | null>(null);
  const [attrsRelation, setAttrsRelation] = useState<Relation | null>(null);
  const [rollupOpen, setRollupOpen] = useState(false);

  const rtHasAttributes = hasEditableRelationAttributes(rt);

  const otherTypeKey = isSource ? rt.target_type_key : rt.source_type_key;
  const otherType = getType(otherTypeKey);
  const verb = isSource ? relLabel(rt) : relLabel(rt, true);

  // Subtype grouping (#792): group the related cards by the target card
  // type's subtype when the section is large and diverse enough to benefit.
  // Only applies on the flat-list path — flowDirection types keep their
  // Provider/Consumer buckets (see below).
  const subtypeDefs = useMemo<SubtypeDef[]>(() => otherType?.subtypes ?? [], [otherType]);
  const subtypeBuckets = useMemo(
    () =>
      bucketRelationsBySubtype(
        rels,
        fsId,
        subtypeDefs.map((s) => s.key),
        i18n.language,
      ),
    [rels, fsId, subtypeDefs, i18n.language],
  );
  const canGroupBySubtype = shouldGroupBySubtype(subtypeBuckets, rels.length);
  // The manual toggle is offered whenever the type has subtypes and at least
  // two are actually present, even below the auto-group threshold.
  const realSubtypeBucketCount = subtypeBuckets.filter((b) => !b.isNoSubtype).length;
  const canToggleGrouping = subtypeDefs.length > 0 && realSubtypeBucketCount >= 2;
  const [grouped, setGrouped] = useState(canGroupBySubtype);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  // Re-sync the auto-decision when the underlying relation set changes
  // (e.g. after adding/removing a relation) unless the user has toggled.
  const [userToggled, setUserToggled] = useState(false);
  useEffect(() => {
    if (!userToggled) setGrouped(canGroupBySubtype);
  }, [canGroupBySubtype, userToggled]);
  const toggleGrouped = () => {
    setUserToggled(true);
    setGrouped((g) => !g);
  };
  const toggleBucketCollapsed = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleDelete = async (relId: string) => {
    await api.delete(`/relations/${relId}`);
    onReload();
  };

  const openAttrs = (event: React.MouseEvent<HTMLElement>, rel: Relation) => {
    event.stopPropagation();
    setAttrsAnchor(event.currentTarget);
    setAttrsRelation(rel);
  };
  const closeAttrs = () => {
    setAttrsAnchor(null);
    setAttrsRelation(null);
  };

  // Bucket relations by role when the relation type carries a
  // `flowDirection` attribute. We surface Provider / Consumer roles
  // because the EA convention for an Interface is to have two roles:
  // a Provider and a Consumer (bidirectional apps act as both).
  const hasFlowDirection = (rt.attributes_schema ?? []).some((f) => f.key === "flowDirection");
  const readFlow = (r: Relation): string | undefined => {
    const v = (r.attributes as RelationAttributes | undefined)?.flowDirection;
    return typeof v === "string" ? v : undefined;
  };
  const providerRels = hasFlowDirection
    ? rels.filter((r) => {
        const v = readFlow(r);
        return v === "forward" || v === "bidirectional";
      })
    : [];
  const consumerRels = hasFlowDirection
    ? rels.filter((r) => {
        const v = readFlow(r);
        return v === "reverse" || v === "bidirectional";
      })
    : [];
  const unspecifiedRels = hasFlowDirection ? rels.filter((r) => !readFlow(r)) : [];

  const otherTypeLabel = typeLabel(otherType) || otherTypeKey;

  const renderRow = (r: Relation) => {
    const other = r.source_id === fsId ? r.target : r.source;
    const oType = getType(other?.type ?? "");
    const attrs = r.attributes as RelationAttributes | undefined;
    const flowBadge = flowDirectionBadge(rt, attrs);
    // Generic value badges for non-directional single-selects (e.g. usageType,
    // criticality) — a relation can carry several, so render one chip each.
    const attrBadges = relationAttributeBadges(rt, attrs);
    const attrSet = !!flowBadge || attrBadges.length > 0;
    const editTooltip = flowBadge
      ? t(`relations.flowDirection.${flowBadge.value}`)
      : attrBadges.length > 0
        ? attrBadges
            .map((b) =>
              // A flag has no option entity — its label IS the value, so
              // printing "field: value" would read "Create: Create".
              b.isFlag
                ? rl(b.fieldLabel, b.fieldTranslations)
                : `${rl(b.fieldLabel, b.fieldTranslations)}: ${rl(b.optionLabel, b.optionTranslations)}`,
            )
            .join(", ")
        : t("relations.editAttributes");
    return (
      <ListItem
        key={r.id}
        secondaryAction={
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            {attrBadges.map((b) => (
              <Chip
                key={b.fieldKey}
                size="small"
                label={rl(b.optionLabel, b.optionTranslations)}
                sx={{
                  height: 20,
                  fontSize: "0.7rem",
                  ...(b.color ? { bgcolor: b.color, color: readableTextColor(b.color) } : {}),
                }}
              />
            ))}
            {rtHasAttributes && canManageRelations && (
              <Tooltip title={editTooltip}>
                <IconButton
                  size="small"
                  onClick={(e) => openAttrs(e, r)}
                  sx={{
                    color: attrSet ? "primary.main" : "text.disabled",
                    border: attrSet ? "none" : "1px dashed",
                    borderColor: "divider",
                    borderRadius: 1,
                    px: 0.5,
                  }}
                >
                  <MaterialSymbol
                    icon={flowBadge ? flowBadge.icon : "label"}
                    size={20}
                  />
                </IconButton>
              </Tooltip>
            )}
            {canManageRelations && (
              <IconButton size="small" onClick={() => handleDelete(r.id)}>
                <MaterialSymbol icon="close" size={16} />
              </IconButton>
            )}
          </Box>
        }
        sx={{ py: 0.25 }}
      >
        <Box
          component="div"
          onClick={() => other && navigate(`/cards/${other.id}`)}
          sx={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 1, "&:hover": { textDecoration: "underline" } }}
        >
          {oType && <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: oType.color, flexShrink: 0 }} />}
          <ListItemText primary={other?.name || t("relations.unknown")} />
        </Box>
      </ListItem>
    );
  };

  const renderBucket = (
    icon: string,
    headerKey: string,
    bucketRels: Relation[],
    showWhenEmpty: boolean,
  ) => {
    if (bucketRels.length === 0 && !showWhenEmpty) return null;
    return (
      <Box key={headerKey}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.75,
            px: 1.5,
            py: 0.5,
            bgcolor: "background.default",
            borderTop: "1px solid",
            borderColor: "divider",
          }}
        >
          <MaterialSymbol icon={icon} size={16} />
          <Typography variant="caption" fontWeight={600} color="text.secondary">
            {t(headerKey, { type: otherTypeLabel })}
          </Typography>
          <Chip
            size="small"
            label={bucketRels.length}
            variant="outlined"
            sx={{ height: 18, fontSize: "0.65rem" }}
          />
        </Box>
        {bucketRels.length > 0 ? (
          <List dense disablePadding sx={{ px: 0.5 }}>
            {bucketRels.map(renderRow)}
          </List>
        ) : (
          <Typography
            variant="caption"
            color="text.disabled"
            sx={{ px: 1.5, py: 0.5, fontStyle: "italic", display: "block" }}
          >
            {t("relations.role.emptyBucket")}
          </Typography>
        )}
      </Box>
    );
  };

  // Collapsible subtype group (#792). Header label resolves the whole
  // SubtypeDef (never the key — see useResolveLabel #661 caveat); the
  // trailing no-subtype bucket uses a dedicated i18n label.
  const renderSubtypeBucket = (bucket: SubtypeBucket) => {
    const isOpen = !collapsed.has(bucket.key);
    const def = bucket.isNoSubtype
      ? undefined
      : subtypeDefs.find((s) => s.key === bucket.key);
    const label = bucket.isNoSubtype
      ? t("relations.subtype.noSubtype")
      : def
        ? subtypeLabel(def)
        : bucket.key;
    return (
      <Box key={bucket.key}>
        <Box
          component="button"
          onClick={() => toggleBucketCollapsed(bucket.key)}
          sx={{
            all: "unset",
            boxSizing: "border-box",
            width: "100%",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 0.75,
            px: 1.5,
            py: 0.5,
            bgcolor: "background.default",
            borderTop: "1px solid",
            borderColor: "divider",
            "&:hover": { bgcolor: "action.hover" },
          }}
        >
          <MaterialSymbol icon={isOpen ? "expand_more" : "chevron_right"} size={16} />
          <Typography
            variant="caption"
            fontWeight={600}
            color={bucket.isNoSubtype ? "text.disabled" : "text.secondary"}
            sx={{ flex: 1, fontStyle: bucket.isNoSubtype ? "italic" : "normal" }}
          >
            {label}
          </Typography>
          <Chip
            size="small"
            label={bucket.rels.length}
            variant="outlined"
            sx={{ height: 18, fontSize: "0.65rem" }}
          />
        </Box>
        <Collapse in={isOpen} unmountOnExit>
          <List dense disablePadding sx={{ px: 0.5 }}>
            {bucket.rels.map(renderRow)}
          </List>
        </Collapse>
      </Box>
    );
  };

  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        overflow: "hidden",
        mb: 1.5,
      }}
    >
      {/* Group header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.5,
          py: 1,
          bgcolor: "action.hover",
          borderBottom: rels.length > 0 ? "1px solid" : "none",
          borderColor: "divider",
        }}
      >
        {otherType && (
          <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: otherType.color, flexShrink: 0 }} />
        )}
        <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }}>
          {verb}
          {otherType && (
            <Typography component="span" variant="subtitle2" color="text.secondary" sx={{ ml: 0.5 }}>
              {typeLabel(otherType)}
            </Typography>
          )}
        </Typography>
        {mandatory && (
          <Chip
            size="small"
            label={t("relations.required")}
            color="warning"
            variant="outlined"
            sx={{ height: 20, fontSize: "0.65rem" }}
          />
        )}
        <Chip
          size="small"
          label={rt.cardinality}
          variant="outlined"
          sx={{ height: 20, fontSize: "0.65rem" }}
        />
        {/* Descendant roll-up (#863): one chip, full list in a drawer. Hidden
            entirely at 0 so leaf cards look exactly as they did before.
            Deliberately text-only — this header row already carries the
            subtype-grouping toggle, whose icon is `account_tree`, and the
            label says everything a glyph would. The info colour is what
            separates it from the neutral cardinality chip beside it. */}
        {rollupCount > 0 && (
          <Tooltip title={t("relations.rollup.chipTooltip")}>
            <Chip
              size="small"
              label={t("relations.rollup.chip", { count: rollupCount })}
              variant="outlined"
              color="info"
              onClick={() => setRollupOpen(true)}
              sx={{ height: 20, fontSize: "0.65rem", cursor: "pointer" }}
            />
          </Tooltip>
        )}
        {!hasFlowDirection && canToggleGrouping && (
          <Tooltip
            title={t(
              grouped ? "relations.subtype.ungroupTooltip" : "relations.subtype.groupTooltip",
            )}
          >
            <IconButton
              size="small"
              onClick={toggleGrouped}
              color={grouped ? "primary" : "default"}
            >
              <MaterialSymbol
                icon={grouped ? "format_list_bulleted" : "account_tree"}
                size={18}
              />
            </IconButton>
          </Tooltip>
        )}
        {canManageRelations && (
          <Tooltip title={t("relations.addSpecific", {
            type: typeLabel(otherType) || otherTypeKey,
          })}>
            <IconButton size="small" onClick={onRequestAdd} color="primary">
              <MaterialSymbol icon="add" size={18} />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* Related cards list — bucketed by role when the relation type
          carries flowDirection, grouped by subtype when toggled/auto, else
          a flat list. */}
      {rels.length > 0 && !hasFlowDirection && grouped && canToggleGrouping && (
        <Box>{subtypeBuckets.map(renderSubtypeBucket)}</Box>
      )}
      {rels.length > 0 && !hasFlowDirection && !(grouped && canToggleGrouping) && (
        <List dense disablePadding sx={{ px: 0.5 }}>
          {rels.map(renderRow)}
        </List>
      )}
      {hasFlowDirection && rels.length > 0 && (
        <>
          {renderBucket(
            "arrow_forward",
            isSource ? "relations.role.providedHeader" : "relations.role.providerHeader",
            providerRels,
            true,
          )}
          {renderBucket(
            "arrow_back",
            isSource ? "relations.role.consumedHeader" : "relations.role.consumerHeader",
            consumerRels,
            true,
          )}
          {renderBucket(
            "help_outline",
            "relations.role.unspecifiedHeader",
            unspecifiedRels,
            false,
          )}
        </>
      )}

      {rollupCount > 0 && (
        <DescendantRelationsDrawer
          open={rollupOpen}
          onClose={() => setRollupOpen(false)}
          cardId={fsId}
          rt={rt}
          isSource={isSource}
        />
      )}

      {rtHasAttributes && attrsRelation && (
        <RelationAttrsPopover
          anchorEl={attrsAnchor}
          open={Boolean(attrsAnchor)}
          onClose={closeAttrs}
          rt={rt}
          relation={attrsRelation}
          onSaved={onRelationUpdated}
        />
      )}

      {/* Empty state for mandatory/visible relations */}
      {rels.length === 0 && (
        <Box sx={{ px: 1.5, py: 1 }}>
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>
            {mandatory ? t("relations.emptyMandatory") : t("relations.emptyVisible")}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

// ── Section: Relations (with CRUD) ──────────────────────────────
function RelationsSection({
  fsId,
  cardTypeKey,
  refreshKey = 0,
  canManageRelations = true,
  initialExpanded = false,
  onCardUpdate,
}: {
  fsId: string;
  cardTypeKey: string;
  refreshKey?: number;
  canManageRelations?: boolean;
  initialExpanded?: boolean;
  /** Re-fetch the card itself. A mandatory relation is a data-quality slot,
   *  so adding or removing one moves the score in the header pill — which the
   *  section's own relation reload cannot refresh. */
  onCardUpdate?: () => void;
}) {
  const { t, i18n } = useTranslation(["cards", "common"]);
  const typeLabel = useTypeLabel();
  const relLabel = useRelationLabel();
  const [rawRelations, setRawRelations] = useState<Relation[]>([]);
  const { types: allTypes, relationTypes, getType } = useMetamodel();
  const visibleTypeKeys = useMemo(() => new Set(allTypes.map((t) => t.key)), [allTypes]);

  // The single add surface: a dialog, opened either from a group's `+` (with
  // that relation type pre-selected) or from the section's Add button.
  const [addOpen, setAddOpen] = useState(false);
  const [addRt, setAddRt] = useState<RelationType | null>(null);
  // Relation types with no group of their own are reached through a menu on
  // the section button — the dialog itself carries no type selector.
  const [addMenuAnchor, setAddMenuAnchor] = useState<HTMLElement | null>(null);

  const load = useCallback(() => {
    api.get<Relation[]>(`/relations?card_id=${fsId}`).then(setRawRelations).catch(() => {});
  }, [fsId]);

  /** Reload the relation list *and* the card, after a relation mutation. */
  const reloadAll = useCallback(() => {
    load();
    onCardUpdate?.();
  }, [load, onCardUpdate]);

  useEffect(load, [load, refreshKey]);

  // Sort once, here, rather than at each of the three render paths (flat list,
  // subtype buckets, flowDirection buckets) — `Array.prototype.filter` keeps
  // order, so every downstream grouping inherits it (discussion #918).
  const relations = useMemo(
    () => sortRelationsByName(rawRelations, fsId, i18n.language),
    [rawRelations, fsId, i18n.language],
  );

  // Descendant relation roll-up (#863). Only hierarchical types can have
  // descendants at all, and the fetch is deferred until the section is
  // actually expanded — a collapsed Relations section costs nothing, and a
  // leaf card gets one cheap query that returns [].
  // The accordion is controlled (so the roll-up fetch can be deferred until it
  // opens), and `useSyncedExpanded` re-syncs when `initialExpanded` changes —
  // the metamodel's section_config arrives asynchronously, so a config that
  // lands after mount still opens the section.
  const [expanded, setExpanded] = useSyncedExpanded(initialExpanded);
  const [rollup, setRollup] = useState<Record<string, number>>({});
  const isHierarchical = getType(cardTypeKey)?.has_hierarchy ?? false;

  useEffect(() => {
    if (!expanded || !isHierarchical) return;
    let cancelled = false;
    api
      .get<DescendantRelationSummaryEntry[]>(`/cards/${fsId}/descendant-relations/summary`)
      .then((entries) => {
        if (cancelled) return;
        const next: Record<string, number> = {};
        for (const e of entries) next[e.relation_type_key] = e.count;
        setRollup(next);
      })
      // A roll-up failure must never break the Relations section — the chip
      // simply doesn't appear.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [expanded, isHierarchical, fsId, refreshKey]);

  // Optimistic append. `POST /relations` returns the row with its `source` /
  // `target` refs eagerly loaded, so it renders identically to a refetched one
  // — 19 rapid-fire adds cost 19 POSTs and one reconcile GET instead of 19
  // full relation refetches (#918).
  //
  // The id guard is required, not defensive: `POST /relations` is idempotent
  // on (type, source, target) and returns the *existing* row (#905), so a
  // stale exclusion would otherwise produce a duplicate React key.
  const handleRelationAdded = useCallback((created: Relation) => {
    setRawRelations((prev) => (prev.some((r) => r.id === created.id) ? prev : [...prev, created]));
  }, []);

  /** Undoing an add from its chip — drop the row without a full refetch. */
  const handleRelationRemoved = useCallback((relId: string) => {
    setRawRelations((prev) => prev.filter((r) => r.id !== relId));
  }, []);

  const handleRelationUpdated = useCallback((updated: Relation) => {
    // Only overlay the mutable fields the PATCH response actually updates.
    // Spreading `updated` wholesale risks clobbering the eagerly-loaded
    // `source`/`target` card refs if the PATCH response ever returns them
    // shallower than the GET (we've seen rows render as "Unknown" after
    // editing direction). The id-keyed merge here keeps the existing refs.
    setRawRelations((prev) =>
      prev.map((r) =>
        r.id === updated.id
          ? { ...r, attributes: updated.attributes, description: updated.description }
          : r,
      ),
    );
  }, []);

  // All relevant (non-hidden) relation types for this card type
  // Successor relations are excluded — they are handled by SuccessorsSection
  const relevantRTs = useMemo(
    () =>
      relationTypes.filter(
        (rt) =>
          !rt.is_hidden &&
          !rt.key.endsWith("Successor") &&
          (rt.source_type_key === cardTypeKey || rt.target_type_key === cardTypeKey) &&
          visibleTypeKeys.has(
            rt.source_type_key === cardTypeKey ? rt.target_type_key : rt.source_type_key,
          ),
      ),
    [relationTypes, cardTypeKey, visibleTypeKeys],
  );

  // Displayed relation type groups: visible=true OR mandatory=true
  const displayedGroups = useMemo(() => {
    return relevantRTs
      .map((rt) => {
        const { isSource, visible, mandatory } = sideFlags(rt, cardTypeKey);
        const rels = relations.filter((r) => r.type === rt.key);
        return { rt, isSource, visible, mandatory, rels };
      })
      .filter(({ visible, mandatory }) => visible || mandatory);
  }, [relevantRTs, cardTypeKey, relations]);

  // Non-displayed relation types (only accessible via generic Add Relation dialog)
  const hiddenRTs = useMemo(() => {
    return relevantRTs.filter((rt) => {
      const { visible, mandatory } = sideFlags(rt, cardTypeKey);
      return !visible && !mandatory;
    });
  }, [relevantRTs, cardTypeKey]);

  const openAddDialog = (rt: RelationType) => {
    setAddRt(rt);
    setAddMenuAnchor(null);
    setAddOpen(true);
  };

  const handleAddClosed = (addedCount: number) => {
    setAddOpen(false);
    // One reconcile per batch rather than per add: picks up what the client
    // can't see (calculated fields, relation-attribute defaults).
    if (addedCount > 0) reloadAll();
  };

  const totalRelations = relations.length;

  return (
    <Accordion
      expanded={expanded}
      onChange={(_, v) => setExpanded(v)}
      disableGutters
    >
      <AccordionSummary expandIcon={<MaterialSymbol icon="expand_more" size={20} />}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1 }}>
          <MaterialSymbol icon="hub" size={20} />
          <Typography fontWeight={600}>{t("relations.title")}</Typography>
          <Chip size="small" label={totalRelations} sx={{ ml: 1, height: 20, fontSize: "0.7rem" }} />
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        {/* Displayed relation type groups */}
        {displayedGroups.map(({ rt, isSource, mandatory, rels }) => (
          <RelationGroup
            key={rt.key}
            rt={rt}
            isSource={isSource}
            mandatory={mandatory}
            rels={rels}
            fsId={fsId}
            canManageRelations={canManageRelations}
            onReload={reloadAll}
            onRequestAdd={() => openAddDialog(rt)}
            onRelationUpdated={handleRelationUpdated}
            rollupCount={rollup[rt.key] ?? 0}
          />
        ))}

        {/* Relation types with data that are NOT in displayed groups */}
        {relevantRTs
          .filter((rt) => {
            const { visible, mandatory } = sideFlags(rt, cardTypeKey);
            return !visible && !mandatory;
          })
          .map((rt) => {
            const rels = relations.filter((r) => r.type === rt.key);
            if (rels.length === 0) return null;
            const isSource = rt.source_type_key === cardTypeKey;
            return (
              <RelationGroup
                key={rt.key}
                rt={rt}
                isSource={isSource}
                mandatory={false}
                rels={rels}
                fsId={fsId}
                canManageRelations={canManageRelations}
                onReload={reloadAll}
                onRequestAdd={() => openAddDialog(rt)}
                onRelationUpdated={handleRelationUpdated}
              />
            );
          })}

        {/* Empty state when nothing is displayed at all */}
        {displayedGroups.length === 0 && totalRelations === 0 && (
          <Typography color="text.secondary" variant="body2" sx={{ mb: 1 }}>
            {t("relations.empty")}
          </Typography>
        )}

        {/* Relation types with no group of their own have no `+` to click, so
            they are reached from here: pick the type, then the same dialog. */}
        {canManageRelations && hiddenRTs.length > 0 && (
          <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 1 }}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<MaterialSymbol icon="add_link" size={16} />}
              onClick={(e) => setAddMenuAnchor(e.currentTarget)}
            >
              {t("relations.add")}
            </Button>
            <Menu
              anchorEl={addMenuAnchor}
              open={Boolean(addMenuAnchor)}
              onClose={() => setAddMenuAnchor(null)}
            >
              {hiddenRTs.map((rt) => {
                const asSource = rt.source_type_key === cardTypeKey;
                const otherKey = asSource ? rt.target_type_key : rt.source_type_key;
                return (
                  <MenuItem key={rt.key} onClick={() => openAddDialog(rt)}>
                    {typeLabel(getType(otherKey)) || otherKey} —{" "}
                    {asSource ? relLabel(rt) : relLabel(rt, true)}
                  </MenuItem>
                );
              })}
            </Menu>
          </Box>
        )}
      </AccordionDetails>

      {canManageRelations && (
        <AddRelationsDialog
          open={addOpen}
          onClose={handleAddClosed}
          fsId={fsId}
          cardTypeKey={cardTypeKey}
          relationType={addRt}
          relations={relations}
          onAdded={handleRelationAdded}
          onRemoved={handleRelationRemoved}
          onUpdated={handleRelationUpdated}
        />
      )}
    </Accordion>
  );
}

export default RelationsSection;
