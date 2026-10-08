/**
 * CommitInitiativeDialog — the last step of the Architecture AI wizard:
 * choose which proposed cards and relations to create, name the initiative,
 * then follow the background commit run until it completes or fails.
 *
 * The run is polled on a fixed 2 s interval, so the submit tests run under
 * fake timers (`shouldAdvanceTime`, so Testing Library's own waits still tick)
 * and answer the run endpoint from a mutable `run` the test sets before each
 * advance — a stray extra poll then re-reads the same state instead of
 * skipping one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "@/i18n";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { installWindowOpen } from "@/test/dom";
import { CARD_TYPES, RELATION_TYPES } from "@/test/fixtures/metamodel";
import type { ArchSolutionOption, CapabilityMappingResult, TurboLensAnalysisRun } from "@/types";
import CommitInitiativeDialog from "./CommitInitiativeDialog";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const COMMIT = "/turbolens/architect/commit";
const RUN = "/turbolens/analysis-runs/run-1";
const POLL_MS = 2_000;

const REQUIREMENT = "Detect payment fraud in real time";

const OPTION: ArchSolutionOption = {
  id: "opt-buy",
  title: "Buy a fraud platform",
  approach: "buy",
  summary: "License a SaaS fraud engine",
  impactPreview: { newComponents: [], modifiedComponents: [], newIntegrations: [], retiredComponents: [] },
};

/**
 * Two new cards, one the user switched off in phase 5, and one existing card
 * reached through its `existingCardId`. Relation 2 touches the switched-off
 * card; relation 3 joins two existing cards.
 */
const MAPPING: CapabilityMappingResult = {
  capabilities: [
    { id: "cap-1", name: "Customer Management", isNew: false, existingCardId: "card-cap-1" },
    { id: "cap-new", name: "Fraud Detection", isNew: true },
  ],
  proposedCards: [
    { id: "pc-app", name: "FraudShield", cardTypeKey: "Application", subtype: "businessApplication", isNew: true },
    { id: "pc-itc", name: "Okta", cardTypeKey: "ITComponent", isNew: true },
    { id: "pc-off", name: "Switched Off", cardTypeKey: "Application", isNew: true, disabled: true },
    { id: "pc-old", name: "Legacy CRM", cardTypeKey: "Application", isNew: false, existingCardId: "app-crm" },
  ],
  proposedRelations: [
    { sourceId: "pc-app", targetId: "cap-new", relationType: "relAppToBC", label: "supports" },
    { sourceId: "pc-app", targetId: "pc-itc", relationType: "relAppToITC" },
    { sourceId: "pc-off", targetId: "cap-new", relationType: "relAppToBC" },
    { sourceId: "app-crm", targetId: "card-cap-1", relationType: "relAppToBC" },
  ],
  existingDependencies: {
    nodes: [{ id: "obj-1", name: "Grow revenue", type: "Objective" }],
    edges: [],
  },
};

function analysisRun(over: Partial<TurboLensAnalysisRun>): TurboLensAnalysisRun {
  return {
    id: "run-1",
    analysis_type: "commit",
    status: "running",
    started_at: null,
    completed_at: null,
    results: null,
    error_message: null,
    created_at: null,
    ...over,
  };
}

function progress(step: string, current = 1, total = 3, detail?: string) {
  return { progress: { step, current, total, ...(detail ? { detail } : {}) } };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Props = React.ComponentProps<typeof CommitInitiativeDialog>;

function renderDialog(over: Partial<Props> = {}) {
  const onClose = vi.fn();
  // Under fake timers user-event's own pauses must ride the mocked clock.
  const user = userEvent.setup(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime } : {});
  const utils = render(
    <CommitInitiativeDialog
      open
      onClose={onClose}
      assessmentId="as-1"
      requirement={REQUIREMENT}
      capabilityMapping={MAPPING}
      objectiveIds={["obj-1", "obj-unknown"]}
      selectedOption={OPTION}
      {...over}
    />,
  );
  return { ...utils, user, onClose };
}

/** The row (a Stack) whose name typography reads `name`. */
function rowOf(name: string): HTMLElement {
  const row = screen
    .getAllByText(name)
    .map((el) => el.parentElement as HTMLElement)
    .find((el) => el.querySelector('input[type="checkbox"]'));
  expect(row).toBeDefined();
  return row as HTMLElement;
}

/** The row being edited: the one holding the inline name field. */
function editingRow(value: string): HTMLElement {
  return screen.getByDisplayValue(value).closest(".MuiStack-root") as HTMLElement;
}

function cardSwitch(name: string): HTMLInputElement {
  return within(rowOf(name)).getByRole("checkbox") as HTMLInputElement;
}

/** The relation switches, in relation-index order (after the card switches). */
function relationSwitches(): HTMLInputElement[] {
  const heading = screen.getByText(/^Relations to Create/);
  const section = heading.parentElement as HTMLElement;
  return within(section).getAllByRole("checkbox") as HTMLInputElement[];
}

/** DateField commits on blur, so drive focus → change → blur like a user would. */
function setDate(label: RegExp, value: string) {
  const input = screen.getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

function fillDates() {
  setDate(/Start Date/, "2026-11-01");
  setDate(/End Date/, "2027-03-31");
}

function submitButton(): HTMLElement {
  return screen.getByRole("button", { name: /Create Initiative$/ });
}

async function advancePoll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(POLL_MS);
  });
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel(CARD_TYPES, RELATION_TYPES);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

describe("CommitInitiativeDialog — selection", () => {
  it("pre-selects every enabled new card and every relation not touching a disabled one", () => {
    renderDialog();

    expect(screen.getByRole("textbox", { name: /Initiative Name/ })).toHaveValue("Buy a fraud platform");
    expect(screen.getByText("Cards to Create (2/2)")).toBeInTheDocument();
    expect(screen.getByText("Relations to Create (3/4)")).toBeInTheDocument();
    expect(cardSwitch("FraudShield")).toBeChecked();
    expect(cardSwitch("Okta")).toBeChecked();
    // A card switched off in phase 5 is not offered at all; existing cards are not created.
    expect(screen.queryByText("Legacy CRM", { selector: "p" })).not.toBeInTheDocument();
    expect(screen.getByText("(Business Application)")).toBeInTheDocument();
    expect(screen.getByText("ITComponent")).toBeInTheDocument();

    const [r0, r1, r2, r3] = relationSwitches();
    expect(r0).toBeChecked();
    expect(r1).toBeChecked();
    expect(r2).not.toBeChecked();
    expect(r2).toBeDisabled();
    expect(r3).toBeChecked();
  });

  it("names relation endpoints from new cards, capabilities and existing cards", () => {
    renderDialog();

    const section = screen.getByText(/^Relations to Create/).parentElement as HTMLElement;
    for (const name of ["Fraud Detection", "Switched Off", "Legacy CRM", "Customer Management"]) {
      expect(within(section).getAllByText(name).length).toBeGreaterThan(0);
    }
    expect(within(section).getByText("supports")).toBeInTheDocument();
  });

  it("lists the linked objectives, falling back to the id for one it cannot name", () => {
    renderDialog();

    expect(screen.getByText("Linked Objectives (2)")).toBeInTheDocument();
    expect(screen.getByText("Grow revenue")).toBeInTheDocument();
    expect(screen.getByText("obj-unknown")).toBeInTheDocument();
  });

  it("hides the objectives block when none are linked and names the initiative after the requirement without an option", () => {
    renderDialog({ objectiveIds: [], selectedOption: undefined });

    expect(screen.queryByText(/Linked Objectives/)).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Initiative Name/ })).toHaveValue(REQUIREMENT);
  });

  it("switching a card off drops its relations; switching it back only restores those whose other end is kept", async () => {
    const { user } = renderDialog();

    await user.click(cardSwitch("Okta"));
    expect(screen.getByText("Cards to Create (1/2)")).toBeInTheDocument();
    expect(screen.getByText("Relations to Create (2/4)")).toBeInTheDocument();
    expect(relationSwitches()[1]).toBeDisabled();

    await user.click(cardSwitch("FraudShield"));
    expect(screen.getByText("Relations to Create (1/4)")).toBeInTheDocument();

    // FraudShield back on: its capability relation returns, the Okta one does not.
    await user.click(cardSwitch("FraudShield"));
    expect(screen.getByText("Relations to Create (2/4)")).toBeInTheDocument();
    const [r0, r1] = relationSwitches();
    expect(r0).toBeChecked();
    expect(r1).not.toBeChecked();

    await user.click(cardSwitch("Okta"));
    expect(screen.getByText("Relations to Create (3/4)")).toBeInTheDocument();
  });

  it("toggles a single relation", async () => {
    const { user } = renderDialog();

    await user.click(relationSwitches()[3]);
    expect(screen.getByText("Relations to Create (2/4)")).toBeInTheDocument();
    await user.click(relationSwitches()[3]);
    expect(screen.getByText("Relations to Create (3/4)")).toBeInTheDocument();
  });

  it("renames a card with Enter or save, discards with Escape or cancel, and only offers edit on kept cards", async () => {
    const { user } = renderDialog();
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(2);

    await user.click(within(rowOf("FraudShield")).getByRole("button", { name: "Edit" }));
    await user.type(screen.getByDisplayValue("FraudShield"), " Pro{Enter}");
    // The new name is used everywhere the card is named, relations included.
    expect(screen.getAllByText("FraudShield Pro").length).toBeGreaterThan(1);

    await user.click(within(rowOf("Okta")).getByRole("button", { name: "Edit" }));
    await user.type(screen.getByDisplayValue("Okta"), " SSO");
    await user.click(within(editingRow("Okta SSO")).getByRole("button", { name: "Save" }));
    expect(screen.getAllByText("Okta SSO").length).toBeGreaterThan(0);

    await user.click(within(rowOf("Okta SSO")).getByRole("button", { name: "Edit" }));
    await user.type(screen.getByDisplayValue("Okta SSO"), " X{Escape}");
    expect(screen.queryByText("Okta SSO X")).not.toBeInTheDocument();

    await user.click(within(rowOf("Okta SSO")).getByRole("button", { name: "Edit" }));
    await user.type(screen.getByDisplayValue("Okta SSO"), " Y");
    await user.click(within(editingRow("Okta SSO Y")).getByRole("button", { name: "Cancel" }));
    expect(screen.getAllByText("Okta SSO").length).toBeGreaterThan(0);

    await user.click(cardSwitch("Okta SSO"));
    expect(within(rowOf("Okta SSO")).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("requires a name and both dates before it can submit", async () => {
    const { user } = renderDialog();
    expect(submitButton()).toBeDisabled();

    setDate(/Start Date/, "2026-11-01");
    expect(submitButton()).toBeDisabled();
    setDate(/End Date/, "2027-03-31");
    expect(submitButton()).toBeEnabled();

    await user.clear(screen.getByRole("textbox", { name: /Initiative Name/ }));
    expect(submitButton()).toBeDisabled();
  });

  it("closes from Cancel and renders nothing while closed", async () => {
    const { user, onClose, rerender } = renderDialog();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <CommitInitiativeDialog
        open={false}
        onClose={onClose}
        assessmentId="as-1"
        requirement={REQUIREMENT}
        capabilityMapping={MAPPING}
        objectiveIds={[]}
      />,
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// Commit run
// ---------------------------------------------------------------------------

describe("CommitInitiativeDialog — commit run", () => {
  let run: TurboLensAnalysisRun;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    run = analysisRun({});
    mockApi.on("post", COMMIT, { run_id: "run-1" });
    mockApi.on("get", RUN, () => run);
  });

  it("posts the user's selection, follows the run's progress and links to the new initiative", async () => {
    const openSpy = installWindowOpen();
    const { user, onClose } = renderDialog();

    await user.click(within(rowOf("FraudShield")).getByRole("button", { name: "Edit" }));
    await user.type(screen.getByDisplayValue("FraudShield"), " Pro{Enter}");
    await user.click(relationSwitches()[3]);
    fillDates();
    await user.click(submitButton());

    expect(mockApi.callsOf("post", COMMIT)[0].body).toEqual({
      assessmentId: "as-1",
      initiativeName: "Buy a fraud platform",
      startDate: "2026-11-01",
      endDate: "2027-03-31",
      selectedCardIds: ["pc-app", "pc-itc"],
      selectedRelationIndices: [0, 1],
      objectiveIds: ["obj-1", "obj-unknown"],
      renamedCards: { "pc-app": "FraudShield Pro" },
    });
    // Before the first poll: the indeterminate bar and the opening step.
    expect(screen.getByText("Creating initiative...")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create Initiative$/ })).not.toBeInTheDocument();

    run = analysisRun({ results: progress("creating_cards", 1, 3, "FraudShield Pro") });
    await advancePoll();
    expect(screen.getByText("Creating cards (1/3)...")).toBeInTheDocument();
    expect(screen.getByText("FraudShield Pro")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "33");

    run = analysisRun({ results: progress("creating_relations", 2, 3) });
    await advancePoll();
    expect(screen.getByText("Creating relations...")).toBeInTheDocument();

    run = analysisRun({ results: progress("creating_adr", 3, 3) });
    await advancePoll();
    expect(screen.getByText("Creating ADR...")).toBeInTheDocument();

    run = analysisRun({ results: progress("linking_objectives", 3, 3) });
    await advancePoll();
    expect(screen.getByText("linking_objectives")).toBeInTheDocument();

    run = analysisRun({
      status: "completed",
      results: { initiative_id: "init-9", card_count: 2, relation_count: 2 },
    });
    await advancePoll();
    expect(screen.getByText("Initiative created successfully!")).toBeInTheDocument();
    expect(screen.getByText("2 new cards, 2 new relations")).toBeInTheDocument();

    // The run is finished: no further polling.
    const polls = mockApi.callsOf("get", RUN).length;
    await advancePoll();
    expect(mockApi.callsOf("get", RUN)).toHaveLength(polls);

    await user.click(screen.getByRole("button", { name: /Open Initiative/ }));
    expect(openSpy).toHaveBeenCalledWith("/cards/init-9", "_blank");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("omits renamedCards when nothing was renamed and shows the opening step until progress arrives", async () => {
    const { user } = renderDialog();
    fillDates();
    await user.click(submitButton());

    const body = mockApi.callsOf("post", COMMIT)[0].body as Record<string, unknown>;
    expect(body.renamedCards).toBeUndefined();
    expect(body.selectedRelationIndices).toEqual([0, 1, 3]);

    run = analysisRun({ results: progress("creating_initiative", 0, 3) });
    await advancePoll();
    expect(screen.getByText("Creating initiative...")).toBeInTheDocument();
  });

  it("closes without opening a tab when the finished run carries no initiative", async () => {
    const openSpy = installWindowOpen();
    const { user, onClose } = renderDialog();
    fillDates();
    await user.click(submitButton());

    run = analysisRun({ status: "completed", results: null });
    await advancePoll();
    expect(screen.getByText("Initiative created successfully!")).toBeInTheDocument();
    expect(screen.queryByText(/new card/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Open Initiative/ }));
    expect(openSpy).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("returns to the form with the run's error when the commit fails", async () => {
    const { user } = renderDialog();
    fillDates();
    await user.click(submitButton());

    run = analysisRun({ status: "failed", error_message: "Card type Objective is hidden" });
    await advancePoll();

    expect(screen.getByText("Card type Objective is hidden")).toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
    expect(screen.getByText("Cards to Create (2/2)")).toBeInTheDocument();
  });

  it("falls back to a generic message when a failed run gives no reason", async () => {
    const { user } = renderDialog();
    fillDates();
    await user.click(submitButton());

    run = analysisRun({ status: "failed" });
    await advancePoll();

    expect(screen.getByText("Failed to create initiative")).toBeInTheDocument();
  });

  it("rides out a failed poll and keeps polling", async () => {
    mockApi.fail("get", RUN, 503);
    const { user } = renderDialog();
    fillDates();
    await user.click(submitButton());

    await advancePoll();
    expect(screen.getByText("Creating initiative...")).toBeInTheDocument();

    run = analysisRun({ status: "completed", results: { initiative_id: "init-2", card_count: 1, relation_count: 0 } });
    mockApi.on("get", RUN, () => run);
    await advancePoll();
    expect(screen.getByText("Initiative created successfully!")).toBeInTheDocument();
  });

  it("shows the error and keeps the form when the commit request itself fails", async () => {
    mockApi.fail("post", COMMIT, 409);
    const { user } = renderDialog();
    fillDates();
    await user.click(submitButton());

    expect(await screen.findByText("POST /turbolens/architect/commit failed")).toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
    expect(mockApi.callsOf("get", RUN)).toHaveLength(0);
  });

  it("cannot be dismissed while the run is in flight, and stops polling once unmounted", async () => {
    const { user, onClose, unmount } = renderDialog();
    fillDates();
    await user.click(submitButton());

    // Escape on the dialog itself: pressed with focus on the page body, it
    // would never reach the dialog's handler and the check would prove nothing.
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();

    await advancePoll();
    const polls = mockApi.callsOf("get", RUN).length;
    expect(polls).toBe(1);
    unmount();
    await advancePoll();
    await advancePoll();
    expect(mockApi.callsOf("get", RUN)).toHaveLength(polls);
  });
});

// ---------------------------------------------------------------------------
// Form details
// ---------------------------------------------------------------------------

/** Every prop but the mapping, for a rerender. */
function dialogWith(mapping: CapabilityMappingResult, onClose = vi.fn()) {
  return (
    <CommitInitiativeDialog
      open
      onClose={onClose}
      assessmentId="as-1"
      requirement={REQUIREMENT}
      capabilityMapping={mapping}
      objectiveIds={["obj-1", "obj-unknown"]}
      selectedOption={OPTION}
    />
  );
}

/** The material-symbol ligatures rendered in a row, in order. */
function iconsIn(row: HTMLElement): string[] {
  return Array.from(row.querySelectorAll(".material-symbols-outlined")).map((i) => i.textContent ?? "");
}

describe("CommitInitiativeDialog — form details", () => {
  it("names the dialog, explains the objectives and starts without an error", () => {
    renderDialog();

    expect(within(screen.getByRole("dialog")).getByText("Create Initiative from Assessment")).toBeInTheDocument();
    expect(screen.getByText("These objectives will be linked to the new initiative.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("cuts a long option title or requirement to 200 characters for the initiative name", () => {
    const long = "x".repeat(150) + "y".repeat(100);
    const first = renderDialog({ selectedOption: { ...OPTION, title: long } });
    expect(screen.getByRole("textbox", { name: /Initiative Name/ })).toHaveValue(long.slice(0, 200));
    first.unmount();

    renderDialog({ selectedOption: undefined, requirement: long });
    expect(screen.getByRole("textbox", { name: /Initiative Name/ })).toHaveValue(long.slice(0, 200));
  });

  it("needs a start date even when the end date is set", () => {
    renderDialog();
    setDate(/End Date/, "2027-03-31");
    expect(submitButton()).toBeDisabled();
  });

  it("does not accept a name made only of spaces", async () => {
    const { user } = renderDialog();
    fillDates();
    const nameField = screen.getByRole("textbox", { name: /Initiative Name/ });
    await user.clear(nameField);
    await user.type(nameField, "   ");
    expect(submitButton()).toBeDisabled();
  });

  it("explains each card switch in its tooltip", async () => {
    const { user } = renderDialog();
    expect(within(rowOf("FraudShield")).getByLabelText("Disable this card and its relations")).toBeInTheDocument();

    await user.click(cardSwitch("FraudShield"));
    expect(within(rowOf("FraudShield")).getByLabelText("Enable this card and its relations")).toBeInTheDocument();
  });

  it("shows each card's type icon, and none for a type the metamodel does not know", () => {
    renderDialog({
      capabilityMapping: {
        ...MAPPING,
        proposedCards: [
          ...MAPPING.proposedCards,
          { id: "pc-widget", name: "Gizmo", cardTypeKey: "Widget", isNew: true },
        ],
      },
    });

    expect(iconsIn(rowOf("FraudShield"))).toEqual(["apps", "edit"]);
    expect(iconsIn(rowOf("Okta"))).toEqual(["memory", "edit"]);
    expect(iconsIn(rowOf("Gizmo"))).toEqual(["edit"]);
  });

  it("closes the inline editor after Enter and after Cancel", async () => {
    const { user } = renderDialog();

    await user.click(within(rowOf("FraudShield")).getByRole("button", { name: "Edit" }));
    await user.type(screen.getByDisplayValue("FraudShield"), " Pro{Enter}");
    expect(screen.queryByDisplayValue("FraudShield Pro")).not.toBeInTheDocument();
    expect(within(rowOf("FraudShield Pro")).getByRole("button", { name: "Edit" })).toBeInTheDocument();

    await user.click(within(rowOf("Okta")).getByRole("button", { name: "Edit" }));
    await user.type(screen.getByDisplayValue("Okta"), " Y");
    await user.click(within(editingRow("Okta Y")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByDisplayValue("Okta Y")).not.toBeInTheDocument();
    expect(within(rowOf("Okta")).getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("shows a relation's label as a chip", () => {
    renderDialog();
    const section = screen.getByText(/^Relations to Create/).parentElement as HTMLElement;
    expect(within(section).getByText("supports").closest(".MuiChip-root")).not.toBeNull();
  });

  it("has no relations section when nothing is to be related", () => {
    renderDialog({ capabilityMapping: { ...MAPPING, proposedRelations: [] } });
    expect(screen.getByText("Cards to Create (2/2)")).toBeInTheDocument();
    expect(screen.queryByText(/^Relations to Create/)).not.toBeInTheDocument();
  });

  it("names an unknown objective by its id when the mapping has no existing landscape", () => {
    renderDialog({
      capabilityMapping: { ...MAPPING, existingDependencies: undefined },
      objectiveIds: ["obj-x"],
    });
    expect(screen.getByText("obj-x")).toBeInTheDocument();
  });
});

describe("CommitInitiativeDialog — relation switches follow their cards", () => {
  it("disables a relation whose source card is switched off, and only those", async () => {
    const { user } = renderDialog();

    await user.click(cardSwitch("FraudShield"));
    const [r0, r1, r2, r3] = relationSwitches();
    expect(r0).toBeDisabled();
    expect(r1).toBeDisabled();
    expect(r2).toBeDisabled();
    expect(r3).toBeEnabled();
    expect(r3).toBeChecked();
  });

  it("does not bring back a relation whose source is still off when its target returns", async () => {
    const { user } = renderDialog();

    await user.click(cardSwitch("Okta"));
    await user.click(cardSwitch("FraudShield"));
    expect(screen.getByText("Relations to Create (1/4)")).toBeInTheDocument();

    await user.click(cardSwitch("Okta"));
    expect(screen.getByText("Relations to Create (1/4)")).toBeInTheDocument();
  });

  it("shows a relation switched off as unchecked", async () => {
    const { user } = renderDialog();

    await user.click(relationSwitches()[3]);
    expect(relationSwitches()[3]).not.toBeChecked();
    expect(relationSwitches()[3]).toBeEnabled();
  });

  it("starts over from a new mapping", () => {
    const { rerender } = renderDialog();
    expect(screen.getByText("Cards to Create (2/2)")).toBeInTheDocument();

    // Now Okta is the card switched off in phase 5, and "Switched Off" is back on.
    rerender(
      dialogWith({
        ...MAPPING,
        proposedCards: [
          MAPPING.proposedCards[0],
          { ...MAPPING.proposedCards[1], disabled: true },
          { ...MAPPING.proposedCards[2], disabled: false },
          MAPPING.proposedCards[3],
        ],
      }),
    );

    expect(screen.getByText("Cards to Create (2/2)")).toBeInTheDocument();
    expect(cardSwitch("Switched Off")).toBeChecked();
    expect(screen.queryByText("Okta", { selector: "p" })).not.toBeInTheDocument();
    expect(screen.getByText("Relations to Create (3/4)")).toBeInTheDocument();
    const [r0, r1, r2, r3] = relationSwitches();
    expect(r0).toBeChecked();
    expect(r1).not.toBeChecked();
    expect(r1).toBeDisabled();
    expect(r2).toBeChecked();
    expect(r2).toBeEnabled();
    expect(r3).toBeChecked();
  });
});

describe("CommitInitiativeDialog — commit run details", () => {
  let run: TurboLensAnalysisRun;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    run = analysisRun({});
    mockApi.on("post", COMMIT, { run_id: "run-1" });
    mockApi.on("get", RUN, () => run);
  });

  it("sends the initiative name without surrounding spaces", async () => {
    const { user } = renderDialog();
    const nameField = screen.getByRole("textbox", { name: /Initiative Name/ });
    await user.clear(nameField);
    await user.type(nameField, "  Fraud programme  ");
    fillDates();
    await user.click(submitButton());

    expect(mockApi.callsOf("post", COMMIT)[0].body).toMatchObject({ initiativeName: "Fraud programme" });
  });

  it("keeps the last progress when a poll brings none", async () => {
    const { user } = renderDialog();
    fillDates();
    await user.click(submitButton());

    run = analysisRun({ results: progress("creating_cards", 1, 3) });
    await advancePoll();
    expect(screen.getByText("Creating cards (1/3)...")).toBeInTheDocument();

    run = analysisRun({ results: { note: "still working" } });
    await advancePoll();
    expect(screen.getByText("Creating cards (1/3)...")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "33");
  });

  it("can be dismissed once the run has completed", async () => {
    const { user, onClose } = renderDialog();
    fillDates();
    await user.click(submitButton());

    run = analysisRun({ status: "completed", results: { initiative_id: "init-9", card_count: 2, relation_count: 3 } });
    await advancePoll();
    expect(screen.getByText("Initiative created successfully!")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stops polling once the run has failed", async () => {
    const { user } = renderDialog();
    fillDates();
    await user.click(submitButton());

    run = analysisRun({ status: "failed", error_message: "nope" });
    await advancePoll();
    expect(screen.getByText("nope")).toBeInTheDocument();
    const polls = mockApi.callsOf("get", RUN).length;

    await advancePoll();
    await advancePoll();
    expect(mockApi.callsOf("get", RUN)).toHaveLength(polls);
  });

  it("counts what was created in the singular and the plural", async () => {
    const { user } = renderDialog();
    fillDates();
    await user.click(submitButton());

    run = analysisRun({ status: "completed", results: { initiative_id: "init-9", card_count: 1, relation_count: 0 } });
    await advancePoll();
    expect(await screen.findByText("1 new card, 0 new relations")).toBeInTheDocument();
  });

  it("counts what was created in the user's language", async () => {
    const { user } = renderDialog();
    fillDates();
    await user.click(submitButton());

    try {
      await act(async () => {
        await i18n.changeLanguage("de");
      });
      run = analysisRun({ status: "completed", results: { initiative_id: "init-9", card_count: 2, relation_count: 1 } });
      await advancePoll();
      expect(await screen.findByText("2 neue Karten, 1 neue Beziehung")).toBeInTheDocument();
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });

  it("starts a retried commit from the opening step, not the failed run's progress", async () => {
    const { user } = renderDialog();
    fillDates();
    await user.click(submitButton());

    run = analysisRun({ results: progress("creating_cards", 1, 3) });
    await advancePoll();
    run = analysisRun({ status: "failed", error_message: "nope", results: progress("creating_cards", 1, 3) });
    await advancePoll();
    expect(screen.getByText("nope")).toBeInTheDocument();

    run = analysisRun({});
    await user.click(submitButton());
    expect(screen.getByText("Creating initiative...")).toBeInTheDocument();
    expect(screen.queryByText("Creating cards (1/3)...")).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  });
});
