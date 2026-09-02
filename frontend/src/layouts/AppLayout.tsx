import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from "react";
import { useNavigate, useLocation, Link as RouterLink } from "react-router";
import Box from "@mui/material/Box";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Badge from "@mui/material/Badge";
import Button from "@mui/material/Button";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Alert from "@mui/material/Alert";
import Divider from "@mui/material/Divider";
import Snackbar from "@mui/material/Snackbar";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Drawer from "@mui/material/Drawer";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import Collapse from "@mui/material/Collapse";
import Tooltip from "@mui/material/Tooltip";
import useMediaQuery from "@mui/material/useMediaQuery";
import { alpha } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import NotificationBell from "@/components/NotificationBell";
import NotificationPreferencesDialog from "@/components/NotificationPreferencesDialog";
import SponsorshipDialog from "@/components/SponsorshipDialog";
import { brand } from "@/theme";
import { api, auth, setToken } from "@/api/client";
import { useAuthContext } from "@/hooks/AuthContext";
import ImpersonateRoleDialog from "@/features/admin/ImpersonateRoleDialog";
import { useEventStream } from "@/hooks/useEventStream";
import { useBpmEnabled } from "@/hooks/useBpmEnabled";
import { useGrcEnabled } from "@/hooks/useGrcEnabled";
import { useSponsorButtonEnabled } from "@/hooks/useSponsorButtonEnabled";
import { usePpmEnabled } from "@/hooks/usePpmEnabled";
import { useTurboLensReady } from "@/hooks/useTurboLensReady";
import { useThemeMode } from "@/hooks/useThemeMode";
import { useAppTitle } from "@/hooks/useAppTitle";
import { useNavbarStyle } from "@/hooks/useNavbarStyle";
import { SUPPORTED_LOCALES, LOCALE_LABELS, type SupportedLocale } from "@/i18n";
import { useEnabledLocales } from "@/hooks/useEnabledLocales";
import SearchDialog from "@/components/SearchDialog";
import {
  EXTENSION_NAV_GROUPS,
  getExtensionRoutesForGroup,
  useExtensionUI,
} from "@/lib/extensionHost";
import CreateCardDialog from "@/components/CreateCardDialog";
import {
  ADMIN_ITEM_DEFS,
  NAV_ITEM_DEFS,
  resolveNavPlacement,
  type NavItemDef,
} from "@/layouts/navItems";
import { hasPermission } from "@/components/RequirePermission";
import { canAccessPath, permissionForPath } from "@/lib/routePermissions";
import type { BadgeCounts, Card } from "@/types";

interface NavItem {
  label: string;
  icon: string;
  path?: string;
  children?: { label: string; icon: string; path: string; permission?: string | string[] }[];
  permission?: string | string[];
}

interface PermissionMap {
  [key: string]: boolean;
}

interface Props {
  children: ReactNode;
  user: { id: string; display_name: string; email: string; role: string; permissions?: PermissionMap; impersonated_role?: string | null; impersonated_role_label?: string | null };
  onLogout: () => void;
}

export default function AppLayout({ children, user, onLogout }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, i18n } = useTranslation("nav");
  const isMobile = useMediaQuery("(max-width:767px)");
  const isCompact = useMediaQuery("(max-width:1023px)");
  const isCondensed = useMediaQuery("(max-width:1279px)");
  const { bpmEnabled } = useBpmEnabled();
  const { ppmEnabled } = usePpmEnabled();
  const { grcEnabled } = useGrcEnabled();
  const { sponsorButtonEnabled } = useSponsorButtonEnabled();
  const { turboLensReady } = useTurboLensReady();
  const { enabledLocales } = useEnabledLocales();
  const { mode, toggleMode } = useThemeMode();
  const appTitle = useAppTitle();
  const { bg: navBg, fg: navFg } = useNavbarStyle();
  // Derived translucent tints — one source (the configured text color) so the
  // whole navbar/drawer palette follows the admin-chosen colors.
  const nav = useMemo(
    () => ({
      bg: navBg,
      fg: navFg,
      fgMuted: alpha(navFg, 0.7), // inactive nav items
      fgSubtle: alpha(navFg, 0.6), // drawer search icon
      fgFaint: alpha(navFg, 0.5), // secondary text (drawer email, search placeholder)
      activeBg: alpha(navFg, 0.12), // active pill
      hoverBg: alpha(navFg, 0.1), // hover
      divider: alpha(navFg, 0.1), // drawer dividers
      fieldBg: alpha(navFg, 0.08), // drawer search field
    }),
    [navBg, navFg],
  );
  const uiExtensions = useExtensionUI();

  // License-attention banner: extension admins see when an installed
  // extension has entered its grace window or expired, driving the
  // air-gapped renewal loop (request a new license file by email).
  const [licenseAttention, setLicenseAttention] = useState<
    { key: string; entitlement_state: string }[]
  >([]);
  const canManageExtensions = !!user.permissions?.["*"] || !!user.permissions?.["admin.manage_extensions"];
  useEffect(() => {
    if (!canManageExtensions) return;
    let cancelled = false;
    api
      .get<{ key: string; version: string; entitlement_state: string }[]>("/extensions/status")
      .then((rows) => {
        if (cancelled) return;
        setLicenseAttention(
          rows.filter((r) => r.entitlement_state === "grace" || r.entitlement_state === "expired"),
        );
      })
      .catch(() => {
        /* endpoint absent or transient failure — no banner */
      });
    return () => {
      cancelled = true;
    };
  }, [canManageExtensions]);

  // Permission check helper
  const can = useCallback(
    (permission: string): boolean => {
      const perms = user.permissions;
      if (!perms) return false; // Fail-closed: deny if permissions haven't loaded
      if (perms["*"]) return true;
      return !!perms[permission];
    },
    [user.permissions]
  );

  // Resolve nav item labels via i18n and filter based on BPM/PPM/TurboLens/permissions
  const navItems = useMemo(() => {
    let items = NAV_ITEM_DEFS as NavItemDef[];
    if (!bpmEnabled) items = items.filter((item) => item.labelKey !== "bpm");
    if (!ppmEnabled) items = items.filter((item) => item.labelKey !== "ppm");
    if (!grcEnabled) items = items.filter((item) => item.labelKey !== "grc");

    // When PPM is disabled, EA Delivery has no parent tab to live under —
    // promote it to a top-level nav item, sitting in PPM's old slot (between
    // BPM and Diagrams) so the surface stays reachable from the top menu.
    if (!ppmEnabled) {
      const eaDeliveryItem: NavItemDef = {
        labelKey: "delivery",
        icon: "architecture",
        path: "/reports/ea-delivery",
      };
      const diagramsIdx = items.findIndex((i) => i.labelKey === "diagrams");
      const insertAt = diagramsIdx >= 0 ? diagramsIdx : items.length;
      items = [...items.slice(0, insertAt), eaDeliveryItem, ...items.slice(insertAt)];
    }

    // Append single TurboLens entry to Reports dropdown when AI is configured
    if (turboLensReady && can("turbolens.view")) {
      items = items.map((item) =>
        item.labelKey === "reports"
          ? {
              ...item,
              children: [
                ...(item.children || []),
                { labelKey: "turbolens", icon: "psychology", path: "/turbolens" },
              ],
            }
          : item,
      );
    }

    // Delegates to the shared helper rather than re-deriving the semantics —
    // OR over a list, wildcard, fail-closed — so the nav can never drift from
    // what RouteGuard enforces.
    const hasPerm = (perm?: string | string[]) =>
      !perm || hasPermission(user.permissions, perm);

    // A nav entry that points at a route inherits that route's permission from
    // ROUTE_PERMISSIONS, so the menu and the router can never disagree. An
    // explicit `permission` still wins — that is how the pathless Reports group
    // and extension-contributed entries carry their own.
    const hasNavPerm = (def: { path?: string; permission?: string | string[] }) => {
      if (def.permission) return hasPerm(def.permission);
      if (def.path) return hasPerm(permissionForPath(def.path));
      return true;
    };

    // Inject extension routes that requested a core nav group as children of
    // that group's menu (desktop dropdown + mobile drawer both read `children`).
    // Reports places them before the "saved" entry so they sit with the core
    // reports; other groups append. Labels are plain strings from the bundle,
    // so t() falls through to them.
    //
    // A group whose nav item is absent for this user — the module is off, or
    // they lack its permission — would otherwise swallow the route entirely, so
    // those fall back to a TOP-LEVEL entry: a licensed extension page stays
    // reachable whatever a core module toggle says.
    const groupedFallbacks: NavItemDef[] = [];
    for (const group of EXTENSION_NAV_GROUPS) {
      const groupRoutes = getExtensionRoutesForGroup(group).map(({ route }) => ({
        labelKey: route.label,
        icon: route.icon,
        path: route.path,
        permission: route.permission,
      }));
      if (!groupRoutes.length) continue;
      const host = items.find((item) => item.labelKey === group);
      // The permission check matters here, not only below: injecting into a
      // host that the final filter then drops would swallow the route silently.
      // Via hasNavPerm, so a core host whose permission is derived from
      // ROUTE_PERMISSIONS rather than declared inline is still checked.
      if (!host || !hasNavPerm(host)) {
        groupedFallbacks.push(...groupRoutes);
        continue;
      }
      items = items.map((item) => {
        if (item.labelKey !== group) return item;
        const kids = [...(item.children || [])];
        // A group that is itself a page (GRC) turns into a dropdown the moment
        // it gains children, so seed its own link as the first entry or the
        // page becomes unreachable from the nav.
        if (item.path && !kids.some((c) => c.path === item.path)) {
          kids.unshift({ labelKey: item.labelKey, icon: item.icon, path: item.path });
        }
        const savedIdx = kids.findIndex((c) => c.path === "/reports/saved");
        kids.splice(savedIdx >= 0 ? savedIdx : kids.length, 0, ...groupRoutes);
        return { ...item, children: kids };
      });
    }
    items = [...items, ...groupedFallbacks];

    // Append pages contributed by installed UI extensions as top-level entries.
    // Routes that requested a core nav group (e.g. Reports, handled above) are
    // skipped here; a route with an unrecognised navGroup surfaces nowhere in
    // the nav (still reachable by URL). Labels are plain strings from the
    // extension itself, so t() falls through to them.
    for (const { plugin } of uiExtensions) {
      for (const route of plugin.routes ?? []) {
        if (route.navGroup) continue;
        const entry: NavItemDef = {
          labelKey: route.label,
          icon: route.icon,
          path: route.path,
          permission: route.permission,
        };
        // The index is recomputed per route, against the list AS IT NOW
        // STANDS. That is what keeps two routes sharing one placement in
        // registration order: the first lands before the anchor, the second
        // then lands before the anchor and after the first, rather than both
        // resolving to the same stale index and coming out reversed.
        const at = resolveNavPlacement(
          items.map((item) => item.labelKey),
          route.navPlacement,
        );
        items = [...items.slice(0, at), entry, ...items.slice(at)];
      }
    }

    const resolve = (def: NavItemDef): NavItem => {
      const children = def.children
        ?.filter((c) => hasNavPerm(c))
        .map((c) => ({ ...c, label: t(c.labelKey) }));
      return {
        ...def,
        label: t(def.labelKey),
        // Normalise an empty list to undefined: a group host whose children are
        // all filtered out (or that has none installed) renders as a plain link
        // rather than a dropdown that opens onto nothing.
        children: children && children.length ? children : undefined,
      };
    };

    return items.filter((item) => hasNavPerm(item)).map(resolve);
  }, [bpmEnabled, ppmEnabled, grcEnabled, turboLensReady, uiExtensions, can, user.permissions, t]);

  // Resolve admin item labels via i18n and filter based on permissions
  const adminItems = useMemo(() => {
    return ADMIN_ITEM_DEFS.filter((item) =>
      canAccessPath(user.permissions, item.path ?? "/"),
    ).map((def) => ({ ...def, label: t(def.labelKey) }));
  }, [user.permissions, t]);

  // Should the admin section be shown at all?
  const showAdmin = adminItems.length > 0;

  // A deep link the user asked for before signing in, that their role cannot
  // actually open — SsoCallback lands them here and leaves the path in router
  // state. Copied into local state so the message survives clearing that
  // state, and cleared immediately so a refresh cannot resurrect it.
  const [deniedPath, setDeniedPath] = useState<string | null>(null);
  const deniedFromState = (location.state as { deniedPath?: string } | null)?.deniedPath;
  useEffect(() => {
    if (!deniedFromState) return;
    setDeniedPath(deniedFromState);
    navigate(location.pathname + location.search, { replace: true, state: null });
  }, [deniedFromState, location.pathname, location.search, navigate]);

  // Reference Catalogue links, gated by the same table as their routes.
  const canOpen = useCallback(
    (path: string) => canAccessPath(user.permissions, path),
    [user.permissions],
  );
  const canOpenAnyCatalogue =
    canOpen("/capability-catalogue") ||
    canOpen("/process-catalogue") ||
    canOpen("/value-stream-catalogue") ||
    canOpen("/principles-catalogue");

  const [userMenu, setUserMenu] = useState<HTMLElement | null>(null);
  // Anchor AND which group opened it — one shared anchor rendered the first
  // group-with-children's items under whichever group you clicked.
  const [navMenu, setNavMenu] = useState<{ el: HTMLElement; group: string } | null>(null);
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [impersonateDialogOpen, setImpersonateDialogOpen] = useState(false);
  const [stopImpersonatingBusy, setStopImpersonatingBusy] = useState(false);
  const { refreshUser } = useAuthContext();
  const handleStopImpersonating = useCallback(async () => {
    if (stopImpersonatingBusy) return;
    setStopImpersonatingBusy(true);
    try {
      const { access_token } = await auth.stopImpersonating();
      setToken(access_token);
      await refreshUser();
    } catch {
      // Best-effort — refreshUser will surface the real state on next poll.
    } finally {
      setStopImpersonatingBusy(false);
    }
  }, [refreshUser, stopImpersonatingBusy]);
  // Inline Create dialog mounted in the layout so the Create button works
  // from any route without navigating to /inventory first.
  const [createOpen, setCreateOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Keyed by group label — a single boolean expanded every group together.
  const [drawerGroupOpen, setDrawerGroupOpen] = useState<Record<string, boolean>>({});
  const [drawerAdminOpen, setDrawerAdminOpen] = useState(false);
  const [notifPrefsOpen, setNotifPrefsOpen] = useState(false);
  const [sponsorshipOpen, setSponsorshipOpen] = useState(false);
  const [langMenu, setLangMenu] = useState<HTMLElement | null>(null);
  // Reference Catalogues menu section starts collapsed by default — there are
  // now three catalogue links (capability, process, value stream) plus
  // principles, and most users only visit the section occasionally. Open
  // state is persisted in localStorage so frequent users only need to expand
  // once.
  const [refCatExpanded, setRefCatExpanded] = useState<boolean>(() => {
    try {
      return localStorage.getItem("refCatExpanded") === "true";
    } catch {
      return false;
    }
  });
  const toggleRefCat = useCallback(() => {
    setRefCatExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("refCatExpanded", String(next));
      } catch {
        // localStorage may be disabled — best-effort persistence
      }
      return next;
    });
  }, []);
  const [badgeCounts, setBadgeCounts] = useState<BadgeCounts>({ open_todos: 0, pending_surveys: 0 });

  const handleLanguageChange = useCallback(
    async (locale: SupportedLocale) => {
      setLangMenu(null);
      setUserMenu(null);
      i18n.changeLanguage(locale);
      try {
        await api.patch(`/users/${user.id}`, { locale });
      } catch {
        // best-effort persistence
      }
    },
    [i18n, user.id],
  );

  const fetchBadgeCounts = useCallback(async () => {
    try {
      const res = await api.get<BadgeCounts>("/notifications/badge-counts");
      setBadgeCounts(res);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchBadgeCounts();
  }, [fetchBadgeCounts]);

  // Debounced badge refresh — coalesces rapid SSE events into one API call
  const badgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedBadgeRefresh = useCallback(() => {
    if (badgeTimerRef.current) clearTimeout(badgeTimerRef.current);
    badgeTimerRef.current = setTimeout(() => fetchBadgeCounts(), 500);
  }, [fetchBadgeCounts]);

  // Refresh badge counts on relevant real-time events (debounced)
  useEventStream(
    useCallback(
      (event: Record<string, unknown>) => {
        const evt = event.event as string | undefined;
        if (
          evt === "notification.created" ||
          evt === "todo.created" ||
          evt === "todo.updated" ||
          evt === "todo.deleted" ||
          evt === "survey.sent" ||
          evt === "survey.responded"
        ) {
          debouncedBadgeRefresh();
        }
      },
      [debouncedBadgeRefresh],
    ),
    // Same reasoning as the bell: events missed while the stream was down are
    // gone, so re-read the counts on reconnect instead of waiting for the next
    // navigation.
    debouncedBadgeRefresh,
  );

  // Also refresh when navigating (covers completing a todo, responding to a survey)
  useEffect(() => {
    fetchBadgeCounts();
  }, [location.pathname, fetchBadgeCounts]);

  // Global Cmd/Ctrl+K keyboard shortcut to open search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchDialogOpen(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const isActive = (path?: string) =>
    !!(path && (location.pathname === path || (path !== "/" && location.pathname.startsWith(path))));
  const isGroupActive = (children?: { path: string }[]) =>
    !!children?.some((c) => location.pathname === c.path);

  const navBtnSx = (active: boolean) => ({
    color: active ? nav.fg : nav.fgMuted,
    textTransform: "none" as const,
    fontWeight: active ? 700 : 500,
    fontSize: isCondensed ? "0.75rem" : "0.85rem",
    minWidth: 0,
    px: isCondensed ? 0.75 : 1.5,
    whiteSpace: "nowrap" as const,
    borderRadius: 1,
    bgcolor: active ? nav.activeBg : "transparent",
    "&:hover": { bgcolor: nav.hoverBg },
  });

  const drawerNav = (path: string) => {
    navigate(path);
    setDrawerOpen(false);
  };

  const hasBadge = (path?: string) =>
    path === "/todos" && (badgeCounts.open_todos > 0 || badgeCounts.pending_surveys > 0);

  // ── Mobile drawer ───────────────────────────────────────────────────────

  const renderDrawer = () => (
    <Drawer
      anchor="left"
      open={drawerOpen}
      onClose={() => setDrawerOpen(false)}
      PaperProps={{ sx: { width: 280, bgcolor: nav.bg } }}
    >
      {/* Brand header */}
      <Box
        sx={{ display: "flex", alignItems: "center", p: 2, cursor: "pointer" }}
        onClick={() => drawerNav("/")}
      >
        <img
          src="/api/v1/settings/logo"
          alt={appTitle}
          style={{ height: 45, maxWidth: 200, objectFit: "contain" }}
        />
      </Box>
      <Divider sx={{ borderColor: nav.divider }} />

      {/* Search button */}
      <Box sx={{ px: 2, py: 1.5 }}>
        <ListItemButton
          onClick={() => {
            setDrawerOpen(false);
            setSearchDialogOpen(true);
          }}
          sx={{
            borderRadius: 1,
            bgcolor: nav.fieldBg,
            color: nav.fgFaint,
            py: 0.75,
            px: 1.5,
            gap: 1,
          }}
        >
          <MaterialSymbol icon="search" size={20} color={nav.fgSubtle} />
          <Typography variant="body2" sx={{ flex: 1 }}>
            {t("search.placeholder")}
          </Typography>
        </ListItemButton>
      </Box>

      <List sx={{ px: 1 }}>
        {navItems.map((item) =>
          item.children ? (
            <Box key={item.label}>
              <ListItemButton
                onClick={() =>
                  setDrawerGroupOpen((p) => ({ ...p, [item.label]: !p[item.label] }))
                }
                sx={{
                  borderRadius: 1,
                  color: isGroupActive(item.children) ? nav.fg : nav.fgMuted,
                  bgcolor: isGroupActive(item.children) ? nav.activeBg : "transparent",
                }}
              >
                <ListItemIcon sx={{ minWidth: 36, color: "inherit" }}>
                  <MaterialSymbol icon={item.icon} size={20} color="inherit" />
                </ListItemIcon>
                <ListItemText primary={item.label} />
                <MaterialSymbol
                  icon={drawerGroupOpen[item.label] ? "expand_less" : "expand_more"}
                  size={18}
                  color="inherit"
                />
              </ListItemButton>
              <Collapse in={!!drawerGroupOpen[item.label]}>
                <List disablePadding sx={{ pl: 2 }}>
                  {item.children.map((child) => (
                    <ListItemButton
                      key={child.path}
                      selected={isActive(child.path)}
                      onClick={() => drawerNav(child.path)}
                      sx={{ borderRadius: 1, color: nav.fgMuted, "&.Mui-selected": { color: nav.fg, bgcolor: nav.activeBg } }}
                    >
                      <ListItemIcon sx={{ minWidth: 32, color: "inherit" }}>
                        <MaterialSymbol icon={child.icon} size={18} color="inherit" />
                      </ListItemIcon>
                      <ListItemText primary={child.label} primaryTypographyProps={{ fontSize: "0.85rem" }} />
                    </ListItemButton>
                  ))}
                </List>
              </Collapse>
            </Box>
          ) : (
            <ListItemButton
              key={item.label}
              selected={isActive(item.path)}
              onClick={() => item.path && drawerNav(item.path)}
              sx={{
                borderRadius: 1,
                color: isActive(item.path) ? nav.fg : nav.fgMuted,
                "&.Mui-selected": { bgcolor: nav.activeBg },
              }}
            >
              <ListItemIcon sx={{ minWidth: 36, color: "inherit" }}>
                <Badge color="error" variant="dot" invisible={!hasBadge(item.path)}>
                  <MaterialSymbol icon={item.icon} size={20} color="inherit" />
                </Badge>
              </ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          ),
        )}

        {showAdmin && (
          <>
            <Divider sx={{ my: 1, borderColor: nav.divider }} />

            {/* Admin section */}
            <ListItemButton
              onClick={() => setDrawerAdminOpen((p) => !p)}
              sx={{
                borderRadius: 1,
                color: isGroupActive(adminItems as { path: string }[]) ? nav.fg : nav.fgMuted,
              }}
            >
              <ListItemIcon sx={{ minWidth: 36, color: "inherit" }}>
                <MaterialSymbol icon="admin_panel_settings" size={20} color="inherit" />
              </ListItemIcon>
              <ListItemText primary={t("admin")} />
              <MaterialSymbol
                icon={drawerAdminOpen ? "expand_less" : "expand_more"}
                size={18}
                color="inherit"
              />
            </ListItemButton>
            <Collapse in={drawerAdminOpen}>
              <List disablePadding sx={{ pl: 2 }}>
                {adminItems.map((item) => (
                  <ListItemButton
                    key={item.path}
                    selected={isActive(item.path)}
                    onClick={() => item.path && drawerNav(item.path)}
                    sx={{ borderRadius: 1, color: nav.fgMuted, "&.Mui-selected": { color: nav.fg, bgcolor: nav.activeBg } }}
                  >
                    <ListItemIcon sx={{ minWidth: 32, color: "inherit" }}>
                      <MaterialSymbol icon={item.icon} size={18} color="inherit" />
                    </ListItemIcon>
                    <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: "0.85rem" }} />
                  </ListItemButton>
                ))}
              </List>
            </Collapse>
          </>
        )}

        {can("inventory.create") && (
          <>
            <Divider sx={{ my: 1, borderColor: nav.divider }} />

            {/* Create */}
            <ListItemButton
              onClick={() => {
                setDrawerOpen(false);
                setCreateOpen(true);
              }}
              sx={{ borderRadius: 1, color: nav.fgMuted }}
            >
              <ListItemIcon sx={{ minWidth: 36, color: "inherit" }}>
                <MaterialSymbol icon="add" size={20} color="inherit" />
              </ListItemIcon>
              <ListItemText primary={t("createCard")} />
            </ListItemButton>
          </>
        )}
      </List>

      {/* User info at bottom */}
      <Box sx={{ mt: "auto", p: 2 }}>
        <Divider sx={{ mb: 1.5, borderColor: nav.divider }} />
        <Typography variant="body2" sx={{ color: nav.fg, fontWeight: 600 }}>
          {user.display_name}
        </Typography>
        <Typography variant="caption" sx={{ color: nav.fgFaint }}>
          {user.email}
        </Typography>
        <Button
          fullWidth
          size="small"
          sx={{ mt: 1, color: nav.fgMuted, textTransform: "none", justifyContent: "flex-start" }}
          startIcon={<MaterialSymbol icon="logout" size={18} />}
          onClick={() => { setDrawerOpen(false); onLogout(); }}
        >
          {t("common:actions.logout")}
        </Button>
      </Box>
    </Drawer>
  );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <AppBar
        position="fixed"
        sx={{ bgcolor: nav.bg }}
        elevation={0}
      >
        <Toolbar sx={{ gap: 0.5 }}>
          {/* Hamburger (mobile) */}
          {isMobile && (
            <IconButton
              sx={{ color: nav.fg, mr: 0.5 }}
              onClick={() => setDrawerOpen(true)}
            >
              <MaterialSymbol icon="menu" size={24} />
            </IconButton>
          )}

          {/* Brand */}
          <Box
            component={RouterLink}
            to="/"
            sx={{
              display: "flex",
              alignItems: "center",
              mr: isMobile ? 0 : isCondensed ? 1.5 : 3,
              cursor: "pointer",
              textDecoration: "none",
            }}
          >
            <img
              src="/api/v1/settings/logo"
              alt={appTitle}
              style={{ height: 45, maxWidth: 200, objectFit: "contain" }}
            />
          </Box>

          {/* Desktop / tablet nav items */}
          {!isMobile && (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                // Shrinkable + scrollable: with enough installed extensions the
                // nav used to push the notification bell and user menu off the
                // right edge (everything else in the toolbar is flexShrink: 0).
                minWidth: 0,
                overflowX: "auto",
                scrollbarWidth: "none",
                "&::-webkit-scrollbar": { display: "none" },
              }}
            >
              {navItems.map((item) =>
                item.children ? (
                  isCompact ? (
                    <Tooltip key={item.label} title={item.label}>
                      <IconButton
                        size="small"
                        sx={{ color: isGroupActive(item.children) ? nav.fg : nav.fgMuted }}
                        onClick={(e) => setNavMenu({ el: e.currentTarget, group: item.label })}
                      >
                        <MaterialSymbol icon={item.icon} size={20} />
                      </IconButton>
                    </Tooltip>
                  ) : (
                    <Button
                      key={item.label}
                      size="small"
                      startIcon={<MaterialSymbol icon={item.icon} size={18} />}
                      endIcon={<MaterialSymbol icon="expand_more" size={16} />}
                      sx={navBtnSx(isGroupActive(item.children))}
                      onClick={(e) => setNavMenu({ el: e.currentTarget, group: item.label })}
                    >
                      {item.label}
                    </Button>
                  )
                ) : isCompact ? (
                  <Tooltip key={item.label} title={item.label}>
                    <IconButton
                      size="small"
                      sx={{
                        color: isActive(item.path) ? nav.fg : nav.fgMuted,
                        bgcolor: isActive(item.path) ? nav.activeBg : "transparent",
                      }}
                      // Render as a real anchor so Ctrl/Cmd+Click and middle-click
                      // open in a new tab natively.
                      {...(item.path ? { component: RouterLink, to: item.path } : {})}
                    >
                      <Badge color="error" variant="dot" invisible={!hasBadge(item.path)}>
                        <MaterialSymbol icon={item.icon} size={20} />
                      </Badge>
                    </IconButton>
                  </Tooltip>
                ) : (
                  <Button
                    key={item.label}
                    size="small"
                    startIcon={
                      <Badge color="error" variant="dot" invisible={!hasBadge(item.path)}>
                        <MaterialSymbol icon={item.icon} size={18} />
                      </Badge>
                    }
                    sx={navBtnSx(isActive(item.path))}
                    {...(item.path ? { component: RouterLink, to: item.path } : {})}
                  >
                    {item.label}
                  </Button>
                ),
              )}

            </Box>
          )}

          {/* Nav group dropdown menu (Reports, GRC, …) */}
          <Menu
            anchorEl={navMenu?.el ?? null}
            open={!!navMenu}
            onClose={() => setNavMenu(null)}
          >
            {navItems
              .find((n) => n.children && n.label === navMenu?.group)
              ?.children?.map((child, idx) => {
              const needsDivider =
                child.path === "/reports/saved" || child.path === "/turbolens";
              return (
                <Box key={child.path}>
                  {needsDivider && idx > 0 && <Divider sx={{ my: 0.5 }} />}
                  <MenuItem
                    component={RouterLink}
                    to={child.path}
                    selected={isActive(child.path)}
                    onClick={() => setNavMenu(null)}
                  >
                    <ListItemIcon>
                      <MaterialSymbol icon={child.icon} size={18} />
                    </ListItemIcon>
                    <ListItemText>{child.label}</ListItemText>
                  </MenuItem>
                </Box>
              );
            })}
          </Menu>


          <Box sx={{ flex: 1 }} />

          {/* Search icon button */}
          {!isMobile && (
            <Tooltip title={t("search.tooltip", { shortcut: /Mac|iPod|iPhone|iPad/.test(navigator.platform) ? "\u2318K" : "Ctrl+K" })}>
              <IconButton
                sx={{ color: nav.fgMuted }}
                onClick={() => setSearchDialogOpen(true)}
              >
                <MaterialSymbol icon="search" size={22} />
              </IconButton>
            </Tooltip>
          )}

          {/* Create button — icon-only on mobile */}
          {can("inventory.create") && (
            isMobile ? (
              <Tooltip title={t("create")}>
                <IconButton
                  sx={{ color: nav.fg }}
                  onClick={() => setCreateOpen(true)}
                >
                  <MaterialSymbol icon="add_circle" size={24} />
                </IconButton>
              </Tooltip>
            ) : (
              <Button
                variant="contained"
                size="small"
                startIcon={<MaterialSymbol icon="add" size={18} />}
                sx={{ ml: 1.5, px: 2, textTransform: "none", flexShrink: 0 }}
                onClick={() => setCreateOpen(true)}
              >
                {t("create")}
              </Button>
            )
          )}

          {/* Notification bell */}
          <NotificationBell userId={user.id} color={nav.fg} />

          {/* User menu */}
          <IconButton
            sx={{ ml: isMobile ? 0 : 1, color: nav.fg, flexShrink: 0 }}
            onClick={(e) => setUserMenu(e.currentTarget)}
          >
            <MaterialSymbol icon="account_circle" size={28} />
          </IconButton>
          <Menu
            anchorEl={userMenu}
            open={!!userMenu}
            onClose={() => setUserMenu(null)}
          >
            <MenuItem disabled>
              <Typography variant="body2">{user.display_name}</Typography>
            </MenuItem>
            <MenuItem disabled>
              <Typography variant="caption" color="text.secondary">
                {user.email}
              </Typography>
            </MenuItem>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 1,
                px: 2,
                py: 0.75,
              }}
            >
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.72rem" }}>
                v{__APP_VERSION__}
              </Typography>
              {sponsorButtonEnabled && (
                <Button
                  size="small"
                  startIcon={<MaterialSymbol icon="volunteer_activism" size={16} />}
                  onClick={(e) => {
                    e.stopPropagation();
                    setUserMenu(null);
                    setSponsorshipOpen(true);
                  }}
                  sx={{
                    background: `linear-gradient(135deg, ${brand.sponsorFrom}, ${brand.sponsorTo})`,
                    color: "#fff",
                    textTransform: "none",
                    px: 1.25,
                    py: 0.25,
                    minHeight: 0,
                    fontSize: "0.72rem",
                    "&:hover": {
                      background: `linear-gradient(135deg, ${brand.sponsorFrom}, ${brand.sponsorTo})`,
                      filter: "brightness(0.95)",
                    },
                  }}
                >
                  {t("userMenu.sponsorship")}
                </Button>
              )}
            </Box>
            <Divider />
            <MenuItem
              onClick={() => {
                setUserMenu(null);
                setNotifPrefsOpen(true);
              }}
            >
              <ListItemIcon>
                <MaterialSymbol icon="notifications_active" size={18} />
              </ListItemIcon>
              <ListItemText>{t("userMenu.notificationSettings")}</ListItemText>
            </MenuItem>
            <MenuItem onClick={toggleMode}>
              <ListItemIcon>
                <MaterialSymbol icon={mode === "dark" ? "light_mode" : "dark_mode"} size={18} />
              </ListItemIcon>
              <ListItemText>{mode === "dark" ? t("userMenu.lightMode") : t("userMenu.darkMode")}</ListItemText>
            </MenuItem>
            <MenuItem onClick={(e) => setLangMenu(e.currentTarget)}>
              <ListItemIcon>
                <MaterialSymbol icon="translate" size={18} />
              </ListItemIcon>
              <ListItemText>{t("userMenu.language")}</ListItemText>
              <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                {LOCALE_LABELS[(i18n.language as SupportedLocale)] || "English"}
              </Typography>
            </MenuItem>
            <MenuItem
              component="a"
              href="https://docs.turbo-ea.org/"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setUserMenu(null)}
            >
              <ListItemIcon>
                <MaterialSymbol icon="menu_book" size={18} />
              </ListItemIcon>
              <ListItemText>{t("userMenu.userManual")}</ListItemText>
            </MenuItem>
            {canOpenAnyCatalogue && <Divider />}
            {canOpenAnyCatalogue && (
              <MenuItem
                onClick={toggleRefCat}
                sx={{ minHeight: 32 }}
                aria-expanded={refCatExpanded}
              >
                <ListItemIcon>
                  <MaterialSymbol icon="library_books" size={18} />
                </ListItemIcon>
                <ListItemText
                  primaryTypographyProps={{
                    variant: "caption",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  {t("userMenu.referenceCatalogues")}
                </ListItemText>
                <MaterialSymbol
                  icon={refCatExpanded ? "expand_less" : "expand_more"}
                  size={18}
                />
              </MenuItem>
            )}
            <Collapse in={refCatExpanded} timeout="auto" unmountOnExit>
              {canOpen("/capability-catalogue") && (
                <MenuItem
                  component={RouterLink}
                  to="/capability-catalogue"
                  onClick={() => setUserMenu(null)}
                  sx={{ pl: 3 }}
                >
                  <ListItemIcon>
                    <MaterialSymbol icon="account_tree" size={18} />
                  </ListItemIcon>
                  <ListItemText>{t("userMenu.capabilityCatalogue")}</ListItemText>
                </MenuItem>
              )}
              {canOpen("/process-catalogue") && (
                <MenuItem
                  component={RouterLink}
                  to="/process-catalogue"
                  onClick={() => setUserMenu(null)}
                  sx={{ pl: 3 }}
                >
                  <ListItemIcon>
                    <MaterialSymbol icon="route" size={18} />
                  </ListItemIcon>
                  <ListItemText>{t("userMenu.processCatalogue")}</ListItemText>
                </MenuItem>
              )}
              {canOpen("/value-stream-catalogue") && (
                <MenuItem
                  component={RouterLink}
                  to="/value-stream-catalogue"
                  onClick={() => setUserMenu(null)}
                  sx={{ pl: 3 }}
                >
                  <ListItemIcon>
                    <MaterialSymbol icon="alt_route" size={18} />
                  </ListItemIcon>
                  <ListItemText>{t("userMenu.valueStreamCatalogue")}</ListItemText>
                </MenuItem>
              )}
              {canOpen("/principles-catalogue") && (
                <MenuItem
                  component={RouterLink}
                  to="/principles-catalogue"
                  onClick={() => setUserMenu(null)}
                  sx={{ pl: 3 }}
                >
                  <ListItemIcon>
                    <MaterialSymbol icon="bookmark_star" size={18} />
                  </ListItemIcon>
                  <ListItemText>{t("userMenu.principlesCatalogue")}</ListItemText>
                </MenuItem>
              )}
            </Collapse>
            {showAdmin && <Divider />}
            {showAdmin && (
              <MenuItem disabled sx={{ opacity: 0.7, minHeight: 32 }}>
                <ListItemIcon>
                  <MaterialSymbol icon="admin_panel_settings" size={18} />
                </ListItemIcon>
                <ListItemText primaryTypographyProps={{ variant: "caption", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>{t("admin")}</ListItemText>
              </MenuItem>
            )}
            {showAdmin && adminItems.map((item) => (
              <MenuItem
                key={item.path}
                selected={isActive(item.path)}
                {...(item.path ? { component: RouterLink, to: item.path } : {})}
                onClick={() => setUserMenu(null)}
                sx={{ pl: 3 }}
              >
                <ListItemIcon>
                  <MaterialSymbol icon={item.icon} size={18} />
                </ListItemIcon>
                <ListItemText>{item.label}</ListItemText>
              </MenuItem>
            ))}
            {can("admin.impersonate") && !user.impersonated_role && <Divider />}
            {can("admin.impersonate") && !user.impersonated_role && (
              <MenuItem
                onClick={() => {
                  setUserMenu(null);
                  setImpersonateDialogOpen(true);
                }}
              >
                <ListItemIcon>
                  <MaterialSymbol icon="switch_account" size={18} />
                </ListItemIcon>
                <ListItemText>{t("userMenu.viewAsRole")}</ListItemText>
              </MenuItem>
            )}
            <Divider />
            <MenuItem
              onClick={() => {
                setUserMenu(null);
                onLogout();
              }}
            >
              <ListItemIcon>
                <MaterialSymbol icon="logout" size={18} />
              </ListItemIcon>
              <ListItemText>{t("common:actions.logout")}</ListItemText>
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      {/* Search dialog */}
      <SearchDialog open={searchDialogOpen} onClose={() => setSearchDialogOpen(false)} />

      {/* Create card dialog — global so the top-nav Create button works from
          any route without first navigating to /inventory. CreateCardDialog
          handles routing to /cards/{newId} on success. */}
      {can("inventory.create") && (
        <CreateCardDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreate={async (data) => {
            const card = await api.post<Card>("/cards", data);
            return card.id;
          }}
        />
      )}

      {/* Notification preferences dialog */}
      <NotificationPreferencesDialog
        open={notifPrefsOpen}
        onClose={() => setNotifPrefsOpen(false)}
      />

      {/* Sponsorship dialog */}
      <SponsorshipDialog open={sponsorshipOpen} onClose={() => setSponsorshipOpen(false)} />

      {/* Language submenu */}
      <Menu
        anchorEl={langMenu}
        open={!!langMenu}
        onClose={() => setLangMenu(null)}
      >
        {SUPPORTED_LOCALES.filter((l) => enabledLocales.includes(l)).map((locale) => (
          <MenuItem
            key={locale}
            selected={i18n.language === locale}
            onClick={() => handleLanguageChange(locale)}
          >
            <ListItemText>{LOCALE_LABELS[locale]}</ListItemText>
          </MenuItem>
        ))}
      </Menu>

      {/* Mobile drawer */}
      {isMobile && renderDrawer()}

      {/* Role-impersonation picker (mounted globally so the user-menu
          entry can open it from any route). */}
      <ImpersonateRoleDialog
        open={impersonateDialogOpen}
        onClose={() => setImpersonateDialogOpen(false)}
        onSuccess={refreshUser}
      />

      {/* Main content */}
      <Box
        component="main"
        className="app-main-content"
        sx={{
          flexGrow: 1,
          bgcolor: "background.default",
          minHeight: "100vh",
          pt: "64px",
        }}
      >
        {user.impersonated_role && (
          <Box
            sx={{
              position: "sticky",
              top: 64,
              zIndex: 1099,
              bgcolor: "#ffb300",
              color: "#1a1a2e",
              px: 2,
              py: 1,
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              borderBottom: "1px solid rgba(0,0,0,0.12)",
              boxShadow: 1,
            }}
            role="status"
            aria-live="polite"
          >
            <MaterialSymbol icon="visibility" size={20} />
            <Typography variant="body2" sx={{ flexGrow: 1, fontWeight: 600 }}>
              {t("impersonation.banner", {
                role: user.impersonated_role_label || user.impersonated_role,
              })}
            </Typography>
            <Button
              size="small"
              variant="contained"
              color="inherit"
              onClick={handleStopImpersonating}
              disabled={stopImpersonatingBusy}
              sx={{
                bgcolor: "#1a1a2e",
                color: "#fff",
                "&:hover": { bgcolor: "#000018" },
                textTransform: "none",
                fontWeight: 600,
              }}
            >
              {t("impersonation.stop")}
            </Button>
          </Box>
        )}
        {licenseAttention.length > 0 && (
          <Box
            sx={{
              px: 2,
              py: 1,
              bgcolor: "warning.main",
              color: "warning.contrastText",
              display: "flex",
              alignItems: "center",
              gap: 1,
              flexWrap: "wrap",
            }}
          >
            <MaterialSymbol icon="license" size={18} />
            <Typography variant="body2">
              {t("extensionLicense.banner", {
                defaultValue:
                  "Extension license attention needed: {{keys}}. Request a renewed license file and apply it under Admin → Extensions.",
                keys: licenseAttention
                  .map((r) => `${r.key} (${r.entitlement_state})`)
                  .join(", "),
              })}
            </Typography>
            <Button
              size="small"
              color="inherit"
              sx={{ ml: "auto" }}
              onClick={() => navigate("/admin/extensions")}
            >
              {t("extensionLicense.manage", { defaultValue: "Manage" })}
            </Button>
          </Box>
        )}
        <Box sx={{ p: { xs: 1.5, sm: 3 } }}>{children}</Box>
      </Box>
      <Snackbar
        open={!!deniedPath}
        autoHideDuration={6000}
        onClose={() => setDeniedPath(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity="info"
          variant="filled"
          onClose={() => setDeniedPath(null)}
          sx={{ width: "100%" }}
        >
          {t("common:accessDenied.redirectedToDashboard")}
        </Alert>
      </Snackbar>
    </Box>
  );
}
