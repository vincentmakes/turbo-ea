/**
 * Add or edit a custom language: code, native name, English name and
 * direction. The code is fixed once the language exists. A new language is
 * left to right until the admin switches it; a code usually written right to
 * left only earns a hint, never the switch.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import { api } from "@/api/client";
import { isBuiltInLocale } from "@/i18n/customLocales";
import type { CustomLocale } from "@/types";
import {
  ENGLISH_NAME_PATTERN,
  LOCALE_CODE_PATTERN,
  errorMessage,
  usuallyRtl,
} from "./customLocaleUtils";

interface Props {
  /** The language to edit; `null` adds a new one. */
  locale: CustomLocale | null;
  onClose: () => void;
  /** Called with the code after a successful save. */
  onSaved: (code: string) => void;
}

export default function CustomLocaleFormDialog({ locale, onClose, onSaved }: Props) {
  const { t } = useTranslation(["admin", "common"]);
  const editing = locale !== null;
  const [code, setCode] = useState(locale?.code ?? "");
  const [name, setName] = useState(locale?.name ?? "");
  const [englishName, setEnglishName] = useState(locale?.english_name ?? "");
  const [rtl, setRtl] = useState(locale?.rtl ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const trimmedCode = code.trim();
  const codeError = editing
    ? ""
    : trimmedCode && !LOCALE_CODE_PATTERN.test(trimmedCode)
      ? t("customLocales.form.codeInvalid")
      : isBuiltInLocale(trimmedCode)
        ? t("customLocales.errors.built_in_code")
        : "";
  const englishNameError =
    englishName.trim() && !ENGLISH_NAME_PATTERN.test(englishName.trim())
      ? t("customLocales.form.englishNameInvalid")
      : "";
  const canSave =
    !saving &&
    !!trimmedCode &&
    !codeError &&
    !!name.trim() &&
    !!englishName.trim() &&
    !englishNameError;

  const handleSave = async () => {
    setSaving(true);
    setError("");
    const body = { name: name.trim(), english_name: englishName.trim(), rtl };
    try {
      if (editing) {
        await api.patch(`/custom-locales/${encodeURIComponent(trimmedCode)}`, body);
      } else {
        await api.post("/custom-locales", { code: trimmedCode, ...body });
      }
      onSaved(trimmedCode);
    } catch (e) {
      setError(errorMessage(e, t, t("customLocales.errors.saveFailed")));
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {editing ? t("customLocales.form.editTitle") : t("customLocales.form.addTitle")}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label={t("customLocales.form.code")}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={editing}
            required
            error={!!codeError}
            helperText={codeError || t("customLocales.form.codeHelp")}
            size="small"
          />
          <TextField
            label={t("customLocales.form.name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            helperText={t("customLocales.form.nameHelp")}
            inputProps={{ maxLength: 100 }}
            size="small"
          />
          <TextField
            label={t("customLocales.form.englishName")}
            value={englishName}
            onChange={(e) => setEnglishName(e.target.value)}
            required
            error={!!englishNameError}
            helperText={englishNameError || t("customLocales.form.englishNameHelp")}
            size="small"
          />
          <FormControlLabel
            control={<Switch checked={rtl} onChange={(e) => setRtl(e.target.checked)} />}
            label={t("customLocales.form.rtl")}
          />
          {!rtl && usuallyRtl(trimmedCode) && (
            <Alert severity="info">{t("customLocales.form.rtlHint")}</Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        <Button variant="contained" onClick={handleSave} disabled={!canSave}>
          {t("common:actions.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
