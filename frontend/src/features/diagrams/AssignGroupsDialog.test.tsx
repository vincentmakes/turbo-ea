/**
 * The gallery's "Add to Groups" dialog: tick the groups one diagram belongs
 * to, optionally create a group inline, and PUT the whole id set at once.
 * The dialog reports the saved ids back (`onSaved`) so the gallery can
 * re-render without a refetch, and asks for a group refetch after an inline
 * create (`onGroupsChanged`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import type { DiagramGroup, DiagramSummary } from "@/types";
import AssignGroupsDialog from "./AssignGroupsDialog";

type Props = React.ComponentProps<typeof AssignGroupsDialog>;

const GROUPS: DiagramGroup[] = [
  { id: "g1", name: "Architecture", color: "#ff0000", sort_order: 0, diagram_count: 2 },
  { id: "g2", name: "Operations", color: null, sort_order: 1, diagram_count: 1 },
];

const DIAGRAM: DiagramSummary = {
  id: "d1",
  name: "Landscape",
  card_ids: [],
  card_count: 0,
  group_ids: ["g1"],
};

function renderDialog(overrides: Partial<Props> = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const onGroupsChanged = vi.fn();
  const user = userEvent.setup();
  const result = render(
    <AssignGroupsDialog
      open
      diagram={DIAGRAM}
      groups={GROUPS}
      onClose={onClose}
      onSaved={onSaved}
      onGroupsChanged={onGroupsChanged}
      {...overrides}
    />,
  );
  return { ...result, user, onClose, onSaved, onGroupsChanged };
}

const checkbox = (name: string) => screen.getByRole("checkbox", { name });
const saveButton = () => screen.getByRole("button", { name: "Save" });

beforeEach(() => {
  mockApi.reset();
  mockApi.on("put", "/diagrams/d1/groups", {});
  mockApi.on("post", "/diagram-groups", (_p, body) => ({
    id: "g3",
    sort_order: 2,
    diagram_count: 0,
    ...(body as Record<string, unknown>),
  }));
});

describe("AssignGroupsDialog", () => {
  it("names the diagram and pre-ticks the groups it already belongs to", () => {
    renderDialog();
    expect(screen.getByText("Add to Groups")).toBeInTheDocument();
    expect(screen.getByText("Organize «Landscape» into one or more groups.")).toBeInTheDocument();
    expect(checkbox("Architecture")).toBeChecked();
    expect(checkbox("Operations")).not.toBeChecked();
  });

  it("saves the toggled set, reports it and closes", async () => {
    const { user, onSaved, onClose } = renderDialog();
    await user.click(checkbox("Operations"));
    await user.click(saveButton());
    expect(mockApi.callsOf("put", "/diagrams/d1/groups")[0].body).toEqual({
      group_ids: ["g1", "g2"],
    });
    expect(onSaved).toHaveBeenCalledWith(["g1", "g2"]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("can remove the diagram from every group", async () => {
    const { user, onSaved } = renderDialog();
    await user.click(checkbox("Architecture"));
    await user.click(saveButton());
    expect(mockApi.callsOf("put", "/diagrams/d1/groups")[0].body).toEqual({ group_ids: [] });
    expect(onSaved).toHaveBeenCalledWith([]);
  });

  it("shows the empty hint when there are no groups yet", () => {
    renderDialog({ groups: [] });
    expect(screen.getByText("No groups yet — create one below.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("creates a group inline on Enter, ticks it and asks for a refetch", async () => {
    const { user, onGroupsChanged, onSaved } = renderDialog();
    const input = screen.getByPlaceholderText("Create new group");
    await user.type(input, "  Security  {Enter}");
    expect(mockApi.callsOf("post", "/diagram-groups")[0].body).toEqual({
      name: "Security",
      sort_order: 2,
    });
    expect(onGroupsChanged).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue("");
    // The new group is part of the selection even before the parent refetches.
    await user.click(saveButton());
    expect(onSaved).toHaveBeenCalledWith(["g1", "g3"]);
  });

  it("creates through the button too and keeps it disabled for a blank name", async () => {
    const { user } = renderDialog();
    const create = screen.getByRole("button", { name: /Create/ });
    expect(create).toBeDisabled();
    await user.type(screen.getByPlaceholderText("Create new group"), "   ");
    expect(create).toBeDisabled();
    await user.type(screen.getByPlaceholderText("Create new group"), "Ops");
    await user.click(create);
    expect(mockApi.callsOf("post", "/diagram-groups")).toHaveLength(1);
  });

  it("ignores Enter on a blank name", async () => {
    const { user } = renderDialog();
    await user.type(screen.getByPlaceholderText("Create new group"), "{Enter}");
    expect(mockApi.callsOf("post", "/diagram-groups")).toHaveLength(0);
  });

  it("closes without saving on Cancel", async () => {
    const { user, onClose, onSaved } = renderDialog();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
    expect(mockApi.callsOf("put")).toHaveLength(0);
  });

  it("does nothing on Save without a diagram", async () => {
    const { user, onSaved } = renderDialog({ diagram: null });
    await user.click(saveButton());
    expect(onSaved).not.toHaveBeenCalled();
    expect(mockApi.callsOf("put")).toHaveLength(0);
  });

  it("re-seeds the selection when reopened on another diagram", () => {
    const { rerender } = renderDialog();
    const props = {
      groups: GROUPS,
      onClose: vi.fn(),
      onSaved: vi.fn(),
      onGroupsChanged: vi.fn(),
    };
    rerender(<AssignGroupsDialog open={false} diagram={DIAGRAM} {...props} />);
    rerender(
      <AssignGroupsDialog open diagram={{ ...DIAGRAM, id: "d2", name: "Ops map", group_ids: ["g2"] }} {...props} />,
    );
    expect(screen.getByText("Organize «Ops map» into one or more groups.")).toBeInTheDocument();
    expect(checkbox("Architecture")).not.toBeChecked();
    expect(checkbox("Operations")).toBeChecked();
  });
  it("saves an empty set for a diagram that carries no group ids", async () => {
    const { user, onSaved } = renderDialog({ diagram: { ...DIAGRAM, group_ids: undefined } });
    expect(checkbox("Architecture")).not.toBeChecked();
    await user.click(saveButton());
    expect(mockApi.callsOf("put", "/diagrams/d1/groups")[0].body).toEqual({ group_ids: [] });
    expect(onSaved).toHaveBeenCalledWith([]);
  });

  it("renders a blank name and an empty create field without a diagram", () => {
    renderDialog({ diagram: null });
    expect(screen.getByText("Organize «» into one or more groups.")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Create new group")).toHaveValue("");
  });

  it("disables Save while the request is in flight and re-enables it after", async () => {
    let release: () => void = () => {};
    mockApi.on("put", "/diagrams/d1/groups", () => new Promise((resolve) => (release = () => resolve({}))));
    const { user, onSaved } = renderDialog();
    await user.click(saveButton());
    await waitFor(() => expect(saveButton()).toBeDisabled());
    expect(onSaved).not.toHaveBeenCalled();
    release();
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(["g1"]));
    await waitFor(() => expect(saveButton()).toBeEnabled());
  });
});
