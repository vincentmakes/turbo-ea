/**
 * Branch coverage for AppLayout beyond `AppLayout.test.tsx`: the mobile drawer
 * and the compact (icon-only) bar, the user menu's secondary entries, the
 * license / impersonation / denied-path banners, module toggles that reshape
 * the bar, and `navPlacement` for top-level extension routes.
 *
 * Uses the shared test kit (`@/test/apiMock`, `@/test/hooks`) rather than the
 * sibling file's bespoke mocks, so every request the layout makes is scripted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";

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

const local = vi.hoisted(() => ({ sponsor: true, locales: ["en", "de"] as string[] }));

vi.mock("@/hooks/useSponsorButtonEnabled", () => ({
  useSponsorButtonEnabled: () => ({ sponsorButtonEnabled: local.sponsor, loaded: true }),
}));
vi.mock("@/hooks/useEnabledLocales", () => ({
  useEnabledLocales: () => ({ enabledLocales: local.locales }),
}));
vi.mock("@/hooks/useAppTitle", () => ({ useAppTitle: () => "Turbo EA" }));
vi.mock("@/hooks/useNavbarStyle", () => ({
  useNavbarStyle: () => ({ bg: "#1a1a2e", fg: "#ffffff" }),
}));

// Dialogs the layout only opens and closes: a stub that shows when open and
// offers its close callback is enough to drive the layout's wiring.
function stubDialog(name: string) {
  return {
    default: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
      open ? (
        <div data-testid={`${name}-dialog`}>
          <button onClick={onClose}>close-{name}</button>
        </div>
      ) : null,
  };
}
vi.mock("@/components/NotificationBell", () => ({
  default: () => <div data-testid="notification-bell" />,
}));
vi.mock("@/components/NotificationPreferencesDialog", () => stubDialog("notif"));
vi.mock("@/components/SearchDialog", () => stubDialog("search"));
vi.mock("@/components/SponsorshipDialog", () => stubDialog("sponsor"));
vi.mock("@/features/admin/ImpersonateRoleDialog", () => stubDialog("impersonate"));
vi.mock("@/components/CreateCardDialog", () => ({
  default: ({
    open,
    onClose,
    onCreate,
  }: {
    open: boolean;
    onClose: () => void;
    onCreate: (data: Record<string, unknown>) => Promise<string>;
  }) =>
    open ? (
      <div data-testid="create-dialog">
        <button onClick={onClose}>close-create</button>
        <button
          onClick={async () => {
            const id = await onCreate({ type: "Application", name: "New App" });
            document.body.setAttribute("data-created", id);
          }}
        >
          do-create
        </button>
      </div>
    ) : null,
}));

import i18n from "@/i18n";
import AppLayout from "./AppLayout";
import { AuthProvider } from "@/hooks/AuthContext";
import { mockApi } from "@/test/apiMock";
import { emitEvent, hookState } from "@/test/hooks";
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
const refreshUser = vi.fn(async () => {});

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

function renderLayout(
  user: LayoutUser = adminUser,
  entry: string | { pathname: string; state?: unknown } = "/",
) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider
        user={user as unknown as Parameters<typeof AuthProvider>[0]["user"]}
        refreshUser={refreshUser}
      >
        <AppLayout user={user} onLogout={onLogout}>
          <LocationProbe />
        </AppLayout>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const pathname = () => screen.getByTestId("location").textContent;

async function openUserMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /account_circle/i }));
  await screen.findByText("Logout");
}

beforeEach(() => {
  hookState.reset();
  mockApi.reset();
  resetExtensionHost();
  onLogout.mockClear();
  refreshUser.mockClear();
  local.sponsor = true;
  local.locales = ["en", "de"];
  localStorage.removeItem("refCatExpanded");
  document.body.removeAttribute("data-created");
  // Off unless a test turns it on: the Reports dropdown then holds core reports only.
  hookState.turboLens = { ...hookState.turboLens, turboLensReady: false };
  mockApi.on("get", "/notifications/badge-counts", { open_todos: 0, pending_surveys: 0 });
  mockApi.on("get", "/extensions/status", []);
});

afterEach(() => {
  resetExtensionHost();
});

describe("AppLayout — banners", () => {
  it("shows the extension license banner for grace / expired entries only, and links to the admin page", async () => {
    mockApi.on("get", "/extensions/status", [
      { key: "alpha", version: "1.0.0", entitlement_state: "grace" },
      { key: "beta", version: "1.0.0", entitlement_state: "active" },
      { key: "gamma", version: "1.0.0", entitlement_state: "expired" },
    ]);
    const user = userEvent.setup();
    renderLayout();

    const banner = await screen.findByText(/alpha \(grace\), gamma \(expired\)/);
    expect(banner).not.toHaveTextContent(/beta/);
    await user.click(screen.getByRole("button", { name: "Manage" }));
    expect(pathname()).toBe("/admin/extensions");
  });

  it("never asks for extension status without the manage permission", async () => {
    renderLayout(viewerUser);
    await waitFor(() => expect(mockApi.callsOf("get", "/notifications/badge-counts").length).toBeGreaterThan(0));
    expect(mockApi.callsOf("get", "/extensions/status")).toHaveLength(0);
  });

  it("swallows a failing extension-status request (no banner)", async () => {
    mockApi.fail("get", "/extensions/status", 500);
    renderLayout();
    await waitFor(() => expect(mockApi.callsOf("get", "/extensions/status")).toHaveLength(1));
    expect(screen.queryByRole("button", { name: "Manage" })).not.toBeInTheDocument();
  });

  it("renders the impersonation banner and stops impersonating on click", async () => {
    mockApi.auth.stopImpersonating.mockResolvedValue({ access_token: "tok" });
    const user = userEvent.setup();
    renderLayout({ ...adminUser, impersonated_role: "viewer", impersonated_role_label: "Viewer" });

    expect(screen.getByRole("status")).toHaveTextContent("Viewing as Viewer");
    await user.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(refreshUser).toHaveBeenCalled());
    expect(mockApi.auth.stopImpersonating).toHaveBeenCalledTimes(1);
    // The button re-enables once the request settles.
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled());
  });

  it("falls back to the raw role key and survives a failing stop request", async () => {
    mockApi.auth.stopImpersonating.mockRejectedValue(new Error("nope"));
    const user = userEvent.setup();
    renderLayout({ ...adminUser, impersonated_role: "auditor" });

    expect(screen.getByRole("status")).toHaveTextContent("Viewing as auditor");
    await user.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled());
    expect(refreshUser).not.toHaveBeenCalled();
  });

  it("hides the 'View as role' entry while already impersonating", async () => {
    const user = userEvent.setup();
    renderLayout({ ...adminUser, impersonated_role: "viewer" });
    await openUserMenu(user);
    expect(screen.queryByText("View as role…")).not.toBeInTheDocument();
  });

  it("announces a denied deep link handed over in router state, then lets it be dismissed", async () => {
    const user = userEvent.setup();
    renderLayout(adminUser, { pathname: "/", state: { deniedPath: "/admin/users" } });

    const alert = await screen.findByText(/You don't have access to that page/);
    expect(alert).toBeInTheDocument();
    await user.click(within(screen.getByRole("alert")).getByRole("button", { name: /close/i }));
    await waitFor(() =>
      expect(screen.queryByText(/You don't have access to that page/)).not.toBeInTheDocument(),
    );
  });
});

describe("AppLayout — module toggles reshape the bar", () => {
  it("promotes EA Delivery to a top-level item, before Diagrams, when PPM is off", () => {
    hookState.ppm = { ppmEnabled: false, ppmLoaded: true };
    renderLayout();

    const delivery = screen.getByRole("link", { name: /EA Delivery/ });
    expect(delivery).toHaveAttribute("href", "/reports/ea-delivery");
    expect(screen.queryByRole("link", { name: /^view_timeline\s*PPM$/ })).not.toBeInTheDocument();
    const diagrams = screen.getByRole("link", { name: /Diagrams/ });
    expect(delivery.compareDocumentPosition(diagrams) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("appends TurboLens to the Reports dropdown, after a divider, when AI is ready", async () => {
    hookState.turboLens = { ...hookState.turboLens, turboLensReady: true };
    const user = userEvent.setup();
    renderLayout();

    await user.click(screen.getByRole("button", { name: /reports/i }));
    const item = await screen.findByRole("menuitem", { name: /TurboLens/ });
    expect(item).toHaveAttribute("href", "/turbolens");
    // Picking an entry closes the dropdown.
    await user.click(item);
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: /TurboLens/ })).not.toBeInTheDocument());
  });

  it("keeps TurboLens out of the dropdown for a role without turbolens.view", async () => {
    hookState.turboLens = { ...hookState.turboLens, turboLensReady: true };
    const user = userEvent.setup();
    renderLayout(viewerUser);

    await user.click(screen.getByRole("button", { name: /reports/i }));
    await screen.findAllByRole("menuitem");
    expect(screen.queryByRole("menuitem", { name: /TurboLens/ })).not.toBeInTheDocument();
  });

  it("closes the group dropdown on Escape", async () => {
    const user = userEvent.setup();
    renderLayout();
    await user.click(screen.getByRole("button", { name: /reports/i }));
    await screen.findAllByRole("menuitem");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryAllByRole("menuitem")).toHaveLength(0));
  });
});

describe("AppLayout — top-level extension routes honour navPlacement", () => {
  function routeAt(id: string, label: string, navPlacement?: string) {
    return {
      id,
      path: `/ext/place-ext/${id}`,
      label,
      icon: "star",
      navPlacement,
      component: () => null,
    };
  }

  function barHrefs(): string[] {
    return screen.getAllByRole("link").map((a) => a.getAttribute("href") ?? "");
  }

  it("inserts before an anchor and keeps two routes sharing it in registration order", () => {
    registerExtension("place-ext", {
      key: "place-ext",
      sdkVersion: UI_SDK_VERSION,
      routes: [routeAt("one", "Ext One", "before:diagrams"), routeAt("two", "Ext Two", "before:diagrams")],
    });
    renderLayout();

    const hrefs = barHrefs();
    const one = hrefs.indexOf("/ext/place-ext/one");
    const two = hrefs.indexOf("/ext/place-ext/two");
    const diagrams = hrefs.indexOf("/diagrams");
    expect(one).toBeGreaterThan(-1);
    expect(one).toBeLessThan(two);
    expect(two).toBeLessThan(diagrams);
  });

  it("puts a 'start' route first and degrades a missing anchor to the end", () => {
    hookState.bpm = { bpmEnabled: false, bpmLoaded: true };
    registerExtension("place-ext", {
      key: "place-ext",
      sdkVersion: UI_SDK_VERSION,
      routes: [routeAt("first", "Ext First", "start"), routeAt("orphan", "Ext Orphan", "after:bpm")],
    });
    renderLayout();

    const hrefs = barHrefs();
    // Brand logo, then the extension, then Dashboard (both core links are "/").
    expect(hrefs.slice(0, 3)).toEqual(["/", "/ext/place-ext/first", "/"]);
    // BPM is off, so "after:bpm" falls back to the default: the end of the bar.
    expect(hrefs[hrefs.length - 1]).toBe("/ext/place-ext/orphan");
  });
});

describe("AppLayout — user menu", () => {
  it("opens and closes notification settings, the manual link and the sponsor dialog", async () => {
    const user = userEvent.setup();
    renderLayout();

    await openUserMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /Notification Settings/ }));
    expect(await screen.findByTestId("notif-dialog")).toBeInTheDocument();
    await user.click(screen.getByText("close-notif"));
    expect(screen.queryByTestId("notif-dialog")).not.toBeInTheDocument();

    await openUserMenu(user);
    const manual = screen.getByRole("menuitem", { name: /User Manual/ });
    expect(manual).toHaveAttribute("href", "https://docs.turbo-ea.org/");
    expect(manual).toHaveAttribute("target", "_blank");
    manual.addEventListener("click", (e) => e.preventDefault());
    await user.click(manual);
    await waitFor(() => expect(screen.queryByText("Logout")).not.toBeInTheDocument());

    await openUserMenu(user);
    await user.click(screen.getByRole("button", { name: /Sponsor/ }));
    expect(await screen.findByTestId("sponsor-dialog")).toBeInTheDocument();
    await user.click(screen.getByText("close-sponsor"));
    expect(screen.queryByTestId("sponsor-dialog")).not.toBeInTheDocument();
  });

  it("hides the sponsor button when the setting is off", async () => {
    local.sponsor = false;
    const user = userEvent.setup();
    renderLayout();
    await openUserMenu(user);
    expect(screen.queryByRole("button", { name: /Sponsor/ })).not.toBeInTheDocument();
  });

  it("labels the theme toggle by the mode it switches to", async () => {
    hookState.themeMode = "dark";
    const user = userEvent.setup();
    renderLayout();
    await openUserMenu(user);
    expect(screen.getByRole("menuitem", { name: /Light Mode/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Dark Mode/ })).not.toBeInTheDocument();
  });

  it("lists only enabled locales and persists a pick to the user's profile", async () => {
    mockApi.on("patch", "/users/u1", {});
    const user = userEvent.setup();
    renderLayout();
    await openUserMenu(user);

    await user.click(screen.getByRole("menuitem", { name: /Language/ }));
    expect(await screen.findByRole("menuitem", { name: "Deutsch" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Français" })).not.toBeInTheDocument();
    // Re-picking English keeps the rest of the file in English.
    await user.click(screen.getByRole("menuitem", { name: "English" }));
    await waitFor(() => expect(mockApi.callsOf("patch", "/users/u1")).toHaveLength(1));
    expect(mockApi.callsOf("patch", "/users/u1")[0].body).toEqual({ locale: "en" });
    expect(i18n.language).toBe("en");
    expect(screen.queryByText("Logout")).not.toBeInTheDocument();
  });

  it("treats a failed locale save as best-effort", async () => {
    mockApi.fail("patch", "/users/u1", 500);
    const user = userEvent.setup();
    renderLayout();
    await openUserMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /Language/ }));
    await user.click(await screen.findByRole("menuitem", { name: "English" }));
    await waitFor(() => expect(mockApi.callsOf("patch", "/users/u1")).toHaveLength(1));
    expect(screen.getByTestId("location")).toBeInTheDocument();
  });

  it("closes the language submenu on Escape without picking", async () => {
    const user = userEvent.setup();
    renderLayout();
    await openUserMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /Language/ }));
    await screen.findByRole("menuitem", { name: "Deutsch" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: "Deutsch" })).not.toBeInTheDocument());
    expect(mockApi.callsOf("patch")).toHaveLength(0);
  });

  it("expands the reference catalogues, persists the choice and navigates from it", async () => {
    const user = userEvent.setup();
    renderLayout();
    await openUserMenu(user);

    const toggle = screen.getByRole("menuitem", { name: /Reference Catalogues/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menuitem", { name: /Capability Catalogue/ })).not.toBeInTheDocument();
    await user.click(toggle);
    expect(localStorage.getItem("refCatExpanded")).toBe("true");

    for (const [label, href] of [
      [/Process Catalogue/, "/process-catalogue"],
      [/Value Stream Catalogue/, "/value-stream-catalogue"],
      [/Principles Catalogue/, "/principles-catalogue"],
    ] as const) {
      expect(await screen.findByRole("menuitem", { name: label })).toHaveAttribute("href", href);
    }
    await user.click(screen.getByRole("menuitem", { name: /Capability Catalogue/ }));
    expect(pathname()).toBe("/capability-catalogue");
    await waitFor(() => expect(screen.queryByText("Logout")).not.toBeInTheDocument());

    // Each of the others navigates and closes the menu too.
    for (const [label, href] of [
      [/Process Catalogue/, "/process-catalogue"],
      [/Value Stream Catalogue/, "/value-stream-catalogue"],
      [/Principles Catalogue/, "/principles-catalogue"],
    ] as const) {
      await openUserMenu(user);
      await user.click(await screen.findByRole("menuitem", { name: label }));
      expect(pathname()).toBe(href);
    }
  });

  it("starts with the catalogues expanded when the choice was persisted, and collapses them", async () => {
    localStorage.setItem("refCatExpanded", "true");
    const user = userEvent.setup();
    renderLayout();
    await openUserMenu(user);

    const toggle = screen.getByRole("menuitem", { name: /Reference Catalogues/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.click(toggle);
    expect(localStorage.getItem("refCatExpanded")).toBe("false");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("closes the menu when an admin entry is followed", async () => {
    const user = userEvent.setup();
    renderLayout();
    await openUserMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /Metamodel/ }));
    expect(pathname()).toBe("/admin/metamodel");
    await waitFor(() => expect(screen.queryByText("Logout")).not.toBeInTheDocument());
  });

  it("opens the role-impersonation dialog from 'View as role'", async () => {
    const user = userEvent.setup();
    renderLayout();
    await openUserMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /View as role/ }));
    expect(await screen.findByTestId("impersonate-dialog")).toBeInTheDocument();
    await user.click(screen.getByText("close-impersonate"));
    expect(screen.queryByTestId("impersonate-dialog")).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    renderLayout();
    await openUserMenu(user);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("Logout")).not.toBeInTheDocument());
  });
});

describe("AppLayout — toolbar actions", () => {
  it("opens search from the icon and from Ctrl+K, but ignores a bare K", async () => {
    const user = userEvent.setup();
    renderLayout();

    fireEvent.keyDown(document, { key: "k" });
    expect(screen.queryByTestId("search-dialog")).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(await screen.findByTestId("search-dialog")).toBeInTheDocument();
    await user.click(screen.getByText("close-search"));
    expect(screen.queryByTestId("search-dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /search/i }));
    expect(await screen.findByTestId("search-dialog")).toBeInTheDocument();
  });

  it("opens the global create dialog and posts the new card", async () => {
    mockApi.on("post", "/cards", { id: "new-card-id" });
    const user = userEvent.setup();
    renderLayout();

    await user.click(screen.getByRole("button", { name: /^add\s*Create$/ }));
    await user.click(await screen.findByText("do-create"));
    await waitFor(() => expect(document.body.getAttribute("data-created")).toBe("new-card-id"));
    expect(mockApi.callsOf("post", "/cards")[0].body).toEqual({ type: "Application", name: "New App" });

    await user.click(screen.getByText("close-create"));
    expect(screen.queryByTestId("create-dialog")).not.toBeInTheDocument();
  });

  it("marks Todos with a badge and refreshes the counts after a relevant event", async () => {
    let calls = 0;
    mockApi.on("get", "/notifications/badge-counts", () => {
      calls += 1;
      return { open_todos: calls > 1 ? 2 : 0, pending_surveys: 0 };
    });
    renderLayout();
    await waitFor(() => expect(calls).toBeGreaterThan(0));
    const before = calls;

    act(() => {
      emitEvent({ event: "card.updated" });
    });
    act(() => {
      emitEvent({ event: "todo.created" });
      emitEvent({ event: "survey.sent" });
    });
    // Two relevant events coalesce into one refresh after the 500ms debounce.
    await waitFor(() => expect(calls).toBe(before + 1), { timeout: 2000 });
    const todos = screen.getByRole("link", { name: /Todos/ });
    await waitFor(() => expect(todos.querySelector(".MuiBadge-invisible")).toBeNull());
  });

  it("re-reads the counts when the event stream reconnects, and ignores a failing read", async () => {
    let calls = 0;
    mockApi.on("get", "/notifications/badge-counts", () => {
      calls += 1;
      throw new Error("down");
    });
    renderLayout();
    await waitFor(() => expect(calls).toBeGreaterThan(0));
    const before = calls;
    act(() => {
      for (const reconnect of hookState.eventStream.reconnect) reconnect();
    });
    await waitFor(() => expect(calls).toBe(before + 1), { timeout: 2000 });
  });
});

describe("AppLayout — compact bar", () => {
  it("renders icon buttons with tooltips and opens a group's dropdown from its icon", async () => {
    setViewportWidth(900);
    const user = userEvent.setup();
    renderLayout();

    // Plain items stay links (Ctrl+Click opens a tab), labelled by their tooltip.
    expect(screen.getByRole("link", { name: "Inventory" })).toHaveAttribute("href", "/inventory");
    expect(screen.queryByRole("button", { name: /expand_more/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reports" }));
    expect(await screen.findByRole("menuitem", { name: /Saved/ })).toBeInTheDocument();
  });
});

describe("AppLayout — mobile drawer", () => {
  beforeEach(() => setViewportWidth(500));

  async function openDrawer(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /^menu$/ }));
    return screen.findByRole("presentation");
  }

  it("hides the desktop nav and search icon, and offers an icon-only Create", async () => {
    const user = userEvent.setup();
    renderLayout();

    expect(screen.queryByRole("link", { name: /Inventory/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^search$/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByTestId("create-dialog")).toBeInTheDocument();
  });

  it("navigates from top-level entries, the brand and expanded groups, closing each time", async () => {
    const user = userEvent.setup();
    renderLayout();

    let drawer = await openDrawer(user);
    await user.click(within(drawer).getByText("Inventory"));
    expect(pathname()).toBe("/inventory");
    await waitFor(() => expect(screen.queryByRole("presentation")).not.toBeInTheDocument());

    drawer = await openDrawer(user);
    await user.click(within(drawer).getByRole("img", { name: "Turbo EA" }));
    expect(pathname()).toBe("/");

    drawer = await openDrawer(user);
    await user.click(within(drawer).getByText("Reports"));
    await user.click(within(drawer).getByText("Saved Reports"));
    expect(pathname()).toBe("/reports/saved");
  });

  it("expands the admin section and follows an admin entry", async () => {
    const user = userEvent.setup();
    renderLayout();
    const drawer = await openDrawer(user);

    await user.click(within(drawer).getByText("Admin"));
    await user.click(await within(drawer).findByText("Metamodel"));
    expect(pathname()).toBe("/admin/metamodel");
  });

  it("opens search and create from the drawer", async () => {
    const user = userEvent.setup();
    renderLayout();

    let drawer = await openDrawer(user);
    await user.click(within(drawer).getByText("Search cards..."));
    expect(await screen.findByTestId("search-dialog")).toBeInTheDocument();
    await user.click(screen.getByText("close-search"));

    drawer = await openDrawer(user);
    await user.click(within(drawer).getByText("Create Card"));
    expect(await screen.findByTestId("create-dialog")).toBeInTheDocument();
  });

  it("logs out from the drawer footer and closes on Escape", async () => {
    const user = userEvent.setup();
    renderLayout();

    let drawer = await openDrawer(user);
    expect(within(drawer).getByText("admin@turboea.local")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("presentation")).not.toBeInTheDocument());

    drawer = await openDrawer(user);
    await user.click(within(drawer).getByRole("button", { name: /Logout/ }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("shows neither admin nor create for a viewer", async () => {
    const user = userEvent.setup();
    renderLayout(viewerUser);
    const drawer = await openDrawer(user);
    expect(within(drawer).queryByText("Admin")).not.toBeInTheDocument();
    expect(within(drawer).queryByText("Create Card")).not.toBeInTheDocument();
  });
});
