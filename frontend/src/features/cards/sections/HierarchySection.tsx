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
import MaterialSymbol from "@/components/MaterialSymbol";
import CardPicker, { type CardOption } from "@/components/CardPicker";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useTypeLabel } from "@/hooks/useResolveLabel";
import { api } from "@/api/client";
import type { Card, HierarchyData } from "@/types";

// ── Section: Hierarchy ───────────────────────────────────────────
const LEVEL_COLORS = ["#1565c0", "#42a5f5", "#90caf9", "#bbdefb", "#e3f2fd"];

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

  const level = hierarchy?.level ?? 1;
  const levelColor = LEVEL_COLORS[Math.min(level - 1, LEVEL_COLORS.length - 1)];

  return (
    <Accordion defaultExpanded={initialExpanded} disableGutters>
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
                    <Button
                      size="small"
                      sx={{ mt: 1 }}
                      startIcon={<MaterialSymbol icon="add" size={16} />}
                      onClick={() => { setCreateMode("parent"); setCreateName(parentSearch); }}
                    >
                      {t("hierarchy.createNew", { type: typeLabel(typeConfig) || card.type })}
                    </Button>
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
                      <Box
                        component="div"
                        onClick={() => navigate(`/cards/${child.id}`)}
                        sx={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 1, "&:hover": { textDecoration: "underline" } }}
                      >
                        <MaterialSymbol icon={typeConfig?.icon || "category"} size={16} color={typeConfig?.color} />
                        <ListItemText primary={child.name} />
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
                    <Button
                      size="small"
                      sx={{ mt: 1 }}
                      startIcon={<MaterialSymbol icon="add" size={16} />}
                      onClick={() => { setCreateMode("child"); setCreateName(childSearch); }}
                    >
                      {t("hierarchy.createNew", { type: typeLabel(typeConfig) || card.type })}
                    </Button>
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
