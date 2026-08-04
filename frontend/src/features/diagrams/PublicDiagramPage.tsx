import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams } from "react-router";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import MaterialSymbol from "@/components/MaterialSymbol";

/**
 * The published, read-only render of a diagram — the page that gets iframed
 * into Confluence and friends (discussion #905).
 *
 * Deliberately austere: no app chrome, no navigation, no card drill-through.
 * It fetches `{name, xml}` from the public endpoint (which has already
 * stripped every Turbo EA attribute server-side) and hands the XML to DrawIO's
 * own lightbox viewer, which brings pan, zoom, fit and multi-page navigation
 * with it.
 *
 * The viewer is loaded from `/drawio-embed/` rather than `/drawio/`. Both serve
 * the same files, but only the former carries the relaxed `frame-ancestors`
 * that lets it render inside a third-party page — CSP checks *every* ancestor,
 * so the app's own `/drawio/` staying locked to 'self' is what keeps the
 * authenticated editor un-framable while this page is embeddable.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _meta = import.meta as any;
const DRAWIO_EMBED_BASE: string =
  _meta.env?.VITE_DRAWIO_EMBED_URL || "/drawio-embed/index.html";

interface PublicDiagram {
  name: string;
  xml: string;
}

interface DiagramGate {
  access_mode: "public" | "sso";
  name: string;
  sso?: {
    provider: string;
    provider_name: string;
    client_id: string;
    authorization_endpoint: string;
    scopes: string;
    extra_auth_params?: Record<string, string>;
  };
}

type ApiError = Error & { status?: number };

async function publicGet<T>(path: string): Promise<T> {
  // credentials: "same-origin" so the httpOnly session cookie reaches the
  // path-scoped public endpoints of an SSO-gated diagram.
  const res = await fetch(`/api/v1${path}`, { credentials: "same-origin" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    const e = new Error(err.detail || res.statusText) as ApiError;
    e.status = res.status;
    throw e;
  }
  return res.json();
}

/** Send the visitor to the IdP. `silent` (prompt=none) completes without any
 *  UI when they already have a session, which matters for an embed: an iframe
 *  that suddenly renders a sign-in form inside a wiki page is jarring. */
function doSsoRedirect(
  sso: NonNullable<DiagramGate["sso"]>,
  slug: string,
  silent: boolean,
): void {
  if (!sso.authorization_endpoint || !sso.client_id) return;
  const nonce =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : String(Date.now());
  sessionStorage.setItem("portal_sso_nonce", nonce);
  const state = btoa(JSON.stringify({ t: "diagram", slug, nonce, silent }));
  const params = new URLSearchParams({
    client_id: sso.client_id,
    response_type: "code",
    redirect_uri: `${window.location.origin}/auth/callback`,
    scope: sso.scopes || "openid email profile",
    response_mode: "query",
    state,
  });
  if (silent) params.set("prompt", "none");
  if (sso.extra_auth_params) {
    Object.entries(sso.extra_auth_params).forEach(([k, v]) => params.set(k, v));
  }
  window.location.href = `${sso.authorization_endpoint}?${params.toString()}`;
}

export default function PublicDiagramPage() {
  const { slug = "" } = useParams();
  const { t } = useTranslation(["diagrams", "common"]);
  const [diagram, setDiagram] = useState<PublicDiagram | null>(null);
  const [gate, setGate] = useState<DiagramGate | null>(null);
  const [locked, setLocked] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  const silentKey = `portal_silent_diagram_${slug}`;

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;

    (async () => {
      try {
        // The gate is always public: it says which access mode applies and,
        // for SSO, how to start the IdP redirect.
        const g = await publicGet<DiagramGate>(`/diagrams/public/${slug}/gate`);
        if (cancelled) return;
        setGate(g);

        try {
          const d = await publicGet<PublicDiagram>(`/diagrams/public/${slug}`);
          if (cancelled) return;
          setDiagram(d);
          sessionStorage.removeItem(silentKey);
        } catch (e) {
          if (cancelled) return;
          const status = (e as ApiError).status;
          if (g.access_mode === "sso" && status === 401) {
            const canSso = Boolean(g.sso?.authorization_endpoint && g.sso?.client_id);
            const alreadyTried = sessionStorage.getItem(silentKey) === "failed";
            if (canSso && !alreadyTried) {
              // One no-UI attempt first — succeeds outright for a visitor
              // already signed in to the org IdP.
              doSsoRedirect(g.sso!, slug, true);
              return;
            }
            setLocked(true);
          } else if (status === 404) {
            setNotFound(true);
          } else {
            setNotFound(true);
          }
        }
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug, silentKey]);

  const handleSignIn = useCallback(() => {
    if (gate?.sso && slug) doSsoRedirect(gate.sso, slug, false);
  }, [gate, slug]);

  const viewerSrc = useMemo(() => {
    if (!diagram?.xml) return null;
    // lightbox=1 → DrawIO's native viewer (pan / zoom / fit / page nav),
    // chrome=0   → canvas + the floating zoom toolbar only.
    const params = new URLSearchParams({ lightbox: "1", chrome: "0", nav: "1" });
    return `${DRAWIO_EMBED_BASE}?${params.toString()}#R${encodeURIComponent(diagram.xml)}`;
  }, [diagram]);

  useEffect(() => {
    if (diagram?.name) document.title = diagram.name;
  }, [diagram]);

  if (loading) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (notFound) {
    return (
      <CenteredMessage
        icon="link_off"
        title={t("public.notFound.title")}
        body={t("public.notFound.body")}
      />
    );
  }

  if (locked && gate) {
    return (
      <CenteredMessage icon="lock" title={gate.name} body={t("public.locked.body")}>
        <Button variant="contained" onClick={handleSignIn} sx={{ mt: 2 }}>
          {t("public.locked.signIn", {
            provider: gate.sso?.provider_name || "SSO",
          })}
        </Button>
      </CenteredMessage>
    );
  }

  return (
    <Box sx={{ height: "100vh", width: "100vw", overflow: "hidden", bgcolor: "#fff" }}>
      {viewerSrc ? (
        <iframe
          title={diagram?.name || "diagram"}
          src={viewerSrc}
          style={{ border: "none", width: "100%", height: "100%", display: "block" }}
        />
      ) : (
        <CenteredMessage
          icon="image_not_supported"
          title={diagram?.name || ""}
          body={t("public.empty")}
        />
      )}
    </Box>
  );
}

function CenteredMessage({
  icon,
  title,
  body,
  children,
}: {
  icon: string;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <Box
      sx={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 1,
        px: 3,
        textAlign: "center",
      }}
    >
      <MaterialSymbol icon={icon} size={40} color="text.disabled" />
      <Typography variant="h6">{title}</Typography>
      <Typography variant="body2" color="text.secondary">
        {body}
      </Typography>
      {children}
    </Box>
  );
}
