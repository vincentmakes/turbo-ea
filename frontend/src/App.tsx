import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import { CacheProvider } from "@emotion/react";
import CircularProgress from "@mui/material/CircularProgress";
import Box from "@mui/material/Box";
import i18n, { dirForLocale } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { AuthProvider } from "@/hooks/AuthContext";
import { ThemeModeContext, useThemeModeState } from "@/hooks/useThemeMode";
import { useAppTitle } from "@/hooks/useAppTitle";
import { buildTheme } from "@/theme";
import { ltrCache, rtlCache } from "@/theme/emotionCache";
import AppLayout from "@/layouts/AppLayout";
import LoginPage from "@/features/auth/LoginPage";
import SsoCallback from "@/features/auth/SsoCallback";
import SetPasswordPage from "@/features/auth/SetPasswordPage";
import ModuleGate from "@/components/ModuleGate";
import RequirePermission from "@/components/RequirePermission";

const ForgotPasswordPage = lazy(() => import("@/features/auth/ForgotPasswordPage"));
const ResetPasswordPage = lazy(() => import("@/features/auth/ResetPasswordPage"));

// --- Lazy-loaded page components (route-level code splitting) ---
const Dashboard = lazy(() => import("@/features/dashboard/Dashboard"));
const InventoryPage = lazy(() => import("@/features/inventory/InventoryPage"));
const CardDetail = lazy(() => import("@/features/cards/CardDetail"));
const ErrorBoundary = lazy(() => import("@/components/ErrorBoundary"));
const PortfolioReport = lazy(() => import("@/features/reports/PortfolioReport"));
const FlexiblePortfolioReport = lazy(() => import("@/features/reports/FlexiblePortfolioReport"));
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
const ExtensionsAdmin = lazy(() => import("@/features/admin/ExtensionsAdmin"));
const ExtensionRoutesOutlet = lazy(() => import("@/lib/ExtensionRoutesOutlet"));
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

  // Sync `document.title` for every route — authenticated and public alike —
  // so public pages (Web Portal, set-password, forgot/reset, SSO callback)
  // inherit the admin-configured Application Title instead of the static
  // «Turbo EA» default baked into index.html (#590).
  const appTitle = useAppTitle();
  useEffect(() => {
    document.title = appTitle;
  }, [appTitle]);

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
        {/* SSO callback route — shared by user login and SSO-gated portals */}
        <Route path="/auth/callback" element={<SsoCallback onSsoCallback={ssoCallback} />} />
        {/* Password setup route (for invited users) */}
        <Route path="/auth/set-password" element={<SetPasswordPage onSetPassword={setPassword} />} />
        {/* Forgot / reset password routes */}
        <Route
          path="/auth/forgot-password"
          element={<Suspense fallback={<PageLoader />}><ForgotPasswordPage /></Suspense>}
        />
        <Route
          path="/auth/reset-password"
          element={<Suspense fallback={<PageLoader />}><ResetPasswordPage /></Suspense>}
        />
        {/* Everything else redirects to login */}
        <Route path="*" element={<LoginPage onLogin={login} onRegister={register} />} />
      </Routes>
    );
  }

  return (
    <Routes>
      {/* Public portal route — also accessible when logged in */}
      <Route path="/portal/:slug" element={<Suspense fallback={<PageLoader />}><PortalViewer /></Suspense>} />
      {/* SSO callback — reachable while logged in too, so an admin previewing an
          SSO portal completes the portal sign-in on the same shared route. */}
      <Route path="/auth/callback" element={<SsoCallback onSsoCallback={ssoCallback} />} />
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
                <Route path="/reports/flexible-portfolio" element={<FlexiblePortfolioReport />} />
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
                <Route path="/grc" element={<ModuleGate module="grc"><GrcPage /></ModuleGate>} />
                <Route path="/grc/risks/:id" element={<ModuleGate module="grc"><RiskDetailPage /></ModuleGate>} />
                <Route path="/todos" element={<TodosPage />} />
                <Route path="/surveys" element={<Navigate to="/todos?tab=surveys" />} />
                <Route path="/surveys/:surveyId/respond/:cardId" element={<SurveyRespond />} />
                <Route path="/admin/metamodel" element={<RequirePermission permission="admin.metamodel"><MetamodelAdmin /></RequirePermission>} />
                <Route path="/admin/users" element={<RequirePermission permission="admin.users"><UsersAdmin /></RequirePermission>} />
                <Route path="/admin/settings" element={<RequirePermission permission="admin.settings"><SettingsAdmin /></RequirePermission>} />
                <Route path="/admin/eol" element={<RequirePermission permission="eol.manage"><Navigate to="/admin/settings?tab=eol" /></RequirePermission>} />
                <Route path="/admin/web-portals" element={<RequirePermission permission="web_portals.manage"><Navigate to="/admin/settings?tab=web-portals" /></RequirePermission>} />
                <Route path="/admin/servicenow" element={<RequirePermission permission="servicenow.manage"><Navigate to="/admin/settings?tab=servicenow" /></RequirePermission>} />
                <Route path="/admin/extensions" element={<RequirePermission permission="admin.manage_extensions"><ExtensionsAdmin /></RequirePermission>} />
                <Route path="/ext/*" element={<ExtensionRoutesOutlet />} />
                <Route path="/admin/surveys" element={<RequirePermission permission="surveys.manage"><SurveysAdmin /></RequirePermission>} />
                <Route path="/admin/surveys/new" element={<RequirePermission permission="surveys.manage"><SurveyBuilder /></RequirePermission>} />
                <Route path="/admin/surveys/:id/results" element={<RequirePermission permission="surveys.manage"><SurveyResults /></RequirePermission>} />
                <Route path="/admin/surveys/:id" element={<RequirePermission permission="surveys.manage"><SurveyBuilder /></RequirePermission>} />
                <Route path="/turbolens" element={<ModuleGate module="turbolens"><TurboLensPage /></ModuleGate>} />
                <Route path="/turbolens/assessments/:id" element={<ModuleGate module="turbolens"><AssessmentViewer /></ModuleGate>} />
                <Route path="/admin/turbolens" element={<RequirePermission permission="turbolens.manage"><Navigate to="/admin/settings?tab=turbolens" /></RequirePermission>} />
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

  // Track the active language reactively so direction (and the emotion cache)
  // updates whenever the locale changes — covers initial load, login
  // (useAuth) and the in-app language picker (AppLayout).
  const [language, setLanguage] = useState(i18n.language);
  useEffect(() => {
    const onChange = (lng: string) => setLanguage(lng);
    i18n.on("languageChanged", onChange);
    return () => {
      i18n.off("languageChanged", onChange);
    };
  }, []);

  const dir = dirForLocale(language);

  // Keep the document direction/lang in sync for native RTL behaviour
  // (scrollbars, text alignment, screen readers).
  useEffect(() => {
    document.documentElement.dir = dir;
    document.documentElement.lang = language || "en";
  }, [dir, language]);

  const theme = useMemo(() => buildTheme(themeModeState.mode, dir), [themeModeState.mode, dir]);

  return (
    <ThemeModeContext.Provider value={themeModeState}>
      <CacheProvider value={dir === "rtl" ? rtlCache : ltrCache}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </ThemeProvider>
      </CacheProvider>
    </ThemeModeContext.Provider>
  );
}
