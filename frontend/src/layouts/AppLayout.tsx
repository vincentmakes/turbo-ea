import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Box from "@mui/material/Box";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Badge from "@mui/material/Badge";
import Button from "@mui/material/Button";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Drawer from "@mui/material/Drawer";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import Collapse from "@mui/material/Collapse";
import Tooltip from "@mui/material/Tooltip";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import NotificationBell from "@/components/NotificationBell";
import NotificationPreferencesDialog from "@/components/NotificationPreferencesDialog";
import { api } from "@/api/client";
import { useEventStream } from "@/hooks/useEventStream";
import { useBpmEnabled } from "@/hooks/useBpmEnabled";
import { usePpmEnabled } from "@/hooks/usePpmEnabled";
import { useTurboLensReady } from "@/hooks/useTurboLensReady";
import { useThemeMode } from "@/hooks/useThemeMode";
import { SUPPORTED_LOCALES, LOCALE_LABELS, type SupportedLocale } from "@/i18n";
import { useEnabledLocales } from "@/hooks/useEnabledLocales";
import SearchDialog from "@/components/SearchDialog";
import type { BadgeCounts } from "@/types";

interface NavItemDef {
  labelKey: string;
  icon: string;
  path?: string;
  children?: { labelKey: string; icon: string; path: string }[];
  permission?: string | string[];
}

interface NavItem {
  label: string;
  icon: string;
  path?: string;
  children?: { label: string; icon: string; path: string }[];
  permission?: string | string[];
}

const NAV_ITEM_DEFS: NavItemDef[] = [
  { labelKey: "dashboard", icon: "dashboard", path: "/" },
  { labelKey: "inventory", icon: "inventory_2", path: "/inventory", permission: "inventory.view" },
  {
    labelKey: "reports",
    icon: "analytics",
    permission: "reports.ea_dashboard",
    children: [
      { labelKey: "reports.portfolio", icon: "dashboard", path: "/reports/portfolio" },
      { labelKey: "reports.capabilityMap", icon: "grid_view", path: "/reports/capability-map" },
      { labelKey: "reports.lifecycle", icon: "timeline", path: "/reports/lifecycle" },
      { labelKey: "reports.dependencies", icon: "hub", path: "/reports/dependencies" },
      { labelKey: "reports.cost", icon: "payments", path: "/reports/cost" },
      { labelKey: "reports.matrix", icon: "table_chart", path: "/reports/matrix" },
      { labelKey: "reports.dataQuality", icon: "verified", path: "/reports/data-quality" },
      { labelKey: "reports.endOfLife", icon: "update", path: "/reports/eol" },
      { labelKey: "reports.saved", icon: "bookmarks", path: "/reports/saved" },
    ],
  },
  { labelKey: "bpm", icon: "route", path: "/bpm", permission: "bpm.view" },
  { labelKey: "ppm", icon: "view_timeline", path: "/ppm", permission: "ppm.view" },
  { labelKey: "diagrams", icon: "schema", path: "/diagrams", permission: "diagrams.view" },
  { labelKey: "delivery", icon: "architecture", path: "/ea-delivery", permission: "soaw.view" },
  {
    labelKey: "delivery.risks",
    icon: "policy",
    path: "/ea-delivery/risks",
    permission: "risks.view",
  },
  { labelKey: "todos", icon: "checklist", path: "/todos" },
];

const ADMIN_ITEM_DEFS: NavItemDef[] = [
  { labelKey: "admin.metamodel", icon: "settings_suggest", path: "/admin/metamodel", permission: "admin.metamodel" },
  { labelKey: "admin.usersAndRoles", icon: "group", path: "/admin/users", permission: "admin.users" },
  { labelKey: "admin.surveys", icon: "assignment", path: "/admin/surveys", permission: "surveys.manage" },
  { labelKey: "admin.settings", icon: "settings", path: "/admin/settings", permission: ["admin.settings", "eol.manage", "web_portals.manage", "servicenow.manage", "turbolens.manage"] },
];

interface PermissionMap {
  [key: string]: boolean;
}

interface Props {
  children: ReactNode;
  user: { id: string; display_name: string; email: string; role: string; permissions?: PermissionMap };
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
  const { turboLensReady } = useTurboLensReady();
  const { enabledLocales } = useEnabledLocales();
  const { mode, toggleMode } = useThemeMode();

  // Permission check helper
  const can = useCallback(
    (permission: string): boolean => {
      const perms = user.permissions;
      if (!perms) return true; // Fallback: allow all if permissions not loaded yet
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

    const resolve = (def: NavItemDef): NavItem => ({
      ...def,
      label: t(def.labelKey),
      children: def.children?.map((c) => ({ ...c, label: t(c.labelKey) })),
    });

    return items
      .filter((item) => {
        if (!item.permission) return true;
        if (Array.isArray(item.permission)) return item.permission.some((p) => can(p));
        return can(item.permission);
      })
      .map(resolve);
  }, [bpmEnabled, ppmEnabled, turboLensReady, can, t]);

  // Resolve admin item labels via i18n and filter based on permissions
  const adminItems = useMemo(() => {
    return ADMIN_ITEM_DEFS.filter((item) => {
      if (!item.permission) return true;
      if (Array.isArray(item.permission)) return item.permission.some((p) => can(p));
      return can(item.permission);
    }).map((def) => ({ ...def, label: t(def.labelKey) }));
  }, [can, t]);

  // Should the admin section be shown at all?
  const showAdmin = adminItems.length > 0;

  const [userMenu, setUserMenu] = useState<HTMLElement | null>(null);
  const [reportsMenu, setReportsMenu] = useState<HTMLElement | null>(null);
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerReportsOpen, setDrawerReportsOpen] = useState(false);
  const [drawerAdminOpen, setDrawerAdminOpen] = useState(false);
  const [notifPrefsOpen, setNotifPrefsOpen] = useState(false);
  const [langMenu, setLangMenu] = useState<HTMLElement | null>(null);
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
    color: active ? "#fff" : "rgba(255,255,255,0.7)",
    textTransform: "none" as const,
    fontWeight: active ? 700 : 500,
    fontSize: isCondensed ? "0.75rem" : "0.85rem",
    minWidth: 0,
    px: isCondensed ? 0.75 : 1.5,
    whiteSpace: "nowrap" as const,
    borderRadius: 1,
    bgcolor: active ? "rgba(255,255,255,0.12)" : "transparent",
    "&:hover": { bgcolor: "rgba(255,255,255,0.1)" },
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
      PaperProps={{ sx: { width: 280, bgcolor: "#1a1a2e" } }}
    >
      {/* Brand header */}
      <Box
        sx={{ display: "flex", alignItems: "center", p: 2, cursor: "pointer" }}
        onClick={() => drawerNav("/")}
      >
        <img
          src="/api/v1/settings/logo"
          alt="Turbo EA"
          style={{ height: 45, objectFit: "contain" }}
        />
      </Box>
      <Divider sx={{ borderColor: "rgba(255,255,255,0.1)" }} />

      {/* Search button */}
      <Box sx={{ px: 2, py: 1.5 }}>
        <ListItemButton
          onClick={() => {
            setDrawerOpen(false);
            setSearchDialogOpen(true);
          }}
          sx={{
            borderRadius: 1,
            bgcolor: "rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.5)",
            py: 0.75,
            px: 1.5,
            gap: 1,
          }}
        >
          <MaterialSymbol icon="search" size={20} color="#999" />
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
                onClick={() => setDrawerReportsOpen((p) => !p)}
                sx={{
                  borderRadius: 1,
                  color: isGroupActive(item.children) ? "#fff" : "rgba(255,255,255,0.7)",
                  bgcolor: isGroupActive(item.children) ? "rgba(255,255,255,0.12)" : "transparent",
                }}
              >
                <ListItemIcon sx={{ minWidth: 36, color: "inherit" }}>
                  <MaterialSymbol icon={item.icon} size={20} color="inherit" />
                </ListItemIcon>
                <ListItemText primary={item.label} />
                <MaterialSymbol
                  icon={drawerReportsOpen ? "expand_less" : "expand_more"}
                  size={18}
                  color="inherit"
                />
              </ListItemButton>
              <Collapse in={drawerReportsOpen}>
                <List disablePadding sx={{ pl: 2 }}>
                  {item.children.map((child) => (
                    <ListItemButton
                      key={child.path}
                      selected={isActive(child.path)}
                      onClick={() => drawerNav(child.path)}
                      sx={{ borderRadius: 1, color: "rgba(255,255,255,0.7)", "&.Mui-selected": { color: "#fff", bgcolor: "rgba(255,255,255,0.12)" } }}
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
                color: isActive(item.path) ? "#fff" : "rgba(255,255,255,0.7)",
                "&.Mui-selected": { bgcolor: "rgba(255,255,255,0.12)" },
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
            <Divider sx={{ my: 1, borderColor: "rgba(255,255,255,0.1)" }} />

            {/* Admin section */}
            <ListItemButton
              onClick={() => setDrawerAdminOpen((p) => !p)}
              sx={{
                borderRadius: 1,
                color: isGroupActive(adminItems as { path: string }[]) ? "#fff" : "rgba(255,255,255,0.7)",
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
                    sx={{ borderRadius: 1, color: "rgba(255,255,255,0.7)", "&.Mui-selected": { color: "#fff", bgcolor: "rgba(255,255,255,0.12)" } }}
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
            <Divider sx={{ my: 1, borderColor: "rgba(255,255,255,0.1)" }} />

            {/* Create */}
            <ListItemButton
              onClick={() => drawerNav("/inventory?create=true")}
              sx={{ borderRadius: 1, color: "rgba(255,255,255,0.7)" }}
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
        <Divider sx={{ mb: 1.5, borderColor: "rgba(255,255,255,0.1)" }} />
        <Typography variant="body2" sx={{ color: "#fff", fontWeight: 600 }}>
          {user.display_name}
        </Typography>
        <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.5)" }}>
          {user.email}
        </Typography>
        <Button
          fullWidth
          size="small"
          sx={{ mt: 1, color: "rgba(255,255,255,0.7)", textTransform: "none", justifyContent: "flex-start" }}
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
        sx={{ bgcolor: "#1a1a2e" }}
        elevation={0}
      >
        <Toolbar sx={{ gap: 0.5 }}>
          {/* Hamburger (mobile) */}
          {isMobile && (
            <IconButton
              sx={{ color: "#fff", mr: 0.5 }}
              onClick={() => setDrawerOpen(true)}
            >
              <MaterialSymbol icon="menu" size={24} />
            </IconButton>
          )}

          {/* Brand */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              mr: isMobile ? 0 : isCondensed ? 1.5 : 3,
              cursor: "pointer",
            }}
            onClick={() => navigate("/")}
          >
            <img
              src="/api/v1/settings/logo"
              alt="Turbo EA"
              style={{ height: 45, objectFit: "contain" }}
            />
          </Box>

          {/* Desktop / tablet nav items */}
          {!isMobile && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0 }}>
              {navItems.map((item) =>
                item.children ? (
                  isCompact ? (
                    <Tooltip key={item.label} title={item.label}>
                      <IconButton
                        size="small"
                        sx={{ color: isGroupActive(item.children) ? "#fff" : "rgba(255,255,255,0.7)" }}
                        onClick={(e) => setReportsMenu(e.currentTarget)}
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
                      onClick={(e) => setReportsMenu(e.currentTarget)}
                    >
                      {item.label}
                    </Button>
                  )
                ) : isCompact ? (
                  <Tooltip key={item.label} title={item.label}>
                    <IconButton
                      size="small"
                      sx={{
                        color: isActive(item.path) ? "#fff" : "rgba(255,255,255,0.7)",
                        bgcolor: isActive(item.path) ? "rgba(255,255,255,0.12)" : "transparent",
                      }}
                      onClick={() => item.path && navigate(item.path)}
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
                    onClick={() => item.path && navigate(item.path)}
                  >
                    {item.label}
                  </Button>
                ),
              )}

            </Box>
          )}

          {/* Reports dropdown menu */}
          <Menu
            anchorEl={reportsMenu}
            open={!!reportsMenu}
            onClose={() => setReportsMenu(null)}
          >
            {navItems.find((n) => n.children)?.children?.map((child, idx) => {
              const needsDivider =
                child.path === "/reports/saved" || child.path === "/turbolens";
              return (
                <Box key={child.path}>
                  {needsDivider && idx > 0 && <Divider sx={{ my: 0.5 }} />}
                  <MenuItem
                    selected={isActive(child.path)}
                    onClick={() => {
                      navigate(child.path);
                      setReportsMenu(null);
                    }}
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
                sx={{ color: "rgba(255,255,255,0.7)" }}
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
                  sx={{ color: "#fff" }}
                  onClick={() => navigate("/inventory?create=true")}
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
                onClick={() => navigate("/inventory?create=true")}
              >
                {t("create")}
              </Button>
            )
          )}

          {/* Notification bell */}
          <NotificationBell userId={user.id} />

          {/* User menu */}
          <IconButton
            sx={{ ml: isMobile ? 0 : 1, color: "#fff", flexShrink: 0 }}
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
            <MenuItem disabled sx={{ minHeight: 24 }}>
              <Typography variant="caption" color="text.disabled" sx={{ fontSize: "0.65rem" }}>
                v{__APP_VERSION__}
              </Typography>
            </MenuItem>
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
                onClick={() => {
                  item.path && navigate(item.path);
                  setUserMenu(null);
                }}
                sx={{ pl: 3 }}
              >
                <ListItemIcon>
                  <MaterialSymbol icon={item.icon} size={18} />
                </ListItemIcon>
                <ListItemText>{item.label}</ListItemText>
              </MenuItem>
            ))}
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

      {/* Notification preferences dialog */}
      <NotificationPreferencesDialog
        open={notifPrefsOpen}
        onClose={() => setNotifPrefsOpen(false)}
      />

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
        <Box sx={{ p: { xs: 1.5, sm: 3 } }}>{children}</Box>
      </Box>
    </Box>
  );
}
