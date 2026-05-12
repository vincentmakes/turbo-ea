import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import MaterialSymbol from "@/components/MaterialSymbol";

const PpmPortfolio = lazy(() => import("./PpmPortfolio"));
const EaDeliveryReport = lazy(() => import("@/features/reports/EaDeliveryReport"));

const TAB_KEYS = ["portfolio", "ea-delivery"] as const;
type TabKey = (typeof TAB_KEYS)[number];

const TAB_ICONS: Record<TabKey, string> = {
  portfolio: "view_timeline",
  "ea-delivery": "architecture",
};

function TabFallback() {
  return (
    <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
      <CircularProgress />
    </Box>
  );
}

/**
 * PPM home — tab container.
 *
 * The Portfolio Gantt was the original /ppm landing. The EA Delivery report
 * (relocated Initiatives + SoAW + ADR workspace) now lives alongside it as
 * a second tab so initiative managers see strategy + execution in one place.
 *
 * EA Delivery also keeps its standalone /reports/ea-delivery route so it
 * stays reachable when PPM is disabled. The Reports dropdown re-injects an
 * EA Delivery entry in that case (see AppLayout's nav memo).
 */
export default function PpmHome() {
  const { t } = useTranslation("ppm");
  const [searchParams, setSearchParams] = useSearchParams();
  const paramTab = searchParams.get("tab") as TabKey | null;
  const resolvedTab: TabKey =
    paramTab && (TAB_KEYS as readonly string[]).includes(paramTab) ? paramTab : "portfolio";
  const [tab, setTab] = useState<TabKey>(resolvedTab);

  useEffect(() => {
    if (resolvedTab !== tab) setTab(resolvedTab);
  }, [resolvedTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (_: React.SyntheticEvent, val: string) => {
    const next = val as TabKey;
    setTab(next);
    const params = new URLSearchParams(searchParams);
    if (next === "portfolio") {
      params.delete("tab");
    } else {
      params.set("tab", next);
    }
    setSearchParams(params, { replace: true });
  };

  const labels: Record<TabKey, string> = useMemo(
    () => ({
      portfolio: t("tabs.portfolio"),
      "ea-delivery": t("tabs.eaDelivery"),
    }),
    [t],
  );

  return (
    <Box>
      <Tabs
        value={tab}
        onChange={handleChange}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}
      >
        {TAB_KEYS.map((key) => (
          <Tab
            key={key}
            value={key}
            label={labels[key]}
            icon={<MaterialSymbol icon={TAB_ICONS[key]} size={18} />}
            iconPosition="start"
            sx={{ minHeight: 48, textTransform: "none" }}
          />
        ))}
      </Tabs>
      <Suspense fallback={<TabFallback />}>
        {tab === "portfolio" && <PpmPortfolio />}
        {tab === "ea-delivery" && <EaDeliveryReport />}
      </Suspense>
    </Box>
  );
}
