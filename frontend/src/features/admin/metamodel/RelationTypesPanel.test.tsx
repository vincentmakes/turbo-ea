/**
 * The shared relation-type manager (#1100 follow-up).
 *
 * The general Metamodel → Relations tab and a card type's own Relations tab are
 * one component now. The cases below pin what each mode owes, and in particular
 * the bug the unification fixes:
 *
 * **A self-referencing relation type is two sides.** The card-type drawer used
 * to derive the side from the type key — `r.source_type_key === cardTypeKey` —
 * which is true at BOTH ends of a self-pair, so such a type rendered once and
 * only ever wrote `source_visible` / `source_mandatory`. The target-side flags
 * were unreachable from anywhere in the product. `expandSides` fixes it, and
 * the first test here is what stops it coming back.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RelationTypesPanel from "./RelationTypesPanel";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock("./RelationTypeValuesDialog", () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="values-dialog" /> : null,
}));

import { api } from "@/api/client";

const ORG = {
  key: "Organization",
  label: "Organization",
  icon: "corporate_fare",
  color: "#2889ff",
  has_hierarchy: true,
} as never;
const APP = {
  key: "Application",
  label: "Application",
  icon: "apps",
  color: "#0f7eb5",
  has_hierarchy: false,
} as never;

/** Organization → Application, an ordinary cross-type relation. */
const ORG_TO_APP = {
  key: "relOrgToApp",
  label: "uses",
  reverse_label: "is used by",
  source_type_key: "Organization",
  target_type_key: "Application",
  cardinality: "n:m",
  built_in: true,
  is_hidden: false,
  attributes_schema: [],
  source_visible: true,
  source_mandatory: false,
  target_visible: true,
  target_mandatory: false,
} as never;

/** Organization → Organization: the self-pair the old code collapsed. */
const ORG_TO_ORG = {
  key: "relOrgToOrg",
  label: "has site",
  reverse_label: "is site of",
  source_type_key: "Organization",
  target_type_key: "Organization",
  cardinality: "1:n",
  built_in: false,
  is_hidden: false,
  attributes_schema: [],
  source_visible: true,
  source_mandatory: false,
  target_visible: false,
  target_mandatory: false,
} as never;

const HIDDEN = {
  ...(ORG_TO_APP as unknown as Record<string, unknown>),
  key: "relHidden",
  label: "retired link",
  is_hidden: true,
} as never;

const TYPES = [ORG, APP];

function renderPanel(props: Record<string, unknown> = {}) {
  const onRefresh = vi.fn();
  render(
    <RelationTypesPanel
      types={TYPES}
      relationTypes={[ORG_TO_APP, ORG_TO_ORG]}
      onRefresh={onRefresh}
      {...props}
    />,
  );
  return onRefresh;
}

/** The card containing a given verb. */
function rowFor(verb: string): HTMLElement {
  return screen.getByText(verb).closest(".MuiCard-root") as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.patch).mockResolvedValue({} as never);
});

describe("RelationTypesPanel — self-referencing types (the #1100 follow-up fix)", () => {
  it("renders a self-pair as TWO rows when scoped to the card type", async () => {
    renderPanel({ scopeTypeKey: "Organization" });
    // Both directions of the Organization→Organization type, each under its
    // own verb. Before the fix only the forward one existed.
    expect(await screen.findByText("has site")).toBeInTheDocument();
    expect(screen.getByText("is site of")).toBeInTheDocument();
  });

  it("writes source_visible from the outgoing row and target_visible from the incoming one", async () => {
    const user = userEvent.setup();
    renderPanel({ scopeTypeKey: "Organization" });

    // Outgoing side ("has site") → source_visible.
    const outgoing = rowFor("has site");
    await user.click(within(outgoing).getAllByRole("checkbox")[0]);
    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith("/metamodel/relation-types/relOrgToOrg", {
        source_visible: false,
      });
    });

    vi.mocked(api.patch).mockClear();

    // Incoming side ("is site of") → target_visible. This field had no UI at all
    // before the sides were split.
    const incoming = rowFor("is site of");
    await user.click(within(incoming).getAllByRole("checkbox")[0]);
    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith("/metamodel/relation-types/relOrgToOrg", {
        target_visible: true,
      });
    });
  });

  it("reflects each side's own stored flags", async () => {
    renderPanel({ scopeTypeKey: "Organization" });
    // source_visible: true, target_visible: false — the two rows must not
    // mirror one another.
    const outgoing = within(rowFor("has site")).getAllByRole("checkbox")[0];
    const incoming = within(rowFor("is site of")).getAllByRole("checkbox")[0];
    expect(outgoing).toBeChecked();
    expect(incoming).not.toBeChecked();
  });
});

describe("RelationTypesPanel — scoping", () => {
  it("shows only the relation types touching the scoped card type", async () => {
    render(
      <RelationTypesPanel
        types={TYPES}
        relationTypes={[ORG_TO_APP, ORG_TO_ORG]}
        onRefresh={vi.fn()}
        scopeTypeKey="Application"
      />,
    );
    // Application is the target of relOrgToApp, so it reads the reverse verb…
    expect(await screen.findByText("is used by")).toBeInTheDocument();
    // …and the Organization self-pair does not touch Application at all.
    expect(screen.queryByText("has site")).not.toBeInTheDocument();
  });

  it("shows both endpoints and both sides' flags when unscoped", async () => {
    renderPanel();
    expect(await screen.findByText("uses")).toBeInTheDocument();
    // Five switches on the cross-type row: visible + mandatory per side, then
    // the one Track lifecycle switch for the whole type.
    const switches = within(rowFor("uses")).getAllByRole("checkbox");
    expect(switches).toHaveLength(5);
    expect(within(rowFor("uses")).getAllByRole("checkbox", { name: "Track lifecycle" })).toEqual([
      switches[4],
    ]);
  });

  it("pre-fills the scoped type as the source of a new relation", async () => {
    const user = userEvent.setup();
    renderPanel({ scopeTypeKey: "Organization" });
    await user.click(screen.getByRole("button", { name: /new relation/i }));
    // The source Select shows the card type under view rather than being empty.
    const selects = await screen.findAllByRole("combobox");
    expect(within(selects[0]).getByText("Organization")).toBeInTheDocument();
  });
});

describe("RelationTypesPanel — hidden relation types", () => {
  it("hides them until the switch is on, then badges them", async () => {
    const user = userEvent.setup();
    render(
      <RelationTypesPanel
        types={TYPES}
        relationTypes={[ORG_TO_APP, HIDDEN]}
        onRefresh={vi.fn()}
        scopeTypeKey="Organization"
      />,
    );
    // The drawer used to render hidden types indistinguishably from live ones.
    expect(screen.queryByText("retired link")).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /show hidden/i }));
    expect(await screen.findByText("retired link")).toBeInTheDocument();
    expect(within(rowFor("retired link")).getByText("Hidden")).toBeInTheDocument();
  });
});

describe("RelationTypesPanel — full editing reaches the card-type tab", () => {
  it("offers edit, relation values and delete when scoped", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue({ instance_count: 0 } as never);
    renderPanel({ scopeTypeKey: "Organization" });

    const row = rowFor("uses");
    // All three were general-tab-only before the panel was shared.
    await user.click(within(row).getByRole("button", { name: /manage relation values/i }));
    expect(await screen.findByTestId("values-dialog")).toBeInTheDocument();
  });

  it("opens the edit dialog seeded with the relation's verbs", async () => {
    const user = userEvent.setup();
    renderPanel({ scopeTypeKey: "Organization" });

    await user.click(within(rowFor("uses")).getByRole("button", { name: /^edit$/i }));
    expect(await screen.findByDisplayValue("uses")).toBeInTheDocument();
    expect(screen.getByDisplayValue("is used by")).toBeInTheDocument();
  });
});

describe("RelationTypesPanel — the key is visible once the type exists (#1406)", () => {
  // The key is the Excel `rel:<key>` column and the Relations sheet's
  // `relation_type` value, and it is fixed at creation. The edit dialog showed
  // only the verbs, so a user who created a custom type had nowhere to read it.
  it("shows a custom relation type's key, read-only, with where Excel uses it", async () => {
    const user = userEvent.setup();
    renderPanel({ scopeTypeKey: "Organization" });

    await user.click(within(rowFor("has site")).getByRole("button", { name: /^edit$/i }));

    const dialog = await screen.findByRole("dialog");
    const keyCaption = within(dialog).getByText("Key: relOrgToOrg");
    expect(keyCaption.closest("input, textarea")).toBeNull();
    expect(
      within(dialog).getByText(
        "In Excel, this key heads the rel:relOrgToOrg column on the source card type's sheet and is the relation_type value on the Relations sheet.",
      ),
    ).toBeInTheDocument();
    // Shown, not editable: no field holds the key.
    expect(within(dialog).queryByDisplayValue("relOrgToOrg")).toBeNull();
  });
});

describe("RelationTypesPanel — delete confirmation", () => {
  it("states the number of relation instances a delete would remove, in bold", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue({ instance_count: 7 } as never);
    renderPanel({ scopeTypeKey: "Organization" });

    await user.click(within(rowFor("uses")).getByRole("button", { name: /^delete$/i }));

    const dialog = await screen.findByRole("dialog");
    const alert = await within(dialog).findByRole("alert");
    expect(alert.querySelector("strong")).toHaveTextContent(/^7$/);
    expect(api.get).toHaveBeenCalledWith("/metamodel/relation-types/relOrgToApp/instance-count");
  });
});

describe("RelationTypesPanel — Track lifecycle", () => {
  // The switch decides only whether card detail offers the date editor on
  // relations of the type. It sits in both dialogs and works on a built-in
  // type like any other.
  const TRACKED = {
    ...(ORG_TO_APP as unknown as Record<string, unknown>),
    lifecycle_enabled: true,
  } as never;

  it("is off by default when creating, explained, and sent when turned on", async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue({} as never);
    const onRefresh = renderPanel({ scopeTypeKey: "Organization" });
    await user.click(screen.getByRole("button", { name: /new relation/i }));

    const dialog = await screen.findByRole("dialog");
    const toggle = within(dialog).getByRole("checkbox", { name: "Track lifecycle" });
    expect(toggle).not.toBeChecked();
    expect(toggle).toHaveAccessibleDescription(
      "Gives each relation of this type its own lifecycle — the same phases as a card — so it can be planned, active or ended independently of the cards it connects.",
    );

    // Pick the target and verb so Create enables.
    const selects = within(dialog).getAllByRole("combobox");
    await user.click(selects[1]);
    await user.click(await screen.findByRole("option", { name: /Application/ }));
    await user.type(within(dialog).getByRole("textbox", { name: /^Label/ }), "runs");
    await user.click(toggle);
    expect(toggle).toBeChecked();
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith(
      "/metamodel/relation-types",
      expect.objectContaining({
        lifecycle_enabled: true,
        source_type_key: "Organization",
        target_type_key: "Application",
        label: "runs",
        reverse_label: "",
        cardinality: "1:n",
      }),
    );
    expect(onRefresh).toHaveBeenCalled();
  });

  it("sends false on create when left off", async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue({} as never);
    renderPanel({ scopeTypeKey: "Organization" });
    await user.click(screen.getByRole("button", { name: /new relation/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getAllByRole("combobox")[1]);
    await user.click(await screen.findByRole("option", { name: /Application/ }));
    await user.type(within(dialog).getByRole("textbox", { name: /^Label/ }), "runs");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/metamodel/relation-types",
        expect.objectContaining({ lifecycle_enabled: false }),
      ),
    );
  });

  it("reflects the stored value on edit of a built-in type and sends the toggled one", async () => {
    const user = userEvent.setup();
    renderPanel({ scopeTypeKey: "Organization", relationTypes: [TRACKED, ORG_TO_ORG] });

    await user.click(within(rowFor("uses")).getByRole("button", { name: /^edit$/i }));
    const dialog = await screen.findByRole("dialog");
    const toggle = within(dialog).getByRole("checkbox", { name: "Track lifecycle" });
    expect(toggle).toBeChecked();

    await user.click(toggle);
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        "/metamodel/relation-types/relOrgToApp",
        expect.objectContaining({ lifecycle_enabled: false }),
      ),
    );
  });

  it("sends true on edit when an untracked type is switched on", async () => {
    const user = userEvent.setup();
    renderPanel({ scopeTypeKey: "Organization" });
    await user.click(within(rowFor("has site")).getByRole("button", { name: /^edit$/i }));
    const dialog = await screen.findByRole("dialog");
    const toggle = within(dialog).getByRole("checkbox", { name: "Track lifecycle" });
    // Absent on the stored type reads as off.
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        "/metamodel/relation-types/relOrgToOrg",
        expect.objectContaining({ lifecycle_enabled: true }),
      ),
    );
  });
});

describe("RelationTypesPanel — Track lifecycle in the list", () => {
  // The switch sits on every row, so an admin dates a relation type's
  // relations without opening its edit dialog. It replaced a read-only chip.
  const HINT =
    "Gives each relation of this type its own lifecycle — the same phases as a card — so it can be planned, active or ended independently of the cards it connects.";
  const TRACKED = {
    ...(ORG_TO_APP as unknown as Record<string, unknown>),
    lifecycle_enabled: true,
  } as never;
  const UNTRACKED = {
    ...(ORG_TO_ORG as unknown as Record<string, unknown>),
    lifecycle_enabled: false,
  } as never;

  const lifecycleSwitch = (verb: string) =>
    within(rowFor(verb)).getByRole("checkbox", { name: "Track lifecycle" });

  it("reflects the stored flag in the Relations tab, absent reading as off", async () => {
    renderPanel({ relationTypes: [TRACKED, ORG_TO_ORG] });
    expect(await screen.findByText("uses")).toBeInTheDocument();
    expect(lifecycleSwitch("uses")).toBeChecked();
    expect(lifecycleSwitch("has site")).not.toBeChecked();
    // The old read-only chip is gone.
    expect(screen.queryByText("Lifecycle")).not.toBeInTheDocument();
  });

  it("reflects the stored flag in a card type's list", async () => {
    renderPanel({ scopeTypeKey: "Application", relationTypes: [TRACKED] });
    expect(await screen.findByText("is used by")).toBeInTheDocument();
    expect(lifecycleSwitch("is used by")).toBeChecked();
  });

  it("switching on PATCHes exactly lifecycle_enabled: true and refreshes", async () => {
    const user = userEvent.setup();
    const onRefresh = renderPanel({ relationTypes: [ORG_TO_APP] });
    await user.click(lifecycleSwitch("uses"));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(api.patch).toHaveBeenCalledWith("/metamodel/relation-types/relOrgToApp", {
      lifecycle_enabled: true,
    });
  });

  it("switching off PATCHes exactly lifecycle_enabled: false and refreshes", async () => {
    const user = userEvent.setup();
    const onRefresh = renderPanel({ scopeTypeKey: "Organization", relationTypes: [TRACKED] });
    await user.click(lifecycleSwitch("uses"));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(api.patch).toHaveBeenCalledWith("/metamodel/relation-types/relOrgToApp", {
      lifecycle_enabled: false,
    });
  });

  it("shows a rejected PATCH in the list's alert and does not refresh", async () => {
    const user = userEvent.setup();
    vi.mocked(api.patch).mockRejectedValueOnce(new Error("Not allowed"));
    const onRefresh = renderPanel({ relationTypes: [ORG_TO_APP] });
    await user.click(lifecycleSwitch("uses"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not allowed");
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("falls back to the generic error for a rejection without a message", async () => {
    const user = userEvent.setup();
    vi.mocked(api.patch).mockRejectedValueOnce("boom");
    renderPanel({ relationTypes: [ORG_TO_APP] });
    await user.click(lifecycleSwitch("uses"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("is described by the hint and explains itself on hover", async () => {
    const user = userEvent.setup();
    renderPanel({ relationTypes: [TRACKED] });
    expect(await screen.findByText("uses")).toBeInTheDocument();
    expect(lifecycleSwitch("uses")).toHaveAccessibleDescription(HINT);
    await user.hover(within(rowFor("uses")).getByText("Track lifecycle"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(HINT);
  });

  it("puts the switch after the side flags, so the first switch stays Visible", async () => {
    renderPanel({ scopeTypeKey: "Organization", relationTypes: [UNTRACKED] });
    expect(await screen.findByText("has site")).toBeInTheDocument();
    const switches = within(rowFor("has site")).getAllByRole("checkbox");
    expect(switches).toHaveLength(3);
    expect(switches[2]).toBe(lifecycleSwitch("has site"));
  });

  it("shows the same type-wide value on both rows of a self-pair, each writing the type", async () => {
    const user = userEvent.setup();
    const TRACKED_SELF = {
      ...(ORG_TO_ORG as unknown as Record<string, unknown>),
      lifecycle_enabled: true,
    } as never;
    renderPanel({ scopeTypeKey: "Organization", relationTypes: [TRACKED_SELF] });
    expect(await screen.findByText("is site of")).toBeInTheDocument();
    expect(lifecycleSwitch("has site")).toBeChecked();
    expect(lifecycleSwitch("is site of")).toBeChecked();
    await user.click(lifecycleSwitch("is site of"));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/metamodel/relation-types/relOrgToOrg", {
        lifecycle_enabled: false,
      }),
    );
  });

  it("is offered on a hidden relation type's row too", async () => {
    const user = userEvent.setup();
    renderPanel({ relationTypes: [HIDDEN] });
    await user.click(screen.getByRole("checkbox", { name: /show hidden/i }));
    expect(await screen.findByText("retired link")).toBeInTheDocument();
    await user.click(lifecycleSwitch("retired link"));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/metamodel/relation-types/relHidden", {
        lifecycle_enabled: true,
      }),
    );
  });
});
