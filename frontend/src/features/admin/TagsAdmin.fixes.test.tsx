/**
 * Tag Management admin, regression tests: a failed request is reported (in
 * the dialog that sent it, which stays open; on the page for a failed load)
 * instead of being swallowed as an unhandled rejection, and names are saved
 * trimmed, the way the dialogs' enabled check already reads them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
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
import { CARD_TYPES, HOSTING_GROUP, RISK_GROUP, TAG_GROUPS } from "@/test/fixtures/metamodel";
import TagsAdmin from "./TagsAdmin";

const tagsPath = `/tag-groups/${HOSTING_GROUP.id}/tags`;
const onPrem = HOSTING_GROUP.tags[0];
const cloud = HOSTING_GROUP.tags[1];

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

let rejections: unknown[];
const onRejection = (reason: unknown) => {
  rejections.push(reason);
};

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel(CARD_TYPES);
  mockApi.on("get", "/tag-groups", TAG_GROUPS);
  rejections = [];
  process.on("unhandledRejection", onRejection);
});

afterEach(() => {
  process.off("unhandledRejection", onRejection);
});

/** Submit `submit` in the open dialog and expect the failure to be shown there. */
async function expectFailureShown(user: UserEvent, dialog: HTMLElement, submit: string, message: string) {
  await user.click(within(dialog).getByRole("button", { name: submit }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(message);
  expect(screen.getByRole("dialog")).toBe(dialog);
  // Nothing was reloaded, and nothing escaped as an unhandled rejection.
  expect(mockApi.callsOf("get", "/tag-groups")).toHaveLength(1);
  expect(rejections).toEqual([]);
}

describe("TagsAdmin failed requests", () => {
  it("keeps the new-group dialog open with the error when creating fails", async () => {
    mockApi.fail("post", "/tag-groups");
    const user = await renderPage();
    await user.click(screen.getByRole("button", { name: /New Tag Group/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Group Name"), "Region");
    await expectFailureShown(user, dialog, "Create", "POST /tag-groups failed");
    expect(within(dialog).getByLabelText("Group Name")).toHaveValue("Region");
  });

  it("keeps the add-tag dialog open with the error when adding fails", async () => {
    mockApi.fail("post", tagsPath);
    const user = await renderPage();
    await user.click(within(groupCard("Hosting")).getByRole("button", { name: "Add Tag" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Tag Name"), "Hybrid");
    await expectFailureShown(user, dialog, "Add", `POST ${tagsPath} failed`);
  });

  it("keeps the edit-group dialog open with the error when saving fails", async () => {
    mockApi.fail("patch", `/tag-groups/${RISK_GROUP.id}`);
    const user = await renderPage();
    await user.click(within(groupCard("Risk")).getByRole("button", { name: "Edit Tag Group" }));
    const dialog = await screen.findByRole("dialog");
    await expectFailureShown(user, dialog, "Save", `PATCH /tag-groups/${RISK_GROUP.id} failed`);
  });

  it("keeps the edit-tag dialog open with the error when saving fails", async () => {
    mockApi.fail("patch", `${tagsPath}/${onPrem.id}`);
    const user = await renderPage();
    await user.click(within(groupCard("Hosting")).getByText("On-Prem"));
    const dialog = await screen.findByRole("dialog");
    await expectFailureShown(user, dialog, "Save", `PATCH ${tagsPath}/${onPrem.id} failed`);
  });

  it("keeps the delete confirmation open with the error when deleting a group fails", async () => {
    mockApi.fail("delete", `/tag-groups/${RISK_GROUP.id}`);
    const user = await renderPage();
    await user.click(within(groupCard("Risk")).getByRole("button", { name: "Delete Tag Group" }));
    const dialog = await screen.findByRole("dialog");
    await expectFailureShown(user, dialog, "Delete", `DELETE /tag-groups/${RISK_GROUP.id} failed`);
  });

  it("keeps the delete confirmation open with the error when deleting a tag fails", async () => {
    mockApi.fail("delete", `${tagsPath}/${cloud.id}`);
    const user = await renderPage();
    await user.click(within(groupCard("Hosting")).getAllByTestId("CancelIcon")[1]);
    const dialog = await screen.findByRole("dialog");
    await expectFailureShown(user, dialog, "Delete", `DELETE ${tagsPath}/${cloud.id} failed`);
  });

  it("reports a failure that is not an Error generically", async () => {
    mockApi.on("post", "/tag-groups", () => Promise.reject("down"));
    const user = await renderPage();
    await user.click(screen.getByRole("button", { name: /New Tag Group/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Group Name"), "Region");
    await expectFailureShown(user, dialog, "Create", "Something went wrong");
  });

  it("opens every dialog without the error an earlier one showed", async () => {
    mockApi.fail("post", "/tag-groups");
    const user = await renderPage();
    const openers: [string, () => HTMLElement][] = [
      ["new group", () => screen.getByRole("button", { name: /New Tag Group/ })],
      ["add tag", () => within(groupCard("Hosting")).getByRole("button", { name: "Add Tag" })],
      ["edit group", () => within(groupCard("Risk")).getByRole("button", { name: "Edit Tag Group" })],
      ["edit tag", () => within(groupCard("Hosting")).getByText("On-Prem")],
      ["delete group", () => within(groupCard("Risk")).getByRole("button", { name: "Delete Tag Group" })],
      ["delete tag", () => within(groupCard("Hosting")).getAllByTestId("CancelIcon")[1]],
    ];
    for (const [what, opener] of openers) {
      // A failed create leaves its error behind in the dialog…
      await user.click(screen.getByRole("button", { name: /New Tag Group/ }));
      let dialog = await screen.findByRole("dialog");
      await user.clear(within(dialog).getByLabelText("Group Name"));
      await user.type(within(dialog).getByLabelText("Group Name"), "Region");
      await user.click(within(dialog).getByRole("button", { name: "Create" }));
      expect(await within(dialog).findByRole("alert")).toHaveTextContent("POST /tag-groups failed");
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      // …which the next dialog does not inherit.
      await user.click(opener());
      dialog = await screen.findByRole("dialog");
      expect(within(dialog).queryByRole("alert"), what).not.toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    }
  });

  it("closes the dialog and reloads once a retried create succeeds", async () => {
    let fail = true;
    mockApi.on("post", "/tag-groups", () => {
      if (fail) throw new Error("db down");
      return {};
    });
    const user = await renderPage();
    await user.click(screen.getByRole("button", { name: /New Tag Group/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Group Name"), "Region");
    await expectFailureShown(user, dialog, "Create", "db down");

    fail = false;
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(mockApi.callsOf("get", "/tag-groups")).toHaveLength(2));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a failed load on the page", async () => {
    mockApi.fail("get", "/tag-groups");
    render(<TagsAdmin />);
    expect(await screen.findByRole("alert")).toHaveTextContent("GET /tag-groups failed");
    expect(rejections).toEqual([]);
  });

  it("shows a failed load that is not an Error generically, and clears it on the next good load", async () => {
    mockApi.on("get", "/tag-groups", () => Promise.reject("down"));
    mockApi.on("post", "/tag-groups", {});
    const user = userEvent.setup();
    render(<TagsAdmin />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");

    mockApi.on("get", "/tag-groups", TAG_GROUPS);
    await user.click(screen.getByRole("button", { name: /New Tag Group/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Group Name"), "Region");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Hosting")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("TagsAdmin names", () => {
  it("creates a group under its trimmed name", async () => {
    mockApi.on("post", "/tag-groups", {});
    const user = await renderPage();
    await user.click(screen.getByRole("button", { name: /New Tag Group/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Group Name"), "  Region  ");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(mockApi.callsOf("post", "/tag-groups")).toHaveLength(1));
    expect(mockApi.callsOf("post", "/tag-groups")[0].body).toEqual({ name: "Region" });
  });

  it("adds a tag under its trimmed name", async () => {
    mockApi.on("post", tagsPath, {});
    const user = await renderPage();
    await user.click(within(groupCard("Hosting")).getByRole("button", { name: "Add Tag" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Tag Name"), " Hybrid ");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(mockApi.callsOf("post", tagsPath)).toHaveLength(1));
    expect(mockApi.callsOf("post", tagsPath)[0].body).toMatchObject({ name: "Hybrid" });
  });
});

describe("TagsAdmin edited names", () => {
  it("saves an edited group under its trimmed name", async () => {
    mockApi.on("patch", `/tag-groups/${RISK_GROUP.id}`, {});
    const user = await renderPage();
    await user.click(within(groupCard("Risk")).getByRole("button", { name: "Edit Tag Group" }));
    const dialog = await screen.findByRole("dialog");
    const name = within(dialog).getByLabelText("Group Name");
    await user.clear(name);
    await user.type(name, "  Risk level  ");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mockApi.callsOf("patch", `/tag-groups/${RISK_GROUP.id}`)).toHaveLength(1),
    );
    expect(mockApi.callsOf("patch", `/tag-groups/${RISK_GROUP.id}`)[0].body).toMatchObject({
      name: "Risk level",
    });
  });

  it("saves an edited group's description trimmed, as a tag's is", async () => {
    mockApi.on("patch", `/tag-groups/${RISK_GROUP.id}`, {});
    const user = await renderPage();
    await user.click(within(groupCard("Risk")).getByRole("button", { name: "Edit Tag Group" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Description"), "  How risky  ");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mockApi.callsOf("patch", `/tag-groups/${RISK_GROUP.id}`)).toHaveLength(1),
    );
    expect(mockApi.callsOf("patch", `/tag-groups/${RISK_GROUP.id}`)[0].body).toMatchObject({
      description: "How risky",
    });
  });

  it("saves a blank group description as no description", async () => {
    mockApi.on("patch", `/tag-groups/${RISK_GROUP.id}`, {});
    const user = await renderPage();
    await user.click(within(groupCard("Risk")).getByRole("button", { name: "Edit Tag Group" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Description"), "   ");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mockApi.callsOf("patch", `/tag-groups/${RISK_GROUP.id}`)).toHaveLength(1),
    );
    expect(mockApi.callsOf("patch", `/tag-groups/${RISK_GROUP.id}`)[0].body).toMatchObject({
      description: null,
    });
  });

  it("saves an edited tag under its trimmed name", async () => {
    mockApi.on("patch", `${tagsPath}/${onPrem.id}`, {});
    const user = await renderPage();
    await user.click(within(groupCard("Hosting")).getByText("On-Prem"));
    const dialog = await screen.findByRole("dialog");
    const name = within(dialog).getByLabelText("Tag Name");
    await user.clear(name);
    await user.type(name, " On-Premises ");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockApi.callsOf("patch", `${tagsPath}/${onPrem.id}`)).toHaveLength(1));
    expect(mockApi.callsOf("patch", `${tagsPath}/${onPrem.id}`)[0].body).toMatchObject({
      name: "On-Premises",
    });
  });
});

describe("TagsAdmin double submit", () => {
  /** A reply that stays pending until the test releases it. */
  function pending() {
    let release: () => void = () => {};
    const reply = () =>
      new Promise<object>((resolve) => {
        release = () => resolve({});
      });
    return { reply, release: () => release() };
  }

  /**
   * Click `submit` twice before the first request settles: one request is
   * sent, the button is disabled while it is in flight, and the dialog closes
   * once it succeeds.
   */
  async function expectSingleSubmit(
    dialog: HTMLElement,
    submit: string,
    method: "post" | "patch" | "delete",
    path: string,
    release: () => void,
  ) {
    const button = within(dialog).getByRole("button", { name: submit });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mockApi.callsOf(method, path)).toHaveLength(1);
    await waitFor(() => expect(within(dialog).getByRole("button", { name: submit })).toBeDisabled());
    fireEvent.click(within(dialog).getByRole("button", { name: submit }));
    expect(mockApi.callsOf(method, path)).toHaveLength(1);
    release();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf(method, path)).toHaveLength(1);
  }

  it("creates a group once on a double click", async () => {
    const { reply, release } = pending();
    mockApi.on("post", "/tag-groups", reply);
    const user = await renderPage();
    await user.click(screen.getByRole("button", { name: /New Tag Group/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Group Name"), "Region");
    await expectSingleSubmit(dialog, "Create", "post", "/tag-groups", release);
  });

  it("adds a tag once on a double click", async () => {
    const { reply, release } = pending();
    mockApi.on("post", tagsPath, reply);
    const user = await renderPage();
    await user.click(within(groupCard("Hosting")).getByRole("button", { name: "Add Tag" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Tag Name"), "Hybrid");
    await expectSingleSubmit(dialog, "Add", "post", tagsPath, release);
  });

  it("saves a group once on a double click", async () => {
    const { reply, release } = pending();
    mockApi.on("patch", `/tag-groups/${RISK_GROUP.id}`, reply);
    const user = await renderPage();
    await user.click(within(groupCard("Risk")).getByRole("button", { name: "Edit Tag Group" }));
    const dialog = await screen.findByRole("dialog");
    await expectSingleSubmit(dialog, "Save", "patch", `/tag-groups/${RISK_GROUP.id}`, release);
  });

  it("saves a tag once on a double click", async () => {
    const { reply, release } = pending();
    mockApi.on("patch", `${tagsPath}/${onPrem.id}`, reply);
    const user = await renderPage();
    await user.click(within(groupCard("Hosting")).getByText("On-Prem"));
    const dialog = await screen.findByRole("dialog");
    await expectSingleSubmit(dialog, "Save", "patch", `${tagsPath}/${onPrem.id}`, release);
  });

  it("deletes once on a double click", async () => {
    const { reply, release } = pending();
    mockApi.on("delete", `/tag-groups/${RISK_GROUP.id}`, reply);
    const user = await renderPage();
    await user.click(within(groupCard("Risk")).getByRole("button", { name: "Delete Tag Group" }));
    const dialog = await screen.findByRole("dialog");
    await expectSingleSubmit(dialog, "Delete", "delete", `/tag-groups/${RISK_GROUP.id}`, release);
  });

  it("lets the user submit again after a failed request", async () => {
    let fail = true;
    mockApi.on("post", "/tag-groups", () => {
      if (fail) throw new Error("db down");
      return {};
    });
    const user = await renderPage();
    await user.click(screen.getByRole("button", { name: /New Tag Group/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Group Name"), "Region");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("db down");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Create" })).toBeEnabled());
    fail = false;
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("post", "/tag-groups")).toHaveLength(2);
  });
});
