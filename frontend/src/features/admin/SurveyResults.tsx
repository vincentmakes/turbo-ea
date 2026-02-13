import { useEffect, useState, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Card from "@mui/material/Card";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import LinearProgress from "@mui/material/LinearProgress";
import Checkbox from "@mui/material/Checkbox";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { Survey, SurveyResponseDetail } from "@/types";

function formatValue(val: unknown): string {
  if (val === null || val === undefined || val === "") return "—";
  if (typeof val === "boolean") return val ? "Yes" : "No";
  if (Array.isArray(val)) return val.join(", ");
  return String(val);
}

export default function SurveyResults() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [survey, setSurvey] = useState<Survey | null>(null);
  const [responses, setResponses] = useState<SurveyResponseDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [closing, setClosing] = useState(false);
  const [detailResp, setDetailResp] = useState<SurveyResponseDetail | null>(null);

  const fetchData = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [s, r] = await Promise.all([
        api.get<Survey>(`/surveys/${id}`),
        api.get<SurveyResponseDetail[]>(`/surveys/${id}/responses`),
      ]);
      setSurvey(s);
      setResponses(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const filtered = useMemo(() => {
    if (tab === 0) return responses;
    if (tab === 1) return responses.filter((r) => r.status === "completed");
    if (tab === 2) return responses.filter((r) => r.status === "pending");
    return responses.filter((r) => r.applied);
  }, [responses, tab]);

  const completedCount = responses.filter((r) => r.status === "completed").length;
  const pendingCount = responses.filter((r) => r.status === "pending").length;
  const appliedCount = responses.filter((r) => r.applied).length;
  const pct = responses.length > 0 ? Math.round((completedCount / responses.length) * 100) : 0;

  const toggleSelect = (rid: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rid)) next.delete(rid);
      else next.add(rid);
      return next;
    });
  };

  const toggleAll = () => {
    const applicable = filtered.filter((r) => r.status === "completed" && !r.applied);
    if (selected.size === applicable.length && applicable.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(applicable.map((r) => r.id)));
    }
  };

  const handleApply = async () => {
    if (selected.size === 0 || !id) return;
    setApplying(true);
    setError("");
    try {
      const result = await api.post<{ applied: number; errors: { response_id: string; error: string }[] }>(
        `/surveys/${id}/apply`,
        { response_ids: Array.from(selected) },
      );
      if (result.errors.length > 0) {
        setError(`Applied ${result.applied}, but ${result.errors.length} error(s): ${result.errors.map((e) => e.error).join(", ")}`);
      }
      setSelected(new Set());
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply");
    } finally {
      setApplying(false);
    }
  };

  const handleClose = async () => {
    if (!id) return;
    setClosing(true);
    try {
      const s = await api.post<Survey>(`/surveys/${id}/close`, {});
      setSurvey(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to close survey");
    } finally {
      setClosing(false);
    }
  };

  // Check if a response has any changes (not just confirmations)
  const hasChanges = (resp: SurveyResponseDetail) => {
    return Object.values(resp.responses).some(
      (r) => !r.confirmed && r.new_value !== null && r.new_value !== undefined,
    );
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!survey) {
    return <Alert severity="error">Survey not found</Alert>;
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1 }}>
        <Tooltip title="Back to Surveys">
          <IconButton onClick={() => navigate("/admin/surveys")}>
            <MaterialSymbol icon="arrow_back" size={22} />
          </IconButton>
        </Tooltip>
        <MaterialSymbol icon="assignment" size={28} color="#1976d2" />
        <Typography variant="h5" sx={{ fontWeight: 700, flex: 1 }}>
          {survey.name}
        </Typography>
        <Chip
          label={survey.status.charAt(0).toUpperCase() + survey.status.slice(1)}
          size="small"
          color={survey.status === "active" ? "info" : survey.status === "closed" ? "success" : "default"}
        />
        {survey.status === "active" && (
          <Button
            variant="outlined"
            color="warning"
            size="small"
            onClick={handleClose}
            disabled={closing}
            sx={{ textTransform: "none" }}
          >
            {closing ? "Closing..." : "Close Survey"}
          </Button>
        )}
      </Box>

      {survey.description && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {survey.description}
        </Typography>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {/* Stats */}
      <Box sx={{ display: "flex", gap: 2, mb: 3 }}>
        <Card variant="outlined" sx={{ p: 2, flex: 1, textAlign: "center" }}>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            {responses.length}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Total Targets
          </Typography>
        </Card>
        <Card variant="outlined" sx={{ p: 2, flex: 1, textAlign: "center" }}>
          <Typography variant="h4" sx={{ fontWeight: 700, color: "success.main" }}>
            {completedCount}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Responded
          </Typography>
        </Card>
        <Card variant="outlined" sx={{ p: 2, flex: 1, textAlign: "center" }}>
          <Typography variant="h4" sx={{ fontWeight: 700, color: "warning.main" }}>
            {pendingCount}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Pending
          </Typography>
        </Card>
        <Card variant="outlined" sx={{ p: 2, flex: 1, textAlign: "center" }}>
          <Typography variant="h4" sx={{ fontWeight: 700, color: "info.main" }}>
            {appliedCount}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Applied
          </Typography>
        </Card>
      </Box>

      <LinearProgress variant="determinate" value={pct} sx={{ height: 8, borderRadius: 4, mb: 3 }} />

      {/* Tabs */}
      <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ flex: 1 }}>
          <Tab label={`All (${responses.length})`} />
          <Tab label={`Completed (${completedCount})`} />
          <Tab label={`Pending (${pendingCount})`} />
          <Tab label={`Applied (${appliedCount})`} />
        </Tabs>
        {selected.size > 0 && (
          <Button
            variant="contained"
            size="small"
            onClick={handleApply}
            disabled={applying}
            startIcon={<MaterialSymbol icon="check_circle" size={18} />}
            sx={{ textTransform: "none" }}
          >
            {applying ? "Applying..." : `Apply ${selected.size} Response${selected.size !== 1 ? "s" : ""}`}
          </Button>
        )}
      </Box>

      {/* Response table */}
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  size="small"
                  indeterminate={selected.size > 0 && selected.size < filtered.filter((r) => r.status === "completed" && !r.applied).length}
                  checked={selected.size > 0 && selected.size === filtered.filter((r) => r.status === "completed" && !r.applied).length}
                  onChange={toggleAll}
                />
              </TableCell>
              <TableCell>Fact Sheet</TableCell>
              <TableCell>User</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Changes</TableCell>
              <TableCell>Applied</TableCell>
              <TableCell>Responded</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((r) => {
              const canSelect = r.status === "completed" && !r.applied;
              return (
                <TableRow key={r.id} hover>
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      disabled={!canSelect}
                      checked={selected.has(r.id)}
                      onChange={() => toggleSelect(r.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography
                      variant="body2"
                      sx={{ cursor: "pointer", color: "primary.main", "&:hover": { textDecoration: "underline" } }}
                      onClick={() => navigate(`/fact-sheets/${r.fact_sheet_id}`)}
                    >
                      {r.fact_sheet_name || r.fact_sheet_id}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{r.user_display_name}</Typography>
                    <Typography variant="caption" color="text.secondary">{r.user_email}</Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={r.status === "completed" ? "Completed" : "Pending"}
                      size="small"
                      color={r.status === "completed" ? "success" : "warning"}
                    />
                  </TableCell>
                  <TableCell>
                    {r.status === "completed" && (
                      hasChanges(r) ? (
                        <Chip label="Has changes" size="small" color="info" variant="outlined" />
                      ) : (
                        <Chip label="All confirmed" size="small" variant="outlined" />
                      )
                    )}
                  </TableCell>
                  <TableCell>
                    {r.applied && <MaterialSymbol icon="check_circle" size={18} color="#2e7d32" />}
                  </TableCell>
                  <TableCell>
                    {r.responded_at && (
                      <Typography variant="caption" color="text.secondary">
                        {new Date(r.responded_at).toLocaleDateString()}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.status === "completed" && (
                      <Tooltip title="View details">
                        <IconButton size="small" onClick={() => setDetailResp(r)}>
                          <MaterialSymbol icon="visibility" size={18} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 4, color: "text.secondary" }}>
                  No responses in this category
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Detail dialog */}
      <Dialog open={!!detailResp} onClose={() => setDetailResp(null)} maxWidth="md" fullWidth>
        {detailResp && (
          <>
            <DialogTitle>
              Response: {detailResp.fact_sheet_name} — {detailResp.user_display_name}
            </DialogTitle>
            <DialogContent>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Field</TableCell>
                    <TableCell>Current Value</TableCell>
                    <TableCell>Response</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(survey.fields || []).map((field) => {
                    const resp = detailResp.responses[field.key];
                    if (!resp) return null;
                    const changed = !resp.confirmed && resp.new_value !== null && resp.new_value !== undefined;
                    return (
                      <TableRow key={field.key}>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {field.label}
                          </Typography>
                        </TableCell>
                        <TableCell>{formatValue(resp.current_value)}</TableCell>
                        <TableCell>
                          {changed ? (
                            <Typography variant="body2" sx={{ color: "info.main", fontWeight: 600 }}>
                              {formatValue(resp.new_value)}
                            </Typography>
                          ) : (
                            formatValue(resp.current_value)
                          )}
                        </TableCell>
                        <TableCell>
                          {resp.confirmed ? (
                            <Chip label="Confirmed" size="small" color="success" variant="outlined" />
                          ) : changed ? (
                            <Chip label="Changed" size="small" color="info" variant="outlined" />
                          ) : (
                            <Chip label="No input" size="small" variant="outlined" />
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDetailResp(null)}>Close</Button>
              {detailResp.status === "completed" && !detailResp.applied && hasChanges(detailResp) && (
                <Button
                  variant="contained"
                  onClick={async () => {
                    setApplying(true);
                    try {
                      await api.post(`/surveys/${id}/apply`, { response_ids: [detailResp.id] });
                      setDetailResp(null);
                      await fetchData();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Failed to apply");
                    } finally {
                      setApplying(false);
                    }
                  }}
                  disabled={applying}
                >
                  Apply Changes
                </Button>
              )}
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
}
