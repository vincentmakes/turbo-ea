/**
 * Settings → General → Custom languages: languages that do not ship with the
 * app, added and filled by an admin (file export/import, the configured AI
 * provider, MCP, or by hand in the review dialog).
 *
 * After any change the enabled list behind the language menu is re-read
 * (`invalidateCustomLocales`) and the changed language's bundle is dropped, and
 * reloaded at once when it is the active language (`refreshCustomLocale`), so
 * the admin sees the result without a page reload. An import, a finished AI
 * run or a manual edit of a database label also re-reads the metamodel and the
 * bootstrap-primed caches (`refreshLabels`).
 */
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Switch from "@mui/material/Switch";
import Alert from "@mui/material/Alert";
import LinearProgress from "@mui/material/LinearProgress";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemText from "@mui/material/ListItemText";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import { useTheme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { refreshBootstrap } from "@/api/bootstrap";
import { invalidateCache as invalidateMetamodel } from "@/hooks/useMetamodel";
import { useApiQuery } from "@/hooks/useApiQuery";
import { invalidateCustomLocales } from "@/hooks/useCustomLocales";
import i18n from "@/i18n";
import {
  forgetCustomLocale,
  refreshCustomLocale,
  setAppLanguage,
} from "@/i18n/customLocales";
import type { CustomLocale, LanguagePack, LanguagePackMode } from "@/types";
import CustomLocaleFormDialog from "./CustomLocaleFormDialog";
import ImportPackDialog from "./ImportPackDialog";
import TranslateDialog from "./TranslateDialog";
import ReviewStringsDialog from "./ReviewStringsDialog";
import { METAMODEL_NAMESPACE, downloadJson, errorMessage, percent } from "./customLocaleUtils";

const EXPORT_MODES: LanguagePackMode[] = ["missing", "all", "current", "share"];

/**
 * Database labels (card types, fields, categories, lifecycle help …) live in
 * the metamodel and the bootstrap-primed caches: re-read both after a change
 * that can have translated them.
 */
function refreshLabels(): void {
  void invalidateMetamodel();
  void refreshBootstrap();
}

type DialogState =
  | { kind: "form"; locale: CustomLocale | null }
  | { kind: "import" | "translate" | "review" | "delete"; locale: CustomLocale };

export default function CustomLocalesSection() {
  const theme = useTheme();
  const { t } = useTranslation(["admin", "common"]);
  const { data, loading, error: loadError, refetch } = useApiQuery<CustomLocale[]>(
    "/custom-locales",
  );
  const locales = Array.isArray(data) ? data : [];
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [exportAnchor, setExportAnchor] = useState<{ el: HTMLElement; code: string } | null>(
    null,
  );
  const [error, setError] = useState("");

  /** Re-read the list and the menu's enabled list; reload `code` if it is active. */
  const afterChange = useCallback(
    (code?: string) => {
      refetch();
      invalidateCustomLocales();
      if (code) void refreshCustomLocale(code);
    },
    [refetch],
  );

  const closeDialog = () => setDialog(null);

  const handleToggle = async (locale: CustomLocale) => {
    setError("");
    try {
      await api.patch(`/custom-locales/${encodeURIComponent(locale.code)}`, {
        enabled: !locale.enabled,
      });
      afterChange();
    } catch (e) {
      setError(errorMessage(e, t, t("customLocales.errors.saveFailed")));
    }
  };

  const handleExport = async (code: string, mode: LanguagePackMode) => {
    setExportAnchor(null);
    setError("");
    try {
      const pack = await api.get<LanguagePack>(
        `/custom-locales/${encodeURIComponent(code)}/export?mode=${mode}`,
      );
      downloadJson(`turbo-ea-${code}-${mode}.json`, pack);
    } catch (e) {
      setError(errorMessage(e, t, t("customLocales.errors.exportFailed")));
    }
  };

  const handleDelete = async (locale: CustomLocale) => {
    setError("");
    try {
      await api.delete(`/custom-locales/${encodeURIComponent(locale.code)}`);
      closeDialog();
      forgetCustomLocale(locale.code);
      if (i18n.language === locale.code) void setAppLanguage("en");
      afterChange();
    } catch (e) {
      closeDialog();
      setError(errorMessage(e, t, t("customLocales.errors.deleteFailed")));
    }
  };

  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1, flexWrap: "wrap" }}>
        <MaterialSymbol icon="language" size={22} color={theme.palette.text.secondary} />
        <Typography variant="h6" fontWeight={600} sx={{ flex: 1 }}>
          {t("customLocales.title")}
        </Typography>
        <Button
          variant="outlined"
          size="small"
          startIcon={<MaterialSymbol icon="add" size={18} />}
          sx={{ textTransform: "none" }}
          onClick={() => setDialog({ kind: "form", locale: null })}
        >
          {t("customLocales.add")}
        </Button>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t("customLocales.description")}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {errorMessage(loadError, t, t("customLocales.errors.loadFailed"))}
        </Alert>
      )}
      {loading && !data && <LinearProgress sx={{ mb: 2 }} />}
      {!loading && !loadError && locales.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          {t("customLocales.empty")}
        </Typography>
      )}

      {locales.map((locale) => {
        const { stats } = locale;
        const running = locale.job?.status === "running";
        return (
          <Box
            key={locale.code}
            data-testid={`custom-locale-${locale.code}`}
            sx={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 1.5,
              py: 1.5,
              borderTop: 1,
              borderColor: "divider",
            }}
          >
            <Box sx={{ minWidth: 160 }}>
              <Typography variant="subtitle2">{locale.name}</Typography>
              <Typography variant="caption" color="text.secondary">
                {locale.code} · {locale.english_name}
                {locale.rtl ? ` · ${t("customLocales.rtlShort")}` : ""}
              </Typography>
            </Box>
            <Box sx={{ flex: 1, minWidth: 160 }}>
              <LinearProgress
                variant="determinate"
                value={percent(stats.translated, stats.total)}
                aria-label={t("customLocales.progressLabel", { name: locale.name })}
              />
              <Typography variant="caption" color="text.secondary">
                {t("customLocales.progress", {
                  translated: stats.translated,
                  total: stats.total,
                })}
              </Typography>
            </Box>
            {stats.missing > 0 && (
              <Chip
                size="small"
                color="error"
                variant="outlined"
                label={t("customLocales.missingCount", { count: stats.missing })}
              />
            )}
            {stats.stale > 0 && (
              <Chip
                size="small"
                color="warning"
                variant="outlined"
                label={t("customLocales.staleCount", { count: stats.stale })}
              />
            )}
            {running && (
              <Chip
                size="small"
                color="info"
                icon={<MaterialSymbol icon="auto_awesome" size={16} />}
                label={t("customLocales.jobStatus.running")}
              />
            )}
            <Tooltip title={t("customLocales.enabledHint")}>
              <Switch
                checked={locale.enabled}
                onChange={() => handleToggle(locale)}
                inputProps={{
                  "aria-label": t("customLocales.enabledLabel", { name: locale.name }),
                }}
              />
            </Tooltip>
            <Box sx={{ display: "flex", gap: 0.25 }}>
              <Tooltip title={t("customLocales.actions.review")}>
                <IconButton
                  size="small"
                  aria-label={t("customLocales.actions.review")}
                  onClick={() => setDialog({ kind: "review", locale })}
                >
                  <MaterialSymbol icon="rate_review" size={18} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t("customLocales.actions.translate")}>
                <IconButton
                  size="small"
                  aria-label={t("customLocales.actions.translate")}
                  onClick={() => setDialog({ kind: "translate", locale })}
                >
                  <MaterialSymbol icon="auto_awesome" size={18} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t("customLocales.actions.export")}>
                <IconButton
                  size="small"
                  aria-label={t("customLocales.actions.export")}
                  onClick={(e) => setExportAnchor({ el: e.currentTarget, code: locale.code })}
                >
                  <MaterialSymbol icon="download" size={18} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t("customLocales.actions.import")}>
                <IconButton
                  size="small"
                  aria-label={t("customLocales.actions.import")}
                  onClick={() => setDialog({ kind: "import", locale })}
                >
                  <MaterialSymbol icon="upload" size={18} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t("common:actions.edit")}>
                <IconButton
                  size="small"
                  aria-label={t("common:actions.edit")}
                  onClick={() => setDialog({ kind: "form", locale })}
                >
                  <MaterialSymbol icon="edit" size={18} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t("common:actions.delete")}>
                <IconButton
                  size="small"
                  aria-label={t("common:actions.delete")}
                  onClick={() => setDialog({ kind: "delete", locale })}
                >
                  <MaterialSymbol icon="delete" size={18} />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>
        );
      })}

      <Menu
        anchorEl={exportAnchor?.el ?? null}
        open={!!exportAnchor}
        onClose={() => setExportAnchor(null)}
      >
        {EXPORT_MODES.map((mode) => (
          <MenuItem
            key={mode}
            onClick={() => exportAnchor && handleExport(exportAnchor.code, mode)}
          >
            <ListItemText
              primary={t(`customLocales.export.${mode}`)}
              secondary={mode === "share" ? t("customLocales.export.shareHint") : undefined}
            />
          </MenuItem>
        ))}
      </Menu>

      {dialog?.kind === "form" && (
        <CustomLocaleFormDialog
          locale={dialog.locale}
          onClose={closeDialog}
          onSaved={(code) => {
            closeDialog();
            afterChange(code);
          }}
        />
      )}
      {dialog?.kind === "import" && (
        <ImportPackDialog
          locale={dialog.locale}
          onClose={closeDialog}
          onImported={() => {
            afterChange(dialog.locale.code);
            refreshLabels();
          }}
        />
      )}
      {dialog?.kind === "translate" && (
        <TranslateDialog
          locale={dialog.locale}
          onClose={closeDialog}
          onFinished={() => {
            afterChange(dialog.locale.code);
            refreshLabels();
          }}
        />
      )}
      {dialog?.kind === "review" && (
        <ReviewStringsDialog
          locale={dialog.locale}
          onClose={closeDialog}
          onChanged={(namespace) => {
            afterChange(dialog.locale.code);
            if (namespace === METAMODEL_NAMESPACE) refreshLabels();
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <Dialog open onClose={closeDialog} maxWidth="xs" fullWidth>
          <DialogTitle>{t("customLocales.delete.title")}</DialogTitle>
          <DialogContent>
            <DialogContentText>
              {t("customLocales.delete.confirm", { name: dialog.locale.name })}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={closeDialog}>{t("common:actions.cancel")}</Button>
            <Button
              color="error"
              variant="contained"
              onClick={() => handleDelete(dialog.locale)}
            >
              {t("common:actions.delete")}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Paper>
  );
}
