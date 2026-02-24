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
import Autocomplete from "@mui/material/Autocomplete";
import Tooltip from "@mui/material/Tooltip";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useResolveMetaLabel } from "@/hooks/useResolveLabel";
import { api } from "@/api/client";
import type { Relation, RelationType } from "@/types";

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
  const rml = useResolveMetaLabel();
  const { getType } = useMetamodel();
  const targetTypeKey = isSource ? rt.target_type_key : rt.source_type_key;
  const targetTypeConfig = getType(targetTypeKey);

  const [search, setSearch] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; type: string }[]>([]);
  const [error, setError] = useState("");
  const [createMode, setCreateMode] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createLoading, setCreateLoading] = useState(false);

  useEffect(() => {
    if (!targetTypeKey || search.length < 1) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      api
        .get<{ items: { id: string; name: string; type: string }[] }>(
          `/cards?type=${targetTypeKey}&search=${encodeURIComponent(search)}&page_size=20`,
        )
        .then((res) => setResults(res.items.filter((item) => item.id !== fsId)))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [targetTypeKey, search, fsId]);

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

  const targetLabel =
    rml(targetTypeConfig?.key ?? "", targetTypeConfig?.translations, "label") || targetTypeKey;

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
        <Autocomplete
          sx={{ flex: 1 }}
          options={results}
          getOptionLabel={(opt) => opt.name}
          onChange={(_, val) => handleSelect(val)}
          inputValue={search}
          onInputChange={(_, val) => setSearch(val)}
          renderOption={(props, opt) => {
            const tConf = getType(opt.type);
            return (
              <li {...props} key={opt.id}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  {tConf && <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: tConf.color }} />}
                  <Typography variant="body2">{opt.name}</Typography>
                </Box>
              </li>
            );
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              size="small"
              placeholder={t("relations.search", { type: targetLabel })}
              autoFocus
            />
          )}
          noOptionsText={search ? t("common:labels.noResults") : t("relations.searchPlaceholder")}
          filterOptions={(x) => x}
          openOnFocus
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
}: {
  rt: RelationType;
  isSource: boolean;
  mandatory: boolean;
  rels: Relation[];
  fsId: string;
  canManageRelations: boolean;
  onReload: () => void;
}) {
  const { t } = useTranslation(["cards", "common"]);
  const rml = useResolveMetaLabel();
  const { getType } = useMetamodel();
  const navigate = useNavigate();
  const [inlineAddOpen, setInlineAddOpen] = useState(false);

  const otherTypeKey = isSource ? rt.target_type_key : rt.source_type_key;
  const otherType = getType(otherTypeKey);
  const verb = isSource
    ? rml(rt.key, rt.translations, "label")
    : rml(rt.key, rt.translations, "reverse_label") || rml(rt.key, rt.translations, "label");

  const handleDelete = async (relId: string) => {
    await api.delete(`/relations/${relId}`);
    onReload();
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
              {rml(otherType.key, otherType.translations, "label")}
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
        {canManageRelations && !inlineAddOpen && (
          <Tooltip title={t("relations.addSpecific", {
            type: rml(otherType?.key ?? "", otherType?.translations, "label") || otherTypeKey,
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

      {/* Related cards list */}
      {rels.length > 0 && (
        <List dense disablePadding sx={{ px: 0.5 }}>
          {rels.map((r) => {
            const other = r.source_id === fsId ? r.target : r.source;
            const oType = getType(other?.type ?? "");
            return (
              <ListItem
                key={r.id}
                secondaryAction={
                  canManageRelations ? (
                    <IconButton size="small" onClick={() => handleDelete(r.id)}>
                      <MaterialSymbol icon="close" size={16} />
                    </IconButton>
                  ) : undefined
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
          })}
        </List>
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
  const rml = useResolveMetaLabel();
  const [relations, setRelations] = useState<Relation[]>([]);
  const { types: allTypes, relationTypes, getType } = useMetamodel();
  const visibleTypeKeys = useMemo(() => new Set(allTypes.map((t) => t.key)), [allTypes]);

  // Add relation dialog state (for non-displayed relation types)
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addRelType, setAddRelType] = useState("");
  const [targetSearch, setTargetSearch] = useState("");
  const [searchResults, setSearchResults] = useState<{ id: string; name: string; type: string }[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<{ id: string; name: string; type: string } | null>(null);
  const [addError, setAddError] = useState("");

  // Inline create state (inside dialog)
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createLoading, setCreateLoading] = useState(false);

  const load = useCallback(() => {
    api.get<Relation[]>(`/relations?card_id=${fsId}`).then(setRelations).catch(() => {});
  }, [fsId]);

  useEffect(load, [load, refreshKey]);

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

  useEffect(() => {
    if (!dialogTargetTypeKey || targetSearch.length < 1) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      api
        .get<{ items: { id: string; name: string; type: string }[] }>(
          `/cards?type=${dialogTargetTypeKey}&search=${encodeURIComponent(targetSearch)}&page_size=20`,
        )
        .then((res) => setSearchResults(res.items.filter((item) => item.id !== fsId)))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [dialogTargetTypeKey, targetSearch, fsId]);

  const handleAddRelation = async () => {
    if (!selectedRT || !selectedTarget) return;
    setAddError("");
    try {
      await api.post("/relations", {
        type: selectedRT.key,
        source_id: dialogIsSource ? fsId : selectedTarget.id,
        target_id: dialogIsSource ? selectedTarget.id : fsId,
      });
      load();
      setAddDialogOpen(false);
      setAddRelType("");
      setSelectedTarget(null);
      setTargetSearch("");
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
              }}
            >
              {hiddenRTs.map((rt) => {
                const rtIsSource = rt.source_type_key === cardTypeKey;
                const verb = rtIsSource
                  ? rml(rt.key, rt.translations, "label")
                  : rml(rt.key, rt.translations, "reverse_label") || rml(rt.key, rt.translations, "label");
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
                          <Typography variant="body2">{rml(other.key, other.translations, "label")}</Typography>
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
              <Autocomplete
                options={searchResults}
                getOptionLabel={(opt) => opt.name}
                value={selectedTarget}
                onChange={(_, val) => setSelectedTarget(val)}
                inputValue={targetSearch}
                onInputChange={(_, val) => setTargetSearch(val)}
                renderOption={(props, opt) => {
                  const tConf = getType(opt.type);
                  return (
                    <li {...props} key={opt.id}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        {tConf && <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: tConf.color }} />}
                        <Typography variant="body2">{opt.name}</Typography>
                        <Typography variant="caption" color="text.secondary">{opt.type}</Typography>
                      </Box>
                    </li>
                  );
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    size="small"
                    label={t("relations.search", {
                      type: rml(dialogTargetConfig?.key ?? "", dialogTargetConfig?.translations, "label") || dialogTargetTypeKey,
                    })}
                    placeholder={t("relations.searchPlaceholder")}
                  />
                )}
                noOptionsText={targetSearch ? t("common:labels.noResults") : t("relations.searchPlaceholder")}
                filterOptions={(x) => x}
              />
              <Button
                size="small"
                sx={{ mt: 1 }}
                startIcon={<MaterialSymbol icon="add" size={16} />}
                onClick={() => { setCreateOpen(true); setCreateName(targetSearch); }}
              >
                {t("relations.createNew", {
                  type: rml(dialogTargetConfig?.key ?? "", dialogTargetConfig?.translations, "label") || dialogTargetTypeKey,
                })}
              </Button>
            </>
          )}
          {addRelType && createOpen && (
            <Box sx={{ mt: 1, p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1, bgcolor: "action.hover" }}>
              <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                {t("relations.createNew", {
                  type: rml(dialogTargetConfig?.key ?? "", dialogTargetConfig?.translations, "label") || dialogTargetTypeKey,
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
