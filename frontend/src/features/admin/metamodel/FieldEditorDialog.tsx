import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import IconButton from "@mui/material/IconButton";
import Alert from "@mui/material/Alert";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import MaterialSymbol from "@/components/MaterialSymbol";
import ColorPicker from "@/components/ColorPicker";
import KeyInput, { isValidKey } from "@/components/KeyInput";
import { api } from "@/api/client";
import { SUPPORTED_LOCALES, LOCALE_LABELS } from "@/i18n";
import type { FieldDef, FieldOption, TranslationMap } from "@/types";
import { FIELD_TYPE_OPTIONS } from "./constants";

/** Locales to show translation inputs for (all except English). */
const TRANSLATION_LOCALES = SUPPORTED_LOCALES.filter((l) => l !== "en");

/** Remove empty-string entries from a TranslationMap. Returns undefined if all empty. */
function cleanTranslationMap(map: TranslationMap | undefined): TranslationMap | undefined {
  if (!map) return undefined;
  const cleaned: TranslationMap = {};
  for (const [k, v] of Object.entries(map)) {
    if (v && v.trim()) cleaned[k] = v.trim();
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

/* ------------------------------------------------------------------ */
/*  Field Editor Dialog                                                */
/* ------------------------------------------------------------------ */

export interface FieldEditorProps {
  open: boolean;
  field: FieldDef;
  typeKey: string;
  fieldKey: string;
  onClose: () => void;
  onSave: (field: FieldDef) => void;
  /** True if this field is the target of an active calculation */
  isCalculated?: boolean;
}

export default function FieldEditorDialog({ open, field: initial, typeKey, fieldKey, onClose, onSave, isCalculated }: FieldEditorProps) {
  const { t } = useTranslation(["admin", "common"]);
  const [field, setField] = useState<FieldDef>(initial);

  // Track which option keys existed before editing — these are locked
  const originalOptionKeys = useMemo(
    () => new Set((initial.options || []).map((o) => o.key).filter(Boolean)),
    [initial],
  );

  // Option deletion confirmation
  const [deleteOptConfirm, setDeleteOptConfirm] = useState<{
    idx: number;
    optionKey: string;
    optionLabel: string;
    cardCount: number | null; // null = loading
  } | null>(null);

  useEffect(() => {
    if (open) {
      setField({ ...initial });
      setDeleteOptConfirm(null);
    }
  }, [open, initial]);

  const isSelect = field.type === "single_select" || field.type === "multiple_select";

  const updateOption = (idx: number, patch: Partial<FieldOption>) => {
    const opts = [...(field.options || [])];
    opts[idx] = { ...opts[idx], ...patch };
    setField({ ...field, options: opts });
  };

  const addOption = () => {
    setField({
      ...field,
      options: [...(field.options || []), { key: "", label: "" }],
    });
  };

  const removeOption = (idx: number) => {
    const opts = [...(field.options || [])];
    opts.splice(idx, 1);
    setField({ ...field, options: opts });
    setDeleteOptConfirm(null);
  };

  const promptRemoveOption = (idx: number) => {
    const opt = (field.options || [])[idx];
    if (!opt) return;

    // New options (not yet saved) can be removed without confirmation
    if (!originalOptionKeys.has(opt.key)) {
      removeOption(idx);
      return;
    }

    // Existing option — check usage
    setDeleteOptConfirm({ idx, optionKey: opt.key, optionLabel: opt.label, cardCount: null });
    if (typeKey && fieldKey) {
      api
        .get<{ card_count: number }>(
          `/metamodel/types/${typeKey}/option-usage?field_key=${encodeURIComponent(fieldKey)}&option_key=${encodeURIComponent(opt.key)}`,
        )
        .then((r) => setDeleteOptConfirm((prev) => (prev ? { ...prev, cardCount: r.card_count } : null)))
        .catch(() => setDeleteOptConfirm((prev) => (prev ? { ...prev, cardCount: 0 } : null)));
    } else {
      setDeleteOptConfirm((prev) => (prev ? { ...prev, cardCount: 0 } : null));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth disableRestoreFocus>
      <DialogTitle>{initial.key ? t("metamodel.fieldEditor.editField") : t("metamodel.fieldEditor.addField")}</DialogTitle>
      <DialogContent>
        {isCalculated && (
          <Alert severity="info" sx={{ mb: 2, mt: 1 }}>
            {t("metamodel.fieldEditor.calculatedInfo")}
          </Alert>
        )}
        <KeyInput
          fullWidth
          label={t("metamodel.fieldEditor.keyLabel")}
          value={field.key}
          onChange={(v) => setField({ ...field, key: v })}
          sx={{ mt: 1, mb: 2 }}
          size="small"
          locked={!!initial.key}
          lockedReason={t("metamodel.fieldEditor.keyLockedReason")}
        />
        <TextField
          fullWidth
          label={t("metamodel.fieldEditor.labelLabel")}
          value={field.label}
          onChange={(e) => setField({ ...field, label: e.target.value })}
          sx={{ mb: 1 }}
        />
        <Accordion variant="outlined" sx={{ mb: 2, "&:before": { display: "none" } }} disableGutters>
          <AccordionSummary
            expandIcon={<MaterialSymbol icon="expand_more" size={16} />}
            sx={{ minHeight: 32, "& .MuiAccordionSummary-content": { my: 0.25 } }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <MaterialSymbol icon="translate" size={14} color="#999" />
              <Typography variant="caption" color="text.secondary">
                {t("metamodel.translations.fieldTranslations")}
              </Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0, pb: 1 }}>
            <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
              {TRANSLATION_LOCALES.map((locale) => (
                <TextField
                  key={`field-${locale}`}
                  size="small"
                  label={LOCALE_LABELS[locale]}
                  value={field.translations?.[locale] || ""}
                  onChange={(e) =>
                    setField({
                      ...field,
                      translations: { ...field.translations, [locale]: e.target.value },
                    })
                  }
                />
              ))}
            </Box>
          </AccordionDetails>
        </Accordion>
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>{t("metamodel.fieldEditor.typeLabel")}</InputLabel>
          <Select
            value={field.type}
            label={t("metamodel.fieldEditor.typeLabel")}
            disabled={!!isCalculated}
            onChange={(e) =>
              setField({ ...field, type: e.target.value as FieldDef["type"] })
            }
          >
            {FIELD_TYPE_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {t(o.tKey)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Box sx={{ display: "flex", gap: 2, mb: 2, alignItems: "center" }}>
          <FormControlLabel
            control={
              <Switch
                checked={!!field.required}
                onChange={(e) =>
                  setField({ ...field, required: e.target.checked })
                }
              />
            }
            label={t("metamodel.fieldEditor.required")}
          />
          <TextField
            label={t("metamodel.fieldEditor.weight")}
            type="number"
            value={field.weight ?? 0}
            onChange={(e) =>
              setField({ ...field, weight: Number(e.target.value) })
            }
            sx={{ width: 120 }}
            size="small"
          />
        </Box>
        {isSelect && (
          <>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {t("metamodel.fieldEditor.options")}
            </Typography>
            {(field.options || []).map((opt, idx) => (
              <Box key={idx}>
                <Box
                  sx={{ display: "flex", gap: 1, mb: 0.5, alignItems: "flex-start" }}
                >
                  <KeyInput
                    size="small"
                    label={t("metamodel.fieldEditor.optionKeyLabel")}
                    value={opt.key}
                    onChange={(v) => updateOption(idx, { key: v })}
                    sx={{ flex: 1 }}
                    locked={originalOptionKeys.has(opt.key)}
                    lockedReason={t("metamodel.fieldEditor.optionKeyLocked")}
                  />
                  <TextField
                    size="small"
                    label={t("metamodel.fieldEditor.optionLabelLabel")}
                    value={opt.label}
                    onChange={(e) => updateOption(idx, { label: e.target.value })}
                    sx={{ flex: 1 }}
                    helperText=" "
                  />
                  <ColorPicker
                    compact
                    value={opt.color || "#1976d2"}
                    onChange={(c) => updateOption(idx, { color: c })}
                  />
                  <IconButton size="small" onClick={() => promptRemoveOption(idx)}>
                    <MaterialSymbol icon="close" size={18} />
                  </IconButton>
                </Box>
                <Accordion
                  variant="outlined"
                  disableGutters
                  sx={{ mb: deleteOptConfirm?.idx === idx ? 0.5 : 1, "&:before": { display: "none" } }}
                >
                  <AccordionSummary
                    expandIcon={<MaterialSymbol icon="expand_more" size={16} />}
                    sx={{ minHeight: 28, "& .MuiAccordionSummary-content": { my: 0.25 } }}
                  >
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                      <MaterialSymbol icon="translate" size={14} color="#999" />
                      <Typography variant="caption" color="text.secondary">
                        {t("metamodel.translations.optionTranslations", { label: opt.label || opt.key })}
                      </Typography>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={{ pt: 0, pb: 1 }}>
                    <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
                      {TRANSLATION_LOCALES.map((locale) => (
                        <TextField
                          key={`opt-${idx}-${locale}`}
                          size="small"
                          label={LOCALE_LABELS[locale]}
                          value={opt.translations?.[locale] || ""}
                          onChange={(e) =>
                            updateOption(idx, {
                              translations: { ...opt.translations, [locale]: e.target.value },
                            })
                          }
                        />
                      ))}
                    </Box>
                  </AccordionDetails>
                </Accordion>
                {deleteOptConfirm?.idx === idx && (
                  <Alert
                    severity={deleteOptConfirm.cardCount === null ? "info" : deleteOptConfirm.cardCount > 0 ? "warning" : "info"}
                    sx={{ mb: 1, py: 0.5 }}
                    action={
                      <Box sx={{ display: "flex", gap: 0.5 }}>
                        <Button size="small" color="inherit" onClick={() => setDeleteOptConfirm(null)}>
                          {t("common:actions.cancel")}
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          disabled={deleteOptConfirm.cardCount === null}
                          onClick={() => removeOption(idx)}
                        >
                          {t("common:actions.remove")}
                        </Button>
                      </Box>
                    }
                  >
                    {deleteOptConfirm.cardCount === null
                      ? t("metamodel.fieldEditor.checkingUsage")
                      : deleteOptConfirm.cardCount > 0
                        ? t("metamodel.fieldEditor.optionUsedByCards", { label: deleteOptConfirm.optionLabel, count: deleteOptConfirm.cardCount })
                        : t("metamodel.fieldEditor.optionSafeToRemove", { label: deleteOptConfirm.optionLabel })}
                  </Alert>
                )}
              </Box>
            ))}
            <Button
              size="small"
              startIcon={<MaterialSymbol icon="add" size={16} />}
              onClick={addOption}
            >
              {t("metamodel.fieldEditor.addOption")}
            </Button>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        <Button
          variant="contained"
          onClick={() => {
            const cleanedField: FieldDef = {
              ...field,
              translations: cleanTranslationMap(field.translations),
              options: field.options?.map((o) => ({
                ...o,
                translations: cleanTranslationMap(o.translations),
              })),
            };
            onSave(cleanedField);
          }}
          disabled={!field.key || !field.label || (!initial.key && !isValidKey(field.key)) || (isSelect && (field.options || []).some((o) => o.key && !isValidKey(o.key) && !originalOptionKeys.has(o.key)))}
        >
          {t("common:actions.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
