import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
