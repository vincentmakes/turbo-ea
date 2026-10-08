/**
 * HierarchySection — the behaviour the two sibling suites run but never pin:
 *
 *  - the link-type popover's draft lifecycle (reopen shows what is stored,
 *    a failed save's error does not survive a reopen, Save/Cancel lock while
 *    saving, a successful save closes and reloads), and which options it
 *    offers (hidden ones only when they are the stored value, no phantom
 *    "unknown" row for a known key);
 *  - what each write path resets afterwards (selection, search text, create
 *    mode, a stale error) and that it reloads the hierarchy it just changed;
 *  - the wording that names the card type by its LABEL, which only differs
 *    from `card.type` for a type whose key is not its display name — the
 *    sibling suites use "Organization", where the two coincide.
 *
 * `CardPicker` is stubbed exactly as in `HierarchySection.branches.test.tsx`.
 */
import { act, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/components/CardPicker", () => ({
  default: ({
    label,
    onChange,
    onInputChange,
  }: {
    label: string;
    onChange: (v: { id: string; name: string; type: string } | null) => void;
    onInputChange?: (v: string) => void;
  }) => (
    <div data-testid="card-picker">
      <span>{label}</span>
      <input aria-label="picker search" onChange={(e) => onInputChange?.(e.target.value)} />
      <button
        onClick={() => onChange({ id: "p9", name: "Company P", type: "BusinessCapability" })}
      >
        pick Company P
      </button>
    </div>
  ),
}));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { makeCardType } from "@/test/fixtures/metamodel";
import { renderWithProviders, userWith, wrapWithProviders } from "@/test/render";
import HierarchySection from "./HierarchySection";
import type { Card, FieldOption, HierarchyData, User } from "@/types";

/** A type whose key ("BusinessCapability") is not its label ("Business Capability"). */
const CAP = makeCardType({
  key: "BusinessCapability",
  label: "Business Capability",
  icon: "account_tree",
  has_hierarchy: true,
});

const VOCAB: FieldOption[] = [
  { key: "commercial", label: "Commercial" },
  { key: "sales", label: "Sales" },
  { key: "strategic", label: "Strategic" },
  { key: "legacy", label: "Legacy", hidden: true },
];

const CARD = {
  id: "b",
  type: "BusinessCapability",
  name: "Billing",
  status: "ACTIVE",
  approval_status: "DRAFT",
  data_quality: 0,
} as unknown as Card;

const node = (id: string, name: string, parent_label: string | null = null) => ({
  id,
  name,
  type: "BusinessCapability",
  parent_label,
});

/** Billing under Finance ("commercial"), with Invoicing ("sales") and Dunning (none). */
const LABELLED: HierarchyData = {
  ancestors: [node("a", "Finance")],
  children: [node("b1", "Invoicing", "sales"), node("b2", "Dunning")],
  level: 2,
  parent_label: "commercial",
};

const ORPHAN: HierarchyData = { ancestors: [], children: [], level: 1 };

/**
 * Serve `/cards/{id}/hierarchy` from a mutable copy, so a write route can
 * change what the next reload returns. A section that forgets to reload keeps
 * showing the old copy.
 */
function serve(initial: HierarchyData, id = "b"): HierarchyData {
  const state = JSON.parse(JSON.stringify(initial)) as HierarchyData;
  mockApi.on("get", `/cards/${id}/hierarchy`, () => JSON.parse(JSON.stringify(state)));
  return state;
}

function deferred<T = unknown>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderSection(opts: { card?: Card; user?: User; onUpdate?: () => void } = {}) {
  const onUpdate = opts.onUpdate ?? vi.fn();
  const result = renderWithProviders(
    <HierarchySection card={opts.card ?? CARD} onUpdate={onUpdate} />,
    { route: "/cards/b", user: opts.user },
  );
  return { ...result, onUpdate };
}

const linkTypeSelect = () => screen.findByRole("combobox", { name: /link type/i });
const saveButton = () => screen.queryByRole("button", { name: "Save" });

async function waitForPopoverClosed() {
  await waitFor(() => expect(saveButton()).not.toBeInTheDocument());
}

async function waitForDialogClosed() {
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}

beforeEach(() => {
  hookState.reset();
  mockApi.reset();
  withMetamodel([CAP]);
  mockApi.on("patch", /^\/cards\//, {});
});

describe("HierarchySection — link-type popover", () => {
  beforeEach(() => {
    withMetamodel([{ ...CAP, hierarchy_labels: VOCAB }]);
  });

  it("opens on the stored value and offers exactly the visible options", async () => {
    serve(LABELLED);
    const { user } = renderSection();
    await user.click(await screen.findByRole("button", { name: "Commercial" }));

    const select = await linkTypeSelect();
    expect(select).toHaveTextContent("Commercial");
    const paper = select.closest(".MuiPopover-paper") as HTMLElement;
    // The heading above the control, the field's own label, and the outline
    // notch that label sizes (the static-label convention) all name it.
    const named = within(paper).getAllByText("Link type");
    expect(
      named.map((el) => (el.closest("legend") ? "notch" : el.tagName === "LABEL" ? "label" : "heading")),
    ).toEqual(["heading", "label", "notch"]);
    expect(within(paper).queryByRole("alert")).not.toBeInTheDocument();

    await user.click(select);
    const options = await screen.findAllByRole("option");
    // The hidden "Legacy" is not offered for a row that does not hold it, and
    // a known key gets no extra "unknown" row.
    expect(options.map((o) => o.textContent)).toEqual([
      "No link type",
      "Commercial",
      "Sales",
      "Strategic",
    ]);
  });

  it("opens an unset row on the empty choice, with no phantom option", async () => {
    serve(LABELLED);
    const { user } = renderSection();
    // Dunning is the only row with nothing set.
    await user.click(await screen.findByRole("button", { name: "Set link type" }));

    await user.click(await linkTypeSelect());
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "No link type",
      "Commercial",
      "Sales",
      "Strategic",
    ]);
    expect(screen.getByRole("option", { name: "No link type" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("keeps a hidden option offered on the row that stores it", async () => {
    serve({ ...LABELLED, children: [node("b1", "Invoicing", "legacy")] });
    const { user } = renderSection();
    await user.click(await screen.findByRole("button", { name: "Legacy" }));

    const select = await linkTypeSelect();
    expect(select).toHaveTextContent("Legacy");
    await user.click(select);
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "No link type",
      "Commercial",
      "Sales",
      "Strategic",
      "Legacy",
    ]);
  });

  it("closes on Cancel and reopens on the stored value, not the cancelled draft", async () => {
    serve(LABELLED);
    const { user } = renderSection();
    await user.click(await screen.findByRole("button", { name: "Commercial" }));
    await user.click(await linkTypeSelect());
    await user.click(await screen.findByRole("option", { name: "Sales" }));
    expect(await linkTypeSelect()).toHaveTextContent("Sales");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitForPopoverClosed();
    expect(mockApi.callsOf("patch")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Commercial" }));
    expect(await linkTypeSelect()).toHaveTextContent("Commercial");
  });

  it("does not show a failed save's error again after reopening", async () => {
    serve(LABELLED);
    mockApi.fail("patch", "/cards/b", 500);
    const { user } = renderSection();
    await user.click(await screen.findByRole("button", { name: "Commercial" }));
    await user.click(await linkTypeSelect());
    await user.click(await screen.findByRole("option", { name: "Sales" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("PATCH /cards/b failed");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitForPopoverClosed();
    await user.click(screen.getByRole("button", { name: "Commercial" }));
    expect(await linkTypeSelect()).toHaveTextContent("Commercial");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("locks while saving, drops the previous error, then closes and reloads", async () => {
    const server = serve(LABELLED);
    mockApi.fail("patch", "/cards/b", 500);
    const { user, onUpdate } = renderSection();
    await user.click(await screen.findByRole("button", { name: "Commercial" }));
    await user.click(await linkTypeSelect());
    await user.click(await screen.findByRole("option", { name: "Strategic" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("PATCH /cards/b failed");

    // The retry hangs until the test lets it through.
    const gate = deferred();
    mockApi.on("patch", "/cards/b", async (_path, body) => {
      await gate.promise;
      server.parent_label = (body as { parent_label: string | null }).parent_label;
      return {};
    });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await act(async () => gate.resolve(undefined));
    await waitForPopoverClosed();
    const patches = mockApi.callsOf("patch", "/cards/b");
    expect(patches[patches.length - 1].body).toEqual({ parent_label: "strategic" });
    // The chip now reads the reloaded value.
    expect(await screen.findByRole("button", { name: "Strategic" })).toBeInTheDocument();
    expect(onUpdate).toHaveBeenCalled();
  });

  it("reports a non-Error failure with the generic message", async () => {
    serve(LABELLED);
    mockApi.on("patch", "/cards/b1", () => Promise.reject("nope"));
    const { user } = renderSection();
    await user.click(await screen.findByRole("button", { name: "Sales" }));
    await user.click(await linkTypeSelect());
    await user.click(await screen.findByRole("option", { name: "Commercial" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to set the link type");
  });
});

describe("HierarchySection — section", () => {
  it("renders nothing for a card whose type is not in the metamodel", async () => {
    serve(LABELLED, "g");
    const { container } = renderSection({ card: { ...CARD, id: "g", type: "Ghost" } as Card });
    await waitFor(() => expect(mockApi.callsOf("get", "/cards/g/hierarchy")).toHaveLength(1));
    expect(container).toBeEmptyDOMElement();
  });

  it("offers no link-type control on a type that declares no vocabulary at all", async () => {
    // `hierarchy_labels` absent, not merely empty.
    serve(LABELLED);
    renderSection();
    await screen.findByText("Invoicing");
    expect(screen.queryByRole("button", { name: "Set link type" })).not.toBeInTheDocument();
    expect(screen.queryByText("Commercial")).not.toBeInTheDocument();
  });

  it("labels the parent and children slots, with no path or error for an orphan", async () => {
    serve(ORPHAN);
    renderSection();
    expect(await screen.findByText("No parent")).toBeInTheDocument();
    expect(screen.getByText("Parent")).toBeInTheDocument();
    expect(screen.getByText("Children")).toBeInTheDocument();
    expect(screen.queryByText("Path")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("colours the level and the breadcrumb by depth, clamping past the palette", async () => {
    const chip = (el: HTMLElement) => el.closest(".MuiChip-root") as HTMLElement;

    serve(ORPHAN);
    const first = renderSection();
    expect(chip(await screen.findByText("Level 1"))).toHaveStyle({ backgroundColor: "#1565c0" });
    first.unmount();

    serve({
      ancestors: [1, 2, 3, 4, 5, 6].map((n) => node(`t${n}`, `Tier ${n}`)),
      children: [],
      level: 7,
    });
    renderSection();
    expect(chip(await screen.findByText("Level 7"))).toHaveStyle({ backgroundColor: "#e3f2fd" });
    const palette = ["#1565c0", "#42a5f5", "#90caf9", "#bbdefb", "#e3f2fd", "#e3f2fd"];
    palette.forEach((color, i) => {
      // The first match is the breadcrumb; "Tier 6" is also the parent chip.
      expect(chip(screen.getAllByText(`Tier ${i + 1}`)[0])).toHaveStyle({ color });
    });
  });

  it("collapses when its header is clicked", async () => {
    serve(LABELLED);
    const { user } = renderSection();
    await screen.findByText("Invoicing");
    const header = screen.getByRole("button", { name: /Hierarchy/ });
    expect(header).toHaveAttribute("aria-expanded", "true");
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
  });

  it("loads the new card's hierarchy when the card changes", async () => {
    serve(LABELLED);
    serve({ ancestors: [], children: [node("c1", "Payroll")], level: 1 }, "c");
    const { rerender } = renderSection();
    await screen.findByText("Invoicing");

    rerender(
      wrapWithProviders(
        <HierarchySection card={{ ...CARD, id: "c", name: "HR" } as Card} onUpdate={vi.fn()} />,
        { route: "/cards/c" },
      ),
    );
    expect(await screen.findByText("Payroll")).toBeInTheDocument();
    expect(mockApi.callsOf("get", "/cards/c/hierarchy")).toHaveLength(1);
  });

  it("reloads after unlinking a child", async () => {
    const server = serve(LABELLED);
    mockApi.on("patch", "/cards/b1", () => {
      server.children = server.children.filter((c) => c.id !== "b1");
      return {};
    });
    const { user } = renderSection();
    await screen.findByText("Invoicing");
    await user.click(screen.getAllByTitle("Remove from hierarchy")[0]);
    await waitFor(() => expect(screen.queryByText("Invoicing")).not.toBeInTheDocument());
    expect(screen.getByText("Dunning")).toBeInTheDocument();
  });
});

describe("HierarchySection — parent dialog", () => {
  it("names the type by its label", async () => {
    serve(LABELLED);
    const { user } = renderSection();
    await user.click(await screen.findByTitle("Change parent"));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByRole("heading", { name: "Set Parent" })).toBeInTheDocument();
    expect(within(dialog).getByText("Search Business Capability")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /Create new Business Capability$/ }));
    expect(within(dialog).getByText("Create new Business Capability as parent")).toBeInTheDocument();
  });

  it("clears a retried failure, reloads, and reopens with nothing carried over", async () => {
    const server = serve(LABELLED);
    mockApi.fail("patch", "/cards/b", 400);
    const { user, onUpdate } = renderSection();
    await user.click(await screen.findByTitle("Change parent"));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("picker search"), "Grp");
    await user.click(within(dialog).getByText("pick Company P"));
    await user.click(within(dialog).getByRole("button", { name: "Set Parent" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("PATCH /cards/b failed");

    mockApi.on("patch", "/cards/b", () => {
      server.ancestors = [node("p9", "Company P")];
      return {};
    });
    await user.click(within(dialog).getByRole("button", { name: "Set Parent" }));
    await waitForDialogClosed();
    expect(onUpdate).toHaveBeenCalled();
    // The section shows the new parent, and the earlier failure is gone.
    expect((await screen.findAllByText("Company P")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(screen.getByTitle("Change parent"));
    const again = await screen.findByRole("dialog");
    // Neither the pick nor the typed search text survive.
    expect(within(again).getByRole("button", { name: "Set Parent" })).toBeDisabled();
    await user.click(within(again).getByRole("button", { name: /Create new/ }));
    expect(within(again).getByLabelText("Name")).toHaveValue("");
  });

  it("reports a non-Error failure with the generic message", async () => {
    serve(LABELLED);
    mockApi.on("patch", "/cards/b", () => Promise.reject("nope"));
    const { user } = renderSection();
    await user.click(await screen.findByTitle("Change parent"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("pick Company P"));
    await user.click(within(dialog).getByRole("button", { name: "Set Parent" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Failed to set parent");
  });

  it("dismissing with Escape clears the error and leaves create mode", async () => {
    serve(LABELLED);
    mockApi.fail("patch", "/cards/b", 400);
    const { user } = renderSection();
    await user.click(await screen.findByTitle("Change parent"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("pick Company P"));
    await user.click(within(dialog).getByRole("button", { name: "Set Parent" }));
    await within(dialog).findByRole("alert");
    await user.click(within(dialog).getByRole("button", { name: /Create new/ }));

    await user.keyboard("{Escape}");
    await waitForDialogClosed();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(screen.getByTitle("Change parent"));
    const again = await screen.findByRole("dialog");
    expect(within(again).getByTestId("card-picker")).toBeInTheDocument();
    expect(within(again).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("Cancel clears the error and leaves create mode too", async () => {
    serve(LABELLED);
    mockApi.fail("patch", "/cards/b", 400);
    const { user } = renderSection();
    await user.click(await screen.findByTitle("Change parent"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("pick Company P"));
    await user.click(within(dialog).getByRole("button", { name: "Set Parent" }));
    await within(dialog).findByRole("alert");
    await user.click(within(dialog).getByRole("button", { name: /Create new/ }));
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitForDialogClosed();
    // The abandoned write's error does not stay behind on the section.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(screen.getByTitle("Change parent"));
    const again = await screen.findByRole("dialog");
    expect(within(again).getByTestId("card-picker")).toBeInTheDocument();
    expect(within(again).getByRole("button", { name: "Set Parent" })).toBeInTheDocument();
    expect(within(again).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("creates only on Enter, never for a blank name, and locks while creating", async () => {
    serve(LABELLED);
    const gate = deferred();
    mockApi.on("post", "/cards", async () => {
      await gate.promise;
      return { id: "np", name: "Group Co" };
    });
    const { user } = renderSection();
    await user.click(await screen.findByTitle("Change parent"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Create new/ }));
    const name = within(dialog).getByLabelText("Name");
    const create = within(dialog).getByRole("button", { name: "Create & Set as Parent" });

    await user.type(name, "   ");
    expect(create).toBeDisabled();
    await user.keyboard("{Enter}");
    expect(mockApi.callsOf("post")).toHaveLength(0);

    await user.clear(name);
    await user.type(name, "Group Co");
    // Typing alone never creates.
    expect(mockApi.callsOf("post")).toHaveLength(0);
    expect(create).toBeEnabled();

    await user.keyboard("{Enter}");
    expect(mockApi.callsOf("post", "/cards")).toHaveLength(1);
    expect(create).toBeDisabled();

    await act(async () => gate.resolve(undefined));
    // Back to search, with no stale error.
    expect(await within(dialog).findByTestId("card-picker")).toBeInTheDocument();
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    expect(mockApi.callsOf("post", "/cards")[0].body).toEqual({
      type: "BusinessCapability",
      name: "Group Co",
    });
    await waitFor(() =>
      expect(mockApi.callsOf("patch", "/cards/b")[0]?.body).toEqual({ parent_id: "np" }),
    );
  });

  it("offers quick-create to a role holding the create permission", async () => {
    serve(LABELLED);
    const { user } = renderSection({
      user: userWith("inventory.view", "inventory.edit", "inventory.create"),
    });
    await user.click(await screen.findByTitle("Change parent"));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("button", { name: /Create new Business Capability$/ }),
    ).toBeInTheDocument();
  });
});

describe("HierarchySection — add-child dialog", () => {
  it("names the type by its label and pre-fills the create form from the search", async () => {
    serve(LABELLED);
    const { user } = renderSection();
    await user.click(await screen.findByRole("button", { name: /Add Child/ }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByRole("heading", { name: "Add Child" })).toBeInTheDocument();
    expect(within(dialog).getByText("Search Business Capability")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("picker search"), "Kid Co");
    await user.click(within(dialog).getByRole("button", { name: /Create new Business Capability$/ }));

    expect(within(dialog).getByText("Create new Business Capability as child")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Kid Co");
    // The create form has its own buttons; the confirm row's is gone.
    expect(within(dialog).queryByRole("button", { name: "Add Child" })).not.toBeInTheDocument();

    const name = within(dialog).getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "  ");
    expect(within(dialog).getByRole("button", { name: "Create & Add as Child" })).toBeDisabled();
  });

  it("clears a retried failure, reloads, and reopens with nothing carried over", async () => {
    const server = serve(LABELLED);
    mockApi.fail("patch", "/cards/p9", 400);
    const { user } = renderSection();
    await user.click(await screen.findByRole("button", { name: /Add Child/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("picker search"), "Kid");
    await user.click(within(dialog).getByText("pick Company P"));
    await user.click(within(dialog).getByRole("button", { name: "Add Child" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("PATCH /cards/p9 failed");

    mockApi.on("patch", "/cards/p9", () => {
      server.children = [...server.children, node("p9", "Company P")];
      return {};
    });
    await user.click(within(dialog).getByRole("button", { name: "Add Child" }));
    await waitForDialogClosed();
    expect(await screen.findByText("Company P")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Add Child/ }));
    const again = await screen.findByRole("dialog");
    expect(within(again).getByRole("button", { name: "Add Child" })).toBeDisabled();
    await user.click(within(again).getByRole("button", { name: /Create new/ }));
    expect(within(again).getByLabelText("Name")).toHaveValue("");
  });

  it("lists a quick-created child once it exists", async () => {
    const server = serve(LABELLED);
    mockApi.on("post", "/cards", () => {
      server.children = [...server.children, node("kid", "Kid Co")];
      return { id: "kid", name: "Kid Co" };
    });
    const { user } = renderSection();
    await user.click(await screen.findByRole("button", { name: /Add Child/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Create new/ }));
    await user.type(within(dialog).getByLabelText("Name"), "Kid Co{Enter}");

    expect(await screen.findByText("Kid Co")).toBeInTheDocument();
    expect(within(dialog).getByTestId("card-picker")).toBeInTheDocument();
  });

  it("keeps a failed quick-create's form usable", async () => {
    serve(LABELLED);
    mockApi.fail("post", "/cards", 409);
    const { user } = renderSection();
    await user.click(await screen.findByRole("button", { name: /Add Child/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Create new/ }));
    await user.type(within(dialog).getByLabelText("Name"), "Dup");
    const create = within(dialog).getByRole("button", { name: "Create & Add as Child" });
    await user.click(create);

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("POST /cards failed");
    expect(create).toBeEnabled();
  });

  it("dismissing with Escape clears the error and leaves create mode", async () => {
    serve(LABELLED);
    mockApi.fail("patch", "/cards/p9", 400);
    const { user } = renderSection();
    await user.click(await screen.findByRole("button", { name: /Add Child/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("pick Company P"));
    await user.click(within(dialog).getByRole("button", { name: "Add Child" }));
    await within(dialog).findByRole("alert");
    await user.click(within(dialog).getByRole("button", { name: /Create new/ }));

    await user.keyboard("{Escape}");
    await waitForDialogClosed();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Add Child/ }));
    const again = await screen.findByRole("dialog");
    expect(within(again).getByTestId("card-picker")).toBeInTheDocument();
    expect(within(again).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("Cancel clears the error and leaves create mode too", async () => {
    serve(LABELLED);
    mockApi.fail("patch", "/cards/p9", 400);
    const { user } = renderSection();
    await user.click(await screen.findByRole("button", { name: /Add Child/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("pick Company P"));
    await user.click(within(dialog).getByRole("button", { name: "Add Child" }));
    await within(dialog).findByRole("alert");
    await user.click(within(dialog).getByRole("button", { name: /Create new/ }));
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitForDialogClosed();
    // The abandoned write's error does not stay behind on the section.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Add Child/ }));
    const again = await screen.findByRole("dialog");
    expect(within(again).getByTestId("card-picker")).toBeInTheDocument();
    expect(within(again).queryByRole("alert")).not.toBeInTheDocument();
  });
});
