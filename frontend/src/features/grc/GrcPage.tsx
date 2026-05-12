import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";

const GovernanceTab = lazy(() => import("./governance/GovernanceTab"));
const RiskRegisterPage = lazy(
  () => import("@/features/grc/risk/RiskRegisterPage"),
);
const ComplianceTab = lazy(() => import("./compliance/ComplianceTab"));

const TAB_KEYS = ["governance", "risk", "compliance"] as const;
type TabKey = (typeof TAB_KEYS)[number];

const TAB_ICONS: Record<TabKey, string> = {
  governance: "gavel",
  risk: "warning",
  compliance: "shield",
};

function TabFallback() {
  return (
    <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
      <CircularProgress />
    </Box>
  );
}

export default function GrcPage() {
  const { t } = useTranslation("grc");
  const [searchParams, setSearchParams] = useSearchParams();
  const paramTab = searchParams.get("tab") as TabKey | null;
  const resolvedTab = paramTab && TAB_KEYS.includes(paramTab) ? paramTab : "governance";
  const [tab, setTab] = useState<TabKey>(resolvedTab);

  useEffect(() => {
    if (resolvedTab !== tab) setTab(resolvedTab);
  }, [resolvedTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (_: React.SyntheticEvent, val: string) => {
    const next = val as TabKey;
    setTab(next);
    const params = new URLSearchParams(searchParams);
    if (next === "governance") {
      params.delete("tab");
    } else {
      params.set("tab", next);
      params.delete("sub");
    }
    setSearchParams(params, { replace: true });
  };

  const labels: Record<TabKey, string> = useMemo(
    () => ({
      governance: t("tabs.governance"),
      risk: t("tabs.risk"),
      compliance: t("tabs.compliance"),
    }),
    [t],
  );

  return (
    <Box>
      {/* Header + tabs — matches the BPM page shell (tight padding, single
          borderBottom under the tabs, no subtitle). */}
      <Box
        sx={{
          px: { xs: 2, md: 3 },
          pt: { xs: 2, md: 2.5 },
          borderBottom: 1,
          borderColor: "divider",
          mb: 2,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
          <MaterialSymbol icon="policy" size={28} color="#1976d2" />
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            {t("page.title")}
          </Typography>
        </Box>
        <Tabs value={tab} onChange={handleChange} variant="scrollable" scrollButtons="auto">
          {TAB_KEYS.map((key) => (
            <Tab
              key={key}
              value={key}
              label={labels[key]}
              icon={<MaterialSymbol icon={TAB_ICONS[key]} size={18} />}
              iconPosition="start"
              sx={{ minHeight: 42, textTransform: "none" }}
            />
          ))}
        </Tabs>
      </Box>
      <Suspense fallback={<TabFallback />}>
        {tab === "governance" && <GovernanceTab />}
        {tab === "risk" && <RiskRegisterPage />}
        {tab === "compliance" && <ComplianceTab />}
      </Suspense>
    </Box>
  );
}
