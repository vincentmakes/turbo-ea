import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";

const TurboLensDashboard = lazy(() => import("./TurboLensDashboard"));
const TurboLensVendors = lazy(() => import("./TurboLensVendors"));
const TurboLensResolution = lazy(() => import("./TurboLensResolution"));
const TurboLensDuplicates = lazy(() => import("./TurboLensDuplicates"));
const TurboLensArchitect = lazy(() => import("./TurboLensArchitect"));
const TurboLensAssessments = lazy(() => import("./TurboLensAssessments"));
const TurboLensSecurity = lazy(() => import("./TurboLensSecurity"));
const TurboLensHistory = lazy(() => import("./TurboLensHistory"));

const TAB_KEYS = [
  "dashboard",
  "vendors",
  "resolution",
  "duplicates",
  "architect",
  "assessments",
  "security",
  "history",
] as const;

type TabKey = (typeof TAB_KEYS)[number];

const TAB_ICONS: Record<TabKey, string> = {
  dashboard: "psychology",
  vendors: "storefront",
  resolution: "account_tree",
  duplicates: "content_copy",
  architect: "architecture",
  assessments: "assignment",
  security: "shield",
  history: "history",
};

function TabFallback() {
  return (
    <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
      <CircularProgress />
    </Box>
  );
}

export default function TurboLensPage() {
  const { t } = useTranslation("nav");
  const [searchParams, setSearchParams] = useSearchParams();
  const paramTab = searchParams.get("tab") as TabKey | null;
  const resolvedTab = paramTab && TAB_KEYS.includes(paramTab) ? paramTab : "dashboard";
  const [tab, setTab] = useState<TabKey>(resolvedTab);

  // Sync tab with URL when search params change (e.g. resume navigation)
  useEffect(() => {
    if (resolvedTab !== tab) setTab(resolvedTab);
  }, [resolvedTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (_: React.SyntheticEvent, val: string) => {
    const key = val as TabKey;
    setTab(key);
    if (key === "dashboard") {
      setSearchParams({});
    } else {
      setSearchParams({ tab: key });
    }
  };

  const tabLabels: Record<TabKey, string> = useMemo(
    () => ({
      dashboard: t("turbolens.dashboard"),
      vendors: t("turbolens.vendors"),
      resolution: t("turbolens.resolution"),
      duplicates: t("turbolens.duplicates"),
      architect: t("turbolens.architect"),
      assessments: t("turbolens.assessments"),
      security: t("turbolens.security"),
      history: t("turbolens.history"),
    }),
    [t],
  );

  return (
    <Box>
      <Typography variant="h5" fontWeight="bold" sx={{ mb: 2 }}>
        TurboLens
      </Typography>
      <Tabs
        value={tab}
        onChange={handleChange}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ borderBottom: 1, borderColor: "divider", mb: 3 }}
      >
        {TAB_KEYS.map((key) => (
          <Tab
            key={key}
            value={key}
            label={tabLabels[key]}
            icon={<MaterialSymbol icon={TAB_ICONS[key]} size={18} />}
            iconPosition="start"
            sx={{ minHeight: 48, textTransform: "none" }}
          />
        ))}
      </Tabs>
      <Suspense fallback={<TabFallback />}>
        {tab === "dashboard" && <TurboLensDashboard />}
        {tab === "vendors" && <TurboLensVendors />}
        {tab === "resolution" && <TurboLensResolution />}
        {tab === "duplicates" && <TurboLensDuplicates />}
        {tab === "architect" && <TurboLensArchitect />}
        {tab === "assessments" && <TurboLensAssessments />}
        {tab === "security" && <TurboLensSecurity />}
        {tab === "history" && <TurboLensHistory />}
      </Suspense>
    </Box>
  );
}
