/**
 * The Process House as served by a published web portal.
 *
 * The account-less twin of `features/bpm/ProcessNavigator.tsx`: both render the
 * same navigator body, so a visitor without a Turbo EA account browses exactly
 * the house their colleagues browse inside the app. They differ in what the
 * source can reach and what the capabilities allow.
 *
 * Unlike `PortalPpmPortfolio`, whose rows link into `/ppm/{id}` behind the login
 * wall, **this portal links nowhere**. It is a dead end by design: a process
 * house published for new joiners, auditors and partners should answer "how do
 * we do this" without ever presenting a door those readers cannot open. So the
 * source omits `loadCard` entirely — the portal never calls `/cards/{id}` — and
 * `canOpenCard: false` removes every affordance that would have led there.
 *
 * What it therefore does not show: the Matrix and Dependencies views, the Apps
 * and Data drawer tabs, and the application-count badge, all of which publish
 * the systems landscape rather than the process. The backend withholds that data
 * regardless; these switches are what stop the UI rendering empty shells of it.
 */

import { useMemo } from "react";
import { ProcessNavigatorBody } from "@/features/bpm/ProcessNavigator";
import {
  FULL_CAPABILITIES,
  ProcessNavigatorProvider,
} from "@/features/bpm/ProcessNavigatorContext";
import type {
  NavigatorCapabilities,
  NavigatorMeta,
  NavigatorStep,
  ProcessNavigatorSource,
} from "@/features/bpm/ProcessNavigatorContext";
import { useProcessTypeOptionsFrom } from "@/features/bpm/useProcessTypeOptions";
import { publicGet } from "./publicApi";
import type {
  PortalProcessFlow,
  PortalProcessMap,
  PublicPortal,
} from "@/types";

interface Props {
  slug: string;
  portal: PublicPortal;
}

/** What the portal is configured to open on. Nothing is persisted. */
interface BpmPortalConfig {
  default_level?: number;
  default_overlay?: string;
  default_columns?: number;
}

export default function PortalProcessNavigator({ slug, portal }: Props) {
  const cfg = (portal.card_config?.bpm ?? {}) as BpmPortalConfig;

  // The portal payload already carries the (cost-stripped) BusinessProcess
  // schema, subtypes, icon and colour — this page has no session to read
  // `/metamodel/types` with, and `useMetamodel` would fetch unconditionally.
  const processTypes = useProcessTypeOptionsFrom(portal.type_info?.fields_schema);

  const source = useMemo<ProcessNavigatorSource>(
    () => ({
      loadMap: async (signal) => {
        const data = await publicGet<PortalProcessMap>(
          `/web-portals/public/${slug}/bpm/process-map`,
          { signal },
        );
        return {
          // The house is built from the same `ProcItem` shape either way; the
          // landscape fields are zeroed rather than absent so `buildTree`'s
          // roll-up arithmetic needs no branch, and `showRollups: false` keeps
          // the resulting zeros off the screen.
          items: data.items.map((p) => ({
            id: p.id,
            name: p.name,
            subtype: p.subtype,
            parent_id: p.parent_id ?? null,
            description: p.description ?? undefined,
            attributes: p.attributes ?? {},
            lifecycle: p.lifecycle ?? {},
            app_count: 0,
            total_cost: 0,
            apps: [],
            data_objects: [],
            org_ids: p.org_tokens ?? [],
            ctx_ids: [],
            has_diagram: p.has_flow ?? false,
            element_count: p.step_count ?? 0,
          })),
          organizations: data.organizations.map((o) => ({ id: o.token, name: o.name })),
          rowOrder: data.row_order ?? [],
        };
      },
      loadFlow: async (processId, signal) => {
        const flow = await publicGet<PortalProcessFlow>(
          `/web-portals/public/${slug}/bpm/processes/${processId}/flow`,
          { signal },
        );
        return {
          bpmnXml: flow.bpmn_xml ?? null,
          svgThumbnail: flow.svg_thumbnail ?? null,
          steps: (flow.steps ?? []).map<NavigatorStep>((s) => ({
            bpmn_element_id: s.bpmn_element_id,
            element_type: s.element_type,
            name: s.name,
            documentation: s.documentation,
            lane_name: s.lane_name,
            is_automated: s.is_automated,
            sequence_order: s.sequence_order,
            application_name: s.application_name ?? undefined,
            data_object_name: s.data_object_name ?? undefined,
            it_component_name: s.it_component_name ?? undefined,
            organizations: (s.organizations ?? []).map((o) => ({ id: o.token, name: o.name })),
          })),
          // Drafts are never published, so there is nothing to point a visitor at.
          hasDrafts: false,
        };
      },
      // loadCard, reorderCards and saveRowOrder are deliberately absent.
    }),
    [slug],
  );

  const capabilities = useMemo<NavigatorCapabilities>(
    () => ({
      ...FULL_CAPABILITIES,
      viewModes: ["house"],
      drawerTabs: ["overview", "steps", "flow"],
      canOpenCard: false,
      canReorder: false,
      showRollups: false,
      persistPreferences: false,
      initial: {
        level: typeof cfg.default_level === "number" ? cfg.default_level : undefined,
        overlay: cfg.default_overlay,
        columns: typeof cfg.default_columns === "number" ? cfg.default_columns : undefined,
      },
    }),
    [cfg.default_level, cfg.default_overlay, cfg.default_columns],
  );

  const meta = useMemo<NavigatorMeta>(
    () => ({
      typeIcon: portal.type_info?.icon ?? "route",
      typeColor: portal.type_info?.color ?? "#028f00",
      subtypes: portal.type_info?.subtypes ?? [],
      processTypes,
    }),
    [portal.type_info, processTypes],
  );

  return (
    <ProcessNavigatorProvider value={{ source, capabilities, meta }}>
      <ProcessNavigatorBody />
    </ProcessNavigatorProvider>
  );
}
