/**
 * MyFavoritesSection — "My Favorites" on the dashboard workspace.
 *
 * Pins the `/favorites` → `/cards/{id}` fan-out (first eight, unreadable
 * cards dropped), navigation, and the optimistic remove with its undo
 * snackbar, including the rollback when the DELETE fails.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { CARD_TYPES, makeCard } from "@/test/fixtures/metamodel";
import { renderWithProviders } from "@/test/render";
import MyFavoritesSection from "./MyFavoritesSection";

const ERP = makeCard({ id: "c1", type: "Application", name: "NexaCore ERP" });
const SAP = makeCard({ id: "c2", type: "ITComponent", name: "SAP HANA" });

const favorite = (card_id: string) => ({ id: `f-${card_id}`, card_id, created_at: null });

function Probe() {
  const { pathname } = useLocation();
  return <div data-testid="landed">{pathname}</div>;
}

function renderSection() {
  return renderWithProviders(<MyFavoritesSection />, {
    routes: [{ path: "/" }, { path: "/cards/:id", element: <Probe /> }],
  });
}

const removeButton = (name: string) =>
  within(screen.getByText(name).parentElement as HTMLElement).getByRole("button", {
    name: "Remove from favorites",
  });

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel(CARD_TYPES);
  mockApi.on("get", "/favorites", [favorite("c1"), favorite("c2")]);
  mockApi.on("get", "/cards/c1", ERP);
  mockApi.on("get", "/cards/c2", SAP);
  mockApi.on("delete", /^\/favorites\//, null);
  mockApi.on("post", /^\/favorites\//, {});
});

describe("MyFavoritesSection", () => {
  it("shows a progress bar, then each favourite card with its type pill", async () => {
    renderSection();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(await screen.findByText("NexaCore ERP")).toBeInTheDocument();
    expect(screen.getByText("SAP HANA")).toBeInTheDocument();
    expect(within(screen.getByText("NexaCore ERP").parentElement as HTMLElement).getByText("Application")).toBeInTheDocument();
    expect(within(screen.getByText("SAP HANA").parentElement as HTMLElement).getByText("IT Component")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows the empty state when nothing is favourited", async () => {
    mockApi.on("get", "/favorites", []);
    renderSection();
    expect(
      await screen.findByText("Browse the inventory and click the star to pin cards here."),
    ).toBeInTheDocument();
  });

  it("loads at most eight cards and drops any it can no longer read", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `k${i}`);
    mockApi.on("get", "/favorites", ids.map(favorite));
    mockApi.on("get", /^\/cards\/k\d$/, (path: string) =>
      makeCard({ id: path.split("/").pop()!, type: "Application", name: `Card ${path.slice(-1)}` }),
    );
    mockApi.fail("get", "/cards/k3", 404);
    renderSection();
    await screen.findByText("Card 0");
    expect(mockApi.callsOf("get", /^\/cards\//)).toHaveLength(8);
    expect(screen.queryByText("Card 3")).not.toBeInTheDocument();
    expect(screen.getAllByText(/^Card \d$/)).toHaveLength(7);
  });

  it("opens a card when its row is clicked", async () => {
    const { user } = renderSection();
    await user.click(await screen.findByText("SAP HANA"));
    expect(await screen.findByTestId("landed")).toHaveTextContent("/cards/c2");
  });

  it("removes a favourite optimistically and offers an undo that re-adds it", async () => {
    const { user } = renderSection();
    await screen.findByText("NexaCore ERP");
    await user.click(removeButton("NexaCore ERP"));

    expect(screen.queryByText("NexaCore ERP")).not.toBeInTheDocument();
    expect(await screen.findByText("Removed «NexaCore ERP» from favorites")).toBeInTheDocument();
    await waitFor(() => expect(mockApi.callsOf("delete", "/favorites/c1")).toHaveLength(1));
    // The click did not bubble up into a navigation.
    expect(screen.queryByTestId("landed")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(mockApi.callsOf("post", "/favorites/c1")).toHaveLength(1));
    expect(await screen.findByText("NexaCore ERP")).toBeInTheDocument();
    // Re-added at the top.
    const names = screen.getAllByText(/NexaCore ERP|SAP HANA/).map((el) => el.textContent);
    expect(names).toEqual(["NexaCore ERP", "SAP HANA"]);
  });

  it("puts the card back and drops the snackbar when the removal fails", async () => {
    mockApi.fail("delete", "/favorites/c2", 500);
    const { user } = renderSection();
    await screen.findByText("SAP HANA");
    await user.click(removeButton("SAP HANA"));

    await waitFor(() => expect(mockApi.callsOf("delete", "/favorites/c2")).toHaveLength(1));
    expect(await screen.findByText("SAP HANA")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("Removed «SAP HANA» from favorites")).not.toBeInTheDocument(),
    );
  });

  it("leaves the card removed when the undo request fails", async () => {
    mockApi.fail("post", "/favorites/c1", 500);
    const { user } = renderSection();
    await screen.findByText("NexaCore ERP");
    await user.click(removeButton("NexaCore ERP"));
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(mockApi.callsOf("post", "/favorites/c1")).toHaveLength(1));
    expect(screen.queryByText("NexaCore ERP")).not.toBeInTheDocument();
  });

  it("closes the undo snackbar through its close button", async () => {
    const { user } = renderSection();
    await screen.findByText("NexaCore ERP");
    await user.click(removeButton("NexaCore ERP"));
    await screen.findByText("Removed «NexaCore ERP» from favorites");
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(screen.queryByText("Removed «NexaCore ERP» from favorites")).not.toBeInTheDocument(),
    );
    expect(mockApi.callsOf("post")).toHaveLength(0);
  });
});
