/**
 * BpmnViewer — Read-only BPMN viewer embedded in ProcessFlowTab.
 * Uses bpmn-js NavigatedViewer for smaller bundle.
 * Click element to see details in popover. Color overlay for automation.
 *
 * A step's linked cards show on the canvas as one coloured dot per card type
 * under the step's name (`linkDots.ts`, shared with the editor) — never as
 * names, which made a linked diagram unreadable. The names are in the click
 * popover, and on each dot as hover text.
 */
import { useRef, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import LinkifiedText from "@/components/LinkifiedText";
import ElementTypeChip from "./ElementTypeChip";
import Popover from "@mui/material/Popover";
import Chip from "@mui/material/Chip";
import MaterialSymbol from "@/components/MaterialSymbol";
import { CALLED_PROCESS_COLOR, calledProcessPath } from "./calledProcess";
import type { LinkKind } from "./calledProcess";
import {
  LINK_DOTS_OVERLAY_TYPE,
  LINK_TYPE_COLORS,
  escapeHtml,
  linkDotPlacement,
  linkDotsFor,
  linkDotsHtml,
} from "./linkDots";

// Kept here for existing importers; the renderer owns it now.
export { escapeHtml };

import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css";

/**
 * The subset of a process element this viewer actually reads.
 *
 * `ProcessElement` is assignable to it, so every existing caller is unaffected —
 * but a published web portal's payload carries no card identifiers at all, and
 * this is what lets the same viewer render it. Widening the prop rather than
 * duplicating the component is deliberate: an account-less visitor must see the
 * exact diagram their colleagues see inside the app.
 */
export interface BpmnViewerElement {
  bpmn_element_id: string;
  element_type: string;
  name?: string;
  documentation?: string;
  lane_name?: string;
  is_automated: boolean;
  event_definition_type?: string | null;
  definition_name?: string | null;
  application_name?: string | null;
  data_object_name?: string | null;
  it_component_name?: string | null;
  /** The process a call activity invokes. The id is absent on a portal
   *  payload, where the chip is inert. */
  business_process_id?: string | null;
  business_process_name?: string | null;
  organizations?: { id: string; name: string }[];
}

/**
 * True when the shape carries an explicit colour set by hand in the modeler.
 *
 * Mirrors bpmn-js's own lookup in `getFillColor` (lib/draw/BpmnRenderUtil.js):
 * BPMN-in-Color first, then the legacy bpmn.io `bioc` attribute. bpmn-js 18's
 * `getDi(element)` is just `element.di`, inlined here so this helper stays free
 * of a static bpmn-js import — the library is loaded lazily below.
 */
export function hasExplicitFill(element: any): boolean {
  const di = element?.di;
  return Boolean(di?.get?.("color:background-color") || di?.get?.("bioc:fill"));
}

interface Props {
  bpmnXml: string;
  elements?: BpmnViewerElement[];
  onElementClick?: (bpmnElementId: string) => void;
  height?: number | string;
  /**
   * Card-type colours for the link dots, from the metamodel
   * (`useLinkTypeColors`). Absent in a portal, which has no metamodel session
   * and gets the seeded `LINK_TYPE_COLORS`.
   */
  typeColors?: Partial<Record<LinkKind, string>>;
}

export default function BpmnViewer({
  bpmnXml,
  elements,
  onElementClick,
  height = 400,
  typeColors,
}: Props) {
  const { t } = useTranslation(["bpm", "common"]);
  const navigate = useNavigate();
  const dotColors = useMemo(() => ({ ...LINK_TYPE_COLORS, ...typeColors }), [typeColors]);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const [popover, setPopover] = useState<{
    anchor: HTMLElement;
    element: BpmnViewerElement;
  } | null>(null);

  useEffect(() => {
    if (!containerRef.current || !bpmnXml) return;
    let destroyed = false;

    async function init() {
      const NavigatedViewer = (await import("bpmn-js/lib/NavigatedViewer")).default;
      if (destroyed || !containerRef.current) return;

      const viewer = new NavigatedViewer({
        container: containerRef.current,
      });

      viewerRef.current = viewer;

      try {
        await viewer.importXML(bpmnXml);
        const canvas = viewer.get("canvas") as any;
        canvas.zoom("fit-viewport");

        const elementRegistry = viewer.get("elementRegistry") as any;

        // Apply color overlays for automated tasks
        if (elements) {
          const overlays = viewer.get("overlays") as any;

          for (const el of elements) {
            const shape = elementRegistry.get(el.bpmn_element_id);
            if (!shape) continue;

            // Color by automation — but never over a colour the user picked in
            // the modeler, which is an explicit choice and must win (#910).
            if (el.is_automated && !hasExplicitFill(shape)) {
              const gfx = elementRegistry.getGraphics(el.bpmn_element_id);
              if (gfx) {
                const rect = gfx.querySelector(".djs-visual rect, .djs-visual polygon");
                if (rect) rect.style.fill = "#e8f5e9";
              }
            }

            // One dot per linked card type under the name — the names are in
            // the popover. A kind is linked when the payload names a card for
            // it; the portal payload carries names and no ids, so names are
            // the one signal both hosts share.
            const dots = linkDotsFor(
              {
                process: el.business_process_name,
                application: el.application_name,
                data_object: el.data_object_name,
                it_component: el.it_component_name,
                organization: (el.organizations ?? []).map((o) => o.name).join(", "),
              },
              dotColors,
            );
            const placement = linkDotPlacement(shape);
            const html = linkDotsHtml(dots, placement.width);
            if (html) {
              try {
                overlays.add(placement.elementId, LINK_DOTS_OVERLAY_TYPE, {
                  position: placement.position,
                  html,
                });
              } catch {
                // Overlay may fail if element not visible
              }
            }
          }
        }

        // Click handler
        const eventBus = viewer.get("eventBus") as any;
        eventBus.on("element.click", (e: any) => {
          const id = e.element?.id;
          if (!id || !elements) return;
          const el = elements.find((x) => x.bpmn_element_id === id);
          if (el) {
            onElementClick?.(id);
            const gfx = elementRegistry.getGraphics(id);
            if (gfx) {
              setPopover({ anchor: gfx as HTMLElement, element: el });
            }
          }
        });
      } catch (err) {
        console.error("BpmnViewer load error:", err);
      }
    }

    init();

    return () => {
      destroyed = true;
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
  }, [bpmnXml, elements, onElementClick, dotColors]);

  return (
    <Box sx={{ position: "relative" }}>
      <Box
        ref={containerRef}
        sx={{ height, border: 1, borderColor: "divider", borderRadius: 1, bgcolor: "action.hover", "& .bjs-powered-by": { display: "none" } }}
      />

      <Popover
        open={!!popover}
        anchorEl={popover?.anchor}
        onClose={() => setPopover(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        transformOrigin={{ vertical: "top", horizontal: "center" }}
      >
        {popover?.element && (
          <Box sx={{ p: 2, maxWidth: 300 }}>
            <Typography variant="subtitle2">{popover.element.name || t("viewer.unnamed")}</Typography>
            <Typography variant="body2" color="text.secondary">
              <ElementTypeChip
                variant="text"
                elementType={popover.element.element_type}
                eventDefinitionType={popover.element.event_definition_type}
                definitionName={popover.element.definition_name}
              />
              {popover.element.lane_name && ` | ${popover.element.lane_name}`}
            </Typography>
            {popover.element.documentation && (
              <Typography variant="body2" sx={{ mt: 1, whiteSpace: "pre-wrap" }}>
                <LinkifiedText text={popover.element.documentation} />
              </Typography>
            )}
            <Box sx={{ mt: 1, display: "flex", gap: 0.5, flexWrap: "wrap" }}>
              {popover.element.is_automated && <Chip label={t("viewer.automated")} size="small" color="success" />}
              {popover.element.application_name && (
                <Chip label={popover.element.application_name} size="small" color="primary" />
              )}
              {popover.element.data_object_name && (
                <Chip label={popover.element.data_object_name} size="small" color="secondary" />
              )}
              {popover.element.it_component_name && (
                <Chip
                  icon={<MaterialSymbol icon="memory" size={14} />}
                  label={popover.element.it_component_name}
                  size="small"
                  variant="outlined"
                />
              )}
              {popover.element.business_process_name && (
                <Chip
                  icon={<MaterialSymbol icon="route" size={14} />}
                  label={`${t("viewer.process")}: ${popover.element.business_process_name}`}
                  size="small"
                  variant="outlined"
                  sx={{ borderColor: CALLED_PROCESS_COLOR, color: CALLED_PROCESS_COLOR }}
                  onClick={
                    popover.element.business_process_id
                      ? () => navigate(calledProcessPath(popover.element.business_process_id!))
                      : undefined
                  }
                />
              )}
              {(popover.element.organizations || []).map((org) => (
                <Chip key={org.id} label={org.name} size="small" color="info" />
              ))}
            </Box>
          </Box>
        )}
      </Popover>
    </Box>
  );
}
