import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import Divider from "@mui/material/Divider";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useResolveLabel } from "@/hooks/useResolveLabel";
import type {
  AiFieldSuggestion,
  AiSuggestResponse,
  CardType,
  FieldDef,
} from "@/types";

interface Props {
  /** Current card type definition (for field labels / options) */
  typeConfig: CardType;
  /** AI suggestion response from the API */
  response: AiSuggestResponse | null;
  /** Whether the AI search is in progress */
  loading: boolean;
  /** Error message if the suggestion failed */
  error: string;
  /** Called when user accepts selected suggestions */
  onApply: (values: Record<string, unknown>) => void;
  /** Called when user dismisses the panel */
  onDismiss: () => void;
}

/** Confidence level label and color */
function confidenceBadge(confidence: number) {
  if (confidence >= 0.8) return { label: "High", color: "#4caf50" };
  if (confidence >= 0.5) return { label: "Medium", color: "#ff9800" };
  return { label: "Low", color: "#f44336" };
}

/** Builds a flat lookup of field key → FieldDef from the type's fields_schema */
function buildFieldMap(typeConfig: CardType): Record<string, FieldDef> {
  const map: Record<string, FieldDef> = {};
  for (const section of typeConfig.fields_schema) {
    for (const field of section.fields) {
      map[field.key] = field;
    }
  }
  return map;
}

export default function AiSuggestPanel({
  typeConfig,
  response,
  loading,
  error,
  onApply,
  onDismiss,
}: Props) {
  const { t } = useTranslation(["common"]);
  const rl = useResolveLabel();

  const fieldMap = useMemo(() => buildFieldMap(typeConfig), [typeConfig]);

  // Track which fields are checked for apply
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  // Track user edits to text suggestions
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});

  // Initialise checked state when response arrives
  const suggestions = response?.suggestions ?? {};
  const keys = Object.keys(suggestions);

  // Auto-check fields with high confidence on first render
  const initialChecked = useMemo(() => {
    const init: Record<string, boolean> = {};
    for (const [key, s] of Object.entries(suggestions)) {
      init[key] = s.confidence >= 0.5;
    }
    return init;
  }, [suggestions]);

  // Use initialChecked as base, overlay user toggles
  const effectiveChecked = useMemo(() => {
    const result = { ...initialChecked };
    for (const [k, v] of Object.entries(checked)) {
      result[k] = v;
    }
    return result;
  }, [initialChecked, checked]);

  const handleToggle = (key: string) => {
    setChecked((prev) => ({ ...prev, [key]: !effectiveChecked[key] }));
  };

  const handleApply = () => {
    const values: Record<string, unknown> = {};
    for (const key of keys) {
      if (!effectiveChecked[key]) continue;
      const suggestion = suggestions[key];
      if (key === "description") {
        values[key] = editedValues[key] ?? suggestion.value;
      } else {
        values[key] = suggestion.value;
      }
    }
    onApply(values);
  };

  const selectedCount = keys.filter((k) => effectiveChecked[k]).length;

  const getFieldLabel = (key: string): string => {
    if (key === "description") return t("labels.description");
    const field = fieldMap[key];
    if (field) return rl(field.key, field.translations);
    return key;
  };

  const getOptionLabel = (
    fieldKey: string,
    optionKey: string,
  ): string => {
    const field = fieldMap[fieldKey];
    if (!field?.options) return optionKey;
    const opt = field.options.find((o) => o.key === optionKey);
    if (opt) return rl(opt.key, opt.translations);
    return optionKey;
  };

  const renderSuggestionValue = (
    key: string,
    suggestion: AiFieldSuggestion,
  ) => {
    const field = fieldMap[key];
    const ftype = field?.type;

    // Description: show as editable multiline
    if (key === "description") {
      return (
        <TextField
          fullWidth
          multiline
          minRows={2}
          maxRows={6}
          size="small"
          value={editedValues[key] ?? (suggestion.value as string) ?? ""}
          onChange={(e) =>
            setEditedValues((prev) => ({ ...prev, [key]: e.target.value }))
          }
          sx={{ mt: 0.5 }}
        />
      );
    }

    // Select fields: show selected + alternatives
    if (ftype === "single_select") {
      return (
        <Box sx={{ mt: 0.5, display: "flex", flexWrap: "wrap", gap: 0.5 }}>
          <Chip
            label={getOptionLabel(key, suggestion.value as string)}
            size="small"
            color="primary"
            variant="filled"
          />
          {suggestion.alternatives?.map((alt) => (
            <Chip
              key={alt}
              label={getOptionLabel(key, alt)}
              size="small"
              variant="outlined"
              sx={{ opacity: 0.7 }}
            />
          ))}
        </Box>
      );
    }

    // Default: show as text
    return (
      <Typography variant="body2" sx={{ mt: 0.5 }}>
        {String(suggestion.value ?? "")}
      </Typography>
    );
  };

  // Loading state
  if (loading) {
    return (
      <Paper
        variant="outlined"
        sx={{ p: 2, mt: 2, borderColor: "primary.main", borderStyle: "dashed" }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
          <MaterialSymbol icon="auto_awesome" size={20} color="#1976d2" />
          <Typography variant="subtitle2" fontWeight={600}>
            {t("ai.searching")}
          </Typography>
        </Box>
        <LinearProgress sx={{ borderRadius: 1 }} />
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
          {t("ai.searchingHint")}
        </Typography>
      </Paper>
    );
  }

  // Error state
  if (error) {
    return (
      <Paper
        variant="outlined"
        sx={{ p: 2, mt: 2, borderColor: "error.main", borderStyle: "dashed" }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
          <MaterialSymbol icon="error_outline" size={20} color="#d32f2f" />
          <Typography variant="subtitle2" fontWeight={600} color="error">
            {t("ai.error")}
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary">
          {error}
        </Typography>
        <Button size="small" sx={{ mt: 1 }} onClick={onDismiss}>
          {t("actions.close")}
        </Button>
      </Paper>
    );
  }

  // No response yet
  if (!response || keys.length === 0) return null;

  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, mt: 2, borderColor: "primary.main", borderStyle: "dashed" }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
        <MaterialSymbol icon="auto_awesome" size={20} color="#1976d2" />
        <Typography variant="subtitle2" fontWeight={600}>
          {t("ai.suggestionsTitle")}
        </Typography>
        <Box sx={{ ml: "auto" }}>
          <Typography variant="caption" color="text.secondary">
            {t("ai.selectedCount", { count: selectedCount, total: keys.length })}
          </Typography>
        </Box>
      </Box>

      {keys.map((key, idx) => {
        const suggestion = suggestions[key];
        const badge = confidenceBadge(suggestion.confidence);
        return (
          <Box key={key}>
            {idx > 0 && <Divider sx={{ my: 1 }} />}
            <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.5 }}>
              <Checkbox
                size="small"
                checked={!!effectiveChecked[key]}
                onChange={() => handleToggle(key)}
                sx={{ mt: -0.5, ml: -0.5 }}
              />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Typography variant="body2" fontWeight={600}>
                    {getFieldLabel(key)}
                  </Typography>
                  <Tooltip
                    title={`${t("ai.confidence")}: ${Math.round(suggestion.confidence * 100)}%`}
                  >
                    <Chip
                      label={`${Math.round(suggestion.confidence * 100)}%`}
                      size="small"
                      sx={{
                        height: 18,
                        fontSize: "0.65rem",
                        fontWeight: 700,
                        bgcolor: badge.color + "20",
                        color: badge.color,
                      }}
                    />
                  </Tooltip>
                  {suggestion.source && (
                    <Typography variant="caption" color="text.secondary">
                      {suggestion.source}
                    </Typography>
                  )}
                </Box>
                <Collapse in={true}>
                  {renderSuggestionValue(key, suggestion)}
                </Collapse>
              </Box>
            </Box>
          </Box>
        );
      })}

      {/* Sources & model */}
      {(response.sources?.length || response.model) && (
        <>
          <Divider sx={{ my: 1.5 }} />
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, alignItems: "center" }}>
            {response.model && (
              <Chip
                label={response.model}
                size="small"
                variant="outlined"
                icon={<MaterialSymbol icon="smart_toy" size={14} />}
                sx={{ height: 20, fontSize: "0.7rem" }}
              />
            )}
            {response.sources && response.sources.length > 0 && (
              <Typography variant="caption" color="text.secondary">
                {t("ai.sources")}:{" "}
                {response.sources
                  .filter((s) => s.title)
                  .slice(0, 5)
                  .map((s) => s.title)
                  .join(", ")}
              </Typography>
            )}
          </Box>
        </>
      )}

      {/* Actions */}
      <Box sx={{ display: "flex", gap: 1, mt: 2, justifyContent: "flex-end" }}>
        <Button size="small" onClick={onDismiss} color="inherit">
          {t("ai.dismiss")}
        </Button>
        <Button
          size="small"
          variant="contained"
          onClick={handleApply}
          disabled={selectedCount === 0}
          startIcon={<MaterialSymbol icon="check" size={16} />}
        >
          {t("ai.applySelected", { count: selectedCount })}
        </Button>
      </Box>
    </Paper>
  );
}
