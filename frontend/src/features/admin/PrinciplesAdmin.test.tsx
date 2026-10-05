/**
 * EA principles admin: the list with its rationale / implications bullets, the
 * EA Delivery display toggle, the create / edit dialog, the active toggle and
 * the delete confirm, driven through the shared api kit.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import userEvent, { type UserEvent } from "@testing-library/user-event";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import i18n from "@/i18n";
import type { EAPrinciple } from "@/types";
import PrinciplesAdmin from "./PrinciplesAdmin";

const PATH = "/metamodel/principles";
const DISPLAY = "/settings/principles-display";

const REUSE: EAPrinciple = {
  id: "p-1",
  title: "Reuse before Buy before Build",
  description: "Prefer what exists. See https://example.com/principles",
  rationale: "Lower cost\nFaster delivery",
  implications: "Check the catalogue first",
  is_active: true,
  sort_order: 0,
};
const CLOUD: EAPrinciple = {
  id: "p-2",
  title: "Cloud first",
  is_active: false,
  sort_order: 1,
};
const ITEMS = [REUSE, CLOUD];

function rowOf(title: string): HTMLElement {
  const row = screen.getByText(title).closest(".MuiCard-root");
  if (!(row instanceof HTMLElement)) throw new Error(`no row for ${title}`);
  return row;
}

/** The EA Delivery display switch sits above the list, outside any card. */
function displaySwitch(): HTMLElement {
  return screen.getByLabelText("Show EA Principles tab on the EA Delivery page");
}

async function renderPage(): Promise<UserEvent> {
  const user = userEvent.setup();
  render(<PrinciplesAdmin />);
  await screen.findByText(REUSE.title);
  return user;
}

async function expectNoDialog() {
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}

beforeEach(() => {
  mockApi.reset();
  mockApi.on("get", PATH, ITEMS);
  mockApi.on("get", DISPLAY, { enabled: true });
});

describe("PrinciplesAdmin list", () => {
  it("renders each principle with its linkified statement, bullets and active state", async () => {
    await renderPage();

    const reuse = rowOf(REUSE.title);
    expect(within(reuse).getByRole("link", { name: "https://example.com/principles" })).toHaveAttribute(
      "href",
      "https://example.com/principles",
    );
    expect(within(reuse).getByText("Rationale:")).toBeInTheDocument();
    const bullets = within(reuse).getAllByRole("listitem").map((li) => li.textContent);
    expect(bullets).toEqual(["Lower cost", "Faster delivery", "Check the catalogue first"]);
    expect(within(reuse).getByRole("checkbox")).toBeChecked();
    expect(within(reuse).queryByText("Inactive")).not.toBeInTheDocument();

    const cloud = rowOf(CLOUD.title);
    expect(within(cloud).getByText("Inactive")).toBeInTheDocument();
    expect(within(cloud).getByRole("checkbox")).not.toBeChecked();
    expect(within(cloud).queryByRole("listitem")).not.toBeInTheDocument();

    expect(displaySwitch()).toBeChecked();
  });

  it("shows the empty state and the display setting when there is nothing yet", async () => {
    mockApi.on("get", PATH, []);
    mockApi.on("get", DISPLAY, { enabled: false });
    render(<PrinciplesAdmin />);

    expect(
      await screen.findByText(
        "No EA principles defined yet. Add principles to guide your architecture decisions.",
      ),
    ).toBeInTheDocument();
    expect(displaySwitch()).not.toBeChecked();
  });

  it("reports a failed load in a dismissible alert", async () => {
    mockApi.fail("get", DISPLAY);
    const user = userEvent.setup();
    render(<PrinciplesAdmin />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Failed to load principles");
    await user.click(within(alert).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("persists the EA Delivery display toggle and reverts it when the save fails", async () => {
    mockApi.on("patch", DISPLAY, {});
    const user = await renderPage();

    await user.click(displaySwitch());
    await waitFor(() => expect(mockApi.callsOf("patch", DISPLAY)).toHaveLength(1));
    expect(mockApi.callsOf("patch", DISPLAY)[0].body).toEqual({ enabled: false });
    expect(displaySwitch()).not.toBeChecked();

    mockApi.fail("patch", DISPLAY);
    await user.click(displaySwitch());
    await waitFor(() => expect(mockApi.callsOf("patch", DISPLAY)).toHaveLength(2));
    // Optimistic flip, then rolled back on the error.
    await waitFor(() => expect(displaySwitch()).not.toBeChecked());
  });

  it("toggles a principle's active flag and reloads", async () => {
    mockApi.on("patch", `${PATH}/p-1`, {});
    const user = await renderPage();

    await user.click(within(rowOf(REUSE.title)).getByRole("checkbox"));

    await waitFor(() => expect(mockApi.callsOf("patch", `${PATH}/p-1`)).toHaveLength(1));
    expect(mockApi.callsOf("patch", `${PATH}/p-1`)[0].body).toEqual({ is_active: false });
    await waitFor(() => expect(mockApi.callsOf("get", PATH)).toHaveLength(2));
  });
});

describe("PrinciplesAdmin dialog", () => {
  it("creates a principle, nulling empty sections and appending it to the order", async () => {
    mockApi.on("post", PATH, {});
    const user = await renderPage();

    await user.click(screen.getByRole("button", { name: /New Principle/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Create EA Principle")).toBeInTheDocument();
    const create = within(dialog).getByRole("button", { name: "Create" });
    expect(create).toBeDisabled();

    await user.type(within(dialog).getByLabelText("Principle Title"), "Secure by design");
    await user.type(within(dialog).getByLabelText("Statement"), "Security is built in.");
    await user.type(within(dialog).getByLabelText("Rationale"), "Fewer incidents");
    await user.click(create);

    await waitFor(() => expect(mockApi.callsOf("post", PATH)).toHaveLength(1));
    expect(mockApi.callsOf("post", PATH)[0].body).toEqual({
      title: "Secure by design",
      description: "Security is built in.",
      rationale: "Fewer incidents",
      implications: null,
      is_active: true,
      sort_order: 2,
    });
    await expectNoDialog();
    await waitFor(() => expect(mockApi.callsOf("get", PATH)).toHaveLength(2));
  });

  it("edits a principle from its prefilled form", async () => {
    mockApi.on("patch", `${PATH}/p-2`, {});
    const user = await renderPage();

    await user.click(within(rowOf(CLOUD.title)).getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Edit EA Principle")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Principle Title")).toHaveValue("Cloud first");
    expect(within(dialog).getByLabelText("Statement")).toHaveValue("");

    await user.type(within(dialog).getByLabelText("Implications"), "Exit on-prem leases");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockApi.callsOf("patch", `${PATH}/p-2`)).toHaveLength(1));
    expect(mockApi.callsOf("patch", `${PATH}/p-2`)[0].body).toEqual({
      title: "Cloud first",
      description: null,
      rationale: null,
      implications: "Exit on-prem leases",
      is_active: false,
    });
    await expectNoDialog();
  });

  it("reports a failed save and keeps the dialog open", async () => {
    mockApi.fail("post", PATH);
    const user = await renderPage();

    await user.click(screen.getByRole("button", { name: /New Principle/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Principle Title"), "Broken");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(await screen.findByRole("alert", { hidden: true })).toHaveTextContent("Failed to save principle");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("PrinciplesAdmin delete", () => {
  it("confirms, cancels, then deletes and reloads", async () => {
    mockApi.on("delete", `${PATH}/p-2`, {});
    const user = await renderPage();

    await user.click(within(rowOf(CLOUD.title)).getByRole("button", { name: "Delete" }));
    let dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Delete Principle?")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Are you sure you want to delete the principle «Cloud first»?"),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await expectNoDialog();
    expect(mockApi.callsOf("delete")).toHaveLength(0);

    await user.click(within(rowOf(CLOUD.title)).getByRole("button", { name: "Delete" }));
    dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(mockApi.callsOf("delete", `${PATH}/p-2`)).toHaveLength(1));
    await expectNoDialog();
    await waitFor(() => expect(mockApi.callsOf("get", PATH)).toHaveLength(2));
  });

  it("reports a failed delete", async () => {
    mockApi.fail("delete", `${PATH}/p-1`);
    const user = await renderPage();

    await user.click(within(rowOf(REUSE.title)).getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(await screen.findByRole("alert", { hidden: true })).toHaveTextContent("Failed to delete principle");
  });
});

describe("PrinciplesAdmin — details the first pass missed", () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  it("paints no rows, no empty state and the display switch on before the load", () => {
    const html = renderToStaticMarkup(<PrinciplesAdmin />);
    expect(html).not.toContain("MuiCard-root");
    expect(html).not.toContain("No EA principles defined yet");
    // The only checkbox at first paint is the EA Delivery display switch.
    expect(html.split('type="checkbox"')).toHaveLength(2);
    expect(html).toContain('checked=""');
  });

  it("renders the intro, both section labels and the active-toggle tooltips", async () => {
    await renderPage();
    expect(
      screen.getByText(/Define the architecture principles that govern your IT landscape/),
    ).toBeInTheDocument();
    const reuse = rowOf(REUSE.title);
    expect(within(reuse).getByText("Implications:")).toBeInTheDocument();
    expect(within(reuse).getByLabelText("Deactivate")).toBeInTheDocument();
    expect(within(rowOf(CLOUD.title)).getByLabelText("Activate")).toBeInTheDocument();
  });

  it("shows a rationale on its own, and drops blank lines from the bullets", async () => {
    mockApi.on("get", PATH, [
      {
        id: "p-3",
        title: "Only why",
        rationale: "First reason\n\nSecond reason\n",
        is_active: true,
        sort_order: 0,
      },
      {
        id: "p-4",
        title: "Only consequences",
        implications: "\nOne\n\nTwo",
        is_active: true,
        sort_order: 1,
      },
    ]);
    render(<PrinciplesAdmin />);

    await screen.findByText("Only why");
    const why = rowOf("Only why");
    expect(within(why).getByText("Rationale:")).toBeInTheDocument();
    expect(within(why).queryByText("Implications:")).not.toBeInTheDocument();
    expect(within(why).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "First reason",
      "Second reason",
    ]);
    const then = rowOf("Only consequences");
    expect(within(then).queryByText("Rationale:")).not.toBeInTheDocument();
    expect(within(then).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "One",
      "Two",
    ]);
  });

  it("hides the empty state while a reload is in flight", async () => {
    mockApi.on("get", PATH, []);
    mockApi.on("post", PATH, {});
    const user = userEvent.setup();
    render(<PrinciplesAdmin />);
    const empty = /No EA principles defined yet/;
    expect(await screen.findByText(empty)).toBeInTheDocument();

    const reload = deferred<EAPrinciple[]>();
    mockApi.on("get", PATH, () => reload.promise);
    await user.click(screen.getByRole("button", { name: /New Principle/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Principle Title"), "First");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    await waitFor(() => expect(mockApi.callsOf("get", PATH)).toHaveLength(2));
    await waitFor(() => expect(screen.queryByText(empty)).not.toBeInTheDocument());

    reload.resolve([{ id: "p-9", title: "First", is_active: true, sort_order: 0 }]);
    expect(await screen.findByText("First")).toBeInTheDocument();
  });

  it("reloads when the language changes", async () => {
    await renderPage();
    expect(mockApi.callsOf("get", PATH)).toHaveLength(1);
    try {
      await act(async () => {
        await i18n.changeLanguage("de");
      });
      await waitFor(() => expect(mockApi.callsOf("get", PATH)).toHaveLength(2));
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });

  it("prefills every section when editing", async () => {
    const user = await renderPage();

    await user.click(within(rowOf(REUSE.title)).getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Principle Title")).toHaveValue(REUSE.title);
    expect(within(dialog).getByLabelText("Statement")).toHaveValue(REUSE.description);
    expect(within(dialog).getByLabelText("Rationale")).toHaveValue(REUSE.rationale);
    expect(within(dialog).getByLabelText("Implications")).toHaveValue(REUSE.implications);
  });

  it("starts a fresh form after an edit was cancelled", async () => {
    const user = await renderPage();

    await user.click(within(rowOf(REUSE.title)).getByRole("button", { name: "Edit" }));
    let dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await expectNoDialog();

    await user.click(screen.getByRole("button", { name: /New Principle/ }));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Create EA Principle")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Principle Title")).toHaveValue("");
    expect(within(dialog).getByLabelText("Statement")).toHaveValue("");
    expect(within(dialog).getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("shows a hint in every field and refuses a blank title", async () => {
    const user = await renderPage();

    await user.click(screen.getByRole("button", { name: /New Principle/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Principle Title")).toHaveAttribute(
      "placeholder",
      "e.g. Reuse before Buy before Build",
    );
    expect(within(dialog).getByLabelText("Statement")).toHaveAttribute(
      "placeholder",
      "What does this principle state?",
    );
    expect(within(dialog).getByLabelText("Rationale")).toHaveAttribute(
      "placeholder",
      "Why is this principle important?",
    );
    expect(within(dialog).getByLabelText("Implications")).toHaveAttribute(
      "placeholder",
      "What are the practical consequences of following this principle?",
    );

    await user.type(within(dialog).getByLabelText("Principle Title"), "   ");
    expect(within(dialog).getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("closes the edit dialog on Escape without saving", async () => {
    const user = await renderPage();

    await user.click(screen.getByRole("button", { name: /New Principle/ }));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");

    await expectNoDialog();
    expect(mockApi.callsOf("post")).toHaveLength(0);
  });

  it("closes the delete confirm on Escape without deleting", async () => {
    const user = await renderPage();

    await user.click(within(rowOf(CLOUD.title)).getByRole("button", { name: "Delete" }));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");

    await expectNoDialog();
    expect(mockApi.callsOf("delete")).toHaveLength(0);
  });

  it("ignores a second Delete click on the closing confirm", async () => {
    const gate = deferred<unknown>();
    mockApi.on("delete", `${PATH}/p-2`, () => gate.promise);
    const user = await renderPage();

    await user.click(within(rowOf(CLOUD.title)).getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Delete" });
    await user.click(confirm);
    await waitFor(() => expect(mockApi.callsOf("delete")).toHaveLength(1));

    await act(async () => {
      gate.resolve({});
    });
    // The confirm is fading out with nothing left to delete.
    fireEvent.click(confirm);

    await expectNoDialog();
    expect(mockApi.callsOf("delete")).toHaveLength(1);
    expect(screen.queryByText("Failed to delete principle")).not.toBeInTheDocument();
  });
});
