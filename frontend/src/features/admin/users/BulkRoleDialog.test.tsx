/**
 * BulkRoleDialog: pick one role for every selected user. Archived roles are
 * not offered, the dialog closes only once the change went through, and a
 * failure stays on screen.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { AppRole } from "@/types";
import BulkRoleDialog from "./BulkRoleDialog";

function role(key: string, label: string, over: Partial<AppRole> = {}): AppRole {
  return {
    id: `id-${key}`,
    key,
    label,
    is_system: false,
    is_default: false,
    is_archived: false,
    color: "#1976d2",
    permissions: {},
    sort_order: 0,
    ...over,
  };
}

const ROLES = [
  role("legacy", "Legacy", { is_archived: true }),
  role("viewer", "Viewer"),
  role("member", "Member"),
];

function renderDialog(over: Partial<React.ComponentProps<typeof BulkRoleDialog>> = {}) {
  const onClose = vi.fn();
  const onConfirm = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(
    <BulkRoleDialog
      open
      onClose={onClose}
      onConfirm={onConfirm}
      roles={ROLES}
      selectedCount={3}
      {...over}
    />,
  );
  return { user, onClose, onConfirm };
}

describe("BulkRoleDialog", () => {
  it("says how many users it changes and starts on the first active role", () => {
    renderDialog();
    expect(screen.getByRole("dialog", { name: "Change role for selected users" })).toBeVisible();
    expect(screen.getByText("Apply a new role to 3 selected users.")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveTextContent("Viewer");
  });

  it("offers only active roles and confirms the one picked", async () => {
    const { user, onConfirm, onClose } = renderDialog();
    await user.click(screen.getByRole("combobox"));
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Viewer", "Member"]);
    await user.click(screen.getByRole("option", { name: "Member" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledWith("member");
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("falls back to member when every role is archived", async () => {
    const { user, onConfirm } = renderDialog({
      roles: [role("legacy", "Legacy", { is_archived: true })],
    });
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledWith("member");
  });

  it("shows the failure and stays open", async () => {
    const { user, onClose } = renderDialog({
      onConfirm: vi.fn().mockRejectedValue(new Error("Not allowed")),
    });
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not allowed");
    expect(onClose).not.toHaveBeenCalled();
    // the buttons come back for another try
    expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
  });

  it("says something generic when the failure is not an Error", async () => {
    const { user } = renderDialog({ onConfirm: vi.fn().mockRejectedValue("nope") });
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("clears an earlier failure on the next try", async () => {
    const onConfirm = vi
      .fn()
      .mockRejectedValueOnce(new Error("Not allowed"))
      .mockResolvedValueOnce(undefined);
    const { user } = renderDialog({ onConfirm });
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("locks both buttons and ignores a close while saving", async () => {
    let finish!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { user, onClose } = renderDialog({ onConfirm });
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("closes on Escape and on Cancel when idle", async () => {
    const { user, onClose } = renderDialog();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
