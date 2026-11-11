/**
 * The Browse dialog on its own: one tab per kind that may be mentioned, the
 * picks of every tab handed back in pick order, Cancel handing back nothing,
 * and a role that may not search cards told why. The standard pickers are
 * stubbed to their contract (`CardMultiPicker` hands back cards on Apply,
 * `UserMultiSelect` its new value); they have tests of their own.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client", () => ({ api: { get: vi.fn() } }));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

const auth = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/hooks/AuthContext", () => ({ useOptionalAuthUser: () => auth.user }));

vi.mock("@/components/CardMultiPicker", () => ({
  default: (props: {
    open: boolean;
    value: string[];
    onChange: (ids: string[], cards: { id: string; name: string; type: string }[]) => void;
    onClose: () => void;
  }) =>
    props.open ? (
      <div data-testid="card-picker">
        <span data-testid="card-picker-value">{props.value.join(",")}</span>
        <button
          onClick={() => {
            props.onChange(
              ["c2", "c1"],
              [
                { id: "c2", name: "CRM", type: "Application" },
                { id: "c1", name: "SAP", type: "Application" },
              ],
            );
            props.onClose();
          }}
        >
          apply-cards
        </button>
        <button
          onClick={() => {
            props.onChange(["c1"], [{ id: "c1", name: "SAP", type: "Application" }]);
            props.onClose();
          }}
        >
          apply-one
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/UserMultiSelect", () => ({
  default: (props: {
    label: string;
    value: { id: string }[];
    onChange: (users: { id: string; display_name: string; email: string }[]) => void;
  }) => (
    <div data-testid="user-select" aria-label={props.label}>
      <span data-testid="user-value">{props.value.map((u) => u.id).join(",")}</span>
      <button onClick={() => props.onChange([{ id: "u1", display_name: "Ann Lee", email: "ann@x.io" }])}>
        pick-ann
      </button>
    </div>
  ),
}));

import { api } from "@/api/client";
import { invalidateDecisionOptions } from "@/components/DecisionPicker";
import type { MentionKind } from "@/lib/mentionHtml";
import { CARD_TYPES } from "@/test/fixtures/metamodel";
import { withMetamodel } from "@/test/hooks";
import MentionBrowseDialog from "./MentionBrowseDialog";

const DECISIONS = [
  { id: "d1", reference_number: "ADR-001", title: "Adopt Kafka", revision_number: 1, status: "draft" },
  {
    id: "d2",
    reference_number: "ADR-002",
    title: "Pick a CRM",
    revision_number: 2,
    status: "signed",
    standing: "in_force",
  },
];

function setup(kinds: MentionKind[] = ["card", "decision", "user"]) {
  const onInsert = vi.fn();
  const onCancel = vi.fn();
  const view = render(<MentionBrowseDialog open kinds={kinds} onInsert={onInsert} onCancel={onCancel} />);
  return { onInsert, onCancel, ...view };
}

beforeEach(() => {
  auth.user = null;
  withMetamodel(CARD_TYPES, []);
  invalidateDecisionOptions();
  vi.mocked(api.get).mockReset();
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path === "/adr?include_earlier=false") return DECISIONS;
    throw new Error(`unexpected ${path}`);
  });
});

describe("MentionBrowseDialog", () => {
  it("shows one tab per kind, People only where people may be mentioned", () => {
    const { unmount } = setup();
    expect(screen.getByRole("dialog", { name: "Mention" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Cards", "Decisions", "People"]);
    unmount();
    setup(["card", "decision"]);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Cards", "Decisions"]);
  });

  it("shows no tabs for a single kind", () => {
    setup(["decision"]);
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("picks cards through the standard picker and lists them", async () => {
    const user = userEvent.setup();
    const { onInsert } = setup();
    expect(screen.getByText("No cards chosen yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Insert" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Choose cards…/ }));
    await user.click(screen.getByText("apply-cards"));
    expect(screen.queryByTestId("card-picker")).not.toBeInTheDocument();
    expect(screen.getByText("CRM")).toBeInTheDocument();
    expect(screen.getByText("SAP")).toBeInTheDocument();
    // The picker opens again on what is picked.
    await user.click(screen.getByRole("button", { name: /Choose cards…/ }));
    expect(screen.getByTestId("card-picker-value")).toHaveTextContent("c2,c1");
    await user.click(screen.getByText("apply-one"));
    expect(screen.queryByText("CRM")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Insert" }));
    expect(onInsert).toHaveBeenCalledWith([{ kind: "card", id: "c1", label: "SAP" }]);
  });

  it("removes a card with its chip", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: /Choose cards…/ }));
    await user.click(screen.getByText("apply-cards"));
    const chip = screen.getByText("CRM").closest(".MuiChip-root") as HTMLElement;
    await user.click(within(chip).getByTestId("CancelIcon"));
    expect(screen.queryByText("CRM")).not.toBeInTheDocument();
    expect(screen.getByText("SAP")).toBeInTheDocument();
  });

  it("tells a role that may not search cards why there are none", () => {
    auth.user = { id: "x", permissions: {}, type_permissions: {} };
    setup();
    expect(screen.getByTestId("mention-cards-forbidden")).toHaveTextContent(
      "Your role cannot search cards; you can still mention decisions.",
    );
    expect(screen.queryByRole("button", { name: /Choose cards…/ })).not.toBeInTheDocument();
  });

  it("lets a role that may read cards choose them", () => {
    auth.user = { id: "x", permissions: { "inventory.view": true }, type_permissions: {} };
    setup();
    expect(screen.getByRole("button", { name: /Choose cards…/ })).toBeInTheDocument();
    expect(screen.queryByTestId("mention-cards-forbidden")).not.toBeInTheDocument();
  });

  it("lists decisions with reference, title and standing, filtered and ranked on the raw input", async () => {
    const user = userEvent.setup();
    setup(["decision"]);
    const first = await screen.findByRole("checkbox", { name: "ADR-001 Adopt Kafka" });
    expect(first).not.toBeChecked();
    const rows = screen.getAllByRole("button").filter((b) => b.querySelector("input[type=checkbox]"));
    expect(rows.map((r) => r.textContent)).toEqual([
      "ADR-001Adopt KafkaDraft",
      "ADR-002 · Rev 2Pick a CRMIn force",
    ]);
    await user.type(screen.getByRole("textbox", { name: "Search decisions" }), "crm");
    expect(screen.queryByRole("checkbox", { name: "ADR-001 Adopt Kafka" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "ADR-002 · Rev 2 Pick a CRM" })).toBeInTheDocument();
    await user.clear(screen.getByRole("textbox", { name: "Search decisions" }));
    await user.type(screen.getByRole("textbox", { name: "Search decisions" }), "zzz");
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });

  it("toggles a decision on and off", async () => {
    const user = userEvent.setup();
    const { onInsert } = setup(["decision"]);
    const box = await screen.findByRole("checkbox", { name: "ADR-001 Adopt Kafka" });
    await user.click(box);
    expect(box).toBeChecked();
    await user.click(box);
    expect(box).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Insert" })).toBeDisabled();
    await user.click(box);
    await user.click(screen.getByRole("button", { name: "Insert" }));
    expect(onInsert).toHaveBeenCalledWith([{ kind: "decision", id: "d1", label: "ADR-001 Adopt Kafka" }]);
  });

  it("gives an empty decision list when the register cannot be read", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("refused"));
    setup(["decision"]);
    expect(await screen.findByText("No matches")).toBeInTheDocument();
  });

  it("inserts the picks of every tab in pick order", async () => {
    const user = userEvent.setup();
    const { onInsert } = setup();
    await user.click(screen.getByRole("tab", { name: "Decisions" }));
    await user.click(await screen.findByRole("checkbox", { name: "ADR-002 · Rev 2 Pick a CRM" }));
    await user.click(screen.getByRole("tab", { name: "People" }));
    expect(screen.getByTestId("user-select")).toHaveAttribute("aria-label", "People");
    await user.click(screen.getByText("pick-ann"));
    expect(screen.getByTestId("user-value")).toHaveTextContent("u1");
    await user.click(screen.getByRole("tab", { name: "Cards" }));
    await user.click(screen.getByRole("button", { name: /Choose cards…/ }));
    await user.click(screen.getByText("apply-one"));
    await user.click(screen.getByRole("button", { name: "Insert" }));
    expect(onInsert).toHaveBeenCalledWith([
      { kind: "decision", id: "d2", label: "ADR-002 · Rev 2 Pick a CRM" },
      { kind: "user", id: "u1", label: "Ann Lee" },
      { kind: "card", id: "c1", label: "SAP" },
    ]);
  });

  it("hands back nothing on Cancel and starts afresh the next time", async () => {
    const user = userEvent.setup();
    const { onInsert, onCancel, rerender } = setup(["decision"]);
    await user.click(await screen.findByRole("checkbox", { name: "ADR-001 Adopt Kafka" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onInsert).not.toHaveBeenCalled();
    rerender(<MentionBrowseDialog open kinds={["decision"]} onInsert={onInsert} onCancel={onCancel} />);
    expect(await screen.findByRole("checkbox", { name: "ADR-001 Adopt Kafka" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Insert" })).toBeDisabled();
  });
});
