/**
 * IdleUsersSection: active users who have not signed in lately, with when
 * they last did, plus the SSO invitations still waiting. Everything opens
 * user management.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { useLocation } from "react-router";

vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

import { hookState } from "@/test/hooks";
import { renderWithProviders } from "@/test/render";
import IdleUsersSection, { type IdleUserRow } from "./IdleUsersSection";

const idle = (id: string, lastLogin: string | null): IdleUserRow => ({
  user_id: id,
  display_name: `User ${id}`,
  email: `${id}@example.com`,
  last_login: lastLogin,
  role: "member",
});

function Where() {
  const { pathname } = useLocation();
  return <div data-testid="where">{pathname}</div>;
}

function renderSection(rows: IdleUserRow[], pendingSsoInvitations = 0, loading = false) {
  return renderWithProviders(
    <IdleUsersSection
      rows={rows}
      pendingSsoInvitations={pendingSsoInvitations}
      loading={loading}
    />,
    { routes: [{ path: "/" }, { path: "/admin/users", element: <Where /> }] },
  );
}

const rowOf = (name: string) => screen.getByText(name).parentElement!.parentElement!;

beforeEach(() => {
  hookState.reset();
});

describe("IdleUsersSection", () => {
  it("shows a progress bar while loading", () => {
    renderSection([idle("a", null)], 2, true);
    expect(screen.getByText("Idle users")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText("User a")).not.toBeInTheDocument();
    expect(screen.queryByText(/SSO invitation/)).not.toBeInTheDocument();
  });

  it("says so when everyone signed in recently", () => {
    renderSection([]);
    expect(screen.getByText("All active users have logged in recently.")).toBeInTheDocument();
    expect(screen.queryByText(/SSO invitation/)).not.toBeInTheDocument();
  });

  it.each([
    [1, "1 pending SSO invitation"],
    [3, "3 pending SSO invitations"],
  ])("counts %i pending SSO invitation(s)", (count, text) => {
    renderSection([], count);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("lists each user with their email and last sign-in", () => {
    renderSection([idle("a", "2026-01-05T09:00:00Z"), idle("b", null)]);
    expect(within(rowOf("User a")).getByText("a@example.com")).toBeInTheDocument();
    expect(within(rowOf("User a")).getByText("2026-01-05")).toBeInTheDocument();
    expect(within(rowOf("User b")).getByText("Never logged in")).toBeInTheDocument();
  });

  it("offers the full user list", () => {
    renderSection([]);
    expect(screen.getByRole("link", { name: "View all →" })).toHaveAttribute(
      "href",
      "/admin/users",
    );
  });

  it("opens user management from a row", async () => {
    const { user } = renderSection([idle("a", null)]);
    await user.click(screen.getByText("User a"));
    expect(screen.getByTestId("where")).toHaveTextContent("/admin/users");
  });
});
