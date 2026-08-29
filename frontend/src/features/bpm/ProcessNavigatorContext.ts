/**
 * The seam that lets one Process Navigator serve two audiences.
 *
 * `ProcessNavigator` renders inside Turbo EA for a signed-in user, and inside a
 * published web portal for a visitor with no account at all. Rather than fork
 * the component — 2,800 lines whose sub-components each fetch their own data —
 * both callers supply a **source** (where does data come from?) and
 * **capabilities** (what may this audience do?), and the body reads them from
 * context.
 *
 * Why context rather than props: the fetches live inside `DrawerSteps`,
 * `DrawerFlow`, `FlowPreviewDialog`, `MatrixView` and `DependenciesView`, and
 * the metamodel lookups live inside `HouseCard`, which is **recursive**.
 * Threading a source and four metamodel values through those would mean six new
 * props at four nesting levels. It also keeps the default export's behaviour
 * byte-identical, so `ProcessNavigator.test.tsx` stays a genuine regression
 * guard over this refactor instead of being rewritten alongside it.
 *
 * The one hazard of this shape is that it is a convention, not a type-level
 * guarantee: a new `api.get` added inside a sub-component would compile and
 * then 401 every portal visitor. `PortalProcessNavigator.test.tsx` guards it by
 * rendering the portal with the API client mocked to throw on any call.
 */

import { createContext, useContext } from "react";
import type { ProcessTypeOptionsResult } from "./useProcessTypeOptions";
import type { SubtypeDef } from "@/types";

/** A BPMN step, in the shape both the authenticated and public payloads share. */
export interface NavigatorStep {
  /** Present on the authenticated payload only; a portal publishes no element ids. */
  id?: string;
  bpmn_element_id: string;
  element_type: string;
  name?: string;
  documentation?: string;
  lane_name?: string;
  is_automated: boolean;
  sequence_order: number;
  application_name?: string;
  data_object_name?: string;
  it_component_name?: string;
  /** Card ids behind the links above — authenticated only, so the chips are
   *  clickable in the app and inert in a portal, which links nowhere. */
  application_id?: string;
  data_object_id?: string;
  it_component_id?: string;
  organizations?: { id: string; name: string }[];
}

/** A process's published flow, resolved in one call by either source. */
export interface ProcessFlowPayload {
  bpmnXml: string | null;
  svgThumbnail: string | null;
  steps: NavigatorStep[];
  /** Whether unpublished drafts exist. Always false in a portal, which never sees them. */
  hasDrafts: boolean;
}

export interface NavigatorMapPayload {
  items: unknown[];
  organizations: { id: string; name: string }[];
  rowOrder: string[];
}

/**
 * Where the navigator's data comes from.
 *
 * The optional methods are the capability boundary in data form: a portal source
 * simply omits `loadCard`, `reorderCards` and `saveRowOrder`, and the affordances
 * that depend on them do not render. An absent method is never called.
 */
export interface ProcessNavigatorSource {
  loadMap(signal?: AbortSignal): Promise<NavigatorMapPayload>;
  loadFlow(
    processId: string,
    signal?: AbortSignal,
  ): Promise<ProcessFlowPayload>;
  /** The full card behind a process — authenticated only. */
  loadCard?(processId: string): Promise<Record<string, unknown>>;
  reorderCards?(updates: { id: string; sortOrder: number }[]): Promise<void>;
  saveRowOrder?(order: string[]): Promise<void>;
}

export type NavigatorViewMode = "house" | "matrix" | "dependencies";
export type NavigatorDrawerTab =
  | "overview"
  | "steps"
  | "flow"
  | "apps"
  | "data";

export interface NavigatorCapabilities {
  /** View modes offered in the toolbar. A portal publishes the house only. */
  viewModes: NavigatorViewMode[];
  drawerTabs: NavigatorDrawerTab[];
  /** Whether anything may link to `/cards/{id}`. False in a portal, which is a dead end by design. */
  canOpenCard: boolean;
  canReorder: boolean;
  /** Application / data-object counts and cost. A portal publishes no landscape, so no rollups. */
  showRollups: boolean;
  /** Whether view preferences persist to localStorage. */
  persistPreferences: boolean;
  initial?: { level?: number; overlay?: string; columns?: number };
}

/** The metamodel facts the navigator needs, from wherever the caller has them. */
export interface NavigatorMeta {
  typeIcon: string;
  typeColor: string;
  subtypes: SubtypeDef[];
  processTypes: ProcessTypeOptionsResult;
}

export interface ProcessNavigatorContextValue {
  source: ProcessNavigatorSource;
  capabilities: NavigatorCapabilities;
  meta: NavigatorMeta;
}

const ProcessNavigatorContext =
  createContext<ProcessNavigatorContextValue | null>(null);

export const ProcessNavigatorProvider = ProcessNavigatorContext.Provider;

function useNavigatorContext(): ProcessNavigatorContextValue {
  const ctx = useContext(ProcessNavigatorContext);
  if (!ctx) {
    throw new Error(
      "Process Navigator components must render inside a ProcessNavigatorProvider",
    );
  }
  return ctx;
}

export function useNavigatorSource(): ProcessNavigatorSource {
  return useNavigatorContext().source;
}

export function useNavigatorCapabilities(): NavigatorCapabilities {
  return useNavigatorContext().capabilities;
}

export function useNavigatorMeta(): NavigatorMeta {
  return useNavigatorContext().meta;
}

/** Capabilities of the in-app navigator: everything on. */
export const FULL_CAPABILITIES: NavigatorCapabilities = {
  viewModes: ["house", "matrix", "dependencies"],
  drawerTabs: ["overview", "steps", "flow", "apps", "data"],
  canOpenCard: true,
  canReorder: false,
  showRollups: true,
  persistPreferences: true,
};
