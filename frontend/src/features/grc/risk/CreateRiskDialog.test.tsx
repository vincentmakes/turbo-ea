/**
 * CreateRiskDialog — one form, two write paths: a manual `POST /risks` and
 * the promote-from-finding `POST /risks/promote/compliance/{id}`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Risk } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import { USERS } from "@/test/fixtures/metamodel";
import CreateRiskDialog from "./CreateRiskDialog";
import { emptySeed, type RiskDialogSeed } from "./riskDefaults";

const CREATED = { id: "risk-new", reference: "R-000042", title: "x" } as Risk;

/** A `<Select>` labelled only through its `<InputLabel>` is reached via its FormControl. */
function selectFor(label: string): HTMLElement {
  const labelEl = screen.getAllByText(label).find((el) => el.tagName === "LABEL") as HTMLElement;
  return within(labelEl.closest(".MuiFormControl-root") as HTMLElement).getByRole("combobox");
}

async function pick(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(selectFor(label));
  await user.click(await screen.findByRole("option", { name: option }));
}

function renderDialog(seed: RiskDialogSeed | null = emptySeed(), open = true) {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  const user = userEvent.setup();
  const view = render(<CreateRiskDialog open={open} seed={seed} onClose={onClose} onCreated={onCreated} />);
  return { onClose, onCreated, user, ...view };
}

beforeEach(() => {
  mockApi.reset();
  mockApi.on("get", "/users", USERS);
  mockApi.on("post", "/risks", CREATED);
  mockApi.on("post", "/risks/promote/compliance/*", CREATED);
});

describe("CreateRiskDialog — manual", () => {
  it("renders the manual title, seeds the defaults and loads the owner picker", async () => {
    const { user } = renderDialog();
    expect(screen.getByRole("heading", { name: "New risk" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(selectFor("Category")).toHaveTextContent("Operational");
    expect(selectFor("Probability")).toHaveTextContent("Medium");
    expect(selectFor("Impact")).toHaveTextContent("Medium");

    await waitFor(() => expect(mockApi.callsOf("get", "/users")).toHaveLength(1));
    const owner = screen.getByRole("combobox", { name: "Owner" });
    await user.click(owner);
    expect(await screen.findByRole("option", { name: "Test Admin (admin@test.local)" })).toBeInTheDocument();
  });

  it("refuses to submit without a title", async () => {
    const { user, onCreated } = renderDialog();
    await user.click(screen.getByRole("button", { name: "New risk" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Title *");
    expect(mockApi.callsOf("post")).toHaveLength(0);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("posts the form as a new risk with the seeded card ids and hands the risk back", async () => {
    const { user, onCreated } = renderDialog(emptySeed(["c1", "c2"]));
    expect(screen.getByText("2 affected cards")).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: /^Title/ }), "ERP outage");
    await user.type(screen.getByRole("textbox", { name: "Description" }), "The ERP can fall over.");
    await pick(user, "Category", "Security");
    await pick(user, "Probability", "Very high");
    await pick(user, "Impact", "Critical");

    const target = screen.getByLabelText("Target resolution date") as HTMLInputElement;
    fireEvent.focus(target);
    fireEvent.change(target, { target: { value: "2026-12-31" } });
    fireEvent.blur(target);

    await waitFor(() => expect(mockApi.callsOf("get", "/users")).toHaveLength(1));
    const owner = screen.getByRole("combobox", { name: "Owner" });
    await user.click(owner);
    await user.type(owner, "Member");
    await user.click(await screen.findByRole("option", { name: "Test Member (member@test.local)" }));

    await user.click(screen.getByRole("button", { name: "New risk" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(CREATED));
    expect(mockApi.callsOf("post", "/risks")[0].body).toEqual({
      title: "ERP outage",
      description: "The ERP can fall over.",
      category: "security",
      initial_probability: "very_high",
      initial_impact: "critical",
      target_resolution_date: "2026-12-31",
      owner_id: USERS[1].id,
      card_ids: ["c1", "c2"],
    });
  });

  it("sends null for an empty target date and owner", async () => {
    const { user } = renderDialog();
    await user.type(screen.getByRole("textbox", { name: /^Title/ }), "Minimal");
    await user.click(screen.getByRole("button", { name: "New risk" }));
    await waitFor(() => expect(mockApi.callsOf("post", "/risks")).toHaveLength(1));
    expect(mockApi.callsOf("post", "/risks")[0].body).toMatchObject({
      target_resolution_date: null,
      owner_id: null,
      card_ids: [],
    });
  });

  it("surfaces the API error and keeps the dialog open", async () => {
    mockApi.fail("post", "/risks", 400, "bad");
    const { user, onCreated } = renderDialog();
    await user.type(screen.getByRole("textbox", { name: /^Title/ }), "Broken");
    await user.click(screen.getByRole("button", { name: "New risk" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("POST /risks failed");
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "New risk" })).toBeEnabled();
  });

  it("renders an empty owner picker when the user list cannot be loaded", async () => {
    mockApi.fail("get", "/users");
    const { user } = renderDialog();
    await waitFor(() => expect(mockApi.callsOf("get", "/users")).toHaveLength(1));
    await user.click(screen.getByRole("combobox", { name: "Owner" }));
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  it("Cancel closes without posting", async () => {
    const { user, onClose } = renderDialog();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockApi.callsOf("post")).toHaveLength(0);
  });
});

describe("CreateRiskDialog — promote from a compliance finding", () => {
  const SEED: RiskDialogSeed = {
    mode: "compliance",
    findingId: "f1",
    title: "Art. 9: NexaCore ERP",
    description: "Risk management system required",
    category: "compliance",
    initial_probability: "high",
    initial_impact: "high",
    cardIds: ["c1"],
  };

  it("seeds the form from the finding and posts to the promote endpoint", async () => {
    const { user, onCreated } = renderDialog(SEED);
    expect(screen.getByRole("heading", { name: "Create risk from finding" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Identification: Compliance scan");
    expect(screen.getByText("1 affected card")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^Title/ })).toHaveValue("Art. 9: NexaCore ERP");
    expect(selectFor("Category")).toHaveTextContent("Compliance");
    expect(selectFor("Probability")).toHaveTextContent("High");

    await user.click(screen.getByRole("button", { name: "Create risk" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(CREATED));
    const call = mockApi.callsOf("post", "/risks/promote/compliance/f1")[0];
    expect(call.body).toEqual({
      title: "Art. 9: NexaCore ERP",
      description: "Risk management system required",
      category: "compliance",
      initial_probability: "high",
      initial_impact: "high",
      target_resolution_date: null,
      owner_id: null,
    });
    expect(mockApi.callsOf("post", "/risks")).toHaveLength(0);
  });

  it("re-seeds when the dialog reopens with a different finding", async () => {
    const { rerender } = renderDialog(SEED);
    rerender(<CreateRiskDialog open={false} seed={SEED} onClose={vi.fn()} onCreated={vi.fn()} />);
    const other = { ...SEED, findingId: "f2", title: "GDPR: Billing", cardIds: [] };
    rerender(<CreateRiskDialog open seed={other} onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(await screen.findByRole("textbox", { name: /^Title/ })).toHaveValue("GDPR: Billing");
    expect(screen.queryByText(/affected card/)).not.toBeInTheDocument();
  });
});

describe("CreateRiskDialog — without a seed", () => {
  it("opens as a blank manual form and posts its defaults with no cards", async () => {
    const { user, onCreated } = renderDialog(null);
    expect(screen.getByRole("heading", { name: "New risk" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/affected card/)).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^Title/ })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("");
    expect(selectFor("Category")).toHaveTextContent("Operational");
    expect(selectFor("Probability")).toHaveTextContent("Medium");
    expect(selectFor("Impact")).toHaveTextContent("Medium");
    expect(screen.getByLabelText("Target resolution date")).toHaveValue("");

    await user.type(screen.getByRole("textbox", { name: /^Title/ }), "Vendor lock-in");
    await user.click(screen.getByRole("button", { name: "New risk" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(CREATED));
    expect(mockApi.callsOf("post", "/risks")[0].body).toEqual({
      title: "Vendor lock-in",
      description: "",
      category: "operational",
      initial_probability: "medium",
      initial_impact: "medium",
      target_resolution_date: null,
      owner_id: null,
      card_ids: [],
    });
  });
});

describe("CreateRiskDialog — owner picker", () => {
  it("offers no owner before the user list has arrived", async () => {
    let release!: (users: typeof USERS) => void;
    mockApi.on("get", "/users", () => new Promise<typeof USERS>((r) => (release = r)));
    const { user } = renderDialog();
    await user.click(screen.getByRole("combobox", { name: "Owner" }));
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(screen.getByText("No options")).toBeInTheDocument();
    await act(async () => release(USERS));
    expect(await screen.findByRole("option", { name: "Test Admin (admin@test.local)" })).toBeInTheDocument();
  });

  it("shows and marks the picked owner, and sends null once it is cleared", async () => {
    const { user } = renderDialog();
    await waitFor(() => expect(mockApi.callsOf("get", "/users")).toHaveLength(1));
    const owner = screen.getByRole("combobox", { name: "Owner" });
    await user.click(owner);
    await user.click(await screen.findByRole("option", { name: "Test Member (member@test.local)" }));
    expect(owner).toHaveValue("Test Member (member@test.local)");

    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByRole("option", { name: "Test Member (member@test.local)" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("option", { name: "Test Admin (admin@test.local)" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    await user.keyboard("{Escape}");

    await user.clear(owner);
    await user.type(screen.getByRole("textbox", { name: /^Title/ }), "Shadow IT");
    await user.click(screen.getByRole("button", { name: "New risk" }));
    await waitFor(() => expect(mockApi.callsOf("post", "/risks")).toHaveLength(1));
    expect(mockApi.callsOf("post", "/risks")[0].body).toMatchObject({ owner_id: null });
  });
});

describe("CreateRiskDialog — submitting", () => {
  it("refuses a title made only of spaces", async () => {
    const { user } = renderDialog();
    await user.type(screen.getByRole("textbox", { name: /^Title/ }), "   ");
    await user.click(screen.getByRole("button", { name: "New risk" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Title *");
    expect(mockApi.callsOf("post")).toHaveLength(0);
  });

  it("locks the form while the request runs and clears an earlier error", async () => {
    let release!: (r: Risk) => void;
    mockApi.on("post", "/risks", () => new Promise<Risk>((r) => (release = r)));
    const { user, onCreated } = renderDialog();
    await user.click(screen.getByRole("button", { name: "New risk" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Title *");

    await user.type(screen.getByRole("textbox", { name: /^Title/ }), "ERP outage");
    await user.click(screen.getByRole("button", { name: "New risk" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "New risk" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: /^Title/ })).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await act(async () => release(CREATED));
    expect(onCreated).toHaveBeenCalledWith(CREATED);
    expect(screen.getByRole("button", { name: "New risk" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("posts a compliance seed without a finding as a plain risk", async () => {
    const seed: RiskDialogSeed = {
      mode: "compliance",
      title: "GDPR: Billing",
      description: "",
      category: "compliance",
      initial_probability: "high",
      initial_impact: "medium",
      cardIds: ["c7"],
    };
    const { user, onCreated } = renderDialog(seed);
    await user.click(screen.getByRole("button", { name: "Create risk" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(CREATED));
    expect(mockApi.callsOf("post", "/risks")[0].body).toMatchObject({ title: "GDPR: Billing", card_ids: ["c7"] });
    expect(mockApi.callsOf("post", /^\/risks\/promote/)).toHaveLength(0);
  });

  it("only promotes a finding when the dialog is in compliance mode", async () => {
    const { user, onCreated } = renderDialog({ ...emptySeed(), findingId: "f9" });
    await user.type(screen.getByRole("textbox", { name: /^Title/ }), "Manual risk");
    await user.click(screen.getByRole("button", { name: "New risk" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(CREATED));
    expect(mockApi.callsOf("post", "/risks")).toHaveLength(1);
    expect(mockApi.callsOf("post", /^\/risks\/promote/)).toHaveLength(0);
  });
});

describe("CreateRiskDialog — reopening", () => {
  it("forgets the owner and the error from the previous opening", async () => {
    const props = { onClose: vi.fn(), onCreated: vi.fn() };
    const seed = emptySeed();
    const user = userEvent.setup();
    const view = render(<CreateRiskDialog open seed={seed} {...props} />);
    await waitFor(() => expect(mockApi.callsOf("get", "/users")).toHaveLength(1));
    const owner = screen.getByRole("combobox", { name: "Owner" });
    await user.click(owner);
    await user.click(await screen.findByRole("option", { name: "Test Member (member@test.local)" }));
    await user.click(screen.getByRole("button", { name: "New risk" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Title *");

    view.rerender(<CreateRiskDialog open={false} seed={seed} {...props} />);
    view.rerender(<CreateRiskDialog open seed={seed} {...props} />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Owner" })).toHaveValue(""));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("retitles itself when reopened to promote a finding", () => {
    const props = { onClose: vi.fn(), onCreated: vi.fn() };
    const view = render(<CreateRiskDialog open seed={emptySeed()} {...props} />);
    expect(screen.getByRole("heading", { name: "New risk" })).toBeInTheDocument();
    view.rerender(
      <CreateRiskDialog
        open
        seed={{ ...emptySeed(), mode: "compliance", findingId: "f1", title: "Art. 9" }}
        {...props}
      />,
    );
    expect(screen.getByRole("heading", { name: "Create risk from finding" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create risk" })).toBeInTheDocument();
  });
});
