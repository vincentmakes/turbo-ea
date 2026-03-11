import { useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import type { PpmStatusReport, PpmHealthValue } from "@/types";

interface Props {
  initiativeId: string;
  report?: PpmStatusReport;
  onClose: () => void;
  onSaved: () => void;
}

const RAG_COLORS: Record<string, string> = {
  onTrack: "#2e7d32",
  atRisk: "#ed6c02",
  offTrack: "#d32f2f",
};

export default function StatusReportDialog({
  initiativeId,
  report,
  onClose,
  onSaved,
}: Props) {
  const { t } = useTranslation("ppm");
  const isEdit = !!report;

  const [reportDate, setReportDate] = useState(
    report?.report_date || new Date().toISOString().slice(0, 10),
  );
  const [scheduleHealth, setScheduleHealth] = useState<PpmHealthValue>(
    (report?.schedule_health as PpmHealthValue) || "onTrack",
  );
  const [costHealth, setCostHealth] = useState<PpmHealthValue>(
    (report?.cost_health as PpmHealthValue) || "onTrack",
  );
  const [scopeHealth, setScopeHealth] = useState<PpmHealthValue>(
    (report?.scope_health as PpmHealthValue) || "onTrack",
  );
  const [summary, setSummary] = useState(report?.summary || "");
  const [accomplishments, setAccomplishments] = useState(
    report?.accomplishments || "",
  );
  const [nextSteps, setNextSteps] = useState(report?.next_steps || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        report_date: reportDate,
        schedule_health: scheduleHealth,
        cost_health: costHealth,
        scope_health: scopeHealth,
        summary: summary || null,
        accomplishments: accomplishments || null,
        next_steps: nextSteps || null,
      };
      if (isEdit) {
        await api.patch(`/ppm/reports/${report.id}`, payload);
      } else {
        await api.post(`/ppm/initiatives/${initiativeId}/reports`, payload);
      }
      onSaved();
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const HealthToggle = ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: PpmHealthValue;
    onChange: (v: PpmHealthValue) => void;
  }) => (
    <Box>
      <Typography variant="caption" fontWeight={600} mb={0.5} display="block">
        {label}
      </Typography>
      <ToggleButtonGroup
        value={value}
        exclusive
        onChange={(_, v) => v && onChange(v)}
        size="small"
      >
        {(["onTrack", "atRisk", "offTrack"] as const).map((v) => (
          <ToggleButton
            key={v}
            value={v}
            sx={{
              px: 1.5,
              "&.Mui-selected": {
                bgcolor: RAG_COLORS[v],
                color: "#fff",
                "&:hover": { bgcolor: RAG_COLORS[v] },
              },
            }}
          >
            {t(`health_${v}`)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Box>
  );

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{isEdit ? t("editReport") : t("addReport")}</DialogTitle>
      <DialogContent>
        <Box display="flex" flexDirection="column" gap={2.5} mt={1}>
          <TextField
            label={t("reportDate")}
            type="date"
            value={reportDate}
            onChange={(e) => setReportDate(e.target.value)}
            size="small"
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ maxWidth: 200 }}
          />

          <Box display="flex" gap={3} flexWrap="wrap">
            <HealthToggle
              label={t("health_schedule")}
              value={scheduleHealth}
              onChange={setScheduleHealth}
            />
            <HealthToggle
              label={t("health_cost")}
              value={costHealth}
              onChange={setCostHealth}
            />
            <HealthToggle
              label={t("health_scope")}
              value={scopeHealth}
              onChange={setScopeHealth}
            />
          </Box>

          <TextField
            label={t("summary")}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            multiline
            rows={3}
            fullWidth
          />

          <TextField
            label={t("accomplishments")}
            value={accomplishments}
            onChange={(e) => setAccomplishments(e.target.value)}
            multiline
            rows={3}
            fullWidth
          />

          <TextField
            label={t("nextSteps")}
            value={nextSteps}
            onChange={(e) => setNextSteps(e.target.value)}
            multiline
            rows={3}
            fullWidth
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel", "Cancel")}</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={16} /> : undefined}
        >
          {isEdit ? t("common:actions.save", "Save") : t("addReport")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
