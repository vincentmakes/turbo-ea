/**
 * Create or edit one card type category (an EA layer).
 *
 * Create mode POSTs `/metamodel/categories` (the key becomes the label as
 * typed); edit mode PATCHes a custom category's label, colour and
 * translations — the key never changes, and built-in categories never reach
 * this dialog in edit mode (they are locked). Either way the category
 * singleton is re-primed with the answer before `onSaved` runs, so every open
 * combobox and lane sees the change at once.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ColorPicker from "@/components/ColorPicker";
import { api } from "@/api/client";
import { useCardTypeCategories } from "@/hooks/useCardTypeCategories";
import { LOCALE_LABELS, SUPPORTED_LOCALES } from "@/i18n";
import { DEFAULT_LAYER_COLOR } from "@/theme/tokens";
import type { CardTypeCategory, TranslationMap } from "@/types";
import { categoryErrorMessage } from "./categoryErrors";

export interface CategoryEditDialogProps {
  open: boolean;
  /** The category to edit; `null` / absent creates a new one. */
  category?: CardTypeCategory | null;
  /** Prefill for the name in create mode (what the user typed in a combobox). */
  initialLabel?: string;
  onClose: () => void;
  onSaved: (category: CardTypeCategory) => void;
}

function cleanTranslations(map: TranslationMap): TranslationMap {
  const out: TranslationMap = {};
  for (const [locale, label] of Object.entries(map)) {
    if (label.trim()) out[locale] = label.trim();
  }
  return out;
}

export default function CategoryEditDialog({
  open,
  category,
  initialLabel = "",
  onClose,
  onSaved,
}: CategoryEditDialogProps) {
  const { t } = useTranslation(["admin", "common"]);
  const { refresh } = useCardTypeCategories();
  const editing = Boolean(category);
  const [label, setLabel] = useState("");
  const [color, setColor] = useState<string>(DEFAULT_LAYER_COLOR);
  const [translations, setTranslations] = useState<TranslationMap>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLabel(category ? category.label : initialLabel);
    setColor(category ? category.color : DEFAULT_LAYER_COLOR);
    setTranslations({ ...(category?.translations ?? {}) });
    setError(null);
    setSaving(false);
  }, [open, category, initialLabel]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    const body = {
      label: label.trim(),
      color,
      translations: cleanTranslations(translations),
    };
    try {
      const saved = category
        ? await api.patch<CardTypeCategory>(
            `/metamodel/categories/${encodeURIComponent(category.key)}`,
            body,
          )
        : await api.post<CardTypeCategory>("/metamodel/categories", body);
      // Re-read the registry rather than patching the list this dialog holds:
      // that copy can be stale, or still empty if the first load failed, and
      // rebuilding the cache from it would drop every other category.
      await refresh();
      onSaved(saved);
    } catch (err) {
      setError(categoryErrorMessage(err, t));
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth disableRestoreFocus>
      <DialogTitle>
        {editing ? t("metamodel.categories.editTitle") : t("metamodel.categories.createTitle")}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            autoFocus
            fullWidth
            label={t("metamodel.categories.labelLabel")}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            inputProps={{ maxLength: 100 }}
          />
          <ColorPicker
            value={color}
            onChange={setColor}
            label={t("metamodel.categories.colorLabel")}
          />
          <Divider />
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              {t("metamodel.categories.translationsLabel")}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t("metamodel.categories.translationsHelp")}
            </Typography>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                gap: 1,
                mt: 1,
              }}
            >
              {SUPPORTED_LOCALES.filter((l) => l !== "en").map((locale) => (
                <TextField
                  key={locale}
                  size="small"
                  label={LOCALE_LABELS[locale] ?? locale}
                  value={translations[locale] ?? ""}
                  onChange={(e) =>
                    setTranslations({ ...translations, [locale]: e.target.value })
                  }
                />
              ))}
            </Box>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || !label.trim()}
        >
          {editing ? t("common:actions.save") : t("common:actions.create")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
