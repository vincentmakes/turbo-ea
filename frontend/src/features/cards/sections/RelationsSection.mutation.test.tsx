/**
 * RelationsSection behaviour the other two suites leave unpinned: how a group
 * renders for each kind of relation type (plain, `flowDirection`, subtyped),
 * the "Also …" caption on a card reached through several relation types, the
 * optimistic add / undo / edit callbacks, the descendant roll-up's lazy and
 * race-safe fetch, the props a card detail page changes after mount
 * (`fsId`, `refreshKey`, `onCardUpdate`, a metamodel that lands late), and
 * which relation types get a group at all.
 *
 * `AddRelationsDialog` and `DescendantRelationsDrawer` are stubbed to the
 * props the section hands them; each has its own tests.
 */
import { act, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

/** What the stubbed add dialog hands back through its callbacks. */
const dlg = vi.hoisted(() => ({
  added: null as unknown,
  removedId: "",
  updated: null as unknown,
}));

vi.mock("@/features/cards/sections/AddRelationsDialog", () => ({
  default: ({
    open,
    onClose,
    relationType,
    isSource,
    onAdded,
    onRemoved,
    onUpdated,
  }: {
    open: boolean;
    onClose: (added: number) => void;
    relationType: { key: string } | null;
    isSource: boolean;
    onAdded: (r: unknown) => void;
    onRemoved: (id: string) => void;
    onUpdated: (r: unknown) => void;
  }) =>
    open ? (
      <div data-testid="add-dialog" data-rt={relationType?.key} data-source={String(isSource)}>
        <button onClick={() => onAdded(dlg.added)}>dlg-add</button>
        <button onClick={() => onRemoved(dlg.removedId)}>dlg-remove</button>
        <button onClick={() => onUpdated(dlg.updated)}>dlg-update</button>
        <button onClick={() => onClose(0)}>dlg-close</button>
      </div>
    ) : null,
}));
vi.mock("@/features/cards/sections/DescendantRelationsDrawer", () => ({
  default: ({ open, rt, isSource }: { open: boolean; rt: { key: string }; isSource: boolean }) =>
    open ? <div data-testid="rollup-drawer" data-rt={rt.key} data-source={String(isSource)} /> : null,
}));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import {
  makeCardType,
  makeField,
  makeOption,
  makeRelationType,
  makeSubtype,
} from "@/test/fixtures/metamodel";
import { makeUser, renderWithProviders, userWith, wrapWithProviders } from "@/test/render";
import type { Relation, RelationType, User } from "@/types";
import RelationsSection from "./RelationsSection";

const FS = "app-1";

const APP = makeCardType({ key: "Application", label: "Application", has_hierarchy: true });
const ORG = makeCardType({
  key: "Organization",
  label: "Organization",
  subtypes: [
    makeSubtype({ key: "bu", label: "Business Unit" }),
    makeSubtype({ key: "region", label: "Region" }),
  ],
});
/** Same type before an admin gave it subtypes. */
const ORG_NO_SUBTYPES = makeCardType({ key: "Organization", label: "Organization" });
const OBJ = makeCardType({ key: "Objective", label: "Objective" });
/** A key that is not its label, so a `key` fallback is visible. */
const FLOW = makeCardType({ key: "DataFlow", label: "Data Flow" });
const FLOW_SUBTYPED = makeCardType({
  key: "DataFlow",
  label: "Data Flow",
  subtypes: [makeSubtype({ key: "a", label: "Alpha" }), makeSubtype({ key: "b", label: "Beta" })],
});

const USAGE_FIELD = makeField({
  key: "usageType",
  label: "Usage Type",
  type: "single_select",
  options: [
    makeOption({ key: "owner", label: "Owner", color: "#1976d2" }),
    makeOption({ key: "user", label: "User" }),
  ],
});

const APP_TO_ORG = makeRelationType({
  key: "appToOrg",
  label: "is used by",
  reverse_label: "uses",
  source_type_key: "Application",
  target_type_key: "Organization",
  attributes_schema: [USAGE_FIELD],
});
const APP_TO_ORG_OWNS = makeRelationType({
  key: "appToOrgOwns",
  label: "owns",
  reverse_label: "is owned by",
  source_type_key: "Application",
  target_type_key: "Organization",
});
const APP_TO_ORG_RUNS = makeRelationType({
  key: "appToOrgRuns",
  label: "runs",
  reverse_label: "is run by",
  source_type_key: "Application",
  target_type_key: "Organization",
});
/** No attributes at all. */
const APP_TO_OBJ = makeRelationType({
  key: "appToObj",
  label: "supports",
  reverse_label: "is supported by",
  source_type_key: "Application",
  target_type_key: "Objective",
});
const OBJ_TO_ORG = makeRelationType({
  key: "objToOrg",
  label: "steers",
  reverse_label: "is steered by",
  source_type_key: "Objective",
  target_type_key: "Organization",
});
/** `flowDirection` beside an ordinary single-select. */
const APP_TO_FLOW = makeRelationType({
  key: "appToFlow",
  label: "provides",
  reverse_label: "is provided by",
  source_type_key: "Application",
  target_type_key: "DataFlow",
  attributes_schema: [
    makeField({
      key: "flowDirection",
      label: "Flow",
      type: "single_select",
      options: [
        makeOption({ key: "forward", label: "Forward" }),
        makeOption({ key: "reverse", label: "Reverse" }),
        makeOption({ key: "bidirectional", label: "Both" }),
      ],
    }),
    USAGE_FIELD,
  ],
});
/** The Application lineage relation — owned by SuccessorsSection, never a group here. */
const APP_LINEAGE = makeRelationType({
  key: "relApplicationSuccessor",
  label: "precedes",
  reverse_label: "succeeds",
  source_type_key: "Application",
  target_type_key: "Application",
});

function rel(
  id: string,
  name: string,
  opts: {
    type?: string;
    targetType?: string;
    targetId?: string;
    subtype?: string;
    attributes?: Record<string, unknown>;
    sourceId?: string;
  } = {},
): Relation {
  const sourceId = opts.sourceId ?? FS;
  const targetId = opts.targetId ?? `t-${id}`;
  return {
    id,
    type: opts.type ?? "appToOrg",
    source_id: sourceId,
    target_id: targetId,
    attributes: opts.attributes,
    source: { id: sourceId, type: "Application", name: "NexaCore ERP" },
    target: { id: targetId, type: opts.targetType ?? "Organization", name, subtype: opts.subtype },
  } as Relation;
}

function flowRel(id: string, name: string, flowDirection?: unknown, subtype?: string): Relation {
  return rel(id, name, {
    type: "appToFlow",
    targetType: "DataFlow",
    subtype,
    attributes: flowDirection === undefined ? undefined : { flowDirection },
  });
}

interface SectionProps {
  fsId: string;
  cardTypeKey: string;
  refreshKey?: number;
  canManageRelations?: boolean;
  initialExpanded?: boolean;
  onCardUpdate?: () => void;
}

/**
 * Mount the section and keep a handle that re-renders it with new props, the
 * way card detail does when the route, the refresh counter or the metamodel
 * changes under a mounted section.
 */
function mount(props: Partial<SectionProps> = {}, user: User = makeUser()) {
  let current: SectionProps = {
    fsId: FS,
    cardTypeKey: "Application",
    initialExpanded: true,
    ...props,
  };
  const ui = () => <RelationsSection {...current} />;
  const view = renderWithProviders(ui(), { route: `/cards/${FS}`, user });
  return {
    ...view,
    rerenderWith(next: Partial<SectionProps>) {
      current = { ...current, ...next };
      view.rerender(wrapWithProviders(ui(), { route: `/cards/${FS}`, user }));
    },
  };
}

/** Run `fn` and let every request it started settle, effects included. */
async function settle(fn?: () => void) {
  await act(async () => {
    fn?.();
    await new Promise((r) => setTimeout(r, 0));
  });
}

function routeRelations(rows: Relation[], cardId = FS) {
  mockApi.on("get", `/relations?card_id=${cardId}`, rows);
}

/** The `<li>` a related card's name sits in. */
function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest("li") as HTMLElement;
}

beforeEach(() => {
  hookState.reset();
  mockApi.reset();
  withMetamodel([APP, ORG, OBJ, FLOW], [APP_TO_ORG]);
  mockApi.on("get", /\/descendant-relations\/summary$/, []);
  routeRelations([]);
  dlg.added = null;
  dlg.removedId = "";
  dlg.updated = null;
});

describe("RelationsSection — a plain relation type", () => {
  beforeEach(() => withMetamodel([APP, OBJ], [APP_TO_OBJ]));

  it("heads the group with the verb and the other card type, then lists the cards flat", async () => {
    routeRelations([
      rel("1", "Grow revenue", { type: "appToObj", targetType: "Objective" }),
      rel("2", "Cut cost", { type: "appToObj", targetType: "Objective" }),
    ]);
    mount();

    expect(await screen.findByText("Grow revenue")).toBeInTheDocument();
    expect(within(screen.getByText("supports")).getByText("Objective")).toBeInTheDocument();
    // Each card once — no role buckets, no subtype buckets, no empty line.
    expect(screen.getAllByText("Grow revenue")).toHaveLength(1);
    expect(screen.getAllByText("Cut cost")).toHaveLength(1);
    expect(screen.queryByText("Provided Objective")).not.toBeInTheDocument();
    expect(screen.queryByText("Unspecified")).not.toBeInTheDocument();
    expect(screen.queryByText("No subtype")).not.toBeInTheDocument();
    expect(screen.queryByText("No relations yet.")).not.toBeInTheDocument();
    // Nothing to group by, so no toggle.
    expect(screen.queryByRole("button", { name: "Group by subtype" })).not.toBeInTheDocument();
  });

  it("says once that an empty group has no relations, with no empty list and no Add menu", async () => {
    mount();

    expect(await screen.findByText("supports")).toBeInTheDocument();
    await settle();
    // The group's own line; the section adds none while a group is shown.
    expect(screen.getAllByText("No relations yet.")).toHaveLength(1);
    expect(screen.queryAllByRole("list")).toHaveLength(0);
    // Every type has its own +, so the section-level menu has nothing to offer.
    expect(screen.queryByRole("button", { name: /Add Relation/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add Objective · supports/ })).toBeInTheDocument();
  });
});

describe("RelationsSection — flowDirection buckets", () => {
  beforeEach(() => withMetamodel([APP, FLOW], [APP_TO_FLOW]));

  it("buckets by role even beside another attribute, naming the type by its label", async () => {
    routeRelations([
      flowRel("f", "Orders API", "forward"),
      flowRel("r", "Billing Feed", "reverse"),
      flowRel("u", "Legacy Link"),
      // A stored value that is not a direction string reads as unspecified.
      flowRel("x", "Odd Link", 42),
    ]);
    mount();

    expect(await screen.findByText("Legacy Link")).toBeInTheDocument();
    const provided = screen.getByText("Provided Data Flow");
    const consumed = screen.getByText("Consumed Data Flow");
    const unspecified = screen.getByText("Unspecified");
    expect(provided.parentElement).toHaveTextContent("arrow_forward");
    expect(consumed.parentElement).toHaveTextContent("arrow_back");
    expect(unspecified.parentElement).toHaveTextContent("help_outline");

    const text = document.body.textContent ?? "";
    const at = (s: string) => text.indexOf(s);
    expect(at("Provided Data Flow")).toBeLessThan(at("Orders API"));
    expect(at("Orders API")).toBeLessThan(at("Consumed Data Flow"));
    expect(at("Consumed Data Flow")).toBeLessThan(at("Billing Feed"));
    expect(at("Billing Feed")).toBeLessThan(at("Unspecified"));
    expect(at("Unspecified")).toBeLessThan(at("Legacy Link"));
    expect(screen.getByText("Odd Link")).toBeInTheDocument();
    expect(at("Unspecified")).toBeLessThan(at("Odd Link"));
    // No flat list beside the buckets: every card is listed exactly once.
    for (const name of ["Orders API", "Billing Feed", "Legacy Link", "Odd Link"]) {
      expect(screen.getAllByText(name)).toHaveLength(1);
    }
    // Unset rows advertise the empty slot with the `label` glyph.
    const unset = screen.getAllByRole("button", { name: "Edit details" });
    expect(unset).toHaveLength(2);
    for (const b of unset) expect(b).toHaveTextContent("label");
    // The group's + names the type by its label, not its key.
    expect(screen.getByRole("button", { name: /Add Data Flow · provides/ })).toBeInTheDocument();
  });

  it("keeps the Provided bucket on screen while only consumers exist", async () => {
    routeRelations([flowRel("r", "Billing Feed", "reverse")]);
    mount();

    expect(await screen.findByText("Billing Feed")).toBeInTheDocument();
    expect(screen.getByText("Provided Data Flow")).toBeInTheDocument();
    expect(screen.getByText("None yet")).toBeInTheDocument();
  });

  it("shows no role buckets while the group is empty", async () => {
    mount();

    expect(await screen.findByText("provides")).toBeInTheDocument();
    await settle();
    expect(screen.getByText("No relations yet.")).toBeInTheDocument();
    expect(screen.queryByText("Provided Data Flow")).not.toBeInTheDocument();
    expect(screen.queryByText("Consumed Data Flow")).not.toBeInTheDocument();
  });

  it("keeps the role buckets, never subtype buckets, when the cards have subtypes", async () => {
    withMetamodel([APP, FLOW_SUBTYPED], [APP_TO_FLOW]);
    routeRelations(
      Array.from({ length: 8 }, (_, i) =>
        flowRel(String(i), `Flow ${i}`, "forward", i % 2 ? "a" : "b"),
      ),
    );
    mount();

    expect(await screen.findByText("Flow 7")).toBeInTheDocument();
    await settle();
    expect(screen.getByText("Provided Data Flow")).toBeInTheDocument();
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
    expect(screen.getAllByText("Flow 7")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Group by subtype" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show as flat list" })).not.toBeInTheDocument();
  });
});

describe("RelationsSection — attribute row", () => {
  it("drops the dashed outline once a value is set", async () => {
    routeRelations([
      rel("1", "Finance", { attributes: { usageType: "owner" } }),
      rel("2", "Legal"),
    ]);
    mount();

    const set = await screen.findByRole("button", { name: "Usage Type: Owner" });
    expect(set).not.toHaveStyle({ borderStyle: "dashed" });
    expect(screen.getByRole("button", { name: "Edit details" })).toHaveStyle({
      borderStyle: "dashed",
    });
  });

  it("opens without an error, locks both buttons while saving, and updates only that row", async () => {
    routeRelations([
      rel("1", "Finance", { attributes: { usageType: "user" } }),
      rel("2", "Legal"),
    ]);
    let release: () => void = () => {};
    mockApi.on(
      "patch",
      "/relations/1",
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({ ...rel("1", "Finance"), attributes: { usageType: "owner" }, description: null });
        }),
    );
    const { user } = mount();

    await user.click(await screen.findByRole("button", { name: "Usage Type: User" }));
    expect(await screen.findByText("Optional details")).toBeInTheDocument();
    await settle();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(mockApi.callsOf("patch", "/relations/1")[0].body).toEqual({
      attributes: { usageType: "user" },
    });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await settle(() => release());
    await waitFor(() => expect(screen.queryByText("Optional details")).not.toBeInTheDocument());
    expect(screen.getAllByText("Owner")).toHaveLength(1);
    expect(within(rowOf("Finance")).getByText("Owner")).toBeInTheDocument();
    expect(within(rowOf("Legal")).getByRole("button", { name: "Edit details" })).toBeInTheDocument();
  });
});

describe("RelationsSection — a card reached through several relation types", () => {
  beforeEach(() =>
    withMetamodel([APP, ORG], [APP_TO_ORG, APP_TO_ORG_OWNS, APP_TO_ORG_RUNS]),
  );

  it("captions each row with every OTHER verb, joined with a slash", async () => {
    routeRelations([
      rel("1", "Finance", { targetId: "org-x" }),
      rel("2", "Finance", { type: "appToOrgOwns", targetId: "org-x" }),
      rel("3", "Finance", { type: "appToOrgRuns", targetId: "org-x" }),
      rel("4", "Legal"),
    ]);
    mount();

    expect(await screen.findByText("Also owns / runs")).toBeInTheDocument();
    expect(screen.getByText("Also is used by / runs")).toBeInTheDocument();
    expect(screen.getByText("Also is used by / owns")).toBeInTheDocument();
    expect(rowOf("Legal").textContent).not.toContain("Also");
  });

  it("counts a duplicate row of one type once", async () => {
    routeRelations([
      rel("1", "Finance", { targetId: "org-x" }),
      rel("2", "Finance", { type: "appToOrgOwns", targetId: "org-x" }),
      rel("3", "Finance", { targetId: "org-x" }),
    ]);
    mount();

    expect(await screen.findByText("Also is used by")).toBeInTheDocument();
    expect(screen.getAllByText("Also owns")).toHaveLength(2);
    expect(screen.queryByText(/is used by \/ is used by/)).not.toBeInTheDocument();
  });

  it("captions no row whose other end is unknown", async () => {
    routeRelations([{ ...rel("1", "x"), target: undefined } as unknown as Relation]);
    mount();

    expect(await screen.findByText("Unknown")).toBeInTheDocument();
    expect(screen.queryByText(/^Also /)).not.toBeInTheDocument();
  });
});

describe("RelationsSection — subtype grouping", () => {
  it("offers no toggle while only one real subtype is present", async () => {
    routeRelations([rel("1", "Sales", { subtype: "bu" }), rel("2", "Ad-hoc team")]);
    mount();

    expect(await screen.findByText("Ad-hoc team")).toBeInTheDocument();
    await settle();
    expect(screen.queryByRole("button", { name: "Group by subtype" })).not.toBeInTheDocument();
    expect(screen.queryByText("No subtype")).not.toBeInTheDocument();
  });

  it("shows the grouping glyph on the toggle and the list glyph once grouped", async () => {
    routeRelations([rel("1", "Sales", { subtype: "bu" }), rel("2", "EMEA", { subtype: "region" })]);
    const { user } = mount();

    const toggle = await screen.findByRole("button", { name: "Group by subtype" });
    expect(toggle).toHaveTextContent("account_tree");
    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Show as flat list" })).toHaveTextContent(
      "format_list_bulleted",
    );
    // Grouped: each card under its subtype's header.
    expect(screen.getByText("Business Unit")).toBeInTheDocument();
    expect(screen.getByText("Region")).toBeInTheDocument();
    expect(screen.getAllByText("Sales")).toHaveLength(1);
    expect(screen.getAllByText("EMEA")).toHaveLength(1);
  });

  it("offers the toggle once the other card type gains subtypes", async () => {
    withMetamodel([APP, ORG_NO_SUBTYPES], [APP_TO_ORG]);
    routeRelations([rel("1", "Sales", { subtype: "bu" }), rel("2", "EMEA", { subtype: "region" })]);
    const view = mount();

    expect(await screen.findByText("EMEA")).toBeInTheDocument();
    await settle();
    expect(screen.queryByRole("button", { name: "Group by subtype" })).not.toBeInTheDocument();

    withMetamodel([APP, ORG], [APP_TO_ORG]);
    await settle(() => view.rerenderWith({}));
    expect(screen.getByRole("button", { name: "Group by subtype" })).toBeInTheDocument();
  });

  it("keeps the user's flat list when the list grows back past the auto-group size", async () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      rel(String(i), `Org ${i}`, { subtype: i % 2 ? "bu" : "region" }),
    );
    let rows = many;
    mockApi.on("get", `/relations?card_id=${FS}`, () => rows);
    const view = mount();

    await view.user.click(await screen.findByRole("button", { name: "Show as flat list" }));
    expect(screen.queryByText("Business Unit")).not.toBeInTheDocument();

    rows = many.slice(0, 3);
    await settle(() => view.rerenderWith({ refreshKey: 1 }));
    expect(screen.queryByText("Org 7")).not.toBeInTheDocument();

    rows = many;
    await settle(() => view.rerenderWith({ refreshKey: 2 }));
    expect(screen.getByText("Org 7")).toBeInTheDocument();
    expect(screen.queryByText("Business Unit")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Group by subtype" })).toBeInTheDocument();
  });
});

describe("RelationsSection — descendant roll-up", () => {
  it("shows the chip with its tooltip as the name, and keeps the drawer closed until clicked", async () => {
    mockApi.on("get", `/cards/${FS}/descendant-relations/summary`, [
      { relation_type_key: "appToOrg", direction: "outgoing", count: 3 },
    ]);
    const { user } = mount();

    const chip = await screen.findByRole("button", {
      name: "Show cards linked to this card's sub-items",
    });
    expect(chip).toHaveTextContent("+3 in sub-items");
    expect(screen.queryByTestId("rollup-drawer")).not.toBeInTheDocument();
    await user.click(chip);
    expect(await screen.findByTestId("rollup-drawer")).toHaveAttribute("data-rt", "appToOrg");
  });

  it("starts collapsed by default and fetches the roll-up only once opened", async () => {
    mockApi.on("get", `/cards/${FS}/descendant-relations/summary`, [
      { relation_type_key: "appToOrg", direction: "outgoing", count: 3 },
    ]);
    const { user } = mount({ initialExpanded: undefined });

    const summary = screen.getByRole("button", { name: /Relations/ });
    expect(summary).toHaveAttribute("aria-expanded", "false");
    await settle();
    expect(mockApi.callsOf("get", /descendant-relations/)).toHaveLength(0);

    await user.click(summary);
    expect(await screen.findByText("+3 in sub-items")).toBeInTheDocument();
    expect(mockApi.callsOf("get", /descendant-relations/)).toHaveLength(1);
  });

  it("ignores a roll-up answer that arrives after the section was refreshed", async () => {
    let calls = 0;
    let releaseStale: () => void = () => {};
    mockApi.on("get", `/cards/${FS}/descendant-relations/summary`, () => {
      calls += 1;
      if (calls === 1) {
        return new Promise((resolve) => {
          releaseStale = () =>
            resolve([{ relation_type_key: "appToOrg", direction: "outgoing", count: 5 }]);
        });
      }
      return [{ relation_type_key: "appToOrg", direction: "outgoing", count: 2 }];
    });
    const view = mount();
    await waitFor(() => expect(calls).toBe(1));

    await settle(() => view.rerenderWith({ refreshKey: 1 }));
    expect(screen.getByText("+2 in sub-items")).toBeInTheDocument();

    await settle(() => releaseStale());
    expect(screen.getByText("+2 in sub-items")).toBeInTheDocument();
    expect(screen.queryByText("+5 in sub-items")).not.toBeInTheDocument();
  });

  it("renders for a card type the metamodel does not know, asking for no roll-up", async () => {
    withMetamodel(
      [ORG],
      [
        makeRelationType({
          key: "ghostToOrg",
          label: "haunts",
          source_type_key: "Ghost",
          target_type_key: "Organization",
        }),
      ],
    );
    mount({ cardTypeKey: "Ghost" });

    expect(await screen.findByText("haunts")).toBeInTheDocument();
    await settle();
    expect(mockApi.callsOf("get", /descendant-relations/)).toHaveLength(0);
  });
});

describe("RelationsSection — optimistic updates from the add dialog", () => {
  async function openDialog() {
    const view = mount();
    await screen.findByText("Finance");
    await view.user.click(screen.getByRole("button", { name: /Add Organization · is used by/ }));
    await screen.findByTestId("add-dialog");
    return view;
  }

  beforeEach(() => routeRelations([rel("1", "Finance"), rel("2", "Legal")]));

  it("appends an added card, once, however often the dialog reports it", async () => {
    const { user } = await openDialog();
    dlg.added = rel("9", "Payroll");

    await user.click(screen.getByText("dlg-add"));
    expect(await screen.findByText("Payroll")).toBeInTheDocument();
    await user.click(screen.getByText("dlg-add"));
    await settle();
    expect(screen.getAllByText("Payroll")).toHaveLength(1);
    expect(screen.getByText("Finance")).toBeInTheDocument();
  });

  it("drops only the undone card", async () => {
    const { user } = await openDialog();
    dlg.removedId = "1";

    await user.click(screen.getByText("dlg-remove"));
    await waitFor(() => expect(screen.queryByText("Finance")).not.toBeInTheDocument());
    expect(screen.getByText("Legal")).toBeInTheDocument();
  });

  it("overlays an edit onto the edited card only", async () => {
    const { user } = await openDialog();
    dlg.updated = { id: "1", attributes: { usageType: "owner" }, description: null };

    await user.click(screen.getByText("dlg-update"));
    expect(await screen.findByText("Owner")).toBeInTheDocument();
    expect(screen.getAllByText("Owner")).toHaveLength(1);
    expect(within(rowOf("Finance")).getByText("Owner")).toBeInTheDocument();
  });
});

describe("RelationsSection — props that change after mount", () => {
  it("loads the new card's relations when the card id changes", async () => {
    routeRelations([rel("1", "Finance")]);
    routeRelations([rel("7", "Payroll", { sourceId: "app-2" })], "app-2");
    const view = mount();
    expect(await screen.findByText("Finance")).toBeInTheDocument();

    await settle(() => view.rerenderWith({ fsId: "app-2" }));
    expect(mockApi.callsOf("get", "/relations?card_id=app-2")).toHaveLength(1);
    expect(screen.getByText("Payroll")).toBeInTheDocument();
  });

  it("reloads when the refresh counter moves", async () => {
    const view = mount();
    await waitFor(() => expect(mockApi.callsOf("get", `/relations?card_id=${FS}`)).toHaveLength(1));

    await settle(() => view.rerenderWith({ refreshKey: 1 }));
    expect(mockApi.callsOf("get", `/relations?card_id=${FS}`)).toHaveLength(2);
  });

  it("drops a load error once a refresh loads the relations", async () => {
    mockApi.fail("get", `/relations?card_id=${FS}`, 500);
    const view = mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(`GET /relations?card_id=${FS} failed`);

    routeRelations([rel("1", "Finance")]);
    view.rerenderWith({ refreshKey: 1 });
    expect(await screen.findByText("Finance")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("refreshes the card through the latest onCardUpdate", async () => {
    let rows = [rel("1", "Finance"), rel("2", "Legal")];
    mockApi.on("get", `/relations?card_id=${FS}`, () => rows);
    mockApi.on("delete", "/relations/1", () => {
      rows = [rel("2", "Legal")];
      return undefined;
    });
    const first = vi.fn();
    const second = vi.fn();
    const view = mount({ onCardUpdate: first });
    await screen.findByText("Finance");

    view.rerenderWith({ onCardUpdate: second });
    await view.user.click(within(rowOf("Finance")).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(second).toHaveBeenCalledTimes(1));
    expect(first).not.toHaveBeenCalled();
  });

  it("builds its groups once a late metamodel arrives", async () => {
    withMetamodel([], []);
    const view = mount();
    await settle();
    expect(screen.queryByText("is used by")).not.toBeInTheDocument();

    withMetamodel(
      [APP, ORG, OBJ],
      [APP_TO_ORG, { ...APP_TO_OBJ, source_visible: false }, APP_LINEAGE],
    );
    await settle(() => view.rerenderWith({}));
    expect(screen.getByText("is used by")).toBeInTheDocument();
    // The no-group side is reached through the section's menu.
    expect(screen.getByRole("button", { name: /Add Relation/ })).toBeInTheDocument();
    // The lineage relation belongs to SuccessorsSection.
    expect(screen.queryByText("precedes")).not.toBeInTheDocument();
    expect(screen.queryByText("succeeds")).not.toBeInTheDocument();
  });
});

describe("RelationsSection — which relation types get a group", () => {
  it("skips a hidden relation type and the lineage relation", async () => {
    withMetamodel([APP, ORG, OBJ], [APP_TO_ORG, { ...APP_TO_OBJ, is_hidden: true }, APP_LINEAGE]);
    mount();

    expect(await screen.findByText("is used by")).toBeInTheDocument();
    expect(screen.queryByText("supports")).not.toBeInTheDocument();
    expect(screen.queryByText("precedes")).not.toBeInTheDocument();
    expect(screen.queryByText("succeeds")).not.toBeInTheDocument();
  });

  it("checks the SOURCE type's visibility for a relation the card is the target of", async () => {
    withMetamodel([APP, ORG, OBJ], [APP_TO_ORG, OBJ_TO_ORG]);
    const denied = makeUser({
      role: "member",
      permissions: { "inventory.view": true },
      type_permissions: { Application: { "inventory.view": false } },
    });
    routeRelations([], "org-1");
    mount({ cardTypeKey: "Organization", fsId: "org-1" }, denied);

    expect(await screen.findByText("is steered by")).toBeInTheDocument();
    expect(screen.queryByText("uses")).not.toBeInTheDocument();
  });

  it("keeps the groups for a role that reaches the card without inventory.view", async () => {
    mount({}, userWith("ppm.view"));
    expect(await screen.findByText("is used by")).toBeInTheDocument();
  });
});

describe("RelationsSection — relation types without a group of their own", () => {
  const hiddenFlowSide: RelationType = { ...APP_TO_FLOW, source_visible: false };

  it("lists a no-group side's cards without a Required chip or a section empty line", async () => {
    withMetamodel([APP, FLOW], [hiddenFlowSide]);
    routeRelations([flowRel("f", "Orders API", "forward")]);
    mount();

    expect(await screen.findByText("Orders API")).toBeInTheDocument();
    expect(screen.queryByText("Required")).not.toBeInTheDocument();
    expect(screen.queryByText("No relations yet.")).not.toBeInTheDocument();
  });

  it("names the menu entry by the type label and closes the menu on pick", async () => {
    withMetamodel([APP, ORG, FLOW], [APP_TO_ORG, hiddenFlowSide]);
    const { user } = mount();

    await user.click(await screen.findByRole("button", { name: /Add Relation/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Data Flow — provides" }));
    expect(await screen.findByTestId("add-dialog")).toHaveAttribute("data-rt", "appToFlow");
    await waitFor(() => expect(screen.queryByRole("menuitem")).not.toBeInTheDocument());
  });

  it("offers a read-only user no Add menu", async () => {
    withMetamodel([APP, ORG, FLOW], [APP_TO_ORG, hiddenFlowSide]);
    mount({ canManageRelations: false });

    expect(await screen.findByText("is used by")).toBeInTheDocument();
    await settle();
    expect(screen.queryByRole("button", { name: /Add Relation/ })).not.toBeInTheDocument();
  });
});

describe("RelationsSection — load state and the header count", () => {
  function headerCount(): HTMLElement | null {
    const header = screen.getByText("Relations").parentElement as HTMLElement;
    return header.querySelector(".MuiChip-root");
  }

  it("shows no error while the relations load, then counts them in the header", async () => {
    let release!: (rows: Relation[]) => void;
    mockApi.on(
      "get",
      `/relations?card_id=${FS}`,
      () => new Promise<Relation[]>((resolve) => (release = resolve)),
    );
    mount();
    await waitFor(() => expect(mockApi.callsOf("get", `/relations?card_id=${FS}`)).toHaveLength(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("is used by")).toBeInTheDocument();

    await act(async () => release([rel("1", "Finance"), rel("2", "Legal")]));
    expect(await screen.findByText("Finance")).toBeInTheDocument();
    const count = headerCount();
    expect(count).toHaveTextContent("2");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows no count in the header when the relations cannot be loaded", async () => {
    mockApi.fail("get", `/relations?card_id=${FS}`, 500);
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      `GET /relations?card_id=${FS} failed`,
    );
    expect(headerCount()).toBeNull();
  });

  it("re-reads the relations from the alert's Retry button", async () => {
    mockApi.fail("get", `/relations?card_id=${FS}`, 500);
    const view = mount();
    const alert = await screen.findByRole("alert");

    routeRelations([rel("1", "Finance")]);
    await view.user.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Finance")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(headerCount()).toHaveTextContent("1");
    expect(mockApi.callsOf("get", `/relations?card_id=${FS}`)).toHaveLength(2);
  });

  it("ignores a reload's reply once a newer reload has landed", async () => {
    routeRelations([rel("1", "Finance")]);
    const view = mount();
    expect(await screen.findByText("Finance")).toBeInTheDocument();

    // A refresh (say, after a write) whose answer is slow…
    let releaseStale!: (rows: Relation[]) => void;
    mockApi.on(
      "get",
      `/relations?card_id=${FS}`,
      () => new Promise<Relation[]>((resolve) => (releaseStale = resolve)),
    );
    await settle(() => view.rerenderWith({ refreshKey: 1 }));
    // …overtaken by the next refresh.
    routeRelations([rel("2", "Legal")]);
    await settle(() => view.rerenderWith({ refreshKey: 2 }));
    expect(await screen.findByText("Legal")).toBeInTheDocument();

    await settle(() => releaseStale([rel("3", "Stale")]));
    expect(screen.queryByText("Stale")).not.toBeInTheDocument();
    expect(screen.getByText("Legal")).toBeInTheDocument();
  });

  it("ignores a reload's failure once a newer reload has landed", async () => {
    routeRelations([rel("1", "Finance")]);
    const view = mount();
    expect(await screen.findByText("Finance")).toBeInTheDocument();

    let failStale!: (e: unknown) => void;
    mockApi.on(
      "get",
      `/relations?card_id=${FS}`,
      () => new Promise<Relation[]>((_, reject) => (failStale = reject)),
    );
    await settle(() => view.rerenderWith({ refreshKey: 1 }));
    routeRelations([rel("2", "Legal")]);
    await settle(() => view.rerenderWith({ refreshKey: 2 }));
    expect(await screen.findByText("Legal")).toBeInTheDocument();

    await settle(() => failStale(new Error("the stale reload failed")));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Legal")).toBeInTheDocument();
  });

  it("closes a failed remove's error from its close button", async () => {
    routeRelations([rel("1", "Finance")]);
    mockApi.fail("delete", "/relations/1", 500);
    const view = mount();
    await screen.findByText("Finance");

    await view.user.click(within(rowOf("Finance")).getByRole("button", { name: "Remove" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("DELETE /relations/1 failed");

    await view.user.click(within(alert).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Finance")).toBeInTheDocument();
  });
});
