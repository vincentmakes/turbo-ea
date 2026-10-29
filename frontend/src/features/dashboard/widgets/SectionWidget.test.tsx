import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import type { DashboardWidget, WidgetType } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

// The sections have their own tests; here each is a stub that prints the
// props the adapter hands it.
function stub(name: string) {
  return { default: (props: Record<string, unknown>) => <div data-testid={name}>{JSON.stringify(props)}</div> };
}
vi.mock("../workspace/MyFavoritesSection", () => stub("my_favorites"));
vi.mock("../workspace/MySavedReportsSection", () => stub("my_saved_reports"));
vi.mock("../workspace/MyRolesSection", () => stub("my_roles"));
vi.mock("../workspace/MyTodosSection", () => stub("my_todos"));
vi.mock("../workspace/MyPendingSurveysSection", () => stub("my_pending_surveys"));
vi.mock("../workspace/MyCreatedSection", () => stub("my_created"));
vi.mock("../workspace/NeedsAttentionSection", () => stub("needs_attention"));
vi.mock("../workspace/RecentActivityOnMyCardsSection", () => stub("my_cards_activity"));
vi.mock("../admin/TopContributorsSection", () => stub("top_contributors"));
vi.mock("../admin/StakeholderCoverageSection", () => stub("stakeholder_coverage"));
vi.mock("../admin/IdleUsersSection", () => stub("idle_users"));
vi.mock("../admin/ApprovalPipelineSection", () => stub("approval_pipeline"));
vi.mock("../admin/SystemActivitySection", () => stub("system_activity"));
vi.mock("../admin/UnassignedTodosSection", () => stub("unassigned_todos"));
vi.mock("../admin/StakeholderDirectorySection", () => stub("stakeholder_directory"));

import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import { DashboardSourcesProvider } from "../DashboardSources";
import SectionWidget from "./SectionWidget";
import WidgetFrame from "./WidgetFrame";

function w(type: WidgetType): DashboardWidget {
  return { id: type, type, title: null, config: {}, layout: { x: 0, y: 0, w: 6, h: 6 } };
}

const WORKSPACE = {
  favorite_count: 0,
  stakeholder_card_count: 0,
  open_todo_count: 0,
  pending_survey_count: 0,
  attention_count: 3,
  overdue_todo_count: 2,
  broken_card_count: 1,
  created_count: 7,
};

const ADMIN = {
  kpis: {
    total_users: 1,
    active_users_30d: 1,
    cards_without_stakeholders: 0,
    overdue_todos_total: 0,
    stuck_approvals: 0,
    broken_total: 0,
    pending_sso_invitations: 4,
    unassigned_todo_count: 6,
  },
  top_contributors: [{ user_id: "u1" }],
  stakeholder_coverage: [{ type_key: "Application" }],
  idle_users: [{ id: "u2" }],
  approval_pipeline: [{ type_key: "Application" }],
  recent_activity: [{ id: "e1", event_type: "card.created" }],
  oldest_overdue_todos: [{ id: "t1" }],
};

/** The sections bare, or inside their frames when `editing` is given. */
function renderSections(types: WidgetType[], editing?: boolean) {
  const widgets = types.map(w);
  return renderWithProviders(
    <DashboardSourcesProvider widgets={widgets}>
      {widgets.map((x) =>
        editing === undefined ? (
          <SectionWidget key={x.id} widget={x} />
        ) : (
          <WidgetFrame key={x.id} widget={x} editing={editing}>
            <SectionWidget widget={x} />
          </WidgetFrame>
        ),
      )}
    </DashboardSourcesProvider>,
  );
}

const props = (id: string) => JSON.parse(screen.getByTestId(id).textContent ?? "{}");

beforeEach(() => {
  mockApi.reset();
  mockApi.on("get", "/reports/my-workspace", WORKSPACE);
  mockApi.on("get", "/reports/admin-dashboard", ADMIN);
});

describe("SectionWidget", () => {
  it("renders the self-fetching workspace sections unchanged, with no shared fetch", () => {
    renderSections(["my_favorites", "my_saved_reports", "my_roles", "my_todos", "my_pending_surveys", "my_cards_activity"]);
    for (const id of ["my_favorites", "my_saved_reports", "my_roles", "my_todos", "my_pending_surveys", "my_cards_activity"]) {
      expect(props(id)).toEqual({});
    }
    expect(mockApi.calls).toHaveLength(0);
  });

  it("feeds the attention banner and Cards I created from the workspace counters", async () => {
    renderSections(["needs_attention", "my_created"]);
    expect(await screen.findByTestId("needs_attention")).toBeInTheDocument();
    expect(props("needs_attention")).toEqual({ overdueTodoCount: 2, brokenCardCount: 1 });
    expect(props("my_created")).toEqual({ createdCount: 7 });
    expect(mockApi.callsOf("get", "/reports/my-workspace")).toHaveLength(1);
  });

  it("hides the attention banner while nothing needs attention", async () => {
    mockApi.on("get", "/reports/my-workspace", { ...WORKSPACE, attention_count: 0 });
    renderSections(["needs_attention", "my_created"]);
    expect(await screen.findByText(/"createdCount":7/)).toBeInTheDocument();
    expect(screen.queryByTestId("needs_attention")).toBeNull();
  });

  it("keeps the attention banner in customize mode with nothing waiting, so it can be moved or removed", async () => {
    mockApi.on("get", "/reports/my-workspace", { ...WORKSPACE, attention_count: 0 });
    renderSections(["needs_attention", "my_created"], true);
    expect(await screen.findByText(/"createdCount":7/)).toBeInTheDocument();
    expect(props("needs_attention")).toEqual({ overdueTodoCount: 0, brokenCardCount: 0 });
  });

  it("hands the attention banner its counts in customize mode too", async () => {
    renderSections(["needs_attention"], true);
    await waitFor(() => expect(props("needs_attention")).toEqual({ overdueTodoCount: 2, brokenCardCount: 1 }));
  });

  it("feeds the six admin sections from one admin fetch", async () => {
    renderSections([
      "top_contributors",
      "stakeholder_coverage",
      "idle_users",
      "approval_pipeline",
      "system_activity",
      "unassigned_todos",
      "stakeholder_directory",
    ]);
    expect(await screen.findByText(/"user_id":"u1"/)).toBeInTheDocument();
    expect(props("top_contributors")).toEqual({ rows: ADMIN.top_contributors, loading: false });
    expect(props("stakeholder_coverage")).toEqual({ rows: ADMIN.stakeholder_coverage, loading: false });
    expect(props("idle_users")).toEqual({ rows: ADMIN.idle_users, pendingSsoInvitations: 4, loading: false });
    expect(props("approval_pipeline")).toEqual({ rows: ADMIN.approval_pipeline, loading: false });
    expect(props("system_activity")).toEqual({ events: ADMIN.recent_activity, loading: false });
    expect(props("unassigned_todos")).toEqual({ rows: ADMIN.oldest_overdue_todos, unassignedCount: 6, loading: false });
    expect(props("stakeholder_directory")).toEqual({});
    expect(mockApi.callsOf("get", "/reports/admin-dashboard")).toHaveLength(1);
  });

  it("passes empty rows while loading", () => {
    renderSections(["idle_users"]);
    expect(props("idle_users")).toEqual({ rows: [], pendingSsoInvitations: 0, loading: true });
  });

  it("renders nothing for a type it does not adapt", () => {
    const { container } = renderSections(["chart"]);
    expect(container).toBeEmptyDOMElement();
  });
});
