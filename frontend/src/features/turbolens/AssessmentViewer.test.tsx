/**
 * The read-only view of a saved Architecture-AI assessment
 * (`GET /turbolens/assessments/{id}`): every wizard phase rendered from
 * `session_data` (both the old and the new key names), the selected option /
 * recommendations / dependency options marked, the target architecture's
 * capabilities, proposed cards and relations, and the merged graph handed to
 * the Layered Dependency View — relation endpoints remapped through capability
 * and proposed-card ids and turned to the relation type's direction. Plus the
 * three ways out: back to the list, Resume in the wizard, Open Initiative.
 *
 * The Layered Dependency View is stubbed (it has its own test); the stub
 * records the nodes and edges it is handed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router";
import type { GEdge, GNode } from "@/features/reports/layeredDependencyLayout";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

const ldv = vi.hoisted(() => ({ props: null as null | { nodes: GNode[]; edges: GEdge[]; types: unknown } }));
vi.mock("@/features/reports/LayeredDependencyView", () => ({
  default: (props: { nodes: GNode[]; edges: GEdge[]; types: unknown; onNodeClick: () => void; onHome: () => void }) => {
    ldv.props = props;
    // The viewer is read-only: both handlers are inert.
    props.onNodeClick();
    props.onHome();
    return <div data-testid="ldv">{`${props.nodes.length} nodes / ${props.edges.length} edges`}</div>;
  },
}));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { CARD_TYPES, RELATION_TYPES } from "@/test/fixtures/metamodel";
import { renderWithProviders } from "@/test/render";
import { resetPageTitle, usePageTitleSlots } from "@/hooks/usePageTitle";
import type { TurboLensAssessment } from "@/types";
import AssessmentViewer from "./AssessmentViewer";

const URL_A1 = "/turbolens/assessments/a-1";
const NO_IMPACT = { newComponents: [], modifiedComponents: [], newIntegrations: [], retiredComponents: [] };

const SESSION = {
  requirement: "Replace the CRM. Spec at https://example.com/spec",
  selectedObjectives: [{ id: "o1", name: "Grow revenue" }],
  selectedCapabilities: [
    { id: "cap-1", name: "Customer Management" },
    { id: "cap-new", name: "Lead Scoring", isNew: true },
  ],
  phase1Answers: [{ question: "Who are the users?", answer: "Sales reps, see https://example.com/users" }],
  archQuestions: [
    { question: "Uptime target?", answer: "99.9%", nfrCategory: "availability" },
    { question: "Data residency?", answer: "" },
  ],
  archOptions: [
    { id: "opt-1", title: "Buy a SaaS CRM", approach: "buy", summary: "Adopt a SaaS suite", impactPreview: NO_IMPACT },
    { id: "opt-2", title: "Build in-house", approach: "build", summary: "Custom app", impactPreview: NO_IMPACT },
  ],
  selectedOptionId: "opt-1",
  gapResult: {
    summary: "Three capability gaps",
    gaps: [
      {
        capability: "Lead Scoring Gap",
        urgency: "critical",
        impact: "Lost deals",
        recommendations: [
          {
            name: "Einstein",
            vendor: "Salesforce",
            why: "Native to the suite",
            pros: ["Integrated"],
            cons: ["Costly"],
            estimatedCost: "$50k/yr",
            integrationEffort: "low",
          },
          { name: "MadKudu" },
          { name: "6sense" },
        ],
      },
      { capability: "Reporting Gap", urgency: "high" },
      { capability: "Archiving Gap" },
    ],
  },
  selectedRecs: ["0:0"],
  depsResult: {
    summary: "One platform dependency",
    dependencies: [
      {
        need: "Identity provider",
        reason: "SSO for every user",
        urgency: "high",
        options: [
          {
            name: "Okta",
            vendor: "Okta Inc",
            why: "Industry standard",
            pros: ["Mature"],
            cons: ["Price"],
            estimatedCost: "$10k/yr",
            integrationEffort: "medium",
          },
          { name: "Entra ID" },
        ],
      },
      { need: "Message bus", urgency: "critical" },
      { need: "Backups" },
    ],
  },
  selectedDeps: ["0:1"],
  capabilityMapping: {
    summary: "Target state after the CRM swap",
    capabilities: [
      { id: "cap-1", name: "Customer Management", isNew: false, existingCardId: "bc-existing" },
      { id: "cap-new", name: "Lead Scoring", isNew: true },
    ],
    proposedCards: [
      { id: "pc-1", name: "Sales Cloud", cardTypeKey: "Application", subtype: "businessApplication", isNew: true },
      { id: "pc-2", name: "Kafka", cardTypeKey: "ITComponent", subtype: "streaming", isNew: true },
      { id: "pc-3", name: "Old CRM", cardTypeKey: "Application", isNew: false, existingCardId: "app-old" },
      { id: "pc-4", name: "Mystery Box", cardTypeKey: "Widget", isNew: true },
    ],
    proposedRelations: [
      { sourceId: "pc-1", targetId: "pc-2", relationType: "relAppToITC", label: "uses" },
      // Stored capability → application although relAppToBC runs the other way,
      // and addressing the capability by its existing card id.
      { sourceId: "bc-existing", targetId: "pc-1", relationType: "relAppToBC" },
      // Addressing a proposed card by the id of the card it stands for.
      { sourceId: "app-old", targetId: "cap-new", relationType: "relAppToBC" },
      // No relation type the metamodel knows: the stored label is kept.
      { sourceId: "pc-2", targetId: "pc-4", relationType: "relCustom", label: "hosts" },
      { sourceId: "pc-4", targetId: "itc-db", relationType: "relCustom" },
      // An endpoint that is not on the canvas is listed but not drawn.
      { sourceId: "pc-1", targetId: "ghost-card", relationType: "relAppToITC", label: "uses" },
    ],
    existingDependencies: {
      nodes: [
        { id: "bc-existing", name: "Customer Mgmt (live)", type: "BusinessCapability" },
        { id: "itc-db", name: "Postgres", type: "ITComponent" },
        { id: "itc-db", name: "Postgres", type: "ITComponent" },
      ],
      edges: [{ source: "itc-db", target: "bc-existing", type: "relLegacy", label: "backs" }],
    },
  },
};

function assessment(overrides: Partial<TurboLensAssessment> = {}): TurboLensAssessment {
  return {
    id: "a-1",
    title: "CRM replacement",
    requirement: "",
    status: "saved",
    session_data: SESSION,
    initiative_id: null,
    created_by: "u-1",
    created_by_name: "Ada Lovelace",
    created_at: "2026-02-01T09:00:00Z",
    updated_at: null,
    ...overrides,
  };
}

function Probe() {
  const { pathname, search } = useLocation();
  const { subject } = usePageTitleSlots();
  return (
    <>
      <output data-testid="location">{`${pathname}${search}`}</output>
      <output data-testid="subject">{subject?.text ?? ""}</output>
    </>
  );
}

function renderViewer(route = "/turbolens/assessments/a-1") {
  return renderWithProviders(
    <>
      <AssessmentViewer />
      <Probe />
    </>,
    {
      route,
      routes: [{ path: "/turbolens/assessments/:id" }, { path: "*", element: <Probe /> }],
    },
  );
}

/** The outlined panel that holds `text`. */
function panelOf(text: string | RegExp): HTMLElement {
  return screen.getByText(text).closest(".MuiPaper-outlined") as HTMLElement;
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel(CARD_TYPES, RELATION_TYPES);
  resetPageTitle();
  ldv.props = null;
});

describe("AssessmentViewer — loading and errors", () => {
  it("shows a loading line until the assessment arrives", async () => {
    let resolve: (v: TurboLensAssessment) => void = () => {};
    mockApi.on("get", URL_A1, () => new Promise<TurboLensAssessment>((r) => (resolve = r)));
    renderViewer();

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    resolve(assessment());
    expect(await screen.findByRole("heading", { name: "CRM replacement" })).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    // The assessment's title names the browser tab, set by an effect after that render.
    await waitFor(() => expect(screen.getByTestId("subject")).toHaveTextContent("CRM replacement"));
  });

  it("shows the request's error when the assessment cannot be loaded", async () => {
    mockApi.fail("get", URL_A1, 404, "Not found");
    renderViewer();

    expect(await screen.findByRole("alert")).toHaveTextContent(`GET ${URL_A1} failed`);
  });

  it("falls back to a generic message when the error carries none", async () => {
    mockApi.on("get", URL_A1, () => Promise.reject(new Error("")));
    renderViewer();

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to load assessment");
  });

  it("says the assessment was not found when the API returns nothing", async () => {
    mockApi.on("get", URL_A1, null);
    renderViewer();

    expect(await screen.findByRole("alert")).toHaveTextContent("Assessment not found");
  });
});

describe("AssessmentViewer — a saved assessment", () => {
  it("renders the header with Resume, status and author, and navigates back to the list", async () => {
    mockApi.on("get", URL_A1, assessment());
    const { user } = renderViewer();

    await screen.findByRole("heading", { name: "CRM replacement" });
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("Created by: Ada Lovelace")).toBeInTheDocument();
    // Only a committed assessment links its initiative.
    expect(screen.queryByRole("button", { name: "Open Initiative" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Architecture Assessments$/ }));
    expect(screen.getByTestId("location")).toHaveTextContent("/turbolens?tab=assessments");
  });

  it("resumes the assessment in the Architect wizard", async () => {
    mockApi.on("get", URL_A1, assessment());
    const { user } = renderViewer();

    await user.click(await screen.findByRole("button", { name: /Resume$/ }));
    expect(screen.getByTestId("location")).toHaveTextContent("/turbolens?tab=architect&resume=a-1");
  });

  it("renders the requirement with its objectives and capabilities", async () => {
    mockApi.on("get", URL_A1, assessment());
    renderViewer();

    await screen.findByText("Requirements");
    const req = panelOf(/^Replace the CRM/);
    expect(within(req).getByRole("link", { name: "https://example.com/spec" })).toHaveAttribute(
      "href",
      "https://example.com/spec",
    );
    expect(within(req).getByText(/Which business objectives/)).toBeInTheDocument();
    expect(within(req).getByText("Grow revenue")).toBeInTheDocument();
    expect(within(req).getByText(/Which business capabilities/)).toBeInTheDocument();
    expect(within(req).getByText("Customer Management").closest(".MuiChip-root")).toHaveClass(
      "MuiChip-colorDefault",
    );
    expect(within(req).getByText("Lead Scoring").closest(".MuiChip-root")).toHaveClass("MuiChip-colorPrimary");
  });

  it("renders the business and technical Q&A, linkifying answers", async () => {
    mockApi.on("get", URL_A1, assessment());
    renderViewer();

    expect(await screen.findByText("Business Fit")).toBeInTheDocument();
    const business = panelOf("Who are the users?");
    expect(within(business).getByRole("link", { name: "https://example.com/users" })).toBeInTheDocument();

    expect(screen.getByText("Technical Fit")).toBeInTheDocument();
    const technical = panelOf("Uptime target?");
    expect(within(technical).getByText("99.9%")).toBeInTheDocument();
    expect(within(technical).getByText("availability")).toBeInTheDocument();
    // An unanswered question shows a dash.
    expect(within(technical).getByText("Data residency?")).toBeInTheDocument();
    expect(within(technical).getByText("—")).toBeInTheDocument();
  });

  it("marks the selected solution option", async () => {
    mockApi.on("get", URL_A1, assessment());
    renderViewer();

    expect(await screen.findByText("Solution")).toBeInTheDocument();
    const chosen = screen.getByText("Buy a SaaS CRM").closest(".MuiPaper-root") as HTMLElement;
    expect(within(chosen).getByText("buy")).toBeInTheDocument();
    expect(within(chosen).getByText("Adopt a SaaS suite")).toBeInTheDocument();
    expect(within(chosen).getByText("Selected")).toBeInTheDocument();
    const other = screen.getByText("Build in-house").closest(".MuiPaper-root") as HTMLElement;
    expect(within(other).getByText("build")).toBeInTheDocument();
    expect(within(other).queryByText("Selected")).not.toBeInTheDocument();
  });

  it("renders the gap analysis with ranked recommendations and the user's pick", async () => {
    mockApi.on("get", URL_A1, assessment());
    renderViewer();

    expect(await screen.findByText("Gap Analysis")).toBeInTheDocument();
    expect(screen.getByText("Three capability gaps")).toBeInTheDocument();

    const lead = screen.getByText("Lead Scoring Gap").closest(".MuiPaper-outlined") as HTMLElement;
    expect(within(lead).getByText("CRITICAL")).toBeInTheDocument();
    expect(within(lead).getByText("Impact: Lost deals")).toBeInTheDocument();
    expect(within(lead).getByText("Market Recommendations")).toBeInTheDocument();
    expect(within(lead).getAllByText(/^#\d$/).map((r) => r.textContent)).toEqual(["#1", "#2", "#3"]);

    const einstein = within(lead).getByText("Einstein").closest(".MuiPaper-root") as HTMLElement;
    expect(within(einstein).getByText("Selected")).toBeInTheDocument();
    expect(within(einstein).getByText("Salesforce")).toBeInTheDocument();
    expect(within(einstein).getByText("Native to the suite")).toBeInTheDocument();
    expect(within(einstein).getByText("+ Integrated")).toBeInTheDocument();
    expect(within(einstein).getByText("- Costly")).toBeInTheDocument();
    expect(within(einstein).getByText("$50k/yr")).toBeInTheDocument();
    expect(within(einstein).getByText("low effort")).toBeInTheDocument();
    const madkudu = within(lead).getByText("MadKudu").closest(".MuiPaper-root") as HTMLElement;
    expect(within(madkudu).queryByText("Selected")).not.toBeInTheDocument();

    const reporting = screen.getByText("Reporting Gap").closest(".MuiPaper-outlined") as HTMLElement;
    expect(within(reporting).getByText("HIGH")).toBeInTheDocument();
    expect(within(reporting).queryByText("Market Recommendations")).not.toBeInTheDocument();

    const archiving = screen.getByText("Archiving Gap").closest(".MuiPaper-outlined") as HTMLElement;
    expect(within(archiving).queryByText(/^(CRITICAL|HIGH)$/)).not.toBeInTheDocument();
    expect(within(archiving).queryByText(/^Impact:/)).not.toBeInTheDocument();
  });

  it("renders the dependency analysis with the selected option", async () => {
    mockApi.on("get", URL_A1, assessment());
    renderViewer();

    expect(await screen.findByText("Dependencies")).toBeInTheDocument();
    expect(screen.getByText("One platform dependency")).toBeInTheDocument();

    const idp = screen.getByText("Identity provider").closest(".MuiPaper-outlined") as HTMLElement;
    expect(within(idp).getByText("HIGH")).toBeInTheDocument();
    expect(within(idp).getByText("SSO for every user")).toBeInTheDocument();
    const okta = within(idp).getByText("Okta").closest(".MuiPaper-root") as HTMLElement;
    expect(within(okta).queryByText("Selected")).not.toBeInTheDocument();
    expect(within(okta).getByText("Okta Inc")).toBeInTheDocument();
    expect(within(okta).getByText("Industry standard")).toBeInTheDocument();
    expect(within(okta).getByText("+ Mature")).toBeInTheDocument();
    expect(within(okta).getByText("- Price")).toBeInTheDocument();
    expect(within(okta).getByText("$10k/yr")).toBeInTheDocument();
    expect(within(okta).getByText("medium effort")).toBeInTheDocument();
    const entra = within(idp).getByText("Entra ID").closest(".MuiPaper-root") as HTMLElement;
    expect(within(entra).getByText("Selected")).toBeInTheDocument();

    const bus = screen.getByText("Message bus").closest(".MuiPaper-outlined") as HTMLElement;
    expect(within(bus).getByText("CRITICAL")).toBeInTheDocument();
    const backups = screen.getByText("Backups").closest(".MuiPaper-outlined") as HTMLElement;
    expect(within(backups).queryByText(/^(CRITICAL|HIGH)$/)).not.toBeInTheDocument();
  });

  it("renders the target architecture's capabilities, new cards and relations", async () => {
    mockApi.on("get", URL_A1, assessment());
    renderViewer();

    expect(await screen.findByText("Target Architecture")).toBeInTheDocument();
    expect(screen.getByText("Target state after the CRM swap")).toBeInTheDocument();

    const caps = panelOf("Business Capabilities");
    expect(within(caps).getByText("Customer Management").previousSibling).toHaveTextContent("Existing");
    expect(within(caps).getByText("Lead Scoring").previousSibling).toHaveTextContent("New");

    // Only new proposed cards are listed; subtypes go through the metamodel,
    // an unknown one stays raw, an unknown type has no icon.
    const cards = panelOf("Proposed New Cards");
    expect(within(cards).queryByText("Old CRM")).not.toBeInTheDocument();
    const salesCloud = within(cards).getByText("Sales Cloud").parentElement as HTMLElement;
    expect(within(salesCloud).getByText("apps")).toBeInTheDocument();
    expect(within(salesCloud).getByText("(Business Application)")).toBeInTheDocument();
    const kafka = within(cards).getByText("Kafka").parentElement as HTMLElement;
    expect(within(kafka).getByText("memory")).toBeInTheDocument();
    expect(within(kafka).getByText("(streaming)")).toBeInTheDocument();
    const mystery = within(cards).getByText("Mystery Box").parentElement as HTMLElement;
    expect(mystery.textContent).toBe("Mystery Box");

    const rels = panelOf(/^Proposed New Relations/);
    expect(within(rels).getByText(/^Proposed New Relations/)).toHaveTextContent("Proposed New Relations (6)");
    const lines = Array.from(rels.querySelectorAll(".MuiStack-root .MuiStack-root")).map((l) => l.textContent);
    expect(lines).toEqual([
      "Sales Cloudarrow_forwardKafkauses",
      // Names resolve through the existing graph, capability and proposed-card ids.
      "Customer Mgmt (live)arrow_forwardSales Cloud",
      "Old CRMarrow_forwardLead Scoring",
      "Kafkaarrow_forwardMystery Boxhosts",
      "Mystery Boxarrow_forwardPostgres",
      // An id nothing names is shown raw.
      "Sales Cloudarrow_forwardghost-carduses",
    ]);
  });

  it("hands the Layered Dependency View one merged, correctly oriented graph", async () => {
    mockApi.on("get", URL_A1, assessment());
    renderViewer();

    expect(await screen.findByText("Dependency Diagram")).toBeInTheDocument();
    expect(screen.getByTestId("ldv")).toHaveTextContent("7 nodes / 6 edges");
    const props = ldv.props;
    if (!props) throw new Error("LayeredDependencyView was not rendered");
    expect(props.types).toBe(CARD_TYPES);

    expect(props.nodes).toEqual([
      // Existing graph first, deduplicated by id.
      { id: "bc-existing", name: "Customer Mgmt (live)", type: "BusinessCapability" },
      { id: "itc-db", name: "Postgres", type: "ITComponent" },
      // Every proposed card, flagged when new.
      { id: "pc-1", name: "Sales Cloud", type: "Application", proposed: true },
      { id: "pc-2", name: "Kafka", type: "ITComponent", proposed: true },
      { id: "pc-3", name: "Old CRM", type: "Application", proposed: false },
      { id: "pc-4", name: "Mystery Box", type: "Widget", proposed: true },
      // Capabilities not already on the canvas under their existing card id.
      { id: "cap-new", name: "Lead Scoring", type: "BusinessCapability", proposed: true },
    ]);

    expect(props.edges).toEqual([
      { source: "itc-db", target: "bc-existing", type: "relLegacy", label: "backs" },
      {
        source: "pc-1",
        target: "pc-2",
        type: "relAppToITC",
        label: "uses",
        reverse_label: "is used by",
      },
      // Turned to run Application → BusinessCapability, as relAppToBC does.
      {
        source: "pc-1",
        target: "bc-existing",
        type: "relAppToBC",
        label: "supports",
        reverse_label: "is supported by",
      },
      // "app-old" is the existing card behind proposed card pc-3.
      {
        source: "pc-3",
        target: "cap-new",
        type: "relAppToBC",
        label: "supports",
        reverse_label: "is supported by",
      },
      { source: "pc-2", target: "pc-4", type: "relCustom", label: "hosts", reverse_label: undefined },
      { source: "pc-4", target: "itc-db", type: "relCustom", label: "", reverse_label: undefined },
    ]);
  });
});

describe("AssessmentViewer — other shapes", () => {
  it("shows a committed assessment's initiative and offers no Resume", async () => {
    mockApi.on(
      "get",
      URL_A1,
      assessment({
        status: "committed",
        initiative_id: "init-9",
        initiative_name: "CRM Programme",
        created_by_name: undefined,
      }),
    );
    const { user } = renderViewer();

    await screen.findByRole("heading", { name: "CRM replacement" });
    expect(screen.getByText("Committed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Resume$/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Created by:/)).not.toBeInTheDocument();
    expect(screen.getByText("Linked Initiative: CRM Programme")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open Initiative" }));
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/cards\/init-9$/);
  });

  it("reads the wizard's older key names", async () => {
    mockApi.on(
      "get",
      URL_A1,
      assessment({
        session_data: {
          archReq: "Legacy requirement text",
          phase1Questions: [{ question: "Old business question?", answer: "Old answer" }],
          phase2Questions: [{ question: "Old technical question?", answer: "Kubernetes" }],
        },
      }),
    );
    renderViewer();

    expect(await screen.findByText("Legacy requirement text")).toBeInTheDocument();
    expect(screen.getByText("Old business question?")).toBeInTheDocument();
    expect(screen.getByText("Old technical question?")).toBeInTheDocument();
    expect(screen.getByText("Kubernetes")).toBeInTheDocument();
  });

  it("reads phase2Answers when present", async () => {
    mockApi.on(
      "get",
      URL_A1,
      assessment({
        session_data: {
          requirement: "Req",
          phase2Answers: [{ question: "Hosting?", answer: "Cloud" }],
        },
      }),
    );
    renderViewer();

    expect(await screen.findByText("Technical Fit")).toBeInTheDocument();
    expect(screen.getByText("Hosting?")).toBeInTheDocument();
    expect(screen.queryByText("Business Fit")).not.toBeInTheDocument();
  });

  it("renders only the requirements block for an assessment with no session data", async () => {
    mockApi.on("get", URL_A1, assessment({ session_data: null }));
    renderViewer();

    expect(await screen.findByText("Requirements")).toBeInTheDocument();
    for (const section of [
      "Business Fit",
      "Technical Fit",
      "Solution",
      "Gap Analysis",
      "Dependencies",
      "Target Architecture",
    ]) {
      expect(screen.queryByText(section)).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/Which business objectives/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("ldv")).not.toBeInTheDocument();
  });

  it("skips empty gap and dependency results and an empty target graph", async () => {
    mockApi.on(
      "get",
      URL_A1,
      assessment({
        session_data: {
          requirement: "Req",
          gapResult: { summary: "nothing", gaps: [] },
          depsResult: { summary: "nothing", dependencies: [] },
          capabilityMapping: { capabilities: [], proposedCards: [], proposedRelations: [] },
        },
      }),
    );
    renderViewer();

    expect(await screen.findByText("Target Architecture")).toBeInTheDocument();
    expect(screen.queryByText("Gap Analysis")).not.toBeInTheDocument();
    expect(screen.queryByText("Dependencies")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Proposed New Relations/)).not.toBeInTheDocument();
    expect(screen.queryByText("Dependency Diagram")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ldv")).not.toBeInTheDocument();
  });

  it("omits the gap and dependency summaries when there are none", async () => {
    mockApi.on(
      "get",
      URL_A1,
      assessment({
        session_data: {
          requirement: "Req",
          gapResult: { gaps: [{ capability: "Only gap", recommendations: [] }] },
          depsResult: { dependencies: [{ need: "Only need", options: [] }] },
        },
      }),
    );
    renderViewer();

    expect(await screen.findByText("Only gap")).toBeInTheDocument();
    expect(screen.getByText("Only need")).toBeInTheDocument();
    expect(screen.queryByText("Market Recommendations")).not.toBeInTheDocument();
  });
});
