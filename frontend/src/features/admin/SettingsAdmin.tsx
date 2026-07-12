import { useState, useEffect, useMemo, useRef, Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Chip from "@mui/material/Chip";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Checkbox from "@mui/material/Checkbox";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useCurrency } from "@/hooks/useCurrency";
import { currencySymbolOverride } from "@/lib/currency";
import {
  DATE_FORMAT_OPTIONS,
  DEFAULT_DATE_FORMAT,
  formatDateWith,
  invalidateDateFormat,
  type DateFormatKey,
} from "@/hooks/useDateFormat";
import { invalidateAppTitle, DEFAULT_APP_TITLE } from "@/hooks/useAppTitle";
import { invalidateGrcEnabled } from "@/hooks/useGrcEnabled";
import { invalidateSponsorButtonEnabled } from "@/hooks/useSponsorButtonEnabled";
import SponsorshipDialog from "@/components/SponsorshipDialog";
import { brand } from "@/theme";
import { invalidateFileUploadsEnabled } from "@/hooks/useFileUploadsEnabled";
import {
  invalidateArchiveRetentionDays,
  DEFAULT_ARCHIVE_RETENTION_DAYS,
} from "@/hooks/useArchiveRetentionDays";
import { invalidateLoginBranding } from "@/hooks/useLoginBranding";
import { useNavbarStyle } from "@/hooks/useNavbarStyle";
import NavbarStyleCard from "./NavbarStyleCard";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useEnabledLocales } from "@/hooks/useEnabledLocales";
import { SUPPORTED_LOCALES, LOCALE_LABELS, type SupportedLocale } from "@/i18n";

const AuthAdmin = lazy(() => import("./AuthAdmin"));
const EolAdmin = lazy(() => import("./EolAdmin"));
const WebPortalsAdmin = lazy(() => import("./WebPortalsAdmin"));
const ServiceNowAdmin = lazy(() => import("./ServiceNowAdmin"));
const AiAdmin = lazy(() => import("./AiAdmin"));
const TurboLensAdmin = lazy(() => import("./TurboLensAdmin"));
const MigrationHub = lazy(() => import("./MigrationHub"));
const AuditLogAdmin = lazy(() => import("./AuditLogAdmin"));

const TAB_KEYS = [
  "general",
  "authentication",
  "ai",
  "eol",
  "web-portals",
  "servicenow",
  "turbolens",
  "migration",
  "audit-log",
];

function TabLoader() {
  return (
    <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
      <CircularProgress />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// General Tab
// ---------------------------------------------------------------------------

// Curated, common-first list of supported currency codes. Display names are
// resolved per active locale via Intl.DisplayNames (so the selector is
// translated), and the symbol uses the override map (e.g. the new Saudi Riyal
// sign) with an Intl fallback \u2014 see currencyOptionLabel().
const CURRENCY_CODES = [
  "USD", "EUR", "GBP", "CHF", "JPY", "CNY", "CAD", "AUD", "SEK", "NOK", "DKK",
  "PLN", "INR", "BRL", "KRW", "SGD", "HKD", "ZAR", "MXN", "TRY", "IDR", "THB",
  "MYR", "PHP", "VND", "NZD", "TWD", "AED", "SAR", "ILS", "QAR", "CZK", "HUF",
  "RON", "RUB", "UAH", "ARS", "CLP", "COP", "EGP", "NGN", "PKR", "BDT",
];

/** Localized "Name (symbol)" label for a currency code in the given locale. */
function currencyOptionLabel(code: string, locale: string): string {
  let name = code;
  try {
    name = new Intl.DisplayNames([locale], { type: "currency" }).of(code) || code;
  } catch {
    /* fall back to the ISO code */
  }
  let symbol = currencySymbolOverride(code);
  if (!symbol) {
    try {
      const parts = new Intl.NumberFormat(locale, {
        style: "currency",
        currency: code,
        maximumFractionDigits: 0,
      }).formatToParts(0);
      symbol = parts.find((p) => p.type === "currency")?.value || code;
    } catch {
      symbol = code;
    }
  }
  return `${name} (${symbol})`;
}

type EmailMethod = "smtp_basic" | "smtp_oauth" | "graph_api";

interface EmailSettings {
  method: EmailMethod;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_password: string;
  smtp_from: string;
  smtp_tls: boolean;
  app_base_url: string;
  oauth_provider: string;
  oauth_tenant_id: string;
  oauth_client_id: string;
  oauth_client_secret: string;
  graph_sender: string;
  oauth_scope: string;
  oauth_token_endpoint: string;
  service_account_json: string;
  configured: boolean;
}

interface LogoInfo {
  has_custom_logo: boolean;
  mime_type: string;
}

interface FaviconInfo {
  has_custom_favicon: boolean;
  mime_type: string;
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      variant="overline"
      sx={{
        display: "block",
        mb: 1.5,
        mt: 1,
        fontWeight: 700,
        color: "text.secondary",
        letterSpacing: 1,
        fontSize: "0.75rem",
      }}
    >
      {children}
    </Typography>
  );
}

function GeneralTab() {
  const { t, i18n } = useTranslation(["admin", "common"]);
  const currencyOptions = useMemo(
    () => CURRENCY_CODES.map((code) => ({ code, label: currencyOptionLabel(code, i18n.language) })),
    [i18n.language],
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [snack, setSnack] = useState("");
  const navbarStyle = useNavbarStyle();

  // Logo state
  const [hasCustomLogo, setHasCustomLogo] = useState(false);
  const [logoVersion, setLogoVersion] = useState(0);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Favicon state
  const [hasCustomFavicon, setHasCustomFavicon] = useState(false);
  const [faviconVersion, setFaviconVersion] = useState(0);
  const [uploadingFavicon, setUploadingFavicon] = useState(false);
  const faviconFileInputRef = useRef<HTMLInputElement>(null);

  // Metamodel cache (invalidated when BPM toggle changes type visibility)
  const { invalidateCache: invalidateMetamodel } = useMetamodel();

  // Currency state
  const { currency: currentCurrency, invalidate: invalidateCurrency } = useCurrency();
  const [selectedCurrency, setSelectedCurrency] = useState("USD");
  const [savingCurrency, setSavingCurrency] = useState(false);

  // Date format state
  const [currentDateFormat, setCurrentDateFormat] =
    useState<DateFormatKey>(DEFAULT_DATE_FORMAT);
  const [selectedDateFormat, setSelectedDateFormat] =
    useState<DateFormatKey>(DEFAULT_DATE_FORMAT);
  const [savingDateFormat, setSavingDateFormat] = useState(false);

  // App title state
  const [appTitle, setAppTitle] = useState(DEFAULT_APP_TITLE);
  const [savingAppTitle, setSavingAppTitle] = useState(false);

  // BPM toggle state
  const [bpmEnabled, setBpmEnabled] = useState(true);
  const [savingBpm, setSavingBpm] = useState(false);

  // PPM toggle state
  const [ppmEnabled, setPpmEnabled] = useState(false);
  const [savingPpm, setSavingPpm] = useState(false);

  // GRC toggle state
  const [grcEnabled, setGrcEnabled] = useState(true);
  const [savingGrc, setSavingGrc] = useState(false);

  // Sponsor button toggle state (gates the avatar-menu button only)
  const [sponsorButtonEnabled, setSponsorButtonEnabled] = useState(true);
  const [savingSponsorButton, setSavingSponsorButton] = useState(false);
  const [sponsorDialogOpen, setSponsorDialogOpen] = useState(false);

  // File uploads toggle state
  const [fileUploadsEnabled, setFileUploadsEnabled] = useState(true);
  const [savingFileUploads, setSavingFileUploads] = useState(false);

  // Fiscal year start
  const [fiscalYearStart, setFiscalYearStart] = useState(1);
  const [savingFiscal, setSavingFiscal] = useState(false);

  // Archived-card retention (days; 0 = keep indefinitely)
  const [archiveRetentionDays, setArchiveRetentionDays] = useState<number>(
    DEFAULT_ARCHIVE_RETENTION_DAYS,
  );
  const [archiveRetentionInput, setArchiveRetentionInput] = useState<string>(
    String(DEFAULT_ARCHIVE_RETENTION_DAYS),
  );
  const [savingArchiveRetention, setSavingArchiveRetention] = useState(false);

  // Enabled locales state
  const { enabledLocales: cachedLocales, invalidateEnabledLocales } = useEnabledLocales();
  const [enabledLocales, setEnabledLocales] = useState<SupportedLocale[]>([...SUPPORTED_LOCALES]);
  const [savingLocales, setSavingLocales] = useState(false);

  // Login-page branding state (tagline + help text + contact link)
  const [loginTagline, setLoginTagline] = useState("");
  const [loginTaglineHidden, setLoginTaglineHidden] = useState(false);
  const [loginHelpText, setLoginHelpText] = useState("");
  const [loginHelpLink, setLoginHelpLink] = useState("");
  const [savingLoginBranding, setSavingLoginBranding] = useState(false);

  const [emailMethod, setEmailMethod] = useState<EmailMethod>("smtp_basic");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("noreply@turboea.local");
  const [smtpTls, setSmtpTls] = useState(true);
  const [appBaseUrl, setAppBaseUrl] = useState("");
  const [oauthProvider, setOauthProvider] = useState("microsoft");
  const [oauthTenantId, setOauthTenantId] = useState("");
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");
  const [graphSender, setGraphSender] = useState("");
  const [oauthScope, setOauthScope] = useState("");
  const [oauthTokenEndpoint, setOauthTokenEndpoint] = useState("");
  const [serviceAccountJson, setServiceAccountJson] = useState("");
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    setEnabledLocales(cachedLocales);
  }, [cachedLocales]);

  useEffect(() => {
    Promise.all([
      api.get<EmailSettings>("/settings/email"),
      api.get<LogoInfo>("/settings/logo/info"),
      api.get<FaviconInfo>("/settings/favicon/info"),
      api.get<{ currency: string }>("/settings/currency"),
      api.get<{ enabled: boolean }>("/settings/bpm-enabled"),
      api.get<{ locales: string[] }>("/settings/enabled-locales"),
      api.get<{ enabled: boolean }>("/settings/ppm-enabled"),
      api.get<{ month: number }>("/settings/fiscal-year-start"),
      api.get<{ days: number }>("/settings/archive-retention-days"),
      api.get<{ app_title: string }>("/settings/app-title"),
      api.get<{ date_format: string }>("/settings/date-format"),
      api.get<{ enabled: boolean }>("/settings/grc-enabled"),
      api.get<{ enabled: boolean }>("/settings/file-uploads-enabled"),
      api.get<{
        login_tagline: string;
        login_tagline_hidden: boolean;
        login_help_text: string;
        login_help_link: string;
      }>("/settings/login-branding"),
      api.get<{ enabled: boolean }>("/settings/sponsor-button-enabled"),
    ])
      .then(([emailData, logoData, faviconData, currencyData, bpmData, localesData, ppmData, fiscalData, archiveRetentionData, appTitleData, dateFormatData, grcData, fileUploadsData, loginBrandingData, sponsorButtonData]) => {
        setEmailMethod(emailData.method ?? "smtp_basic");
        setSmtpHost(emailData.smtp_host);
        setSmtpPort(emailData.smtp_port);
        setSmtpUser(emailData.smtp_user);
        setSmtpPassword(emailData.smtp_password);
        setSmtpFrom(emailData.smtp_from);
        setSmtpTls(emailData.smtp_tls);
        setAppBaseUrl(emailData.app_base_url);
        setOauthProvider(emailData.oauth_provider ?? "microsoft");
        setOauthTenantId(emailData.oauth_tenant_id ?? "");
        setOauthClientId(emailData.oauth_client_id ?? "");
        setOauthClientSecret(emailData.oauth_client_secret ?? "");
        setGraphSender(emailData.graph_sender ?? "");
        setOauthScope(emailData.oauth_scope ?? "");
        setOauthTokenEndpoint(emailData.oauth_token_endpoint ?? "");
        setServiceAccountJson(emailData.service_account_json ?? "");
        setConfigured(emailData.configured);
        setHasCustomLogo(logoData.has_custom_logo);
        setHasCustomFavicon(faviconData.has_custom_favicon);
        setSelectedCurrency(currencyData.currency);
        setBpmEnabled(bpmData.enabled);
        setPpmEnabled(ppmData.enabled);
        setGrcEnabled(grcData.enabled);
        setSponsorButtonEnabled(sponsorButtonData.enabled);
        setFileUploadsEnabled(fileUploadsData.enabled);
        setFiscalYearStart(fiscalData.month);
        setArchiveRetentionDays(archiveRetentionData.days);
        setArchiveRetentionInput(String(archiveRetentionData.days));
        setAppTitle(appTitleData.app_title || DEFAULT_APP_TITLE);
        const fmt = (DATE_FORMAT_OPTIONS as string[]).includes(dateFormatData.date_format)
          ? (dateFormatData.date_format as DateFormatKey)
          : DEFAULT_DATE_FORMAT;
        setCurrentDateFormat(fmt);
        setSelectedDateFormat(fmt);
        const validLocales = (localesData.locales || []).filter((l: string): l is SupportedLocale =>
          (SUPPORTED_LOCALES as readonly string[]).includes(l),
        );
        if (validLocales.length > 0) setEnabledLocales(validLocales);
        setLoginTagline(loginBrandingData.login_tagline || "");
        setLoginTaglineHidden(Boolean(loginBrandingData.login_tagline_hidden));
        setLoginHelpText(loginBrandingData.login_help_text || "");
        setLoginHelpLink(loginBrandingData.login_help_link || "");
      })
      .catch((e) => setError(e instanceof Error ? e.message : t("common:errors.generic")))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const saved = await api.patch<EmailSettings>("/settings/email", {
        method: emailMethod,
        smtp_host: smtpHost,
        smtp_port: smtpPort,
        smtp_user: smtpUser,
        smtp_password: smtpPassword,
        smtp_from: smtpFrom,
        smtp_tls: smtpTls,
        app_base_url: appBaseUrl,
        oauth_provider: oauthProvider,
        oauth_tenant_id: oauthTenantId,
        oauth_client_id: oauthClientId,
        oauth_client_secret: oauthClientSecret,
        graph_sender: graphSender,
        oauth_scope: oauthScope,
        oauth_token_endpoint: oauthTokenEndpoint,
        service_account_json: serviceAccountJson,
      });
      // PATCH echoes the masked settings back, so the computed `configured`
      // flag and re-masked secrets update without a second round-trip.
      setConfigured(saved.configured);
      setSmtpPassword(saved.smtp_password);
      setOauthClientSecret(saved.oauth_client_secret ?? "");
      setServiceAccountJson(saved.service_account_json ?? "");
      setSnack(t("settings.smtp.savedSuccess"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setError("");
    try {
      const res = await api.post<{ ok: boolean; sent_to: string }>(
        "/settings/email/test"
      );
      setSnack(t("settings.smtp.testSent", { email: res.sent_to }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setTesting(false);
    }
  };

  const updateFavicons = () => {
    const v = Date.now();
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (link) link.href = `/api/v1/settings/favicon?v=${v}`;
    const apple = document.querySelector<HTMLLinkElement>(
      'link[rel="apple-touch-icon"]',
    );
    if (apple) apple.href = `/api/v1/settings/favicon?v=${v}`;
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    setError("");
    try {
      await api.upload("/settings/logo", file);
      setHasCustomLogo(true);
      setLogoVersion((v) => v + 1);
      setSnack(t("settings.logo.updated"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common:errors.generic"));
    } finally {
      setUploadingLogo(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleLogoReset = async () => {
    setUploadingLogo(true);
    setError("");
    try {
      await api.delete("/settings/logo");
      setHasCustomLogo(false);
      setLogoVersion((v) => v + 1);
      setSnack(t("settings.logo.resetSuccess"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common:errors.generic"));
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleFaviconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFavicon(true);
    setError("");
    try {
      await api.upload("/settings/favicon", file);
      setHasCustomFavicon(true);
      setFaviconVersion((v) => v + 1);
      updateFavicons();
      setSnack(t("settings.favicon.updated"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common:errors.generic"));
    } finally {
      setUploadingFavicon(false);
      if (faviconFileInputRef.current) faviconFileInputRef.current.value = "";
    }
  };

  const handleFaviconReset = async () => {
    setUploadingFavicon(true);
    setError("");
    try {
      await api.delete("/settings/favicon");
      setHasCustomFavicon(false);
      setFaviconVersion((v) => v + 1);
      updateFavicons();
      setSnack(t("settings.favicon.resetSuccess"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common:errors.generic"));
    } finally {
      setUploadingFavicon(false);
    }
  };

  const handleBpmToggle = async (enabled: boolean) => {
    setSavingBpm(true);
    setError("");
    try {
      await api.patch("/settings/bpm-enabled", { enabled });
      setBpmEnabled(enabled);
      invalidateMetamodel();
      setSnack(enabled ? t("settings.bpm.enabledSuccess") : t("settings.bpm.disabledSuccess"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setSavingBpm(false);
    }
  };

  const handlePpmToggle = async (enabled: boolean) => {
    setSavingPpm(true);
    setError("");
    try {
      await api.patch("/settings/ppm-enabled", { enabled });
      setPpmEnabled(enabled);
      setSnack(enabled ? t("settings.ppm.enabledSuccess") : t("settings.ppm.disabledSuccess"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setSavingPpm(false);
    }
  };

  const handleGrcToggle = async (enabled: boolean) => {
    setSavingGrc(true);
    setError("");
    try {
      await api.patch("/settings/grc-enabled", { enabled });
      setGrcEnabled(enabled);
      invalidateGrcEnabled(enabled);
      setSnack(enabled ? t("settings.grc.enabledSuccess") : t("settings.grc.disabledSuccess"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setSavingGrc(false);
    }
  };

  const handleSponsorButtonToggle = async (enabled: boolean) => {
    setSavingSponsorButton(true);
    setError("");
    try {
      await api.patch("/settings/sponsor-button-enabled", { enabled });
      setSponsorButtonEnabled(enabled);
      invalidateSponsorButtonEnabled(enabled);
      setSnack(
        enabled
          ? t("settings.sponsorButton.enabledSuccess")
          : t("settings.sponsorButton.disabledSuccess"),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setSavingSponsorButton(false);
    }
  };

  const handleFileUploadsToggle = async (enabled: boolean) => {
    setSavingFileUploads(true);
    setError("");
    try {
      await api.patch("/settings/file-uploads-enabled", { enabled });
      setFileUploadsEnabled(enabled);
      invalidateFileUploadsEnabled(enabled);
      setSnack(
        enabled
          ? t("settings.fileUploads.enabledSuccess")
          : t("settings.fileUploads.disabledSuccess"),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setSavingFileUploads(false);
    }
  };

  const handleFiscalYearSave = async (month: number) => {
    setSavingFiscal(true);
    setError("");
    try {
      await api.patch("/settings/fiscal-year-start", { month });
      setFiscalYearStart(month);
      setSnack(t("settings.fiscal.savedSuccess"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setSavingFiscal(false);
    }
  };

  const MAX_ARCHIVE_RETENTION_DAYS = 3650;

  const handleArchiveRetentionSave = async () => {
    const parsed = Number(archiveRetentionInput);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_ARCHIVE_RETENTION_DAYS) {
      setError(t("settings.dataManagement.invalid", { max: MAX_ARCHIVE_RETENTION_DAYS }));
      return;
    }
    setSavingArchiveRetention(true);
    setError("");
    try {
      await api.patch("/settings/archive-retention-days", { days: parsed });
      setArchiveRetentionDays(parsed);
      setArchiveRetentionInput(String(parsed));
      invalidateArchiveRetentionDays(parsed);
      setSnack(t("settings.dataManagement.savedSuccess"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setSavingArchiveRetention(false);
    }
  };

  const handleCurrencySave = async () => {
    setSavingCurrency(true);
    setError("");
    try {
      await api.patch("/settings/currency", { currency: selectedCurrency });
      invalidateCurrency(selectedCurrency);
      setSnack(t("settings.currency.updated"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setSavingCurrency(false);
    }
  };

  const handleDateFormatSave = async () => {
    setSavingDateFormat(true);
    setError("");
    try {
      await api.patch("/settings/date-format", {
        date_format: selectedDateFormat,
      });
      invalidateDateFormat(selectedDateFormat);
      setCurrentDateFormat(selectedDateFormat);
      setSnack(t("settings.dateFormat.updated"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setSavingDateFormat(false);
    }
  };

  const handleAppTitleSave = async () => {
    setSavingAppTitle(true);
    setError("");
    try {
      const trimmed = appTitle.trim();
      await api.patch("/settings/app-title", { app_title: trimmed });
      invalidateAppTitle(trimmed);
      setSnack(t("settings.appTitle.updated"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setSavingAppTitle(false);
    }
  };

  const handleLoginBrandingSave = async () => {
    setSavingLoginBranding(true);
    setError("");
    try {
      const res = await api.patch<{
        login_tagline: string;
        login_tagline_hidden: boolean;
        login_help_text: string;
        login_help_link: string;
      }>("/settings/login-branding", {
        login_tagline: loginTagline.trim(),
        login_tagline_hidden: loginTaglineHidden,
        login_help_text: loginHelpText.trim(),
        login_help_link: loginHelpLink.trim(),
      });
      setLoginTagline(res.login_tagline);
      setLoginTaglineHidden(res.login_tagline_hidden);
      setLoginHelpText(res.login_help_text);
      setLoginHelpLink(res.login_help_link);
      invalidateLoginBranding({
        tagline: res.login_tagline,
        taglineHidden: res.login_tagline_hidden,
        helpText: res.login_help_text,
        helpLink: res.login_help_link,
      });
      setSnack(t("settings.loginBranding.savedSuccess"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setSavingLoginBranding(false);
    }
  };

  const handleLocaleToggle = (locale: SupportedLocale, checked: boolean) => {
    if (checked) {
      setEnabledLocales((prev) => [...prev, locale]);
    } else {
      setEnabledLocales((prev) => prev.filter((l) => l !== locale));
    }
  };

  const handleLocalesSave = async () => {
    if (enabledLocales.length === 0) return;
    setSavingLocales(true);
    setError("");
    try {
      const res = await api.patch<{ locales: string[] }>("/settings/enabled-locales", {
        locales: enabledLocales,
      });
      const valid = (res.locales || []).filter((l: string): l is SupportedLocale =>
        (SUPPORTED_LOCALES as readonly string[]).includes(l),
      );
      invalidateEnabledLocales(valid);
      setSnack(t("settings.locales.savedSuccess"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setSavingLocales(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 720, mx: "auto" }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {/* ── Appearance ────────────────────────────────────────────── */}
      <SectionHeader>{t("settings.section.appearance")}</SectionHeader>

      {/* App title Settings */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1 }}>
          <MaterialSymbol icon="badge" size={22} color="#555" />
          <Typography variant="h6" fontWeight={600}>
            {t("settings.appTitle.title")}
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("settings.appTitle.description")}
        </Typography>
        <Box sx={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap" }}>
          <TextField
            size="small"
            value={appTitle}
            onChange={(e) => setAppTitle(e.target.value)}
            inputProps={{ maxLength: 64 }}
            placeholder={DEFAULT_APP_TITLE}
            sx={{ minWidth: 280 }}
          />
          <Button
            variant="contained"
            size="small"
            onClick={handleAppTitleSave}
            disabled={savingAppTitle}
            startIcon={
              savingAppTitle ? (
                <CircularProgress size={16} />
              ) : (
                <MaterialSymbol icon="save" size={18} />
              )
            }
            sx={{ textTransform: "none" }}
          >
            {savingAppTitle ? t("common:labels.loading") : t("common:actions.save")}
          </Button>
        </Box>
      </Paper>

      {/* Logo Settings */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1 }}>
          <MaterialSymbol icon="image" size={22} color="#555" />
          <Typography variant="h6" fontWeight={600}>
            {t("settings.logo.title")}
          </Typography>
          <Chip
            label={hasCustomLogo ? t("settings.logo.custom") : t("settings.logo.default")}
            size="small"
            color={hasCustomLogo ? "info" : "default"}
            sx={{ ml: 1 }}
          />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t("settings.logo.description")}
        </Typography>

        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 3,
            mb: 2,
          }}
        >
          <Box
            sx={{
              width: 200,
              height: 80,
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              // Preview the logo on the configured navbar background.
              bgcolor: navbarStyle.bg,
              p: 1,
            }}
          >
            <img
              src={`/api/v1/settings/logo?v=${logoVersion}`}
              alt={t("settings.logo.title")}
              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
            />
          </Box>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
              style={{ display: "none" }}
              onChange={handleLogoUpload}
            />
            <Button
              variant="contained"
              size="small"
              startIcon={
                uploadingLogo ? (
                  <CircularProgress size={16} />
                ) : (
                  <MaterialSymbol icon="upload" size={18} />
                )
              }
              sx={{ textTransform: "none" }}
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingLogo}
            >
              {t("settings.logo.upload")}
            </Button>
            {hasCustomLogo && (
              <Button
                variant="outlined"
                size="small"
                color="warning"
                startIcon={<MaterialSymbol icon="restart_alt" size={18} />}
                sx={{ textTransform: "none" }}
                onClick={handleLogoReset}
                disabled={uploadingLogo}
              >
                {t("settings.logo.reset")}
              </Button>
            )}
          </Box>
        </Box>
      </Paper>

      {/* Navbar style */}
      <NavbarStyleCard onSaved={setSnack} onError={setError} />

      {/* Favicon Settings */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1 }}>
          <MaterialSymbol icon="star" size={22} color="#555" />
          <Typography variant="h6" fontWeight={600}>
            {t("settings.favicon.title")}
          </Typography>
          <Chip
            label={hasCustomFavicon ? t("settings.logo.custom") : t("settings.logo.default")}
            size="small"
            color={hasCustomFavicon ? "info" : "default"}
            sx={{ ml: 1 }}
          />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t("settings.favicon.description")}
        </Typography>

        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 3,
            mb: 2,
          }}
        >
          <Box
            sx={{
              width: 80,
              height: 80,
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: "action.selected",
              p: 1,
            }}
          >
            <img
              src={`/api/v1/settings/favicon?v=${faviconVersion}`}
              alt={t("settings.favicon.title")}
              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
            />
          </Box>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <input
              ref={faviconFileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
              style={{ display: "none" }}
              onChange={handleFaviconUpload}
            />
            <Button
              variant="contained"
              size="small"
              startIcon={
                uploadingFavicon ? (
                  <CircularProgress size={16} />
                ) : (
                  <MaterialSymbol icon="upload" size={18} />
                )
              }
              sx={{ textTransform: "none" }}
              onClick={() => faviconFileInputRef.current?.click()}
              disabled={uploadingFavicon}
            >
              {t("settings.favicon.upload")}
            </Button>
            {hasCustomFavicon && (
              <Button
                variant="outlined"
                size="small"
                color="warning"
                startIcon={<MaterialSymbol icon="restart_alt" size={18} />}
                sx={{ textTransform: "none" }}
                onClick={handleFaviconReset}
                disabled={uploadingFavicon}
              >
                {t("settings.logo.reset")}
              </Button>
            )}
          </Box>
        </Box>
      </Paper>

      {/* Login Page Branding */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1 }}>
          <MaterialSymbol icon="login" size={22} color="#555" />
          <Typography variant="h6" fontWeight={600}>
            {t("settings.loginBranding.title")}
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t("settings.loginBranding.description")}
        </Typography>

        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <TextField
            size="small"
            label={t("settings.loginBranding.tagline")}
            value={loginTagline}
            onChange={(e) => setLoginTagline(e.target.value)}
            inputProps={{ maxLength: 200 }}
            placeholder={t("settings.loginBranding.taglinePlaceholder")}
            helperText={t("settings.loginBranding.taglineHelp")}
            fullWidth
          />
          <FormControlLabel
            control={
              <Switch
                checked={loginTaglineHidden}
                onChange={(_, checked) => setLoginTaglineHidden(checked)}
              />
            }
            label={t("settings.loginBranding.hideTagline")}
          />
          <TextField
            size="small"
            label={t("settings.loginBranding.helpText")}
            value={loginHelpText}
            onChange={(e) => setLoginHelpText(e.target.value)}
            inputProps={{ maxLength: 500 }}
            placeholder={t("settings.loginBranding.helpTextPlaceholder")}
            helperText={t("settings.loginBranding.helpTextHelp")}
            multiline
            minRows={2}
            maxRows={4}
            fullWidth
          />
          <TextField
            size="small"
            label={t("settings.loginBranding.helpLink")}
            value={loginHelpLink}
            onChange={(e) => setLoginHelpLink(e.target.value)}
            inputProps={{ maxLength: 300 }}
            placeholder={t("settings.loginBranding.helpLinkPlaceholder")}
            helperText={t("settings.loginBranding.helpLinkHelp")}
            fullWidth
          />
          <Box>
            <Button
              variant="contained"
              size="small"
              onClick={handleLoginBrandingSave}
              disabled={savingLoginBranding}
              startIcon={
                savingLoginBranding ? (
                  <CircularProgress size={16} />
                ) : (
                  <MaterialSymbol icon="save" size={18} />
                )
              }
              sx={{ textTransform: "none" }}
            >
              {savingLoginBranding ? t("common:labels.loading") : t("common:actions.save")}
            </Button>
          </Box>
        </Box>
      </Paper>

      {/* Currency Settings */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1 }}>
          <MaterialSymbol icon="payments" size={22} color="#555" />
          <Typography variant="h6" fontWeight={600}>
            {t("settings.currency.title")}
          </Typography>
          <Chip
            label={currentCurrency}
            size="small"
            color="default"
            sx={{ ml: 1 }}
          />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t("settings.currency.description")}
        </Typography>

        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <TextField
            select
            size="small"
            label={t("settings.currency.label")}
            value={selectedCurrency}
            onChange={(e) => setSelectedCurrency(e.target.value)}
            sx={{ minWidth: 280 }}
          >
            {currencyOptions.map((c) => (
              <MenuItem key={c.code} value={c.code}>
                {c.code} — {c.label}
              </MenuItem>
            ))}
          </TextField>
          <Button
            variant="contained"
            size="small"
            startIcon={<MaterialSymbol icon="save" size={18} />}
            sx={{ textTransform: "none" }}
            onClick={handleCurrencySave}
            disabled={savingCurrency || selectedCurrency === currentCurrency}
          >
            {savingCurrency ? t("common:labels.loading") : t("common:actions.save")}
          </Button>
        </Box>
      </Paper>

      {/* Date Format Settings */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1 }}>
          <MaterialSymbol icon="calendar_today" size={22} color="#555" />
          <Typography variant="h6" fontWeight={600}>
            {t("settings.dateFormat.title")}
          </Typography>
          <Chip
            label={currentDateFormat}
            size="small"
            color="default"
            sx={{ ml: 1 }}
          />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t("settings.dateFormat.description")}
        </Typography>

        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <TextField
            select
            size="small"
            label={t("settings.dateFormat.label")}
            value={selectedDateFormat}
            onChange={(e) =>
              setSelectedDateFormat(e.target.value as DateFormatKey)
            }
            sx={{ minWidth: 320 }}
          >
            {DATE_FORMAT_OPTIONS.map((fmt) => (
              <MenuItem key={fmt} value={fmt}>
                {fmt} — {formatDateWith(fmt, new Date(2026, 3, 29))}
              </MenuItem>
            ))}
          </TextField>
          <Button
            variant="contained"
            size="small"
            startIcon={<MaterialSymbol icon="save" size={18} />}
            sx={{ textTransform: "none" }}
            onClick={handleDateFormatSave}
            disabled={
              savingDateFormat || selectedDateFormat === currentDateFormat
            }
          >
            {savingDateFormat
              ? t("common:labels.loading")
              : t("common:actions.save")}
          </Button>
        </Box>
      </Paper>

      {/* Enabled Languages */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1 }}>
          <MaterialSymbol icon="translate" size={22} color="#555" />
          <Typography variant="h6" fontWeight={600}>
            {t("settings.locales.title")}
          </Typography>
          <Chip
            label={`${enabledLocales.length}/${SUPPORTED_LOCALES.length}`}
            size="small"
            color="default"
            sx={{ ml: 1 }}
          />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("settings.locales.description")}
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 2 }}>
          {SUPPORTED_LOCALES.map((locale) => (
            <FormControlLabel
              key={locale}
              control={
                <Checkbox
                  size="small"
                  checked={enabledLocales.includes(locale)}
                  onChange={(e) => handleLocaleToggle(locale, e.target.checked)}
                  disabled={enabledLocales.length === 1 && enabledLocales.includes(locale)}
                />
              }
              label={LOCALE_LABELS[locale]}
              sx={{ mr: 2 }}
            />
          ))}
        </Box>
        <Button
          variant="contained"
          size="small"
          startIcon={<MaterialSymbol icon="save" size={18} />}
          sx={{ textTransform: "none" }}
          onClick={handleLocalesSave}
          disabled={savingLocales || enabledLocales.length === 0}
        >
          {savingLocales ? t("common:labels.loading") : t("common:actions.save")}
        </Button>
      </Paper>

      {/* Fiscal Year Start */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1 }}>
          <MaterialSymbol icon="calendar_month" size={22} color="#555" />
          <Typography variant="h6" fontWeight={600}>
            {t("settings.fiscal.title")}
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("settings.fiscal.description")}
        </Typography>
        <TextField
          select
          size="small"
          label={t("settings.fiscal.startMonth")}
          value={fiscalYearStart}
          onChange={(e) => handleFiscalYearSave(Number(e.target.value))}
          disabled={savingFiscal}
          sx={{ minWidth: 220 }}
        >
          {Array.from({ length: 12 }, (_, i) => {
            const d = new Date(2000, i, 1);
            return (
              <MenuItem key={i + 1} value={i + 1}>
                {d.toLocaleString(undefined, { month: "long" })} ({i + 1})
              </MenuItem>
            );
          })}
        </TextField>
      </Paper>

      {/* File Uploads Toggle */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1 }}>
          <MaterialSymbol icon="attach_file" size={22} color="#555" />
          <Typography variant="h6" fontWeight={600}>
            {t("settings.fileUploads.title")}
          </Typography>
          <Chip
            label={
              fileUploadsEnabled
                ? t("settings.fileUploads.enabled")
                : t("settings.fileUploads.disabled")
            }
            size="small"
            color={fileUploadsEnabled ? "success" : "default"}
            sx={{ ml: 1 }}
          />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("settings.fileUploads.description")}
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={fileUploadsEnabled}
              onChange={(e) => handleFileUploadsToggle(e.target.checked)}
              disabled={savingFileUploads}
            />
          }
          label={
            fileUploadsEnabled
              ? t("settings.fileUploads.visible")
              : t("settings.fileUploads.hidden")
          }
        />
      </Paper>

      {/* ── Data management ───────────────────────────────────────── */}
      <SectionHeader>{t("settings.section.dataManagement")}</SectionHeader>

      {/* Archived-card retention */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1 }}>
          <MaterialSymbol icon="auto_delete" size={22} color="#555" />
          <Typography variant="h6" fontWeight={600}>
            {t("settings.dataManagement.title")}
          </Typography>
          <Chip
            label={
              archiveRetentionDays === 0
                ? t("settings.dataManagement.indefiniteChip")
                : t("settings.dataManagement.daysChip", { count: archiveRetentionDays })
            }
            size="small"
            color={archiveRetentionDays === 0 ? "warning" : "default"}
            sx={{ ml: 1 }}
          />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("settings.dataManagement.description")}
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={archiveRetentionInput.trim() === "0"}
              onChange={(e) =>
                setArchiveRetentionInput(
                  e.target.checked ? "0" : String(DEFAULT_ARCHIVE_RETENTION_DAYS),
                )
              }
              disabled={savingArchiveRetention}
            />
          }
          label={t("settings.dataManagement.keepIndefinitely")}
        />
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 2, mt: 1 }}>
          <TextField
            type="number"
            size="small"
            label={t("settings.dataManagement.retentionDays")}
            value={archiveRetentionInput}
            onChange={(e) => setArchiveRetentionInput(e.target.value)}
            disabled={savingArchiveRetention || archiveRetentionInput.trim() === "0"}
            inputProps={{ min: 0, max: 3650 }}
            helperText={t("settings.dataManagement.retentionHelp")}
            sx={{ minWidth: 220 }}
          />
          <Button
            variant="contained"
            startIcon={<MaterialSymbol icon="save" size={18} />}
            sx={{ textTransform: "none", mt: 0.25 }}
            onClick={handleArchiveRetentionSave}
            disabled={savingArchiveRetention || archiveRetentionInput === String(archiveRetentionDays)}
          >
            {savingArchiveRetention ? t("common:labels.loading") : t("common:actions.save")}
          </Button>
        </Box>
      </Paper>

      {/* ── Modules ───────────────────────────────────────────────── */}
      <SectionHeader>{t("settings.section.modules")}</SectionHeader>

      {/* BPM Module Toggle */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1 }}>
          <MaterialSymbol icon="route" size={22} color="#555" />
          <Typography variant="h6" fontWeight={600}>
            {t("settings.bpm.title")}
          </Typography>
          <Chip
            label={bpmEnabled ? t("settings.bpm.enabled") : t("settings.bpm.disabled")}
            size="small"
            color={bpmEnabled ? "success" : "default"}
            sx={{ ml: 1 }}
          />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("settings.bpm.description")}
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={bpmEnabled}
              onChange={(e) => handleBpmToggle(e.target.checked)}
              disabled={savingBpm}
            />
          }
          label={bpmEnabled ? t("settings.bpm.visible") : t("settings.bpm.hidden")}
        />
      </Paper>

      {/* PPM Module Toggle */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1 }}>
          <MaterialSymbol icon="assignment" size={22} color="#555" />
          <Typography variant="h6" fontWeight={600}>
            {t("settings.ppm.title")}
          </Typography>
          <Chip
            label={ppmEnabled ? t("settings.ppm.enabled") : t("settings.ppm.disabled")}
            size="small"
            color={ppmEnabled ? "success" : "default"}
            sx={{ ml: 1 }}
          />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("settings.ppm.description")}
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={ppmEnabled}
              onChange={(e) => handlePpmToggle(e.target.checked)}
              disabled={savingPpm}
            />
          }
          label={ppmEnabled ? t("settings.ppm.visible") : t("settings.ppm.hidden")}
        />
      </Paper>

      {/* GRC Module Toggle */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1 }}>
          <MaterialSymbol icon="policy" size={22} color="#555" />
          <Typography variant="h6" fontWeight={600}>
            {t("settings.grc.title")}
          </Typography>
          <Chip
            label={grcEnabled ? t("settings.grc.enabled") : t("settings.grc.disabled")}
            size="small"
            color={grcEnabled ? "success" : "default"}
            sx={{ ml: 1 }}
          />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("settings.grc.description")}
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={grcEnabled}
              onChange={(e) => handleGrcToggle(e.target.checked)}
              disabled={savingGrc}
            />
          }
          label={grcEnabled ? t("settings.grc.visible") : t("settings.grc.hidden")}
        />
      </Paper>

      {/* Sponsor Button Toggle */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1 }}>
          <MaterialSymbol icon="volunteer_activism" size={22} color="#555" />
          <Typography variant="h6" fontWeight={600}>
            {t("settings.sponsorButton.title")}
          </Typography>
          <Chip
            label={
              sponsorButtonEnabled
                ? t("settings.sponsorButton.enabled")
                : t("settings.sponsorButton.disabled")
            }
            size="small"
            color={sponsorButtonEnabled ? "success" : "default"}
            sx={{ ml: 1 }}
          />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("settings.sponsorButton.description")}
        </Typography>
        <Button
          startIcon={<MaterialSymbol icon="volunteer_activism" size={18} />}
          onClick={() => setSponsorDialogOpen(true)}
          sx={{
            mb: 2,
            background: `linear-gradient(135deg, ${brand.sponsorFrom}, ${brand.sponsorTo})`,
            color: "#fff",
            textTransform: "none",
            "&:hover": {
              background: `linear-gradient(135deg, ${brand.sponsorFrom}, ${brand.sponsorTo})`,
              filter: "brightness(0.95)",
            },
          }}
        >
          {t("nav:userMenu.sponsorship")}
        </Button>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("settings.sponsorButton.companyLogoNote")}{" "}
          <Link href="mailto:sponsorship@turbo-ea.org">sponsorship@turbo-ea.org</Link>
        </Typography>
        <FormControlLabel
          sx={{ display: "flex" }}
          control={
            <Switch
              checked={sponsorButtonEnabled}
              onChange={(e) => handleSponsorButtonToggle(e.target.checked)}
              disabled={savingSponsorButton}
            />
          }
          label={
            sponsorButtonEnabled
              ? t("settings.sponsorButton.visible")
              : t("settings.sponsorButton.hidden")
          }
        />
      </Paper>
      <SponsorshipDialog open={sponsorDialogOpen} onClose={() => setSponsorDialogOpen(false)} />

      {/* ── Email ─────────────────────────────────────────────────── */}
      <SectionHeader>{t("settings.section.email")}</SectionHeader>

      {/* Email delivery settings (SMTP / SMTP OAuth / Microsoft Graph) */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1 }}>
          <MaterialSymbol icon="mail" size={22} color="#555" />
          <Typography variant="h6" fontWeight={600}>
            {t("settings.email.title")}
          </Typography>
          <Chip
            label={configured ? t("settings.smtp.configured") : t("settings.smtp.notConfigured")}
            size="small"
            color={configured ? "success" : "default"}
            sx={{ ml: 1 }}
          />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t("settings.email.description")}
        </Typography>

        {/* Transport method selector */}
        <TextField
          select
          label={t("settings.email.method")}
          fullWidth
          value={emailMethod}
          onChange={(e) => setEmailMethod(e.target.value as EmailMethod)}
          helperText={t("settings.email.methodHelper")}
          sx={{ mb: 2 }}
        >
          <MenuItem value="smtp_basic">{t("settings.email.method.smtpBasic")}</MenuItem>
          <MenuItem value="smtp_oauth">{t("settings.email.method.smtpOauth")}</MenuItem>
          <MenuItem value="graph_api">{t("settings.email.method.graphApi")}</MenuItem>
        </TextField>

        {emailMethod === "graph_api" && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {t("settings.email.hint.graphApi")}
          </Alert>
        )}
        {emailMethod === "smtp_oauth" && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {t("settings.email.hint.smtpOauth")}
          </Alert>
        )}

        {/* SMTP connection (basic + xoauth2) */}
        {emailMethod !== "graph_api" && (
          <Box
            sx={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 2, mb: 2 }}
          >
            <TextField
              label={t("settings.smtp.host")}
              fullWidth
              value={smtpHost}
              onChange={(e) => setSmtpHost(e.target.value)}
              placeholder="e.g. smtp.gmail.com"
            />
            <TextField
              label={t("settings.smtp.port")}
              fullWidth
              type="number"
              value={smtpPort}
              onChange={(e) => setSmtpPort(Number(e.target.value))}
            />
          </Box>
        )}

        {/* Basic auth credentials */}
        {emailMethod === "smtp_basic" && (
          <Box
            sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, mb: 2 }}
          >
            <TextField
              label={t("settings.smtp.username")}
              fullWidth
              value={smtpUser}
              onChange={(e) => setSmtpUser(e.target.value)}
              placeholder="e.g. user@gmail.com"
            />
            <TextField
              label={t("settings.smtp.password")}
              fullWidth
              type="password"
              value={smtpPassword}
              onChange={(e) => setSmtpPassword(e.target.value)}
            />
          </Box>
        )}

        {/* OAuth provider config (graph_api + smtp_oauth) */}
        {emailMethod !== "smtp_basic" && (
          <>
            <TextField
              select
              label={t("settings.email.oauthProvider")}
              fullWidth
              value={oauthProvider}
              onChange={(e) => setOauthProvider(e.target.value)}
              disabled={emailMethod === "graph_api"}
              sx={{ mb: 2 }}
            >
              <MenuItem value="microsoft">
                {t("settings.email.provider.microsoft")}
              </MenuItem>
              <MenuItem value="google">{t("settings.email.provider.google")}</MenuItem>
            </TextField>

            {emailMethod === "smtp_oauth" && (
              <TextField
                label={t("settings.email.senderMailbox")}
                fullWidth
                value={smtpUser}
                onChange={(e) => setSmtpUser(e.target.value)}
                placeholder="mailbox@yourcompany.com"
                helperText={t("settings.email.senderMailboxHelper")}
                sx={{ mb: 2 }}
              />
            )}

            {emailMethod === "graph_api" && (
              <TextField
                label={t("settings.email.graphSender")}
                fullWidth
                value={graphSender}
                onChange={(e) => setGraphSender(e.target.value)}
                placeholder="mailbox@yourcompany.com"
                helperText={t("settings.email.graphSenderHelper")}
                sx={{ mb: 2 }}
              />
            )}

            {oauthProvider === "google" && emailMethod === "smtp_oauth" ? (
              <TextField
                label={t("settings.email.serviceAccountJson")}
                fullWidth
                multiline
                minRows={3}
                value={serviceAccountJson}
                onChange={(e) => setServiceAccountJson(e.target.value)}
                placeholder='{ "client_email": "...", "private_key": "..." }'
                helperText={t("settings.email.serviceAccountJsonHelper")}
                sx={{ mb: 2 }}
              />
            ) : (
              <>
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 2,
                    mb: 2,
                  }}
                >
                  <TextField
                    label={t("settings.email.tenantId")}
                    fullWidth
                    value={oauthTenantId}
                    onChange={(e) => setOauthTenantId(e.target.value)}
                    placeholder="organizations"
                  />
                  <TextField
                    label={t("settings.email.clientId")}
                    fullWidth
                    value={oauthClientId}
                    onChange={(e) => setOauthClientId(e.target.value)}
                  />
                </Box>
                <TextField
                  label={t("settings.email.clientSecret")}
                  fullWidth
                  type="password"
                  value={oauthClientSecret}
                  onChange={(e) => setOauthClientSecret(e.target.value)}
                  sx={{ mb: 2 }}
                />
              </>
            )}

            {/* Advanced overrides */}
            <Box
              sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, mb: 2 }}
            >
              <TextField
                label={t("settings.email.scope")}
                fullWidth
                value={oauthScope}
                onChange={(e) => setOauthScope(e.target.value)}
                placeholder={t("settings.email.scopePlaceholder")}
                helperText={t("settings.email.scopeHelper")}
              />
              <TextField
                label={t("settings.email.tokenEndpoint")}
                fullWidth
                value={oauthTokenEndpoint}
                onChange={(e) => setOauthTokenEndpoint(e.target.value)}
                helperText={t("settings.email.tokenEndpointHelper")}
              />
            </Box>
          </>
        )}

        {/* From + TLS */}
        <Box
          sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, mb: 2 }}
        >
          <TextField
            label={t("settings.smtp.fromAddress")}
            fullWidth
            value={smtpFrom}
            onChange={(e) => setSmtpFrom(e.target.value)}
            placeholder="noreply@turboea.local"
          />
          {emailMethod !== "graph_api" && (
            <FormControlLabel
              control={
                <Switch
                  checked={smtpTls}
                  onChange={(e) => setSmtpTls(e.target.checked)}
                />
              }
              label={t("settings.smtp.useTls")}
              sx={{ ml: 1, mt: 1 }}
            />
          )}
        </Box>

        <Divider sx={{ my: 2 }} />

        <TextField
          label={t("settings.smtp.appBaseUrl")}
          fullWidth
          value={appBaseUrl}
          onChange={(e) => setAppBaseUrl(e.target.value)}
          placeholder="e.g. https://turboea.yourcompany.com"
          helperText={t("settings.smtp.appBaseUrlHelper")}
          sx={{ mb: 3 }}
        />

        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
          <Button
            variant="outlined"
            startIcon={
              testing ? (
                <CircularProgress size={16} />
              ) : (
                <MaterialSymbol icon="send" size={18} />
              )
            }
            sx={{ textTransform: "none" }}
            onClick={handleTest}
            disabled={saving || testing || !configured}
          >
            {testing ? t("settings.smtp.sending") : t("settings.smtp.sendTest")}
          </Button>
          <Button
            variant="contained"
            startIcon={<MaterialSymbol icon="save" size={18} />}
            sx={{ textTransform: "none" }}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? t("common:labels.loading") : t("common:actions.save")}
          </Button>
        </Box>
      </Paper>

      <Snackbar
        open={!!snack}
        autoHideDuration={4000}
        onClose={() => setSnack("")}
        message={snack}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main Settings Page (Tabbed Layout)
// ---------------------------------------------------------------------------

export default function SettingsAdmin() {
  const { t } = useTranslation(["admin", "common"]);
  const [params, setParams] = useSearchParams();
  const tabKey = params.get("tab") || "general";
  const tabIndex = Math.max(0, TAB_KEYS.indexOf(tabKey));

  const TAB_LABELS = [
    t("settings.tabs.general"),
    t("settings.tabs.authentication"),
    t("settings.tabs.ai"),
    t("settings.tabs.eol"),
    t("settings.tabs.webPortals"),
    t("settings.tabs.servicenow"),
    t("settings.tabs.turbolens"),
    t("settings.tabs.migration"),
    t("settings.tabs.auditLog", "Audit log"),
  ];

  const handleTabChange = (_: React.SyntheticEvent, newIndex: number) => {
    const newTab = TAB_KEYS[newIndex];
    if (newTab === "general") {
      setParams({});
    } else {
      setParams({ tab: newTab });
    }
  };

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", mb: 3, gap: 1 }}>
        <MaterialSymbol icon="settings" size={28} color="#1976d2" />
        <Typography variant="h5" fontWeight={700}>
          {t("settings.title")}
        </Typography>
      </Box>

      <Tabs
        value={tabIndex}
        onChange={handleTabChange}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 3 }}
      >
        {TAB_LABELS.map((label, i) => (
          <Tab key={TAB_KEYS[i]} label={label} />
        ))}
      </Tabs>

      {tabIndex === 0 && <GeneralTab />}
      {tabIndex === 1 && (
        <Suspense fallback={<TabLoader />}>
          <AuthAdmin />
        </Suspense>
      )}
      {tabIndex === 2 && (
        <Suspense fallback={<TabLoader />}>
          <AiAdmin />
        </Suspense>
      )}
      {tabIndex === 3 && (
        <Suspense fallback={<TabLoader />}>
          <EolAdmin />
        </Suspense>
      )}
      {tabIndex === 4 && (
        <Suspense fallback={<TabLoader />}>
          <WebPortalsAdmin />
        </Suspense>
      )}
      {tabIndex === 5 && (
        <Suspense fallback={<TabLoader />}>
          <ServiceNowAdmin />
        </Suspense>
      )}
      {tabIndex === 6 && (
        <Suspense fallback={<TabLoader />}>
          <TurboLensAdmin />
        </Suspense>
      )}
      {tabIndex === 7 && (
        <Suspense fallback={<TabLoader />}>
          <MigrationHub />
        </Suspense>
      )}
      {tabIndex === 8 && (
        <Suspense fallback={<TabLoader />}>
          <AuditLogAdmin />
        </Suspense>
      )}
    </Box>
  );
}
