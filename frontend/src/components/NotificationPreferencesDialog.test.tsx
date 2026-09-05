import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), patch: vi.fn() },
}));

import { api } from "@/api/client";
import { AuthProvider } from "@/hooks/AuthContext";
import { registerExtension, resetExtensionHost, UI_SDK_VERSION } from "@/lib/extensionHost";
import type { User } from "@/types";
import NotificationPreferencesDialog from "./NotificationPreferencesDialog";

const mockGet = api.get as ReturnType<typeof vi.fn>;
const mockPatch = api.patch as ReturnType<typeof vi.fn>;

const TYPES = [
  { key: "todo_assigned", in_app_default: true, email_default: true, in_app_only: false, email_locked: false },
  { key: "card_updated", in_app_default: true, email_default: false, in_app_only: false, email_locked: false },
  { key: "app_updated", in_app_default: true, email_default: false, in_app_only: true, email_locked: false },
];

function prefs(overrides: Record<string, unknown> = {}) {
  return {
    in_app: { todo_assigned: true, card_updated: true, app_updated: true },
    email: { todo_assigned: true, card_updated: false },
    types: TYPES,
    available_channels: [],
    ...overrides,
  };
}

function renderDialog() {
  const user = { id: "u1", permissions: {} } as unknown as User;
  return render(
    <AuthProvider user={user} refreshUser={async () => {}}>
      <NotificationPreferencesDialog open onClose={() => {}} />
    </AuthProvider>,
  );
}

/** The header row's cells, minus the leading "Notification" label column. */
async function channelHeaders(): Promise<string[]> {
  const table = await screen.findByRole("table");
  const header = within(table).getAllByRole("row")[0];
  return within(header)
    .getAllByRole("columnheader")
    .slice(1)
    .map((c) => c.textContent ?? "");
}

describe("NotificationPreferencesDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetExtensionHost();
    mockPatch.mockResolvedValue({});
  });

  it("renders one row per server-supplied type", async () => {
    mockGet.mockResolvedValue(prefs());
    renderDialog();
    const table = await screen.findByRole("table");
    // header + 3 type rows
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(4));
  });

  it("renders the server label for a row an extension declared", async () => {
    mockGet.mockResolvedValue(
      prefs({
        types: [
          ...TYPES,
          {
            key: "ext.rules.notice",
            in_app_default: true,
            email_default: false,
            in_app_only: false,
            email_locked: false,
            label: "Rule notices",
            extension_key: "rules",
          },
        ],
      }),
    );
    renderDialog();
    expect(await screen.findByText("Rule notices")).toBeInTheDocument();
    expect(screen.queryByText("ext.rules.notice")).toBeNull();
  });

  it("shows only In-App and Email when no extension delivers a channel", async () => {
    mockGet.mockResolvedValue(prefs());
    renderDialog();
    expect(await channelHeaders()).toHaveLength(2);
  });

  it("renders an extension column when the backend and a slot agree", async () => {
    registerExtension("chat-relay", {
      key: "chat-relay",
      sdkVersion: UI_SDK_VERSION,
      slots: [
        {
          slot: "notification.preferences.channels",
          id: "chat-relay",
          build: () => ({ label: "Chat", order: 10 }),
        },
      ],
    });
    mockGet.mockResolvedValue(
      prefs({ available_channels: [{ key: "chat-relay", extension_key: "chat-relay" }] }),
    );
    renderDialog();
    expect(await channelHeaders()).toEqual(["In-App", "Email", "Chat"]);
  });

  it("falls back to the raw key when the backend reports a channel no slot labels", async () => {
    // A backend channel is genuinely delivering; an unlabelled column is still
    // better than an unswitchable one.
    mockGet.mockResolvedValue(
      prefs({ available_channels: [{ key: "chat-relay", extension_key: "chat-relay" }] }),
    );
    renderDialog();
    expect(await channelHeaders()).toEqual(["In-App", "Email", "chat-relay"]);
  });

  it("renders no column for a slot the backend does not report", async () => {
    // A UI-only bundle installs live while a backend channel needs a restart;
    // a column whose PATCH the backend would ignore is worse than none.
    registerExtension("chat-relay", {
      key: "chat-relay",
      sdkVersion: UI_SDK_VERSION,
      slots: [
        {
          slot: "notification.preferences.channels",
          id: "chat-relay",
          build: () => ({ label: "Chat" }),
        },
      ],
    });
    mockGet.mockResolvedValue(prefs());
    renderDialog();
    expect(await channelHeaders()).toEqual(["In-App", "Email"]);
  });

  it("degrades to the raw key when a slot's build() throws", async () => {
    registerExtension("chat-relay", {
      key: "chat-relay",
      sdkVersion: UI_SDK_VERSION,
      slots: [
        {
          slot: "notification.preferences.channels",
          id: "chat-relay",
          build: () => {
            throw new Error("boom");
          },
        },
      ],
    });
    mockGet.mockResolvedValue(
      prefs({ available_channels: [{ key: "chat-relay", extension_key: "chat-relay" }] }),
    );
    renderDialog();
    expect(await channelHeaders()).toEqual(["In-App", "Email", "chat-relay"]);
  });

  it("disables every outbound switch on an in-app-only type", async () => {
    mockGet.mockResolvedValue(
      prefs({ available_channels: [{ key: "chat-relay", extension_key: "chat-relay" }] }),
    );
    renderDialog();
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    // Row order mirrors TYPES: app_updated is last.
    const switches = within(rows[3]).getAllByRole("checkbox");
    expect(switches[0]).not.toBeDisabled(); // in-app
    expect(switches[1]).toBeDisabled(); // email
    expect(switches[2]).toBeDisabled(); // extension channel
  });

  it("starts every extension channel switch off", async () => {
    mockGet.mockResolvedValue(
      prefs({ available_channels: [{ key: "chat-relay", extension_key: "chat-relay" }] }),
    );
    renderDialog();
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    // todo_assigned is on for in-app AND email by default, but never for an
    // extension channel — installing one must not start delivering.
    const switches = within(rows[1]).getAllByRole("checkbox");
    expect(switches[0]).toBeChecked();
    expect(switches[1]).toBeChecked();
    expect(switches[2]).not.toBeChecked();
  });

  it("saves the opt-ins only, never the server's render metadata", async () => {
    mockGet.mockResolvedValue(
      prefs({ available_channels: [{ key: "chat-relay", extension_key: "chat-relay" }] }),
    );
    renderDialog();
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    await userEvent.click(within(rows[1]).getAllByRole("checkbox")[2]);
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1));
    const [path, body] = mockPatch.mock.calls[0];
    expect(path).toBe("/users/me/notification-preferences");
    expect(Object.keys(body).sort()).toEqual(["channels", "email", "in_app"]);
    expect(body.channels["chat-relay"].todo_assigned).toBe(true);
  });
});
