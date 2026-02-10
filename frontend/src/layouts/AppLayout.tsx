import { useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import {
  AppBar,
  Box,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
  Divider,
} from "@mui/material";
import { MaterialSymbol } from "../components/MaterialSymbol";

const DRAWER_WIDTH = 260;

interface NavItem {
  label: string;
  icon: string;
  path: string;
}

const navItems: NavItem[] = [
  { label: "Dashboard", icon: "dashboard", path: "/" },
  { label: "Applications", icon: "apps", path: "/fact-sheets?type=application" },
  {
    label: "Business Capabilities",
    icon: "account_tree",
    path: "/fact-sheets?type=business_capability",
  },
  { label: "IT Components", icon: "memory", path: "/fact-sheets?type=it_component" },
  { label: "Organizations", icon: "corporate_fare", path: "/fact-sheets?type=organization" },
  { label: "Providers", icon: "storefront", path: "/fact-sheets?type=provider" },
  { label: "Interfaces", icon: "swap_horiz", path: "/fact-sheets?type=interface" },
  { label: "Initiatives", icon: "rocket_launch", path: "/fact-sheets?type=initiative" },
  { label: "Capability Map", icon: "map", path: "/capability-map" },
  { label: "Tech Radar", icon: "radar", path: "/tech-radar" },
  { label: "Risk Matrix", icon: "warning", path: "/risk-matrix" },
  { label: "Provider Costs", icon: "payments", path: "/providers" },
  { label: "Data Flow", icon: "device_hub", path: "/data-flow" },
  { label: "Interface Map", icon: "bubble_chart", path: "/interface-map" },
  { label: "CRUD Matrix", icon: "grid_on", path: "/crud-matrix" },
  { label: "Initiative Board", icon: "view_kanban", path: "/initiative-board" },
  { label: "Roadmap", icon: "calendar_month", path: "/roadmap" },
  { label: "TIME Model", icon: "dashboard", path: "/time-model" },
  { label: "Traceability", icon: "account_tree", path: "/traceability" },
  { label: "Landscape Report", icon: "landscape", path: "/landscape-report" },
  { label: "Matrix Report", icon: "grid_on", path: "/matrix-report" },
  { label: "All Fact Sheets", icon: "list", path: "/fact-sheets" },
];

export default function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <AppBar
        position="fixed"
        sx={{
          zIndex: (theme) => theme.zIndex.drawer + 1,
          backgroundColor: "primary.dark",
        }}
      >
        <Toolbar>
          <IconButton
            color="inherit"
            edge="start"
            onClick={() => setDrawerOpen(!drawerOpen)}
            sx={{ mr: 2 }}
          >
            <MaterialSymbol icon="menu" />
          </IconButton>
          <Typography variant="h6" noWrap sx={{ fontWeight: 700, letterSpacing: "0.5px" }}>
            Turbo EA
          </Typography>
        </Toolbar>
      </AppBar>

      <Drawer
        variant="persistent"
        open={drawerOpen}
        sx={{
          width: drawerOpen ? DRAWER_WIDTH : 0,
          flexShrink: 0,
          "& .MuiDrawer-paper": {
            width: DRAWER_WIDTH,
            boxSizing: "border-box",
          },
        }}
      >
        <Toolbar />
        <Box sx={{ overflow: "auto", py: 1 }}>
          <List>
            {navItems.map((item) => (
              <ListItemButton
                key={item.path}
                selected={location.pathname + location.search === item.path}
                onClick={() => navigate(item.path)}
                sx={{ borderRadius: 1, mx: 1, mb: 0.5 }}
              >
                <ListItemIcon sx={{ minWidth: 40 }}>
                  <MaterialSymbol icon={item.icon} />
                </ListItemIcon>
                <ListItemText
                  primary={item.label}
                  primaryTypographyProps={{ fontSize: "0.875rem" }}
                />
              </ListItemButton>
            ))}
          </List>
          <Divider sx={{ my: 1 }} />
          <List>
            <ListItemButton
              onClick={() => navigate("/settings")}
              sx={{ borderRadius: 1, mx: 1 }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>
                <MaterialSymbol icon="settings" />
              </ListItemIcon>
              <ListItemText
                primary="Settings"
                primaryTypographyProps={{ fontSize: "0.875rem" }}
              />
            </ListItemButton>
          </List>
        </Box>
      </Drawer>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          mt: 8,
          backgroundColor: "background.default",
          minHeight: "100vh",
        }}
      >
        <Outlet />
      </Box>
    </Box>
  );
}
