/**
 * TurboLensArchitect — the second half of the wizard: the stepper, the
 * question widgets, the product / dependency / target-architecture views and
 * the handlers behind them (re-running a phase, choosing again, starting
 * over, saving, committing).
 *
 * `TurboLensArchitect.test.tsx` walks the happy path; this suite pins what
 * that walk cannot see: which steps are reachable at every point, what each
 * re-run forgets, which option every request names, and how the views cope
 * with a stored snapshot that lacks a piece. Like the main suite it starts
 * mid-wizard by seeding the sessionStorage snapshot the component restores
 * on mount, and stubs React Flow and the commit dialog.
 */
import type { ComponentProps } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

vi.mock("@/features/reports/LayeredDependencyView", () => ({
  default: (props: { nodes: unknown[]; edges: unknown[] }) => (
    <div data-testid="ldv">{`${props.nodes.length} nodes / ${props.edges.length} edges`}</div>
  ),
}));

type CommitProps = ComponentProps<typeof CommitInitiativeDialogType>;
const commitProps: CommitProps[] = [];
vi.mock("@/features/turbolens/CommitInitiativeDialog", () => ({
  default: (props: CommitProps) => {
    commitProps.push(props);
    if (!props.open) return null;
    return <div data-testid="commit-dialog">{`commit ${props.assessmentId}`}</div>;
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
import type CommitInitiativeDialogType from "./CommitInitiativeDialog";
import TurboLensArchitect from "./TurboLensArchitect";

// ---------------------------------------------------------------------------
// Endpoints and copy
// ---------------------------------------------------------------------------

const P = {
  objectives: "/turbolens/architect/objectives",
  capabilities: "/turbolens/architect/capabilities",
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
  noNewCards: "No new cards proposed",
  disableCard: "Disable this card and its relations",
};

const STEPS = [
  "Business Requirements",
  "Business Fit",
  "Technical Fit",
  "Solution Options",
  "Product Selection",
  "Dependencies",
  "Target Architecture",
];

// ---------------------------------------------------------------------------
// Fixtures (the same NexaTech-free landscape as the main suite)
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

const PHASE1_QUESTIONS = [
  { question: Q_USERS, why: "Defines the users", type: "text" },
  { question: Q_CHANNEL, type: "choice", options: ["Web", "Mobile"] },
  { question: Q_QUALITIES, type: "multi", options: ["Security", "Performance"] },
];
const P1_ANSWERED = [
  { ...PHASE1_QUESTIONS[0], answer: "The risk team" },
  { ...PHASE1_QUESTIONS[1], answer: "Mobile" },
  { ...PHASE1_QUESTIONS[2], answer: "Security, Latency" },
];
const P2_ANSWERED = [{ question: Q_HOSTING, answer: "EU cloud" }];

const OPTION_BUY: ArchSolutionOption = {
  id: "opt-buy",
  title: "Buy a fraud platform",
  approach: "buy",
  summary: "License a SaaS fraud engine",
  impactPreview: { newComponents: [], modifiedComponents: [], newIntegrations: [], retiredComponents: [] },
};
const OPTION_BUILD: ArchSolutionOption = {
  id: "opt-build",
  title: "Build in-house scoring",
  approach: "build",
  summary: "Train our own model",
  impactPreview: { newComponents: [], modifiedComponents: [], newIntegrations: [], retiredComponents: [] },
};
const OPTIONS = [OPTION_BUY, OPTION_BUILD];

const FRAUDSHIELD = {
  name: "FraudShield",
  vendor: "Acme",
  recommended: true,
  pros: ["Real-time scoring"],
  cons: ["Costly"],
};
const GAPS: GapAnalysisResult = {
  summary: "Two capabilities need a product",
  gaps: [
    {
      capability: "Fraud Detection",
      urgency: "critical",
      recommendations: [FRAUDSHIELD, { name: "RiskGuard", vendor: "Beta Corp" }],
    },
    { capability: "Billing", urgency: "high", recommendations: [{ name: "BillPro" }] },
  ],
};
/** The second gap came back without any product to recommend. */
const GAPS_SPARSE: GapAnalysisResult = {
  summary: "One capability needs a product",
  gaps: [GAPS.gaps[0], { capability: "Billing", urgency: "high" } as GapAnalysisResult["gaps"][number]],
};

const OKTA = {
  name: "Okta",
  vendor: "Okta Inc",
  recommended: true,
  pros: ["Mature SSO"],
  cons: ["Per-seat cost"],
  estimatedCost: "$20k",
  integrationEffort: "medium",
};
const DEPS: DependencyAnalysisResult = {
  summary: "FraudShield needs an identity provider",
  dependencies: [
    { need: "Identity Provider", urgency: "critical", options: [OKTA, { name: "Keycloak" }] },
    { need: "Message Bus", urgency: "low", options: [{ name: "Kafka" }] },
  ],
};
/** The second dependency came back without any option to choose from. */
const DEPS_SPARSE: DependencyAnalysisResult = {
  summary: "FraudShield needs an identity provider",
  dependencies: [
    DEPS.dependencies[0],
    { need: "Message Bus", urgency: "low" } as DependencyAnalysisResult["dependencies"][number],
  ],
};

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
  ],
  existingDependencies: { nodes: [], edges: [] },
};

const PRODUCT_FRAUDSHIELD = {
  capability: "Fraud Detection",
  name: "FraudShield",
  vendor: "Acme",
  pros: ["Real-time scoring"],
  cons: ["Costly"],
};
const PICK_FRAUDSHIELD = {
  capability: "Fraud Detection",
  recommendation: "FraudShield",
  vendor: "Acme",
  role: "primary",
  pros: ["Real-time scoring"],
  cons: ["Costly"],
};
const PICK_BILLPRO = { capability: "Billing", recommendation: "BillPro", role: "primary" };
const PICK_OKTA = {
  capability: "Identity Provider",
  recommendation: "Okta",
  vendor: "Okta Inc",
  role: "dependency",
  pros: ["Mature SSO"],
  cons: ["Per-seat cost"],
};

/** What `New Assessment` must leave behind: nothing at all. */
const BLANK_SESSION = {
  archReq: "",
  archPhase: 0,
  archQuestions: [],
  phase1Answers: [],
  phase2Answers: [],
  archOptions: null,
  selectedOptionId: null,
  selectedObjectives: [],
  selectedCapabilities: [],
  gapResult: null,
  depsResult: null,
  capabilityMapping: null,
  selectedRecs: [],
  selectedDeps: [],
  assessmentId: null,
  assessmentSaved: false,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Phase = 0 | 1 | 2 | 3 | 3.5 | 4 | 5;

/** The snapshot the wizard stores on reaching `phase` through the real UI. */
function sessionAt(phase: Phase): Record<string, unknown> {
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
    return { ...base, archQuestions: PHASE1_QUESTIONS.map((q) => ({ ...q, answer: "" })) };
  }
  if (phase === 2) {
    return { ...base, phase1Answers: P1_ANSWERED, archQuestions: [{ question: Q_HOSTING, answer: "" }] };
  }
  const p3 = { ...base, phase1Answers: P1_ANSWERED, phase2Answers: P2_ANSWERED, archOptions: OPTIONS };
  if (phase === 3) return p3;
  const p35 = { ...p3, selectedOptionId: "opt-buy", gapResult: GAPS, selectedRecs: ["0:0"] };
  if (phase === 3.5) return p35;
  const p4 = { ...p35, depsResult: DEPS, selectedRecs: ["0:0", "1:0"], selectedDeps: ["0:0"] };
  if (phase === 4) return p4;
  return { ...p4, capabilityMapping: MAPPING };
}

/** Mount the wizard as if the user had left it at `phase` in this tab. */
function startAt(phase: Phase, over: Record<string, unknown> = {}) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...sessionAt(phase), ...over }));
  return renderWithProviders(<TurboLensArchitect />, { route: "/turbolens?tab=architect" });
}

function storedSession(): Record<string, unknown> {
  return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null");
}

function bodyOf(method: "post" | "patch", path: string | RegExp): Record<string, unknown> {
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

function lastCommit(): CommitProps {
  return commitProps[commitProps.length - 1];
}

function selectButtonOf(title: string): HTMLElement {
  const card = screen.getByText(title).closest(".MuiCard-root") as HTMLElement;
  return within(card).getByRole("button", { name: /Select This Approach|Selected/ });
}

function stepLabel(name: string): HTMLElement {
  return screen.getByText(name, { selector: ".MuiStepLabel-label" });
}

const DONE = "done";
const CURRENT = "current";
const LOCKED = "locked";

/**
 * Each step as the user sees it: `done` (ticked, click to revisit), `current`
 * (the active step) or `locked` (greyed out, not reachable yet).
 */
function stepper(): string[] {
  return STEPS.map((name) => {
    const c = stepLabel(name).classList;
    const state = [
      c.contains("Mui-active") && CURRENT,
      c.contains("Mui-completed") && DONE,
      c.contains("Mui-disabled") && LOCKED,
    ].filter(Boolean);
    return state.join("+") || "open";
  });
}

/** The Material Symbols shown on the proposed-card row named `name` (phase 5). */
function rowIcons(name: string): string[] {
  const row = screen
    .getAllByText(name)
    .map((el) => el.parentElement as HTMLElement)
    .find((el) => el.querySelector('input[type="checkbox"]'));
  expect(row).toBeDefined();
  return Array.from((row as HTMLElement).querySelectorAll(".material-symbols-outlined")).map(
    (el) => el.textContent ?? "",
  );
}

/** The Paper tile (or panel) that holds the text `name`. */
function tileOf(name: string): HTMLElement {
  return screen.getByText(name).closest(".MuiPaper-root") as HTMLElement;
}

function chipsIn(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll(".MuiChip-root")).map((c) => c.textContent);
}

function questionCard(text: string): HTMLElement {
  return screen.getByText(text).closest(".MuiPaper-root") as HTMLElement;
}

async function expectError(message: string) {
  const text = await screen.findByText(message);
  return text.closest('[role="alert"]') as HTMLElement;
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel([OBJECTIVE_TYPE, ...CARD_TYPES], RELATION_TYPES);
  commitProps.length = 0;
  mockApi.on("get", P.objectives, OBJECTIVES);
  mockApi.on("get", P.capabilities, CAPABILITIES);
  mockApi.on("post", P.phase2, { items: [Q_HOSTING] });
  mockApi.on("post", P.options, { options: OPTIONS });
  mockApi.on("post", P.gaps, GAPS);
  mockApi.on("post", P.deps, DEPS);
  mockApi.on("post", P.target, MAPPING);
  mockApi.on("post", P.assessments, { id: "as-1" });
  mockApi.on("patch", /^\/turbolens\/assessments\//, (path: string) => ({ id: path.split("/").pop() }));
});

// ---------------------------------------------------------------------------
// Page header and phase 0
// ---------------------------------------------------------------------------

describe("TurboLensArchitect — page and requirement form", () => {
  it("names the page and explains every part of the requirement form", () => {
    startAt(0);

    expect(screen.getByRole("heading", { name: "Architecture AI" })).toBeInTheDocument();
    expect(
      screen.getByText(/^Describe your business requirement and the AI will generate/),
    ).toBeInTheDocument();
    expect(screen.getByText("AI-Assisted Assessment")).toBeInTheDocument();
    expect(screen.getByText(/^This assessment leverages AI to generate recommendations/)).toBeInTheDocument();
    expect(screen.getByText("Which business objectives does this solution support?")).toBeInTheDocument();
    expect(screen.getByText(/^Select one or more existing Business Objectives/)).toBeInTheDocument();
    expect(
      screen.getByText("Which business capabilities are you improving or introducing?"),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Select existing Business Capabilities from your landscape/)).toBeInTheDocument();
  });

  it("offers New Assessment as soon as the first question round has started", () => {
    startAt(1);
    expect(screen.getByRole("button", { name: /New Assessment/ })).toBeInTheDocument();
  });

  it("shows a chosen objective by name and leaves only the others to pick", async () => {
    const { user } = startAt(0);

    expect(screen.getByRole("button", { name: "Grow revenue" })).toBeInTheDocument();
    await user.click(screen.getByPlaceholderText(COPY.searchObjectives));
    expect(await screen.findByRole("option", { name: "Reduce churn" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Grow revenue/ })).not.toBeInTheDocument();
  });

  it("removes a capability with the delete icon on its chip", async () => {
    const { user } = startAt(0);

    const chip = screen.getByRole("button", { name: "Customer Management" });
    await user.click(within(chip).getByTestId("CancelIcon"));

    expect(screen.queryByRole("button", { name: "Customer Management" })).not.toBeInTheDocument();
    expect(storedSession().selectedCapabilities).toEqual([SELECTED_CAPABILITIES[1]]);
  });

  it("removes exactly the capability whose chip was cleared, not the first one", async () => {
    const { user } = startAt(0);

    const chip = screen.getByRole("button", { name: "New: Fraud Detection" });
    await user.click(within(chip).getByTestId("CancelIcon"));

    expect(screen.queryByRole("button", { name: "New: Fraud Detection" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Customer Management" })).toBeInTheDocument();
    expect(storedSession().selectedCapabilities).toEqual([SELECTED_CAPABILITIES[0]]);
  });

  it("lists an objective's description as its own line under its name", async () => {
    const { user } = startAt(0, { selectedObjectives: [] });

    await user.click(screen.getByPlaceholderText(COPY.searchObjectives));

    expect(await screen.findByText("Increase online revenue by 10%")).toHaveClass("MuiTypography-caption");
    expect(screen.getByRole("option", { name: "Reduce churn" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Phases 1 & 2 — the question widgets
// ---------------------------------------------------------------------------

describe("TurboLensArchitect — question widgets", () => {
  it("numbers the questions and falls back to free text for anything it cannot offer as choices", () => {
    startAt(1, {
      archQuestions: [
        { question: "How many analysts?", type: "number", answer: "" },
        { question: "Rate the urgency", type: "scale", options: [], answer: "" },
        { question: "Which region?", type: "text", options: ["EU", "US"], answer: "" },
        { question: "Which tier?", options: ["Gold", "Silver"], answer: "" },
      ],
    });

    expect(screen.queryByRole("textbox", { name: "Business Requirement" })).not.toBeInTheDocument();
    ["How many analysts?", "Rate the urgency", "Which region?", "Which tier?"].forEach((q, i) => {
      const card = questionCard(q);
      expect(within(card).getByText(String(i + 1))).toBeInTheDocument();
      expect(within(card).getByPlaceholderText(COPY.answer)).toBeInTheDocument();
    });
    // A text question is answered in words even when the AI attached options.
    expect(screen.queryByRole("button", { name: "EU" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gold" })).not.toBeInTheDocument();
  });

  it("sends exactly the picks made, one per line, and a trimmed custom answer", async () => {
    const { user } = startAt(1, {
      archQuestions: [
        { question: "Which qualities?", type: "multi", options: ["Security", "Performance"], answer: "" },
        { question: "Which drivers?", type: "multi", options: ["Speed", "Cost"], answer: "" },
        { question: "Anything else?", type: "multi", options: ["Uptime"], answer: "" },
      ],
    });

    await user.click(screen.getByRole("button", { name: "Security" }));
    await user.click(screen.getByRole("button", { name: "Speed" }));
    await user.click(screen.getByRole("button", { name: "Cost" }));
    await user.type(within(questionCard("Anything else?")).getByPlaceholderText(COPY.custom), "  Latency  {Enter}");
    await user.click(screen.getByRole("button", { name: /Submit & Get Technical Questions/ }));

    await screen.findByText(COPY.phase2Intro);
    expect(bodyOf("post", P.phase2).phase1QA).toEqual([
      { question: "Which qualities?", answer: "Security" },
      { question: "Which drivers?", answer: "Speed\nCost" },
      { question: "Anything else?", answer: "Latency" },
    ]);
  });

  it("does not count a blank answer as answered", async () => {
    const { user } = startAt(2);
    await user.type(screen.getByPlaceholderText(COPY.answer), "   ");
    expect(screen.getByRole("button", { name: /Analyze Capabilities/ })).toBeDisabled();
  });

  it("shows no question round once the options are on screen", () => {
    startAt(3);

    expect(screen.getByText(COPY.optionsIntro)).toBeInTheDocument();
    expect(screen.queryByText(COPY.phase2Intro)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Analyze Capabilities/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Business Requirement" })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The stepper
// ---------------------------------------------------------------------------

describe("TurboLensArchitect — stepper", () => {
  it.each<[Phase, string[]]>([
    [0, [CURRENT, LOCKED, LOCKED, LOCKED, LOCKED, LOCKED, LOCKED]],
    [1, [DONE, CURRENT, LOCKED, LOCKED, LOCKED, LOCKED, LOCKED]],
    [3, [DONE, DONE, DONE, CURRENT, LOCKED, LOCKED, LOCKED]],
    [3.5, [DONE, DONE, DONE, DONE, CURRENT, LOCKED, LOCKED]],
    [5, [DONE, DONE, DONE, DONE, DONE, DONE, CURRENT]],
  ])("at phase %s ticks the reached steps and locks the rest", (phase, expected) => {
    startAt(phase);
    expect(stepper()).toEqual(expected);
  });

  it.each([
    { phase: 2 as Phase, over: {}, back: "Business Requirements", forward: "Business Fit", lands: COPY.phase1Intro },
    {
      phase: 2 as Phase,
      over: { phase2Answers: P2_ANSWERED },
      back: "Business Fit",
      forward: "Technical Fit",
      lands: COPY.phase2Intro,
    },
    { phase: 3 as Phase, over: {}, back: "Technical Fit", forward: "Solution Options", lands: COPY.optionsIntro },
    { phase: 3.5 as Phase, over: {}, back: "Solution Options", forward: "Product Selection", lands: COPY.gapsIntro },
    { phase: 4 as Phase, over: {}, back: "Product Selection", forward: "Dependencies", lands: COPY.depsIntro },
  ])("keeps $forward reachable after browsing back to $back", async ({ phase, over, back, forward, lands }) => {
    const { user } = startAt(phase, over);

    await user.click(stepLabel(back));
    expect(stepper()[STEPS.indexOf(forward)]).toBe(DONE);

    await user.click(stepLabel(forward));
    expect(screen.getByText(lands)).toBeInTheDocument();
  });

  it("unlocks the steps as the user moves through the rounds", async () => {
    const { user } = startAt(2);
    await user.type(screen.getByPlaceholderText(COPY.answer), "EU cloud");
    await user.click(screen.getByRole("button", { name: /Analyze Capabilities/ }));

    await screen.findByText(COPY.optionsIntro);
    expect(stepper()).toEqual([DONE, DONE, DONE, CURRENT, LOCKED, LOCKED, LOCKED]);
  });

  it("clears the error and leaves the question buffer alone when browsing to another step", async () => {
    mockApi.fail("post", P.assessments);
    const { user } = startAt(5);
    await user.click(screen.getByRole("button", { name: /Save Assessment/ }));
    await expectError("POST /turbolens/assessments failed");

    await user.click(stepLabel("Solution Options"));

    expect(screen.getByText(COPY.optionsIntro)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(storedSession().archQuestions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Re-running a phase forgets what came after it
// ---------------------------------------------------------------------------

describe("TurboLensArchitect — re-running a phase", () => {
  it("re-running the options round forgets the old choice, products, dependencies and architecture", async () => {
    const { user } = startAt(5);
    await user.click(stepLabel("Technical Fit"));
    await user.click(screen.getByRole("button", { name: /Analyze Capabilities/ }));

    await screen.findByText(COPY.optionsIntro);
    expect(storedSession()).toMatchObject({
      archPhase: 3,
      selectedOptionId: null,
      gapResult: null,
      selectedRecs: [],
      depsResult: null,
      selectedDeps: [],
      capabilityMapping: null,
    });
    expect(stepper()).toEqual([DONE, DONE, DONE, CURRENT, LOCKED, LOCKED, LOCKED]);
  });

  it("re-running the dependency analysis forgets the old target architecture", async () => {
    const { user } = startAt(5);
    await user.click(stepLabel("Product Selection"));
    await user.click(screen.getByRole("button", { name: /Analyse Dependencies/ }));

    await screen.findByText(COPY.depsIntro);
    expect(storedSession().capabilityMapping).toBeNull();
    expect(stepper()[6]).toBe(LOCKED);
  });

  it("choosing an option again forgets the last one's products, dependencies and architecture", async () => {
    mockApi.fail("post", P.gaps);
    const { user } = startAt(5);
    await user.click(stepLabel("Solution Options"));
    await user.click(selectButtonOf("Build in-house scoring"));

    await expectError("POST /turbolens/architect/phase3/gaps failed");
    expect(bodyOf("post", P.gaps).selectedOption).toEqual(OPTION_BUILD);
    expect(storedSession()).toMatchObject({
      selectedOptionId: "opt-build",
      gapResult: null,
      selectedRecs: [],
      depsResult: null,
      selectedDeps: [],
      capabilityMapping: null,
    });
    // A choice whose gap analysis failed unlocks nothing further.
    expect(stepper()).toEqual([DONE, DONE, DONE, CURRENT, LOCKED, LOCKED, LOCKED]);

    // Trying again clears the error.
    mockApi.on("post", P.gaps, GAPS);
    await user.click(selectButtonOf("Buy a fraud platform"));
    await screen.findByText(COPY.gapsIntro);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("choosing a different approach from the dependencies forgets the products and dependencies", async () => {
    const { user } = startAt(4);
    expect(screen.getByRole("button", { name: "Start Over" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Choose Different Approach" }));

    expect(screen.getByText(COPY.optionsIntro)).toBeInTheDocument();
    expect(storedSession()).toMatchObject({
      archPhase: 3,
      selectedRecs: [],
      depsResult: null,
      selectedDeps: [],
    });
  });
});

// ---------------------------------------------------------------------------
// Starting over
// ---------------------------------------------------------------------------

describe("TurboLensArchitect — starting over", () => {
  it("New Assessment stores a completely blank snapshot", async () => {
    const { user } = startAt(5, { assessmentId: "as-3", assessmentSaved: true });
    await user.click(screen.getByRole("button", { name: /New Assessment/ }));

    expect(storedSession()).toEqual(BLANK_SESSION);
    expect(stepper()).toEqual([CURRENT, LOCKED, LOCKED, LOCKED, LOCKED, LOCKED, LOCKED]);
  });

  it("New Assessment forgets a saved assessment even when the step does not change", async () => {
    const { user } = startAt(0, { archOptions: OPTIONS, assessmentId: "as-3", assessmentSaved: true });
    await user.click(screen.getByRole("button", { name: /New Assessment/ }));

    expect(storedSession()).toEqual(BLANK_SESSION);
  });

  it("Start Over dismisses an error", async () => {
    mockApi.fail("post", P.gaps);
    const { user } = startAt(3);
    await user.click(selectButtonOf("Buy a fraud platform"));
    await expectError("POST /turbolens/architect/phase3/gaps failed");

    await user.click(screen.getByRole("button", { name: "Start Over" }));

    expect(screen.getByRole("textbox", { name: "Business Requirement" })).toHaveValue("");
    // The AI disclaimer is the only notice left on the blank form.
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual([
      expect.stringContaining("AI-Assisted Assessment"),
    ]);
  });
});

// ---------------------------------------------------------------------------
// Products (3b) and dependencies (3c)
// ---------------------------------------------------------------------------

describe("TurboLensArchitect — products and dependencies", () => {
  it("carries the option the user actually picked through every later request", async () => {
    const { user } = startAt(3.5, { selectedOptionId: "opt-build" });

    expect(screen.getByText("Build in-house scoring")).toBeInTheDocument();
    expect(screen.getByText("Train our own model")).toBeInTheDocument();
    expect(screen.getByText("Build")).toBeInTheDocument();
    expect(screen.queryByText("Buy a fraud platform")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Over" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Analyse Dependencies/ }));
    await screen.findByText(COPY.depsIntro);
    expect(bodyOf("post", P.deps).selectedOption).toEqual(OPTION_BUILD);
    expect(screen.getByText("Build in-house scoring")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Generate Target Architecture/ }));
    await screen.findByTestId("ldv");
    expect(bodyOf("post", P.target).selectedOption).toEqual(OPTION_BUILD);

    await user.click(screen.getByRole("button", { name: /Commit & Create Initiative/ }));
    expect(await screen.findByTestId("commit-dialog")).toHaveTextContent("commit as-1");
    expect(lastCommit().selectedOption).toEqual(OPTION_BUILD);
  });

  it("keeps working from a snapshot that lost the options list", async () => {
    const { user } = startAt(3.5, { archOptions: null });

    await user.click(screen.getByRole("button", { name: /Analyse Dependencies/ }));
    await screen.findByText(COPY.depsIntro);
    expect(bodyOf("post", P.deps).selectedOption).toBeNull();

    await user.click(screen.getByRole("button", { name: /Generate Target Architecture/ }));
    await screen.findByTestId("ldv");
    expect(bodyOf("post", P.target).selectedOption).toBeNull();

    await user.click(screen.getByRole("button", { name: /Commit & Create Initiative/ }));
    await screen.findByTestId("commit-dialog");
    expect(lastCommit().selectedOption).toBeUndefined();
  });

  it("generates the architecture from a snapshot that lost the gap result", async () => {
    const { user } = startAt(4, { gapResult: null });

    const summary = screen.getByText("Buy a fraud platform").closest(".MuiPaper-root") as HTMLElement;
    expect(summary.querySelectorAll(".MuiChip-root")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: /Generate Target Architecture/ }));
    await screen.findByTestId("ldv");
    expect(bodyOf("post", P.target).selectedRecommendations).toEqual([PICK_OKTA]);
  });

  it.each([
    { phase: 3.5 as Phase, over: { gapResult: null }, missing: COPY.gapsIntro },
    { phase: 4 as Phase, over: { depsResult: null }, missing: COPY.depsIntro },
  ])("renders no view for a snapshot at phase $phase without its result", ({ phase, over, missing }) => {
    startAt(phase, over);
    expect(screen.getByRole("heading", { name: "Architecture AI" })).toBeInTheDocument();
    expect(screen.queryByText(missing)).not.toBeInTheDocument();
  });

  it("ignores a selected key that points at a gap without products", async () => {
    const { user } = startAt(3.5, { gapResult: GAPS_SPARSE, selectedRecs: ["0:0", "1:0"] });

    await user.click(screen.getByRole("button", { name: /Analyse Dependencies/ }));
    await screen.findByText(COPY.depsIntro);
    expect(bodyOf("post", P.deps).selectedProducts).toEqual([PRODUCT_FRAUDSHIELD]);
    const summary = screen.getByText("Buy a fraud platform").closest(".MuiPaper-root") as HTMLElement;
    expect(Array.from(summary.querySelectorAll(".MuiChip-root")).map((c) => c.textContent)).toEqual([
      "FraudShield",
    ]);

    await user.click(screen.getByRole("button", { name: /Generate Target Architecture/ }));
    await screen.findByTestId("ldv");
    expect(bodyOf("post", P.target).selectedRecommendations).toEqual([PICK_FRAUDSHIELD, PICK_OKTA]);
  });

  it("shows a dependency option's estimates as chips and adds none it does not have", () => {
    startAt(4);
    expect(chipsIn(tileOf("Okta"))).toEqual(["Top Pick", "$20k", "effort: Medium"]);
    expect(chipsIn(tileOf("Keycloak"))).toEqual([]);
  });

  it("sets the dependency summary, each reason, vendor and rationale on lines of their own", () => {
    startAt(4, {
      depsResult: {
        ...DEPS,
        dependencies: [
          {
            ...DEPS.dependencies[0],
            reason: "Analysts sign in with SSO",
            options: [{ ...OKTA, why: "Already licensed" }, { name: "Keycloak" }],
          },
          DEPS.dependencies[1],
        ],
      },
    });

    expect(screen.getByText(DEPS.summary as string)).toHaveClass("MuiTypography-body2");
    expect(screen.getByText("Analysts sign in with SSO")).toHaveClass("MuiTypography-caption");
    expect(screen.getByText("Okta Inc")).toHaveClass("MuiTypography-caption");
    expect(screen.getByText("Already licensed")).toHaveClass("MuiTypography-caption");
  });

  it("keeps each dependency tile's checkbox out of the tab order: the tile itself is what is clicked", () => {
    startAt(4);

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);
    boxes.forEach((box) => expect(box).toHaveAttribute("tabindex", "-1"));
  });

  it("offers nothing to pick for a dependency without options and ignores a stale key to it", async () => {
    const { user } = startAt(4, { depsResult: DEPS_SPARSE, selectedDeps: ["0:0", "1:0"] });

    expect(screen.getByText("Message Bus")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: /Generate Target Architecture/ }));
    await screen.findByTestId("ldv");
    expect(bodyOf("post", P.target).selectedRecommendations).toEqual([
      PICK_FRAUDSHIELD,
      PICK_BILLPRO,
      PICK_OKTA,
    ]);
  });
});

// ---------------------------------------------------------------------------
// Phase 5 — target architecture
// ---------------------------------------------------------------------------

describe("TurboLensArchitect — target architecture", () => {
  it("labels the panels, the card switches and the actions", () => {
    startAt(5);

    expect(screen.getByText("Business Capabilities")).toBeInTheDocument();
    expect(screen.getByText("Proposed New Cards")).toBeInTheDocument();
    expect(screen.getByText("Dependency Diagram")).toBeInTheDocument();
    expect(screen.getByText(/^Dashed borders indicate proposed new components/)).toBeInTheDocument();
    expect(screen.getAllByLabelText(COPY.disableCard)).toHaveLength(3);
    expect(screen.queryByText(COPY.noNewCards)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Over" })).toBeInTheDocument();
    // No notice is up before anything was saved.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("opens with the architecture summary on a line of its own", () => {
    startAt(5);
    expect(screen.getByText(MAPPING.summary as string)).toHaveClass("MuiTypography-body2");
  });

  it("dismisses an error with the alert's close button", async () => {
    mockApi.fail("post", P.assessments);
    const { user } = startAt(5);
    await user.click(screen.getByRole("button", { name: /Save Assessment/ }));

    const alert = await expectError("POST /turbolens/assessments failed");
    await user.click(within(alert).getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a relation's label as a chip and none for an unlabelled relation", () => {
    startAt(5);
    const panel = screen.getByText(/^Proposed New Relations/).closest(".MuiPaper-root") as HTMLElement;
    expect(chipsIn(panel)).toEqual(["supports"]);
  });

  it("shows each proposed card's type icon, and none for a type the metamodel does not know", () => {
    startAt(5, {
      capabilityMapping: {
        ...MAPPING,
        proposedCards: [
          ...MAPPING.proposedCards,
          { id: "pc-5", name: "Mystery Box", cardTypeKey: "QuantumThing", isNew: true },
        ],
      },
    });

    expect(rowIcons("FraudShield")).toEqual(["apps", "edit"]);
    expect(rowIcons("Okta")).toEqual(["memory", "edit"]);
    expect(rowIcons("Mystery Box")).toEqual(["edit"]);
  });

  it("says no new cards are proposed when every proposed card already exists", () => {
    startAt(5, { capabilityMapping: { ...MAPPING, proposedCards: [MAPPING.proposedCards[2]] } });
    expect(screen.getByText(COPY.noNewCards)).toBeInTheDocument();
  });

  it("disables both actions while the assessment is being saved", async () => {
    const gate = deferred<unknown>();
    mockApi.on("post", P.assessments, () => gate.promise);
    const { user } = startAt(5);

    await user.click(screen.getByRole("button", { name: /Save Assessment/ }));
    expect(screen.getByRole("button", { name: /Commit & Create Initiative/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Save Assessment/ })).toBeDisabled();

    await act(async () => gate.resolve({ id: "as-1" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Commit & Create Initiative/ })).toBeEnabled(),
    );
  });

  it("caps the title of an updated assessment at 200 characters too", async () => {
    const longReq = "R".repeat(250);
    const { user } = startAt(5, { archReq: longReq, assessmentId: "as-2" });

    await user.click(screen.getByRole("button", { name: /Save Assessment/ }));
    await waitFor(() => expect(mockApi.callsOf("patch")).toHaveLength(1));
    expect(bodyOf("patch", /^\/turbolens\/assessments\/as-2$/)).toMatchObject({
      title: "R".repeat(200),
      requirement: longReq,
    });
  });

  it("does not open the commit dialog when updating an existing assessment fails", async () => {
    mockApi.fail("patch", /^\/turbolens\/assessments\//);
    const { user } = startAt(5, { assessmentId: "as-4" });
    await user.click(screen.getByRole("button", { name: /Commit & Create Initiative/ }));

    await expectError("PATCH /turbolens/assessments/as-4 failed");
    expect(screen.queryByTestId("commit-dialog")).not.toBeInTheDocument();
    expect(lastCommit().open).toBe(false);
  });

  it("closes the saved notice with Escape", async () => {
    const { user } = startAt(5);
    await user.click(screen.getByRole("button", { name: /Save Assessment/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Assessment saved");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument(), { timeout: 3000 });
  });
});
