/**
 * Contract test: every administrative action and data export the backend
 * records in the Security & admin log has a label, in English and in every
 * shipped locale.
 *
 * The catalogue is read off the backend source rather than hard-coded, so a new
 * `audit_log.record(action=...)` cannot ship without its label: every string
 * literal shaped like an action (`auth.*` / `admin.*` / `access.*`) is
 * collected from `backend/app/api/v1/*.py` on a line that names an `action`
 * (`action="…"`, `action: str = "…"`, `action="…" if … else "…"`) or that
 * defines a module-level constant (`_LOGIN_FAILED = "auth.login.failed"`).
 * Actions the source builds at run time cannot be read that way and are listed
 * in `DYNAMIC_ACTIONS`, each pinned to the template that builds it. An action
 * missing a label would render as its raw dotted key.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import i18n, { SUPPORTED_LOCALES } from "@/i18n";
import en from "@/i18n/locales/en/admin.json";
import { describeSourceScan, itSourceScan } from "@/test/sourceScan";
import { actionLabelKey } from "./SecurityLogTypes";

const API_DIR = path.resolve(__dirname, "../../../../backend/app/api/v1");

const ACTION_RE = /^(auth|admin|access)\.[a-z0-9_.]+$/;
const LITERAL_RE = /(["'])((?:auth|admin|access)\.[a-z0-9_.]+)\1/g;
/** A line that names an action: a keyword argument / parameter, or a constant. */
const ACTION_LINE_RE = /\baction\s*[=:]|^_?[A-Z][A-Z0-9_]*\s*=\s*["']/;
/** A constant holding a permission key (`MANAGE_PERMISSION = "admin.dashboards"`) is not an action. */
const PERMISSION_CONSTANT_RE = /^_?[A-Z][A-Z0-9_]*PERMISSION\s*=/;

/**
 * Actions built at run time (an f-string a scan cannot read), with the source
 * file and the template that builds them — the template is asserted present so
 * this list cannot outlive the code.
 */
const DYNAMIC_ACTIONS: { file: string; template: string; helper: string; actions: string[] }[] = [
  {
    file: "stakeholder_roles.py",
    template: 'action=f"admin.stakeholder_role.{action}"',
    helper: "_audit_srd",
    actions: ["created", "updated", "deleted", "archived", "restored"].map(
      (s) => `admin.stakeholder_role.${s}`,
    ),
  },
  {
    file: "dashboards.py",
    template: 'action=f"admin.dashboard.{action}"',
    helper: "_audit",
    actions: ["created", "updated", "deleted", "duplicated", "reset"].map((s) => `admin.dashboard.${s}`),
  },
];

function sourceFiles(): string[] {
  return fs
    .readdirSync(API_DIR)
    .filter((f) => f.endsWith(".py"))
    .sort();
}

/** Every action literal the backend's route modules record. */
function backendActions(): string[] {
  const found = new Set<string>();
  for (const file of sourceFiles()) {
    const text = fs.readFileSync(path.join(API_DIR, file), "utf-8");
    for (const line of text.split("\n")) {
      if (!ACTION_LINE_RE.test(line.trim()) || PERMISSION_CONSTANT_RE.test(line.trim())) continue;
      for (const match of line.matchAll(LITERAL_RE)) {
        if (ACTION_RE.test(match[2])) found.add(match[2]);
      }
    }
  }
  for (const dyn of DYNAMIC_ACTIONS) dyn.actions.forEach((a) => found.add(a));
  return [...found].sort();
}

describeSourceScan("administrative action labels", () => {
  itSourceScan("finds the actions in the backend source", () => {
    const actions = backendActions();
    expect(actions.length).toBeGreaterThan(50);
    // Sanity: one action recorded through a module-level constant, one through
    // a literal keyword argument, one through a parameter default.
    expect(actions).toContain("auth.login.failed");
    expect(actions).toContain("admin.user.updated");
    expect(actions).toContain("admin.settings.updated");
    // Both arms of a conditional action.
    expect(actions).toContain("admin.extension.enabled");
    expect(actions).toContain("admin.extension.disabled");
    // Data exports recorded through a helper's parameter default or constant.
    expect(actions).toContain("access.export.cards");
    expect(actions).toContain("access.export.workspace");
    expect(actions).toContain("access.export.migration");
    // Permission keys share the prefix but are never actions.
    expect(actions).not.toContain("admin.users");
    expect(actions).not.toContain("admin.metamodel");
  });

  itSourceScan("pins every run-time action to the template that builds it", () => {
    for (const dyn of DYNAMIC_ACTIONS) {
      const text = fs.readFileSync(path.join(API_DIR, dyn.file), "utf-8");
      expect(text, dyn.file).toContain(dyn.template);
      for (const action of dyn.actions) {
        const verb = action.split(".").pop() as string;
        expect(text, action).toMatch(new RegExp(`${dyn.helper}\\(\\s*db,\\s*user,\\s*"${verb}"`));
      }
    }
  });

  itSourceScan("has a non-empty English label for every action", () => {
    const labels = en as Record<string, string>;
    for (const action of backendActions()) {
      const label = labels[actionLabelKey(action)];
      expect(typeof label === "string" && label.trim().length > 0, action).toBe(true);
      expect(label, action).not.toBe(action);
    }
  });

  itSourceScan("has a label for every action in every shipped locale", () => {
    const actions = backendActions();
    expect(SUPPORTED_LOCALES.length).toBe(10);
    for (const locale of SUPPORTED_LOCALES) {
      const bundle = i18n.getResourceBundle(locale, "admin") as Record<string, string>;
      for (const action of actions) {
        const label = bundle[actionLabelKey(action)];
        expect(typeof label === "string" && label.trim().length > 0, `${locale}: ${action}`).toBe(
          true,
        );
      }
    }
  });
});

describe("Users page lockout labels", () => {
  it("labels the lockout controls", () => {
    for (const key of ["locked", "lockedUntil", "unlock", "unlockSuccess", "unlockFailed"]) {
      expect(i18n.exists(`admin:users.${key}`), key).toBe(true);
    }
    expect(i18n.t("admin:users.lockedUntil", { time: "T", lng: "en" })).toBe("Locked until T");
  });
});
