import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Alert from "@mui/material/Alert";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Tooltip from "@mui/material/Tooltip";
import Popover from "@mui/material/Popover";
import Collapse from "@mui/material/Collapse";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import CardPicker from "@/components/CardPicker";
import { useMetamodel } from "@/hooks/useMetamodel";
import {
  useResolveLabel,
  useTypeLabel,
  useRelationLabel,
  useSubtypeLabel,
} from "@/hooks/useResolveLabel";
import { api } from "@/api/client";
import type { Relation, RelationType, SubtypeDef } from "@/types";
import RelationAttributesEditor, {
  flowDirectionBadge,
  relationAttributeBadges,
  hasRelationSubtypes,
  type RelationAttributes,
} from "./RelationAttributesEditor";
import { readableTextColor } from "@/lib/color";
import {
  bucketRelationsBySubtype,
  shouldGroupBySubtype,
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

/* ── Inline Add Row ─────────────────────────────────────────── */
function InlineAddRow({
  rt,
  isSource,
  fsId,
  onAdded,
  onClose,
}: {
  rt: RelationType;
  isSource: boolean;
  fsId: string;
  onAdded: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation(["cards", "common"]);
  const typeLabel = useTypeLabel();
  const { getType } = useMetamodel();
  const targetTypeKey = isSource ? rt.target_type_key : rt.source_type_key;
  const targetTypeConfig = getType(targetTypeKey);

  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [createMode, setCreateMode] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createLoading, setCreateLoading] = useState(false);

  const handleSelect = async (card: { id: string; name: string; type: string } | null) => {
    if (!card) return;
    setError("");
    try {
      await api.post("/relations", {
        type: rt.key,
        source_id: isSource ? fsId : card.id,
        target_id: isSource ? card.id : fsId,
      });
      onAdded();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("relations.errors.create"));
    }
  };

  const handleQuickCreate = async () => {
    if (!createName.trim()) return;
    setCreateLoading(true);
    setError("");
    try {
      const created = await api.post<{ id: string; name: string; type: string }>("/cards", {
        type: targetTypeKey,
        name: createName.trim(),
      });
      await api.post("/relations", {
        type: rt.key,
        source_id: isSource ? fsId : created.id,
        target_id: isSource ? created.id : fsId,
      });
      onAdded();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("relations.errors.createCard"));
    } finally {
      setCreateLoading(false);
    }
  };

  const targetLabel = typeLabel(targetTypeConfig) || targetTypeKey;

  if (createMode) {
    return (
      <Box sx={{ mt: 1, p: 1.5, border: "1px solid", borderColor: "divider", borderRadius: 1, bgcolor: "action.hover" }}>
        {error && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError("")}>{error}</Alert>}
        <Typography variant="caption" fontWeight={600} sx={{ mb: 0.5, display: "block" }}>
          {t("relations.createNew", { type: targetLabel })}
        </Typography>
        <TextField
          fullWidth
          size="small"
          label={t("common:labels.name")}
          value={createName}
          onChange={(e) => setCreateName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleQuickCreate()}
          autoFocus
          sx={{ mb: 1 }}
        />
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button size="small" variant="contained" onClick={handleQuickCreate} disabled={!createName.trim() || createLoading}>
            {t("relations.createAndAdd")}
          </Button>
          <Button size="small" onClick={() => setCreateMode(false)}>
            {t("relations.backToSearch")}
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button size="small" color="inherit" onClick={onClose}>
            {t("common:actions.cancel")}
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ mt: 1 }}>
      {error && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError("")}>{error}</Alert>}
      <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
        <CardPicker
          sx={{ flex: 1 }}
          types={targetTypeKey}
          value={null}
          onChange={handleSelect}
          onInputChange={setSearch}
          excludeIds={[fsId]}
          placeholder={t("relations.search", { type: targetLabel })}
          autoFocus
        />
        <Tooltip title={t("relations.createNew", { type: targetLabel })}>
          <IconButton size="small" onClick={() => { setCreateMode(true); setCreateName(search); }}>
            <MaterialSymbol icon="add" size={18} />
          </IconButton>
        </Tooltip>
        <IconButton size="small" onClick={onClose}>
          <MaterialSymbol icon="close" size={18} />
        </IconButton>
      </Box>
    </Box>
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
  onRelationUpdated,
}: {
  rt: RelationType;
  isSource: boolean;
  mandatory: boolean;
  rels: Relation[];
  fsId: string;
  canManageRelations: boolean;
  onReload: () => void;
  onRelationUpdated: (updated: Relation) => void;
}) {
  const { t } = useTranslation(["cards", "common"]);
  const rl = useResolveLabel();
  const typeLabel = useTypeLabel();
  const relLabel = useRelationLabel();
  const subtypeLabel = useSubtypeLabel();
  const { getType } = useMetamodel();
  const navigate = useNavigate();
  const [inlineAddOpen, setInlineAddOpen] = useState(false);
  const [attrsAnchor, setAttrsAnchor] = useState<HTMLElement | null>(null);
  const [attrsRelation, setAttrsRelation] = useState<Relation | null>(null);

  const rtHasSubtypes = hasRelationSubtypes(rt);

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
      ),
    [rels, fsId, subtypeDefs],
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
            .map(
              (b) =>
                `${rl(b.fieldLabel, b.fieldTranslations)}: ${rl(b.optionLabel, b.optionTranslations)}`,
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
            {rtHasSubtypes && canManageRelations && (
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
          borderBottom: rels.length > 0 || inlineAddOpen ? "1px solid" : "none",
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
        {canManageRelations && !inlineAddOpen && (
          <Tooltip title={t("relations.addSpecific", {
            type: typeLabel(otherType) || otherTypeKey,
          })}>
            <IconButton
              size="small"
              onClick={() => setInlineAddOpen(true)}
              color="primary"
            >
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

      {rtHasSubtypes && attrsRelation && (
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
      {rels.length === 0 && !inlineAddOpen && (
        <Box sx={{ px: 1.5, py: 1 }}>
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>
            {mandatory ? t("relations.emptyMandatory") : t("relations.emptyVisible")}
          </Typography>
        </Box>
      )}

      {/* Inline add */}
      {inlineAddOpen && (
        <Box sx={{ px: 1.5, pb: 1 }}>
          <InlineAddRow
            rt={rt}
            isSource={isSource}
            fsId={fsId}
            onAdded={onReload}
            onClose={() => setInlineAddOpen(false)}
          />
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
}: {
  fsId: string;
  cardTypeKey: string;
  refreshKey?: number;
  canManageRelations?: boolean;
  initialExpanded?: boolean;
}) {
  const { t } = useTranslation(["cards", "common"]);
  const typeLabel = useTypeLabel();
  const relLabel = useRelationLabel();
  const [relations, setRelations] = useState<Relation[]>([]);
  const { types: allTypes, relationTypes, getType } = useMetamodel();
  const visibleTypeKeys = useMemo(() => new Set(allTypes.map((t) => t.key)), [allTypes]);

  // Add relation dialog state (for non-displayed relation types)
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addRelType, setAddRelType] = useState("");
  const [targetSearch, setTargetSearch] = useState("");
  const [selectedTarget, setSelectedTarget] = useState<{ id: string; name: string; type: string } | null>(null);
  const [addError, setAddError] = useState("");

  // Inline create state (inside dialog)
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createLoading, setCreateLoading] = useState(false);

  // Optional attributes captured in the dialog (when relation type declares a schema)
  const [dialogAttributes, setDialogAttributes] = useState<RelationAttributes>({});

  const load = useCallback(() => {
    api.get<Relation[]>(`/relations?card_id=${fsId}`).then(setRelations).catch(() => {});
  }, [fsId]);

  useEffect(load, [load, refreshKey]);

  const handleRelationUpdated = useCallback((updated: Relation) => {
    // Only overlay the mutable fields the PATCH response actually updates.
    // Spreading `updated` wholesale risks clobbering the eagerly-loaded
    // `source`/`target` card refs if the PATCH response ever returns them
    // shallower than the GET (we've seen rows render as "Unknown" after
    // editing direction). The id-keyed merge here keeps the existing refs.
    setRelations((prev) =>
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

  // Dialog state
  const selectedRT = relationTypes.find((rt) => rt.key === addRelType);
  const dialogIsSource = selectedRT ? selectedRT.source_type_key === cardTypeKey : true;
  const dialogTargetTypeKey = selectedRT
    ? dialogIsSource ? selectedRT.target_type_key : selectedRT.source_type_key
    : "";
  const dialogTargetConfig = getType(dialogTargetTypeKey);

  const handleAddRelation = async () => {
    if (!selectedRT || !selectedTarget) return;
    setAddError("");
    try {
      const payload: Record<string, unknown> = {
        type: selectedRT.key,
        source_id: dialogIsSource ? fsId : selectedTarget.id,
        target_id: dialogIsSource ? selectedTarget.id : fsId,
      };
      if (Object.keys(dialogAttributes).length > 0) {
        payload.attributes = dialogAttributes;
      }
      await api.post("/relations", payload);
      load();
      setAddDialogOpen(false);
      setAddRelType("");
      setSelectedTarget(null);
      setTargetSearch("");
      setDialogAttributes({});
    } catch (e) {
      setAddError(e instanceof Error ? e.message : t("relations.errors.create"));
    }
  };

  const handleQuickCreate = async () => {
    if (!createName.trim() || !dialogTargetTypeKey) return;
    setCreateLoading(true);
    try {
      const created = await api.post<{ id: string; name: string; type: string }>("/cards", {
        type: dialogTargetTypeKey,
        name: createName.trim(),
      });
      setSelectedTarget({ id: created.id, name: created.name, type: created.type });
      setCreateOpen(false);
      setCreateName("");
    } catch (e) {
      setAddError(e instanceof Error ? e.message : t("relations.errors.createCard"));
    } finally {
      setCreateLoading(false);
    }
  };

  const totalRelations = relations.length;

  return (
    <Accordion defaultExpanded={initialExpanded} disableGutters>
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
            onReload={load}
            onRelationUpdated={handleRelationUpdated}
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
                onReload={load}
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

        {/* Generic Add Relation button — always visible for non-displayed types or as fallback */}
        {canManageRelations && hiddenRTs.length > 0 && (
          <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 1 }}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<MaterialSymbol icon="add_link" size={16} />}
              onClick={() => setAddDialogOpen(true)}
            >
              {t("relations.add")}
            </Button>
          </Box>
        )}
      </AccordionDetails>

      {/* ── Add Relation Dialog (non-displayed types) ── */}
      <Dialog
        open={addDialogOpen}
        onClose={() => { setAddDialogOpen(false); setCreateOpen(false); }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t("relations.add")}</DialogTitle>
        <DialogContent>
          {addError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setAddError("")}>{addError}</Alert>}
          <FormControl fullWidth size="small" sx={{ mt: 1, mb: 2 }}>
            <InputLabel>{t("relations.relationType")}</InputLabel>
            <Select
              value={addRelType}
              label={t("relations.relationType")}
              onChange={(e) => {
                setAddRelType(e.target.value);
                setSelectedTarget(null);
                setTargetSearch("");
                setCreateOpen(false);
                setDialogAttributes({});
              }}
            >
              {hiddenRTs.map((rt) => {
                const rtIsSource = rt.source_type_key === cardTypeKey;
                const verb = rtIsSource ? relLabel(rt) : relLabel(rt, true);
                const otherKey = rtIsSource ? rt.target_type_key : rt.source_type_key;
                const other = getType(otherKey);
                return (
                  <MenuItem key={rt.key} value={rt.key}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Typography variant="body2" fontWeight={500}>{verb}</Typography>
                      <MaterialSymbol icon="arrow_forward" size={14} />
                      {other && (
                        <>
                          <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: other.color }} />
                          <Typography variant="body2">{typeLabel(other)}</Typography>
                        </>
                      )}
                      <Chip size="small" label={rt.cardinality} variant="outlined" sx={{ height: 18, fontSize: "0.65rem" }} />
                    </Box>
                  </MenuItem>
                );
              })}
            </Select>
          </FormControl>
          {addRelType && !createOpen && (
            <>
              <CardPicker
                types={dialogTargetTypeKey}
                value={selectedTarget}
                onChange={setSelectedTarget}
                onInputChange={setTargetSearch}
                excludeIds={[fsId]}
                fullWidth
                label={t("relations.search", {
                  type: typeLabel(dialogTargetConfig) || dialogTargetTypeKey,
                })}
              />
              <Button
                size="small"
                sx={{ mt: 1 }}
                startIcon={<MaterialSymbol icon="add" size={16} />}
                onClick={() => { setCreateOpen(true); setCreateName(targetSearch); }}
              >
                {t("relations.createNew", {
                  type: typeLabel(dialogTargetConfig) || dialogTargetTypeKey,
                })}
              </Button>
              {selectedRT && hasRelationSubtypes(selectedRT) && (
                <Box sx={{ mt: 2, p: 1.5, border: "1px dashed", borderColor: "divider", borderRadius: 1 }}>
                  <Typography variant="caption" fontWeight={600} sx={{ display: "block", mb: 1 }}>
                    {t("relations.optionalDetails")}
                  </Typography>
                  <RelationAttributesEditor
                    relationType={selectedRT}
                    value={dialogAttributes}
                    onChange={setDialogAttributes}
                    compact
                  />
                </Box>
              )}
            </>
          )}
          {addRelType && createOpen && (
            <Box sx={{ mt: 1, p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1, bgcolor: "action.hover" }}>
              <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                {t("relations.createNew", {
                  type: typeLabel(dialogTargetConfig) || dialogTargetTypeKey,
                })}
              </Typography>
              <TextField
                fullWidth
                size="small"
                label={t("common:labels.name")}
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleQuickCreate()}
                autoFocus
                sx={{ mb: 1 }}
              />
              <Box sx={{ display: "flex", gap: 1 }}>
                <Button size="small" variant="contained" onClick={handleQuickCreate} disabled={!createName.trim() || createLoading}>
                  {t("relations.createAndSelect")}
                </Button>
                <Button size="small" onClick={() => setCreateOpen(false)}>
                  {t("relations.backToSearch")}
                </Button>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setAddDialogOpen(false); setCreateOpen(false); }}>{t("common:actions.cancel")}</Button>
          <Button variant="contained" onClick={handleAddRelation} disabled={!selectedRT || !selectedTarget}>
            {t("common:actions.add")}
          </Button>
        </DialogActions>
      </Dialog>
    </Accordion>
  );
}

export default RelationsSection;
