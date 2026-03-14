import { lazy, Suspense, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";

const ArchLensDashboard = lazy(() => import("./ArchLensDashboard"));
const ArchLensVendors = lazy(() => import("./ArchLensVendors"));
const ArchLensResolution = lazy(() => import("./ArchLensResolution"));
const ArchLensDuplicates = lazy(() => import("./ArchLensDuplicates"));
const ArchLensArchitect = lazy(() => import("./ArchLensArchitect"));
const ArchLensHistory = lazy(() => import("./ArchLensHistory"));

const TAB_KEYS = [
  "dashboard",
  "vendors",
  "resolution",
  "duplicates",
  "architect",
  "history",
] as const;

type TabKey = (typeof TAB_KEYS)[number];

const TAB_ICONS: Record<TabKey, string> = {
  dashboard: "psychology",
  vendors: "storefront",
  resolution: "account_tree",
  duplicates: "content_copy",
  architect: "architecture",
  history: "history",
};

function TabFallback() {
  return (
    <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
      <CircularProgress />
    </Box>
  );
}

export default function ArchLensPage() {
  const { t } = useTranslation("nav");
  const [searchParams, setSearchParams] = useSearchParams();
  const paramTab = searchParams.get("tab") as TabKey | null;
  const initialTab = paramTab && TAB_KEYS.includes(paramTab) ? paramTab : "dashboard";
  const [tab, setTab] = useState<TabKey>(initialTab);

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
      dashboard: t("archlens.dashboard"),
      vendors: t("archlens.vendors"),
      resolution: t("archlens.resolution"),
      duplicates: t("archlens.duplicates"),
      architect: t("archlens.architect"),
      history: t("archlens.history"),
    }),
    [t],
  );

  return (
    <Box>
      <Typography variant="h5" fontWeight="bold" sx={{ mb: 2 }}>
        ArchLens
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
        {tab === "dashboard" && <ArchLensDashboard />}
        {tab === "vendors" && <ArchLensVendors />}
        {tab === "resolution" && <ArchLensResolution />}
        {tab === "duplicates" && <ArchLensDuplicates />}
        {tab === "architect" && <ArchLensArchitect />}
        {tab === "history" && <ArchLensHistory />}
      </Suspense>
    </Box>
  );
}
