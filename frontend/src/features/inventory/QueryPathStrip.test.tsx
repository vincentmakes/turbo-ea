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

  it("labels an EOL status condition, (empty) by the facet's label and an unknown value raw", () => {
    const view: ActiveQuery = {
      ...VIEW,
      query: {
        type: "Application",
        where: { eol_status: ["eol", "approaching", "__empty__", "missing"] },
        related: [
          { relation: "relAppToApp", type: "Application", where: { eol_status: ["supported", "unknown"] } },
        ],
      },
    };
    render(<QueryPathStrip view={view} onLeave={() => {}} />);
    expect(
      screen.getByText("End of life: End of Life, Approaching EOL, (empty), missing"),
    ).toBeInTheDocument();
    expect(screen.getByText("End of life: Supported, Unknown")).toBeInTheDocument();
  });

  it("reads out a refused query under the lines, by its code", () => {
    const view: ActiveQuery = {
      ...VIEW,
      query: { type: "Application", where: { eol_status: ["eol"] } },
    };
    const { rerender } = render(<QueryPathStrip view={view} onLeave={() => {}} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    rerender(<QueryPathStrip view={view} onLeave={() => {}} queryError="eol_view_required" />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This view filters on end-of-life status, which your role cannot see.",
    );
    expect(screen.getByRole("alert")).toHaveAttribute("data-testid", "query-path-error");
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
    expect(screen.getByTestId("query-path-strip")).toHaveTextContent(/^view_in_ar/);
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
      "Specific cards",
      "Lifecycle",
      "Subtype",
      "Data Quality",
      "Tags",
      "Delivery Status",
    ]);
  });

  it("sets Specific cards apart with a divider, and drops it once cards are taken", () => {
    const { unmount } = renderEditor({ query: { type: "Application" }, viewId: null });
    fireEvent.click(screen.getByTestId("query-path-add-condition"));
    const menu = screen.getByRole("menu");
    const separators = within(menu).getAllByRole("separator");
    expect(separators).toHaveLength(1);
    expect(separators[0].previousElementSibling).toHaveTextContent("Specific cards");
    expect(separators[0].nextElementSibling).toHaveTextContent("Lifecycle");
    unmount();

    renderEditor({ query: { type: "Application", where: { cards: ["a1"] } }, viewId: null });
    fireEvent.click(screen.getByTestId("query-path-add-condition"));
    expect(menuLabels()[0]).toBe("Lifecycle");
    expect(menuLabels()).not.toContain("Specific cards");
    expect(within(screen.getByRole("menu")).queryByRole("separator")).not.toBeInTheDocument();
  });

  it("leaves out tags when no group with tags applies to the type", () => {
    renderEditor({ query: { type: "Application" }, viewId: null }, { tagGroups: [ORG_ONLY] });
    fireEvent.click(screen.getByTestId("query-path-add-condition"));
    expect(menuLabels()).toEqual([
      "Specific cards",
      "Lifecycle",
      "Approval Status",
      "Data Quality",
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

  it("adds a data quality condition, labels its chip and removes it with its ×", () => {
    const { last } = renderEditor({ query: { type: "Application" }, viewId: null });
    addCondition("Data Quality");
    expect(last().query.where).toEqual({ data_quality_band: [] });
    chooseOption("Partial (40-79%)");
    expect(last().query.where).toEqual({ data_quality_band: ["partial"] });
    chooseOption("Complete (≥80%)");
    expect(last().query.where).toEqual({ data_quality_band: ["partial", "complete"] });
    expect(screen.getByText("Data Quality: Partial (40-79%), Complete (≥80%)")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId("query-condition-popover"), { key: "Escape" });
    fireEvent.click(screen.getByTestId("query-path-add-condition"));
    expect(menuLabels()).not.toContain("Data Quality");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    deleteChip("Data Quality: Partial (40-79%), Complete (≥80%)");
    expect(last()).toEqual({ query: { type: "Application" }, viewId: null });
  });

  it("labels a stored data quality condition, an unknown band by its key", () => {
    renderEditor({
      query: { type: "Application", where: { data_quality_band: ["minimal", "great"] } },
      viewId: null,
    });
    expect(screen.getByText("Data Quality: Minimal (<40%), great")).toBeInTheDocument();
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

  it("offers End of life after Data Quality on a type that tracks it, with eol.view", () => {
    const { last } = renderEditor({ query: { type: "Application" }, viewId: null }, { canViewEol: true });
    fireEvent.click(screen.getByTestId("query-path-add-condition"));
    expect(menuLabels()).toEqual([
      "Specific cards",
      "Lifecycle",
      "Approval Status",
      "Data Quality",
      "End of life",
      "Tags",
      "Business Criticality",
      "Cloud hosted",
    ]);
    pick("End of life");
    expect(last().query.where).toEqual({ eol_status: [] });
    expect(screen.getByTestId("query-path-save")).toBeDisabled();
    chooseOption("Approaching EOL");
    chooseOption("(empty)");
    expect(last().query.where).toEqual({ eol_status: ["approaching", "__empty__"] });
    expect(screen.getByText("End of life: Approaching EOL, (empty)")).toBeInTheDocument();
    expect(screen.getByTestId("query-path-save")).toBeEnabled();
    fireEvent.keyDown(screen.getByTestId("query-condition-popover"), { key: "Escape" });
    fireEvent.click(screen.getByTestId("query-path-add-condition"));
    expect(menuLabels()).not.toContain("End of life");
  });

  it("does not offer End of life without eol.view", () => {
    renderEditor({ query: { type: "Application" }, viewId: null });
    fireEvent.click(screen.getByTestId("query-path-add-condition"));
    expect(menuLabels()).not.toContain("End of life");
    expect(menuLabels()).toContain("Data Quality");
  });

  it("offers End of life only where the type's End of Life section is shown", () => {
    withMetamodel(
      [
        { ...APP, section_config: { eol: { hidden: true } } },
        { ...ORG, section_config: { eol: { hidden: false } } },
        INIT,
      ],
      [REL_ORG_TO_APP, REL_INIT_TO_APP],
    );
    const { unmount } = renderEditor(
      { query: { type: "Application" }, viewId: null },
      { canViewEol: true },
    );
    fireEvent.click(screen.getByTestId("query-path-add-condition"));
    expect(menuLabels()).not.toContain("End of life");
    unmount();

    renderEditor({ query: { type: "Organization" }, viewId: null }, { canViewEol: true });
    fireEvent.click(screen.getByTestId("query-path-add-condition"));
    expect(menuLabels()).toContain("End of life");
  });

  it("does not offer End of life on a type that does not track it by default", () => {
    renderEditor({ query: { type: "Initiative" }, viewId: null }, { canViewEol: true });
    fireEvent.click(screen.getByTestId("query-path-add-condition"));
    expect(menuLabels()).not.toContain("End of life");
  });

  it("shows a refused query in edit mode, a refused save first", () => {
    const { unmount } = renderEditor(
      { query: { type: "Application", where: { eol_status: ["eol"] } }, viewId: null },
      { queryError: "eol_view_required" },
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This view filters on end-of-life status, which your role cannot see.",
    );
    unmount();
    renderEditor(
      { query: { type: "Application", where: { eol_status: ["eol"] } }, viewId: null },
      { queryError: "eol_view_required", error: "eol_not_tracked" },
    );
    expect(screen.getByRole("alert")).toHaveTextContent("This card type does not track end of life.");
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

describe("QueryPathStrip — stacked lines", () => {
  const APP_LINE = {
    type: "Application",
    where: { lifecycle_phase: ["active"] },
    related: [{ relation: "relInitiativeToApp", type: "Initiative" }],
  };
  const ORG_LINE = { type: "Organization", related: [{ relation: "relOrgToApp", type: "Application" }] };
  /** The plan's mockup: an Application group with an AND line, OR an Organization line. */
  const STACK = {
    any_of: [{ all_of: [APP_LINE, { type: "Application" }] }, ORG_LINE],
  };
  const STACK_VIEW: ActiveQuery = { viewId: "bm-s", name: "Stack", createdVia: "web", query: STACK };

  const lines = () => screen.getAllByTestId("query-line");
  const chipsOf = (el: HTMLElement) =>
    Array.from(el.querySelectorAll(".MuiChip-label")).map((c) => c.textContent);
  const startChips = () => screen.getAllByTestId("query-path-start-type");

  it("shows a plain query as one line, with no badge and no divider, in both modes", () => {
    const { unmount } = render(<QueryPathStrip view={VIEW} onLeave={() => {}} />);
    expect(lines()).toHaveLength(1);
    expect(screen.queryByTestId("query-line-and")).not.toBeInTheDocument();
    expect(screen.queryByTestId("query-group-or")).not.toBeInTheDocument();
    expect(screen.queryByTestId("query-add-line")).not.toBeInTheDocument();
    expect(screen.queryByTestId("query-line-remove")).not.toBeInTheDocument();
    unmount();

    renderEditor({ query: { type: "Application" }, viewId: null });
    expect(lines()).toHaveLength(1);
    expect(screen.queryByTestId("query-line-and")).not.toBeInTheDocument();
    expect(screen.queryByTestId("query-group-or")).not.toBeInTheDocument();
    expect(screen.queryByTestId("query-line-remove")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("query-add-line")).toHaveLength(1);
  });

  it("reads a two-group stack in view mode, one AND row and one OR divider, no controls", () => {
    render(<QueryPathStrip view={STACK_VIEW} onLeave={() => {}} />);
    expect(lines().map(chipsOf)).toEqual([
      ["Business App", "Lifecycle: Active", "Change Initiative"],
      ["Business App"],
      ["Org Unit", "Business App"],
    ]);
    expect(within(lines()[0]).getByText("is affected by")).toBeInTheDocument();
    expect(within(lines()[2]).getByText("uses")).toBeInTheDocument();
    const and = screen.getAllByTestId("query-line-and");
    expect(and).toHaveLength(1);
    expect(and[0]).toHaveTextContent(/^AND$/);
    const or = screen.getAllByTestId("query-group-or");
    expect(or).toHaveLength(1);
    expect(or[0]).toHaveTextContent(/^OR$/);
    expect(or[0]).toHaveClass("MuiDivider-root");
    // The badges sit between the lines they join.
    const strip = screen.getByTestId("query-path-strip");
    const order = Array.from(
      strip.querySelectorAll('[data-testid="query-line"], [data-testid="query-line-and"], [data-testid="query-group-or"]'),
    ).map((el) => el.getAttribute("data-testid"));
    expect(order).toEqual(["query-line", "query-line-and", "query-line", "query-group-or", "query-line"]);
    expect(screen.queryByTestId("query-add-line")).not.toBeInTheDocument();
    expect(screen.queryByTestId("query-line-remove")).not.toBeInTheDocument();
    expect(screen.queryByTestId("query-path-add-hop")).not.toBeInTheDocument();
  });

  it("puts one plus under each group in edit mode, offering exactly AND and OR", () => {
    renderEditor({ query: STACK, viewId: "bm-s" });
    const plus = screen.getAllByTestId("query-add-line");
    expect(plus).toHaveLength(2);
    expect(plus[0]).toHaveAttribute("aria-label", "Add a query line");
    expect(plus[0]).toHaveTextContent("add_circle");
    // Under the group's last line: the AND line is before it, the OR after it.
    const strip = screen.getByTestId("query-path-strip");
    const order = Array.from(
      strip.querySelectorAll('[data-testid="query-line"], [data-testid="query-add-line"], [data-testid="query-group-or"]'),
    ).map((el) => el.getAttribute("data-testid"));
    expect(order).toEqual(["query-line", "query-line", "query-add-line", "query-group-or", "query-line", "query-add-line"]);
    fireEvent.click(plus[0]);
    expect(menuLabels()).toEqual(["AND", "OR"]);
  });

  it("AND adds a line on the group's type: its start chip is fixed, the first line's locked", () => {
    const { last } = renderEditor({ query: { type: "Application" }, viewId: null });
    fireEvent.click(screen.getByTestId("query-add-line"));
    pick("AND");
    expect(last()).toEqual({
      query: { all_of: [{ type: "Application" }, { type: "Application" }] },
      viewId: null,
    });
    expect(lines()).toHaveLength(2);
    expect(screen.getAllByTestId("query-line-and")).toHaveLength(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    const [first, fixed] = startChips();
    expect(fixed).toHaveTextContent("Business App");
    expect(fixed).toHaveAttribute("title", "An AND line starts from the same card type as its group");
    expect(fixed).not.toHaveClass("Mui-disabled");
    fireEvent.click(fixed);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    expect(first).toHaveClass("Mui-disabled");
    expect(screen.getByTestId("query-path-start-type-locked")).toHaveAttribute(
      "title",
      "Remove the AND lines to change the card type",
    );
    fireEvent.click(first);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    // Still one plus: the group is one group.
    expect(screen.getAllByTestId("query-add-line")).toHaveLength(1);
  });

  it("OR adds a group after its group, starting on the type chooser", () => {
    const { last } = renderEditor({ query: STACK, viewId: "bm-s" });
    fireEvent.click(screen.getAllByTestId("query-add-line")[0]);
    pick("OR");
    expect(last()).toEqual({
      query: { any_of: [{ all_of: [APP_LINE, { type: "Application" }] }, { type: "" }, ORG_LINE] },
      viewId: "bm-s",
    });
    expect(screen.getAllByTestId("query-group-or")).toHaveLength(2);
    const chooser = startChips()[2];
    expect(chooser).toHaveTextContent("Choose a type");
    expect(chooser).not.toHaveClass("Mui-disabled");
    expect(chooser).not.toHaveAttribute("title");
    fireEvent.click(chooser);
    pick("Org Unit");
    expect(last().query).toEqual({
      any_of: [{ all_of: [APP_LINE, { type: "Application" }] }, { type: "Organization" }, ORG_LINE],
    });
  });

  it("does not offer AND while the group has no type", () => {
    renderEditor({ query: { any_of: [{ type: "Application" }, { type: "" }] }, viewId: null });
    fireEvent.click(screen.getAllByTestId("query-add-line")[1]);
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
    expect(items[0]).toHaveAttribute("aria-disabled", "true");
    expect(items[1]).not.toHaveAttribute("aria-disabled");
  });

  it("edits a relation and a condition on line 2 only", () => {
    const { last } = renderEditor({ query: { all_of: [{ type: "Application" }, { type: "Application" }] }, viewId: null });
    fireEvent.click(screen.getAllByTestId("query-path-add-hop")[1]);
    pick("is affected by Change Initiative");
    expect(last()).toEqual({
      query: {
        all_of: [
          { type: "Application" },
          { type: "Application", related: [{ relation: "relInitiativeToApp", type: "Initiative" }] },
        ],
      },
      viewId: null,
    });
    // Line 2's conditions: its start node is the second "+ Condition".
    addCondition("Lifecycle", 1);
    chooseOption("Active");
    expect(last()).toEqual({
      query: {
        all_of: [
          { type: "Application" },
          {
            type: "Application",
            where: { lifecycle_phase: ["active"] },
            related: [{ relation: "relInitiativeToApp", type: "Initiative" }],
          },
        ],
      },
      viewId: null,
    });
    expect(chipsOf(lines()[0])).toEqual(["Business App", "Condition", "Relation"]);
  });

  it("removes a line with its ×, a group with its last line, and hides × on a single line", () => {
    const { last } = renderEditor({ query: STACK, viewId: "bm-s" });
    const removes = screen.getAllByTestId("query-line-remove");
    expect(removes).toHaveLength(3);
    expect(removes[0]).toHaveAttribute("aria-label", "Remove this line");
    fireEvent.click(removes[1]);
    expect(last().query).toEqual({ any_of: [APP_LINE, ORG_LINE] });
    expect(screen.queryByTestId("query-line-and")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByTestId("query-line-remove")[1]);
    expect(last().query).toEqual(APP_LINE);
    expect(screen.queryByTestId("query-group-or")).not.toBeInTheDocument();
    expect(screen.queryByTestId("query-line-remove")).not.toBeInTheDocument();
  });

  it("hides the plus at 6 lines and + Relation at 12 relations", () => {
    const six = { all_of: Array.from({ length: 6 }, () => ({ type: "Application" })) };
    const { unmount } = renderEditor({ query: six, viewId: null });
    expect(lines()).toHaveLength(6);
    expect(screen.queryByTestId("query-add-line")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("query-path-add-hop")).toHaveLength(6);
    unmount();

    const hop = (type: string, related?: unknown[]) => ({ relation: "relAppToApp__out", type, ...(related ? { related } : {}) });
    const three = { type: "Application", related: [hop("Application", [hop("Application", [hop("Application")])])] };
    const full = { all_of: [three, three, three, { type: "Application", related: [hop("Application"), hop("Application"), hop("Application")] }] };
    renderEditor({ query: full, viewId: null });
    expect(screen.getAllByTestId("query-add-line")).toHaveLength(1);
    expect(screen.queryByTestId("query-path-add-hop")).not.toBeInTheDocument();
  });

  it("offers + Relation while the stack is under 12 relations", () => {
    const hop = (related?: unknown[]) => ({ relation: "relAppToApp__out", type: "Application", ...(related ? { related } : {}) });
    const eleven = {
      all_of: [
        { type: "Application", related: [hop([hop([hop()])])] },
        { type: "Application", related: [hop([hop([hop()])])] },
        { type: "Application", related: [hop([hop([hop()])])] },
        { type: "Application", related: [hop([hop()])] },
      ],
    };
    renderEditor({ query: eleven, viewId: null });
    expect(screen.getAllByTestId("query-path-add-hop")).toHaveLength(1);
  });

  it("disables Save while a line has no type", () => {
    renderEditor({ query: { any_of: [{ type: "Application" }, { type: "" }] }, viewId: null });
    expect(screen.getByTestId("query-path-save")).toBeDisabled();
  });

  it("states a refused stack by its code", () => {
    renderEditor({ query: STACK, viewId: "bm-s" }, { error: "too_many_lines" });
    expect(screen.getByRole("alert")).toHaveTextContent(/^A view holds at most 6 query lines\.$/);
  });

  it("names every line's picks with one fetch", async () => {
    fetchCards.mockResolvedValue({
      cards: [{ id: "a1", name: "Alpha", type: "Application" } as Card, { id: "o1", name: "Corp", type: "Organization" } as Card],
      withheldIds: [],
    });
    const view: ActiveQuery = {
      ...STACK_VIEW,
      query: {
        any_of: [
          { type: "Application", where: { cards: ["a1"] } },
          { type: "Organization", where: { cards: ["o1"] } },
        ],
      },
    };
    render(<QueryPathStrip view={view} onLeave={() => {}} />);
    await waitFor(() => expect(screen.getByText("Cards: Corp")).toBeInTheDocument());
    expect(screen.getByText("Cards: Alpha")).toBeInTheDocument();
    expect(fetchCards).toHaveBeenCalledTimes(1);
    expect(fetchCards.mock.calls[0][0]).toEqual(["a1", "o1"]);
  });

  it("takes a removed line's open editor with it, not handing it to the next line", () => {
    renderEditor({
      query: {
        all_of: [{ type: "Application" }, { type: "Application", where: { lifecycle_phase: ["active"] } }],
      },
      viewId: null,
    });
    addCondition("Lifecycle", 0);
    expect(screen.getByTestId("query-condition-popover")).toBeInTheDocument();
    fireEvent.click(screen.getAllByTestId("query-line-remove")[0]);
    expect(screen.queryByTestId("query-condition-popover")).not.toBeInTheDocument();
    expect(lines()).toHaveLength(1);
    expect(chipsOf(lines()[0])).toEqual(["Business App", "Lifecycle: Active", "Condition", "Relation"]);
  });

  it("keeps a line's editor open while other lines are added and removed", () => {
    const { last } = renderEditor({ query: { any_of: [{ type: "Application" }, { type: "Organization" }] }, viewId: null });
    // The Organization line's start node is the second "+ Condition".
    addCondition("Lifecycle", 1);
    expect(screen.getByTestId("query-condition-popover")).toBeInTheDocument();
    fireEvent.click(screen.getAllByTestId("query-add-line")[0]);
    pick("AND");
    expect(last().query).toEqual({
      any_of: [
        { all_of: [{ type: "Application" }, { type: "Application" }] },
        { type: "Organization", where: { lifecycle_phase: [] } },
      ],
    });
    expect(screen.getByTestId("query-condition-popover")).toBeInTheDocument();
    fireEvent.click(screen.getAllByTestId("query-line-remove")[1]);
    expect(last().query).toEqual({
      any_of: [{ type: "Application" }, { type: "Organization", where: { lifecycle_phase: [] } }],
    });
    expect(screen.getByTestId("query-condition-popover")).toBeInTheDocument();
    // Still the Organization line's editor: a pick lands there.
    chooseOption("Active");
    expect(last().query).toEqual({
      any_of: [{ type: "Application" }, { type: "Organization", where: { lifecycle_phase: ["active"] } }],
    });
  });

  it("follows a draft replaced by one with another number of lines", () => {
    const two = { query: { any_of: [{ type: "Application" }, { type: "Organization" }] }, viewId: null };
    const three = {
      query: { any_of: [{ all_of: [{ type: "Application" }, { type: "Application" }] }, { type: "Initiative" }] },
      viewId: "bm-s",
    };
    const { rerender } = render(<QueryPathStrip view={null} draft={two} onLeave={() => {}} />);
    expect(lines().map(chipsOf)).toEqual([
      ["Business App", "Condition", "Relation"],
      ["Org Unit", "Condition", "Relation"],
    ]);
    rerender(<QueryPathStrip view={null} draft={three} onLeave={() => {}} />);
    expect(lines().map(chipsOf)).toEqual([
      ["Business App", "Condition", "Relation"],
      ["Business App", "Condition", "Relation"],
      ["Change Initiative", "Condition", "Relation"],
    ]);
    expect(screen.getAllByTestId("query-line-remove")).toHaveLength(3);
  });

  it("states what an opened set breaks as a whole, a refused save first", () => {
    const seven = { all_of: Array.from({ length: 7 }, () => ({ type: "Application" })) };
    const { unmount } = renderEditor({ query: seven, viewId: "bm-s" });
    expect(screen.getByTestId("query-path-save")).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/^A view holds at most 6 query lines\.$/);
    unmount();

    const mixed = renderEditor({ query: { all_of: [{ type: "Application" }, { type: "Organization" }] }, viewId: "bm-s" });
    expect(screen.getByTestId("query-path-save")).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /^Every line of an AND group must start from the same card type\.$/,
    );
    mixed.unmount();

    const hop = { relation: "relAppToApp__out", type: "Application" };
    const many = { all_of: Array.from({ length: 5 }, () => ({ type: "Application", related: [hop, hop, hop] })) };
    const third = renderEditor({ query: many, viewId: "bm-s" });
    expect(screen.getByRole("alert")).toHaveTextContent(
      /^A view holds at most 12 relations over all its lines\.$/,
    );
    third.unmount();

    renderEditor({ query: seven, viewId: "bm-s" }, { error: "unknown_tag" });
    expect(screen.getByRole("alert")).toHaveTextContent(/^A tag in this query no longer exists\.$/);
  });

  it("does not flag a line still being filled in", () => {
    renderEditor({ query: { any_of: [{ type: "Application" }, { type: "" }] }, viewId: null });
    expect(screen.getByTestId("query-path-save")).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("QueryPathStrip — matched-cards switches", () => {
  const switches = () => screen.queryAllByTestId("query-path-match-switch");

  it("offers no switch without a toggle handler", () => {
    render(<QueryPathStrip view={VIEW} onLeave={() => {}} />);
    expect(switches()).toHaveLength(0);
    expect(screen.queryByRole("button", { pressed: false })).toBeNull();
  });

  it("makes every pill after the first a switch, but none behind 'has no'", () => {
    render(<QueryPathStrip view={VIEW} onLeave={() => {}} onToggleMatched={vi.fn()} />);
    expect(switches().map((s) => s.getAttribute("data-match-key"))).toEqual(["0:0", "0:0.0"]);
    // The start card and the negated Application stay plain pills.
    expect(screen.getByText("Org Unit").closest("[data-testid]")).not.toHaveAttribute(
      "data-testid",
      "query-path-match-switch",
    );
    const apps = screen.getAllByText("Business App").map((el) => el.closest(".MuiChip-root"));
    expect(apps[0]).toHaveAttribute("data-testid", "query-path-match-switch");
    expect(apps[1]).not.toHaveAttribute("data-testid", "query-path-match-switch");
  });

  it("reads off as outlined with a show label, on as filled with a hide label", () => {
    render(
      <QueryPathStrip view={VIEW} onLeave={() => {}} matchedKeys={["0:0.0"]} onToggleMatched={vi.fn()} />,
    );
    const off = screen.getByRole("button", {
      name: "Show the matched Business App cards in a column",
    });
    expect(off).toHaveAttribute("aria-pressed", "false");
    expect(off).toHaveAttribute("data-pressed", "false");
    expect(off).toHaveClass("MuiChip-outlined");
    expect(off).toHaveAccessibleDescription("Show these in a column");
    expect(within(off).queryByText("view_column")).toBeNull();

    const on = screen.getByRole("button", { name: "Hide the matched Change Initiative column" });
    expect(on).toHaveAttribute("aria-pressed", "true");
    expect(on).toHaveAttribute("data-pressed", "true");
    expect(on).toHaveClass("MuiChip-filled");
    expect(on).toHaveAccessibleDescription("Hide the column");
    expect(within(on).getByText("view_column")).toBeInTheDocument();
    // Filled in its type colour, with contrast text.
    expect(on).toHaveStyle({ backgroundColor: "#0f7eb5", color: "#ffffff" });
  });

  it("calls the handler with the step's key on a click and from the keyboard", () => {
    const onToggle = vi.fn();
    render(<QueryPathStrip view={VIEW} onLeave={() => {}} onToggleMatched={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: /matched Change Initiative/ }));
    expect(onToggle).toHaveBeenLastCalledWith("0:0.0");
    const app = screen.getByRole("button", { name: /matched Business App/ });
    app.focus();
    fireEvent.keyDown(app, { key: "Enter" });
    expect(onToggle).toHaveBeenLastCalledWith("0:0");
    expect(onToggle).toHaveBeenCalledTimes(2);
    fireEvent.keyUp(app, { key: " " });
    expect(onToggle).toHaveBeenCalledTimes(3);
    expect(onToggle).toHaveBeenLastCalledWith("0:0");
  });

  it("offers no switch in edit mode", () => {
    renderEditor({ query: VIEW.query, viewId: "bm-q" }, { onToggleMatched: vi.fn() });
    expect(switches()).toHaveLength(0);
  });

  it("numbers every line of a stacked view, AND and OR alike", () => {
    const stacked: ActiveQuery = {
      ...VIEW,
      query: {
        any_of: [
          {
            all_of: [
              { type: "Application", related: [{ relation: "relInitiativeToApp", type: "Initiative" }] },
              { type: "Application", related: [{ relation: "relAppToApp__out", type: "Application" }] },
            ],
          },
          { type: "Organization", related: [{ relation: "relOrgToApp", type: "Application" }] },
        ],
      },
    };
    const onToggle = vi.fn();
    render(
      <QueryPathStrip view={stacked} onLeave={() => {}} matchedKeys={["2:0"]} onToggleMatched={onToggle} />,
    );
    expect(switches().map((s) => [s.getAttribute("data-match-key"), s.getAttribute("aria-pressed")])).toEqual([
      ["0:0", "false"],
      ["1:0", "false"],
      ["2:0", "true"],
    ]);
    fireEvent.click(switches()[1]);
    expect(onToggle).toHaveBeenCalledWith("1:0");
  });
});
