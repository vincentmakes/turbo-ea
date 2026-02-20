import { useState, useEffect, useCallback } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import ColorPicker from "@/components/ColorPicker";
import KeyInput, { isValidKey } from "@/components/KeyInput";
import CalculationsAdmin from "@/features/admin/CalculationsAdmin";
import TagsAdmin from "@/features/admin/TagsAdmin";
import { useMetamodel } from "@/hooks/useMetamodel";
import { api } from "@/api/client";
import type {
  CardType as FSType,
  RelationType as RType,
} from "@/types";
import { TypeDetailDrawer, MetamodelGraph } from "./metamodel";
import { CATEGORIES, CARDINALITY_OPTIONS } from "./metamodel/constants";

/* ================================================================== */
/*  Main Component                                                     */
/* ================================================================== */

export default function MetamodelAdmin() {
  const { invalidateCache } = useMetamodel();

  const [tab, setTab] = useState(0);
  const [types, setTypes] = useState<FSType[]>([]);
  const [relationTypes, setRelationTypes] = useState<RType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHidden, setShowHidden] = useState(false);
  const [showHiddenRels, setShowHiddenRels] = useState(false);

  /* --- Drawer state --- */
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedTypeKey, setSelectedTypeKey] = useState<string | null>(null);

  /* --- Create type dialog --- */
  const [createTypeOpen, setCreateTypeOpen] = useState(false);
  const [newType, setNewType] = useState({
    key: "",
    label: "",
    icon: "category",
    color: "#1976d2",
    category: "Application & Data",
    has_hierarchy: false,
    description: "",
  });

  /* --- Create relation dialog --- */
  const [createRelOpen, setCreateRelOpen] = useState(false);
  const [newRel, setNewRel] = useState({
    key: "",
    label: "",
    reverse_label: "",
    source_type_key: "",
    target_type_key: "",
    cardinality: "1:n" as "1:1" | "1:n" | "n:m",
  });

  /* --- Edit relation dialog --- */
  const [editRelOpen, setEditRelOpen] = useState(false);
  const [editRel, setEditRel] = useState<RType | null>(null);

  /* --- Delete relation confirmation --- */
  const [deleteRelConfirm, setDeleteRelConfirm] = useState<{
    key: string;
    label: string;
    builtIn: boolean;
    instanceCount: number | null; // null = not yet fetched
  } | null>(null);

  /* ---- Data fetching ---- */
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [t, r] = await Promise.all([
        api.get<FSType[]>("/metamodel/types?include_hidden=true"),
        api.get<RType[]>("/metamodel/relation-types?include_hidden=true"),
      ]);
      setTypes(t);
      setRelationTypes(r);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const refresh = useCallback(() => {
    invalidateCache();
    fetchData();
  }, [invalidateCache, fetchData]);

  /* ---- Derived ---- */
  const displayTypes = showHidden
    ? types
    : types.filter((t) => !t.is_hidden);

  const displayRelationTypes = showHiddenRels
    ? relationTypes
    : relationTypes.filter((r) => !r.is_hidden);

  const autoRelKey =
    newRel.source_type_key && newRel.target_type_key
      ? `${newRel.source_type_key}_to_${newRel.target_type_key}`
      : "";

  /* ---- Handlers ---- */
  const handleCreateType = async () => {
    await api.post("/metamodel/types", {
      ...newType,
      fields_schema: [],
      built_in: false,
    });
    refresh();
    setCreateTypeOpen(false);
    setNewType({
      key: "",
      label: "",
      icon: "category",
      color: "#1976d2",
      category: "Application & Data",
      has_hierarchy: false,
      description: "",
    });
  };

  const handleCreateRelation = async () => {
    const finalKey = newRel.key || autoRelKey;
    await api.post("/metamodel/relation-types", {
      ...newRel,
      key: finalKey,
      attributes_schema: [],
      built_in: false,
    });
    refresh();
    setCreateRelOpen(false);
    setNewRel({
      key: "",
      label: "",
      reverse_label: "",
      source_type_key: "",
      target_type_key: "",
      cardinality: "1:n",
    });
  };

  const handleUpdateRelation = async () => {
    if (!editRel) return;
    await api.patch(`/metamodel/relation-types/${editRel.key}`, {
      label: editRel.label,
      reverse_label: editRel.reverse_label,
      cardinality: editRel.cardinality,
    });
    refresh();
    setEditRelOpen(false);
    setEditRel(null);
  };

  const promptDeleteRelation = (rt: RType) => {
    setDeleteRelConfirm({
      key: rt.key,
      label: `${resolveType(rt.source_type_key)?.label ?? rt.source_type_key} → ${resolveType(rt.target_type_key)?.label ?? rt.target_type_key}`,
      builtIn: rt.built_in,
      instanceCount: null,
    });
    // Fetch instance count for the warning message
    api
      .get<{ instance_count: number }>(`/metamodel/relation-types/${rt.key}/instance-count`)
      .then((resp) => {
        setDeleteRelConfirm((prev) =>
          prev ? { ...prev, instanceCount: resp.instance_count } : null
        );
      })
      .catch(() => {
        setDeleteRelConfirm((prev) =>
          prev ? { ...prev, instanceCount: 0 } : null
        );
      });
  };

  const confirmDeleteRelation = async () => {
    if (!deleteRelConfirm) return;
    try {
      const resp = await api.delete<{ status?: string }>(
        `/metamodel/relation-types/${deleteRelConfirm.key}?force=true`
      );
      if (resp?.status === "hidden") {
        setShowHiddenRels(true);
      }
      refresh();
      setDeleteRelConfirm(null);
    } catch {
      // Shouldn't fail with force=true, but just in case
    }
  };

  const handleRestoreRelation = async (key: string) => {
    await api.post(`/metamodel/relation-types/${key}/restore`);
    refresh();
  };

  const openCreateRelation = (preselectedTypeKey?: string) => {
    setNewRel({
      key: "",
      label: "",
      reverse_label: "",
      source_type_key: preselectedTypeKey || "",
      target_type_key: "",
      cardinality: "1:n",
    });
    setCreateRelOpen(true);
  };

  const handleNodeClick = useCallback((key: string) => {
    setSelectedTypeKey(key);
    setDrawerOpen(true);
  }, []);

  const resolveType = (key: string) => types.find((t) => t.key === key);

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  return (
    <Box>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>
        Metamodel Configuration
      </Typography>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
        <Tab label="Card Types" />
        <Tab label="Relation Types" />
        <Tab label="Calculations" />
        <Tab label="Tags" />
        <Tab label="Metamodel Graph" />
      </Tabs>

      {/* ============================================================ */}
      {/*  TAB 0 -- Card Types                                   */}
      {/* ============================================================ */}
      {tab === 0 && (
        <Box>
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              mb: 2,
            }}
          >
            <FormControlLabel
              control={
                <Switch
                  checked={showHidden}
                  onChange={(e) => setShowHidden(e.target.checked)}
                />
              }
              label="Show hidden types"
            />
            <Button
              variant="contained"
              startIcon={<MaterialSymbol icon="add" size={18} />}
              onClick={() => setCreateTypeOpen(true)}
            >
              New Type
            </Button>
          </Box>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 2,
            }}
          >
            {displayTypes.map((t) => {
              const fieldCount = t.fields_schema.reduce(
                (sum, s) => sum + s.fields.length,
                0,
              );
              const subtypeCount = (t.subtypes || []).length;
              const relCount = relationTypes.filter(
                (r) =>
                  r.source_type_key === t.key ||
                  r.target_type_key === t.key,
              ).length;

              return (
                <Card
                  key={t.key}
                  sx={{
                    cursor: "pointer",
                    transition: "box-shadow 0.2s, transform 0.15s",
                    "&:hover": { boxShadow: 6, transform: "translateY(-2px)" },
                    opacity: t.is_hidden ? 0.55 : 1,
                  }}
                  onClick={() => {
                    setSelectedTypeKey(t.key);
                    setDrawerOpen(true);
                  }}
                >
                  <CardContent>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1.5,
                        mb: 1,
                      }}
                    >
                      <Box
                        sx={{
                          width: 40,
                          height: 40,
                          borderRadius: "50%",
                          bgcolor: t.color,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <MaterialSymbol
                          icon={t.icon}
                          size={22}
                          color="#fff"
                        />
                      </Box>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography fontWeight={600} noWrap>
                          {t.label}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          noWrap
                        >
                          {t.category || "Uncategorized"}
                        </Typography>
                      </Box>
                      <Tooltip title={t.is_hidden ? "Unhide" : "Hide"}>
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            api
                              .patch(`/metamodel/types/${t.key}`, { is_hidden: !t.is_hidden })
                              .then(refresh);
                          }}
                        >
                          <MaterialSymbol
                            icon={t.is_hidden ? "visibility_off" : "visibility"}
                            size={18}
                            color={t.is_hidden ? "#f57c00" : "#bbb"}
                          />
                        </IconButton>
                      </Tooltip>
                    </Box>

                    <Box
                      sx={{
                        display: "flex",
                        gap: 0.5,
                        flexWrap: "wrap",
                        mb: 1,
                      }}
                    >
                      {t.has_hierarchy && (
                        <Chip
                          size="small"
                          label="Hierarchy"
                          variant="outlined"
                          sx={{ height: 22, fontSize: 11 }}
                        />
                      )}
                      {t.built_in && (
                        <Chip
                          size="small"
                          label="Built-in"
                          color="info"
                          sx={{ height: 22, fontSize: 11 }}
                        />
                      )}
                      {t.is_hidden && (
                        <Chip
                          size="small"
                          label="Hidden"
                          sx={{ height: 22, fontSize: 11 }}
                        />
                      )}
                    </Box>

                    <Box sx={{ display: "flex", gap: 2 }}>
                      <Typography variant="caption" color="text.secondary">
                        {fieldCount} field{fieldCount !== 1 ? "s" : ""}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {subtypeCount} subtype{subtypeCount !== 1 ? "s" : ""}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {relCount} relation{relCount !== 1 ? "s" : ""}
                      </Typography>
                    </Box>
                  </CardContent>
                </Card>
              );
            })}
          </Box>

          {displayTypes.length === 0 && !loading && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mt: 2, textAlign: "center" }}
            >
              No card types found.
            </Typography>
          )}
        </Box>
      )}

      {/* ============================================================ */}
      {/*  TAB 1 -- Relation Types                                     */}
      {/* ============================================================ */}
      {tab === 1 && (
        <Box>
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              mb: 2,
            }}
          >
            <FormControlLabel
              control={
                <Switch
                  checked={showHiddenRels}
                  onChange={(e) => setShowHiddenRels(e.target.checked)}
                />
              }
              label="Show hidden relations"
            />
            <Button
              variant="contained"
              startIcon={<MaterialSymbol icon="add" size={18} />}
              onClick={() => openCreateRelation()}
            >
              New Relation
            </Button>
          </Box>

          {displayRelationTypes.map((rt) => {
            const srcType = resolveType(rt.source_type_key);
            const tgtType = resolveType(rt.target_type_key);
            return (
              <Card key={rt.key} sx={{ mb: 1, opacity: rt.is_hidden ? 0.5 : 1 }}>
                <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1.5,
                      flexWrap: "wrap",
                    }}
                  >
                    {/* Source type */}
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0.5,
                      }}
                    >
                      {srcType && (
                        <>
                          <Box
                            sx={{
                              width: 12,
                              height: 12,
                              borderRadius: "50%",
                              bgcolor: srcType.color,
                              flexShrink: 0,
                            }}
                          />
                          <MaterialSymbol
                            icon={srcType.icon}
                            size={16}
                            color={srcType.color}
                          />
                        </>
                      )}
                      <Typography variant="body2" fontWeight={500}>
                        {srcType?.label || rt.source_type_key}
                      </Typography>
                    </Box>

                    <MaterialSymbol
                      icon="arrow_forward"
                      size={16}
                      color="#bbb"
                    />

                    {/* Verb */}
                    <Typography
                      variant="body2"
                      fontWeight={600}
                      color="primary.main"
                    >
                      {rt.label}
                    </Typography>

                    <MaterialSymbol
                      icon="arrow_forward"
                      size={16}
                      color="#bbb"
                    />

                    {/* Target type */}
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0.5,
                      }}
                    >
                      {tgtType && (
                        <>
                          <Box
                            sx={{
                              width: 12,
                              height: 12,
                              borderRadius: "50%",
                              bgcolor: tgtType.color,
                              flexShrink: 0,
                            }}
                          />
                          <MaterialSymbol
                            icon={tgtType.icon}
                            size={16}
                            color={tgtType.color}
                          />
                        </>
                      )}
                      <Typography variant="body2" fontWeight={500}>
                        {tgtType?.label || rt.target_type_key}
                      </Typography>
                    </Box>

                    <Box sx={{ flex: 1 }} />

                    <Chip
                      size="small"
                      label={rt.cardinality}
                      variant="outlined"
                      sx={{ height: 22, fontSize: 11 }}
                    />
                    {rt.built_in && (
                      <Chip
                        size="small"
                        label="Built-in"
                        color="info"
                        sx={{ height: 22, fontSize: 11 }}
                      />
                    )}
                    {rt.is_hidden && (
                      <Chip
                        size="small"
                        label="Hidden"
                        color="warning"
                        sx={{ height: 22, fontSize: 11 }}
                      />
                    )}

                    {rt.is_hidden ? (
                      <Tooltip title="Restore">
                        <IconButton
                          size="small"
                          onClick={() => handleRestoreRelation(rt.key)}
                        >
                          <MaterialSymbol icon="restore" size={18} />
                        </IconButton>
                      </Tooltip>
                    ) : (
                      <>
                        <Tooltip title="Edit">
                          <IconButton
                            size="small"
                            onClick={() => {
                              setEditRel({ ...rt });
                              setEditRelOpen(true);
                            }}
                          >
                            <MaterialSymbol icon="edit" size={18} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton
                            size="small"
                            onClick={() => promptDeleteRelation(rt)}
                          >
                            <MaterialSymbol icon="delete" size={18} />
                          </IconButton>
                        </Tooltip>
                      </>
                    )}
                  </Box>
                </CardContent>
              </Card>
            );
          })}

          {relationTypes.length === 0 && !loading && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ textAlign: "center", mt: 2 }}
            >
              No relation types defined yet.
            </Typography>
          )}
        </Box>
      )}

      {/* ============================================================ */}
      {/*  TAB 2 -- Calculations                                       */}
      {/* ============================================================ */}
      {tab === 2 && <CalculationsAdmin />}

      {/* ============================================================ */}
      {/*  TAB 3 -- Tags                                               */}
      {/* ============================================================ */}
      {tab === 3 && <TagsAdmin />}

      {/* ============================================================ */}
      {/*  TAB 4 -- Metamodel Graph                                    */}
      {/* ============================================================ */}
      {tab === 4 && (
        <MetamodelGraph
          types={types}
          relationTypes={relationTypes}
          onNodeClick={handleNodeClick}
        />
      )}

      {/* ============================================================ */}
      {/*  Type Detail Dialog                                          */}
      {/* ============================================================ */}
      <TypeDetailDrawer
        open={drawerOpen}
        typeKey={selectedTypeKey}
        types={types}
        relationTypes={relationTypes}
        onClose={() => setDrawerOpen(false)}
        onRefresh={refresh}
        onCreateRelation={(preKey) => openCreateRelation(preKey)}
      />

      {/* ============================================================ */}
      {/*  Create Type Dialog                                          */}
      {/* ============================================================ */}
      <Dialog
        open={createTypeOpen}
        onClose={() => setCreateTypeOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Create Card Type</DialogTitle>
        <DialogContent>
          <KeyInput
            fullWidth
            label="Key (e.g. my_custom_type)"
            value={newType.key}
            onChange={(v) => setNewType({ ...newType, key: v })}
            sx={{ mt: 1, mb: 2 }}
            size="small"
          />
          <TextField
            fullWidth
            label="Label"
            value={newType.label}
            onChange={(e) => setNewType({ ...newType, label: e.target.value })}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            label="Description"
            value={newType.description}
            onChange={(e) =>
              setNewType({ ...newType, description: e.target.value })
            }
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            label="Icon (Material Symbol name)"
            value={newType.icon}
            onChange={(e) => setNewType({ ...newType, icon: e.target.value })}
            sx={{ mb: 2 }}
          />
          <Box sx={{ mb: 2 }}>
            <ColorPicker
              value={newType.color}
              onChange={(c) => setNewType({ ...newType, color: c })}
              label="Color"
            />
          </Box>
          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel>Category</InputLabel>
            <Select
              value={newType.category}
              label="Category"
              onChange={(e) =>
                setNewType({ ...newType, category: e.target.value })
              }
            >
              {CATEGORIES.map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControlLabel
            control={
              <Switch
                checked={newType.has_hierarchy}
                onChange={(e) =>
                  setNewType({ ...newType, has_hierarchy: e.target.checked })
                }
              />
            }
            label="Supports Hierarchy (Parent / Child)"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateTypeOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreateType}
            disabled={!newType.key || !newType.label || !isValidKey(newType.key)}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* ============================================================ */}
      {/*  Create Relation Dialog                                      */}
      {/* ============================================================ */}
      <Dialog
        open={createRelOpen}
        onClose={() => setCreateRelOpen(false)}
        maxWidth="sm"
        fullWidth
        disableRestoreFocus
      >
        <DialogTitle>Create Relation Type</DialogTitle>
        <DialogContent>
          <FormControl fullWidth sx={{ mt: 1, mb: 2 }}>
            <InputLabel>Source Type</InputLabel>
            <Select
              value={newRel.source_type_key}
              label="Source Type"
              onChange={(e) => {
                const src = e.target.value;
                setNewRel({
                  ...newRel,
                  source_type_key: src,
                  key:
                    src && newRel.target_type_key
                      ? `${src}_to_${newRel.target_type_key}`
                      : newRel.key,
                });
              }}
            >
              {types.map((t) => (
                <MenuItem key={t.key} value={t.key}>
                  <Box
                    sx={{ display: "flex", alignItems: "center", gap: 1 }}
                  >
                    <Box
                      sx={{
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        bgcolor: t.color,
                      }}
                    />
                    <MaterialSymbol icon={t.icon} size={16} color={t.color} />
                    {t.label}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel>Target Type</InputLabel>
            <Select
              value={newRel.target_type_key}
              label="Target Type"
              onChange={(e) => {
                const tgt = e.target.value;
                setNewRel({
                  ...newRel,
                  target_type_key: tgt,
                  key:
                    newRel.source_type_key && tgt
                      ? `${newRel.source_type_key}_to_${tgt}`
                      : newRel.key,
                });
              }}
            >
              {types.map((t) => (
                <MenuItem key={t.key} value={t.key}>
                  <Box
                    sx={{ display: "flex", alignItems: "center", gap: 1 }}
                  >
                    <Box
                      sx={{
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        bgcolor: t.color,
                      }}
                    />
                    <MaterialSymbol icon={t.icon} size={16} color={t.color} />
                    {t.label}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <KeyInput
            fullWidth
            label="Key"
            value={newRel.key || autoRelKey}
            onChange={(v) => setNewRel({ ...newRel, key: v })}
            sx={{ mb: 2 }}
            size="small"
          />
          <TextField
            fullWidth
            label='Label (verb, e.g., "uses")'
            value={newRel.label}
            onChange={(e) => setNewRel({ ...newRel, label: e.target.value })}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            label='Reverse Label (e.g., "is used by")'
            value={newRel.reverse_label}
            onChange={(e) =>
              setNewRel({ ...newRel, reverse_label: e.target.value })
            }
            sx={{ mb: 2 }}
          />
          <FormControl fullWidth>
            <InputLabel>Cardinality</InputLabel>
            <Select
              value={newRel.cardinality}
              label="Cardinality"
              onChange={(e) =>
                setNewRel({
                  ...newRel,
                  cardinality: e.target.value as "1:1" | "1:n" | "n:m",
                })
              }
            >
              {CARDINALITY_OPTIONS.map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateRelOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreateRelation}
            disabled={
              !newRel.source_type_key ||
              !newRel.target_type_key ||
              !(newRel.key || autoRelKey) ||
              !newRel.label ||
              !isValidKey(newRel.key || autoRelKey)
            }
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* ============================================================ */}
      {/*  Edit Relation Dialog                                        */}
      {/* ============================================================ */}
      <Dialog
        open={editRelOpen}
        onClose={() => setEditRelOpen(false)}
        maxWidth="sm"
        fullWidth
        disableRestoreFocus
      >
        <DialogTitle>Edit Relation Type</DialogTitle>
        {editRel && (
          <>
            <DialogContent>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  mb: 2,
                  mt: 1,
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  {resolveType(editRel.source_type_key)?.label ||
                    editRel.source_type_key}
                </Typography>
                <MaterialSymbol
                  icon="arrow_forward"
                  size={16}
                  color="#bbb"
                />
                <Typography variant="body2" color="text.secondary">
                  {resolveType(editRel.target_type_key)?.label ||
                    editRel.target_type_key}
                </Typography>
              </Box>
              <TextField
                fullWidth
                label="Label"
                value={editRel.label}
                onChange={(e) =>
                  setEditRel({ ...editRel, label: e.target.value })
                }
                sx={{ mb: 2 }}
              />
              <TextField
                fullWidth
                label="Reverse Label"
                value={editRel.reverse_label || ""}
                onChange={(e) =>
                  setEditRel({
                    ...editRel,
                    reverse_label: e.target.value,
                  })
                }
                sx={{ mb: 2 }}
              />
              <FormControl fullWidth>
                <InputLabel>Cardinality</InputLabel>
                <Select
                  value={editRel.cardinality}
                  label="Cardinality"
                  onChange={(e) =>
                    setEditRel({
                      ...editRel,
                      cardinality: e.target.value as "1:1" | "1:n" | "n:m",
                    })
                  }
                >
                  {CARDINALITY_OPTIONS.map((c) => (
                    <MenuItem key={c} value={c}>
                      {c}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setEditRelOpen(false)}>Cancel</Button>
              <Button variant="contained" onClick={handleUpdateRelation}>
                Save
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      {/* ============================================================ */}
      {/*  Delete Relation Confirmation Dialog                          */}
      {/* ============================================================ */}
      <Dialog
        open={!!deleteRelConfirm}
        onClose={() => setDeleteRelConfirm(null)}
        maxWidth="xs"
        fullWidth
        disableRestoreFocus
      >
        <DialogTitle>Delete Relation Type?</DialogTitle>
        <DialogContent>
          {deleteRelConfirm && (
            <>
              <Typography variant="body2" sx={{ mt: 1, mb: 1 }}>
                <strong>{deleteRelConfirm.label}</strong>
              </Typography>
              {deleteRelConfirm.instanceCount === null ? (
                <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : deleteRelConfirm.instanceCount > 0 ? (
                <Alert severity="warning">
                  This relation type has{" "}
                  <strong>{deleteRelConfirm.instanceCount}</strong> relation
                  instance(s) linking cards together. Deleting it will
                  permanently remove all of them.
                </Alert>
              ) : deleteRelConfirm.builtIn ? (
                <Alert severity="info">
                  This built-in relation type will be hidden and can be
                  restored later.
                </Alert>
              ) : (
                <Alert severity="info">
                  This relation type has no instances and will be permanently
                  deleted.
                </Alert>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteRelConfirm(null)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            disabled={deleteRelConfirm?.instanceCount === null}
            onClick={confirmDeleteRelation}
          >
            {deleteRelConfirm?.builtIn && deleteRelConfirm.instanceCount === 0
              ? "Hide"
              : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
