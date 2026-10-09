/**
 * TurboLensArchitect — the Architecture AI wizard.
 *
 * The wizard is one component holding every phase's state, so the suite is
 * organised the way a user meets it: one end-to-end walk through the real UI
 * that pins every request body the user's choices end up in, then a block per
 * phase. The per-phase blocks start mid-wizard by seeding the sessionStorage
 * snapshot the component restores on mount — which is itself the persistence
 * feature under test — instead of re-typing the requirement every time.
 *
 * React Flow cannot lay out in jsdom and the commit dialog has its own suite,
 * so both are stubbed with components that record the props they receive.
 */
import type { ComponentProps } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

type LdvProps = { nodes: GNode[]; edges: GEdge[] };
const ldvProps: LdvProps[] = [];
vi.mock("@/features/reports/LayeredDependencyView", () => ({
  default: (props: LdvProps) => {
    ldvProps.push(props);
    return <div data-testid="ldv">{`${props.nodes.length} nodes / ${props.edges.length} edges`}</div>;
  },
}));

type CommitProps = ComponentProps<typeof CommitInitiativeDialogType>;
const commitProps: CommitProps[] = [];
vi.mock("./CommitInitiativeDialog", () => ({
  default: (props: CommitProps) => {
    commitProps.push(props);
    if (!props.open) return null;
    return (
      <div data-testid="commit-dialog">
        <span>{`commit ${props.assessmentId}`}</span>
        <button onClick={props.onClose}>close commit</button>
      </div>
    );
  },
}));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { renderWithProviders } from "@/test/render";
import { CARD_TYPES, RELATION_TYPES, makeCardType } from "@/test/fixtures/metamodel";
import type {
  ArchSolutionOption,
  CapabilityMappingResult,
  DependencyAnalysisResult,
  GapAnalysisResult,
} from "@/types";
import type { GEdge, GNode } from "@/features/reports/layeredDependencyLayout";
import type CommitInitiativeDialogType from "./CommitInitiativeDialog";
import TurboLensArchitect from "./TurboLensArchitect";

// ---------------------------------------------------------------------------
// Endpoints and copy
// ---------------------------------------------------------------------------

const P = {
  objectives: "/turbolens/architect/objectives",
  capabilities: "/turbolens/architect/capabilities",
  phase1: "/turbolens/architect/phase1",
  phase2: "/turbolens/architect/phase2",
  options: "/turbolens/architect/phase3/options",
  gaps: "/turbolens/architect/phase3/gaps",
  deps: "/turbolens/architect/phase3/deps",
  target: "/turbolens/architect/phase3",
  assessments: "/turbolens/assessments",
};

const SESSION_KEY = "turbolens-architect-session";

const COPY = {
  phase1Intro: "Please answer these clarifying questions about your requirement:",
  phase2Intro: "Based on your answers, please provide more technical details:",
  optionsIntro: "Based on your requirements, here are the recommended solution approaches:",
  gapsIntro: "Select the product you want to use for each capability gap:",
  depsIntro:
    "These are the integration dependencies required for your selected products to work in your environment:",
  answer: "Enter your answer...",
  custom: "Or type your own answer...",
  searchObjectives: "Search objectives...",
  searchCapabilities: "Search or type new capability...",
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OBJECTIVE_TYPE = makeCardType({
  key: "Objective",
  label: "Objective",
  icon: "flag",
  color: "#c7527d",
  category: "Strategy & Transformation",
});

const REQUIREMENT = "Detect payment fraud in real time";

const OBJECTIVES = [
  { id: "obj-1", name: "Grow revenue", description: "Increase online revenue by 10%" },
  { id: "obj-2", name: "Reduce churn" },
];
const CAPABILITIES = [
  { id: "cap-1", name: "Customer Management" },
  { id: "cap-2", name: "Billing" },
];

const SELECTED_OBJECTIVE = OBJECTIVES[0];
const SELECTED_CAPABILITIES = [
  { id: "cap-1", name: "Customer Management", isNew: false },
  { id: "new_Fraud Detection", name: "Fraud Detection", isNew: true },
];

const Q_USERS = "Who reviews flagged payments?";
const Q_CHANNEL = "Which channel matters most?";
const Q_QUALITIES = "Which qualities matter?";
const Q_HOSTING = "Where should it be hosted?";

/** Phase 1 answers the three question types: free text, single choice, multi choice. */
const PHASE1 = {
  questions: [
    { question: Q_USERS, why: "Defines the users", type: "text" },
    { question: Q_CHANNEL, type: "choice", options: ["Web", "Mobile"] },
    {
      question: Q_QUALITIES,
      type: "multi",
      options: ["Security", "Performance"],
      nfrCategory: "non_functional",
    },
  ],
};
/** Phase 2 answers with the `items` key and a bare string question. */
const PHASE2 = { items: [Q_HOSTING] };

const P1_ANSWERED = [
  { ...PHASE1.questions[0], answer: "The risk team" },
  { ...PHASE1.questions[1], answer: "Mobile" },
  { ...PHASE1.questions[2], answer: "Security, Latency" },
];
const P2_ANSWERED = [{ question: Q_HOSTING, answer: "EU cloud" }];

const PHASE1_QA = [
  { question: Q_USERS, answer: "The risk team" },
  { question: Q_CHANNEL, answer: "Mobile" },
  { question: Q_QUALITIES, answer: "Security, Latency" },
];
const ALL_QA = [...PHASE1_QA, { question: Q_HOSTING, answer: "EU cloud" }];

const OPTION_BUY: ArchSolutionOption = {
  id: "opt-buy",
  title: "Buy a fraud platform",
  approach: "buy",
  summary: "License a SaaS fraud engine",
  estimatedCost: "$200k",
  estimatedDuration: "3 months",
  estimatedComplexity: "very_high",
  pros: ["Fast to deploy"],
  cons: ["Vendor lock-in"],
  impactPreview: {
    newComponents: [
      { name: "FraudShield", cardTypeKey: "Application", subtype: "businessApplication" },
    ],
    modifiedComponents: [
      { name: "Payments Hub", cardTypeKey: "Application", change: "Add scoring hook" },
    ],
    newIntegrations: [{ from: "Payments Hub", to: "FraudShield", protocol: "REST" }],
    retiredComponents: [{ name: "Manual Review Tool", cardTypeKey: "Application" }],
  },
};
const OPTION_BUILD: ArchSolutionOption = {
  id: "opt-build",
  title: "Build in-house scoring",
  approach: "build",
  summary: "Train our own model",
  impactPreview: { newComponents: [], modifiedComponents: [], newIntegrations: [], retiredComponents: [] },
};
const OPTIONS = { options: [OPTION_BUY, OPTION_BUILD] };

const GAPS: GapAnalysisResult = {
  summary: "Two capabilities need a product",
  gaps: [
    {
      capability: "Fraud Detection",
      urgency: "critical",
      impact: "Chargebacks keep rising",
      recommendations: [
        {
          name: "FraudShield",
          vendor: "Acme",
          recommended: true,
          why: "Market leader with rule tuning",
          marketPosition: "Gartner leader",
          principleAlignment: "Aligns with cloud-first",
          pros: ["Real-time scoring"],
          cons: ["Costly"],
          estimatedCost: "$150k/yr",
          integrationEffort: "low",
          deploymentModel: "SaaS",
          licenseModel: "Subscription",
        },
        { name: "RiskGuard", vendor: "Beta Corp", principleAlignment: "Conflicts with on-prem data rule" },
        { name: "Homegrown rules" },
      ],
    },
    { capability: "Billing", urgency: "high", recommendations: [{ name: "BillPro" }] },
  ],
};

const DEPS: DependencyAnalysisResult = {
  summary: "FraudShield needs an identity provider",
  dependencies: [
    {
      need: "Identity Provider",
      reason: "SSO for analysts",
      urgency: "critical",
      options: [
        {
          name: "Okta",
          vendor: "Okta Inc",
          recommended: true,
          why: "Already licensed",
          pros: ["Mature SSO"],
          cons: ["Per-seat cost"],
          estimatedCost: "$20k",
          integrationEffort: "medium",
        },
        { name: "Keycloak" },
      ],
    },
    { need: "Message Bus", urgency: "low", options: [{ name: "Kafka" }] },
  ],
};

/**
 * Exercises every branch of the merged-graph builder: an existing card reached
 * through `existingCardId`, a relation the AI wrote against the metamodel's
 * direction, one to a card that does not exist, one whose type the metamodel
 * does not know, and a proposed card nothing connects to.
 */
const MAPPING: CapabilityMappingResult = {
  summary: "Introduce FraudShield on top of the existing payments estate",
  capabilities: [
    { id: "cap-1", name: "Customer Management", isNew: false, existingCardId: "card-cap-1" },
    { id: "cap-new-1", name: "Fraud Detection", isNew: true },
  ],
  proposedCards: [
    { id: "pc-1", name: "FraudShield", cardTypeKey: "Application", subtype: "businessApplication", isNew: true },
    { id: "pc-2", name: "Okta", cardTypeKey: "ITComponent", isNew: true },
    { id: "pc-3", name: "Legacy CRM", cardTypeKey: "Application", isNew: false, existingCardId: "app-crm" },
    { id: "pc-4", name: "Orphan Widget", cardTypeKey: "Application", isNew: true },
  ],
  proposedRelations: [
    { sourceId: "pc-1", targetId: "cap-new-1", relationType: "relAppToBC", label: "supports" },
    { sourceId: "pc-2", targetId: "pc-1", relationType: "relAppToITC" },
    { sourceId: "app-crm", targetId: "card-cap-1", relationType: "relAppToBC" },
    { sourceId: "pc-1", targetId: "ghost", relationType: "relAppToITC" },
    { sourceId: "obj-1", targetId: "cap-new-1", relationType: "relObjectiveToBC", label: "improves" },
  ],
  existingDependencies: {
    nodes: [
      { id: "obj-1", name: "Grow revenue", type: "Objective" },
      { id: "app-erp", name: "ERP", type: "Application" },
    ],
    edges: [{ source: "app-erp", target: "card-cap-1", type: "relAppToBC", label: "supports" }],
  },
};

const EXPECTED_PRODUCTS = [
  {
    capability: "Fraud Detection",
    name: "FraudShield",
    vendor: "Acme",
    pros: ["Real-time scoring"],
    cons: ["Costly"],
  },
  { capability: "Billing", name: "BillPro" },
];

const EXPECTED_RECOMMENDATIONS = [
  {
    capability: "Fraud Detection",
    recommendation: "FraudShield",
    vendor: "Acme",
    role: "primary",
    pros: ["Real-time scoring"],
    cons: ["Costly"],
  },
  { capability: "Billing", recommendation: "BillPro", role: "primary" },
  {
    capability: "Identity Provider",
    recommendation: "Okta",
    vendor: "Okta Inc",
    role: "dependency",
    pros: ["Mature SSO"],
    cons: ["Per-seat cost"],
  },
  { capability: "Identity Provider", recommendation: "Keycloak", role: "dependency" },
];

/** What every AI call after phase 0 carries about the requirement. */
const CONTEXT = {
  requirement: REQUIREMENT,
  objectiveIds: ["obj-1"],
  selectedCapabilities: SELECTED_CAPABILITIES,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type User = ReturnType<typeof renderWithProviders>["user"];
type Phase = 1 | 2 | 3 | 3.5 | 4 | 5;

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.search}</div>;
}

function renderArchitect(route = "/turbolens?tab=architect") {
  return renderWithProviders(
    <>
      <TurboLensArchitect />
      <LocationProbe />
    </>,
    { route },
  );
}

/** The snapshot the wizard would have stored on reaching `phase` by the walk below. */
function sessionAt(phase: 0 | Phase): Record<string, unknown> {
  const base = {
    archReq: REQUIREMENT,
    archPhase: phase,
    archQuestions: [],
    phase1Answers: [],
    phase2Answers: [],
    archOptions: null,
    selectedOptionId: null,
    selectedObjectives: [SELECTED_OBJECTIVE],
    selectedCapabilities: SELECTED_CAPABILITIES,
    gapResult: null,
    depsResult: null,
    capabilityMapping: null,
    selectedRecs: [],
    selectedDeps: [],
  };
  if (phase === 0) return base;
  if (phase === 1) {
    return { ...base, archQuestions: PHASE1.questions.map((q) => ({ ...q, answer: "" })) };
  }
  if (phase === 2) {
    return { ...base, phase1Answers: P1_ANSWERED, archQuestions: [{ question: Q_HOSTING, answer: "" }] };
  }
  const p3 = { ...base, phase1Answers: P1_ANSWERED, phase2Answers: P2_ANSWERED, archOptions: OPTIONS.options };
  if (phase === 3) return p3;
  const p35 = { ...p3, selectedOptionId: "opt-buy", gapResult: GAPS, selectedRecs: ["0:0"] };
  if (phase === 3.5) return p35;
  const p4 = { ...p35, depsResult: DEPS, selectedRecs: ["0:0", "1:0"], selectedDeps: ["0:0"] };
  if (phase === 4) return p4;
  return { ...p4, capabilityMapping: MAPPING, selectedDeps: ["0:0", "0:1"] };
}

/** Mount the wizard as if the user had left it at `phase` in this tab. */
function startAt(phase: 0 | Phase, over: Record<string, unknown> = {}) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...sessionAt(phase), ...over }));
  return renderArchitect();
}

function storedSession(): Record<string, unknown> {
  return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null");
}

function bodyOf(method: "post" | "patch", path: string): Record<string, unknown> {
  const calls = mockApi.callsOf(method, path);
  expect(calls).toHaveLength(1);
  return calls[0].body as Record<string, unknown>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function lastLdv(): LdvProps {
  return ldvProps[ldvProps.length - 1];
}

function lastCommit(): CommitProps {
  return commitProps[commitProps.length - 1];
}

/** The checkbox inside the recommendation / dependency tile titled `name`. */
function tileCheckbox(name: string): HTMLInputElement {
  const tile = screen.getByText(name).closest(".MuiPaper-root") as HTMLElement;
  return within(tile).getByRole("checkbox") as HTMLInputElement;
}

/** The enable/disable switch on the proposed-card row named `name` (phase 5). */
function cardSwitch(name: string): HTMLInputElement {
  const row = screen
    .getAllByText(name)
    .map((el) => el.parentElement as HTMLElement)
    .find((el) => el.querySelector('input[type="checkbox"]'));
  expect(row).toBeDefined();
  return within(row as HTMLElement).getByRole("checkbox") as HTMLInputElement;
}

function selectButtonOf(title: string): HTMLElement {
  const card = screen.getByText(title).closest(".MuiCard-root") as HTMLElement;
  return within(card).getByRole("button", { name: /Select This Approach|Selected/ });
}

/**
 * Fill phase 0. Long strings are pasted rather than typed: every keystroke
 * re-renders the whole wizard, and typing them made the suite twice as slow.
 */
async function fillRequirements(user: User) {
  await user.click(screen.getByRole("textbox", { name: "Business Requirement" }));
  await user.paste(REQUIREMENT);
  await user.click(screen.getByPlaceholderText(COPY.searchObjectives));
  await user.click(await screen.findByRole("option", { name: /Grow revenue/ }));
  await user.click(screen.getByPlaceholderText(COPY.searchCapabilities));
  await user.click(await screen.findByRole("option", { name: "Customer Management" }));
  await user.paste("Fraud Detection");
  await user.keyboard("{Enter}");
}

/** Answer phase 1 through every widget: text, a single choice, a multi choice + custom answer. */
async function answerPhase1(user: User) {
  await user.type(screen.getByPlaceholderText(COPY.answer), "The risk team");
  await user.click(screen.getByRole("button", { name: "Mobile" }));
  await user.click(screen.getByRole("button", { name: "Security" }));
  await user.click(screen.getByRole("button", { name: "Performance" }));
  await user.click(screen.getByRole("button", { name: "✓ Performance" }));
  await user.type(screen.getByPlaceholderText(COPY.custom), "Latency{Enter}");
}

/** Drive the real UI from an empty wizard to `phase`. */
async function walkTo(user: User, phase: Phase) {
  await fillRequirements(user);
  await user.click(screen.getByRole("button", { name: /Generate Questions/ }));
  await screen.findByText(COPY.phase1Intro);
  if (phase === 1) return;

  await answerPhase1(user);
  await user.click(screen.getByRole("button", { name: /Submit & Get Technical Questions/ }));
  await screen.findByText(COPY.phase2Intro);
  if (phase === 2) return;

  await user.type(screen.getByPlaceholderText(COPY.answer), "EU cloud");
  await user.click(screen.getByRole("button", { name: /Analyze Capabilities/ }));
  await screen.findByText(COPY.optionsIntro);
  if (phase === 3) return;

  await user.click(selectButtonOf("Buy a fraud platform"));
  await screen.findByText(COPY.gapsIntro);
  if (phase === 3.5) return;

  await user.click(screen.getByText("BillPro"));
  await user.click(screen.getByRole("button", { name: /Analyse Dependencies/ }));
  await screen.findByText(COPY.depsIntro);
  if (phase === 4) return;

  await user.click(screen.getByText("Keycloak"));
  await user.click(screen.getByRole("button", { name: /Generate Target Architecture/ }));
  await screen.findByTestId("ldv");
}

async function expectError(message: string) {
  const text = await screen.findByText(message);
  return text.closest('[role="alert"]') as HTMLElement;
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel([OBJECTIVE_TYPE, ...CARD_TYPES], RELATION_TYPES);
  ldvProps.length = 0;
  commitProps.length = 0;
  mockApi.on("get", P.objectives, OBJECTIVES);
  mockApi.on("get", P.capabilities, CAPABILITIES);
  mockApi.on("post", P.phase1, PHASE1);
  mockApi.on("post", P.phase2, PHASE2);
  mockApi.on("post", P.options, OPTIONS);
  mockApi.on("post", P.gaps, GAPS);
  mockApi.on("post", P.deps, DEPS);
  mockApi.on("post", P.target, MAPPING);
  mockApi.on("post", P.assessments, { id: "as-1" });
  mockApi.on("patch", /^\/turbolens\/assessments\//, (path: string) => ({ id: path.split("/").pop() }));
});

// ---------------------------------------------------------------------------
// End to end
// ---------------------------------------------------------------------------

describe("TurboLensArchitect — end to end", () => {
  it("carries the user's choices from the requirement to the target architecture", async () => {
    const { user } = renderArchitect();
    await walkTo(user, 5);

    expect(bodyOf("post", P.phase1)).toEqual({ phase: 1, ...CONTEXT });
    expect(bodyOf("post", P.phase2)).toEqual({ phase: 2, ...CONTEXT, phase1QA: PHASE1_QA });
    expect(bodyOf("post", P.options)).toEqual({ phase: 3, ...CONTEXT, allQA: ALL_QA });
    expect(bodyOf("post", P.gaps)).toEqual({ ...CONTEXT, allQA: ALL_QA, selectedOption: OPTION_BUY });
    expect(bodyOf("post", P.deps)).toEqual({
      phase: 4,
      ...CONTEXT,
      allQA: ALL_QA,
      selectedOption: OPTION_BUY,
      selectedProducts: EXPECTED_PRODUCTS,
    });
    expect(bodyOf("post", P.target)).toEqual({
      phase: 5,
      ...CONTEXT,
      allQA: ALL_QA,
      selectedOption: OPTION_BUY,
      selectedRecommendations: EXPECTED_RECOMMENDATIONS,
    });

    expect(screen.getByText(MAPPING.summary as string)).toBeInTheDocument();
    expect(screen.getByTestId("ldv")).toHaveTextContent("7 nodes / 5 edges");
  });

  it("saves the assessment and opens the commit dialog with the wizard's selections", async () => {
    const { user } = renderArchitect();
    await walkTo(user, 5);

    await user.click(screen.getByRole("button", { name: /Commit & Create Initiative/ }));

    expect(await screen.findByTestId("commit-dialog")).toHaveTextContent("commit as-1");
    const body = bodyOf("post", P.assessments);
    expect(body).toMatchObject({ title: REQUIREMENT, requirement: REQUIREMENT });
    expect(body.sessionData).toMatchObject({
      archPhase: 5,
      selectedOptionId: "opt-buy",
      selectedObjectives: [SELECTED_OBJECTIVE],
      selectedCapabilities: SELECTED_CAPABILITIES,
      selectedRecs: ["0:0", "1:0"],
      selectedDeps: ["0:0", "0:1"],
      capabilityMapping: MAPPING,
    });
    expect(lastCommit()).toMatchObject({
      open: true,
      assessmentId: "as-1",
      requirement: REQUIREMENT,
      objectiveIds: ["obj-1"],
      selectedOption: OPTION_BUY,
      capabilityMapping: MAPPING,
    });

    await user.click(screen.getByRole("button", { name: "close commit" }));
    expect(screen.queryByTestId("commit-dialog")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Phase 0 — requirement, objectives, capabilities
// ---------------------------------------------------------------------------

describe("TurboLensArchitect — requirements (phase 0)", () => {
  it("loads both pickers on mount and gates Generate on a requirement and an objective", async () => {
    const { user } = renderArchitect();
    const generate = screen.getByRole("button", { name: /Generate Questions/ });
    expect(generate).toBeDisabled();
    expect(screen.queryByRole("button", { name: /New Assessment/ })).not.toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Business Requirement" }), "Fraud");
    expect(generate).toBeDisabled();

    await user.click(screen.getByPlaceholderText(COPY.searchObjectives));
    const option = await screen.findByRole("option", { name: /Grow revenue/ });
    expect(option).toHaveTextContent("Increase online revenue by 10%");
    await user.click(option);
    expect(generate).toBeEnabled();
    expect(mockApi.callsOf("get").map((c) => c.path).sort()).toEqual([P.capabilities, P.objectives]);
  });

  it("marks a typed capability as new and a picked one as existing", async () => {
    const { user } = renderArchitect();
    await fillRequirements(user);

    expect(screen.getByRole("button", { name: "Customer Management" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New: Fraud Detection" })).toBeInTheDocument();
    expect(storedSession().selectedCapabilities).toEqual(SELECTED_CAPABILITIES);
  });

  it("shows the analysing state while the questions are generated", async () => {
    const gate = deferred<unknown>();
    mockApi.on("post", P.phase1, () => gate.promise);
    const { user } = renderArchitect();
    await fillRequirements(user);

    await user.click(screen.getByRole("button", { name: /Generate Questions/ }));
    expect(await screen.findByText("AI is analyzing your landscape...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generate Questions/ })).toBeDisabled();

    await act(async () => gate.resolve(PHASE1));
    expect(await screen.findByText(COPY.phase1Intro)).toBeInTheDocument();
    expect(screen.queryByText("AI is analyzing your landscape...")).not.toBeInTheDocument();
  });

  it("reports a failed question round and stays on the form until the alert is dismissed", async () => {
    mockApi.fail("post", P.phase1);
    const { user } = renderArchitect();
    await fillRequirements(user);
    await user.click(screen.getByRole("button", { name: /Generate Questions/ }));

    const alert = await expectError("POST /turbolens/architect/phase1 failed");
    expect(screen.getByRole("textbox", { name: "Business Requirement" })).toHaveValue(REQUIREMENT);

    await user.click(within(alert).getByRole("button", { name: "Close" }));
    expect(screen.queryByText("POST /turbolens/architect/phase1 failed")).not.toBeInTheDocument();
  });

  it("reports a non-API failure by its string form", async () => {
    mockApi.on("post", P.phase1, () => {
      throw new TypeError("network down");
    });
    const { user } = renderArchitect();
    await fillRequirements(user);
    await user.click(screen.getByRole("button", { name: /Generate Questions/ }));

    expect(await screen.findByText("TypeError: network down")).toBeInTheDocument();
  });

  it("still renders the pickers, empty, when they fail to load", async () => {
    mockApi.fail("get", P.objectives);
    const { user } = renderArchitect();
    await user.click(screen.getByPlaceholderText(COPY.searchObjectives));
    expect(await screen.findByText("No options")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Phases 1 & 2 — question rounds
// ---------------------------------------------------------------------------

describe("TurboLensArchitect — question rounds (phases 1 and 2)", () => {
  it("renders each question type and only submits once every question is answered", async () => {
    const { user } = startAt(1);

    expect(screen.getByText(COPY.phase1Intro)).toBeInTheDocument();
    expect(screen.getByText(Q_USERS)).toBeInTheDocument();
    expect(screen.getByText("Impact: Defines the users")).toBeInTheDocument();
    expect(screen.getByText("non functional")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Web" })).toBeInTheDocument();

    const submit = screen.getByRole("button", { name: /Submit & Get Technical Questions/ });
    expect(submit).toBeDisabled();

    await user.type(screen.getByPlaceholderText(COPY.answer), "The risk team");
    await user.click(screen.getByRole("button", { name: "Web" }));
    await user.click(screen.getByRole("button", { name: "Mobile" }));
    expect(screen.getByRole("button", { name: "✓ Mobile" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Web" })).toBeInTheDocument();
    expect(submit).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Security" }));
    expect(submit).toBeEnabled();
  });

  it("joins multi-choice picks and appends a typed custom answer once", async () => {
    const { user } = startAt(1);
    await answerPhase1(user);
    // A custom answer already present is not appended twice.
    await user.type(screen.getByPlaceholderText(COPY.custom), "Security{Enter}");

    await user.click(screen.getByRole("button", { name: /Submit & Get Technical Questions/ }));
    await screen.findByText(COPY.phase2Intro);
    expect(bodyOf("post", P.phase2).phase1QA).toEqual(PHASE1_QA);
  });

  it("renders a phase 2 bare-string question as free text and moves on to the options", async () => {
    const { user } = startAt(2);
    expect(screen.getByText(COPY.phase2Intro)).toBeInTheDocument();
    expect(screen.getByText(Q_HOSTING)).toBeInTheDocument();

    const analyze = screen.getByRole("button", { name: /Analyze Capabilities/ });
    expect(analyze).toBeDisabled();
    await user.type(screen.getByPlaceholderText(COPY.answer), "EU cloud");
    await user.click(analyze);

    await screen.findByText(COPY.optionsIntro);
    expect(bodyOf("post", P.options)).toEqual({ phase: 3, ...CONTEXT, allQA: ALL_QA });
    expect(storedSession()).toMatchObject({ archPhase: 3, phase2Answers: [{ question: Q_HOSTING, answer: "EU cloud" }] });
  });

  it("reads questions from a bare array and from the `text` key", async () => {
    mockApi.on("post", P.phase1, [{ text: "Asked via text" }, "A plain question"]);
    const { user } = renderArchitect();
    await fillRequirements(user);
    await user.click(screen.getByRole("button", { name: /Generate Questions/ }));

    expect(await screen.findByText("Asked via text")).toBeInTheDocument();
    expect(screen.getByText("A plain question")).toBeInTheDocument();
    expect(screen.getAllByPlaceholderText(COPY.answer)).toHaveLength(2);
  });

  it("offers nothing to answer when the AI returns no question list", async () => {
    mockApi.on("post", P.phase1, { note: "nothing here" });
    const { user } = renderArchitect();
    await fillRequirements(user);
    await user.click(screen.getByRole("button", { name: /Generate Questions/ }));

    await screen.findByText(COPY.phase1Intro);
    expect(screen.queryByPlaceholderText(COPY.answer)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Submit & Get Technical Questions/ })).toBeDisabled();
  });

  it("keeps the answered questions on screen when the next round fails", async () => {
    mockApi.fail("post", P.options, 502);
    const { user } = startAt(2);
    await user.type(screen.getByPlaceholderText(COPY.answer), "EU cloud");
    await user.click(screen.getByRole("button", { name: /Analyze Capabilities/ }));

    await expectError("POST /turbolens/architect/phase3/options failed");
    expect(screen.getByText(COPY.phase2Intro)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(COPY.answer)).toHaveValue("EU cloud");
  });

  it("starts over from a question round", async () => {
    const { user } = startAt(1);
    await user.click(screen.getByRole("button", { name: "Start Over" }));

    expect(screen.getByRole("textbox", { name: "Business Requirement" })).toHaveValue("");
    expect(storedSession()).toMatchObject({ archPhase: 0, archReq: "", selectedObjectives: [] });
  });
});

// ---------------------------------------------------------------------------
// Phase 3a — solution options
// ---------------------------------------------------------------------------

describe("TurboLensArchitect — solution options (phase 3a)", () => {
  it("renders each option with its estimates and architectural impact", () => {
    startAt(3);

    expect(screen.getByText("Buy a fraud platform")).toBeInTheDocument();
    expect(screen.getByText("Build in-house scoring")).toBeInTheDocument();
    expect(screen.getByText("Buy")).toBeInTheDocument();
    expect(screen.getByText("Build")).toBeInTheDocument();
    expect(screen.getByText("+ Fast to deploy")).toBeInTheDocument();
    expect(screen.getByText("- Vendor lock-in")).toBeInTheDocument();
    for (const chip of ["$200k", "3 months", "very high", "REST"]) {
      expect(screen.getByText(chip)).toBeInTheDocument();
    }
    // Only the option that has an impact preview renders one.
    expect(screen.getAllByText("Architectural Impact")).toHaveLength(1);
    expect(screen.getByText("+ New Components")).toBeInTheDocument();
    expect(screen.getByText("(Business Application)")).toBeInTheDocument();
    expect(screen.getByText("~ Modified Components")).toBeInTheDocument();
    expect(screen.getByText("— Add scoring hook")).toBeInTheDocument();
    expect(screen.getByText("New Integrations")).toBeInTheDocument();
    expect(screen.getByText("- Retired Components")).toBeInTheDocument();
    expect(screen.getByText("Manual Review Tool")).toBeInTheDocument();
  });

  it("selecting an option runs the gap analysis for it and pre-selects the top picks", async () => {
    const gate = deferred<unknown>();
    mockApi.on("post", P.gaps, () => gate.promise);
    const { user } = startAt(3);

    await user.click(selectButtonOf("Buy a fraud platform"));
    expect(await screen.findByText("AI is analyzing gaps for the selected approach...")).toBeInTheDocument();
    await act(async () => gate.resolve(GAPS));

    await screen.findByText(COPY.gapsIntro);
    expect(bodyOf("post", P.gaps)).toEqual({ ...CONTEXT, allQA: ALL_QA, selectedOption: OPTION_BUY });
    expect(screen.getByText("License a SaaS fraud engine")).toBeInTheDocument();
    expect(tileCheckbox("FraudShield")).toBeChecked();
    expect(tileCheckbox("RiskGuard")).not.toBeChecked();
    expect(tileCheckbox("BillPro")).not.toBeChecked();
    expect(screen.getByText(/^1 product\(s\) selected/)).toBeInTheDocument();
  });

  it("keeps the options and marks the choice when the gap analysis fails", async () => {
    mockApi.fail("post", P.gaps);
    const { user } = startAt(3);
    await user.click(selectButtonOf("Build in-house scoring"));

    await expectError("POST /turbolens/architect/phase3/gaps failed");
    expect(screen.getByText(COPY.optionsIntro)).toBeInTheDocument();
    expect(selectButtonOf("Build in-house scoring")).toHaveTextContent("Selected");
    expect(selectButtonOf("Buy a fraud platform")).toHaveTextContent("Select This Approach");
  });

  it("treats a response without an options list as no options", async () => {
    mockApi.on("post", P.options, { summary: "nothing fits" });
    const { user } = startAt(2);
    await user.type(screen.getByPlaceholderText(COPY.answer), "EU cloud");
    await user.click(screen.getByRole("button", { name: /Analyze Capabilities/ }));

    await waitFor(() => expect(storedSession()).toMatchObject({ archPhase: 3, archOptions: [] }));
    expect(screen.queryByText(COPY.optionsIntro)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New Assessment/ })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Phase 3b — product selection
// ---------------------------------------------------------------------------

describe("TurboLensArchitect — product selection (phase 3b)", () => {
  it("renders each gap with its ranked market recommendations", () => {
    startAt(3.5);

    expect(screen.getByText("Two capabilities need a product")).toBeInTheDocument();
    expect(screen.getByText("CRITICAL")).toBeInTheDocument();
    expect(screen.getByText("HIGH")).toBeInTheDocument();
    expect(screen.getByText("Impact: Chargebacks keep rising")).toBeInTheDocument();
    expect(screen.getAllByText("#1")).toHaveLength(2);
    expect(screen.getByText("#3")).toBeInTheDocument();
    expect(screen.getByText("Top Pick")).toBeInTheDocument();
    for (const text of [
      "Acme",
      "Gartner leader",
      "Aligns with cloud-first",
      "Conflicts with on-prem data rule",
      "Market leader with rule tuning",
      "+ Real-time scoring",
      "- Costly",
      "$150k/yr",
      "Low effort",
      "SaaS",
      "Subscription",
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });

  it("toggles products and gates the dependency analysis on at least one", async () => {
    const { user } = startAt(3.5);
    const analyse = screen.getByRole("button", { name: /Analyse Dependencies/ });
    expect(analyse).toBeEnabled();

    await user.click(screen.getByText("FraudShield"));
    expect(tileCheckbox("FraudShield")).not.toBeChecked();
    expect(analyse).toBeDisabled();
    expect(screen.queryByText(/product\(s\) selected/)).not.toBeInTheDocument();

    await user.click(screen.getByText("RiskGuard"));
    await user.click(screen.getByText("BillPro"));
    expect(screen.getByText(/^2 product\(s\) selected/)).toBeInTheDocument();

    await user.click(analyse);
    await screen.findByText(COPY.depsIntro);
    expect(bodyOf("post", P.deps).selectedProducts).toEqual([
      { capability: "Fraud Detection", name: "RiskGuard", vendor: "Beta Corp" },
      { capability: "Billing", name: "BillPro" },
    ]);
    // The AI's recommended dependency options arrive pre-selected.
    expect(tileCheckbox("Okta")).toBeChecked();
    expect(tileCheckbox("Keycloak")).not.toBeChecked();
  });

  it("reports a failed dependency analysis and stays on the products", async () => {
    mockApi.fail("post", P.deps);
    const { user } = startAt(3.5);
    await user.click(screen.getByRole("button", { name: /Analyse Dependencies/ }));

    await expectError("POST /turbolens/architect/phase3/deps failed");
    expect(screen.getByText(COPY.gapsIntro)).toBeInTheDocument();
  });

  it("returns to the options when the user chooses a different approach", async () => {
    const { user } = startAt(3.5);
    await user.click(screen.getByRole("button", { name: "Choose Different Approach" }));

    expect(screen.getByText(COPY.optionsIntro)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Select This Approach/ })).toHaveLength(2);
    expect(storedSession()).toMatchObject({ archPhase: 3, selectedOptionId: null, gapResult: null });
  });

  it("says so when the landscape already covers every capability", () => {
    startAt(3.5, { gapResult: { gaps: [] }, selectedRecs: [] });

    expect(
      screen.getByText("All requirements covered by existing landscape. No capability gaps identified."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Analyse Dependencies/ })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Phase 3c — dependencies
// ---------------------------------------------------------------------------

describe("TurboLensArchitect — dependencies (phase 3c)", () => {
  it("summarises the chosen products and renders each dependency's options", () => {
    startAt(4);

    expect(screen.getByText("Buy a fraud platform")).toBeInTheDocument();
    expect(screen.getByText("FraudShield")).toBeInTheDocument();
    expect(screen.getByText("BillPro")).toBeInTheDocument();
    expect(screen.queryByText("RiskGuard")).not.toBeInTheDocument();
    for (const text of [
      "FraudShield needs an identity provider",
      "Identity Provider",
      "SSO for analysts",
      "CRITICAL",
      "LOW",
      "Top Pick",
      "Okta Inc",
      "Already licensed",
      "+ Mature SSO",
      "- Per-seat cost",
      "$20k",
      "effort: Medium",
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });

  it("sends the products and the picked dependencies to the target architecture", async () => {
    const { user } = startAt(4);
    await user.click(screen.getByText("Okta"));
    expect(tileCheckbox("Okta")).not.toBeChecked();
    await user.click(screen.getByText("Kafka"));
    await user.click(screen.getByRole("button", { name: /Generate Target Architecture/ }));

    await screen.findByTestId("ldv");
    expect(bodyOf("post", P.target)).toEqual({
      phase: 5,
      ...CONTEXT,
      allQA: ALL_QA,
      selectedOption: OPTION_BUY,
      selectedRecommendations: [
        EXPECTED_RECOMMENDATIONS[0],
        EXPECTED_RECOMMENDATIONS[1],
        { capability: "Message Bus", recommendation: "Kafka", role: "dependency" },
      ],
    });
  });

  it("reports a failed target architecture and stays on the dependencies", async () => {
    mockApi.fail("post", P.target);
    const { user } = startAt(4);
    await user.click(screen.getByRole("button", { name: /Generate Target Architecture/ }));

    await expectError("POST /turbolens/architect/phase3 failed");
    expect(screen.getByText(COPY.depsIntro)).toBeInTheDocument();
  });

  it("says so when the products need no further dependency", () => {
    startAt(4, { depsResult: { dependencies: [] }, selectedDeps: [] });

    expect(
      screen.getByText(
        "No additional dependencies needed — the selected products can integrate with your existing landscape.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generate Target Architecture/ })).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// Phase 5 — target architecture
// ---------------------------------------------------------------------------

describe("TurboLensArchitect — target architecture (phase 5)", () => {
  it("lists capabilities, new cards and relations by name", () => {
    startAt(5);

    expect(screen.getByText("Introduce FraudShield on top of the existing payments estate")).toBeInTheDocument();
    expect(screen.getAllByText("New")).toHaveLength(1);
    expect(screen.getAllByText("Existing")).toHaveLength(1);
    // Only new cards are proposed; an existing one appears in relations only.
    expect(cardSwitch("FraudShield")).toBeChecked();
    expect(cardSwitch("Okta")).toBeChecked();
    expect(cardSwitch("Orphan Widget")).toBeChecked();
    expect(screen.getByText("(Business Application)")).toBeInTheDocument();
    expect(screen.getByText("Proposed New Relations (5)")).toBeInTheDocument();
    expect(screen.getByText("Legacy CRM")).toBeInTheDocument();
    expect(screen.getByText("ghost")).toBeInTheDocument();
    expect(screen.getByText("improves")).toBeInTheDocument();
  });

  it("merges the landscape and the proposal into one dependency graph in metamodel direction", () => {
    startAt(5);

    const { nodes, edges } = lastLdv();
    expect(nodes.map((n) => [n.id, Boolean(n.proposed)])).toEqual([
      ["obj-1", false],
      ["app-erp", false],
      ["pc-1", true],
      ["pc-2", true],
      ["pc-3", false],
      ["card-cap-1", false],
      ["cap-new-1", true],
    ]);
    expect(edges).toEqual([
      { source: "app-erp", target: "card-cap-1", type: "relAppToBC", label: "supports", reverse_label: undefined },
      { source: "pc-1", target: "cap-new-1", type: "relAppToBC", label: "supports", reverse_label: "is supported by" },
      // The AI wrote ITComponent → Application; the metamodel says Application → ITComponent.
      { source: "pc-1", target: "pc-2", type: "relAppToITC", label: "uses", reverse_label: "is used by" },
      { source: "pc-3", target: "card-cap-1", type: "relAppToBC", label: "supports", reverse_label: "is supported by" },
      { source: "obj-1", target: "cap-new-1", type: "relObjectiveToBC", label: "improves", reverse_label: undefined },
    ]);
  });

  it("drops a disabled card and its relations from the graph until it is enabled again", async () => {
    const { user } = startAt(5);

    await user.click(cardSwitch("FraudShield"));
    expect(cardSwitch("FraudShield")).not.toBeChecked();
    expect(screen.getByLabelText("Enable this card and its relations")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(2);
    const disabled = lastLdv();
    expect(disabled.nodes.map((n) => n.id)).toEqual(["obj-1", "app-erp", "pc-3", "card-cap-1", "cap-new-1"]);
    expect(disabled.edges.map((e) => `${e.source}>${e.target}`)).toEqual([
      "app-erp>card-cap-1",
      "pc-3>card-cap-1",
      "obj-1>cap-new-1",
    ]);
    expect(storedSession().capabilityMapping).toMatchObject({
      proposedCards: [{ id: "pc-1", disabled: true }, {}, {}, {}],
    });

    await user.click(cardSwitch("FraudShield"));
    expect(lastLdv().edges).toHaveLength(5);
  });

  it("renames a proposed card with Enter or the save button, and discards with Escape or cancel", async () => {
    const { user } = startAt(5);

    await user.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    await user.clear(screen.getByDisplayValue("FraudShield"));
    await user.paste("FraudShield Pro");
    await user.keyboard("{Enter}");
    expect(screen.getAllByText("FraudShield Pro").length).toBeGreaterThan(1);
    expect(lastLdv().nodes.find((n) => n.id === "pc-1")?.name).toBe("FraudShield Pro");

    await user.click(screen.getAllByRole("button", { name: "Edit" })[1]);
    await user.click(screen.getByDisplayValue("Okta"));
    await user.paste(" Workforce");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getAllByText("Okta Workforce").length).toBeGreaterThan(0);

    await user.click(screen.getAllByRole("button", { name: "Edit" })[2]);
    await user.type(screen.getByDisplayValue("Orphan Widget"), " X{Escape}");
    expect(screen.getByText("Orphan Widget")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Edit" })[2]);
    await user.type(screen.getByDisplayValue("Orphan Widget"), " Y");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Orphan Widget")).toBeInTheDocument();
    expect(screen.queryByText("Orphan Widget Y")).not.toBeInTheDocument();
  });

  it("saves an assessment once, then updates it after a material change", async () => {
    const longReq = "R".repeat(250);
    const { user } = startAt(5, { archReq: longReq });

    await user.click(screen.getByRole("button", { name: /Save Assessment/ }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Assessment saved/ })).toBeDisabled(),
    );
    expect(screen.getAllByText("Assessment saved")).toHaveLength(2);
    const created = bodyOf("post", P.assessments);
    expect(created).toMatchObject({ title: "R".repeat(200), requirement: longReq });

    // Disabling a card changes the mapping, so the saved copy is stale again.
    await user.click(cardSwitch("Orphan Widget"));
    await user.click(screen.getByRole("button", { name: /Save Assessment/ }));
    await waitFor(() => expect(mockApi.callsOf("patch")).toHaveLength(1));
    const patch = mockApi.callsOf("patch")[0];
    expect(patch.path).toBe("/turbolens/assessments/as-1");
    expect((patch.body as { sessionData: { capabilityMapping: CapabilityMappingResult } }).sessionData
      .capabilityMapping.proposedCards[3]).toMatchObject({ id: "pc-4", disabled: true });
    expect(mockApi.callsOf("post", P.assessments)).toHaveLength(1);
  });

  it("does not open the commit dialog when saving the assessment fails", async () => {
    mockApi.fail("post", P.assessments, 500);
    const { user } = startAt(5);
    await user.click(screen.getByRole("button", { name: /Commit & Create Initiative/ }));

    await expectError("POST /turbolens/assessments failed");
    expect(screen.queryByTestId("commit-dialog")).not.toBeInTheDocument();
    expect(commitProps).toHaveLength(0);
  });

  it("says so when nothing new is proposed and draws no diagram for an empty graph", () => {
    startAt(5, {
      capabilityMapping: { capabilities: [], proposedCards: [], proposedRelations: [] },
    });

    expect(screen.getByText("No new cards proposed")).toBeInTheDocument();
    expect(screen.queryByText(/Proposed New Relations/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("ldv")).not.toBeInTheDocument();
  });

  it("returns to the options and forgets the assessment when choosing a different approach", async () => {
    const { user } = startAt(5, { assessmentId: "as-7", assessmentSaved: true });
    await user.click(screen.getByRole("button", { name: "Choose Different Approach" }));

    expect(screen.getByText(COPY.optionsIntro)).toBeInTheDocument();
    expect(storedSession()).toMatchObject({
      archPhase: 3,
      capabilityMapping: null,
      assessmentId: null,
      assessmentSaved: false,
    });
  });
});

// ---------------------------------------------------------------------------
// Stepper navigation, persistence, resume, reset
// ---------------------------------------------------------------------------

describe("TurboLensArchitect — navigation and persistence", () => {
  it("browses back and forth between reached steps without clearing anything", async () => {
    const { user } = startAt(5);

    await user.click(screen.getByText("Product Selection"));
    expect(screen.getByText(COPY.gapsIntro)).toBeInTheDocument();
    expect(tileCheckbox("FraudShield")).toBeChecked();

    await user.click(screen.getByText("Dependencies"));
    expect(screen.getByText(COPY.depsIntro)).toBeInTheDocument();

    await user.click(screen.getByText("Business Fit"));
    expect(screen.getByText(COPY.phase1Intro)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(COPY.answer)).toHaveValue("The risk team");
    expect(screen.getByRole("button", { name: "✓ Mobile" })).toBeInTheDocument();

    await user.click(screen.getByText("Technical Fit"));
    expect(screen.getByPlaceholderText(COPY.answer)).toHaveValue("EU cloud");

    await user.click(screen.getByText("Solution Options"));
    expect(selectButtonOf("Buy a fraud platform")).toHaveTextContent("Selected");

    await user.click(screen.getByText("Target Architecture"));
    expect(screen.getByTestId("ldv")).toBeInTheDocument();
    expect(mockApi.callsOf("post")).toHaveLength(0);
  });

  it("does not let the user jump ahead of what has been reached", async () => {
    const { user } = startAt(3);

    await user.click(screen.getByText("Target Architecture"));
    await user.click(screen.getByText("Solution Options"));
    expect(screen.getByText(COPY.optionsIntro)).toBeInTheDocument();
  });

  it("restores the wizard from the session snapshot after a remount", async () => {
    const first = renderArchitect();
    await walkTo(first.user, 1);
    expect(storedSession()).toMatchObject({
      archReq: REQUIREMENT,
      archPhase: 1,
      selectedObjectives: [SELECTED_OBJECTIVE],
    });
    first.unmount();

    renderArchitect();
    expect(screen.getByText(COPY.phase1Intro)).toBeInTheDocument();
    expect(screen.getByText(Q_CHANNEL)).toBeInTheDocument();
  });

  it("starts fresh when the stored snapshot is unreadable", () => {
    sessionStorage.setItem(SESSION_KEY, "{not json");
    renderArchitect();
    expect(screen.getByRole("textbox", { name: "Business Requirement" })).toHaveValue("");
  });

  it("New Assessment clears every phase", async () => {
    const { user } = startAt(5, { assessmentId: "as-3" });
    await user.click(screen.getByRole("button", { name: /New Assessment/ }));

    expect(screen.getByRole("textbox", { name: "Business Requirement" })).toHaveValue("");
    expect(screen.queryByTestId("ldv")).not.toBeInTheDocument();
    expect(storedSession()).toMatchObject({
      archPhase: 0,
      archOptions: null,
      capabilityMapping: null,
      assessmentId: null,
      selectedRecs: [],
    });
  });

  it("resumes a saved assessment from ?resume= and updates it on commit", async () => {
    mockApi.on("get", `${P.assessments}/as-9`, {
      id: "as-9",
      status: "saved",
      session_data: sessionAt(5),
    });
    const { user } = renderArchitect("/turbolens?tab=architect&resume=as-9");

    expect(await screen.findByTestId("ldv")).toBeInTheDocument();
    // The resume parameter is dropped so a reload does not resume again.
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\?tab=architect$/));

    await user.click(screen.getByRole("button", { name: /Commit & Create Initiative/ }));
    expect(await screen.findByTestId("commit-dialog")).toHaveTextContent("commit as-9");
    expect(mockApi.callsOf("patch")[0].path).toBe("/turbolens/assessments/as-9");
    expect(mockApi.callsOf("post", P.assessments)).toHaveLength(0);
  });

  it("does not resume an assessment that was already committed", async () => {
    mockApi.on("get", `${P.assessments}/as-5`, { id: "as-5", status: "committed", session_data: sessionAt(5) });
    renderArchitect("/turbolens?resume=as-5");

    await waitFor(() => expect(mockApi.callsOf("get", `${P.assessments}/as-5`)).toHaveLength(1));
    expect(screen.getByRole("textbox", { name: "Business Requirement" })).toHaveValue("");
    expect(screen.getByTestId("location")).toHaveTextContent("?resume=as-5");
  });

  it("ignores a resume link to an assessment that no longer exists", async () => {
    mockApi.fail("get", `${P.assessments}/gone`, 404);
    renderArchitect("/turbolens?resume=gone");

    await waitFor(() => expect(mockApi.callsOf("get", `${P.assessments}/gone`)).toHaveLength(1));
    expect(screen.getByRole("textbox", { name: "Business Requirement" })).toHaveValue("");
    expect(screen.queryByText(/assessments\/gone/)).not.toBeInTheDocument();
  });
});
