import { useState, useEffect } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Alert from "@mui/material/Alert";
import { useTranslation } from "react-i18next";
import type { CurrencyFormatter } from "@/hooks/useCurrency";
import MaterialSymbol from "@/components/MaterialSymbol";
import { FieldValue, FieldEditor, isValidUrl, getUrlErrorMsg } from "@/features/cards/sections/cardDetailUtils";
import { useFieldLabel } from "@/hooks/useResolveLabel";
import { ApiError } from "@/api/client";
import type { Card, FieldDef } from "@/types";

// ── Section: Description ────────────────────────────────────────
function DescriptionSection({
  card,
  onSave,
  canEdit = true,
  initialExpanded = true,
  extraFields,
  currencyFmt,
  onAiSuggest,
  aiBusy = false,
  onDirtyChange,
}: {
  card: Card;
  onSave: (u: Record<string, unknown>) => Promise<void>;
  canEdit?: boolean;
  initialExpanded?: boolean;
  extraFields?: FieldDef[];
  currencyFmt?: CurrencyFormatter;
  onAiSuggest?: () => void;
  aiBusy?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation(["cards", "common"]);
  const fieldLabel = useFieldLabel();
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState(card.description || "");
  const [attrs, setAttrs] = useState<Record<string, unknown>>(card.attributes || {});
  const [saveError, setSaveError] = useState<string | null>(null);

  // Re-sync the draft from the card prop only while NOT editing, so saving
  // another section (which replaces the whole card object in the parent) can't
  // clobber this section's in-progress draft (issue #843).
  useEffect(() => {
    if (!editing) {
      setDescription(card.description || "");
      setAttrs(card.attributes || {});
    }
  }, [card.description, card.attributes, editing]);

  // Report unsaved-changes state up so the page can warn on navigation (#843).
  const dirty =
    editing &&
    (description !== (card.description || "") ||
      JSON.stringify(attrs) !== JSON.stringify(card.attributes || {}));
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  // URL validation for extra fields
  const urlErrors: Record<string, string> = {};
  if (extraFields) {
    for (const f of extraFields) {
      if (f.type === "url") {
        const val = attrs[f.key];
        if (typeof val === "string" && val && !isValidUrl(val)) {
          urlErrors[f.key] = getUrlErrorMsg(t);
        }
      }
    }
  }
  const hasValidationErrors = Object.keys(urlErrors).length > 0;

  const save = async () => {
    if (hasValidationErrors) return;
    setSaveError(null);
    try {
      const updates: Record<string, unknown> = { description };
      if (extraFields && extraFields.length > 0) {
        updates.attributes = { ...(card.attributes || {}), ...attrs };
      }
      await onSave(updates);
      setEditing(false);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      setSaveError(msg);
    }
  };

  return (
    <Accordion defaultExpanded={initialExpanded} disableGutters>
      <AccordionSummary expandIcon={<MaterialSymbol icon="expand_more" size={20} />}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1 }}>
          <MaterialSymbol icon="description" size={20} />
          <Typography fontWeight={600}>{t("description.title")}</Typography>
        </Box>
        {!editing && canEdit && onAiSuggest && (
          <Tooltip title={t("common:ai.buttonTooltip")}>
            <span>
              <IconButton
                size="small"
                disabled={aiBusy}
                data-testid="ai-suggest-button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAiSuggest();
                }}
                sx={{ color: "#1976d2" }}
              >
                <MaterialSymbol icon="auto_awesome" size={20} />
              </IconButton>
            </span>
          </Tooltip>
        )}
        {!editing && canEdit && (
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
          >
            <MaterialSymbol icon="edit" size={16} />
          </IconButton>
        )}
      </AccordionSummary>
      <AccordionDetails>
        {editing && canEdit ? (
          <Box>
            <TextField
              fullWidth
              label={t("common:labels.description")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              multiline
              rows={4}
              size="small"
              sx={{ mb: 2 }}
            />
            {extraFields && extraFields.map((field) => (
              <Box key={field.key} sx={{ mb: 2 }}>
                <FieldEditor field={field} value={attrs[field.key]} onChange={(v) => setAttrs((prev) => ({ ...prev, [field.key]: v }))} error={urlErrors[field.key]} />
              </Box>
            ))}
            {saveError && (
              <Alert severity="error" sx={{ mb: 1 }} onClose={() => setSaveError(null)}>
                {saveError}
              </Alert>
            )}
            <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
              <Button
                size="small"
                onClick={() => {
                  setDescription(card.description || "");
                  setAttrs(card.attributes || {});
                  setEditing(false);
                  setSaveError(null);
                }}
              >
                {t("common:actions.cancel")}
              </Button>
              <Button size="small" variant="contained" onClick={save} disabled={hasValidationErrors}>
                {t("common:actions.save")}
              </Button>
            </Box>
          </Box>
        ) : (
          <Box sx={{ containerType: "inline-size" }}>
            <Typography variant="body2" color="text.secondary" whiteSpace="pre-wrap" sx={{ mb: extraFields?.length ? 1 : 0 }}>
              {card.description || t("description.noDescription")}
            </Typography>
            {extraFields && extraFields.length > 0 && (
              <Box sx={{ display: "flex", flexDirection: "column", rowGap: 1 }}>
                {extraFields.map((field) => {
                  // Multi-line text breaks out of the 180px label column to get full width.
                  if (field.type === "multiline_text") {
                    return (
                      <Box key={field.key}>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                          {fieldLabel(field)}
                        </Typography>
                        <FieldValue field={field} value={(card.attributes || {})[field.key]} currencyFmt={currencyFmt} />
                      </Box>
                    );
                  }
                  return (
                    <Box key={field.key} sx={{ display: "grid", gridTemplateColumns: "1fr", columnGap: 2, "@container (min-width: 480px)": { gridTemplateColumns: "180px 1fr", alignItems: "center" } }}>
                      <Typography variant="body2" color="text.secondary">{fieldLabel(field)}</Typography>
                      <FieldValue field={field} value={(card.attributes || {})[field.key]} currencyFmt={currencyFmt} />
                    </Box>
                  );
                })}
              </Box>
            )}
          </Box>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

export default DescriptionSection;
