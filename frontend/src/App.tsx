import { lazy, Suspense, useMemo } from "react";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import CircularProgress from "@mui/material/CircularProgress";
import Box from "@mui/material/Box";
import { useAuth } from "@/hooks/useAuth";
import { AuthProvider } from "@/hooks/AuthContext";
import { ThemeModeContext, useThemeModeState } from "@/hooks/useThemeMode";
import { buildTheme } from "@/theme";
import AppLayout from "@/layouts/AppLayout";
import LoginPage from "@/features/auth/LoginPage";
import SsoCallback from "@/features/auth/SsoCallback";
import SetPasswordPage from "@/features/auth/SetPasswordPage";
import ModuleGate from "@/components/ModuleGate";

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
const DiagramViewer = lazy(() => import("@/features/diagrams/DiagramViewer"));
const DiagramEditor = lazy(() => import("@/features/diagrams/DiagramEditor"));
const TodosPage = lazy(() => import("@/features/todos/TodosPage"));
const EaDeliveryReport = lazy(() => import("@/features/reports/EaDeliveryReport"));
const SoAWEditor = lazy(() => import("@/features/ea-delivery/SoAWEditor"));
const SoAWPreview = lazy(() => import("@/features/ea-delivery/SoAWPreview"));
const ADREditor = lazy(() => import("@/features/ea-delivery/ADREditor"));
const ADRPreview = lazy(() => import("@/features/ea-delivery/ADRPreview"));
const RiskDetailPage = lazy(
  () => import("@/features/grc/risk/RiskDetailPage"),
);
const GrcPage = lazy(() => import("@/features/grc/GrcPage"));
const MetamodelAdmin = lazy(() => import("@/features/admin/MetamodelAdmin"));
const UsersAdmin = lazy(() => import("@/features/admin/UsersAdmin"));
const SettingsAdmin = lazy(() => import("@/features/admin/SettingsAdmin"));
const SurveysAdmin = lazy(() => import("@/features/admin/SurveysAdmin"));
const SurveyBuilder = lazy(() => import("@/features/admin/SurveyBuilder"));
const SurveyResults = lazy(() => import("@/features/admin/SurveyResults"));
const SurveyRespond = lazy(() => import("@/features/surveys/SurveyRespond"));
const PortalViewer = lazy(() => import("@/features/web-portals/PortalViewer"));
const BpmDashboard = lazy(() => import("@/features/bpm/BpmDashboard"));
const ProcessFlowEditorPage = lazy(() => import("@/features/bpm/ProcessFlowEditorPage"));
const PpmHome = lazy(() => import("@/features/ppm/PpmHome"));
const PpmProjectDetail = lazy(() => import("@/features/ppm/PpmProjectDetail"));
const TurboLensPage = lazy(() => import("@/features/turbolens/TurboLensPage"));
const AssessmentViewer = lazy(() => import("@/features/turbolens/AssessmentViewer"));
const CapabilityCataloguePage = lazy(
  () => import("@/features/capability-catalogue/CapabilityCataloguePage"),
);
const ProcessCataloguePage = lazy(
  () => import("@/features/process-catalogue/ProcessCataloguePage"),
);
const ValueStreamCataloguePage = lazy(
  () => import("@/features/value-stream-catalogue/ValueStreamCataloguePage"),
);
const PrinciplesCataloguePage = lazy(
  () => import("@/features/principles-catalogue/PrinciplesCataloguePage"),
);

/** Preserve the :id when redirecting /ea-delivery/risks/:id → /grc/risks/:id. */
function LegacyRiskDetailRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/grc/risks/${id ?? ""}`} replace />;
}

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
  const { user, loading, login, register, ssoCallback, setPassword, logout, refreshUser } =
    useAuth();

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
          <AuthProvider user={user} refreshUser={refreshUser}>
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
                <Route path="/bpm" element={<ModuleGate module="bpm"><BpmDashboard /></ModuleGate>} />
                <Route path="/bpm/processes/:id/flow" element={<ModuleGate module="bpm"><ProcessFlowEditorPage /></ModuleGate>} />
                <Route path="/ppm" element={<ModuleGate module="ppm"><PpmHome /></ModuleGate>} />
                <Route path="/ppm/:id" element={<ModuleGate module="ppm"><PpmProjectDetail /></ModuleGate>} />
                <Route path="/diagrams" element={<DiagramsPage />} />
                <Route path="/diagrams/:id" element={<DiagramViewer />} />
                <Route path="/diagrams/:id/edit" element={<DiagramEditor />} />
                {/* EA Delivery: page dissolved in 1.10.0. Initiatives workspace
                    moved to /reports/ea-delivery; risks moved to /grc?tab=risk.
                    Editor routes for SoAW and ADR keep their /ea-delivery/ paths
                    so existing bookmarks survive. */}
                <Route path="/ea-delivery" element={<Navigate to="/reports/ea-delivery" replace />} />
                <Route path="/reports/ea-delivery" element={<EaDeliveryReport />} />
                <Route path="/ea-delivery/soaw/new" element={<SoAWEditor />} />
                <Route path="/ea-delivery/soaw/:id/preview" element={<SoAWPreview />} />
                <Route path="/ea-delivery/soaw/:id" element={<SoAWEditor />} />
                <Route path="/ea-delivery/adr/new" element={<ADREditor />} />
                <Route path="/ea-delivery/adr/:id/preview" element={<ADRPreview />} />
                <Route path="/ea-delivery/adr/:id" element={<ADREditor />} />
                <Route path="/ea-delivery/risks" element={<Navigate to="/grc?tab=risk" replace />} />
                <Route path="/ea-delivery/risks/:id" element={<LegacyRiskDetailRedirect />} />
                <Route path="/grc" element={<GrcPage />} />
                <Route path="/grc/risks/:id" element={<RiskDetailPage />} />
                <Route path="/todos" element={<TodosPage />} />
                <Route path="/surveys" element={<Navigate to="/todos?tab=surveys" />} />
                <Route path="/surveys/:surveyId/respond/:cardId" element={<SurveyRespond />} />
                <Route path="/admin/metamodel" element={<MetamodelAdmin />} />
                <Route path="/admin/users" element={<UsersAdmin />} />
                <Route path="/admin/settings" element={<SettingsAdmin />} />
                <Route path="/admin/eol" element={<Navigate to="/admin/settings?tab=eol" />} />
                <Route path="/admin/web-portals" element={<Navigate to="/admin/settings?tab=web-portals" />} />
                <Route path="/admin/servicenow" element={<Navigate to="/admin/settings?tab=servicenow" />} />
                <Route path="/admin/surveys" element={<SurveysAdmin />} />
                <Route path="/admin/surveys/new" element={<SurveyBuilder />} />
                <Route path="/admin/surveys/:id/results" element={<SurveyResults />} />
                <Route path="/admin/surveys/:id" element={<SurveyBuilder />} />
                <Route path="/turbolens" element={<ModuleGate module="turbolens"><TurboLensPage /></ModuleGate>} />
                <Route path="/turbolens/assessments/:id" element={<ModuleGate module="turbolens"><AssessmentViewer /></ModuleGate>} />
                <Route path="/admin/turbolens" element={<Navigate to="/admin/settings?tab=turbolens" />} />
                <Route path="/capability-catalogue" element={<CapabilityCataloguePage />} />
                <Route path="/process-catalogue" element={<ProcessCataloguePage />} />
                <Route path="/value-stream-catalogue" element={<ValueStreamCataloguePage />} />
                <Route path="/principles-catalogue" element={<PrinciplesCataloguePage />} />
                <Route path="*" element={<Navigate to="/" />} />
              </Routes>
            </Suspense>
          </AppLayout>
          </AuthProvider>
        }
      />
    </Routes>
  );
}

export default function App() {
  const themeModeState = useThemeModeState();
  const theme = useMemo(() => buildTheme(themeModeState.mode), [themeModeState.mode]);

  return (
    <ThemeModeContext.Provider value={themeModeState}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </ThemeProvider>
    </ThemeModeContext.Provider>
  );
}
