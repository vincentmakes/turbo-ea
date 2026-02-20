import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Divider from "@mui/material/Divider";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { SurveyRespondForm, SurveyField } from "@/types";

/** Resolve a value to its display label using field options when available. */
function formatValue(val: unknown, field?: SurveyField & { current_value?: unknown }): string {
  if (val === null || val === undefined || val === "") return "—";
  if (typeof val === "boolean") return val ? "Yes" : "No";

  const opts = field?.options;
  if (opts && opts.length > 0) {
    if (Array.isArray(val)) {
      return val
        .map((v) => opts.find((o) => o.key === v)?.label ?? String(v))
        .join(", ");
    }
    const match = opts.find((o) => o.key === val);
    if (match) return match.label;
  }

  if (Array.isArray(val)) return val.join(", ");
  return String(val);
}

interface FieldResponse {
  confirmed: boolean;
  new_value: unknown;
}

export default function SurveyRespond() {
  const { surveyId, cardId } = useParams<{ surveyId: string; cardId: string }>();
  const navigate = useNavigate();

  const [form, setForm] = useState<SurveyRespondForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Field responses: {field_key: {confirmed: bool, new_value: any}}
  const [fieldResponses, setFieldResponses] = useState<Record<string, FieldResponse>>({});

  useEffect(() => {
    if (!surveyId || !cardId) return;
    const load = async () => {
      try {
        const data = await api.get<SurveyRespondForm>(
          `/surveys/${surveyId}/respond/${cardId}`,
        );
        setForm(data);

        // Initialize field responses based on action type
        const initial: Record<string, FieldResponse> = {};
        for (const field of data.fields) {
          const existing = data.existing_responses[field.key];
          if (existing) {
            // Restore previous answers
            initial[field.key] = {
              confirmed: existing.confirmed,
              new_value: existing.new_value,
            };
          } else if (field.action === "confirm") {
            // Confirm: default to confirmed (toggle on)
            initial[field.key] = { confirmed: true, new_value: null };
          } else {
            // Maintain: default to editing (show input immediately)
            initial[field.key] = { confirmed: false, new_value: null };
          }
        }
        setFieldResponses(initial);

        if (data.response_status === "completed") {
          setSubmitted(true);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load survey");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [surveyId, cardId]);

  const setConfirmed = (key: string, confirmed: boolean) => {
    setFieldResponses((prev) => ({
      ...prev,
      [key]: { ...prev[key], confirmed, new_value: confirmed ? null : prev[key]?.new_value },
    }));
  };

  const setNewValue = (key: string, value: unknown) => {
    setFieldResponses((prev) => ({
      ...prev,
      [key]: { ...prev[key], new_value: value, confirmed: false },
    }));
  };

  const handleSubmit = async () => {
    if (!surveyId || !cardId) return;
    setSubmitting(true);
    setError("");
    try {
      await api.post(`/surveys/${surveyId}/respond/${cardId}`, {
        responses: fieldResponses,
      });
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  const renderFieldInput = (field: SurveyField & { current_value: unknown }, resp: FieldResponse) => {
    if (resp.confirmed) return null; // No input needed if confirmed

    const value = resp.new_value ?? field.current_value ?? "";

    if (field.type === "boolean") {
      return (
        <FormControlLabel
          control={
            <Switch
              checked={!!value}
              onChange={(e) => setNewValue(field.key, e.target.checked)}
            />
          }
          label={value ? "Yes" : "No"}
        />
      );
    }

    if (field.type === "single_select" && field.options) {
      return (
        <TextField
          select
          size="small"
          fullWidth
          value={value || ""}
          onChange={(e) => setNewValue(field.key, e.target.value)}
        >
          <MenuItem value="">
            <em>None</em>
          </MenuItem>
          {field.options.map((opt) => (
            <MenuItem key={opt.key} value={opt.key}>
              {opt.label}
            </MenuItem>
          ))}
        </TextField>
      );
    }

    if (field.type === "multiple_select" && field.options) {
      const current = Array.isArray(value) ? value : [];
      return (
        <TextField
          select
          size="small"
          fullWidth
          SelectProps={{ multiple: true }}
          value={current}
          onChange={(e) => setNewValue(field.key, e.target.value)}
        >
          {field.options.map((opt) => (
            <MenuItem key={opt.key} value={opt.key}>
              {opt.label}
            </MenuItem>
          ))}
        </TextField>
      );
    }

    if (field.type === "number" || field.type === "cost") {
      return (
        <TextField
          type="number"
          size="small"
          fullWidth
          value={value ?? ""}
          onChange={(e) => setNewValue(field.key, e.target.value ? Number(e.target.value) : null)}
        />
      );
    }

    if (field.type === "date") {
      return (
        <TextField
          type="date"
          size="small"
          fullWidth
          value={value || ""}
          onChange={(e) => setNewValue(field.key, e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
      );
    }

    // Default: text
    return (
      <TextField
        size="small"
        fullWidth
        multiline={String(value).length > 80}
        value={value ?? ""}
        onChange={(e) => setNewValue(field.key, e.target.value)}
      />
    );
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!form) {
    return <Alert severity="error">{error || "Survey not found"}</Alert>;
  }

  if (submitted) {
    return (
      <Box sx={{ maxWidth: 600, mx: "auto", py: 6, textAlign: "center" }}>
        <MaterialSymbol icon="check_circle" size={64} color="#2e7d32" />
        <Typography variant="h5" sx={{ mt: 2, fontWeight: 700 }}>
          Response Submitted
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1, mb: 3 }}>
          Thank you for completing the survey for <strong>{form.card.name}</strong>.
        </Typography>
        <Button variant="outlined" onClick={() => navigate("/surveys")}>
          Back to My Surveys
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 800, mx: "auto" }}>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1 }}>
        <Tooltip title="Back to My Surveys">
          <IconButton onClick={() => navigate("/surveys")}>
            <MaterialSymbol icon="arrow_back" size={22} />
          </IconButton>
        </Tooltip>
        <MaterialSymbol icon="assignment" size={28} color="#1976d2" />
        <Typography variant="h5" sx={{ fontWeight: 700, flex: 1 }}>
          {form.survey.name}
        </Typography>
      </Box>

      {/* Card info */}
      <Card variant="outlined" sx={{ p: 2, mb: 2, display: "flex", alignItems: "center", gap: 1 }}>
        <MaterialSymbol icon="apps" size={22} color="#0f7eb5" />
        <Typography sx={{ fontWeight: 600, flex: 1 }}>{form.card.name}</Typography>
        <Chip label={form.card.type} size="small" variant="outlined" />
        {form.card.subtype && (
          <Chip label={form.card.subtype} size="small" />
        )}
      </Card>

      {/* Survey message */}
      {form.survey.message && (
        <Card variant="outlined" sx={{ p: 2, mb: 3, bgcolor: "#f5f5ff" }}>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
            {form.survey.message}
          </Typography>
        </Card>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {/* Field cards */}
      {form.fields.map((field) => {
        const resp = fieldResponses[field.key] || { confirmed: false, new_value: null };
        const isMaintain = field.action === "maintain";

        return (
          <Card key={field.key} sx={{ mb: 2, p: 2 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
              <Typography sx={{ fontWeight: 600, flex: 1 }}>{field.label}</Typography>
              <Chip
                label={isMaintain ? "Maintain" : "Confirm"}
                size="small"
                color={isMaintain ? "primary" : "default"}
                variant="outlined"
              />
              <Typography variant="caption" color="text.secondary">
                {field.section}
              </Typography>
            </Box>

            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Current value:
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {formatValue(field.current_value, field)}
              </Typography>
            </Box>

            <Divider sx={{ my: 1 }} />

            {isMaintain ? (
              /* ── Maintain: input is shown by default; optional "no change" toggle ── */
              <>
                <Box sx={{ display: "flex", alignItems: "center", gap: 2, mt: 1 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={resp.confirmed}
                        onChange={(e) => setConfirmed(field.key, e.target.checked)}
                        color="success"
                        size="small"
                      />
                    }
                    label={
                      <Typography variant="body2" color="text.secondary">
                        No change needed
                      </Typography>
                    }
                  />
                </Box>
                {!resp.confirmed && (
                  <Box sx={{ mt: 1.5 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                      Updated value:
                    </Typography>
                    {renderFieldInput(field, resp)}
                  </Box>
                )}
              </>
            ) : (
              /* ── Confirm: toggle is on by default, turn off to propose a change ── */
              <>
                <Box sx={{ display: "flex", alignItems: "center", gap: 2, mt: 1 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={resp.confirmed}
                        onChange={(e) => setConfirmed(field.key, e.target.checked)}
                        color="success"
                      />
                    }
                    label={
                      <Typography variant="body2">
                        {resp.confirmed
                          ? "I confirm this value is correct"
                          : "I want to propose a change"}
                      </Typography>
                    }
                  />
                </Box>
                {!resp.confirmed && (
                  <Box sx={{ mt: 1.5 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                      Proposed value:
                    </Typography>
                    {renderFieldInput(field, resp)}
                  </Box>
                )}
              </>
            )}
          </Card>
        );
      })}

      {/* Submit */}
      <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 3, mb: 4 }}>
        <Button
          variant="contained"
          size="large"
          onClick={handleSubmit}
          disabled={submitting}
          startIcon={<MaterialSymbol icon="send" size={18} />}
          sx={{ textTransform: "none" }}
        >
          {submitting ? "Submitting..." : "Submit Response"}
        </Button>
      </Box>
    </Box>
  );
}
