/**
 * Resource types admin (link types + file categories): the two sections, the
 * create / edit dialog, the enable toggle and the delete confirm, driven
 * through the shared api kit. `IconPicker` is stubbed with a plain input.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import userEvent, { type UserEvent } from "@testing-library/user-event";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/components/IconPicker", () => ({
  default: ({ value, onChange }: { value: string; onChange: (icon: string) => void }) => (
    <input aria-label="icon" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const h = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("@/hooks/useResourceTypes", () => ({
  useResourceTypes: () => ({
    resourceTypes: [],
    linkTypes: [],
    fileCategories: [],
    byKindKey: {},
    loaded: true,
    refresh: h.refresh,
  }),
}));

import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import type { ResourceType, ResourceTypeKind } from "@/types";
import ResourceTypesAdmin from "./ResourceTypesAdmin";

const PATH = "/metamodel/resource-types";

function makeType(overrides: Partial<ResourceType> & { id: string; key: string }): ResourceType {
  return {
    kind: "link_type",
    label: overrides.key,
    description: null,
    icon: null,
    is_enabled: true,
    built_in: false,
    sort_order: 0,
    translations: {},
    ...overrides,
  };
}

const DOCUMENTATION = makeType({
  id: "rt-1",
  key: "documentation",
  label: "Documentation",
  icon: "description",
  built_in: true,
  sort_order: 10,
});
const CONTRACT = makeType({
  id: "rt-2",
  key: "contract",
  label: "Contract",
  icon: "gavel",
  sort_order: 20,
  translations: { de: "Vertrag" },
});
/** Disabled and with the lowest sort order, so it must list first. */
const WIKI = makeType({ id: "rt-3", key: "wiki", label: "Wiki", is_enabled: false, sort_order: 5 });
const INVOICE = makeType({ id: "rt-4", kind: "file_category", key: "invoice", label: "Invoice" });
const MANUAL = makeType({
  id: "rt-5",
  kind: "file_category",
  key: "manual",
  label: "Manual",
  built_in: true,
  sort_order: -1,
});
const ITEMS = [DOCUMENTATION, CONTRACT, WIKI, INVOICE, MANUAL];

function rowOf(label: string): HTMLElement {
  const row = screen.getByText(label).closest(".MuiCard-root");
  if (!(row instanceof HTMLElement)) throw new Error(`no row for ${label}`);
  return row;
}

async function renderPage(): Promise<UserEvent> {
  const user = userEvent.setup();
  render(<ResourceTypesAdmin />);
  await screen.findByText("Documentation");
  return user;
}

async function expectNoDialog() {
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}

beforeEach(() => {
  mockApi.reset();
  h.refresh.mockClear();
  mockApi.on("get", PATH, ITEMS);
});

describe("ResourceTypesAdmin list", () => {
  it("renders both sections sorted by sort order, with built-in and disabled chips", async () => {
    const { container } = render(<ResourceTypesAdmin />);
    await screen.findByText("Documentation");

    expect(screen.getByText("Link types")).toBeInTheDocument();
    expect(screen.getByText("File categories")).toBeInTheDocument();
    const labels = Array.from(container.querySelectorAll(".MuiCard-root h6")).map(
      (el) => el.textContent,
    );
    expect(labels).toEqual(["Wiki", "Documentation", "Contract", "Manual", "Invoice"]);

    expect(within(rowOf("Documentation")).getByText("Built-in")).toBeInTheDocument();
    expect(within(rowOf("Documentation")).getByText("documentation")).toBeInTheDocument();
    expect(within(rowOf("Documentation")).getByRole("button", { name: /delete/i })).toBeDisabled();
    expect(within(rowOf("Wiki")).getByText("Disabled")).toBeInTheDocument();
    expect(within(rowOf("Wiki")).getByRole("checkbox")).not.toBeChecked();
    expect(within(rowOf("Contract")).getByRole("button", { name: /delete/i })).toBeEnabled();
    // The fresh list is pushed into the singleton for the Resources tab.
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("reports a failed load in a dismissible alert", async () => {
    mockApi.fail("get", PATH);
    const user = userEvent.setup();
    render(<ResourceTypesAdmin />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load resource types.");
    await user.click(within(alert).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("toggles a row's enabled flag and reloads", async () => {
    mockApi.on("patch", `${PATH}/rt-3`, {});
    const user = await renderPage();

    await user.click(within(rowOf("Wiki")).getByRole("checkbox"));

    await waitFor(() => expect(mockApi.callsOf("patch", `${PATH}/rt-3`)).toHaveLength(1));
    expect(mockApi.callsOf("patch", `${PATH}/rt-3`)[0].body).toEqual({ is_enabled: true });
    await waitFor(() => expect(mockApi.callsOf("get", PATH)).toHaveLength(2));
  });
});

describe("ResourceTypesAdmin dialog", () => {
  it("creates a link type with a lower-cased key, icon, sort order and translations", async () => {
    mockApi.on("post", PATH, {});
    const user = await renderPage();

    await user.click(screen.getByRole("button", { name: /Add link type/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Add entry")).toBeInTheDocument();
    const create = within(dialog).getByRole("button", { name: "Create" });
    expect(create).toBeDisabled();

    await user.type(within(dialog).getByLabelText("Key"), "RunBook");
    expect(create).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Display label"), "Runbook");
    expect(create).toBeEnabled();

    // The picker shows "link" while the form's icon is empty, so clearing it
    // would snap back to that default; set the value in one change instead.
    const icon = within(dialog).getByLabelText("icon");
    expect(icon).toHaveValue("link");
    fireEvent.change(icon, { target: { value: "book" } });

    // Three link types exist, so the suggested sort order is 3 * 10 + 100.
    const sortOrder = within(dialog).getByLabelText("Sort order");
    expect(sortOrder).toHaveValue(130);
    await user.clear(sortOrder);
    await user.type(sortOrder, "7");

    await user.type(within(dialog).getByLabelText("Deutsch"), "  Laufbuch ");
    await user.type(within(dialog).getByLabelText("Français"), "   ");
    await user.click(create);

    await waitFor(() => expect(mockApi.callsOf("post", PATH)).toHaveLength(1));
    expect(mockApi.callsOf("post", PATH)[0].body).toEqual({
      kind: "link_type",
      key: "runbook",
      label: "Runbook",
      icon: "book",
      is_enabled: true,
      sort_order: 7,
      translations: { de: "Laufbuch" },
    });
    await expectNoDialog();
    await waitFor(() => expect(mockApi.callsOf("get", PATH)).toHaveLength(2));
  });

  it("creates a file category without an icon", async () => {
    mockApi.on("post", PATH, {});
    const user = await renderPage();

    await user.click(screen.getByRole("button", { name: /Add file category/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText("icon")).not.toBeInTheDocument();

    await user.type(within(dialog).getByLabelText("Key"), "scan");
    await user.type(within(dialog).getByLabelText("Display label"), "Scan");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    await waitFor(() => expect(mockApi.callsOf("post", PATH)).toHaveLength(1));
    expect(mockApi.callsOf("post", PATH)[0].body).toEqual({
      kind: "file_category",
      key: "scan",
      label: "Scan",
      icon: null,
      is_enabled: true,
      sort_order: 120,
      translations: {},
    });
  });

  it("edits a row with its key locked and patches the rest", async () => {
    mockApi.on("patch", `${PATH}/rt-2`, {});
    const user = await renderPage();

    await user.click(within(rowOf("Contract")).getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Edit entry")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Key")).toBeDisabled();
    expect(within(dialog).getByLabelText("Key")).toHaveValue("contract");
    expect(within(dialog).getByLabelText("Deutsch")).toHaveValue("Vertrag");

    const label = within(dialog).getByLabelText("Display label");
    await user.clear(label);
    await user.type(label, "Contracts");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockApi.callsOf("patch", `${PATH}/rt-2`)).toHaveLength(1));
    expect(mockApi.callsOf("patch", `${PATH}/rt-2`)[0].body).toEqual({
      label: "Contracts",
      icon: "gavel",
      is_enabled: true,
      sort_order: 20,
      translations: { de: "Vertrag" },
    });
    await expectNoDialog();
  });

  it("keeps the dialog open and shows the server message when saving fails", async () => {
    mockApi.fail("patch", `${PATH}/rt-2`);
    const user = await renderPage();

    await user.click(within(rowOf("Contract")).getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert", { hidden: true })).toHaveTextContent(
      `PATCH ${PATH}/rt-2 failed`,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("ResourceTypesAdmin delete", () => {
  it("confirms, cancels, then deletes a custom row", async () => {
    mockApi.on("delete", `${PATH}/rt-2`, {});
    const user = await renderPage();

    await user.click(within(rowOf("Contract")).getByRole("button", { name: /delete/i }));
    let dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Delete entry")).toBeInTheDocument();
    expect(within(dialog).getByText(/Delete "Contract"\?/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await expectNoDialog();
    expect(mockApi.callsOf("delete")).toHaveLength(0);

    await user.click(within(rowOf("Contract")).getByRole("button", { name: /delete/i }));
    dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(mockApi.callsOf("delete", `${PATH}/rt-2`)).toHaveLength(1));
    await expectNoDialog();
    await waitFor(() => expect(mockApi.callsOf("get", PATH)).toHaveLength(2));
  });

  it("reports a failed delete", async () => {
    mockApi.fail("delete", `${PATH}/rt-4`);
    const user = await renderPage();

    await user.click(within(rowOf("Invoice")).getByRole("button", { name: /delete/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(await screen.findByRole("alert", { hidden: true })).toHaveTextContent("Could not delete resource type.");
  });
});

describe("ResourceTypesAdmin first paint and reloads", () => {
  it("paints only the description before the list has loaded", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<ResourceTypesAdmin />);
    expect(host.textContent).toContain("Manage the link types and file categories");
    expect(host.textContent).not.toContain("Link types");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("orders each section's heading, description and rows, with no alert after a good load", async () => {
    const { container } = render(<ResourceTypesAdmin />);
    await screen.findByText("Documentation");

    expect(Array.from(container.querySelectorAll("h6")).map((el) => el.textContent)).toEqual([
      "Link types",
      "Wiki",
      "Documentation",
      "Contract",
      "File categories",
      "Manual",
      "Invoice",
    ]);
    const text = container.textContent ?? "";
    const at = (s: string) => {
      const i = text.indexOf(s);
      expect(i, s).toBeGreaterThanOrEqual(0);
      return i;
    };
    expect(at("Categories for document links (e.g. documentation, contract, security).")).toBeLessThan(
      at("Wiki"),
    );
    expect(at("Contract")).toBeLessThan(at("Categories for uploaded file attachments."));
    expect(at("Categories for uploaded file attachments.")).toBeLessThan(at("Manual"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ignores rows of an unknown kind", async () => {
    mockApi.on("get", PATH, [
      ...ITEMS,
      makeType({ id: "rt-9", kind: "legacy" as ResourceTypeKind, key: "old", label: "Old thing" }),
    ]);
    await renderPage();
    expect(screen.getByText("File categories")).toBeInTheDocument();
    expect(screen.queryByText("Old thing")).not.toBeInTheDocument();
  });

  it("shows a link type's own icon, the link fallback, and the label icon for file categories", async () => {
    await renderPage();
    expect(within(rowOf("Documentation")).getByText("description")).toBeInTheDocument();
    expect(within(rowOf("Contract")).getByText("gavel")).toBeInTheDocument();
    expect(within(rowOf("Wiki")).getByText("link")).toBeInTheDocument();
    expect(within(rowOf("Invoice")).getByText("label")).toBeInTheDocument();
    expect(within(rowOf("Invoice")).queryByText("link")).not.toBeInTheDocument();
  });

  it("hides the sections while the list reloads", async () => {
    mockApi.on("patch", `${PATH}/rt-3`, {});
    const user = await renderPage();
    let resolve: (v: unknown) => void = () => {};
    mockApi.on("get", PATH, () => new Promise((r) => (resolve = r)));

    await user.click(within(rowOf("Wiki")).getByRole("checkbox"));
    await waitFor(() => expect(mockApi.callsOf("get", PATH)).toHaveLength(2));
    await waitFor(() => expect(screen.queryByText("Link types")).not.toBeInTheDocument());
    await act(async () => resolve(ITEMS));
    expect(await screen.findByText("Link types")).toBeInTheDocument();
  });

  it("reloads the list when the interface language changes", async () => {
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

  it("labels the toggle and the delete button by what they do", async () => {
    await renderPage();
    expect(
      within(rowOf("Contract")).getByLabelText(
        "Disable — hides it from the picker but keeps existing values.",
      ),
    ).toBeInTheDocument();
    expect(within(rowOf("Wiki")).getByLabelText("Enable")).toBeInTheDocument();
    expect(
      within(rowOf("Documentation")).getByLabelText(
        "Built-in entries cannot be deleted. Disable them with the toggle instead.",
      ),
    ).toBeInTheDocument();
    expect(within(rowOf("Contract")).getByLabelText("Delete")).toBeInTheDocument();
  });
});

describe("ResourceTypesAdmin dialog details", () => {
  async function openCreate(user: UserEvent, name = /Add link type/) {
    await user.click(screen.getByRole("button", { name }));
    return screen.findByRole("dialog");
  }

  it("shows the help texts, the icon label and one translation field per other locale", async () => {
    const user = await renderPage();
    const dialog = await openCreate(user);

    expect(
      within(dialog).getByText("Lowercase identifier stored on cards. Cannot be changed later."),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Icon")).toBeInTheDocument();
    expect(within(dialog).getByText("Translations")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Display label per locale. Leave empty to fall back to the default label."),
    ).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("English")).not.toBeInTheDocument();
    for (const name of ["Deutsch", "Français", "Español", "Italiano", "Português", "中文", "Русский", "Dansk", "العربية"]) {
      expect(within(dialog).getByLabelText(name)).toBeInTheDocument();
    }
  });

  it("enables Create only once both a key and a label carry text", async () => {
    const user = await renderPage();
    const dialog = await openCreate(user);
    const create = within(dialog).getByRole("button", { name: "Create" });
    const key = within(dialog).getByLabelText("Key");
    const label = within(dialog).getByLabelText("Display label");

    await user.type(label, "Runbook");
    expect(create).toBeDisabled();
    await user.type(key, "   ");
    expect(create).toBeDisabled();
    await user.clear(label);
    await user.clear(key);
    await user.type(key, "runbook");
    expect(create).toBeDisabled();
    await user.type(label, "   ");
    expect(create).toBeDisabled();
    await user.type(label, "R");
    expect(create).toBeEnabled();
  });

  it("trims the key, label and icon it sends", async () => {
    mockApi.on("post", PATH, {});
    const user = await renderPage();
    const dialog = await openCreate(user);

    await user.type(within(dialog).getByLabelText("Key"), "  RunBook ");
    await user.type(within(dialog).getByLabelText("Display label"), "  Runbook ");
    fireEvent.change(within(dialog).getByLabelText("icon"), { target: { value: " book " } });
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    await waitFor(() => expect(mockApi.callsOf("post", PATH)).toHaveLength(1));
    expect(mockApi.callsOf("post", PATH)[0].body).toMatchObject({
      key: "runbook",
      label: "Runbook",
      icon: "book",
    });
  });

  it("edits a link type without an icon from the link fallback and saves no icon", async () => {
    mockApi.on("patch", `${PATH}/rt-3`, {});
    const user = await renderPage();
    await user.click(within(rowOf("Wiki")).getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("icon")).toHaveValue("link");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockApi.callsOf("patch", `${PATH}/rt-3`)).toHaveLength(1));
    expect(mockApi.callsOf("patch", `${PATH}/rt-3`)[0].body).toMatchObject({ icon: null });
  });

  it("edits a file category without the icon picker", async () => {
    const user = await renderPage();
    await user.click(within(rowOf("Invoice")).getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Key")).toHaveValue("invoice");
    expect(within(dialog).queryByLabelText("icon")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Icon")).not.toBeInTheDocument();
  });

  it("opens a fresh create form after cancelling an edit", async () => {
    const user = await renderPage();
    await user.click(within(rowOf("Contract")).getByRole("button", { name: "Edit" }));
    let dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Edit entry")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await expectNoDialog();

    dialog = await openCreate(user);
    expect(within(dialog).getByText("Add entry")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Key")).toBeEnabled();
    expect(within(dialog).getByLabelText("Key")).toHaveValue("");
    expect(within(dialog).getByRole("button", { name: "Create" })).toBeInTheDocument();
  });

  it("closes the create dialog on Cancel and on Escape without saving", async () => {
    const user = await renderPage();
    let dialog = await openCreate(user);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await expectNoDialog();

    dialog = await openCreate(user, /Add file category/);
    fireEvent.keyDown(dialog, { key: "Escape" });
    await expectNoDialog();
    expect(mockApi.callsOf("post")).toHaveLength(0);
  });

  it("shows a generic message when saving fails without an Error", async () => {
    mockApi.on("post", PATH, () => Promise.reject("nope"));
    const user = await renderPage();
    const dialog = await openCreate(user);
    await user.type(within(dialog).getByLabelText("Key"), "runbook");
    await user.type(within(dialog).getByLabelText("Display label"), "Runbook");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(await screen.findByRole("alert", { hidden: true })).toHaveTextContent(
      "Could not save resource type.",
    );
  });
});

describe("ResourceTypesAdmin delete dialog", () => {
  it("closes the confirm on Escape without deleting", async () => {
    const user = await renderPage();
    await user.click(within(rowOf("Contract")).getByRole("button", { name: /delete/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await expectNoDialog();
    expect(mockApi.callsOf("delete")).toHaveLength(0);
  });

  it("ignores a Delete click that lands while the cancelled confirm is closing", async () => {
    mockApi.on("delete", `${PATH}/rt-2`, {});
    const user = await renderPage();
    await user.click(within(rowOf("Contract")).getByRole("button", { name: /delete/i }));
    const dialog = await screen.findByRole("dialog");
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    const confirmDelete = within(dialog).getByRole("button", { name: "Delete" });

    fireEvent.click(cancel);
    fireEvent.click(confirmDelete);

    await expectNoDialog();
    expect(mockApi.callsOf("delete")).toHaveLength(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
