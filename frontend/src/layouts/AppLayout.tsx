import { useState, type ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Collapse from "@mui/material/Collapse";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Button from "@mui/material/Button";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Divider from "@mui/material/Divider";
import MaterialSymbol from "@/components/MaterialSymbol";

const DRAWER_WIDTH = 240;

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
  const [reportsOpen, setReportsOpen] = useState(
    location.pathname.startsWith("/reports")
  );
  const [adminOpen, setAdminOpen] = useState(
    location.pathname.startsWith("/admin")
  );
  const [userMenu, setUserMenu] = useState<HTMLElement | null>(null);
  const [search, setSearch] = useState("");

  const handleSearch = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && search.trim()) {
      navigate(`/inventory?search=${encodeURIComponent(search.trim())}`);
    }
  };

  const isActive = (path?: string) => !!(path && location.pathname === path);

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <AppBar
        position="fixed"
        sx={{ zIndex: (t) => t.zIndex.drawer + 1, bgcolor: "#1a1a2e" }}
        elevation={0}
      >
        <Toolbar>
          <MaterialSymbol icon="hub" size={28} color="#64b5f6" />
          <Typography
            variant="h6"
            sx={{ ml: 1, fontWeight: 700, letterSpacing: "-0.5px", mr: 4 }}
          >
            Turbo EA
          </Typography>
          <TextField
            size="small"
            placeholder="Search fact sheets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleSearch}
            sx={{
              flex: 1,
              maxWidth: 500,
              bgcolor: "rgba(255,255,255,0.08)",
              borderRadius: 1,
              "& .MuiOutlinedInput-notchedOutline": { border: "none" },
              input: { color: "#fff" },
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <MaterialSymbol icon="search" size={20} color="#999" />
                </InputAdornment>
              ),
            }}
          />
          <Button
            variant="contained"
            size="small"
            startIcon={<MaterialSymbol icon="add" size={18} />}
            sx={{ ml: 2, textTransform: "none" }}
            onClick={() => navigate("/inventory?create=true")}
          >
            Create
          </Button>
          <IconButton
            sx={{ ml: 2, color: "#fff" }}
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

      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          "& .MuiDrawer-paper": {
            width: DRAWER_WIDTH,
            boxSizing: "border-box",
            bgcolor: "#f5f7fa",
            borderRight: "1px solid #e0e0e0",
          },
        }}
      >
        <Toolbar />
        <Box sx={{ overflow: "auto", py: 1 }}>
          <List dense>
            {NAV_ITEMS.map((item) =>
              item.children ? (
                <Box key={item.label}>
                  <ListItemButton onClick={() => setReportsOpen(!reportsOpen)}>
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <MaterialSymbol icon={item.icon} size={20} />
                    </ListItemIcon>
                    <ListItemText primary={item.label} />
                    <MaterialSymbol
                      icon={reportsOpen ? "expand_less" : "expand_more"}
                      size={20}
                    />
                  </ListItemButton>
                  <Collapse in={reportsOpen} timeout="auto">
                    <List dense disablePadding>
                      {item.children.map((child) => (
                        <ListItemButton
                          key={child.path}
                          sx={{ pl: 5 }}
                          selected={isActive(child.path)}
                          onClick={() => navigate(child.path)}
                        >
                          <ListItemIcon sx={{ minWidth: 32 }}>
                            <MaterialSymbol icon={child.icon} size={18} />
                          </ListItemIcon>
                          <ListItemText primary={child.label} />
                        </ListItemButton>
                      ))}
                    </List>
                  </Collapse>
                </Box>
              ) : (
                <ListItemButton
                  key={item.label}
                  selected={isActive(item.path)}
                  onClick={() => item.path && navigate(item.path)}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <MaterialSymbol icon={item.icon} size={20} />
                  </ListItemIcon>
                  <ListItemText primary={item.label} />
                </ListItemButton>
              )
            )}
          </List>
          <Divider sx={{ my: 1 }} />
          <ListItemButton onClick={() => setAdminOpen(!adminOpen)}>
            <ListItemIcon sx={{ minWidth: 36 }}>
              <MaterialSymbol icon="admin_panel_settings" size={20} />
            </ListItemIcon>
            <ListItemText primary="Admin" />
            <MaterialSymbol
              icon={adminOpen ? "expand_less" : "expand_more"}
              size={20}
            />
          </ListItemButton>
          <Collapse in={adminOpen} timeout="auto">
            <List dense disablePadding>
              {ADMIN_ITEMS.map((item) => (
                <ListItemButton
                  key={item.path}
                  sx={{ pl: 5 }}
                  selected={isActive(item.path)}
                  onClick={() => item.path && navigate(item.path)}
                >
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    <MaterialSymbol icon={item.icon} size={18} />
                  </ListItemIcon>
                  <ListItemText primary={item.label} />
                </ListItemButton>
              ))}
            </List>
          </Collapse>
        </Box>
      </Drawer>

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
