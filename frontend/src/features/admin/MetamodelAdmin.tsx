import { useState, useEffect, useCallback, useMemo } from "react";
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
import MaterialSymbol from "@/components/MaterialSymbol";
import ColorPicker from "@/components/ColorPicker";
import IconPicker from "@/components/IconPicker";
import KeyInput, { isValidKey } from "@/components/KeyInput";
import CalculationsAdmin from "@/features/admin/CalculationsAdmin";
import PrinciplesAdmin from "@/features/admin/PrinciplesAdmin";
import RegulationsAdmin from "@/features/admin/RegulationsAdmin";
import ResourceTypesAdmin from "@/features/admin/ResourceTypesAdmin";
import TagsAdmin from "@/features/admin/TagsAdmin";
import { useMetamodel } from "@/hooks/useMetamodel";
import { api } from "@/api/client";
import type { CardType as FSType, RelationType as RType } from "@/types";
import { TypeDetailDrawer, MetamodelGraph } from "./metamodel";
import RelationTypesPanel from "./metamodel/RelationTypesPanel";
import HierarchyLinkTypesSection from "./metamodel/HierarchyLinkTypesSection";
import { CATEGORIES } from "./metamodel/constants";
import { successorRelationKeys } from "@/lib/successorRelation";

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

  // Still needed by the card-types tab's per-type relation count: each type's
  // ONE lineage relation is managed by its "Supports Lineage" toggle, not
  // counted as an ordinary relation.
  const successorRelKeys = useMemo(() => successorRelationKeys(relationTypes), [relationTypes]);

  const handleNodeClick = (typeKey: string) => {
    setSelectedTypeKey(typeKey);
    setDrawerOpen(true);
  };

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
        <Tab label={t("metamodel.tabs.graph")} />
        <Tab label={t("metamodel.tabs.principles")} />
        <Tab label={t("metamodel.tabs.regulations")} />
        <Tab label={t("metamodel.tabs.resources")} />
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
                  !successorRelKeys.has(r.key) &&
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
          {/* A parent→child link is a relationship, so its vocabulary lives
              beside the relation types (#1100). */}
          <HierarchyLinkTypesSection types={types} onRefresh={refresh} />
          <RelationTypesPanel
            types={types}
            relationTypes={relationTypes}
            onRefresh={refresh}
            loading={loading}
          />
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
      {/*  TAB 5 -- EA Principles                                      */}
      {/* ============================================================ */}
      {tab === 5 && <PrinciplesAdmin />}

      {/* ============================================================ */}
      {/*  TAB 6 -- Compliance Regulations                             */}
      {/* ============================================================ */}
      {tab === 6 && <RegulationsAdmin />}

      {/* ============================================================ */}
      {/*  TAB 7 -- Resource Types (link types & file categories)      */}
      {/* ============================================================ */}
      {tab === 7 && <ResourceTypesAdmin />}

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
            required={!!newType.label.trim()}
          />
          <TextField
            fullWidth
            label={t("common:labels.name")}
            value={newType.label}
            onChange={(e) => setNewType({ ...newType, label: e.target.value })}
            sx={{ mb: 2 }}
            error={!newType.label.trim()}
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

    </Box>
  );
}
