import { useState, useEffect } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Chip from "@mui/material/Chip";
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
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { PpmRisk } from "@/types";

interface UserOption {
  id: string;
  display_name: string;
  email: string;
}

function scoreColor(score: number): string {
  if (score >= 15) return "#d32f2f";
  if (score >= 6) return "#ed6c02";
  return "#2e7d32";
}

const STATUS_COLORS: Record<string, "default" | "error" | "warning" | "success" | "info"> = {
  open: "error",
  mitigating: "warning",
  mitigated: "success",
  closed: "default",
  accepted: "info",
};

interface Props {
  initiativeId: string;
  risks: PpmRisk[];
  onRefresh: () => void;
}

export default function PpmRiskTab({ initiativeId, risks, onRefresh }: Props) {
  const { t } = useTranslation("ppm");
  const [dialog, setDialog] = useState<{ open: boolean; item?: PpmRisk }>({
    open: false,
  });
  const [users, setUsers] = useState<UserOption[]>([]);
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

  const openRisks = risks.filter((r) => r.status === "open").length;
  const highRisks = risks.filter((r) => r.risk_score >= 15).length;

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
    setDialog({ open: true, item });
  };

  const handleSave = async () => {
    const payload = {
      ...form,
      description: form.description || null,
      mitigation: form.mitigation || null,
    };
    if (dialog.item) {
      await api.patch(`/ppm/risks/${dialog.item.id}`, payload);
    } else {
      await api.post(`/ppm/initiatives/${initiativeId}/risks`, payload);
    }
    setDialog({ open: false });
    onRefresh();
  };

  const handleDelete = async (id: string) => {
    await api.delete(`/ppm/risks/${id}`);
    onRefresh();
  };

  return (
    <Box>
      {/* Summary */}
      <Paper
        sx={{
          display: "flex",
          gap: 4,
          px: 3,
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
            {risks.length}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            {t("riskStatusOpen")}
          </Typography>
          <Typography variant="h6" fontWeight={600} color="error">
            {openRisks}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            {t("highRisks")}
          </Typography>
          <Typography variant="h6" fontWeight={600} color="error">
            {highRisks}
          </Typography>
        </Box>
      </Paper>

      {/* Add Button */}
      <Box display="flex" justifyContent="flex-end" mb={2}>
        <Button
          variant="contained"
          size="small"
          startIcon={<MaterialSymbol icon="add" size={18} />}
          onClick={() => handleOpen()}
        >
          {t("addRisk")}
        </Button>
      </Box>

      {/* Table */}
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t("riskTitle")}</TableCell>
              <TableCell align="center" width={60}>
                {t("probability")}
              </TableCell>
              <TableCell align="center" width={60}>
                {t("impact")}
              </TableCell>
              <TableCell align="center" width={60}>
                {t("riskScore")}
              </TableCell>
              <TableCell>{t("riskStatus")}</TableCell>
              <TableCell>{t("riskOwner")}</TableCell>
              <TableCell>{t("mitigation")}</TableCell>
              <TableCell width={80} />
            </TableRow>
          </TableHead>
          <TableBody>
            {risks.map((risk) => (
              <TableRow key={risk.id} hover>
                <TableCell>
                  <Typography variant="body2" fontWeight={500}>
                    {risk.title}
                  </Typography>
                  {risk.description && (
                    <Typography variant="caption" color="text.secondary">
                      {risk.description.length > 80
                        ? `${risk.description.slice(0, 80)}...`
                        : risk.description}
                    </Typography>
                  )}
                </TableCell>
                <TableCell align="center">{risk.probability}</TableCell>
                <TableCell align="center">{risk.impact}</TableCell>
                <TableCell align="center">
                  <Chip
                    label={risk.risk_score}
                    size="small"
                    sx={{
                      bgcolor: scoreColor(risk.risk_score),
                      color: "#fff",
                      fontWeight: 700,
                      minWidth: 32,
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Chip
                    label={t(`riskStatus${risk.status.charAt(0).toUpperCase()}${risk.status.slice(1)}`)}
                    size="small"
                    color={STATUS_COLORS[risk.status] || "default"}
                    variant="outlined"
                  />
                </TableCell>
                <TableCell>
                  <Typography variant="caption">
                    {risk.owner_name || "\u2014"}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="caption" noWrap sx={{ maxWidth: 200, display: "block" }}>
                    {risk.mitigation || "\u2014"}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Box display="flex" gap={0.5}>
                    <IconButton size="small" onClick={() => handleOpen(risk)}>
                      <MaterialSymbol icon="edit" size={16} />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => handleDelete(risk.id)}
                    >
                      <MaterialSymbol icon="delete" size={16} />
                    </IconButton>
                  </Box>
                </TableCell>
              </TableRow>
            ))}
            {risks.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 3 }}>
                  <Typography color="text.secondary">
                    {t("noRisks")}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Dialog */}
      {dialog.open && (
        <Dialog
          open
          onClose={() => setDialog({ open: false })}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>
            {dialog.item ? t("editRisk") : t("addRisk")}
          </DialogTitle>
          <DialogContent>
            <Box display="flex" flexDirection="column" gap={2} mt={1}>
              <TextField
                label={t("riskTitle")}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                fullWidth
                size="small"
              />
              <TextField
                label={t("common:description", "Description")}
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
                <InputLabel>{t("riskStatus")}</InputLabel>
                <Select
                  value={form.status}
                  label={t("riskStatus")}
                  onChange={(e) =>
                    setForm({ ...form, status: e.target.value })
                  }
                >
                  {["open", "mitigating", "mitigated", "closed", "accepted"].map(
                    (s) => (
                      <MenuItem key={s} value={s}>
                        {t(`riskStatus${s.charAt(0).toUpperCase()}${s.slice(1)}`)}
                      </MenuItem>
                    ),
                  )}
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
              disabled={!form.title}
            >
              {t("common:actions.save", "Save")}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}
