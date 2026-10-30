/**
 * The breakdown body the docked panel and the small-screen drawer share
 * (#1334): the required-field warning, every unmet slot with its gain and jump
 * link, the slots that already count by name, and the host's action beside
 * the headline.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    types: TYPES,
    relationTypes: RELATION_TYPES,
    loading: false,
    getType: (key: string) => TYPES.find((t) => t.key === key),
  }),
}));

import type { CardType, DataQualityBreakdown, DataQualityFactor, RelationType } from "@/types";
import { DataQualityBreakdownContent } from "./DataQualityBreakdownContent";
import { rankUnmet } from "./dataQualityFactors";
import type { DataQualityBreakdownState } from "./useDataQualityBreakdown";

const TYPES = [
  {
    key: "Application",
    label: "Application",
    fields_schema: [
      {
        section: "Details",
        fields: [
          { key: "team", label: "Team", type: "text" },
          { key: "cost", label: "Annual Cost", type: "cost" },
          { key: "code", label: "Business Code", type: "text", required: true },
        ],
      },
    ],
  },
  { key: "Organization", label: "Organization", fields_schema: [] },
] as unknown as CardType[];

const RELATION_TYPES = [
  {
    key: "relOrgToApp",
    label: "owns",
    reverse_label: "is owned by",
    source_type_key: "Organization",
    target_type_key: "Application",
  },
] as unknown as RelationType[];

function factor(
  kind: DataQualityFactor["kind"],
  key: string,
  filled: boolean,
  gain: number | null,
  extra: Partial<DataQualityFactor> = {},
): DataQualityFactor {
  return { kind, key, weight: 1, filled, gain, score_if_filled: null, ...extra };
}

const FACTORS = [
  factor("field", "team", true, null),
  factor("lifecycle", "lifecycle", false, 12.5),
  factor("field", "cost", false, 25),
  factor("description", "description", true, null),
  factor("stakeholders", "stakeholders", false, 10),
];

function state(over: Partial<DataQualityBreakdown> = {}, rest: Partial<DataQualityBreakdownState> = {}) {
  const data: DataQualityBreakdown = {
    score: 40,
    ungated_score: 40,
    total_weight: 5,
    filled_weight: 2,
    blocked_by_required: [],
    factors: FACTORS,
    ...over,
  };
  const blocked = data.blocked_by_required;
  return {
    data,
    loading: false,
    error: null,
    blocked,
    unmet: rankUnmet(data.factors, blocked),
    met: data.factors.filter((f) => f.filled),
    ...rest,
  } satisfies DataQualityBreakdownState;
}

/** The names of the counted slots, once the toggle is open. */
async function countedNames(host: HTMLElement, count: number) {
  await userEvent.click(
    within(host).getByRole("button", { name: new RegExp(`^Already counted \\(${count}\\)`) }),
  );
  return within(host)
    .getAllByRole("listitem")
    .map((li) => li.querySelector("p")?.textContent);
}

function renderContent(props: Partial<Parameters<typeof DataQualityBreakdownContent>[0]> = {}) {
  const { container } = render(
    <div data-testid="host">
      <DataQualityBreakdownContent
        value={40}
        cardType="Application"
        breakdown={state()}
        {...props}
      />
    </div>,
  );
  return { host: screen.getByTestId("host"), container };
}

describe("DataQualityBreakdownContent", () => {
  it("heads with the score and lists every unmet slot by gain, each with its gain chip", () => {
    const { host } = renderContent();
    expect(screen.getByTestId("data-quality-breakdown-header")).toHaveTextContent(
      /^40% data quality$/,
    );
    expect(within(host).getByText("To raise the score")).toBeInTheDocument();
    const rows = within(host)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(rows).toEqual([
      "Fill Annual Cost+25%",
      "Set lifecycle dates+12.5%",
      "Assign a stakeholder+10%",
    ]);
    expect(within(host).getByText("+25%").closest(".MuiChip-root")).toHaveClass(
      "MuiChip-colorSuccess",
      "MuiChip-outlined",
    );
    // Without onJump the rows are text: the counted toggle is the only button.
    expect(within(host).getAllByRole("button")).toHaveLength(1);
    expect(
      within(host).queryByRole("button", { name: "Set lifecycle dates" }),
    ).not.toBeInTheDocument();
    expect(within(host).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("puts the host's action at the right of the headline", () => {
    renderContent({ action: <button type="button">Act</button> });
    const header = screen.getByTestId("data-quality-breakdown-header");
    expect(header).toHaveStyle({ display: "flex", alignItems: "center" });
    expect(header).toHaveTextContent(/^40% data qualityAct$/);
    const [headline, action] = [...header.children];
    expect(headline).toHaveTextContent(/^40% data quality$/);
    expect(headline).toHaveStyle({ flex: "1" });
    expect(action).toBe(screen.getByRole("button", { name: "Act" }));
  });

  it("shows only the headline in the header without an action", () => {
    renderContent();
    expect(screen.getByTestId("data-quality-breakdown-header").children).toHaveLength(1);
  });

  it("hands the slot's target to the host and does nothing else", async () => {
    const onJump = vi.fn();
    const { host } = renderContent({ onJump });
    // Every unmet row is a left-aligned link, beside the counted toggle.
    expect(within(host).getAllByRole("button")).toHaveLength(4);
    const link = within(host).getByRole("button", { name: "Set lifecycle dates" });
    expect(link).toHaveClass("MuiLink-underlineHover");
    expect(link).toHaveStyle({ textAlign: "left" });
    await userEvent.click(link);
    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump).toHaveBeenCalledWith({
      tab: "card",
      anchor: "card-section-lifecycle",
      sectionAnchor: "card-section-lifecycle",
    });
    // The content stays: closing is the host's call.
    expect(within(host).getByText("To raise the score")).toBeInTheDocument();
  });

  it("shows the slots that already count behind a toggle", async () => {
    const { host } = renderContent();
    const toggle = within(host).getByRole("button", { name: /^Already counted \(2\)/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent(/expand_more$/);
    expect(within(host).queryByText("Team")).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveTextContent(/expand_less$/);
    expect(within(host).getByText("Team")).toBeInTheDocument();
    expect(within(host).getByText("Description")).toBeInTheDocument();
  });

  it("names the required fields holding the score at 0, with the ungated score", () => {
    const { host } = renderContent({
      value: 0,
      breakdown: state({ score: 0, ungated_score: 33.3, blocked_by_required: ["code", "cost"] }),
    });
    expect(within(host).getByRole("alert")).toHaveTextContent(
      /^The score stays at 0% until these required fields are filled: Business Code, Annual Cost Without them it would be 33\.3%\.$/,
    );
    // The gating field leads, with a neutral "required" chip instead of a gain.
    const first = within(host).getAllByRole("listitem")[0];
    expect(first).toHaveTextContent(/^Fill Annual Cost→ required$/);
    const chip = within(first).getByText("→ required").closest(".MuiChip-root");
    expect(chip).toHaveClass("MuiChip-colorDefault");
    expect(chip).not.toHaveClass("MuiChip-colorSuccess");
  });

  it("says so when every slot already counts", () => {
    const { host } = renderContent({
      breakdown: state({ factors: FACTORS.filter((f) => f.filled) }),
    });
    expect(within(host).getByText("Every slot counts — nothing left to fill.")).toBeInTheDocument();
    expect(within(host).queryByText("To raise the score")).not.toBeInTheDocument();
  });

  it("hides the counted toggle when nothing counts yet", () => {
    const { host } = renderContent({
      breakdown: state({ factors: FACTORS.filter((f) => !f.filled) }),
    });
    expect(within(host).queryByRole("button", { name: /Already counted/ })).not.toBeInTheDocument();
  });

  it("spins while the breakdown loads", () => {
    const empty = { data: undefined, blocked: [], unmet: [], met: [] };
    const { host } = renderContent({
      breakdown: { ...empty, loading: true, error: null },
    });
    expect(within(host).getByRole("progressbar")).toBeInTheDocument();
    expect(within(host).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(host).queryByRole("list")).not.toBeInTheDocument();
  });

  it("reports a breakdown that failed to load", () => {
    const { host } = renderContent({
      breakdown: { data: undefined, blocked: [], unmet: [], met: [], loading: false, error: new Error("x") },
    });
    expect(within(host).getByRole("alert")).toHaveTextContent(
      /^The breakdown could not be loaded\.$/,
    );
    expect(within(host).queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("hides the spinner and the error once a breakdown is there", () => {
    const { host } = renderContent({
      breakdown: state({}, { loading: true, error: new Error("x") }),
    });
    expect(within(host).queryByRole("progressbar")).not.toBeInTheDocument();
    expect(within(host).queryByText("The breakdown could not be loaded.")).not.toBeInTheDocument();
  });

  it("lists every kind of unmet slot by gain, a target-side relation with its reverse verb", () => {
    const { host } = renderContent({
      breakdown: state({
        factors: [
          factor("field", "cost", false, 25, { section: "Details", weight: 2 }),
          factor("lifecycle", "lifecycle", false, 12.5),
          factor("relation", "relOrgToApp", false, 12.5, {
            side: "target",
            other_type_key: "Organization",
            label: "is owned by",
          }),
          factor("tag_group", "g-1", false, 12.5, { name: "Criticality" }),
          factor("stakeholders", "stakeholders", false, 12.5),
        ],
      }),
    });
    expect(
      within(host)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([
      "Fill Annual Cost+25%",
      "Set lifecycle dates+12.5%",
      "Add relation: is owned by Organization+12.5%",
      "Tag with Criticality+12.5%",
      "Assign a stakeholder+12.5%",
    ]);
  });

  it("names every kind of counted slot, and a field the metamodel forgot", async () => {
    const { host } = renderContent({
      value: 100,
      breakdown: state({
        score: 100,
        factors: [
          factor("field", "team", true, null, { section: "Details" }),
          factor("field", "ghost", true, null),
          factor("description", "description", true, null),
          factor("lifecycle", "lifecycle", true, null),
          factor("relation", "relOrgToApp", true, null, {
            side: "source",
            other_type_key: "Application",
            label: "owns",
          }),
          factor("relation", "ghostRel", true, null, { side: "source" }),
          factor("tag_group", "g-1", true, null, { name: "Criticality" }),
          factor("stakeholders", "stakeholders", true, null),
        ],
      }),
    });
    expect(await countedNames(host, 8)).toEqual([
      "Team",
      "A field",
      "Description",
      "Lifecycle dates",
      "owns Application",
      "A required relation",
      "Criticality",
      "A stakeholder assigned",
    ]);
    expect(host).not.toHaveTextContent("ghost");
  });

  it("names a counted tag group by nothing rather than by its id when it has no name", async () => {
    const { host } = renderContent({
      value: 100,
      breakdown: state({
        score: 100,
        factors: [
          factor("tag_group", "g-1", true, null, { name: "Criticality" }),
          factor("tag_group", "g-77", true, null, { name: null }),
        ],
      }),
    });
    expect(await countedNames(host, 2)).toEqual(["Criticality", ""]);
    expect(host).not.toHaveTextContent("g-77");
  });

  it("tells a self-referencing relation's two mandatory ends apart", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { host } = renderContent({
      breakdown: state({
        factors: [
          factor("relation", "relOrgToApp", false, 12.5, {
            side: "source",
            other_type_key: "Application",
            label: "owns",
          }),
          factor("relation", "relOrgToApp", false, 12.5, {
            side: "target",
            other_type_key: "Organization",
            label: "is owned by",
          }),
        ],
      }),
    });
    expect(within(host).getByText("Add relation: owns Application")).toBeInTheDocument();
    expect(within(host).getByText("Add relation: is owned by Organization")).toBeInTheDocument();
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/same key/);
    consoleError.mockRestore();
  });

  it("never shows a field's key when the metamodel does not know the field", () => {
    const { host } = renderContent({
      value: 0,
      breakdown: state({
        score: 0,
        factors: [factor("field", "ghostField", false, 42.5), factor("relation", "ghostRel", false, 32.5)],
        blocked_by_required: ["ghostField"],
      }),
    });
    expect(within(host).getByText("Fill a field")).toBeInTheDocument();
    expect(within(host).getByText("Add a required relation")).toBeInTheDocument();
    expect(within(host).getByRole("alert")).toHaveTextContent("filled: A field");
    expect(host).not.toHaveTextContent("ghost");
  });

  it("leads with every gating field, then the slots by gain", () => {
    const { host } = renderContent({
      value: 0,
      breakdown: state({
        score: 0,
        ungated_score: 33.3,
        blocked_by_required: ["code", "cost"],
        // `code` weighs less than the optional lifecycle slot: by gain alone it
        // would sink below the slots that cannot move the score yet.
        factors: [...FACTORS, factor("field", "code", false, 8.3, { section: "Details" })],
      }),
    });
    expect(
      within(host)
        .getAllByRole("listitem")
        .map((li) => li.textContent)
        .slice(0, 3),
    ).toEqual(["Fill Annual Cost→ required", "Fill Business Code→ required", "Set lifecycle dates+12.5%"]);
    expect(within(host).getByText("+12.5%").closest(".MuiChip-root")).toHaveClass(
      "MuiChip-colorSuccess",
    );
  });

  describe("jump targets", () => {
    it("sends the stakeholder row to the Stakeholders tab", async () => {
      const onJump = vi.fn();
      const { host } = renderContent({ onJump });
      await userEvent.click(within(host).getByRole("button", { name: "Assign a stakeholder" }));
      expect(onJump).toHaveBeenCalledWith({ tab: "stakeholders" });
    });

    it("sends a field to its section and a relation to its group", async () => {
      const onJump = vi.fn();
      const { host } = renderContent({
        onJump,
        breakdown: state({
          factors: [
            factor("field", "cost", false, 25, { section: "Details" }),
            factor("relation", "relOrgToApp", false, 12.5, {
              side: "target",
              other_type_key: "Organization",
              label: "is owned by",
            }),
          ],
        }),
      });
      await userEvent.click(within(host).getByRole("button", { name: "Fill Annual Cost" }));
      expect(onJump).toHaveBeenLastCalledWith({
        tab: "card",
        anchor: "card-section-custom-details",
        sectionAnchor: "card-section-custom-details",
        fieldKey: "cost",
      });
      await userEvent.click(
        within(host).getByRole("button", { name: "Add relation: is owned by Organization" }),
      );
      expect(onJump).toHaveBeenLastCalledWith({
        tab: "card",
        anchor: "card-relation-relOrgToApp-target",
        sectionAnchor: "card-section-relations",
        relation: { type: "relOrgToApp", side: "target" },
      });
    });
  });
});
