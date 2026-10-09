/**
 * TurboLensArchitect — regression tests for wizard bugs found by the mutation
 * pass: a proposed relation with an end that is not set, a question that
 * arrives with no usable input, the loading line while the solution options
 * are generated, and the saved state of an assessment resumed from a link.
 *
 * Fixtures and helpers mirror `TurboLensArchitect.test.tsx`; React Flow and
 * the commit dialog are stubbed with components that record their props.
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
vi.mock("@/features/turbolens/CommitInitiativeDialog", () => ({
  default: (props: CommitProps) =>
    props.open ? <div data-testid="commit-dialog">{`commit ${props.assessmentId}`}</div> : null,
}));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { renderWithProviders } from "@/test/render";
import { CARD_TYPES, RELATION_TYPES } from "@/test/fixtures/metamodel";
import type { ArchSolutionOption, CapabilityMappingResult } from "@/types";
import type { GEdge, GNode } from "@/features/reports/layeredDependencyLayout";
import type CommitInitiativeDialogType from "./CommitInitiativeDialog";
import TurboLensArchitect from "./TurboLensArchitect";

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
const ANSWER = "Enter your answer...";
const OPTIONS_INTRO = "Based on your requirements, here are the recommended solution approaches:";
const PHASE2_INTRO = "Based on your answers, please provide more technical details:";

const REQUIREMENT = "Detect payment fraud in real time";
const OPTION: ArchSolutionOption = {
  id: "opt-buy",
  title: "Buy a fraud platform",
  approach: "buy",
  summary: "License a SaaS fraud engine",
  impactPreview: { newComponents: [], modifiedComponents: [], newIntegrations: [], retiredComponents: [] },
};

const MAPPING: CapabilityMappingResult = {
  capabilities: [{ id: "cap-new-1", name: "Fraud Detection", isNew: true }],
  proposedCards: [{ id: "pc-1", name: "FraudShield", cardTypeKey: "Application", isNew: true }],
  proposedRelations: [{ sourceId: "pc-1", targetId: "cap-new-1", relationType: "relAppToBC" }],
};

function sessionAt(phase: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    archReq: REQUIREMENT,
    archPhase: phase,
    archQuestions: [],
    phase1Answers: [],
    phase2Answers: [],
    archOptions: phase >= 3 ? [OPTION] : null,
    selectedOptionId: phase >= 3.5 ? OPTION.id : null,
    selectedObjectives: [{ id: "obj-1", name: "Grow revenue" }],
    selectedCapabilities: [],
    gapResult: phase >= 3.5 ? { gaps: [] } : null,
    depsResult: phase >= 4 ? { dependencies: [] } : null,
    capabilityMapping: phase >= 5 ? MAPPING : null,
    selectedRecs: [],
    selectedDeps: [],
    ...over,
  };
}

function LocationProbe() {
  return <div data-testid="location">{useLocation().search}</div>;
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

function startAt(phase: number, over: Record<string, unknown> = {}) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionAt(phase, over)));
  return renderArchitect();
}

function lastLdv(): LdvProps {
  return ldvProps[ldvProps.length - 1];
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

function questionCard(text: string): HTMLElement {
  return screen.getByText(text).closest(".MuiPaper-root") as HTMLElement;
}

beforeEach(() => {
  sessionStorage.clear();
  mockApi.reset();
  hookState.reset();
  withMetamodel(CARD_TYPES, RELATION_TYPES);
  ldvProps.length = 0;
  mockApi.on("get", P.objectives, []);
  mockApi.on("get", P.capabilities, []);
  mockApi.on("post", P.assessments, { id: "as-1" });
  mockApi.on("patch", /^\/turbolens\/assessments\//, (path: string) => ({ id: path.split("/").pop() }));
});

describe("TurboLensArchitect — a proposed relation with an end that is not set", () => {
  it("is not drawn to the first new capability, or anywhere else", () => {
    startAt(5, {
      capabilityMapping: {
        ...MAPPING,
        proposedRelations: [
          ...MAPPING.proposedRelations,
          { sourceId: "pc-1", relationType: "relAppToBC" },
          { targetId: "pc-1", relationType: "relAppToITC" },
          { sourceId: "pc-1", targetId: "", relationType: "relAppToBC" },
        ],
      },
    });

    expect(lastLdv().edges.map((e) => [e.source, e.target, e.type])).toEqual([
      ["pc-1", "cap-new-1", "relAppToBC"],
    ]);
  });
});

describe("TurboLensArchitect — a question with no usable input", () => {
  it("falls back to a free-text answer, so the round can always be submitted", async () => {
    mockApi.on("post", P.phase2, { questions: [{ question: "Where should it be hosted?", type: "text" }] });
    const { user } = startAt(1, {
      archQuestions: [
        { question: "Which channel?", type: "choice", answer: "" },
        { question: "Which qualities?", type: "multi", options: [], answer: "" },
        { question: "How urgent?", type: "scale", options: ["1", "5"], answer: "" },
      ],
    });

    const submit = screen.getByRole("button", { name: /Submit & Get Technical Questions/ });
    expect(submit).toBeDisabled();
    for (const [question, answer] of [
      ["Which channel?", "Mobile"],
      ["Which qualities?", "Security"],
      ["How urgent?", "Very"],
    ]) {
      await user.type(within(questionCard(question)).getByPlaceholderText(ANSWER), answer);
    }
    expect(submit).toBeEnabled();

    await user.click(submit);
    expect(await screen.findByText(PHASE2_INTRO)).toBeInTheDocument();
    expect(mockApi.callsOf("post", P.phase2)[0].body).toMatchObject({
      phase1QA: [
        { question: "Which channel?", answer: "Mobile" },
        { question: "Which qualities?", answer: "Security" },
        { question: "How urgent?", answer: "Very" },
      ],
    });
  });

  it("still offers choices, not free text, when a choice question carries options", () => {
    startAt(1, {
      archQuestions: [
        { question: "Which channel?", type: "choice", options: ["Web", "Mobile"], answer: "" },
        { question: "Which qualities?", type: "multi", options: ["Security"], answer: "" },
      ],
    });

    const channel = questionCard("Which channel?");
    expect(within(channel).getByRole("button", { name: "Mobile" })).toBeInTheDocument();
    expect(within(channel).queryByPlaceholderText(ANSWER)).not.toBeInTheDocument();
    const qualities = questionCard("Which qualities?");
    expect(within(qualities).getByRole("button", { name: "Security" })).toBeInTheDocument();
    expect(within(qualities).queryByPlaceholderText(ANSWER)).not.toBeInTheDocument();
  });
});

describe("TurboLensArchitect — the loading line", () => {
  it("says the solution approaches are being analysed while Analyze Capabilities runs", async () => {
    let answer: (v: unknown) => void = () => {};
    mockApi.on("post", P.options, () => new Promise((r) => (answer = r)));
    const { user } = startAt(2, { archQuestions: [{ question: "Where should it be hosted?", answer: "" }] });

    await user.type(screen.getByPlaceholderText(ANSWER), "EU cloud");
    await user.click(screen.getByRole("button", { name: /Analyze Capabilities/ }));

    expect(await screen.findByText("AI is analyzing solution approaches...")).toBeInTheDocument();
    expect(screen.queryByText("AI is analyzing your landscape...")).not.toBeInTheDocument();

    await act(async () => answer({ options: [OPTION] }));
    expect(await screen.findByText(OPTIONS_INTRO)).toBeInTheDocument();
    expect(screen.queryByText("AI is analyzing solution approaches...")).not.toBeInTheDocument();

    // Picking an option right after analyses its gaps, and says so.
    mockApi.on("post", P.gaps, () => new Promise(() => {}));
    await user.click(screen.getByRole("button", { name: /Select This Approach/ }));
    expect(await screen.findByText("AI is analyzing gaps for the selected approach...")).toBeInTheDocument();
    expect(screen.queryByText("AI is analyzing solution approaches...")).not.toBeInTheDocument();
  });
});

describe("TurboLensArchitect — an assessment resumed from a link", () => {
  it("is shown as saved until something changes, and updates the same assessment", async () => {
    mockApi.on("get", `${P.assessments}/as-9`, { id: "as-9", status: "saved", session_data: sessionAt(5) });
    const { user } = renderArchitect("/turbolens?tab=architect&resume=as-9");

    expect(await screen.findByTestId("ldv")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\?tab=architect$/));
    expect(screen.getByRole("button", { name: /Assessment saved/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Save Assessment/ })).not.toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null")).toMatchObject({
      assessmentId: "as-9",
      assessmentSaved: true,
    });

    // A material change after the resume makes it saveable again; saving
    // updates as-9 rather than creating another assessment.
    await user.click(cardSwitch("FraudShield"));
    const save = screen.getByRole("button", { name: /Save Assessment/ });
    expect(save).toBeEnabled();
    await user.click(save);
    expect(await screen.findByRole("button", { name: /Assessment saved/ })).toBeDisabled();
    expect(mockApi.callsOf("patch").map((c) => c.path)).toEqual([`${P.assessments}/as-9`]);
    expect(mockApi.callsOf("post", P.assessments)).toHaveLength(0);
  });
});

describe("TurboLensArchitect — the loading line of the later steps", () => {
  const GAPS_LINE = "AI is analyzing gaps for the selected approach...";

  it("says the dependencies are being analysed while Analyse Dependencies runs", async () => {
    let answer: (v: unknown) => void = () => {};
    mockApi.on("post", P.deps, () => new Promise((r) => (answer = r)));
    const { user } = startAt(3.5, {
      gapResult: { gaps: [{ capability: "Fraud Detection", recommendations: [{ name: "FraudShield" }] }] },
      selectedRecs: ["0:0"],
    });

    await user.click(screen.getByRole("button", { name: /Analyse Dependencies/ }));
    expect(await screen.findByText("AI is analyzing dependencies for the selected products...")).toBeInTheDocument();
    expect(screen.queryByText(GAPS_LINE)).not.toBeInTheDocument();

    await act(async () => answer({ dependencies: [] }));
    expect(await screen.findByRole("button", { name: /Generate Target Architecture/ })).toBeEnabled();
    expect(screen.queryByText("AI is analyzing dependencies for the selected products...")).not.toBeInTheDocument();
  });

  it("says the capabilities are being mapped while Generate Target Architecture runs", async () => {
    let answer: (v: unknown) => void = () => {};
    mockApi.on("post", P.target, () => new Promise((r) => (answer = r)));
    const { user } = startAt(4);

    await user.click(screen.getByRole("button", { name: /Generate Target Architecture/ }));
    expect(await screen.findByText("AI is analyzing capabilities and dependencies...")).toBeInTheDocument();
    expect(screen.queryByText(GAPS_LINE)).not.toBeInTheDocument();
    expect(screen.queryByText("AI is analyzing dependencies for the selected products...")).not.toBeInTheDocument();

    await act(async () => answer(MAPPING));
    expect(await screen.findByTestId("ldv")).toBeInTheDocument();
    expect(screen.queryByText("AI is analyzing capabilities and dependencies...")).not.toBeInTheDocument();
  });
});

describe("TurboLensArchitect — naming a proposed relation's ends", () => {
  /** The proposed-relations list's lines, as text. */
  function relationLines(): (string | null)[] {
    const heading = screen.getByText(/^Proposed New Relations/);
    const rels = heading.closest(".MuiPaper-outlined") as HTMLElement;
    return Array.from(rels.querySelectorAll(".MuiStack-root .MuiStack-root")).map((l) => l.textContent);
  }

  it("names each end after the node the diagram draws it to", () => {
    // "pc-crm" stands for the landscape's "app-crm" under another name, and the
    // capability "cap-1" stands for the landscape's "bc-1": the diagram draws a
    // relation addressing "app-crm" to the proposal's node, and one addressing
    // "cap-1" to the landscape's node.
    startAt(5, {
      capabilityMapping: {
        capabilities: [
          { id: "cap-1", name: "Customer Management", isNew: false, existingCardId: "bc-1" },
          { id: "cap-new", name: "Lead Scoring", isNew: true },
        ],
        proposedCards: [
          { id: "pc-crm", name: "CRM (proposed)", cardTypeKey: "Application", isNew: false, existingCardId: "app-crm" },
        ],
        proposedRelations: [
          { sourceId: "app-crm", targetId: "cap-new", relationType: "relAppToBC" },
          { sourceId: "pc-crm", targetId: "cap-1", relationType: "relAppToBC" },
        ],
        existingDependencies: {
          nodes: [
            { id: "app-crm", name: "Salesforce", type: "Application" },
            { id: "bc-1", name: "Customer Mgmt (live)", type: "BusinessCapability" },
          ],
          edges: [],
        },
      },
    });

    const { nodes, edges } = lastLdv();
    const drawnName = (id: string) => nodes.find((n) => n.id === id)?.name;
    expect(edges.map((e) => [drawnName(e.source), drawnName(e.target)])).toEqual([
      ["CRM (proposed)", "Lead Scoring"],
      ["CRM (proposed)", "Customer Mgmt (live)"],
    ]);
    expect(relationLines()).toEqual([
      "CRM (proposed)arrow_forwardLead Scoring",
      "CRM (proposed)arrow_forwardCustomer Mgmt (live)",
    ]);
  });

  it("names a switched-off card's end after the card itself, and an unknown end by its id", () => {
    startAt(5, {
      capabilityMapping: {
        ...MAPPING,
        proposedCards: [
          ...MAPPING.proposedCards,
          { id: "pc-off", name: "Switched Off", cardTypeKey: "Application", isNew: true, disabled: true },
        ],
        proposedRelations: [
          { sourceId: "pc-off", targetId: "cap-new-1", relationType: "relAppToBC" },
          { sourceId: "pc-1", targetId: "ghost", relationType: "relAppToITC" },
        ],
      },
    });

    // Neither relation is drawn.
    expect(ldvProps.flatMap((p) => p.edges)).toEqual([]);
    expect(relationLines()).toEqual([
      "Switched Offarrow_forwardFraud Detection",
      "FraudShieldarrow_forwardghost",
    ]);
  });
});

describe("TurboLensArchitect — relation ends the diagram cannot place", () => {
  it("draws no edge from an end that is not a node of the diagram", () => {
    startAt(5, {
      capabilityMapping: {
        ...MAPPING,
        proposedRelations: [
          { sourceId: "ghost", targetId: "cap-new-1", relationType: "relAppToBC" },
          ...MAPPING.proposedRelations,
        ],
      },
    });

    expect(lastLdv().edges.map((e) => [e.source, e.target])).toEqual([["pc-1", "cap-new-1"]]);
  });

  it("does not take a missing end for a card that came back without an id", () => {
    // The AI listed a landscape card without its id: a relation missing an end
    // must still be dropped, not drawn to that card.
    startAt(5, {
      capabilityMapping: {
        ...MAPPING,
        proposedCards: [
          ...MAPPING.proposedCards,
          { name: "Legacy Billing", cardTypeKey: "Application", isNew: false },
        ],
        proposedRelations: [
          { targetId: "cap-new-1", relationType: "relAppToBC" },
          { sourceId: "pc-1", relationType: "relAppToITC" },
          ...MAPPING.proposedRelations,
        ],
      },
    });

    const { nodes, edges } = lastLdv();
    expect(edges.map((e) => [e.source, e.target])).toEqual([["pc-1", "cap-new-1"]]);
    // The card itself is still drawn, unconnected, as landscape context.
    expect(nodes.map((n) => n.name)).toEqual(["FraudShield", "Legacy Billing", "Fraud Detection"]);
  });
});
