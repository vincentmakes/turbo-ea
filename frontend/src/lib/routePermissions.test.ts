import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ADMIN_ITEM_DEFS, NAV_ITEM_DEFS } from "@/layouts/navItems";
import { itSourceScan } from "@/test/sourceScan";

import {
  INTENTIONALLY_UNGATED,
  ROUTE_PERMISSIONS,
  canAccessPath,
  permissionForPath,
} from "./routePermissions";

/**
 * A `<Route>`'s `path`, wherever it sits among the tag's attributes and on
 * whichever line — `<Route path="/x"`, `<Route\n  path="/x"`, or
 * `<Route index\n  path="/x"`. `[^>]` keeps a match inside one tag; a `path`
 * written after an `element={<X />}` is still missed, so keep `path` first.
 */
const ROUTE_PATH = /<Route\s[^>]*?\bpath="([^"]+)"/g;

/**
 * Mirrors the app-level keys in `backend/app/core/permissions.py`. Hand-kept,
 * exactly like the pinned locale list in `i18n.test.ts` — a typo in the table
 * would otherwise be silently fail-closed and lock everyone out of a page.
 */
const KNOWN_PERMISSIONS = new Set([
  "admin.dashboards",
  "admin.events",
  "admin.export_workspace",
  "admin.impersonate",
  "admin.import_workspace",
  "admin.manage_extensions",
  "admin.mcp",
  "admin.metamodel",
  "admin.migrate",
  "admin.roles",
  "admin.settings",
  "admin.todos",
  "admin.users",
  "adr.delete",
  "adr.manage",
  "adr.sign",
  "adr.view",
  "ai.suggest",
  "archimatediagrams.application.manage",
  "archimatediagrams.application.publish",
  "archimatediagrams.application.view",
  "archimatediagrams.business.manage",
  "archimatediagrams.business.publish",
  "archimatediagrams.business.view",
  "archimatediagrams.technology.manage",
  "archimatediagrams.technology.publish",
  "archimatediagrams.technology.view",
  "bpm.approve_flows",
  "bpm.assessments",
  "bpm.edit",
  "bpm.manage_drafts",
  "bpm.value_chain",
  "bpm.view",
  "bpm.withdraw_flows",
  "boRelationship.view",
  "bookmarks.manage",
  "comments.create",
  "comments.manage",
  "compliance.manage",
  "compliance.view",
  "costs.view",
  "diagrams.manage",
  "diagrams.publish",
  "diagrams.view",
  "documents.manage",
  "documents.view",
  "eol.manage",
  "eol.view",
  "grc.manage",
  "grc.view",
  "inventory.approval_status",
  "inventory.archive",
  "inventory.bulk_edit",
  "inventory.create",
  "inventory.delete",
  "inventory.edit",
  "inventory.export",
  "inventory.quality_seal",
  "inventory.view",
  "licenses.edit",
  "licenses.view",
  "notifications.manage",
  "ppm.manage",
  "ppm.view",
  "relations.manage",
  "reports.bpm_dashboard",
  "reports.ea_dashboard",
  "reports.portfolio",
  "reports.ppm_dashboard",
  "risks.manage",
  "risks.view",
  "saved_reports.create",
  "servicenow.manage",
  "servicenow.view",
  "soaw.manage",
  "soaw.sign",
  "soaw.view",
  "stakeholders.manage",
  "surveys.manage",
  "surveys.respond",
  "tags.manage",
  "turbolens.manage",
  "turbolens.view",
  "users.view",
  "web_portals.manage",
  "web_portals.view",
]);

describe("permissionForPath", () => {
  it("is undefined for a path the table does not gate", () => {
    expect(permissionForPath("/todos")).toBeUndefined();
    expect(permissionForPath("/no/such/page")).toBeUndefined();
  });

  it("resolves a concrete path", () => {
    expect(permissionForPath("/ppm")).toBe("ppm.view");
    expect(permissionForPath("/ppm/abc-123")).toBe("ppm.view");
  });

  it("prefers the more specific pattern", () => {
    expect(permissionForPath("/diagrams/abc")).toBe("diagrams.view");
    expect(permissionForPath("/diagrams/abc/edit")).toBe("diagrams.manage");
    expect(permissionForPath("/admin/surveys/abc")).toBe("surveys.manage");
    expect(permissionForPath("/admin/surveys/abc/results")).toBe("surveys.manage");
    expect(permissionForPath("/ea-delivery/soaw/abc")).toBe("soaw.view");
    expect(permissionForPath("/ea-delivery/soaw/new")).toBe("soaw.manage");
  });

  it("returns undefined for an ungated path", () => {
    expect(permissionForPath("/")).toBeUndefined();
    expect(permissionForPath("/todos")).toBeUndefined();
    expect(permissionForPath("/ext/acme/board")).toBeUndefined();
    expect(permissionForPath("/nonsense")).toBeUndefined();
  });
});

describe("canAccessPath", () => {
  it("denies direct BO Relationship access without view permission", () => {
    const path = "/application-architecture/bo-relationship";
    expect(canAccessPath({}, path)).toBe(false);
    expect(canAccessPath({ "boRelationship.edit": true }, path)).toBe(false);
    expect(canAccessPath({ "boRelationship.view": true }, path)).toBe(true);
  });
  it("is fail-closed on missing permissions", () => {
    expect(canAccessPath(undefined, "/ppm")).toBe(false);
    expect(canAccessPath({}, "/ppm")).toBe(false);
  });

  it("still allows ungated paths without any permissions", () => {
    expect(canAccessPath(undefined, "/")).toBe(true);
    expect(canAccessPath({}, "/todos")).toBe(true);
  });

  it("honours the admin wildcard", () => {
    expect(canAccessPath({ "*": true }, "/admin/users")).toBe(true);
    expect(canAccessPath({ "*": true }, "/principles-catalogue")).toBe(true);
  });

  it("grants exactly what the user holds", () => {
    expect(canAccessPath({ "ppm.view": true }, "/ppm")).toBe(true);
    expect(canAccessPath({ "ppm.view": true }, "/bpm")).toBe(false);
  });

  it("keeps the ArchiMate sandbox out of the navigation (it is opened from Settings)", () => {
    const entries = [...NAV_ITEM_DEFS, ...ADMIN_ITEM_DEFS].flatMap((def) => [def, ...(def.children ?? [])]);
    const named = entries.filter((e) =>
      [e.labelKey, e.icon, "path" in e ? e.path : undefined].some((v) => v?.toLowerCase().includes("archimate")),
    );
    expect(named).toEqual([]);
    expect(entries.map((e) => ("path" in e ? e.path : undefined))).toContain("/admin/settings"); // the list really was read
  });

  // The menu is built from those defs; nothing in AppLayout links to the sandbox either.
  // (AppLayout does read the ArchiMate module flag, to hide the scoped diagram
  // entries when the module is off — so this checks the sandbox paths, not the word.)
  itSourceScan("does not mention the ArchiMate sandbox in AppLayout", () => {
    const layout = fs.readFileSync(path.resolve(__dirname, "../layouts/AppLayout.tsx"), "utf-8");
    expect(layout).not.toMatch(/architectureStudio|\/admin\/archimate/i);
  });

  it("opens the ArchiMate studio list for admin.settings or any layer's ArchiMate key", () => {
    for (const p of ["/admin/architectureStudio", "/admin/archimate"]) {
      expect(canAccessPath({ "admin.settings": true }, p)).toBe(true);
      // The editor's Back button lands here: a per-layer user must not dead-end.
      expect(canAccessPath({ "archimatediagrams.business.manage": true }, p)).toBe(true);
      expect(canAccessPath({ "archimatediagrams.technology.view": true }, p)).toBe(true);
      expect(canAccessPath({ "admin.users": true, "diagrams.manage": true }, p)).toBe(false);
      expect(canAccessPath({ "*": true }, p)).toBe(true);
    }
  });

  it("opens the ArchiMate editor with manage on any layer, never with diagrams.* or admin.settings", () => {
    for (const p of ["/admin/architectureStudio/abc", "/admin/archimate/abc"]) {
      for (const layer of ["business", "application", "technology"]) {
        expect(canAccessPath({ [`archimatediagrams.${layer}.manage`]: true }, p)).toBe(true);
        expect(canAccessPath({ [`archimatediagrams.${layer}.view`]: true }, p)).toBe(false);
      }
      expect(canAccessPath({ "diagrams.manage": true, "admin.settings": true }, p)).toBe(false);
      expect(canAccessPath({}, p)).toBe(false);
      expect(canAccessPath({ "*": true }, p)).toBe(true);
    }
  });

  it("gates each scoped ArchiMate diagram page on its own layer's view or manage key", () => {
    const routes = {
      business: "/business-architecture/diagram",
      application: "/application-architecture/diagram",
      technology: "/technology-architecture/diagram",
    };
    for (const [layer, p] of Object.entries(routes)) {
      expect(permissionForPath(p)).toEqual([
        `archimatediagrams.${layer}.view`,
        `archimatediagrams.${layer}.manage`,
      ]);
      expect(canAccessPath({ [`archimatediagrams.${layer}.view`]: true }, p)).toBe(true);
      expect(canAccessPath({ [`archimatediagrams.${layer}.manage`]: true }, p)).toBe(true);
      expect(canAccessPath({ "diagrams.manage": true }, p)).toBe(false);
      for (const other of Object.keys(routes).filter((l) => l !== layer)) {
        expect(canAccessPath({ [`archimatediagrams.${other}.manage`]: true }, p)).toBe(false);
      }
    }
  });

  it("gates the value chain pages on bpm.value_chain, independent of bpm.view", () => {
    for (const p of ["/value-chain", "/value-chain/value-stream"]) {
      expect(canAccessPath({ "bpm.value_chain": true }, p)).toBe(true);
      expect(canAccessPath({ "bpm.view": true }, p)).toBe(false);
      expect(canAccessPath({}, p)).toBe(false);
      expect(canAccessPath({ "*": true }, p)).toBe(true);
    }
  });

  // Issue #1400: EA Delivery lists SoAWs and decisions, so a reader of either
  // opens it; each document page keeps its own permission.
  it.each(["/ea-delivery", "/reports/ea-delivery"])(
    "opens %s for a reader of SoAWs or of decisions, and for no one else",
    (path) => {
      expect(permissionForPath(path)).toEqual(["soaw.view", "adr.view"]);
      expect(canAccessPath({ "adr.view": true, "adr.comment": true }, path)).toBe(true);
      expect(canAccessPath({ "soaw.view": true }, path)).toBe(true);
      expect(canAccessPath({ "ppm.view": true, "inventory.view": true }, path)).toBe(false);
      expect(canAccessPath({ "soaw.view": false, "adr.view": false }, path)).toBe(false);
    },
  );

  it("keeps a SoAW behind soaw.view and a decision behind adr.view", () => {
    expect(canAccessPath({ "adr.view": true }, "/ea-delivery/soaw/abc")).toBe(false);
    expect(canAccessPath({ "soaw.view": true }, "/ea-delivery/adr/abc")).toBe(false);
    expect(canAccessPath({ "adr.view": true }, "/ea-delivery/adr/abc")).toBe(true);
  });
});

describe("ROUTE_PATH", () => {
  it("finds a path on the tag's line, on a later line, or after another attribute", () => {
    const src = [
      '<Route path="/a" element={<A />} />',
      "<Route",
      '  path="/b"',
      "  element={<B />}",
      "/>",
      '<Route caseSensitive\n  path="/c" element={<C />} />',
      '<Route index element={<D />} />',
      '<RouteGuard path="/e" />',
    ].join("\n");
    expect([...src.matchAll(ROUTE_PATH)].map((m) => m[1])).toEqual(["/a", "/b", "/c"]);
  });
});

describe("parity", () => {
  /**
   * Every route declared in the authenticated table has to be either gated or
   * explicitly listed as ungated. A new route added without a decision fails
   * here rather than shipping silently open.
   */
  itSourceScan("covers every route in App.tsx", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../App.tsx"),
      "utf-8",
    );
    // The authenticated table is the second <Routes> block — everything after
    // the AppLayout wrapper opens.
    const start = source.indexOf("<AppLayout");
    expect(start).toBeGreaterThan(-1);
    const declared = [
      ...source.slice(start).matchAll(ROUTE_PATH),
    ].map((m) => m[1]);

    expect(declared.length).toBeGreaterThan(40);

    const known = new Set([
      ...ROUTE_PERMISSIONS.map((r) => r.path),
      ...INTENTIONALLY_UNGATED,
    ]);
    const unreviewed = declared.filter((p) => !known.has(p));
    expect(unreviewed).toEqual([]);
  });

  itSourceScan("has no stale entries pointing at routes that no longer exist", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../App.tsx"),
      "utf-8",
    );
    const declared = new Set(
      [...source.matchAll(ROUTE_PATH)].map((m) => m[1]),
    );
    const stale = ROUTE_PERMISSIONS.map((r) => r.path).filter(
      (p) => !declared.has(p),
    );
    expect(stale).toEqual([]);
  });

  it("resolves a permission for every nav item that points at a route", () => {
    const withPath = [...NAV_ITEM_DEFS, ...ADMIN_ITEM_DEFS].flatMap((def) => [
      ...(def.path ? [def.path] : []),
      ...(def.children ?? []).map((c) => c.path),
    ]);
    const ungated = new Set(INTENTIONALLY_UNGATED);
    for (const p of withPath) {
      if (ungated.has(p)) continue;
      expect(
        permissionForPath(p),
        `nav item ${p} has no entry in ROUTE_PERMISSIONS`,
      ).toBeDefined();
    }
  });

  it("only names permissions the backend actually defines", () => {
    for (const { path: routePath, permission } of ROUTE_PERMISSIONS) {
      const keys = Array.isArray(permission) ? permission : [permission];
      for (const key of keys) {
        expect(
          KNOWN_PERMISSIONS.has(key),
          `${routePath} names unknown permission "${key}"`,
        ).toBe(true);
      }
    }
  });
});
