import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

import { mockApi } from "@/test/apiMock";
import { BUSINESS_CAPABILITY_TYPE, CARD_TYPES, HIDDEN_TYPE, PROVIDER_TYPE } from "@/test/fixtures/metamodel";
import { withMetamodel } from "@/test/hooks";
import { makeUser, renderWithProviders } from "@/test/render";
import BrowseByTypeWidget from "./BrowseByTypeWidget";

function renderIt(user = makeUser()) {
  return renderWithProviders(<BrowseByTypeWidget />, {
    user,
    routes: [{ path: "/" }, { path: "/inventory", element: <div>inventory page</div> }],
  });
}

beforeEach(() => {
  mockApi.reset();
  withMetamodel(CARD_TYPES);
  mockApi.on("get", "/reports/dashboard", {
    by_type: { Application: 8, [HIDDEN_TYPE.key]: 4 },
    recent_events: [],
  });
});

describe("BrowseByTypeWidget", () => {
  it("lists types with cards plus the core types, never hidden ones", async () => {
    renderIt();
    expect(await screen.findByText("Application")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    // An always-shown type with no cards still has a row.
    expect(screen.getByText(BUSINESS_CAPABILITY_TYPE.label)).toBeInTheDocument();
    // A type without cards that is not a core type has none.
    expect(screen.queryByText(PROVIDER_TYPE.label)).toBeNull();
    expect(screen.queryByText(HIDDEN_TYPE.label)).toBeNull();
  });

  it("opens the inventory on the type", async () => {
    const { user } = renderIt();
    await user.click(await screen.findByText("Application"));
    expect(await screen.findByText("inventory page")).toBeInTheDocument();
  });

  it("opens it from the keyboard too", async () => {
    const { user } = renderIt();
    const row = (await screen.findByText("Application")).closest("[role=link]") as HTMLElement;
    row.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByText("inventory page")).toBeInTheDocument();
  });

  it("skips a type the viewer may not read", async () => {
    renderIt(
      makeUser({
        role: "member",
        permissions: { "inventory.view": true },
        type_permissions: { Application: { "inventory.view": false } },
      } as never),
    );
    expect(await screen.findByText(BUSINESS_CAPABILITY_TYPE.label)).toBeInTheDocument();
    expect(screen.queryByText("Application")).toBeNull();
  });
});
