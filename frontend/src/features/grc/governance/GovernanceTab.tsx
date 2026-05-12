import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import MaterialSymbol from "@/components/MaterialSymbol";

const AiInventoryPanel = lazy(() => import("./AiInventoryPanel"));
const PrinciplesPanel = lazy(() => import("./PrinciplesPanel"));
const DecisionsPanel = lazy(() => import("./DecisionsPanel"));

const SUB_KEYS = ["ai", "principles", "decisions"] as const;
type SubKey = (typeof SUB_KEYS)[number];

const SUB_ICONS: Record<SubKey, string> = {
  ai: "smart_toy",
  principles: "bookmark_star",
  decisions: "fact_check",
};

function PanelFallback() {
  return (
    <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
      <CircularProgress />
    </Box>
  );
}

export default function GovernanceTab() {
  const { t } = useTranslation("grc");
  const [searchParams, setSearchParams] = useSearchParams();
  const paramSub = searchParams.get("sub") as SubKey | null;
  const resolved = paramSub && SUB_KEYS.includes(paramSub) ? paramSub : "ai";
  const [sub, setSub] = useState<SubKey>(resolved);

  useEffect(() => {
    if (resolved !== sub) setSub(resolved);
  }, [resolved]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (_: React.SyntheticEvent, val: string) => {
    const next = val as SubKey;
    setSub(next);
    const params = new URLSearchParams(searchParams);
    params.set("tab", "governance");
    if (next === "ai") {
      params.delete("sub");
    } else {
      params.set("sub", next);
    }
    setSearchParams(params, { replace: true });
  };

  const labels: Record<SubKey, string> = useMemo(
    () => ({
      ai: t("governance.subtabs.ai"),
      principles: t("governance.subtabs.principles"),
      decisions: t("governance.subtabs.decisions"),
    }),
    [t],
  );

  return (
    <Box>
      <Tabs
        value={sub}
        onChange={handleChange}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}
      >
        {SUB_KEYS.map((key) => (
          <Tab
            key={key}
            value={key}
            label={labels[key]}
            icon={<MaterialSymbol icon={SUB_ICONS[key]} size={16} />}
            iconPosition="start"
            sx={{ minHeight: 40, textTransform: "none", fontSize: "0.875rem" }}
          />
        ))}
      </Tabs>
      <Suspense fallback={<PanelFallback />}>
        {sub === "ai" && <AiInventoryPanel />}
        {sub === "principles" && <PrinciplesPanel />}
        {sub === "decisions" && <DecisionsPanel />}
      </Suspense>
    </Box>
  );
}
