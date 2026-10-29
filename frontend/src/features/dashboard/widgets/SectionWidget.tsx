/**
 * Adapter from a section widget type to the existing My Workspace and Admin
 * section components, unchanged. Sections that fetch their own data render as
 * they are; the ones the old tabs fed (the attention banner, "Cards I
 * created" and the six admin sections) read the dashboard's shared sources.
 */
import type { WidgetType } from "@/types";
import { useDashboardSource } from "../DashboardSources";
import MyFavoritesSection from "../workspace/MyFavoritesSection";
import MySavedReportsSection from "../workspace/MySavedReportsSection";
import MyRolesSection from "../workspace/MyRolesSection";
import MyTodosSection from "../workspace/MyTodosSection";
import MyPendingSurveysSection from "../workspace/MyPendingSurveysSection";
import MyCreatedSection from "../workspace/MyCreatedSection";
import NeedsAttentionSection from "../workspace/NeedsAttentionSection";
import RecentActivityOnMyCardsSection from "../workspace/RecentActivityOnMyCardsSection";
import TopContributorsSection from "../admin/TopContributorsSection";
import StakeholderCoverageSection from "../admin/StakeholderCoverageSection";
import IdleUsersSection from "../admin/IdleUsersSection";
import ApprovalPipelineSection from "../admin/ApprovalPipelineSection";
import SystemActivitySection from "../admin/SystemActivitySection";
import UnassignedTodosSection from "../admin/UnassignedTodosSection";
import StakeholderDirectorySection from "../admin/StakeholderDirectorySection";
import { useWidgetEditing } from "./WidgetFrame";
import type { WidgetProps } from "./widgetMeta";

/**
 * Rendered only while something needs attention, as on the old tab — except
 * in customize mode, where the section keeps its title row and controls so
 * the widget can still be moved or removed.
 */
function NeedsAttentionWidget() {
  const { data } = useDashboardSource("my_workspace");
  const editing = useWidgetEditing();
  const waiting = !!data && data.attention_count > 0;
  if (!waiting && !editing) return null;
  return (
    <NeedsAttentionSection
      overdueTodoCount={waiting ? data.overdue_todo_count : 0}
      brokenCardCount={waiting ? data.broken_card_count : 0}
    />
  );
}

function MyCreatedWidget() {
  const { data } = useDashboardSource("my_workspace");
  return <MyCreatedSection createdCount={data?.created_count ?? 0} />;
}

type AdminSectionType =
  | "top_contributors"
  | "stakeholder_coverage"
  | "idle_users"
  | "approval_pipeline"
  | "system_activity"
  | "unassigned_todos";

function AdminSectionWidget({ type }: { type: AdminSectionType }) {
  const { data, loading } = useDashboardSource("admin_dashboard");
  switch (type) {
    case "top_contributors":
      return <TopContributorsSection rows={data?.top_contributors ?? []} loading={loading} />;
    case "stakeholder_coverage":
      return <StakeholderCoverageSection rows={data?.stakeholder_coverage ?? []} loading={loading} />;
    case "idle_users":
      return (
        <IdleUsersSection
          rows={data?.idle_users ?? []}
          pendingSsoInvitations={data?.kpis.pending_sso_invitations ?? 0}
          loading={loading}
        />
      );
    case "approval_pipeline":
      return <ApprovalPipelineSection rows={data?.approval_pipeline ?? []} loading={loading} />;
    case "system_activity":
      return <SystemActivitySection events={data?.recent_activity ?? []} loading={loading} />;
    case "unassigned_todos":
      return (
        <UnassignedTodosSection
          rows={data?.oldest_overdue_todos ?? []}
          unassignedCount={data?.kpis.unassigned_todo_count ?? 0}
          loading={loading}
        />
      );
  }
}

const ADMIN_SECTIONS: WidgetType[] = [
  "top_contributors",
  "stakeholder_coverage",
  "idle_users",
  "approval_pipeline",
  "system_activity",
  "unassigned_todos",
];

export default function SectionWidget({ widget }: WidgetProps) {
  switch (widget.type) {
    case "needs_attention":
      return <NeedsAttentionWidget />;
    case "my_favorites":
      return <MyFavoritesSection />;
    case "my_saved_reports":
      return <MySavedReportsSection />;
    case "my_roles":
      return <MyRolesSection />;
    case "my_todos":
      return <MyTodosSection />;
    case "my_pending_surveys":
      return <MyPendingSurveysSection />;
    case "my_created":
      return <MyCreatedWidget />;
    case "my_cards_activity":
      return <RecentActivityOnMyCardsSection />;
    case "stakeholder_directory":
      return <StakeholderDirectorySection />;
    default:
      if (ADMIN_SECTIONS.includes(widget.type)) {
        return <AdminSectionWidget type={widget.type as AdminSectionType} />;
      }
      return null;
  }
}
