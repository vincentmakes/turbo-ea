import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/layouts/AppLayout";
import LoginPage from "@/features/auth/LoginPage";
import Dashboard from "@/features/dashboard/Dashboard";
import InventoryPage from "@/features/inventory/InventoryPage";
import FactSheetDetail from "@/features/fact-sheets/FactSheetDetail";
import LandscapeReport from "@/features/reports/LandscapeReport";
import PortfolioReport from "@/features/reports/PortfolioReport";
import MatrixReport from "@/features/reports/MatrixReport";
import RoadmapReport from "@/features/reports/RoadmapReport";
import CostReport from "@/features/reports/CostReport";
import DiagramsPage from "@/features/diagrams/DiagramsPage";
import DiagramEditor from "@/features/diagrams/DiagramEditor";
import TodosPage from "@/features/todos/TodosPage";
import MetamodelAdmin from "@/features/admin/MetamodelAdmin";
import TagsAdmin from "@/features/admin/TagsAdmin";
import UsersAdmin from "@/features/admin/UsersAdmin";
import CircularProgress from "@mui/material/CircularProgress";
import Box from "@mui/material/Box";

const theme = createTheme({
  typography: {
    fontFamily: "'Inter', sans-serif",
  },
  palette: {
    primary: { main: "#1976d2" },
  },
  components: {
    MuiCard: {
      defaultProps: { variant: "outlined" },
    },
  },
});

export default function App() {
  const { user, loading, login, register, logout } = useAuth();

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!user) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <LoginPage onLogin={login} onRegister={register} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <AppLayout user={user} onLogout={logout}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/inventory" element={<InventoryPage />} />
            <Route path="/fact-sheets/:id" element={<FactSheetDetail />} />
            <Route path="/reports/landscape" element={<LandscapeReport />} />
            <Route path="/reports/portfolio" element={<PortfolioReport />} />
            <Route path="/reports/matrix" element={<MatrixReport />} />
            <Route path="/reports/roadmap" element={<RoadmapReport />} />
            <Route path="/reports/cost" element={<CostReport />} />
            <Route path="/diagrams" element={<DiagramsPage />} />
            <Route path="/diagrams/:id" element={<DiagramEditor />} />
            <Route path="/todos" element={<TodosPage />} />
            <Route path="/admin/metamodel" element={<MetamodelAdmin />} />
            <Route path="/admin/tags" element={<TagsAdmin />} />
            <Route path="/admin/users" element={<UsersAdmin />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </AppLayout>
      </BrowserRouter>
    </ThemeProvider>
  );
}
