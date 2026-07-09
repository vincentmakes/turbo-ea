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
 * Four extension points exist: nav routes (full pages), card-detail tabs,
 * admin panels, and custom field types (SDK 1.1 — a renderer/editor for an
 * `ext.{key}.*` field type used inside card attribute sections). Every
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

export const UI_SDK_VERSION = "1.1";

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

export interface TurboExtensionUI {
  key: string;
  sdkVersion: string;
  routes?: ExtensionRouteContribution[];
  cardTabs?: ExtensionCardTabContribution[];
  adminPanels?: ExtensionAdminPanelContribution[];
  fieldTypes?: ExtensionFieldTypeContribution[];
}

export interface RegisteredFieldType {
  extKey: string;
  contribution: ExtensionFieldTypeContribution;
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
// Cached, stable snapshot of the field-type registry — recomputed lazily and
// invalidated on every notify() so useSyncExternalStore never loops.
let _fieldTypesCache: Record<string, RegisteredFieldType> | null = null;

function notify() {
  _fieldTypesCache = null;
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
