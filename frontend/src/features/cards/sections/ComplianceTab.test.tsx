/**
 * Card Detail → Compliance tab: the per-card findings list behind
 * `GET /cards/{id}/compliance-findings`, with the shared drawer, the edit
 * dialog and the promote-to-risk dialog hanging off it.
 *
 * The three children have their own tests and are stubbed here with buttons
 * that fire the callbacks this tab wires up, so the tab's own state handling
 * (row refresh after an update, reload + navigate after a promotion) is what
 * is under test.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useComplianceRegulations", () =>
  import("@/test/hooks").then((m) => m.useComplianceRegulationsModule()),
);

vi.mock("@/features/grc/compliance/FindingDetailDrawer", () => ({
  default: ({
    finding,
    onClose,
    onEdit,
    onPromoteToRisk,
    onOpenRisk,
    onUpdated,
  }: {
    finding: { id: string; requirement: string } | null;
    onClose: () => void;
    onEdit: (f: unknown) => void;
    onPromoteToRisk: (f: unknown) => void;
    onOpenRisk: (id: string) => void;
    onUpdated: (f: unknown) => void;
  }) =>
    finding ? (
      <div data-testid="drawer">
        <span data-testid="drawer-requirement">{finding.requirement}</span>
        <button type="button" onClick={onClose}>close drawer</button>
        <button type="button" onClick={() => onEdit(finding)}>edit finding</button>
        <button type="button" onClick={() => onPromoteToRisk(finding)}>promote</button>
        <button type="button" onClick={() => onOpenRisk("risk-7")}>open risk</button>
        <button
          type="button"
          onClick={() => onUpdated({ ...finding, requirement: "Updated requirement" })}
        >
          mark updated
        </button>
        <button
          type="button"
          onClick={() => onUpdated({ ...finding, id: "f2", requirement: "Other row updated" })}
        >
          update other row
        </button>
      </div>
    ) : null,
}));

vi.mock("@/features/grc/compliance/CreateComplianceFindingDialog", () => ({
  default: ({
    open,
    finding,
    onClose,
    onSaved,
  }: {
    open: boolean;
    finding: { id: string } | null;
    onClose: () => void;
    onSaved: (f: unknown) => void;
  }) =>
    open ? (
      <div data-testid="edit-dialog">
        <button type="button" onClick={() => onSaved({ ...finding, requirement: "Saved requirement" })}>
          save finding
        </button>
        <button type="button" onClick={onClose}>close edit</button>
      </div>
    ) : null,
}));

vi.mock("@/features/grc/risk/CreateRiskDialog", () => ({
  default: ({
    open,
    seed,
    onClose,
    onCreated,
  }: {
    open: boolean;
    seed: { mode: string; findingId?: string; cardIds: string[] } | null;
    onClose: () => void;
    onCreated: (risk: { id: string }) => void;
  }) =>
    open ? (
      <div data-testid="risk-dialog">
        <span data-testid="risk-seed">{`${seed?.mode}:${seed?.findingId}:${seed?.cardIds.join(",")}`}</span>
        <button type="button" onClick={() => onCreated({ id: "risk-new" })}>risk created</button>
        <button type="button" onClick={onClose}>close risk</button>
      </div>
    ) : null,
}));

import { mockApi } from "@/test/apiMock";
import { hookState } from "@/test/hooks";
import { renderWithProviders, wrapWithProviders } from "@/test/render";
import { setViewportWidth } from "@/test/matchMedia";
import type { ComplianceRegulation, TurboLensComplianceFinding } from "@/types";
import ComplianceTab from "./ComplianceTab";

const CARD_ID = "ca4d0000-0000-4000-8000-000000000011";
const LIST = `/cards/${CARD_ID}/compliance-findings?`;
const LIST_RESOLVED = `/cards/${CARD_ID}/compliance-findings?include_auto_resolved=true`;

function makeFinding(
  overrides: Partial<TurboLensComplianceFinding> & { id: string; requirement: string },
): TurboLensComplianceFinding {
  return {
    run_id: "run-1",
    regulation: "gdpr",
    regulation_article: null,
    card_id: CARD_ID,
    card_name: "ERP Core",
    card_type: "Application",
    card_has_ai_features: null,
    scope_type: "card",
    category: "data",
    status: "non_compliant",
    severity: "high",
    gap_description: "",
    evidence: null,
    remediation: null,
    ai_detected: false,
    risk_id: null,
    risk_reference: null,
    decision: "new",
    reviewed_by: null,
    reviewer_name: null,
    reviewed_at: null,
    review_note: null,
    auto_resolved: false,
    last_seen_run_id: null,
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

const FINDINGS: TurboLensComplianceFinding[] = [
  makeFinding({ id: "f1", requirement: "Keep a record of processing", regulation_article: "Art. 30" }),
  makeFinding({
    id: "f2",
    requirement: "Register the AI system",
    regulation: "eu_ai_act",
    status: "compliant",
    severity: "low",
    decision: "verified",
    review_note: "Signed off by the AI board",
    auto_resolved: true,
  }),
];

const REGULATIONS: ComplianceRegulation[] = [
  { key: "gdpr", label: "GDPR (custom label)", is_enabled: true } as ComplianceRegulation,
];

function renderTab() {
  return renderWithProviders(<ComplianceTab cardId={CARD_ID} />, {
    route: "/cards/x",
    routes: [
      { path: "/cards/x" },
      { path: "/grc", element: <div>GRC page</div> },
      { path: "/grc/risks/:id", element: <div>Risk detail page</div> },
    ],
  });
}

beforeEach(() => {
  hookState.reset();
  hookState.complianceRegulations = REGULATIONS;
  mockApi.reset();
  mockApi.on("get", LIST, FINDINGS);
  mockApi.on("get", LIST_RESOLVED, [...FINDINGS, makeFinding({ id: "f3", requirement: "Old finding", auto_resolved: true })]);
});

describe("ComplianceTab", () => {
  it("shows a spinner, then the empty state when the card has no findings", async () => {
    mockApi.on("get", LIST, []);
    renderTab();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(await screen.findByText(/No compliance findings recorded/)).toBeInTheDocument();
  });

  it("paints the spinner first, never a flash of the empty state", () => {
    // The first commit, before any effect runs: what a browser paints while
    // the request is still in flight.
    const html = renderToStaticMarkup(wrapWithProviders(<ComplianceTab cardId={CARD_ID} />));
    expect(html).toContain('role="progressbar"');
    expect(html).not.toContain("No compliance findings recorded");
    expect(mockApi.callsOf("get")).toHaveLength(0);
  });

  it("renders a row per finding, naming the regulation from the catalogue or the built-in label", async () => {
    renderTab();
    expect(await screen.findByText("Keep a record of processing")).toBeInTheDocument();
    expect(screen.getByText("Compliance findings")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Regulation",
      "Article",
      "Status",
      "Severity",
      "Lifecycle",
      "Requirement",
    ]);

    const row1 = screen.getByText("Keep a record of processing").closest("tr") as HTMLElement;
    // Admin-managed label wins over the built-in one.
    expect(within(row1).getByText("GDPR (custom label)")).toBeInTheDocument();
    expect(within(row1).getByText("Art. 30")).toBeInTheDocument();
    expect(within(row1).getByText("Non-compliant")).toBeInTheDocument();
    expect(within(row1).getByText("High")).toBeInTheDocument();
    expect(within(row1).getByText("New")).toBeInTheDocument();

    const row2 = screen.getByText("Register the AI system").closest("tr") as HTMLElement;
    // Not in the catalogue → falls back to the admin namespace.
    expect(within(row2).getByText("EU AI Act")).toBeInTheDocument();
    expect(within(row2).getByText("—")).toBeInTheDocument();
    expect(within(row2).getByText("Verified")).toBeInTheDocument();
    expect(row2).toHaveStyle({ opacity: "0.65" });

    // The lifecycle chip explains itself: the reviewer's note when there is
    // one, otherwise what the lifecycle state means.
    expect(
      within(row1).getByLabelText("Fresh from the scanner. Awaiting human review."),
    ).toHaveTextContent("New");
    expect(within(row2).getByLabelText("Signed off by the AI board")).toHaveTextContent("Verified");
  });

  it("shows a regulation neither the catalogue nor the built-in labels know by its key", async () => {
    mockApi.on("get", LIST, [
      makeFinding({ id: "f9", requirement: "Follow the house rule", regulation: "acme_policy" }),
    ]);
    renderTab();
    const row = (await screen.findByText("Follow the house rule")).closest("tr") as HTMLElement;
    expect(within(row).getByText("acme_policy")).toBeInTheDocument();
  });

  it("re-queries with include_auto_resolved when the checkbox is ticked", async () => {
    const { user } = renderTab();
    await screen.findByText("Keep a record of processing");
    await user.click(screen.getByRole("checkbox", { name: "Include auto-resolved" }));
    expect(await screen.findByText("Old finding")).toBeInTheDocument();
    expect(mockApi.callsOf("get", LIST_RESOLVED)).toHaveLength(1);
  });

  it("opens the compliance module from the header button", async () => {
    const { user } = renderTab();
    await user.click(await screen.findByRole("button", { name: "Open compliance module" }));
    expect(await screen.findByText("GRC page")).toBeInTheDocument();
  });

  it("opens the drawer on a row and keeps the row in sync with updates", async () => {
    const { user } = renderTab();
    await user.click(await screen.findByText("Keep a record of processing"));
    expect(screen.getByTestId("drawer-requirement")).toHaveTextContent("Keep a record of processing");

    await user.click(screen.getByRole("button", { name: "mark updated" }));
    // Both the table row and the drawer reflect the update.
    expect(screen.getByTestId("drawer-requirement")).toHaveTextContent("Updated requirement");
    expect(screen.getByRole("cell", { name: "Updated requirement" })).toBeInTheDocument();
    // Only the updated finding's row changed.
    expect(screen.queryByRole("cell", { name: "Keep a record of processing" })).not.toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Register the AI system" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "close drawer" }));
    expect(screen.queryByTestId("drawer")).not.toBeInTheDocument();
  });

  it("updates another finding's row without swapping the open drawer", async () => {
    const { user } = renderTab();
    await user.click(await screen.findByText("Keep a record of processing"));
    await user.click(screen.getByRole("button", { name: "update other row" }));
    expect(screen.getByTestId("drawer-requirement")).toHaveTextContent("Keep a record of processing");
    expect(screen.getByRole("cell", { name: "Other row updated" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Keep a record of processing" })).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "Register the AI system" })).not.toBeInTheDocument();
  });

  it("hands the finding to the edit dialog and applies what it saved", async () => {
    const { user } = renderTab();
    await user.click(await screen.findByText("Register the AI system"));
    await user.click(screen.getByRole("button", { name: "edit finding" }));
    // The drawer closes as the dialog opens.
    expect(screen.queryByTestId("drawer")).not.toBeInTheDocument();
    expect(screen.getByTestId("edit-dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "save finding" }));
    expect(screen.queryByTestId("edit-dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Saved requirement" })).toBeInTheDocument();
    // Saving does not reopen the drawer it was launched from.
    expect(screen.queryByTestId("drawer")).not.toBeInTheDocument();
  });

  it("closes the edit dialog without changing the row", async () => {
    const { user } = renderTab();
    await user.click(await screen.findByText("Register the AI system"));
    await user.click(screen.getByRole("button", { name: "edit finding" }));
    await user.click(screen.getByRole("button", { name: "close edit" }));
    expect(screen.queryByTestId("edit-dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Register the AI system")).toBeInTheDocument();
  });

  it("promotes a finding to a risk, then reloads and opens the new risk", async () => {
    const { user } = renderTab();
    await user.click(await screen.findByText("Keep a record of processing"));
    await user.click(screen.getByRole("button", { name: "promote" }));
    expect(screen.getByTestId("risk-seed")).toHaveTextContent(`compliance:f1:${CARD_ID}`);

    await user.click(screen.getByRole("button", { name: "risk created" }));
    await waitFor(() => expect(mockApi.callsOf("get", LIST)).toHaveLength(2));
    expect(await screen.findByText("Risk detail page")).toBeInTheDocument();
  });

  it("closes the risk dialog once the risk is created", async () => {
    // No route table: the tab stays mounted after the navigation, so what it
    // does with its own dialog is observable.
    const { user } = renderWithProviders(<ComplianceTab cardId={CARD_ID} />);
    await user.click(await screen.findByText("Keep a record of processing"));
    await user.click(screen.getByRole("button", { name: "promote" }));
    await user.click(screen.getByRole("button", { name: "risk created" }));
    await waitFor(() => expect(mockApi.callsOf("get", LIST)).toHaveLength(2));
    await waitFor(() => expect(screen.queryByTestId("risk-dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Keep a record of processing")).toBeInTheDocument();
  });

  it("dismisses the risk dialog and navigates to an existing risk from the drawer", async () => {
    const { user } = renderTab();
    await user.click(await screen.findByText("Keep a record of processing"));
    await user.click(screen.getByRole("button", { name: "promote" }));
    await user.click(screen.getByRole("button", { name: "close risk" }));
    expect(screen.queryByTestId("risk-dialog")).not.toBeInTheDocument();

    await user.click(screen.getByText("Keep a record of processing"));
    await user.click(screen.getByRole("button", { name: "open risk" }));
    expect(await screen.findByText("Risk detail page")).toBeInTheDocument();
  });

  it("renders stacked cards instead of a table on a phone", async () => {
    setViewportWidth(400);
    const { user } = renderTab();
    expect(await screen.findByText("Keep a record of processing")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("Art. 30")).toBeInTheDocument();
    expect(screen.getByText("GDPR (custom label)")).toBeInTheDocument();

    const first = screen.getByText("Keep a record of processing").parentElement as HTMLElement;
    expect(within(first).getByText("Non-compliant")).toBeInTheDocument();
    expect(within(first).getByText("High")).toBeInTheDocument();
    expect(within(first).getByText("New")).toBeInTheDocument();
    const second = screen.getByText("Register the AI system").parentElement as HTMLElement;
    // Not in the catalogue → the built-in label.
    expect(within(second).getByText("EU AI Act")).toBeInTheDocument();
    expect(within(second).getByText("Compliant")).toBeInTheDocument();
    expect(within(second).getByText("Low")).toBeInTheDocument();
    expect(within(second).getByText("Verified")).toBeInTheDocument();

    await user.click(screen.getByText("Register the AI system"));
    expect(screen.getByTestId("drawer-requirement")).toHaveTextContent("Register the AI system");
  });

  it("names an unknown regulation by its key on a phone too", async () => {
    setViewportWidth(400);
    mockApi.on("get", LIST, [
      makeFinding({ id: "f9", requirement: "Follow the house rule", regulation: "acme_policy" }),
    ]);
    renderTab();
    const card = (await screen.findByText("Follow the house rule")).parentElement as HTMLElement;
    expect(within(card).getByText("acme_policy")).toBeInTheDocument();
  });

  it("stays quiet when the request is aborted rather than failed", async () => {
    mockApi.abort("get", LIST);
    renderTab();
    expect(await screen.findByText(/No compliance findings recorded/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("surfaces a failed load as a dismissible alert", async () => {
    mockApi.fail("get", LIST, 500, "boom");
    const { user } = renderTab();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(`GET ${LIST} failed`);
    // Nothing was loaded, so the list is the empty state rather than a table.
    expect(screen.getByText(/No compliance findings recorded/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await user.click(within(alert).getByRole("button", { name: /close/i }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
