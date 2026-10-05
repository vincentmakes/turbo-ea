/**
 * PrinciplesCataloguePage — browse the curated principles reference set and
 * import a selection into the principles register.
 *
 * Pins what `/principles-catalogue` renders (version chip, bullets, the
 * already-imported marker), the client-side search, the selection controls,
 * and the `/principles-catalogue/import` round-trip with its result dialog.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router";
import type { CataloguePrinciple, PrinciplesCataloguePayload } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import PrinciplesCataloguePage from "./PrinciplesCataloguePage";

function principle(overrides: Partial<CataloguePrinciple> & { id: string; title: string }): CataloguePrinciple {
  return {
    description: null,
    rationale: null,
    implications: null,
    existing_principle_id: null,
    ...overrides,
  };
}

const P1 = principle({
  id: "PR-001",
  title: "Data is an Asset",
  description: "See https://example.com/data-asset",
  rationale: "- Accurate data drives decisions\n\n* Shared data saves cost",
  implications: "• Data stewards are named",
});
const P2 = principle({ id: "PR-002", title: "Reuse before Buy", description: "Prefer existing platforms" });
const P3 = principle({
  id: "PR-003",
  title: "Business Continuity",
  existing_principle_id: "ep-1",
  implications: "Recovery plans are tested",
});

const PAYLOAD: PrinciplesCataloguePayload = {
  catalogue_version: "2026.1",
  generated_at: null,
  principles: [P1, P2, P3],
};

function Probe() {
  const { pathname } = useLocation();
  return <div data-testid="landed">{pathname}</div>;
}

function renderPage() {
  return renderWithProviders(<PrinciplesCataloguePage />, {
    routes: [{ path: "/" }, { path: "/admin/metamodel", element: <Probe /> }],
  });
}

/** The card of one principle. */
const cardOf = (title: string) => screen.getByText(title).closest(".MuiCard-root") as HTMLElement;
const checkboxOf = (title: string) => within(cardOf(title)).getByRole("checkbox");

beforeEach(() => {
  mockApi.reset();
  mockApi.on("get", "/principles-catalogue", PAYLOAD);
});

describe("PrinciplesCataloguePage — browsing", () => {
  it("lists every principle with its version, bullets and linkified description", async () => {
    renderPage();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(await screen.findByText("Data is an Asset")).toBeInTheDocument();
    expect(screen.getByText("Catalogue v2026.1")).toBeInTheDocument();
    expect(screen.getByText("Showing 3 of 3 — 2 not yet imported")).toBeInTheDocument();

    const card = cardOf("Data is an Asset");
    expect(within(card).getByText("PR-001")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "https://example.com/data-asset" })).toBeInTheDocument();
    // Bullet markers are stripped and blank lines dropped.
    expect(within(card).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Accurate data drives decisions",
      "Shared data saves cost",
      "Data stewards are named",
    ]);
    expect(within(card).getByText("Rationale")).toBeInTheDocument();
    expect(within(card).getByText("Implications")).toBeInTheDocument();
  });

  it("marks an already-imported principle and offers no checkbox for it", async () => {
    renderPage();
    await screen.findByText("Business Continuity");
    const card = cardOf("Business Continuity");
    expect(within(card).getByText("Already imported")).toBeInTheDocument();
    expect(within(card).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(card).queryByText("Rationale")).not.toBeInTheDocument();
  });

  it("omits the version chip when the catalogue has no version", async () => {
    mockApi.on("get", "/principles-catalogue", { ...PAYLOAD, catalogue_version: null });
    renderPage();
    await screen.findByText("Data is an Asset");
    expect(screen.queryByText(/^Catalogue v/)).not.toBeInTheDocument();
  });

  it("filters across title, description, rationale and implications", async () => {
    const { user } = renderPage();
    await screen.findByText("Data is an Asset");
    const search = screen.getByPlaceholderText("Search principles...");

    await user.type(search, "platforms");
    expect(screen.getByText("Reuse before Buy")).toBeInTheDocument();
    expect(screen.queryByText("Data is an Asset")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 3 — 2 not yet imported")).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "STEWARDS");
    expect(screen.getByText("Data is an Asset")).toBeInTheDocument();
    expect(screen.queryByText("Reuse before Buy")).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "recovery");
    expect(screen.getByText("Business Continuity")).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "zzz");
    expect(screen.getByText("No principles match your search")).toBeInTheDocument();
  });

  it("shows the load error and lets the user dismiss it", async () => {
    mockApi.fail("get", "/principles-catalogue", 500);
    const { user } = renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("GET /principles-catalogue failed");
    expect(screen.getByText("No principles match your search")).toBeInTheDocument();
    await user.click(within(alert).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("PrinciplesCataloguePage — selection", () => {
  it("toggles single principles and shows the selection bar", async () => {
    const { user } = renderPage();
    await screen.findByText("Data is an Asset");
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();

    await user.click(checkboxOf("Data is an Asset"));
    expect(checkboxOf("Data is an Asset")).toBeChecked();
    expect(screen.getByText("1 principle selected")).toBeInTheDocument();

    await user.click(checkboxOf("Reuse before Buy"));
    expect(screen.getByText("2 principles selected")).toBeInTheDocument();

    await user.click(checkboxOf("Data is an Asset"));
    expect(screen.getByText("1 principle selected")).toBeInTheDocument();
  });

  it("selects every visible, importable principle and clears the selection", async () => {
    const { user } = renderPage();
    await screen.findByText("Data is an Asset");
    const selectVisible = screen.getByRole("button", { name: "Select all visible" });
    const clear = screen.getByRole("button", { name: "Clear" });
    expect(clear).toBeDisabled();

    await user.click(selectVisible);
    expect(screen.getByText("2 principles selected")).toBeInTheDocument();
    // Nothing left to add once every importable row is ticked.
    expect(selectVisible).toBeDisabled();

    await user.click(clear);
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();
    expect(checkboxOf("Data is an Asset")).not.toBeChecked();
  });

  it("selects only what the search shows", async () => {
    const { user } = renderPage();
    await screen.findByText("Data is an Asset");
    await user.type(screen.getByPlaceholderText("Search principles..."), "reuse");
    await user.click(screen.getByRole("button", { name: "Select all visible" }));
    expect(screen.getByText("1 principle selected")).toBeInTheDocument();
  });

  it("cancels the selection from the selection bar", async () => {
    const { user } = renderPage();
    await screen.findByText("Data is an Asset");
    await user.click(checkboxOf("Reuse before Buy"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();
  });
});

describe("PrinciplesCataloguePage — import", () => {
  it("imports the selection, reloads, and opens the principles admin from the result", async () => {
    mockApi.on("post", "/principles-catalogue/import", {
      created: [{ catalogue_id: "PR-001", principle_id: "ep-9" }],
      skipped: [{ catalogue_id: "PR-002", principle_id: "ep-2", reason: "exists" }],
      catalogue_version: "2026.1",
    });
    const { user } = renderPage();
    await screen.findByText("Data is an Asset");
    await user.click(checkboxOf("Data is an Asset"));
    await user.click(checkboxOf("Reuse before Buy"));
    await user.click(screen.getByRole("button", { name: /Import/ }));

    const confirm = await screen.findByRole("dialog", { name: "Import principles" });
    expect(within(confirm).getByText("Create 2 principles from the catalogue?")).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "Import" }));

    await waitFor(() => expect(mockApi.callsOf("post", "/principles-catalogue/import")).toHaveLength(1));
    expect(mockApi.callsOf("post", "/principles-catalogue/import")[0].body).toEqual({
      catalogue_ids: ["PR-001", "PR-002"],
    });
    const done = await screen.findByRole("dialog", { name: "Import complete" });
    expect(within(done).getByText("Created 1, skipped 1.")).toBeInTheDocument();
    expect(mockApi.callsOf("get", "/principles-catalogue")).toHaveLength(2);
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();

    await user.click(within(done).getByRole("button", { name: "Open Principles admin" }));
    expect(await screen.findByTestId("landed")).toHaveTextContent("/admin/metamodel");
  });

  it("closes the result dialog without leaving the page", async () => {
    mockApi.on("post", "/principles-catalogue/import", { created: [], skipped: [], catalogue_version: null });
    const { user } = renderPage();
    await screen.findByText("Data is an Asset");
    await user.click(checkboxOf("Data is an Asset"));
    await user.click(screen.getByRole("button", { name: /Import/ }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Import" }));
    const done = await screen.findByRole("dialog", { name: "Import complete" });
    expect(within(done).getByText("Created 0, skipped 0.")).toBeInTheDocument();
    await user.click(within(done).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByTestId("landed")).not.toBeInTheDocument();
  });

  it("keeps the dialog open with the error and the selection intact when the import fails", async () => {
    mockApi.fail("post", "/principles-catalogue/import", 500);
    const { user } = renderPage();
    await screen.findByText("Data is an Asset");
    await user.click(checkboxOf("Reuse before Buy"));
    await user.click(screen.getByRole("button", { name: /Import/ }));
    const confirm = await screen.findByRole("dialog", { name: "Import principles" });
    expect(within(confirm).getByText("Create 1 principle from the catalogue?")).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "Import" }));

    expect(await within(confirm).findByText("POST /principles-catalogue/import failed")).toBeInTheDocument();
    expect(within(confirm).getByRole("button", { name: "Import" })).toBeEnabled();
    expect(mockApi.callsOf("get", "/principles-catalogue")).toHaveLength(1);

    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("1 principle selected")).toBeInTheDocument();
  });
});
