import { useState, useEffect, useCallback } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import Autocomplete from "@mui/material/Autocomplete";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import type { Relation, RelationType } from "@/types";

interface RelationCellPopoverProps {
  open: boolean;
  onClose: () => void;
  cardId: string;
  cardName: string;
  relationType: RelationType;
  selectedType: string;
  onRelationsChanged: () => void;
}

interface SearchResult {
  id: string;
  name: string;
  type: string;
}

export default function RelationCellPopover({
  open,
  onClose,
  cardId,
  cardName,
  relationType,
  selectedType,
  onRelationsChanged,
}: RelationCellPopoverProps) {
  const { getType } = useMetamodel();

  const isSource = relationType.source_type_key === selectedType;
  const targetTypeKey = isSource ? relationType.target_type_key : relationType.source_type_key;
  const targetTypeConfig = getType(targetTypeKey);
  const verb = isSource ? relationType.label : (relationType.reverse_label || relationType.label);

  const [relations, setRelations] = useState<Relation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Search state
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [targetSearch, setTargetSearch] = useState("");
  const [selectedTarget, setSelectedTarget] = useState<SearchResult | null>(null);
  const [adding, setAdding] = useState(false);

  // Quick-create state
  const [createMode, setCreateMode] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createLoading, setCreateLoading] = useState(false);

  // Load relations for this card + type
  const loadRelations = useCallback(async () => {
    setLoading(true);
    try {
      const all = await api.get<Relation[]>(`/relations?card_id=${cardId}&type=${relationType.key}`);
      setRelations(all);
    } catch {
      setRelations([]);
    } finally {
      setLoading(false);
    }
  }, [cardId, relationType.key]);

  useEffect(() => {
    if (open) {
      loadRelations();
      setError("");
      setTargetSearch("");
      setSelectedTarget(null);
      setSearchResults([]);
      setCreateMode(false);
      setCreateName("");
    }
  }, [open, loadRelations]);

  // Search for target cards
  useEffect(() => {
    if (!open || targetSearch.length < 1) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      api
        .get<{ items: SearchResult[] }>(
          `/cards?type=${targetTypeKey}&search=${encodeURIComponent(targetSearch)}&page_size=20`
        )
        .then((res) => {
          // Exclude current card and already-related cards
          const existingIds = new Set(
            relations.map((r) => (isSource ? r.target_id : r.source_id))
          );
          existingIds.add(cardId);
          setSearchResults(res.items.filter((item) => !existingIds.has(item.id)));
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [targetTypeKey, targetSearch, open, cardId, relations, isSource]);

  const handleAdd = async () => {
    if (!selectedTarget) return;
    setAdding(true);
    setError("");
    try {
      await api.post("/relations", {
        type: relationType.key,
        source_id: isSource ? cardId : selectedTarget.id,
        target_id: isSource ? selectedTarget.id : cardId,
      });
      await loadRelations();
      onRelationsChanged();
      setSelectedTarget(null);
      setTargetSearch("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add relation");
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (relId: string) => {
    setError("");
    try {
      await api.delete(`/relations/${relId}`);
      await loadRelations();
      onRelationsChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove relation");
    }
  };

  const handleQuickCreate = async () => {
    if (!createName.trim()) return;
    setCreateLoading(true);
    setError("");
    try {
      const created = await api.post<SearchResult>("/cards", {
        type: targetTypeKey,
        name: createName.trim(),
      });
      // Immediately create the relation
      await api.post("/relations", {
        type: relationType.key,
        source_id: isSource ? cardId : created.id,
        target_id: isSource ? created.id : cardId,
      });
      await loadRelations();
      onRelationsChanged();
      setCreateMode(false);
      setCreateName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setCreateLoading(false);
    }
  };

  const otherType = getType(targetTypeKey);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pb: 1 }}>
        {otherType && (
          <Box sx={{ width: 14, height: 14, borderRadius: "50%", bgcolor: otherType.color, flexShrink: 0 }} />
        )}
        <Typography variant="h6" component="span" sx={{ flex: 1 }}>
          {cardName}
          <Typography component="span" variant="body1" color="text.secondary" sx={{ mx: 1 }}>
            {verb} &rarr;
          </Typography>
          {otherType?.label || targetTypeKey}
        </Typography>
        <IconButton size="small" onClick={onClose} edge="end">
          <MaterialSymbol icon="close" size={20} />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>{error}</Alert>}

        {/* Current relations */}
        <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mb: 1, display: "block" }}>
          Current relations
        </Typography>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
            <CircularProgress size={24} />
          </Box>
        ) : (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 2.5, minHeight: 32 }}>
            {relations.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>
                No relations yet
              </Typography>
            )}
            {relations.map((r) => {
              const other = isSource ? r.target : r.source;
              return (
                <Chip
                  key={r.id}
                  label={other?.name || "Unknown"}
                  onDelete={() => handleDelete(r.id)}
                  icon={otherType ? <MaterialSymbol icon={otherType.icon} size={16} color={otherType.color} /> : undefined}
                  sx={{ maxWidth: "100%" }}
                />
              );
            })}
          </Box>
        )}

        {/* Add section */}
        <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mb: 1, display: "block" }}>
          Add relation
        </Typography>
        {!createMode ? (
          <>
            <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
              <Autocomplete
                size="small"
                fullWidth
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
                      </Box>
                    </li>
                  );
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    placeholder={`Search ${targetTypeConfig?.label || targetTypeKey}...`}
                  />
                )}
                noOptionsText={targetSearch ? "No results" : "Type to search..."}
                filterOptions={(x) => x}
              />
              <Button
                variant="contained"
                size="small"
                onClick={handleAdd}
                disabled={!selectedTarget || adding}
                sx={{ textTransform: "none", whiteSpace: "nowrap", minWidth: 56, height: 40 }}
              >
                {adding ? <CircularProgress size={18} color="inherit" /> : "Add"}
              </Button>
            </Box>
            <Button
              size="small"
              sx={{ mt: 0.5, textTransform: "none" }}
              startIcon={<MaterialSymbol icon="add" size={16} />}
              onClick={() => { setCreateMode(true); setCreateName(targetSearch); }}
            >
              Create new {targetTypeConfig?.label || targetTypeKey}
            </Button>
          </>
        ) : (
          <Box sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1, bgcolor: "action.hover" }}>
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
              Create new {targetTypeConfig?.label || targetTypeKey}
            </Typography>
            <TextField
              fullWidth
              size="small"
              placeholder="Name"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleQuickCreate()}
              autoFocus
              sx={{ mb: 1 }}
            />
            <Box sx={{ display: "flex", gap: 1 }}>
              <Button
                size="small"
                variant="contained"
                onClick={handleQuickCreate}
                disabled={!createName.trim() || createLoading}
                sx={{ textTransform: "none" }}
              >
                {createLoading ? <CircularProgress size={16} color="inherit" /> : "Create & Add"}
              </Button>
              <Button size="small" onClick={() => setCreateMode(false)} sx={{ textTransform: "none" }}>
                Back
              </Button>
            </Box>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}
