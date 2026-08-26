import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
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

/** The hub reads/writes its sub-tab from the URL, so it needs a router. */
function renderHub(initialEntry = "/admin/settings?tab=integrations") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <IntegrationsHub />
    </MemoryRouter>,
  );
}

function registerTrackerPanel() {
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
}

describe("IntegrationsHub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetExtensionHost();
    localStorage.clear();
    mockUser.permissions = {};
  });

  it("renders ServiceNow as the first sub-tab with no extensions registered", async () => {
    renderHub();
    expect(screen.getByRole("tab", { name: /servicenow/i })).toBeInTheDocument();
    expect(await screen.findByText("servicenow-admin-panel")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(1);
  });

  it("shows an extension integration panel as a sub-tab and mounts it on click", async () => {
    mockUser.permissions = { "ext.conn.admin": true };
    registerTrackerPanel();
    const user = userEvent.setup();
    renderHub();
    const tab = screen.getByRole("tab", { name: /tracker sync/i });
    await user.click(tab);
    expect(await screen.findByText("tracker-sync-panel")).toBeInTheDocument();
    expect(screen.queryByText("servicenow-admin-panel")).not.toBeInTheDocument();
  });

  it("hides an integration sub-tab from users lacking its permission", () => {
    mockUser.permissions = {};
    registerTrackerPanel();
    renderHub();
    expect(screen.queryByRole("tab", { name: /tracker sync/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(1);
  });

  it("restores the sub-tab named by the URL, so a refresh stays put", async () => {
    mockUser.permissions = { "ext.conn.admin": true };
    registerTrackerPanel();
    renderHub("/admin/settings?tab=integrations&integration=conn.settings");
    expect(screen.getByRole("tab", { name: /tracker sync/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByText("tracker-sync-panel")).toBeInTheDocument();
  });

  it("falls back to ServiceNow when the URL names an integration that is gone", async () => {
    mockUser.permissions = { "ext.conn.admin": true };
    renderHub("/admin/settings?tab=integrations&integration=uninstalled.settings");
    expect(screen.getByRole("tab", { name: /servicenow/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByText("servicenow-admin-panel")).toBeInTheDocument();
  });

  it("writes the picked integration to the URL, keeping the Settings tab param", async () => {
    mockUser.permissions = { "ext.conn.admin": true };
    registerTrackerPanel();
    const user = userEvent.setup();
    // A location probe: the hub writes through useSearchParams, so the only way
    // to see what it wrote is to read the router's own location back out.
    let search = "";
    function Probe() {
      search = useLocation().search;
      return null;
    }
    render(
      <MemoryRouter initialEntries={["/admin/settings?tab=integrations"]}>
        <IntegrationsHub />
        <Probe />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("tab", { name: /tracker sync/i }));
    const written = new URLSearchParams(search);
    expect(written.get("integration")).toBe("conn.settings");
    // The parent Settings page keys off `tab`; clobbering it would bounce the
    // user out of Integrations entirely on the next render.
    expect(written.get("tab")).toBe("integrations");

    // Picking ServiceNow back clears the param rather than writing a default.
    await user.click(screen.getByRole("tab", { name: /servicenow/i }));
    expect(new URLSearchParams(search).has("integration")).toBe(false);
  });

  it("remembers the integration across visits with no URL param", async () => {
    mockUser.permissions = { "ext.conn.admin": true };
    registerTrackerPanel();
    const user = userEvent.setup();
    const first = renderHub();
    await user.click(screen.getByRole("tab", { name: /tracker sync/i }));
    first.unmount();

    // Leaving for another Settings tab drops every query param, so a remount
    // with a bare URL is the real "come back later" path.
    renderHub();
    expect(screen.getByRole("tab", { name: /tracker sync/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByText("tracker-sync-panel")).toBeInTheDocument();
  });

  it("falls back to ServiceNow when the remembered extension is gone", async () => {
    localStorage.setItem("turboea.settings.integration", "uninstalled.settings");
    renderHub();
    expect(screen.getByRole("tab", { name: /servicenow/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByText("servicenow-admin-panel")).toBeInTheDocument();
    // The unresolved key is left in storage, not flattened: the extension may
    // simply be disabled today and come back tomorrow.
    expect(localStorage.getItem("turboea.settings.integration")).toBe("uninstalled.settings");
  });
});
