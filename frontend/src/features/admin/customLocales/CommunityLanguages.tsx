/**
 * Settings → Custom languages → Community languages: the language packs of the
 * community library, each with its coverage, the Turbo EA version it was made
 * with, a "Community-provided, not reviewed" marker, and Install / Update.
 *
 * The server downloads the library's list only when this block asks — on its
 * first read and on Refresh — and caches it. A language installed here shows
 * as installed, with "Update available" when the library has another pack
 * than the one installed.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useDateFormat } from "@/hooks/useDateFormat";
import type { CommunityCatalogue, CommunityLanguage } from "@/types";
import CommunityInstallDialog from "./CommunityInstallDialog";
import UnreviewedChip from "./UnreviewedChip";
import { communityAction, errorMessage, isKnownErrorCode } from "./customLocaleUtils";

export const CATALOGUE_PATH = "/custom-locales/catalogue";

interface Props {
  /** Called after a pack was installed into the language `code`. */
  onInstalled: (code: string) => void;
  /**
   * Bumped by the section when its own languages changed (added, deleted…):
   * the block then re-reads its list — the cached one, no new download — so
   * "Installed" follows.
   */
  listVersion?: number;
}

/** The status chip of an installed language: its label key and colour. */
const STATUS_CHIP = {
  installed: { label: "customLocales.community.installed", color: "success" },
  update: { label: "customLocales.community.updateAvailable", color: "info" },
  merge: { label: "customLocales.community.addedHere", color: "default" },
} as const;

function LanguageRow({
  language,
  onInstall,
}: {
  language: CommunityLanguage;
  onInstall: (language: CommunityLanguage) => void;
}) {
  const { t } = useTranslation("admin");
  const action = communityAction(language);
  // The chip follows the action an installed language offers (none: current).
  const status = action === "install" ? null : STATUS_CHIP[action ?? "installed"];
  return (
    <Box
      data-testid={`community-language-${language.code}`}
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
      <Box sx={{ minWidth: 160, flex: 1 }}>
        <Typography
          variant="subtitle2"
          lang={language.code}
          dir={language.rtl ? "rtl" : "ltr"}
          sx={{ display: "inline-block" }}
        >
          {language.name}
        </Typography>
        <Typography variant="caption" color="text.secondary" component="div">
          {[
            `${language.code} · ${language.english_name}`,
            language.coverage !== null
              ? t("customLocales.community.coverage", { percent: Math.round(language.coverage) })
              : null,
            t("customLocales.community.madeFor", { version: language.app_version }),
          ]
            .filter(Boolean)
            .join(" · ")}
        </Typography>
      </Box>
      <UnreviewedChip />
      {status && (
        <Chip
          size="small"
          color={status.color}
          variant="outlined"
          label={t(status.label)}
          data-testid="community-status"
        />
      )}
      {action && (
        <Button
          size="small"
          variant="outlined"
          startIcon={<MaterialSymbol icon="download" size={18} />}
          onClick={() => onInstall(language)}
          aria-label={t(`customLocales.community.${action}Named`, { name: language.name })}
        >
          {t(`customLocales.community.${action}`)}
        </Button>
      )}
    </Box>
  );
}

export default function CommunityLanguages({ onInstalled, listVersion = 0 }: Props) {
  const { t } = useTranslation(["admin", "common"]);
  const { formatDateTime } = useDateFormat();
  // Refresh asks the server to download the library's list again; any other
  // read (the first, the one after an install) takes the list it cached.
  const [refresh, setRefresh] = useState(false);
  const [reads, setReads] = useState(0);
  const path = refresh ? `${CATALOGUE_PATH}?refresh=true` : CATALOGUE_PATH;
  const { data, loading, error } = useApiQuery<CommunityCatalogue>(path, {
    refetchKey: `${reads}:${listVersion}`,
  });
  const reread = (download: boolean) => {
    setRefresh(download);
    setReads((n) => n + 1);
  };
  const [installing, setInstalling] = useState<CommunityLanguage | null>(null);

  const languages = data?.enabled ? data.languages : [];
  const libraryError = data?.enabled ? data.error : null;

  return (
    <Box sx={{ mt: 3 }} data-testid="community-languages">
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1, flexWrap: "wrap" }}>
        <MaterialSymbol icon="public" size={20} />
        <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>
          {t("customLocales.community.title")}
        </Typography>
        {/* Also after a failed request: the admin needs a way to try again. */}
        {(data ? data.enabled : !!error) && (
          <Button
            size="small"
            startIcon={<MaterialSymbol icon="refresh" size={18} />}
            disabled={loading}
            // The icon's ligature text would otherwise join the name.
            aria-label={t("customLocales.community.refresh")}
            onClick={() => reread(true)}
          >
            {t("customLocales.community.refresh")}
          </Button>
        )}
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: data?.fetched_at ? 0.5 : 2 }}>
        {t("customLocales.community.description")}
      </Typography>
      {data?.enabled && data.fetched_at && (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 2 }}>
          {t("customLocales.community.fetchedAt", { date: formatDateTime(data.fetched_at) })}
        </Typography>
      )}

      {loading && <LinearProgress sx={{ mb: 2 }} aria-label={t("customLocales.community.loading")} />}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {errorMessage(error, t, t("customLocales.community.loadFailed"))}
        </Alert>
      )}
      {data && !data.enabled && (
        <Typography variant="body2" color="text.secondary">
          {t("customLocales.community.disabled")}
        </Typography>
      )}
      {libraryError && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {isKnownErrorCode(libraryError)
            ? t(`customLocales.errors.${libraryError}`)
            : t("customLocales.community.loadFailed")}
          {languages.length > 0 && ` ${t("customLocales.community.staleList")}`}
        </Alert>
      )}
      {data?.enabled && !libraryError && languages.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          {t("customLocales.community.empty")}
        </Typography>
      )}

      {languages.map((language) => (
        <LanguageRow key={language.code} language={language} onInstall={setInstalling} />
      ))}

      {installing && (
        <CommunityInstallDialog
          language={installing}
          onClose={() => setInstalling(null)}
          onInstalled={(code) => {
            reread(false);
            onInstalled(code);
          }}
        />
      )}
    </Box>
  );
}
