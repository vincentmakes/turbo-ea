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
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useResolveMetaLabel } from "@/hooks/useResolveLabel";
import { api } from "@/api/client";
import type { Card, Relation, RelationType } from "@/types";

/**
 * Find the successor relation type for a given card type.
 * Convention: key ends with "Successor" and source_type_key === target_type_key === typeKey.
 */
function findSuccessorRelationType(
  relationTypes: RelationType[],
  typeKey: string,
): RelationType | undefined {
  return relationTypes.find(
    (rt) =>
      !rt.is_hidden &&
      rt.source_type_key === typeKey &&
      rt.target_type_key === typeKey &&
      rt.key.endsWith("Successor"),
  );
}

function SuccessorsSection({
  card,
  canEdit = true,
  initialExpanded = true,
}: {
  card: Card;
  canEdit?: boolean;
  initialExpanded?: boolean;
}) {
  const { t } = useTranslation(["cards", "common"]);
  const navigate = useNavigate();
  const { getType, relationTypes } = useMetamodel();
  const rml = useResolveMetaLabel();
  const typeConfig = getType(card.type);

  const successorRT = findSuccessorRelationType(relationTypes, card.type);

  const [relations, setRelations] = useState<Relation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Add dialog state
  const [addMode, setAddMode] = useState<"successor" | "predecessor" | null>(null);
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);

  // Inline create state
  const [createMode, setCreateMode] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createLoading, setCreateLoading] = useState(false);

  const loadRelations = useCallback(() => {
    if (!successorRT) {
      setLoading(false);
      return;
    }
    api
      .get<Relation[]>(`/relations?card_id=${card.id}&type=${successorRT.key}`)
      .then((rels) => {
        setRelations(rels);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [card.id, successorRT]);

  useEffect(loadRelations, [loadRelations]);

  // Search for cards of the same type
  useEffect(() => {
    if (!addMode || search.length < 1) {
      setOptions([]);
      return;
    }
    const timer = setTimeout(() => {
      api
        .get<{ items: { id: string; name: string }[] }>(
          `/cards?type=${card.type}&search=${encodeURIComponent(search)}&page_size=20`,
        )
        .then((res) => {
          // Exclude self and already-related cards
          const existingIds = new Set(
            relations.flatMap((r) => [r.source_id, r.target_id]),
          );
          existingIds.add(card.id);
          setOptions(res.items.filter((item) => !existingIds.has(item.id)));
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [addMode, search, card.id, card.type, relations]);

  // Successors: cards where THIS card is the source (this card succeeds nothing — those cards succeed this one)
  // Actually: if relation is "A succeeds B", then A is source, B is target.
  // So: successors of this card = relations where THIS card is the TARGET (source succeeds this card)
  // Predecessors of this card = relations where THIS card is the SOURCE (this card succeeds those)
  const successors = relations.filter((r) => r.target_id === card.id);
  const predecessors = relations.filter((r) => r.source_id === card.id);

  const handleAdd = async () => {
    if (!selected || !successorRT) return;
    try {
      setError("");
      if (addMode === "successor") {
        // "selected" succeeds this card → source=selected, target=this card
        await api.post("/relations", {
          type: successorRT.key,
          source_id: selected.id,
          target_id: card.id,
        });
      } else {
        // this card succeeds "selected" → source=this card, target=selected
        await api.post("/relations", {
          type: successorRT.key,
          source_id: card.id,
          target_id: selected.id,
        });
      }
      closeDialog();
      loadRelations();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("successors.errors.add"));
    }
  };

  const handleQuickCreate = async () => {
    if (!createName.trim() || !successorRT) return;
    setCreateLoading(true);
    setError("");
    try {
      const created = await api.post<{ id: string; name: string }>("/cards", {
        type: card.type,
        name: createName.trim(),
      });
      if (addMode === "successor") {
        await api.post("/relations", {
          type: successorRT.key,
          source_id: created.id,
          target_id: card.id,
        });
      } else {
        await api.post("/relations", {
          type: successorRT.key,
          source_id: card.id,
          target_id: created.id,
        });
      }
      closeDialog();
      loadRelations();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("successors.errors.create"));
    } finally {
      setCreateLoading(false);
    }
  };

  const handleRemove = async (relId: string) => {
    await api.delete(`/relations/${relId}`);
    loadRelations();
  };

  const closeDialog = () => {
    setAddMode(null);
    setSelected(null);
    setSearch("");
    setCreateMode(false);
    setCreateName("");
  };

  if (!typeConfig?.has_successors || !successorRT) return null;

  const typeLabel =
    rml(typeConfig.key, typeConfig.translations, "label") || card.type;
  const totalCount = successors.length + predecessors.length;

  return (
    <Accordion defaultExpanded={initialExpanded} disableGutters>
      <AccordionSummary
        expandIcon={<MaterialSymbol icon="expand_more" size={20} />}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1 }}>
          <MaterialSymbol icon="arrow_forward" size={20} />
          <Typography fontWeight={600}>{t("successors.title")}</Typography>
          {totalCount > 0 && (
            <Chip
              size="small"
              label={totalCount}
              sx={{ ml: 1, height: 20, fontSize: "0.7rem" }}
            />
          )}
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        {error && (
          <Alert severity="error" onClose={() => setError("")} sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {loading ? (
          <LinearProgress />
        ) : (
          <Box>
            {/* Predecessors */}
            <Box sx={{ mb: 2 }}>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  mb: 1,
                }}
              >
                <Typography
                  variant="caption"
                  color="text.secondary"
                  fontWeight={600}
                >
                  {t("successors.predecessors")}
                </Typography>
                <Chip
                  size="small"
                  label={predecessors.length}
                  sx={{ height: 18, fontSize: "0.65rem" }}
                />
              </Box>
              {predecessors.length > 0 ? (
                <List dense disablePadding>
                  {predecessors.map((rel) => (
                    <ListItem
                      key={rel.id}
                      secondaryAction={
                        canEdit ? (
                          <IconButton
                            size="small"
                            onClick={() => handleRemove(rel.id)}
                            title={t("common:actions.remove")}
                          >
                            <MaterialSymbol
                              icon="link_off"
                              size={16}
                              color="#f44336"
                            />
                          </IconButton>
                        ) : undefined
                      }
                    >
                      <Box
                        component="div"
                        onClick={() =>
                          navigate(`/cards/${rel.target_id}`)
                        }
                        sx={{
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          "&:hover": { textDecoration: "underline" },
                        }}
                      >
                        <MaterialSymbol
                          icon={typeConfig.icon || "category"}
                          size={16}
                          color={typeConfig.color}
                        />
                        <ListItemText
                          primary={rel.target?.name || rel.target_id}
                        />
                      </Box>
                    </ListItem>
                  ))}
                </List>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {t("successors.noPredecessors")}
                </Typography>
              )}
              {canEdit && (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<MaterialSymbol icon="add" size={16} />}
                  onClick={() => setAddMode("predecessor")}
                  sx={{ mt: 1 }}
                >
                  {t("successors.addPredecessor")}
                </Button>
              )}
            </Box>

            {/* Successors */}
            <Box>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  mb: 1,
                }}
              >
                <Typography
                  variant="caption"
                  color="text.secondary"
                  fontWeight={600}
                >
                  {t("successors.successorsList")}
                </Typography>
                <Chip
                  size="small"
                  label={successors.length}
                  sx={{ height: 18, fontSize: "0.65rem" }}
                />
              </Box>
              {successors.length > 0 ? (
                <List dense disablePadding>
                  {successors.map((rel) => (
                    <ListItem
                      key={rel.id}
                      secondaryAction={
                        canEdit ? (
                          <IconButton
                            size="small"
                            onClick={() => handleRemove(rel.id)}
                            title={t("common:actions.remove")}
                          >
                            <MaterialSymbol
                              icon="link_off"
                              size={16}
                              color="#f44336"
                            />
                          </IconButton>
                        ) : undefined
                      }
                    >
                      <Box
                        component="div"
                        onClick={() =>
                          navigate(`/cards/${rel.source_id}`)
                        }
                        sx={{
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          "&:hover": { textDecoration: "underline" },
                        }}
                      >
                        <MaterialSymbol
                          icon={typeConfig.icon || "category"}
                          size={16}
                          color={typeConfig.color}
                        />
                        <ListItemText
                          primary={rel.source?.name || rel.source_id}
                        />
                      </Box>
                    </ListItem>
                  ))}
                </List>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {t("successors.noSuccessors")}
                </Typography>
              )}
              {canEdit && (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<MaterialSymbol icon="add" size={16} />}
                  onClick={() => setAddMode("successor")}
                  sx={{ mt: 1 }}
                >
                  {t("successors.addSuccessor")}
                </Button>
              )}
            </Box>
          </Box>
        )}

        {/* Add dialog */}
        <Dialog
          open={addMode !== null}
          onClose={closeDialog}
          maxWidth="sm"
          fullWidth
          disableRestoreFocus
        >
          <DialogTitle>
            {addMode === "successor"
              ? t("successors.addSuccessor")
              : t("successors.addPredecessor")}
          </DialogTitle>
          <DialogContent>
            {error && (
              <Alert
                severity="error"
                onClose={() => setError("")}
                sx={{ mb: 1, mt: 1 }}
              >
                {error}
              </Alert>
            )}
            {!createMode ? (
              <>
                <Autocomplete
                  options={options}
                  getOptionLabel={(opt) => opt.name}
                  value={selected}
                  onChange={(_, val) => setSelected(val)}
                  inputValue={search}
                  onInputChange={(_, val) => setSearch(val)}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      size="small"
                      label={t("successors.search", { type: typeLabel })}
                      placeholder={t("successors.searchPlaceholder")}
                      sx={{ mt: 1 }}
                    />
                  )}
                  noOptionsText={
                    search
                      ? t("common:labels.noResults")
                      : t("successors.searchPlaceholder")
                  }
                  filterOptions={(x) => x}
                />
                <Button
                  size="small"
                  sx={{ mt: 1 }}
                  startIcon={<MaterialSymbol icon="add" size={16} />}
                  onClick={() => {
                    setCreateMode(true);
                    setCreateName(search);
                  }}
                >
                  {t("successors.createNew", { type: typeLabel })}
                </Button>
              </>
            ) : (
              <Box
                sx={{
                  mt: 1,
                  p: 2,
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 1,
                  bgcolor: "action.hover",
                }}
              >
                <Typography
                  variant="subtitle2"
                  fontWeight={600}
                  sx={{ mb: 1 }}
                >
                  {addMode === "successor"
                    ? t("successors.createAsSuccessor", { type: typeLabel })
                    : t("successors.createAsPredecessor", {
                        type: typeLabel,
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
                  <Button
                    size="small"
                    variant="contained"
                    onClick={handleQuickCreate}
                    disabled={!createName.trim() || createLoading}
                  >
                    {t("successors.createAndAdd")}
                  </Button>
                  <Button size="small" onClick={() => setCreateMode(false)}>
                    {t("successors.backToSearch")}
                  </Button>
                </Box>
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={closeDialog}>{t("common:actions.cancel")}</Button>
            {!createMode && (
              <Button
                variant="contained"
                onClick={handleAdd}
                disabled={!selected}
              >
                {t("common:actions.add")}
              </Button>
            )}
          </DialogActions>
        </Dialog>
      </AccordionDetails>
    </Accordion>
  );
}

export default SuccessorsSection;
