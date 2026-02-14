/**
 * BpmnViewer — Read-only BPMN viewer embedded in ProcessFlowTab.
 * Uses bpmn-js NavigatedViewer for smaller bundle.
 * Click element to see details in popover. Color overlay for automation.
 */
import { useRef, useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Popover from "@mui/material/Popover";
import Chip from "@mui/material/Chip";

import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css";

import type { ProcessElement } from "@/types";

interface Props {
  bpmnXml: string;
  elements?: ProcessElement[];
  onElementClick?: (bpmnElementId: string) => void;
  height?: number | string;
}

export default function BpmnViewer({ bpmnXml, elements, onElementClick, height = 400 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const [popover, setPopover] = useState<{
    anchor: HTMLElement;
    element: ProcessElement;
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

            // Color by automation
            if (el.is_automated) {
              const gfx = elementRegistry.getGraphics(el.bpmn_element_id);
              if (gfx) {
                const rect = gfx.querySelector(".djs-visual rect, .djs-visual polygon");
                if (rect) rect.style.fill = "#e8f5e9";
              }
            }

            // Show application badge
            if (el.application_name) {
              try {
                overlays.add(el.bpmn_element_id, {
                  position: { bottom: -4, right: 4 },
                  html: `<div style="background:#1976d2;color:#fff;font-size:10px;padding:1px 4px;border-radius:2px;white-space:nowrap">${el.application_name}</div>`,
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
  }, [bpmnXml, elements, onElementClick]);

  return (
    <Box sx={{ position: "relative" }}>
      <Box
        ref={containerRef}
        sx={{ height, border: 1, borderColor: "divider", borderRadius: 1, bgcolor: "#fafafa", "& .bjs-powered-by": { display: "none" } }}
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
            <Typography variant="subtitle2">{popover.element.name || "(unnamed)"}</Typography>
            <Typography variant="body2" color="text.secondary">
              {popover.element.element_type}
              {popover.element.lane_name && ` | ${popover.element.lane_name}`}
            </Typography>
            {popover.element.documentation && (
              <Typography variant="body2" sx={{ mt: 1 }}>
                {popover.element.documentation}
              </Typography>
            )}
            <Box sx={{ mt: 1, display: "flex", gap: 0.5, flexWrap: "wrap" }}>
              {popover.element.is_automated && <Chip label="Automated" size="small" color="success" />}
              {popover.element.application_name && (
                <Chip label={popover.element.application_name} size="small" color="primary" />
              )}
              {popover.element.data_object_name && (
                <Chip label={popover.element.data_object_name} size="small" color="secondary" />
              )}
            </Box>
          </Box>
        )}
      </Popover>
    </Box>
  );
}
