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
import { renderToStaticMarkup } from "react-dom/server";
import { useLocation } from "react-router";
import type { CataloguePrinciple, PrinciplesCataloguePayload } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import { renderWithProviders, wrapWithProviders } from "@/test/render";
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
const NO_MATCHES = "No principles match your search";

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Tick principles, open the import dialog from the selection bar, and confirm it. */
async function importSelection(user: ReturnType<typeof renderPage>["user"], ...titles: string[]) {
  for (const title of titles) await user.click(checkboxOf(title));
  await user.click(screen.getByRole("button", { name: /Import/ }));
  const confirm = await screen.findByRole("dialog", { name: "Import principles" });
  await user.click(within(confirm).getByRole("button", { name: "Import" }));
  return confirm;
}

beforeEach(() => {
  mockApi.reset();
  mockApi.on("get", "/principles-catalogue", PAYLOAD);
});

describe("PrinciplesCataloguePage — browsing", () => {
  it("paints the heading and a spinner — not the no-match state — before the catalogue arrives", () => {
    const html = renderToStaticMarkup(wrapWithProviders(<PrinciplesCataloguePage />));
    expect(html).toContain("Principles Catalogue");
    expect(html).toContain("Curated reference set of industry-standard EA principles.");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain("Showing 0 of 0 — 0 not yet imported");
    expect(html).not.toContain(NO_MATCHES);
  });

  it("lists every principle with its version, bullets and linkified description", async () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Principles Catalogue" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(await screen.findByText("Data is an Asset")).toBeInTheDocument();
    expect(screen.getByText("Catalogue v2026.1")).toBeInTheDocument();
    expect(screen.getByText("Showing 3 of 3 — 2 not yet imported")).toBeInTheDocument();
    expect(screen.queryByText(NO_MATCHES)).not.toBeInTheDocument();

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
    const { user } = renderPage();
    await screen.findByText("Business Continuity");
    const card = cardOf("Business Continuity");
    expect(within(card).getByText("Already imported")).toBeInTheDocument();
    expect(within(card).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(card).queryByText("Rationale")).not.toBeInTheDocument();
    // The tick that stands in for the checkbox explains itself.
    await user.hover(within(card).getByText("check_circle"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Already imported");
  });

  it("turns each non-blank line into a bullet, stripping only a leading marker", async () => {
    mockApi.on("get", "/principles-catalogue", {
      ...PAYLOAD,
      principles: [
        principle({
          id: "PR-009",
          title: "Lean Bullets",
          rationale: "  - Indented bullet  \n   \n-tight bullet\n*   spaced bullet\nCost-effective reuse",
        }),
      ],
    });
    renderPage();
    await screen.findByText("Lean Bullets");
    expect(within(cardOf("Lean Bullets")).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Indented bullet",
      "tight bullet",
      "spaced bullet",
      "Cost-effective reuse",
    ]);
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

  it("matches the rationale too", async () => {
    const { user } = renderPage();
    await screen.findByText("Data is an Asset");
    await user.type(screen.getByPlaceholderText("Search principles..."), "decisions");
    expect(screen.getByText("Data is an Asset")).toBeInTheDocument();
    expect(screen.queryByText("Reuse before Buy")).not.toBeInTheDocument();
    expect(screen.queryByText("Business Continuity")).not.toBeInTheDocument();
  });

  it("ignores spaces around the search term, and a blank search shows everything", async () => {
    const { user } = renderPage();
    await screen.findByText("Data is an Asset");
    const search = screen.getByPlaceholderText("Search principles...");

    await user.type(search, "  reuse  ");
    expect(screen.getByText("Reuse before Buy")).toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 3 — 2 not yet imported")).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "   ");
    expect(screen.getByText("Showing 3 of 3 — 2 not yet imported")).toBeInTheDocument();
  });

  it("never matches a term that only exists across two fields run together", async () => {
    const { user } = renderPage();
    await screen.findByText("Data is an Asset");
    // "Reuse before Buy" + "Prefer existing platforms": no single field holds "buyprefer".
    await user.type(screen.getByPlaceholderText("Search principles..."), "buyprefer");
    expect(screen.getByText(NO_MATCHES)).toBeInTheDocument();
    expect(screen.queryByText("Reuse before Buy")).not.toBeInTheDocument();
  });

  it("shows the load error and lets the user dismiss it", async () => {
    mockApi.fail("get", "/principles-catalogue", 500);
    const { user } = renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("GET /principles-catalogue failed");
    expect(screen.getByText("No principles match your search")).toBeInTheDocument();
    expect(screen.getByText("Showing 0 of 0 — 0 not yet imported")).toBeInTheDocument();
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

  it("clears an earlier reload error once a later reload succeeds", async () => {
    let gets = 0;
    mockApi.on("get", "/principles-catalogue", () => {
      gets += 1;
      return gets === 2 ? Promise.reject(new Error("catalogue offline")) : PAYLOAD;
    });
    mockApi.on("post", "/principles-catalogue/import", { created: [], skipped: [], catalogue_version: null });
    const { user } = renderPage();
    await screen.findByText("Data is an Asset");

    await importSelection(user, "Data is an Asset");
    const done = await screen.findByRole("dialog", { name: "Import complete" });
    // The reload after the import fails; the list stays and the error shows.
    expect(await screen.findByText("catalogue offline")).toBeInTheDocument();
    await user.click(within(done).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await importSelection(user, "Reuse before Buy");
    await screen.findByRole("dialog", { name: "Import complete" });
    await waitFor(() => expect(mockApi.callsOf("get", "/principles-catalogue")).toHaveLength(3));
    await waitFor(() => expect(screen.queryByText("catalogue offline")).not.toBeInTheDocument());
  });

  it("locks the dialog while the import runs, and a retry clears the previous error", async () => {
    let posts = 0;
    const second = deferred<object>();
    mockApi.on("post", "/principles-catalogue/import", () => {
      posts += 1;
      return posts === 1 ? Promise.reject(new Error("import offline")) : second.promise;
    });
    const { user } = renderPage();
    await screen.findByText("Data is an Asset");
    await user.click(checkboxOf("Reuse before Buy"));
    await user.click(screen.getByRole("button", { name: /Import/ }));
    const confirm = await screen.findByRole("dialog", { name: "Import principles" });
    // Nothing has failed yet.
    expect(within(confirm).queryByRole("alert")).not.toBeInTheDocument();

    await user.click(within(confirm).getByRole("button", { name: "Import" }));
    expect(await within(confirm).findByRole("alert")).toHaveTextContent("import offline");

    await user.click(within(confirm).getByRole("button", { name: "Import" }));
    await waitFor(() => expect(posts).toBe(2));
    await waitFor(() => expect(within(confirm).queryByRole("alert")).not.toBeInTheDocument());
    expect(within(confirm).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(within(confirm).getByRole("progressbar")).toBeInTheDocument();
    // Escape cannot close it mid-import.
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Import principles" })).toBeInTheDocument();

    second.resolve({ created: [{ catalogue_id: "PR-002", principle_id: "ep-2" }], skipped: [], catalogue_version: null });
    expect(await screen.findByRole("dialog", { name: "Import complete" })).toBeInTheDocument();
  });

  it("closes the confirmation on Escape without importing", async () => {
    const { user } = renderPage();
    await screen.findByText("Data is an Asset");
    await user.click(checkboxOf("Reuse before Buy"));
    await user.click(screen.getByRole("button", { name: /Import/ }));
    await screen.findByRole("dialog", { name: "Import principles" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("post")).toHaveLength(0);
    expect(screen.getByText("1 principle selected")).toBeInTheDocument();
  });

  it("closes the result on Escape without leaving the page", async () => {
    mockApi.on("post", "/principles-catalogue/import", { created: [], skipped: [], catalogue_version: null });
    const { user } = renderPage();
    await screen.findByText("Data is an Asset");
    await importSelection(user, "Data is an Asset");
    await screen.findByRole("dialog", { name: "Import complete" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByTestId("landed")).not.toBeInTheDocument();
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

    expect(await within(confirm).findByRole("alert")).toHaveTextContent("POST /principles-catalogue/import failed");
    expect(within(confirm).getByRole("button", { name: "Import" })).toBeEnabled();
    expect(mockApi.callsOf("get", "/principles-catalogue")).toHaveLength(1);

    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("1 principle selected")).toBeInTheDocument();
  });
});
