import { useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { AiSuggestResponse } from "@/types";

interface Props {
  /** AI suggestion response from the API */
  response: AiSuggestResponse | null;
  /** Whether the AI search is in progress */
  loading: boolean;
  /** Error message if the suggestion failed */
  error: string;
  /** Called when user accepts the description */
  onApply: (description: string) => void;
  /** Called when user dismisses the panel */
  onDismiss: () => void;
}

/** Confidence level label and color */
function confidenceBadge(confidence: number) {
  if (confidence >= 0.8) return { label: "High", color: "#4caf50" };
  if (confidence >= 0.5) return { label: "Medium", color: "#ff9800" };
  return { label: "Low", color: "#f44336" };
}

export default function AiSuggestPanel({
  response,
  loading,
  error,
  onApply,
  onDismiss,
}: Props) {
  const { t } = useTranslation(["common"]);

  const [editedDescription, setEditedDescription] = useState<string | null>(null);

  const suggestion = response?.suggestions?.description;

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

  // No response or no description suggestion
  if (!response || !suggestion) return null;

  const badge = confidenceBadge(suggestion.confidence);
  const currentValue = editedDescription ?? (suggestion.value as string) ?? "";

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
      </Box>

      {/* Description label + confidence */}
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

      {/* Editable description */}
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
          onClick={() => onApply(currentValue)}
          disabled={!currentValue.trim()}
          startIcon={<MaterialSymbol icon="check" size={16} />}
        >
          {t("ai.applyDescription")}
        </Button>
      </Box>
    </Paper>
  );
}
