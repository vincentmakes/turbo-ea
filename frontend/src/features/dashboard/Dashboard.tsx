/**
 * The homepage: one tab per dashboard (`GET /dashboards`), each a grid of
 * widgets. A tab is shown only when the viewer may see at least one of its
 * widgets — that is how the Overview and Admin tabs stay hidden from roles
 * without `reports.ea_dashboard` / `admin.users` while `/` itself stays
 * ungated. Managers (`admin.dashboards`) see every dashboard, hidden and
 * empty ones included, and get Customize mode and the dashboards menu.
 *
 * `?tab=<key>` selects the dashboard; the user's pinned default
 * (`ui_preferences.dashboard_default_tab`) is used when there is none, and a
 * stale pin or link falls back to the first tab.
 *
 * Customize mode edits a local draft with undo / redo (`useDraftHistory`,
 * also on Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z or +Y); Save sends it in one PATCH.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useAuthContext } from "@/hooks/AuthContext";
import { useApiQuery } from "@/hooks/useApiQuery";
import { STATUS_COLORS } from "@/theme/tokens";
import type { Dashboard as DashboardModel, DashboardWidget } from "@/types";
import { DashboardSourcesProvider } from "./DashboardSources";
import DashboardGrid from "./DashboardGrid";
import AddWidgetDrawer from "./customize/AddWidgetDrawer";
import type { CatalogueEntry } from "./customize/catalogue";
import DashboardsMenu, { type DashboardsChange } from "./customize/DashboardsMenu";
import WidgetConfigDialog from "./customize/WidgetConfigDialog";
import { canManageDashboards, dashboardLabel } from "./customize/dashboardUtils";
import { newWidgetId, newWidgetLayout } from "./layoutUtils";
import { useDashboardModules } from "./useDashboardModules";
import { isEditableTarget, undoRedoAction, useDraftHistory } from "./useDraftHistory";
import { visibleWidgets } from "./widgets/widgetMeta";

interface PinTabLabelProps {
  label: string;
  hidden: boolean;
  hiddenLabel: string;
  isDefault: boolean;
  onTogglePin: () => void;
  setAsDefaultTooltip: string;
  unsetAsDefaultTooltip: string;
}

function PinTabLabel({
  label,
  hidden,
  hiddenLabel,
  isDefault,
  onTogglePin,
  setAsDefaultTooltip,
  unsetAsDefaultTooltip,
}: PinTabLabelProps) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
      <span className="dashboard-tab-label">{label}</span>
      {hidden && (
        <Chip
          size="small"
          variant="outlined"
          icon={<MaterialSymbol icon="visibility_off" size={14} />}
          label={hiddenLabel}
          sx={{ height: 20, ml: 0.5, "& .MuiChip-label": { px: 0.75 } }}
        />
      )}
      <Tooltip title={isDefault ? unsetAsDefaultTooltip : setAsDefaultTooltip}>
        <IconButton
          size="small"
          component="span"
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
            color={isDefault ? STATUS_COLORS.info : STATUS_COLORS.neutral}
            style={isDefault ? { fontVariationSettings: "'FILL' 1" } : undefined}
          />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

interface ConfigTarget {
  widget: DashboardWidget;
  mode: "create" | "edit";
}

export default function Dashboard() {
  const { t, i18n } = useTranslation("common");
  const { user, refreshUser } = useAuthContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const permissions = user?.permissions;
  const isManager = canManageDashboards(permissions);
  const modules = useDashboardModules();

  const { data, loading, error, refetch } = useApiQuery<DashboardModel[]>("/dashboards");
  // A just-saved dashboard, shown until the refetch lands so the grid never
  // flashes back to the previous layout.
  const [saved, setSaved] = useState<Record<string, DashboardModel>>({});
  useEffect(() => setSaved({}), [data]);

  const dashboards = useMemo(() => (data ?? []).map((d) => saved[d.id] ?? d), [data, saved]);

  const [editing, setEditing] = useState(false);
  const {
    present: draft,
    set: setDraft,
    reset: resetDraft,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useDraftHistory<DashboardWidget[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [configTarget, setConfigTarget] = useState<ConfigTarget | null>(null);
  const [pendingEdit, setPendingEdit] = useState<string | null>(null);

  const tabs = useMemo(
    () =>
      dashboards.filter((d) => isManager || visibleWidgets(d.widgets ?? [], permissions, modules).length > 0),
    [dashboards, isManager, permissions, modules],
  );
  const tabKeys = useMemo(() => tabs.map((d) => d.key), [tabs]);

  const rawTab = searchParams.get("tab");
  const fallbackTab: string | undefined = tabKeys[0];
  const pinned = user?.ui_preferences?.dashboard_default_tab;
  // Guard against a stale preference (a deleted dashboard, or one the user
  // may no longer see).
  const preferredTab = pinned && tabKeys.includes(pinned) ? pinned : fallbackTab;
  const activeTab = rawTab && tabKeys.includes(rawTab) ? rawTab : preferredTab;
  const active = tabs.find((d) => d.key === activeTab) ?? null;

  // With no explicit ?tab=, write the resolved tab back so deep links and
  // refreshes are stable.
  useEffect(() => {
    if (rawTab === null && activeTab) {
      const next = new URLSearchParams(searchParams);
      next.set("tab", activeTab);
      setSearchParams(next, { replace: true });
    }
  }, [rawTab, activeTab, searchParams, setSearchParams]);

  const setActiveTab = useCallback(
    (key: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (key) next.set("tab", key);
      else next.delete("tab");
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const togglePin = useCallback(
    async (key: string) => {
      const nextValue: string | null = preferredTab === key ? null : key;
      try {
        await api.patch("/users/me/ui-preferences", { dashboard_default_tab: nextValue });
        await refreshUser();
      } catch (err) {
        console.error("Failed to persist dashboard pin preference", err);
      }
    },
    [preferredTab, refreshUser],
  );

  const startEditing = useCallback(
    (dashboard: DashboardModel) => {
      resetDraft(dashboard.widgets ?? []);
      setSaveError(null);
      setEditing(true);
    },
    [resetDraft],
  );

  const stopEditing = useCallback(() => {
    setEditing(false);
    resetDraft(null);
    setSaveError(null);
    setDrawerOpen(false);
    setConfigTarget(null);
  }, [resetDraft]);

  // Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (or +Y) step through the draft while
  // the grid has the stage; a text field keeps its own undo.
  const shortcutsActive = editing && !drawerOpen && configTarget === null;
  useEffect(() => {
    if (!shortcutsActive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const action = undoRedoAction(event);
      if (!action) return;
      event.preventDefault();
      if (action === "undo") undo();
      else redo();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [shortcutsActive, undo, redo]);

  // A dashboard just created opens in customize mode once it has arrived.
  useEffect(() => {
    if (pendingEdit && active?.key === pendingEdit) {
      setPendingEdit(null);
      startEditing(active);
    }
  }, [pendingEdit, active, startEditing]);

  const handleChanged = useCallback(
    (change: DashboardsChange) => {
      stopEditing();
      if (change.removed) setActiveTab(null);
      else if (change.select) setActiveTab(change.select);
      if (change.edit && change.select) setPendingEdit(change.select);
      refetch();
    },
    [refetch, setActiveTab, stopEditing],
  );

  const widgets = useMemo(
    () => (editing && draft ? draft : (active?.widgets ?? [])),
    [editing, draft, active],
  );
  const shown = useMemo(() => visibleWidgets(widgets, permissions, modules), [widgets, permissions, modules]);
  const dirty = editing && !!active && JSON.stringify(draft) !== JSON.stringify(active.widgets ?? []);

  // Widgets the viewer cannot see stay in the draft untouched; only the
  // visible ones are laid out, configured or removed.
  const updateVisible = useCallback(
    (next: DashboardWidget[]) => {
      setDraft((current) => {
        const byId = new Map(next.map((w) => [w.id, w]));
        return (current ?? []).map((w) => byId.get(w.id) ?? w);
      });
    },
    [setDraft],
  );

  const handleSave = async () => {
    if (!active || !draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await api.patch<DashboardModel>(`/dashboards/${active.id}`, { widgets: draft });
      setSaved((s) => ({ ...s, [active.id]: result ?? { ...active, widgets: draft } }));
      stopEditing();
      refetch();
    } catch (err) {
      setSaveError(err instanceof Error && err.message ? err.message : t("dashboard.customize.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const addWidget = (widget: DashboardWidget) => setDraft((current) => [...(current ?? []), widget]);

  const handlePick = (entry: CatalogueEntry) => {
    const current = draft ?? [];
    const widget: DashboardWidget = {
      id: newWidgetId(entry.type, current),
      type: entry.type,
      title: null,
      config: structuredClone(entry.config),
      layout: newWidgetLayout(entry.type, current),
    };
    setDrawerOpen(false);
    if (entry.needsConfig) setConfigTarget({ widget, mode: "create" });
    else addWidget(widget);
  };

  const handleConfigSave = (widget: DashboardWidget) => {
    if (configTarget?.mode === "create") addWidget(widget);
    else setDraft((current) => (current ?? []).map((w) => (w.id === widget.id ? widget : w)));
    setConfigTarget(null);
  };

  const label = (d: DashboardModel) => dashboardLabel(d, i18n.language);

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2, flexWrap: "wrap" }}>
        <Typography variant="h5" fontWeight={600} sx={{ flex: 1 }}>
          {t("dashboard.title")}
        </Typography>
        {isManager && active && !editing && (
          <Button
            variant="outlined"
            size="small"
            startIcon={<MaterialSymbol icon="dashboard_customize" size={18} />}
            onClick={() => startEditing(active)}
          >
            {t("dashboard.customize.customize")}
          </Button>
        )}
        {editing && (
          <>
            {dirty && <Chip size="small" color="warning" variant="outlined" label={t("dashboard.customize.unsavedChanges")} />}
            <Tooltip title={t("actions.undo")}>
              {/* span wrapper so the Tooltip works while the button is disabled */}
              <span>
                <IconButton
                  size="small"
                  aria-label={t("actions.undo")}
                  disabled={!canUndo}
                  onClick={undo}
                  data-testid="dashboard-undo"
                >
                  <MaterialSymbol icon="undo" size={20} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={t("actions.redo")}>
              <span>
                <IconButton
                  size="small"
                  aria-label={t("actions.redo")}
                  disabled={!canRedo}
                  onClick={redo}
                  data-testid="dashboard-redo"
                >
                  <MaterialSymbol icon="redo" size={20} />
                </IconButton>
              </span>
            </Tooltip>
            <Button
              variant="outlined"
              size="small"
              startIcon={<MaterialSymbol icon="add" size={18} />}
              onClick={() => setDrawerOpen(true)}
            >
              {t("dashboard.customize.addWidget")}
            </Button>
            <Button size="small" onClick={stopEditing} disabled={saving}>
              {dirty ? t("dashboard.customize.discard") : t("actions.done")}
            </Button>
            <Button variant="contained" size="small" onClick={handleSave} disabled={!dirty || saving}>
              {t("actions.save")}
            </Button>
          </>
        )}
        {isManager && !editing && (
          <DashboardsMenu
            dashboard={active}
            dashboards={dashboards}
            label={active ? label(active) : ""}
            onChanged={handleChanged}
          />
        )}
      </Box>

      {error && !data && <Alert severity="error">{t("dashboard.loadFailed")}</Alert>}
      {loading && !data && <LinearProgress />}

      {tabs.length > 0 && activeTab && (
        <Tabs
          value={activeTab}
          onChange={(_, value) => setActiveTab(value as string)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ mb: 3, borderBottom: 1, borderColor: "divider" }}
        >
          {tabs.map((d) => (
            <Tab
              key={d.key}
              value={d.key}
              disabled={editing && d.key !== activeTab}
              label={
                <PinTabLabel
                  label={label(d)}
                  hidden={d.is_hidden}
                  hiddenLabel={t("dashboard.menu.hiddenChip")}
                  isDefault={preferredTab === d.key}
                  onTogglePin={() => togglePin(d.key)}
                  setAsDefaultTooltip={t("dashboard.pinAsDefault")}
                  unsetAsDefaultTooltip={t("dashboard.unpinDefault")}
                />
              }
            />
          ))}
        </Tabs>
      )}

      {saveError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setSaveError(null)}>
          {saveError}
        </Alert>
      )}
      {editing && (
        <Alert severity="info" sx={{ mb: 2 }} icon={<MaterialSymbol icon="dashboard_customize" size={20} />}>
          {t("dashboard.customize.editingHint")}
        </Alert>
      )}

      {active && shown.length === 0 && (
        <Box sx={{ py: 6, textAlign: "center" }} data-testid="dashboard-empty">
          <Typography color="text.secondary">
            {widgets.length === 0 ? t("dashboard.customize.empty") : t("dashboard.customize.noVisibleWidgets")}
          </Typography>
          {isManager && !editing && widgets.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t("dashboard.customize.emptyHint")}
            </Typography>
          )}
        </Box>
      )}

      {active && shown.length > 0 && (
        <DashboardSourcesProvider key={active.id} widgets={shown} modules={modules}>
          <DashboardGrid
            widgets={shown}
            editing={editing}
            onLayoutChange={updateVisible}
            onConfigure={(widget) => setConfigTarget({ widget, mode: "edit" })}
            onRemove={(widget) => setDraft((current) => (current ?? []).filter((w) => w.id !== widget.id))}
          />
        </DashboardSourcesProvider>
      )}

      {editing && (
        <AddWidgetDrawer
          open={drawerOpen}
          widgets={draft ?? []}
          modules={modules}
          onClose={() => setDrawerOpen(false)}
          onPick={handlePick}
        />
      )}
      <WidgetConfigDialog
        open={configTarget !== null}
        widget={configTarget?.widget ?? null}
        mode={configTarget?.mode ?? "edit"}
        onClose={() => setConfigTarget(null)}
        onSave={handleConfigSave}
      />
    </Box>
  );
}
