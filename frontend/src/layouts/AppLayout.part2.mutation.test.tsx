/**
 * Behaviour pins for the second half of AppLayout (the Ctrl/Cmd+K shortcut
 * onwards): which entry is highlighted as the current page, the Todos badge,
 * the mobile drawer's collapsible groups, the dividers in the Reports
 * dropdown, the user menu's structure per role, the language caption and the
 * localized license banner. Each assertion is one the sibling files did not
 * make, written so a regression in that logic fails here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

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

// Dialogs the layout only opens and closes: visible while open, nothing else.
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

import i18n from "@/i18n";
import AppLayout from "./AppLayout";
import { AuthProvider } from "@/hooks/AuthContext";
import { mockApi } from "@/test/apiMock";
import { hookState } from "@/test/hooks";
import { setViewportWidth } from "@/test/matchMedia";
import { registerExtension, resetExtensionHost, UI_SDK_VERSION } from "@/lib/extensionHost";

type LayoutUser = Parameters<typeof AppLayout>[0]["user"];

const adminUser: LayoutUser = {
  id: "u1",
  display_name: "Admin User",
  email: "admin@turboea.local",
  role: "admin",
  permissions: { "*": true },
};

const viewerUser: LayoutUser = {
  id: "u2",
  display_name: "Viewer User",
  email: "viewer@turboea.local",
  role: "viewer",
  permissions: {
    "inventory.view": true,
    "reports.ea_dashboard": true,
    "diagrams.view": true,
  },
};

const onLogout = vi.fn();

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

function renderLayout(
  user: LayoutUser = adminUser,
  entry: string | { pathname: string; state?: unknown } = "/",
) {
  // Mounted under a splat route, as App.tsx mounts it: relative navigation
  // then resolves against the current page, not the router root.
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="*"
          element={
            <AuthProvider
              user={user as unknown as Parameters<typeof AuthProvider>[0]["user"]}
              refreshUser={async () => {}}
            >
              <AppLayout user={user} onLogout={onLogout}>
                <LocationProbe />
              </AppLayout>
            </AuthProvider>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const pathname = () => screen.getByTestId("location").textContent;

async function openUserMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /account_circle/i }));
  return screen.findByRole("menu");
}

/**
 * The open menu, top to bottom: one entry per item (its label, without the
 * icon ligature) and "—" for every divider.
 */
function outline(menu: HTMLElement): string[] {
  return Array.from(menu.children).flatMap((el) => {
    if (el.tagName === "HR") return ["—"];
    if (el.getAttribute("role") !== "menuitem") return [];
    const label = el.querySelector(".MuiListItemText-root") ?? el;
    return [(label.textContent ?? "").trim()];
  });
}

/** Whether the nav link's dot badge is showing. */
function badgeShown(link: HTMLElement): boolean {
  const badge = link.querySelector(".MuiBadge-badge");
  return !!badge && !badge.classList.contains("MuiBadge-invisible");
}

function collapseOf(el: HTMLElement): HTMLElement {
  const root = el.closest<HTMLElement>(".MuiCollapse-root");
  if (!root) throw new Error("not inside a Collapse");
  return root;
}

function rowOf(el: HTMLElement): HTMLElement {
  const row = el.closest<HTMLElement>('[role="button"]');
  if (!row) throw new Error("not inside a list button");
  return row;
}

beforeEach(() => {
  hookState.reset();
  mockApi.reset();
  resetExtensionHost();
  onLogout.mockClear();
  localStorage.removeItem("refCatExpanded");
  hookState.turboLens = { ...hookState.turboLens, turboLensReady: false };
  mockApi.on("get", "/notifications/badge-counts", { open_todos: 0, pending_surveys: 0 });
  mockApi.on("get", "/extensions/status", []);
});

afterEach(async () => {
  resetExtensionHost();
  if (i18n.language !== "en") await i18n.changeLanguage("en");
});

describe("AppLayout — Ctrl/Cmd+K", () => {
  it("opens search on Cmd+K or Ctrl+K only, taking the shortcut from the browser", async () => {
    renderLayout();

    // A bare K, or another key with Ctrl, is left alone.
    expect(fireEvent.keyDown(document, { key: "k" })).toBe(true);
    expect(fireEvent.keyDown(document, { key: "j", ctrlKey: true })).toBe(true);
    expect(screen.queryByTestId("search-dialog")).not.toBeInTheDocument();

    // The shortcut is consumed (default prevented) and opens the search.
    expect(fireEvent.keyDown(document, { key: "k", metaKey: true })).toBe(false);
    expect(await screen.findByTestId("search-dialog")).toBeInTheDocument();
  });

  it("stops claiming Ctrl+K once the layout is gone", () => {
    const { unmount } = renderLayout();
    expect(fireEvent.keyDown(document, { key: "k", ctrlKey: true })).toBe(false);
    unmount();
    expect(fireEvent.keyDown(document, { key: "k", ctrlKey: true })).toBe(true);
  });

  it("names the search button after the shortcut", () => {
    renderLayout();
    expect(screen.getByRole("button", { name: "Search (Ctrl+K)" })).toBeInTheDocument();
  });

  it("shows the Command-key shortcut on a Mac", () => {
    Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
    try {
      renderLayout();
      expect(screen.getByRole("button", { name: "Search (⌘K)" })).toBeInTheDocument();
    } finally {
      delete (window.navigator as unknown as Record<string, unknown>).platform;
    }
  });
});

describe("AppLayout — Todos badge", () => {
  it("stays hidden while there is nothing to do", async () => {
    renderLayout();
    await waitFor(() =>
      expect(mockApi.callsOf("get", "/notifications/badge-counts").length).toBeGreaterThan(0),
    );
    expect(badgeShown(screen.getByRole("link", { name: /Todos/ }))).toBe(false);
    expect(badgeShown(screen.getByRole("link", { name: /Inventory/ }))).toBe(false);
  });

  it("marks Todos, and only Todos, when there are open todos", async () => {
    mockApi.on("get", "/notifications/badge-counts", { open_todos: 2, pending_surveys: 0 });
    renderLayout();
    const todos = screen.getByRole("link", { name: /Todos/ });
    await waitFor(() => expect(badgeShown(todos)).toBe(true));
    expect(badgeShown(screen.getByRole("link", { name: /Inventory/ }))).toBe(false);
    expect(badgeShown(screen.getByRole("link", { name: /^dashboard\s*Dashboard$/ }))).toBe(false);
  });

  it("marks Todos when only a survey is pending", async () => {
    mockApi.on("get", "/notifications/badge-counts", { open_todos: 0, pending_surveys: 3 });
    renderLayout();
    const todos = screen.getByRole("link", { name: /Todos/ });
    await waitFor(() => expect(badgeShown(todos)).toBe(true));
  });
});

describe("AppLayout — Reports dropdown", () => {
  it("sets Saved Reports and TurboLens apart with dividers and highlights the open report", async () => {
    hookState.turboLens = { ...hookState.turboLens, turboLensReady: true };
    const user = userEvent.setup();
    renderLayout(adminUser, "/reports/cost");

    await user.click(screen.getByRole("button", { name: /reports/i }));
    const menu = await screen.findByRole("menu");

    const dividedFrom = within(menu)
      .getAllByRole("separator")
      .map((hr) => hr.nextElementSibling?.querySelector(".MuiListItemText-root")?.textContent);
    expect(dividedFrom).toEqual(["Saved Reports", "TurboLens"]);

    const selected = Array.from(menu.querySelectorAll(".Mui-selected")).map((el) => el.textContent);
    expect(selected).toEqual(["paymentsCost"]);
  });
});

describe("AppLayout — mobile drawer", () => {
  beforeEach(() => setViewportWidth(500));

  async function openDrawer(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /^menu$/ }));
    return screen.findByRole("presentation");
  }

  function selectedLabels(drawer: HTMLElement): string[] {
    return Array.from(drawer.querySelectorAll(".Mui-selected")).map(
      (el) => el.querySelector(".MuiListItemText-primary")?.textContent ?? "",
    );
  }

  it.each([
    ["/", ["Dashboard"]],
    ["/inventory", ["Inventory"]],
    ["/diagrams/d1", ["Diagrams"]],
    ["/reports/cost", ["Cost"]],
    ["/admin/surveys/new", ["Surveys"]],
  ])("highlights only the current page's entry at %s", async (path, expected) => {
    const user = userEvent.setup();
    renderLayout(adminUser, path);
    const drawer = await openDrawer(user);
    expect(selectedLabels(drawer)).toEqual(expected);
  });

  it("takes the brand back to the dashboard", async () => {
    const user = userEvent.setup();
    renderLayout(adminUser, "/inventory");
    const drawer = await openDrawer(user);
    await user.click(within(drawer).getByRole("img", { name: "Turbo EA" }));
    expect(pathname()).toBe("/");
  });

  it("expands and collapses each group on its own", async () => {
    registerExtension("gov-ext", {
      key: "gov-ext",
      sdkVersion: UI_SDK_VERSION,
      routes: [
        {
          id: "register",
          path: "/ext/gov-ext/register",
          label: "Gov Register",
          icon: "gavel",
          navGroup: "grc",
          component: () => null,
        },
      ],
    });
    const user = userEvent.setup();
    renderLayout();
    const drawer = await openDrawer(user);

    const reports = rowOf(within(drawer).getByText("Reports"));
    const reportsBody = collapseOf(within(drawer).getByText("Saved Reports"));
    const grcBody = collapseOf(within(drawer).getByText("Gov Register"));
    expect(reports).toHaveTextContent(/expand_more$/);
    expect(reportsBody).toHaveClass("MuiCollapse-hidden");

    await user.click(reports);
    expect(reports).toHaveTextContent(/expand_less$/);
    await waitFor(() => expect(reportsBody).not.toHaveClass("MuiCollapse-hidden"));
    // Keyed by group: opening Reports leaves GRC shut.
    expect(grcBody).toHaveClass("MuiCollapse-hidden");

    await user.click(reports);
    expect(reports).toHaveTextContent(/expand_more$/);
    await waitFor(() => expect(reportsBody).toHaveClass("MuiCollapse-hidden"));
  });

  it("toggles the admin section open and shut", async () => {
    const user = userEvent.setup();
    renderLayout();
    const drawer = await openDrawer(user);

    const admin = rowOf(within(drawer).getByText("Admin"));
    const body = collapseOf(within(drawer).getByText("Metamodel"));
    expect(admin).toHaveTextContent(/expand_more$/);
    expect(body).toHaveClass("MuiCollapse-hidden");

    await user.click(admin);
    expect(admin).toHaveTextContent(/expand_less$/);
    await waitFor(() => expect(body).not.toHaveClass("MuiCollapse-hidden"));

    await user.click(admin);
    expect(admin).toHaveTextContent(/expand_more$/);
    await waitFor(() => expect(body).toHaveClass("MuiCollapse-hidden"));
  });

  it("closes itself when Create Card opens the dialog", async () => {
    const user = userEvent.setup();
    renderLayout();
    const drawer = await openDrawer(user);
    await user.click(within(drawer).getByText("Create Card"));
    expect(await screen.findByTestId("create-dialog")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("presentation")).not.toBeInTheDocument());
  });

  it("closes itself on logout", async () => {
    const user = userEvent.setup();
    renderLayout();
    const drawer = await openDrawer(user);
    await user.click(within(drawer).getByRole("button", { name: /Logout/ }));
    expect(onLogout).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("presentation")).not.toBeInTheDocument());
  });
});

describe("AppLayout — user menu structure", () => {
  const head = ["Admin User", "admin@turboea.local", "—", "Notification Settings", "Dark Mode", "Language", "User Manual"];
  const adminSection = ["—", "Admin", "Metamodel", "Users & Roles", "Surveys", "Extensions", "Settings"];

  it("gives an admin the catalogues, the admin section and 'View as role'", async () => {
    const user = userEvent.setup();
    renderLayout();
    const menu = await openUserMenu(user);
    expect(outline(menu)).toEqual([
      ...head,
      "—",
      "Reference Catalogues",
      ...adminSection,
      "—",
      "View as role…",
      "—",
      "Logout",
    ]);
  });

  it("drops 'View as role' and its divider while impersonating", async () => {
    const user = userEvent.setup();
    renderLayout({ ...adminUser, impersonated_role: "viewer" });
    const menu = await openUserMenu(user);
    expect(outline(menu)).toEqual([
      ...head,
      "—",
      "Reference Catalogues",
      ...adminSection,
      "—",
      "Logout",
    ]);
  });

  it("shows a role with none of those grants no extra sections or dividers", async () => {
    const user = userEvent.setup();
    renderLayout({
      id: "u3",
      display_name: "Plain User",
      email: "plain@turboea.local",
      role: "reporter",
      permissions: { "reports.ea_dashboard": true },
    });
    const menu = await openUserMenu(user);
    expect(outline(menu)).toEqual([
      "Plain User",
      "plain@turboea.local",
      "—",
      "Notification Settings",
      "Dark Mode",
      "Language",
      "User Manual",
      "—",
      "Logout",
    ]);
  });

  it("offers 'View as role' to a role granted admin.impersonate explicitly", async () => {
    const user = userEvent.setup();
    renderLayout({
      id: "u4",
      display_name: "Support User",
      email: "support@turboea.local",
      role: "support",
      permissions: { "admin.impersonate": true },
    });
    const menu = await openUserMenu(user);
    expect(outline(menu)).toEqual([
      "Support User",
      "support@turboea.local",
      "—",
      "Notification Settings",
      "Dark Mode",
      "Language",
      "User Manual",
      "—",
      "View as role…",
      "—",
      "Logout",
    ]);
  });

  it("lists only the catalogues the role can open", async () => {
    localStorage.setItem("refCatExpanded", "true");
    const user = userEvent.setup();
    renderLayout({
      id: "u5",
      display_name: "Modeller",
      email: "modeller@turboea.local",
      role: "modeller",
      permissions: { "admin.metamodel": true },
    });
    await openUserMenu(user);
    expect(await screen.findByRole("menuitem", { name: /Principles Catalogue/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Capability Catalogue/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Process Catalogue/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Value Stream Catalogue/ })).not.toBeInTheDocument();
  });

  it("keeps the principles catalogue from a role without admin.metamodel", async () => {
    localStorage.setItem("refCatExpanded", "true");
    const user = userEvent.setup();
    renderLayout(viewerUser);
    await openUserMenu(user);
    expect(await screen.findByRole("menuitem", { name: /Capability Catalogue/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Process Catalogue/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Value Stream Catalogue/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Principles Catalogue/ })).not.toBeInTheDocument();
  });

  it("flips the catalogue chevron as the section opens", async () => {
    const user = userEvent.setup();
    renderLayout();
    const menu = await openUserMenu(user);
    const toggle = within(menu).getByRole("menuitem", { name: /Reference Catalogues/ });
    expect(toggle).toHaveTextContent(/expand_more$/);
    await user.click(toggle);
    expect(toggle).toHaveTextContent(/expand_less$/);
  });
});

describe("AppLayout — user menu actions close the menu", () => {
  it("closes when the principles catalogue is followed", async () => {
    localStorage.setItem("refCatExpanded", "true");
    const user = userEvent.setup();
    renderLayout();
    await openUserMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: /Principles Catalogue/ }));
    expect(pathname()).toBe("/principles-catalogue");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("closes when the sponsor dialog opens", async () => {
    const user = userEvent.setup();
    renderLayout();
    await openUserMenu(user);
    await user.click(screen.getByRole("button", { name: /Sponsor/ }));
    expect(await screen.findByTestId("sponsor-dialog")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("closes when 'View as role' opens the picker", async () => {
    const user = userEvent.setup();
    renderLayout();
    await openUserMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /View as role/ }));
    expect(await screen.findByTestId("impersonate-dialog")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("closes on logout", async () => {
    const user = userEvent.setup();
    renderLayout();
    await openUserMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /Logout/ }));
    expect(onLogout).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });
});

describe("AppLayout — theme and language entries", () => {
  it("offers Dark Mode, with its icon, in light mode", async () => {
    const user = userEvent.setup();
    renderLayout();
    const menu = await openUserMenu(user);
    expect(within(menu).getByRole("menuitem", { name: /^dark_mode\s*Dark Mode$/ })).toBeInTheDocument();
  });

  it("offers Light Mode, with its icon, in dark mode", async () => {
    hookState.themeMode = "dark";
    const user = userEvent.setup();
    renderLayout();
    const menu = await openUserMenu(user);
    expect(within(menu).getByRole("menuitem", { name: /^light_mode\s*Light Mode$/ })).toBeInTheDocument();
  });

  it("captions the language entry with the current language and marks it in the picker", async () => {
    const user = userEvent.setup();
    renderLayout();
    const menu = await openUserMenu(user);
    const language = within(menu).getByRole("menuitem", { name: /Language/ });
    expect(language).toHaveTextContent(/English$/);

    await user.click(language);
    expect(await screen.findByRole("menuitem", { name: "English" })).toHaveClass("Mui-selected");
    expect(screen.getByRole("menuitem", { name: "Deutsch" })).not.toHaveClass("Mui-selected");
  });

  it("captions the language entry in the language's own name", async () => {
    await i18n.changeLanguage("de");
    const user = userEvent.setup();
    renderLayout();
    const menu = await openUserMenu(user);
    expect(within(menu).getByRole("menuitem", { name: /Sprache/ })).toHaveTextContent(/Deutsch$/);
  });

  it("falls back to English for a regional variant it has no label for", async () => {
    await i18n.changeLanguage("en-US");
    const user = userEvent.setup();
    renderLayout();
    const menu = await openUserMenu(user);
    expect(within(menu).getByRole("menuitem", { name: /Language/ })).toHaveTextContent(/English$/);
  });
});

describe("AppLayout — banners", () => {
  it("localizes the extension license banner and its action", async () => {
    await i18n.changeLanguage("de");
    mockApi.on("get", "/extensions/status", [
      { key: "alpha", version: "1.0.0", entitlement_state: "grace" },
    ]);
    renderLayout();
    expect(
      await screen.findByText(/^Erweiterungslizenz erfordert Aufmerksamkeit: alpha \(grace\)\./),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verwalten" })).toBeInTheDocument();
  });

  it("dismisses the access-denied notice on Escape", async () => {
    const user = userEvent.setup();
    renderLayout(adminUser, { pathname: "/", state: { deniedPath: "/admin/users" } });
    await screen.findByText(/You don't have access to that page/);
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByText(/You don't have access to that page/)).not.toBeInTheDocument(),
    );
  });
});
