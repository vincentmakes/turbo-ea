import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import { useTranslation } from "react-i18next";

interface Props {
  onSsoCallback: (code: string, redirectUri: string) => Promise<void>;
}

interface PortalState {
  t: "portal";
  slug: string;
  nonce: string;
  silent?: boolean;
}

function parsePortalState(raw: string | null): PortalState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(atob(raw));
    if (parsed && parsed.t === "portal" && typeof parsed.slug === "string") {
      return parsed as PortalState;
    }
  } catch {
    // Not a portal state — a normal login callback.
  }
  return null;
}

/**
 * Shared OAuth redirect target (/auth/callback). Handles both normal user login
 * and SSO-gated web-portal sign-in — the two are told apart by the OAuth
 * `state`. Reusing one redirect URI means an SSO portal needs no extra IdP
 * registration beyond the login one that already works.
 */
export default function SsoCallback({ onSsoCallback }: Props) {
  const { t } = useTranslation(["auth", "common"]);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  // Set when a portal sign-in is denied for a real reason (e.g. email domain
  // not allowed) — distinct from the silent-auth fallback, which bounces the
  // visitor back to the portal's sign-in button without an error.
  const [portalDenied, setPortalDenied] = useState<{ slug: string; message: string } | null>(null);

  useEffect(() => {
    const code = searchParams.get("code");
    const errorParam = searchParams.get("error");
    const errorDesc = searchParams.get("error_description");
    const portalState = parsePortalState(searchParams.get("state"));

    if (portalState) {
      handlePortalReturn(portalState, code, errorParam);
      return;
    }

    // ---- normal user login callback ----
    if (errorParam) {
      setError(errorDesc || errorParam);
      return;
    }
    if (!code) {
      setError(t("sso.noCodeGeneric"));
      return;
    }
    const redirectUri = `${window.location.origin}/auth/callback`;
    onSsoCallback(code, redirectUri)
      .then(() => navigate("/", { replace: true }))
      .catch((err) => setError(err instanceof Error ? err.message : t("sso.failed")));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handlePortalReturn(state: PortalState, code: string | null, errorParam: string | null) {
    const { slug, nonce } = state;
    const flagKey = `portal_silent_${slug}`;
    const back = () => navigate(`/portal/${slug}`, { replace: true });

    // CSRF: the nonce must match the one stored just before we redirected.
    const storedNonce = sessionStorage.getItem("portal_sso_nonce");
    sessionStorage.removeItem("portal_sso_nonce");
    if (!storedNonce || storedNonce !== nonce) {
      sessionStorage.setItem(flagKey, "failed");
      back();
      return;
    }

    // IdP returned an error (silent attempt needs interaction, or the user
    // cancelled): fall back to the portal's explicit sign-in button.
    if (errorParam || !code) {
      sessionStorage.setItem(flagKey, "failed");
      back();
      return;
    }

    // Exchange the code for an account-less portal-session cookie.
    const redirectUri = `${window.location.origin}/auth/callback`;
    fetch(`/api/v1/web-portals/public/${slug}/sso/callback`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, redirect_uri: redirectUri }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }));
          throw new Error(err.detail || res.statusText);
        }
        sessionStorage.removeItem(flagKey);
        back();
      })
      .catch((e) => {
        // A real denial (domain not allowed / email unverified) — show it
        // rather than looping the visitor back through sign-in.
        sessionStorage.setItem(flagKey, "failed");
        setPortalDenied({
          slug,
          message: e instanceof Error ? e.message : t("common:portal.signInError"),
        });
      });
  }

  if (portalDenied) {
    return (
      <Box
        sx={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: "#1a1a2e",
          gap: 2,
          px: 3,
        }}
      >
        <Alert severity="error" sx={{ maxWidth: 500 }}>
          {portalDenied.message}
        </Alert>
        <Button
          variant="contained"
          onClick={() => navigate(`/portal/${portalDenied.slug}`, { replace: true })}
          sx={{ mt: 2 }}
        >
          {t("common:actions.retry")}
        </Button>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "#1a1a2e",
        gap: 2,
      }}
    >
      {error ? (
        <>
          <Alert severity="error" sx={{ maxWidth: 500 }}>
            {error}
          </Alert>
          <Button
            variant="contained"
            onClick={() => navigate("/", { replace: true })}
            sx={{ mt: 2 }}
          >
            {t("sso.backToLogin")}
          </Button>
        </>
      ) : (
        <>
          <CircularProgress sx={{ color: "#64b5f6" }} />
          <Typography color="#fff">{t("sso.completing")}</Typography>
        </>
      )}
    </Box>
  );
}
