import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { api } from "@/api/client";
import type { CardOption } from "@/components/CardPicker";

// ---- Mocks -------------------------------------------------------------

vi.mock("@/api/client", () => ({
  api: { post: vi.fn(), patch: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

vi.mock("@/hooks/useComplianceRegulations", () => ({
  useComplianceRegulations: () => ({
    enabled: [{ key: "eu_ai_act", label: "EU AI Act", is_enabled: true }],
  }),
}));

// A lightweight CardPicker stand-in: a button that selects a fixed card, so
// tests can drive the "card selected" state without the search autocomplete.
vi.mock("@/components/CardPicker", () => ({
  default: ({
    value,
    onChange,
  }: {
    value: CardOption | null;
    onChange: (v: CardOption | null) => void;
  }) => (
    <button
      type="button"
      data-testid="card-picker"
      onClick={() =>
        onChange({ id: "card-1", name: "NexaCore ERP", type: "Application" })
      }
    >
      {value ? value.name : "pick a card"}
    </button>
  ),
}));

import CreateComplianceFindingDialog from "./CreateComplianceFindingDialog";

const post = vi.mocked(api.post);
const patch = vi.mocked(api.patch);

beforeEach(() => {
  post.mockReset();
  patch.mockReset();
  post.mockResolvedValue({ id: "finding-1" } as never);
  patch.mockResolvedValue({ id: "finding-1" } as never);
});

function renderCreate(props: Partial<Record<string, unknown>> = {}) {
  return render(
    <CreateComplianceFindingDialog
      open
      onClose={vi.fn()}
      onSaved={vi.fn()}
      {...props}
    />,
  );
}

describe("CreateComplianceFindingDialog scope", () => {
  it("defaults to card scope and blocks submit with no card selected", async () => {
    const user = userEvent.setup();
    renderCreate();

    // Card scope is the default; the picker is shown.
    expect(screen.getByRole("radio", { name: "A specific card" })).toBeChecked();
    expect(screen.getByTestId("card-picker")).toBeInTheDocument();

    await user.type(
      screen.getByRole("textbox", { name: /Requirement/i }),
      "Log AI system in the register",
    );
    await user.click(screen.getByRole("button", { name: "Create" }));

    // Validation error surfaced, nothing sent.
    expect(
      screen.getByText(/Select a card, or choose/i),
    ).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("submits a card-scoped finding once a card is picked", async () => {
    const user = userEvent.setup();
    renderCreate();

    await user.type(
      screen.getByRole("textbox", { name: /Requirement/i }),
      "Log AI system in the register",
    );
    await user.click(screen.getByTestId("card-picker"));
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [, body] = post.mock.calls[0];
    expect((body as { card_id: string | null }).card_id).toBe("card-1");
  });

  it("hides the picker and sends a null card for landscape scope", async () => {
    const user = userEvent.setup();
    renderCreate();

    await user.click(
      screen.getByRole("radio", { name: "The whole landscape" }),
    );
    // Picker disappears in landscape scope.
    expect(screen.queryByTestId("card-picker")).not.toBeInTheDocument();

    await user.type(
      screen.getByRole("textbox", { name: /Requirement/i }),
      "No estate-wide AI incident-reporting procedure",
    );
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [, body] = post.mock.calls[0];
    expect((body as { card_id: string | null }).card_id).toBeNull();
  });

  it("prefills landscape scope when editing a card-less finding", () => {
    renderCreate({
      finding: {
        id: "f1",
        regulation: "eu_ai_act",
        regulation_article: null,
        card_id: null,
        card_name: null,
        card_type: null,
        category: "governance",
        requirement: "Existing landscape finding",
        status: "review_needed",
        severity: "medium",
        gap_description: "",
        evidence: null,
        remediation: null,
        scope_type: "landscape",
      },
    });

    expect(
      screen.getByRole("radio", { name: "The whole landscape" }),
    ).toBeChecked();
    expect(screen.queryByTestId("card-picker")).not.toBeInTheDocument();
  });

  it("prefills card scope with the card when editing a card-scoped finding", () => {
    renderCreate({
      finding: {
        id: "f2",
        regulation: "eu_ai_act",
        regulation_article: null,
        card_id: "card-9",
        card_name: "Payments API",
        card_type: "Application",
        category: "governance",
        requirement: "Existing card finding",
        status: "review_needed",
        severity: "medium",
        gap_description: "",
        evidence: null,
        remediation: null,
        scope_type: "card",
      },
    });

    expect(screen.getByRole("radio", { name: "A specific card" })).toBeChecked();
    expect(screen.getByTestId("card-picker")).toHaveTextContent("Payments API");
  });
});
