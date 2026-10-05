/**
 * Resource types admin (link types + file categories): the two sections, the
 * create / edit dialog, the enable toggle and the delete confirm, driven
 * through the shared api kit. `IconPicker` is stubbed with a plain input.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
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

import { mockApi } from "@/test/apiMock";
import type { ResourceType } from "@/types";
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
