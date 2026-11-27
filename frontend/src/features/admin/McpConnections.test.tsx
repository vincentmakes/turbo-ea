import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { get: vi.fn(), delete: vi.fn() } };
});

vi.mock("@/hooks/useDateFormat", () => ({
  useDateFormat: () => ({ formatDateTime: (v: string) => `at ${v}` }),
}));

import { api } from "@/api/client";
import type { McpConnection } from "@/types";

import McpConnections, { MCP_CONNECTIONS_PATH } from "./McpConnections";

const ALICE: McpConnection = {
  id: "11111111-1111-4111-8111-111111111111",
  client_name: "Claude",
  created_at: "2026-11-01T08:00:00Z",
  last_used_at: "2026-11-26T09:30:00Z",
  expires_at: "2026-12-26T09:30:00Z",
  user: { id: "u1", display_name: "Alice Admin" },
};

const BOB: McpConnection = {
  id: "22222222-2222-4222-8222-222222222222",
  client_name: "Copilot Studio",
  created_at: "2026-10-02T10:00:00Z",
  last_used_at: "2026-11-20T11:00:00Z",
  expires_at: "2026-12-20T11:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

function rowOf(text: string): HTMLElement {
  const row = screen.getByText(text).closest("tr");
  if (!row) throw new Error(`no row for ${text}`);
  return row as HTMLElement;
}

describe("McpConnections", () => {
  it("lists everyone's connections with person, AI tool and the three dates", async () => {
    vi.mocked(api.get).mockResolvedValue([ALICE, BOB]);
    render(<McpConnections />);

    const alice = await screen.findByText("Alice Admin");
    expect(api.get).toHaveBeenCalledWith(MCP_CONNECTIONS_PATH, expect.anything());
    expect(MCP_CONNECTIONS_PATH).toBe("/auth/mcp/sessions?everyone=true");

    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Person", "AI tool", "Connected", "Last used", "Ends if unused", ""]);

    const cells = within(alice.closest("tr") as HTMLElement)
      .getAllByRole("cell")
      .map((c) => c.textContent);
    expect(cells.slice(0, 5)).toEqual([
      "Alice Admin",
      "Claude",
      "at 2026-11-01T08:00:00Z",
      "at 2026-11-26T09:30:00Z",
      "at 2026-12-26T09:30:00Z",
    ]);
    // A row without its person still reads as somebody, never as blank.
    expect(within(rowOf("Copilot Studio")).getByText("Unknown person")).toBeInTheDocument();
  });

  it("revokes after confirmation, then reloads the list and reports it", async () => {
    vi.mocked(api.get).mockResolvedValueOnce([ALICE, BOB]).mockResolvedValueOnce([BOB]);
    vi.mocked(api.delete).mockResolvedValue(undefined);
    const onNotice = vi.fn();
    const user = userEvent.setup();
    render(<McpConnections onNotice={onNotice} />);

    await user.click(
      await screen.findByRole("button", {
        name: "Revoke the Claude connection of Alice Admin",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Revoke this connection?")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Claude stops working for Alice Admin at once. To use it again, they sign in from the AI tool.",
      ),
    ).toBeInTheDocument();
    expect(api.delete).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Revoke" }));

    expect(api.delete).toHaveBeenCalledTimes(1);
    expect(api.delete).toHaveBeenCalledWith(`/auth/mcp/sessions/${ALICE.id}`);
    await waitFor(() => expect(screen.queryByText("Alice Admin")).not.toBeInTheDocument());
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Copilot Studio")).toBeInTheDocument();
    expect(onNotice).toHaveBeenCalledWith("Connection revoked");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("cancelling the confirmation revokes nothing", async () => {
    vi.mocked(api.get).mockResolvedValue([ALICE]);
    const user = userEvent.setup();
    render(<McpConnections />);

    await user.click(
      await screen.findByRole("button", { name: "Revoke the Claude connection of Alice Admin" }),
    );
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.delete).not.toHaveBeenCalled();
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("keeps the dialog open with an error when the revoke fails", async () => {
    vi.mocked(api.get).mockResolvedValue([ALICE]);
    vi.mocked(api.delete).mockRejectedValue(new Error("boom"));
    const onNotice = vi.fn();
    const user = userEvent.setup();
    render(<McpConnections onNotice={onNotice} />);

    await user.click(
      await screen.findByRole("button", { name: "Revoke the Claude connection of Alice Admin" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Revoke" }));

    expect(
      await within(dialog).findByText("The connection could not be revoked."),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Revoke" })).toBeEnabled();
    expect(onNotice).not.toHaveBeenCalled();
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Alice Admin")).toBeInTheDocument();
  });

  it("says so when nobody is connected", async () => {
    vi.mocked(api.get).mockResolvedValue([]);
    render(<McpConnections />);

    expect(await screen.findByText("No AI tool is connected.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows an error, and no table, when the list cannot be loaded", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("500"));
    render(<McpConnections />);

    expect(await screen.findByText("The connections could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("No AI tool is connected.")).not.toBeInTheDocument();
  });
});
