/**
 * MyFavoritesSection — "My Favorites" on the dashboard workspace.
 *
 * Pins the `/favorites` → `/cards/{id}` fan-out (first eight, unreadable
 * cards dropped), navigation, and the optimistic remove with its undo
 * snackbar, including the rollback when the DELETE fails.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { useLocation } from "react-router";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { CARD_TYPES, makeCard } from "@/test/fixtures/metamodel";
import { renderWithProviders, wrapWithProviders } from "@/test/render";
import MyFavoritesSection from "./MyFavoritesSection";

const ERP = makeCard({ id: "c1", type: "Application", name: "NexaCore ERP" });
const SAP = makeCard({ id: "c2", type: "ITComponent", name: "SAP HANA" });

const favorite = (card_id: string) => ({ id: `f-${card_id}`, card_id, created_at: null });

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Settle a request the section is awaiting and let its handler run: the
 * section registered its `await` on the call's promise before this does, so
 * by the time this resolves the handler has set its state, which `act` flushes.
 */
async function settle(call: Promise<unknown>, done: () => void) {
  await act(async () => {
    done();
    await call.then(
      () => undefined,
      () => undefined,
    );
  });
}

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
  it("paints the progress bar, not the empty state, before the favourites are fetched", () => {
    const html = renderToStaticMarkup(wrapWithProviders(<MyFavoritesSection />));
    expect(html).toContain("My Favorites");
    expect(html).toContain('role="progressbar"');
    expect(html).not.toContain("Browse the inventory and click the star to pin cards here.");
  });

  it("shows a progress bar, then each favourite card with its type pill", async () => {
    renderSection();
    expect(screen.getByText("My Favorites")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(await screen.findByText("NexaCore ERP")).toBeInTheDocument();
    expect(screen.getByText("SAP HANA")).toBeInTheDocument();
    expect(within(screen.getByText("NexaCore ERP").parentElement as HTMLElement).getByText("Application")).toBeInTheDocument();
    expect(within(screen.getByText("SAP HANA").parentElement as HTMLElement).getByText("IT Component")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    // Nothing removed yet, so no undo offer.
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("names the remove action in a tooltip", async () => {
    const { user } = renderSection();
    await screen.findByText("NexaCore ERP");
    await user.hover(removeButton("NexaCore ERP"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Remove from favorites");
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

  it("puts back the only favourite when its removal fails", async () => {
    mockApi.on("get", "/favorites", [favorite("c1")]);
    mockApi.fail("delete", "/favorites/c1", 500);
    const { user } = renderSection();
    await screen.findByText("NexaCore ERP");
    await user.click(removeButton("NexaCore ERP"));
    await waitFor(() => expect(mockApi.callsOf("delete", "/favorites/c1")).toHaveLength(1));
    expect(await screen.findByText("NexaCore ERP")).toBeInTheDocument();
  });

  it("brings back the only favourite on undo", async () => {
    mockApi.on("get", "/favorites", [favorite("c1")]);
    const { user } = renderSection();
    await screen.findByText("NexaCore ERP");
    await user.click(removeButton("NexaCore ERP"));
    expect(await screen.findByText("Browse the inventory and click the star to pin cards here.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("NexaCore ERP")).toBeInTheDocument();
  });

  it("lists a card once when an undo lands before its slow removal fails", async () => {
    const removal = deferred<null>();
    mockApi.on("delete", "/favorites/c1", () => removal.promise);
    const { user } = renderSection();
    await screen.findByText("NexaCore ERP");
    await user.click(removeButton("NexaCore ERP"));
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(mockApi.callsOf("post", "/favorites/c1")).toHaveLength(1));
    expect(await screen.findByText("NexaCore ERP")).toBeInTheDocument();

    // The removal now fails: its rollback must not add the card a second time.
    await settle(mockApi.api.delete.mock.results[0].value as Promise<unknown>, () =>
      removal.reject(new Error("offline")),
    );
    expect(screen.getAllByText("NexaCore ERP")).toHaveLength(1);
  });

  it("lists a card once when its removal fails before the undo lands", async () => {
    const removal = deferred<null>();
    const readd = deferred<object>();
    mockApi.on("delete", "/favorites/c1", () => removal.promise);
    mockApi.on("post", "/favorites/c1", () => readd.promise);
    const { user } = renderSection();
    await screen.findByText("NexaCore ERP");
    await user.click(removeButton("NexaCore ERP"));
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(mockApi.callsOf("post", "/favorites/c1")).toHaveLength(1));

    // The failed removal puts the card back first ...
    await settle(mockApi.api.delete.mock.results[0].value as Promise<unknown>, () =>
      removal.reject(new Error("offline")),
    );
    expect(screen.getAllByText("NexaCore ERP")).toHaveLength(1);
    // ... so the undo landing afterwards has nothing left to add.
    await settle(mockApi.api.post.mock.results[0].value as Promise<unknown>, () => readd.resolve({}));
    expect(screen.getAllByText("NexaCore ERP")).toHaveLength(1);
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

  it("closes the undo snackbar on Escape, keeping the card removed", async () => {
    const { user } = renderSection();
    await screen.findByText("NexaCore ERP");
    await user.click(removeButton("NexaCore ERP"));
    await screen.findByText("Removed «NexaCore ERP» from favorites");
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByText("Removed «NexaCore ERP» from favorites")).not.toBeInTheDocument(),
    );
    expect(screen.queryByText("NexaCore ERP")).not.toBeInTheDocument();
    expect(mockApi.callsOf("post")).toHaveLength(0);
  });
});
