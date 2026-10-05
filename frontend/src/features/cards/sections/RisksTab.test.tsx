/**
 * Card Detail → Risks tab: the per-card list behind `GET /cards/{id}/risks`,
 * the two navigation buttons and the create dialog it seeds with the card.
 *
 * `CreateRiskDialog` has its own tests, so it is replaced by a stub that
 * exposes the seed it received and a button firing `onCreated`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

vi.mock("@/features/grc/risk/CreateRiskDialog", () => ({
  default: ({
    open,
    seed,
    onClose,
    onCreated,
  }: {
    open: boolean;
    seed: { cardIds: string[]; mode: string } | null;
    onClose: () => void;
    onCreated: (risk: { id: string }) => void;
  }) =>
    open ? (
      <div data-testid="create-risk-dialog">
        <span data-testid="seed">{`${seed?.mode}:${seed?.cardIds.join(",")}`}</span>
        <button type="button" onClick={() => onCreated({ id: "risk-new" })}>
          created
        </button>
        <button type="button" onClick={onClose}>
          close dialog
        </button>
      </div>
    ) : null,
}));

import { mockApi } from "@/test/apiMock";
import { renderWithProviders, wrapWithProviders } from "@/test/render";
import type { Risk } from "@/types";
import RisksTab from "./RisksTab";

const CARD_ID = "ca4d0000-0000-4000-8000-000000000011";

function makeRisk(overrides: Partial<Risk> & { id: string; title: string }): Risk {
  return {
    reference: "R-000001",
    description: "",
    category: "security",
    source_type: "manual",
    source_ref: null,
    initial_probability: "high",
    initial_impact: "high",
    initial_level: "critical",
    residual_probability: null,
    residual_impact: null,
    residual_level: null,
    owner_id: null,
    owner_name: null,
    target_resolution_date: null,
    status: "identified",
    acceptance_rationale: null,
    accepted_by: null,
    accepted_at: null,
    created_by: null,
    created_at: null,
    updated_at: null,
    cards: [],
    ...overrides,
  } as Risk;
}

const RISKS: Risk[] = [
  makeRisk({ id: "r1", reference: "R-000001", title: "Unpatched database" }),
  makeRisk({
    id: "r2",
    reference: "R-000002",
    title: "Vendor lock-in",
    category: "technology",
    initial_level: "medium",
    residual_level: "low",
    status: "mitigated",
    target_resolution_date: "2026-12-31",
  }),
];

function renderTab() {
  return renderWithProviders(<RisksTab cardId={CARD_ID} />, {
    route: "/cards/x",
    routes: [
      { path: "/cards/x" },
      { path: "/grc", element: <div>GRC page</div> },
      { path: "/grc/risks/:id", element: <div>Risk detail page</div> },
    ],
  });
}

beforeEach(() => {
  mockApi.reset();
  mockApi.on("get", `/cards/${CARD_ID}/risks`, RISKS);
});

describe("RisksTab", () => {
  it("shows a spinner, then the empty state when the card has no risks", async () => {
    mockApi.on("get", `/cards/${CARD_ID}/risks`, []);
    renderTab();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(await screen.findByText("No risks linked to this card.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("paints the spinner first, never a flash of the empty state", () => {
    // The first commit, before any effect runs: what a browser paints while
    // the request is still in flight.
    const html = renderToStaticMarkup(wrapWithProviders(<RisksTab cardId={CARD_ID} />));
    expect(html).toContain('role="progressbar"');
    expect(html).not.toContain("No risks linked to this card.");
    expect(mockApi.callsOf("get")).toHaveLength(0);
  });

  it("renders one row per risk with its chips, and dashes for missing values", async () => {
    renderTab();
    expect(await screen.findByText("Unpatched database")).toBeInTheDocument();
    expect(screen.getByText("Risks")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Reference",
      "Title",
      "Category",
      "Initial",
      "Residual",
      "Status",
      "Target",
    ]);

    const row1 = screen.getByText("R-000001").closest("tr") as HTMLElement;
    expect(within(row1).getByText("Security")).toBeInTheDocument();
    expect(within(row1).getByText("Critical")).toBeInTheDocument();
    expect(within(row1).getByText("Identified")).toBeInTheDocument();
    // No residual level and no target date yet.
    expect(within(row1).getAllByText("—")).toHaveLength(2);

    const row2 = screen.getByText("R-000002").closest("tr") as HTMLElement;
    expect(within(row2).getByText("Technology")).toBeInTheDocument();
    expect(within(row2).getByText("Medium")).toBeInTheDocument();
    expect(within(row2).getByText("Low")).toBeInTheDocument();
    expect(within(row2).getByText("Mitigated")).toBeInTheDocument();
    expect(within(row2).getByText("2026-12-31")).toBeInTheDocument();
  });

  it("opens the risk's detail page when a row is clicked", async () => {
    const { user } = renderTab();
    await user.click(await screen.findByText("Vendor lock-in"));
    expect(await screen.findByText("Risk detail page")).toBeInTheDocument();
  });

  it("jumps to the register from the header button", async () => {
    const { user } = renderTab();
    await user.click(await screen.findByRole("button", { name: "Risk Register" }));
    expect(await screen.findByText("GRC page")).toBeInTheDocument();
  });

  it("seeds the create dialog with this card and follows the new risk once created", async () => {
    const { user } = renderTab();
    await screen.findByText("Unpatched database");
    expect(screen.queryByTestId("create-risk-dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Create new risk/ }));
    expect(screen.getByTestId("seed")).toHaveTextContent(`manual:${CARD_ID}`);

    await user.click(screen.getByRole("button", { name: "created" }));
    // The list is reloaded and the user lands on the new risk.
    await waitFor(() => expect(mockApi.callsOf("get", `/cards/${CARD_ID}/risks`)).toHaveLength(2));
    expect(await screen.findByText("Risk detail page")).toBeInTheDocument();
  });

  it("closes the create dialog without creating anything", async () => {
    const { user } = renderTab();
    await screen.findByText("Unpatched database");
    await user.click(screen.getByRole("button", { name: /Create new risk/ }));
    await user.click(screen.getByRole("button", { name: "close dialog" }));
    expect(screen.queryByTestId("create-risk-dialog")).not.toBeInTheDocument();
    expect(mockApi.callsOf("get", `/cards/${CARD_ID}/risks`)).toHaveLength(1);
  });

  it("surfaces a failed load as a dismissible alert", async () => {
    mockApi.fail("get", `/cards/${CARD_ID}/risks`, 500, "boom");
    const { user } = renderTab();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(`GET /cards/${CARD_ID}/risks failed`);
    // Nothing was loaded, so the list is the empty state rather than a table.
    expect(screen.getByText("No risks linked to this card.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await user.click(within(alert).getByRole("button", { name: /close/i }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("stays quiet when the request is aborted rather than failed", async () => {
    mockApi.abort("get", `/cards/${CARD_ID}/risks`);
    renderTab();
    expect(await screen.findByText("No risks linked to this card.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reloads the list when the card changes", async () => {
    const OTHER_ID = "ca4d0000-0000-4000-8000-000000000099";
    mockApi.on("get", `/cards/${OTHER_ID}/risks`, [
      makeRisk({ id: "r9", reference: "R-000009", title: "Other card's risk" }),
    ]);
    const { rerender } = renderWithProviders(<RisksTab cardId={CARD_ID} />);
    expect(await screen.findByText("Unpatched database")).toBeInTheDocument();

    rerender(wrapWithProviders(<RisksTab cardId={OTHER_ID} />));
    expect(await screen.findByText("Other card's risk")).toBeInTheDocument();
    expect(screen.queryByText("Unpatched database")).not.toBeInTheDocument();
    expect(mockApi.callsOf("get", `/cards/${OTHER_ID}/risks`)).toHaveLength(1);
  });

  it("closes the create dialog once the risk is created", async () => {
    // No route table: the tab stays mounted after the navigation, so what it
    // does with its own dialog is observable.
    const { user } = renderWithProviders(<RisksTab cardId={CARD_ID} />);
    await screen.findByText("Unpatched database");
    await user.click(screen.getByRole("button", { name: /Create new risk/ }));
    await user.click(screen.getByRole("button", { name: "created" }));
    await waitFor(() => expect(mockApi.callsOf("get", `/cards/${CARD_ID}/risks`)).toHaveLength(2));
    await waitFor(() => expect(screen.queryByTestId("create-risk-dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Unpatched database")).toBeInTheDocument();
  });
});
