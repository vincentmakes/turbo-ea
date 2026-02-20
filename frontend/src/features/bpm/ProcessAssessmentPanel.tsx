/**
 * ProcessAssessmentPanel — Assessment form + history chart.
 * Embedded as a tab in CardDetail for BusinessProcess type.
 */
import { useState, useEffect, useCallback } from "react";
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
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
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
  const [assessments, setAssessments] = useState<ProcessAssessment[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
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
    if (!confirm("Delete this assessment?")) return;
    await api.delete(`/bpm/processes/${processId}/assessments/${id}`);
    load();
  };

  // Chart data (oldest first)
  const chartData = [...assessments].reverse().map((a) => ({
    date: a.assessment_date,
    Overall: a.overall_score,
    Efficiency: a.efficiency,
    Effectiveness: a.effectiveness,
    Compliance: a.compliance,
    Automation: a.automation,
  }));

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 2, alignItems: "center" }}>
        <Typography variant="subtitle1">Process Assessments</Typography>
        <Button
          variant="contained"
          size="small"
          startIcon={<MaterialSymbol icon="add" />}
          onClick={() => setDialogOpen(true)}
        >
          New Assessment
        </Button>
      </Box>

      {/* Trend Chart */}
      {chartData.length > 1 && (
        <Box sx={{ mb: 3 }}>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} />
              <RTooltip />
              <Legend />
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
                <TableCell>Date</TableCell>
                <TableCell>Assessor</TableCell>
                <TableCell align="center">Overall</TableCell>
                <TableCell align="center">Efficiency</TableCell>
                <TableCell align="center">Effectiveness</TableCell>
                <TableCell align="center">Compliance</TableCell>
                <TableCell align="center">Automation</TableCell>
                <TableCell>Notes</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {assessments.map((a) => (
                <TableRow key={a.id} hover>
                  <TableCell>{a.assessment_date}</TableCell>
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
          No assessments yet. Create one to start tracking process maturity.
        </Typography>
      )}

      {/* Create Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>New Assessment</DialogTitle>
        <DialogContent>
          <TextField
            label="Date"
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
            label="Notes"
            multiline
            rows={3}
            fullWidth
            margin="normal"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit}>Save</Button>
        </DialogActions>
      </Dialog>
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
