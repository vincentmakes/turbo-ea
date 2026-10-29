/**
 * The payloads several widgets on one dashboard share — fetched once per
 * dashboard mount, not once per widget. The provider looks at the widgets it
 * is given, works out which sources they read, and runs one `useApiQuery`
 * per source (path `null` when no widget needs it, so a dashboard without
 * admin widgets never calls the admin endpoint). A module's report (risks,
 * compliance, PPM, BPM) is fetched only when a visible widget reads it AND
 * its module is on (`modules`, from `useDashboardModules`).
 *
 * A widget rendered outside a provider (the configuration preview) fetches
 * its source itself, through the same hook.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useOptionalAuthUser } from "@/hooks/AuthContext";
import { useApiQuery } from "@/hooks/useApiQuery";
import type { DashboardData, DashboardWidget, EventEntry } from "@/types";
import type { ContributorRow } from "./admin/TopContributorsSection";
import type { CoverageRow } from "./admin/StakeholderCoverageSection";
import type { IdleUserRow } from "./admin/IdleUsersSection";
import type { PipelineRow } from "./admin/ApprovalPipelineSection";
import type { OverdueTodoRow } from "./admin/UnassignedTodosSection";
import { SOURCE_PATHS, type SourceName } from "./widgets/kpiPresets";
import type {
  BpmDashboardPayload,
  ComplianceOverviewPayload,
  PpmDashboardPayload,
  RiskMetricsPayload,
} from "./widgets/sourceSeries";
import { NO_MODULES, neededSources, type DashboardModules } from "./widgets/widgetMeta";

export interface MyWorkspaceCounters {
  favorite_count: number;
  stakeholder_card_count: number;
  open_todo_count: number;
  pending_survey_count: number;
  attention_count: number;
  overdue_todo_count: number;
  broken_card_count: number;
  created_count: number;
}

export interface AdminKpis {
  total_users: number;
  active_users_30d: number;
  cards_without_stakeholders: number;
  overdue_todos_total: number;
  stuck_approvals: number;
  broken_total: number;
  pending_sso_invitations: number;
  unassigned_todo_count: number;
}

export interface AdminDashboardPayload {
  kpis: AdminKpis;
  top_contributors: ContributorRow[];
  stakeholder_coverage: CoverageRow[];
  idle_users: IdleUserRow[];
  approval_pipeline: PipelineRow[];
  recent_activity: EventEntry[];
  oldest_overdue_todos: OverdueTodoRow[];
}

export interface DataQualitySummary {
  overall_data_quality: number;
  total_items: number;
}

export interface SourcePayloads {
  "reports.dashboard": DashboardData;
  my_workspace: MyWorkspaceCounters;
  admin_dashboard: AdminDashboardPayload;
  data_quality: DataQualitySummary;
  risks_metrics: RiskMetricsPayload;
  compliance_overview: ComplianceOverviewPayload;
  ppm_dashboard: PpmDashboardPayload;
  bpm_dashboard: BpmDashboardPayload;
}

export interface SourceState<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | null;
}

type SourcesValue = { [K in SourceName]: SourceState<SourcePayloads[K]> };

const SourcesContext = createContext<SourcesValue | null>(null);

function pick<T>(r: { data: T | undefined; loading: boolean; error: Error | null }): SourceState<T> {
  return { data: r.data, loading: r.loading, error: r.error };
}

export function DashboardSourcesProvider({
  widgets,
  modules = NO_MODULES,
  children,
}: {
  widgets: DashboardWidget[];
  /** Which optional modules are on; their sources are never fetched otherwise. */
  modules?: DashboardModules;
  children: ReactNode;
}) {
  const user = useOptionalAuthUser();
  const needed = neededSources(widgets, user?.permissions, modules);
  const path = (name: SourceName) => (needed.has(name) ? SOURCE_PATHS[name] : null);

  const dashboard = useApiQuery<DashboardData>(path("reports.dashboard"));
  const workspace = useApiQuery<MyWorkspaceCounters>(path("my_workspace"));
  const admin = useApiQuery<AdminDashboardPayload>(path("admin_dashboard"));
  const quality = useApiQuery<DataQualitySummary>(path("data_quality"));
  const risks = useApiQuery<RiskMetricsPayload>(path("risks_metrics"));
  const compliance = useApiQuery<ComplianceOverviewPayload>(path("compliance_overview"));
  const ppm = useApiQuery<PpmDashboardPayload>(path("ppm_dashboard"));
  const bpm = useApiQuery<BpmDashboardPayload>(path("bpm_dashboard"));

  const value = useMemo<SourcesValue>(
    () => ({
      "reports.dashboard": pick(dashboard),
      my_workspace: pick(workspace),
      admin_dashboard: pick(admin),
      data_quality: pick(quality),
      risks_metrics: pick(risks),
      compliance_overview: pick(compliance),
      ppm_dashboard: pick(ppm),
      bpm_dashboard: pick(bpm),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the hook results are fresh objects every render; their fields are the identity
    [
      dashboard.data, dashboard.loading, dashboard.error,
      workspace.data, workspace.loading, workspace.error,
      admin.data, admin.loading, admin.error,
      quality.data, quality.loading, quality.error,
      risks.data, risks.loading, risks.error,
      compliance.data, compliance.loading, compliance.error,
      ppm.data, ppm.loading, ppm.error,
      bpm.data, bpm.loading, bpm.error,
    ],
  );

  return <SourcesContext.Provider value={value}>{children}</SourcesContext.Provider>;
}

/** One shared source's state. Outside a provider the widget fetches it itself. */
export function useDashboardSource<K extends SourceName>(name: K): SourceState<SourcePayloads[K]> {
  const ctx = useContext(SourcesContext);
  const own = useApiQuery<SourcePayloads[K]>(ctx ? null : SOURCE_PATHS[name]);
  if (ctx) return ctx[name] as SourceState<SourcePayloads[K]>;
  return pick(own);
}

