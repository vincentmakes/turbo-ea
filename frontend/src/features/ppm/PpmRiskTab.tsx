import { useState, useEffect } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Slider from "@mui/material/Slider";
import Autocomplete from "@mui/material/Autocomplete";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useSubmitOnce } from "@/hooks/useSubmitOnce";
import { useFullScreenDialog } from "@/hooks/useFullScreenDialog";
import type { PpmRisk } from "@/types";
import PpmRiskGrid from "./PpmRiskGrid";
import PpmRiskImportDialog from "./PpmRiskImportDialog";
import { RISK_STATUSES, riskStatusLabel, riskSummary } from "./ppmRiskModel";

interface UserOption {
  id: string;
  display_name: string;
  email: string;
}

interface Props {
  initiativeId: string;
  risks: PpmRisk[];
  onRefresh: () => void;
  /** The initiative's name, for the export's file name. */
  initiativeName?: string;
}

export default function PpmRiskTab({ initiativeId, risks, onRefresh, initiativeName }: Props) {
  const { t } = useTranslation("ppm");
  const [importOpen, setImportOpen] = useState(false);
  const fullScreen = useFullScreenDialog();
  const [dialog, setDialog] = useState<{ open: boolean; item?: PpmRisk }>({
    open: false,
  });
  const [users, setUsers] = useState<UserOption[]>([]);
  // A failed save, shown in the dialog; a failed delete, shown above the table.
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // The save is in flight: Save is disabled, and a second click that lands
  // before that re-render is ignored.
  const { busy: saving, run: submit } = useSubmitOnce();
  const [form, setForm] = useState({
    title: "",
    description: "",
    probability: 3,
    impact: 3,
    mitigation: "",
    owner_id: null as string | null,
    status: "open" as string,
  });

  useEffect(() => {
    api.get<UserOption[]>("/users").then(setUsers).catch(() => {});
  }, []);

  const errorText = (err: unknown) =>
    err instanceof Error ? err.message : t("common:errors.generic");

  const summary = riskSummary(risks);

  const handleOpen = (item?: PpmRisk) => {
    if (item) {
      setForm({
        title: item.title,
        description: item.description || "",
        probability: item.probability,
        impact: item.impact,
        mitigation: item.mitigation || "",
        owner_id: item.owner_id,
        status: item.status,
      });
    } else {
      setForm({
        title: "",
        description: "",
        probability: 3,
        impact: 3,
        mitigation: "",
        owner_id: null,
        status: "open",
      });
    }
    setSaveError(null);
    setDialog({ open: true, item });
  };

  const handleSave = () =>
    submit(async () => {
      const payload = {
        ...form,
        description: form.description || null,
        mitigation: form.mitigation || null,
      };
      try {
        if (dialog.item) {
          await api.patch(`/ppm/risks/${dialog.item.id}`, payload);
        } else {
          await api.post(`/ppm/initiatives/${initiativeId}/risks`, payload);
        }
      } catch (err) {
        setSaveError(errorText(err));
        return;
      }
      // Stryker disable next-line ObjectLiteral: a dialog state without `open` is closed
      setDialog({ open: false });
      onRefresh();
    });

  const handleDelete = async (id: string) => {
    setDeleteError(null);
    try {
      await api.delete(`/ppm/risks/${id}`);
    } catch (err) {
      setDeleteError(errorText(err));
      return;
    }
    onRefresh();
  };

  return (
    <Box>
      {/* Summary */}
      <Paper
        sx={{
          display: "flex",
          flexWrap: "wrap",
          gap: { xs: 2, sm: 4 },
          rowGap: 1,
          px: { xs: 2, sm: 3 },
          py: 1.5,
          mb: 2,
          alignItems: "center",
        }}
        variant="outlined"
      >
        <Box>
          <Typography variant="caption" color="text.secondary">
            {t("totalRisks")}
          </Typography>
          <Typography variant="h6" fontWeight={600}>
            {summary.total}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            {t("riskStatusOpen")}
          </Typography>
          <Typography variant="h6" fontWeight={600} color="error">
            {summary.open}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            {t("highRisks")}
          </Typography>
          <Typography variant="h6" fontWeight={600} color="error">
            {summary.high}
          </Typography>
        </Box>
      </Paper>

      {deleteError && (
        // Stryker disable next-line ObjectLiteral: spacing is presentation
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setDeleteError(null)}>
          {deleteError}
        </Alert>
      )}

      {/* Grid, with its sidebar and toolbar (Group by, Export, Import, Add) */}
      <PpmRiskGrid
        risks={risks}
        initiativeName={initiativeName}
        onAdd={() => handleOpen()}
        onEdit={handleOpen}
        onDelete={handleDelete}
        onImport={() => setImportOpen(true)}
      />

      <PpmRiskImportDialog
        open={importOpen}
        initiativeId={initiativeId}
        existingRisks={risks}
        onClose={() => setImportOpen(false)}
        onImported={onRefresh}
      />

      {/* Dialog */}
      {dialog.open && (
        <Dialog
          open
          onClose={() => setDialog({ open: false })}
          maxWidth="sm"
          fullWidth
          fullScreen={fullScreen}
        >
          <DialogTitle>
            {dialog.item ? t("editRisk") : t("addRisk")}
          </DialogTitle>
          <DialogContent>
            {saveError && (
              // Stryker disable next-line ObjectLiteral: spacing is presentation
              <Alert severity="error" sx={{ mb: 1 }}>
                {saveError}
              </Alert>
            )}
            <Box display="flex" flexDirection="column" gap={2} mt={1}>
              <TextField
                label={t("riskTitle")}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                fullWidth
                size="small"
              />
              <TextField
                label={t("common:labels.description")}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                fullWidth
                size="small"
                multiline
                rows={2}
              />
              <Box>
                <Typography variant="caption" fontWeight={600}>
                  {t("probability")}: {form.probability}
                </Typography>
                <Slider
                  value={form.probability}
                  onChange={(_, v) =>
                    setForm({ ...form, probability: v as number })
                  }
                  min={1}
                  max={5}
                  step={1}
                  marks
                  sx={{ maxWidth: 300 }}
                />
              </Box>
              <Box>
                <Typography variant="caption" fontWeight={600}>
                  {t("impact")}: {form.impact}
                </Typography>
                <Slider
                  value={form.impact}
                  onChange={(_, v) =>
                    setForm({ ...form, impact: v as number })
                  }
                  min={1}
                  max={5}
                  step={1}
                  marks
                  sx={{ maxWidth: 300 }}
                />
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {t("riskScore")}: {form.probability * form.impact}
                </Typography>
              </Box>
              <TextField
                label={t("mitigation")}
                value={form.mitigation}
                onChange={(e) =>
                  setForm({ ...form, mitigation: e.target.value })
                }
                fullWidth
                size="small"
                multiline
                rows={2}
              />
              <Autocomplete
                options={users}
                getOptionLabel={(u) => u.display_name || u.email}
                value={users.find((u) => u.id === form.owner_id) || null}
                onChange={(_, v) =>
                  setForm({ ...form, owner_id: v?.id || null })
                }
                renderInput={(params) => (
                  <TextField {...params} label={t("riskOwner")} size="small" />
                )}
                size="small"
              />
              <FormControl size="small">
                <InputLabel id="ppm-risk-status-label">{t("riskStatus")}</InputLabel>
                <Select
                  labelId="ppm-risk-status-label"
                  value={form.status}
                  label={t("riskStatus")}
                  onChange={(e) =>
                    setForm({ ...form, status: e.target.value })
                  }
                >
                  {RISK_STATUSES.map((s) => (
                    <MenuItem key={s} value={s}>
                      {riskStatusLabel(s, t)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDialog({ open: false })}>
              {t("common:actions.cancel", "Cancel")}
            </Button>
            <Button
              variant="contained"
              onClick={handleSave}
              disabled={!form.title || saving}
            >
              {t("common:actions.save", "Save")}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}
