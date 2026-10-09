import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import LinearProgress from "@mui/material/LinearProgress";
import Link from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useFieldLabel, useOptionLabel } from "@/hooks/useResolveLabel";
import { brand, SEVERITY_COLORS, STATUS_COLORS } from "@/theme/tokens";
import type { AiSuggestResponse, FieldDef, SectionDef } from "@/types";

/** Resolved field suggestions: description + any extra attribute suggestions. */
export interface AiApplyPayload {
  description: string;
  fields?: Record<string, unknown>;
}

interface Props {
  /** AI suggestion response from the API */
  response: AiSuggestResponse | null;
  /** Whether the AI search is in progress */
  loading: boolean;
  /** Error message if the suggestion failed */
  error: string;
  /** Called when user accepts the suggestions */
  onApply: (payload: AiApplyPayload) => void;
  /** Called when user dismisses the panel */
  onDismiss: () => void;
  /** Field definitions from the card type (to resolve labels/options for extra fields) */
  fieldsSchema?: SectionDef[];
}

/** Confidence badge colour (the badge itself shows the percentage). */
function confidenceBadge(confidence: number) {
  if (confidence >= 0.8) return { color: STATUS_COLORS.success };
  if (confidence >= 0.5) return { color: STATUS_COLORS.warning };
  return { color: STATUS_COLORS.error };
}

/** Resolve a FieldDef from fieldsSchema by key */
function findField(fieldsSchema: SectionDef[] | undefined, key: string): FieldDef | null {
  if (!fieldsSchema) return null;
  for (const section of fieldsSchema) {
    for (const field of section.fields) {
      if (field.key === key) return field;
    }
  }
  return null;
}

export default function AiSuggestPanel({
  response,
  loading,
  error,
  onApply,
  onDismiss,
  fieldsSchema,
}: Props) {
  const { t } = useTranslation(["common"]);
  const fieldLabel = useFieldLabel();
  const optionLabel = useOptionLabel();

  const [editedDescription, setEditedDescription] = useState<string | null>(null);
  const [fieldOverrides, setFieldOverrides] = useState<Record<string, unknown>>({});

  // Reset overrides when response changes
  useEffect(() => {
    setEditedDescription(null);
    setFieldOverrides({});
  }, [response]);

  const suggestion = response?.suggestions?.description;

  // Collect non-description suggestions
  const extraSuggestions = Object.entries(response?.suggestions ?? {}).filter(
    ([k]) => k !== "description",
  );

  // Loading state
  if (loading) {
    return (
      <Paper
        variant="outlined"
        sx={{ p: 2, mt: 2, borderColor: "primary.main", borderStyle: "dashed" }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
          <MaterialSymbol icon="auto_awesome" size={20} color={brand.primary} />
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
          <MaterialSymbol icon="error_outline" size={20} color={SEVERITY_COLORS.critical} />
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

  // No response or no suggestions at all
  if (!response || (!suggestion && extraSuggestions.length === 0)) return null;

  const badge = suggestion ? confidenceBadge(suggestion.confidence) : null;
  const currentValue = editedDescription ?? (suggestion?.value as string) ?? "";

  const handleApply = () => {
    const fields: Record<string, unknown> = {};
    for (const [key, s] of extraSuggestions) {
      fields[key] = key in fieldOverrides ? fieldOverrides[key] : s.value;
    }
    onApply({
      description: currentValue,
      fields: Object.keys(fields).length > 0 ? fields : undefined,
    });
  };

  const hasDescription = !!suggestion;
  const buttonLabel = extraSuggestions.length > 0 ? t("ai.applySuggestions") : t("ai.applyDescription");

  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, mt: 2, borderColor: "primary.main", borderStyle: "dashed" }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
        <MaterialSymbol icon="auto_awesome" size={20} color={brand.primary} />
        <Typography variant="subtitle2" fontWeight={600}>
          {t("ai.suggestionsTitle")}
        </Typography>
      </Box>

      {/* Description */}
      {hasDescription && badge && (
        <>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
            <Typography variant="body2" fontWeight={600}>
              {t("labels.description")}
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

          <TextField
            fullWidth
            multiline
            minRows={2}
            maxRows={6}
            size="small"
            value={currentValue}
            onChange={(e) => setEditedDescription(e.target.value)}
            sx={{ mt: 0.5 }}
          />
        </>
      )}

      {/* Extra field suggestions */}
      {extraSuggestions.map(([key, s]) => {
        const fieldDef = findField(fieldsSchema, key);
        if (!fieldDef) return null;
        const fBadge = confidenceBadge(s.confidence);
        const currentFieldVal = key in fieldOverrides ? fieldOverrides[key] : s.value;

        return (
          <Box key={key} sx={{ mt: hasDescription ? 2 : 0 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
              <Typography variant="body2" fontWeight={600}>
                {fieldLabel(fieldDef)}
              </Typography>
              <Tooltip
                title={`${t("ai.confidence")}: ${Math.round(s.confidence * 100)}%`}
              >
                <Chip
                  label={`${Math.round(s.confidence * 100)}%`}
                  size="small"
                  sx={{
                    height: 18,
                    fontSize: "0.65rem",
                    fontWeight: 700,
                    bgcolor: fBadge.color + "20",
                    color: fBadge.color,
                  }}
                />
              </Tooltip>
              {s.source && (
                <Typography variant="caption" color="text.secondary">
                  {s.source}
                </Typography>
              )}
            </Box>

            {fieldDef.type === "boolean" && (
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={!!currentFieldVal}
                    onChange={(e) =>
                      setFieldOverrides((prev) => ({ ...prev, [key]: e.target.checked }))
                    }
                  />
                }
                label={
                  <Typography variant="body2">
                    {currentFieldVal ? t("labels.yes") : t("labels.no")}
                  </Typography>
                }
              />
            )}

            {fieldDef.type === "single_select" && fieldDef.options && (
              <TextField
                select
                fullWidth
                size="small"
                value={currentFieldVal ?? ""}
                onChange={(e) =>
                  setFieldOverrides((prev) => ({ ...prev, [key]: e.target.value }))
                }
                sx={{ mt: 0.5 }}
              >
                {fieldDef.options.map((opt) => (
                  <MenuItem key={opt.key} value={opt.key}>
                    {optionLabel(opt)}
                  </MenuItem>
                ))}
              </TextField>
            )}
          </Box>
        );
      })}

      {/* Sources & model */}
      {(response.sources?.length || response.model) && (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, alignItems: "center", mt: 1.5 }}>
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
            <Typography variant="caption" color="text.secondary" component="span">
              {t("ai.sources")}:{" "}
              {response.sources
                .filter((s) => s.title)
                .slice(0, 5)
                .map((s, i) => (
                  <span key={i}>
                    {i > 0 && ", "}
                    {s.url ? (
                      <Link
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        variant="caption"
                        underline="hover"
                      >
                        {s.title}
                      </Link>
                    ) : (
                      s.title
                    )}
                  </span>
                ))}
            </Typography>
          )}
        </Box>
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
          disabled={hasDescription && !currentValue.trim()}
          startIcon={<MaterialSymbol icon="check" size={16} />}
        >
          {buttonLabel}
        </Button>
      </Box>
    </Paper>
  );
}
