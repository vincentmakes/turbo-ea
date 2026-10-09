/**
 * TurboLensArchitect — the parts of the wizard the main suite reaches without
 * pinning: the option cards' impact preview, the gap tiles, the session
 * snapshot's defaults, the restored-assessment state, resuming from a link,
 * the merged dependency graph's edge cases and the relation name lookup.
 *
 * Fixtures and helpers mirror `TurboLensArchitect.test.tsx`; mocks use the
 * `@/` alias so an out-of-tree copy of this file resolves them the same way.
 */
import { StrictMode, type ComponentProps } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation, useNavigate, useNavigationType } from "react-router";

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
vi.mock("@/features/turbolens/CommitInitiativeDialog", () => ({
  default: (props: CommitProps) => {
    commitProps.push(props);
    if (!props.open) return null;
    return <div data-testid="commit-dialog">{`commit ${props.assessmentId}`}</div>;
  },
}));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { renderWithProviders, wrapWithProviders } from "@/test/render";
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
// Endpoints, copy, fixtures
// ---------------------------------------------------------------------------

const P = {
  objectives: "/turbolens/architect/objectives",
  capabilities: "/turbolens/architect/capabilities",
  phase1: "/turbolens/architect/phase1",
  phase2: "/turbolens/architect/phase2",
  options: "/turbolens/architect/phase3/options",
  assessments: "/turbolens/assessments",
};

const SESSION_KEY = "turbolens-architect-session";

const COPY = {
  phase1Intro: "Please answer these clarifying questions about your requirement:",
  phase2Intro: "Based on your answers, please provide more technical details:",
  optionsIntro: "Based on your requirements, here are the recommended solution approaches:",
  gapsIntro: "Select the product you want to use for each capability gap:",
  answer: "Enter your answer...",
  searchObjectives: "Search objectives...",
  searchCapabilities: "Search or type new capability...",
};

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
const Q_HOSTING = "Where should it be hosted?";
const P1_ANSWERED = [{ question: Q_USERS, type: "text", answer: "The risk team" }];
const P2_ANSWERED = [{ question: Q_HOSTING, answer: "EU cloud" }];

const OPTION_BUY: ArchSolutionOption = {
  id: "opt-buy",
  title: "Buy a fraud platform",
  approach: "buy",
  summary: "License a SaaS fraud engine",
  estimatedCost: "$200k",
  estimatedDuration: "3 months",
  estimatedComplexity: "very_high",
  impactPreview: {
    newComponents: [{ name: "FraudShield", cardTypeKey: "Application" }],
    modifiedComponents: [],
    newIntegrations: [{ from: "Payments Hub", to: "FraudShield", protocol: "REST" }],
    retiredComponents: [],
  },
};
const OPTION_BUILD: ArchSolutionOption = {
  id: "opt-build",
  title: "Build in-house scoring",
  approach: "build",
  summary: "Train our own model",
  impactPreview: { newComponents: [], modifiedComponents: [], newIntegrations: [], retiredComponents: [] },
};
const OPTIONS = [OPTION_BUY, OPTION_BUILD];

const GAPS: GapAnalysisResult = {
  summary: "Two capabilities need a product",
  gaps: [
    {
      capability: "Fraud Detection",
      urgency: "critical",
      recommendations: [
        {
          name: "FraudShield",
          vendor: "Acme",
          recommended: true,
          why: "Market leader with rule tuning",
          marketPosition: "Gartner leader",
          principleAlignment: "Aligns with cloud-first",
          estimatedCost: "$150k/yr",
          deploymentModel: "SaaS",
          licenseModel: "Subscription",
        },
      ],
    },
    { capability: "Billing", urgency: "high", recommendations: [{ name: "BillPro" }] },
  ],
};

const DEPS: DependencyAnalysisResult = {
  dependencies: [{ need: "Identity Provider", options: [{ name: "Okta", recommended: true }] }],
};

/** The main suite's mapping: one relation per kind of id the name lookup resolves. */
const MAPPING: CapabilityMappingResult = {
  summary: "Introduce FraudShield on top of the existing payments estate",
  capabilities: [
    { id: "cap-1", name: "Customer Management", isNew: false, existingCardId: "card-cap-1" },
    { id: "cap-new-1", name: "Fraud Detection", isNew: true },
  ],
  proposedCards: [
    { id: "pc-1", name: "FraudShield", cardTypeKey: "Application", isNew: true },
    { id: "pc-2", name: "Okta", cardTypeKey: "ITComponent", isNew: true },
    { id: "pc-3", name: "Legacy CRM", cardTypeKey: "Application", isNew: false, existingCardId: "app-crm" },
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
    edges: [],
  },
};

/** The snapshot the wizard stores for a brand-new assessment. */
const EMPTY_SESSION = {
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

type User = ReturnType<typeof renderWithProviders>["user"];
type Phase = 0 | 1 | 2 | 3 | 3.5 | 4 | 5;

/** Shows the URL and how the router got there, and moves the URL on demand. */
function RouterProbe() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();
  return (
    <>
      <div data-testid="location">{location.search}</div>
      <div data-testid="navigation-type">{navigationType}</div>
      <button onClick={() => navigate(`${location.pathname}${location.search}&panel=open`)}>
        touch url
      </button>
      <button onClick={() => navigate("/turbolens?tab=architect&resume=as-late")}>
        open resume link
      </button>
    </>
  );
}

function renderArchitect(route = "/turbolens?tab=architect") {
  return renderWithProviders(
    <>
      <TurboLensArchitect />
      <RouterProbe />
    </>,
    { route },
  );
}

function sessionAt(phase: Phase): Record<string, unknown> {
  const base = {
    ...EMPTY_SESSION,
    archReq: REQUIREMENT,
    archPhase: phase,
    selectedObjectives: [SELECTED_OBJECTIVE],
    selectedCapabilities: SELECTED_CAPABILITIES,
  };
  delete (base as Record<string, unknown>).assessmentId;
  delete (base as Record<string, unknown>).assessmentSaved;
  if (phase < 3) return base;
  const p3 = { ...base, phase1Answers: P1_ANSWERED, phase2Answers: P2_ANSWERED, archOptions: OPTIONS };
  if (phase === 3) return p3;
  const p35 = { ...p3, selectedOptionId: "opt-buy", gapResult: GAPS, selectedRecs: ["0:0"] };
  if (phase === 3.5) return p35;
  const p4 = { ...p35, depsResult: DEPS, selectedDeps: ["0:0"] };
  if (phase === 4) return p4;
  return { ...p4, capabilityMapping: MAPPING };
}

function startAt(phase: Phase, over: Record<string, unknown> = {}) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...sessionAt(phase), ...over }));
  return renderArchitect();
}

function storedSession(): Record<string, unknown> {
  return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null");
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

function optionCard(title: string): HTMLElement {
  return screen.getByText(title).closest(".MuiCard-root") as HTMLElement;
}

/** The material-symbol glyph rendered on the row that names `name`, if any. */
function rowIcon(scope: HTMLElement, name: string): string | null {
  const row = within(scope).getByText(name).parentElement as HTMLElement;
  return row.querySelector(".material-symbols-outlined")?.textContent ?? null;
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

async function fillRequirements(user: User) {
  await user.click(screen.getByRole("textbox", { name: "Business Requirement" }));
  await user.paste(REQUIREMENT);
  await user.click(screen.getByPlaceholderText(COPY.searchObjectives));
  await user.click(await screen.findByRole("option", { name: /Grow revenue/ }));
}

function node(id: string): GNode | undefined {
  return lastLdv().nodes.find((n) => n.id === id);
}

function edgeList(): string[] {
  return lastLdv().edges.map((e) => `${e.source}>${e.target}`);
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel([OBJECTIVE_TYPE, ...CARD_TYPES], RELATION_TYPES);
  ldvProps.length = 0;
  commitProps.length = 0;
  mockApi.on("get", P.objectives, OBJECTIVES);
  mockApi.on("get", P.capabilities, CAPABILITIES);
  mockApi.on("post", P.options, { options: OPTIONS });
  mockApi.on("post", P.assessments, { id: "as-1" });
  mockApi.on("patch", /^\/turbolens\/assessments\//, (path: string) => ({ id: path.split("/").pop() }));
});

// ---------------------------------------------------------------------------
// Phase 3a — the impact preview of each option card
// ---------------------------------------------------------------------------

/**
 * One option per impact category, each leaving the other three lists out
 * entirely (the AI often omits empty lists), plus one with no impact at all.
 */
const IMPACT_OPTIONS = [
  {
    id: "o-new",
    title: "Only new",
    approach: "buy",
    summary: "s",
    estimatedCost: "$90k",
    estimatedDuration: "6 weeks",
    impactPreview: {
      newComponents: [
        { name: "New App", cardTypeKey: "Application" },
        { name: "New Mystery", cardTypeKey: "Unknown" },
      ],
    },
  },
  {
    id: "o-mod",
    title: "Only modified",
    approach: "extend",
    summary: "s",
    impactPreview: {
      modifiedComponents: [
        { name: "Mod Server", cardTypeKey: "ITComponent" },
        { name: "Mod Mystery", cardTypeKey: "Unknown" },
      ],
    },
  },
  {
    id: "o-int",
    title: "Only integrations",
    approach: "reuse",
    summary: "s",
    impactPreview: {
      newIntegrations: [
        { from: "Hub", to: "Engine", protocol: "gRPC" },
        { from: "Engine", to: "Ledger" },
      ],
    },
  },
  {
    id: "o-ret",
    title: "Only retired",
    approach: "build",
    summary: "s",
    impactPreview: {
      retiredComponents: [
        { name: "Old App", cardTypeKey: "Application" },
        { name: "Old Mystery", cardTypeKey: "Unknown" },
      ],
    },
  },
  { id: "o-none", title: "No impact", approach: "buy", summary: "s", impactPreview: {} },
];

describe("TurboLensArchitect — option impact preview", () => {
  it("shows the impact preview whenever any one category is listed", () => {
    startAt(3, { archOptions: IMPACT_OPTIONS });

    const only = (title: string) => within(optionCard(title));
    expect(only("Only new").getByText("Architectural Impact")).toBeInTheDocument();
    expect(only("Only new").getByText("+ New Components")).toBeInTheDocument();
    expect(only("Only new").queryByText("~ Modified Components")).not.toBeInTheDocument();

    expect(only("Only modified").getByText("Architectural Impact")).toBeInTheDocument();
    expect(only("Only modified").getByText("~ Modified Components")).toBeInTheDocument();
    expect(only("Only modified").queryByText("+ New Components")).not.toBeInTheDocument();

    expect(only("Only integrations").getByText("Architectural Impact")).toBeInTheDocument();
    expect(only("Only integrations").getByText("New Integrations")).toBeInTheDocument();
    expect(only("Only integrations").queryByText("- Retired Components")).not.toBeInTheDocument();

    expect(only("Only retired").getByText("Architectural Impact")).toBeInTheDocument();
    expect(only("Only retired").getByText("- Retired Components")).toBeInTheDocument();
    expect(only("Only retired").queryByText("New Integrations")).not.toBeInTheDocument();

    expect(only("No impact").queryByText("Architectural Impact")).not.toBeInTheDocument();
    expect(screen.getAllByText("Architectural Impact")).toHaveLength(4);
  });

  it("marks each component with its card type's icon, and none for an unknown type", () => {
    startAt(3, { archOptions: IMPACT_OPTIONS });

    expect(rowIcon(optionCard("Only new"), "New App")).toBe("apps");
    expect(rowIcon(optionCard("Only new"), "New Mystery")).toBeNull();
    expect(rowIcon(optionCard("Only modified"), "Mod Server")).toBe("memory");
    expect(rowIcon(optionCard("Only modified"), "Mod Mystery")).toBeNull();
    expect(rowIcon(optionCard("Only retired"), "Old App")).toBe("apps");
    expect(rowIcon(optionCard("Only retired"), "Old Mystery")).toBeNull();
  });

  it("shows estimates and protocols as chips, and no chip for one that is missing", () => {
    startAt(3, { archOptions: IMPACT_OPTIONS });

    const withEstimates = optionCard("Only new");
    expect(within(withEstimates).getByText("$90k").closest(".MuiChip-root")).not.toBeNull();
    expect(within(withEstimates).getByText("6 weeks").closest(".MuiChip-root")).not.toBeNull();
    // The approach chip only: no estimate, duration or complexity was given.
    expect(optionCard("Only modified").querySelectorAll(".MuiChip-root")).toHaveLength(1);

    const integrations = optionCard("Only integrations");
    expect(within(integrations).getByText("gRPC").closest(".MuiChip-root")).not.toBeNull();
    // The approach chip and the one protocol: the second integration has none.
    expect(integrations.querySelectorAll(".MuiChip-root")).toHaveLength(2);
  });

  it("colours a very high complexity like a high effort, and other levels by their own effort", () => {
    startAt(3, {
      archOptions: [
        { ...OPTION_BUY, id: "o-vh", title: "Very hard", estimatedComplexity: "very_high" },
        { ...OPTION_BUILD, id: "o-med", title: "Middling", estimatedComplexity: "medium" },
      ],
    });

    const complexity = (title: string, label: string) =>
      within(optionCard(title)).getByText(label).closest(".MuiChip-root");
    expect(complexity("Very hard", "very high")).toHaveClass("MuiChip-colorError");
    expect(complexity("Middling", "medium")).toHaveClass("MuiChip-colorWarning");
  });
});

// ---------------------------------------------------------------------------
// Phase 3b — gap tiles
// ---------------------------------------------------------------------------

describe("TurboLensArchitect — gap tiles", () => {
  const gapsWithEdges: GapAnalysisResult = {
    ...GAPS,
    gaps: [
      ...GAPS.gaps,
      { capability: "Payments", urgency: "low" },
      { capability: "Ledger", recommendations: [{ name: "LedgerOne", principleAlignment: "N/A" }] },
    ],
  };

  it("lays out the summary and each recommendation's details as their own lines and chips", () => {
    startAt(3.5, { gapResult: gapsWithEdges, selectedRecs: [] });

    expect(screen.getByText("Two capabilities need a product")).toHaveClass("MuiTypography-body2");
    expect(screen.getAllByText("Market Recommendations")).toHaveLength(4);
    for (const line of ["Acme", "Gartner leader", "Aligns with cloud-first", "Market leader with rule tuning"]) {
      expect(screen.getByText(line)).toHaveClass("MuiTypography-caption");
    }
    for (const chip of ["$150k/yr", "SaaS", "Subscription"]) {
      expect(screen.getByText(chip).closest(".MuiChip-root")).not.toBeNull();
    }
  });

  it("offers nothing to pick for a gap without recommendations and hides an N/A alignment", () => {
    startAt(3.5, { gapResult: gapsWithEdges, selectedRecs: [] });

    const payments = screen.getByText("Payments").closest(".MuiPaper-root") as HTMLElement;
    expect(within(payments).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(payments).queryByText("#1")).not.toBeInTheDocument();

    expect(screen.getByText("LedgerOne")).toBeInTheDocument();
    expect(screen.queryByText("N/A")).not.toBeInTheDocument();
  });

  it("keeps each tile's checkbox out of the tab order: the tile itself is what is clicked", () => {
    startAt(3.5, { gapResult: gapsWithEdges, selectedRecs: [] });

    const tile = screen.getByText("BillPro").closest(".MuiPaper-root") as HTMLElement;
    expect(within(tile).getByRole("checkbox")).toHaveAttribute("tabindex", "-1");
  });

  it("starts with nothing picked when the stored session has no product picks", () => {
    startAt(3.5, { selectedRecs: undefined });

    expect(screen.getByText(COPY.gapsIntro)).toBeInTheDocument();
    expect(screen.queryByText(/product\(s\) selected/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Analyse Dependencies/ })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// A fresh wizard
// ---------------------------------------------------------------------------

describe("TurboLensArchitect — a fresh wizard", () => {
  it("stores an empty snapshot and shows no error or message", () => {
    renderArchitect();

    expect(storedSession()).toEqual(EMPTY_SESSION);
    // The disclaimer is the only alert.
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("does not let the user open a question round that has not been reached", async () => {
    const { user } = renderArchitect();

    await user.click(screen.getByText("Business Fit"));
    await user.click(screen.getByText("Technical Fit"));

    expect(screen.getByRole("textbox", { name: "Business Requirement" })).toBeInTheDocument();
    expect(screen.queryByText(COPY.phase1Intro)).not.toBeInTheDocument();
    expect(screen.queryByText(COPY.phase2Intro)).not.toBeInTheDocument();
  });

  it("shows both pickers as loading until the lists arrive", async () => {
    const gate = deferred<unknown>();
    mockApi.on("get", P.objectives, () => gate.promise);
    const { user } = renderArchitect();

    await user.click(screen.getByPlaceholderText(COPY.searchObjectives));
    expect(await screen.findByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText("No options")).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());

    await user.click(screen.getByPlaceholderText(COPY.searchCapabilities));
    expect(await screen.findByText("Loading…")).toBeInTheDocument();

    await act(async () => gate.resolve(OBJECTIVES));
    expect(await screen.findByRole("option", { name: "Customer Management" })).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("ignores the lists loaded by a mount that was torn down (StrictMode's first mount)", async () => {
    const gates: ReturnType<typeof deferred<unknown>>[] = [];
    mockApi.on("get", P.objectives, () => {
      const gate = deferred<unknown>();
      gates.push(gate);
      return gate.promise;
    });
    // StrictMode at the root, as `main.tsx` mounts the app: the wizard mounts,
    // is torn down and mounts again, so the lists are requested twice.
    const user = userEvent.setup();
    const app = wrapWithProviders(<TurboLensArchitect />, { route: "/turbolens?tab=architect" });
    render(<StrictMode>{app}</StrictMode>);
    await waitFor(() => expect(gates).toHaveLength(2));

    // The discarded mount's request answers first, with a list of its own.
    await act(async () => {
      gates[0].resolve([{ id: "obj-stale", name: "Stale objective" }]);
      await new Promise((r) => setTimeout(r, 0));
    });
    await user.click(screen.getByPlaceholderText(COPY.searchObjectives));
    expect(await screen.findByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText("Stale objective")).not.toBeInTheDocument();
    expect(screen.queryByText("No options")).not.toBeInTheDocument();

    await act(async () => {
      gates[1].resolve(OBJECTIVES);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(await screen.findByRole("option", { name: /Grow revenue/ })).toBeInTheDocument();
    expect(screen.queryByText("Stale objective")).not.toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("stops loading the capability picker once an empty list arrives", async () => {
    mockApi.on("get", P.capabilities, []);
    const { user } = renderArchitect();

    // The objectives are listed, so both lists have been loaded.
    await user.click(screen.getByPlaceholderText(COPY.searchObjectives));
    await screen.findByRole("option", { name: /Grow revenue/ });
    await user.keyboard("{Escape}");

    await user.click(screen.getByPlaceholderText(COPY.searchCapabilities));
    expect(screen.getByPlaceholderText(COPY.searchCapabilities)).toHaveFocus();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Question rounds — what the AI's question list is read into
// ---------------------------------------------------------------------------

describe("TurboLensArchitect — reading the AI's questions", () => {
  it("reads a question from the `q` key, keeps an unlabelled one blank and defaults its type", async () => {
    mockApi.on("post", P.phase1, { questions: [{ q: "Asked via q" }, { why: "Unlabelled" }] });
    mockApi.on("post", P.phase2, { questions: [] });
    const { user } = renderArchitect();
    await fillRequirements(user);
    await user.click(screen.getByRole("button", { name: /Generate Questions/ }));

    expect(await screen.findByText(COPY.phase1Intro)).toBeInTheDocument();
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(screen.getByText("Asked via q")).toBeInTheDocument();
    expect(screen.getByText("Impact: Unlabelled")).toBeInTheDocument();
    expect((storedSession().archQuestions as { type: string }[]).map((q) => q.type)).toEqual(["text", "text"]);

    const [first, second] = screen.getAllByPlaceholderText(COPY.answer);
    await user.type(first, "a");
    await user.type(second, "b");
    await user.click(screen.getByRole("button", { name: /Submit & Get Technical Questions/ }));
    await screen.findByText(COPY.phase2Intro);

    expect(mockApi.callsOf("post", P.phase2)[0].body).toMatchObject({
      phase1QA: [
        { question: "Asked via q", answer: "a" },
        { question: "", answer: "b" },
      ],
    });
  });

  it("raises no error when the AI returns no question list", async () => {
    mockApi.on("post", P.phase1, { note: "nothing here" });
    const { user } = renderArchitect();
    await fillRequirements(user);
    await user.click(screen.getByRole("button", { name: /Generate Questions/ }));

    expect(await screen.findByText(COPY.phase1Intro)).toBeInTheDocument();
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });

  it("re-running the options from the technical round forgets the previous choice", async () => {
    const { user } = startAt(5);

    await user.click(screen.getByText("Technical Fit"));
    await user.click(screen.getByRole("button", { name: /Analyze Capabilities/ }));
    await screen.findByText(COPY.optionsIntro);

    expect(screen.getAllByRole("button", { name: /Select This Approach/ })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /^Selected$/ })).not.toBeInTheDocument();
    expect(storedSession()).toMatchObject({ selectedOptionId: null });
  });
});

// ---------------------------------------------------------------------------
// A restored assessment
// ---------------------------------------------------------------------------

describe("TurboLensArchitect — a restored, already saved assessment", () => {
  it("stays saved, keeps the commit dialog closed and updates the same assessment on commit", async () => {
    const { user } = startAt(5, { assessmentId: "as-7", assessmentSaved: true });

    expect(screen.getByRole("button", { name: /Assessment saved/ })).toBeDisabled();
    expect(screen.queryByTestId("commit-dialog")).not.toBeInTheDocument();
    expect(commitProps[commitProps.length - 1]).toMatchObject({ open: false, assessmentId: "as-7" });
    expect(screen.queryAllByRole("alert")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: /Commit & Create Initiative/ }));
    expect(await screen.findByTestId("commit-dialog")).toHaveTextContent("commit as-7");
    expect(mockApi.callsOf("patch").map((c) => c.path)).toEqual(["/turbolens/assessments/as-7"]);
    expect(mockApi.callsOf("post", P.assessments)).toHaveLength(0);
  });

  it("stays saved when a card is 'renamed' to the name it already had", async () => {
    const { user } = startAt(5, { assessmentId: "as-7", assessmentSaved: true });

    await user.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    expect(screen.getByDisplayValue("FraudShield")).toBeInTheDocument();
    await user.keyboard("{Enter}");

    expect(screen.queryByDisplayValue("FraudShield")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Assessment saved/ })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Resuming from ?resume=
// ---------------------------------------------------------------------------

describe("TurboLensArchitect — resuming an assessment from a link", () => {
  const FULL = {
    ...sessionAt(5),
    archQuestions: [{ question: "Leftover question", answer: "kept" }],
  };

  it("restores every part of the stored wizard and replaces the link in history", async () => {
    mockApi.on("get", `${P.assessments}/as-9`, { id: "as-9", status: "saved", session_data: FULL });
    renderArchitect("/turbolens?tab=architect&resume=as-9");

    expect(await screen.findByTestId("ldv")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\?tab=architect$/));
    expect(screen.getByTestId("navigation-type")).toHaveTextContent("REPLACE");

    // The resumed assessment is the saved one: it stays saved.
    expect(storedSession()).toEqual({
      ...FULL,
      assessmentId: "as-9",
      assessmentSaved: true,
    });
    expect(screen.getByRole("button", { name: /Assessment saved/ })).toBeDisabled();
  });

  it("fills in defaults for everything an older snapshot does not carry", async () => {
    mockApi.on("get", `${P.assessments}/as-s`, { id: "as-s", status: "saved", session_data: {} });
    renderArchitect("/turbolens?tab=architect&resume=as-s");

    await waitFor(() => expect(storedSession()).toMatchObject({ assessmentId: "as-s" }));
    expect(storedSession()).toEqual({ ...EMPTY_SESSION, assessmentId: "as-s", assessmentSaved: true });
    expect(screen.getByRole("textbox", { name: "Business Requirement" })).toHaveValue("");
    expect(screen.queryAllByRole("alert")).toHaveLength(1);
  });

  it("fetches the assessment once even if the URL changes while it loads", async () => {
    const gate = deferred<unknown>();
    mockApi.on("get", `${P.assessments}/as-9`, () => gate.promise);
    const { user } = renderArchitect("/turbolens?tab=architect&resume=as-9");

    await waitFor(() => expect(mockApi.callsOf("get", `${P.assessments}/as-9`)).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "touch url" }));
    expect(screen.getByTestId("location")).toHaveTextContent("panel=open");

    await act(async () => gate.resolve({ id: "as-9", status: "saved", session_data: sessionAt(5) }));
    expect(await screen.findByTestId("ldv")).toBeInTheDocument();
    expect(mockApi.callsOf("get", `${P.assessments}/as-9`)).toHaveLength(1);
  });

  it("resumes a link that arrives after the wizard is already open", async () => {
    mockApi.on("get", `${P.assessments}/as-late`, {
      id: "as-late",
      status: "saved",
      session_data: sessionAt(5),
    });
    const { user } = renderArchitect();
    expect(screen.getByRole("textbox", { name: "Business Requirement" })).toHaveValue("");

    await user.click(screen.getByRole("button", { name: "open resume link" }));

    expect(await screen.findByTestId("ldv")).toBeInTheDocument();
    expect(mockApi.callsOf("get", `${P.assessments}/as-late`)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Phase 5 — the merged dependency graph
// ---------------------------------------------------------------------------

/**
 * A proposal whose ids collide with the landscape: a new card reusing a
 * landscape node's id, a capability whose existing card is also a landscape
 * node, a relation naming a capability by its proposal id, and two relations
 * where only one end matches the metamodel's reverse direction.
 */
const GRAPH: CapabilityMappingResult = {
  capabilities: [
    { id: "cap-1", name: "Customer Management", isNew: false, existingCardId: "card-cap-1" },
    { id: "cap-new-1", name: "Fraud Detection", isNew: true },
  ],
  proposedCards: [
    { id: "pc-1", name: "FraudShield", cardTypeKey: "Application", isNew: true },
    { id: "pc-2", name: "Okta", cardTypeKey: "ITComponent", isNew: true },
    { id: "app-erp", name: "ERP Next", cardTypeKey: "Application", isNew: true },
  ],
  proposedRelations: [
    { sourceId: "pc-1", targetId: "cap-1", relationType: "relAppToBC" },
    { sourceId: "pc-1", targetId: "cap-new-1", relationType: "relAppToBC" },
    { sourceId: "obj-1", targetId: "pc-1", relationType: "relAppToITC" },
    { sourceId: "pc-2", targetId: "obj-1", relationType: "relAppToITC" },
    { sourceId: "app-erp", targetId: "cap-new-1", relationType: "relAppToBC" },
  ],
  existingDependencies: {
    nodes: [
      { id: "obj-1", name: "Grow revenue", type: "Objective" },
      { id: "app-erp", name: "ERP", type: "Application" },
      { id: "card-cap-1", name: "Customer Mgmt (landscape)", type: "BusinessCapability" },
    ],
    edges: [],
  },
};

describe("TurboLensArchitect — merged dependency graph", () => {
  it("keeps landscape nodes as they are and resolves a capability named by its proposal id", () => {
    startAt(5, { capabilityMapping: GRAPH });

    expect(node("app-erp")).toMatchObject({ name: "ERP", type: "Application" });
    expect(node("app-erp")?.proposed).toBeFalsy();
    expect(node("card-cap-1")).toMatchObject({ name: "Customer Mgmt (landscape)", type: "BusinessCapability" });
    expect(node("card-cap-1")?.proposed).toBeFalsy();
    expect(node("cap-new-1")).toMatchObject({ name: "Fraud Detection", type: "BusinessCapability", proposed: true });
    expect(edgeList()).toEqual([
      "pc-1>card-cap-1",
      "pc-1>cap-new-1",
      "obj-1>pc-1",
      "pc-2>obj-1",
      "app-erp>cap-new-1",
    ]);
  });

  it("only flips a relation when both ends are the metamodel's reverse", () => {
    startAt(5, { capabilityMapping: GRAPH });

    const edges = lastLdv().edges;
    expect(edges.find((e) => e.source === "obj-1")).toMatchObject({ target: "pc-1", type: "relAppToITC" });
    expect(edges.find((e) => e.source === "pc-2")).toMatchObject({ target: "obj-1", type: "relAppToITC" });
  });

  it("attaches a relation naming a landscape card to its capability before a proposed card matched to it", () => {
    startAt(5, {
      capabilityMapping: {
        capabilities: [
          { id: "cap-1", name: "Customer Management", isNew: false, existingCardId: "card-cap-1" },
        ],
        proposedCards: [
          { id: "pc-1", name: "FraudShield", cardTypeKey: "Application", isNew: true },
          {
            id: "pc-cm",
            name: "Customer Management (proposed)",
            cardTypeKey: "BusinessCapability",
            isNew: false,
            existingCardId: "card-cap-1",
          },
        ],
        proposedRelations: [{ sourceId: "pc-1", targetId: "card-cap-1", relationType: "relAppToBC" }],
        existingDependencies: { nodes: [], edges: [] },
      },
    });

    expect(edgeList()).toEqual(["pc-1>card-cap-1"]);
  });

  it("drops a disabled card's relations even when its id is also a landscape node", async () => {
    const { user } = startAt(5, { capabilityMapping: GRAPH });

    await user.click(cardSwitch("ERP Next"));

    expect(cardSwitch("ERP Next")).not.toBeChecked();
    expect(node("app-erp")).toMatchObject({ name: "ERP" });
    expect(edgeList()).toEqual(["pc-1>card-cap-1", "pc-1>cap-new-1", "obj-1>pc-1", "pc-2>obj-1"]);
  });
});

describe("TurboLensArchitect — proposed relations by name", () => {
  it("names every end: proposed cards, capabilities by either id, and landscape nodes", () => {
    startAt(5);

    const heading = screen.getByText(/Proposed New Relations \(5\)/);
    const panel = heading.closest(".MuiPaper-root") as HTMLElement;
    const ends = Array.from(panel.querySelectorAll(".MuiTypography-caption")).map((el) => el.textContent);
    expect(ends).toEqual([
      "FraudShield",
      "Fraud Detection",
      "Okta",
      "FraudShield",
      "Legacy CRM",
      "Customer Management",
      "FraudShield",
      "ghost",
      "Grow revenue",
      "Fraud Detection",
    ]);
  });

  it("does not list a relation the AI left without an end, as the diagram draws none for it", () => {
    startAt(5, {
      capabilityMapping: {
        ...MAPPING,
        proposedRelations: [{ sourceId: "pc-1", relationType: "relAppToBC" }, MAPPING.proposedRelations[0]],
      },
    });

    const heading = screen.getByText(/Proposed New Relations \(1\)/);
    const panel = heading.closest(".MuiPaper-root") as HTMLElement;
    const ends = Array.from(panel.querySelectorAll(".MuiTypography-caption")).map((el) => el.textContent);
    expect(ends).toEqual(["FraudShield", "Fraud Detection"]);
  });
});
