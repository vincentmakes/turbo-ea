/**
 * Unused translation keys ratchet down to zero — the reverse of
 * `translationKeys.test.ts` (every key the code asks for exists): every key
 * English defines must be asked for by the code.
 *
 * A key nobody reads still costs a translation in ten locale files and a row in
 * every `/translate` pass, and a dead key is how a renamed string keeps its
 * stale twin alive. Several hundred predated this guard, so it starts in REPORT
 * mode: the sorted list of unused English leaf keys must equal
 * `UNUSED_KEY_BASELINE` EXACTLY (the `theme/rawColours.sourceScan.test.ts`
 * ratchet):
 *
 *   - an unused key missing from the baseline fails, named — a new string is
 *     read by the code that adds it, or it is not added;
 *   - a baseline entry that is read again, or no longer exists, fails too,
 *     asking for the entry to be deleted — so the list can only shrink.
 *
 * Purging the baseline is a follow-up PR. Deleting a key means deleting it from
 * all 10 locale files (`src/i18n/locales/<locale>/<ns>.json`), or the parity
 * checks in `i18n.test.ts` fail on the other nine.
 *
 * What counts as a reference (`collectReferences`). Every rule errs towards
 * "used", so the guard never asks for a live key to be deleted:
 *   - the first argument of a bound `t` — `useTranslation("ns")`, an alias such
 *     as `t: tCards`, a `TFunction` parameter, an `i18n.t` wrapper; the bindings
 *     `translationKeys.test.ts` resolves, shared in `@/test/i18nKeys` — and of
 *     `i18n.t(…)`, with a `ns:` prefix or an `{ ns }` option winning;
 *     `<Trans i18nKey="…" ns="…">` likewise;
 *   - a template key matches every key of its shape: `t(`status.${s}`)` reads
 *     `status.*`, `t(`cards:${family}.industryValueAll`)` reads
 *     `cards:*.industryValueAll`;
 *   - any other string literal that names a key: a dotted one in any namespace
 *     (`labelKey: "nav.reports"`, consumed by another file's `t`), a bare word
 *     only in a namespace its own file binds, `"ns:key"` in its namespace;
 *   - any other template literal with a dotted or underscored static part, in
 *     any namespace (`securityLog.actionLabels.${action}`,
 *     `compliance_phase_${phase}`), and a literal ending in `.` / `_` that
 *     starts some key (a prefix handed to a helper: `valueLabel("x_", v)`);
 *   - `DYNAMIC_PREFIXES`, for families whose keys no source literal spells.
 * A referenced key also covers its plural forms (`_one`, `_other`, …) and,
 * read with `returnObjects`, every leaf under it.
 */
import fs from "node:fs";
import path from "node:path";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_NS,
  NAMESPACES,
  NS_SET,
  TRANS_ATTR_WINDOW,
  TRANS_KEY_ATTR,
  TRANS_NS,
  TRANS_TAG,
  extractBindings,
} from "@/test/i18nKeys";
import { describeSourceScan, itSourceScan } from "@/test/sourceScan";
import { SRC, parse, walkSources } from "@/test/sourceScanners";

const LOCALE_DIR = path.join(SRC, "i18n", "locales", "en");

/**
 * Key families no source literal spells, as `ns:prefix` — every key under the
 * prefix counts as read. One-line reason each.
 */
const DYNAMIC_PREFIXES: Record<string, string> = {};

/**
 * English leaf keys (`ns:key`) no code reads, sorted and exact. Delete an entry
 * in the PR that reads or deletes the key (deleting: from all 10 locales).
 * Never add one: a new key is read by the code that adds it. Measured
 * 2026-11-02: 310 of the 7019 English leaves.
 */
const UNUSED_KEY_BASELINE: string[] = [
  "admin:calculations.columns.name",
  "admin:calculations.columns.status",
  "admin:calculations.newCalculationDialog",
  "admin:cardLayout.builtinFields.name",
  "admin:cardLayout.calc",
  "admin:compliance_accept",
  "admin:compliance_accepted_by",
  "admin:compliance_acknowledge",
  "admin:compliance_article",
  "admin:compliance_filter_decision",
  "admin:compliance_no_findings",
  "admin:compliance_permission_denied",
  "admin:compliance_reopen",
  "admin:compliance_running",
  "admin:eol.cardType",
  "admin:eol.product",
  "admin:eol.suggestedMatches",
  "admin:extensions.install.choose",
  "admin:extensions.license.title",
  "admin:extensions.store.close",
  "admin:extensions.store.details",
  "admin:extensions.store.licensed",
  "admin:metamodel.fieldEditor.weight",
  "admin:metamodel.typeDrawer.addRelation",
  "admin:metamodel.typeDrawer.icon",
  "admin:migration.col.factSheets",
  "admin:page.title",
  "admin:settings.ai.sectionCards",
  "admin:settings.favicon.reset",
  "admin:settings.section.authentication",
  "admin:settings.section.integrations",
  "admin:surveys.respond.title",
  "admin:turbolens_add_connection",
  "admin:turbolens_analysis_started",
  "admin:turbolens_arch_complexity",
  "admin:turbolens_arch_components",
  "admin:turbolens_arch_copy_mermaid",
  "admin:turbolens_arch_critical",
  "admin:turbolens_arch_custom_build",
  "admin:turbolens_arch_data_flows",
  "admin:turbolens_arch_diagram_error",
  "admin:turbolens_arch_direction",
  "admin:turbolens_arch_effort",
  "admin:turbolens_arch_export_svg",
  "admin:turbolens_arch_from",
  "admin:turbolens_arch_gaps",
  "admin:turbolens_arch_in_landscape",
  "admin:turbolens_arch_integration_map",
  "admin:turbolens_arch_integrations",
  "admin:turbolens_arch_legend_existing",
  "admin:turbolens_arch_legend_new",
  "admin:turbolens_arch_mitigation",
  "admin:turbolens_arch_next_steps",
  "admin:turbolens_arch_notes",
  "admin:turbolens_arch_protocol",
  "admin:turbolens_arch_rendering_diagram",
  "admin:turbolens_arch_reset_zoom",
  "admin:turbolens_arch_risks",
  "admin:turbolens_arch_tab_gaps",
  "admin:turbolens_arch_tab_integrations",
  "admin:turbolens_arch_tab_layers",
  "admin:turbolens_arch_tab_plan",
  "admin:turbolens_arch_timeline",
  "admin:turbolens_arch_to",
  "admin:turbolens_architect_diagram",
  "admin:turbolens_architect_generate_architecture",
  "admin:turbolens_architect_generate_capability_map",
  "admin:turbolens_architect_recs_selected",
  "admin:turbolens_architect_result_title",
  "admin:turbolens_architect_summary",
  "admin:turbolens_col_current_tech",
  "admin:turbolens_col_effort",
  "admin:turbolens_col_modernization_type",
  "admin:turbolens_col_priority",
  "admin:turbolens_col_recommendation",
  "admin:turbolens_col_target_type",
  "admin:turbolens_connected",
  "admin:turbolens_dashboard_title",
  "admin:turbolens_edit_connection",
  "admin:turbolens_email",
  "admin:turbolens_instance_url",
  "admin:turbolens_last_synced",
  "admin:turbolens_modernization_results",
  "admin:turbolens_modernization_title",
  "admin:turbolens_new_connection",
  "admin:turbolens_no_connection_description",
  "admin:turbolens_no_connection_title",
  "admin:turbolens_no_connections",
  "admin:turbolens_no_duplicate_data",
  "admin:turbolens_no_vendor_data",
  "admin:turbolens_not_tested",
  "admin:turbolens_password",
  "admin:turbolens_phase",
  "admin:turbolens_push_ai_config",
  "admin:turbolens_run_duplicate_detection",
  "admin:turbolens_run_vendor_analysis",
  "admin:turbolens_sync",
  "admin:turbolens_sync_success",
  "admin:turbolens_tab_architect",
  "admin:turbolens_tab_connection",
  "admin:turbolens_tab_history",
  "admin:turbolens_tab_vendors",
  "admin:turbolens_test",
  "admin:turbolens_turbo_credentials",
  "admin:turbolens_turbo_url",
  "admin:turbolens_vendor_apps",
  "admin:turbolens_vendor_category",
  "admin:turbolens_vendor_cost",
  "admin:users.archivedRoleTooltip",
  "admin:users.columns.actions",
  "admin:users.create.password",
  "admin:users.create.passwordHelperText",
  "admin:users.create.passwordRequiredLocal",
  "admin:users.invitations.email",
  "admin:users.invitations.invited",
  "admin:users.invitations.role",
  "admin:users.loadingUsers",
  "admin:users.pendingInvitations",
  "auth:login.noAccount",
  "auth:login.register",
  "auth:login.signIn",
  "auth:login.ssoButton",
  "auth:login.subtitle",
  "auth:passwordRules.digit",
  "auth:passwordRules.minLength",
  "auth:passwordRules.uppercase",
  "auth:register.button",
  "auth:register.email",
  "auth:register.password",
  "auth:setPassword.invalidToken",
  "auth:setPassword.success",
  "auth:setPassword.welcome",
  "auth:sso.error",
  "auth:sso.noCode",
  "bpm:navigator.hasBpmnDiagram",
  "bpm:navigator.hasProcessFlow",
  "cards:compliance.cardTab.col.actions",
  "cards:compliance.cardTab.col.decision",
  "cards:compliance.create.newFinding",
  "cards:compliance.drawer.reopen",
  "cards:compliance.lifecycle.advanceTo",
  "cards:detail.actions.archiveTooltip",
  "cards:detail.actions.deleteTooltip",
  "cards:detail.dialogs.archive.descriptionIndefinite",
  "cards:detail.dialogs.related.empty",
  "cards:detail.dialogs.related.summary",
  "cards:detail.title",
  "cards:resources.deleteLink",
  "cards:resources.error.createFailed",
  "cards:resources.error.loadFailed",
  "cards:resources.fileCategory.architecture",
  "cards:resources.fileCategory.compliance",
  "cards:resources.fileCategory.design",
  "cards:resources.fileCategory.meeting_notes",
  "cards:resources.fileCategory.operations",
  "cards:resources.fileCategory.other",
  "cards:resources.fileCategory.security",
  "cards:resources.linkType.architecture",
  "cards:resources.linkType.compliance",
  "cards:resources.linkType.documentation",
  "cards:resources.linkType.operations",
  "cards:resources.linkType.other",
  "cards:resources.linkType.security",
  "cards:resources.linkType.support",
  "cards:stakeholders.alreadyAssigned",
  "cards:stakeholders.inviteEmailFailed",
  "cards:stakeholders.inviteSuccess",
  "common:actions.copy",
  "common:actions.download",
  "common:actions.print",
  "common:actions.refresh",
  "common:actions.send",
  "common:actions.upload",
  "common:emptyStates.noCards",
  "common:emptyStates.noResults",
  "common:errors.unauthorized",
  "common:grid.fill.failed",
  "common:labels.count",
  "common:labels.createdBy",
  "common:labels.optional",
  "common:labels.updatedAt",
  "common:labels.updatedBy",
  "common:labels.version",
  "common:portal.allTagGroup",
  "common:portal.lifecycle",
  "common:portal.loading",
  "delivery:artefactGroup.noAdrs",
  "delivery:artefactGroup.noDiagrams",
  "delivery:artefactGroup.noSoaws",
  "delivery:card.createAdrForInitiative",
  "delivery:card.createArtefactTooltip",
  "delivery:card.createSoaw",
  "delivery:card.createSoawForInitiative",
  "delivery:card.createSoawTooltip",
  "delivery:card.linkDiagrams",
  "delivery:diagram.label",
  "delivery:editor.signDialog.sending",
  "delivery:editor.status",
  "delivery:empty.createAdr",
  "delivery:empty.createSoaw",
  "delivery:empty.linkDiagram",
  "delivery:empty.noArtefacts",
  "delivery:empty.or",
  "delivery:header.searchInitiatives",
  "delivery:list.actions",
  "delivery:list.artefacts",
  "delivery:list.businessValue",
  "delivery:list.effort",
  "delivery:list.name",
  "delivery:list.relatedElements",
  "delivery:list.soawCount",
  "delivery:list.status",
  "delivery:list.subtype",
  "delivery:list.timeline",
  "delivery:principles.empty",
  "delivery:principles.implications",
  "delivery:principles.rationale",
  "delivery:tabs.decisions",
  "delivery:tabs.principles",
  "delivery:unlinked.title",
  "delivery:view.cardView",
  "delivery:view.listView",
  "diagrams:cardPicker.search",
  "diagrams:cardPicker.selectOrSearch",
  "diagrams:cardPicker.title",
  "diagrams:editor.alreadyDrilled",
  "diagrams:editor.cardArchived",
  "diagrams:editor.errors.archiveCardFailed",
  "diagrams:editor.removedFromDiagram",
  "diagrams:editor.toolbar.syncCount",
  "diagrams:gallery.author",
  "diagrams:sync.alsoArchive",
  "diagrams:sync.archiveNow",
  "diagrams:sync.removeNow",
  "diagrams:sync.removedCards",
  "diagrams:sync.willArchive",
  "diagrams:sync.willKeepInInventory",
  "grc:compliance.aiRequired.body",
  "grc:compliance.aiRequired.contactAdmin",
  "grc:compliance.aiRequired.regulations",
  "grc:compliance.aiRequired.title",
  "grc:governance.decisions.empty",
  "grc:governance.decisions.open",
  "grc:governance.decisions.status",
  "grc:page.subtitle",
  "grc:risks.cardTab.linkExisting",
  "grc:risks.cards.link",
  "grc:risks.cards.unlink",
  "grc:risks.emptyState",
  "grc:risks.export.sheetRisks",
  "grc:risks.export.sheetTasks",
  "grc:risks.field.acceptedBy",
  "grc:risks.filter.all",
  "grc:risks.filter.quickSearch",
  "grc:risks.grid.empty",
  "grc:risks.grid.rowsPerPage",
  "grc:risks.overdueTooltip",
  "grc:risks.tasks.field.reference",
  "grc:risks.tasks.history.closedAt",
  "grc:risks.tasks.history.dueOn",
  "grc:risks.toastCreated",
  "grc:risks.toastDeleted",
  "grc:risks.toastUpdated",
  "grc:risks.viewSource",
  "inventory:import.errors.invalidRelationAction",
  "inventory:import.errors.noExistingCard",
  "inventory:massArchive.archiving",
  "inventory:massArchive.cascadeHelp",
  "inventory:massDelete.deleting",
  "inventory:massEdit.clear",
  "ppm:actual",
  "ppm:budgetFrom",
  "ppm:costLines",
  "ppm:costManagement",
  "ppm:costsFrom",
  "ppm:datesFrom",
  "ppm:deleteDependency",
  "ppm:derivedBothTooltip_one",
  "ppm:derivedBothTooltip_other",
  "ppm:description",
  "ppm:dueToday",
  "ppm:fromBeneath_one",
  "ppm:fromBeneath_other",
  "ppm:fromOwn",
  "ppm:kanbanView",
  "ppm:listView",
  "ppm:noReportAvailable",
  "ppm:openRisks",
  "ppm:overdue",
  "ppm:parentColumn",
  "ppm:planned",
  "ppm:printOn",
  "ppm:progress",
  "ppm:riskDescription",
  "ppm:status",
  "ppm:totalPlanned",
  "ppm:viewReport",
  "ppm:workPackage",
  "reports:common.center",
  "reports:common.dateRange",
  "reports:dependency.alsoAppearsElsewhere",
  "reports:dependency.resetLayout",
  "reports:dependency.viewInLdv",
  "reports:flexiblePortfolio.title",
  "reports:page.title",
  "reports:portfolio.applicationFilters",
  "validation:invalidEmail",
  "validation:invalidUrl",
  "validation:tooLong",
  "validation:tooShort",
];

/** Anti-rot floor: a scanner that stops matching must not pass by reporting nothing as read. */
const MIN_REFERENCED_KEYS = 3_000;

const PLURAL_SUFFIX = /_(?:zero|one|two|few|many|other)$/;

/** A template's static text must carry this much before it may match keys outside a `t` call. */
const MIN_STATIC_WORD = /[A-Za-z]{3}/;

// ---------------------------------------------------------------------------
// Locale keys
// ---------------------------------------------------------------------------

/** Every leaf of a locale bundle as a dotted path (nested objects and flat dotted keys read alike). */
function leafKeys(bundle: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(bundle)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out.push(...leafKeys(value as Record<string, unknown>, full));
    } else {
      out.push(full);
    }
  }
  return out;
}

/** English keys per namespace: every leaf and every plural base. */
type KnownKeys = Map<string, Set<string>>;

function knownKeys(bundles: Record<string, Record<string, unknown>>): KnownKeys {
  const known: KnownKeys = new Map();
  for (const [ns, bundle] of Object.entries(bundles)) {
    const keys = new Set<string>();
    for (const leaf of leafKeys(bundle)) {
      keys.add(leaf);
      keys.add(leaf.replace(PLURAL_SUFFIX, ""));
    }
    known.set(ns, keys);
  }
  return known;
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/** What the code names: exact `ns:key`s, and per-namespace key shapes from template literals. */
interface References {
  keys: Set<string>;
  /** `ns` → sources of anchored RegExps over that namespace's keys. */
  shapes: Map<string, Set<string>>;
}

function emptyReferences(): References {
  return { keys: new Set(), shapes: new Map() };
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `ns:rest` → [ns, rest] when `ns` is a namespace, else [fallback, raw]. */
function splitNs(raw: string, fallback: string): [string, string] {
  const colon = raw.indexOf(":");
  if (colon > 0 && NS_SET.has(raw.slice(0, colon))) return [raw.slice(0, colon), raw.slice(colon + 1)];
  return [fallback, raw];
}

/** The static parts of a template literal: the head, then the text after each substitution. */
function templateParts(node: ts.TemplateExpression): string[] {
  return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
}

/**
 * True for the value of a property named like a translation key (`labelKey: "todos"`,
 * `tKey`, `i18nKey`): a bare word there is a key some other file's `t` reads.
 */
function isNamedKey(node: ts.Node): boolean {
  const parent = node.parent;
  return (
    !!parent &&
    ts.isPropertyAssignment(parent) &&
    parent.initializer === node &&
    (ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name)) &&
    /.Key$/.test(parent.name.text)
  );
}

/** The `{ ns: "…" }` option of a `t(key, options)` call, when it names a namespace. */
function nsOption(call: ts.CallExpression): string | undefined {
  const options = call.arguments[1];
  if (!options || !ts.isObjectLiteralExpression(options)) return undefined;
  for (const prop of options.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === "ns" &&
      ts.isStringLiteral(prop.initializer) &&
      NS_SET.has(prop.initializer.text)
    ) {
      return prop.initializer.text;
    }
  }
  return undefined;
}

/**
 * Every key one source file references, added to `out`. `known` is the English
 * key set per namespace, against which literals outside a `t` call are matched.
 */
function collectReferences(
  file: string,
  src: string,
  known: KnownKeys,
  out: References = emptyReferences(),
): References {
  const { bindings } = extractBindings(src);
  const fileNamespaces = new Set<string>([DEFAULT_NS, ...bindings.values()]);

  const addKey = (ns: string, key: string) => {
    if (key) out.keys.add(`${ns}:${key}`);
  };
  const addShape = (ns: string, parts: string[]) => {
    const shapes = out.shapes.get(ns) ?? new Set<string>();
    shapes.add(`^${parts.map(escapeRe).join(".+")}$`);
    out.shapes.set(ns, shapes);
  };

  /** A `t` / `i18n.t` call's first argument, in `fallback` unless a `ns:` prefix or `{ ns }` says otherwise. */
  const addCallArgument = (call: ts.CallExpression, fallback: string) => {
    const arg = call.arguments[0];
    const ns = nsOption(call) ?? fallback;
    if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
      const [keyNs, key] = splitNs(arg.text, ns);
      addKey(keyNs, key);
    } else if (arg && ts.isTemplateExpression(arg)) {
      const parts = templateParts(arg);
      const [keyNs, head] = splitNs(parts[0], ns);
      parts[0] = head;
      // `t(`${key}`)` and a `delivery:${key}` wrapper name no family.
      if (parts.join("") !== "") addShape(keyNs, parts);
    }
  };

  const addLiteral = (raw: string, namedKey: boolean) => {
    if (!raw) return;
    const [ns, key] = splitNs(raw, "");
    if (ns) {
      if (known.get(ns)?.has(key)) addKey(ns, key);
      return;
    }
    for (const candidate of raw.includes(".") || namedKey ? NAMESPACES : fileNamespaces) {
      if (known.get(candidate)?.has(raw)) addKey(candidate, raw);
    }
    // A key prefix handed to a helper (`valueLabel("turbolens_priority_", p)`).
    if (/[._]$/.test(raw) && MIN_STATIC_WORD.test(raw)) {
      for (const candidate of NAMESPACES) {
        if ([...(known.get(candidate) ?? [])].some((k) => k.startsWith(raw))) addShape(candidate, [raw, ""]);
      }
    }
  };

  const addTemplate = (node: ts.TemplateExpression) => {
    const parts = templateParts(node);
    const [ns, head] = splitNs(parts[0], "");
    parts[0] = head;
    const text = parts.join("");
    if (!/[._]/.test(text) || !MIN_STATIC_WORD.test(text)) return;
    for (const candidate of ns ? [ns] : NAMESPACES) addShape(candidate, parts);
  };

  const callNs = (callee: ts.Expression): string | undefined => {
    if (ts.isIdentifier(callee)) return bindings.get(callee.text);
    if (
      ts.isPropertyAccessExpression(callee) &&
      callee.name.text === "t" &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === "i18n"
    ) {
      return DEFAULT_NS;
    }
    return undefined;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const ns = callNs(node.expression);
      if (ns !== undefined) {
        addCallArgument(node, ns);
        // A computed key (`t(cond ? "a.b" : "a.c")`) is read as plain literals.
        const [first, ...rest] = node.arguments;
        if (first && !ts.isStringLiteralLike(first) && !ts.isTemplateExpression(first)) visit(first);
        rest.forEach(visit);
        return;
      }
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      addLiteral(node.text, isNamedKey(node));
    }
    else if (ts.isTemplateExpression(node)) addTemplate(node);
    ts.forEachChild(node, visit);
  };
  visit(parse(file, src));

  // `<Trans i18nKey="…" ns="…">`: the visit saw the attribute as a plain
  // literal, but not the namespace its `ns=` names.
  for (const m of src.matchAll(TRANS_TAG)) {
    const window = src.slice(m.index, m.index + TRANS_ATTR_WINDOW);
    const keyAttr = TRANS_KEY_ATTR.exec(window);
    if (!keyAttr) continue;
    const nsAttr = TRANS_NS.exec(window);
    const fallback = nsAttr && NS_SET.has(nsAttr[1]) ? nsAttr[1] : DEFAULT_NS;
    addKey(...splitNs(keyAttr[1] ?? keyAttr[2], fallback));
  }
  return out;
}

/** The leaves (`ns:key`) no reference reaches, sorted. */
function unusedLeaves(leaves: string[], refs: References, dynamicPrefixes: string[] = []): string[] {
  const shapes = new Map(
    [...refs.shapes].map(([ns, sources]) => [ns, [...sources].map((s) => new RegExp(s))] as const),
  );
  const used = (leaf: string): boolean => {
    if (dynamicPrefixes.some((prefix) => leaf.startsWith(prefix))) return true;
    const colon = leaf.indexOf(":");
    const ns = leaf.slice(0, colon);
    const key = leaf.slice(colon + 1);
    const base = key.replace(PLURAL_SUFFIX, "");
    for (const candidate of base === key ? [key] : [key, base]) {
      if (refs.keys.has(`${ns}:${candidate}`)) return true;
      // A key read with `returnObjects` names an object above its leaves.
      const segments = candidate.split(".");
      for (let i = segments.length - 1; i > 0; i--) {
        if (refs.keys.has(`${ns}:${segments.slice(0, i).join(".")}`)) return true;
      }
      if (shapes.get(ns)?.some((re) => re.test(candidate))) return true;
    }
    return false;
  };
  return leaves.filter((leaf) => !used(leaf)).sort();
}

// ---------------------------------------------------------------------------
// Ratchet
// ---------------------------------------------------------------------------

/** The ratchet's verdicts — both empty when the scan and the baseline agree. */
function ratchet(unused: string[], baseline: string[]): { added: string[]; stale: string[] } {
  const now = new Set(unused);
  const listed = new Set(baseline);
  return {
    added: unused.filter((key) => !listed.has(key)),
    stale: baseline.filter((key) => !now.has(key)),
  };
}

// ---------------------------------------------------------------------------
// Self-tests (strings only — no disk)
// ---------------------------------------------------------------------------

const BUNDLES = {
  common: {
    actions: { save: "Save" },
    status: { active: "Active", retired: "Retired" },
    items_one: "{{count}} item",
    items_other: "{{count}} items",
  },
  cards: { "relations.title": "Relations", catalogue: { all: "All", none: "None" }, process: { all: "All" } },
  nav: { reports: "Reports", inventory: "Inventory" },
};
const KNOWN = knownKeys(BUNDLES);
const LEAVES = Object.entries(BUNDLES).flatMap(([ns, bundle]) => leafKeys(bundle).map((key) => `${ns}:${key}`));
const refsOf = (src: string, file = "x.tsx") => collectReferences(file, src, KNOWN);
const unusedIn = (src: string) => unusedLeaves(LEAVES, refsOf(src));

describe("collectReferences", () => {
  it("reads a bound t()'s literal key in its namespace, and a ns:key in that namespace", () => {
    const src = 'const { t } = useTranslation("cards"); t("relations.title"); t("common:actions.save");';
    expect([...refsOf(src).keys].sort()).toEqual(["cards:relations.title", "common:actions.save"]);
  });

  it("reads an aliased binding and i18n.t", () => {
    const src = 'const { t: tNav } = useTranslation("nav"); tNav("reports"); i18n.t("actions.save");';
    expect([...refsOf(src).keys].sort()).toEqual(["common:actions.save", "nav:reports"]);
  });

  it("reads a template key as every key of its shape", () => {
    const unused = unusedIn("const { t } = useTranslation(); t(`status.${s}`); t(`cards:${family}.all`);");
    expect(unused).toEqual(["cards:catalogue.none", "cards:relations.title", "common:actions.save",
      "common:items_one", "common:items_other", "nav:inventory", "nav:reports"]);
  });

  it("reads a dotted template outside t() in every namespace", () => {
    expect(unusedIn("const key = `status.${s}`;")).not.toContain("common:status.active");
  });

  it("reads a key prefix handed to a helper, and an underscored template", () => {
    const unused = unusedLeaves(LEAVES, refsOf('label(valueLabel("items_", n)); const k = `relations.${x}`;'));
    expect(unused).not.toContain("common:items_one");
    expect(unused).not.toContain("cards:relations.title");
  });

  it("ignores a template that names no family", () => {
    const src = "const { t } = useTranslation(); t(`${key}`); const u = `/cards/${id}`; const k = `${a}.${b}`;";
    expect(refsOf(src).shapes.size).toBe(0);
  });

  it("reads <Trans i18nKey> in its ns", () => {
    expect([...refsOf('<Trans i18nKey="reports" ns="nav" components={{ b: <b /> }} />').keys]).toContain(
      "nav:reports",
    );
  });

  it("reads a dotted literal in any namespace, a bare word only in the file's own namespaces", () => {
    const src = 'const items = [{ labelKey: "relations.title" }, { key: "inventory" }];';
    expect(refsOf(src, "x.ts").keys.has("cards:relations.title")).toBe(true);
    expect(refsOf(src, "x.ts").keys.has("nav:inventory")).toBe(false);
    expect(refsOf(`const { t } = useTranslation("nav"); ${src}`).keys.has("nav:inventory")).toBe(true);
  });

  it("reads a bare word under a *Key property in any namespace", () => {
    expect(refsOf('const item = { labelKey: "inventory", key: "reports" };', "x.ts").keys).toEqual(
      new Set(["nav:inventory"]),
    );
  });

  it("counts a plural form read when its base is, and a leaf when its object is", () => {
    const unused = unusedIn('const { t } = useTranslation(); t("items", { count }); t("status", { returnObjects: true });');
    expect(unused).not.toContain("common:items_one");
    expect(unused).not.toContain("common:items_other");
    expect(unused).not.toContain("common:status.active");
    expect(unused).toContain("common:actions.save");
  });

  it("reads the literals of a computed key", () => {
    const src = 'const { t } = useTranslation("nav"); t(open ? "relations.title" : "reports");';
    expect([...refsOf(src).keys].sort()).toEqual(["cards:relations.title", "nav:reports"]);
  });

  it("honours a { ns } option on the call", () => {
    expect([...refsOf('const { t } = useTranslation(); t("reports", { ns: "nav" });').keys]).toEqual([
      "nav:reports",
    ]);
  });

  it("marks a dynamic prefix's family read", () => {
    expect(unusedLeaves(LEAVES, emptyReferences(), ["cards:catalogue."])).not.toContain("cards:catalogue.none");
  });
});

describe("ratchet", () => {
  it("names a new unused key, and a baseline entry no longer unused", () => {
    expect(ratchet(["a:x", "a:y"], ["a:x", "a:z"])).toEqual({ added: ["a:y"], stale: ["a:z"] });
    expect(ratchet(["a:x"], ["a:x"])).toEqual({ added: [], stale: [] });
  });
});

describe("UNUSED_KEY_BASELINE", () => {
  it("is sorted and free of duplicates", () => {
    expect(UNUSED_KEY_BASELINE).toEqual([...new Set(UNUSED_KEY_BASELINE)].sort());
  });
});

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

interface Scan {
  leaves: string[];
  unused: string[];
}

let scanned: Scan | undefined;

/** Every English leaf and the ones `src/` never reads. Read once, on first use. */
function scan(): Scan {
  if (scanned) return scanned;
  const bundles: Record<string, Record<string, unknown>> = {};
  const leaves: string[] = [];
  for (const ns of NAMESPACES) {
    bundles[ns] = JSON.parse(fs.readFileSync(path.join(LOCALE_DIR, `${ns}.json`), "utf8"));
    leaves.push(...leafKeys(bundles[ns]).map((key) => `${ns}:${key}`));
  }
  const known = knownKeys(bundles);
  const refs = emptyReferences();
  for (const file of walkSources(SRC)) collectReferences(file, fs.readFileSync(file, "utf8"), known, refs);
  scanned = { leaves, unused: unusedLeaves(leaves, refs, Object.keys(DYNAMIC_PREFIXES)) };
  return scanned;
}

describeSourceScan("unused translation keys ratchet against UNUSED_KEY_BASELINE", () => {
  itSourceScan(`reads at least ${MIN_REFERENCED_KEYS} English keys`, () => {
    const { leaves, unused } = scan();
    expect(leaves.length - unused.length).toBeGreaterThanOrEqual(MIN_REFERENCED_KEYS);
  });

  itSourceScan("adds no unused key", () => {
    expect(
      ratchet(scan().unused, UNUSED_KEY_BASELINE).added,
      "These English keys are read by no code. Read each where it is meant to show, or delete it " +
        "from all 10 locale files. (A key built in a way this scan cannot see goes in DYNAMIC_PREFIXES, with why.)",
    ).toEqual([]);
  });

  itSourceScan("lists only keys that are still unused (delete the rest from the baseline)", () => {
    expect(
      ratchet(scan().unused, UNUSED_KEY_BASELINE).stale,
      "now read or deleted — delete these entries from UNUSED_KEY_BASELINE",
    ).toEqual([]);
  });

  itSourceScan("marks only prefixes that still name keys (stale DYNAMIC_PREFIXES)", () => {
    const { leaves } = scan();
    const stale = Object.keys(DYNAMIC_PREFIXES).filter((p) => !leaves.some((leaf) => leaf.startsWith(p)));
    expect(stale, "no English key starts with this prefix any more — delete the entry").toEqual([]);
  });
});
