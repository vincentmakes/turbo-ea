/**
 * Extension host — runtime loader + registry for vendor-signed UI extensions.
 *
 * Extensions are prebuilt ESM bundles served same-origin by the backend
 * (`/api/v1/ext-assets/...`), listed by the authenticated, entitlement-
 * filtered `/extensions/ui-manifest` endpoint. Each bundle calls
 * `window.TurboEA.register(key, plugin)` on import. React/MUI/the API
 * client are provided via `window.TurboEA.sdk` so bundles stay small and
 * share the host's single React instance (the template repo's Vite
 * config externalizes them onto these globals).
 *
 * Seven extension points exist: nav routes (full pages), card-detail tabs,
 * admin panels, custom field types (SDK 1.1 — a renderer/editor for an
 * `ext.{key}.*` field type used inside card attribute sections), survey
 * templates (SDK 1.2), and — SDK 1.3 — ADR panels (a component rendered on
 * the Architecture Decision Record editor/preview, e.g. a value-savings form
 * writing the ADR `ext.*` attributes bag) and ADR export sections (plain data
 * a plugin contributes into the core ADR DOCX export). Every
 * extension-provided component must be rendered inside <ExtensionBoundary> —
 * a crashing extension shows a fallback chip, never a white screen. A field
 * type whose extension is missing, disabled, or unlicensed simply is not in
 * the registry, so core falls back to a read-only text rendering of the
 * stored value (the data is never lost).
 */

import * as mui from "@mui/material";
import { Alert } from "@mui/material";
import React, { useSyncExternalStore } from "react";
import ReactDOM from "react-dom";
import { useTranslation } from "react-i18next";

import { api } from "@/api/client";
import MaterialSymbol from "@/components/MaterialSymbol";
import * as tokens from "@/theme/tokens";

export const UI_SDK_VERSION = "1.3";

/**
 * Core nav groups an extension route may request placement into (instead of the
 * default top-level nav entry). Whitelisted on purpose so an extension can only
 * land in sanctioned menus (never admin/arbitrary ones); extend deliberately.
 */
export const EXTENSION_NAV_GROUPS = ["reports"] as const;
export type ExtensionNavGroup = (typeof EXTENSION_NAV_GROUPS)[number];

export interface ExtensionRouteContribution {
  id: string;
  path: string; // mounted under /ext/{key}/... in the SPA router
  label: string;
  icon: string;
  permission?: string;
  component: React.ComponentType;
  // Optional placement hint: render this route's nav entry inside a core menu
  // group (e.g. "reports") rather than as a top-level item. The route path and
  // rendering are unchanged — only where the menu entry appears. Omit for the
  // current top-level behaviour. An unrecognised value shows nowhere in the nav.
  navGroup?: ExtensionNavGroup;
}

export interface ExtensionCardTabContribution {
  id: string;
  label: string;
  permission?: string;
  appliesTo?: string[]; // card-type keys; omit = all types
  component: React.ComponentType<{ cardId: string; cardType: string }>;
}

export interface ExtensionAdminPanelContribution {
  id: string;
  label: string;
  component: React.ComponentType;
}

/** Props handed to an extension field type's read-only display component. */
export interface ExtensionFieldDisplayProps {
  field: { key: string; label: string; type: string; config?: Record<string, unknown> };
  value: unknown;
  config?: Record<string, unknown>;
}

/** Props handed to an extension field type's inline editor component. */
export interface ExtensionFieldEditorProps extends ExtensionFieldDisplayProps {
  onChange: (value: unknown) => void;
  error?: string;
}

/**
 * A custom field type an extension contributes to card attribute editing.
 * `type` MUST be namespaced `ext.{extensionKey}.*` (enforced at aggregation) so
 * two extensions can never collide and core can tell a custom type from an
 * unknown one. `config` is the per-field settings object (e.g. `{min,max}` for a
 * rating), sourced from the field's `config` in the metamodel.
 */
export interface ExtensionFieldTypeContribution {
  type: string;
  label: string;
  display?: React.ComponentType<ExtensionFieldDisplayProps>;
  editor?: React.ComponentType<ExtensionFieldEditorProps>;
  defaultConfig?: Record<string, unknown>;
}

/** The payload an extension survey template posts to `POST /surveys`. */
export interface ExtensionSurveyTemplatePayload {
  name: string;
  description?: string;
  message?: string;
  target_type_key: string;
  target_filters?: Record<string, unknown>;
  target_roles?: string[];
  fields?: Array<Record<string, unknown>>;
}

/**
 * A "New from template" shortcut on the Surveys admin page. Clicking it mints a
 * fresh **draft** survey from `build()`'s payload (POST /surveys always creates
 * a draft) and opens it in the builder for the admin to review and send —
 * `build()` runs at click time so it may compute dynamic values (dates, etc.).
 */
export interface ExtensionSurveyTemplateContribution {
  id: string;
  label: string;
  icon?: string;
  build: () => ExtensionSurveyTemplatePayload;
}

/** Props every ADR panel component receives (SDK 1.3). */
export interface ExtensionAdrPanelProps {
  adrId: string;
  status: string; // draft | in_review | signed
  signed: boolean; // convenience: status === "signed" (attributes are frozen)
  // The panel must not allow edits when true: it is either a signed (frozen)
  // ADR or the read-only preview page. Editing is only offered on the editor
  // page for an unsigned ADR.
  readOnly: boolean;
}

/**
 * A panel rendered on the ADR editor and preview pages (SDK 1.3). ADRs are not
 * cards, so this is the sanctioned place to attach ADR-scoped UI — e.g. a
 * value-savings form that reads/writes the ADR `ext.*` attributes bag via
 * `PATCH /adr/{id}`. `appliesTo` has no analogue (there is only one ADR
 * "type"); gate with `permission` if needed. Rendered read-only-friendly: the
 * component should respect `signed` to disable editing once frozen.
 */
export interface ExtensionAdrPanelContribution {
  id: string;
  permission?: string;
  component: React.ComponentType<ExtensionAdrPanelProps>;
}

/** A section a plugin contributes into the core ADR DOCX export (SDK 1.3). */
export interface AdrExportSection {
  heading: string;
  paragraphs?: string[];
  table?: { headers: string[]; rows: string[][] };
}

/**
 * Contributes extra sections to the core ADR DOCX export (SDK 1.3). `build()`
 * receives the full ADR (including its `attributes` bag) and returns plain data
 * — core renders it with the document's own styles, so the plugin never touches
 * the `docx` library. Runs at export time inside a guard; a throw is skipped.
 */
export interface ExtensionAdrExportContribution {
  id: string;
  build: (adr: Record<string, unknown>) => AdrExportSection[];
}

export interface TurboExtensionUI {
  key: string;
  sdkVersion: string;
  routes?: ExtensionRouteContribution[];
  cardTabs?: ExtensionCardTabContribution[];
  adminPanels?: ExtensionAdminPanelContribution[];
  fieldTypes?: ExtensionFieldTypeContribution[];
  surveyTemplates?: ExtensionSurveyTemplateContribution[];
  adrPanels?: ExtensionAdrPanelContribution[];
  adrExportSections?: ExtensionAdrExportContribution[];
}

export interface RegisteredFieldType {
  extKey: string;
  contribution: ExtensionFieldTypeContribution;
}

export interface RegisteredSurveyTemplate {
  extKey: string;
  contribution: ExtensionSurveyTemplateContribution;
}

export interface RegisteredAdrPanel {
  extKey: string;
  contribution: ExtensionAdrPanelContribution;
}

export interface RegisteredAdrExport {
  extKey: string;
  contribution: ExtensionAdrExportContribution;
}

export interface RegisteredExtension {
  key: string;
  plugin: TurboExtensionUI;
}

interface UiManifestEntry {
  key: string;
  version: string;
  entry: string;
  entitlement_state: string;
}

// ---------------------------------------------------------------------------
// Registry store (useSyncExternalStore-backed so mount points re-render)
// ---------------------------------------------------------------------------

let _registered: RegisteredExtension[] = [];
let _loadErrors: Record<string, string> = {};
const _listeners = new Set<() => void>();
let _loadStarted = false;
// Cached, stable snapshots — recomputed lazily and invalidated on every
// notify() so useSyncExternalStore never loops.
let _fieldTypesCache: Record<string, RegisteredFieldType> | null = null;
let _surveyTemplatesCache: RegisteredSurveyTemplate[] | null = null;
let _adrExportCache: RegisteredAdrExport[] | null = null;

function notify() {
  _fieldTypesCache = null;
  _surveyTemplatesCache = null;
  _adrExportCache = null;
  _listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function sdkMajor(v: string): number {
  return Number.parseInt(String(v).split(".", 1)[0] ?? "", 10);
}

export function registerExtension(key: string, plugin: TurboExtensionUI): void {
  if (!plugin || plugin.key !== key) {
    _loadErrors = { ..._loadErrors, [key]: `register() key mismatch (${plugin?.key})` };
    notify();
    return;
  }
  if (sdkMajor(plugin.sdkVersion) !== sdkMajor(UI_SDK_VERSION)) {
    _loadErrors = {
      ..._loadErrors,
      [key]: `built for UI SDK ${plugin.sdkVersion}, host provides ${UI_SDK_VERSION}`,
    };
    notify();
    return;
  }
  _registered = [..._registered.filter((r) => r.key !== key), { key, plugin }];
  notify();
}

export function getRegisteredExtensions(): RegisteredExtension[] {
  return _registered;
}

export function getExtensionLoadErrors(): Record<string, string> {
  return _loadErrors;
}

export function useExtensionUI(): RegisteredExtension[] {
  return useSyncExternalStore(subscribe, getRegisteredExtensions, getRegisteredExtensions);
}

/**
 * Map of every registered custom field type (`ext.{key}.*` → contribution).
 * A contribution whose `type` is not namespaced under its own extension key is
 * dropped (defence against collisions). The result is cached and only changes
 * when the registry does, so it is safe as a useSyncExternalStore snapshot.
 */
export function getExtensionFieldTypes(): Record<string, RegisteredFieldType> {
  if (_fieldTypesCache) return _fieldTypesCache;
  const out: Record<string, RegisteredFieldType> = {};
  for (const { key, plugin } of _registered) {
    for (const ft of plugin.fieldTypes ?? []) {
      if (!ft?.type || !ft.type.startsWith(`ext.${key}.`)) {
        console.warn(
          `[extension:${key}] field type "${ft?.type}" must be namespaced ext.${key}.* — ignored`,
        );
        continue;
      }
      out[ft.type] = { extKey: key, contribution: ft };
    }
  }
  _fieldTypesCache = out;
  return out;
}

export function useExtensionFieldTypes(): Record<string, RegisteredFieldType> {
  return useSyncExternalStore(subscribe, getExtensionFieldTypes, getExtensionFieldTypes);
}

/**
 * Survey templates contributed by registered extensions, in registration order.
 * A contribution missing `id`/`label`/`build` is dropped. Cached (stable
 * reference) so it is safe as a useSyncExternalStore snapshot.
 */
export function getExtensionSurveyTemplates(): RegisteredSurveyTemplate[] {
  if (_surveyTemplatesCache) return _surveyTemplatesCache;
  const out: RegisteredSurveyTemplate[] = [];
  for (const { key, plugin } of _registered) {
    for (const tpl of plugin.surveyTemplates ?? []) {
      if (!tpl?.id || !tpl.label || typeof tpl.build !== "function") {
        console.warn(`[extension:${key}] invalid survey template — ignored`, tpl);
        continue;
      }
      out.push({ extKey: key, contribution: tpl });
    }
  }
  _surveyTemplatesCache = out;
  return out;
}

export function useExtensionSurveyTemplates(): RegisteredSurveyTemplate[] {
  return useSyncExternalStore(
    subscribe,
    getExtensionSurveyTemplates,
    getExtensionSurveyTemplates,
  );
}

/**
 * ADR panels contributed by registered extensions, in registration order.
 * Consumed via `useExtensionUI()` at the mount points (ADR editor/preview); a
 * contribution missing `id`/`component` is dropped. Not cached — the caller
 * already re-renders off `useExtensionUI`.
 */
export function getExtensionAdrPanels(): RegisteredAdrPanel[] {
  const out: RegisteredAdrPanel[] = [];
  for (const { key, plugin } of _registered) {
    for (const panel of plugin.adrPanels ?? []) {
      if (!panel?.id || typeof panel.component !== "function") {
        console.warn(`[extension:${key}] invalid ADR panel — ignored`, panel);
        continue;
      }
      out.push({ extKey: key, contribution: panel });
    }
  }
  return out;
}

export function useExtensionAdrPanels(): RegisteredAdrPanel[] {
  // Depend on the registry snapshot so mounts re-render on (un)register.
  useSyncExternalStore(subscribe, getRegisteredExtensions, getRegisteredExtensions);
  return getExtensionAdrPanels();
}

/**
 * ADR DOCX export contributions, in registration order. A contribution missing
 * `id`/`build` is dropped. Cached (stable reference) so the non-React exporter
 * (`adrExport.ts`) can call it directly.
 */
export function getExtensionAdrExportSections(): RegisteredAdrExport[] {
  if (_adrExportCache) return _adrExportCache;
  const out: RegisteredAdrExport[] = [];
  for (const { key, plugin } of _registered) {
    for (const contribution of plugin.adrExportSections ?? []) {
      if (!contribution?.id || typeof contribution.build !== "function") {
        console.warn(`[extension:${key}] invalid ADR export contribution — ignored`, contribution);
        continue;
      }
      out.push({ extKey: key, contribution });
    }
  }
  _adrExportCache = out;
  return out;
}

/** Test helper — wipe the registry between tests. */
export function resetExtensionHost(): void {
  _registered = [];
  _loadErrors = {};
  _loadStarted = false;
  _fieldTypesCache = null;
  notify();
}

// ---------------------------------------------------------------------------
// window.TurboEA — the global SDK surface extension bundles compile against
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    TurboEA?: {
      sdk: Record<string, unknown>;
      register: (key: string, plugin: TurboExtensionUI) => void;
    };
  }
}

export function initExtensionHost(): void {
  if (typeof window === "undefined" || window.TurboEA) return;
  window.TurboEA = {
    sdk: {
      React,
      ReactDOM,
      mui,
      api,
      MaterialSymbol,
      useTranslation,
      tokens,
      uiSdkVersion: UI_SDK_VERSION,
    },
    register: registerExtension,
  };
}

/**
 * Fetch the entitlement-filtered manifest and import each bundle.
 * Call once after login; per-extension failures are recorded and
 * surfaced, never thrown.
 */
export async function loadUiExtensions(): Promise<void> {
  if (_loadStarted) return;
  _loadStarted = true;
  initExtensionHost();
  let manifest: UiManifestEntry[] = [];
  try {
    manifest = await api.get<UiManifestEntry[]>("/extensions/ui-manifest");
  } catch {
    // Backend older than the extension store, or transient failure — no UI extensions.
    return;
  }
  await Promise.all(
    manifest.map(async (entry) => {
      try {
        await import(/* @vite-ignore */ entry.entry);
        if (!_registered.some((r) => r.key === entry.key)) {
          _loadErrors = {
            ..._loadErrors,
            [entry.key]: "bundle imported but never called TurboEA.register()",
          };
          notify();
        }
      } catch (e) {
        _loadErrors = {
          ..._loadErrors,
          [entry.key]: e instanceof Error ? e.message : String(e),
        };
        notify();
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// Route outlet — one wildcard SPA route renders all extension pages
// ---------------------------------------------------------------------------

/** All route contributions across registered extensions. */
export function getExtensionRoutes(): { extKey: string; route: ExtensionRouteContribution }[] {
  return _registered.flatMap(({ key, plugin }) =>
    (plugin.routes ?? []).map((route) => ({ extKey: key, route })),
  );
}

/** Extension routes that requested placement into a given core nav group. */
export function getExtensionRoutesForGroup(
  group: ExtensionNavGroup,
): { extKey: string; route: ExtensionRouteContribution }[] {
  return _registered.flatMap(({ key, plugin }) =>
    (plugin.routes ?? [])
      .filter((r) => r.navGroup === group)
      .map((route) => ({ extKey: key, route })),
  );
}

// ---------------------------------------------------------------------------
// Error boundary — wraps every extension-provided component
// ---------------------------------------------------------------------------

interface BoundaryProps {
  extensionKey: string;
  children: React.ReactNode;
}

interface BoundaryState {
  error: string | null;
}

export class ExtensionBoundary extends React.Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown) {
    console.error(`[extension:${this.props.extensionKey}]`, error);
  }

  render() {
    if (this.state.error) {
      return (
        <Alert severity="error" variant="outlined" sx={{ m: 1 }}>
          Extension “{this.props.extensionKey}” failed to render: {this.state.error}
        </Alert>
      );
    }
    return this.props.children;
  }
}
