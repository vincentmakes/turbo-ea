/**
 * The diagram's lightweight "Create Card" dialog. It never calls the API
 * itself — it hands `{type, name, description?}` to the editor, which inserts
 * a pending cell and lets the sync panel create the card later. What it does
 * own is the type picker: hidden types and types this role may not create
 * (per-card-type deny, discussion #1068) never appear in it.
 */
import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";

import { renderWithProviders, makeUser, userWith, wrapWithProviders } from "@/test/render";
import { CARD_TYPES } from "@/test/fixtures/metamodel";
import type { User } from "@/types";
import CreateOnDiagramDialog from "./CreateOnDiagramDialog";

type Props = React.ComponentProps<typeof CreateOnDiagramDialog>;

function renderDialog(overrides: Partial<Props> = {}, user?: User) {
  const onClose = vi.fn();
  const onCreate = vi.fn();
  const result = renderWithProviders(
    <CreateOnDiagramDialog
      open
      types={CARD_TYPES}
      onClose={onClose}
      onCreate={onCreate}
      {...overrides}
    />,
    { user },
  );
  return { ...result, onClose, onCreate };
}

const typeSelect = () => screen.getByRole("combobox", { name: "Type" });
const nameField = () => screen.getByRole("textbox", { name: "Name" });
const addButton = () => screen.getByRole("button", { name: "Add to Diagram" });

async function pickType(user: ReturnType<typeof renderDialog>["user"], label: string) {
  await user.click(typeSelect());
  const listbox = await screen.findByRole("listbox");
  await user.click(within(listbox).getByRole("option", { name: label }));
}

describe("CreateOnDiagramDialog", () => {
  it("lists every visible type an admin may create, hidden types excluded", async () => {
    const { user } = renderDialog();
    await user.click(typeSelect());
    const listbox = await screen.findByRole("listbox");
    const names = within(listbox)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(names).toEqual(["Business Capability", "Application", "IT Component", "Provider"]);
    expect(names).not.toContain("Secret");
  });

  it("drops types the role may not create, including a per-type deny", async () => {
    const member = userWith("inventory.view", "inventory.create");
    member.type_permissions = { Provider: { "inventory.create": false } };
    const { user } = renderDialog({}, member);
    await user.click(typeSelect());
    const listbox = await screen.findByRole("listbox");
    const names = within(listbox)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(names).toEqual(["Business Capability", "Application", "IT Component"]);
  });

  it("offers no type at all to a role without inventory.create", async () => {
    const { user } = renderDialog({}, makeUser({ permissions: { "inventory.view": true } }));
    await user.click(typeSelect());
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).queryAllByRole("option")).toHaveLength(0);
  });

  it("keeps Add disabled until both a type and a non-blank name are set", async () => {
    const { user } = renderDialog();
    expect(addButton()).toBeDisabled();
    await user.type(nameField(), "   ");
    expect(addButton()).toBeDisabled();
    await pickType(user, "Application");
    expect(addButton()).toBeDisabled();
    await user.clear(nameField());
    await user.type(nameField(), "Billing Portal");
    expect(addButton()).toBeEnabled();
  });

  it("names the pending type in the hint once a type is chosen", async () => {
    const { user } = renderDialog();
    expect(screen.queryByText(/Will be added to the diagram as a pending/)).not.toBeInTheDocument();
    await pickType(user, "IT Component");
    const hint = screen.getByText(/Will be added to the diagram as a pending/);
    expect(hint).toHaveTextContent("IT Component");
    expect(hint).toHaveTextContent("Synchronise to save it to the inventory.");
  });

  it("emits a trimmed name without a description key when none was typed, then resets", async () => {
    const { user, onCreate, onClose } = renderDialog();
    await pickType(user, "Application");
    await user.type(nameField(), "  Billing Portal  ");
    await user.click(addButton());
    expect(onCreate).toHaveBeenCalledWith({
      type: "Application",
      name: "Billing Portal",
      description: undefined,
    });
    expect(onClose).not.toHaveBeenCalled();
    // The form is cleared for the next card.
    expect(nameField()).toHaveValue("");
    expect(addButton()).toBeDisabled();
  });

  it("includes the trimmed description and submits on Enter in the name field", async () => {
    const { user, onCreate } = renderDialog();
    await pickType(user, "Provider");
    await user.type(screen.getByRole("textbox", { name: "Description (optional)" }), " Hosts ERP ");
    await user.type(nameField(), "Acme{Enter}");
    expect(onCreate).toHaveBeenCalledWith({
      type: "Provider",
      name: "Acme",
      description: "Hosts ERP",
    });
  });

  it("ignores Enter while the form is incomplete", async () => {
    const { user, onCreate } = renderDialog();
    await user.type(nameField(), "Acme{Enter}");
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("seeds the name from prefillName for the convert-shape flow", () => {
    renderDialog({ prefillName: "Legacy Box" });
    expect(nameField()).toHaveValue("Legacy Box");
  });

  it("clears the form and reports close on Cancel", async () => {
    const { user, onClose, onCreate } = renderDialog({ prefillName: "Draft" });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCreate).not.toHaveBeenCalled();
  });
  it("titles the dialog and spells the hint out word by word", async () => {
    const { user } = renderDialog();
    expect(screen.getByText("Create Card")).toBeInTheDocument();
    await pickType(user, "IT Component");
    const hint = screen.getByText(/Will be added to the diagram as a pending/);
    expect(hint.textContent).toBe(
      "Will be added to the diagram as a pending IT Component. Synchronise to save it to the inventory.",
    );
  });

  it("clears type, name and description after a create", async () => {
    const { user, onCreate } = renderDialog();
    const description = screen.getByRole("textbox", { name: "Description (optional)" });
    await pickType(user, "Application");
    await user.type(nameField(), "Billing Portal");
    await user.type(description, "Invoices");
    await user.click(addButton());
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(description).toHaveValue("");
    expect(screen.queryByText(/Will be added to the diagram as a pending/)).not.toBeInTheDocument();
    // The type was reset too, so a name alone is not enough again.
    await user.type(nameField(), "Next");
    expect(addButton()).toBeDisabled();
  });

  it("clears type, name and description on Cancel", async () => {
    const { user, onClose } = renderDialog();
    const description = screen.getByRole("textbox", { name: "Description (optional)" });
    await pickType(user, "Application");
    await user.type(nameField(), "Billing Portal");
    await user.type(description, "Invoices");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(nameField()).toHaveValue("");
    expect(description).toHaveValue("");
    await user.type(nameField(), "Next");
    expect(addButton()).toBeDisabled();
  });

  it("seeds the name when the dialog is opened later with a prefill", () => {
    const { rerender } = renderDialog({ open: false });
    rerender(
      wrapWithProviders(
        <CreateOnDiagramDialog open types={CARD_TYPES} prefillName="Legacy Box" onClose={vi.fn()} onCreate={vi.fn()} />,
      ),
    );
    expect(nameField()).toHaveValue("Legacy Box");
  });
});
