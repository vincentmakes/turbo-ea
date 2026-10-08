/**
 * HierarchySection beyond link labels (`HierarchySection.test.tsx`): setting,
 * changing and removing the parent, adding and removing children, quick-create
 * of a parent or child of the card's own type, navigation, and the gates that
 * hide each control.
 *
 * `CardPicker` is stubbed: its own search behaviour is covered by its tests,
 * and what matters here is which ids the section excludes and what it does
 * with the pick.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/components/CardPicker", () => ({
  default: ({
    label,
    onChange,
    onInputChange,
    excludeIds,
  }: {
    label: string;
    onChange: (v: { id: string; name: string; type: string } | null) => void;
    onInputChange?: (v: string) => void;
    excludeIds?: string[];
  }) => (
    <div data-testid="card-picker" data-exclude={(excludeIds ?? []).join(",")}>
      <span>{label}</span>
      <input aria-label="picker search" onChange={(e) => onInputChange?.(e.target.value)} />
      <button onClick={() => onChange({ id: "p9", name: "Company P", type: "Organization" })}>
        pick Company P
      </button>
    </div>
  ),
}));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { makeCardType } from "@/test/fixtures/metamodel";
import { renderWithProviders, userWith, wrapWithProviders } from "@/test/render";
import { HierarchySection } from "./index";
import type { Card, HierarchyData } from "@/types";

const ORG = makeCardType({
  key: "Organization",
  label: "Organization",
  icon: "corporate_fare",
  has_hierarchy: true,
});

const CARD = {
  id: "b",
  type: "Organization",
  name: "Company B",
  status: "ACTIVE",
  approval_status: "DRAFT",
  data_quality: 0,
} as unknown as Card;

const WITH_PARENT: HierarchyData = {
  ancestors: [
    { id: "root", name: "Holding", type: "Organization" },
    { id: "a", name: "Company A", type: "Organization" },
  ],
  children: [{ id: "b1", name: "Company B1", type: "Organization" }],
  level: 3,
} as HierarchyData;

const ORPHAN: HierarchyData = { ancestors: [], children: [], level: 1 } as HierarchyData;

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

function renderSection(
  opts: { canEdit?: boolean; user?: ReturnType<typeof userWith>; onUpdate?: () => void } = {},
) {
  const onUpdate = opts.onUpdate ?? vi.fn();
  const result = renderWithProviders(
    <>
      <HierarchySection card={CARD} onUpdate={onUpdate} canEdit={opts.canEdit} />
      <LocationProbe />
    </>,
    { route: "/cards/b", user: opts.user },
  );
  return { ...result, onUpdate };
}

const location = () => screen.getByTestId("location").textContent;

beforeEach(() => {
  hookState.reset();
  mockApi.reset();
  withMetamodel([ORG]);
  mockApi.on("get", "/cards/b/hierarchy", WITH_PARENT);
  mockApi.on("patch", /^\/cards\//, {});
});

describe("HierarchySection — rendering", () => {
  it("renders nothing for a type without hierarchy", async () => {
    withMetamodel([{ ...ORG, has_hierarchy: false }]);
    renderSection();
    expect(screen.queryByText("Hierarchy")).not.toBeInTheDocument();
  });

  it("shows the breadcrumb path, the level and the immediate parent", async () => {
    renderSection();
    expect(await screen.findByText("Level 3")).toBeInTheDocument();
    expect(screen.getByText("Path")).toBeInTheDocument();
    expect(screen.getByText("Holding")).toBeInTheDocument();
    // "Company A" is both the last breadcrumb and the parent chip.
    expect(screen.getAllByText("Company A")).toHaveLength(2);
    expect(screen.getByText("Company B1")).toBeInTheDocument();
  });

  it("stops the progress bar and shows the error when the hierarchy fails to load", async () => {
    mockApi.fail("get", "/cards/b/hierarchy", 500);
    renderSection();
    expect(await screen.findByRole("alert")).toHaveTextContent("GET /cards/b/hierarchy failed");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("names a failed load that carries no message, and drops it once another card loads", async () => {
    mockApi.on("get", "/cards/b/hierarchy", () => Promise.reject("nope"));
    mockApi.on("get", "/cards/c/hierarchy", ORPHAN);
    const { rerender } = renderWithProviders(<HierarchySection card={CARD} onUpdate={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");

    rerender(wrapWithProviders(<HierarchySection card={{ ...CARD, id: "c" }} onUpdate={vi.fn()} />));
    expect(await screen.findByText("No parent")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the empty states and no edit controls for a read-only viewer", async () => {
    mockApi.on("get", "/cards/b/hierarchy", ORPHAN);
    renderSection({ canEdit: false });
    expect(await screen.findByText("No parent")).toBeInTheDocument();
    expect(screen.getByText("No children")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Set Parent/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add Child/ })).not.toBeInTheDocument();
  });

  it("hides the edit and unlink buttons on a parented card when read-only", async () => {
    renderSection({ canEdit: false });
    await screen.findByText("Company B1");
    expect(screen.queryByTitle("Change parent")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Remove parent")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Remove from hierarchy")).not.toBeInTheDocument();
  });

  it("navigates from the breadcrumb, the parent chip and a child row", async () => {
    const { user } = renderSection();
    await screen.findByText("Holding");

    await user.click(screen.getByText("Holding"));
    expect(location()).toBe("/cards/root");
    // The parent chip is the second "Company A".
    await user.click(screen.getAllByText("Company A")[1]);
    expect(location()).toBe("/cards/a");
    await user.click(screen.getByText("Company B1"));
    expect(location()).toBe("/cards/b1");
  });
});

describe("HierarchySection — parent", () => {
  it("removes the parent and refreshes the page", async () => {
    const { user, onUpdate } = renderSection();
    await user.click(await screen.findByTitle("Remove parent"));

    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    expect(mockApi.callsOf("patch", "/cards/b")[0].body).toEqual({ parent_id: null });
    expect(mockApi.callsOf("get", "/cards/b/hierarchy").length).toBeGreaterThan(1);
  });

  it("shows a failed parent removal on the section and does not refresh the page", async () => {
    mockApi.fail("patch", "/cards/b", 409);
    const { user, onUpdate } = renderSection();
    await user.click(await screen.findByTitle("Remove parent"));
    expect(await screen.findByRole("alert")).toHaveTextContent("PATCH /cards/b failed");
    expect(onUpdate).not.toHaveBeenCalled();
    // The parent is still shown: nothing was unlinked.
    expect(screen.getByTitle("Remove parent")).toBeInTheDocument();
    expect(mockApi.callsOf("get", "/cards/b/hierarchy")).toHaveLength(1);
  });

  it("names a failed parent removal that carries no message", async () => {
    mockApi.on("patch", "/cards/b", () => Promise.reject("nope"));
    const { user } = renderSection();
    await user.click(await screen.findByTitle("Remove parent"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("sets a parent picked in the dialog, excluding self and children", async () => {
    mockApi.on("get", "/cards/b/hierarchy", { ...ORPHAN, children: WITH_PARENT.children });
    const { user, onUpdate } = renderSection();
    await user.click(await screen.findByRole("button", { name: /Set Parent/ }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTestId("card-picker")).toHaveAttribute("data-exclude", "b,b1");
    expect(within(dialog).getByText("Search Organization")).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "Set Parent" });
    expect(confirm).toBeDisabled();
    await user.click(within(dialog).getByText("pick Company P"));
    await user.click(confirm);

    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    expect(mockApi.callsOf("patch", "/cards/b")[0].body).toEqual({ parent_id: "p9" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows a failed parent change in the dialog and clears it on dismiss", async () => {
    mockApi.fail("patch", "/cards/b", 400, "cycle");
    const { user, onUpdate } = renderSection();
    await user.click(await screen.findByTitle("Change parent"));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("pick Company P"));
    await user.click(within(dialog).getByRole("button", { name: "Set Parent" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("PATCH /cards/b failed");
    expect(onUpdate).not.toHaveBeenCalled();

    await user.click(within(alert).getByRole("button"));
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("quick-creates a parent named after the search, then links to it", async () => {
    mockApi.on("post", "/cards", { id: "new-parent", name: "Group Co" });
    const { user, onUpdate } = renderSection();
    await user.click(await screen.findByTitle("Change parent"));
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("picker search"), "Group Co");
    await user.click(within(dialog).getByRole("button", { name: /Create new Organization/ }));
    expect(within(dialog).getByText("Create new Organization as parent")).toBeInTheDocument();
    const name = within(dialog).getByLabelText("Name");
    expect(name).toHaveValue("Group Co");
    // The confirm row is replaced by the create form's own buttons.
    expect(within(dialog).queryByRole("button", { name: "Set Parent" })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Create & Set as Parent" }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    expect(mockApi.callsOf("post", "/cards")[0].body).toEqual({
      type: "Organization",
      name: "Group Co",
    });
    expect(mockApi.callsOf("patch", "/cards/b")[0].body).toEqual({ parent_id: "new-parent" });
  });

  it("goes back to search from the create form, and disables create on a blank name", async () => {
    const { user } = renderSection();
    await user.click(await screen.findByTitle("Change parent"));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: /Create new Organization/ }));
    const create = within(dialog).getByRole("button", { name: "Create & Set as Parent" });
    expect(create).toBeDisabled();
    // Enter on a blank name is a no-op too.
    await user.type(within(dialog).getByLabelText("Name"), "{Enter}");
    expect(mockApi.callsOf("post")).toHaveLength(0);

    await user.click(within(dialog).getByRole("button", { name: "Back to search" }));
    expect(within(dialog).getByTestId("card-picker")).toBeInTheDocument();
  });

  it("closes the parent dialog on Escape", async () => {
    const { user } = renderSection();
    await user.click(await screen.findByTitle("Change parent"));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("offers no quick-create without create permission on the type", async () => {
    const { user } = renderSection({ user: userWith("inventory.view", "inventory.edit") });
    await user.click(await screen.findByTitle("Change parent"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: /Create new/ })).not.toBeInTheDocument();
  });
});

describe("HierarchySection — children", () => {
  it("unlinks a child without refreshing the page", async () => {
    const { user, onUpdate } = renderSection();
    await user.click(await screen.findByTitle("Remove from hierarchy"));
    await waitFor(() => expect(mockApi.callsOf("patch", "/cards/b1")).toHaveLength(1));
    expect(mockApi.callsOf("patch", "/cards/b1")[0].body).toEqual({ parent_id: null });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("shows a failed child unlink on the section and keeps the child listed", async () => {
    mockApi.fail("patch", "/cards/b1", 409);
    const { user } = renderSection();
    await user.click(await screen.findByTitle("Remove from hierarchy"));
    expect(await screen.findByRole("alert")).toHaveTextContent("PATCH /cards/b1 failed");
    expect(screen.getByText("Company B1")).toBeInTheDocument();
    expect(mockApi.callsOf("get", "/cards/b/hierarchy")).toHaveLength(1);
  });

  it("names a failed child unlink that carries no message, and clears it on the next success", async () => {
    mockApi.on("patch", "/cards/b1", () => Promise.reject("nope"));
    const { user } = renderSection();
    await user.click(await screen.findByTitle("Remove from hierarchy"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");

    mockApi.on("patch", "/cards/b1", {});
    await user.click(screen.getByTitle("Remove from hierarchy"));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("adds a picked child, excluding self and ancestors", async () => {
    const { user } = renderSection();
    await user.click(await screen.findByRole("button", { name: /Add Child/ }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByTestId("card-picker")).toHaveAttribute("data-exclude", "b,root,a");
    await user.click(within(dialog).getByText("pick Company P"));
    await user.click(within(dialog).getByRole("button", { name: "Add Child" }));

    await waitFor(() => expect(mockApi.callsOf("patch", "/cards/p9")).toHaveLength(1));
    expect(mockApi.callsOf("patch", "/cards/p9")[0].body).toEqual({ parent_id: "b" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows a non-Error add failure with the generic message", async () => {
    mockApi.on("patch", "/cards/p9", () => Promise.reject("nope"));
    const { user } = renderSection();
    await user.click(await screen.findByRole("button", { name: /Add Child/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("pick Company P"));
    await user.click(within(dialog).getByRole("button", { name: "Add Child" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("Failed to add child");
    await user.click(within(alert).getByRole("button"));
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("quick-creates a child with Enter, posting it under this card", async () => {
    mockApi.on("post", "/cards", { id: "kid", name: "Company B9" });
    const { user, onUpdate } = renderSection();
    await user.click(await screen.findByRole("button", { name: /Add Child/ }));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: /Create new Organization/ }));
    expect(within(dialog).getByText("Create new Organization as child")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Name"), "  Company B9  {Enter}");

    await waitFor(() => expect(mockApi.callsOf("post", "/cards")).toHaveLength(1));
    expect(mockApi.callsOf("post", "/cards")[0].body).toEqual({
      type: "Organization",
      name: "Company B9",
      parent_id: "b",
    });
    // Creating a child leaves this card's own fields untouched.
    expect(mockApi.callsOf("patch")).toHaveLength(0);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("reports a failed quick-create and returns to search", async () => {
    mockApi.fail("post", "/cards", 409, "duplicate");
    const { user } = renderSection();
    await user.click(await screen.findByRole("button", { name: /Add Child/ }));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: /Create new Organization/ }));
    await user.type(within(dialog).getByLabelText("Name"), "Dup");
    await user.click(within(dialog).getByRole("button", { name: "Create & Add as Child" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("POST /cards failed");

    await user.click(within(dialog).getByRole("button", { name: "Back to search" }));
    expect(within(dialog).getByTestId("card-picker")).toBeInTheDocument();
  });

  it("reports a non-Error quick-create failure generically", async () => {
    mockApi.on("post", "/cards", () => Promise.reject(42));
    const { user } = renderSection();
    await user.click(await screen.findByTitle("Change parent"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Create new Organization/ }));
    await user.type(within(dialog).getByLabelText("Name"), "X{Enter}");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Failed to create");
  });

  it("closes the add-child dialog on Escape", async () => {
    const { user } = renderSection();
    await user.click(await screen.findByRole("button", { name: /Add Child/ }));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("HierarchySection — link-label popover", () => {
  beforeEach(() => {
    withMetamodel([
      {
        ...ORG,
        hierarchy_labels: [
          { key: "commercial", label: "Commercial" },
          { key: "sales", label: "Sales" },
        ],
      },
    ]);
  });

  it("dismisses a save error inside the popover and closes on Escape", async () => {
    mockApi.fail("patch", "/cards/b", 500);
    const { user } = renderSection();
    // The parent line comes first; the child row has its own unset button.
    await user.click((await screen.findAllByRole("button", { name: "Set link type" }))[0]);
    await user.click(await screen.findByRole("combobox", { name: /link type/i }));
    await user.click(await screen.findByRole("option", { name: "Sales" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    const alert = await screen.findByText("PATCH /cards/b failed");
    await user.click(within(alert.closest("[role=alert]") as HTMLElement).getByRole("button"));
    expect(screen.queryByText("PATCH /cards/b failed")).not.toBeInTheDocument();

    // Dismissing the alert removed the focused button; refocus inside the popover.
    screen.getByRole("button", { name: "Save" }).focus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument());
  });
});
