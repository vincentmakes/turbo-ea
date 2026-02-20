import { useState, useEffect, useCallback } from "react";
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
import Autocomplete from "@mui/material/Autocomplete";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useMetamodel } from "@/hooks/useMetamodel";
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
  const navigate = useNavigate();
  const { getType } = useMetamodel();
  const typeConfig = getType(card.type);
  const [hierarchy, setHierarchy] = useState<HierarchyData | null>(null);

  // Parent picker state
  const [pickingParent, setPickingParent] = useState(false);
  const [parentSearch, setParentSearch] = useState("");
  const [parentOptions, setParentOptions] = useState<{ id: string; name: string }[]>([]);
  const [selectedParent, setSelectedParent] = useState<{ id: string; name: string } | null>(null);

  // Add child state
  const [addChildOpen, setAddChildOpen] = useState(false);
  const [childSearch, setChildSearch] = useState("");
  const [childOptions, setChildOptions] = useState<{ id: string; name: string }[]>([]);
  const [selectedChild, setSelectedChild] = useState<{ id: string; name: string } | null>(null);

  // Inline create state
  const [createMode, setCreateMode] = useState<"parent" | "child" | null>(null);
  const [createName, setCreateName] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [hierarchyError, setHierarchyError] = useState("");

  const loadHierarchy = useCallback(() => {
    api.get<HierarchyData>(`/cards/${card.id}/hierarchy`).then(setHierarchy).catch(() => {});
  }, [card.id]);

  useEffect(loadHierarchy, [loadHierarchy]);

  // Search parents (same type, exclude self and descendants)
  useEffect(() => {
    if (!pickingParent || parentSearch.length < 1) { setParentOptions([]); return; }
    const timer = setTimeout(() => {
      api
        .get<{ items: { id: string; name: string }[] }>(
          `/cards?type=${card.type}&search=${encodeURIComponent(parentSearch)}&page_size=20`
        )
        .then((res) => {
          const childIds = new Set(hierarchy?.children.map((c) => c.id) || []);
          setParentOptions(res.items.filter((item) => item.id !== card.id && !childIds.has(item.id)));
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [pickingParent, parentSearch, card.id, card.type, hierarchy]);

  // Search children (same type, exclude self)
  useEffect(() => {
    if (!addChildOpen || childSearch.length < 1) { setChildOptions([]); return; }
    const timer = setTimeout(() => {
      api
        .get<{ items: { id: string; name: string }[] }>(
          `/cards?type=${card.type}&search=${encodeURIComponent(childSearch)}&page_size=20`
        )
        .then((res) => {
          const ancestorIds = new Set(hierarchy?.ancestors.map((a) => a.id) || []);
          setChildOptions(res.items.filter((item) => item.id !== card.id && !ancestorIds.has(item.id)));
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [addChildOpen, childSearch, card.id, card.type, hierarchy]);

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
      setHierarchyError(err instanceof Error ? err.message : "Failed to set parent");
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
      setHierarchyError(err instanceof Error ? err.message : "Failed to add child");
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
      setHierarchyError(err instanceof Error ? err.message : "Failed to create");
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
          <MaterialSymbol icon="account_tree" size={20} color="#666" />
          <Typography fontWeight={600}>Hierarchy</Typography>
          {hierarchy && (
            <Chip
              size="small"
              label={`Level ${level}`}
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
                  Path
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
                        <MaterialSymbol icon="chevron_right" size={16} color="#bbb" />
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
                  Parent
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
                    <IconButton size="small" onClick={() => setPickingParent(true)} title="Change parent">
                      <MaterialSymbol icon="edit" size={16} />
                    </IconButton>
                  )}
                  {canEdit && (
                    <IconButton size="small" onClick={handleRemoveParent} title="Remove parent">
                      <MaterialSymbol icon="link_off" size={16} color="#f44336" />
                    </IconButton>
                  )}
                </Box>
              ) : (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Typography variant="body2" color="text.secondary">No parent</Typography>
                  {canEdit && (
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<MaterialSymbol icon="add" size={16} />}
                      onClick={() => setPickingParent(true)}
                    >
                      Set Parent
                    </Button>
                  )}
                </Box>
              )}
            </Box>

            {/* Parent picker dialog */}
            <Dialog open={pickingParent} onClose={() => { setPickingParent(false); setCreateMode(null); setHierarchyError(""); }} maxWidth="sm" fullWidth>
              <DialogTitle>Set Parent</DialogTitle>
              <DialogContent>
                {hierarchyError && (
                  <Alert severity="error" onClose={() => setHierarchyError("")} sx={{ mb: 1, mt: 1 }}>
                    {hierarchyError}
                  </Alert>
                )}
                {!createMode ? (
                  <>
                    <Autocomplete
                      options={parentOptions}
                      getOptionLabel={(opt) => opt.name}
                      value={selectedParent}
                      onChange={(_, val) => setSelectedParent(val)}
                      inputValue={parentSearch}
                      onInputChange={(_, val) => setParentSearch(val)}
                      renderInput={(params) => (
                        <TextField {...params} size="small" label={`Search ${typeConfig?.label || card.type}`} placeholder="Type to search..." sx={{ mt: 1 }} />
                      )}
                      noOptionsText={parentSearch ? "No results found" : "Type to search..."}
                      filterOptions={(x) => x}
                    />
                    <Button
                      size="small"
                      sx={{ mt: 1 }}
                      startIcon={<MaterialSymbol icon="add" size={16} />}
                      onClick={() => { setCreateMode("parent"); setCreateName(parentSearch); }}
                    >
                      Create new {typeConfig?.label || card.type}
                    </Button>
                  </>
                ) : (
                  <Box sx={{ mt: 1, p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1, bgcolor: "action.hover" }}>
                    <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                      Create new {typeConfig?.label || card.type} as parent
                    </Typography>
                    <TextField
                      fullWidth size="small" label="Name" value={createName}
                      onChange={(e) => setCreateName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleQuickCreate()}
                      autoFocus sx={{ mb: 1 }}
                    />
                    <Box sx={{ display: "flex", gap: 1 }}>
                      <Button size="small" variant="contained" onClick={handleQuickCreate} disabled={!createName.trim() || createLoading}>
                        Create & Set as Parent
                      </Button>
                      <Button size="small" onClick={() => setCreateMode(null)}>Back to search</Button>
                    </Box>
                  </Box>
                )}
              </DialogContent>
              <DialogActions>
                <Button onClick={() => { setPickingParent(false); setCreateMode(null); }}>Cancel</Button>
                {!createMode && (
                  <Button variant="contained" onClick={handleSetParent} disabled={!selectedParent}>
                    Set Parent
                  </Button>
                )}
              </DialogActions>
            </Dialog>

            {/* Children */}
            <Box>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                  Children
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
                          <IconButton size="small" onClick={() => handleRemoveChild(child.id)} title="Remove from hierarchy">
                            <MaterialSymbol icon="link_off" size={16} color="#999" />
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
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>No children</Typography>
              )}
              {canEdit && (
                <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<MaterialSymbol icon="add" size={16} />}
                    onClick={() => setAddChildOpen(true)}
                  >
                    Add Child
                  </Button>
                </Box>
              )}
            </Box>

            {/* Add child dialog */}
            <Dialog open={addChildOpen} onClose={() => { setAddChildOpen(false); setCreateMode(null); setHierarchyError(""); }} maxWidth="sm" fullWidth>
              <DialogTitle>Add Child</DialogTitle>
              <DialogContent>
                {hierarchyError && (
                  <Alert severity="error" onClose={() => setHierarchyError("")} sx={{ mb: 1, mt: 1 }}>
                    {hierarchyError}
                  </Alert>
                )}
                {createMode !== "child" ? (
                  <>
                    <Autocomplete
                      options={childOptions}
                      getOptionLabel={(opt) => opt.name}
                      value={selectedChild}
                      onChange={(_, val) => setSelectedChild(val)}
                      inputValue={childSearch}
                      onInputChange={(_, val) => setChildSearch(val)}
                      renderInput={(params) => (
                        <TextField {...params} size="small" label={`Search ${typeConfig?.label || card.type}`} placeholder="Type to search..." sx={{ mt: 1 }} />
                      )}
                      noOptionsText={childSearch ? "No results found" : "Type to search..."}
                      filterOptions={(x) => x}
                    />
                    <Button
                      size="small"
                      sx={{ mt: 1 }}
                      startIcon={<MaterialSymbol icon="add" size={16} />}
                      onClick={() => { setCreateMode("child"); setCreateName(childSearch); }}
                    >
                      Create new {typeConfig?.label || card.type}
                    </Button>
                  </>
                ) : (
                  <Box sx={{ mt: 1, p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1, bgcolor: "action.hover" }}>
                    <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                      Create new {typeConfig?.label || card.type} as child
                    </Typography>
                    <TextField
                      fullWidth size="small" label="Name" value={createName}
                      onChange={(e) => setCreateName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleQuickCreate()}
                      autoFocus sx={{ mb: 1 }}
                    />
                    <Box sx={{ display: "flex", gap: 1 }}>
                      <Button size="small" variant="contained" onClick={handleQuickCreate} disabled={!createName.trim() || createLoading}>
                        Create & Add as Child
                      </Button>
                      <Button size="small" onClick={() => setCreateMode(null)}>Back to search</Button>
                    </Box>
                  </Box>
                )}
              </DialogContent>
              <DialogActions>
                <Button onClick={() => { setAddChildOpen(false); setCreateMode(null); }}>Cancel</Button>
                {createMode !== "child" && (
                  <Button variant="contained" onClick={handleAddChild} disabled={!selectedChild}>
                    Add Child
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
