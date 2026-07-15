import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import MaterialSymbol from "@/components/MaterialSymbol";

const PrinciplesPanel = lazy(() => import("./PrinciplesPanel"));
const DecisionsPanel = lazy(() => import("./DecisionsPanel"));

const SUB_KEYS = ["principles", "decisions"] as const;
type SubKey = (typeof SUB_KEYS)[number];

const STORAGE_KEY = "turboea.grc.governance.sub";

function readStoredSub(): SubKey | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && SUB_KEYS.includes(v as SubKey) ? (v as SubKey) : null;
  } catch {
    return null;
  }
}

const SUB_ICONS: Record<SubKey, string> = {
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
  const validParam = paramSub && SUB_KEYS.includes(paramSub) ? paramSub : null;
  // Priority: valid URL param > localStorage > default. localStorage is read
  // only once (lazy initializer) so it never fights a subsequent sub-tab click.
  const [sub, setSub] = useState<SubKey>(
    () => validParam ?? readStoredSub() ?? "principles",
  );

  // Sync only from a present, valid URL param (deep link / back-forward).
  useEffect(() => {
    if (validParam && validParam !== sub) setSub(validParam);
  }, [validParam]); // eslint-disable-line react-hooks/exhaustive-deps

  // Remember the last active governance sub-tab across visits.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, sub);
    } catch {
      /* ignore storage errors (private mode / disabled) */
    }
  }, [sub]);

  const handleChange = (_: React.SyntheticEvent, val: string) => {
    const next = val as SubKey;
    setSub(next);
    const params = new URLSearchParams(searchParams);
    params.set("tab", "governance");
    if (next === "principles") {
      params.delete("sub");
    } else {
      params.set("sub", next);
    }
    setSearchParams(params, { replace: true });
  };

  const labels: Record<SubKey, string> = useMemo(
    () => ({
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
        {sub === "principles" && <PrinciplesPanel />}
        {sub === "decisions" && <DecisionsPanel />}
      </Suspense>
    </Box>
  );
}
