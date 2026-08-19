import { Box, Tab, Tabs } from "@mui/material";
import { Suspense, lazy, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import MaterialSymbol from "@/components/MaterialSymbol";
import { hasPermission } from "@/components/RequirePermission";
import { useAuthContext } from "@/hooks/AuthContext";
import { ExtensionBoundary, useExtensionIntegrationPanels } from "@/lib/extensionHost";

const ServiceNowAdmin = lazy(() => import("./ServiceNowAdmin"));

/**
 * Container for every integration's configuration, grouped under the single
 * Admin → Settings → Integrations tab: the built-in ServiceNow sync first,
 * then one sub-tab per extension-contributed integration panel
 * (`integrationPanels`, UI SDK 1.16) — so an integration added by an
 * extension is configured in the same place, with the same chrome, as the
 * built-in one. Entries whose `permission` the viewer lacks are hidden
 * silently, and every extension panel renders inside an ExtensionBoundary so
 * a crashing panel can never take the Settings page down.
 */
export default function IntegrationsHub() {
  const { t } = useTranslation("admin");
  const { user } = useAuthContext();
  const [tab, setTab] = useState(0);
  const panels = useExtensionIntegrationPanels();

  const visiblePanels = useMemo(
    () =>
      panels.filter(
        ({ contribution }) =>
          !contribution.permission || hasPermission(user?.permissions, contribution.permission),
      ),
    [panels, user?.permissions],
  );

  // Clamp: if the selected extension sub-tab disappears (uninstall/lapse), fall
  // back to ServiceNow instead of rendering an empty pane.
  const activeTab = tab > visiblePanels.length ? 0 : tab;

  return (
    <Box>
      <Tabs
        value={activeTab}
        onChange={(_e, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 3, borderBottom: 1, borderColor: "divider" }}
      >
        <Tab label={t("settings.tabs.servicenow")} />
        {visiblePanels.map(({ extKey, contribution }) => (
          <Tab
            key={`${extKey}:${contribution.id}`}
            label={contribution.label}
            icon={
              contribution.icon ? (
                <MaterialSymbol icon={contribution.icon} size={18} />
              ) : undefined
            }
            iconPosition="start"
            sx={{ minHeight: 48 }}
          />
        ))}
      </Tabs>

      {activeTab === 0 && (
        <Suspense fallback={null}>
          <ServiceNowAdmin />
        </Suspense>
      )}
      {activeTab > 0 &&
        (() => {
          const entry = visiblePanels[activeTab - 1];
          if (!entry) return null;
          const Panel = entry.contribution.component;
          return (
            <ExtensionBoundary
              key={`${entry.extKey}:${entry.contribution.id}`}
              extensionKey={entry.extKey}
            >
              <Panel />
            </ExtensionBoundary>
          );
        })()}
    </Box>
  );
}
