/**
 * Render a page or component the way the app mounts it: inside a router and
 * an authenticated user, optionally under the real theme.
 *
 * ```ts
 * const { user } = renderWithProviders(<RiskDetailPage />, {
 *   route: "/grc/risks/r1",
 *   routes: [{ path: "/grc/risks/:id" }],
 *   user: userWith("risks.view", "risks.manage"),
 * });
 * await user.click(screen.getByRole("button", { name: /save/i }));
 * ```
 *
 * `routes` wraps `ui` in `<Routes>` so `useParams` resolves; an entry without
 * `element` renders `ui`. The theme is off by default — MUI's default theme
 * renders every component, and `buildTheme` only matters to tests about the
 * theme itself (`staticLabels.test.tsx`).
 */
import type { ReactElement } from "react";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";
import { MemoryRouter, Route, Routes } from "react-router";

import { AuthProvider } from "@/hooks/AuthContext";
import { buildTheme } from "@/theme";
import type { User } from "@/types";

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "00000000-0000-4000-8000-00000000a001",
    email: "admin@test.local",
    display_name: "Test Admin",
    role: "admin",
    is_active: true,
    permissions: { "*": true },
    ...overrides,
  };
}

/** The wildcard admin. */
export function adminUser(): User {
  return makeUser();
}

/** A member holding exactly the given app-level permissions. */
export function userWith(...permissions: string[]): User {
  return makeUser({
    id: "00000000-0000-4000-8000-00000000b002",
    email: "member@test.local",
    display_name: "Test Member",
    role: "member",
    permissions: Object.fromEntries(permissions.map((p) => [p, true])),
  });
}

export interface RouteEntry {
  path: string;
  element?: ReactElement;
}

export interface ProvidersOptions {
  /** The URL the router starts at. */
  route?: string;
  /** Route table; `ui` is the element of any entry without one. */
  routes?: RouteEntry[];
  /** The signed-in user; `null` renders signed out. */
  user?: User | null;
  refreshUser?: () => Promise<void>;
  /** Wrap in the real `buildTheme("light")`. */
  theme?: boolean;
}

export function wrapWithProviders(ui: ReactElement, opts: ProvidersOptions = {}): ReactElement {
  const { route = "/", routes, user = adminUser(), refreshUser = async () => {}, theme } = opts;
  const body = routes ? (
    <Routes>
      {routes.map((r) => (
        <Route key={r.path} path={r.path} element={r.element ?? ui} />
      ))}
    </Routes>
  ) : (
    ui
  );
  const withAuth = (
    <AuthProvider user={user} refreshUser={refreshUser}>
      {body}
    </AuthProvider>
  );
  return (
    <MemoryRouter initialEntries={[route]}>
      {theme ? <ThemeProvider theme={buildTheme("light")}>{withAuth}</ThemeProvider> : withAuth}
    </MemoryRouter>
  );
}

export type RenderWithProvidersResult = RenderResult & {
  /** A `userEvent` session created before rendering. */
  user: ReturnType<typeof userEvent.setup>;
};

export function renderWithProviders(
  ui: ReactElement,
  opts: ProvidersOptions & { renderOptions?: Omit<RenderOptions, "wrapper"> } = {},
): RenderWithProvidersResult {
  const { renderOptions, ...providers } = opts;
  const user = userEvent.setup();
  const result = render(wrapWithProviders(ui, providers), renderOptions);
  return { ...result, user };
}
