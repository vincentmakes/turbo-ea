/**
 * The inventory grid's Tags cell editor. It follows AG Grid's React editor
 * contract: `onValueChange` is called with the full `TagRef[]` on every
 * change, Save ends the edit through `stopEditing()` and Cancel (or Escape)
 * discards through `api.stopEditing(true)`. The picker inside enforces a
 * single-choice group by swapping the previous tag out, and the editor
 * resolves ids back to refs so the grid never sees a bare id.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { HOSTING_GROUP, RISK_GROUP, TAG_GROUPS } from "@/test/fixtures/metamodel";
import type { TagRef } from "@/types";
import TagsCellEditor from "./TagsCellEditor";

type Props = React.ComponentProps<typeof TagsCellEditor>;

const ON_PREM = HOSTING_GROUP.tags[0];
const CLOUD = HOSTING_GROUP.tags[1];
const AUDITED = RISK_GROUP.tags[1];

const onPremRef: TagRef = { id: ON_PREM.id, name: "On-Prem", color: ON_PREM.color, group_name: "Hosting" };

function renderEditor(overrides: Partial<Props> = {}) {
  const onValueChange = vi.fn();
  const stopEditing = vi.fn();
  const gridStopEditing = vi.fn();
  const user = userEvent.setup();
  render(
    <TagsCellEditor
      value={[onPremRef]}
      groups={TAG_GROUPS}
      typeKey="Application"
      onValueChange={onValueChange}
      stopEditing={stopEditing}
      api={{ stopEditing: gridStopEditing } as unknown as Props["api"]}
      {...overrides}
    />,
  );
  return { user, onValueChange, stopEditing, gridStopEditing };
}

async function pick(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("combobox", { name: "Tags" }));
  const listbox = await screen.findByRole("listbox");
  await user.click(within(listbox).getByRole("option", { name }));
}

describe("TagsCellEditor", () => {
  it("renders the current tags as group-prefixed chips", () => {
    renderEditor();
    expect(screen.getByRole("button", { name: "Hosting: On-Prem" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cancel/ })).toBeInTheDocument();
  });

  it("reports full tag refs, swapping the single-choice group's previous tag", async () => {
    const { user, onValueChange } = renderEditor();
    await pick(user, "Cloud");
    expect(onValueChange).toHaveBeenLastCalledWith([
      { id: CLOUD.id, name: "Cloud", color: CLOUD.color, group_name: "Hosting" },
    ]);
    expect(screen.getByRole("button", { name: "Hosting: Cloud" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hosting: On-Prem" })).not.toBeInTheDocument();
  });

  it("accumulates a tag from a multi-choice group alongside the single one", async () => {
    const { user, onValueChange } = renderEditor();
    await pick(user, "Audited");
    const last = onValueChange.mock.calls.at(-1)?.[0] as TagRef[];
    expect(last.map((t) => t.id).sort()).toEqual([AUDITED.id, ON_PREM.id].sort());
    expect(last.find((t) => t.id === AUDITED.id)).toEqual({
      id: AUDITED.id,
      name: "Audited",
      color: AUDITED.color,
      group_name: "Risk",
    });
  });

  it("reports an empty list once the last chip is removed", async () => {
    const { user, onValueChange } = renderEditor();
    const chip = screen.getByRole("button", { name: "Hosting: On-Prem" });
    await user.click(within(chip).getByTestId("CancelIcon"));
    expect(onValueChange).toHaveBeenLastCalledWith([]);
  });

  it("starts empty when the cell holds no value", () => {
    renderEditor({ value: undefined });
    expect(screen.queryByRole("button", { name: /Hosting:/ })).not.toBeInTheDocument();
  });

  it("commits on Save and discards on Cancel", async () => {
    const { user, stopEditing, gridStopEditing } = renderEditor();
    await user.click(screen.getByRole("button", { name: /Save/ }));
    expect(stopEditing).toHaveBeenCalledTimes(1);
    expect(gridStopEditing).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(gridStopEditing).toHaveBeenCalledWith(true);
  });

  it("discards on Escape without letting the key reach the grid", () => {
    const { gridStopEditing } = renderEditor();
    const input = screen.getByRole("combobox", { name: "Tags" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(gridStopEditing).toHaveBeenCalledWith(true);
    // Any other key is left to the picker.
    fireEvent.keyDown(input, { key: "a" });
    expect(gridStopEditing).toHaveBeenCalledTimes(1);
  });

  it("survives a Save press without a stopEditing callback", async () => {
    const { user } = renderEditor({ stopEditing: undefined });
    await user.click(screen.getByRole("button", { name: /Save/ }));
  });
  it("resolves tags from groups that arrive after the editor mounted", async () => {
    const onValueChange = vi.fn();
    const api = { stopEditing: vi.fn() } as unknown as Props["api"];
    const user = userEvent.setup();
    const { rerender } = render(
      <TagsCellEditor value={[onPremRef]} groups={[HOSTING_GROUP]} typeKey="Application" onValueChange={onValueChange} api={api} />,
    );
    rerender(
      <TagsCellEditor value={[onPremRef]} groups={TAG_GROUPS} typeKey="Application" onValueChange={onValueChange} api={api} />,
    );
    await pick(user, "Audited");
    const last = onValueChange.mock.calls.at(-1)?.[0] as TagRef[];
    expect(last.map((t) => t.id).sort()).toEqual([AUDITED.id, ON_PREM.id].sort());
  });

  it("keeps mouse-downs and Escape from reaching the grid around it", () => {
    const parentMouseDown = vi.fn();
    const parentKeyDown = vi.fn();
    const gridStopEditing = vi.fn();
    render(
      <div onMouseDown={parentMouseDown} onKeyDown={parentKeyDown}>
        <TagsCellEditor
          value={[onPremRef]}
          groups={TAG_GROUPS}
          onValueChange={vi.fn()}
          api={{ stopEditing: gridStopEditing } as unknown as Props["api"]}
        />
      </div>,
    );
    fireEvent.mouseDown(screen.getByRole("button", { name: /Save/ }));
    expect(parentMouseDown).not.toHaveBeenCalled();
    const input = screen.getByRole("combobox", { name: "Tags" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(gridStopEditing).toHaveBeenCalledWith(true);
    expect(parentKeyDown).not.toHaveBeenCalled();
    // Other keys still bubble to the grid.
    fireEvent.keyDown(input, { key: "a" });
    expect(parentKeyDown).toHaveBeenCalledTimes(1);
  });
});
