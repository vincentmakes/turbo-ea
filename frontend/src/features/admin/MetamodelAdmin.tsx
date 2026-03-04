import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
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
import IconPicker from "@/components/IconPicker";
import KeyInput, { isValidKey } from "@/components/KeyInput";
import CalculationsAdmin from "@/features/admin/CalculationsAdmin";
import PrinciplesAdmin from "@/features/admin/PrinciplesAdmin";
import TagsAdmin from "@/features/admin/TagsAdmin";
import { useMetamodel } from "@/hooks/useMetamodel";
import { api } from "@/api/client";
import type {
  CardType as FSType,
  RelationType as RType,
  MetamodelTranslations,
  TranslationMap,
} from "@/types";
import { TypeDetailDrawer, MetamodelGraph } from "./metamodel";
import { CATEGORIES, CARDINALITY_OPTIONS } from "./metamodel/constants";

/** Remove empty-string entries from a TranslationMap. Returns undefined if all empty. */
function cleanTranslationMap(map: TranslationMap | undefined): TranslationMap | undefined {
  if (!map) return undefined;
  const cleaned: TranslationMap = {};
  for (const [k, v] of Object.entries(map)) {
    if (v && v.trim()) cleaned[k] = v.trim();
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

/** Clean a MetamodelTranslations object, removing empty maps. */
function cleanTranslations(
  trans: MetamodelTranslations | undefined,
): MetamodelTranslations | undefined {
  if (!trans) return undefined;
  const cleaned: MetamodelTranslations = {};
  for (const [key, map] of Object.entries(trans)) {
    const c = cleanTranslationMap(map);
    if (c) cleaned[key] = c;
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

/* ================================================================== */
/*  Main Component                                                     */
/* ================================================================== */

export default function MetamodelAdmin() {
  const { t } = useTranslation(["admin", "common"]);
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
    has_successors: false,
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
    translations: {} as MetamodelTranslations,
  });

  /* --- Edit relation dialog --- */
  const [editRelOpen, setEditRelOpen] = useState(false);
  const [editRel, setEditRel] = useState<(RType & { translations?: MetamodelTranslations }) | null>(null);

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
    : types.filter((ct) => !ct.is_hidden);

  const displayRelationTypes = (showHiddenRels
    ? relationTypes
    : relationTypes.filter((r) => !r.is_hidden)
  ).filter((r) => !r.key.endsWith("Successor"));

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
      has_successors: false,
      description: "",
    });
  };

  const handleCreateRelation = async () => {
    const finalKey = newRel.key || autoRelKey;
    const { translations: rawTrans, ...rest } = newRel;
    await api.post("/metamodel/relation-types", {
      ...rest,
      key: finalKey,
      attributes_schema: [],
      built_in: false,
      translations: cleanTranslations(rawTrans) || undefined,
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
      translations: {},
    });
  };

  const handleUpdateRelation = async () => {
    if (!editRel) return;
    await api.patch(`/metamodel/relation-types/${editRel.key}`, {
      label: editRel.label,
      reverse_label: editRel.reverse_label,
      cardinality: editRel.cardinality,
      translations: cleanTranslations(editRel.translations) || null,
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
      translations: {},
    });
    setCreateRelOpen(true);
  };

  const handleNodeClick = useCallback((key: string) => {
    setSelectedTypeKey(key);
    setDrawerOpen(true);
  }, []);

  const resolveType = (key: string) => types.find((ct) => ct.key === key);

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  return (
    <Box>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>
        {t("metamodel.title")}
      </Typography>

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 3 }}
      >
        <Tab label={t("metamodel.tabs.cardTypes")} />
        <Tab label={t("metamodel.tabs.relationTypes")} />
        <Tab label={t("metamodel.tabs.calculations")} />
        <Tab label={t("metamodel.tabs.tags")} />
        <Tab label={t("metamodel.tabs.principles")} />
        <Tab label={t("metamodel.tabs.graph")} />
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
              label={t("metamodel.showHiddenTypes")}
            />
            <Button
              variant="contained"
              startIcon={<MaterialSymbol icon="add" size={18} />}
              onClick={() => setCreateTypeOpen(true)}
            >
              {t("metamodel.newType")}
            </Button>
          </Box>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 2,
            }}
          >
            {displayTypes.map((ct) => {
              const fieldCount = ct.fields_schema.reduce(
                (sum, s) => sum + s.fields.length,
                0,
              );
              const subtypeCount = (ct.subtypes || []).length;
              const relCount = relationTypes.filter(
                (r) =>
                  !r.key.endsWith("Successor") &&
                  (r.source_type_key === ct.key ||
                  r.target_type_key === ct.key),
              ).length;

              return (
                <Card
                  key={ct.key}
                  sx={{
                    cursor: "pointer",
                    transition: "box-shadow 0.2s, transform 0.15s",
                    "&:hover": { boxShadow: 6, transform: "translateY(-2px)" },
                    opacity: ct.is_hidden ? 0.55 : 1,
                  }}
                  onClick={() => {
                    setSelectedTypeKey(ct.key);
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
                          bgcolor: ct.color,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <MaterialSymbol
                          icon={ct.icon}
                          size={22}
                          color="#fff"
                        />
                      </Box>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography fontWeight={600} noWrap>
                          {ct.label}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          noWrap
                        >
                          {ct.category || t("metamodel.uncategorized")}
                        </Typography>
                      </Box>
                      <Tooltip title={ct.is_hidden ? t("common:actions.restore") : t("metamodel.hidden")}>
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            api
                              .patch(`/metamodel/types/${ct.key}`, { is_hidden: !ct.is_hidden })
                              .then(refresh);
                          }}
                        >
                          <MaterialSymbol
                            icon={ct.is_hidden ? "visibility_off" : "visibility"}
                            size={18}
                            color={ct.is_hidden ? "#f57c00" : "#bbb"}
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
                      {ct.has_hierarchy && (
                        <Chip
                          size="small"
                          label={t("metamodel.hierarchy")}
                          variant="outlined"
                          sx={{ height: 22, fontSize: 11 }}
                        />
                      )}
                      {ct.has_successors && (
                        <Chip
                          size="small"
                          label={t("metamodel.successors")}
                          variant="outlined"
                          sx={{ height: 22, fontSize: 11 }}
                        />
                      )}
                      {ct.built_in && (
                        <Chip
                          size="small"
                          label={t("metamodel.builtIn")}
                          color="info"
                          sx={{ height: 22, fontSize: 11 }}
                        />
                      )}
                      {ct.is_hidden && (
                        <Chip
                          size="small"
                          label={t("metamodel.hidden")}
                          sx={{ height: 22, fontSize: 11 }}
                        />
                      )}
                    </Box>

                    <Box sx={{ display: "flex", gap: 2 }}>
                      <Typography variant="caption" color="text.secondary">
                        {t("metamodel.fields", { count: fieldCount })}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t("metamodel.subtypes", { count: subtypeCount })}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t("metamodel.relations", { count: relCount })}
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
              {t("metamodel.noCardTypes")}
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
              label={t("metamodel.showHiddenRelations")}
            />
            <Button
              variant="contained"
              startIcon={<MaterialSymbol icon="add" size={18} />}
              onClick={() => openCreateRelation()}
            >
              {t("metamodel.newRelation")}
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
                        label={t("metamodel.builtIn")}
                        color="info"
                        sx={{ height: 22, fontSize: 11 }}
                      />
                    )}
                    {rt.is_hidden && (
                      <Chip
                        size="small"
                        label={t("metamodel.hidden")}
                        color="warning"
                        sx={{ height: 22, fontSize: 11 }}
                      />
                    )}

                    {rt.is_hidden ? (
                      <Tooltip title={t("common:actions.restore")}>
                        <IconButton
                          size="small"
                          onClick={() => handleRestoreRelation(rt.key)}
                        >
                          <MaterialSymbol icon="restore" size={18} />
                        </IconButton>
                      </Tooltip>
                    ) : (
                      <>
                        <Tooltip title={t("common:actions.edit")}>
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
                        <Tooltip title={t("common:actions.delete")}>
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
              {t("metamodel.noRelationTypes")}
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
      {/*  TAB 4 -- EA Principles                                      */}
      {/* ============================================================ */}
      {tab === 4 && <PrinciplesAdmin />}

      {/* ============================================================ */}
      {/*  TAB 5 -- Metamodel Graph                                    */}
      {/* ============================================================ */}
      {tab === 5 && (
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
        <DialogTitle>{t("metamodel.createCardType")}</DialogTitle>
        <DialogContent>
          <KeyInput
            fullWidth
            label={t("metamodel.keyLabel")}
            value={newType.key}
            onChange={(v) => setNewType({ ...newType, key: v })}
            sx={{ mt: 1, mb: 2 }}
            size="small"
          />
          <TextField
            fullWidth
            label={t("common:labels.name")}
            value={newType.label}
            onChange={(e) => setNewType({ ...newType, label: e.target.value })}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            label={t("common:labels.description")}
            value={newType.description}
            onChange={(e) =>
              setNewType({ ...newType, description: e.target.value })
            }
            sx={{ mb: 2 }}
          />
          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
              {t("metamodel.iconLabel")}
            </Typography>
            <IconPicker
              value={newType.icon}
              onChange={(v) => setNewType({ ...newType, icon: v })}
              color={newType.color}
            />
          </Box>
          <Box sx={{ mb: 2 }}>
            <ColorPicker
              value={newType.color}
              onChange={(c) => setNewType({ ...newType, color: c })}
              label={t("tags.color")}
            />
          </Box>
          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel>{t("metamodel.category")}</InputLabel>
            <Select
              value={newType.category}
              label={t("metamodel.category")}
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
            label={t("metamodel.supportsHierarchy")}
          />
          <FormControlLabel
            control={
              <Switch
                checked={newType.has_successors}
                onChange={(e) =>
                  setNewType({ ...newType, has_successors: e.target.checked })
                }
              />
            }
            label={t("metamodel.supportsSuccessors")}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateTypeOpen(false)}>{t("common:actions.cancel")}</Button>
          <Button
            variant="contained"
            onClick={handleCreateType}
            disabled={!newType.key || !newType.label || !isValidKey(newType.key)}
          >
            {t("common:actions.create")}
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
        <DialogTitle>{t("metamodel.createRelationType")}</DialogTitle>
        <DialogContent>
          <FormControl fullWidth sx={{ mt: 1, mb: 2 }}>
            <InputLabel>{t("metamodel.sourceType")}</InputLabel>
            <Select
              value={newRel.source_type_key}
              label={t("metamodel.sourceType")}
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
              {types.map((ct) => (
                <MenuItem key={ct.key} value={ct.key}>
                  <Box
                    sx={{ display: "flex", alignItems: "center", gap: 1 }}
                  >
                    <Box
                      sx={{
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        bgcolor: ct.color,
                      }}
                    />
                    <MaterialSymbol icon={ct.icon} size={16} color={ct.color} />
                    {ct.label}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel>{t("metamodel.targetType")}</InputLabel>
            <Select
              value={newRel.target_type_key}
              label={t("metamodel.targetType")}
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
              {types.map((ct) => (
                <MenuItem key={ct.key} value={ct.key}>
                  <Box
                    sx={{ display: "flex", alignItems: "center", gap: 1 }}
                  >
                    <Box
                      sx={{
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        bgcolor: ct.color,
                      }}
                    />
                    <MaterialSymbol icon={ct.icon} size={16} color={ct.color} />
                    {ct.label}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <KeyInput
            fullWidth
            label={t("metamodel.keyLabel")}
            value={newRel.key || autoRelKey}
            onChange={(v) => setNewRel({ ...newRel, key: v })}
            sx={{ mb: 2 }}
            size="small"
          />
          <TextField
            fullWidth
            label={t("metamodel.labelVerb")}
            value={newRel.label}
            onChange={(e) => setNewRel({ ...newRel, label: e.target.value })}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            label={t("metamodel.reverseLabel")}
            value={newRel.reverse_label}
            onChange={(e) =>
              setNewRel({ ...newRel, reverse_label: e.target.value })
            }
            sx={{ mb: 2 }}
          />
          <FormControl fullWidth>
            <InputLabel>{t("metamodel.cardinality")}</InputLabel>
            <Select
              value={newRel.cardinality}
              label={t("metamodel.cardinality")}
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
          <Button onClick={() => setCreateRelOpen(false)}>{t("common:actions.cancel")}</Button>
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
            {t("common:actions.create")}
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
        <DialogTitle>{t("metamodel.editRelationType")}</DialogTitle>
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
                label={t("common:labels.name")}
                value={editRel.label}
                onChange={(e) =>
                  setEditRel({ ...editRel, label: e.target.value })
                }
                sx={{ mb: 2 }}
              />
              <TextField
                fullWidth
                label={t("metamodel.reverseLabel")}
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
                <InputLabel>{t("metamodel.cardinality")}</InputLabel>
                <Select
                  value={editRel.cardinality}
                  label={t("metamodel.cardinality")}
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
              <Button onClick={() => setEditRelOpen(false)}>{t("common:actions.cancel")}</Button>
              <Button variant="contained" onClick={handleUpdateRelation}>
                {t("common:actions.save")}
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
        <DialogTitle>{t("metamodel.deleteRelationType")}</DialogTitle>
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
                  <span dangerouslySetInnerHTML={{ __html: t("metamodel.deleteRelHasInstances", { count: deleteRelConfirm.instanceCount }) }} />
                </Alert>
              ) : deleteRelConfirm.builtIn ? (
                <Alert severity="info">
                  {t("metamodel.deleteRelBuiltInHidden")}
                </Alert>
              ) : (
                <Alert severity="info">
                  {t("metamodel.deleteRelNoInstances")}
                </Alert>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteRelConfirm(null)}>{t("common:actions.cancel")}</Button>
          <Button
            variant="contained"
            color="error"
            disabled={deleteRelConfirm?.instanceCount === null}
            onClick={confirmDeleteRelation}
          >
            {deleteRelConfirm?.builtIn && deleteRelConfirm.instanceCount === 0
              ? t("metamodel.hidden")
              : t("common:actions.delete")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
