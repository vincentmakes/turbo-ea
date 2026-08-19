import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn().mockResolvedValue([]), post: vi.fn() },
}));
// ServiceNowAdmin drags the whole sync-admin graph; the hub only mounts it.
vi.mock("./ServiceNowAdmin", () => ({
  default: () => <div>servicenow-admin-panel</div>,
}));

const mockUser = { permissions: {} as Record<string, boolean> };
vi.mock("@/hooks/AuthContext", () => ({
  useAuthContext: () => ({ user: mockUser }),
}));

import { registerExtension, resetExtensionHost, UI_SDK_VERSION } from "@/lib/extensionHost";

import IntegrationsHub from "./IntegrationsHub";

describe("IntegrationsHub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetExtensionHost();
    mockUser.permissions = {};
  });

  it("renders ServiceNow as the first sub-tab with no extensions registered", async () => {
    render(<IntegrationsHub />);
    expect(screen.getByRole("tab", { name: /servicenow/i })).toBeInTheDocument();
    expect(await screen.findByText("servicenow-admin-panel")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(1);
  });

  it("shows an extension integration panel as a sub-tab and mounts it on click", async () => {
    mockUser.permissions = { "ext.conn.admin": true };
    registerExtension("conn", {
      key: "conn",
      sdkVersion: UI_SDK_VERSION,
      integrationPanels: [
        {
          id: "settings",
          label: "Tracker sync",
          icon: "sync",
          permission: "ext.conn.admin",
          component: () => <div>tracker-sync-panel</div>,
        },
      ],
    });
    const user = userEvent.setup();
    render(<IntegrationsHub />);
    const tab = screen.getByRole("tab", { name: /tracker sync/i });
    await user.click(tab);
    expect(await screen.findByText("tracker-sync-panel")).toBeInTheDocument();
    expect(screen.queryByText("servicenow-admin-panel")).not.toBeInTheDocument();
  });

  it("hides an integration sub-tab from users lacking its permission", () => {
    mockUser.permissions = {};
    registerExtension("conn", {
      key: "conn",
      sdkVersion: UI_SDK_VERSION,
      integrationPanels: [
        {
          id: "settings",
          label: "Tracker sync",
          permission: "ext.conn.admin",
          component: () => <div>tracker-sync-panel</div>,
        },
      ],
    });
    render(<IntegrationsHub />);
    expect(screen.queryByRole("tab", { name: /tracker sync/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(1);
  });
});
