import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useMetamodel } from "@/hooks/useMetamodel";
import { api } from "@/api/client";
import type {
  ArchLensAnalysisRun,
  ArchLensCommitProgress,
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
}

export default function CommitInitiativeDialog({
  open,
  onClose,
  assessmentId,
  requirement,
  capabilityMapping,
  objectiveIds,
}: Props) {
  const { t } = useTranslation("admin");
  const { types } = useMetamodel();

  const [name, setName] = useState(requirement.slice(0, 200));
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set());
  const [selectedRels, setSelectedRels] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<ArchLensCommitProgress | null>(null);
  const [done, setDone] = useState(false);
  const [resultData, setResultData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  const newCards = useMemo(
    () => capabilityMapping.proposedCards.filter((c) => c.isNew),
    [capabilityMapping],
  );

  // Pre-select all new cards and relations
  useEffect(() => {
    setSelectedCards(new Set(newCards.map((c) => c.id)));
    setSelectedRels(
      new Set(capabilityMapping.proposedRelations.map((_, i) => i)),
    );
  }, [newCards, capabilityMapping.proposedRelations]);

  const toggleCard = (id: string) => {
    setSelectedCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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

  const resolveName = useCallback(
    (id: string): string => {
      const card = capabilityMapping.proposedCards.find((c) => c.id === id);
      if (card) return card.name;
      const cap = capabilityMapping.capabilities.find((c) => c.id === id);
      if (cap) return cap.name;
      return id;
    },
    [capabilityMapping],
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

    try {
      const resp = await api.post<{ run_id: string }>("/archlens/architect/commit", {
        assessmentId,
        initiativeName: name.trim(),
        startDate,
        endDate,
        selectedCardIds: Array.from(selectedCards),
        selectedRelationIndices: Array.from(selectedRels),
        objectiveIds,
      });
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
    <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="md" fullWidth>
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
                {(resultData as Record<string, unknown>).card_count as number}{" "}
                {t("archlens_architect_proposed_cards").toLowerCase()},{" "}
                {(resultData as Record<string, unknown>).relation_count as number}{" "}
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
                progress ? (progress.current / progress.total) * 100 : undefined
              }
              sx={{ mb: 2 }}
            />
            <Typography variant="body2" color="text.secondary" align="center">
              {progressText || t("archlens_commit_progress_initiative")}
            </Typography>
            {progress?.detail && (
              <Typography variant="caption" color="text.secondary" align="center" display="block">
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
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
                  {t("archlens_commit_objectives")} ({objectiveIds.length})
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t("archlens_commit_objectives_hint")}
                </Typography>
              </Box>
            )}

            <Box>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                {t("archlens_commit_select_cards")} ({selectedCards.size}/
                {newCards.length})
              </Typography>
              <Stack spacing={0.5}>
                {newCards.map((card: ProposedCard) => {
                  const ti = typeInfo(card.cardTypeKey);
                  return (
                    <Stack
                      key={card.id}
                      direction="row"
                      alignItems="center"
                      spacing={1}
                      sx={{ cursor: "pointer" }}
                      onClick={() => toggleCard(card.id)}
                    >
                      <Checkbox
                        size="small"
                        checked={selectedCards.has(card.id)}
                        tabIndex={-1}
                      />
                      {ti && (
                        <MaterialSymbol icon={ti.icon} size={14} color={ti.color} />
                      )}
                      <Typography variant="body2">{card.name}</Typography>
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

            {capabilityMapping.proposedRelations.length > 0 && (
              <Box>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                  {t("archlens_commit_select_relations")} ({selectedRels.size}/
                  {capabilityMapping.proposedRelations.length})
                </Typography>
                <Stack spacing={0.3}>
                  {capabilityMapping.proposedRelations.map(
                    (rel: ProposedRelation, i: number) => (
                      <Stack
                        key={i}
                        direction="row"
                        alignItems="center"
                        spacing={0.5}
                        sx={{ cursor: "pointer" }}
                        onClick={() => toggleRel(i)}
                      >
                        <Checkbox
                          size="small"
                          checked={selectedRels.has(i)}
                          tabIndex={-1}
                        />
                        <Typography variant="caption">
                          {resolveName(rel.sourceId)}
                        </Typography>
                        <MaterialSymbol icon="arrow_forward" size={12} color="#999" />
                        <Typography variant="caption">
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
                    ),
                  )}
                </Stack>
              </Box>
            )}
          </Stack>
        )}
      </DialogContent>
      {!done && !submitting && (
        <DialogActions>
          <Button onClick={onClose}>{t("common:cancel", "Cancel")}</Button>
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
