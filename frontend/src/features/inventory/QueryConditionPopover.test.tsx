import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  APPLICATION_TYPE,
  HOSTING_GROUP,
  makeCardType,
  PROVIDER_TYPE,
  RISK_GROUP,
  TAG_GROUPS,
} from "@/test/fixtures/metamodel";
import { EOL_STATUS_COLORS } from "@/lib/eol";
import type { CardType } from "@/types";
import type { CardNameEntry } from "./useCardNames";

// The real picker is a whole card browser; the popover only needs to open it
// and hear what it applies.
vi.mock("@/components/CardMultiPicker", () => ({
  default: (props: {
    open: boolean;
    types?: string | string[];
    value: string[];
    initialOptions?: { id: string; name: string; type: string }[];
    title?: string;
    onChange: (ids: string[], picked: { id: string; name: string; type: string }[]) => void;
    onClose: () => void;
  }) =>
    props.open ? (
      <div
        data-testid="card-multi-picker"
        data-types={String(props.types)}
        data-value={props.value.join(",")}
        data-initial={(props.initialOptions ?? []).map((o) => `${o.id}=${o.name}`).join(",")}
        data-initial-types={(props.initialOptions ?? []).map((o) => o.type).join(",")}
        data-title={props.title}
      >
        <button
          onClick={() =>
            props.onChange(
              ["id1", "id2"],
              [
                { id: "id1", name: "One", type: "Application" },
                { id: "id2", name: "Two", type: "Application" },
              ],
            )
          }
        >
          apply-picker
        </button>
        <button onClick={props.onClose}>close-picker</button>
      </div>
    ) : null,
}));

import QueryConditionPopover from "./QueryConditionPopover";

type Kind = Parameters<typeof QueryConditionPopover>[0]["kind"];

const NO_NAMES = new Map<string, CardNameEntry>();

function renderEditor(
  kind: Kind,
  values: string[] = [],
  type: CardType | undefined = APPLICATION_TYPE,
  extra: { cardNames?: Map<string, CardNameEntry>; includeDescendants?: boolean } = {},
) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  const onIncludeDescendantsChange = vi.fn();
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  const view = render(
    <QueryConditionPopover
      anchorEl={anchor}
      onClose={onClose}
      type={type}
      kind={kind}
      values={values}
      tagGroups={TAG_GROUPS}
      cardNames={extra.cardNames ?? NO_NAMES}
      includeDescendants={extra.includeDescendants ?? false}
      onIncludeDescendantsChange={onIncludeDescendantsChange}
      onChange={onChange}
    />,
  );
  return { onChange, onClose, onIncludeDescendantsChange, ...view };
}

/** Opens the editor's dropdown and returns the offered option labels. */
function openOptions(): string[] {
  const popover = screen.getByTestId("query-condition-popover");
  fireEvent.mouseDown(within(popover).getByRole("combobox"));
  return screen.getAllByRole("option").map((o) => o.textContent ?? "");
}

describe("QueryConditionPopover", () => {
  it("offers the lifecycle phases plus (empty), and maps (empty) to none", () => {
    const { onChange } = renderEditor("lifecycle_phase");
    expect(openOptions()).toEqual([
      "(empty)",
      "Plan",
      "Phase In",
      "Active",
      "Phase Out",
      "End of Life",
    ]);
    fireEvent.click(screen.getByRole("option", { name: "(empty)" }));
    expect(onChange).toHaveBeenLastCalledWith(["none"]);
  });

  it("shows a stored none as (empty) and keeps it when another phase is added", () => {
    const { onChange } = renderEditor("lifecycle_phase", ["none"]);
    const popover = screen.getByTestId("query-condition-popover");
    expect(within(popover).getByText("(empty)", { selector: ".MuiChip-label" })).toBeInTheDocument();
    openOptions();
    fireEvent.click(screen.getByRole("option", { name: "Active" }));
    expect(onChange).toHaveBeenLastCalledWith(["none", "active"]);
  });

  it("offers no (empty) for the approval status", () => {
    const { onChange } = renderEditor("approval_status");
    expect(openOptions()).toEqual(["Draft", "Approved", "Broken", "Rejected"]);
    fireEvent.click(screen.getByRole("option", { name: "Approved" }));
    expect(onChange).toHaveBeenLastCalledWith(["APPROVED"]);
  });

  it("offers the three data quality bands, no (empty), and emits their keys", () => {
    const { onChange } = renderEditor("data_quality_band", ["complete"]);
    const popover = screen.getByTestId("query-condition-popover");
    expect(within(popover).getByText("Data Quality", { selector: "label" })).toBeInTheDocument();
    expect(openOptions()).toEqual(["Complete (≥80%)", "Partial (40-79%)", "Minimal (<40%)"]);
    fireEvent.click(screen.getByRole("option", { name: "Minimal (<40%)" }));
    expect(onChange).toHaveBeenLastCalledWith(["complete", "minimal"]);
  });

  it("offers the four EOL statuses plus (empty) and emits their keys", () => {
    const { onChange } = renderEditor("eol_status", ["eol"]);
    const popover = screen.getByTestId("query-condition-popover");
    expect(within(popover).getByText("End of life", { selector: "label" })).toBeInTheDocument();
    expect(openOptions()).toEqual([
      "(empty)",
      "End of Life",
      "Approaching EOL",
      "Supported",
      "Unknown",
    ]);
    fireEvent.click(screen.getByRole("option", { name: "Approaching EOL" }));
    expect(onChange).toHaveBeenLastCalledWith(["eol", "approaching"]);
    fireEvent.click(screen.getByRole("option", { name: "(empty)" }));
    expect(onChange).toHaveBeenLastCalledWith(["eol", "__empty__"]);
  });

  it("shows picked EOL statuses in their status colours and (empty) by its label", () => {
    renderEditor("eol_status", ["eol", "supported", "unknown", "__empty__"]);
    const popover = screen.getByTestId("query-condition-popover");
    const chip = (label: string) =>
      within(popover).getByText(label, { selector: ".MuiChip-label" }).closest(".MuiChip-root");
    expect(chip("End of Life")).toHaveStyle({ backgroundColor: EOL_STATUS_COLORS.eol });
    expect(chip("Supported")).toHaveStyle({ backgroundColor: EOL_STATUS_COLORS.supported });
    expect(chip("Unknown")).toHaveStyle({ backgroundColor: EOL_STATUS_COLORS.unknown });
    expect(chip("(empty)")).toBeInTheDocument();
  });

  it("offers Yes / No / (empty) for a boolean field and emits their keys", () => {
    const { onChange, rerender, onClose } = renderEditor({ attribute: "isCloud" });
    expect(openOptions()).toEqual(["(empty)", "Yes", "No"]);
    fireEvent.click(screen.getByRole("option", { name: "Yes" }));
    expect(onChange).toHaveBeenLastCalledWith(["true"]);
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    rerender(
      <QueryConditionPopover
        anchorEl={anchor}
        onClose={onClose}
        type={APPLICATION_TYPE}
        kind={{ attribute: "isCloud" }}
        values={["true"]}
        tagGroups={TAG_GROUPS}
        cardNames={NO_NAMES}
        includeDescendants={false}
        onIncludeDescendantsChange={vi.fn()}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("option", { name: "No" }));
    expect(onChange).toHaveBeenLastCalledWith(["true", "false"]);
    fireEvent.click(screen.getByRole("option", { name: "(empty)" }));
    expect(onChange).toHaveBeenLastCalledWith(["true", "__empty__"]);
  });

  it("labels a select field's options by label, never by key", () => {
    const { onChange } = renderEditor({ attribute: "businessCriticality" });
    const popover = screen.getByTestId("query-condition-popover");
    expect(within(popover).getByLabelText("Business Criticality")).toBeInTheDocument();
    const offered = openOptions();
    expect(offered).toEqual([
      "(empty)",
      "Mission Critical",
      "Business Critical",
      "Business Operational",
      "Administrative Service",
    ]);
    expect(offered).not.toContain("missionCritical");
    fireEvent.click(screen.getByRole("option", { name: "Business Critical" }));
    expect(onChange).toHaveBeenLastCalledWith(["businessCritical"]);
  });

  it("picks tags with the tag picker, from the groups that apply to the type, as ids", () => {
    const { onChange } = renderEditor("tags", [], PROVIDER_TYPE);
    const popover = screen.getByTestId("query-condition-popover");
    expect(within(popover).getByLabelText("Tags")).toBeInTheDocument();
    const offered = openOptions();
    // Hosting is restricted to Application / ITComponent; Risk applies everywhere.
    expect(offered).toEqual(RISK_GROUP.tags.map((tag) => tag.name));
    expect(offered).not.toContain("On-Prem");
    fireEvent.click(screen.getByRole("option", { name: "Audited" }));
    expect(onChange).toHaveBeenLastCalledWith([RISK_GROUP.tags[1].id]);
  });

  it("offers a restricted group's tags on a type it applies to", () => {
    renderEditor("tags", [], APPLICATION_TYPE);
    expect(openOptions()).toEqual([
      ...HOSTING_GROUP.tags.map((tag) => tag.name),
      ...RISK_GROUP.tags.map((tag) => tag.name),
    ]);
  });

  it("renders nothing and closes for a field the type does not have", () => {
    const { onClose, onChange } = renderEditor({ attribute: "noSuchField" });
    expect(screen.queryByTestId("query-condition-popover")).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("stays closed without an anchor", () => {
    const onClose = vi.fn();
    render(
      <QueryConditionPopover
        anchorEl={null}
        onClose={onClose}
        type={APPLICATION_TYPE}
        kind="lifecycle_phase"
        values={[]}
        tagGroups={TAG_GROUPS}
        cardNames={NO_NAMES}
        includeDescendants={false}
        onIncludeDescendantsChange={vi.fn()}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("query-condition-popover")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  describe("specific cards", () => {
    const NAMES = new Map<string, CardNameEntry>([
      ["a", { kind: "card", name: "Alpha", type: "Application" }],
      ["h", { kind: "hidden" }],
      ["u", { kind: "unknown" }],
    ]);
    const FLAT = makeCardType({ key: "Flat", label: "Flat Type", has_hierarchy: false });

    const chipLabels = () =>
      screen.getAllByTestId("query-cards-chip").map((c) => c.textContent ?? "");

    it("shows each picked card by name, a hidden or unknown one as such, a loading one by id", () => {
      renderEditor("cards", ["a", "h", "u", "loading"], APPLICATION_TYPE, { cardNames: NAMES });
      expect(chipLabels()).toEqual(["Alpha", "(hidden card)", "(unknown card)", "loading"]);
      expect(screen.queryByTestId("card-multi-picker")).not.toBeInTheDocument();
    });

    it("shows no chip while nothing is picked", () => {
      renderEditor("cards", [], APPLICATION_TYPE, { cardNames: NAMES });
      expect(screen.queryByTestId("query-cards-chip")).not.toBeInTheDocument();
      expect(screen.getByTestId("query-cards-pick")).toHaveTextContent("Pick cards…");
    });

    it("removes one card with its chip's ×", () => {
      const { onChange } = renderEditor("cards", ["a", "h", "u"], APPLICATION_TYPE, {
        cardNames: NAMES,
      });
      const chip = screen.getAllByTestId("query-cards-chip")[1];
      fireEvent.click(chip.querySelector(".MuiChip-deleteIcon") as Element);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenLastCalledWith(["a", "u"]);
    });

    it("seeds the picker with hidden, unknown and loading picks under their labels", () => {
      renderEditor("cards", ["h", "u", "a", "loading"], APPLICATION_TYPE, { cardNames: NAMES });
      fireEvent.click(screen.getByTestId("query-cards-pick"));
      const picker = screen.getByTestId("card-multi-picker");
      expect(picker).toHaveAttribute(
        "data-initial",
        "h=(hidden card),u=(unknown card),a=Alpha,loading=loading",
      );
      // A named card keeps its own type; the others take the node's type.
      expect(picker).toHaveAttribute(
        "data-initial-types",
        "Application,Application,Application,Application",
      );
    });

    it("seeds a hidden pick with the node's type, or an empty one when the node has none", () => {
      renderEditor("cards", ["h", "a"], FLAT, { cardNames: NAMES });
      fireEvent.click(screen.getByTestId("query-cards-pick"));
      const picker = screen.getByTestId("card-multi-picker");
      expect(picker).toHaveAttribute("data-initial", "h=(hidden card),a=Alpha");
      expect(picker).toHaveAttribute("data-initial-types", "Flat,Application");
    });

    it("seeds a hidden pick with an empty type when the node has no type", () => {
      render(
        <QueryConditionPopover
          anchorEl={document.body}
          onClose={vi.fn()}
          type={undefined}
          kind="cards"
          values={["u", "a"]}
          tagGroups={TAG_GROUPS}
          cardNames={NAMES}
          includeDescendants={false}
          onIncludeDescendantsChange={vi.fn()}
          onChange={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByTestId("query-cards-pick"));
      const picker = screen.getByTestId("card-multi-picker");
      expect(picker).toHaveAttribute("data-initial", "u=(unknown card),a=Alpha");
      expect(picker).toHaveAttribute("data-initial-types", ",Application");
    });

    it("opens the picker on the node's type, seeded with the picks, and applies what it returns", () => {
      const { onChange, onClose } = renderEditor("cards", ["a", "h"], APPLICATION_TYPE, {
        cardNames: NAMES,
      });
      fireEvent.click(screen.getByTestId("query-cards-pick"));
      const picker = screen.getByTestId("card-multi-picker");
      expect(picker).toHaveAttribute("data-types", "Application");
      expect(picker).toHaveAttribute("data-value", "a,h");
      // Every pick seeds the picker's basket, a hidden one under its label.
      expect(picker).toHaveAttribute("data-initial", "a=Alpha,h=(hidden card)");
      expect(picker).toHaveAttribute("data-title", "Pick cards…");
      fireEvent.click(screen.getByText("apply-picker"));
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenLastCalledWith(["id1", "id2"]);
      expect(screen.queryByTestId("card-multi-picker")).not.toBeInTheDocument();
      // The popover itself stays open.
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByTestId("query-condition-popover")).toBeInTheDocument();
    });

    it("closes the picker without a change when it is dismissed", () => {
      const { onChange } = renderEditor("cards", ["a"], APPLICATION_TYPE, { cardNames: NAMES });
      fireEvent.click(screen.getByTestId("query-cards-pick"));
      fireEvent.click(screen.getByText("close-picker"));
      expect(screen.queryByTestId("card-multi-picker")).not.toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
    });

    it("offers Include sub-cards only on a type with a hierarchy", () => {
      const { onIncludeDescendantsChange, unmount } = renderEditor("cards", ["a"], APPLICATION_TYPE, {
        cardNames: NAMES,
      });
      const toggle = within(screen.getByTestId("query-cards-subcards")).getByRole("checkbox");
      expect(screen.getByLabelText("Include sub-cards")).toBe(toggle);
      expect(toggle).not.toBeChecked();
      fireEvent.click(toggle);
      expect(onIncludeDescendantsChange).toHaveBeenCalledTimes(1);
      expect(onIncludeDescendantsChange).toHaveBeenLastCalledWith(true);
      unmount();

      const on = renderEditor("cards", ["a"], APPLICATION_TYPE, {
        cardNames: NAMES,
        includeDescendants: true,
      });
      const checked = within(screen.getByTestId("query-cards-subcards")).getByRole("checkbox");
      expect(checked).toBeChecked();
      fireEvent.click(checked);
      expect(on.onIncludeDescendantsChange).toHaveBeenLastCalledWith(false);
      on.unmount();

      renderEditor("cards", ["a"], FLAT, { cardNames: NAMES });
      expect(screen.queryByTestId("query-cards-subcards")).not.toBeInTheDocument();
      expect(screen.queryByText("Include sub-cards")).not.toBeInTheDocument();
    });
  });
});
