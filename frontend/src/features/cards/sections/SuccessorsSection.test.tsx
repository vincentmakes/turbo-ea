/**
 * The Lineage section: predecessors and successors of a card through its
 * type's one successor relation type.
 *
 * The direction rule it encodes: "A succeeds B" is stored source=A,
 * target=B. So this card's SUCCESSORS are the rows where it is the target
 * and its PREDECESSORS the rows where it is the source — and adding one
 * must POST the pair the right way round.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

// The picker has its own tests; here it is a button that picks one fixed
// card and reports a typed search string.
vi.mock("@/components/CardPicker", () => ({
  default: ({
    onChange,
    onInputChange,
    excludeIds,
    label,
  }: {
    onChange: (v: { id: string; name: string; type: string } | null) => void;
    onInputChange?: (v: string) => void;
    excludeIds?: Iterable<string>;
    label?: string;
  }) => (
    <div>
      <span data-testid="picker-label">{label}</span>
      <span data-testid="picker-excludes">{[...(excludeIds ?? [])].join(",")}</span>
      <button
        type="button"
        data-testid="card-picker"
        onClick={() => {
          onInputChange?.("ERP Next");
          onChange({ id: "picked-1", name: "ERP Next", type: "Application" });
        }}
      >
        pick
      </button>
    </div>
  ),
}));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { renderWithProviders, userWith } from "@/test/render";
import {
  CARDS,
  CARD_IDS,
  CARD_TYPES,
  RELATION_TYPES,
  cardById,
  makeRelationType,
} from "@/test/fixtures/metamodel";
import type { Relation } from "@/types";
import SuccessorsSection from "./SuccessorsSection";

const SUCCESSOR_RT = makeRelationType({
  key: "relApplicationSuccessor",
  label: "succeeds",
  reverse_label: "is succeeded by",
  source_type_key: "Application",
  target_type_key: "Application",
});

const CARD = cardById(CARD_IDS.erp);
const RELATIONS_URL = `/relations?card_id=${CARD.id}&type=${SUCCESSOR_RT.key}`;

const RELATIONS: Relation[] = [
  // ERP Core succeeds ERP Legacy → ERP Legacy is a predecessor.
  {
    id: "rel-pred",
    type: SUCCESSOR_RT.key,
    source_id: CARD.id,
    target_id: CARD_IDS.erpArchived,
    source: { id: CARD.id, type: "Application", name: CARD.name },
    target: { id: CARD_IDS.erpArchived, type: "Application", name: "ERP Legacy" },
  },
  // CRM Cloud succeeds ERP Core → CRM Cloud is a successor.
  {
    id: "rel-succ",
    type: SUCCESSOR_RT.key,
    source_id: CARD_IDS.crm,
    target_id: CARD.id,
    source: { id: CARD_IDS.crm, type: "Application", name: "CRM Cloud" },
    target: { id: CARD.id, type: "Application", name: CARD.name },
  },
];

function renderSection(props: Partial<React.ComponentProps<typeof SuccessorsSection>> = {}, user = undefined as ReturnType<typeof userWith> | undefined) {
  return renderWithProviders(<SuccessorsSection card={CARD} {...props} />, {
    route: "/cards/here",
    routes: [{ path: "/cards/here" }, { path: "/cards/:id", element: <div>Navigated away</div> }],
    ...(user ? { user } : {}),
  });
}

beforeEach(() => {
  hookState.reset();
  withMetamodel(CARD_TYPES, [...RELATION_TYPES, SUCCESSOR_RT]);
  mockApi.reset();
  mockApi.on("get", RELATIONS_URL, RELATIONS);
  mockApi.on("post", "/relations", {});
  mockApi.on("delete", "/relations/*", {});
});

describe("SuccessorsSection", () => {
  it("lists predecessors and successors on the right side with a total chip", async () => {
    renderSection();
    expect(await screen.findByText("ERP Legacy")).toBeInTheDocument();
    expect(screen.getByText("Lineage")).toBeInTheDocument();

    const predecessors = screen.getByText("Predecessors").parentElement!.parentElement as HTMLElement;
    expect(within(predecessors).getByText("ERP Legacy")).toBeInTheDocument();
    expect(within(predecessors).queryByText("CRM Cloud")).not.toBeInTheDocument();

    const successors = screen.getByText("Successors").parentElement!.parentElement as HTMLElement;
    expect(within(successors).getByText("CRM Cloud")).toBeInTheDocument();
    // 1 + 1 → the header chip reads 2.
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows the two empty hints when nothing is linked", async () => {
    mockApi.on("get", RELATIONS_URL, []);
    renderSection();
    expect(await screen.findByText("No predecessors.")).toBeInTheDocument();
    expect(screen.getByText("No successors.")).toBeInTheDocument();
  });

  it("renders nothing for a type without lineage", () => {
    const { container } = renderSection({ card: CARDS.find((c) => c.type === "ITComponent")! });
    expect(container.querySelector(".MuiAccordion-root")).toBeNull();
    expect(mockApi.callsOf("get")).toHaveLength(0);
  });

  it("renders nothing when the metamodel has no successor relation type", () => {
    withMetamodel(CARD_TYPES, RELATION_TYPES);
    const { container } = renderSection();
    expect(container.querySelector(".MuiAccordion-root")).toBeNull();
  });

  it("navigates to the related card when its name is clicked", async () => {
    const { user } = renderSection();
    await user.click(await screen.findByText("CRM Cloud"));
    expect(await screen.findByText("Navigated away")).toBeInTheDocument();
  });

  it("adds a successor as source=picked, target=this card", async () => {
    const { user } = renderSection();
    await screen.findByText("ERP Legacy");
    await user.click(screen.getByRole("button", { name: /Add Successor/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Add Successor")).toBeInTheDocument();
    expect(within(dialog).getByTestId("picker-label")).toHaveTextContent("Search Application");
    // Self and every already-linked card are excluded from the picker.
    const excludes = within(dialog).getByTestId("picker-excludes").textContent!.split(",");
    expect(excludes).toEqual(expect.arrayContaining([CARD.id, CARD_IDS.crm, CARD_IDS.erpArchived]));

    const add = within(dialog).getByRole("button", { name: "Add" });
    expect(add).toBeDisabled();
    await user.click(within(dialog).getByTestId("card-picker"));
    await user.click(add);

    await waitFor(() => expect(mockApi.callsOf("post", "/relations")).toHaveLength(1));
    expect(mockApi.callsOf("post", "/relations")[0].body).toEqual({
      type: SUCCESSOR_RT.key,
      source_id: "picked-1",
      target_id: CARD.id,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("get", RELATIONS_URL)).toHaveLength(2);
  });

  it("adds a predecessor as source=this card, target=picked", async () => {
    const { user } = renderSection();
    await screen.findByText("ERP Legacy");
    await user.click(screen.getByRole("button", { name: /Add Predecessor/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByTestId("card-picker"));
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(mockApi.callsOf("post", "/relations")).toHaveLength(1));
    expect(mockApi.callsOf("post", "/relations")[0].body).toEqual({
      type: SUCCESSOR_RT.key,
      source_id: CARD.id,
      target_id: "picked-1",
    });
  });

  it("keeps the dialog open and shows the error when the add fails", async () => {
    mockApi.fail("post", "/relations", 409, "duplicate");
    const { user } = renderSection();
    await screen.findByText("ERP Legacy");
    await user.click(screen.getByRole("button", { name: /Add Successor/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByTestId("card-picker"));
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("POST /relations failed");
  });

  it("creates a new card of the same type and links it, seeded with the typed search", async () => {
    mockApi.on("post", "/cards", { id: "new-card", name: "ERP Next" });
    const { user } = renderSection();
    await screen.findByText("ERP Legacy");
    await user.click(screen.getByRole("button", { name: /Add Successor/ }));
    const dialog = await screen.findByRole("dialog");
    // Typing in the picker carries over into the quick-create name.
    await user.click(within(dialog).getByTestId("card-picker"));
    await user.click(within(dialog).getByRole("button", { name: /Create new Application/ }));
    expect(within(dialog).getByText("Create new Application as successor")).toBeInTheDocument();
    const name = within(dialog).getByLabelText("Name");
    expect(name).toHaveValue("ERP Next");
    await user.clear(name);
    await user.type(name, "ERP Next Gen");
    await user.click(within(dialog).getByRole("button", { name: "Create & Add" }));

    await waitFor(() => expect(mockApi.callsOf("post", "/relations")).toHaveLength(1));
    expect(mockApi.callsOf("post", "/cards")[0].body).toEqual({ type: "Application", name: "ERP Next Gen" });
    expect(mockApi.callsOf("post", "/relations")[0].body).toEqual({
      type: SUCCESSOR_RT.key,
      source_id: "new-card",
      target_id: CARD.id,
    });
  });

  it("goes back to search from the quick-create form, and Cancel closes it", async () => {
    const { user } = renderSection();
    await screen.findByText("ERP Legacy");
    await user.click(screen.getByRole("button", { name: /Add Predecessor/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Create new Application/ }));
    expect(within(dialog).getByText("Create new Application as predecessor")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Create & Add" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Back to search" }));
    expect(within(dialog).getByTestId("card-picker")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("post")).toHaveLength(0);
  });

  it("hides quick-create from a role that may not create the type", async () => {
    const { user } = renderSection({}, userWith("inventory.view", "relations.manage"));
    await screen.findByText("ERP Legacy");
    await user.click(screen.getByRole("button", { name: /Add Successor/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: /Create new Application/ })).not.toBeInTheDocument();
  });

  it("removes a relation from its row", async () => {
    const { user } = renderSection();
    await screen.findByText("ERP Legacy");
    const row = screen.getByText("ERP Legacy").closest("li") as HTMLElement;
    await user.click(within(row).getByTitle("Remove"));
    await waitFor(() => expect(mockApi.callsOf("delete", "/relations/rel-pred")).toHaveLength(1));
    expect(mockApi.callsOf("get", RELATIONS_URL)).toHaveLength(2);
  });

  it("offers no editing controls when the user cannot edit", async () => {
    renderSection({ canEdit: false });
    await screen.findByText("ERP Legacy");
    expect(screen.queryByRole("button", { name: /Add Successor/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add Predecessor/ })).not.toBeInTheDocument();
    expect(screen.queryByTitle("Remove")).not.toBeInTheDocument();
  });

  it("starts collapsed when configured so, and toggles on click", async () => {
    const { user } = renderSection({ initialExpanded: false });
    const summary = screen.getByRole("button", { name: /Lineage/ });
    expect(summary).toHaveAttribute("aria-expanded", "false");
    await user.click(summary);
    expect(summary).toHaveAttribute("aria-expanded", "true");
  });
});
