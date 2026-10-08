/**
 * Mutation-hardening for the first half of `AppLayout.tsx` (state, permission
 * helpers, the nav / admin-item builders, the denied-path hand-over, the
 * impersonation stop, the language switch and the badge-count refresh).
 *
 * Each block pins a rule the layout owes its users, not a rendering detail:
 * the bar is built from `ROUTE_PERMISSIONS` and the module flags, extension
 * routes land where their `navGroup` asks (a page-host keeps its own link as
 * the first child), a denied deep link is announced once and never
 * resurrected, and the Todos badge follows the events that change it.
 *
 * Uses the shared test kit (`@/test/apiMock`, `@/test/hooks`) like
 * `AppLayout.branches.test.tsx`; it does not replace either sibling file.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router";

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
vi.mock("@/components/CreateCardDialog", () => stubDialog("create"));

import i18n from "@/i18n";
import AppLayout from "./AppLayout";
import { AuthProvider } from "@/hooks/AuthContext";
import { isAuthenticated, setAuthenticated } from "@/api/client";
import { mockApi } from "@/test/apiMock";
import { emitEvent, hookState } from "@/test/hooks";
import { setViewportWidth } from "@/test/matchMedia";
import {
  registerExtension,
  resetExtensionHost,
  UI_SDK_VERSION,
  type ExtensionRouteContribution,
} from "@/lib/extensionHost";
import type { User } from "@/types";

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

function userWithPerms(...perms: string[]): LayoutUser {
  return {
    id: "u5",
    display_name: "Scoped User",
    email: "scoped@turboea.local",
    role: "member",
    permissions: Object.fromEntries(perms.map((p) => [p, true])),
  };
}

const onLogout = vi.fn();
const refreshUser = vi.fn(async () => {});

/** Shows where the router is, and drives it the way another page would. */
function Probe() {
  const loc = useLocation();
  const navigate = useNavigate();
  return (
    <div>
      <div data-testid="location">{loc.pathname}</div>
      <div data-testid="location-state">{JSON.stringify(loc.state ?? null)}</div>
      <button onClick={() => navigate(-1)}>probe-back</button>
      <button onClick={() => navigate("/", { state: { deniedPath: "/admin/users" } })}>
        probe-deny
      </button>
    </div>
  );
}

type Entry = string | { pathname: string; state?: unknown };

function Layout({
  user = adminUser,
  refresh = refreshUser,
  entries = ["/"],
  index,
}: {
  user?: LayoutUser;
  refresh?: () => Promise<void>;
  entries?: Entry[];
  index?: number;
}) {
  return (
    <MemoryRouter initialEntries={entries} initialIndex={index}>
      <AuthProvider user={user as unknown as User} refreshUser={refresh}>
        <AppLayout user={user} onLogout={onLogout}>
          <Probe />
        </AppLayout>
      </AuthProvider>
    </MemoryRouter>
  );
}

const pathname = () => screen.getByTestId("location").textContent;
const badgeCalls = () => mockApi.callsOf("get", "/notifications/badge-counts").length;

/**
 * The top bar's entries in order: a link's href, or `[text]` for a dropdown
 * trigger (icon names are part of the text — `[analyticsReportsexpand_more]`).
 */
function navEntries(): string[] {
  const nav = screen.getByRole("link", { name: /Dashboard/ }).parentElement as HTMLElement;
  return Array.from(nav.children).map((el) => el.getAttribute("href") ?? `[${el.textContent}]`);
}

const REPORTS_BUTTON = "[analyticsReportsexpand_more]";
const CORE_BAR = ["/", "/inventory", REPORTS_BUTTON, "/bpm", "/ppm", "/diagrams", "/grc", "/todos"];
const CORE_REPORTS = [
  "/reports/portfolio",
  "/reports/flexible-portfolio",
  "/reports/capability-map",
  "/reports/lifecycle",
  "/reports/dependencies",
  "/reports/cost",
  "/reports/matrix",
  "/reports/data-quality",
  "/reports/eol",
];

/** The hrefs of the open dropdown's entries, in order. */
function menuHrefs(): (string | null)[] {
  return screen.getAllByRole("menuitem").map((el) => el.getAttribute("href"));
}

async function openUserMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /account_circle/i }));
  await screen.findByText("Logout");
}

function extRoute(
  id: string,
  label: string,
  extra: Partial<ExtensionRouteContribution> = {},
): ExtensionRouteContribution {
  return { id, path: `/ext/test-ext/${id}`, label, icon: "star", component: () => null, ...extra };
}

function registerRoutes(...routes: ExtensionRouteContribution[]) {
  registerExtension("test-ext", { key: "test-ext", sdkVersion: UI_SDK_VERSION, routes });
}

beforeEach(() => {
  hookState.reset();
  mockApi.reset();
  resetExtensionHost();
  onLogout.mockClear();
  refreshUser.mockClear();
  localStorage.removeItem("refCatExpanded");
  hookState.turboLens = { ...hookState.turboLens, turboLensReady: false };
  mockApi.on("get", "/notifications/badge-counts", { open_todos: 0, pending_surveys: 0 });
  mockApi.on("get", "/extensions/status", []);
});

afterEach(() => {
  vi.useRealTimers();
  resetExtensionHost();
});

// ---------------------------------------------------------------------------

describe("AppLayout — permission helpers fail closed", () => {
  it("renders for a user whose permissions have not loaded, offering only ungated pages", async () => {
    hookState.turboLens = { ...hookState.turboLens, turboLensReady: true };
    const nobody: LayoutUser = {
      id: "u3",
      display_name: "Nobody",
      email: "nobody@turboea.local",
      role: "viewer",
    };
    const user = userEvent.setup();
    render(<Layout user={nobody} />);

    // `/` and `/todos` are the two intentionally ungated pages.
    expect(navEntries()).toEqual(["/", "/todos"]);
    expect(screen.queryByRole("button", { name: /^add\s*Create$/ })).not.toBeInTheDocument();
    // No status request either: the license banner is for extension admins.
    expect(mockApi.callsOf("get", "/extensions/status")).toHaveLength(0);

    await openUserMenu(user);
    expect(screen.queryByRole("menuitem", { name: /View as role/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Reference Catalogues/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Metamodel")).not.toBeInTheDocument();
  });

  it("offers 'View as role' only to a role holding admin.impersonate", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Layout user={viewerUser} />);
    await openUserMenu(user);
    expect(screen.queryByRole("menuitem", { name: /View as role/ })).not.toBeInTheDocument();
    unmount();

    render(<Layout user={userWithPerms("admin.impersonate")} />);
    await openUserMenu(user);
    expect(screen.getByRole("menuitem", { name: /View as role/ })).toBeInTheDocument();
  });

  it("re-reads the permissions when the user's permission map changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Layout user={viewerUser} />);
    rerender(
      <Layout
        user={{
          ...viewerUser,
          permissions: { ...viewerUser.permissions, "admin.impersonate": true },
        }}
      />,
    );
    await openUserMenu(user);
    expect(screen.getByRole("menuitem", { name: /View as role/ })).toBeInTheDocument();
  });

  it("follows a changing user for the Create button", () => {
    const { rerender } = render(<Layout user={viewerUser} />);
    expect(screen.queryByRole("button", { name: /^add\s*Create$/ })).not.toBeInTheDocument();
    rerender(<Layout user={adminUser} />);
    expect(screen.getByRole("button", { name: /^add\s*Create$/ })).toBeInTheDocument();
  });
});

describe("AppLayout — extension license banner", () => {
  const GRACE = [{ key: "alpha", version: "1.0.0", entitlement_state: "grace" }];

  it("is fetched for a role holding admin.manage_extensions without the wildcard", async () => {
    mockApi.on("get", "/extensions/status", GRACE);
    render(<Layout user={userWithPerms("admin.manage_extensions")} />);
    expect(await screen.findByText(/alpha \(grace\)/)).toBeInTheDocument();
    expect(mockApi.callsOf("get", "/extensions/status")).toHaveLength(1);
  });

  it("is fetched once the user gains the manage permission", async () => {
    mockApi.on("get", "/extensions/status", GRACE);
    const { rerender } = render(<Layout user={viewerUser} />);
    expect(mockApi.callsOf("get", "/extensions/status")).toHaveLength(0);
    rerender(<Layout user={adminUser} />);
    expect(await screen.findByText(/alpha \(grace\)/)).toBeInTheDocument();
  });

  it("drops an in-flight answer when the user loses the manage permission", async () => {
    let release: (rows: unknown) => void = () => {};
    mockApi.on(
      "get",
      "/extensions/status",
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { rerender } = render(<Layout user={adminUser} />);
    await waitFor(() => expect(mockApi.callsOf("get", "/extensions/status")).toHaveLength(1));

    rerender(<Layout user={viewerUser} />);
    await act(async () => {
      release(GRACE);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByText(/alpha \(grace\)/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Manage" })).not.toBeInTheDocument();
  });
});

describe("AppLayout — the bar follows the module flags and ROUTE_PERMISSIONS", () => {
  it("lists every core page for an admin with every module on, GRC as a plain link", async () => {
    const user = userEvent.setup();
    render(<Layout />);
    expect(navEntries()).toEqual(CORE_BAR);

    // TurboLens is not configured, so the Reports dropdown holds the core reports only.
    await user.click(screen.getByRole("button", { name: /reports/i }));
    await screen.findAllByRole("menuitem");
    expect(menuHrefs()).toEqual([...CORE_REPORTS, "/reports/saved"]);
  });

  it("promotes EA Delivery into PPM's slot, between BPM and Diagrams, when PPM is off", () => {
    hookState.ppm = { ppmEnabled: false, ppmLoaded: true };
    render(<Layout />);
    expect(navEntries()).toEqual([
      "/",
      "/inventory",
      REPORTS_BUTTON,
      "/bpm",
      "/reports/ea-delivery",
      "/diagrams",
      "/grc",
      "/todos",
    ]);
    const delivery = screen.getByRole("link", { name: /EA Delivery/ });
    expect(within(delivery).getByText("architecture")).toBeInTheDocument();
  });

  it("drops only GRC when GRC is off", () => {
    hookState.grc = { grcEnabled: false, grcLoaded: true };
    render(<Layout />);
    expect(navEntries()).toEqual(["/", "/inventory", REPORTS_BUTTON, "/bpm", "/ppm", "/diagrams", "/todos"]);
  });

  it("hides the Reports group from a role without its permission", () => {
    render(<Layout user={userWithPerms("inventory.view")} />);
    expect(navEntries()).toEqual(["/", "/inventory", "/todos"]);
  });

  it("hides a top-level extension page from a role without the permission it declares", () => {
    registerRoutes(extRoute("gated", "Gated Page", { permission: "ext.test-ext.view" }));
    render(<Layout user={viewerUser} />);
    expect(screen.queryByRole("link", { name: /Gated Page/ })).not.toBeInTheDocument();
  });

  it("rebuilds the bar when a module flag changes", () => {
    const { rerender } = render(<Layout />);
    expect(navEntries()).toContain("/bpm");
    hookState.bpm = { bpmEnabled: false, bpmLoaded: true };
    rerender(<Layout />);
    expect(navEntries()).not.toContain("/bpm");
  });

  it("appends TurboLens after Saved Reports, without turning other pages into dropdowns", async () => {
    hookState.turboLens = { ...hookState.turboLens, turboLensReady: true };
    const user = userEvent.setup();
    render(<Layout />);
    expect(navEntries()).toEqual(CORE_BAR);

    await user.click(screen.getByRole("button", { name: /reports/i }));
    await screen.findAllByRole("menuitem");
    expect(menuHrefs()).toEqual([...CORE_REPORTS, "/reports/saved", "/turbolens"]);
    const item = screen.getByRole("menuitem", { name: /TurboLens/ });
    expect(within(item).getByText("psychology")).toBeInTheDocument();
  });

  it("offers TurboLens to a non-admin role holding turbolens.view", async () => {
    hookState.turboLens = { ...hookState.turboLens, turboLensReady: true };
    const user = userEvent.setup();
    render(<Layout user={userWithPerms("reports.ea_dashboard", "turbolens.view")} />);

    await user.click(screen.getByRole("button", { name: /reports/i }));
    await screen.findAllByRole("menuitem");
    expect(menuHrefs()).toEqual([
      "/reports/capability-map",
      "/reports/lifecycle",
      "/reports/dependencies",
      "/reports/matrix",
      "/reports/data-quality",
      "/reports/eol",
      "/reports/saved",
      "/turbolens",
    ]);
  });
});

describe("AppLayout — extension routes in nav groups", () => {
  it("slots a reports-group route among the core reports, just before Saved Reports", async () => {
    registerRoutes(extRoute("quadrant", "Autonomy Report", { navGroup: "reports" }));
    const user = userEvent.setup();
    render(<Layout />);
    expect(navEntries()).toEqual(CORE_BAR);

    await user.click(screen.getByRole("button", { name: /reports/i }));
    await screen.findAllByRole("menuitem");
    expect(menuHrefs()).toEqual([...CORE_REPORTS, "/ext/test-ext/quadrant", "/reports/saved"]);
  });

  it("keeps the GRC page as the first entry once GRC becomes a dropdown", async () => {
    registerRoutes(
      extRoute("register", "Gov Register", { navGroup: "grc" }),
      extRoute("controls", "Gov Controls", { navGroup: "grc" }),
    );
    const user = userEvent.setup();
    render(<Layout />);
    expect(navEntries()).toEqual([
      "/",
      "/inventory",
      REPORTS_BUTTON,
      "/bpm",
      "/ppm",
      "/diagrams",
      "[policyGRCexpand_more]",
      "/todos",
    ]);

    await user.click(screen.getByRole("button", { name: /GRC/ }));
    await screen.findAllByRole("menuitem");
    expect(menuHrefs()).toEqual(["/grc", "/ext/test-ext/register", "/ext/test-ext/controls"]);
  });

  it("adds nothing to the bar for an extension that contributes no routes", () => {
    registerExtension("bare-ext", { key: "bare-ext", sdkVersion: UI_SDK_VERSION });
    render(<Layout />);
    expect(navEntries()).toEqual(CORE_BAR);
  });

  it("keeps routes outside the admin group out of the user menu's Admin section", async () => {
    registerRoutes(
      extRoute("page", "Legacy Page"),
      extRoute("quadrant", "Autonomy Report", { navGroup: "reports" }),
    );
    const user = userEvent.setup();
    render(<Layout />);
    await openUserMenu(user);
    expect(screen.getByRole("menuitem", { name: /Metamodel/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Legacy Page/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Autonomy Report/ })).not.toBeInTheDocument();
  });

  it("lists an admin-group route installed after the layout mounted", async () => {
    const user = userEvent.setup();
    render(<Layout />);
    act(() => {
      registerRoutes(extRoute("rules", "Rules Console", { navGroup: "admin" }));
    });
    await openUserMenu(user);
    expect(screen.getByRole("menuitem", { name: /Rules Console/ })).toHaveAttribute(
      "href",
      "/ext/test-ext/rules",
    );
  });
});

describe("AppLayout — denied deep link", () => {
  const DENIED = /You don't have access to that page/;

  it("leaves router state it does not own untouched", async () => {
    render(<Layout entries={[{ pathname: "/", state: { from: "elsewhere" } }]} />);
    await act(async () => {});
    expect(screen.getByTestId("location-state").textContent).toBe('{"from":"elsewhere"}');
    expect(screen.queryByText(DENIED)).not.toBeInTheDocument();
  });

  it("replaces the history entry, so going back cannot resurrect the message", async () => {
    const user = userEvent.setup();
    render(
      <Layout
        entries={["/inventory", { pathname: "/", state: { deniedPath: "/admin/users" } }]}
        index={1}
      />,
    );
    expect(await screen.findByText(DENIED)).toBeInTheDocument();
    expect(screen.getByTestId("location-state").textContent).toBe("null");

    await user.click(screen.getByText("probe-back"));
    expect(pathname()).toBe("/inventory");
  });

  it("announces a denied path handed over after the layout mounted", async () => {
    const user = userEvent.setup();
    render(<Layout entries={["/inventory"]} />);
    expect(screen.queryByText(DENIED)).not.toBeInTheDocument();

    await user.click(screen.getByText("probe-deny"));
    expect(await screen.findByText(DENIED)).toBeInTheDocument();
    expect(pathname()).toBe("/");
    expect(screen.getByTestId("location-state").textContent).toBe("null");
  });
});

describe("AppLayout — reference catalogues follow their route permissions", () => {
  it("hides the section from a role that can open none of them", async () => {
    const user = userEvent.setup();
    render(<Layout user={userWithPerms("reports.ea_dashboard")} />);
    await openUserMenu(user);
    expect(screen.queryByRole("menuitem", { name: /Reference Catalogues/ })).not.toBeInTheDocument();
  });

  it("shows the inventory catalogues to an inventory reader, without Principles", async () => {
    const user = userEvent.setup();
    render(<Layout user={userWithPerms("inventory.view")} />);
    await openUserMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /Reference Catalogues/ }));
    expect(await screen.findByRole("menuitem", { name: /Capability Catalogue/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Process Catalogue/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Value Stream Catalogue/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Principles Catalogue/ })).not.toBeInTheDocument();
  });

  it("shows Principles alone to a metamodel admin without inventory access", async () => {
    const user = userEvent.setup();
    render(<Layout user={userWithPerms("admin.metamodel")} />);
    await openUserMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /Reference Catalogues/ }));
    expect(await screen.findByRole("menuitem", { name: /Principles Catalogue/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Capability Catalogue/ })).not.toBeInTheDocument();
  });

  it("re-evaluates the section when the user changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Layout />);
    rerender(<Layout user={userWithPerms("reports.ea_dashboard")} />);
    await openUserMenu(user);
    expect(screen.queryByRole("menuitem", { name: /Reference Catalogues/ })).not.toBeInTheDocument();
  });

  it("starts collapsed when localStorage is unavailable", async () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    try {
      render(<Layout />);
    } finally {
      spy.mockRestore();
    }
    const user = userEvent.setup();
    await openUserMenu(user);
    expect(screen.getByRole("menuitem", { name: /Reference Catalogues/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});

describe("AppLayout — stopping an impersonation", () => {
  const impersonating: LayoutUser = { ...adminUser, impersonated_role: "viewer" };

  it("disables Stop while the request is in flight", async () => {
    let release: (v: { access_token: string }) => void = () => {};
    mockApi.auth.stopImpersonating.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<Layout user={impersonating} />);

    const stop = screen.getByRole("button", { name: "Stop" });
    await user.click(stop);
    expect(stop).toBeDisabled();
    await act(async () => {
      release({ access_token: "tok" });
    });
    await waitFor(() => expect(stop).toBeEnabled());
    expect(refreshUser).toHaveBeenCalledTimes(1);
  });

  it("marks the session signed in with the new token before refreshing", async () => {
    setAuthenticated(false);
    mockApi.auth.stopImpersonating.mockResolvedValue({ access_token: "tok" });
    const user = userEvent.setup();
    render(<Layout user={impersonating} />);
    await user.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(refreshUser).toHaveBeenCalled());
    expect(isAuthenticated()).toBe(true);
  });

  it("refreshes through the current auth context, not the one it mounted with", async () => {
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    mockApi.auth.stopImpersonating.mockResolvedValue({ access_token: "tok" });
    const user = userEvent.setup();
    const { rerender } = render(<Layout user={impersonating} refresh={first} />);
    rerender(<Layout user={impersonating} refresh={second} />);

    await user.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(second).toHaveBeenCalledTimes(1));
    expect(first).not.toHaveBeenCalled();
  });
});

describe("AppLayout — initial UI state", () => {
  it("mounts with the notification preferences closed", () => {
    render(<Layout />);
    expect(screen.queryByTestId("notif-dialog")).not.toBeInTheDocument();
  });

  it("opens the drawer with its Admin section collapsed", async () => {
    setViewportWidth(500);
    const user = userEvent.setup();
    render(<Layout />);
    await user.click(screen.getByRole("button", { name: /^menu$/ }));
    const drawer = await screen.findByRole("presentation");
    const admin = within(drawer).getByText("Admin").closest('[role="button"]') as HTMLElement;
    expect(admin).toHaveTextContent("expand_more");
    expect(admin).not.toHaveTextContent("expand_less");

    await user.click(admin);
    expect(admin).toHaveTextContent("expand_less");
  });
});

describe("AppLayout — language switch", () => {
  it("switches the UI language and closes the language menu", async () => {
    mockApi.on("patch", /^\/users\//, {});
    const spy = vi.spyOn(i18n, "changeLanguage").mockImplementation(async () => i18n.t);
    try {
      const user = userEvent.setup();
      render(<Layout />);
      await openUserMenu(user);
      await user.click(screen.getByRole("menuitem", { name: /Language/ }));
      await user.click(await screen.findByRole("menuitem", { name: "Deutsch" }));

      expect(spy).toHaveBeenCalledWith("de");
      await waitFor(() =>
        expect(screen.queryByRole("menuitem", { name: "Deutsch" })).not.toBeInTheDocument(),
      );
      await waitFor(() => expect(mockApi.callsOf("patch")).toHaveLength(1));
      expect(mockApi.callsOf("patch")[0]).toMatchObject({ path: "/users/u1", body: { locale: "de" } });
    } finally {
      spy.mockRestore();
    }
  });

  it("persists the pick on the current user's profile after the user changes", async () => {
    mockApi.on("patch", /^\/users\//, {});
    const user = userEvent.setup();
    const { rerender } = render(<Layout />);
    rerender(<Layout user={{ ...adminUser, id: "u9" }} />);
    await openUserMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /Language/ }));
    await user.click(await screen.findByRole("menuitem", { name: "English" }));
    await waitFor(() => expect(mockApi.callsOf("patch")).toHaveLength(1));
    expect(mockApi.callsOf("patch")[0].path).toBe("/users/u9");
  });
});

describe("AppLayout — badge counts", () => {
  it("refreshes after each event that can move a count, and after no other", async () => {
    render(<Layout />);
    await waitFor(() => expect(badgeCalls()).toBeGreaterThan(0));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    for (const evt of [
      "notification.created",
      "todo.created",
      "todo.updated",
      "todo.deleted",
      "survey.sent",
      "survey.responded",
    ]) {
      const before = badgeCalls();
      act(() => emitEvent({ event: evt }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(badgeCalls(), evt).toBe(before + 1);
    }

    const before = badgeCalls();
    act(() => {
      emitEvent({ event: "card.updated" });
      emitEvent({ event: "notification.read" });
      emitEvent({});
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(badgeCalls()).toBe(before);
  });

  it("re-reads the counts on every navigation", async () => {
    const user = userEvent.setup();
    render(<Layout />);
    await waitFor(() => expect(badgeCalls()).toBeGreaterThan(0));
    const before = badgeCalls();

    await user.click(screen.getByRole("link", { name: /Inventory/ }));
    expect(pathname()).toBe("/inventory");
    await waitFor(() => expect(badgeCalls()).toBe(before + 1));

    await user.click(screen.getByRole("link", { name: /Diagrams/ }));
    await waitFor(() => expect(badgeCalls()).toBe(before + 2));
  });
});
