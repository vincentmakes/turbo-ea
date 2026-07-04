import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { Link as RouterLink } from "react-router-dom";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Alert from "@mui/material/Alert";
import Divider from "@mui/material/Divider";
import CircularProgress from "@mui/material/CircularProgress";
import { useTranslation } from "react-i18next";
import { auth } from "@/api/client";
import { useAppTitle } from "@/hooks/useAppTitle";
import { useLoginBranding, normalizeContactLink } from "@/hooks/useLoginBranding";
import type { SsoConfig } from "@/types";

interface Props {
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (email: string, displayName: string, password: string) => Promise<void>;
}

// Cache the resolved SSO config for the session so a refresh renders the
// correct login layout instantly — no flash of the email/password fields
// while the request is in flight, and no repeat round-trip (the config
// fetch can take a couple seconds when the backend must reach an OIDC
// provider's discovery document).
const SSO_CACHE_KEY = "turboea_sso_config";

function readCachedSsoConfig(): SsoConfig | null {
  try {
    const raw = sessionStorage.getItem(SSO_CACHE_KEY);
    return raw ? (JSON.parse(raw) as SsoConfig) : null;
  } catch {
    return null;
  }
}

export default function LoginPage({ onLogin, onRegister }: Props) {
  const { t } = useTranslation("auth");
  const [tab, setTab] = useState(0);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [ssoConfig, setSsoConfig] = useState<SsoConfig | null>(readCachedSsoConfig);
  // Only "loading" on the very first visit (no cached config yet). With a
  // cached value we render the right layout immediately and refresh silently.
  const [configLoading, setConfigLoading] = useState(() => readCachedSsoConfig() === null);
  const appTitle = useAppTitle();
  const branding = useLoginBranding();

  // Measure the logo+tagline header so we can shift the group up by half its
  // height, keeping the card (not just the group) at the true vertical centre.
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerShift, setHeaderShift] = useState(0);
  useLayoutEffect(() => {
    const h = headerRef.current?.offsetHeight ?? 0;
    // 24px = the mb:3 gap (theme spacing unit 8px × 3) between header and card.
    setHeaderShift(h > 0 ? (h + 24) / 2 : 0);
  }, [branding.taglineHidden, branding.tagline, appTitle]);

  useEffect(() => {
    auth
      .ssoConfig()
      .then((cfg) => {
        setSsoConfig(cfg);
        try {
          sessionStorage.setItem(SSO_CACHE_KEY, JSON.stringify(cfg));
        } catch {
          // sessionStorage unavailable (private mode etc.) — non-fatal.
        }
      })
      .catch(() => {})
      .finally(() => setConfigLoading(false));
  }, []);

  const ssoEnabled = ssoConfig?.enabled === true;
  // Hide the email/password form when SSO is on and every account is SSO-based
  // (the backend reports no local accounts). Any local/invited account keeps
  // the form visible so those users can still sign in or set a password.
  const showLocalLogin =
    !ssoEnabled || ssoConfig?.local_login_available !== false;
  const registrationAllowed =
    !ssoEnabled && ssoConfig?.registration_enabled !== false;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (tab === 0) {
        await onLogin(email, password);
      } else {
        await onRegister(email, displayName, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common:errors.occurred"));
    } finally {
      setLoading(false);
    }
  };

  const handleSsoLogin = () => {
    if (!ssoConfig?.client_id || !ssoConfig.authorization_endpoint) return;

    const redirectUri = `${window.location.origin}/auth/callback`;
    const params = new URLSearchParams({
      client_id: ssoConfig.client_id,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: ssoConfig.scopes || "openid email profile",
      response_mode: "query",
    });

    // Append any extra auth params (e.g. Google's hd parameter)
    if (ssoConfig.extra_auth_params) {
      for (const [k, v] of Object.entries(ssoConfig.extra_auth_params)) {
        params.set(k, v);
      }
    }

    window.location.href = `${ssoConfig.authorization_endpoint}?${params.toString()}`;
  };

  const provider = ssoConfig?.provider || "microsoft";

  return (
    <Box
      sx={{
        // Center against the *visible* viewport. On mobile, 100vh includes the
        // area behind the address bar, so 100vh-centred content sits lower than
        // the visual centre — 100dvh tracks the actually-visible height.
        minHeight: "100vh",
        "@supports (min-height: 100dvh)": { minHeight: "100dvh" },
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "#1a1a2e",
        py: 4,
      }}
    >
      {/* For the compact SSO-only card, shift the group up by half the header's
          height so the CARD itself sits at the true vertical centre (not just the
          logo+card group). When the taller email/password form is shown, keep the
          balanced group-centring — shifting a tall card up leaves it looking too
          high. */}
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          transform: `translateY(-${showLocalLogin ? 0 : headerShift}px)`,
        }}
      >
        <Box ref={headerRef} sx={{ textAlign: "center", mb: 3 }}>
          <img
            src="/api/v1/settings/logo"
            alt={appTitle}
            style={{ height: 64, maxWidth: 280, objectFit: "contain" }}
          />
          {!branding.taglineHidden && (
            <Typography variant="body2" sx={{ mt: 1, color: "rgba(255,255,255,0.6)" }}>
              {branding.tagline || t("login.title")}
            </Typography>
          )}
        </Box>
        <Card sx={{ p: 4, width: 400, maxWidth: "90vw" }}>
        {configLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 5 }}>
            <CircularProgress size={28} />
          </Box>
        ) : (
          <>
        {/* SSO Login Button */}
        {ssoEnabled && (
          <>
            {/* When SSO is the only method, give the card a proper heading so
                it doesn't read as a lone button. */}
            {!showLocalLogin && (
              <Box sx={{ textAlign: "center", mb: 3 }}>
                <Typography variant="h6" fontWeight={600}>
                  {t("login.signInToApp", { app: appTitle })}
                </Typography>
              </Box>
            )}
            <Button
              fullWidth
              variant="contained"
              size="large"
              onClick={handleSsoLogin}
              startIcon={
                provider === "microsoft" ? (
                  <svg width="20" height="20" viewBox="0 0 21 21" fill="none">
                    <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                    <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                    <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                    <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
                  </svg>
                ) : provider === "google" ? (
                  <svg width="20" height="20" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                ) : provider === "okta" ? (
                  <svg width="20" height="20" viewBox="0 0 24 24">
                    <path d="M12 0C5.389 0 0 5.389 0 12s5.389 12 12 12 12-5.389 12-12S18.611 0 12 0zm0 18c-3.314 0-6-2.686-6-6s2.686-6 6-6 6 2.686 6 6-2.686 6-6 6z" fill="#007DC1"/>
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
                  </svg>
                )
              }
              sx={{
                mb: showLocalLogin ? 2 : 1.5,
                bgcolor: "action.hover",
                color: "text.primary",
                textTransform: "none",
                fontWeight: 600,
                boxShadow: "none",
                border: 1,
                borderColor: "divider",
                "&:hover": { bgcolor: "action.selected", boxShadow: "none" },
              }}
            >
              {t("login.ssoButtonProvider", {
                provider: ssoConfig?.provider_name || "SSO",
              })}
            </Button>
            {!showLocalLogin && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", textAlign: "center", mt: 1.5 }}
              >
                {t("login.ssoRedirectHint", {
                  provider: ssoConfig?.provider_name || "SSO",
                })}
              </Typography>
            )}
            {showLocalLogin && (
              <Divider sx={{ my: 2, color: "text.secondary", fontSize: 13 }}>
                {t("login.ssoEmailDivider")}
              </Divider>
            )}
          </>
        )}

        {/* Only show Login/Register tabs when registration is allowed */}
        {registrationAllowed && (
          <Tabs value={tab} onChange={(_, v) => setTab(v)} centered sx={{ mb: 2 }}>
            <Tab label={t("login.tabLogin")} />
            <Tab label={t("login.tabRegister")} />
          </Tabs>
        )}

        {showLocalLogin && (
          <>
            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}

            <form onSubmit={handleSubmit}>
              <TextField
                fullWidth
                label={t("login.email")}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                sx={{ mb: 2 }}
              />
              {tab === 1 && registrationAllowed && (
                <TextField
                  fullWidth
                  label={t("register.displayName")}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                  sx={{ mb: 2 }}
                />
              )}
              <TextField
                fullWidth
                label={t("login.password")}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                sx={{ mb: tab === 0 && branding.smtpConfigured ? 1 : 3 }}
              />
              {tab === 0 && branding.smtpConfigured && (
                <Box sx={{ textAlign: "right", mb: 2 }}>
                  <Link
                    component={RouterLink}
                    to="/auth/forgot-password"
                    variant="body2"
                    underline="hover"
                  >
                    {t("login.forgotPassword")}
                  </Link>
                </Box>
              )}
              <Button
                fullWidth
                variant="contained"
                type="submit"
                disabled={loading}
                size="large"
              >
                {loading
                  ? "..."
                  : tab === 0 || !registrationAllowed
                    ? t("login.submitLogin")
                    : t("login.submitRegister")}
              </Button>
            </form>
          </>
        )}
          </>
        )}
        </Card>
      </Box>
      {(branding.helpText || branding.helpLink) && (
        <Box
          sx={{
            mt: 3,
            width: 400,
            maxWidth: "90vw",
            textAlign: "center",
            color: "rgba(255,255,255,0.7)",
          }}
        >
          {branding.helpText && (
            <Typography variant="body2" sx={{ whiteSpace: "pre-line" }}>
              {branding.helpText}
            </Typography>
          )}
          {branding.helpLink && (
            <Link
              href={normalizeContactLink(branding.helpLink)}
              variant="body2"
              underline="hover"
              sx={{
                display: "inline-block",
                mt: branding.helpText ? 0.5 : 0,
                color: "#64b5f6",
              }}
            >
              {branding.helpLink}
            </Link>
          )}
        </Box>
      )}
    </Box>
  );
}
