import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useParams } from "react-router";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import MaterialSymbol from "@/components/MaterialSymbol";
import { usePageSubject } from "@/hooks/usePageTitle";
import { useFieldLabel, useOptionLabel, useTypeLabel } from "@/hooks/useResolveLabel";
import type { PublicDiagramLegend } from "@/types";
import { publicGet, publicPost, type ApiError } from "@/features/web-portals/publicApi";
import {
  buildAuthorizeUrl,
  isFramed,
  newNonce,
  parsePublicSsoMessage,
  PUBLIC_SSO_CALLBACK_PATH,
  type PublicSsoConfig,
} from "@/lib/publicSso";
import DiagramViewLegend from "./DiagramViewLegend";
import { colorKey, legendSections, type ViewResolvers, type ViewSource } from "./viewSource";

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
 *
 * SSO-gated diagrams sign in two different ways depending on where the page
 * is rendered (#1126):
 *
 * - **Top-level** (the link opened in a tab): a plain navigation to the IdP,
 *   with one silent `prompt=none` attempt first, like a web portal.
 * - **Inside another site's frame**: the frame must never navigate itself to
 *   the IdP — every provider serves its authorize endpoint with
 *   `X-Frame-Options: DENY`, so the visitor would see the browser's "refused
 *   to display" page and nothing else, ever. The sign-in runs in a popup the
 *   visitor opens by clicking; `/auth/callback` relays the outcome here with
 *   `postMessage`; and *this page* exchanges the code, because the session
 *   cookie is partitioned by the embedding site and a cookie set in the
 *   popup would never reach the frame. See `lib/publicSso.ts`.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _meta = import.meta as any;
const DRAWIO_EMBED_BASE: string =
  _meta.env?.VITE_DRAWIO_EMBED_URL || "/drawio-embed/index.html";

const POPUP_NAME = "turboea_sso";
const POPUP_FEATURES = "popup,width=520,height=680";
/** How often to notice a sign-in popup the visitor closed without finishing. */
const POPUP_CLOSED_POLL_MS = 500;

interface PublicDiagram {
  name: string;
  xml: string;
  /** Key to the colours the picture already shows; null for card-type colours. */
  legend?: PublicDiagramLegend | null;
}

interface DiagramGate {
  access_mode: "public" | "sso";
  name: string;
  sso?: PublicSsoConfig;
}

export default function PublicDiagramPage() {
  const { slug = "" } = useParams();
  const { t } = useTranslation(["diagrams", "common"]);
  const [diagram, setDiagram] = useState<PublicDiagram | null>(null);
  const [gate, setGate] = useState<DiagramGate | null>(null);
  const [locked, setLocked] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  // Sign-in in progress: a popup is open (framed), or the page is about to
  // leave for the IdP (top-level) — either way, no button to click twice.
  const [signingIn, setSigningIn] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);
  // A real refusal from the code exchange (email domain not allowed, email
  // unverified): shown in the gate rather than looping through sign-in.
  const [denied, setDenied] = useState<string | null>(null);
  // The popup flow's state lives in refs, not sessionStorage: the popup opens
  // directly on the IdP so it inherits no storage, two diagrams embedded on
  // one wiki page would share a key, and the message comes back to the very
  // document that started the flow.
  const popupRef = useRef<Window | null>(null);
  const nonceRef = useRef<string | null>(null);
  const framed = useMemo(isFramed, []);

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
            // In a frame there is no silent attempt: it cannot be a popup
            // (no click to open one) and it cannot be a navigation (the IdP
            // refuses to be framed). Straight to the gate.
            if (framed) {
              setLocked(true);
              return;
            }
            // Top-level: one no-UI attempt first, which succeeds outright for
            // a visitor already signed in to the org IdP. The flag is written
            // *before* leaving so an attempt that never comes back — blocked,
            // abandoned — still lands on the sign-in button next time instead
            // of looping.
            const nonce = newNonce();
            const url = g.sso
              ? buildAuthorizeUrl(g.sso, { t: "diagram", slug, nonce, silent: true })
              : null;
            if (url && !sessionStorage.getItem(silentKey)) {
              sessionStorage.setItem(silentKey, "pending");
              sessionStorage.setItem("portal_sso_nonce", nonce);
              setSigningIn(true);
              window.location.href = url;
              return;
            }
            setLocked(true);
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
  }, [slug, silentKey, framed]);

  const handleSignIn = useCallback(() => {
    if (!gate?.sso || !slug) return;
    const nonce = newNonce();
    setDenied(null);

    if (!framed) {
      const url = buildAuthorizeUrl(gate.sso, { t: "diagram", slug, nonce });
      if (!url) return;
      sessionStorage.setItem("portal_sso_nonce", nonce);
      setSigningIn(true);
      window.location.href = url;
      return;
    }

    // Framed: a popup, opened from the click so the browser allows it. The
    // callback page will post the outcome back to us (see `lib/publicSso.ts`).
    const url = buildAuthorizeUrl(gate.sso, { t: "diagram", slug, nonce, popup: true });
    if (!url) return;
    const popup = window.open(url, POPUP_NAME, POPUP_FEATURES);
    if (!popup) {
      setPopupBlocked(true);
      return;
    }
    nonceRef.current = nonce;
    popupRef.current = popup;
    setPopupBlocked(false);
    setSigningIn(true);
  }, [gate, slug, framed]);

  // The popup relays `{code | error, nonce}`; verify it is *our* popup on
  // *our* origin answering *this* flow, then do the exchange from here.
  useEffect(() => {
    if (!framed || !slug) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!popupRef.current || event.source !== popupRef.current) return;
      const msg = parsePublicSsoMessage(event.data);
      if (!msg || msg.t !== "diagram" || msg.slug !== slug) return;
      if (!nonceRef.current || msg.nonce !== nonceRef.current) return;
      // One shot: a replay of the same message must not run a second exchange.
      nonceRef.current = null;
      popupRef.current = null;

      if (msg.error || !msg.code) {
        // The visitor cancelled at the IdP — back to the button.
        setSigningIn(false);
        return;
      }
      (async () => {
        try {
          await publicPost(`/diagrams/public/${slug}/sso/callback`, {
            code: msg.code,
            redirect_uri: `${window.location.origin}${PUBLIC_SSO_CALLBACK_PATH}`,
          });
          const d = await publicGet<PublicDiagram>(`/diagrams/public/${slug}`);
          setDiagram(d);
          setLocked(false);
        } catch (e) {
          setDenied((e as Error).message || t("common:portal.signInError"));
        } finally {
          setSigningIn(false);
        }
      })();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [framed, slug, t]);

  // A popup closed without ever reporting back (the visitor dismissed it)
  // re-enables the button; the relay clears `popupRef` first, so a popup that
  // closed itself after reporting never trips this.
  useEffect(() => {
    if (!framed || !signingIn) return;
    const id = window.setInterval(() => {
      if (popupRef.current && popupRef.current.closed) {
        popupRef.current = null;
        nonceRef.current = null;
        setSigningIn(false);
      }
    }, POPUP_CLOSED_POLL_MS);
    return () => window.clearInterval(id);
  }, [framed, signingIn]);

  // The legend comes from the server as aggregate data (this page can read
  // neither the metamodel nor the cards); only its labels are resolved here,
  // in the visitor's locale, through the same builder the app uses.
  const typeLabel = useTypeLabel();
  const fieldLabel = useFieldLabel();
  const optionLabel = useOptionLabel();
  const legend = useMemo(() => {
    const data = diagram?.legend;
    if (!data) return null;
    const r: ViewResolvers = { typeLabel, fieldLabel, optionLabel, t };
    if (data.kind === "approval_status") {
      const sections = legendSections({ kind: "approval_status" }, [], () => false, r);
      return { sections, coloured: data.coloured };
    }
    const view: ViewSource = {
      kind: "card_fields",
      fields: Object.fromEntries(data.rules.map((rule) => [rule.type_key, rule.field_key])),
    };
    const missing = new Set(
      data.rules
        .filter((rule) => rule.has_missing)
        .map((rule) => colorKey(rule.type_key, rule.field_key, "")),
    );
    const sections = legendSections(
      view,
      data.types,
      (typeKey, fieldKey) => missing.has(colorKey(typeKey, fieldKey, "")),
      r,
    );
    return { sections, coloured: data.coloured };
  }, [diagram, typeLabel, fieldLabel, optionLabel, t]);

  // The browser tab names the diagram. Published pages carry no app chrome,
  // so this is the only thing telling a reader what they are looking at.
  usePageSubject(diagram?.name);

  const viewerSrc = useMemo(() => {
    if (!diagram?.xml) return null;
    // lightbox=1 → DrawIO's native viewer (pan / zoom / fit / page nav),
    // chrome=0   → canvas + the floating zoom toolbar only.
    const params = new URLSearchParams({ lightbox: "1", chrome: "0", nav: "1" });
    return `${DRAWIO_EMBED_BASE}?${params.toString()}#R${encodeURIComponent(diagram.xml)}`;
  }, [diagram]);

  if (loading || (signingIn && !framed)) {
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
    const canSso = Boolean(gate.sso?.authorization_endpoint && gate.sso?.client_id);
    return (
      <CenteredMessage
        icon="lock"
        title={gate.name}
        body={framed ? t("public.locked.bodyFramed") : t("public.locked.body")}
      >
        {denied && (
          <Alert severity="error" sx={{ mt: 1, maxWidth: 480 }}>
            {denied}
          </Alert>
        )}
        {!canSso ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t("public.locked.unavailable")}
          </Typography>
        ) : signingIn ? (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 2 }}>
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">
              {t("public.locked.waiting")}
            </Typography>
          </Box>
        ) : (
          <Button variant="contained" onClick={handleSignIn} sx={{ mt: 2 }}>
            {t("public.locked.signIn", {
              provider: gate.sso?.provider_name || "SSO",
            })}
          </Button>
        )}
        {popupBlocked && (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t("public.locked.popupBlocked")}
            </Typography>
            {/* A new tab is a top-level page: it signs in by navigation and
                shows the diagram there. Its cookie lands in that tab's own
                partition, so this frame stays locked — the copy says so. */}
            <Button
              component="a"
              href={`/embed/diagram/${slug}`}
              target="_blank"
              rel="noopener"
              variant="outlined"
              size="small"
            >
              {t("public.locked.openInNewTab")}
            </Button>
          </>
        )}
      </CenteredMessage>
    );
  }

  return (
    <Box
      sx={{
        height: "100vh",
        width: "100vw",
        overflow: "hidden",
        bgcolor: "#fff",
        position: "relative",
      }}
    >
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
      {viewerSrc && legend && (
        <DiagramViewLegend sections={legend.sections} appliedCount={legend.coloured} />
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
