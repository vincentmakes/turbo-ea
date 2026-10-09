import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, createTheme } from "@mui/material/styles";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

// A CardPicker stand-in: one button that picks a fixed card, so the test can
// drive "card added" without the search autocomplete. It echoes the ids it is
// told to exclude and its placeholder, so the test can see what it was given.
vi.mock("@/components/CardPicker", () => ({
  default: ({
    onChange,
    excludeIds,
    placeholder,
  }: {
    onChange: (v: { id: string; name: string; type: string }) => void;
    excludeIds?: Set<string>;
    placeholder?: string;
  }) => (
    <button
      type="button"
      data-testid="card-picker"
      data-exclude={[...(excludeIds ?? [])].join(",")}
      data-placeholder={placeholder}
      onClick={() => onChange({ id: "card-1", name: "NexaCore ERP", type: "Application" })}
    >
      pick
    </button>
  ),
}));

import { mockApi } from "@/test/apiMock";
import type { ArchitectureDecision } from "@/types";
import CreateAdrDialog from "./CreateAdrDialog";

const CREATED: ArchitectureDecision = {
  id: "adr-9",
  reference_number: "ADR-0009",
  title: "Adopt event bus",
  status: "draft",
  context: null,
  decision: null,
  consequences: null,
  alternatives_considered: null,
  related_decisions: [],
  created_by: null,
  signatories: [],
  signed_at: null,
  revision_number: 1,
  parent_id: null,
  linked_cards: [],
  created_at: null,
  updated_at: null,
};

const INITIATIVE = { id: "init-1", name: "Cloud Migration", type: "Initiative" };

function renderDialog(props: Partial<React.ComponentProps<typeof CreateAdrDialog>> = {}) {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  const utils = render(<CreateAdrDialog open onClose={onClose} onCreated={onCreated} {...props} />);
  return { ...utils, onClose, onCreated };
}

beforeEach(() => {
  mockApi.reset();
  mockApi.on("post", "/adr", (_path, body) => ({ ...CREATED, ...(body as object) }));
  mockApi.on("post", /^\/adr\/adr-9\/cards$/, { ok: true });
});

describe("CreateAdrDialog", () => {
  it("renders the title field and the pre-linked cards as removable chips", async () => {
    const user = userEvent.setup();
    renderDialog({ preLinkedCards: [INITIATIVE] });

    expect(screen.getByText("New Architecture Decision")).toBeInTheDocument();
    expect(screen.getByLabelText("Decision title")).toBeInTheDocument();
    expect(screen.getByText("Linked Cards")).toBeInTheDocument();
    expect(screen.getByText("Cloud Migration")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    // Opening clears the error: nothing to report yet.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // The chip's delete icon removes the card.
    const chip = screen.getByText("Cloud Migration").closest(".MuiChip-root");
    if (!chip) throw new Error("chip not rendered");
    await user.click(chip.querySelector(".MuiChip-deleteIcon") as Element);
    expect(screen.queryByText("Cloud Migration")).not.toBeInTheDocument();
  });

  it("creates the decision, then links every card in turn, and closes", async () => {
    const user = userEvent.setup();
    const { onClose, onCreated } = renderDialog({ preLinkedCards: [INITIATIVE] });

    await user.type(screen.getByLabelText("Decision title"), "  Adopt event bus ");

    // Add Card swaps the button for the picker; picking adds a chip and hides it again.
    await user.click(screen.getByRole("button", { name: /Add Card$/ }));
    expect(screen.queryByRole("button", { name: /Add Card$/ })).not.toBeInTheDocument();
    await user.click(screen.getByTestId("card-picker"));
    expect(screen.getByText("NexaCore ERP")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add Card$/ })).toBeInTheDocument();

    // Picking the same card twice is a no-op.
    await user.click(screen.getByRole("button", { name: /Add Card$/ }));
    await user.click(screen.getByTestId("card-picker"));
    expect(screen.getAllByText("NexaCore ERP")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mockApi.callsOf("post", "/adr")[0].body).toEqual({ title: "Adopt event bus" });
    const links = mockApi.callsOf("post", /^\/adr\/adr-9\/cards$/);
    expect(links.map((c) => c.body)).toEqual([{ card_id: "init-1" }, { card_id: "card-1" }]);
    expect(onCreated.mock.calls[0][0]).toMatchObject({ id: "adr-9" });
    expect(onClose).toHaveBeenCalledTimes(1);
    // A successful create leaves no error behind.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("submits on Enter with no linked cards", async () => {
    const user = userEvent.setup();
    const { onCreated } = renderDialog();

    await user.type(screen.getByLabelText("Decision title"), "Quick one{Enter}");

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mockApi.callsOf("post", "/adr")).toHaveLength(1);
    expect(mockApi.callsOf("post", /\/cards$/)).toHaveLength(0);
  });

  it("shows a dismissible error when the request fails and stays open", async () => {
    mockApi.fail("post", "/adr", 500);
    const user = userEvent.setup();
    const { onClose, onCreated } = renderDialog();

    await user.type(screen.getByLabelText("Decision title"), "Doomed");
    await user.click(screen.getByRole("button", { name: "Create" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Failed to create architecture decision");
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    // The request is over: Create is back, enabled, for a retry.
    expect(screen.getByRole("button", { name: "Create" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("Cancel calls onClose and reopening resets the form", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(<CreateAdrDialog open onClose={onClose} onCreated={vi.fn()} />);

    await user.type(screen.getByLabelText("Decision title"), "Typed");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<CreateAdrDialog open={false} onClose={onClose} onCreated={vi.fn()} />);
    rerender(<CreateAdrDialog open onClose={onClose} onCreated={vi.fn()} />);
    expect(screen.getByLabelText("Decision title")).toHaveValue("");
  });

  it("paints an empty, idle form before any effect runs", () => {
    // MUI portals render nothing on the server; keep the dialog inline.
    const theme = createTheme({ components: { MuiModal: { defaultProps: { disablePortal: true } } } });
    const html = renderToStaticMarkup(
      <ThemeProvider theme={theme}>
        <CreateAdrDialog open onClose={vi.fn()} onCreated={vi.fn()} />
      </ThemeProvider>,
    );
    const host = document.createElement("div");
    host.innerHTML = html;
    expect(within(host).queryByText("New Architecture Decision")).not.toBeNull();
    expect(host.querySelector("input")).toHaveValue("");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(within(host).queryByText("Add Card")).not.toBeNull();
    expect(within(host).queryByTestId("card-picker")).toBeNull();
    expect(within(host).queryByText("Create")).not.toBeNull();
    expect(within(host).queryByText("Creating...")).toBeNull();
  });

  it("removes only the chip whose delete icon was clicked", async () => {
    const user = userEvent.setup();
    renderDialog({
      preLinkedCards: [INITIATIVE, { id: "app-2", name: "Billing Hub", type: "Application" }],
    });

    const chip = screen.getByText("Billing Hub").closest(".MuiChip-root");
    if (!chip) throw new Error("chip not rendered");
    await user.click(chip.querySelector(".MuiChip-deleteIcon") as Element);

    expect(screen.queryByText("Billing Hub")).not.toBeInTheDocument();
    expect(screen.getByText("Cloud Migration")).toBeInTheDocument();
  });

  it("hands the picker the linked card ids to exclude and its placeholder", async () => {
    const user = userEvent.setup();
    renderDialog({ preLinkedCards: [INITIATIVE] });

    await user.click(screen.getByRole("button", { name: /Add Card$/ }));
    const picker = screen.getByTestId("card-picker");
    expect(picker).toHaveAttribute("data-exclude", "init-1");
    expect(picker).toHaveAttribute("data-placeholder", "Search cards...");
  });

  it("keeps Create disabled for a whitespace-only title", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText("Decision title"), "   ");
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("shows Creating... and disables the button while the request is in flight", async () => {
    let release: (v: ArchitectureDecision) => void = () => {};
    mockApi.on(
      "post",
      "/adr",
      () => new Promise<ArchitectureDecision>((resolve) => (release = resolve)),
    );
    const user = userEvent.setup();
    const { onCreated } = renderDialog();

    await user.type(screen.getByLabelText("Decision title"), "Slow one");
    await user.click(screen.getByRole("button", { name: "Create" }));

    const busy = await screen.findByRole("button", { name: "Creating..." });
    expect(busy).toBeDisabled();

    release(CREATED);
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  });

  it("cannot be left while the decision itself is being created, so nothing appears after a cancel", async () => {
    let release: (v: ArchitectureDecision) => void = () => {};
    mockApi.on(
      "post",
      "/adr",
      () => new Promise<ArchitectureDecision>((resolve) => (release = resolve)),
    );
    const user = userEvent.setup();
    const { onCreated, onClose } = renderDialog();

    await user.type(screen.getByLabelText("Decision title"), "Slow one");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByRole("button", { name: "Creating..." });

    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();

    // Once the decision exists the dialog finishes as usual: the parent hears about it once.
    release(CREATED);
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("can be cancelled again once a failed create has answered", async () => {
    let reject: (e: Error) => void = () => {};
    mockApi.on("post", "/adr", () => new Promise<ArchitectureDecision>((_resolve, r) => (reject = r)));
    const user = userEvent.setup();
    const { onCreated, onClose } = renderDialog();

    await user.type(screen.getByLabelText("Decision title"), "Slow one");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByRole("button", { name: "Creating..." });
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    reject(new Error("boom"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to create architecture decision");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("clears the previous error as soon as a retry starts", async () => {
    mockApi.fail("post", "/adr", 500);
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText("Decision title"), "Second try");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    let release: (v: ArchitectureDecision) => void = () => {};
    mockApi.on(
      "post",
      "/adr",
      () => new Promise<ArchitectureDecision>((resolve) => (release = resolve)),
    );
    await user.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByRole("button", { name: "Creating..." });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    release(CREATED);
    await waitFor(() => expect(screen.getByRole("button", { name: "Create" })).toBeEnabled());
  });

  it("reopening shows the new pre-linked cards, not the previous ones", () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    const { rerender } = render(
      <CreateAdrDialog open onClose={onClose} onCreated={onCreated} preLinkedCards={[INITIATIVE]} />,
    );
    expect(screen.getByText("Cloud Migration")).toBeInTheDocument();

    const next = [{ id: "init-2", name: "Data Platform", type: "Initiative" }];
    rerender(
      <CreateAdrDialog open={false} onClose={onClose} onCreated={onCreated} preLinkedCards={next} />,
    );
    rerender(<CreateAdrDialog open onClose={onClose} onCreated={onCreated} preLinkedCards={next} />);

    expect(screen.getByText("Data Platform")).toBeInTheDocument();
    expect(screen.queryByText("Cloud Migration")).not.toBeInTheDocument();
  });

  it("does not wipe the form while the dialog animates closed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onCreated = vi.fn();
    const { rerender } = render(<CreateAdrDialog open onClose={onClose} onCreated={onCreated} />);

    await user.type(screen.getByLabelText("Decision title"), "Half typed");
    rerender(<CreateAdrDialog open={false} onClose={onClose} onCreated={onCreated} />);

    // The exit transition still shows the form; the reset is for the next open.
    expect(screen.getByLabelText("Decision title")).toHaveValue("Half typed");
  });
});

describe("CreateAdrDialog — a link fails after the decision was created", () => {
  /** Linking card-1 fails `times` times, then succeeds; every other link succeeds. */
  function failLinkOf(cardId: string, times: number) {
    let left = times;
    mockApi.on("post", "/adr/adr-9/cards", (_path, body) => {
      if ((body as { card_id: string }).card_id === cardId && left > 0) {
        left -= 1;
        throw new Error("link refused");
      }
      return { ok: true };
    });
  }

  async function createWithTwoCards() {
    const user = userEvent.setup();
    const handlers = renderDialog({ preLinkedCards: [INITIATIVE] });
    await user.type(screen.getByLabelText("Decision title"), "Adopt event bus");
    await user.click(screen.getByRole("button", { name: /Add Card$/ }));
    await user.click(screen.getByTestId("card-picker"));
    await user.click(screen.getByRole("button", { name: "Create" }));
    return { user, ...handlers };
  }

  const linkCalls = () =>
    mockApi.callsOf("post", "/adr/adr-9/cards").map((c) => (c.body as { card_id: string }).card_id);

  it("says the decision exists and names the card it could not link, and stays open", async () => {
    failLinkOf("init-1", 1);
    const { onCreated, onClose } = await createWithTwoCards();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "The decision was created, but these cards could not be linked: Cloud Migration.",
    );
    expect(alert).not.toHaveTextContent("Failed to create architecture decision");
    // One failure does not stop the rest of the links.
    expect(linkCalls()).toEqual(["init-1", "card-1"]);
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // The title belongs to a decision that now exists: it can no longer be edited here.
    expect(screen.getByLabelText("Decision title")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create" })).toBeEnabled();
  });

  it("names every card it could not link, separated by commas", async () => {
    mockApi.on("post", "/adr/adr-9/cards", () => {
      throw new Error("link refused");
    });
    await createWithTwoCards();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The decision was created, but these cards could not be linked: Cloud Migration, NexaCore ERP.",
    );
  });

  it("links the pre-linked cards to the next decision after it is reopened", async () => {
    failLinkOf("card-1", 1);
    const { user, onClose, onCreated, rerender } = await createWithTwoCards();
    await screen.findByRole("alert");
    expect(linkCalls()).toEqual(["init-1", "card-1"]);

    const props = { onClose, onCreated, preLinkedCards: [INITIATIVE] };
    rerender(<CreateAdrDialog open={false} {...props} />);
    rerender(<CreateAdrDialog open {...props} />);
    await waitFor(() => expect(screen.getByLabelText("Decision title")).toHaveValue(""));

    // Nothing is linked to the new decision yet, so its card can still be removed.
    const chip = screen.getByText("Cloud Migration").closest(".MuiChip-root") as HTMLElement;
    expect(within(chip).getByTestId("CancelIcon")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Decision title"), "Second");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mockApi.callsOf("post", "/adr")).toHaveLength(2);
    expect(linkCalls()).toEqual(["init-1", "card-1", "init-1"]);
  });

  it("retries only the missing link, never a second decision, then finishes", async () => {
    failLinkOf("card-1", 1);
    const { user, onCreated, onClose } = await createWithTwoCards();
    expect(await screen.findByRole("alert")).toHaveTextContent("NexaCore ERP");

    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mockApi.callsOf("post", "/adr")).toHaveLength(1);
    expect(linkCalls()).toEqual(["init-1", "card-1", "card-1"]);
    expect(onCreated.mock.calls[0][0]).toMatchObject({ id: "adr-9" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("finishes without the failed card once it is removed", async () => {
    failLinkOf("card-1", 5);
    const { user, onCreated } = await createWithTwoCards();
    await screen.findByRole("alert");

    // A card already linked to the decision cannot be removed from it here.
    const linked = screen.getByText("Cloud Migration").closest(".MuiChip-root") as HTMLElement;
    expect(within(linked).queryByTestId("CancelIcon")).not.toBeInTheDocument();

    const failed = screen.getByText("NexaCore ERP").closest(".MuiChip-root") as HTMLElement;
    await user.click(within(failed).getByTestId("CancelIcon"));
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mockApi.callsOf("post", "/adr")).toHaveLength(1);
    expect(linkCalls()).toEqual(["init-1", "card-1"]);
  });

  it("hands the created decision to the parent on Cancel, so its list shows it", async () => {
    failLinkOf("init-1", 1);
    const { user, onCreated, onClose } = await createWithTwoCards();
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated.mock.calls[0][0]).toMatchObject({ id: "adr-9" });
    expect(onClose).toHaveBeenCalledTimes(1);
    // Nothing is created or linked again on the way out.
    expect(mockApi.callsOf("post", "/adr")).toHaveLength(1);
    expect(linkCalls()).toEqual(["init-1", "card-1"]);
  });

  it("hands the created decision to the parent when dismissed with Escape", async () => {
    failLinkOf("card-1", 1);
    const { user, onCreated, onClose } = await createWithTwoCards();
    await screen.findByRole("alert");

    await user.keyboard("{Escape}");
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated.mock.calls[0][0]).toMatchObject({ id: "adr-9" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reports the decision once when cancelled while its links are still in flight", async () => {
    let release!: () => void;
    mockApi.on(
      "post",
      "/adr/adr-9/cards",
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true });
        }),
    );
    const user = userEvent.setup();
    const { onCreated, onClose } = renderDialog({ preLinkedCards: [INITIATIVE] });
    await user.type(screen.getByLabelText("Decision title"), "Adopt event bus");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(linkCalls()).toEqual(["init-1"]));

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    release();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("reports each decision when the dialog is reopened for another one", async () => {
    const user = userEvent.setup();
    const props = { onClose: vi.fn(), onCreated: vi.fn() };
    const { rerender } = render(<CreateAdrDialog open {...props} />);
    await user.type(screen.getByLabelText("Decision title"), "First");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(props.onCreated).toHaveBeenCalledTimes(1));

    rerender(<CreateAdrDialog open={false} {...props} />);
    rerender(<CreateAdrDialog open {...props} />);
    await waitFor(() => expect(screen.getByLabelText("Decision title")).toHaveValue(""));
    await user.type(screen.getByLabelText("Decision title"), "Second");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(props.onCreated).toHaveBeenCalledTimes(2));
    expect(props.onCreated.mock.calls[1][0]).toMatchObject({ title: "Second" });
  });

  it("reports no decision on Cancel when the create itself failed", async () => {
    mockApi.fail("post", "/adr", 500, "boom");
    const { user, onCreated, onClose } = await createWithTwoCards();
    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to create architecture decision");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh decision when it is reopened", async () => {
    failLinkOf("card-1", 1);
    const user = userEvent.setup();
    const props = { onClose: vi.fn(), onCreated: vi.fn() };
    const { rerender } = render(<CreateAdrDialog open {...props} />);
    await user.type(screen.getByLabelText("Decision title"), "First");
    await user.click(screen.getByRole("button", { name: /Add Card$/ }));
    await user.click(screen.getByTestId("card-picker"));
    await user.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByRole("alert");

    rerender(<CreateAdrDialog open={false} {...props} />);
    rerender(<CreateAdrDialog open {...props} />);
    expect(screen.getByLabelText("Decision title")).toBeEnabled();
    await user.type(screen.getByLabelText("Decision title"), "Second");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(props.onCreated).toHaveBeenCalledTimes(1));
    expect(mockApi.callsOf("post", "/adr").map((c) => c.body)).toEqual([
      { title: "First" },
      { title: "Second" },
    ]);
  });
});
