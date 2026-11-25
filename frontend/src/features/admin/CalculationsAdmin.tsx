import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import InputLabel from "@mui/material/InputLabel";
import Link from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Switch from "@mui/material/Switch";
import { useTheme } from "@mui/material/styles";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import LinkifiedText from "@/components/LinkifiedText";
import MaterialSymbol from "@/components/MaterialSymbol";
import { invalidateCalculatedFields } from "@/hooks/useCalculatedFields";
import { useCardSubtypeLabel } from "@/hooks/useCardSubtypeLabel";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useAbortableEffect } from "@/hooks/useLatestRequest";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useFieldLabel, useRelationLabel, useTypeLabel } from "@/hooks/useResolveLabel";
import { STATUS_COLORS } from "@/theme";
import type {
  Calculation,
  CalculationRunReport,
  Card as CardItem,
  CardType,
  FieldDef,
  RelationType,
} from "@/types";
import { formatRunReport } from "./calculationRunReport";
import { FormulaEditor } from "./FormulaEditor";
import { HL_STYLES, highlightFormula } from "./formulaHighlight";

// ── Highlighted Code Block (read-only, with line numbers) ─────────

const EXAMPLE_FORMULAS = `# Total Budget
COALESCE(data.budgetCapEx, 0) + COALESCE(data.budgetOpEx, 0)

# Count related applications
relation_count.relAppToITC

# Sum a field from related cards (note the "attributes." prefix)
SUM(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))

# PPM capex budget on an Initiative, and just this fiscal year's
ppm.capexBudget
SUM(PLUCK(FILTER(ppm.byYear, "year", ppm.currentFiscalYear), "capexBudget"))

# PPM progress on an Initiative (into a percentage field), and a delivery flag
ppm.completion
IF(ppm.tasksOverdue > 0, "At risk", COALESCE(ppm.scheduleHealth, "No report"))

# Inherit a value from the parent card (fall back to own value at the root)
IF(parent, parent.attributes.businessCriticality, data.businessCriticality)

# Score by depth in the hierarchy (1 = root)
hierarchy_level * 10

# Weighted score
scores = {"perfect": 4, "good": 3, "adequate": 2, "poor": 1}
MAP_SCORE(data.stability, scores) * 0.5 + MAP_SCORE(data.security, scores) * 0.5

# ── TIME Model (Tolerate / Invest / Migrate / Eliminate) ──
# Target: Application → TIME Model. Uses the built-in fields
# functionalSuitability and technicalSuitability.
#
# Each rating maps to a 1-4 score (4 = best); threshold 2.5:
#   Invest    = high functional + high technical
#   Migrate   = high functional + low technical
#   Tolerate  = low functional  + high technical
#   Eliminate = low functional  + low technical
#
ff = MAP_SCORE(data.functionalSuitability, {"perfect": 4, "appropriate": 3, "insufficient": 2, "unreasonable": 1})
tf = MAP_SCORE(data.technicalSuitability, {"fullyAppropriate": 4, "adequate": 3, "unreasonable": 2, "inappropriate": 1})
IF(ff is None or tf is None, None, IF(ff >= 2.5, IF(tf >= 2.5, "invest", "migrate"), IF(tf >= 2.5, "tolerate", "eliminate")))`;

function HighlightedCodeBlock({ code }: { code: string }) {
  const lines = code.split("\n");
  return (
    <Box
      sx={{
        display: "flex",
        bgcolor: "action.hover",
        borderRadius: 1,
        border: "1px solid",
        borderColor: "divider",
        overflow: "auto",
        fontSize: "0.7rem",
        lineHeight: "1.55",
        fontFamily: "monospace",
      }}
    >
      <style>{HL_STYLES}</style>
      <Box
        sx={{
          py: 1,
          px: 1,
          color: "text.secondary",
          textAlign: "right",
          userSelect: "none",
          borderRight: 1,
          borderColor: "divider",
          bgcolor: "action.selected",
          flexShrink: 0,
          minWidth: 28,
        }}
        aria-hidden
      >
        {lines.map((_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </Box>
      <Box
        component="pre"
        sx={{ py: 1, px: 1.5, m: 0, color: "#24292e", whiteSpace: "pre-wrap", flex: 1 }}
        dangerouslySetInnerHTML={{ __html: highlightFormula(code) }}
      />
    </Box>
  );
}

// ── Formula Reference Panel ────────────────────────────────────────

interface FormulaReferenceProps {
  cardType: CardType | null;
  relationTypes: RelationType[];
}

function FormulaReference({ cardType, relationTypes }: FormulaReferenceProps) {
  const { t } = useTranslation(["admin"]);
  const fieldLabel = useFieldLabel();
  const relLabel = useRelationLabel();
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
    { name: "LN(num)", desc: "Natural logarithm (null for values \u2264 0)" },
    { name: "COALESCE(v1, v2, ...)", desc: "First non-null value" },
    { name: "LOWER(s) / UPPER(s)", desc: "Case conversion" },
    { name: "CONCAT(s1, s2, ...)", desc: "String concatenation" },
    { name: "CONTAINS(s, sub)", desc: "Substring check" },
    { name: "PLUCK(list, key)", desc: "Extract field from each dict" },
    { name: "FILTER(list, key, val)", desc: "Filter list by field value" },
    { name: 'MAP_SCORE(val, {"a":1,...})', desc: "Map key to score" },
  ];

  const contextVars = [
    { name: "parent", desc: t("calculations.ctxParent") },
    { name: "parent.attributes.<key>", desc: t("calculations.ctxParentAttributes") },
    { name: "hierarchy_level", desc: t("calculations.ctxHierarchyLevel") },
    { name: "children", desc: t("calculations.ctxChildren") },
    { name: "children_count", desc: t("calculations.ctxChildrenCount") },
    { name: "ppm.capexBudget", desc: t("calculations.ctxPpm") },
    { name: "ppm.byYear", desc: t("calculations.ctxPpmByYear") },
    { name: "ppm.completion", desc: t("calculations.ctxPpmProgress") },
    { name: "ppm.scheduleHealth", desc: t("calculations.ctxPpmReport") },
  ];

  return (
    <Accordion sx={{ mt: 2 }}>
      <AccordionSummary expandIcon={<MaterialSymbol icon="expand_more" size={20} />}>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {t("calculations.formulaReference")}
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {cardType && (
            <Box>
              <Typography variant="caption" fontWeight={600} gutterBottom>
                {t("calculations.availableFields")}
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
                      title={`${fieldLabel(f)} (${f.type})`}
                    />
                  ))
                )}
              </Box>
            </Box>
          )}

          {relTypes.length > 0 && (
            <Box>
              <Typography variant="caption" fontWeight={600} gutterBottom>
                {t("calculations.relationTypes")}
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>
                {relTypes.map((rt) => (
                  <Chip
                    key={rt.key}
                    size="small"
                    label={`relations.${rt.key}`}
                    variant="outlined"
                    title={`${relLabel(rt)} (${rt.source_type_key} → ${rt.target_type_key})`}
                  />
                ))}
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
                {t("calculations.alsoRelationCount")}
              </Typography>
            </Box>
          )}

          <Box>
            <Typography variant="caption" fontWeight={600} gutterBottom>
              {t("calculations.contextVariables")}
            </Typography>
            <Table size="small" sx={{ mt: 0.5 }}>
              <TableBody>
                {contextVars.map((cv) => (
                  <TableRow key={cv.name}>
                    <TableCell sx={{ fontFamily: "monospace", fontSize: "0.75rem", py: 0.25, whiteSpace: "nowrap" }}>
                      {cv.name}
                    </TableCell>
                    <TableCell sx={{ fontSize: "0.75rem", py: 0.25 }}>{cv.desc}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>

          <Box>
            <Typography variant="caption" fontWeight={600} gutterBottom>
              {t("calculations.builtInFunctions")}
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
              {t("calculations.exampleFormulas")}
            </Typography>
            <HighlightedCodeBlock code={EXAMPLE_FORMULAS} />
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
  const { t } = useTranslation(["admin", "common"]);
  const typeLabel = useTypeLabel();
  const fieldLabel = useFieldLabel();
  const [form, setForm] = useState<Partial<Calculation>>({});
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{ valid: boolean; error?: string; preview_result?: unknown; warnings?: string[] } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setForm(calculation || { execution_order: 0 });
      setValidationResult(null);
      setError("");
    }
  }, [open, calculation]);

  const selectedType = cardTypes.find((ct) => ct.key === form.target_type_key);

  // Get eligible fields for the selected type
  const eligibleFields: FieldDef[] = [];
  if (selectedType) {
    for (const section of selectedType.fields_schema || []) {
      for (const field of section.fields) {
        if (
          ["number", "cost", "percentage", "text", "single_select", "boolean"].includes(field.type)
        ) {
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
      const res = await api.post<{ valid: boolean; error?: string; preview_result?: unknown; warnings?: string[] }>(
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
      setError(t("calculations.requiredFields"));
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
      <DialogTitle>{calculation?.id ? t("calculations.editCalculation") : t("calculations.newCalculation")}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            label={t("common:labels.name")}
            value={form.name || ""}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            fullWidth
          />

          <TextField
            label={t("common:labels.description")}
            value={form.description || ""}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            multiline
            rows={2}
            fullWidth
          />

          <Box sx={{ display: "flex", gap: 2 }}>
            <FormControl fullWidth required>
              <InputLabel>{t("calculations.targetCardType")}</InputLabel>
              <Select
                value={form.target_type_key || ""}
                label={t("calculations.targetCardType")}
                onChange={(e) => setForm({ ...form, target_type_key: e.target.value, target_field_key: "" })}
              >
                {cardTypes.map((ct) => (
                  <MenuItem key={ct.key} value={ct.key}>
                    {typeLabel(ct)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth required disabled={!selectedType}>
              <InputLabel>{t("calculations.targetField")}</InputLabel>
              <Select
                value={form.target_field_key || ""}
                label={t("calculations.targetField")}
                onChange={(e) => setForm({ ...form, target_field_key: e.target.value })}
              >
                {eligibleFields.map((f) => (
                  <MenuItem key={f.key} value={f.key}>
                    {fieldLabel(f)} ({f.type})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          <TextField
            label={t("calculations.executionOrder")}
            type="number"
            value={form.execution_order ?? 0}
            onChange={(e) => setForm({ ...form, execution_order: parseInt(e.target.value) || 0 })}
            sx={{ maxWidth: 180 }}
          />

          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={form.blanks_as_zero ?? false}
                  onChange={(e) => setForm({ ...form, blanks_as_zero: e.target.checked })}
                />
              }
              label={t("calculations.blanksAsZero")}
            />
            <Typography variant="caption" color="text.secondary" display="block">
              {t("calculations.blanksAsZeroHelp")}
            </Typography>
          </Box>

          <FormulaEditor
            value={form.formula || ""}
            onChange={(v) => {
              setForm({ ...form, formula: v });
              setValidationResult(null);
            }}
            cardType={selectedType || null}
            relationTypes={relationTypes}
          />

          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            <Button
              size="small"
              variant="outlined"
              onClick={handleValidate}
              disabled={validating || !form.formula || !form.target_type_key}
            >
              {validating ? <CircularProgress size={16} sx={{ mr: 1 }} /> : null}
              {t("calculations.validate")}
            </Button>
            {validationResult && (
              <Chip
                size="small"
                label={validationResult.valid ? t("calculations.valid") : t("calculations.invalid")}
                color={validationResult.valid ? "success" : "error"}
              />
            )}
            {validationResult?.valid && validationResult.preview_result !== undefined && (
              <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                {t("calculations.preview", { value: JSON.stringify(validationResult.preview_result) })}
              </Typography>
            )}
          </Box>

          {validationResult?.error && <Alert severity="error">{validationResult.error}</Alert>}
          {!!validationResult?.warnings?.length && (
            <Alert severity="warning">
              {validationResult.warnings.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </Alert>
          )}

          <FormulaReference cardType={selectedType || null} relationTypes={relationTypes} />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? <CircularProgress size={16} sx={{ mr: 1 }} /> : null}
          {calculation?.id ? t("common:actions.save") : t("common:actions.create")}
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
  const { t } = useTranslation(["admin", "common"]);
  const [selectedCard, setSelectedCard] = useState<CardItem | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [options, setOptions] = useState<CardItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; error?: string; computed_value?: unknown; card_name?: string } | null>(null);

  const { types } = useMetamodel();
  const resolveTypeLabel = useTypeLabel();
  const subtypeLabel = useCardSubtypeLabel();

  useEffect(() => {
    if (open) {
      setSelectedCard(null);
      setSearchInput("");
      setOptions([]);
      setResult(null);
    }
  }, [open]);

  // Debounced card search. `clearTimeout` cancelled the timer but never the
  // request, so a stale response could replace newer options (#882).
  const [debouncedSearchInput, searchDebouncePending] = useDebouncedValue(searchInput, 300);
  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      if (!debouncedSearchInput || debouncedSearchInput.length < 2 || !calculation?.target_type_key) {
        setOptions([]);
        setSearchLoading(false);
        return;
      }
      setSearchLoading(true);
      try {
        const res = await api.get<{ items: CardItem[] }>(
          `/cards?type=${encodeURIComponent(calculation.target_type_key)}&search=${encodeURIComponent(debouncedSearchInput)}&page_size=15`,
          { signal },
        );
        if (!isCurrent()) return;
        setOptions(res.items);
      } catch {
        if (!isCurrent()) return;
        setOptions([]);
      } finally {
        if (isCurrent()) setSearchLoading(false);
      }
    },
    [debouncedSearchInput, calculation?.target_type_key],
  );

  const handleTest = async () => {
    if (!calculation || !selectedCard) return;
    setTesting(true);
    setResult(null);
    try {
      const res = await api.post<{ success: boolean; error?: string; computed_value?: unknown; card_name?: string }>(
        `/calculations/${calculation.id}/test`,
        { card_id: selectedCard.id }
      );
      setResult(res);
    } catch (e: unknown) {
      setResult({ success: false, error: String(e) });
    } finally {
      setTesting(false);
    }
  };

  const typeFound = types.find((ct) => ct.key === calculation?.target_type_key);
  const typeLabel = typeFound
    ? resolveTypeLabel(typeFound)
    : calculation?.target_type_key || "card";

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("calculations.testCalculation", { name: calculation?.name })}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t("calculations.testDescription", { type: typeLabel })}
          </Typography>
          <Autocomplete
            options={options}
            value={selectedCard}
            onChange={(_, val) => {
              setSelectedCard(val);
              setResult(null);
            }}
            onInputChange={(_, val, reason) => {
              if (reason === "input") setSearchInput(val);
              else if (reason === "clear") setSearchInput("");
            }}
            filterOptions={(x) => x}
            getOptionLabel={(opt) => opt.name}
            isOptionEqualToValue={(opt, val) => opt.id === val.id}
            loading={searchLoading || searchDebouncePending}
            noOptionsText={searchInput.length < 2 ? t("calculations.typeToSearch") : t("calculations.noCardsFound")}
            renderOption={({ key: _key, ...optProps }, option) => (
              <li key={option.id} {...optProps}>
                <Box sx={{ display: "flex", flexDirection: "column" }}>
                  <Typography variant="body2">{option.name}</Typography>
                  {option.subtype && (
                    <Typography variant="caption" color="text.secondary">
                      {subtypeLabel(option.type, option.subtype)}
                    </Typography>
                  )}
                </Box>
              </li>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                label={t("calculations.searchLabel", { type: typeLabel })}
                placeholder={t("calculations.searchPlaceholder", { type: typeLabel.toLowerCase() })}
                slotProps={{
                  input: {
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {searchLoading || searchDebouncePending ? <CircularProgress color="inherit" size={16} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  },
                }}
              />
            )}
          />
          <Button variant="contained" onClick={handleTest} disabled={testing || !selectedCard}>
            {testing ? <CircularProgress size={16} sx={{ mr: 1 }} /> : null}
            {t("calculations.test")}
          </Button>
          {result && (
            <Alert severity={result.success ? "success" : "error"}>
              {result.success ? (
                <>
                  {t("calculations.computedValue", { name: result.card_name })}{" "}
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
        <Button onClick={onClose}>{t("common:actions.close")}</Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Recalculation results ──────────────────────────────────────────

interface RecalcResultDialogProps {
  open: boolean;
  report: CalculationRunReport | null;
  typeName: string;
  onClose: () => void;
}

function RecalcResultDialog({ open, report, typeName, onClose }: RecalcResultDialogProps) {
  const { t } = useTranslation(["admin", "common"]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) setCopied(false);
  }, [open]);

  if (!report) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formatRunReport(report, typeName));
      setCopied(true);
    } catch {
      // Clipboard permission denied or unavailable — the report is still on
      // screen, so there is nothing useful to say about it.
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t("calculations.recalcDialogTitle", { type: typeName })}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("calculations.recalcResult", {
            cards: report.cards_processed,
            succeeded: report.calculations_succeeded,
            failed: report.calculations_failed,
          })}
        </Typography>

        {report.calculations.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("calculations.recalcNothingRan")}
          </Typography>
        ) : (
          report.calculations.map((calc, idx) => (
            <Box key={calc.calculation_id} sx={{ mb: 2 }}>
              {idx > 0 && <Divider sx={{ mb: 2 }} />}
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", mb: 1 }}>
                <Typography variant="body2" fontWeight={600}>
                  {calc.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {calc.target_field}
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Chip
                  size="small"
                  color="success"
                  variant={calc.succeeded ? "filled" : "outlined"}
                  label={t("calculations.recalcOkCount", { count: calc.succeeded })}
                />
                {calc.failed > 0 && (
                  <Chip
                    size="small"
                    color="error"
                    label={t("calculations.recalcFailedCount", { count: calc.failed })}
                  />
                )}
              </Box>

              {calc.failures.length === 0 ? (
                <Typography variant="caption" color="text.secondary">
                  {t("calculations.recalcAllClean")}
                </Typography>
              ) : (
                calc.failures.map((group) => (
                  <Paper key={group.error} variant="outlined" sx={{ p: 1.5, mb: 1 }}>
                    <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
                      <MaterialSymbol icon="error" size={18} color={STATUS_COLORS.error} />
                      <Typography variant="body2" sx={{ flex: 1 }}>
                        {group.error}
                      </Typography>
                      <Chip size="small" label={group.count} />
                    </Box>
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 1, pl: 3.5 }}>
                      {group.cards.map((card) => (
                        <Link
                          key={card.id}
                          href={`/cards/${card.id}`}
                          target="_blank"
                          rel="noopener"
                          variant="caption"
                        >
                          {card.name}
                        </Link>
                      ))}
                      {group.cards_truncated && (
                        <Typography variant="caption" color="text.secondary">
                          {t("calculations.recalcMoreCards", {
                            count: group.count - group.cards.length,
                          })}
                        </Typography>
                      )}
                    </Box>
                  </Paper>
                ))
              )}
            </Box>
          ))
        )}
      </DialogContent>
      <DialogActions>
        <Button
          onClick={handleCopy}
          startIcon={<MaterialSymbol icon={copied ? "check" : "content_copy"} size={18} />}
        >
          {copied ? t("calculations.recalcCopied") : t("calculations.recalcCopy")}
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>{t("common:actions.close")}</Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Main Component ─────────────────────────────────────────────────

export default function CalculationsAdmin() {
  const theme = useTheme();
  const { t } = useTranslation(["admin", "common"]);
  const { formatDateTime } = useDateFormat();
  const { types, relationTypes } = useMetamodel();
  const typeLabel = useTypeLabel();
  const fieldLabel = useFieldLabel();
  const [calculations, setCalculations] = useState<Calculation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editCalc, setEditCalc] = useState<Partial<Calculation> | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testCalc, setTestCalc] = useState<Calculation | null>(null);
  const [recalculating, setRecalculating] = useState<string | null>(null);
  const [recalcResult, setRecalcResult] = useState<{
    type: string;
    report: CalculationRunReport | null;
    message?: string;
  } | null>(null);
  const [recalcDetailOpen, setRecalcDetailOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<Calculation | null>(null);
  const [filterType, setFilterType] = useState<string>("");

  const visibleTypes = types.filter((ct) => !ct.is_hidden);

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
    const payload = {
      name: data.name,
      description: data.description || null,
      target_type_key: data.target_type_key,
      target_field_key: data.target_field_key,
      formula: data.formula,
      execution_order: data.execution_order,
      blanks_as_zero: data.blanks_as_zero ?? false,
    };
    if (data.id) {
      await api.patch(`/calculations/${data.id}`, payload);
    } else {
      await api.post("/calculations", payload);
    }
    // The card-detail / inventory lock reads a cached map of calculated
    // fields; drop it so the next card opened in this session locks the target.
    invalidateCalculatedFields();
    await fetchCalculations();
  };

  const handleToggleActive = async (calc: Calculation) => {
    try {
      if (calc.is_active) {
        await api.post(`/calculations/${calc.id}/deactivate`, {});
      } else {
        await api.post(`/calculations/${calc.id}/activate`, {});
      }
      invalidateCalculatedFields();
      await fetchCalculations();
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  const handleDelete = async (calc: Calculation) => {
    try {
      await api.delete(`/calculations/${calc.id}`);
      setDeleteConfirm(null);
      invalidateCalculatedFields();
      await fetchCalculations();
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  const handleRecalculate = async (typeKey: string) => {
    setRecalculating(typeKey);
    setRecalcResult(null);
    setRecalcDetailOpen(false);
    try {
      const report = await api.post<CalculationRunReport>(
        `/calculations/recalculate/${typeKey}`,
        {},
      );
      setRecalcResult({ type: typeKey, report });
      // The list's per-row Error/OK chip is settled by the run, so pull the
      // rows back rather than leaving a stale status next to fresh results.
      await fetchCalculations();
    } catch (e: unknown) {
      setRecalcResult({ type: typeKey, report: null, message: `Error: ${String(e)}` });
    } finally {
      setRecalculating(null);
    }
  };

  const filteredCalcs = filterType
    ? calculations.filter((c) => c.target_type_key === filterType)
    : calculations;

  const getTypeLabel = (key: string) => {
    const ct = types.find((ct) => ct.key === key);
    return ct ? typeLabel(ct) : key;
  };

  const getFieldLabel = (typeKey: string, fieldKey: string) => {
    const cardType = types.find((ct) => ct.key === typeKey);
    if (!cardType) return fieldKey;
    for (const section of cardType.fields_schema || []) {
      for (const field of section.fields) {
        if (field.key === fieldKey) return fieldLabel(field);
      }
    }
    return fieldKey;
  };

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 3, flexWrap: "wrap" }}>
        <MaterialSymbol icon="calculate" size={22} />
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          {t("calculations.title")}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>{t("calculations.filterByType")}</InputLabel>
          <Select
            value={filterType}
            label={t("calculations.filterByType")}
            onChange={(e) => setFilterType(e.target.value)}
          >
            <MenuItem value="">{t("calculations.allTypes")}</MenuItem>
            {visibleTypes.map((ct) => (
              <MenuItem key={ct.key} value={ct.key}>
                {typeLabel(ct)}
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
          {t("calculations.newCalculation")}
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {recalcResult && (
        <Alert
          severity={
            !recalcResult.report
              ? "error"
              : recalcResult.report.calculations_failed > 0
                ? "warning"
                : "success"
          }
          sx={{ mb: 2 }}
          onClose={() => setRecalcResult(null)}
          action={
            recalcResult.report && recalcResult.report.calculations.length > 0 ? (
              <Button
                color="inherit"
                size="small"
                onClick={() => setRecalcDetailOpen(true)}
              >
                {t("calculations.recalcViewDetails")}
              </Button>
            ) : undefined
          }
        >
          <strong>{getTypeLabel(recalcResult.type)}:</strong>{" "}
          {recalcResult.report
            ? t("calculations.recalcResult", {
                cards: recalcResult.report.cards_processed,
                succeeded: recalcResult.report.calculations_succeeded,
                failed: recalcResult.report.calculations_failed,
              })
            : recalcResult.message}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      ) : filteredCalcs.length === 0 ? (
        <Card>
          <CardContent sx={{ textAlign: "center", py: 6 }}>
            <MaterialSymbol icon="calculate" size={48} color={theme.palette.action.disabled} />
            <Typography variant="h6" color="text.secondary" sx={{ mt: 1 }}>
              {t("calculations.noCalculations")}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t("calculations.noCalculationsHint")}
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <TableContainer component={Card}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t("common:labels.name")}</TableCell>
                <TableCell>{t("calculations.columns.targetType")}</TableCell>
                <TableCell>{t("calculations.columns.targetField")}</TableCell>
                <TableCell>{t("calculations.columns.order")}</TableCell>
                <TableCell align="center">{t("calculations.columns.active")}</TableCell>
                <TableCell>{t("calculations.columns.lastRun")}</TableCell>
                <TableCell>{t("common:labels.status")}</TableCell>
                <TableCell align="right">{t("calculations.columns.actions")}</TableCell>
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
                        <LinkifiedText text={calc.description} />
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
                        {formatDateTime(calc.last_run_at)}
                      </Typography>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        {t("calculations.never")}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {!!calc.warnings?.length && (
                      <Tooltip title={calc.warnings.join("\n")}>
                        <Chip
                          size="small"
                          label={t("calculations.warning")}
                          color="warning"
                          sx={{ mr: 0.5 }}
                        />
                      </Tooltip>
                    )}
                    {calc.last_error ? (
                      <Tooltip title={calc.last_error}>
                        <Chip size="small" label={t("calculations.error")} color="error" />
                      </Tooltip>
                    ) : calc.last_run_at ? (
                      <Chip size="small" label={t("calculations.ok")} color="success" />
                    ) : null}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title={t("calculations.editTooltip")}>
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
                    <Tooltip title={t("calculations.testTooltip")}>
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
                    <Tooltip title={t("calculations.recalculateTooltip")}>
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
                    <Tooltip title={t("calculations.deleteTooltip")}>
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

      <RecalcResultDialog
        open={recalcDetailOpen}
        report={recalcResult?.report ?? null}
        typeName={recalcResult ? getTypeLabel(recalcResult.type) : ""}
        onClose={() => setRecalcDetailOpen(false)}
      />

      {/* Delete confirmation */}
      <Dialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)}>
        <DialogTitle>{t("calculations.deleteCalculation")}</DialogTitle>
        <DialogContent>
          <Typography>
            {t("calculations.deleteConfirm", { name: deleteConfirm?.name })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)}>{t("common:actions.cancel")}</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
          >
            {t("common:actions.delete")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
