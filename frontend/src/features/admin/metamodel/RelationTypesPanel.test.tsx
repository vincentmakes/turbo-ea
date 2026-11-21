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

/** Already has an ArchiMate mapping with the reversed direction set --
 *  opening its edit dialog must show that state, not just let it be set. */
const ORG_TO_APP_REVERSED = {
  ...(ORG_TO_APP as unknown as Record<string, unknown>),
  key: "relOrgToAppReversed",
  label: "already reversed",
  archimate_type: "Serving",
  archimate_access: null,
  archimate_reversed: true,
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
    // Four switches on the cross-type row: visible + mandatory, per side.
    expect(within(rowFor("uses")).getAllByRole("checkbox")).toHaveLength(4);
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

describe("RelationTypesPanel — ArchiMate mapping (archimate_type/archimate_access/archimate_reversed)", () => {
  async function openEditDialog(user: ReturnType<typeof userEvent.setup>) {
    renderPanel({ scopeTypeKey: "Organization" });
    await user.click(within(rowFor("uses")).getByRole("button", { name: /^edit$/i }));
    const dialog = await screen.findByRole("dialog");
    // Order in the dialog: cardinality, then ArchiMate relationship type.
    const archimateTypeSelect = within(dialog).getAllByRole("combobox")[1];
    return { dialog, archimateTypeSelect };
  }

  it("has no ArchiMate access-type picker or reversed switch until a relationship type is chosen", async () => {
    const user = userEvent.setup();
    const { dialog } = await openEditDialog(user);

    expect(within(dialog).getAllByText("ArchiMate relationship").length).toBeGreaterThan(0);
    expect(within(dialog).queryByText("Access type")).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/ArchiMate direction is reversed/)).not.toBeInTheDocument();
  });

  it("shows the access-type picker's label and the None option once a type is chosen", async () => {
    const user = userEvent.setup();
    const { dialog, archimateTypeSelect } = await openEditDialog(user);

    await user.click(archimateTypeSelect);
    await user.click(await screen.findByRole("option", { name: "Access" }));

    expect(within(dialog).getAllByText("Access type").length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/ArchiMate direction is reversed/)).toBeInTheDocument();

    const accessSelect = within(dialog).getAllByRole("combobox")[2];
    await user.click(accessSelect);
    expect(await screen.findAllByRole("option", { name: "None" })).not.toHaveLength(0);
  });

  it("opens already showing the reversed switch checked when archimate_reversed is already true", async () => {
    renderPanel({ relationTypes: [ORG_TO_APP_REVERSED, ORG_TO_ORG] });
    const user = userEvent.setup();
    await user.click(within(rowFor("already reversed")).getByRole("button", { name: /^edit$/i }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByRole("checkbox", { name: /ArchiMate direction is reversed/ })).toBeChecked();
  });

  it("saving with an ArchiMate relationship type chosen sends archimate_type and archimate_reversed: false", async () => {
    const user = userEvent.setup();
    const { dialog, archimateTypeSelect } = await openEditDialog(user);

    await user.click(archimateTypeSelect);
    await user.click(await screen.findByRole("option", { name: "Serving" }));
    await user.click(within(dialog).getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        "/metamodel/relation-types/relOrgToApp",
        expect.objectContaining({
          archimate_type: "Serving",
          archimate_access: null,
          archimate_reversed: false,
        }),
      ),
    );
  });

  it("choosing Access reveals the access-type picker, and saving sends the chosen access type", async () => {
    const user = userEvent.setup();
    const { dialog, archimateTypeSelect } = await openEditDialog(user);

    await user.click(archimateTypeSelect);
    await user.click(await screen.findByRole("option", { name: "Access" }));

    const accessSelect = within(dialog).getAllByRole("combobox")[2];
    await user.click(accessSelect);
    await user.click(await screen.findByRole("option", { name: "Read" }));
    await user.click(within(dialog).getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        "/metamodel/relation-types/relOrgToApp",
        expect.objectContaining({ archimate_type: "Access", archimate_access: "Read" }),
      ),
    );
  });

  it("switching away from Access clears the stored access type", async () => {
    const user = userEvent.setup();
    const { dialog, archimateTypeSelect } = await openEditDialog(user);

    await user.click(archimateTypeSelect);
    await user.click(await screen.findByRole("option", { name: "Access" }));
    const accessSelect = within(dialog).getAllByRole("combobox")[2];
    await user.click(accessSelect);
    await user.click(await screen.findByRole("option", { name: "Read" }));

    // Switch the relationship type away from Access -- its picker must disappear.
    await user.click(archimateTypeSelect);
    await user.click(await screen.findByRole("option", { name: "Serving" }));
    expect(within(dialog).queryByText("Access type")).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        "/metamodel/relation-types/relOrgToApp",
        expect.objectContaining({ archimate_type: "Serving", archimate_access: null }),
      ),
    );
  });

  it("toggling the reversed switch sends archimate_reversed: true", async () => {
    const user = userEvent.setup();
    const { dialog, archimateTypeSelect } = await openEditDialog(user);

    await user.click(archimateTypeSelect);
    await user.click(await screen.findByRole("option", { name: "Serving" }));
    await user.click(within(dialog).getByRole("checkbox", { name: /ArchiMate direction is reversed/ }));
    await user.click(within(dialog).getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        "/metamodel/relation-types/relOrgToApp",
        expect.objectContaining({ archimate_reversed: true }),
      ),
    );
  });

  it("choosing None clears a previously set ArchiMate relationship type", async () => {
    const user = userEvent.setup();
    const { dialog, archimateTypeSelect } = await openEditDialog(user);

    await user.click(archimateTypeSelect);
    await user.click(await screen.findByRole("option", { name: "Serving" }));
    await user.click(archimateTypeSelect);
    await user.click(await screen.findByRole("option", { name: "None" }));
    await user.click(within(dialog).getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        "/metamodel/relation-types/relOrgToApp",
        expect.objectContaining({ archimate_type: null, archimate_reversed: false }),
      ),
    );
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
