/**
 * MyCreatedSection — "Cards I Created" on the dashboard workspace.
 *
 * Pins the paged `/cards/my-created` reads (50 first, then the rest from the
 * current offset), the "Showing N of M" caption, the empty state and
 * navigation to a card.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { useLocation } from "react-router";
import type { Card } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { CARD_TYPES, makeCard } from "@/test/fixtures/metamodel";
import { renderWithProviders } from "@/test/render";
import MyCreatedSection from "./MyCreatedSection";

const FIRST_PAGE = "/cards/my-created?limit=50&offset=0";

const page = (items: Card[], total: number, has_more: boolean) => ({
  items,
  total,
  offset: 0,
  limit: 50,
  has_more,
});

function Probe() {
  const { pathname } = useLocation();
  return <div data-testid="landed">{pathname}</div>;
}

function renderSection(createdCount = 0) {
  return renderWithProviders(<MyCreatedSection createdCount={createdCount} />, {
    routes: [{ path: "/" }, { path: "/cards/:id", element: <Probe /> }],
  });
}

/** A promise the test resolves by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const ERP = makeCard({ id: "c1", type: "Application", name: "NexaCore ERP" });
const PROVIDER = makeCard({ id: "c2", type: "Provider", name: "Acme Corp" });
const UNKNOWN = makeCard({ id: "c3", type: "RetiredType", name: "Legacy Thing" });

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel(CARD_TYPES);
  mockApi.on("get", FIRST_PAGE, page([ERP, PROVIDER, UNKNOWN], 3, false));
});

describe("MyCreatedSection", () => {
  it("lists the cards the user created with their type pills", async () => {
    renderSection(3);
    expect(screen.getByText("Cards I Created")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(await screen.findByText("NexaCore ERP")).toBeInTheDocument();
    expect(screen.getByText("Application")).toBeInTheDocument();
    expect(screen.getByText("Provider")).toBeInTheDocument();
    // A type missing from the metamodel falls back to its raw key.
    expect(screen.getByText("RetiredType")).toBeInTheDocument();
    expect(screen.getByText("Showing 3 of 3")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });

  it("shows the empty state and no caption when the user created nothing", async () => {
    mockApi.on("get", FIRST_PAGE, page([], 0, false));
    renderSection(0);
    expect(await screen.findByText("You haven't created any cards yet.")).toBeInTheDocument();
    expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument();
  });

  it("captions the server's total once the first page lands, not the count it was given", async () => {
    renderSection(5);
    expect(screen.getByText("Showing 0 of 5")).toBeInTheDocument();
    expect(await screen.findByText("Showing 3 of 3")).toBeInTheDocument();
  });

  it("captions the count it was given until the first page lands", () => {
    mockApi.on("get", FIRST_PAGE, () => new Promise(() => {}));
    renderSection(42);
    expect(screen.getByText("Showing 0 of 42")).toBeInTheDocument();
  });

  it("loads the rest from the current offset on Show more", async () => {
    const first = Array.from({ length: 2 }, (_, i) =>
      makeCard({ id: `a${i}`, type: "Application", name: `App ${i}` }),
    );
    mockApi.on("get", FIRST_PAGE, page(first, 3, true));
    const more = deferred<ReturnType<typeof page>>();
    mockApi.on("get", "/cards/my-created?limit=200&offset=2", () => more.promise);

    const { user } = renderSection(3);
    expect(await screen.findByText("Showing 2 of 3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show more" }));
    expect(await screen.findByRole("button", { name: "Loading..." })).toBeDisabled();

    more.resolve(page([ERP], 3, false));
    expect(await screen.findByText("NexaCore ERP")).toBeInTheDocument();
    expect(screen.getByText("Showing 3 of 3")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: /Show more|Loading/ })).not.toBeInTheDocument());
  });

  it("offers Show more again when the next batch still is not the last, with the refreshed total", async () => {
    const first = [makeCard({ id: "a0", type: "Application", name: "App 0" })];
    mockApi.on("get", FIRST_PAGE, page(first, 3, true));
    mockApi.on("get", "/cards/my-created?limit=200&offset=1", page([ERP], 4, true));

    const { user } = renderSection(3);
    expect(await screen.findByText("Showing 1 of 3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show more" }));

    expect(await screen.findByText("NexaCore ERP")).toBeInTheDocument();
    // A card was created meanwhile: the caption follows the server's new total.
    expect(screen.getByText("Showing 2 of 4")).toBeInTheDocument();
    // The button comes back, enabled, for the batch after this one.
    await waitFor(() => expect(screen.getByRole("button", { name: "Show more" })).toBeEnabled());
  });

  it("opens a card when its row is clicked", async () => {
    const { user } = renderSection(3);
    await user.click(await screen.findByText("Acme Corp"));
    expect(await screen.findByTestId("landed")).toHaveTextContent("/cards/c2");
  });
});
