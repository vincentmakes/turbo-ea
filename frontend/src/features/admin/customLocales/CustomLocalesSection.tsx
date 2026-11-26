/**
 * Settings → General → Custom languages: languages that do not ship with the
 * app, added and filled by an admin (file export/import, the configured AI
 * provider, MCP, or by hand in the review dialog).
 *
 * After any change the list is re-read, bootstrap is re-read
 * (`refreshBootstrap`: the enabled list behind the language menu, category,
 * regulation and resource-type labels, lifecycle help) and the changed
 * language's bundle is dropped, and reloaded at once when it is the active
 * language (`refreshCustomLocale`), so the admin sees the result without a page
 * reload. An import, an install from the community library, a finished AI run
 * or a manual edit of a database label also re-reads the metamodel. While any language's AI job runs, the list is
 * polled, so a job finishing after its dialog closed still refreshes all that.
 */
import { useCallback, useEffect, useRef, useState } from "react";
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
import i18n from "@/i18n";
import { forgetLoadedLocale, refreshCustomLocale, setAppLanguage } from "@/i18n/customLocales";
import type { CustomLocale, LanguagePack, LanguagePackMode } from "@/types";
import CommunityLanguages from "./CommunityLanguages";
import CustomLocaleFormDialog from "./CustomLocaleFormDialog";
import ImportPackDialog from "./ImportPackDialog";
import TranslateDialog, { POLL_INTERVAL_MS } from "./TranslateDialog";
import ReviewStringsDialog from "./ReviewStringsDialog";
import UnreviewedChip from "./UnreviewedChip";
import {
  METAMODEL_NAMESPACE,
  downloadJson,
  errorMessage,
  formatCount,
  percent,
} from "./customLocaleUtils";

const EXPORT_MODES: LanguagePackMode[] = ["missing", "all", "current", "share"];

/**
 * Refresh what a change to a custom language can have moved: bootstrap (the
 * enabled list, the database labels it primes), the language's own bundle and,
 * when database labels may have changed, the metamodel.
 */
function refreshAfterChange(code: string | undefined, labels: boolean): void {
  void refreshBootstrap();
  if (code) void refreshCustomLocale(code);
  if (labels) invalidateMetamodel().catch(() => {});
}

function isRunning(locale: CustomLocale): boolean {
  return locale.job?.status === "running";
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

  /** Re-read the list, then everything the change can have moved. */
  const afterChange = useCallback(
    (code?: string, labels = false) => {
      refetch();
      refreshAfterChange(code, labels);
    },
    // Stryker disable next-line ArrayDeclaration: `refetch` is a stable useCallback, so [] and [refetch] memoise the same function
    [refetch],
  );

  // Poll the list while a job runs, one read at a time: the next one is
  // armed only once the previous read settled (every read is a new `data`).
  const anyRunning = locales.some(isRunning);
  useEffect(() => {
    if (!anyRunning || loading) return;
    const id = setTimeout(refetch, POLL_INTERVAL_MS);
    return () => clearTimeout(id);
  }, [anyRunning, loading, data, refetch]);

  // A job seen running that no longer is has finished: refresh what it wrote.
  const seenRunning = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!Array.isArray(data)) return;
    const now = new Set(data.filter(isRunning).map((l) => l.code));
    for (const code of seenRunning.current) {
      if (!now.has(code)) refreshAfterChange(code, true);
    }
    seenRunning.current = now;
  }, [data]);

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
      forgetLoadedLocale(locale.code);
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
        // No stats: the server has no English catalogue, so nothing can be
        // counted, exported, reviewed or translated until it has.
        const { stats } = locale;
        const running = isRunning(locale);
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
            {locale.source === "community" && <UnreviewedChip />}
            <Box sx={{ flex: 1, minWidth: 160 }}>
              {stats ? (
                <>
                  <LinearProgress
                    variant="determinate"
                    value={percent(stats.translated, stats.total)}
                    aria-label={t("customLocales.progressLabel", { name: locale.name })}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {t("customLocales.progress", {
                      translated: formatCount(stats.translated, i18n.language),
                      total: formatCount(stats.total, i18n.language),
                    })}
                  </Typography>
                </>
              ) : (
                <Typography variant="caption" color="error">
                  {t("customLocales.errors.catalog_unavailable")}
                </Typography>
              )}
            </Box>
            {stats && stats.missing > 0 && (
              <Chip
                size="small"
                color="error"
                variant="outlined"
                label={t("customLocales.missingCount", { count: stats.missing })}
              />
            )}
            {stats && stats.stale > 0 && (
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
                label={
                  // The share once the job has counted its strings.
                  locale.job && locale.job.total > 0
                    ? t("customLocales.jobStatus.runningPercent", {
                        percent: percent(locale.job.done, locale.job.total),
                      })
                    : t("customLocales.jobStatus.running")
                }
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
                <span>
                <IconButton
                  size="small"
                  aria-label={t("customLocales.actions.review")}
                  disabled={!stats}
                  onClick={() => setDialog({ kind: "review", locale })}
                >
                  <MaterialSymbol icon="rate_review" size={18} />
                </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={t("customLocales.actions.translate")}>
                <span>
                <IconButton
                  size="small"
                  aria-label={t("customLocales.actions.translate")}
                  disabled={!stats}
                  onClick={() => setDialog({ kind: "translate", locale })}
                >
                  <MaterialSymbol icon="auto_awesome" size={18} />
                </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={t("customLocales.actions.export")}>
                <span>
                <IconButton
                  size="small"
                  aria-label={t("customLocales.actions.export")}
                  disabled={!stats}
                  onClick={(e) => setExportAnchor({ el: e.currentTarget, code: locale.code })}
                >
                  <MaterialSymbol icon="download" size={18} />
                </IconButton>
                </span>
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

      <CommunityLanguages onInstalled={(code) => afterChange(code, true)} />

      <Menu
        anchorEl={exportAnchor?.el}
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
          onImported={() => afterChange(dialog.locale.code, true)}
        />
      )}
      {dialog?.kind === "translate" && (
        <TranslateDialog
          locale={dialog.locale}
          onClose={closeDialog}
          onStarted={refetch}
          onFinished={() => {
            // The list may have seen it running too: refresh once, not twice.
            seenRunning.current.delete(dialog.locale.code);
            afterChange(dialog.locale.code, true);
          }}
        />
      )}
      {dialog?.kind === "review" && (
        <ReviewStringsDialog
          locale={dialog.locale}
          onClose={closeDialog}
          onChanged={(namespace) =>
            afterChange(dialog.locale.code, namespace === METAMODEL_NAMESPACE)
          }
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
