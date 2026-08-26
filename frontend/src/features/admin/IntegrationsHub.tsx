import { Box, Tab, Tabs } from "@mui/material";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";

import MaterialSymbol from "@/components/MaterialSymbol";
import { hasPermission } from "@/components/RequirePermission";
import { useAuthContext } from "@/hooks/AuthContext";
import { ExtensionBoundary, useExtensionIntegrationPanels } from "@/lib/extensionHost";

const ServiceNowAdmin = lazy(() => import("./ServiceNowAdmin"));

const STORAGE_KEY = "turboea.settings.integration";
const SERVICENOW_KEY = "servicenow";

/** Stable, URL-safe key for an extension panel: `<extension>.<panel id>`. */
function panelKey(extKey: string, id: string): string {
  return `${extKey}.${id}`;
}

function readStoredIntegration(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Container for every integration's configuration, grouped under the single
 * Admin → Settings → Integrations tab: the built-in ServiceNow sync first,
 * then one sub-tab per extension-contributed integration panel
 * (`integrationPanels`, UI SDK 1.16) — so an integration added by an
 * extension is configured in the same place, with the same chrome, as the
 * built-in one. Entries whose `permission` the viewer lacks are hidden
 * silently, and every extension panel renders inside an ExtensionBoundary so
 * a crashing panel can never take the Settings page down.
 *
 * The selected sub-tab is remembered in two tiers — a valid `integration` query
 * param wins, then localStorage, then ServiceNow — the same shape GovernanceTab
 * uses for its own sub-tab. The URL tier makes a reload and a shared deep link
 * land on the same integration; the localStorage tier covers leaving for another
 * Settings tab and coming back, which the URL alone cannot, because
 * SettingsAdmin's tab handler rebuilds the query string from scratch and drops
 * every other param.
 *
 * Both tiers carry the panel's stable key, never its index: extensions install,
 * uninstall and reorder, and an index would silently point at a different
 * integration after any of those. The key is resolved against the live panel
 * list at render rather than validated when read, because that list is dynamic —
 * so a stored key still lands once the extension host has registered its panels,
 * and one whose extension is gone falls through to ServiceNow on its own.
 */
export default function IntegrationsHub() {
  const { t } = useTranslation("admin");
  const { user } = useAuthContext();
  const [params, setParams] = useSearchParams();
  const panels = useExtensionIntegrationPanels();

  const visiblePanels = useMemo(
    () =>
      panels.filter(
        ({ contribution }) =>
          !contribution.permission || hasPermission(user?.permissions, contribution.permission),
      ),
    [panels, user?.permissions],
  );

  const paramKey = params.get("integration");
  // localStorage is read once, in the lazy initializer, so it can never fight a
  // later sub-tab click.
  const [selected, setSelected] = useState<string | null>(
    () => paramKey ?? readStoredIntegration(),
  );

  // Adopt a URL param that arrives later — a deep link, or back/forward.
  useEffect(() => {
    if (paramKey && paramKey !== selected) setSelected(paramKey);
  }, [paramKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // An unknown key — an extension uninstalled or lapsed since the link was made,
  // a hand-typed value — resolves to -1 and falls back to ServiceNow rather than
  // rendering an empty pane.
  const requestedIndex = visiblePanels.findIndex(
    ({ extKey, contribution }) => panelKey(extKey, contribution.id) === selected,
  );
  const activeTab = requestedIndex >= 0 ? requestedIndex + 1 : 0;

  // Remember the last integration across visits — but only once the selection
  // has actually resolved to a live panel (or is an explicit ServiceNow pick).
  // A key that resolves to nothing is left alone rather than flattened to
  // ServiceNow: an extension bundle that registers its panel after first paint
  // would otherwise have the user's stored choice overwritten in the gap.
  const resolved = requestedIndex >= 0 || selected === SERVICENOW_KEY;
  useEffect(() => {
    if (!resolved || !selected) return;
    try {
      localStorage.setItem(STORAGE_KEY, selected);
    } catch {
      /* ignore storage errors (private mode / disabled) */
    }
  }, [resolved, selected]);

  const handleChange = (_e: unknown, value: number) => {
    const entry = value > 0 ? visiblePanels[value - 1] : undefined;
    setSelected(entry ? panelKey(entry.extKey, entry.contribution.id) : SERVICENOW_KEY);
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (entry) next.set("integration", panelKey(entry.extKey, entry.contribution.id));
        else next.delete("integration");
        return next;
      },
      { replace: true },
    );
  };

  return (
    <Box>
      <Tabs
        value={activeTab}
        onChange={handleChange}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 3, borderBottom: 1, borderColor: "divider" }}
      >
        <Tab label={t("settings.tabs.servicenow")} value={0} />
        {visiblePanels.map(({ extKey, contribution }, i) => (
          <Tab
            key={panelKey(extKey, contribution.id)}
            value={i + 1}
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
