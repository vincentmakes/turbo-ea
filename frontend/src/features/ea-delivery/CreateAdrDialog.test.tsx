import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

// A CardPicker stand-in: one button that picks a fixed card, so the test can
// drive "card added" without the search autocomplete.
vi.mock("@/components/CardPicker", () => ({
  default: ({ onChange }: { onChange: (v: { id: string; name: string; type: string }) => void }) => (
    <button
      type="button"
      data-testid="card-picker"
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
});
