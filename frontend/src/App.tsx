import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import CircularProgress from "@mui/material/CircularProgress";
import Box from "@mui/material/Box";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/layouts/AppLayout";
import LoginPage from "@/features/auth/LoginPage";
import SsoCallback from "@/features/auth/SsoCallback";
import SetPasswordPage from "@/features/auth/SetPasswordPage";

// --- Lazy-loaded page components (route-level code splitting) ---
const Dashboard = lazy(() => import("@/features/dashboard/Dashboard"));
const InventoryPage = lazy(() => import("@/features/inventory/InventoryPage"));
const CardDetail = lazy(() => import("@/features/cards/CardDetail"));
const ErrorBoundary = lazy(() => import("@/components/ErrorBoundary"));
const PortfolioReport = lazy(() => import("@/features/reports/PortfolioReport"));
const CapabilityMapReport = lazy(() => import("@/features/reports/CapabilityMapReport"));
const LifecycleReport = lazy(() => import("@/features/reports/LifecycleReport"));
const DependencyReport = lazy(() => import("@/features/reports/DependencyReport"));
const CostReport = lazy(() => import("@/features/reports/CostReport"));
const MatrixReport = lazy(() => import("@/features/reports/MatrixReport"));
const DataQualityReport = lazy(() => import("@/features/reports/DataQualityReport"));
const EolReport = lazy(() => import("@/features/reports/EolReport"));
const SavedReportsPage = lazy(() => import("@/features/reports/SavedReportsPage"));
const DiagramsPage = lazy(() => import("@/features/diagrams/DiagramsPage"));
const DiagramEditor = lazy(() => import("@/features/diagrams/DiagramEditor"));
const TodosPage = lazy(() => import("@/features/todos/TodosPage"));
const EADeliveryPage = lazy(() => import("@/features/ea-delivery/EADeliveryPage"));
const SoAWEditor = lazy(() => import("@/features/ea-delivery/SoAWEditor"));
const SoAWPreview = lazy(() => import("@/features/ea-delivery/SoAWPreview"));
const MetamodelAdmin = lazy(() => import("@/features/admin/MetamodelAdmin"));
const UsersAdmin = lazy(() => import("@/features/admin/UsersAdmin"));
const SettingsAdmin = lazy(() => import("@/features/admin/SettingsAdmin"));
const SurveysAdmin = lazy(() => import("@/features/admin/SurveysAdmin"));
const SurveyBuilder = lazy(() => import("@/features/admin/SurveyBuilder"));
const SurveyResults = lazy(() => import("@/features/admin/SurveyResults"));
const EolAdmin = lazy(() => import("@/features/admin/EolAdmin"));
const SurveyRespond = lazy(() => import("@/features/surveys/SurveyRespond"));
const WebPortalsAdmin = lazy(() => import("@/features/admin/WebPortalsAdmin"));
const ServiceNowAdmin = lazy(() => import("@/features/admin/ServiceNowAdmin"));
const PortalViewer = lazy(() => import("@/features/web-portals/PortalViewer"));
const BpmDashboard = lazy(() => import("@/features/bpm/BpmDashboard"));
const ProcessFlowEditorPage = lazy(() => import("@/features/bpm/ProcessFlowEditorPage"));

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

/** Centered spinner shown while lazy components are loading. */
function PageLoader() {
  return (
    <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "60vh" }}>
      <CircularProgress />
    </Box>
  );
}

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
        <Route path="/portal/:slug" element={<Suspense fallback={<PageLoader />}><PortalViewer /></Suspense>} />
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
      <Route path="/portal/:slug" element={<Suspense fallback={<PageLoader />}><PortalViewer /></Suspense>} />
      {/* Authenticated routes */}
      <Route
        path="*"
        element={
          <AppLayout user={user} onLogout={logout}>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/inventory" element={<InventoryPage />} />
                <Route path="/cards/:id" element={<ErrorBoundary label="Card Detail"><CardDetail /></ErrorBoundary>} />
                <Route path="/reports/portfolio" element={<PortfolioReport />} />
                <Route path="/reports/capability-map" element={<CapabilityMapReport />} />
                <Route path="/reports/lifecycle" element={<LifecycleReport />} />
                <Route path="/reports/dependencies" element={<DependencyReport />} />
                <Route path="/reports/cost" element={<CostReport />} />
                <Route path="/reports/matrix" element={<MatrixReport />} />
                <Route path="/reports/data-quality" element={<DataQualityReport />} />
                <Route path="/reports/eol" element={<EolReport />} />
                <Route path="/reports/saved" element={<SavedReportsPage />} />
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
                <Route path="/admin/users" element={<UsersAdmin />} />
                <Route path="/admin/settings" element={<SettingsAdmin />} />
                <Route path="/admin/eol" element={<EolAdmin />} />
                <Route path="/admin/surveys" element={<SurveysAdmin />} />
                <Route path="/admin/surveys/new" element={<SurveyBuilder />} />
                <Route path="/admin/surveys/:id/results" element={<SurveyResults />} />
                <Route path="/admin/surveys/:id" element={<SurveyBuilder />} />
                <Route path="/admin/web-portals" element={<WebPortalsAdmin />} />
                <Route path="/admin/servicenow" element={<ServiceNowAdmin />} />
                <Route path="*" element={<Navigate to="/" />} />
              </Routes>
            </Suspense>
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
