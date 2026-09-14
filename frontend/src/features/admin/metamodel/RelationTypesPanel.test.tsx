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

vi.mock("./RelationTranslationDialog", () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="translations-dialog" /> : null,
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
