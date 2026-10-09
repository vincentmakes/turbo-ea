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
import { act, screen, waitFor, within } from "@testing-library/react";
import { useParams } from "react-router";

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
    enabled,
  }: {
    onChange: (v: { id: string; name: string; type: string } | null) => void;
    onInputChange?: (v: string) => void;
    excludeIds?: Iterable<string>;
    label?: string;
    enabled?: boolean;
  }) => (
    <div>
      <span data-testid="picker-label">{label}</span>
      <span data-testid="picker-enabled">{String(enabled)}</span>
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
import { renderWithProviders, userWith, wrapWithProviders } from "@/test/render";
import {
  CARDS,
  CARD_IDS,
  CARD_TYPES,
  RELATION_TYPES,
  cardById,
  makeRelationType,
} from "@/test/fixtures/metamodel";
import type { Card, Relation } from "@/types";
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
  it("shows a progress bar until the relations arrive", async () => {
    renderSection();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText("No predecessors.")).not.toBeInTheDocument();
    expect(await screen.findByText("ERP Legacy")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("lists predecessors and successors on the right side with a total chip", async () => {
    renderSection();
    expect(await screen.findByText("ERP Legacy")).toBeInTheDocument();
    expect(screen.getByText("Lineage")).toBeInTheDocument();
    // No error has happened, so no alert either.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    const predecessors = screen.getByText("Predecessors").parentElement!.parentElement as HTMLElement;
    expect(within(predecessors).getByText("ERP Legacy")).toBeInTheDocument();
    expect(within(predecessors).queryByText("CRM Cloud")).not.toBeInTheDocument();
    expect(within(screen.getByText("Predecessors").parentElement!).getByText("1")).toBeInTheDocument();

    const successors = screen.getByText("Successors").parentElement!.parentElement as HTMLElement;
    expect(within(successors).getByText("CRM Cloud")).toBeInTheDocument();
    expect(within(successors).queryByText("ERP Legacy")).not.toBeInTheDocument();
    expect(within(screen.getByText("Successors").parentElement!).getByText("1")).toBeInTheDocument();
    // 1 + 1 → the header chip reads 2.
    expect(within(screen.getByRole("button", { name: /Lineage/ })).getByText("2")).toBeInTheDocument();
    // Each row carries the card type's icon.
    expect(within(screen.getByText("ERP Legacy").closest("li")!).getByText("apps")).toBeInTheDocument();
    expect(within(screen.getByText("CRM Cloud").closest("li")!).getByText("apps")).toBeInTheDocument();
  });

  it("shows the two empty hints when nothing is linked", async () => {
    mockApi.on("get", RELATIONS_URL, []);
    renderSection();
    expect(await screen.findByText("No predecessors.")).toBeInTheDocument();
    expect(screen.getByText("No successors.")).toBeInTheDocument();
    // An empty lineage carries no count chip on the header.
    expect(within(screen.getByRole("button", { name: /Lineage/ })).queryByText("0")).not.toBeInTheDocument();
  });

  it("falls back to the related card's id when a relation carries no card names", async () => {
    mockApi.on("get", RELATIONS_URL, [
      { id: "rel-pred", type: SUCCESSOR_RT.key, source_id: CARD.id, target_id: CARD_IDS.erpArchived },
      { id: "rel-succ", type: SUCCESSOR_RT.key, source_id: CARD_IDS.crm, target_id: CARD.id },
    ]);
    renderSection();
    const predecessors = (await screen.findByText("Predecessors")).parentElement!.parentElement as HTMLElement;
    expect(await within(predecessors).findByText(CARD_IDS.erpArchived)).toBeInTheDocument();
    const successors = screen.getByText("Successors").parentElement!.parentElement as HTMLElement;
    expect(within(successors).getByText(CARD_IDS.crm)).toBeInTheDocument();
  });

  it("uses a generic icon for a type that has none", async () => {
    withMetamodel(
      CARD_TYPES.map((t) => (t.key === "Application" ? { ...t, icon: "" } : t)),
      [...RELATION_TYPES, SUCCESSOR_RT],
    );
    renderSection();
    const pred = (await screen.findByText("ERP Legacy")).closest("li") as HTMLElement;
    expect(within(pred).getByText("category")).toBeInTheDocument();
    expect(within(screen.getByText("CRM Cloud").closest("li")!).getByText("category")).toBeInTheDocument();
  });

  it("ends the progress bar and shows the error, not the empty hints, when the load fails", async () => {
    mockApi.fail("get", RELATIONS_URL, 500, "boom");
    renderSection();
    expect(await screen.findByRole("alert")).toHaveTextContent(`GET ${RELATIONS_URL} failed`);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    // An unknown lineage is not an empty one.
    expect(screen.queryByText("No predecessors.")).not.toBeInTheDocument();
    expect(screen.queryByText("No successors.")).not.toBeInTheDocument();
  });

  it("names a failed load that carries no message", async () => {
    mockApi.on("get", RELATIONS_URL, () => Promise.reject("boom"));
    renderSection();
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.queryByText("No predecessors.")).not.toBeInTheDocument();
  });

  it("drops a load error once the next card's lineage loads", async () => {
    const other = cardById(CARD_IDS.crm);
    const otherUrl = `/relations?card_id=${other.id}&type=${SUCCESSOR_RT.key}`;
    mockApi.fail("get", RELATIONS_URL, 500, "boom");
    mockApi.on("get", otherUrl, []);
    const { rerender } = renderWithProviders(<SuccessorsSection card={CARD} />);
    await screen.findByRole("alert");
    rerender(wrapWithProviders(<SuccessorsSection card={other} />));
    expect(await screen.findByText("No predecessors.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("re-reads the lineage when the card changes", async () => {
    const other = cardById(CARD_IDS.crm);
    const otherUrl = `/relations?card_id=${other.id}&type=${SUCCESSOR_RT.key}`;
    mockApi.on("get", otherUrl, []);
    const { rerender } = renderWithProviders(<SuccessorsSection card={CARD} />);
    expect(await screen.findByText("ERP Legacy")).toBeInTheDocument();
    rerender(wrapWithProviders(<SuccessorsSection card={other} />));
    expect(await screen.findByText("No predecessors.")).toBeInTheDocument();
    expect(mockApi.callsOf("get", otherUrl)).toHaveLength(1);
  });

  it("renders nothing for a card whose type is not in the metamodel", () => {
    const ghost = { ...CARD, type: "Ghost" } as Card;
    const { container } = renderSection({ card: ghost });
    expect(container.querySelector(".MuiAccordion-root")).toBeNull();
  });

  it("names the card type by its label in the picker", async () => {
    withMetamodel(
      CARD_TYPES.map((t) => (t.key === "Application" ? { ...t, label: "Software Application" } : t)),
      [...RELATION_TYPES, SUCCESSOR_RT],
    );
    const { user } = renderSection();
    await screen.findByText("ERP Legacy");
    await user.click(screen.getByRole("button", { name: /Add Successor/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTestId("picker-label")).toHaveTextContent("Search Software Application");
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

  it("opens the predecessor's or the successor's own page", async () => {
    function CardPage() {
      return <div>{`Card page ${useParams().id}`}</div>;
    }
    const routes = [{ path: "/cards/here" }, { path: "/cards/:id", element: <CardPage /> }];
    const first = renderWithProviders(<SuccessorsSection card={CARD} />, { route: "/cards/here", routes });
    await first.user.click(await screen.findByText("ERP Legacy"));
    expect(await screen.findByText(`Card page ${CARD_IDS.erpArchived}`)).toBeInTheDocument();
    first.unmount();

    const second = renderWithProviders(<SuccessorsSection card={CARD} />, { route: "/cards/here", routes });
    await second.user.click(await screen.findByText("CRM Cloud"));
    expect(await screen.findByText(`Card page ${CARD_IDS.crm}`)).toBeInTheDocument();
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
    expect(within(dialog).getByText("Add Predecessor")).toBeInTheDocument();
    expect(within(dialog).queryByText("Add Successor")).not.toBeInTheDocument();
    // The picker is told to fetch while the dialog is open.
    expect(within(dialog).getByTestId("picker-enabled")).toHaveTextContent("true");
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

  it("names a failure that carries no message, dismisses it, and clears it on a retry", async () => {
    mockApi.on("post", "/relations", () => Promise.reject("not an Error"));
    const { user } = renderSection();
    await screen.findByText("ERP Legacy");
    await user.click(screen.getByRole("button", { name: /Add Successor/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByTestId("card-picker"));
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("Failed to add relation");

    // The alert's own close button dismisses it.
    await user.click(within(alert).getByRole("button", { name: /close/i }));
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();

    // Fail again, then succeed: the retry starts from a clean slate.
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Failed to add relation");
    mockApi.on("post", "/relations", {});
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("drops an add error when the dialog is cancelled", async () => {
    mockApi.fail("post", "/relations", 409, "duplicate");
    const { user } = renderSection();
    await screen.findByText("ERP Legacy");
    await user.click(screen.getByRole("button", { name: /Add Successor/ }));
    let dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByTestId("card-picker"));
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("POST /relations failed");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // The abandoned add leaves nothing behind on the section…
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // …nor in the dialog when it is opened again.
    await user.click(screen.getByRole("button", { name: /Add Successor/ }));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("starts the dialog afresh after Cancel", async () => {
    const { user } = renderSection();
    await screen.findByText("ERP Legacy");
    await user.click(screen.getByRole("button", { name: /Add Successor/ }));
    let dialog = await screen.findByRole("dialog");
    // A pick (which also reports the typed search), then a switch to quick-create.
    await user.click(within(dialog).getByTestId("card-picker"));
    await user.click(within(dialog).getByRole("button", { name: /Create new Application/ }));
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Add Successor/ }));
    dialog = await screen.findByRole("dialog");
    // Back on the picker, with nothing picked …
    expect(within(dialog).getByTestId("card-picker")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Add" })).toBeDisabled();
    // … and no search left over to seed the quick-create name.
    await user.click(within(dialog).getByRole("button", { name: /Create new Application/ }));
    expect(within(dialog).getByLabelText("Name")).toHaveValue("");
  });

  it("offers quick-create to a role that may create the type", async () => {
    const { user } = renderSection({}, userWith("inventory.view", "inventory.create", "relations.manage"));
    await screen.findByText("ERP Legacy");
    await user.click(screen.getByRole("button", { name: /Add Successor/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /Create new Application/ })).toBeInTheDocument();
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
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("get", RELATIONS_URL)).toHaveLength(2);
  });

  it("quick-creates a predecessor with a trimmed name, linked as source=this card", async () => {
    mockApi.on("post", "/cards", { id: "new-card", name: "ERP Mainframe" });
    const { user } = renderSection();
    await screen.findByText("ERP Legacy");
    await user.click(screen.getByRole("button", { name: /Add Predecessor/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Create new Application/ }));
    await user.type(within(dialog).getByLabelText("Name"), "  ERP Mainframe  ");
    await user.click(within(dialog).getByRole("button", { name: "Create & Add" }));

    await waitFor(() => expect(mockApi.callsOf("post", "/relations")).toHaveLength(1));
    expect(mockApi.callsOf("post", "/cards")[0].body).toEqual({ type: "Application", name: "ERP Mainframe" });
    expect(mockApi.callsOf("post", "/relations")[0].body).toEqual({
      type: SUCCESSOR_RT.key,
      source_id: CARD.id,
      target_id: "new-card",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("get", RELATIONS_URL)).toHaveLength(2);
  });

  it("quick-creates on Enter, once, with the whole name", async () => {
    mockApi.on("post", "/cards", { id: "new-card", name: "ERP Next" });
    const { user } = renderSection();
    await screen.findByText("ERP Legacy");
    await user.click(screen.getByRole("button", { name: /Add Successor/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Create new Application/ }));
    await user.type(within(dialog).getByLabelText("Name"), "ERP Next{Enter}");
    await waitFor(() => expect(mockApi.callsOf("post", "/relations")).toHaveLength(1));
    expect(mockApi.callsOf("post", "/cards")).toHaveLength(1);
    expect(mockApi.callsOf("post", "/cards")[0].body).toEqual({ type: "Application", name: "ERP Next" });
  });

  it("refuses a blank quick-create name, by button and by Enter", async () => {
    const { user } = renderSection();
    await screen.findByText("ERP Legacy");
    await user.click(screen.getByRole("button", { name: /Add Successor/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Create new Application/ }));
    await user.type(within(dialog).getByLabelText("Name"), "   ");
    expect(within(dialog).getByRole("button", { name: "Create & Add" })).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Name"), "{Enter}");
    expect(mockApi.callsOf("post")).toHaveLength(0);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("disables quick-create while the card is being created", async () => {
    let release: (card: { id: string; name: string }) => void = () => {};
    mockApi.on(
      "post",
      "/cards",
      () => new Promise<{ id: string; name: string }>((resolve) => (release = resolve)),
    );
    const { user } = renderSection();
    await screen.findByText("ERP Legacy");
    await user.click(screen.getByRole("button", { name: /Add Successor/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Create new Application/ }));
    await user.type(within(dialog).getByLabelText("Name"), "ERP Next");
    await user.click(within(dialog).getByRole("button", { name: "Create & Add" }));

    await waitFor(() => expect(mockApi.callsOf("post", "/cards")).toHaveLength(1));
    expect(within(dialog).getByRole("button", { name: "Create & Add" })).toBeDisabled();
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();

    await act(async () => release({ id: "new-card", name: "ERP Next" }));
    await waitFor(() => expect(mockApi.callsOf("post", "/relations")).toHaveLength(1));
  });

  it("names a failed quick-create and lets the user try again", async () => {
    mockApi.on("post", "/cards", () => Promise.reject("not an Error"));
    const { user } = renderSection();
    await screen.findByText("ERP Legacy");
    await user.click(screen.getByRole("button", { name: /Add Successor/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Create new Application/ }));
    await user.type(within(dialog).getByLabelText("Name"), "ERP Next");
    await user.click(within(dialog).getByRole("button", { name: "Create & Add" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Failed to create card");
    expect(within(dialog).getByRole("button", { name: "Create & Add" })).toBeEnabled();
    expect(mockApi.callsOf("post", "/relations")).toHaveLength(0);
  });

  it("reports the server's message when a quick-create is refused", async () => {
    mockApi.fail("post", "/cards", 409, "duplicate");
    const { user } = renderSection();
    await screen.findByText("ERP Legacy");
    await user.click(screen.getByRole("button", { name: /Add Successor/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Create new Application/ }));
    await user.type(within(dialog).getByLabelText("Name"), "ERP Next");
    await user.click(within(dialog).getByRole("button", { name: "Create & Add" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("POST /cards failed");
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

  it("removes a successor from its row", async () => {
    const { user } = renderSection();
    await screen.findByText("CRM Cloud");
    const row = screen.getByText("CRM Cloud").closest("li") as HTMLElement;
    await user.click(within(row).getByTitle("Remove"));
    await waitFor(() => expect(mockApi.callsOf("delete", "/relations/rel-succ")).toHaveLength(1));
    expect(mockApi.callsOf("delete")).toHaveLength(1);
  });

  it("shows the error when a remove fails and keeps the row", async () => {
    mockApi.fail("delete", "/relations/*", 500);
    const { user } = renderSection();
    await screen.findByText("ERP Legacy");
    const row = screen.getByText("ERP Legacy").closest("li") as HTMLElement;
    await user.click(within(row).getByTitle("Remove"));
    expect(await screen.findByRole("alert")).toHaveTextContent("DELETE /relations/rel-pred failed");
    expect(screen.getByText("ERP Legacy")).toBeInTheDocument();
    expect(mockApi.callsOf("get", RELATIONS_URL)).toHaveLength(1);
  });

  it("names a failed remove that carries no message", async () => {
    mockApi.on("delete", "/relations/*", () => Promise.reject("not an Error"));
    const { user } = renderSection();
    await screen.findByText("CRM Cloud");
    const row = screen.getByText("CRM Cloud").closest("li") as HTMLElement;
    await user.click(within(row).getByTitle("Remove"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("clears a failed remove's error once a remove succeeds", async () => {
    mockApi.fail("delete", "/relations/*", 500);
    const { user } = renderSection();
    await screen.findByText("ERP Legacy");
    const row = screen.getByText("ERP Legacy").closest("li") as HTMLElement;
    await user.click(within(row).getByTitle("Remove"));
    expect(await screen.findByRole("alert")).toHaveTextContent("DELETE /relations/rel-pred failed");

    mockApi.on("delete", "/relations/*", {});
    await user.click(within(row).getByTitle("Remove"));
    await waitFor(() => expect(mockApi.callsOf("delete", "/relations/rel-pred")).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("shows no error while the lineage loads after the relation types arrive", async () => {
    // The section first renders before the metamodel carries the successor
    // relation type, then loads the lineage once it does.
    withMetamodel(CARD_TYPES, RELATION_TYPES);
    let release!: (rels: Relation[]) => void;
    mockApi.on(
      "get",
      RELATIONS_URL,
      () => new Promise<Relation[]>((resolve) => (release = resolve)),
    );
    const { rerender } = renderWithProviders(<SuccessorsSection card={CARD} />);

    withMetamodel(CARD_TYPES, [...RELATION_TYPES, SUCCESSOR_RT]);
    rerender(wrapWithProviders(<SuccessorsSection card={CARD} />));
    await waitFor(() => expect(mockApi.callsOf("get", RELATIONS_URL)).toHaveLength(1));
    expect(screen.getByRole("button", { name: /Lineage/ })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Still loading: a progress bar, not the empty hints of a list not yet read.
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText("No predecessors.")).not.toBeInTheDocument();
    expect(screen.queryByText("No successors.")).not.toBeInTheDocument();

    await act(async () => release(RELATIONS));
    expect(await screen.findByText("ERP Legacy")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
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
