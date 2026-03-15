import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useMetamodel } from "@/hooks/useMetamodel";
import { api } from "@/api/client";
import type {
  ArchLensAnalysisRun,
  ArchLensCommitProgress,
  ArchSolutionOption,
  CapabilityMappingResult,
  ProposedCard,
  ProposedRelation,
} from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  assessmentId: string;
  requirement: string;
  capabilityMapping: CapabilityMappingResult;
  objectiveIds: string[];
  selectedOption?: ArchSolutionOption;
}

/** Build a concise initiative name from the selected option title + requirement. */
function buildInitiativeName(
  requirement: string,
  selectedOption?: ArchSolutionOption,
): string {
  if (selectedOption?.title) {
    // Use option title — it's more specific than the raw requirement
    return selectedOption.title.slice(0, 200);
  }
  return requirement.slice(0, 200);
}

export default function CommitInitiativeDialog({
  open,
  onClose,
  assessmentId,
  requirement,
  capabilityMapping,
  objectiveIds,
  selectedOption,
}: Props) {
  const { t } = useTranslation("admin");
  const { types } = useMetamodel();

  const [name, setName] = useState(
    buildInitiativeName(requirement, selectedOption),
  );
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set());
  const [selectedRels, setSelectedRels] = useState<Set<number>>(new Set());
  const [cardNames, setCardNames] = useState<Map<string, string>>(new Map());
  const [editingCard, setEditingCard] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<ArchLensCommitProgress | null>(null);
  const [done, setDone] = useState(false);
  const [resultData, setResultData] = useState<Record<string, unknown> | null>(
    null,
  );
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  // Only show non-disabled new cards
  const newCards = useMemo(
    () => capabilityMapping.proposedCards.filter((c) => c.isNew && !c.disabled),
    [capabilityMapping],
  );

  const disabledCardIds = useMemo(
    () =>
      new Set(
        capabilityMapping.proposedCards
          .filter((c) => c.disabled)
          .map((c) => c.id),
      ),
    [capabilityMapping],
  );

  // Initialise selection + names from Phase 5 state
  useEffect(() => {
    setSelectedCards(new Set(newCards.map((c) => c.id)));
    // Pre-select relations not involving disabled cards
    setSelectedRels(
      new Set(
        capabilityMapping.proposedRelations
          .map((rel, i) => ({ rel, i }))
          .filter(
            ({ rel }) =>
              !disabledCardIds.has(rel.sourceId) &&
              !disabledCardIds.has(rel.targetId),
          )
          .map(({ i }) => i),
      ),
    );
    // Carry over edited names from Phase 5
    const names = new Map<string, string>();
    for (const card of capabilityMapping.proposedCards) {
      names.set(card.id, card.name);
    }
    setCardNames(names);
  }, [newCards, capabilityMapping.proposedRelations, disabledCardIds, capabilityMapping.proposedCards]);

  const toggleCard = (id: string) => {
    setSelectedCards((prev) => {
      const next = new Set(prev);
      const wasSelected = next.has(id);
      if (wasSelected) {
        next.delete(id);
      } else {
        next.add(id);
      }
      // Auto-toggle relations involving this card
      setSelectedRels((prevRels) => {
        const nextRels = new Set(prevRels);
        capabilityMapping.proposedRelations.forEach((rel, i) => {
          if (rel.sourceId === id || rel.targetId === id) {
            if (wasSelected) {
              nextRels.delete(i);
            } else {
              // Only re-enable if the other endpoint is also selected
              const otherId =
                rel.sourceId === id ? rel.targetId : rel.sourceId;
              const otherCard = newCards.find((c) => c.id === otherId);
              const otherSelected =
                !otherCard || next.has(otherId);
              if (otherSelected) nextRels.add(i);
            }
          }
        });
        return nextRels;
      });
      return next;
    });
  };

  const toggleRel = (idx: number) => {
    setSelectedRels((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const getCardName = useCallback(
    (id: string): string => cardNames.get(id) ?? id,
    [cardNames],
  );

  const resolveName = useCallback(
    (id: string): string => {
      const customName = cardNames.get(id);
      if (customName) return customName;
      const cap = capabilityMapping.capabilities.find((c) => c.id === id);
      if (cap) return cap.name;
      const dep = capabilityMapping.existingDependencies?.nodes.find(
        (n) => n.id === id,
      );
      if (dep) return dep.name;
      return id;
    },
    [capabilityMapping, cardNames],
  );

  const pollProgress = useCallback(
    (runId: string) => {
      pollRef.current = setInterval(async () => {
        try {
          const run = await api.get<ArchLensAnalysisRun>(
            `/archlens/analysis-runs/${runId}`,
          );
          if (run.results) {
            const p = (run.results as Record<string, unknown>).progress as
              | ArchLensCommitProgress
              | undefined;
            if (p) setProgress(p);
          }
          if (run.status === "completed") {
            clearInterval(pollRef.current);
            setDone(true);
            setResultData(run.results);
            setSubmitting(false);
          } else if (run.status === "failed") {
            clearInterval(pollRef.current);
            setError(run.error_message || t("archlens_commit_error"));
            setSubmitting(false);
          }
        } catch {
          // Polling errors are transient
        }
      }, 2000);
    },
    [t],
  );

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleSubmit = async () => {
    if (!name.trim() || !startDate || !endDate) return;
    setSubmitting(true);
    setError("");
    setProgress(null);
    setDone(false);

    // Build renamed cards map for backend
    const renamedCards: Record<string, string> = {};
    for (const card of newCards) {
      const customName = cardNames.get(card.id);
      if (customName && customName !== card.name) {
        renamedCards[card.id] = customName;
      }
    }

    try {
      const resp = await api.post<{ run_id: string }>(
        "/archlens/architect/commit",
        {
          assessmentId,
          initiativeName: name.trim(),
          startDate,
          endDate,
          selectedCardIds: Array.from(selectedCards),
          selectedRelationIndices: Array.from(selectedRels),
          objectiveIds,
          renamedCards: Object.keys(renamedCards).length > 0 ? renamedCards : undefined,
        },
      );
      pollProgress(resp.run_id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setSubmitting(false);
    }
  };

  const openInitiative = () => {
    const initId =
      resultData?.initiative_id ||
      (resultData as Record<string, unknown>)?.initiative_id;
    if (initId) {
      window.open(`/cards/${initId}`, "_blank");
    }
    onClose();
  };

  const progressText = useMemo(() => {
    if (!progress) return "";
    switch (progress.step) {
      case "creating_initiative":
        return t("archlens_commit_progress_initiative");
      case "creating_cards":
        return t("archlens_commit_progress_cards", {
          current: progress.current,
          total: progress.total,
        });
      case "creating_relations":
        return t("archlens_commit_progress_relations");
      case "creating_adr":
        return t("archlens_commit_progress_adr");
      default:
        return progress.step;
    }
  }, [progress, t]);

  const typeInfo = (key: string) => types.find((tp) => tp.key === key);

  return (
    <Dialog
      open={open}
      onClose={submitting ? undefined : onClose}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>
        <Stack direction="row" spacing={1} alignItems="center">
          <MaterialSymbol icon="rocket_launch" size={22} />
          <span>{t("archlens_commit_dialog_title")}</span>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        {done ? (
          <Box sx={{ textAlign: "center", py: 4 }}>
            <MaterialSymbol icon="check_circle" size={48} color="#4caf50" />
            <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
              {t("archlens_commit_success")}
            </Typography>
            {resultData && (
              <Typography variant="body2" color="text.secondary">
                {
                  (resultData as Record<string, unknown>)
                    .card_count as number
                }{" "}
                {t("archlens_architect_proposed_cards").toLowerCase()},{" "}
                {
                  (resultData as Record<string, unknown>)
                    .relation_count as number
                }{" "}
                {t("archlens_architect_proposed_relations").toLowerCase()}
              </Typography>
            )}
            <Button
              variant="contained"
              sx={{ mt: 3 }}
              onClick={openInitiative}
              startIcon={<MaterialSymbol icon="open_in_new" size={18} />}
            >
              {t("archlens_commit_open_initiative")}
            </Button>
          </Box>
        ) : submitting ? (
          <Box sx={{ py: 4 }}>
            <LinearProgress
              variant={progress ? "determinate" : "indeterminate"}
              value={
                progress
                  ? (progress.current / progress.total) * 100
                  : undefined
              }
              sx={{ mb: 2 }}
            />
            <Typography
              variant="body2"
              color="text.secondary"
              align="center"
            >
              {progressText || t("archlens_commit_progress_initiative")}
            </Typography>
            {progress?.detail && (
              <Typography
                variant="caption"
                color="text.secondary"
                align="center"
                display="block"
              >
                {progress.detail}
              </Typography>
            )}
          </Box>
        ) : (
          <Stack spacing={3} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}

            <TextField
              label={t("archlens_commit_initiative_name")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
              required
            />

            <Stack direction="row" spacing={2}>
              <TextField
                label={t("archlens_commit_start_date")}
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
                fullWidth
                required
              />
              <TextField
                label={t("archlens_commit_end_date")}
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
                fullWidth
                required
              />
            </Stack>

            {objectiveIds.length > 0 && (
              <Box>
                <Typography
                  variant="subtitle2"
                  fontWeight={700}
                  sx={{ mb: 0.5 }}
                >
                  {t("archlens_commit_objectives")} ({objectiveIds.length})
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t("archlens_commit_objectives_hint")}
                </Typography>
              </Box>
            )}

            {/* --- Proposed Cards --- */}
            <Box>
              <Typography
                variant="subtitle2"
                fontWeight={700}
                sx={{ mb: 1 }}
              >
                {t("archlens_commit_select_cards")} ({selectedCards.size}/
                {newCards.length})
              </Typography>
              <Stack spacing={0.5}>
                {newCards.map((card: ProposedCard) => {
                  const ti = typeInfo(card.cardTypeKey);
                  const isSelected = selectedCards.has(card.id);
                  const isEditing = editingCard?.id === card.id;
                  return (
                    <Stack
                      key={card.id}
                      direction="row"
                      alignItems="center"
                      spacing={0.5}
                      sx={{
                        opacity: isSelected ? 1 : 0.45,
                        transition: "opacity 0.2s",
                      }}
                    >
                      <Tooltip
                        title={
                          isSelected
                            ? t("archlens_architect_disable_card")
                            : t("archlens_architect_enable_card")
                        }
                        arrow
                      >
                        <Switch
                          size="small"
                          checked={isSelected}
                          onChange={() => toggleCard(card.id)}
                          sx={{ mr: 0.5 }}
                        />
                      </Tooltip>
                      {ti && (
                        <MaterialSymbol
                          icon={ti.icon}
                          size={14}
                          color={isSelected ? ti.color : "inherit"}
                        />
                      )}
                      {isEditing ? (
                        <>
                          <TextField
                            size="small"
                            variant="standard"
                            autoFocus
                            value={editingCard.name}
                            onChange={(e) =>
                              setEditingCard({
                                id: card.id,
                                name: e.target.value,
                              })
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                setCardNames((prev) => {
                                  const next = new Map(prev);
                                  next.set(card.id, editingCard.name);
                                  return next;
                                });
                                setEditingCard(null);
                              } else if (e.key === "Escape") {
                                setEditingCard(null);
                              }
                            }}
                            inputProps={{
                              style: { fontSize: 14, padding: 0 },
                            }}
                            sx={{ flex: 1, minWidth: 120 }}
                          />
                          <Tooltip title={t("common:actions.save")} arrow>
                            <IconButton
                              size="small"
                              color="primary"
                              onClick={() => {
                                setCardNames((prev) => {
                                  const next = new Map(prev);
                                  next.set(card.id, editingCard.name);
                                  return next;
                                });
                                setEditingCard(null);
                              }}
                            >
                              <MaterialSymbol icon="check" size={16} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={t("common:actions.cancel")} arrow>
                            <IconButton
                              size="small"
                              onClick={() => setEditingCard(null)}
                            >
                              <MaterialSymbol icon="close" size={16} />
                            </IconButton>
                          </Tooltip>
                        </>
                      ) : (
                        <>
                          <Typography
                            variant="body2"
                            sx={{
                              flex: 1,
                              textDecoration: isSelected
                                ? undefined
                                : "line-through",
                            }}
                          >
                            {getCardName(card.id)}
                          </Typography>
                          {isSelected && (
                            <Tooltip title={t("common:actions.edit")} arrow>
                              <IconButton
                                size="small"
                                onClick={() =>
                                  setEditingCard({
                                    id: card.id,
                                    name: getCardName(card.id),
                                  })
                                }
                              >
                                <MaterialSymbol icon="edit" size={14} />
                              </IconButton>
                            </Tooltip>
                          )}
                        </>
                      )}
                      {card.subtype && (
                        <Typography variant="caption" color="text.secondary">
                          ({card.subtype})
                        </Typography>
                      )}
                      <Chip
                        label={card.cardTypeKey}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: 10, height: 18 }}
                      />
                    </Stack>
                  );
                })}
              </Stack>
            </Box>

            {/* --- Proposed Relations --- */}
            {capabilityMapping.proposedRelations.length > 0 && (
              <Box>
                <Typography
                  variant="subtitle2"
                  fontWeight={700}
                  sx={{ mb: 1 }}
                >
                  {t("archlens_commit_select_relations")} (
                  {selectedRels.size}/
                  {capabilityMapping.proposedRelations.length})
                </Typography>
                <Stack spacing={0.3}>
                  {capabilityMapping.proposedRelations.map(
                    (rel: ProposedRelation, i: number) => {
                      // Check if either endpoint is a deselected new card
                      const srcNewCard = newCards.find(
                        (c) => c.id === rel.sourceId,
                      );
                      const tgtNewCard = newCards.find(
                        (c) => c.id === rel.targetId,
                      );
                      const endpointDisabled =
                        (srcNewCard && !selectedCards.has(srcNewCard.id)) ||
                        (tgtNewCard && !selectedCards.has(tgtNewCard.id)) ||
                        disabledCardIds.has(rel.sourceId) ||
                        disabledCardIds.has(rel.targetId);
                      const isSelected =
                        selectedRels.has(i) && !endpointDisabled;
                      return (
                        <Stack
                          key={i}
                          direction="row"
                          alignItems="center"
                          spacing={0.5}
                          sx={{
                            opacity: endpointDisabled ? 0.3 : isSelected ? 1 : 0.45,
                            transition: "opacity 0.2s",
                          }}
                        >
                          <Switch
                            size="small"
                            checked={isSelected}
                            disabled={endpointDisabled}
                            onChange={() => toggleRel(i)}
                            sx={{ mr: 0.5 }}
                          />
                          <Typography
                            variant="caption"
                            sx={{
                              textDecoration:
                                endpointDisabled || !isSelected
                                  ? "line-through"
                                  : undefined,
                            }}
                          >
                            {resolveName(rel.sourceId)}
                          </Typography>
                          <MaterialSymbol
                            icon="arrow_forward"
                            size={12}
                            color="#999"
                          />
                          <Typography
                            variant="caption"
                            sx={{
                              textDecoration:
                                endpointDisabled || !isSelected
                                  ? "line-through"
                                  : undefined,
                            }}
                          >
                            {resolveName(rel.targetId)}
                          </Typography>
                          {rel.label && (
                            <Chip
                              label={rel.label}
                              size="small"
                              variant="outlined"
                              sx={{ fontSize: 9, height: 16, ml: 0.5 }}
                            />
                          )}
                        </Stack>
                      );
                    },
                  )}
                </Stack>
              </Box>
            )}
          </Stack>
        )}
      </DialogContent>
      {!done && !submitting && (
        <DialogActions>
          <Button onClick={onClose}>
            {t("common:actions.cancel", "Cancel")}
          </Button>
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={!name.trim() || !startDate || !endDate}
            startIcon={<MaterialSymbol icon="rocket_launch" size={18} />}
          >
            {t("archlens_commit_submit")}
          </Button>
        </DialogActions>
      )}
    </Dialog>
  );
}
