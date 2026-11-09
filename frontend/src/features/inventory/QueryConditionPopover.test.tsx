import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  APPLICATION_TYPE,
  HOSTING_GROUP,
  PROVIDER_TYPE,
  RISK_GROUP,
  TAG_GROUPS,
} from "@/test/fixtures/metamodel";
import type { CardType } from "@/types";
import QueryConditionPopover from "./QueryConditionPopover";

type Kind = Parameters<typeof QueryConditionPopover>[0]["kind"];

function renderEditor(kind: Kind, values: string[] = [], type: CardType | undefined = APPLICATION_TYPE) {
  const onChange = vi.fn();
  const onClose = vi.fn();
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
      onChange={onChange}
    />,
  );
  return { onChange, onClose, ...view };
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
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("query-condition-popover")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
