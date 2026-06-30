import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import Alert from "@mui/material/Alert";
import Divider from "@mui/material/Divider";
import MaterialSymbol from "@/components/MaterialSymbol";
import ColorPicker from "@/components/ColorPicker";
import KeyInput, { isValidKey } from "@/components/KeyInput";
import { useFieldLabel, useOptionLabel } from "@/hooks/useResolveLabel";
import { LOCALE_LABELS } from "@/i18n";
import { api, ApiError } from "@/api/client";
import type { FieldDef, FieldOption, RelationType, TranslationMap } from "@/types";
import { DEFAULT_OPTION_COLOR } from "./constants";

/** Remove empty-string entries from a TranslationMap. Returns undefined if all empty. */
function cleanTranslationMap(map: TranslationMap | undefined): TranslationMap | undefined {
  if (!map) return undefined;
  const cleaned: TranslationMap = {};
  for (const [k, v] of Object.entries(map)) {
    if (v && v.trim()) cleaned[k] = v.trim();
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

interface Props {
  open: boolean;
  relationType: RelationType | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Admin editor for a relation type's "type" values — the options of the
 * `single_select` fields in its `attributes_schema` (e.g. Owner / User /
 * Stakeholder on Organization→Application). Built-in dimensions and values
 * are locked-but-hideable; custom ones are fully editable. Admins can also add
 * a brand-new "type" dimension to any relation, including built-in ones.
 */
export default function RelationTypeValuesDialog({ open, relationType, onClose, onSaved }: Props) {
  const { t, i18n } = useTranslation(["admin", "common"]);
  const locale = i18n.language;
  const fieldLabel = useFieldLabel();
  const optLabel = useOptionLabel();

  const [schema, setSchema] = useState<FieldDef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && relationType) {
      // Deep clone so edits don't mutate the cached metamodel. Mark every
      // existing dimension/option as original so its key stays locked — a row's
      // original-ness travels with the row, so a new row never locks just
      // because its typed key matches an existing one.
      const cloned: FieldDef[] = JSON.parse(JSON.stringify(relationType.attributes_schema ?? []));
      for (const f of cloned) {
        f._original = true;
        for (const o of f.options ?? []) o._original = true;
      }
      setSchema(cloned);
      setError(null);
    }
  }, [open, relationType]);

  // Only single_select dimensions are user-managed (relation "type" pickers).
  const isManaged = (f: FieldDef) => f.type === "single_select";

  const updateField = (fi: number, patch: Partial<FieldDef>) => {
    setSchema((prev) => prev.map((f, i) => (i === fi ? { ...f, ...patch } : f)));
  };

  const setFieldLabel = (fi: number, text: string) => {
    setSchema((prev) =>
      prev.map((f, i) =>
        i === fi ? { ...f, label: text, translations: { ...f.translations, [locale]: text } } : f,
      ),
    );
  };

  const removeField = (fi: number) => {
    setSchema((prev) => prev.filter((_, i) => i !== fi));
  };

  const addDimension = () => {
    setSchema((prev) => [
      ...prev,
      { key: "", label: "", type: "single_select", options: [] },
    ]);
  };

  const updateOption = (fi: number, oi: number, patch: Partial<FieldOption>) => {
    setSchema((prev) =>
      prev.map((f, i) => {
        if (i !== fi) return f;
        const opts = [...(f.options ?? [])];
        opts[oi] = { ...opts[oi], ...patch };
        return { ...f, options: opts };
      }),
    );
  };

  const setOptionLabel = (fi: number, oi: number, text: string) => {
    setSchema((prev) =>
      prev.map((f, i) => {
        if (i !== fi) return f;
        const opts = [...(f.options ?? [])];
        opts[oi] = {
          ...opts[oi],
          label: text,
          translations: { ...opts[oi].translations, [locale]: text },
        };
        return { ...f, options: opts };
      }),
    );
  };

  const addValue = (fi: number) => {
    setSchema((prev) =>
      prev.map((f, i) =>
        i === fi
          ? { ...f, options: [...(f.options ?? []), { key: "", label: "", color: DEFAULT_OPTION_COLOR }] }
          : f,
      ),
    );
  };

  const removeValue = (fi: number, oi: number) => {
    setSchema((prev) =>
      prev.map((f, i) =>
        i === fi ? { ...f, options: (f.options ?? []).filter((_, j) => j !== oi) } : f,
      ),
    );
  };

  const handleSave = async () => {
    if (!relationType) return;
    setSaving(true);
    setError(null);
    // Clean translations before persisting.
    const cleaned = schema.map(({ _original, ...f }) => ({
      ...f,
      translations: cleanTranslationMap(f.translations),
      options: (f.options ?? []).map(({ _original: _o, ...o }) => ({
        ...o,
        // Persist the picker's displayed default so an untouched swatch still
        // saves a color and its badge renders (issue #718).
        color: o.color || DEFAULT_OPTION_COLOR,
        translations: cleanTranslationMap(o.translations),
      })),
    }));
    try {
      await api.patch(`/metamodel/relation-types/${relationType.key}`, {
        attributes_schema: cleaned,
      });
      onSaved();
      onClose();
    } catch (e) {
      const msg =
        e instanceof ApiError && typeof e.detail === "string"
          ? e.detail
          : e instanceof Error
            ? e.message
            : t("metamodel.relationValuesSaveFailed");
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  // Validation: every custom field/option needs a valid key + label.
  const invalid = schema.some(
    (f) =>
      isManaged(f) &&
      ((!f.built_in && (!isValidKey(f.key) || !f.label.trim())) ||
        (f.options ?? []).some((o) => !o.built_in && (!isValidKey(o.key) || !o.label.trim()))),
  );

  // Keys must be unique: dimension keys across the whole schema, and option keys
  // within their dimension (counting built-in keys too — a custom key can't
  // collide with a built-in one). Flagged red and block Save.
  const dupKeys = (keys: string[]) => {
    const counts = new Map<string, number>();
    for (const k of keys) if (k) counts.set(k, (counts.get(k) || 0) + 1);
    return new Set([...counts].filter(([, n]) => n > 1).map(([k]) => k));
  };
  const duplicateDimensionKeys = dupKeys(schema.map((f) => f.key));
  const duplicateOptionKeysByField = new Map<number, Set<string>>(
    schema.map((f, i) => [i, dupKeys((f.options ?? []).map((o) => o.key))]),
  );
  const hasDuplicates =
    duplicateDimensionKeys.size > 0 ||
    [...duplicateOptionKeysByField.values()].some((s) => s.size > 0);

  const managed = schema.map((f, i) => ({ f, i })).filter(({ f }) => isManaged(f));

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth disableRestoreFocus>
      <DialogTitle>{t("metamodel.manageRelationValues")}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2, mt: 1 }}>
            {error}
          </Alert>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, mt: 1 }}>
          {t("metamodel.relationValuesHelp")}
        </Typography>

        {managed.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic", mb: 2 }}>
            {t("metamodel.noTypeDimensions")}
          </Typography>
        )}

        {managed.map(({ f, i: fi }, mi) => (
          <Box key={fi} sx={{ mb: 2 }}>
            {mi > 0 && <Divider sx={{ mb: 2 }} />}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
              {f.built_in ? (
                <>
                  <MaterialSymbol icon="lock" size={16} color="#888" />
                  <Typography variant="subtitle2">{fieldLabel(f)}</Typography>
                  <Chip size="small" label={t("metamodel.builtIn")} color="info" sx={{ height: 20 }} />
                </>
              ) : (
                <>
                  <TextField
                    size="small"
                    label={`${t("metamodel.dimensionLabel")} (${LOCALE_LABELS[locale as keyof typeof LOCALE_LABELS] || locale})`}
                    value={f.translations?.[locale] ?? f.label}
                    onChange={(e) => setFieldLabel(fi, e.target.value)}
                    sx={{ flex: 1 }}
                    error={!(f.translations?.[locale] ?? f.label ?? "").trim()}
                  />
                  <Tooltip title={t("common:actions.delete")}>
                    <IconButton size="small" onClick={() => removeField(fi)}>
                      <MaterialSymbol icon="delete" size={18} />
                    </IconButton>
                  </Tooltip>
                </>
              )}
            </Box>
            {!f.built_in && (
              <KeyInput
                size="small"
                fullWidth
                label={t("metamodel.dimensionKey")}
                value={f.key}
                onChange={(v) => updateField(fi, { key: v })}
                locked={!!f._original}
                lockedReason={t("metamodel.fieldEditor.keyLockedReason")}
                sx={{ mb: 1.5 }}
                required={!!(f.translations?.[locale] ?? f.label ?? "").trim()}
                externalError={
                  duplicateDimensionKeys.has(f.key) ? t("validation:key.duplicate") : undefined
                }
              />
            )}

            {(f.options ?? []).map((opt, oi) =>
              opt.built_in ? (
                <Box
                  key={oi}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    mb: 0.75,
                    opacity: opt.hidden ? 0.5 : 1,
                  }}
                >
                  <MaterialSymbol icon="lock" size={16} color="#aaa" />
                  <Box
                    sx={{
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      bgcolor: opt.color || "#bbb",
                      flexShrink: 0,
                    }}
                  />
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    {optLabel(opt)}
                  </Typography>
                  {opt.hidden && (
                    <Chip size="small" label={t("metamodel.hidden")} color="warning" sx={{ height: 20 }} />
                  )}
                  <Tooltip title={opt.hidden ? t("metamodel.showValue") : t("metamodel.hideValue")}>
                    <IconButton size="small" onClick={() => updateOption(fi, oi, { hidden: !opt.hidden })}>
                      <MaterialSymbol icon={opt.hidden ? "visibility" : "visibility_off"} size={18} />
                    </IconButton>
                  </Tooltip>
                </Box>
              ) : (
                <Box key={oi} sx={{ display: "flex", gap: 1, mb: 0.75, alignItems: "flex-start" }}>
                  <KeyInput
                    size="small"
                    label={t("metamodel.fieldEditor.optionKeyLabel")}
                    value={opt.key}
                    onChange={(v) => updateOption(fi, oi, { key: v })}
                    locked={!!opt._original}
                    lockedReason={t("metamodel.fieldEditor.optionKeyLocked")}
                    sx={{ flex: 1 }}
                    required={!!(opt.translations?.[locale] ?? opt.label ?? "").trim()}
                    externalError={
                      duplicateOptionKeysByField.get(fi)?.has(opt.key)
                        ? t("validation:key.duplicate")
                        : undefined
                    }
                  />
                  <TextField
                    size="small"
                    label={t("metamodel.fieldEditor.optionLabelLabel")}
                    value={opt.translations?.[locale] ?? opt.label}
                    onChange={(e) => setOptionLabel(fi, oi, e.target.value)}
                    sx={{ flex: 1 }}
                    error={!(opt.translations?.[locale] ?? opt.label ?? "").trim()}
                  />
                  <ColorPicker
                    compact
                    value={opt.color || DEFAULT_OPTION_COLOR}
                    onChange={(c) => updateOption(fi, oi, { color: c })}
                  />
                  <IconButton size="small" onClick={() => removeValue(fi, oi)}>
                    <MaterialSymbol icon="close" size={18} />
                  </IconButton>
                </Box>
              ),
            )}
            <Button
              size="small"
              startIcon={<MaterialSymbol icon="add" size={16} />}
              onClick={() => addValue(fi)}
            >
              {t("metamodel.addValue")}
            </Button>
          </Box>
        ))}

        <Divider sx={{ my: 2 }} />
        <Button
          startIcon={<MaterialSymbol icon="add" size={18} />}
          onClick={addDimension}
        >
          {t("metamodel.addTypeDimension")}
        </Button>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving || invalid || hasDuplicates}>
          {t("common:actions.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
