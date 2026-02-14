import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Box from "@mui/material/Box";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
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
import Popper from "@mui/material/Popper";
import Paper from "@mui/material/Paper";
import ClickAwayListener from "@mui/material/ClickAwayListener";
import CircularProgress from "@mui/material/CircularProgress";
import Chip from "@mui/material/Chip";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import NotificationBell from "@/components/NotificationBell";
import NotificationPreferencesDialog from "@/components/NotificationPreferencesDialog";
import { api } from "@/api/client";
import { useEventStream } from "@/hooks/useEventStream";
import { useMetamodel } from "@/hooks/useMetamodel";
import type { BadgeCounts } from "@/types";

interface NavItem {
  label: string;
  icon: string;
  path?: string;
  children?: { label: string; icon: string; path: string }[];
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", icon: "dashboard", path: "/" },
  { label: "Inventory", icon: "inventory_2", path: "/inventory" },
  {
    label: "Reports",
    icon: "analytics",
    children: [
      { label: "Portfolio", icon: "bubble_chart", path: "/reports/portfolio" },
      { label: "Capability Map", icon: "grid_view", path: "/reports/capability-map" },
      { label: "Lifecycle", icon: "timeline", path: "/reports/lifecycle" },
      { label: "Dependencies", icon: "hub", path: "/reports/dependencies" },
      { label: "Cost", icon: "payments", path: "/reports/cost" },
      { label: "Matrix", icon: "table_chart", path: "/reports/matrix" },
      { label: "Data Quality", icon: "verified", path: "/reports/data-quality" },
      { label: "End of Life", icon: "update", path: "/reports/eol" },
    ],
  },
  { label: "Diagrams", icon: "schema", path: "/diagrams" },
  { label: "Delivery", icon: "architecture", path: "/ea-delivery" },
  { label: "Todos", icon: "checklist", path: "/todos" },
  { label: "Surveys", icon: "assignment", path: "/surveys" },
];

const ADMIN_ITEMS: NavItem[] = [
  { label: "Metamodel", icon: "settings_suggest", path: "/admin/metamodel" },
  { label: "Tags", icon: "label", path: "/admin/tags" },
  { label: "Users", icon: "group", path: "/admin/users" },
  { label: "Surveys", icon: "assignment", path: "/admin/surveys" },
  { label: "Settings", icon: "settings", path: "/admin/settings" },
  { label: "EOL Search", icon: "update", path: "/admin/eol" },
  { label: "Web Portals", icon: "language", path: "/admin/web-portals" },
];

interface Props {
  children: ReactNode;
  user: { id: string; display_name: string; email: string; role: string };
  onLogout: () => void;
}

interface SearchResult {
  id: string;
  name: string;
  type: string;
  subtype?: string;
}

export default function AppLayout({ children, user, onLogout }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const isCompact = useMediaQuery(theme.breakpoints.down("lg"));
  const { getType } = useMetamodel();

  const [userMenu, setUserMenu] = useState<HTMLElement | null>(null);
  const [reportsMenu, setReportsMenu] = useState<HTMLElement | null>(null);
  const [adminMenu, setAdminMenu] = useState<HTMLElement | null>(null);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchAnchorRef = useRef<HTMLDivElement | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerReportsOpen, setDrawerReportsOpen] = useState(false);
  const [drawerAdminOpen, setDrawerAdminOpen] = useState(false);
  const [notifPrefsOpen, setNotifPrefsOpen] = useState(false);
  const [badgeCounts, setBadgeCounts] = useState<BadgeCounts>({ open_todos: 0, pending_surveys: 0 });

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

  // Refresh badge counts on relevant real-time events
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
          fetchBadgeCounts();
        }
      },
      [fetchBadgeCounts],
    ),
  );

  // Also refresh when navigating (covers completing a todo, responding to a survey)
  useEffect(() => {
    fetchBadgeCounts();
  }, [location.pathname, fetchBadgeCounts]);

  // Debounced live search
  const doLiveSearch = useCallback(
    async (query: string) => {
      if (query.trim().length < 2) {
        setSearchResults([]);
        setSearchOpen(false);
        return;
      }
      setSearchLoading(true);
      try {
        const res = await api.get<{ items: SearchResult[] }>(
          `/fact-sheets?search=${encodeURIComponent(query.trim())}&page_size=10`
        );
        setSearchResults(res.items);
        setSearchOpen(res.items.length > 0);
      } catch {
        setSearchResults([]);
        setSearchOpen(false);
      } finally {
        setSearchLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (search.trim().length < 2) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }
    searchTimerRef.current = setTimeout(() => doLiveSearch(search), 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [search, doLiveSearch]);

  // Close search results on navigation
  useEffect(() => {
    setSearchOpen(false);
  }, [location.pathname]);

  const handleSearchResultClick = (id: string) => {
    setSearchOpen(false);
    setSearch("");
    navigate(`/fact-sheets/${id}`);
  };

  const handleSearch = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && search.trim()) {
      setSearchOpen(false);
      navigate(`/inventory?search=${encodeURIComponent(search.trim())}`);
      setDrawerOpen(false);
    }
    if (e.key === "Escape") {
      setSearchOpen(false);
    }
  };

  const isActive = (path?: string) =>
    !!(path && (location.pathname === path || (path !== "/" && location.pathname.startsWith(path))));
  const isGroupActive = (children?: { path: string }[]) =>
    !!children?.some((c) => location.pathname === c.path);

  const navBtnSx = (active: boolean) => ({
    color: active ? "#fff" : "rgba(255,255,255,0.7)",
    textTransform: "none" as const,
    fontWeight: active ? 700 : 500,
    fontSize: "0.85rem",
    minWidth: 0,
    px: isCompact && !isMobile ? 1 : 1.5,
    borderRadius: 1,
    bgcolor: active ? "rgba(255,255,255,0.12)" : "transparent",
    "&:hover": { bgcolor: "rgba(255,255,255,0.1)" },
  });

  const drawerNav = (path: string) => {
    navigate(path);
    setDrawerOpen(false);
  };

  const hasBadge = (label: string) =>
    (label === "Todos" && badgeCounts.open_todos > 0) ||
    (label === "Surveys" && badgeCounts.pending_surveys > 0);

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

      {/* Search */}
      <Box sx={{ px: 2, py: 1.5 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Search fact sheets..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={handleSearch}
          sx={{
            bgcolor: "rgba(255,255,255,0.08)",
            borderRadius: 1,
            "& .MuiOutlinedInput-notchedOutline": { border: "none" },
            input: { color: "#fff", py: 0.75 },
          }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <MaterialSymbol icon="search" size={20} color="#999" />
              </InputAdornment>
            ),
            endAdornment: searchLoading ? (
              <InputAdornment position="end">
                <CircularProgress size={16} sx={{ color: "rgba(255,255,255,0.5)" }} />
              </InputAdornment>
            ) : null,
          }}
        />
        {/* Mobile live search results */}
        {searchResults.length > 0 && search.trim().length >= 2 && (
          <Paper sx={{ mt: 1, borderRadius: 1.5, maxHeight: 300, overflow: "auto" }}>
            {searchResults.map((item) => {
              const typeConfig = getType(item.type);
              return (
                <Box
                  key={item.id}
                  onClick={() => {
                    setDrawerOpen(false);
                    setSearch("");
                    setSearchResults([]);
                    navigate(`/fact-sheets/${item.id}`);
                  }}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1.5,
                    px: 2,
                    py: 1,
                    cursor: "pointer",
                    "&:hover": { bgcolor: "action.hover" },
                    borderBottom: "1px solid",
                    borderColor: "divider",
                    "&:last-child": { borderBottom: "none" },
                  }}
                >
                  <MaterialSymbol
                    icon={typeConfig?.icon || "description"}
                    size={18}
                    color={typeConfig?.color || "#999"}
                  />
                  <Typography variant="body2" noWrap sx={{ flex: 1, fontWeight: 500 }}>
                    {item.name}
                  </Typography>
                  <Chip
                    label={typeConfig?.label || item.type}
                    size="small"
                    sx={{
                      height: 18,
                      fontSize: "0.65rem",
                      bgcolor: typeConfig?.color ? `${typeConfig.color}18` : "action.selected",
                      color: typeConfig?.color || "text.secondary",
                      fontWeight: 600,
                    }}
                  />
                </Box>
              );
            })}
          </Paper>
        )}
      </Box>

      <List sx={{ px: 1 }}>
        {NAV_ITEMS.map((item) =>
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
                <Badge color="error" variant="dot" invisible={!hasBadge(item.label)}>
                  <MaterialSymbol icon={item.icon} size={20} color="inherit" />
                </Badge>
              </ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          ),
        )}

        <Divider sx={{ my: 1, borderColor: "rgba(255,255,255,0.1)" }} />

        {/* Admin section */}
        <ListItemButton
          onClick={() => setDrawerAdminOpen((p) => !p)}
          sx={{
            borderRadius: 1,
            color: isGroupActive(ADMIN_ITEMS as { path: string }[]) ? "#fff" : "rgba(255,255,255,0.7)",
          }}
        >
          <ListItemIcon sx={{ minWidth: 36, color: "inherit" }}>
            <MaterialSymbol icon="admin_panel_settings" size={20} color="inherit" />
          </ListItemIcon>
          <ListItemText primary="Admin" />
          <MaterialSymbol
            icon={drawerAdminOpen ? "expand_less" : "expand_more"}
            size={18}
            color="inherit"
          />
        </ListItemButton>
        <Collapse in={drawerAdminOpen}>
          <List disablePadding sx={{ pl: 2 }}>
            {ADMIN_ITEMS.map((item) => (
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

        <Divider sx={{ my: 1, borderColor: "rgba(255,255,255,0.1)" }} />

        {/* Create */}
        <ListItemButton
          onClick={() => drawerNav("/inventory?create=true")}
          sx={{ borderRadius: 1, color: "rgba(255,255,255,0.7)" }}
        >
          <ListItemIcon sx={{ minWidth: 36, color: "inherit" }}>
            <MaterialSymbol icon="add" size={20} color="inherit" />
          </ListItemIcon>
          <ListItemText primary="Create Fact Sheet" />
        </ListItemButton>
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
          Logout
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
              mr: isMobile ? 0 : 3,
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
          {!isMobile &&
            NAV_ITEMS.map((item) =>
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
                    <Badge color="error" variant="dot" invisible={!hasBadge(item.label)}>
                      <MaterialSymbol icon={item.icon} size={20} />
                    </Badge>
                  </IconButton>
                </Tooltip>
              ) : (
                <Button
                  key={item.label}
                  size="small"
                  startIcon={
                    <Badge color="error" variant="dot" invisible={!hasBadge(item.label)}>
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

          {/* Admin dropdown (desktop/tablet) */}
          {!isMobile &&
            (isCompact ? (
              <Tooltip title="Admin">
                <IconButton
                  size="small"
                  sx={{ color: isGroupActive(ADMIN_ITEMS as { path: string }[]) ? "#fff" : "rgba(255,255,255,0.7)" }}
                  onClick={(e) => setAdminMenu(e.currentTarget)}
                >
                  <MaterialSymbol icon="admin_panel_settings" size={20} />
                </IconButton>
              </Tooltip>
            ) : (
              <Button
                size="small"
                startIcon={<MaterialSymbol icon="admin_panel_settings" size={18} />}
                endIcon={<MaterialSymbol icon="expand_more" size={16} />}
                sx={navBtnSx(isGroupActive(ADMIN_ITEMS as { path: string }[]))}
                onClick={(e) => setAdminMenu(e.currentTarget)}
              >
                Admin
              </Button>
            ))}

          {/* Reports dropdown menu */}
          <Menu
            anchorEl={reportsMenu}
            open={!!reportsMenu}
            onClose={() => setReportsMenu(null)}
          >
            {NAV_ITEMS.find((n) => n.children)?.children?.map((child) => (
              <MenuItem
                key={child.path}
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
            ))}
          </Menu>

          {/* Admin dropdown menu */}
          <Menu
            anchorEl={adminMenu}
            open={!!adminMenu}
            onClose={() => setAdminMenu(null)}
          >
            {ADMIN_ITEMS.map((item) => (
              <MenuItem
                key={item.path}
                selected={isActive(item.path)}
                onClick={() => {
                  item.path && navigate(item.path);
                  setAdminMenu(null);
                }}
              >
                <ListItemIcon>
                  <MaterialSymbol icon={item.icon} size={18} />
                </ListItemIcon>
                <ListItemText>{item.label}</ListItemText>
              </MenuItem>
            ))}
          </Menu>

          <Box sx={{ flex: 1 }} />

          {/* Search (hidden on mobile — available in drawer) */}
          {!isMobile && (
            <ClickAwayListener onClickAway={() => setSearchOpen(false)}>
              <Box sx={{ position: "relative" }} ref={searchAnchorRef}>
                <TextField
                  size="small"
                  placeholder="Search fact sheets..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={handleSearch}
                  onFocus={() => {
                    if (searchResults.length > 0) setSearchOpen(true);
                  }}
                  sx={{
                    maxWidth: isCompact ? 200 : 360,
                    minWidth: isCompact ? 200 : 300,
                    bgcolor: "rgba(255,255,255,0.08)",
                    borderRadius: 1,
                    "& .MuiOutlinedInput-notchedOutline": { border: "none" },
                    input: { color: "#fff", py: 0.75 },
                  }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <MaterialSymbol icon="search" size={20} color="#999" />
                      </InputAdornment>
                    ),
                    endAdornment: searchLoading ? (
                      <InputAdornment position="end">
                        <CircularProgress size={16} sx={{ color: "rgba(255,255,255,0.5)" }} />
                      </InputAdornment>
                    ) : null,
                  }}
                />
                <Popper
                  open={searchOpen}
                  anchorEl={searchAnchorRef.current}
                  placement="bottom-end"
                  style={{ zIndex: theme.zIndex.modal + 1, width: Math.max(440, searchAnchorRef.current?.offsetWidth || 440), maxWidth: "calc(100vw - 32px)" }}
                >
                  <Paper
                    elevation={8}
                    sx={{
                      mt: 0.5,
                      maxHeight: 400,
                      overflow: "auto",
                      borderRadius: 1.5,
                    }}
                  >
                    {searchResults.map((item) => {
                      const typeConfig = getType(item.type);
                      return (
                        <Box
                          key={item.id}
                          onClick={() => handleSearchResultClick(item.id)}
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1.5,
                            px: 2,
                            py: 1,
                            cursor: "pointer",
                            "&:hover": { bgcolor: "action.hover" },
                            borderBottom: "1px solid",
                            borderColor: "divider",
                            "&:last-child": { borderBottom: "none" },
                          }}
                        >
                          <MaterialSymbol
                            icon={typeConfig?.icon || "description"}
                            size={20}
                            color={typeConfig?.color || "#999"}
                          />
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography
                              variant="body2"
                              sx={{ fontWeight: 500, wordBreak: "break-word" }}
                            >
                              {item.name}
                            </Typography>
                          </Box>
                          <Chip
                            label={typeConfig?.label || item.type}
                            size="small"
                            sx={{
                              height: 20,
                              fontSize: "0.7rem",
                              bgcolor: typeConfig?.color ? `${typeConfig.color}18` : "action.selected",
                              color: typeConfig?.color || "text.secondary",
                              fontWeight: 600,
                            }}
                          />
                        </Box>
                      );
                    })}
                    {search.trim().length >= 2 && (
                      <Box
                        onClick={() => {
                          setSearchOpen(false);
                          navigate(`/inventory?search=${encodeURIComponent(search.trim())}`);
                        }}
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 0.5,
                          px: 2,
                          py: 1,
                          cursor: "pointer",
                          "&:hover": { bgcolor: "action.hover" },
                          color: "primary.main",
                        }}
                      >
                        <MaterialSymbol icon="search" size={16} />
                        <Typography variant="body2" sx={{ fontSize: "0.8rem" }}>
                          View all results for &quot;{search.trim()}&quot;
                        </Typography>
                      </Box>
                    )}
                  </Paper>
                </Popper>
              </Box>
            </ClickAwayListener>
          )}

          {/* Create button */}
          {isMobile ? (
            <Tooltip title="Create">
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
              sx={{ ml: 1.5, textTransform: "none" }}
              onClick={() => navigate("/inventory?create=true")}
            >
              Create
            </Button>
          )}

          {/* Notification bell */}
          <NotificationBell userId={user.id} />

          {/* User menu */}
          <IconButton
            sx={{ ml: isMobile ? 0 : 1, color: "#fff" }}
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
              <ListItemText>Notification Settings</ListItemText>
            </MenuItem>
            <MenuItem
              onClick={() => {
                setUserMenu(null);
                onLogout();
              }}
            >
              <ListItemIcon>
                <MaterialSymbol icon="logout" size={18} />
              </ListItemIcon>
              <ListItemText>Logout</ListItemText>
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      {/* Notification preferences dialog */}
      <NotificationPreferencesDialog
        open={notifPrefsOpen}
        onClose={() => setNotifPrefsOpen(false)}
      />

      {/* Mobile drawer */}
      {isMobile && renderDrawer()}

      {/* Main content */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          bgcolor: "#fafbfc",
          minHeight: "100vh",
          pt: "64px",
        }}
      >
        <Box sx={{ p: { xs: 1.5, sm: 3 } }}>{children}</Box>
      </Box>
    </Box>
  );
}
