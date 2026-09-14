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
import Alert from "@mui/material/Alert";
import MaterialSymbol from "@/components/MaterialSymbol";
import ColorPicker from "@/components/ColorPicker";
import KeyInput, { isValidKey } from "@/components/KeyInput";
import { LOCALE_LABELS } from "@/i18n";
import { api, ApiError } from "@/api/client";
import type { CardType, FieldOption } from "@/types";
import { DEFAULT_OPTION_COLOR } from "./constants";
import { cleanTranslationMap } from "./helpers";

interface Props {
  open: boolean;
  cardType: CardType | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Admin editor for a hierarchical card type's **hierarchy link labels** — the
 * vocabulary a parent→child link is labelled from (discussion #1100), stored as
 * `card_types.hierarchy_labels` and set per child as `cards.parent_label`.
 *
 * Structurally `RelationTypeValuesDialog` with the dimension layer removed:
 * there is exactly one list here, because a link carries one label. The option
 * shape is the same `FieldOption`, so colours, translations and `OptionChip`
 * rendering all come for free.
 *
 * Removing a label does NOT rewrite the cards already carrying it — the write
 * validator exempts an unchanged value, so those cards stay editable and the
 * stale value keeps rendering as the unknown-option chip. The confirmation
 * below says how many cards that is, fetched from `hierarchy-label-usage`.
 */
export default function HierarchyLabelsDialog({ open, cardType, onClose, onSaved }: Props) {
  const { t, i18n } = useTranslation(["admin", "common", "validation"]);
  const locale = i18n.language;

  const [labels, setLabels] = useState<FieldOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && cardType) {
      // Deep clone so edits never mutate the cached metamodel, and mark the
      // rows that already existed so their keys stay locked — a stored
      // `parent_label` points at the key, so renaming one would orphan cards.
      const cloned: FieldOption[] = JSON.parse(JSON.stringify(cardType.hierarchy_labels ?? []));
      for (const o of cloned) o._original = true;
      setLabels(cloned);
      setError(null);
    }
  }, [open, cardType]);

  const updateLabel = (index: number, patch: Partial<FieldOption>) => {
    setLabels((prev) => prev.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  };

  const setLabelText = (index: number, text: string) => {
    setLabels((prev) =>
      prev.map((o, i) =>
        i === index
          ? { ...o, label: text, translations: { ...o.translations, [locale]: text } }
          : o,
      ),
    );
  };

  const addLabel = () => {
    setLabels((prev) => [...prev, { key: "", label: "", color: DEFAULT_OPTION_COLOR }]);
  };

  const removeLabel = async (index: number) => {
    const option = labels[index];
    // Only an already-persisted label can have cards on it; a row added in this
    // dialog has never been saved, so there is nothing to warn about.
    if (option._original && cardType) {
      let count = 0;
      try {
        const usage = await api.get<{ card_count: number }>(
          `/metamodel/types/${cardType.key}/hierarchy-label-usage?label_key=${encodeURIComponent(option.key)}`,
        );
        count = usage.card_count;
      } catch {
        // A failed count must not block the edit — fall through to the plain
        // confirm rather than leaving the admin stuck.
      }
      if (count > 0 && !window.confirm(t("metamodel.hierarchyLabels.deleteConfirm", { count }))) {
        return;
      }
    }
    setLabels((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!cardType) return;
    setSaving(true);
    setError(null);
    const cleaned = labels.map(({ _original, ...o }) => ({
      ...o,
      // Persist the picker's displayed default so an untouched swatch still
      // saves a colour and its chip renders (issue #718).
      color: o.color || DEFAULT_OPTION_COLOR,
      translations: cleanTranslationMap(o.translations),
    }));
    try {
      await api.patch(`/metamodel/types/${cardType.key}`, { hierarchy_labels: cleaned });
      onSaved();
      onClose();
    } catch (e) {
      const msg =
        e instanceof ApiError && typeof e.detail === "string"
          ? e.detail
          : e instanceof Error
            ? e.message
            : t("metamodel.hierarchyLabels.saveFailed");
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const invalid = labels.some(
    (o) => !isValidKey(o.key) || !(o.translations?.[locale] ?? o.label ?? "").trim(),
  );
  const counts = new Map<string, number>();
  for (const o of labels) if (o.key) counts.set(o.key, (counts.get(o.key) || 0) + 1);
  const duplicateKeys = new Set([...counts].filter(([, n]) => n > 1).map(([k]) => k));

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth disableRestoreFocus>
      <DialogTitle>{t("metamodel.hierarchyLabels.title")}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2, mt: 1 }}>
            {error}
          </Alert>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, mt: 1 }}>
          {t("metamodel.hierarchyLabels.help")}
        </Typography>

        {labels.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic", mb: 2 }}>
            {t("metamodel.hierarchyLabels.none")}
          </Typography>
        )}

        {labels.map((opt, index) => (
          <Box key={index} sx={{ display: "flex", gap: 1, mb: 0.75, alignItems: "flex-start" }}>
            <KeyInput
              size="small"
              label={t("metamodel.fieldEditor.optionKeyLabel")}
              value={opt.key}
              onChange={(v) => updateLabel(index, { key: v })}
              locked={!!opt._original}
              lockedReason={t("metamodel.hierarchyLabels.keyLocked")}
              sx={{ flex: 1 }}
              required
              externalError={
                duplicateKeys.has(opt.key) ? t("validation:key.duplicate") : undefined
              }
            />
            <TextField
              size="small"
              label={`${t("metamodel.fieldEditor.optionLabelLabel")} (${
                LOCALE_LABELS[locale as keyof typeof LOCALE_LABELS] || locale
              })`}
              value={opt.translations?.[locale] ?? opt.label}
              onChange={(e) => setLabelText(index, e.target.value)}
              sx={{ flex: 1 }}
              error={!(opt.translations?.[locale] ?? opt.label ?? "").trim()}
            />
            <ColorPicker
              compact
              value={opt.color || DEFAULT_OPTION_COLOR}
              onChange={(c) => updateLabel(index, { color: c })}
            />
            <IconButton
              size="small"
              onClick={() => removeLabel(index)}
              aria-label={t("common:actions.delete")}
            >
              <MaterialSymbol icon="close" size={18} />
            </IconButton>
          </Box>
        ))}

        <Button size="small" startIcon={<MaterialSymbol icon="add" size={16} />} onClick={addLabel}>
          {t("metamodel.hierarchyLabels.add")}
        </Button>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || invalid || duplicateKeys.size > 0}
        >
          {t("common:actions.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
