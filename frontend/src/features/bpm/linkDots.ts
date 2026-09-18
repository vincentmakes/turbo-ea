/**
 * The one renderer for a step's links on a BPMN canvas: one small dot per
 * linked card *type*, in that type's colour, under the step's name. Shared by
 * the read-only viewer and the editor, so the two cannot drift.
 *
 * Names are never drawn on the canvas — they made it unreadable — they live in
 * the viewer's click popover and the editor's Linked cards panel, and ride on
 * each dot as its hover text. Pure: no bpmn-js import (the library is loaded
 * lazily by both hosts), which is also what keeps it unit-testable.
 */
import { CALLED_PROCESS_COLOR, LINK_KIND_ORDER } from "./calledProcess";
import type { LinkKind } from "./calledProcess";

/** The bpmn-js overlay type, so a host can `overlays.remove({ type })` its own. */
export const LINK_DOTS_OVERLAY_TYPE = "turboea-link-dots";

/**
 * The seeded metamodel colours (`seed.py`), as a fallback. In the app the
 * colours come from the metamodel through `useLinkTypeColors`, so an admin's
 * recolouring shows; the viewer also renders inside account-less portals,
 * which cannot read the metamodel, and those get this set — the same reason
 * `CALLED_PROCESS_COLOR` is mirrored rather than fetched.
 */
export const LINK_TYPE_COLORS: Record<LinkKind, string> = {
  process: CALLED_PROCESS_COLOR,
  application: "#0f7eb5",
  data_object: "#774fcc",
  it_component: "#d29270",
  organization: "#2889ff",
};

/**
 * Escape a card name for an overlay, which bpmn-js takes as an HTML string. A
 * name is user text; `<b>` in it is a name, not markup.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface LinkDot {
  kind: LinkKind;
  color: string;
  /** Hover text — the linked card's name, or the organizations' names joined. */
  title: string;
}

/**
 * Build the dots from per-kind titles: a kind with a title is a kind with a
 * link. Ordered by `LINK_KIND_ORDER`, whatever order the titles came in.
 */
export function linkDotsFor(
  titles: Partial<Record<LinkKind, string | null | undefined>>,
  colors: Record<LinkKind, string>,
): LinkDot[] {
  const dots: LinkDot[] = [];
  for (const kind of LINK_KIND_ORDER) {
    const title = titles[kind];
    if (title) dots.push({ kind, color: colors[kind], title });
  }
  return dots;
}

const DOT_PX = 8;
const DOT_GAP_PX = 4;

/**
 * The overlay HTML: a row as wide as the element it sits on, so `center`
 * centres the dots under the name. Overlays scale with the canvas by default,
 * so the width is in diagram units like the element's own. `null` for a step
 * with nothing linked, so the host adds no overlay at all.
 */
export function linkDotsHtml(dots: LinkDot[], width: number): string | null {
  if (!dots.length) return null;
  const spans = dots
    .map(
      (d) =>
        `<span class="turboea-link-dot turboea-link-dot-${d.kind}" title="${escapeHtml(d.title)}" ` +
        `style="display:inline-block;width:${DOT_PX}px;height:${DOT_PX}px;border-radius:50%;` +
        `background:${d.color};border:1px solid rgba(0,0,0,.25);box-sizing:border-box"></span>`,
    )
    .join("");
  return (
    `<div class="turboea-link-dots" style="width:${width}px;display:flex;justify-content:center;` +
    `gap:${DOT_GAP_PX}px;pointer-events:auto">${spans}</div>`
  );
}

/** The little a placement needs from a bpmn-js shape. */
export interface ShapeLike {
  id: string;
  width?: number;
  /** The external label, when the name is drawn outside the shape. */
  label?: { id: string; width?: number } | null;
  /** A collapsed sub-process draws the `+` marker at its bottom centre. */
  collapsed?: boolean;
  businessObject?: {
    $instanceOf?: (type: string) => boolean;
    /** Loop / multi-instance — a bottom-centre marker too. */
    loopCharacteristics?: unknown;
  } | null;
}

export interface LinkDotPlacement {
  /** The element the overlay attaches to — the label when there is one. */
  elementId: string;
  position: { bottom: number; left: number };
  width: number;
}

/**
 * True when bpmn-js draws a marker at the shape's bottom centre — the call
 * activity's `⊞`, a collapsed sub-process's `+`, an ad-hoc `~`, the loop and
 * multi-instance glyphs — which is exactly where the dots would otherwise go.
 */
export function hasBottomMarker(shape: ShapeLike): boolean {
  const bo = shape.businessObject;
  if (!bo?.$instanceOf) return false;
  if (bo.loopCharacteristics) return true;
  if (bo.$instanceOf("bpmn:CallActivity") || bo.$instanceOf("bpmn:AdHocSubProcess")) return true;
  return Boolean(shape.collapsed && bo.$instanceOf("bpmn:SubProcess"));
}

/**
 * Where "right under the name" is. A task, sub-process or call activity draws
 * its name inside, so the dots sit at the bottom of the shape; an event,
 * gateway or data artefact draws its name as an external label below it, so
 * the dots hang under that label instead — attached to the label element,
 * which moves with it.
 *
 * diagram-js reads `position.bottom` as "the overlay's *top* edge sits this
 * far above the element's bottom edge" (`top = height - bottom`), so a row of
 * 8px dots needs `bottom: 14` to end 6px clear of a shape's border, and
 * `bottom: -2` to hang 2px under a label. A shape with a bottom-centre marker
 * (`hasBottomMarker`) has no free row inside: the marker owns the bottom and a
 * two-line name owns the middle, so its dots hang just under the box instead,
 * `bottom: -3` — still centred under the name, clear of both.
 */
export function linkDotPlacement(shape: ShapeLike): LinkDotPlacement {
  const label = shape.label;
  if (label && label.width) {
    return { elementId: label.id, position: { bottom: -2, left: 0 }, width: label.width };
  }
  const bottom = hasBottomMarker(shape) ? -3 : 14;
  return { elementId: shape.id, position: { bottom, left: 0 }, width: shape.width ?? 100 };
}
