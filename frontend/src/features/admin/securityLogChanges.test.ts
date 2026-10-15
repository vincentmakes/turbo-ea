/**
 * Contract test: every semantic change item the backend writes into the
 * Security & admin log has a sentence template in every shipped locale, so the
 * drawer never falls back to its generic "Kind: arg = value" line.
 *
 * The catalogue is read off the backend source rather than hard-coded:
 * `AUDIT_ITEM_KINDS` in `backend/app/services/audit_changes.py` is the closed
 * vocabulary (`audit_changes.item()` refuses anything else), and every kind
 * literal a writer passes — `item("…")`, `kind="…"`, `"kind": "…"` — in that
 * module and in `backend/app/api/v1/*.py` must belong to it. A new kind
 * therefore cannot ship without its template.
 */
import fs from "node:fs";
import path from "node:path";

import { expect } from "vitest";

import i18n, { SUPPORTED_LOCALES } from "@/i18n";
import en from "@/i18n/locales/en/admin.json";
import { describeSourceScan, itSourceScan } from "@/test/sourceScan";
import { changeKindKey } from "./securityLogDetails";

const BACKEND = path.resolve(__dirname, "../../../../backend/app");
const CHANGES_FILE = path.join(BACKEND, "services/audit_changes.py");
const API_DIR = path.join(BACKEND, "api/v1");

const KIND_RE = /^(?:[a-z_]+\.[a-z_]+|more)$/;
const LITERAL_KIND_RE = /(?:\bitem\(\s*|\bkind\s*=\s*|["']kind["']\s*:\s*)(["'])([^"'\n]+)\1/g;

/** The `AUDIT_ITEM_KINDS` frozenset, read as text. */
function declaredKinds(): string[] {
  const text = fs.readFileSync(CHANGES_FILE, "utf-8");
  // The assignment at the start of a line, not a mention in the docstring.
  const start = text.search(/^AUDIT_ITEM_KINDS\b/m);
  expect(start, "AUDIT_ITEM_KINDS is declared").toBeGreaterThan(-1);
  const body = text.slice(start, text.indexOf("\n)", start));
  return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
}

/** Every kind literal a writer passes. */
function writtenKinds(): string[] {
  const files = [
    CHANGES_FILE,
    ...fs
      .readdirSync(API_DIR)
      .filter((f) => f.endsWith(".py"))
      .map((f) => path.join(API_DIR, f)),
  ];
  const found = new Set<string>();
  for (const file of files) {
    for (const m of fs.readFileSync(file, "utf-8").matchAll(LITERAL_KIND_RE)) {
      if (KIND_RE.test(m[2])) found.add(m[2]);
    }
  }
  return [...found].sort();
}

/** The keys a kind's template lives under (`more` is plural). */
function templateKeys(kind: string): string[] {
  const key = changeKindKey(kind);
  return kind === "more" ? [`${key}_one`, `${key}_other`] : [key];
}

describeSourceScan("change item templates", () => {
  itSourceScan("reads the vocabulary and the writers off the backend", () => {
    const kinds = declaredKinds();
    expect(kinds.length).toBeGreaterThanOrEqual(47);
    expect(kinds).toContain("field.added");
    expect(kinds).toContain("type_permission.changed");
    expect(kinds).toContain("more");
    for (const kind of kinds) expect(kind, kind).toMatch(KIND_RE);
    const written = writtenKinds();
    // Sanity: one kind passed by the pure builders, one by a route module.
    expect(written).toContain("option.added");
    expect(written).toContain("user.deleted");
  });

  itSourceScan("every kind a writer passes is in the vocabulary", () => {
    const declared = new Set(declaredKinds());
    for (const kind of writtenKinds()) expect(declared.has(kind), kind).toBe(true);
  });

  itSourceScan("has a template for every kind in every shipped locale", () => {
    expect(SUPPORTED_LOCALES.length).toBe(10);
    const kinds = declaredKinds();
    for (const locale of SUPPORTED_LOCALES) {
      const bundle = i18n.getResourceBundle(locale, "admin") as Record<string, string>;
      for (const kind of kinds) {
        for (const key of templateKeys(kind)) {
          const tpl = bundle[key];
          expect(typeof tpl === "string" && tpl.trim().length > 0, `${locale}: ${key}`).toBe(true);
        }
      }
    }
  });

  itSourceScan("the overflow line is pluralised on its count", () => {
    const labels = en as Record<string, string>;
    expect(labels["securityLog.changes.more_one"]).toContain("{{count}}");
    expect(labels["securityLog.changes.more_other"]).toContain("{{count}}");
  });
});

describeSourceScan("security log label catalogues", () => {
  itSourceScan("every field, value, target type and setting label exists in every locale", () => {
    const labels = en as Record<string, string>;
    for (const prefix of ["fields", "values", "targetTypes", "settings"]) {
      const keys = Object.keys(labels).filter((k) => k.startsWith(`securityLog.${prefix}.`));
      expect(keys.length, prefix).toBeGreaterThan(0);
      for (const locale of SUPPORTED_LOCALES) {
        const bundle = i18n.getResourceBundle(locale, "admin") as Record<string, string>;
        const present = keys.filter((k) => typeof bundle[k] === "string" && bundle[k].trim());
        expect(present.length, `${locale}: ${prefix}`).toBe(keys.length);
      }
    }
  });
});
