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
import MaterialSymbol from "@/components/MaterialSymbol";
import CardPicker, { type CardOption } from "@/components/CardPicker";
import OptionChip, { chipWidthForField } from "@/components/OptionChip";
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
function HierarchyLinkLabel({
  value,
  options,
  onChange,
  emptyLabel,
}: {
  value: string | null | undefined;
  options: FieldOption[];
  onChange?: (next: string | null) => void;
  emptyLabel: string;
}) {
  const optLabel = useOptionLabel();
  const option = options.find((o) => o.key === value);
  // A value already set stays offered even if the option is now hidden, so
  // editing a card never silently rewrites its label.
  const selectable = options.filter((o) => !o.hidden || o.key === value);

  if (!onChange) {
    if (!value) return null;
    return <OptionChip option={option} value={value} label={option ? optLabel(option) : undefined} />;
  }

  return (
    <Select
      size="small"
      value={option || !value ? (value ?? "") : value}
      displayEmpty
      onChange={(e) => onChange((e.target.value as string) || null)}
      renderValue={(v) =>
        v ? (
          <OptionChip option={option} value={v as string} label={option ? optLabel(option) : undefined} />
        ) : (
          <Typography variant="body2" color="text.secondary">
            {emptyLabel}
          </Typography>
        )
      }
      sx={{
        minWidth: chipWidthForField(options),
        "& .MuiSelect-select": { py: 0.25 },
      }}
    >
      <MenuItem value="">
        <Typography variant="body2" color="text.secondary">
          {emptyLabel}
        </Typography>
      </MenuItem>
      {selectable.map((o) => (
        <MenuItem key={o.key} value={o.key}>
          <OptionChip option={o} label={optLabel(o)} />
        </MenuItem>
      ))}
    </Select>
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
    try {
      setHierarchyError("");
      await api.patch(`/cards/${cardId}`, { parent_label: next });
      loadHierarchy();
      if (cardId === card.id) onUpdate();
    } catch (err: unknown) {
      setHierarchyError(err instanceof Error ? err.message : t("hierarchy.errors.setLinkLabel"));
    }
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
                      emptyLabel={t("hierarchy.noLinkLabel")}
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
                            emptyLabel={t("hierarchy.noLinkLabel")}
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
