/**
 * Hierarchy link labels on card detail (discussion #1100).
 *
 * The control is deliberately a copy of how the Relations section edits a
 * relation's attributes — a dense chip for the value, a `label` button that is
 * outlined-dashed while nothing is set, and a popover holding a draft that
 * commits on Save. Four things are worth guarding, and each is a distinct way
 * to get this wrong:
 *
 *  - **The two label slots are different edges.** The Parent chip shows THIS
 *    card's link upwards (`hierarchy.parent_label`); each child row shows that
 *    CHILD's link to this card. Reading the parent chip off the last ancestor
 *    instead would silently show the grandparent's link.
 *  - **Editing a child row patches the child**, not the card under view — the
 *    same "the edge lives on the child" asymmetry `handleAddChild` already has.
 *  - **The draft is a draft.** Cancel must write nothing; only Save PATCHes.
 *  - **An unconfigured type renders nothing**, so every install that has not
 *    opted in sees the section exactly as it was before the feature existed.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/AuthContext", () => ({
  useAuthContext: () => ({
    user: { id: "u1", email: "a@test.com", display_name: "Admin", permissions: { "*": true } },
    refreshUser: vi.fn(),
  }),
}));

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class extends Error {},
}));

vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));

/** Mutable so a test can run the type with no configured vocabulary. */
const mm = vi.hoisted(() => ({
  hierarchyLabels: [] as Record<string, unknown>[],
}));

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    getType: (key: string) =>
      key === "Organization"
        ? {
            key: "Organization",
            label: "Organization",
            color: "#2889ff",
            icon: "corporate_fare",
            has_hierarchy: true,
            subtypes: [],
            hierarchy_labels: mm.hierarchyLabels,
          }
        : undefined,
    types: [],
    relationTypes: [],
  }),
}));

import { api } from "@/api/client";
import { HierarchySection } from "./index";

const VOCAB = [
  { key: "commercial", label: "Commercial", color: "#2889ff" },
  { key: "sales", label: "Sales", color: "#33cc58" },
];

const CARD = {
  id: "b",
  type: "Organization",
  name: "Company B",
  status: "ACTIVE",
  approval_status: "DRAFT",
  data_quality: 0,
} as never;

/** Company B, child of A ("commercial"), with children B1 ("sales") and B2 (none). */
const HIERARCHY = {
  ancestors: [{ id: "a", name: "Company A", type: "Organization", parent_label: null }],
  children: [
    { id: "b1", name: "Company B1", type: "Organization", parent_label: "sales" },
    { id: "b2", name: "Company B2", type: "Organization", parent_label: null },
  ],
  level: 2,
  parent_label: "commercial",
};

beforeEach(() => {
  vi.clearAllMocks();
  mm.hierarchyLabels = VOCAB;
  vi.mocked(api.get).mockResolvedValue(HIERARCHY as never);
});

function renderSection(onUpdate = vi.fn()) {
  render(<HierarchySection card={CARD} onUpdate={onUpdate} />);
  return onUpdate;
}

/**
 * The edit buttons are told apart by their accessible name, which MUI's
 * `Tooltip` mirrors from its title: the resolved value when one is set, and
 * the "set it" prompt when none is. In this fixture that is unique per row.
 */
function editButton(name: string) {
  return screen.getByRole("button", { name });
}

/** Opens a row's popover and picks `option` from the select, without saving. */
async function pick(user: ReturnType<typeof userEvent.setup>, button: HTMLElement, option: string) {
  await user.click(button);
  await user.click(await screen.findByRole("combobox", { name: /link type/i }));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("HierarchySection link labels", () => {
  it("shows this card's own label on the parent line", async () => {
    renderSection();
    // "commercial" is B's link up to A — it comes from the response's
    // top-level field, not from the ancestor node.
    expect(await screen.findByText("Commercial")).toBeInTheDocument();
  });

  it("shows each child's own label on its row", async () => {
    renderSection();
    expect(await screen.findByText("Sales")).toBeInTheDocument();
    // B2 has no label, so it gets the unset affordance and no chip.
    expect(screen.getByText("Company B2")).toBeInTheDocument();
    expect(editButton("Set link type")).toBeInTheDocument();
  });

  it("renders nothing when the type has no configured vocabulary", async () => {
    mm.hierarchyLabels = [];
    renderSection();
    await screen.findByText("Company B1");
    expect(screen.queryByText("Commercial")).not.toBeInTheDocument();
    expect(screen.queryByText("Sales")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set link type" })).not.toBeInTheDocument();
  });

  it("outlines the button while nothing is set and tints it once one is", async () => {
    renderSection();
    await screen.findByText("Commercial");
    // The unset row advertises itself as an empty slot; a set one does not.
    expect(editButton("Set link type")).toHaveStyle({ borderStyle: "dashed" });
    expect(editButton("Commercial")).not.toHaveStyle({ borderStyle: "dashed" });
  });

  it("patches THIS card when the parent line's label is saved", async () => {
    const user = userEvent.setup();
    const onUpdate = renderSection();
    vi.mocked(api.patch).mockResolvedValue({} as never);

    await screen.findByText("Commercial");
    await pick(user, editButton("Commercial"), "Sales");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith("/cards/b", { parent_label: "sales" });
    });
    // The card object the rest of the page renders from went stale.
    expect(onUpdate).toHaveBeenCalled();
  });

  it("patches the CHILD when a child row's label is saved", async () => {
    const user = userEvent.setup();
    const onUpdate = renderSection();
    vi.mocked(api.patch).mockResolvedValue({} as never);

    await screen.findByText("Sales");
    await pick(user, editButton("Sales"), "Commercial");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith("/cards/b1", { parent_label: "commercial" });
    });
    // This card did not change, so the page does not need refreshing.
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("writes nothing when the popover is cancelled", async () => {
    const user = userEvent.setup();
    renderSection();
    vi.mocked(api.patch).mockResolvedValue({} as never);

    await screen.findByText("Commercial");
    await pick(user, editButton("Commercial"), "Sales");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(api.patch).not.toHaveBeenCalled();
    // And the stored value is still what the chip shows.
    expect(screen.getByText("Commercial")).toBeInTheDocument();
  });

  it("clears the label through the empty option", async () => {
    const user = userEvent.setup();
    renderSection();
    vi.mocked(api.patch).mockResolvedValue({} as never);

    await screen.findByText("Sales");
    await pick(user, editButton("Sales"), "No link type");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith("/cards/b1", { parent_label: null });
    });
  });

  it("surfaces a failed save inside the popover", async () => {
    const user = userEvent.setup();
    renderSection();
    vi.mocked(api.patch).mockRejectedValue(new Error("Boom"));

    await screen.findByText("Commercial");
    await pick(user, editButton("Commercial"), "Sales");
    await user.click(screen.getByRole("button", { name: "Save" }));

    // Next to the control the user is holding open — a section-level alert
    // would be scrolled off behind the popover.
    expect(await screen.findByText("Boom")).toBeInTheDocument();
  });

  it("keeps an unknown stored key visible instead of blanking the cell", async () => {
    vi.mocked(api.get).mockResolvedValue({
      ...HIERARCHY,
      parent_label: "retired",
    } as never);
    renderSection();
    // An option an admin has since deleted still renders, carrying its raw key.
    expect(await screen.findByText("retired")).toBeInTheDocument();
  });

  it("offers a stored key whose option was deleted, so the popover agrees with the chip", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue({
      ...HIERARCHY,
      parent_label: "retired",
    } as never);
    renderSection();

    await screen.findByText("retired");
    await user.click(editButton("retired"));
    // Without a row for it the Select has nothing matching its value: MUI
    // renders an empty control and warns out-of-range, so the popover would
    // read "nothing set" while the chip beside it shows the stored value.
    const combo = await screen.findByRole("combobox", { name: /link type/i });
    expect(combo).toHaveTextContent(/retired/);
    await user.click(combo);
    expect(await screen.findByRole("option", { name: /retired/ })).toBeInTheDocument();
  });

  it("right-pins the link type, and only the link type", async () => {
    renderSection();

    // Structure, not just presence. `secondaryAction` is what MUI
    // absolutely-positions at the row's right edge, so the link type stays
    // aligned down the list instead of floating wherever each name ends — but
    // it is the ONLY thing out there. Unlink is the frequent action and lives
    // beside the name, as it does on the Parent row.
    const row = (await screen.findByText("Company B1")).closest("li") as HTMLElement;
    const slot = row.querySelector(".MuiListItemSecondaryAction-root") as HTMLElement;
    expect(slot).not.toBeNull();
    expect(within(slot).getByText("Sales")).toBeInTheDocument();
    expect(within(slot).getAllByRole("button")).toHaveLength(1);

    // The unlink button is on the row, but not in that slot.
    const unlink = row.querySelector('button[title="Remove from hierarchy"]') as HTMLElement;
    expect(unlink).not.toBeNull();
    expect(slot.contains(unlink)).toBe(false);
  });

  it("reserves no right-hand space when the type has no link types", async () => {
    mm.hierarchyLabels = [];
    renderSection();

    // MUI adds its right-padding reserve whenever `secondaryAction` is set, so
    // an empty node there would indent every row on every install that never
    // opted into link types.
    const row = (await screen.findByText("Company B1")).closest("li") as HTMLElement;
    expect(row.querySelector(".MuiListItemSecondaryAction-root")).toBeNull();
    expect(row.querySelector('button[title="Remove from hierarchy"]')).not.toBeNull();
  });

  it("offers no editing control when the user cannot edit", async () => {
    render(<HierarchySection card={CARD} onUpdate={vi.fn()} canEdit={false} />);
    // The chip still renders — a viewer can read the value, same as on a
    // relation row; only the affordance goes.
    expect(await screen.findByText("Commercial")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Commercial" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set link type" })).not.toBeInTheDocument();
  });
});
