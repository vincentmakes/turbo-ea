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
import MaterialSymbol from "@/components/MaterialSymbol";
import { useMetamodel } from "@/hooks/useMetamodel";
import { api } from "@/api/client";
import type { Relation } from "@/types";

// ── Section: Relations (with CRUD) ──────────────────────────────
function RelationsSection({ fsId, cardTypeKey, refreshKey = 0, canManageRelations = true, initialExpanded = false }: { fsId: string; cardTypeKey: string; refreshKey?: number; canManageRelations?: boolean; initialExpanded?: boolean }) {
  const [relations, setRelations] = useState<Relation[]>([]);
  const { types: allTypes, relationTypes, getType } = useMetamodel();
  const visibleTypeKeys = useMemo(() => new Set(allTypes.map((t) => t.key)), [allTypes]);
  const navigate = useNavigate();

  // Add relation dialog state
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addRelType, setAddRelType] = useState("");
  const [targetSearch, setTargetSearch] = useState("");
  const [searchResults, setSearchResults] = useState<{ id: string; name: string; type: string }[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<{ id: string; name: string; type: string } | null>(null);
  const [addError, setAddError] = useState("");

  // Inline create state
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createLoading, setCreateLoading] = useState(false);

  const load = useCallback(() => {
    api.get<Relation[]>(`/relations?card_id=${fsId}`).then(setRelations).catch(() => {});
  }, [fsId]);

  useEffect(load, [load, refreshKey]);

  const relevantRTs = relationTypes.filter(
    (rt) =>
      !rt.is_hidden &&
      (rt.source_type_key === cardTypeKey || rt.target_type_key === cardTypeKey) &&
      visibleTypeKeys.has(
        rt.source_type_key === cardTypeKey ? rt.target_type_key : rt.source_type_key
      )
  );

  const selectedRT = relationTypes.find((rt) => rt.key === addRelType);
  const isSource = selectedRT ? selectedRT.source_type_key === cardTypeKey : true;
  const targetTypeKey = selectedRT
    ? (isSource ? selectedRT.target_type_key : selectedRT.source_type_key)
    : "";
  const targetTypeConfig = getType(targetTypeKey);

  // Search for target cards when user types
  useEffect(() => {
    if (!targetTypeKey || targetSearch.length < 1) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      api
        .get<{ items: { id: string; name: string; type: string }[] }>(
          `/cards?type=${targetTypeKey}&search=${encodeURIComponent(targetSearch)}&page_size=20`
        )
        .then((res) => setSearchResults(res.items.filter((item) => item.id !== fsId)))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [targetTypeKey, targetSearch, fsId]);

  const handleAddRelation = async () => {
    if (!selectedRT || !selectedTarget) return;
    setAddError("");
    try {
      await api.post("/relations", {
        type: selectedRT.key,
        source_id: isSource ? fsId : selectedTarget.id,
        target_id: isSource ? selectedTarget.id : fsId,
      });
      load();
      setAddDialogOpen(false);
      setAddRelType("");
      setSelectedTarget(null);
      setTargetSearch("");
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Failed to create relation");
    }
  };

  const handleDeleteRelation = async (relId: string) => {
    await api.delete(`/relations/${relId}`);
    load();
  };

  // Create a new card and immediately select it as the relation target
  const handleQuickCreate = async () => {
    if (!createName.trim() || !targetTypeKey) return;
    setCreateLoading(true);
    try {
      const created = await api.post<{ id: string; name: string; type: string }>("/cards", {
        type: targetTypeKey,
        name: createName.trim(),
      });
      setSelectedTarget({ id: created.id, name: created.name, type: created.type });
      setCreateOpen(false);
      setCreateName("");
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Failed to create card");
    } finally {
      setCreateLoading(false);
    }
  };

  // Group relations by relation type -- only show types that have relations
  const grouped = relevantRTs
    .map((rt) => {
      const rtIsSource = rt.source_type_key === cardTypeKey;
      const verb = rtIsSource ? rt.label : (rt.reverse_label || rt.label);
      const otherTypeKey = rtIsSource ? rt.target_type_key : rt.source_type_key;
      const otherType = getType(otherTypeKey);
      return { rt, verb, otherType, isSource: rtIsSource, rels: relations.filter((r) => r.type === rt.key) };
    })
    .filter(({ rels }) => rels.length > 0);

  return (
    <Accordion defaultExpanded={initialExpanded} disableGutters>
      <AccordionSummary expandIcon={<MaterialSymbol icon="expand_more" size={20} />}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1 }}>
          <MaterialSymbol icon="hub" size={20} />
          <Typography fontWeight={600}>Relations</Typography>
          <Chip size="small" label={relations.length} sx={{ ml: 1, height: 20, fontSize: "0.7rem" }} />
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        {canManageRelations && (
          <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<MaterialSymbol icon="add_link" size={16} />}
              onClick={() => setAddDialogOpen(true)}
            >
              Add Relation
            </Button>
          </Box>
        )}
        {grouped.length === 0 && (
          <Typography color="text.secondary" variant="body2">No relations yet.</Typography>
        )}
        {grouped.map(({ rt, verb, otherType, rels }) => (
          <Box key={rt.key} sx={{ mb: 2 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
              <Typography variant="subtitle2" fontWeight={600}>{verb}</Typography>
              <MaterialSymbol icon="arrow_forward" size={14} />
              {otherType && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: otherType.color, flexShrink: 0 }} />
                  <Typography variant="subtitle2" color="text.secondary">{otherType.label}</Typography>
                </Box>
              )}
              <Chip size="small" label={rt.cardinality} variant="outlined" sx={{ height: 18, fontSize: "0.65rem" }} />
            </Box>
            <List dense disablePadding>
              {rels.map((r) => {
                const other = r.source_id === fsId ? r.target : r.source;
                return (
                  <ListItem
                    key={r.id}
                    secondaryAction={
                      canManageRelations ? (
                        <IconButton size="small" onClick={() => handleDeleteRelation(r.id)}>
                          <MaterialSymbol icon="close" size={16} />
                        </IconButton>
                      ) : undefined
                    }
                  >
                    <Box
                      component="div"
                      onClick={() => other && navigate(`/cards/${other.id}`)}
                      sx={{ cursor: "pointer", "&:hover": { textDecoration: "underline" } }}
                    >
                      <ListItemText primary={other?.name || "Unknown"} secondary={other?.type} />
                    </Box>
                  </ListItem>
                );
              })}
            </List>
          </Box>
        ))}
      </AccordionDetails>

      {/* ── Add Relation Dialog ── */}
      <Dialog open={addDialogOpen} onClose={() => { setAddDialogOpen(false); setCreateOpen(false); }} maxWidth="sm" fullWidth>
        <DialogTitle>Add Relation</DialogTitle>
        <DialogContent>
          {addError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setAddError("")}>{addError}</Alert>}
          <FormControl fullWidth size="small" sx={{ mt: 1, mb: 2 }}>
            <InputLabel>Relation Type</InputLabel>
            <Select
              value={addRelType}
              label="Relation Type"
              onChange={(e) => { setAddRelType(e.target.value); setSelectedTarget(null); setTargetSearch(""); setCreateOpen(false); }}
            >
              {relevantRTs.map((rt) => {
                const rtIsSource = rt.source_type_key === cardTypeKey;
                const verb = rtIsSource ? rt.label : (rt.reverse_label || rt.label);
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
                          <Typography variant="body2">{other.label}</Typography>
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
                    label={`Search ${targetTypeConfig?.label || targetTypeKey}`}
                    placeholder="Type to search..."
                  />
                )}
                noOptionsText={targetSearch ? "No results found" : "Type to search..."}
                filterOptions={(x) => x}
              />
              <Button
                size="small"
                sx={{ mt: 1 }}
                startIcon={<MaterialSymbol icon="add" size={16} />}
                onClick={() => { setCreateOpen(true); setCreateName(targetSearch); }}
              >
                Create new {targetTypeConfig?.label || targetTypeKey}
              </Button>
            </>
          )}
          {addRelType && createOpen && (
            <Box sx={{ mt: 1, p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1, bgcolor: "action.hover" }}>
              <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                Create new {targetTypeConfig?.label || targetTypeKey}
              </Typography>
              <TextField
                fullWidth
                size="small"
                label="Name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleQuickCreate()}
                autoFocus
                sx={{ mb: 1 }}
              />
              <Box sx={{ display: "flex", gap: 1 }}>
                <Button size="small" variant="contained" onClick={handleQuickCreate} disabled={!createName.trim() || createLoading}>
                  Create & Select
                </Button>
                <Button size="small" onClick={() => setCreateOpen(false)}>
                  Back to search
                </Button>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setAddDialogOpen(false); setCreateOpen(false); }}>Cancel</Button>
          <Button variant="contained" onClick={handleAddRelation} disabled={!selectedRT || !selectedTarget}>
            Add
          </Button>
        </DialogActions>
      </Dialog>
    </Accordion>
  );
}

export default RelationsSection;
