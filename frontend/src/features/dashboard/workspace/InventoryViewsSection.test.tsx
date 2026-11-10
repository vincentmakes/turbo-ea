/**
 * InventoryViewsSection: the saved inventory views the widget's rule picks
 * (whose views, query views only), six at most in the API's order. Each row
 * reads like the inventory's Views list — type icon, name, query-view mark,
 * visibility mark, then the query's path or the card type — and is a real link
 * to `/inventory?view=<id>`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { useLocation } from "react-router";
import i18n from "@/i18n";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { renderWithProviders } from "@/test/render";
import { APPLICATION_TYPE, IT_COMPONENT_TYPE, REL_APP_TO_ITC } from "@/test/fixtures/metamodel";
import type { Bookmark, DashboardWidget } from "@/types";
import InventoryViewsSection from "./InventoryViewsSection";

const tc = (k: string, o?: Record<string, unknown>) => i18n.t(`common:${k}`, o) as string;
const ti = (k: string, o?: Record<string, unknown>) => i18n.t(`inventory:${k}`, o) as string;

function w(config: Record<string, unknown> = {}, title: string | null = null): DashboardWidget {
  return { id: "views", type: "inventory_views", title, config, layout: { x: 0, y: 0, w: 6, h: 6 } };
}

const view = (id: string, over: Partial<Bookmark> = {}): Bookmark => ({
  id,
  name: `View ${id}`,
  is_default: false,
  visibility: "private",
  odata_enabled: false,
  owner_id: "u1",
  owner_name: "Ada",
  is_owner: true,
  can_edit: true,
  filters: {},
  ...over,
});

const PATH_QUERY = { type: "Application", related: [{ relation: "relAppToITC", type: "ITComponent" }] };

function Where() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{pathname + search}</div>;
}

function renderSection(widget: DashboardWidget = w()) {
  return renderWithProviders(<InventoryViewsSection widget={widget} />, {
    routes: [{ path: "/" }, { path: "*", element: <Where /> }],
  });
}

/** The row link holding a view's name. */
const rowOf = async (name: string) => (await screen.findByText(name)).closest("a") as HTMLElement;
const lineOf = (row: HTMLElement) => within(row).getByTestId("inventory-view-line").textContent;
const iconOf = (row: HTMLElement) => row.querySelector(".MuiListItemIcon-root")!.textContent;

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel([APPLICATION_TYPE, IT_COMPONENT_TYPE], [REL_APP_TO_ITC]);
});

describe("InventoryViewsSection", () => {
  it.each([
    [{}, "/bookmarks?filter=all"],
    [{ filter: "my" }, "/bookmarks?filter=my"],
    [{ filter: "shared", query_only: true }, "/bookmarks?filter=shared"],
    [{ filter: "public" }, "/bookmarks?filter=all"],
  ])("asks for the views its filter names (%j)", async (config, path) => {
    mockApi.on("get", path, [view("a", { query: { type: "Application" } })]);
    renderSection(w(config));
    expect(await screen.findByText("View a")).toBeInTheDocument();
    expect(mockApi.calls.filter((c) => c.path.startsWith("/bookmarks")).map((c) => c.path)).toEqual([path]);
  });

  it("titles itself by the widget's own title, else its label, and links to the inventory", async () => {
    mockApi.on("get", "/bookmarks?filter=all", []);
    const { unmount } = renderSection();
    expect(await screen.findByText("Inventory views")).toBeInTheDocument();
    expect(screen.getByText(`${tc("actions.viewAll")} →`)).toHaveAttribute("href", "/inventory");
    unmount();
    renderSection(w({}, "Team views"));
    expect(await screen.findByText("Team views")).toBeInTheDocument();
  });

  it("reads each view like the inventory's Views list", async () => {
    mockApi.on("get", "/bookmarks?filter=all", [
      view("one", { name: "Apps", filters: { types: ["Application"] }, visibility: "public" }),
      view("many", { name: "Mixed", filters: { types: ["Application", "ITComponent"] }, visibility: "shared" }),
      view("none", { name: "Everything" }),
      view("path", { name: "Apps on infra", query: PATH_QUERY, filters: { types: ["ITComponent"] } }),
      view("mcp", {
        name: "Either",
        created_via: "mcp",
        query: { any_of: [{ type: "Application" }, { type: "ITComponent" }] },
      }),
    ]);
    renderSection();

    const apps = await rowOf("Apps");
    expect(iconOf(apps)).toBe("apps");
    expect(lineOf(apps)).toBe("Application");
    expect(within(apps).getByRole("img", { name: ti("views.visibilityPublic") }).textContent).toBe("public");
    expect(within(apps).queryByRole("img", { name: ti("queryView.badge") })).toBeNull();

    const mixed = await rowOf("Mixed");
    expect(iconOf(mixed)).toBe("bookmark");
    expect(lineOf(mixed)).toBe(ti("views.nTypes", { count: 2 }));
    expect(within(mixed).getByRole("img", { name: ti("views.visibilityShared") }).textContent).toBe("group");

    const everything = await rowOf("Everything");
    expect(iconOf(everything)).toBe("bookmark");
    expect(lineOf(everything)).toBe(ti("views.allTypes"));
    expect(within(everything).queryAllByRole("img")).toEqual([]);

    // A query view is about its start type, whatever its stored facets say.
    const path = await rowOf("Apps on infra");
    expect(iconOf(path)).toBe("apps");
    expect(lineOf(path)).toBe("Application › uses IT Component");
    expect(within(path).getByRole("img", { name: ti("queryView.badge") }).textContent).toBe("view_in_ar");

    const mcp = await rowOf("Either");
    expect(iconOf(mcp)).toBe("bookmark");
    expect(lineOf(mcp)).toBe(`Application ${ti("queryView.connectiveOr")} IT Component`);
    expect(within(mcp).getByRole("img", { name: ti("queryView.badge") }).textContent).toBe("smart_toy");
  });

  it("says a view has conditions, so a filtered view never reads like the bare type", async () => {
    mockApi.on("get", "/bookmarks?filter=all", [
      view("eol", {
        name: "Apps at or near end of life",
        query: { type: "Application", where: { eol_status: ["eol", "approaching"] } },
      }),
      view("two", {
        name: "Active apps on live tech",
        query: {
          type: "Application",
          where: { lifecycle_phase: ["active"] },
          related: [{ relation: "relAppToITC", type: "ITComponent", where: { eol_status: ["eol"] } }],
        },
      }),
      view("all", { name: "All Applications", query: { type: "Application" } }),
    ]);
    renderSection();
    expect(lineOf(await rowOf("Apps at or near end of life"))).toBe("Application · 1 condition");
    expect(lineOf(await rowOf("Active apps on live tech"))).toBe(
      "Application › uses IT Component · 2 conditions",
    );
    expect(lineOf(await rowOf("All Applications"))).toBe("Application");
    expect(ti("queryView.conditionCount", { count: 1 })).toBe("1 condition");
    expect(ti("queryView.conditionCount", { count: 2 })).toBe("2 conditions");
  });

  it("names a type missing from the metamodel by the query's key", async () => {
    mockApi.on("get", "/bookmarks?filter=all", [view("x", { name: "Ghosts", query: { type: "Ghost" } })]);
    renderSection();
    const row = await rowOf("Ghosts");
    expect(iconOf(row)).toBe("bookmark");
    expect(lineOf(row)).toBe("Ghost");
  });

  it("lists six views at most, in the API's order", async () => {
    const views = ["f", "e", "d", "c", "b", "a", "z"].map((id) => view(id));
    mockApi.on("get", "/bookmarks?filter=all", views);
    renderSection();
    await screen.findByText("View f");
    const rows = screen.getAllByTestId("inventory-view-row");
    expect(rows.map((r) => within(r).getByText(/^View /).textContent)).toEqual([
      "View f",
      "View e",
      "View d",
      "View c",
      "View b",
      "View a",
    ]);
  });

  it("keeps the query views alone when asked, still six at most", async () => {
    const plain = ["p1", "p2", "p3"].map((id) => view(id));
    const queries = ["q1", "q2", "q3", "q4", "q5", "q6", "q7"].map((id) => view(id, { query: { type: "Application" } }));
    mockApi.on("get", "/bookmarks?filter=my", [plain[0], queries[0], plain[1], ...queries.slice(1), plain[2]]);
    renderSection(w({ filter: "my", query_only: true }));
    await screen.findByText("View q1");
    const names = screen.getAllByTestId("inventory-view-row").map((r) => within(r).getByText(/^View /).textContent);
    expect(names).toEqual(["View q1", "View q2", "View q3", "View q4", "View q5", "View q6"]);
  });

  it("opens the view in the inventory through a real link", async () => {
    mockApi.on("get", "/bookmarks?filter=all", [view("v-42", { name: "Mine" })]);
    const { user } = renderSection();
    const row = await rowOf("Mine");
    expect(row).toHaveAttribute("href", "/inventory?view=v-42");
    await user.click(row);
    expect(await screen.findByTestId("where")).toHaveTextContent("/inventory?view=v-42");
  });

  it("says when there is nothing to list, and when no query view is", async () => {
    mockApi.on("get", "/bookmarks?filter=all", [view("p")]);
    mockApi.on("get", "/bookmarks?filter=shared", []);
    const { unmount } = renderSection(w({ filter: "shared" }));
    expect(await screen.findByText(tc("dashboard.inventoryViews.empty"))).toBeInTheDocument();
    unmount();
    renderSection(w({ query_only: true }));
    expect(await screen.findByText(tc("dashboard.inventoryViews.emptyQuery"))).toBeInTheDocument();
    expect(screen.queryByText("View p")).toBeNull();
  });

  it("tells a role without saved views so, and shows any other failure", async () => {
    mockApi.fail("get", "/bookmarks?filter=all", 403, "Forbidden");
    const { unmount } = renderSection();
    expect(await screen.findByText(tc("dashboard.inventoryViews.forbidden"))).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    unmount();
    mockApi.reset();
    mockApi.fail("get", "/bookmarks?filter=all", 500, "boom");
    renderSection();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(tc("dashboard.inventoryViews.forbidden"))).toBeNull();
  });
});
