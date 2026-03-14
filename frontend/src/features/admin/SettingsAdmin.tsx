import { useState, useEffect, useRef, Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
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
import { useMetamodel } from "@/hooks/useMetamodel";
import { useEnabledLocales } from "@/hooks/useEnabledLocales";
import { SUPPORTED_LOCALES, LOCALE_LABELS, type SupportedLocale } from "@/i18n";

const AuthAdmin = lazy(() => import("./AuthAdmin"));
const EolAdmin = lazy(() => import("./EolAdmin"));
const WebPortalsAdmin = lazy(() => import("./WebPortalsAdmin"));
const ServiceNowAdmin = lazy(() => import("./ServiceNowAdmin"));
const AiAdmin = lazy(() => import("./AiAdmin"));
const ArchLensAdmin = lazy(() => import("./ArchLensAdmin"));

const TAB_KEYS = ["general", "authentication", "ai", "eol", "web-portals", "servicenow", "archlens"];

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

const CURRENCIES = [
  { code: "USD", label: "US Dollar ($)" },
  { code: "EUR", label: "Euro (\u20ac)" },
  { code: "GBP", label: "British Pound (\u00a3)" },
  { code: "CHF", label: "Swiss Franc (CHF)" },
  { code: "JPY", label: "Japanese Yen (\u00a5)" },
  { code: "CNY", label: "Chinese Yuan (\u00a5)" },
  { code: "CAD", label: "Canadian Dollar (CA$)" },
  { code: "AUD", label: "Australian Dollar (A$)" },
  { code: "SEK", label: "Swedish Krona (kr)" },
  { code: "NOK", label: "Norwegian Krone (kr)" },
  { code: "DKK", label: "Danish Krone (kr)" },
  { code: "PLN", label: "Polish Z\u0142oty (z\u0142)" },
  { code: "INR", label: "Indian Rupee (\u20b9)" },
  { code: "BRL", label: "Brazilian Real (R$)" },
  { code: "KRW", label: "South Korean Won (\u20a9)" },
  { code: "SGD", label: "Singapore Dollar (S$)" },
  { code: "HKD", label: "Hong Kong Dollar (HK$)" },
  { code: "ZAR", label: "South African Rand (R)" },
  { code: "MXN", label: "Mexican Peso (MX$)" },
  { code: "TRY", label: "Turkish Lira (\u20ba)" },
];

interface EmailSettings {
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_password: string;
  smtp_from: string;
  smtp_tls: boolean;
  app_base_url: string;
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
  const { t } = useTranslation(["admin", "common"]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [snack, setSnack] = useState("");

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

  // BPM toggle state
  const [bpmEnabled, setBpmEnabled] = useState(true);
  const [savingBpm, setSavingBpm] = useState(false);

  // PPM toggle state
  const [ppmEnabled, setPpmEnabled] = useState(false);
  const [savingPpm, setSavingPpm] = useState(false);

  // Fiscal year start
  const [fiscalYearStart, setFiscalYearStart] = useState(1);
  const [savingFiscal, setSavingFiscal] = useState(false);

  // Enabled locales state
  const { enabledLocales: cachedLocales, invalidateEnabledLocales } = useEnabledLocales();
  const [enabledLocales, setEnabledLocales] = useState<SupportedLocale[]>([...SUPPORTED_LOCALES]);
  const [savingLocales, setSavingLocales] = useState(false);

  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("noreply@turboea.local");
  const [smtpTls, setSmtpTls] = useState(true);
  const [appBaseUrl, setAppBaseUrl] = useState("");
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
    ])
      .then(([emailData, logoData, faviconData, currencyData, bpmData, localesData, ppmData, fiscalData]) => {
        setSmtpHost(emailData.smtp_host);
        setSmtpPort(emailData.smtp_port);
        setSmtpUser(emailData.smtp_user);
        setSmtpPassword(emailData.smtp_password);
        setSmtpFrom(emailData.smtp_from);
        setSmtpTls(emailData.smtp_tls);
        setAppBaseUrl(emailData.app_base_url);
        setConfigured(emailData.configured);
        setHasCustomLogo(logoData.has_custom_logo);
        setHasCustomFavicon(faviconData.has_custom_favicon);
        setSelectedCurrency(currencyData.currency);
        setBpmEnabled(bpmData.enabled);
        setPpmEnabled(ppmData.enabled);
        setFiscalYearStart(fiscalData.month);
        const validLocales = (localesData.locales || []).filter((l: string): l is SupportedLocale =>
          (SUPPORTED_LOCALES as readonly string[]).includes(l),
        );
        if (validLocales.length > 0) setEnabledLocales(validLocales);
      })
      .catch((e) => setError(e instanceof Error ? e.message : t("common:errors.generic")))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      await api.patch("/settings/email", {
        smtp_host: smtpHost,
        smtp_port: smtpPort,
        smtp_user: smtpUser,
        smtp_password: smtpPassword,
        smtp_from: smtpFrom,
        smtp_tls: smtpTls,
        app_base_url: appBaseUrl,
      });
      setConfigured(!!smtpHost);
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
              bgcolor: "#1a1a2e",
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
            {CURRENCIES.map((c) => (
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

      {/* ── Email ─────────────────────────────────────────────────── */}
      <SectionHeader>{t("settings.section.email")}</SectionHeader>

      {/* Email / SMTP Settings */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1 }}>
          <MaterialSymbol icon="mail" size={22} color="#555" />
          <Typography variant="h6" fontWeight={600}>
            {t("settings.smtp.title")}
          </Typography>
          <Chip
            label={configured ? t("settings.smtp.configured") : t("settings.smtp.notConfigured")}
            size="small"
            color={configured ? "success" : "default"}
            sx={{ ml: 1 }}
          />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t("settings.smtp.description")}
        </Typography>

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
            disabled={saving || testing || !smtpHost}
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
    t("settings.tabs.archlens"),
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
          <ArchLensAdmin />
        </Suspense>
      )}
    </Box>
  );
}
