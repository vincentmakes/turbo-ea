import { useState, useEffect, useCallback } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Alert from "@mui/material/Alert";
import TextField from "@mui/material/TextField";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Switch from "@mui/material/Switch";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import CircularProgress from "@mui/material/CircularProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import type { Calculation, CardType, FieldDef, RelationType } from "@/types";

// ── Formula Reference Panel ────────────────────────────────────────

interface FormulaReferenceProps {
  cardType: CardType | null;
  relationTypes: RelationType[];
}

function FormulaReference({ cardType, relationTypes }: FormulaReferenceProps) {
  const relTypes = relationTypes.filter(
    (rt) =>
      cardType &&
      (rt.source_type_key === cardType.key ||
        rt.target_type_key === cardType.key)
  );

  const functions = [
    { name: "IF(cond, true_val, false_val)", desc: "Conditional" },
    { name: "SUM(list)", desc: "Sum a list of numbers" },
    { name: "AVG(list)", desc: "Average a list" },
    { name: "MIN(list) / MAX(list)", desc: "Min / Max of list" },
    { name: "COUNT(list)", desc: "Length of a list" },
    { name: "ROUND(num, decimals)", desc: "Round a number" },
    { name: "ABS(num)", desc: "Absolute value" },
    { name: "COALESCE(v1, v2, ...)", desc: "First non-null value" },
    { name: "LOWER(s) / UPPER(s)", desc: "Case conversion" },
    { name: "CONCAT(s1, s2, ...)", desc: "String concatenation" },
    { name: "CONTAINS(s, sub)", desc: "Substring check" },
    { name: "PLUCK(list, key)", desc: "Extract field from each dict" },
    { name: "FILTER(list, key, val)", desc: "Filter list by field value" },
    { name: 'MAP_SCORE(val, {"a":1,...})', desc: "Map key to score" },
  ];

  return (
    <Accordion sx={{ mt: 2 }}>
      <AccordionSummary expandIcon={<MaterialSymbol icon="expand_more" size={20} />}>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          Formula Reference
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {cardType && (
            <Box>
              <Typography variant="caption" fontWeight={600} gutterBottom>
                Available Fields (data.&lt;fieldKey&gt;)
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>
                <Chip size="small" label="data.name" variant="outlined" />
                <Chip size="small" label="data.description" variant="outlined" />
                <Chip size="small" label="data.status" variant="outlined" />
                <Chip size="small" label="data.subtype" variant="outlined" />
                {cardType.fields_schema?.flatMap((s) =>
                  s.fields.map((f) => (
                    <Chip
                      key={f.key}
                      size="small"
                      label={`data.${f.key}`}
                      variant="outlined"
                      title={`${f.label} (${f.type})`}
                    />
                  ))
                )}
              </Box>
            </Box>
          )}

          {relTypes.length > 0 && (
            <Box>
              <Typography variant="caption" fontWeight={600} gutterBottom>
                Relation Types
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>
                {relTypes.map((rt) => (
                  <Chip
                    key={rt.key}
                    size="small"
                    label={`relations.${rt.key}`}
                    variant="outlined"
                    title={`${rt.label} (${rt.source_type_key} → ${rt.target_type_key})`}
                  />
                ))}
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
                Also: relation_count.&lt;key&gt;, children, children_count
              </Typography>
            </Box>
          )}

          <Box>
            <Typography variant="caption" fontWeight={600} gutterBottom>
              Built-in Functions
            </Typography>
            <Table size="small" sx={{ mt: 0.5 }}>
              <TableBody>
                {functions.map((fn) => (
                  <TableRow key={fn.name}>
                    <TableCell sx={{ fontFamily: "monospace", fontSize: "0.75rem", py: 0.25, whiteSpace: "nowrap" }}>
                      {fn.name}
                    </TableCell>
                    <TableCell sx={{ fontSize: "0.75rem", py: 0.25 }}>{fn.desc}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>

          <Box>
            <Typography variant="caption" fontWeight={600} gutterBottom>
              Example Formulas
            </Typography>
            <Box component="pre" sx={{ fontSize: "0.7rem", bgcolor: "grey.50", p: 1, borderRadius: 1, overflow: "auto", whiteSpace: "pre-wrap" }}>
              {`# Total Budget
COALESCE(data.budgetCapEx, 0) + COALESCE(data.budgetOpEx, 0)

# Count related applications
relation_count.relAppToITC

# Weighted score
scores = {"perfect": 4, "good": 3, "adequate": 2, "poor": 1}
MAP_SCORE(data.stability, scores) * 0.5 + MAP_SCORE(data.security, scores) * 0.5

# ── TIME Model (Tolerate / Invest / Migrate / Eliminate) ──
# Assumes single_select fields: businessFit and technicalFit
# with options: excellent, adequate, insufficient, unreasonable.
#
# Scoring: Map each dimension to 1-4 numeric scale.
# Business Fit  = Y-axis (how well does it serve the business?)
# Technical Fit = X-axis (how healthy is the technology?)
#
# Quadrant logic (threshold at score 2.5):
#   Invest    = high business + high technical
#   Migrate   = high business + low technical
#   Tolerate  = low business  + high technical
#   Eliminate = low business  + low technical
#
bf = MAP_SCORE(data.businessFit, {"excellent": 4, "adequate": 3, "insufficient": 2, "unreasonable": 1})
tf = MAP_SCORE(data.technicalFit, {"excellent": 4, "adequate": 3, "insufficient": 2, "unreasonable": 1})
IF(bf is None or tf is None, None, IF(bf >= 2.5, IF(tf >= 2.5, "invest", "migrate"), IF(tf >= 2.5, "tolerate", "eliminate")))`}
            </Box>
          </Box>
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}

// ── Edit Dialog ────────────────────────────────────────────────────

interface EditDialogProps {
  open: boolean;
  calculation: Partial<Calculation> | null;
  cardTypes: CardType[];
  relationTypes: RelationType[];
  onClose: () => void;
  onSave: (data: Partial<Calculation>) => Promise<void>;
}

function EditDialog({ open, calculation, cardTypes, relationTypes, onClose, onSave }: EditDialogProps) {
  const [form, setForm] = useState<Partial<Calculation>>({});
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{ valid: boolean; error?: string; preview_result?: unknown } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setForm(calculation || { execution_order: 0 });
      setValidationResult(null);
      setError("");
    }
  }, [open, calculation]);

  const selectedType = cardTypes.find((t) => t.key === form.target_type_key);

  // Get eligible fields for the selected type
  const eligibleFields: FieldDef[] = [];
  if (selectedType) {
    for (const section of selectedType.fields_schema || []) {
      for (const field of section.fields) {
        if (["number", "cost", "text", "single_select", "boolean"].includes(field.type)) {
          eligibleFields.push(field);
        }
      }
    }
  }

  const handleValidate = async () => {
    if (!form.formula || !form.target_type_key) return;
    setValidating(true);
    setValidationResult(null);
    try {
      const res = await api.post<{ valid: boolean; error?: string; preview_result?: unknown }>(
        "/calculations/validate",
        { formula: form.formula, target_type_key: form.target_type_key }
      );
      setValidationResult(res);
    } catch (e: unknown) {
      setValidationResult({ valid: false, error: String(e) });
    } finally {
      setValidating(false);
    }
  };

  const handleSave = async () => {
    if (!form.name || !form.target_type_key || !form.target_field_key || !form.formula) {
      setError("Name, target type, target field, and formula are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(form);
      onClose();
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{calculation?.id ? "Edit Calculation" : "New Calculation"}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            label="Name"
            value={form.name || ""}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            fullWidth
          />

          <TextField
            label="Description"
            value={form.description || ""}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            multiline
            rows={2}
            fullWidth
          />

          <Box sx={{ display: "flex", gap: 2 }}>
            <FormControl fullWidth required>
              <InputLabel>Target Card Type</InputLabel>
              <Select
                value={form.target_type_key || ""}
                label="Target Card Type"
                onChange={(e) => setForm({ ...form, target_type_key: e.target.value, target_field_key: "" })}
              >
                {cardTypes.map((t) => (
                  <MenuItem key={t.key} value={t.key}>
                    {t.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth required disabled={!selectedType}>
              <InputLabel>Target Field</InputLabel>
              <Select
                value={form.target_field_key || ""}
                label="Target Field"
                onChange={(e) => setForm({ ...form, target_field_key: e.target.value })}
              >
                {eligibleFields.map((f) => (
                  <MenuItem key={f.key} value={f.key}>
                    {f.label} ({f.type})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          <TextField
            label="Execution Order"
            type="number"
            value={form.execution_order ?? 0}
            onChange={(e) => setForm({ ...form, execution_order: parseInt(e.target.value) || 0 })}
            sx={{ maxWidth: 180 }}
          />

          <TextField
            label="Formula"
            value={form.formula || ""}
            onChange={(e) => {
              setForm({ ...form, formula: e.target.value });
              setValidationResult(null);
            }}
            multiline
            rows={6}
            required
            fullWidth
            slotProps={{
              input: {
                sx: { fontFamily: "monospace", fontSize: "0.85rem" },
              },
            }}
          />

          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            <Button
              size="small"
              variant="outlined"
              onClick={handleValidate}
              disabled={validating || !form.formula || !form.target_type_key}
            >
              {validating ? <CircularProgress size={16} sx={{ mr: 1 }} /> : null}
              Validate
            </Button>
            {validationResult && (
              <Chip
                size="small"
                label={validationResult.valid ? "Valid" : "Invalid"}
                color={validationResult.valid ? "success" : "error"}
              />
            )}
            {validationResult?.error && (
              <Typography variant="caption" color="error" sx={{ ml: 1 }}>
                {validationResult.error}
              </Typography>
            )}
            {validationResult?.valid && validationResult.preview_result !== undefined && (
              <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                Preview: {JSON.stringify(validationResult.preview_result)}
              </Typography>
            )}
          </Box>

          <FormulaReference cardType={selectedType || null} relationTypes={relationTypes} />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? <CircularProgress size={16} sx={{ mr: 1 }} /> : null}
          {calculation?.id ? "Save" : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Test Dialog ────────────────────────────────────────────────────

interface TestDialogProps {
  open: boolean;
  calculation: Calculation | null;
  onClose: () => void;
}

function TestDialog({ open, calculation, onClose }: TestDialogProps) {
  const [cardId, setCardId] = useState("");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; error?: string; computed_value?: unknown; card_name?: string } | null>(null);

  useEffect(() => {
    if (open) {
      setCardId("");
      setResult(null);
    }
  }, [open]);

  const handleTest = async () => {
    if (!calculation || !cardId) return;
    setTesting(true);
    setResult(null);
    try {
      const res = await api.post<{ success: boolean; error?: string; computed_value?: unknown; card_name?: string }>(
        `/calculations/${calculation.id}/test`,
        { card_id: cardId }
      );
      setResult(res);
    } catch (e: unknown) {
      setResult({ success: false, error: String(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Test Calculation: {calculation?.name}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Enter a card ID to test this formula against. The result will not be saved.
          </Typography>
          <TextField
            label="Card ID (UUID)"
            value={cardId}
            onChange={(e) => setCardId(e.target.value)}
            fullWidth
            placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
          />
          <Button variant="contained" onClick={handleTest} disabled={testing || !cardId}>
            {testing ? <CircularProgress size={16} sx={{ mr: 1 }} /> : null}
            Test
          </Button>
          {result && (
            <Alert severity={result.success ? "success" : "error"}>
              {result.success ? (
                <>
                  Computed value for &quot;{result.card_name}&quot;:{" "}
                  <strong>{JSON.stringify(result.computed_value)}</strong>
                </>
              ) : (
                result.error
              )}
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Main Component ─────────────────────────────────────────────────

export default function CalculationsAdmin() {
  const { types, relationTypes } = useMetamodel();
  const [calculations, setCalculations] = useState<Calculation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editCalc, setEditCalc] = useState<Partial<Calculation> | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testCalc, setTestCalc] = useState<Calculation | null>(null);
  const [recalculating, setRecalculating] = useState<string | null>(null);
  const [recalcResult, setRecalcResult] = useState<{ type: string; message: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Calculation | null>(null);
  const [filterType, setFilterType] = useState<string>("");

  const visibleTypes = types.filter((t) => !t.is_hidden);

  const fetchCalculations = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.get<Calculation[]>("/calculations");
      setCalculations(data);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCalculations();
  }, [fetchCalculations]);

  const handleSave = async (data: Partial<Calculation>) => {
    if (data.id) {
      await api.patch(`/calculations/${data.id}`, {
        name: data.name,
        description: data.description,
        target_type_key: data.target_type_key,
        target_field_key: data.target_field_key,
        formula: data.formula,
        execution_order: data.execution_order,
      });
    } else {
      await api.post("/calculations", {
        name: data.name,
        description: data.description,
        target_type_key: data.target_type_key,
        target_field_key: data.target_field_key,
        formula: data.formula,
        execution_order: data.execution_order,
      });
    }
    await fetchCalculations();
  };

  const handleToggleActive = async (calc: Calculation) => {
    try {
      if (calc.is_active) {
        await api.post(`/calculations/${calc.id}/deactivate`, {});
      } else {
        await api.post(`/calculations/${calc.id}/activate`, {});
      }
      await fetchCalculations();
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  const handleDelete = async (calc: Calculation) => {
    try {
      await api.delete(`/calculations/${calc.id}`);
      setDeleteConfirm(null);
      await fetchCalculations();
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  const handleRecalculate = async (typeKey: string) => {
    setRecalculating(typeKey);
    setRecalcResult(null);
    try {
      const res = await api.post<{
        cards_processed: number;
        calculations_succeeded: number;
        calculations_failed: number;
      }>(`/calculations/recalculate/${typeKey}`, {});
      setRecalcResult({
        type: typeKey,
        message: `Processed ${res.cards_processed} cards: ${res.calculations_succeeded} succeeded, ${res.calculations_failed} failed`,
      });
    } catch (e: unknown) {
      setRecalcResult({ type: typeKey, message: `Error: ${String(e)}` });
    } finally {
      setRecalculating(null);
    }
  };

  const filteredCalcs = filterType
    ? calculations.filter((c) => c.target_type_key === filterType)
    : calculations;

  const getTypeLabel = (key: string) => types.find((t) => t.key === key)?.label || key;

  const getFieldLabel = (typeKey: string, fieldKey: string) => {
    const t = types.find((ct) => ct.key === typeKey);
    if (!t) return fieldKey;
    for (const section of t.fields_schema || []) {
      for (const field of section.fields) {
        if (field.key === fieldKey) return field.label;
      }
    }
    return fieldKey;
  };

  return (
    <Box sx={{ maxWidth: 1100, mx: "auto", p: { xs: 2, sm: 3 } }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 3, flexWrap: "wrap" }}>
        <MaterialSymbol icon="calculate" size={28} />
        <Typography variant="h5" sx={{ fontWeight: 600 }}>
          Calculated Fields
        </Typography>
        <Box sx={{ flex: 1 }} />
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>Filter by type</InputLabel>
          <Select
            value={filterType}
            label="Filter by type"
            onChange={(e) => setFilterType(e.target.value)}
          >
            <MenuItem value="">All types</MenuItem>
            {visibleTypes.map((t) => (
              <MenuItem key={t.key} value={t.key}>
                {t.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button
          variant="contained"
          startIcon={<MaterialSymbol icon="add" size={18} />}
          onClick={() => {
            setEditCalc(null);
            setEditOpen(true);
          }}
        >
          New Calculation
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {recalcResult && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          onClose={() => setRecalcResult(null)}
        >
          <strong>{getTypeLabel(recalcResult.type)}:</strong> {recalcResult.message}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      ) : filteredCalcs.length === 0 ? (
        <Card>
          <CardContent sx={{ textAlign: "center", py: 6 }}>
            <MaterialSymbol icon="calculate" size={48} color="#ccc" />
            <Typography variant="h6" color="text.secondary" sx={{ mt: 1 }}>
              No calculations defined
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Create a calculation to auto-populate card fields based on formulas.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <TableContainer component={Card}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Target Type</TableCell>
                <TableCell>Target Field</TableCell>
                <TableCell>Order</TableCell>
                <TableCell align="center">Active</TableCell>
                <TableCell>Last Run</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredCalcs.map((calc) => (
                <TableRow key={calc.id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>
                      {calc.name}
                    </Typography>
                    {calc.description && (
                      <Typography variant="caption" color="text.secondary">
                        {calc.description}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{getTypeLabel(calc.target_type_key)}</TableCell>
                  <TableCell>{getFieldLabel(calc.target_type_key, calc.target_field_key)}</TableCell>
                  <TableCell>{calc.execution_order}</TableCell>
                  <TableCell align="center">
                    <Switch
                      checked={calc.is_active}
                      onChange={() => handleToggleActive(calc)}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>
                    {calc.last_run_at ? (
                      <Typography variant="caption">
                        {new Date(calc.last_run_at).toLocaleString()}
                      </Typography>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        Never
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {calc.last_error ? (
                      <Tooltip title={calc.last_error}>
                        <Chip size="small" label="Error" color="error" />
                      </Tooltip>
                    ) : calc.last_run_at ? (
                      <Chip size="small" label="OK" color="success" />
                    ) : null}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Edit">
                      <IconButton
                        size="small"
                        onClick={() => {
                          setEditCalc(calc);
                          setEditOpen(true);
                        }}
                      >
                        <MaterialSymbol icon="edit" size={18} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Test with card">
                      <IconButton
                        size="small"
                        onClick={() => {
                          setTestCalc(calc);
                          setTestOpen(true);
                        }}
                      >
                        <MaterialSymbol icon="science" size={18} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Recalculate all">
                      <IconButton
                        size="small"
                        onClick={() => handleRecalculate(calc.target_type_key)}
                        disabled={recalculating === calc.target_type_key}
                      >
                        {recalculating === calc.target_type_key ? (
                          <CircularProgress size={18} />
                        ) : (
                          <MaterialSymbol icon="refresh" size={18} />
                        )}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => setDeleteConfirm(calc)}
                      >
                        <MaterialSymbol icon="delete" size={18} />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <EditDialog
        open={editOpen}
        calculation={editCalc}
        cardTypes={visibleTypes}
        relationTypes={relationTypes}
        onClose={() => setEditOpen(false)}
        onSave={handleSave}
      />

      <TestDialog
        open={testOpen}
        calculation={testCalc}
        onClose={() => setTestOpen(false)}
      />

      {/* Delete confirmation */}
      <Dialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)}>
        <DialogTitle>Delete Calculation</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete &quot;{deleteConfirm?.name}&quot;? This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
