/**
 * "Record as decided": lock a draft as a decision taken outside Turbo EA. It
 * is labelled "Recorded", never "Signed", and needs `adr.record`. The decision
 * makers it names must already be on the decision; the backend checks the
 * saved list, so the page saves first through `prepare`.
 */
import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";

import { api } from "@/api/client";
import { DateField } from "@/components/DateField";
import type { ArchitectureDecision, DecisionPerson } from "@/types";
import DecisionPeopleField from "./DecisionPeopleField";
import { problemMessage } from "./decisionProblems";

/** Today as a local `yyyy-mm-dd`. */
export function todayIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export type RecordProblem = "decided_on_missing" | "decided_on_future" | "no_decision_maker";

const RECORD_PROBLEM_KEYS: Record<RecordProblem, string> = {
  decided_on_missing: "adr.record.decidedOnRequired",
  decided_on_future: "adr.record.decidedOnFuture",
  no_decision_maker: "adr.record.noDecisionMaker",
};

/** What stops the dialog from submitting, in field order. ISO dates compare as strings. */
export function recordProblems(
  decidedOn: string,
  decisionMakers: DecisionPerson[],
  today: string,
): RecordProblem[] {
  const out: RecordProblem[] = [];
  if (!decidedOn) out.push("decided_on_missing");
  else if (decidedOn > today) out.push("decided_on_future");
  if (decisionMakers.length === 0) out.push("no_decision_maker");
  return out;
}

/** The body of `POST /adr/{id}/record`; an empty "Effective from" is left to default. */
export function recordPayload(
  decidedOn: string,
  effectiveFrom: string,
): { decided_on: string; effective_from?: string } {
  return effectiveFrom ? { decided_on: decidedOn, effective_from: effectiveFrom } : { decided_on: decidedOn };
}

export interface RecordAsDecidedDialogProps {
  open: boolean;
  adrId: string;
  decisionMakers: DecisionPerson[];
  onClose: () => void;
  /** Called with the recorded decision. */
  onRecorded: (adr: ArchitectureDecision) => void;
  /** Runs before the record request (the editor saves its pending edits); throw to stop. */
  prepare?: () => Promise<void>;
  /** Injectable "today" (`yyyy-mm-dd`), for tests. */
  today?: string;
}

export default function RecordAsDecidedDialog({
  open,
  adrId,
  decisionMakers,
  onClose,
  onRecorded,
  prepare,
  today,
}: RecordAsDecidedDialogProps) {
  const { t } = useTranslation(["delivery", "common"]);
  const [decidedOn, setDecidedOn] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDecidedOn("");
    setEffectiveFrom("");
    setError("");
    setTried(false);
  }, [open]);

  const problems = recordProblems(decidedOn, decisionMakers, today ?? todayIso());
  const shown = tried ? problems : problems.filter((p) => p !== "decided_on_missing");

  const handleSubmit = async () => {
    setTried(true);
    if (problems.length > 0) return;
    setSubmitting(true);
    setError("");
    try {
      if (prepare) await prepare();
      const recorded = await api.post<ArchitectureDecision>(
        `/adr/${adrId}/record`,
        recordPayload(decidedOn, effectiveFrom),
      );
      onRecorded(recorded);
    } catch (err) {
      setError(problemMessage(err, t) ?? t("adr.record.failed"));
    } finally {
      setSubmitting(false);
    }
  };

  const fieldError = (p: RecordProblem) => (shown.includes(p) ? t(RECORD_PROBLEM_KEYS[p]) : undefined);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth disableRestoreFocus>
      <DialogTitle>{t("adr.record.title")}</DialogTitle>
      <DialogContent>
        <Alert severity="info" sx={{ mb: 2 }}>
          {t("adr.record.explanation")}
        </Alert>
        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", mt: 1 }}>
          <DateField
            label={t("adr.dates.decidedOn")}
            value={decidedOn}
            onChange={setDecidedOn}
            required
            size="small"
            error={Boolean(fieldError("decided_on_missing") ?? fieldError("decided_on_future"))}
            helperText={fieldError("decided_on_missing") ?? fieldError("decided_on_future")}
            slotProps={{ htmlInput: { max: today ?? todayIso(), "data-testid": "record-decided-on" } }}
          />
          <DateField
            label={t("adr.dates.effectiveFrom")}
            value={effectiveFrom}
            onChange={setEffectiveFrom}
            size="small"
            helperText={t("adr.record.effectiveFromHint")}
            slotProps={{ htmlInput: { "data-testid": "record-effective-from" } }}
          />
        </Box>
        <Box sx={{ mt: 2 }}>
          <DecisionPeopleField part="decision_makers" value={decisionMakers} readOnly />
          {fieldError("no_decision_maker") && (
            <Typography variant="body2" color="error" sx={{ mt: 0.5 }}>
              {fieldError("no_decision_maker")}
            </Typography>
          )}
        </Box>
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={submitting || shown.length > 0}
        >
          {submitting ? t("adr.record.submitting") : t("adr.record.submit")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
