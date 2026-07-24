import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useAuthContext } from "@/hooks/AuthContext";
import { api } from "@/api/client";
import type { DashboardTabKey } from "@/types";
import AdminTab from "./admin/AdminTab";
import OverviewTab from "./OverviewTab";
import WorkspaceTab from "./workspace/WorkspaceTab";

const ADMIN_TAB_PERMISSION = "admin.users";

function isValidTab(value: string | null): value is DashboardTabKey {
  return value === "overview" || value === "workspace" || value === "admin";
}

interface PinTabLabelProps {
  label: string;
  isDefault: boolean;
  onTogglePin: () => void;
  setAsDefaultTooltip: string;
  unsetAsDefaultTooltip: string;
}

function PinTabLabel({
  label,
  isDefault,
  onTogglePin,
  setAsDefaultTooltip,
  unsetAsDefaultTooltip,
}: PinTabLabelProps) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
      <span>{label}</span>
      <Tooltip title={isDefault ? unsetAsDefaultTooltip : setAsDefaultTooltip}>
        <IconButton
          size="small"
          aria-label={isDefault ? unsetAsDefaultTooltip : setAsDefaultTooltip}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin();
          }}
          sx={{ p: 0.25, ml: 0.25 }}
        >
          <MaterialSymbol
            icon="push_pin"
            size={16}
            color={isDefault ? "#1976d2" : "#9e9e9e"}
            style={isDefault ? { fontVariationSettings: "'FILL' 1" } : undefined}
          />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

export default function Dashboard() {
  const { t } = useTranslation("common");
  const { user, refreshUser } = useAuthContext();
  const [searchParams, setSearchParams] = useSearchParams();

  const isAdmin =
    !!user?.permissions?.["*"] || !!user?.permissions?.[ADMIN_TAB_PERMISSION];
  const validTabs = useMemo<DashboardTabKey[]>(
    () => (isAdmin ? ["overview", "workspace", "admin"] : ["overview", "workspace"]),
    [isAdmin],
  );

  const rawTab = searchParams.get("tab");
  const preferredTabRaw: DashboardTabKey =
    user?.ui_preferences?.dashboard_default_tab ?? "overview";
  // Guard against a stale preference / URL pointing at the admin tab when the
  // user no longer has permission to see it.
  const preferredTab: DashboardTabKey = validTabs.includes(preferredTabRaw)
    ? preferredTabRaw
    : "overview";
  const requestedTab: DashboardTabKey = isValidTab(rawTab) ? rawTab : preferredTab;
  const activeTab: DashboardTabKey = validTabs.includes(requestedTab)
    ? requestedTab
    : preferredTab;

  // If the URL has no explicit ?tab=, write the resolved tab back so deep
  // links and refreshes are stable. Only run when there is no rawTab.
  useEffect(() => {
    if (rawTab === null) {
      const next = new URLSearchParams(searchParams);
      next.set("tab", activeTab);
      setSearchParams(next, { replace: true });
    }
  }, [rawTab, activeTab, searchParams, setSearchParams]);

  const setActiveTab = useCallback(
    (tab: DashboardTabKey) => {
      const next = new URLSearchParams(searchParams);
      next.set("tab", tab);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const togglePin = useCallback(
    async (tab: DashboardTabKey) => {
      const isAlreadyDefault = preferredTab === tab;
      const nextValue: DashboardTabKey | null = isAlreadyDefault ? null : tab;
      try {
        await api.patch("/users/me/ui-preferences", {
          dashboard_default_tab: nextValue,
        });
        await refreshUser();
      } catch (err) {
        console.error("Failed to persist dashboard pin preference", err);
      }
    },
    [preferredTab, refreshUser],
  );

  const tabConfigs = useMemo(
    () =>
      validTabs.map((key) => ({
        key,
        label: t(`dashboard.tabs.${key}`),
      })),
    [t, validTabs],
  );

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
        <Typography variant="h5" fontWeight={600}>
          {t("dashboard.title")}
        </Typography>
      </Box>

      <Tabs
        value={activeTab}
        onChange={(_, value) => setActiveTab(value as DashboardTabKey)}
        sx={{ mb: 3, borderBottom: 1, borderColor: "divider" }}
      >
        {tabConfigs.map((tab) => (
          <Tab
            key={tab.key}
            value={tab.key}
            label={
              <PinTabLabel
                label={tab.label}
                isDefault={preferredTab === tab.key}
                onTogglePin={() => togglePin(tab.key)}
                setAsDefaultTooltip={t("dashboard.pinAsDefault")}
                unsetAsDefaultTooltip={t("dashboard.unpinDefault")}
              />
            }
          />
        ))}
      </Tabs>

      {activeTab === "overview" && <OverviewTab />}
      {activeTab === "workspace" && <WorkspaceTab />}
      {activeTab === "admin" && isAdmin && <AdminTab />}
    </Box>
  );
}
