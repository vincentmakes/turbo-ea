import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
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
import Chip from "@mui/material/Chip";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";

interface SsoSettings {
  enabled: boolean;
  provider: string;
  client_id: string;
  client_secret: string;
  tenant_id: string;
  domain: string;
  issuer_url: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

const SSO_PROVIDERS = [
  { value: "microsoft", label: "settings.sso.providers.microsoft" },
  { value: "google", label: "settings.sso.providers.google" },
  { value: "okta", label: "settings.sso.providers.okta" },
  { value: "oidc", label: "settings.sso.providers.oidc" },
];

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

export default function AuthAdmin() {
  const { t } = useTranslation(["admin", "common"]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [snack, setSnack] = useState("");

  // Registration toggle state
  const [registrationEnabled, setRegistrationEnabled] = useState(true);
  const [savingRegistration, setSavingRegistration] = useState(false);

  // SSO state
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [ssoProvider, setSsoProvider] = useState("microsoft");
  const [ssoClientId, setSsoClientId] = useState("");
  const [ssoClientSecret, setSsoClientSecret] = useState("");
  const [ssoTenantId, setSsoTenantId] = useState("organizations");
  const [ssoDomain, setSsoDomain] = useState("");
  const [ssoIssuerUrl, setSsoIssuerUrl] = useState("");
  const [ssoAuthEndpoint, setSsoAuthEndpoint] = useState("");
  const [ssoTokenEndpoint, setSsoTokenEndpoint] = useState("");
  const [ssoJwksUri, setSsoJwksUri] = useState("");
  const [savingSso, setSavingSso] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get<SsoSettings>("/settings/sso"),
      api.get<{ enabled: boolean }>("/settings/registration"),
    ])
      .then(([ssoData, regData]) => {
        setSsoEnabled(ssoData.enabled);
        setSsoProvider(ssoData.provider || "microsoft");
        setSsoClientId(ssoData.client_id);
        setSsoClientSecret(ssoData.client_secret);
        setSsoTenantId(ssoData.tenant_id);
        setSsoDomain(ssoData.domain || "");
        setSsoIssuerUrl(ssoData.issuer_url || "");
        setSsoAuthEndpoint(ssoData.authorization_endpoint || "");
        setSsoTokenEndpoint(ssoData.token_endpoint || "");
        setSsoJwksUri(ssoData.jwks_uri || "");
        setRegistrationEnabled(regData.enabled);
      })
      .catch((e) => setError(e instanceof Error ? e.message : t("common:errors.generic")))
      .finally(() => setLoading(false));
  }, []);

  const handleRegistrationToggle = async (enabled: boolean) => {
    setSavingRegistration(true);
    setError("");
    try {
      await api.patch("/settings/registration", { enabled });
      setRegistrationEnabled(enabled);
      setSnack(
        enabled
          ? t("settings.registration.enabledSuccess")
          : t("settings.registration.disabledSuccess"),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setSavingRegistration(false);
    }
  };

  const handleSsoSave = async () => {
    setSavingSso(true);
    setError("");
    try {
      await api.patch("/settings/sso", {
        enabled: ssoEnabled,
        provider: ssoProvider,
        client_id: ssoClientId,
        client_secret: ssoClientSecret,
        tenant_id: ssoTenantId,
        domain: ssoDomain,
        issuer_url: ssoIssuerUrl,
        authorization_endpoint: ssoAuthEndpoint,
        token_endpoint: ssoTokenEndpoint,
        jwks_uri: ssoJwksUri,
      });
      setSnack(t("settings.sso.savedSuccess"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setSavingSso(false);
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

      {/* ── Self-Registration ─────────────────────────────────────── */}
      <SectionHeader>{t("settings.auth.section.registration")}</SectionHeader>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1 }}>
          <MaterialSymbol icon="person_add" size={22} color="#555" />
          <Typography variant="h6" fontWeight={600}>
            {t("settings.registration.title")}
          </Typography>
          <Chip
            label={registrationEnabled ? t("settings.bpm.enabled") : t("settings.bpm.disabled")}
            size="small"
            color={registrationEnabled ? "success" : "default"}
            sx={{ ml: 1 }}
          />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("settings.registration.description")}
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={registrationEnabled}
              onChange={(e) => handleRegistrationToggle(e.target.checked)}
              disabled={savingRegistration || ssoEnabled}
            />
          }
          label={
            ssoEnabled
              ? t("settings.registration.managedBySso")
              : registrationEnabled
                ? t("settings.registration.usersCanRegister")
                : t("settings.registration.onlyAdmins")
          }
        />
      </Paper>

      {/* ── Single Sign-On ────────────────────────────────────────── */}
      <SectionHeader>{t("settings.auth.section.sso")}</SectionHeader>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1 }}>
          <MaterialSymbol icon="shield_person" size={22} color="#555" />
          <Typography variant="h6" fontWeight={600}>
            {t("settings.sso.title")}
          </Typography>
          <Chip
            label={ssoEnabled ? t("settings.bpm.enabled") : t("settings.bpm.disabled")}
            size="small"
            color={ssoEnabled ? "success" : "default"}
            sx={{ ml: 1 }}
          />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t("settings.sso.description")}
        </Typography>

        <FormControlLabel
          control={
            <Switch
              checked={ssoEnabled}
              onChange={(e) => setSsoEnabled(e.target.checked)}
            />
          }
          label={ssoEnabled ? t("settings.sso.enabled") : t("settings.sso.disabled")}
          sx={{ mb: 2 }}
        />

        {ssoEnabled && (
          <>
            {/* Provider selector */}
            <TextField
              select
              label={t("settings.sso.provider")}
              fullWidth
              value={ssoProvider}
              onChange={(e) => setSsoProvider(e.target.value)}
              helperText={t("settings.sso.providerHelper")}
              sx={{ mb: 2 }}
            >
              {SSO_PROVIDERS.map((p) => (
                <MenuItem key={p.value} value={p.value}>
                  {t(p.label)}
                </MenuItem>
              ))}
            </TextField>

            {/* Client ID — always shown */}
            <TextField
              label={t("settings.sso.clientId")}
              fullWidth
              value={ssoClientId}
              onChange={(e) => setSsoClientId(e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              helperText={t(`settings.sso.clientIdHelper.${ssoProvider}`)}
              sx={{ mb: 2 }}
            />

            {/* Client Secret — always shown */}
            <TextField
              label={t("settings.sso.clientSecret")}
              fullWidth
              type="password"
              value={ssoClientSecret}
              onChange={(e) => setSsoClientSecret(e.target.value)}
              helperText={t(`settings.sso.clientSecretHelper.${ssoProvider}`)}
              sx={{ mb: 2 }}
            />

            {/* Microsoft: Tenant ID */}
            {ssoProvider === "microsoft" && (
              <TextField
                label={t("settings.sso.tenantId")}
                fullWidth
                value={ssoTenantId}
                onChange={(e) => setSsoTenantId(e.target.value)}
                placeholder="organizations"
                helperText={t("settings.sso.tenantIdHelper")}
                sx={{ mb: 2 }}
              />
            )}

            {/* Google: Hosted Domain */}
            {ssoProvider === "google" && (
              <TextField
                label={t("settings.sso.googleDomain")}
                fullWidth
                value={ssoDomain}
                onChange={(e) => setSsoDomain(e.target.value)}
                placeholder="yourcompany.com"
                helperText={t("settings.sso.googleDomainHelper")}
                sx={{ mb: 2 }}
              />
            )}

            {/* Okta: Domain */}
            {ssoProvider === "okta" && (
              <TextField
                label={t("settings.sso.oktaDomain")}
                fullWidth
                value={ssoDomain}
                onChange={(e) => setSsoDomain(e.target.value)}
                placeholder="dev-12345.okta.com"
                helperText={t("settings.sso.oktaDomainHelper")}
                sx={{ mb: 2 }}
              />
            )}

            {/* Generic OIDC: Issuer URL */}
            {ssoProvider === "oidc" && (
              <>
                <TextField
                  label={t("settings.sso.issuerUrl")}
                  fullWidth
                  value={ssoIssuerUrl}
                  onChange={(e) => setSsoIssuerUrl(e.target.value)}
                  placeholder="https://auth.example.com/realms/myapp"
                  helperText={t("settings.sso.issuerUrlHelper")}
                  sx={{ mb: 2 }}
                />

                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 1.5, mt: 1 }}
                >
                  {t("settings.sso.manualEndpointsLabel")}
                </Typography>

                <TextField
                  label={t("settings.sso.authorizationEndpoint")}
                  fullWidth
                  value={ssoAuthEndpoint}
                  onChange={(e) => setSsoAuthEndpoint(e.target.value)}
                  placeholder="https://auth.example.com/realms/myapp/protocol/openid-connect/auth"
                  helperText={t("settings.sso.authorizationEndpointHelper")}
                  sx={{ mb: 2 }}
                />
                <TextField
                  label={t("settings.sso.tokenEndpoint")}
                  fullWidth
                  value={ssoTokenEndpoint}
                  onChange={(e) => setSsoTokenEndpoint(e.target.value)}
                  placeholder="https://auth.example.com/realms/myapp/protocol/openid-connect/token"
                  helperText={t("settings.sso.tokenEndpointHelper")}
                  sx={{ mb: 2 }}
                />
                <TextField
                  label={t("settings.sso.jwksUri")}
                  fullWidth
                  value={ssoJwksUri}
                  onChange={(e) => setSsoJwksUri(e.target.value)}
                  placeholder="https://auth.example.com/realms/myapp/protocol/openid-connect/certs"
                  helperText={t("settings.sso.jwksUriHelper")}
                  sx={{ mb: 2 }}
                />
              </>
            )}

            {/* Redirect URI info */}
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2">
                <strong>{t("settings.sso.redirectUri")}</strong>:{" "}
                {t("settings.sso.redirectUriHint")}{" "}
                <code>{window.location.origin}/auth/callback</code>
              </Typography>
            </Alert>

            {/* Provider-specific setup hints */}
            {ssoProvider === "google" && (
              <Alert severity="info" sx={{ mb: 2 }}>
                <Typography variant="body2">
                  {t("settings.sso.googleSetupHint")}
                </Typography>
              </Alert>
            )}
            {ssoProvider === "okta" && (
              <Alert severity="info" sx={{ mb: 2 }}>
                <Typography variant="body2">
                  {t("settings.sso.oktaSetupHint")}
                </Typography>
              </Alert>
            )}
            {ssoProvider === "oidc" && (
              <Alert severity="info" sx={{ mb: 2 }}>
                <Typography variant="body2">
                  {t("settings.sso.oidcSetupHint")}
                </Typography>
              </Alert>
            )}
          </>
        )}

        <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
          <Button
            variant="contained"
            size="small"
            startIcon={<MaterialSymbol icon="save" size={18} />}
            sx={{ textTransform: "none" }}
            onClick={handleSsoSave}
            disabled={savingSso}
          >
            {savingSso ? t("common:labels.loading") : t("common:actions.save")}
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
