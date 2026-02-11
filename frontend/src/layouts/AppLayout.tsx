import { useState, type ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Box from "@mui/material/Box";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Button from "@mui/material/Button";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import MaterialSymbol from "@/components/MaterialSymbol";

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
      { label: "Landscape", icon: "grid_view", path: "/reports/landscape" },
      { label: "Portfolio", icon: "bubble_chart", path: "/reports/portfolio" },
      { label: "Matrix", icon: "table_chart", path: "/reports/matrix" },
      { label: "Roadmap", icon: "timeline", path: "/reports/roadmap" },
      { label: "Cost", icon: "payments", path: "/reports/cost" },
    ],
  },
  { label: "Diagrams", icon: "schema", path: "/diagrams" },
  { label: "Todos", icon: "checklist", path: "/todos" },
];

const ADMIN_ITEMS: NavItem[] = [
  { label: "Metamodel", icon: "settings_suggest", path: "/admin/metamodel" },
  { label: "Tags", icon: "label", path: "/admin/tags" },
  { label: "Users", icon: "group", path: "/admin/users" },
];

interface Props {
  children: ReactNode;
  user: { display_name: string; email: string; role: string };
  onLogout: () => void;
}

export default function AppLayout({ children, user, onLogout }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const [userMenu, setUserMenu] = useState<HTMLElement | null>(null);
  const [reportsMenu, setReportsMenu] = useState<HTMLElement | null>(null);
  const [adminMenu, setAdminMenu] = useState<HTMLElement | null>(null);
  const [search, setSearch] = useState("");

  const handleSearch = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && search.trim()) {
      navigate(`/inventory?search=${encodeURIComponent(search.trim())}`);
    }
  };

  const isActive = (path?: string) => !!(path && location.pathname === path);
  const isGroupActive = (children?: { path: string }[]) =>
    !!children?.some((c) => location.pathname === c.path);

  const navBtnSx = (active: boolean) => ({
    color: active ? "#fff" : "rgba(255,255,255,0.7)",
    textTransform: "none" as const,
    fontWeight: active ? 700 : 500,
    fontSize: "0.85rem",
    minWidth: 0,
    px: 1.5,
    borderRadius: 1,
    bgcolor: active ? "rgba(255,255,255,0.12)" : "transparent",
    "&:hover": { bgcolor: "rgba(255,255,255,0.1)" },
  });

  return (
    <Box sx={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <AppBar
        position="fixed"
        sx={{ bgcolor: "#1a1a2e" }}
        elevation={0}
      >
        <Toolbar sx={{ gap: 0.5 }}>
          {/* Brand */}
          <MaterialSymbol icon="hub" size={28} color="#64b5f6" />
          <Typography
            variant="h6"
            sx={{
              ml: 1,
              fontWeight: 700,
              letterSpacing: "-0.5px",
              mr: 3,
              cursor: "pointer",
            }}
            onClick={() => navigate("/")}
          >
            Turbo EA
          </Typography>

          {/* Main nav items */}
          {NAV_ITEMS.map((item) =>
            item.children ? (
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
            ) : (
              <Button
                key={item.label}
                size="small"
                startIcon={<MaterialSymbol icon={item.icon} size={18} />}
                sx={navBtnSx(isActive(item.path))}
                onClick={() => item.path && navigate(item.path)}
              >
                {item.label}
              </Button>
            )
          )}

          {/* Admin dropdown */}
          <Button
            size="small"
            startIcon={<MaterialSymbol icon="admin_panel_settings" size={18} />}
            endIcon={<MaterialSymbol icon="expand_more" size={16} />}
            sx={navBtnSx(isGroupActive(ADMIN_ITEMS as { path: string }[]))}
            onClick={(e) => setAdminMenu(e.currentTarget)}
          >
            Admin
          </Button>

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

          {/* Search */}
          <TextField
            size="small"
            placeholder="Search fact sheets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleSearch}
            sx={{
              maxWidth: 360,
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
            }}
          />

          {/* Create button */}
          <Button
            variant="contained"
            size="small"
            startIcon={<MaterialSymbol icon="add" size={18} />}
            sx={{ ml: 1.5, textTransform: "none" }}
            onClick={() => navigate("/inventory?create=true")}
          >
            Create
          </Button>

          {/* User menu */}
          <IconButton
            sx={{ ml: 1, color: "#fff" }}
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
                onLogout();
              }}
            >
              Logout
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      {/* Main content — full width now, no sidebar */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          bgcolor: "#fafbfc",
          minHeight: "100vh",
          pt: "64px",
        }}
      >
        <Box sx={{ p: 3 }}>{children}</Box>
      </Box>
    </Box>
  );
}
