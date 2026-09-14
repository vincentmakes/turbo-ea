/**
 * Hierarchy link labels on card detail (discussion #1100).
 *
 * Three things are worth guarding, and each is a distinct way to get this
 * wrong:
 *
 *  - **The two label slots are different edges.** The Parent chip shows THIS
 *    card's link upwards (`hierarchy.parent_label`); each child row shows that
 *    CHILD's link to this card. Reading the parent chip off the last ancestor
 *    instead would silently show the grandparent's link.
 *  - **Editing a child row patches the child**, not the card under view — the
 *    same "the edge lives on the child" asymmetry `handleAddChild` already has.
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

/** Company B, child of A ("commercial"), with its own child B1 ("sales"). */
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
    // B2 has no label, so nothing extra is rendered for it.
    expect(screen.queryByText("Company B2")).toBeInTheDocument();
  });

  it("renders nothing when the type has no configured vocabulary", async () => {
    mm.hierarchyLabels = [];
    renderSection();
    await screen.findByText("Company B1");
    expect(screen.queryByText("Commercial")).not.toBeInTheDocument();
    expect(screen.queryByText("Sales")).not.toBeInTheDocument();
  });

  it("patches THIS card when the parent line's label is changed", async () => {
    const user = userEvent.setup();
    const onUpdate = renderSection();
    vi.mocked(api.patch).mockResolvedValue({} as never);

    // The parent line's control is the one showing the card's own label.
    const control = (await screen.findByText("Commercial")).closest(
      ".MuiInputBase-root",
    ) as HTMLElement;
    await user.click(within(control).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Sales" }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith("/cards/b", { parent_label: "sales" });
    });
    // The card object the rest of the page renders from went stale.
    expect(onUpdate).toHaveBeenCalled();
  });

  it("patches the CHILD when a child row's label is changed", async () => {
    const user = userEvent.setup();
    const onUpdate = renderSection();
    vi.mocked(api.patch).mockResolvedValue({} as never);

    const control = (await screen.findByText("Sales")).closest(
      ".MuiInputBase-root",
    ) as HTMLElement;
    await user.click(within(control).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Commercial" }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith("/cards/b1", { parent_label: "commercial" });
    });
    // This card did not change, so the page does not need refreshing.
    expect(onUpdate).not.toHaveBeenCalled();
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

  it("offers no editing control when the user cannot edit", async () => {
    render(<HierarchySection card={CARD} onUpdate={vi.fn()} canEdit={false} />);
    expect(await screen.findByText("Commercial")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
