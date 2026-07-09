import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
import Autocomplete from "@mui/material/Autocomplete";
import IconButton from "@mui/material/IconButton";
import { useTheme } from "@mui/material/styles";
import {
  useResolveLabel,
  useResolveMetaLabel,
  useTypeLabel,
  useSubtypeLabel,
  useOptionLabel,
  useFieldLabel,
} from "@/hooks/useResolveLabel";
import { useMetamodel } from "@/hooks/useMetamodel";
import Tooltip from "@mui/material/Tooltip";
import Divider from "@mui/material/Divider";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { ExtensionBoundary, useExtensionFieldTypes } from "@/lib/extensionHost";
import { FieldHelp } from "@/features/cards/sections/cardDetailUtils";
import type { SurveyRespondForm, SurveyField } from "@/types";

type OptionLabelResolver = (key: string, translations?: Record<string, string>) => string;

interface RelationRef {
  id: string;
  name: string;
}

/** True when a value is a list of related-card references ({id, name}). */
function isRelationRefList(val: unknown): val is RelationRef[] {
  return (
    Array.isArray(val) &&
    val.every((v) => v !== null && typeof v === "object" && "id" in (v as object))
  );
}

/** Resolve a value to its display label using field options when available. */
function formatValue(
  val: unknown,
  field?: SurveyField & { current_value?: unknown },
  t?: (key: string) => string,
  rl?: OptionLabelResolver,
): string {
  if (field?.kind === "relation" || isRelationRefList(val)) {
    if (!isRelationRefList(val) || val.length === 0) return "—";
    return val.map((r) => r.name).join(", ");
  }
  if (val === null || val === undefined || val === "") return "—";
  if (typeof val === "boolean") return val ? (t ? t("common:labels.yes") : "Yes") : (t ? t("common:labels.no") : "No");

  const opts = field?.options;
  if (opts && opts.length > 0) {
    const optLabel = (key: unknown) => {
      const opt = opts.find((o) => o.key === key);
      if (!opt) return String(key);
      return rl ? rl(opt.label || opt.key, opt.translations) : (opt.label ?? opt.key);
    };
    if (Array.isArray(val)) {
      return val.map(optLabel).join(", ");
    }
    return optLabel(val);
  }

  if (Array.isArray(val)) return val.join(", ");
  return String(val);
}

interface FieldResponse {
  confirmed: boolean;
  new_value: unknown;
}

/** Card-picker for a relation survey field: search cards of the related type
 * and edit the linked set. Manages its own debounced search + options. */
function RelationFieldEditor({
  relatedTypeKey,
  value,
  onChange,
  placeholder,
  chipColor,
}: {
  relatedTypeKey?: string;
  value: RelationRef[];
  onChange: (refs: RelationRef[]) => void;
  placeholder: string;
  chipColor?: { bg: string; fg: string };
}) {
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<RelationRef[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Load candidates as soon as the dropdown opens (empty query returns the
  // first cards of the related type) and refine as the user types — users
  // can't be expected to know linkable card names by heart.
  useEffect(() => {
    if (!relatedTypeKey || !open) {
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.get<{ items: RelationRef[] }>(
          `/cards?type=${encodeURIComponent(relatedTypeKey)}&search=${encodeURIComponent(search)}&page_size=20`,
        );
        setOptions(res.items.map((c) => ({ id: c.id, name: c.name })));
      } catch {
        // ignore — empty option list
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [search, relatedTypeKey, open]);

  const merged = useMemo(() => {
    const ids = new Set(options.map((o) => o.id));
    return [...options, ...value.filter((v) => !ids.has(v.id))];
  }, [options, value]);

  return (
    <Autocomplete
      multiple
      filterSelectedOptions
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      loading={loading}
      options={merged}
      getOptionLabel={(o) => o.name}
      isOptionEqualToValue={(opt, val) => opt.id === val.id}
      value={value}
      inputValue={search}
      onInputChange={(_, val, reason) => {
        if (reason !== "reset") setSearch(val);
      }}
      onChange={(_, vals) => onChange(vals)}
      renderOption={(props, opt) => (
        <li {...props} key={opt.id}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            {chipColor && (
              <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: chipColor.bg, flexShrink: 0 }} />
            )}
            <Typography variant="body2">{opt.name}</Typography>
          </Box>
        </li>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          size="small"
          placeholder={placeholder}
          slotProps={{
            input: {
              ...params.InputProps,
              endAdornment: (
                <>
                  {loading ? <CircularProgress color="inherit" size={16} /> : null}
                  {params.InputProps.endAdornment}
                </>
              ),
            },
          }}
        />
      )}
      renderTags={(vals, getTagProps) =>
        vals.map((v, i) => (
          <Chip
            {...getTagProps({ index: i })}
            key={v.id}
            label={v.name}
            size="small"
            sx={
              chipColor
                ? { bgcolor: chipColor.bg, color: chipColor.fg, "& .MuiChip-deleteIcon": { color: chipColor.fg, opacity: 0.7 } }
                : undefined
            }
          />
        ))
      }
    />
  );
}

export default function SurveyRespond() {
  const { t, i18n } = useTranslation(["admin", "common"]);
  const extFieldTypes = useExtensionFieldTypes();
  const rl = useResolveLabel();
  const rml = useResolveMetaLabel();
  const typeLabel = useTypeLabel();
  const stLabel = useSubtypeLabel();
  const optLabel = useOptionLabel();
  const fieldLabel = useFieldLabel();
  const theme = useTheme();
  const { types } = useMetamodel();
  const { surveyId, cardId } = useParams<{ surveyId: string; cardId: string }>();

  // For a relation field, the related cards are all of one type (relation types
  // are unique per type pair), so colour the pills by that type's metamodel
  // colour and resolve its label for the "between X and Y" instruction.
  const relatedTypeColor = (key?: string): { bg: string; fg: string } => {
    const bg = types.find((ct) => ct.key === key)?.color || theme.palette.grey[500];
    return { bg, fg: theme.palette.getContrastText(bg) };
  };
  const relatedTypeLabel = (key?: string): string => {
    const ct = types.find((c) => c.key === key);
    return ct ? typeLabel(ct) : key || "";
  };
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
        setError(e instanceof Error ? e.message : t("surveys.respond.error.loadFailed"));
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
      setError(e instanceof Error ? e.message : t("surveys.respond.error.submitFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const renderFieldInput = (field: SurveyField & { current_value: unknown }, resp: FieldResponse) => {
    if (resp.confirmed) return null; // No input needed if confirmed

    if (field.kind === "relation") {
      // Baseline = current links; respondent edits the set (add/remove).
      const current = isRelationRefList(field.current_value) ? field.current_value : [];
      const selected = isRelationRefList(resp.new_value) ? resp.new_value : current;
      return (
        <RelationFieldEditor
          relatedTypeKey={field.related_type_key}
          value={selected}
          onChange={(refs) => setNewValue(field.key, refs)}
          placeholder={t("surveys.respond.searchRelated")}
          chipColor={relatedTypeColor(field.related_type_key)}
        />
      );
    }

    const value = resp.new_value ?? field.current_value ?? "";

    // Extension-contributed custom field type (e.g. a rating widget): render its
    // editor so a contributed field is answered with the same control as the
    // card detail. When the extension is missing/disabled it's absent from the
    // registry and we fall through to the built-in inputs (a plain text box).
    const custom = extFieldTypes[field.type];
    if (custom?.contribution.editor) {
      const Editor = custom.contribution.editor;
      return (
        <ExtensionBoundary extensionKey={custom.extKey}>
          <Editor
            field={{ key: field.key, label: field.label, type: field.type, config: field.config }}
            value={value === "" ? undefined : value}
            config={field.config ?? custom.contribution.defaultConfig}
            onChange={(v) => setNewValue(field.key, v)}
          />
        </ExtensionBoundary>
      );
    }

    if (field.type === "boolean") {
      return (
        <FormControlLabel
          control={
            <Switch
              checked={!!value}
              onChange={(e) => setNewValue(field.key, e.target.checked)}
            />
          }
          label={value ? t("common:labels.yes") : t("common:labels.no")}
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
            <em>{t("common:labels.none")}</em>
          </MenuItem>
          {field.options.map((opt) => (
            <MenuItem key={opt.key} value={opt.key}>
              {optLabel(opt)}
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
              {optLabel(opt)}
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
    return <Alert severity="error">{error || t("surveys.respond.notFound")}</Alert>;
  }

  if (submitted) {
    return (
      <Box sx={{ maxWidth: 600, mx: "auto", py: 6, textAlign: "center" }}>
        <MaterialSymbol icon="check_circle" size={64} color="#2e7d32" />
        <Typography variant="h5" sx={{ mt: 2, fontWeight: 700 }}>
          {t("surveys.respond.success")}
        </Typography>
        <Typography
          color="text.secondary"
          sx={{ mt: 1, mb: 3 }}
          dangerouslySetInnerHTML={{
            __html: t("surveys.respond.thankYou", {
              name: form.card.name,
              interpolation: { escapeValue: true },
            }),
          }}
        />
        <Button variant="outlined" onClick={() => navigate("/surveys")}>
          {t("surveys.respond.backToSurveys")}
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 800, mx: "auto" }}>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1 }}>
        <Tooltip title={t("surveys.respond.backTooltip")}>
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
        <Chip
          label={
            typeLabel(types.find((tp) => tp.key === form.card.type)) ||
            rml(form.card.type, form.card.type_translations, "label")
          }
          size="small"
          variant="outlined"
        />
        {form.card.subtype && (
          <Chip
            label={
              stLabel(
                types
                  .find((tp) => tp.key === form.card.type)
                  ?.subtypes?.find((s) => s.key === form.card.subtype),
              ) || rl(form.card.subtype, form.card.subtype_translations)
            }
            size="small"
          />
        )}
      </Card>

      {/* Survey message */}
      {form.survey.message && (
        <Card variant="outlined" sx={{ p: 2, mb: 3, bgcolor: "action.hover" }}>
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
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: field.kind === "relation" ? 0.5 : 1 }}>
              <Typography sx={{ fontWeight: 600, flex: 1 }}>
                {field.kind === "relation" ? field.label : fieldLabel(field)}
              </Typography>
              <Chip
                label={isMaintain ? t("surveys.respond.maintain") : t("surveys.respond.confirmLabel")}
                size="small"
                color={isMaintain ? "primary" : "default"}
                variant="outlined"
              />
              {field.kind !== "relation" && (
                <Typography variant="caption" color="text.secondary">
                  {rl(field.section, field.section_translations)}
                </Typography>
              )}
            </Box>

            {field.kind !== "relation" && (
              <FieldHelp
                text={(field.helpTranslations?.[i18n.language] as string) || field.help || ""}
              />
            )}

            {field.kind === "relation" && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {t(
                  isMaintain
                    ? "surveys.respond.relationMaintainInstruction"
                    : "surveys.respond.relationConfirmInstruction",
                  { card: form.card.name, related: relatedTypeLabel(field.related_type_key) },
                )}
              </Typography>
            )}

            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1, flexWrap: "wrap" }}>
              <Typography variant="body2" color="text.secondary">
                {t("surveys.respond.currentValue")}
              </Typography>
              {field.kind === "relation" ? (
                isRelationRefList(field.current_value) && field.current_value.length > 0 ? (
                  field.current_value.map((r) => {
                    const c = relatedTypeColor(field.related_type_key);
                    return (
                      <Chip
                        key={r.id}
                        label={r.name}
                        size="small"
                        sx={{ bgcolor: c.bg, color: c.fg }}
                      />
                    );
                  })
                ) : (
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    —
                  </Typography>
                )
              ) : (
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {formatValue(field.current_value, field, t, rl)}
                </Typography>
              )}
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
                        {t("surveys.respond.noChangeNeeded")}
                      </Typography>
                    }
                  />
                </Box>
                {!resp.confirmed && (
                  <Box sx={{ mt: 1.5 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                      {t("surveys.respond.updatedValue")}
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
                          ? t("surveys.respond.confirmCorrect")
                          : t("surveys.respond.proposeChange")}
                      </Typography>
                    }
                  />
                </Box>
                {!resp.confirmed && (
                  <Box sx={{ mt: 1.5 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                      {t("surveys.respond.proposedValue")}
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
          {submitting ? t("surveys.respond.submitting") : t("surveys.respond.submit")}
        </Button>
      </Box>
    </Box>
  );
}
