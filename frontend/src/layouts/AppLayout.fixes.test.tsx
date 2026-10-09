/**
 * Regression tests for three AppLayout fixes:
 *
 * - the extension-license banner goes away when the user loses
 *   `admin.manage_extensions` (e.g. an admin switching to "View as role…"),
 *   not only when the status answer is still in flight;
 * - the Todos badge counts are read once on load, not once per mount effect;
 * - a nav group (the Reports bar button, the drawer's Admin header) is
 *   highlighted on a sub-path of one of its entries, matching how the entry
 *   itself is highlighted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useBpmEnabled", () => import("@/test/hooks").then((m) => m.useBpmEnabledModule()));
vi.mock("@/hooks/useGrcEnabled", () => import("@/test/hooks").then((m) => m.useGrcEnabledModule()));
vi.mock("@/hooks/usePpmEnabled", () => import("@/test/hooks").then((m) => m.usePpmEnabledModule()));
vi.mock("@/hooks/useTurboLensReady", () =>
  import("@/test/hooks").then((m) => m.useTurboLensReadyModule()),
);
vi.mock("@/hooks/useThemeMode", () => import("@/test/hooks").then((m) => m.useThemeModeModule()));
vi.mock("@/hooks/useEventStream", () => import("@/test/hooks").then((m) => m.useEventStreamModule()));
vi.mock("@/hooks/useSponsorButtonEnabled", () => ({
  useSponsorButtonEnabled: () => ({ sponsorButtonEnabled: true, loaded: true }),
}));
vi.mock("@/hooks/useEnabledLocales", () => ({
  useEnabledLocales: () => ({ enabledLocales: ["en", "de"] }),
}));
vi.mock("@/hooks/useAppTitle", () => ({ useAppTitle: () => "Turbo EA" }));
vi.mock("@/hooks/useNavbarStyle", () => ({
  useNavbarStyle: () => ({ bg: "#1a1a2e", fg: "#ffffff" }),
}));

function stubDialog(name: string) {
  return {
    default: ({ open }: { open: boolean }) => (open ? <div data-testid={`${name}-dialog`} /> : null),
  };
}
vi.mock("@/components/NotificationBell", () => ({
  default: () => <div data-testid="notification-bell" />,
}));
vi.mock("@/components/NotificationPreferencesDialog", () => stubDialog("notif"));
vi.mock("@/components/SearchDialog", () => stubDialog("search"));
vi.mock("@/components/SponsorshipDialog", () => stubDialog("sponsor"));
vi.mock("@/features/admin/ImpersonateRoleDialog", () => stubDialog("impersonate"));
vi.mock("@/components/CreateCardDialog", () => stubDialog("create"));

import AppLayout from "./AppLayout";
import { AuthProvider } from "@/hooks/AuthContext";
import { mockApi } from "@/test/apiMock";
import { hookState } from "@/test/hooks";
import { setViewportWidth } from "@/test/matchMedia";
import { resetExtensionHost } from "@/lib/extensionHost";

type LayoutUser = Parameters<typeof AppLayout>[0]["user"];

const adminUser: LayoutUser = {
  id: "u1",
  display_name: "Admin User",
  email: "admin@turboea.local",
  role: "admin",
  permissions: { "*": true },
};

const viewerUser: LayoutUser = {
  id: "u1",
  display_name: "Admin User",
  email: "admin@turboea.local",
  role: "viewer",
  permissions: {
    "inventory.view": true,
    "reports.ea_dashboard": true,
    "diagrams.view": true,
  },
};

/** The nav colours `useNavbarStyle` is mocked to: full white when active, 70% when not. */
const ACTIVE = "rgb(255, 255, 255)";
const MUTED = "rgba(255, 255, 255, 0.7)";

function Layout({ user = adminUser }: { user?: LayoutUser }) {
  return (
    <AuthProvider
      user={user as unknown as Parameters<typeof AuthProvider>[0]["user"]}
      refreshUser={async () => {}}
    >
      <AppLayout user={user} onLogout={vi.fn()}>
        <div data-testid="page" />
      </AppLayout>
    </AuthProvider>
  );
}

function renderAt(path: string, user: LayoutUser = adminUser) {
  const ui = (u: LayoutUser) => (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<Layout user={u} />} />
      </Routes>
    </MemoryRouter>
  );
  const result = render(ui(user));
  return { ...result, rerenderAs: (u: LayoutUser) => result.rerender(ui(u)) };
}

const badgeCalls = () => mockApi.callsOf("get", "/notifications/badge-counts").length;

beforeEach(() => {
  hookState.reset();
  mockApi.reset();
  resetExtensionHost();
  hookState.turboLens = { ...hookState.turboLens, turboLensReady: false };
  mockApi.on("get", "/notifications/badge-counts", { open_todos: 0, pending_surveys: 0 });
  mockApi.on("get", "/extensions/status", []);
});

afterEach(() => {
  resetExtensionHost();
});

describe("AppLayout — license banner follows the manage permission", () => {
  it("drops a banner already shown once the user loses admin.manage_extensions", async () => {
    mockApi.on("get", "/extensions/status", [
      { key: "alpha", version: "1.0.0", entitlement_state: "expired" },
    ]);
    const { rerenderAs } = renderAt("/");
    expect(await screen.findByText(/alpha \(expired\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manage" })).toBeInTheDocument();

    // e.g. "View as role…" switched to a viewer: same person, viewer's permissions.
    rerenderAs(viewerUser);
    await waitFor(() => expect(screen.queryByText(/alpha \(expired\)/)).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Manage" })).not.toBeInTheDocument();
    expect(mockApi.callsOf("get", "/extensions/status")).toHaveLength(1);
  });
});

describe("AppLayout — badge counts on load", () => {
  it("reads the counts once when the layout mounts", async () => {
    renderAt("/");
    expect(badgeCalls()).toBe(1);
    // Nothing else asks once the first answer has landed.
    await waitFor(() => expect(screen.getByRole("link", { name: /Todos/ })).toBeInTheDocument());
    expect(badgeCalls()).toBe(1);
  });
});

describe("AppLayout — group highlight on a sub-path", () => {
  it("highlights the Reports button on a sub-path of one of its entries", async () => {
    hookState.turboLens = { ...hookState.turboLens, turboLensReady: true };
    renderAt("/turbolens/assessments/a1");
    const reports = screen.getByRole("button", { name: /Reports/ });
    expect(getComputedStyle(reports).color).toBe(ACTIVE);
  });

  it("leaves the Reports button plain elsewhere", () => {
    hookState.turboLens = { ...hookState.turboLens, turboLensReady: true };
    renderAt("/inventory");
    const reports = screen.getByRole("button", { name: /Reports/ });
    expect(getComputedStyle(reports).color).toBe(MUTED);
  });

  it("highlights the drawer's Admin header on a sub-path of an admin entry", async () => {
    setViewportWidth(500);
    const user = userEvent.setup();
    renderAt("/admin/surveys/new");
    await user.click(screen.getByRole("button", { name: /^menu$/ }));
    const drawer = await screen.findByRole("presentation");
    const header = within(drawer).getByText("Admin").closest('[role="button"]') as HTMLElement;
    expect(getComputedStyle(header).color).toBe(ACTIVE);
  });

  it("leaves the drawer's Admin header plain off the admin pages", async () => {
    setViewportWidth(500);
    const user = userEvent.setup();
    renderAt("/inventory");
    await user.click(screen.getByRole("button", { name: /^menu$/ }));
    const drawer = await screen.findByRole("presentation");
    const header = within(drawer).getByText("Admin").closest('[role="button"]') as HTMLElement;
    expect(getComputedStyle(header).color).toBe(MUTED);
  });
});
