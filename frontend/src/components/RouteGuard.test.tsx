import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { AuthProvider } from "@/hooks/AuthContext";
import type { User } from "@/types";

import RouteGuard from "./RouteGuard";

function makeUser(permissions: Record<string, boolean> | undefined): User {
  return {
    id: "u1",
    email: "u@example.com",
    display_name: "U",
    role: "member",
    is_active: true,
    permissions,
  };
}

function renderAt(path: string, permissions: Record<string, boolean> | undefined) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider user={makeUser(permissions)} refreshUser={async () => {}}>
        <RouteGuard>
          <div>page content</div>
        </RouteGuard>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("RouteGuard", () => {
  it("renders the page when the user holds the route's permission", () => {
    renderAt("/ppm", { "ppm.view": true });
    expect(screen.getByText("page content")).toBeInTheDocument();
  });

  it("blocks the page when the user does not", () => {
    renderAt("/ppm", { "inventory.view": true });
    expect(screen.queryByText("page content")).not.toBeInTheDocument();
    expect(screen.getByText("Access denied")).toBeInTheDocument();
  });

  it("is fail-closed when permissions have not loaded", () => {
    renderAt("/ppm", undefined);
    expect(screen.getByText("Access denied")).toBeInTheDocument();
  });

  it("lets the admin wildcard through", () => {
    renderAt("/admin/users", { "*": true });
    expect(screen.getByText("page content")).toBeInTheDocument();
  });

  it("leaves the dashboard and personal pages open", () => {
    renderAt("/", {});
    expect(screen.getByText("page content")).toBeInTheDocument();

    renderAt("/todos", {});
    expect(screen.getAllByText("page content").length).toBeGreaterThan(0);
  });

  it("leaves extension routes to the extension outlet", () => {
    renderAt("/ext/acme/board", {});
    expect(screen.getByText("page content")).toBeInTheDocument();
  });

  it("applies the more specific pattern for a nested route", () => {
    renderAt("/diagrams/abc/edit", { "diagrams.view": true });
    expect(screen.getByText("Access denied")).toBeInTheDocument();

    renderAt("/diagrams/abc", { "diagrams.view": true });
    expect(screen.getByText("page content")).toBeInTheDocument();
  });
});
