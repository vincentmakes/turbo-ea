import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Alert from "@mui/material/Alert";
import LinearProgress from "@mui/material/LinearProgress";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import { useTranslation } from "react-i18next";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Popover from "@mui/material/Popover";
import Tooltip from "@mui/material/Tooltip";
import MaterialSymbol from "@/components/MaterialSymbol";
import CardPicker, { type CardOption } from "@/components/CardPicker";
import OptionChip from "@/components/OptionChip";
import { useMetamodel } from "@/hooks/useMetamodel";
import { hasTypePermission } from "@/components/RequirePermission";
import { useAuthContext } from "@/hooks/AuthContext";
import { useOptionLabel, useTypeLabel } from "@/hooks/useResolveLabel";
import { useSyncedExpanded } from "@/hooks/useSyncedExpanded";
import { api } from "@/api/client";
import type { Card, FieldOption, HierarchyData } from "@/types";

// ── Section: Hierarchy ───────────────────────────────────────────
const LEVEL_COLORS = ["#1565c0", "#42a5f5", "#90caf9", "#bbdefb", "#e3f2fd"];

/**
 * The label on one parent→child link (discussion #1100), rendered read-only as
 * an `OptionChip` and edited — when `onChange` is supplied — through a `Select`
 * over the card type's `hierarchy_labels`.
 *
 * One component used at both ends on purpose: the parent line edits the card
 * under view, each child row edits that child, and the two affordances must not
 * drift. Which card is patched is the caller's business, not this component's.
 *
 * An unknown stored key still renders (as `OptionChip`'s outlined warning chip)
 * and stays selectable in the dropdown, so a label whose option an admin has
 * deleted is visible and clearable rather than silently gone.
 */
/**
 * The link type on one parent→child edge (discussion #1100).
 *
 * Deliberately built as a copy of how card detail's **Relations** section edits
 * a relation's attributes (`RelationAttrsPopover` + the `single_select` branch
 * of `RelationAttributesEditor`): a dense `OptionChip` for the value, a `label`
 * IconButton that is outlined-dashed while nothing is set, and a popover
 * holding a draft that commits on Save. The two are the same kind of thing — a
 * per-link value drawn from a metamodel vocabulary — and sit a few centimetres
 * apart on the same page, so they read as one treatment rather than two.
 *
 * `onChange` absent means read-only: the chip still renders (a viewer can see
 * the value), only the affordance goes — same as a relation row.
 */
function HierarchyLinkLabel({
  value,
  options,
  onChange,
  idPrefix,
}: {
  value: string | null | undefined;
  options: FieldOption[];
  onChange?: (next: string | null) => Promise<void>;
  /** Makes the select's `labelId` unique per row, so each has its own name. */
  idPrefix: string;
}) {
  const { t } = useTranslation(["cards", "common"]);
  const optLabel = useOptionLabel();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [draft, setDraft] = useState<string>(value ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const option = options.find((o) => o.key === value);
  const resolved = option ? optLabel(option) : value || "";
  const open = Boolean(anchor);

  // Reopening must show what is stored, not what a cancelled edit left behind.
  useEffect(() => {
    if (open) {
      setDraft(value ?? "");
      setError("");
    }
  }, [open, value]);

  const handleSave = async () => {
    if (!onChange) return;
    setSaving(true);
    setError("");
    try {
      await onChange(draft || null);
      setAnchor(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("hierarchy.errors.setLinkLabel"));
    } finally {
      setSaving(false);
    }
  };

  // A value already set stays offered even if the option is now hidden, so
  // editing a card never silently rewrites its label.
  const selectable = options.filter((o) => !o.hidden || o.key === draft);
  const labelId = `hierarchy-link-type-${idPrefix}`;

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
      {value && (
        <OptionChip dense option={option} value={value} label={option ? resolved : undefined} />
      )}
      {onChange && (
        <Tooltip title={value ? resolved : t("hierarchy.editLinkType")}>
          <IconButton
            size="small"
            onClick={(e) => setAnchor(e.currentTarget)}
            sx={{
              color: value ? "primary.main" : "text.disabled",
              border: value ? "none" : "1px dashed",
              borderColor: "divider",
              borderRadius: 1,
              px: 0.5,
            }}
          >
            <MaterialSymbol icon="label" size={20} />
          </IconButton>
        </Tooltip>
      )}
      <Popover
        open={open}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{ paper: { sx: { p: 2, minWidth: 280 } } }}
      >
        <Typography variant="caption" fontWeight={600} sx={{ display: "block", mb: 1 }}>
          {t("hierarchy.linkType")}
        </Typography>
        {error && (
          <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError("")}>
            {error}
          </Alert>
        )}
        <FormControl size="small" fullWidth disabled={saving}>
          <InputLabel id={labelId}>{t("hierarchy.linkType")}</InputLabel>
          <Select
            labelId={labelId}
            value={draft}
            label={t("hierarchy.linkType")}
            onChange={(e) => setDraft(e.target.value as string)}
          >
            <MenuItem value="">
              <Typography variant="body2" color="text.secondary" fontStyle="italic">
                {t("hierarchy.noLinkLabel")}
              </Typography>
            </MenuItem>
            {selectable.map((o) => (
              <MenuItem key={o.key} value={o.key}>
                {optLabel(o)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 1.5 }}>
          <Button size="small" onClick={() => setAnchor(null)} disabled={saving}>
            {t("common:actions.cancel")}
          </Button>
          <Button size="small" variant="contained" onClick={handleSave} disabled={saving}>
            {t("common:actions.save")}
          </Button>
        </Box>
      </Popover>
    </Box>
  );
}

function HierarchySection({
  card,
  onUpdate,
  canEdit = true,
  initialExpanded = true,
}: {
  card: Card;
  onUpdate: () => void;
  canEdit?: boolean;
  initialExpanded?: boolean;
}) {
  const { t } = useTranslation(["cards", "common"]);
  const navigate = useNavigate();
  const { getType } = useMetamodel();
  const typeLabel = useTypeLabel();
  const typeConfig = getType(card.type);
  const [expanded, setExpanded] = useSyncedExpanded(initialExpanded);
  const [hierarchy, setHierarchy] = useState<HierarchyData | null>(null);

  // Parent picker state
  const [pickingParent, setPickingParent] = useState(false);
  const [parentSearch, setParentSearch] = useState("");
  const [selectedParent, setSelectedParent] = useState<CardOption | null>(null);

  // Add child state
  const [addChildOpen, setAddChildOpen] = useState(false);
  const [childSearch, setChildSearch] = useState("");
  const [selectedChild, setSelectedChild] = useState<CardOption | null>(null);

  // Inline create state
  const [createMode, setCreateMode] = useState<"parent" | "child" | null>(null);
  // Quick-create makes a card of this card's own type, so it needs create
  // permission on that type (discussion #1068).
  const { user } = useAuthContext();
  const canCreateOwnType = hasTypePermission(user, "inventory.create", card.type);
  const [createName, setCreateName] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [hierarchyError, setHierarchyError] = useState("");

  const loadHierarchy = useCallback(() => {
    api.get<HierarchyData>(`/cards/${card.id}/hierarchy`).then(setHierarchy).catch(() => {});
  }, [card.id]);

  useEffect(loadHierarchy, [loadHierarchy]);

  // Parent picker excludes self + existing children; child picker excludes self + ancestors.
  const parentExcludeIds = useMemo(
    () => [card.id, ...(hierarchy?.children.map((c) => c.id) || [])],
    [card.id, hierarchy],
  );
  const childExcludeIds = useMemo(
    () => [card.id, ...(hierarchy?.ancestors.map((a) => a.id) || [])],
    [card.id, hierarchy],
  );

  const handleSetParent = async () => {
    if (!selectedParent) return;
    try {
      setHierarchyError("");
      await api.patch(`/cards/${card.id}`, { parent_id: selectedParent.id });
      setPickingParent(false);
      setSelectedParent(null);
      setParentSearch("");
      loadHierarchy();
      onUpdate();
    } catch (err: unknown) {
      setHierarchyError(err instanceof Error ? err.message : t("hierarchy.errors.setParent"));
    }
  };

  const handleRemoveParent = async () => {
    await api.patch(`/cards/${card.id}`, { parent_id: null });
    loadHierarchy();
    onUpdate();
  };

  const handleAddChild = async () => {
    if (!selectedChild) return;
    try {
      setHierarchyError("");
      await api.patch(`/cards/${selectedChild.id}`, { parent_id: card.id });
      setAddChildOpen(false);
      setSelectedChild(null);
      setChildSearch("");
      loadHierarchy();
    } catch (err: unknown) {
      setHierarchyError(err instanceof Error ? err.message : t("hierarchy.errors.addChild"));
    }
  };

  const handleRemoveChild = async (childId: string) => {
    await api.patch(`/cards/${childId}`, { parent_id: null });
    loadHierarchy();
  };

  // The link label is set on the CHILD of each edge, so the parent line patches
  // this card and a child row patches that child — the same asymmetry
  // `handleSetParent` and `handleAddChild` already encode. `onUpdate()` is
  // called only for this card's own label, because only then does the `card`
  // prop the rest of the page renders from go stale.
  const setLinkLabel = async (cardId: string, next: string | null) => {
    // Errors propagate to the popover, which shows them next to the control
    // the user is holding open — the section-level alert would be off-screen.
    await api.patch(`/cards/${cardId}`, { parent_label: next });
    loadHierarchy();
    if (cardId === card.id) onUpdate();
  };

  const handleQuickCreate = async () => {
    if (!createName.trim()) return;
    setCreateLoading(true);
    setHierarchyError("");
    try {
      const created = await api.post<{ id: string; name: string }>("/cards", {
        type: card.type,
        name: createName.trim(),
        ...(createMode === "child" ? { parent_id: card.id } : {}),
      });
      if (createMode === "parent") {
        // Set the newly created card as parent
        await api.patch(`/cards/${card.id}`, { parent_id: created.id });
        onUpdate();
      }
      setCreateMode(null);
      setCreateName("");
      loadHierarchy();
    } catch (err: unknown) {
      setHierarchyError(err instanceof Error ? err.message : t("hierarchy.errors.create"));
    } finally {
      setCreateLoading(false);
    }
  };

  if (!typeConfig?.has_hierarchy) return null;

  // No configured vocabulary ⇒ the whole affordance is absent and the section
  // renders exactly as it did before the feature existed.
  const linkLabels = typeConfig.hierarchy_labels ?? [];
  const showLinkLabels = linkLabels.length > 0;

  const level = hierarchy?.level ?? 1;
  const levelColor = LEVEL_COLORS[Math.min(level - 1, LEVEL_COLORS.length - 1)];

  return (
    <Accordion expanded={expanded} onChange={(_, v) => setExpanded(v)} disableGutters>
      <AccordionSummary expandIcon={<MaterialSymbol icon="expand_more" size={20} />}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1 }}>
          <MaterialSymbol icon="account_tree" size={20} />
          <Typography fontWeight={600}>{t("hierarchy.title")}</Typography>
          {hierarchy && (
            <Chip
              size="small"
              label={t("hierarchy.level", { level })}
              sx={{ ml: 1, height: 20, fontSize: "0.7rem", bgcolor: levelColor, color: "#fff" }}
            />
          )}
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        {hierarchyError && (
          <Alert severity="error" onClose={() => setHierarchyError("")} sx={{ mb: 2 }}>
            {hierarchyError}
          </Alert>
        )}
        {!hierarchy ? (
          <LinearProgress />
        ) : (
          <Box>
            {/* Ancestor breadcrumb trail */}
            {hierarchy.ancestors.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mb: 0.5, display: "block" }}>
                  {t("hierarchy.path")}
                </Typography>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
                  {hierarchy.ancestors.map((ancestor, i) => {
                    const ancestorLevel = i + 1;
                    const aColor = LEVEL_COLORS[Math.min(ancestorLevel - 1, LEVEL_COLORS.length - 1)];
                    return (
                      <Box key={ancestor.id} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                        <Chip
                          size="small"
                          label={ancestor.name}
                          onClick={() => navigate(`/cards/${ancestor.id}`)}
                          sx={{ cursor: "pointer", borderColor: aColor, color: aColor, fontWeight: 500 }}
                          variant="outlined"
                        />
                        <MaterialSymbol icon="chevron_right" size={16} />
                      </Box>
                    );
                  })}
                  <Chip
                    size="small"
                    label={card.name}
                    sx={{ bgcolor: levelColor, color: "#fff", fontWeight: 600 }}
                  />
                </Box>
              </Box>
            )}

            {/* Parent */}
            <Box sx={{ mb: 2 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                  {t("hierarchy.parent")}
                </Typography>
              </Box>
              {hierarchy.ancestors.length > 0 ? (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Chip
                    size="small"
                    label={hierarchy.ancestors[hierarchy.ancestors.length - 1].name}
                    onClick={() => navigate(`/cards/${hierarchy.ancestors[hierarchy.ancestors.length - 1].id}`)}
                    sx={{ cursor: "pointer" }}
                    icon={<MaterialSymbol icon={typeConfig?.icon || "category"} size={16} />}
                  />
                  {canEdit && (
                    <IconButton size="small" onClick={() => setPickingParent(true)} title={t("hierarchy.changeParent")}>
                      <MaterialSymbol icon="edit" size={16} />
                    </IconButton>
                  )}
                  {canEdit && (
                    <IconButton size="small" onClick={handleRemoveParent} title={t("hierarchy.removeParent")}>
                      <MaterialSymbol icon="link_off" size={16} color="#f44336" />
                    </IconButton>
                  )}
                  {/* This card's OWN label for the link above it — read from
                      `hierarchy.parent_label`, never from the last ancestor
                      node, whose label describes the edge one level higher. */}
                  {showLinkLabels && (
                    <HierarchyLinkLabel
                      value={hierarchy.parent_label}
                      options={linkLabels}
                      onChange={canEdit ? (next) => setLinkLabel(card.id, next) : undefined}
                      idPrefix="parent"
                    />
                  )}
                </Box>
              ) : (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Typography variant="body2" color="text.secondary">{t("hierarchy.noParent")}</Typography>
                  {canEdit && (
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<MaterialSymbol icon="add" size={16} />}
                      onClick={() => setPickingParent(true)}
                    >
                      {t("hierarchy.setParent")}
                    </Button>
                  )}
                </Box>
              )}
            </Box>

            {/* Parent picker dialog */}
            <Dialog open={pickingParent} onClose={() => { setPickingParent(false); setCreateMode(null); setHierarchyError(""); }} maxWidth="sm" fullWidth>
              <DialogTitle>{t("hierarchy.setParent")}</DialogTitle>
              <DialogContent>
                {hierarchyError && (
                  <Alert severity="error" onClose={() => setHierarchyError("")} sx={{ mb: 1, mt: 1 }}>
                    {hierarchyError}
                  </Alert>
                )}
                {!createMode ? (
                  <>
                    <CardPicker
                      types={card.type}
                      value={selectedParent}
                      onChange={setSelectedParent}
                      onInputChange={setParentSearch}
                      excludeIds={parentExcludeIds}
                      enabled={pickingParent}
                      fullWidth
                      sx={{ mt: 1 }}
                      label={t("hierarchy.search", { type: typeLabel(typeConfig) || card.type })}
                    />
                    {canCreateOwnType && (
                      <Button
                        size="small"
                        sx={{ mt: 1 }}
                        startIcon={<MaterialSymbol icon="add" size={16} />}
                        onClick={() => { setCreateMode("parent"); setCreateName(parentSearch); }}
                      >
                        {t("hierarchy.createNew", { type: typeLabel(typeConfig) || card.type })}
                      </Button>
                    )}
                  </>
                ) : (
                  <Box sx={{ mt: 1, p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1, bgcolor: "action.hover" }}>
                    <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                      {t("hierarchy.createAsParent", { type: typeLabel(typeConfig) || card.type })}
                    </Typography>
                    <TextField
                      fullWidth size="small" label={t("common:labels.name")} value={createName}
                      onChange={(e) => setCreateName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleQuickCreate()}
                      autoFocus sx={{ mb: 1 }}
                    />
                    <Box sx={{ display: "flex", gap: 1 }}>
                      <Button size="small" variant="contained" onClick={handleQuickCreate} disabled={!createName.trim() || createLoading}>
                        {t("hierarchy.createAndSetParent")}
                      </Button>
                      <Button size="small" onClick={() => setCreateMode(null)}>{t("hierarchy.backToSearch")}</Button>
                    </Box>
                  </Box>
                )}
              </DialogContent>
              <DialogActions>
                <Button onClick={() => { setPickingParent(false); setCreateMode(null); }}>{t("common:actions.cancel")}</Button>
                {!createMode && (
                  <Button variant="contained" onClick={handleSetParent} disabled={!selectedParent}>
                    {t("hierarchy.setParent")}
                  </Button>
                )}
              </DialogActions>
            </Dialog>

            {/* Children */}
            <Box>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                  {t("hierarchy.children")}
                </Typography>
                <Chip size="small" label={hierarchy.children.length} sx={{ height: 18, fontSize: "0.65rem" }} />
              </Box>
              {hierarchy.children.length > 0 ? (
                <List dense disablePadding>
                  {hierarchy.children.map((child) => (
                    <ListItem
                      key={child.id}
                      secondaryAction={
                        canEdit ? (
                          <IconButton size="small" onClick={() => handleRemoveChild(child.id)} title={t("hierarchy.removeChild")}>
                            <MaterialSymbol icon="link_off" size={16} />
                          </IconButton>
                        ) : undefined
                      }
                    >
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Box
                          component="div"
                          onClick={() => navigate(`/cards/${child.id}`)}
                          sx={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 1, "&:hover": { textDecoration: "underline" } }}
                        >
                          <MaterialSymbol icon={typeConfig?.icon || "category"} size={16} color={typeConfig?.color} />
                          <ListItemText primary={child.name} />
                        </Box>
                        {/* The child's own label — the edge from this card down
                            to it. Editing patches the CHILD, not this card. */}
                        {showLinkLabels && (
                          <HierarchyLinkLabel
                            value={child.parent_label}
                            options={linkLabels}
                            onChange={canEdit ? (next) => setLinkLabel(child.id, next) : undefined}
                            idPrefix={child.id}
                          />
                        )}
                      </Box>
                    </ListItem>
                  ))}
                </List>
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t("hierarchy.noChildren")}</Typography>
              )}
              {canEdit && (
                <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<MaterialSymbol icon="add" size={16} />}
                    onClick={() => setAddChildOpen(true)}
                  >
                    {t("hierarchy.addChild")}
                  </Button>
                </Box>
              )}
            </Box>

            {/* Add child dialog */}
            <Dialog open={addChildOpen} onClose={() => { setAddChildOpen(false); setCreateMode(null); setHierarchyError(""); }} maxWidth="sm" fullWidth>
              <DialogTitle>{t("hierarchy.addChild")}</DialogTitle>
              <DialogContent>
                {hierarchyError && (
                  <Alert severity="error" onClose={() => setHierarchyError("")} sx={{ mb: 1, mt: 1 }}>
                    {hierarchyError}
                  </Alert>
                )}
                {createMode !== "child" ? (
                  <>
                    <CardPicker
                      types={card.type}
                      value={selectedChild}
                      onChange={setSelectedChild}
                      onInputChange={setChildSearch}
                      excludeIds={childExcludeIds}
                      enabled={addChildOpen}
                      fullWidth
                      sx={{ mt: 1 }}
                      label={t("hierarchy.search", { type: typeLabel(typeConfig) || card.type })}
                    />
                    {canCreateOwnType && (
                      <Button
                        size="small"
                        sx={{ mt: 1 }}
                        startIcon={<MaterialSymbol icon="add" size={16} />}
                        onClick={() => { setCreateMode("child"); setCreateName(childSearch); }}
                      >
                        {t("hierarchy.createNew", { type: typeLabel(typeConfig) || card.type })}
                      </Button>
                    )}
                  </>
                ) : (
                  <Box sx={{ mt: 1, p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1, bgcolor: "action.hover" }}>
                    <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                      {t("hierarchy.createAsChild", { type: typeLabel(typeConfig) || card.type })}
                    </Typography>
                    <TextField
                      fullWidth size="small" label={t("common:labels.name")} value={createName}
                      onChange={(e) => setCreateName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleQuickCreate()}
                      autoFocus sx={{ mb: 1 }}
                    />
                    <Box sx={{ display: "flex", gap: 1 }}>
                      <Button size="small" variant="contained" onClick={handleQuickCreate} disabled={!createName.trim() || createLoading}>
                        {t("hierarchy.createAndAddChild")}
                      </Button>
                      <Button size="small" onClick={() => setCreateMode(null)}>{t("hierarchy.backToSearch")}</Button>
                    </Box>
                  </Box>
                )}
              </DialogContent>
              <DialogActions>
                <Button onClick={() => { setAddChildOpen(false); setCreateMode(null); }}>{t("common:actions.cancel")}</Button>
                {createMode !== "child" && (
                  <Button variant="contained" onClick={handleAddChild} disabled={!selectedChild}>
                    {t("hierarchy.addChild")}
                  </Button>
                )}
              </DialogActions>
            </Dialog>
          </Box>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

export default HierarchySection;
