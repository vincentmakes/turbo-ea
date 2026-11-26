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
import type { CommunityCatalogue, CommunityLanguage } from "@/types";
import CommunityInstallDialog from "./CommunityInstallDialog";
import UnreviewedChip from "./UnreviewedChip";
import { errorMessage, isKnownErrorCode } from "./customLocaleUtils";

export const CATALOGUE_PATH = "/custom-locales/catalogue";

interface Props {
  /** Called after a pack was installed into the language `code`. */
  onInstalled: (code: string) => void;
}

function LanguageRow({
  language,
  onInstall,
}: {
  language: CommunityLanguage;
  onInstall: (language: CommunityLanguage) => void;
}) {
  const { t } = useTranslation("admin");
  const action = !language.installed
    ? "customLocales.community.install"
    : language.update_available
      ? "customLocales.community.update"
      : null;
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
      {language.installed && (
        <Chip
          size="small"
          color={language.update_available ? "info" : "success"}
          variant="outlined"
          label={t(
            language.update_available
              ? "customLocales.community.updateAvailable"
              : "customLocales.community.installed",
          )}
        />
      )}
      {action && (
        <Button
          size="small"
          variant="outlined"
          startIcon={<MaterialSymbol icon="download" size={18} />}
          onClick={() => onInstall(language)}
          aria-label={`${t(action)} ${language.name}`}
        >
          {t(action)}
        </Button>
      )}
    </Box>
  );
}

export default function CommunityLanguages({ onInstalled }: Props) {
  const { t } = useTranslation(["admin", "common"]);
  // Refresh asks the server to download the library's list again; any other
  // read (the first, the one after an install) takes the list it cached.
  const [refresh, setRefresh] = useState(false);
  const [reads, setReads] = useState(0);
  const path = refresh ? `${CATALOGUE_PATH}?refresh=true` : CATALOGUE_PATH;
  const { data, loading, error } = useApiQuery<CommunityCatalogue>(path, { refetchKey: reads });
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
        {data?.enabled && (
          <Button
            size="small"
            startIcon={<MaterialSymbol icon="refresh" size={18} />}
            disabled={loading}
            onClick={() => reread(true)}
          >
            {t("customLocales.community.refresh")}
          </Button>
        )}
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t("customLocales.community.description")}
      </Typography>

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
