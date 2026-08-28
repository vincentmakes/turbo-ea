import { useLocation } from "react-router";

import RequirePermission from "@/components/RequirePermission";
import { permissionForPath } from "@/lib/routePermissions";

/**
 * Applies each route's permission to the whole authenticated route table, so
 * typing a URL is gated exactly like clicking the nav item that leads to it.
 *
 * Wrapping the table once — rather than every `<Route>` element individually —
 * is what stops the gating drifting: a route added without a table entry is
 * simply ungated, and the parity test in `lib/routePermissions.test.ts` fails
 * until somebody decides which it should be.
 *
 * `ModuleGate` deliberately stays *inside* the route elements, so permission is
 * checked first and the module flag second: "you may not see this at all"
 * outranks "this is switched off".
 */
export default function RouteGuard({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const permission = permissionForPath(pathname);
  if (!permission) return <>{children}</>;
  return <RequirePermission permission={permission}>{children}</RequirePermission>;
}
