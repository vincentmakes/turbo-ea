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
import MaterialSymbol from "@/components/MaterialSymbol";
import ColorPicker from "@/components/ColorPicker";
import KeyInput, { isValidKey } from "@/components/KeyInput";
import { api } from "@/api/client";
import { useExtensionCapabilities } from "@/hooks/useExtensionCapabilities";
import { LOCALE_LABELS } from "@/i18n";
import { useExtensionFieldTypes, ExtensionBoundary } from "@/lib/extensionHost";
import type { FieldDef, FieldOption, TranslationMap } from "@/types";
import { FIELD_TYPE_OPTIONS, DEFAULT_OPTION_COLOR } from "./constants";
import ConfigEditor from "./ConfigEditor";

const CAP_FIELD_HELP = "metamodel.field_help";

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
  const { t, i18n } = useTranslation(["admin", "common"]);
  const locale = i18n.language;
  const [field, setField] = useState<FieldDef>(initial);

  const caps = useExtensionCapabilities();
  const helpGranted = caps.has(CAP_FIELD_HELP);
  const extFieldTypes = useExtensionFieldTypes();

  // Built-in field types plus any contributed by installed extensions.
  const typeOptions = useMemo(
    () => [
      ...FIELD_TYPE_OPTIONS.map((o) => ({ value: o.value, label: t(o.tKey) })),
      ...Object.values(extFieldTypes).map((rft) => ({
        value: rft.contribution.type,
        label: rft.contribution.label,
      })),
    ],
    [extFieldTypes, t],
  );
  const customType = extFieldTypes[field.type];
  const CustomConfigEditor = customType?.contribution.configEditor;
  // Extension-contributed fields are re-synced from their manifest, so their
  // config/help are shown read-only ("Managed by <ext>") — edits wouldn't stick.
  const extOwned = !!initial.ext;
  const extOwner = initial.ext ?? "";
  // The config object shown for a custom type, seeded from its defaultConfig
  // when the field has none yet, e.g. a rating's { min, max }.
  const configObj = (field.config ??
    (customType ? customType.contribution.defaultConfig : undefined) ??
    {}) as Record<string, unknown>;
  const showConfig = !!customType || Object.keys(configObj).length > 0;
  const localeLabel = LOCALE_LABELS[locale as keyof typeof LOCALE_LABELS] || locale;
  // Show the help input when the grant is active, or (read-only) when an
  // ext-owned field already carries help so it stays visible/discoverable.
  const showHelp =
    helpGranted || (extOwned && !!(initial.help || initial.helpTranslations?.[locale]));

  // The label input reads/writes translations[currentLocale]
  const [displayLabel, setDisplayLabel] = useState("");
  // Help text input reads/writes helpTranslations[currentLocale] (gated).
  const [displayHelp, setDisplayHelp] = useState("");

  // Keys that appear on more than one option — flagged red, and block Save.
  // Keys must be unique within a select field's option list.
  const duplicateOptionKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of field.options || []) {
      if (o.key) counts.set(o.key, (counts.get(o.key) || 0) + 1);
    }
    return new Set([...counts].filter(([, n]) => n > 1).map(([k]) => k));
  }, [field.options]);

  // Option deletion confirmation
  const [deleteOptConfirm, setDeleteOptConfirm] = useState<{
    idx: number;
    optionKey: string;
    optionLabel: string;
    cardCount: number | null; // null = loading
  } | null>(null);

  useEffect(() => {
    if (open) {
      // Mark options that already exist so their key stays locked. A row's
      // original-ness travels with the row (survives add/remove), so a new row
      // never locks just because its typed key matches an existing one.
      setField({
        ...initial,
        options: (initial.options || []).map((o) => ({ ...o, _original: true })),
      });
      setDisplayLabel(initial.translations?.[locale] || initial.label || "");
      setDisplayHelp(initial.helpTranslations?.[locale] || initial.help || "");
      setDeleteOptConfirm(null);
    }
  }, [open, initial, locale]);

  const isSelect = field.type === "single_select" || field.type === "multiple_select";

  const updateOption = (idx: number, patch: Partial<FieldOption>) => {
    const opts = [...(field.options || [])];
    opts[idx] = { ...opts[idx], ...patch };
    setField({ ...field, options: opts });
  };

  const addOption = () => {
    setField({
      ...field,
      options: [...(field.options || []), { key: "", label: "", color: DEFAULT_OPTION_COLOR }],
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
    if (!opt._original) {
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
          required={!!displayLabel.trim()}
        />
        <TextField
          fullWidth
          label={`${t("metamodel.fieldEditor.labelLabel")} (${LOCALE_LABELS[locale as keyof typeof LOCALE_LABELS] || locale})`}
          value={displayLabel}
          onChange={(e) => setDisplayLabel(e.target.value)}
          sx={{ mb: 2 }}
          error={!displayLabel.trim()}
        />
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>{t("metamodel.fieldEditor.typeLabel")}</InputLabel>
          <Select
            value={field.type}
            label={t("metamodel.fieldEditor.typeLabel")}
            disabled={!!isCalculated}
            onChange={(e) => {
              const newType = e.target.value as FieldDef["type"];
              const rft = extFieldTypes[newType];
              // Seed config from the custom type's defaults on first selection.
              setField({
                ...field,
                type: newType,
                config: rft
                  ? { ...(rft.contribution.defaultConfig ?? {}), ...(field.config ?? {}) }
                  : field.config,
              });
            }}
          >
            {typeOptions.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        {showConfig && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {t("metamodel.fieldEditor.customConfig")}
            </Typography>
            {extOwned ? (
              <>
                <ConfigEditor config={configObj} onChange={() => {}} readOnly />
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                  {t("metamodel.fieldEditor.managedByExtension", { ext: extOwner })}
                </Typography>
              </>
            ) : CustomConfigEditor ? (
              <ExtensionBoundary extensionKey={customType!.extKey}>
                <CustomConfigEditor
                  config={configObj}
                  onChange={(c) => setField({ ...field, config: c })}
                />
              </ExtensionBoundary>
            ) : (
              <ConfigEditor config={configObj} onChange={(c) => setField({ ...field, config: c })} />
            )}
          </Box>
        )}
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
          <Typography variant="caption" color="text.secondary">
            {t("metamodel.fieldEditor.weightMovedHint")}
          </Typography>
        </Box>
        {showHelp && (
          <TextField
            fullWidth
            multiline
            minRows={2}
            maxRows={6}
            label={`${t("metamodel.fieldEditor.helpLabel")} (${localeLabel})`}
            value={displayHelp}
            disabled={extOwned}
            onChange={(e) => setDisplayHelp(e.target.value)}
            helperText={
              extOwned
                ? t("metamodel.fieldEditor.managedByExtension", { ext: extOwner })
                : t("metamodel.fieldEditor.helpHint")
            }
            sx={{ mb: 2 }}
          />
        )}
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
                    locked={!!opt._original}
                    lockedReason={t("metamodel.fieldEditor.optionKeyLocked")}
                    required={!!opt.label.trim()}
                    externalError={
                      duplicateOptionKeys.has(opt.key) ? t("validation:key.duplicate") : undefined
                    }
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
                    value={opt.color || DEFAULT_OPTION_COLOR}
                    onChange={(c) => updateOption(idx, { color: c })}
                  />
                  <IconButton size="small" onClick={() => promptRemoveOption(idx)}>
                    <MaterialSymbol icon="close" size={18} />
                  </IconButton>
                </Box>
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
            const mergedTranslations = { ...field.translations, [locale]: displayLabel };
            const mergedHelp = { ...field.helpTranslations, [locale]: displayHelp };
            const cleanedHelp = helpGranted ? cleanTranslationMap(mergedHelp) : field.helpTranslations;
            const cleanedField: FieldDef = {
              ...field,
              label: displayLabel,
              translations: cleanTranslationMap(mergedTranslations),
              // Extension-owned config/help are read-only in this dialog and
              // re-synced from the manifest — never rewrite them here.
              help: extOwned ? initial.help : helpGranted ? displayHelp.trim() || undefined : field.help,
              helpTranslations: extOwned ? initial.helpTranslations : cleanedHelp,
              config: extOwned ? initial.config : field.config,
              options: field.options?.map(({ _original, ...o }) => ({
                ...o,
                // Persist the default the picker displays so an option whose
                // swatch was never touched still saves a color (issue #718).
                color: o.color || DEFAULT_OPTION_COLOR,
                translations: cleanTranslationMap(o.translations),
              })),
            };
            onSave(cleanedField);
          }}
          disabled={!field.key || !displayLabel || (!initial.key && !isValidKey(field.key)) || (isSelect && ((field.options || []).some((o) => !o._original && !isValidKey(o.key)) || duplicateOptionKeys.size > 0))}
        >
          {t("common:actions.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
