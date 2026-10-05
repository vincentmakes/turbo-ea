/**
 * Tag Management admin page: the group cards, and the five dialogs (new group,
 * add tag, edit group, edit tag, delete confirm) driven through the shared api
 * kit. `ColorPicker` is stubbed with a plain input — its popover is a
 * canvas-backed sketch picker that has its own tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/components/ColorPicker", () => ({
  default: ({
    value,
    onChange,
    label,
  }: {
    value: string;
    onChange: (c: string) => void;
    label?: string;
  }) => (
    <input aria-label={label ?? "color"} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import {
  CARD_TYPES,
  HOSTING_GROUP,
  RISK_GROUP,
  TAG_GROUPS,
  makeTag,
  makeTagGroup,
} from "@/test/fixtures/metamodel";
import TagsAdmin from "./TagsAdmin";

const EMPTY_GROUP = makeTagGroup({ id: "7a660000-0000-4000-8000-000000000003", name: "Empty" });
/** Four scoped types: two in the preview, two in the overflow, one unknown to the metamodel. */
const WIDE_GROUP = makeTagGroup({
  id: "7a660000-0000-4000-8000-000000000004",
  name: "Wide",
  restrict_to_types: ["Application", "ITComponent", "Provider", "Ghost"],
});
const GROUPS = [...TAG_GROUPS, EMPTY_GROUP, WIDE_GROUP];

function groupCard(name: string): HTMLElement {
  const card = screen.getByText(name).closest(".MuiCard-root");
  if (!(card instanceof HTMLElement)) throw new Error(`no card for group ${name}`);
  return card;
}

async function renderPage(): Promise<UserEvent> {
  const user = userEvent.setup();
  render(<TagsAdmin />);
  await screen.findByText("Hosting");
  return user;
}

async function expectNoDialog() {
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel(CARD_TYPES);
  mockApi.on("get", "/tag-groups", GROUPS);
});

describe("TagsAdmin list", () => {
  it("renders every group with its mode, mandatory and scope chips and its tags", async () => {
    await renderPage();

    const hosting = groupCard("Hosting");
    expect(within(hosting).getByText("single")).toBeInTheDocument();
    expect(within(hosting).getByText("Mandatory")).toBeInTheDocument();
    // Scope labels come from the metamodel, never the keys.
    expect(within(hosting).getByText("Scope: Application, IT Component")).toBeInTheDocument();
    for (const tag of ["On-Prem", "Cloud", "Critical"]) {
      expect(within(hosting).getByText(tag)).toBeInTheDocument();
    }

    const risk = groupCard("Risk");
    expect(within(risk).getByText("multi")).toBeInTheDocument();
    expect(within(risk).queryByText("Mandatory")).not.toBeInTheDocument();
    expect(within(risk).queryByText(/^Scope:/)).not.toBeInTheDocument();
    expect(within(risk).getByText("Audited")).toBeInTheDocument();

    expect(within(groupCard("Empty")).getByText("No tags")).toBeInTheDocument();
    expect(
      within(groupCard("Wide")).getByText("Scope: Application, IT Component +2"),
    ).toBeInTheDocument();
  });
});

describe("TagsAdmin groups", () => {
  it("creates a group once a name is typed and reloads the list", async () => {
    mockApi.on("post", "/tag-groups", {});
    const user = await renderPage();

    await user.click(screen.getByRole("button", { name: /New Tag Group/ }));
    const dialog = await screen.findByRole("dialog");
    const create = within(dialog).getByRole("button", { name: "Create" });
    expect(create).toBeDisabled();

    await user.type(within(dialog).getByLabelText("Group Name"), "Region");
    await user.click(create);

    await waitFor(() => expect(mockApi.callsOf("post", "/tag-groups")).toHaveLength(1));
    expect(mockApi.callsOf("post", "/tag-groups")[0].body).toEqual({ name: "Region" });
    await expectNoDialog();
    await waitFor(() => expect(mockApi.callsOf("get", "/tag-groups")).toHaveLength(2));
  });

  it("edits a group: name, description, mode, a type restriction and the mandatory flag", async () => {
    mockApi.on("patch", `/tag-groups/${RISK_GROUP.id}`, {});
    const user = await renderPage();

    await user.click(within(groupCard("Risk")).getByRole("button", { name: "Edit Tag Group" }));
    const dialog = await screen.findByRole("dialog");

    const name = within(dialog).getByLabelText("Group Name");
    expect(name).toHaveValue("Risk");
    await user.clear(name);
    await user.type(name, "Risk level");
    await user.type(within(dialog).getByLabelText("Description"), "How risky");

    const [modeSelect, typePicker] = within(dialog).getAllByRole("combobox");
    await user.click(modeSelect);
    await user.click(await screen.findByRole("option", { name: "Single" }));
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());

    await user.click(typePicker);
    const listbox = await screen.findByRole("listbox");
    // Hidden types are not offered.
    expect(within(listbox).queryByRole("option", { name: /Secret/ })).not.toBeInTheDocument();
    await user.click(within(listbox).getByRole("option", { name: /Provider/ }));

    await user.click(within(dialog).getByRole("checkbox"));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockApi.callsOf("patch", `/tag-groups/${RISK_GROUP.id}`)).toHaveLength(1),
    );
    expect(mockApi.callsOf("patch", `/tag-groups/${RISK_GROUP.id}`)[0].body).toEqual({
      name: "Risk level",
      description: "How risky",
      mode: "single",
      mandatory: true,
      restrict_to_types: ["Provider"],
    });
    await expectNoDialog();
  });

  it("sends a null restriction when every scoped type is removed", async () => {
    mockApi.on("patch", `/tag-groups/${HOSTING_GROUP.id}`, {});
    const user = await renderPage();

    await user.click(within(groupCard("Hosting")).getByRole("button", { name: "Edit Tag Group" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Application")).toBeInTheDocument();
    expect(within(dialog).getByText("IT Component")).toBeInTheDocument();

    await user.click(within(dialog).getAllByTestId("CancelIcon")[0]);
    await user.click(within(dialog).getAllByTestId("CancelIcon")[0]);
    expect(within(dialog).queryAllByTestId("CancelIcon")).toHaveLength(0);

    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mockApi.callsOf("patch", `/tag-groups/${HOSTING_GROUP.id}`)).toHaveLength(1),
    );
    expect(mockApi.callsOf("patch", `/tag-groups/${HOSTING_GROUP.id}`)[0].body).toEqual({
      name: "Hosting",
      description: "",
      mode: "single",
      mandatory: true,
      restrict_to_types: null,
    });
  });

  it("asks before deleting a group, cancels, then deletes and reloads", async () => {
    mockApi.on("delete", `/tag-groups/${RISK_GROUP.id}`, {});
    const user = await renderPage();

    await user.click(within(groupCard("Risk")).getByRole("button", { name: "Delete Tag Group" }));
    let dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        "Delete tag group «Risk»? All tags in this group will be removed from every card.",
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await expectNoDialog();
    expect(mockApi.callsOf("delete")).toHaveLength(0);

    await user.click(within(groupCard("Risk")).getByRole("button", { name: "Delete Tag Group" }));
    dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(mockApi.callsOf("delete", `/tag-groups/${RISK_GROUP.id}`)).toHaveLength(1),
    );
    await expectNoDialog();
    await waitFor(() => expect(mockApi.callsOf("get", "/tag-groups")).toHaveLength(2));
  });
});

describe("TagsAdmin tags", () => {
  const tagsPath = `/tag-groups/${HOSTING_GROUP.id}/tags`;

  it("adds a tag with a description and a picked colour", async () => {
    mockApi.on("post", tagsPath, {});
    const user = await renderPage();

    await user.click(within(groupCard("Hosting")).getByRole("button", { name: "Add Tag" }));
    const dialog = await screen.findByRole("dialog");
    const add = within(dialog).getByRole("button", { name: "Add" });
    expect(add).toBeDisabled();

    await user.type(within(dialog).getByLabelText("Tag Name"), "Hybrid");
    await user.type(within(dialog).getByLabelText("Description"), "Mixed hosting");
    const color = within(dialog).getByLabelText("Color");
    await user.clear(color);
    await user.type(color, "#ff0000");
    await user.click(add);

    await waitFor(() => expect(mockApi.callsOf("post", tagsPath)).toHaveLength(1));
    expect(mockApi.callsOf("post", tagsPath)[0].body).toEqual({
      name: "Hybrid",
      description: "Mixed hosting",
      color: "#ff0000",
    });
    await expectNoDialog();
  });

  it("sends a null description for a tag added without one", async () => {
    mockApi.on("post", tagsPath, {});
    const user = await renderPage();

    await user.click(within(groupCard("Hosting")).getByRole("button", { name: "Add Tag" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Tag Name"), "Edge");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    await waitFor(() => expect(mockApi.callsOf("post", tagsPath)).toHaveLength(1));
    expect(mockApi.callsOf("post", tagsPath)[0].body).toEqual({
      name: "Edge",
      description: null,
      color: "#1976d2",
    });
  });

  it("edits a tag from its chip and keeps its colour", async () => {
    const onPrem = HOSTING_GROUP.tags[0];
    mockApi.on("patch", `${tagsPath}/${onPrem.id}`, {});
    const user = await renderPage();

    await user.click(within(groupCard("Hosting")).getByText("On-Prem"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Edit Tag")).toBeInTheDocument();
    const name = within(dialog).getByLabelText("Tag Name");
    expect(name).toHaveValue("On-Prem");
    expect(within(dialog).getByLabelText("Color")).toHaveValue("#607d8b");

    await user.clear(name);
    await user.type(name, "On-Premises");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockApi.callsOf("patch", `${tagsPath}/${onPrem.id}`)).toHaveLength(1));
    expect(mockApi.callsOf("patch", `${tagsPath}/${onPrem.id}`)[0].body).toEqual({
      name: "On-Premises",
      description: null,
      color: "#607d8b",
    });
    await expectNoDialog();
  });

  it("deletes a tag from its chip after confirmation", async () => {
    const cloud = HOSTING_GROUP.tags[1];
    mockApi.on("delete", `${tagsPath}/${cloud.id}`, {});
    const user = await renderPage();

    await user.click(within(groupCard("Hosting")).getAllByTestId("CancelIcon")[1]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Delete Tag")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Delete tag «Cloud»? It will be removed from every card it is assigned to.",
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(mockApi.callsOf("delete", `${tagsPath}/${cloud.id}`)).toHaveLength(1));
    await expectNoDialog();
  });
});

/**
 * The dialogs' click handlers are async and unguarded, so one that throws
 * surfaces only as an unhandled rejection; collect those so a test can assert
 * a click was a clean no-op.
 */
function collectUnhandledRejections(): { reasons: unknown[]; stop: () => void } {
  const reasons: unknown[] = [];
  const onRejection = (reason: unknown) => {
    reasons.push(reason);
  };
  process.on("unhandledRejection", onRejection);
  return { reasons, stop: () => process.off("unhandledRejection", onRejection) };
}

describe("TagsAdmin details", () => {
  const tagsPath = `/tag-groups/${HOSTING_GROUP.id}/tags`;
  let rejections: ReturnType<typeof collectUnhandledRejections>;

  beforeEach(() => {
    rejections = collectUnhandledRejections();
  });

  afterEach(() => {
    rejections.stop();
  });

  async function openDialog(user: UserEvent, button: HTMLElement): Promise<HTMLElement> {
    await user.click(button);
    return screen.findByRole("dialog");
  }

  it("shows the page title, the group actions' hover titles and the full scope on the chip", async () => {
    await renderPage();
    expect(screen.getByText("Tag Management")).toBeInTheDocument();
    const hosting = groupCard("Hosting");
    expect(within(hosting).getByRole("button", { name: "Edit Tag Group" })).toHaveAttribute(
      "title",
      "Edit Tag Group",
    );
    expect(within(hosting).getByRole("button", { name: "Delete Tag Group" })).toHaveAttribute(
      "title",
      "Delete Tag Group",
    );
    expect(within(hosting).queryByText("No tags")).not.toBeInTheDocument();
    expect(
      within(groupCard("Wide")).getByLabelText("Application, IT Component, Provider, Ghost"),
    ).toBeInTheDocument();
  });

  it("shows no scope chip for an empty restriction and a tag's description as its hover title", async () => {
    const groupId = "7a660000-0000-4000-8000-000000000009";
    mockApi.on("get", "/tag-groups", [
      makeTagGroup({
        id: groupId,
        name: "Lifecycle",
        restrict_to_types: [],
        tags: [
          makeTag({ name: "Legacy", description: "Due for retirement", tag_group_id: groupId }),
          makeTag({ name: "Fresh", tag_group_id: groupId }),
        ],
      }),
    ]);
    render(<TagsAdmin />);
    const legacy = await screen.findByText("Legacy");
    const card = groupCard("Lifecycle");
    expect(within(card).queryByText(/^Scope:/)).not.toBeInTheDocument();
    expect(legacy.closest(".MuiChip-root")).toHaveAttribute("title", "Due for retirement");
    expect(within(card).getByText("Fresh").closest(".MuiChip-root")).not.toHaveAttribute("title");
  });

  it("edits a tag that has no colour from the default colour", async () => {
    const groupId = "7a660000-0000-4000-8000-000000000010";
    const plain = makeTag({ name: "Plain", tag_group_id: groupId });
    mockApi.on("get", "/tag-groups", [makeTagGroup({ id: groupId, name: "Misc", tags: [plain] })]);
    mockApi.on("patch", `/tag-groups/${groupId}/tags/${plain.id}`, {});
    const user = userEvent.setup();
    render(<TagsAdmin />);
    const dialog = await openDialog(user, await screen.findByText("Plain"));

    expect(within(dialog).getByLabelText("Color")).toHaveValue("#1976d2");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mockApi.callsOf("patch", `/tag-groups/${groupId}/tags/${plain.id}`)).toHaveLength(1),
    );
    expect(mockApi.callsOf("patch", `/tag-groups/${groupId}/tags/${plain.id}`)[0].body).toEqual({
      name: "Plain",
      description: null,
      color: "#1976d2",
    });
  });

  it("titles the new-group dialog, refuses a blank name, closes on Cancel and Escape, and starts empty again", async () => {
    mockApi.on("post", "/tag-groups", {});
    const user = await renderPage();
    const newGroup = screen.getByRole("button", { name: /New Tag Group/ });

    let dialog = await openDialog(user, newGroup);
    expect(within(dialog).getByText("New Tag Group")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Group Name"), "   ");
    expect(within(dialog).getByRole("button", { name: "Create" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await expectNoDialog();

    dialog = await openDialog(user, newGroup);
    fireEvent.keyDown(dialog, { key: "Escape" });
    await expectNoDialog();
    expect(mockApi.callsOf("post")).toHaveLength(0);

    dialog = await openDialog(user, newGroup);
    const name = within(dialog).getByLabelText("Group Name");
    await user.clear(name);
    await user.type(name, "Region");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await expectNoDialog();

    dialog = await openDialog(user, newGroup);
    expect(within(dialog).getByLabelText("Group Name")).toHaveValue("");
  });

  it("titles the add-tag dialog, trims the description, reloads and clears the form for the next tag", async () => {
    mockApi.on("post", tagsPath, {});
    const user = await renderPage();
    const addTag = within(groupCard("Hosting")).getByRole("button", { name: "Add Tag" });

    let dialog = await openDialog(user, addTag);
    expect(within(dialog).getByText("Add Tag")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Tag Name"), "   ");
    expect(within(dialog).getByRole("button", { name: "Add" })).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Tag Name"), "Hybrid");
    await user.type(within(dialog).getByLabelText("Description"), "  Mixed hosting  ");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    await waitFor(() => expect(mockApi.callsOf("post", tagsPath)).toHaveLength(1));
    expect(mockApi.callsOf("post", tagsPath)[0].body).toMatchObject({ description: "Mixed hosting" });
    await expectNoDialog();
    await waitFor(() => expect(mockApi.callsOf("get", "/tag-groups")).toHaveLength(2));

    dialog = await openDialog(user, addTag);
    expect(within(dialog).getByLabelText("Tag Name")).toHaveValue("");
    expect(within(dialog).getByLabelText("Description")).toHaveValue("");
    await user.type(within(dialog).getByLabelText("Tag Name"), "Edge");
    await user.type(within(dialog).getByLabelText("Description"), "   ");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(mockApi.callsOf("post", tagsPath)).toHaveLength(2));
    expect(mockApi.callsOf("post", tagsPath)[1].body).toMatchObject({ description: null });
  });

  it("closes the add-tag dialog on Cancel and on Escape without adding", async () => {
    const user = await renderPage();
    const addTag = within(groupCard("Hosting")).getByRole("button", { name: "Add Tag" });

    let dialog = await openDialog(user, addTag);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await expectNoDialog();
    dialog = await openDialog(user, addTag);
    fireEvent.keyDown(dialog, { key: "Escape" });
    await expectNoDialog();
    expect(mockApi.callsOf("post")).toHaveLength(0);
  });

  it("ignores an Add click that lands while the cancelled add-tag dialog is closing", async () => {
    const user = await renderPage();
    const dialog = await openDialog(
      user,
      within(groupCard("Hosting")).getByRole("button", { name: "Add Tag" }),
    );
    await user.type(within(dialog).getByLabelText("Tag Name"), "Hybrid");
    await user.tab();
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    const add = within(dialog).getByRole("button", { name: "Add" });

    fireEvent.click(cancel);
    fireEvent.click(add);

    await expectNoDialog();
    expect(mockApi.callsOf("post")).toHaveLength(0);
    expect(rejections.reasons).toEqual([]);
  });

  it("labels the edit-group form, shows the current mode and keeps an unrestricted group unrestricted", async () => {
    mockApi.on("patch", `/tag-groups/${RISK_GROUP.id}`, {});
    const user = await renderPage();
    const dialog = await openDialog(
      user,
      within(groupCard("Risk")).getByRole("button", { name: "Edit Tag Group" }),
    );

    expect(within(dialog).getByText("Edit Tag Group")).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: /^Mode/ })).toHaveTextContent("Multiple");
    expect(within(dialog).getByLabelText("Restrict to card types")).toBeInTheDocument();
    expect(within(dialog).getByText("Leave empty to apply to all card types")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Mandatory")).not.toBeChecked();

    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mockApi.callsOf("patch", `/tag-groups/${RISK_GROUP.id}`)).toHaveLength(1),
    );
    expect(mockApi.callsOf("patch", `/tag-groups/${RISK_GROUP.id}`)[0].body).toMatchObject({
      restrict_to_types: null,
    });
    await waitFor(() => expect(mockApi.callsOf("get", "/tag-groups")).toHaveLength(2));
  });

  it("marks the scoped types as selected, filters by label, and removes the chip that was clicked", async () => {
    mockApi.on("patch", `/tag-groups/${HOSTING_GROUP.id}`, {});
    const user = await renderPage();
    const dialog = await openDialog(
      user,
      within(groupCard("Hosting")).getByRole("button", { name: "Edit Tag Group" }),
    );
    const picker = within(dialog).getByLabelText("Restrict to card types");

    await user.click(picker);
    let listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByRole("option", { name: /Application/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(listbox).getByRole("option", { name: /Provider/ })).toHaveAttribute(
      "aria-selected",
      "false",
    );

    await user.type(picker, "Prov");
    listbox = await screen.findByRole("listbox");
    await waitFor(() => expect(within(listbox).getAllByRole("option")).toHaveLength(1));
    expect(within(listbox).getByRole("option", { name: /Provider/ })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());

    // Remove the second chip (IT Component), not the first.
    await user.click(within(dialog).getAllByTestId("CancelIcon")[1]);
    expect(within(dialog).queryByText("IT Component")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mockApi.callsOf("patch", `/tag-groups/${HOSTING_GROUP.id}`)).toHaveLength(1),
    );
    expect(mockApi.callsOf("patch", `/tag-groups/${HOSTING_GROUP.id}`)[0].body).toMatchObject({
      restrict_to_types: ["Application"],
    });
  });

  it("deselects a scoped type by clicking its option again", async () => {
    mockApi.on("patch", `/tag-groups/${HOSTING_GROUP.id}`, {});
    const user = await renderPage();
    const dialog = await openDialog(
      user,
      within(groupCard("Hosting")).getByRole("button", { name: "Edit Tag Group" }),
    );
    await user.click(within(dialog).getByLabelText("Restrict to card types"));
    const listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByRole("option", { name: /Application/ }));
    await waitFor(() => expect(within(dialog).queryByText("Application")).not.toBeInTheDocument());
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mockApi.callsOf("patch", `/tag-groups/${HOSTING_GROUP.id}`)).toHaveLength(1),
    );
    expect(mockApi.callsOf("patch", `/tag-groups/${HOSTING_GROUP.id}`)[0].body).toMatchObject({
      restrict_to_types: ["ITComponent"],
    });
  });

  it("refuses a blank group name and closes the edit-group dialog on Cancel and Escape", async () => {
    const user = await renderPage();
    const edit = within(groupCard("Risk")).getByRole("button", { name: "Edit Tag Group" });

    let dialog = await openDialog(user, edit);
    const name = within(dialog).getByLabelText("Group Name");
    await user.clear(name);
    await user.type(name, "   ");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await expectNoDialog();

    dialog = await openDialog(user, edit);
    fireEvent.keyDown(dialog, { key: "Escape" });
    await expectNoDialog();
    expect(mockApi.callsOf("patch")).toHaveLength(0);
  });

  it("ignores a Save click that lands while the cancelled edit-group dialog is closing", async () => {
    const user = await renderPage();
    const dialog = await openDialog(
      user,
      within(groupCard("Risk")).getByRole("button", { name: "Edit Tag Group" }),
    );
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    const save = within(dialog).getByRole("button", { name: "Save" });

    fireEvent.click(cancel);
    fireEvent.click(save);

    await expectNoDialog();
    expect(mockApi.callsOf("patch")).toHaveLength(0);
    expect(rejections.reasons).toEqual([]);
  });

  it("edits a tag's description and colour, trimming the description, and reloads", async () => {
    const onPrem = HOSTING_GROUP.tags[0];
    mockApi.on("patch", `${tagsPath}/${onPrem.id}`, {});
    const user = await renderPage();
    const dialog = await openDialog(user, within(groupCard("Hosting")).getByText("On-Prem"));

    await user.type(within(dialog).getByLabelText("Description"), "  Own racks  ");
    fireEvent.change(within(dialog).getByLabelText("Color"), { target: { value: "#00ff00" } });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockApi.callsOf("patch", `${tagsPath}/${onPrem.id}`)).toHaveLength(1));
    expect(mockApi.callsOf("patch", `${tagsPath}/${onPrem.id}`)[0].body).toEqual({
      name: "On-Prem",
      description: "Own racks",
      color: "#00ff00",
    });
    await expectNoDialog();
    await waitFor(() => expect(mockApi.callsOf("get", "/tag-groups")).toHaveLength(2));
  });

  it("refuses a blank tag name and closes the edit-tag dialog on Cancel and Escape", async () => {
    const user = await renderPage();
    let dialog = await openDialog(user, within(groupCard("Hosting")).getByText("On-Prem"));
    const name = within(dialog).getByLabelText("Tag Name");
    await user.clear(name);
    await user.type(name, "   ");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await expectNoDialog();

    dialog = await openDialog(user, within(groupCard("Hosting")).getByText("Cloud"));
    fireEvent.keyDown(dialog, { key: "Escape" });
    await expectNoDialog();
    expect(mockApi.callsOf("patch")).toHaveLength(0);
  });

  it("ignores a Save click that lands while the cancelled edit-tag dialog is closing", async () => {
    const user = await renderPage();
    const dialog = await openDialog(user, within(groupCard("Hosting")).getByText("On-Prem"));
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    const save = within(dialog).getByRole("button", { name: "Save" });

    fireEvent.click(cancel);
    fireEvent.click(save);

    await expectNoDialog();
    expect(mockApi.callsOf("patch")).toHaveLength(0);
    expect(rejections.reasons).toEqual([]);
  });

  it("titles a group delete as such and closes the confirm on Escape", async () => {
    const user = await renderPage();
    const dialog = await openDialog(
      user,
      within(groupCard("Risk")).getByRole("button", { name: "Delete Tag Group" }),
    );
    expect(within(dialog).getByText("Delete Tag Group")).toBeInTheDocument();
    expect(within(dialog).queryByText("Delete Tag")).not.toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await expectNoDialog();
    expect(mockApi.callsOf("delete")).toHaveLength(0);
  });

  it("ignores a Delete click that lands while the cancelled confirm is closing", async () => {
    const user = await renderPage();
    const dialog = await openDialog(
      user,
      within(groupCard("Risk")).getByRole("button", { name: "Delete Tag Group" }),
    );
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    const del = within(dialog).getByRole("button", { name: "Delete" });

    fireEvent.click(cancel);
    fireEvent.click(del);

    await expectNoDialog();
    expect(mockApi.callsOf("delete")).toHaveLength(0);
    expect(rejections.reasons).toEqual([]);
  });
});
