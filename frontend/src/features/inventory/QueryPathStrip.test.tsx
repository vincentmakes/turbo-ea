import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  makeCardType,
  makeField,
  makeOption,
  makeRelationType,
  makeSection,
  makeSubtype,
  makeTag,
  makeTagGroup,
} from "@/test/fixtures/metamodel";
import type { ActiveQuery, Card, QueryDraft, TagGroup, User } from "@/types";
import QueryPathStrip from "./QueryPathStrip";

vi.mock("@/api/cardsByIds", () => ({ fetchCardsByIdsDetailed: vi.fn() }));
// The picker is a whole card browser; the strip only needs what it applies.
vi.mock("@/components/CardMultiPicker", () => ({
  default: (props: {
    open: boolean;
    types?: string | string[];
    onChange: (ids: string[], picked: { id: string; name: string; type: string }[]) => void;
  }) =>
    props.open ? (
      <button
        data-testid="card-multi-picker"
        data-types={String(props.types)}
        onClick={() =>
          props.onChange(
            ["app-1", "app-2"],
            [
              { id: "app-1", name: "Alpha", type: "Application" },
              { id: "app-2", name: "Beta", type: "Application" },
            ],
          )
        }
      >
        apply-picker
      </button>
    ) : null,
}));

vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useIsRtl", () => import("@/test/hooks").then((m) => m.useIsRtlModule()));
// The signed-in user decides which card types the builder offers.
vi.mock("@/hooks/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/AuthContext")>("@/hooks/AuthContext");
  const { hookState: state } = await import("@/test/hooks");
  return { ...actual, useOptionalAuthUser: () => state.auth.user };
});

import { hookState, withMetamodel } from "@/test/hooks";
import { fetchCardsByIdsDetailed } from "@/api/cardsByIds";

const fetchCards = vi.mocked(fetchCardsByIdsDetailed);

// Labels deliberately differ from keys, so a key leaking into the strip fails.
const ORG = makeCardType({
  key: "Organization",
  label: "Org Unit",
  icon: "corporate_fare",
  has_hierarchy: true,
});
const APP = makeCardType({
  key: "Application",
  label: "Business App",
  icon: "apps",
  fields_schema: [
    makeSection({
      fields: [
        makeField({
          key: "criticality",
          label: "Business Criticality",
          type: "single_select",
          options: [
            makeOption({ key: "high", label: "Mission critical" }),
            makeOption({ key: "low", label: "Nice to have" }),
          ],
        }),
        makeField({ key: "isCloud", label: "Cloud hosted", type: "boolean" }),
        makeField({ key: "notes", label: "Notes", type: "text" }),
      ],
    }),
  ],
});
const INIT = makeCardType({
  key: "Initiative",
  label: "Change Initiative",
  subtypes: [makeSubtype({ key: "proj", label: "Project" })],
  fields_schema: [
    makeSection({
      fields: [
        makeField({
          key: "initiativeStatus",
          label: "Delivery Status",
          type: "single_select",
          options: [makeOption({ key: "onTrack", label: "On Track" })],
        }),
      ],
    }),
  ],
});
const HIDDEN = makeCardType({ key: "Legacy", label: "Legacy Thing", is_hidden: true });
const SECRET = makeCardType({ key: "Secret", label: "Secret Stuff" });

const REL_ORG_TO_APP = makeRelationType({
  key: "relOrgToApp",
  label: "uses",
  reverse_label: "is used by",
  source_type_key: "Organization",
  target_type_key: "Application",
});
const REL_INIT_TO_APP = makeRelationType({
  key: "relInitiativeToApp",
  label: "affects",
  reverse_label: "is affected by",
  source_type_key: "Initiative",
  target_type_key: "Application",
});
const REL_APP_TO_APP = makeRelationType({
  key: "relAppToApp",
  label: "calls",
  reverse_label: "is called by",
  source_type_key: "Application",
  target_type_key: "Application",
});
const REL_APP_TO_SECRET = makeRelationType({
  key: "relAppToSecret",
  label: "leaks",
  source_type_key: "Application",
  target_type_key: "Secret",
});
const REL_HIDDEN = makeRelationType({
  key: "relHidden",
  label: "secretly owns",
  source_type_key: "Application",
  target_type_key: "Organization",
  is_hidden: true,
});

const DOMAIN = makeTagGroup({ name: "Domain" });
const FINANCE = makeTag({ name: "Finance", tag_group_id: DOMAIN.id });
const SALES = makeTag({ name: "Sales", tag_group_id: DOMAIN.id });
DOMAIN.tags = [FINANCE, SALES];
const ORG_ONLY = makeTagGroup({ name: "Org Only", restrict_to_types: ["Organization"] });
const HQ = makeTag({ name: "Hq", tag_group_id: ORG_ONLY.id });
ORG_ONLY.tags = [HQ];
const TAG_GROUPS: TagGroup[] = [DOMAIN, ORG_ONLY];

const MEMBER: User = {
  id: "u-member",
  email: "member@example.com",
  display_name: "Member",
  role: "member",
  is_active: true,
  permissions: { "inventory.view": true },
  type_permissions: { Secret: { "inventory.view": false } },
} as User;

const VIEW: ActiveQuery = {
  viewId: "bm-q",
  name: "Orgs on live apps in flight",
  createdVia: "mcp",
  query: {
    type: "Organization",
    where: { approval_status: ["APPROVED"] },
    related: [
      {
        relation: "relOrgToApp",
        type: "Application",
        where: {
          lifecycle_phase: ["active", "none"],
          attributes: { criticality: ["high", "__empty__"], isCloud: ["true"] },
        },
        related: [
          {
            relation: "relInitiativeToApp",
            type: "Initiative",
            where: { subtype: ["proj"], attributes: { initiativeStatus: ["onTrack"] } },
          },
        ],
      },
      { relation: "relOrgToApp", type: "Application", negate: true },
    ],
  },
};

beforeEach(() => {
  fetchCards.mockReset();
  fetchCards.mockResolvedValue({ cards: [], withheldIds: [] });
  hookState.reset();
  hookState.auth.user = MEMBER;
  withMetamodel(
    [ORG, APP, INIT, HIDDEN, SECRET],
    [REL_ORG_TO_APP, REL_INIT_TO_APP, REL_APP_TO_APP, REL_APP_TO_SECRET, REL_HIDDEN],
  );
});

function arrows(): HTMLElement[] {
  return screen
    .getAllByTestId("query-path-hop")
    .map((hop) => within(hop).getAllByText("arrow_forward")[0]);
}

/** The texts of the open menu's items, icons left out. */
function menuLabels(): string[] {
  return within(screen.getByRole("menu"))
    .getAllByRole("menuitem")
    .map((el) => (el.querySelector(".MuiListItemText-root") ?? el).textContent ?? "");
}

function pick(label: string) {
  fireEvent.click(within(screen.getByRole("menu")).getByText(label));
}

function deleteChip(label: string) {
  const chip = screen.getByText(label).closest(".MuiChip-root") as HTMLElement;
  fireEvent.click(chip.querySelector(".MuiChip-deleteIcon") as Element);
}

/** Opens the condition editor's dropdown and clicks one option. */
function chooseOption(label: string) {
  const popover = screen.getByTestId("query-condition-popover");
  // The list stays open between picks (`disableCloseOnSelect`).
  if (!screen.queryByRole("listbox")) fireEvent.mouseDown(within(popover).getByRole("combobox"));
  fireEvent.click(screen.getByRole("option", { name: label }));
}

function addCondition(label: string, node = 0) {
  fireEvent.click(screen.getAllByTestId("query-path-add-condition")[node]);
  pick(label);
}

/** The strip in edit mode, holding its draft like the page does. */
function renderEditor(initial: QueryDraft, props: Partial<Parameters<typeof QueryPathStrip>[0]> = {}) {
  const drafts: QueryDraft[] = [];
  function Harness() {
    const [draft, setDraft] = useState<QueryDraft>(initial);
    return (
      <QueryPathStrip
        view={null}
        tagGroups={TAG_GROUPS}
        onLeave={() => {}}
        {...props}
        draft={draft}
        onDraftChange={(d) => {
          drafts.push(d);
          setDraft(d);
        }}
      />
    );
  }
  const { unmount } = render(<Harness />);
  return { drafts, last: () => drafts[drafts.length - 1], unmount };
}

describe("QueryPathStrip — view mode", () => {
  it("renders nothing without an active query or a draft", () => {
    const { container } = render(<QueryPathStrip view={null} onLeave={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("marks an MCP-created view with the origin chip and its caption", () => {
    render(<QueryPathStrip view={VIEW} onLeave={() => {}} />);
    const strip = screen.getByTestId("query-path-strip");
    expect(strip.querySelector('[data-origin="mcp"]')).not.toBeNull();
    expect(within(strip).getByText("Orgs on live apps in flight")).toBeInTheDocument();
    const caption = within(strip).getByText("Created via MCP");
    expect(caption).toHaveAttribute("title", expect.stringContaining("An AI assistant wrote"));
    expect(screen.queryByText(/editable only via MCP/)).not.toBeInTheDocument();
  });

  it("says nothing about the origin of a view made in the web UI", () => {
    render(<QueryPathStrip view={{ ...VIEW, createdVia: "web" }} onLeave={() => {}} />);
    const strip = screen.getByTestId("query-path-strip");
    expect(strip.querySelector("[data-origin]")).toBeNull();
    expect(screen.queryByText("Created via MCP")).not.toBeInTheDocument();
  });

  it("shows the pencil only to someone who may edit the view", () => {
    const onEdit = vi.fn();
    const { rerender } = render(<QueryPathStrip view={VIEW} onLeave={() => {}} onEdit={onEdit} />);
    expect(screen.queryByTestId("query-path-edit")).not.toBeInTheDocument();
    rerender(<QueryPathStrip view={VIEW} canEdit onLeave={() => {}} onEdit={onEdit} />);
    const pencil = screen.getByRole("button", { name: "Edit the query" });
    expect(pencil).toHaveAttribute("data-testid", "query-path-edit");
    expect(onEdit).not.toHaveBeenCalled();
    fireEvent.click(pencil);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("resolves type labels, never keys", () => {
    render(<QueryPathStrip view={VIEW} onLeave={() => {}} />);
    expect(screen.getByText("Org Unit")).toBeInTheDocument();
    expect(screen.getAllByText("Business App")).toHaveLength(2);
    expect(screen.getByText("Change Initiative")).toBeInTheDocument();
    expect(screen.queryByText("Organization")).not.toBeInTheDocument();
    expect(screen.queryByText("Initiative")).not.toBeInTheDocument();
  });

  it("reads each hop's verb from the side under view", () => {
    render(<QueryPathStrip view={VIEW} onLeave={() => {}} />);
    const hops = screen.getAllByTestId("query-path-hop");
    expect(hops).toHaveLength(3);
    expect(within(hops[0]).getAllByText("uses")[0]).toBeInTheDocument();
    expect(within(hops[1]).getByText("is affected by")).toBeInTheDocument();
    expect(screen.queryByText("affects")).not.toBeInTheDocument();
  });

  it("prefixes a negated hop with has no and joins sibling hops with and", () => {
    render(<QueryPathStrip view={VIEW} onLeave={() => {}} />);
    const hops = screen.getAllByTestId("query-path-hop");
    expect(within(hops[2]).getByText("has no uses")).toBeInTheDocument();
    expect(screen.getAllByText("and")).toHaveLength(1);
    expect(screen.getAllByText(/has no/)).toHaveLength(1);
  });

  it("labels each condition with its field and option labels", () => {
    render(<QueryPathStrip view={VIEW} onLeave={() => {}} />);
    expect(screen.getByText("Approval Status: Approved")).toBeInTheDocument();
    expect(screen.getByText("Lifecycle: Active, (empty)")).toBeInTheDocument();
    expect(screen.getByText("Business Criticality: Mission critical, (empty)")).toBeInTheDocument();
    expect(screen.getByText("Cloud hosted: Yes")).toBeInTheDocument();
    expect(screen.getByText("Subtype: Project")).toBeInTheDocument();
    expect(screen.getByText("Delivery Status: On Track")).toBeInTheDocument();
  });

  it("shows No for a false flag and the raw value for free text", () => {
    const view: ActiveQuery = {
      ...VIEW,
      query: {
        type: "Application",
        where: { attributes: { isCloud: ["false"], notInSchema: ["abc"] } },
      },
    };
    render(<QueryPathStrip view={view} onLeave={() => {}} />);
    expect(screen.getByText("Cloud hosted: No")).toBeInTheDocument();
    expect(screen.getByText("notInSchema: abc")).toBeInTheDocument();
    expect(screen.queryByTestId("query-path-hop")).not.toBeInTheDocument();
  });

  it("shows tags as one chip per group, and an unknown tag as such", () => {
    const view: ActiveQuery = {
      ...VIEW,
      query: { type: "Organization", where: { tags: [HQ.id, FINANCE.id, "gone", SALES.id] } },
    };
    render(<QueryPathStrip view={view} tagGroups={TAG_GROUPS} onLeave={() => {}} />);
    const chips = Array.from(
      screen.getByTestId("query-path-strip").querySelectorAll(".MuiChip-label"),
    ).map((el) => el.textContent);
    expect(chips).toEqual(["MCP", "Org Unit", "Org Only: Hq", "Domain: Finance, Sales", "(unknown tag)"]);
  });

  it("leaves the view from the close button", () => {
    const onLeave = vi.fn();
    render(<QueryPathStrip view={VIEW} onLeave={onLeave} />);
    const leave = screen.getByRole("button", { name: "Leave this view" });
    expect(leave).toHaveAttribute("data-testid", "query-path-leave");
    expect(onLeave).not.toHaveBeenCalled();
    fireEvent.click(leave);
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("points the arrows the reading direction", () => {
    const { unmount } = render(<QueryPathStrip view={VIEW} onLeave={() => {}} />);
    for (const arrow of arrows()) expect(arrow.style.transform).toBe("");
    unmount();

    hookState.isRtl = true;
    render(<QueryPathStrip view={VIEW} onLeave={() => {}} />);
    const flipped = arrows();
    expect(flipped).toHaveLength(3);
    for (const arrow of flipped) expect(arrow.style.transform).toBe("scaleX(-1)");
  });
});

describe("QueryPathStrip — edit mode", () => {
  it("titles a new draft and an edited view, with Save and Cancel", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    const { unmount } = renderEditor(
      { query: { type: "Application" }, viewId: null },
      { onSave, onCancel },
    );
    expect(screen.getByText("New query view")).toBeInTheDocument();
    expect(screen.queryByTestId("query-path-leave")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("query-path-save"));
    expect(onSave).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("query-path-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    unmount();

    renderEditor({ query: VIEW.query, viewId: "bm-q" }, { view: VIEW });
    expect(screen.getByText("Edit query view")).toBeInTheDocument();
    expect(screen.getByText("Orgs on live apps in flight")).toBeInTheDocument();
    expect(screen.queryByText("New query view")).not.toBeInTheDocument();
  });

  it("disables Save without a type, with an empty condition, and while saving", () => {
    const { unmount } = renderEditor({ query: { type: "" }, viewId: null });
    expect(screen.getByTestId("query-path-start-type")).toHaveTextContent("Choose a type");
    expect(screen.getByTestId("query-path-save")).toBeDisabled();
    expect(screen.queryByTestId("query-path-add-condition")).not.toBeInTheDocument();
    expect(screen.queryByTestId("query-path-add-hop")).not.toBeInTheDocument();
    unmount();

    const second = renderEditor({ query: { type: "Initiative", where: { subtype: [] } }, viewId: null });
    expect(screen.getByTestId("query-path-save")).toBeDisabled();
    second.unmount();

    renderEditor({ query: { type: "Initiative" }, viewId: null }, { saving: true });
    expect(screen.getByTestId("query-path-save")).toBeDisabled();
  });

  it("offers readable, visible types by label, and a new start type resets the chain", () => {
    const { last } = renderEditor({ query: VIEW.query, viewId: "bm-q" });
    fireEvent.click(screen.getByTestId("query-path-start-type"));
    expect(menuLabels()).toEqual(["Business App", "Change Initiative", "Org Unit"]);
    pick("Business App");
    expect(last()).toEqual({ query: { type: "Application" }, viewId: "bm-q" });
    expect(screen.queryByTestId("query-path-hop")).not.toBeInTheDocument();
  });

  it("adds a hop by verb and type, both sides of a self-reference", () => {
    const { last } = renderEditor({ query: { type: "Application" }, viewId: null });
    fireEvent.click(screen.getByTestId("query-path-add-hop"));
    expect(menuLabels()).toEqual([
      "is used by Org Unit",
      "is affected by Change Initiative",
      "calls Business App",
      "is called by Business App",
    ]);
    pick("calls Business App");
    expect(last()).toEqual({
      query: { type: "Application", related: [{ relation: "relAppToApp__out", type: "Application" }] },
      viewId: null,
    });
    expect(screen.getByTestId("query-path-verb")).toHaveTextContent("calls");

    fireEvent.click(screen.getByTestId("query-path-add-hop"));
    pick("is used by Org Unit");
    expect(last().query.related![0].related).toEqual([{ relation: "relOrgToApp", type: "Organization" }]);
    expect(screen.getAllByTestId("query-path-verb")[1]).toHaveTextContent("is used by");
  });

  it("stops offering a hop at the third one", () => {
    const two = {
      type: "Organization",
      related: [
        {
          relation: "relOrgToApp",
          type: "Application",
          related: [{ relation: "relAppToApp__out", type: "Application" }],
        },
      ],
    };
    renderEditor({ query: two, viewId: null });
    fireEvent.click(screen.getByTestId("query-path-add-hop"));
    pick("is called by Business App");
    expect(screen.getAllByTestId("query-path-hop")).toHaveLength(3);
    expect(screen.queryByTestId("query-path-add-hop")).not.toBeInTheDocument();
  });

  it("negates a hop and removes it with everything after it", () => {
    const { last } = renderEditor({ query: VIEW.query, viewId: "bm-q" });
    const verbs = screen.getAllByTestId("query-path-verb");
    expect(verbs.map((v) => v.textContent)).toEqual(["uses", "is affected by"]);
    fireEvent.click(verbs[1]);
    pick("has no");
    expect(last().query.related![0].related![0]).toEqual({
      relation: "relInitiativeToApp",
      type: "Initiative",
      where: { subtype: ["proj"], attributes: { initiativeStatus: ["onTrack"] } },
      negate: true,
    });
    expect(screen.getAllByTestId("query-path-verb")[1]).toHaveTextContent("has no is affected by");

    fireEvent.click(screen.getAllByTestId("query-path-verb")[0]);
    pick("Remove this hop");
    expect(last()).toEqual({
      query: {
        type: "Organization",
        where: { approval_status: ["APPROVED"] },
        related: [{ relation: "relOrgToApp", type: "Application", negate: true }],
      },
      viewId: "bm-q",
    });
    // The MCP branch beside the chain moved into it.
    expect(screen.getAllByTestId("query-path-verb")).toHaveLength(1);
  });

  it("offers each condition once, subtypes and tags only where they apply", () => {
    renderEditor({ query: { type: "Initiative", where: { approval_status: ["DRAFT"] } }, viewId: null });
    fireEvent.click(screen.getByTestId("query-path-add-condition"));
    expect(menuLabels()).toEqual([
      "Lifecycle",
      "Subtype",
      "Tags",
      "Specific cards",
      "Delivery Status",
    ]);
  });

  it("leaves out tags when no group with tags applies to the type", () => {
    renderEditor({ query: { type: "Application" }, viewId: null }, { tagGroups: [ORG_ONLY] });
    fireEvent.click(screen.getByTestId("query-path-add-condition"));
    expect(menuLabels()).toEqual([
      "Lifecycle",
      "Approval Status",
      "Specific cards",
      "Business Criticality",
      "Cloud hosted",
    ]);
  });

  it("maps a lifecycle (empty) to none", () => {
    const { drafts, last } = renderEditor({ query: { type: "Application" }, viewId: null });
    addCondition("Lifecycle");
    expect(drafts[0]).toEqual({ query: { type: "Application", where: { lifecycle_phase: [] } }, viewId: null });
    expect(screen.getByTestId("query-path-save")).toBeDisabled();
    chooseOption("(empty)");
    expect(last().query.where).toEqual({ lifecycle_phase: ["none"] });
    chooseOption("Active");
    expect(last().query.where).toEqual({ lifecycle_phase: ["none", "active"] });
    expect(screen.getByText("Lifecycle: (empty), Active")).toBeInTheDocument();
    expect(screen.getByTestId("query-path-save")).toBeEnabled();
  });

  it("picks a select field's option and a flag's No", () => {
    const { last } = renderEditor({ query: { type: "Application" }, viewId: null });
    addCondition("Business Criticality");
    chooseOption("Mission critical");
    expect(last().query.where).toEqual({ attributes: { criticality: ["high"] } });
    fireEvent.keyDown(screen.getByTestId("query-condition-popover"), { key: "Escape" });

    addCondition("Cloud hosted");
    chooseOption("No");
    expect(last().query.where).toEqual({ attributes: { criticality: ["high"], isCloud: ["false"] } });
  });

  it("leaves (empty) out of the approval status editor", () => {
    renderEditor({ query: { type: "Application" }, viewId: null });
    addCondition("Approval Status");
    const popover = screen.getByTestId("query-condition-popover");
    fireEvent.mouseDown(within(popover).getByRole("combobox"));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Draft",
      "Approved",
      "Broken",
      "Rejected",
    ]);
  });

  it("picks tags with the tag picker, only from groups that apply", () => {
    const { last } = renderEditor({ query: { type: "Application" }, viewId: null });
    addCondition("Tags");
    const popover = screen.getByTestId("query-condition-popover");
    fireEvent.mouseDown(within(popover).getByRole("combobox"));
    expect(screen.queryByRole("option", { name: "Hq" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Sales" }));
    expect(last().query.where).toEqual({ tags: [SALES.id] });
    // One chip on the path, one in the picker.
    expect(screen.getAllByText("Domain: Sales", { selector: ".MuiChip-label" })).toHaveLength(2);
  });

  it("drops a condition its editor closed empty", () => {
    const { last } = renderEditor({ query: { type: "Application" }, viewId: null });
    addCondition("Lifecycle");
    fireEvent.keyDown(screen.getByTestId("query-condition-popover"), { key: "Escape" });
    expect(last()).toEqual({ query: { type: "Application" }, viewId: null });
  });

  it("removes a condition with its ×, a tag group's chip by its tags", () => {
    const { last } = renderEditor({
      query: {
        type: "Organization",
        where: { approval_status: ["APPROVED"], tags: [FINANCE.id, HQ.id] },
      },
      viewId: null,
    });
    deleteChip("Domain: Finance");
    expect(last().query.where).toEqual({ approval_status: ["APPROVED"], tags: [HQ.id] });
    deleteChip("Org Only: Hq");
    expect(last().query.where).toEqual({ approval_status: ["APPROVED"] });
    deleteChip("Approval Status: Approved");
    expect(last()).toEqual({ query: { type: "Organization" }, viewId: null });
  });

  it("reopens a condition's editor from its chip", () => {
    const { last } = renderEditor({
      query: { type: "Application", where: { attributes: { criticality: ["high"] } } },
      viewId: null,
    });
    fireEvent.click(screen.getByText("Business Criticality: Mission critical"));
    chooseOption("Nice to have");
    expect(last().query.where).toEqual({ attributes: { criticality: ["high", "low"] } });
  });

  it("states why a save was refused, by its code", () => {
    const { unmount } = renderEditor(
      { query: { type: "Application" }, viewId: null },
      { error: "tag_not_for_type" },
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A tag in this query belongs to a tag group that does not apply to its card type.",
    );
    unmount();
    renderEditor({ query: { type: "Application" }, viewId: null }, { error: "brand_new_code" });
    expect(screen.getByRole("alert")).toHaveTextContent("brand_new_code");
  });
});

describe("QueryPathStrip — specific cards", () => {
  const card = (id: string, name: string, type = "Application") => ({ id, name, type }) as Card;

  const PICKED: ActiveQuery = {
    viewId: "bm-c",
    name: "Picked",
    createdVia: "web",
    query: {
      type: "Organization",
      where: { cards: ["o1", "o2", "o3", "o4"], include_descendants: true },
      related: [
        {
          relation: "relOrgToApp",
          type: "Application",
          where: { cards: ["a1", "o2"] },
          related: [{ relation: "relInitiativeToApp", type: "Initiative", where: { cards: ["i1"] } }],
        },
        { relation: "relOrgToApp", type: "Application", where: { cards: ["a2", "gone"] } },
      ],
    },
  };

  const chipLabels = () =>
    Array.from(screen.getByTestId("query-path-strip").querySelectorAll(".MuiChip-label")).map(
      (el) => el.textContent,
    );

  it("names every node's picks with one fetch for the union", async () => {
    fetchCards.mockResolvedValue({
      cards: [
        card("o1", "Corp", "Organization"),
        card("o2", "Sales Org", "Organization"),
        card("o3", "Zed", "Organization"),
        card("o4", "Yonder", "Organization"),
        card("a1", "Alpha"),
        card("i1", "Initiative X", "Initiative"),
      ],
      withheldIds: ["a2"],
    });
    render(<QueryPathStrip view={PICKED} onLeave={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText("Cards: Corp, Sales Org, Zed +1 · sub-cards")).toBeInTheDocument(),
    );
    expect(fetchCards).toHaveBeenCalledTimes(1);
    expect(fetchCards.mock.calls[0][0]).toEqual(["a1", "a2", "gone", "i1", "o1", "o2", "o3", "o4"]);
    expect(chipLabels()).toEqual([
      "Org Unit",
      "Cards: Corp, Sales Org, Zed +1 · sub-cards",
      "Business App",
      "Cards: Alpha, Sales Org",
      "Change Initiative",
      "Cards: Initiative X",
      "Business App",
      "Cards: (hidden card), (unknown card)",
    ]);
  });

  it("shows the ids while the names load, and fetches nothing without picks", async () => {
    fetchCards.mockReturnValue(new Promise(() => {}));
    const { unmount } = render(
      <QueryPathStrip
        view={{ ...PICKED, query: { type: "Application", where: { cards: ["a1"] } } }}
        onLeave={() => {}}
      />,
    );
    expect(screen.getByText("Cards: a1")).toBeInTheDocument();
    unmount();
    fetchCards.mockClear();

    render(<QueryPathStrip view={VIEW} onLeave={() => {}} />);
    await waitFor(() => expect(screen.getByText("Org Unit")).toBeInTheDocument());
    expect(fetchCards).not.toHaveBeenCalled();
  });

  it("adds the condition, picks cards in the picker, and writes them to the draft", async () => {
    fetchCards.mockResolvedValue({ cards: [card("app-1", "Alpha"), card("app-2", "Beta")], withheldIds: [] });
    const { drafts, last } = renderEditor({
      query: { type: "Organization", related: [{ relation: "relOrgToApp", type: "Application" }] },
      viewId: null,
    });
    addCondition("Specific cards", 1);
    expect(last().query.related![0].where).toEqual({ cards: [] });
    expect(drafts).toHaveLength(1);
    expect(screen.getByTestId("query-path-save")).toBeDisabled();
    // Application has no hierarchy here: no sub-cards switch.
    expect(screen.queryByTestId("query-cards-subcards")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("query-cards-pick"));
    expect(screen.getByTestId("card-multi-picker")).toHaveAttribute("data-types", "Application");
    fireEvent.click(screen.getByTestId("card-multi-picker"));
    expect(last()).toEqual({
      query: {
        type: "Organization",
        related: [{ relation: "relOrgToApp", type: "Application", where: { cards: ["app-1", "app-2"] } }],
      },
      viewId: null,
    });
    expect(screen.getByTestId("query-path-save")).toBeEnabled();
    await waitFor(() =>
      expect(screen.getAllByText("Cards: Alpha, Beta", { selector: ".MuiChip-label" })).toHaveLength(1),
    );
    expect(fetchCards).toHaveBeenCalledTimes(1);
    expect(fetchCards.mock.calls[0][0]).toEqual(["app-1", "app-2"]);
    expect(screen.getAllByTestId("query-cards-chip").map((c) => c.textContent)).toEqual([
      "Alpha",
      "Beta",
    ]);
  });

  it("turns Include sub-cards on for a hierarchy type and drops it with the condition", () => {
    const { last } = renderEditor({
      query: { type: "Organization", where: { cards: ["o1"] } },
      viewId: null,
    });
    fireEvent.click(screen.getByText("Cards: o1"));
    fireEvent.click(within(screen.getByTestId("query-cards-subcards")).getByRole("checkbox"));
    expect(last().query).toEqual({
      type: "Organization",
      where: { cards: ["o1"], include_descendants: true },
    });
    expect(screen.getByText("Cards: o1 · sub-cards", { selector: ".MuiChip-label" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId("query-condition-popover"), { key: "Escape" });
    deleteChip("Cards: o1 · sub-cards");
    expect(last().query).toEqual({ type: "Organization" });
  });

  it("drops a cards condition closed before anything was picked", () => {
    const { last } = renderEditor({ query: { type: "Organization" }, viewId: null });
    addCondition("Specific cards");
    expect(screen.getByText("Cards", { selector: ".MuiChip-label" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId("query-condition-popover"), { key: "Escape" });
    expect(last()).toEqual({ query: { type: "Organization" }, viewId: null });
  });
});
