import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { makeUser, renderWithProviders } from "@/test/render";

import RouteGuard from "./RouteGuard";

function renderAt(path: string, permissions: Record<string, boolean> | undefined) {
  return renderWithProviders(
    <RouteGuard>
      <div>page content</div>
    </RouteGuard>,
    { route: path, user: makeUser({ role: "member", permissions }) },
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
