/**
 * The gallery's "Manage Groups" dialog: create, rename, recolour and delete
 * diagram groups against `/diagram-groups`. The dialog never holds the list —
 * it renders the `groups` prop and calls `onChanged` after every write so the
 * gallery refetches.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import { installConfirm } from "@/test/dom";
import type { DiagramGroup } from "@/types";
import ManageGroupsDialog from "./ManageGroupsDialog";

type Props = React.ComponentProps<typeof ManageGroupsDialog>;

const GROUPS: DiagramGroup[] = [
  { id: "g1", name: "Architecture", color: "#ff0000", sort_order: 0, diagram_count: 2 },
  { id: "g2", name: "Operations", color: null, sort_order: 1, diagram_count: 1 },
];

function renderDialog(overrides: Partial<Props> = {}) {
  const onClose = vi.fn();
  const onChanged = vi.fn();
  const user = userEvent.setup();
  const result = render(
    <ManageGroupsDialog open groups={GROUPS} onClose={onClose} onChanged={onChanged} {...overrides} />,
  );
  return { ...result, user, onClose, onChanged };
}

/** The list item holding a group's name. */
function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest("li") as HTMLElement;
}

beforeEach(() => {
  mockApi.reset();
  mockApi.on("post", "/diagram-groups", { id: "g3" });
  mockApi.on("patch", "/diagram-groups/*", {});
  mockApi.on("delete", "/diagram-groups/*", {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ManageGroupsDialog", () => {
  it("lists every group with its diagram count", () => {
    renderDialog();
    expect(screen.getByText("Manage Groups")).toBeInTheDocument();
    expect(within(rowOf("Architecture")).getByText("2 diagrams")).toBeInTheDocument();
    expect(within(rowOf("Operations")).getByText("1 diagram")).toBeInTheDocument();
  });

  it("shows the empty hint when there are no groups", () => {
    renderDialog({ groups: [] });
    expect(
      screen.getByText("No groups yet. Create one to organize your diagrams."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("creates a group on Enter with the default colour and the next sort order", async () => {
    const { user, onChanged } = renderDialog();
    const input = screen.getByPlaceholderText("New group name");
    await user.type(input, "  Security  {Enter}");
    expect(mockApi.callsOf("post", "/diagram-groups")[0].body).toEqual({
      name: "Security",
      color: "#60a5fa",
      sort_order: 2,
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue("");
  });

  it("keeps Add disabled for a blank name and creates on click otherwise", async () => {
    const { user, onChanged } = renderDialog();
    const add = screen.getByRole("button", { name: "Add" });
    expect(add).toBeDisabled();
    await user.type(screen.getByPlaceholderText("New group name"), "   ");
    expect(add).toBeDisabled();
    await user.type(screen.getByPlaceholderText("New group name"), "{Enter}");
    expect(mockApi.callsOf("post")).toHaveLength(0);
    await user.type(screen.getByPlaceholderText("New group name"), "Ops");
    await user.click(add);
    expect(mockApi.callsOf("post", "/diagram-groups")).toHaveLength(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("renames a group inline and patches the trimmed name on Enter", async () => {
    const { user, onChanged } = renderDialog();
    await user.click(within(rowOf("Architecture")).getByTitle("Rename"));
    const field = screen.getByDisplayValue("Architecture");
    await user.clear(field);
    await user.type(field, " Enterprise Architecture {Enter}");
    expect(mockApi.callsOf("patch", "/diagram-groups/g1")[0].body).toEqual({
      name: "Enterprise Architecture",
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
    // Back to read mode: the rename button returns and the field is gone.
    expect(screen.queryByDisplayValue("Enterprise Architecture")).not.toBeInTheDocument();
    expect(within(rowOf("Architecture")).getByTitle("Rename")).toBeInTheDocument();
  });

  it("commits a rename through the check button and refuses a blank name", async () => {
    const { user, onChanged } = renderDialog();
    const row = rowOf("Operations");
    await user.click(within(row).getByTitle("Rename"));
    const field = screen.getByDisplayValue("Operations");
    await user.clear(field);
    await user.keyboard("{Enter}");
    const check = within(row).getByRole("button", { name: "check" });
    await user.click(check);
    expect(mockApi.callsOf("patch")).toHaveLength(0);
    await user.type(field, "Ops");
    await user.click(check);
    expect(mockApi.callsOf("patch", "/diagram-groups/g2")[0].body).toEqual({ name: "Ops" });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("asks before deleting and skips the request when the user declines", async () => {
    const confirm = installConfirm(false);
    const { user, onChanged } = renderDialog();
    await user.click(within(rowOf("Architecture")).getByRole("button", { name: "delete" }));
    expect(confirm).toHaveBeenCalledWith(
      "Delete group «Architecture»? Diagrams are kept; they just lose this grouping.",
    );
    expect(mockApi.callsOf("delete")).toHaveLength(0);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("deletes the group once confirmed", async () => {
    installConfirm(true);
    const { user, onChanged } = renderDialog();
    await user.click(within(rowOf("Operations")).getByRole("button", { name: "delete" }));
    expect(mockApi.callsOf("delete", "/diagram-groups/g2")).toHaveLength(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("patches a group's colour from its swatch picker", async () => {
    const { user, onChanged } = renderDialog();
    // Swatch order: the new-group picker first, then one per listed group.
    const swatches = screen.getAllByLabelText("Pick color");
    expect(swatches).toHaveLength(3);
    await user.click(swatches[1]);
    await user.click(await screen.findByRole("button", { name: "Save" }));
    expect(mockApi.callsOf("patch", "/diagram-groups/g1")[0].body).toEqual({ color: "#ff0000" });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("closes through the Close button", async () => {
    const { user, onClose } = renderDialog();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("drops a pending rename and draft name when reopened", async () => {
    const { user, rerender } = renderDialog();
    await user.type(screen.getByPlaceholderText("New group name"), "Draft");
    await user.click(within(rowOf("Architecture")).getByTitle("Rename"));
    expect(screen.getByDisplayValue("Architecture")).toBeInTheDocument();
    const props = { groups: GROUPS, onClose: vi.fn(), onChanged: vi.fn() };
    rerender(<ManageGroupsDialog open={false} {...props} />);
    rerender(<ManageGroupsDialog open {...props} />);
    expect(screen.getByPlaceholderText("New group name")).toHaveValue("");
    expect(screen.queryByDisplayValue("Architecture")).not.toBeInTheDocument();
  });
});
