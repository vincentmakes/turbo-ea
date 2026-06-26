/**
 * ProcessAssessmentPanel — Assessment form + history chart.
 * Embedded as a tab in CardDetail for BusinessProcess type.
 */
import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Slider from "@mui/material/Slider";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableContainer from "@mui/material/TableContainer";
import Paper from "@mui/material/Paper";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Drawer from "@mui/material/Drawer";
import Divider from "@mui/material/Divider";
import { useTheme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useIsRtl } from "@/hooks/useIsRtl";
import { makeRtlAxisTick, rtlLegendItemStyle, rtlTooltipStyle } from "@/lib/rechartsRtl";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  Legend, ResponsiveContainer,
} from "recharts";
import type { ProcessAssessment } from "@/types";

interface Props {
  processId: string;
}

const DIMENSIONS = [
  { key: "overall_score", label: "Overall", color: "#1976d2" },
  { key: "efficiency", label: "Efficiency", color: "#4caf50" },
  { key: "effectiveness", label: "Effectiveness", color: "#ff9800" },
  { key: "compliance", label: "Compliance", color: "#9c27b0" },
  { key: "automation", label: "Automation", color: "#00bcd4" },
];

export default function ProcessAssessmentPanel({ processId }: Props) {
  const { t } = useTranslation(["bpm", "common"]);
  const theme = useTheme();
  const isRtl = useIsRtl();
  const rtlAxisTick = makeRtlAxisTick(theme.palette.text.secondary, 11);
  const { formatDate } = useDateFormat();
  const [assessments, setAssessments] = useState<ProcessAssessment[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [form, setForm] = useState({
    assessment_date: new Date().toISOString().split("T")[0],
    overall_score: 3,
    efficiency: 3,
    effectiveness: 3,
    compliance: 3,
    automation: 3,
    notes: "",
  });

  const load = useCallback(async () => {
    try {
      const data = await api.get<ProcessAssessment[]>(`/bpm/processes/${processId}/assessments`);
      setAssessments(data || []);
    } catch {
      setAssessments([]);
    }
  }, [processId]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async () => {
    try {
      await api.post(`/bpm/processes/${processId}/assessments`, form);
      setDialogOpen(false);
      load();
    } catch (err) {
      console.error("Failed to create assessment:", err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("assessment.confirmDelete"))) return;
    await api.delete(`/bpm/processes/${processId}/assessments/${id}`);
    load();
  };

  // Chart data (oldest first)
  const chartData = [...assessments].reverse().map((a) => ({
    date: formatDate(a.assessment_date),
    Overall: a.overall_score,
    Efficiency: a.efficiency,
    Effectiveness: a.effectiveness,
    Compliance: a.compliance,
    Automation: a.automation,
  }));

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 2, alignItems: "center" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="subtitle1">{t("assessment.title")}</Typography>
          <Tooltip title={t("assessment.helpButton")}>
            <IconButton
              color="primary"
              onClick={() => setHelpOpen(true)}
              aria-label={t("assessment.helpButton")}
              sx={{
                bgcolor: (theme) => theme.palette.primary.main + "14",
                "&:hover": {
                  bgcolor: (theme) => theme.palette.primary.main + "29",
                },
              }}
            >
              <MaterialSymbol icon="help_outline" size={22} />
            </IconButton>
          </Tooltip>
        </Box>
        <Button
          variant="contained"
          size="small"
          startIcon={<MaterialSymbol icon="add" />}
          onClick={() => setDialogOpen(true)}
        >
          {t("assessment.newAssessment")}
        </Button>
      </Box>

      {/* Trend Chart */}
      {chartData.length > 1 && (
        <Box sx={{ mb: 3 }}>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
              <XAxis
                dataKey="date"
                reversed={isRtl}
                tick={{ fill: theme.palette.text.secondary, fontSize: 11 }}
                tickMargin={8}
                minTickGap={16}
              />
              <YAxis
                domain={[1, 5]}
                ticks={[1, 2, 3, 4, 5]}
                orientation={isRtl ? "right" : "left"}
                tick={isRtl ? rtlAxisTick : { fill: theme.palette.text.secondary, fontSize: 11 }}
                width={28}
              />
              <RTooltip
                contentStyle={{
                  backgroundColor: theme.palette.background.paper,
                  borderColor: theme.palette.divider,
                  color: theme.palette.text.primary,
                  fontSize: 12,
                  ...rtlTooltipStyle(isRtl),
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 12, direction: isRtl ? "rtl" : "ltr" }}
                formatter={(value: string) => (
                  <span style={rtlLegendItemStyle(isRtl, theme.palette.text.primary)}>{value}</span>
                )}
              />
              {DIMENSIONS.map((d) => (
                <Line
                  key={d.key}
                  type="monotone"
                  dataKey={d.label}
                  stroke={d.color}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </Box>
      )}

      {/* History Table */}
      {assessments.length > 0 ? (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t("common:labels.date")}</TableCell>
                <TableCell>{t("assessment.assessor")}</TableCell>
                <TableCell align="center">{t("assessment.overall")}</TableCell>
                <TableCell align="center">{t("assessment.efficiency")}</TableCell>
                <TableCell align="center">{t("assessment.effectiveness")}</TableCell>
                <TableCell align="center">{t("assessment.compliance")}</TableCell>
                <TableCell align="center">{t("assessment.automation")}</TableCell>
                <TableCell>{t("assessment.notes")}</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {assessments.map((a) => (
                <TableRow key={a.id} hover>
                  <TableCell>{formatDate(a.assessment_date)}</TableCell>
                  <TableCell>{a.assessor_name || "—"}</TableCell>
                  <TableCell align="center"><ScoreChip score={a.overall_score} /></TableCell>
                  <TableCell align="center"><ScoreChip score={a.efficiency} /></TableCell>
                  <TableCell align="center"><ScoreChip score={a.effectiveness} /></TableCell>
                  <TableCell align="center"><ScoreChip score={a.compliance} /></TableCell>
                  <TableCell align="center"><ScoreChip score={a.automation} /></TableCell>
                  <TableCell sx={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {a.notes || "—"}
                  </TableCell>
                  <TableCell>
                    <IconButton size="small" onClick={() => handleDelete(a.id)}>
                      <MaterialSymbol icon="delete" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <Typography color="text.secondary" sx={{ textAlign: "center", py: 3 }}>
          {t("assessment.noAssessments")}
        </Typography>
      )}

      {/* Create Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t("assessment.newAssessment")}</DialogTitle>
        <DialogContent>
          <TextField
            label={t("common:labels.date")}
            type="date"
            fullWidth
            margin="normal"
            value={form.assessment_date}
            onChange={(e) => setForm({ ...form, assessment_date: e.target.value })}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          {DIMENSIONS.map((d) => (
            <Box key={d.key} sx={{ mt: 2 }}>
              <Typography variant="body2" gutterBottom>
                {d.label}: {(form as any)[d.key]}
              </Typography>
              <Slider
                value={(form as any)[d.key]}
                onChange={(_, v) => setForm({ ...form, [d.key]: v as number })}
                min={1}
                max={5}
                step={1}
                marks={[
                  { value: 1, label: "1" },
                  { value: 2, label: "2" },
                  { value: 3, label: "3" },
                  { value: 4, label: "4" },
                  { value: 5, label: "5" },
                ]}
              />
            </Box>
          ))}
          <TextField
            label={t("assessment.notes")}
            multiline
            rows={3}
            fullWidth
            margin="normal"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{t("common:actions.cancel")}</Button>
          <Button variant="contained" onClick={handleSubmit}>{t("common:actions.save")}</Button>
        </DialogActions>
      </Dialog>

      {/* Help / Guide Drawer */}
      <Drawer
        anchor="right"
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        PaperProps={{ sx: { width: { xs: "100%", sm: 420 } } }}
      >
        <Box sx={{ p: 2.5 }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <MaterialSymbol icon="help_outline" size={22} />
              <Typography variant="h6">{t("assessment.helpTitle")}</Typography>
            </Box>
            <IconButton size="small" onClick={() => setHelpOpen(false)}>
              <MaterialSymbol icon="close" size={20} />
            </IconButton>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("assessment.helpIntro")}
          </Typography>

          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {t("assessment.helpDimensions")}
          </Typography>
          {[
            { title: "helpEfficiencyTitle", desc: "helpEfficiencyDesc", color: "#4caf50" },
            { title: "helpEffectivenessTitle", desc: "helpEffectivenessDesc", color: "#ff9800" },
            { title: "helpComplianceTitle", desc: "helpComplianceDesc", color: "#9c27b0" },
            { title: "helpAutomationTitle", desc: "helpAutomationDesc", color: "#00bcd4" },
            { title: "helpOverallTitle", desc: "helpOverallDesc", color: "#1976d2" },
          ].map((d) => (
            <Box
              key={d.title}
              sx={{
                mb: 1.5,
                pl: 1.5,
                borderLeft: `3px solid ${d.color}`,
              }}
            >
              <Typography variant="body2" fontWeight={600}>
                {t(`assessment.${d.title}`)}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", lineHeight: 1.5 }}>
                {t(`assessment.${d.desc}`)}
              </Typography>
            </Box>
          ))}

          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {t("assessment.helpBestPracticesTitle")}
          </Typography>
          <Box component="ul" sx={{ pl: 2.5, m: 0, "& li": { mb: 0.75 } }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <li key={n}>
                <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.5 }}>
                  {t(`assessment.helpBestPractice${n}`)}
                </Typography>
              </li>
            ))}
          </Box>

          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            {t("assessment.helpReferencesTitle")}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t("assessment.helpReferences")}
          </Typography>
        </Box>
      </Drawer>
    </Box>
  );
}

function ScoreChip({ score }: { score: number }) {
  const colors: Record<number, "error" | "warning" | "default" | "info" | "success"> = {
    1: "error",
    2: "warning",
    3: "default",
    4: "info",
    5: "success",
  };
  return <Chip label={score} size="small" color={colors[score] || "default"} />;
}
