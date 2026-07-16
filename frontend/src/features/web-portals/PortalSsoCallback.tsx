import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import { useTranslation } from "react-i18next";

const BASE = "/api/v1";

/**
 * OAuth redirect target for SSO-gated web portals. Reads the `code` + `state`
 * returned by the IdP, validates the CSRF nonce stashed in sessionStorage,
 * exchanges the code for an account-less portal session cookie via
 * POST /web-portals/public/{slug}/sso/callback, then returns to the portal.
 */
export default function PortalSsoCallback() {
  const { t } = useTranslation("common");
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [slug, setSlug] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get("code");
    const errorParam = searchParams.get("error");
    const errorDesc = searchParams.get("error_description");
    const state = searchParams.get("state");

    if (errorParam) {
      setError(errorDesc || errorParam);
      return;
    }
    if (!code || !state) {
      setError(t("portal.signInError"));
      return;
    }
    // CSRF: the state we sent must match the one we stored before redirecting.
    const stored = sessionStorage.getItem("portal_sso_state");
    if (!stored || stored !== state) {
      setError(t("portal.signInError"));
      return;
    }
    sessionStorage.removeItem("portal_sso_state");

    let parsedSlug: string;
    try {
      parsedSlug = JSON.parse(atob(state)).slug;
    } catch {
      setError(t("portal.signInError"));
      return;
    }
    if (!parsedSlug) {
      setError(t("portal.signInError"));
      return;
    }
    setSlug(parsedSlug);

    const redirectUri = `${window.location.origin}/portal/sso-callback`;
    (async () => {
      try {
        const res = await fetch(
          `${BASE}/web-portals/public/${parsedSlug}/sso/callback`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code, redirect_uri: redirectUri }),
          },
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }));
          throw new Error(err.detail || res.statusText);
        }
        navigate(`/portal/${parsedSlug}`, { replace: true });
      } catch (e) {
        setError(e instanceof Error ? e.message : t("portal.signInError"));
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      {error ? (
        <>
          <Alert severity="error" sx={{ maxWidth: 500 }}>
            {error}
          </Alert>
          {slug && (
            <Button
              variant="contained"
              onClick={() => navigate(`/portal/${slug}`, { replace: true })}
              sx={{ mt: 2 }}
            >
              {t("actions.retry")}
            </Button>
          )}
        </>
      ) : (
        <>
          <CircularProgress sx={{ color: "#64b5f6" }} />
          <Typography color="#fff">{t("portal.signingIn")}</Typography>
        </>
      )}
    </Box>
  );
}
