import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const t = (k: string, opts?: Record<string, unknown>) =>
  opts?.extension ? `${k}:${String(opts.extension)}` : k;
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t }),
}));

import { AuthProvider } from "@/hooks/AuthContext";
import {
  registerExtension,
  resetExtensionHost,
  setExtensionDisplayName,
  UI_SDK_VERSION,
} from "@/lib/extensionHost";
import type { Notification, User } from "@/types";
import NotificationDetailDialog from "./NotificationDetailDialog";

const digest = (overrides: Partial<Notification> = {}): Notification => ({
  id: "n1",
  user_id: "u1",
  type: "ext.rules.notice",
  title: "Costly applications (3)",
  message: "Billing, CRM, ERP\n• Billing — no owner\n• CRM — no owner",
  link: "/ext/rules?tab=runs&rule=r1",
  is_read: true,
  data: { ext: "rules", open: "detail", cards: [{ id: "c1", name: "Billing" }] },
  created_at: "2026-09-05T10:00:00Z",
  ...overrides,
});

function renderDialog(
  notification: Notification,
  perms: Record<string, boolean> = { "inventory.view": true },
) {
  const user = { id: "u1", permissions: perms } as unknown as User;
  const onClose = vi.fn();
  const onNavigate = vi.fn();
  render(
    <AuthProvider user={user} refreshUser={async () => {}}>
      <NotificationDetailDialog
        notification={notification}
        onClose={onClose}
        onNavigate={onNavigate}
      />
    </AuthProvider>,
  );
  return { onClose, onNavigate };
}

describe("NotificationDetailDialog", () => {
  beforeEach(() => {
    resetExtensionHost();
  });

  it("renders the title, the full message with its line breaks, and the sender", () => {
    setExtensionDisplayName("rules", "Rules Engine");
    renderDialog(digest());
    expect(screen.getByText("Costly applications (3)")).toBeInTheDocument();
    const body = screen.getByText(/Billing, CRM, ERP/);
    expect(body).toHaveStyle({ whiteSpace: "pre-wrap" });
    expect(body.textContent).toContain("• CRM — no owner");
    expect(screen.getByText(/detail.sentBy:Rules Engine/)).toBeInTheDocument();
  });

  it("falls back to the extension key when the manifest carried no name", () => {
    renderDialog(digest());
    expect(screen.getByText(/detail.sentBy:rules/)).toBeInTheDocument();
  });

  it("hides the Open button for an extension page the viewer cannot open", () => {
    // No route registered at all — the bundle is not loaded for this viewer.
    renderDialog(digest());
    expect(screen.queryByRole("button", { name: /detail\.open$/ })).toBeNull();
  });

  it("offers the Open button when the extension route is registered and permitted", async () => {
    registerExtension("rules", {
      key: "rules",
      sdkVersion: UI_SDK_VERSION,
      routes: [
        {
          id: "rules",
          path: "/ext/rules",
          label: "Rules",
          permission: "ext.rules.view",
          component: () => null,
        },
      ],
    });
    const { onNavigate, onClose } = renderDialog(digest(), {
      "inventory.view": true,
      "ext.rules.view": true,
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /detail\.open$/ }));
    expect(onNavigate).toHaveBeenCalledWith("/ext/rules?tab=runs&rule=r1");
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the Open button hidden when the route needs a permission the viewer lacks", () => {
    registerExtension("rules", {
      key: "rules",
      sdkVersion: UI_SDK_VERSION,
      routes: [
        {
          id: "rules",
          path: "/ext/rules",
          label: "Rules",
          permission: "ext.rules.view",
          component: () => null,
        },
      ],
    });
    renderDialog(digest(), { "inventory.view": true });
    expect(screen.queryByRole("button", { name: /detail\.open$/ })).toBeNull();
  });

  it("offers Open card to a viewer who may open cards", async () => {
    const { onNavigate } = renderDialog(digest({ card_id: "c9", link: undefined }));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /detail\.openCard$/ }));
    expect(onNavigate).toHaveBeenCalledWith("/cards/c9");
  });

  it("hides Open card from a viewer without inventory access", () => {
    renderDialog(digest({ card_id: "c9", link: undefined }), {});
    expect(screen.queryByRole("button", { name: /detail\.openCard$/ })).toBeNull();
  });

  it("opens an absolute link in a new tab", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderDialog(digest({ link: "https://example.com/report" }));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /detail\.open$/ }));
    expect(open).toHaveBeenCalledWith(
      "https://example.com/report",
      "_blank",
      "noopener,noreferrer",
    );
    open.mockRestore();
  });

  it("renders only the sending extension's notification.detail contribution", () => {
    const Mine = (props: { data?: { cards?: { name: string }[] } }) => (
      <div>mine:{props.data?.cards?.[0]?.name}</div>
    );
    const Theirs = () => <div>theirs</div>;
    registerExtension("rules", {
      key: "rules",
      sdkVersion: UI_SDK_VERSION,
      slots: [{ slot: "notification.detail", id: "digest", component: Mine }],
    });
    registerExtension("other", {
      key: "other",
      sdkVersion: UI_SDK_VERSION,
      slots: [{ slot: "notification.detail", id: "sneak", component: Theirs }],
    });
    renderDialog(digest());
    expect(screen.getByText("mine:Billing")).toBeInTheDocument();
    expect(screen.queryByText("theirs")).toBeNull();
  });

  it("lets a contribution target the notification type through appliesTo", () => {
    const Mine = () => <div>typed</div>;
    registerExtension("rules", {
      key: "rules",
      sdkVersion: UI_SDK_VERSION,
      slots: [
        { slot: "notification.detail", id: "a", appliesTo: ["ext.rules.notice"], component: Mine },
        {
          slot: "notification.detail",
          id: "b",
          appliesTo: ["ext.rules.other"],
          component: () => <div>wrong-type</div>,
        },
      ],
    });
    renderDialog(digest());
    expect(screen.getByText("typed")).toBeInTheDocument();
    expect(screen.queryByText("wrong-type")).toBeNull();
  });
});
