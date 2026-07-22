/**
 * Commit dialog for an architecture plan. Simplified from the TurboLens
 * `CommitInitiativeDialog`: the commit is synchronous (no AI, no run polling).
 * Creates the Initiative, the selected proposed cards/relations, an optional
 * draft ADR, and stamps an end-of-life date on removed/replaced cards.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { CardOption } from "@/components/CardPicker";
import { api } from "@/api/client";
import type { ArchitecturePlan, PlanChangeOp, PlanCommitResult } from "@/types";
import MultiCardPicker from "./MultiCardPicker";

interface Props {
  plan: ArchitecturePlan;
  /** Human-readable one-liner per change op (from the preview page). */
  describeOp: (op: PlanChangeOp) => string;
  onClose: () => void;
  onCommitted: (result: PlanCommitResult) => void;
}

const today = () => new Date().toISOString().slice(0, 10);
const inSixMonths = () => {
  const d = new Date();
  d.setMonth(d.getMonth() + 6);
  return d.toISOString().slice(0, 10);
};

export default function PlanCommitDialog({ plan, describeOp, onClose, onCommitted }: Props) {
  const { t } = useTranslation(["delivery", "common"]);
  const navigate = useNavigate();

  const changes = useMemo(() => plan.plan_data?.changes ?? [], [plan.plan_data]);
  const scope = plan.scope ?? {};

  const [initiativeName, setInitiativeName] = useState(plan.title);
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState(inSixMonths());
  const [objectives, setObjectives] = useState<CardOption[]>(
    ((scope as Record<string, unknown>).objectiveRefs as CardOption[]) ?? [],
  );
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(changes.map((_, i) => i)),
  );
  const [renames, setRenames] = useState<Record<string, string>>({});
  const [createAdr, setCreateAdr] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PlanCommitResult | null>(null);

  const proposedCards = useMemo(() => {
    const out: { tempId: string; name: string }[] = [];
    for (const c of changes) {
      const ref = c.op === "add_card" ? c.card : c.op === "replace_card" ? c.successor : null;
      if (ref && "proposed" in ref) out.push({ tempId: ref.proposed.tempId, name: ref.proposed.name });
    }
    return out;
  }, [changes]);

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const commit = async () => {
    setCommitting(true);
    setError("");
    try {
      const res = await api.post<PlanCommitResult>(`/architecture-plans/${plan.id}/commit`, {
        initiative_name: initiativeName.trim(),
        start_date: startDate,
        end_date: endDate,
        objective_ids: objectives.map((o) => o.id),
        create_adr: createAdr,
        selected_change_indices: [...selected].sort((a, b) => a - b),
        renamed_cards: Object.fromEntries(
          Object.entries(renames).filter(([, v]) => v.trim()),
        ),
      });
      setResult(res);
      onCommitted(res);
    } catch (err) {
      setError((err as Error).message || "Commit failed");
    } finally {
      setCommitting(false);
    }
  };

  return (
    <Dialog open onClose={result ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("plan.commit.title")}</DialogTitle>
      <DialogContent>
        {result ? (
          <Stack spacing={2} sx={{ mt: 1 }} alignItems="flex-start">
            <Alert severity="success" sx={{ width: "100%" }}>
              {t("plan.commit.successTitle", {
                cards: result.card_count,
                relations: result.relation_count,
                retired: result.retired_count,
              })}
            </Alert>
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                size="small"
                onClick={() => navigate(`/cards/${result.initiative_id}`)}
                startIcon={<MaterialSymbol icon="rocket_launch" size={18} />}
              >
                {t("plan.commit.openInitiative")}
              </Button>
              {result.adr_id && (
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => navigate(`/ea-delivery/adr/${result.adr_id}`)}
                  startIcon={<MaterialSymbol icon="gavel" size={18} />}
                >
                  {t("plan.commit.openAdr", { reference: result.adr_reference })}
                </Button>
              )}
            </Stack>
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label={t("plan.commit.initiativeName")}
              value={initiativeName}
              onChange={(e) => setInitiativeName(e.target.value)}
              size="small"
              fullWidth
              required
            />
            <Stack direction="row" spacing={2}>
              <TextField
                label={t("plan.commit.startDate")}
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                size="small"
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                label={t("plan.commit.endDate")}
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                size="small"
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Stack>
            <Typography variant="subtitle2">{t("plan.commit.objectives")}</Typography>
            <MultiCardPicker
              types="Objective"
              values={objectives}
              onChange={setObjectives}
              label={t("plan.objectivesStep.placeholder")}
            />
            <Typography variant="subtitle2">{t("plan.commit.changes")}</Typography>
            <Stack spacing={0}>
              {changes.map((op, i) => (
                <FormControlLabel
                  key={i}
                  control={
                    <Checkbox size="small" checked={selected.has(i)} onChange={() => toggle(i)} />
                  }
                  label={<Typography variant="body2">{describeOp(op)}</Typography>}
                />
              ))}
            </Stack>
            {proposedCards.length > 0 && (
              <>
                <Typography variant="subtitle2">{t("plan.commit.rename")}</Typography>
                <Stack spacing={1}>
                  {proposedCards.map((c) => (
                    <TextField
                      key={c.tempId}
                      size="small"
                      label={c.name}
                      placeholder={c.name}
                      value={renames[c.tempId] ?? ""}
                      onChange={(e) =>
                        setRenames((prev) => ({ ...prev, [c.tempId]: e.target.value }))
                      }
                    />
                  ))}
                </Stack>
              </>
            )}
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={createAdr}
                  onChange={(e) => setCreateAdr(e.target.checked)}
                />
              }
              label={t("plan.commit.createAdr")}
            />
            <Alert severity="info" icon={<MaterialSymbol icon="event_busy" size={20} />}>
              {t("plan.commit.eolNote", { date: endDate })}
            </Alert>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {result ? (
          <Button onClick={onClose}>{t("common:actions.close")}</Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={committing}>
              {t("common:actions.cancel")}
            </Button>
            <Button
              variant="contained"
              onClick={commit}
              disabled={
                committing || !initiativeName.trim() || !startDate || !endDate || selected.size === 0
              }
              startIcon={
                committing ? <CircularProgress size={16} /> : <MaterialSymbol icon="rocket_launch" size={18} />
              }
            >
              {t("plan.commit.submit")}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
