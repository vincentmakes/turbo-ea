/**
 * What every widget type is — label, icon, family, default size, the
 * permission it needs and the shared sources it reads — without the React
 * components (`registry.ts` adds those). Kept apart so the data layer
 * (`DashboardSources`) and the frame can read it without importing every
 * widget.
 *
 * `WIDGET_TYPE_KEYS` mirrors `WIDGET_TYPES` in
 * `backend/app/services/dashboard_defaults.py`; `registry.test.ts` pins the
 * two together in both directions.
 */
import type { TFunction } from "i18next";
import { hasPermission } from "@/components/RequirePermission";
import type { DashboardQuery, DashboardWidget, WidgetType } from "@/types";
import { kpiPreset, type SourceName } from "./kpiPresets";
import {
  SOURCE_MODULES,
  SOURCE_PERMISSIONS,
  isModuleSource,
  seriesLabelKey,
  type ModuleKey,
  type ModuleSourceName,
} from "./sourceSeries";

/** Which optional modules are on. A flag not loaded yet counts as off, so a
 *  module widget never flashes in and out. */
export type DashboardModules = Record<ModuleKey, boolean>;

export const NO_MODULES: DashboardModules = { bpm: false, ppm: false, grc: false };

export type WidgetFamily = "kpi" | "chart" | "overview" | "workspace" | "admin";

/**
 * How the frame dresses the widget:
 * - `titled`: a card with the title row (charts, Browse by type);
 * - `card`: a card without a title row — the widget prints its own heading;
 * - `self`: the widget draws its own surface (a KPI tile, a workspace or
 *   admin section) and, in customize mode, places the frame's drag handle and
 *   buttons in its own top row (`useWidgetControls`) — the frame adds no card
 *   and no header in either mode.
 */
export type WidgetChrome = "titled" | "card" | "self";

export interface WidgetDefaultLayout {
  w: number;
  h: number;
  minW: number;
  minH: number;
}

export interface WidgetMeta {
  type: WidgetType;
  labelKey: string;
  icon: string;
  family: WidgetFamily;
  defaultLayout: WidgetDefaultLayout;
  /** Required to see the widget (resolved per preset for `kpi`). */
  permission?: string;
  /** Shared payloads read (resolved per preset for `kpi`). */
  sources: SourceName[];
  /** At most one per dashboard. */
  single: boolean;
  configurable?: "kpi" | "chart" | "activity";
  chrome: WidgetChrome;
}

const EA = "reports.ea_dashboard";
const ADMIN = "admin.users";

/** Sizes are in grid rows of about 60 px (the backend defaults use the same). */
const SECTION = { w: 6, h: 6, minW: 3, minH: 3 };

function section(
  type: WidgetType,
  family: "workspace" | "admin",
  labelKey: string,
  icon: string,
  sources: SourceName[] = [],
  layout: WidgetDefaultLayout = SECTION,
): WidgetMeta {
  return {
    type,
    labelKey,
    icon,
    family,
    defaultLayout: layout,
    permission: family === "admin" ? ADMIN : undefined,
    sources,
    single: true,
    chrome: "self",
  };
}

export const WIDGET_META: Record<WidgetType, WidgetMeta> = {
  kpi: {
    type: "kpi",
    labelKey: "dashboard.widgets.kpi",
    icon: "speed",
    family: "kpi",
    defaultLayout: { w: 3, h: 2, minW: 2, minH: 2 },
    permission: EA,
    sources: [],
    single: false,
    configurable: "kpi",
    chrome: "self",
  },
  chart: {
    type: "chart",
    labelKey: "dashboard.widgets.chart",
    icon: "bar_chart",
    family: "chart",
    defaultLayout: { w: 6, h: 5, minW: 3, minH: 3 },
    permission: EA,
    sources: [],
    single: false,
    configurable: "chart",
    chrome: "titled",
  },
  recent_activity: {
    type: "recent_activity",
    labelKey: "dashboard.recentActivity",
    icon: "history",
    family: "overview",
    defaultLayout: { w: 7, h: 6, minW: 4, minH: 4 },
    permission: EA,
    sources: ["reports.dashboard"],
    single: true,
    configurable: "activity",
    chrome: "card",
  },
  browse_by_type: {
    type: "browse_by_type",
    labelKey: "dashboard.browseByType",
    icon: "category",
    family: "overview",
    defaultLayout: { w: 5, h: 6, minW: 3, minH: 3 },
    permission: EA,
    sources: ["reports.dashboard"],
    single: true,
    chrome: "titled",
  },
  needs_attention: section(
    "needs_attention",
    "workspace",
    "dashboard.workspace.needsAttention",
    "priority_high",
    ["my_workspace"],
    { w: 12, h: 2, minW: 4, minH: 2 },
  ),
  my_favorites: section("my_favorites", "workspace", "dashboard.workspace.myFavorites", "star"),
  my_saved_reports: section("my_saved_reports", "workspace", "dashboard.workspace.mySavedReports", "bookmark"),
  my_roles: section("my_roles", "workspace", "dashboard.workspace.myRoles", "badge"),
  my_todos: section("my_todos", "workspace", "dashboard.workspace.myTodos", "task_alt"),
  my_pending_surveys: section("my_pending_surveys", "workspace", "dashboard.workspace.myPendingSurveys", "poll"),
  my_created: section("my_created", "workspace", "dashboard.workspace.myCreated", "add_circle", ["my_workspace"]),
  my_cards_activity: section("my_cards_activity", "workspace", "dashboard.workspace.recentActivity", "history"),
  top_contributors: section("top_contributors", "admin", "dashboard.admin.topContributors", "leaderboard", ["admin_dashboard"]),
  stakeholder_coverage: section("stakeholder_coverage", "admin", "dashboard.admin.stakeholderCoverage", "group", ["admin_dashboard"]),
  idle_users: section("idle_users", "admin", "dashboard.admin.idleUsers", "person_off", ["admin_dashboard"]),
  approval_pipeline: section("approval_pipeline", "admin", "dashboard.admin.approvalPipeline", "fact_check", ["admin_dashboard"]),
  system_activity: section("system_activity", "admin", "dashboard.admin.systemActivity", "history", ["admin_dashboard"]),
  unassigned_todos: section("unassigned_todos", "admin", "dashboard.admin.overdueTodos", "assignment_late", ["admin_dashboard"]),
  stakeholder_directory: section(
    "stakeholder_directory",
    "admin",
    "dashboard.admin.stakeholderDirectory",
    "contacts",
    [],
    { w: 12, h: 7, minW: 6, minH: 4 },
  ),
};

export const WIDGET_TYPE_KEYS = Object.keys(WIDGET_META) as WidgetType[];

export function isKnownWidgetType(type: string): type is WidgetType {
  return Object.prototype.hasOwnProperty.call(WIDGET_META, type);
}

/** The module source a KPI or chart reads (`config.source`), or null. */
export function widgetSource(widget: Pick<DashboardWidget, "type" | "config">): ModuleSourceName | null {
  if (widget.type !== "kpi" && widget.type !== "chart") return null;
  const source = widget.config?.source;
  return isModuleSource(source) ? source : null;
}

/** The optional module a widget belongs to, or undefined for the core ones. */
export function widgetModule(widget: Pick<DashboardWidget, "type" | "config">): ModuleKey | undefined {
  const source = widgetSource(widget);
  return source ? SOURCE_MODULES[source] : undefined;
}

/** The permission a widget needs, or undefined when everyone may see it. */
export function widgetPermission(widget: Pick<DashboardWidget, "type" | "config">): string | undefined {
  if (!isKnownWidgetType(widget.type)) return undefined;
  // A module widget needs what its source's endpoint enforces.
  const source = widgetSource(widget);
  if (source) return SOURCE_PERMISSIONS[source];
  if (widget.type === "kpi") {
    const preset = kpiPreset(widget.config?.metric);
    // A preset names its own source's permission; a query KPI reads the
    // generic endpoint, gated like the overview.
    return preset ? preset.permission : EA;
  }
  return WIDGET_META[widget.type].permission;
}

/** The shared payloads a widget reads. */
export function widgetSources(widget: Pick<DashboardWidget, "type" | "config">): SourceName[] {
  if (!isKnownWidgetType(widget.type)) return [];
  const source = widgetSource(widget);
  if (source) return [source];
  if (widget.type === "kpi") return kpiPreset(widget.config?.metric)?.sources ?? [];
  return WIDGET_META[widget.type].sources;
}

/**
 * The widgets the viewer may see: a known type whose permission they hold
 * and, for a module widget, whose module is on. A widget they lack is not
 * rendered at all and its slot compacts away.
 */
export function visibleWidgets<W extends Pick<DashboardWidget, "type" | "config">>(
  widgets: W[],
  permissions: Record<string, boolean> | undefined,
  modules: DashboardModules = NO_MODULES,
): W[] {
  return widgets.filter((w) => {
    if (!isKnownWidgetType(w.type)) return false;
    const mod = widgetModule(w);
    if (mod && !modules[mod]) return false;
    const perm = widgetPermission(w);
    return perm === undefined || hasPermission(permissions, perm);
  });
}

/** Every shared source the given widgets read — only those the viewer may see. */
export function neededSources(
  widgets: Pick<DashboardWidget, "type" | "config">[],
  permissions: Record<string, boolean> | undefined,
  modules: DashboardModules = NO_MODULES,
): Set<SourceName> {
  const needed = new Set<SourceName>();
  for (const w of visibleWidgets(widgets, permissions, modules)) {
    for (const s of widgetSources(w)) needed.add(s);
  }
  return needed;
}

/** Today's chart titles, for a count over the whole landscape by one dimension. */
const CHART_TITLE_KEYS: Record<string, string> = {
  type: "dashboard.cardsByType",
  approval_status: "dashboard.approvalStatusDistribution",
  data_quality_bucket: "dashboard.completionDistribution",
  lifecycle_phase: "dashboard.lifecycleOverview",
};

export function chartTitleKey(query: DashboardQuery | undefined | null): string | null {
  if (!query || !query.group_by) return null;
  if (query.card_type || query.group_by_2 || query.relation_type) return null;
  if (query.metric && query.metric !== "count") return null;
  if (query.approval_status || query.lifecycle_phase || query.subtype) return null;
  return CHART_TITLE_KEYS[query.group_by] ?? null;
}

/**
 * A widget's display title: the admin's own title, else the preset's or
 * chart's natural title, else the catalogue label. Always translated — a
 * built-in widget stores no English title.
 */
export function widgetTitle(widget: Pick<DashboardWidget, "type" | "title" | "config">, t: TFunction): string {
  const own = widget.title?.trim();
  if (own) return own;
  if (widget.type === "kpi") {
    const preset = kpiPreset(widget.config?.metric);
    if (preset) return t(preset.labelKey);
  }
  if (widget.type === "kpi" || widget.type === "chart") {
    // A built-in or catalogue widget names itself by an i18n key, so it reads
    // in the viewer's language; only dashboard keys are honoured.
    const titleKey = widget.config?.title_key;
    if (typeof titleKey === "string" && titleKey.startsWith("dashboard.")) return t(titleKey);
    const source = widgetSource(widget);
    if (source && typeof widget.config?.series === "string") {
      return t(seriesLabelKey(source, widget.config.series));
    }
  }
  if (widget.type === "chart") {
    const key = chartTitleKey(widget.config?.query as DashboardQuery | undefined);
    if (key) return t(key);
  }
  if (isKnownWidgetType(widget.type)) return t(WIDGET_META[widget.type].labelKey);
  return t("dashboard.widgets.unknown");
}

/** What every widget component receives. */
export interface WidgetProps {
  widget: DashboardWidget;
}
