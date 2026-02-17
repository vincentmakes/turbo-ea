import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/layouts/AppLayout";
import LoginPage from "@/features/auth/LoginPage";
import Dashboard from "@/features/dashboard/Dashboard";
import InventoryPage from "@/features/inventory/InventoryPage";
import CardDetail from "@/features/cards/CardDetail";
import PortfolioReport from "@/features/reports/PortfolioReport";
import CapabilityMapReport from "@/features/reports/CapabilityMapReport";
import LifecycleReport from "@/features/reports/LifecycleReport";
import DependencyReport from "@/features/reports/DependencyReport";
import CostReport from "@/features/reports/CostReport";
import MatrixReport from "@/features/reports/MatrixReport";
import DataQualityReport from "@/features/reports/DataQualityReport";
import EolReport from "@/features/reports/EolReport";
import DiagramsPage from "@/features/diagrams/DiagramsPage";
import DiagramEditor from "@/features/diagrams/DiagramEditor";
import TodosPage from "@/features/todos/TodosPage";
import EADeliveryPage from "@/features/ea-delivery/EADeliveryPage";
import SoAWEditor from "@/features/ea-delivery/SoAWEditor";
import SoAWPreview from "@/features/ea-delivery/SoAWPreview";
import MetamodelAdmin from "@/features/admin/MetamodelAdmin";
import TagsAdmin from "@/features/admin/TagsAdmin";
import UsersAdmin from "@/features/admin/UsersAdmin";
import SettingsAdmin from "@/features/admin/SettingsAdmin";
import SurveysAdmin from "@/features/admin/SurveysAdmin";
import SurveyBuilder from "@/features/admin/SurveyBuilder";
import SurveyResults from "@/features/admin/SurveyResults";
import EolAdmin from "@/features/admin/EolAdmin";
import SurveyRespond from "@/features/surveys/SurveyRespond";
import RolesAdmin from "@/features/admin/RolesAdmin";
import WebPortalsAdmin from "@/features/admin/WebPortalsAdmin";
import PortalViewer from "@/features/web-portals/PortalViewer";
import SsoCallback from "@/features/auth/SsoCallback";
import SetPasswordPage from "@/features/auth/SetPasswordPage";
import BpmDashboard from "@/features/bpm/BpmDashboard";
import ProcessFlowEditorPage from "@/features/bpm/ProcessFlowEditorPage";

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

/** Inner component that handles authenticated vs public routes. */
function AppRoutes() {
  const { user, loading, login, register, ssoCallback, setPassword, logout } = useAuth();

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!user) {
    return (
      <Routes>
        {/* Public portal route — accessible without login */}
        <Route path="/portal/:slug" element={<PortalViewer />} />
        {/* SSO callback route */}
        <Route path="/auth/callback" element={<SsoCallback onSsoCallback={ssoCallback} />} />
        {/* Password setup route (for invited users) */}
        <Route path="/auth/set-password" element={<SetPasswordPage onSetPassword={setPassword} />} />
        {/* Everything else redirects to login */}
        <Route path="*" element={<LoginPage onLogin={login} onRegister={register} />} />
      </Routes>
    );
  }

  return (
    <Routes>
      {/* Public portal route — also accessible when logged in */}
      <Route path="/portal/:slug" element={<PortalViewer />} />
      {/* Authenticated routes */}
      <Route
        path="*"
        element={
          <AppLayout user={user} onLogout={logout}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/inventory" element={<InventoryPage />} />
              <Route path="/cards/:id" element={<CardDetail />} />
              <Route path="/reports/portfolio" element={<PortfolioReport />} />
              <Route path="/reports/capability-map" element={<CapabilityMapReport />} />
              <Route path="/reports/lifecycle" element={<LifecycleReport />} />
              <Route path="/reports/dependencies" element={<DependencyReport />} />
              <Route path="/reports/cost" element={<CostReport />} />
              <Route path="/reports/matrix" element={<MatrixReport />} />
              <Route path="/reports/data-quality" element={<DataQualityReport />} />
              <Route path="/reports/eol" element={<EolReport />} />
              <Route path="/bpm" element={<BpmDashboard />} />
              <Route path="/bpm/processes/:id/flow" element={<ProcessFlowEditorPage />} />
              <Route path="/diagrams" element={<DiagramsPage />} />
              <Route path="/diagrams/:id" element={<DiagramEditor />} />
              <Route path="/ea-delivery" element={<EADeliveryPage />} />
              <Route path="/ea-delivery/soaw/new" element={<SoAWEditor />} />
              <Route path="/ea-delivery/soaw/:id/preview" element={<SoAWPreview />} />
              <Route path="/ea-delivery/soaw/:id" element={<SoAWEditor />} />
              <Route path="/todos" element={<TodosPage />} />
              <Route path="/surveys" element={<Navigate to="/todos?tab=surveys" />} />
              <Route path="/surveys/:surveyId/respond/:cardId" element={<SurveyRespond />} />
              <Route path="/admin/metamodel" element={<MetamodelAdmin />} />
              <Route path="/admin/tags" element={<TagsAdmin />} />
              <Route path="/admin/users" element={<UsersAdmin />} />
              <Route path="/admin/settings" element={<SettingsAdmin />} />
              <Route path="/admin/eol" element={<EolAdmin />} />
              <Route path="/admin/surveys" element={<SurveysAdmin />} />
              <Route path="/admin/surveys/new" element={<SurveyBuilder />} />
              <Route path="/admin/surveys/:id/results" element={<SurveyResults />} />
              <Route path="/admin/surveys/:id" element={<SurveyBuilder />} />
              <Route path="/admin/roles" element={<RolesAdmin />} />
              <Route path="/admin/web-portals" element={<WebPortalsAdmin />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </AppLayout>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </ThemeProvider>
  );
}
