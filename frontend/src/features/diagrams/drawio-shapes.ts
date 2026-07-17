/**
 * Helpers for DrawIO card shape insertion and extraction.
 *
 * Insertion uses same-origin access to the DrawIO iframe — we call
 * graph.insertVertex() directly from the parent window, bypassing
 * postMessage entirely.  This is the most reliable approach because
 * it avoids XML merge root-cell conflicts and plugin lifecycle issues.
 */

import { ICON_PATHS } from "./iconPaths";
import { readableTextColor } from "@/lib/color";

/** Escape a string for safe inclusion in XML attribute/text content. */
function escapeXml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Mix a hex color toward white by a factor (0-1) for a faint background tint. */
function tint(hex: string, factor = 0.88): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const t = (v: number) =>
    Math.round(v + (255 - v) * factor)
      .toString(16)
      .padStart(2, "0");
  return `#${t(r)}${t(g)}${t(b)}`;
}

/** Darken a hex color by a factor (0-1) for stroke color */
function darken(hex: string, factor = 0.25): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const d = (v: number) =>
    Math.round(v * (1 - factor))
      .toString(16)
      .padStart(2, "0");
  return `#${d(r)}${d(g)}${d(b)}`;
}

/**
 * Build an SVG data-URI for a card-type icon (white glyph), or null when the
 * icon name isn't in the bundled set. We ship real vector paths (see
 * iconPaths.ts) rather than the Material Symbols font because font glyphs can't
 * be reliably rasterised into images and the DrawIO iframe has no access to the
 * app's webfont.
 *
 * The URI is `encodeURIComponent`-encoded, so it contains no raw `;` or `=` and
 * is therefore safe to embed in an mxGraph style string (which is `;`/`=`
 * delimited and split by the view-recolour helpers).
 */
function buildIconImage(icon?: string): string | null {
  if (!icon) return null;
  const entry = ICON_PATHS[icon];
  if (!entry) return null;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${entry.vb}">` +
    `<path fill="#ffffff" d="${entry.d}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Extra mxGraph style tokens that render the card-type icon as a small white
 * glyph in the top-left corner of the shape. Returns [] when the icon isn't
 * available, so cells fall back to the plain coloured rectangle.
 *
 * Using `shape=label` bakes the icon into the single cell — it drags, copies
 * and exports with the shape, with no child cells or groups to manage.
 */
function iconStyleParts(icon?: string): string[] {
  const image = buildIconImage(icon);
  if (!image) return [];
  return [
    "shape=label",
    `image=${image}`,
    "imageAlign=left",
    "imageVerticalAlign=top",
    "imageWidth=18",
    "imageHeight=18",
    // `spacing` insets the icon from the top-left corner; `spacingLeft`
    // reserves a matching left gutter for the label so the (centered) card
    // name is always laid out to the right of the glyph and never overlaps it,
    // even when it wraps to several lines.
    "spacing=4",
    "spacingLeft=24",
  ];
}

/** Carry an existing cell's icon tokens across a full style rebuild. */
function iconTokensFromStyle(style: string): string[] {
  return (style || "")
    .split(";")
    .filter(Boolean)
    .filter(
      (p) =>
        p === "shape=label" ||
        p.startsWith("image=") ||
        p.startsWith("imageAlign=") ||
        p.startsWith("imageVerticalAlign=") ||
        p.startsWith("imageWidth=") ||
        p.startsWith("imageHeight=") ||
        p.startsWith("spacing"),
    );
}

export interface InsertCardOpts {
  cardId: string;
  cardType: string;
  name: string;
  color: string;
  /** Card-type Material Symbols icon name (e.g. "apps"). Optional. */
  icon?: string;
  x: number;
  y: number;
}

/** Shape data needed for direct mxGraph API insertion */
export interface CardCellData {
  cellId: string;
  label: string;
  cardId: string;
  cardType: string;
  x: number;
  y: number;
  width: number;
  height: number;
  style: string;
}

/**
 * Build the data for inserting a card shape via the mxGraph API.
 */
export function buildCardCellData(opts: InsertCardOpts): CardCellData {
  const { cardId, cardType, name, color, icon, x, y } = opts;
  const stroke = darken(color);
  const cellId = `card-${cardId.slice(0, 8)}-${Date.now()}`;

  const style = [
    "rounded=1",
    "whiteSpace=wrap",
    "html=1",
    `fillColor=${color}`,
    `fontColor=${readableTextColor(color)}`,
    `strokeColor=${stroke}`,
    "fontSize=12",
    "fontStyle=1",
    "arcSize=12",
    "shadow=1",
    ...iconStyleParts(icon),
  ].join(";");

  return {
    cellId,
    label: name,
    cardId,
    cardType,
    x,
    y,
    width: 210,
    height: 60,
    style,
  };
}

/**
 * Insert a card shape directly into the DrawIO graph via same-origin
 * iframe access.  Returns true on success, false if the graph isn't ready.
 */
export function insertCardIntoGraph(
  iframe: HTMLIFrameElement,
  data: CardCellData
): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = iframe.contentWindow as any;
    if (!win) return false;

    // Obtain the graph.  After DrawIO init the reference is stored by our
    // bootstrap (see DiagramEditor's init handler) on window.__turboGraph.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const graph: any = win.__turboGraph;
    if (!graph) return false;

    const model = graph.getModel();
    const parent = graph.getDefaultParent();

    // Create the user-object in an XML document — NOT the HTML document.
    // Using iframe.contentDocument.createElement("object") produces an
    // HTMLObjectElement which mxGraph's XML codec silently drops during
    // serialization, causing labels and custom attributes to be lost.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const xmlDoc = (win.mxUtils as any).createXmlDocument();
    const obj = xmlDoc.createElement("object");
    obj.setAttribute("label", data.label);
    obj.setAttribute("cardId", data.cardId);
    obj.setAttribute("cardType", data.cardType);

    model.beginUpdate();
    try {
      graph.insertVertex(
        parent,
        data.cellId,
        obj,
        data.x,
        data.y,
        data.width,
        data.height,
        data.style
      );
    } finally {
      model.endUpdate();
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Return the graph-space coordinates of the center of the currently visible
 * portion of the DrawIO canvas.  Useful as a fallback insertion position.
 */
export function getVisibleCenter(iframe: HTMLIFrameElement): { x: number; y: number } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = iframe.contentWindow as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const graph: any = win?.__turboGraph;
    if (!graph) return null;

    const container = graph.container as HTMLElement;
    const s = graph.view.scale as number;
    const tr = graph.view.translate as { x: number; y: number };

    const cx = (container.scrollLeft + container.clientWidth / 2) / s - tr.x;
    const cy = (container.scrollTop + container.clientHeight / 2) / s - tr.y;

    return { x: Math.round(cx), y: Math.round(cy) };
  } catch {
    return null;
  }
}

/**
 * Parse diagram XML and return the set of cardId values found.
 * Used client-side for display; the backend does its own authoritative parse.
 */
export function extractCardIds(xml: string): string[] {
  const ids: string[] = [];
  const re = /cardId="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

/* ------------------------------------------------------------------ */
/*  Pending (unsynchronised) cell helpers                              */
/* ------------------------------------------------------------------ */

/** Style for a pending (not-yet-synced) card cell — dashed border */
function buildPendingStyle(color: string, icon?: string): string {
  const stroke = darken(color);
  return [
    "rounded=1", "whiteSpace=wrap", "html=1",
    `fillColor=${color}`, `fontColor=${readableTextColor(color)}`,
    `strokeColor=${stroke}`, "fontSize=12",
    "fontStyle=1", "arcSize=12",
    "dashed=1", "dashPattern=5 3",
    ...iconStyleParts(icon),
  ].join(";");
}

/** Style for a synced (normal) card cell */
function buildSyncedStyle(color: string, icon?: string): string {
  const stroke = darken(color);
  return [
    "rounded=1", "whiteSpace=wrap", "html=1",
    `fillColor=${color}`, `fontColor=${readableTextColor(color)}`,
    `strokeColor=${stroke}`, "fontSize=12",
    "fontStyle=1", "arcSize=12", "shadow=1",
    ...iconStyleParts(icon),
  ].join(";");
}

/**
 * Insert a pending (not-yet-synced) card cell.
 * Uses a dashed border to distinguish it from synced cells.
 */
export function insertPendingCard(
  iframe: HTMLIFrameElement,
  opts: {
    tempId: string;
    type: string;
    name: string;
    color: string;
    icon?: string;
    x: number;
    y: number;
  },
): string | null {
  const ctx = getMxGraph(iframe);
  if (!ctx) return null;
  const { win, graph } = ctx;

  const model = graph.getModel();
  const parent = graph.getDefaultParent();
  const cellId = `pfs-${Date.now()}`;

  const xmlDoc = win.mxUtils.createXmlDocument();
  const obj = xmlDoc.createElement("object");
  obj.setAttribute("label", opts.name);
  obj.setAttribute("cardId", opts.tempId);
  obj.setAttribute("cardType", opts.type);
  obj.setAttribute("pending", "1");

  model.beginUpdate();
  try {
    graph.insertVertex(
      parent,
      cellId,
      obj,
      opts.x,
      opts.y,
      210,
      60,
      buildPendingStyle(opts.color, opts.icon),
    );
  } finally {
    model.endUpdate();
  }
  return cellId;
}

/**
 * After the user draws an edge between two FS cells and picks a relation type,
 * stamp the edge with relation metadata and apply entity-relation style.
 */
export function stampEdgeAsRelation(
  iframe: HTMLIFrameElement,
  edgeCellId: string,
  relationType: string,
  relationLabel: string,
  color: string,
  pending: boolean,
): boolean {
  const ctx = getMxGraph(iframe);
  if (!ctx) return false;
  const { win, graph } = ctx;

  const model = graph.getModel();
  const edge = model.getCell(edgeCellId);
  if (!edge) return false;

  model.beginUpdate();
  try {
    // Replace user object with rich metadata
    const xmlDoc = win.mxUtils.createXmlDocument();
    const obj = xmlDoc.createElement("object");
    obj.setAttribute("label", relationLabel);
    obj.setAttribute("relationType", relationType);
    if (pending) obj.setAttribute("pending", "1");
    model.setValue(edge, obj);

    const dash = pending ? "dashed=1;dashPattern=5 3;" : "";
    const style =
      `edgeStyle=entityRelationEdgeStyle;strokeColor=${color};strokeWidth=1.5;` +
      `endArrow=none;startArrow=none;fontSize=10;fontColor=#666;${dash}`;
    graph.setCellStyles("edgeStyle", "entityRelationEdgeStyle", [edge]);
    model.setStyle(edge, style);
  } finally {
    model.endUpdate();
  }
  return true;
}

/**
 * Mark a pending cell as synced: update its cardId to the real one
 * and switch from dashed to solid style.
 */
export function markCellSynced(
  iframe: HTMLIFrameElement,
  cellId: string,
  realCardId: string,
  color: string,
): boolean {
  const ctx = getMxGraph(iframe);
  if (!ctx) return false;
  const { graph } = ctx;

  const model = graph.getModel();
  const cell = model.getCell(cellId);
  if (!cell) return false;

  model.beginUpdate();
  try {
    const obj = cell.value;
    if (obj?.setAttribute) {
      obj.setAttribute("cardId", realCardId);
      if (obj.removeAttribute) obj.removeAttribute("pending");
    }
    // Carry the pending cell's icon tokens across the dashed→solid restyle.
    const carried = iconTokensFromStyle((model.getStyle(cell) || "") as string);
    const base = buildSyncedStyle(color);
    model.setStyle(cell, carried.length ? `${base};${carried.join(";")}` : base);
  } finally {
    model.endUpdate();
  }
  return true;
}

/**
 * Mark a pending relation edge as synced (remove dashed style).
 * Optionally stamps the edge with the real backend relation id so that
 * canvas deletions can fire a DELETE /relations/{id}.
 */
export function markEdgeSynced(
  iframe: HTMLIFrameElement,
  edgeCellId: string,
  color: string,
  relationId?: string,
): boolean {
  const ctx = getMxGraph(iframe);
  if (!ctx) return false;
  const { graph } = ctx;

  const model = graph.getModel();
  const edge = model.getCell(edgeCellId);
  if (!edge) return false;

  model.beginUpdate();
  try {
    const obj = edge.value;
    if (obj?.removeAttribute) obj.removeAttribute("pending");
    if (relationId && obj?.setAttribute) obj.setAttribute("relationId", relationId);
    const style =
      `edgeStyle=entityRelationEdgeStyle;strokeColor=${color};strokeWidth=1.5;` +
      `endArrow=none;startArrow=none;fontSize=10;fontColor=#666;`;
    model.setStyle(edge, style);
  } finally {
    model.endUpdate();
  }
  return true;
}

/**
 * Update a cell's label (e.g. after accepting an inventory name change).
 */
export function updateCellLabel(
  iframe: HTMLIFrameElement,
  cellId: string,
  newLabel: string,
): boolean {
  const ctx = getMxGraph(iframe);
  if (!ctx) return false;
  const { graph } = ctx;

  const model = graph.getModel();
  const cell = model.getCell(cellId);
  if (!cell) return false;

  model.beginUpdate();
  try {
    if (cell.value?.setAttribute) {
      cell.value.setAttribute("label", newLabel);
    }
    graph.refresh(cell);
  } finally {
    model.endUpdate();
  }
  return true;
}

/**
 * Remove a cell (vertex or edge) and its connected edges from the graph.
 */
export function removeDiagramCell(
  iframe: HTMLIFrameElement,
  cellId: string,
): boolean {
  const ctx = getMxGraph(iframe);
  if (!ctx) return false;
  const { graph } = ctx;

  const cell = graph.getModel().getCell(cellId);
  if (!cell) return false;

  graph.removeCells([cell], true);
  return true;
}

export interface ScannedPendingFS {
  cellId: string;
  tempId: string;
  type: string;
  name: string;
}

export interface ScannedPendingRel {
  edgeCellId: string;
  relationType: string;
  relationLabel: string;
  sourceCardId: string;
  targetCardId: string;
  sourceName: string;
  targetName: string;
}

export interface ScannedSyncedFS {
  cellId: string;
  cardId: string;
  name: string;
  type: string;
}

/**
 * Scan the graph for pending and synced items.
 */
export function scanDiagramItems(iframe: HTMLIFrameElement): {
  pendingCards: ScannedPendingFS[];
  pendingRels: ScannedPendingRel[];
  syncedFS: ScannedSyncedFS[];
} {
  const pendingCards: ScannedPendingFS[] = [];
  const pendingRels: ScannedPendingRel[] = [];
  const syncedFS: ScannedSyncedFS[] = [];

  const ctx = getMxGraph(iframe);
  if (!ctx) return { pendingCards, pendingRels, syncedFS };
  const { graph } = ctx;

  const cells = graph.getModel().cells || {};
  for (const k of Object.keys(cells)) {
    const cell = cells[k];
    if (!cell?.value?.getAttribute) continue;

    const isPending = cell.value.getAttribute("pending") === "1";
    const fsId = cell.value.getAttribute("cardId");
    const relType = cell.value.getAttribute("relationType");

    if (relType && isPending) {
      // Pending relation edge
      const src = graph.getModel().getTerminal(cell, true);
      const tgt = graph.getModel().getTerminal(cell, false);
      pendingRels.push({
        edgeCellId: cell.id,
        relationType: relType,
        relationLabel: cell.value.getAttribute("label") || relType,
        sourceCardId: src?.value?.getAttribute?.("cardId") || "",
        targetCardId: tgt?.value?.getAttribute?.("cardId") || "",
        sourceName: src?.value?.getAttribute?.("label") || "?",
        targetName: tgt?.value?.getAttribute?.("label") || "?",
      });
    } else if (fsId && isPending) {
      // Pending card vertex
      pendingCards.push({
        cellId: cell.id,
        tempId: fsId,
        type: cell.value.getAttribute("cardType") || "",
        name: cell.value.getAttribute("label") || "",
      });
    } else if (fsId && !isPending && !cell.value.getAttribute("parentGroupCell")) {
      // Synced top-level card vertex
      syncedFS.push({
        cellId: cell.id,
        cardId: fsId,
        name: cell.value.getAttribute("label") || "",
        type: cell.value.getAttribute("cardType") || "",
      });
    }
  }

  return { pendingCards, pendingRels, syncedFS };
}

/** SVG data URI for the "out of sync" resync overlay icon (orange !) */
const RESYNC_OVERLAY = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">' +
    '<circle cx="10" cy="10" r="9" fill="#ff9800" stroke="#e65100" stroke-width="1"/>' +
    '<rect x="9" y="5" width="2" height="7" rx="1" fill="#fff"/>' +
    '<circle cx="10" cy="14.5" r="1.2" fill="#fff"/>' +
    '</svg>',
)}`;

/** SVG data URI for the + overlay icon */
const PLUS_OVERLAY = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">' +
    '<circle cx="10" cy="10" r="9" fill="rgba(255,255,255,0.9)" stroke="rgba(0,0,0,0.25)" stroke-width="1"/>' +
    '<path d="M10 5v10M5 10h10" stroke="rgba(0,0,0,0.55)" stroke-width="2" stroke-linecap="round"/>' +
    '</svg>',
)}`;

/** SVG data URI for the − overlay icon */
const MINUS_OVERLAY = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">' +
    '<circle cx="10" cy="10" r="9" fill="rgba(255,255,255,0.9)" stroke="rgba(0,0,0,0.25)" stroke-width="1"/>' +
    '<path d="M5 10h10" stroke="rgba(0,0,0,0.55)" stroke-width="2" stroke-linecap="round"/>' +
    '</svg>',
)}`;

/** SVG data URI for the chevron overlay (replaces +/− with a richer menu) */
const CHEVRON_OVERLAY = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">' +
    '<circle cx="10" cy="10" r="9" fill="rgba(255,255,255,0.95)" stroke="rgba(0,0,0,0.3)" stroke-width="1"/>' +
    '<path d="M6 8l4 4 4-4" stroke="rgba(0,0,0,0.65)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' +
    '</svg>',
)}`;

const CHILD_CARD_W = 190;
const CHILD_CARD_H = 40;
const CHILD_GAP_Y = 10;
const CHILD_GAP_X = 60;
const TYPE_GROUP_GAP = 16;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMxGraph(iframe: HTMLIFrameElement): { win: any; graph: any } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = iframe.contentWindow as any;
    const graph = win?.__turboGraph;
    return graph ? { win, graph } : null;
  } catch {
    return null;
  }
}

export interface ExpandChildData {
  id: string;
  name: string;
  type: string;
  color: string;
  /** Card-type Material Symbols icon name. Optional. */
  icon?: string;
  relationType: string;
  /** Backend relation id, when known. Stamped onto the connecting edge so
   *  canvas deletions can fire `DELETE /relations/{id}`. */
  relationId?: string;
}

/**
 * Add a +/− overlay icon to a card cell.
 */
export function addExpandOverlay(
  iframe: HTMLIFrameElement,
  cellId: string,
  expanded: boolean,
  onClick: () => void,
): boolean {
  const ctx = getMxGraph(iframe);
  if (!ctx) return false;
  const { win, graph } = ctx;

  const cell = graph.getModel().getCell(cellId);
  if (!cell) return false;

  graph.removeCellOverlays(cell);

  // Sit on the card's right edge but lifted above the vertical centre, so the
  // affordance clears mxGraph's East connection arrow while the enlarged hit
  // target keeps it easy to click.
  const overlay = new win.mxCellOverlay(
    new win.mxImage(expanded ? MINUS_OVERLAY : PLUS_OVERLAY, 24, 24),
    expanded ? "Collapse" : "Expand related cards",
    win.mxConstants.ALIGN_RIGHT,
    win.mxConstants.ALIGN_MIDDLE,
    new win.mxPoint(0, -14),
  );
  overlay.cursor = "pointer";
  overlay.addListener(win.mxEvent.CLICK, () => onClick());

  graph.addCellOverlay(cell, overlay);
  return true;
}

/**
 * Insert child vertices + edges around a parent card cell.
 * Children are laid out in a column to the right, grouped by type.
 */
/** Edge metadata threaded back from expansion helpers so the editor can
 *  populate its cellId → relation-meta side-table. */
export interface ExpandedEdgeInfo {
  cellId: string;
  cardId: string;
  edgeCellId: string;
  relationId?: string;
  relationType?: string;
  relationLabel?: string;
}

export function expandCardGroup(
  iframe: HTMLIFrameElement,
  parentCellId: string,
  children: ExpandChildData[],
): ExpandedEdgeInfo[] {
  const ctx = getMxGraph(iframe);
  if (!ctx) return [];
  const { win, graph } = ctx;

  const model = graph.getModel();
  const root = graph.getDefaultParent();
  const parentCell = model.getCell(parentCellId);
  if (!parentCell) return [];

  const geo = graph.getCellGeometry(parentCell);
  if (!geo) return [];

  // Compute total height with gaps between type groups
  let totalH = 0;
  for (let i = 0; i < children.length; i++) {
    if (i > 0) {
      totalH += children[i].type !== children[i - 1].type ? TYPE_GROUP_GAP : CHILD_GAP_Y;
    }
    totalH += CHILD_CARD_H;
  }

  const startX = geo.x + geo.width + CHILD_GAP_X;
  const startY = geo.y + geo.height / 2 - totalH / 2;

  const inserted: ExpandedEdgeInfo[] = [];
  model.beginUpdate();
  try {
    let yOff = 0;
    for (let i = 0; i < children.length; i++) {
      if (i > 0) {
        yOff += children[i].type !== children[i - 1].type ? TYPE_GROUP_GAP : CHILD_GAP_Y;
      }
      const ch = children[i];
      const cid = `fsg-${ch.id.slice(0, 8)}-${Date.now()}-${i}`;
      const edgeCellId = `fse-${cid}`;
      const stroke = darken(ch.color);
      const style = [
        "rounded=1", "whiteSpace=wrap", "html=1",
        `fillColor=${ch.color}`, `fontColor=${readableTextColor(ch.color)}`,
        `strokeColor=${stroke}`, "fontSize=11",
        "fontStyle=1", "arcSize=12",
        ...iconStyleParts(ch.icon),
      ].join(";");

      const xmlDoc = win.mxUtils.createXmlDocument();
      const obj = xmlDoc.createElement("object");
      obj.setAttribute("label", ch.name);
      obj.setAttribute("cardId", ch.id);
      obj.setAttribute("cardType", ch.type);
      obj.setAttribute("parentGroupCell", parentCellId);

      const vertex = graph.insertVertex(
        root, cid, obj, startX, startY + yOff, CHILD_CARD_W, CHILD_CARD_H, style,
      );

      // Stamp the connecting edge with the backend relation id (when known)
      // so canvas-side deletions can fire DELETE /relations/{id}. Insert
      // with an empty value first, then setValue so the XML user-object
      // survives mxGraph's silent string-coercion of the insertEdge value.
      // The editor also maintains a cellId → relation-meta side-table as
      // the authoritative source for in-session deletes, since DrawIO
      // sometimes drops user-object attributes on edges created inside an
      // open transaction.
      const edge = graph.insertEdge(
        root, edgeCellId, "",
        parentCell, vertex,
        `edgeStyle=entityRelationEdgeStyle;strokeColor=${ch.color};strokeWidth=1.5;endArrow=none;startArrow=none`,
      );
      const edgeObj = xmlDoc.createElement("object");
      edgeObj.setAttribute("label", "");
      if (ch.relationType) edgeObj.setAttribute("relationType", ch.relationType);
      if (ch.relationId) edgeObj.setAttribute("relationId", ch.relationId);
      model.setValue(edge, edgeObj);

      inserted.push({
        cellId: cid,
        cardId: ch.id,
        edgeCellId,
        relationId: ch.relationId,
        relationType: ch.relationType,
      });
      yOff += CHILD_CARD_H;
    }

    const pv = parentCell.value;
    if (pv?.setAttribute) {
      pv.setAttribute("expanded", "1");
      pv.setAttribute("childCellIds", inserted.map((c) => c.cellId).join(","));
    }
  } finally {
    model.endUpdate();
  }

  return inserted;
}

/**
 * Remove all descendant cells (and their edges) belonging to a parent group.
 * Recurses into children that are themselves expanded, so nested expansions
 * are cleaned up correctly.
 */
/**
 * Remove all descendant cells (and their edges) belonging to a parent group.
 * Recurses into children that are themselves expanded, so nested expansions
 * are cleaned up correctly.
 *
 * Returns the cellIds of every cell that was actually removed (vertices
 * AND their connecting edges). Callers need this so they can scrub
 * matching entries from their own side-tables (e.g. the editor's
 * edgeRelationMap) — otherwise the diff-based edge-deletion detector
 * would mistake a collapse for a user delete and prompt the confirm
 * dialog for every edge that disappeared.
 */
export function collapseCardGroup(
  iframe: HTMLIFrameElement,
  parentCellId: string,
): { removedCellIds: string[] } {
  const ctx = getMxGraph(iframe);
  if (!ctx) return { removedCellIds: [] };
  const { graph } = ctx;

  const model = graph.getModel();
  const parentCell = model.getCell(parentCellId);
  if (!parentCell) return { removedCellIds: [] };

  const cells = model.cells || {};

  // Build parent→children index so we can walk the tree
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const childrenOf = new Map<string, any[]>();
  for (const k of Object.keys(cells)) {
    const c = cells[k];
    const pgc = c?.value?.getAttribute?.("parentGroupCell");
    if (pgc) {
      if (!childrenOf.has(pgc)) childrenOf.set(pgc, []);
      childrenOf.get(pgc)!.push(c);
    }
  }

  // Collect all descendants recursively
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toRemove: any[] = [];
  const queue = [parentCellId];
  while (queue.length > 0) {
    const pid = queue.shift()!;
    for (const c of childrenOf.get(pid) || []) {
      toRemove.push(c);
      queue.push(c.id);
    }
  }

  if (toRemove.length === 0) return { removedCellIds: [] };

  // Compute the full set of cellIds that mxGraph will actually remove —
  // `removeCells(toRemove, true)` also collects every edge connected to
  // any cell in `toRemove`. We need those edge cellIds to scrub the
  // editor's side-table.
  const removedSet = new Set<string>();
  const collectEdges = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cell: any,
  ) => {
    if (!cell?.edges) return;
    for (const e of cell.edges) {
      if (e?.id) removedSet.add(e.id);
    }
  };
  for (const c of toRemove) {
    if (c.id) removedSet.add(c.id);
    collectEdges(c);
  }

  model.beginUpdate();
  try {
    graph.removeCells(toRemove, true);
    const pv = parentCell.value;
    if (pv?.setAttribute) {
      pv.setAttribute("expanded", "0");
      if (pv.removeAttribute) pv.removeAttribute("childCellIds");
    }
  } finally {
    model.endUpdate();
  }

  return { removedCellIds: Array.from(removedSet) };
}

/**
 * Scan all cells and add expand/collapse overlays to every card cell
 * (including children from previous expansions).
 *
 * For collapsed cells we render a chevron that opens the per-relation-type
 * ExpandMenu (Phase 3). For already-expanded cells we keep the minus icon
 * so the user can collapse with one click.
 */
export function refreshCardOverlays(
  iframe: HTMLIFrameElement,
  onCollapse: (cellId: string, cardId: string) => void,
  onChevron: (cellId: string, cardId: string, anchor: { x: number; y: number }) => void,
): void {
  const ctx = getMxGraph(iframe);
  if (!ctx) return;
  const { graph } = ctx;

  const cells = graph.getModel().cells || {};

  // Detect which parent cells actually have children present in the graph
  const parentsWithChildren = new Set<string>();
  for (const k of Object.keys(cells)) {
    const pgc = cells[k]?.value?.getAttribute?.("parentGroupCell");
    if (pgc) parentsWithChildren.add(pgc);
  }

  for (const k of Object.keys(cells)) {
    const cell = cells[k];
    if (!cell?.value?.getAttribute) continue;

    const fsId = cell.value.getAttribute("cardId");
    if (!fsId) continue;
    if (fsId.startsWith("pending-")) continue; // pending cells get the chevron only after sync

    let expanded = cell.value.getAttribute("expanded") === "1";
    // If marked expanded but children were deleted, treat as collapsed
    if (expanded && !parentsWithChildren.has(cell.id)) expanded = false;

    if (expanded) {
      addExpandOverlay(iframe, cell.id, true, () => onCollapse(cell.id, fsId));
    } else {
      addChevronOverlay(iframe, cell.id, (anchor) => onChevron(cell.id, fsId, anchor));
    }
  }
}

/**
 * Return the set of cardId values for children currently connected to a
 * parent cell.  A child is "connected" only if its vertex is still present AND
 * it still has at least one edge linking it to the parent.  This catches both
 * vertex deletions (user deleted the child) and edge-only deletions (user
 * deleted the relation line but left the child shape).
 */
export function getGroupChildCardIds(
  iframe: HTMLIFrameElement,
  parentCellId: string,
): Set<string> {
  const ctx = getMxGraph(iframe);
  if (!ctx) return new Set();
  const { graph } = ctx;

  const model = graph.getModel();
  const parentCell = model.getCell(parentCellId);
  if (!parentCell) return new Set();

  const result = new Set<string>();
  const cells = model.cells || {};
  for (const k of Object.keys(cells)) {
    const c = cells[k];
    if (c?.value?.getAttribute?.("parentGroupCell") !== parentCellId) continue;
    const fsId = c.value.getAttribute("cardId");
    if (!fsId) continue;

    // Verify the child still has an edge to the parent
    const edges = graph.getEdgesBetween(parentCell, c, false);
    if (edges && edges.length > 0) {
      result.add(fsId);
    }
  }
  return result;
}

/**
 * Add a resync overlay (orange "!" icon) at the top-left of a card cell.
 * Indicates the cell's expanded children are out of sync with inventory.
 * Must be called AFTER addExpandOverlay (which clears all overlays first).
 */
export function addResyncOverlay(
  iframe: HTMLIFrameElement,
  cellId: string,
  onClick: () => void,
): boolean {
  const ctx = getMxGraph(iframe);
  if (!ctx) return false;
  const { win, graph } = ctx;

  const cell = graph.getModel().getCell(cellId);
  if (!cell) return false;

  const overlay = new win.mxCellOverlay(
    new win.mxImage(RESYNC_OVERLAY, 18, 18),
    "Restore removed relations (click to resync)",
    win.mxConstants.ALIGN_LEFT,
    win.mxConstants.ALIGN_TOP,
    new win.mxPoint(0, 0),
  );
  overlay.cursor = "pointer";
  overlay.addListener(win.mxEvent.CLICK, () => onClick());

  graph.addCellOverlay(cell, overlay);
  return true;
}

/* ------------------------------------------------------------------ */
/*  Cell lifecycle (paste/duplicate dedup + deletion tombstones)       */
/* ------------------------------------------------------------------ */

/** Tombstone surfaced by the lifecycle listener for an INTENTIONAL
 *  user removal of a relation edge. Card removals are not tombstoned
 *  any more — deleting a card from the canvas is treated as a
 *  visual-only "I don't want to see this here" gesture; real
 *  inventory archival is done from the Inventory page. */
export interface RemovedRelationTombstone {
  kind: "relation";
  edgeCellId: string;
  relationId: string;
  relationType: string;
  /** Human-readable label for the confirmation dialog. */
  relationLabel: string;
  sourceName: string;
  targetName: string;
  /** Captured at removal time so a "No, abort" confirmation can re-insert
   *  the edge between the same vertices with the same style. */
  sourceCellId: string | null;
  targetCellId: string | null;
  style: string;
  /** Actual visible text on the edge before deletion. */
  edgeLabel?: string;
}

/** Backwards-compat alias kept so consumers don't need to be edited
 *  in lock-step. New code should reference RemovedRelationTombstone
 *  directly. */
export type RemovedTombstone = RemovedRelationTombstone;

export interface ResolvedRelationMeta {
  relationId: string;
  relationType: string;
  /** Human-readable label for the confirmation dialog (e.g. "uses"). */
  relationLabel: string;
  sourceName: string;
  targetName: string;
  /** Endpoint cellIds captured at registration time so the
   *  abort-deletion path can re-insert the edge between the same
   *  vertices, even when the deletion was detected via the periodic
   *  side-table diff instead of a live CELLS_REMOVED event. */
  sourceCellId?: string | null;
  targetCellId?: string | null;
  /** Style captured at registration time; falls back to a sane
   *  default in restoreRemovedEdge when missing. */
  style?: string;
  /** The actual visible text on the edge at registration time. Used
   *  by restoreRemovedEdge so the re-inserted edge looks identical to
   *  the original — Show-Dependency edges normally have label="" and
   *  shouldn't suddenly show the relation type key after a restore. */
  edgeLabel?: string;
}

export interface CellLifecycleHandlers {
  onDuplicate: (cellId: string, sharedCardId: string, wasPending: boolean) => void;
  /** Fired for EVERY relation edge the user intentionally removed.
   *  Card removals are NOT surfaced — they're treated as visual-only
   *  "remove from this diagram" gestures; archival is an inventory
   *  responsibility. Edges whose endpoint card was removed in the
   *  same batch (incidental removal) go through onIncidentalEdgeRemoval
   *  instead so the editor's side-table is cleaned without prompting
   *  the user for each hanging edge. */
  onRemoved: (tombstones: RemovedRelationTombstone[]) => void;
  /** Returns the set of cellIds we have deliberately inserted ourselves.
   *  Any cell with a cardId attribute whose cellId is NOT in this set is
   *  treated as a paste/clone and routed through onDuplicate. */
  isRegistered: (cellId: string) => boolean;
  /** Optional fallback resolver for edges where the XML user-object
   *  doesn't expose `relationId`. DrawIO occasionally drops or never
   *  serialises user-object attributes for edges inserted inside an open
   *  `beginUpdate / endUpdate` transaction — the editor maintains its own
   *  cellId → metadata map so deletion sync stays reliable. */
  getRelationIdForEdge?: (cellId: string) => ResolvedRelationMeta | null;
  /** Called once per edge that was removed alongside its endpoint card
   *  in the same batch (the edge was "incidental" to a card removal).
   *  The editor uses this to clean its cellId → relation-meta side-
   *  table so the periodic diff scan doesn't later re-surface the edge
   *  as a fresh tombstone the user would have to dismiss. */
  onIncidentalEdgeRemoval?: (edgeCellId: string) => void;
}

/**
 * Hook the graph model so we can:
 *   - detect copy/paste/duplicate adding a cell that reuses an existing
 *     cardId, and call onDuplicate so the parent can either regenerate the
 *     temp id (pending clone) or strip the cardId (synced clone). We use
 *     a "is this cellId one we deliberately inserted" check rather than
 *     "is this cardId duplicated in the model" — DrawIO's clipboard goes
 *     through paths that don't always end up in CELLS_ADDED, and the
 *     registered-set check stays correct even when our listener missed
 *     the synchronous event.
 *   - detect cell removals carrying a real cardId / relationId so the parent
 *     can tombstone them for the next sync.
 *
 * Returns a cleanup function that removes the listeners.
 */
export function attachCellLifecycleListeners(
  iframe: HTMLIFrameElement,
  handlers: CellLifecycleHandlers,
): () => void {
  const ctx = getMxGraph(iframe);
  if (!ctx) return () => {};
  const { win, graph } = ctx;
  const model = graph.getModel();

  /** Fire onDuplicate for any card cell whose cellId we don't recognise. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const checkCell = (cell: any) => {
    if (!cell?.value?.getAttribute) return;
    if (cell.edge) return;
    // Cells nested inside containers (expansion / drill-down / roll-up)
    // are managed by their parent and must not be treated as paste
    // candidates — their cardId is intentional, not a clone.
    if (cell.value.getAttribute("parentGroupCell")) return;
    if (cell.value.getAttribute("drillDownChild") === "1") return;
    if (cell.value.getAttribute("rollUpChild") === "1") return;
    const cardId = cell.value.getAttribute("cardId");
    if (!cardId) return;
    if (handlers.isRegistered(cell.id)) return;
    const wasPending = cell.value.getAttribute("pending") === "1";
    handlers.onDuplicate(cell.id, cardId, wasPending);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const addedListener = (_sender: unknown, evt: any) => {
    const cells = evt.getProperty("cells") || [];
    if (cells.length === 0) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const cell of cells as any[]) checkCell(cell);
  };

  // Edge cellIds we've programmatically scheduled to remove as a
  // cascade of a card removal. The next CELLS_REMOVED for them is
  // treated as silent (no confirm dialog, no tombstone, side-table
  // cleaned), because the user already explicitly removed the card
  // and we shouldn't pester them about every connected edge.
  const pendingIncidentalEdgeRemovals = new Set<string>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const removedListener = (_sender: unknown, evt: any) => {
    const cells = evt.getProperty("cells") || [];
    if (cells.length === 0) return;
    // eslint-disable-next-line no-console
    console.debug("[turbo-ea] CELLS_REMOVED", {
      count: cells.length,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cells: (cells as any[]).map((c) => ({
        id: c?.id,
        edge: !!c?.edge,
        cardId: c?.value?.getAttribute?.("cardId"),
        label: c?.value?.getAttribute?.("label"),
      })),
    });

    // Pre-pass: collect cellIds of every VERTEX being removed in this
    // batch (not just card vertices). Unlinked stubs + plain DrawIO
    // shapes connected to cards should also cascade-clean their
    // dangling edges; if they don't carry a cardId we still want
    // their connected edges to disappear with them.
    const removedVertexCellIds = new Set<string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const cell of cells as any[]) {
      if (cell?.edge) continue;
      // Skip layer / root cells.
      const cid = cell?.id;
      if (cid === "0" || cid === "1") continue;
      removedVertexCellIds.add(cid);
    }

    const tombstones: RemovedRelationTombstone[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const cell of cells as any[]) {
      // Card vertices are intentionally NOT tombstoned. Removing a card
      // from the diagram is treated as a visual-only "I don't want to
      // see this here" gesture; inventory archival is a job for the
      // Inventory page.
      if (!cell?.edge) continue;

      // Cascade-removed edges that we scheduled ourselves get the
      // silent treatment. Without this, the second CELLS_REMOVED wave
      // (when the cascade actually executes) would re-fire the confirm
      // dialog because the card is no longer in this batch.
      if (pendingIncidentalEdgeRemovals.has(cell.id)) {
        pendingIncidentalEdgeRemovals.delete(cell.id);
        handlers.onIncidentalEdgeRemoval?.(cell.id);
        continue;
      }

      // Resolve relation metadata via the XML user-object first, then
      // the editor's side-table fallback.
      const value = cell.value;
      let relationId: string | null = null;
      let relationType = "";
      let relationLabel = "";
      let edgeLabel: string | undefined;
      let metaSrcCellId: string | null = null;
      let metaTgtCellId: string | null = null;
      let metaStyle: string | undefined;
      if (value?.getAttribute) {
        relationId = value.getAttribute("relationId");
        relationType = value.getAttribute("relationType") || "";
        edgeLabel = value.getAttribute("label") || "";
        relationLabel = edgeLabel || relationType;
      }
      let srcName = "";
      let tgtName = "";
      if (!relationId && handlers.getRelationIdForEdge) {
        const meta = handlers.getRelationIdForEdge(cell.id);
        if (meta) {
          relationId = meta.relationId;
          relationType = meta.relationType;
          relationLabel = meta.relationLabel;
          srcName = meta.sourceName;
          tgtName = meta.targetName;
          edgeLabel = meta.edgeLabel;
          metaSrcCellId = meta.sourceCellId ?? null;
          metaTgtCellId = meta.targetCellId ?? null;
          metaStyle = meta.style;
        }
      }
      if (!relationId) continue;

      // Incidental: an endpoint of this edge was also removed in the
      // same batch. The user clearly meant "remove this card from my
      // view" rather than "delete this relation from inventory" — so
      // we silently drop the side-table entry without surfacing the
      // confirm dialog. The relation stays alive in the backend, the
      // card stays in inventory; only the canvas is decluttered.
      const srcCell = cell.source;
      const tgtCell = cell.target;
      // Incidental if an endpoint is in the current batch OR if an
      // endpoint cell is no longer in the model at all (it was
      // removed in an earlier tick / a separate transaction). Either
      // way the user clearly meant "remove this card from my view",
      // not "delete this relation from inventory".
      const srcMissing =
        !srcCell?.id || (!removedVertexCellIds.has(srcCell.id) && !model.getCell(srcCell.id));
      const tgtMissing =
        !tgtCell?.id || (!removedVertexCellIds.has(tgtCell.id) && !model.getCell(tgtCell.id));
      const incidental =
        (srcCell?.id && removedVertexCellIds.has(srcCell.id)) ||
        (tgtCell?.id && removedVertexCellIds.has(tgtCell.id)) ||
        srcMissing ||
        tgtMissing;
      if (incidental) {
        handlers.onIncidentalEdgeRemoval?.(cell.id);
        continue;
      }

      const srcLabel: string =
        srcName ||
        srcCell?.value?.getAttribute?.("label") ||
        (typeof srcCell?.value === "string" ? srcCell.value : "") ||
        "";
      const tgtLabel: string =
        tgtName ||
        tgtCell?.value?.getAttribute?.("label") ||
        (typeof tgtCell?.value === "string" ? tgtCell.value : "") ||
        "";
      const liveStyle = String(model.getStyle(cell) || "");
      tombstones.push({
        kind: "relation",
        edgeCellId: cell.id,
        relationId,
        relationType,
        relationLabel,
        sourceName: String(srcLabel),
        targetName: String(tgtLabel),
        sourceCellId: srcCell?.id ?? metaSrcCellId,
        targetCellId: tgtCell?.id ?? metaTgtCellId,
        // Prefer the live style (still on the cell at removal time);
        // fall back to whatever the side-table captured at register.
        style: liveStyle || metaStyle || "",
        edgeLabel,
      });
    }
    if (tombstones.length > 0) handlers.onRemoved(tombstones);

    // Post-pass: cascade edge removal when DrawIO removed ONLY the
    // vertex cells and left their connected edges dangling. mxGraph's
    // `removeCells(cells, includeEdges=true)` should normally cascade,
    // but DrawIO sometimes routes deletes through a path that doesn't
    // include edges — leaving the edges visible but pointing at a
    // non-existent vertex.
    if (removedVertexCellIds.size > 0) {
      const allCells = model.cells || {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dangling: any[] = [];
      for (const k of Object.keys(allCells)) {
        const c = allCells[k];
        if (!c?.edge) continue;
        // Edge references its source/target via mxCell.source /
        // .target — those object refs still point at the just-
        // removed vertex cells (their .id is what we matched on).
        const srcId = c.source?.id;
        const tgtId = c.target?.id;
        if (
          (srcId && removedVertexCellIds.has(srcId)) ||
          (tgtId && removedVertexCellIds.has(tgtId))
        ) {
          dangling.push(c);
        }
      }
      // eslint-disable-next-line no-console
      console.debug("[turbo-ea] post-pass dangling-edge scan", {
        removedVertexCellIds: Array.from(removedVertexCellIds),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dangling: dangling.map((d) => ({ id: d.id, src: d.source?.id, tgt: d.target?.id })),
      });
      if (dangling.length > 0) {
        // Mark each as pending-incidental so the cascade's own
        // CELLS_REMOVED stays silent + drop their side-table entries
        // early so the diff scan can't fire phantom tombstones in the
        // window between this pre-clean and the actual removal.
        for (const e of dangling) {
          pendingIncidentalEdgeRemovals.add(e.id);
          handlers.onIncidentalEdgeRemoval?.(e.id);
        }
        setTimeout(() => {
          // Defensive: filter to only edges still in the model. The
          // user might have manually removed some in the meantime.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const stillThere = dangling.filter(
            (d) => model.getCell(d.id) === d,
          );
          // eslint-disable-next-line no-console
          console.debug("[turbo-ea] cascade-removing edges", {
            count: stillThere.length,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ids: stillThere.map((s) => s.id),
          });
          if (stillThere.length === 0) return;
          model.beginUpdate();
          try {
            // graph.removeCells should work, but try model.remove
            // directly as a belt-and-braces fallback in case DrawIO
            // intercepts graph.removeCells in a way that no-ops.
            try {
              graph.removeCells(stillThere, false);
            } catch {
              // Fall through to direct model.remove below.
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const e of stillThere) {
              if (model.getCell(e.id) === e) {
                try {
                  model.remove(e);
                } catch {
                  // ignore
                }
              }
            }
          } finally {
            model.endUpdate();
          }
        }, 0);
      }
    }
  };

  model.addListener(win.mxEvent.CELLS_ADDED, addedListener);
  // Attach CELLS_REMOVED on BOTH model and graph. mxGraph fires it on the
  // graph via `cellsRemoved()`; DrawIO sometimes also routes deletes
  // through the model. Card deletes in DrawIO go through the graph path
  // and never reach a model-level listener, so we listen on both.
  model.addListener(win.mxEvent.CELLS_REMOVED, removedListener);
  try {
    graph.addListener(win.mxEvent.CELLS_REMOVED, removedListener);
  } catch {
    // older mxGraph builds without graph-level CELLS_REMOVED
  }

  // Diff-based fallback. Some DrawIO delete paths fire neither
  // model.CELLS_REMOVED nor graph.CELLS_REMOVED in a form our handlers
  // see. We track every card / shape vertex we've seen and, on every
  // model CHANGE, detect which ones disappeared since last tick. The
  // synthesised removal then routes through the same `removedListener`
  // so cascade-edge-removal works for these paths too.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const knownVertexCells = new Map<string, any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const knownEdgeCells = new Map<string, any>();
  const seedKnownCells = () => {
    const allCells = model.cells || {};
    for (const k of Object.keys(allCells)) {
      const c = allCells[k];
      if (!c || c.id === "0" || c.id === "1") continue;
      if (c.edge) knownEdgeCells.set(c.id, c);
      else knownVertexCells.set(c.id, c);
    }
  };
  seedKnownCells();

  const synthesiseRemoval = () => {
    const allCells = model.cells || {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const goneVertices: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const goneEdges: any[] = [];
    for (const [id, cell] of knownVertexCells) {
      if (!allCells[id]) {
        goneVertices.push(cell);
      }
    }
    // Also detect edges that disappeared (their model entry is gone)
    // so we cover the case where DrawIO removed only the edge.
    // We need a known-edge map too — maintain it inline.
    for (const [id, cell] of knownEdgeCells) {
      if (!allCells[id]) {
        goneEdges.push(cell);
      }
    }
    if (goneVertices.length === 0 && goneEdges.length === 0) {
      // Refresh known sets to pick up any new cells added since last tick.
      for (const k of Object.keys(allCells)) {
        const c = allCells[k];
        if (!c || c.id === "0" || c.id === "1") continue;
        if (c.edge) knownEdgeCells.set(c.id, c);
        else knownVertexCells.set(c.id, c);
      }
      return;
    }
    // eslint-disable-next-line no-console
    console.debug("[turbo-ea] diff-detected removals", {
      vertices: goneVertices.map((v) => ({
        id: v?.id,
        cardId: v?.value?.getAttribute?.("cardId"),
        label: v?.value?.getAttribute?.("label"),
      })),
      edges: goneEdges.map((e) => ({ id: e?.id })),
    });
    // Update known sets first so the listener invocation can't see
    // these cells anymore.
    for (const v of goneVertices) knownVertexCells.delete(v.id);
    for (const e of goneEdges) knownEdgeCells.delete(e.id);
    // Refresh with newly-added cells too.
    for (const k of Object.keys(allCells)) {
      const c = allCells[k];
      if (!c || c.id === "0" || c.id === "1") continue;
      if (c.edge) knownEdgeCells.set(c.id, c);
      else knownVertexCells.set(c.id, c);
    }
    // Fake an mxEvent-shaped object the listener expects.
    const fakeEvt = {
      getProperty: (k: string) =>
        k === "cells" ? [...goneVertices, ...goneEdges] : null,
    };
    removedListener(null, fakeEvt);
  };

  const changeListener = () => synthesiseRemoval();
  model.addListener(win.mxEvent.CHANGE, changeListener);

  return () => {
    try {
      model.removeListener(addedListener);
      model.removeListener(removedListener);
      model.removeListener(changeListener);
      try {
        graph.removeListener(removedListener);
      } catch {
        // ignore
      }
    } catch {
      // graph may have been torn down already
    }
  };
}

/**
 * Walk every cell in the graph and route any unregistered card cell through
 * `onDuplicate`. Used as a periodic safety net because DrawIO's clipboard
 * sometimes inserts cells via paths that don't fire `CELLS_ADDED` on the
 * model in a way our listener sees (e.g. cross-tab paste deserialises XML
 * and skips the standard transaction batching).
 */
export function scanForDuplicateCells(
  iframe: HTMLIFrameElement,
  isRegistered: (cellId: string) => boolean,
  onDuplicate: (cellId: string, sharedCardId: string, wasPending: boolean) => void,
): void {
  const ctx = getMxGraph(iframe);
  if (!ctx) return;
  const { graph } = ctx;
  const cells = graph.getModel().cells || {};
  for (const k of Object.keys(cells)) {
    const cell = cells[k];
    if (!cell?.value?.getAttribute) continue;
    if (cell.edge) continue;
    if (cell.value.getAttribute("parentGroupCell")) continue;
    const cardId = cell.value.getAttribute("cardId");
    if (!cardId) continue;
    if (isRegistered(cell.id)) continue;
    const wasPending = cell.value.getAttribute("pending") === "1";
    onDuplicate(cell.id, cardId, wasPending);
  }
}

/**
 * Re-insert an edge that was just removed from the canvas (used for the
 * "No, abort" path of the relation-deletion confirmation). Re-creates a
 * fresh edge between the original source/target cells with the captured
 * style + relationId. Falls back to a no-op if either endpoint has since
 * disappeared (e.g. the user also removed the source card).
 */
export function restoreRemovedEdge(
  iframe: HTMLIFrameElement,
  tombstone: RemovedRelationTombstone,
): boolean {
  const ctx = getMxGraph(iframe);
  if (!ctx) return false;
  const { win, graph } = ctx;
  const model = graph.getModel();
  const src = tombstone.sourceCellId ? model.getCell(tombstone.sourceCellId) : null;
  const tgt = tombstone.targetCellId ? model.getCell(tombstone.targetCellId) : null;
  if (!src || !tgt) return false;

  model.beginUpdate();
  try {
    const xmlDoc = win.mxUtils.createXmlDocument();
    const obj = xmlDoc.createElement("object");
    // The visible edge label is the one captured at registration time,
    // NOT the human-readable relationLabel used by the dialog. Show-
    // Dependency edges have label="" and shouldn't suddenly show the
    // relation type key on restore.
    obj.setAttribute("label", tombstone.edgeLabel ?? "");
    if (tombstone.relationType) obj.setAttribute("relationType", tombstone.relationType);
    obj.setAttribute("relationId", tombstone.relationId);
    graph.insertEdge(
      graph.getDefaultParent(),
      tombstone.edgeCellId,
      obj,
      src,
      tgt,
      tombstone.style ||
        "edgeStyle=entityRelationEdgeStyle;strokeColor=#666;strokeWidth=1.5;endArrow=none;startArrow=none;",
    );
  } finally {
    model.endUpdate();
  }
  return true;
}

/** Return the set of cellIds currently present in the model that are
 *  edges. Used by the editor's periodic diff against its side-table —
 *  any edge that was registered as a relation but is no longer in the
 *  model has been deleted and should land in the confirm-dialog queue.
 *  This is more reliable than the synchronous `CELLS_REMOVED` listener,
 *  which DrawIO doesn't always fire for the deletion paths a user can
 *  trigger (keyboard Delete, right-click → Delete, edge tool, …). */
export function collectLiveEdgeCellIds(iframe: HTMLIFrameElement): Set<string> {
  const out = new Set<string>();
  const ctx = getMxGraph(iframe);
  if (!ctx) return out;
  const cells = ctx.graph.getModel().cells || {};
  for (const k of Object.keys(cells)) {
    if (cells[k]?.edge) out.add(k);
  }
  return out;
}

/**
 * Snapshot of which cellIds currently exist in the model. Used by the
 * editor's periodic scan to detect when a card-relation edge has lost
 * an endpoint vertex (user deleted the connected card from the canvas).
 */
export function collectLiveCellIds(iframe: HTMLIFrameElement): Set<string> {
  const out = new Set<string>();
  const ctx = getMxGraph(iframe);
  if (!ctx) return out;
  const cells = ctx.graph.getModel().cells || {};
  for (const k of Object.keys(cells)) {
    if (cells[k]) out.add(k);
  }
  return out;
}

/**
 * Silently remove a specific set of edge cells. Used by the editor's
 * cascade-on-card-delete path: when a registered relation-edge has lost
 * a card endpoint, we drop the edge without surfacing the
 * "delete this relation?" modal. Hand-drawn arrows (no side-table
 * entry) are NEVER passed to this helper, so they survive.
 */
export function removeEdgeCellsByIds(
  iframe: HTMLIFrameElement,
  edgeCellIds: string[],
): void {
  if (edgeCellIds.length === 0) return;
  const ctx = getMxGraph(iframe);
  if (!ctx) return;
  const { graph } = ctx;
  const model = graph.getModel();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cells: any[] = [];
  for (const id of edgeCellIds) {
    const c = model.getCell(id);
    if (c?.edge) cells.push(c);
  }
  if (cells.length === 0) return;
  model.beginUpdate();
  try {
    try {
      graph.removeCells(cells, false);
    } catch {
      // fall through
    }
    for (const c of cells) {
      if (model.getCell(c.id) === c) {
        try {
          model.remove(c);
        } catch {
          // ignore
        }
      }
    }
  } finally {
    model.endUpdate();
  }
}

/** Snapshot an edge's visible state — endpoints, style, and label —
 *  so the editor can restore the same edge later via
 *  `restoreRemovedEdge`. Returns empty defaults if the edge has been
 *  detached from the model already. */
export function describeEdgeEndpoints(
  iframe: HTMLIFrameElement,
  edgeCellId: string,
): {
  sourceName: string;
  targetName: string;
  sourceCellId: string | null;
  targetCellId: string | null;
  style: string;
  label: string;
} {
  const ctx = getMxGraph(iframe);
  if (!ctx)
    return {
      sourceName: "",
      targetName: "",
      sourceCellId: null,
      targetCellId: null,
      style: "",
      label: "",
    };
  const cell = ctx.graph.getModel().getCell(edgeCellId);
  if (!cell)
    return {
      sourceName: "",
      targetName: "",
      sourceCellId: null,
      targetCellId: null,
      style: "",
      label: "",
    };
  const labelOf = (c: { value?: { getAttribute?: (k: string) => string | null } | string | null } | null | undefined) => {
    if (!c?.value) return "";
    if (typeof c.value === "string") return c.value;
    return c.value.getAttribute?.("label") || "";
  };
  return {
    sourceName: labelOf(cell.source),
    targetName: labelOf(cell.target),
    sourceCellId: cell.source?.id ?? null,
    targetCellId: cell.target?.id ?? null,
    style: String(ctx.graph.getModel().getStyle(cell) || ""),
    label: labelOf(cell),
  };
}

/** Scan the in-memory graph for every edge that already carries a
 *  relationId attribute on its XML user-object, returning a list of
 *  metadata records the editor can drop into its side-table. Used on
 *  bootstrap to bridge saved diagrams into the in-session cache. */
export function collectExistingEdgeRelations(
  iframe: HTMLIFrameElement,
): Array<{
  edgeCellId: string;
  relationId: string;
  relationType: string;
  relationLabel: string;
}> {
  const ctx = getMxGraph(iframe);
  if (!ctx) return [];
  const { graph } = ctx;
  const cells = graph.getModel().cells || {};
  const result: Array<{
    edgeCellId: string;
    relationId: string;
    relationType: string;
    relationLabel: string;
  }> = [];
  for (const k of Object.keys(cells)) {
    const cell = cells[k];
    if (!cell?.edge) continue;
    if (!cell.value?.getAttribute) continue;
    const relationId = cell.value.getAttribute("relationId");
    if (!relationId) continue;
    result.push({
      edgeCellId: cell.id,
      relationId,
      relationType: cell.value.getAttribute("relationType") || "",
      relationLabel: cell.value.getAttribute("label") || "",
    });
  }
  return result;
}

/** Parse a diagram XML string and extract every card-cell cellId so the
 *  editor can pre-seed the registered-cells set before loading restored
 *  draft XML. Without this, the lifecycle listener sees the restored
 *  cells as "unregistered" and silently dedupes them into grey stubs. */
export function extractCardCellIdsFromXml(xml: string): string[] {
  try {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const ids: string[] = [];
    const objects = doc.querySelectorAll("object[cardId]");
    objects.forEach((obj) => {
      // mxGraph serialises card cells as <object cardId="..."><mxCell id="..." vertex="1"/></object>
      const inner = obj.querySelector("mxCell");
      if (!inner) return;
      // Skip edges — only vertex card cells need registration.
      if (inner.getAttribute("edge") === "1") return;
      const id = inner.getAttribute("id");
      if (id) ids.push(id);
    });
    return ids;
  } catch {
    return [];
  }
}

/** Same as collectExistingEdgeRelations but reads from a raw XML string
 *  rather than the in-memory graph. Used on restore to seed the side-
 *  table BEFORE handing the XML to DrawIO — otherwise the brief window
 *  between load and our post-load scan would leave edge deletions
 *  un-tombstoneable. */
export function extractEdgeRelationsFromXml(
  xml: string,
): Array<{
  edgeCellId: string;
  relationId: string;
  relationType: string;
  relationLabel: string;
}> {
  try {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const result: Array<{
      edgeCellId: string;
      relationId: string;
      relationType: string;
      relationLabel: string;
    }> = [];
    const objects = doc.querySelectorAll("object[relationId]");
    objects.forEach((obj) => {
      const inner = obj.querySelector("mxCell[edge='1']");
      if (!inner) return;
      const edgeCellId = inner.getAttribute("id");
      if (!edgeCellId) return;
      result.push({
        edgeCellId,
        relationId: obj.getAttribute("relationId") || "",
        relationType: obj.getAttribute("relationType") || "",
        relationLabel: obj.getAttribute("label") || "",
      });
    });
    return result;
  } catch {
    return [];
  }
}

/**
 * Seed the registered-cells set with every card cellId currently in the
 * graph. Call this once on bootstrap right after the diagram XML loads,
 * before attaching the lifecycle listener — otherwise the listener will
 * see the loaded cells as "unregistered" and mistakenly dedupe them.
 */
export function collectExistingCardCellIds(iframe: HTMLIFrameElement): string[] {
  const ctx = getMxGraph(iframe);
  if (!ctx) return [];
  const { graph } = ctx;
  const cells = graph.getModel().cells || {};
  const ids: string[] = [];
  for (const k of Object.keys(cells)) {
    const cell = cells[k];
    if (!cell?.value?.getAttribute) continue;
    if (cell.edge) continue;
    if (cell.value.getAttribute("parentGroupCell")) continue;
    const cardId = cell.value.getAttribute("cardId");
    if (cardId) ids.push(cell.id);
  }
  return ids;
}

/**
 * Dedup a duplicate (pasted) card cell.
 *   - If the clone was pending, give it a fresh temp id so users can sync it
 *     as a separate card.
 *   - If the clone was synced, strip the cardId so it becomes an unlinked
 *     shape — the user can then re-link it via the context menu.
 *
 * Returns the new temp id for pending clones, "unlinked" for synced clones,
 * or null on failure.
 */
export function dedupClonedCell(
  iframe: HTMLIFrameElement,
  cellId: string,
  wasPending: boolean,
): { mode: "regenerated"; tempId: string } | { mode: "unlinked" } | null {
  const ctx = getMxGraph(iframe);
  if (!ctx) return null;
  const { graph } = ctx;

  const model = graph.getModel();
  const cell = model.getCell(cellId);
  if (!cell?.value?.setAttribute) return null;

  model.beginUpdate();
  try {
    // Children we don't dedupe — they're expansion artifacts.
    if (cell.value.getAttribute("parentGroupCell")) return null;

    if (wasPending) {
      const tempId = `pending-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      cell.value.setAttribute("cardId", tempId);
      return { mode: "regenerated", tempId };
    }

    cell.value.removeAttribute("cardId");
    if (cell.value.removeAttribute) {
      cell.value.removeAttribute("expanded");
      cell.value.removeAttribute("childCellIds");
    }
    // Repaint as an "unlinked" stub: solid grey dashed border.
    model.setStyle(cell, buildUnlinkedStyle());
    graph.removeCellOverlays(cell);
    return { mode: "unlinked" };
  } finally {
    model.endUpdate();
  }
}

/** Visual style for an unlinked (was-synced) stub after copy/paste. */
function buildUnlinkedStyle(): string {
  return [
    "rounded=1",
    "whiteSpace=wrap",
    "html=1",
    "fillColor=#f5f5f5",
    "fontColor=#616161",
    "strokeColor=#9e9e9e",
    "fontSize=12",
    "fontStyle=0",
    "arcSize=12",
    "dashed=1",
    "dashPattern=4 3",
  ].join(";");
}

/* ------------------------------------------------------------------ */
/*  Link / unlink / relink helpers (Phase 2)                           */
/* ------------------------------------------------------------------ */

/**
 * Strip a synced cell's link to its card. The shape stays on the canvas
 * but becomes a plain unlinked stub. Returns the previous cardId so the
 * editor can offer "undo" feedback.
 */
export function unlinkCell(
  iframe: HTMLIFrameElement,
  cellId: string,
): string | null {
  const ctx = getMxGraph(iframe);
  if (!ctx) return null;
  const { graph } = ctx;

  const model = graph.getModel();
  const cell = model.getCell(cellId);
  if (!cell?.value?.getAttribute) return null;
  const previousId = cell.value.getAttribute("cardId");
  if (!previousId) return null;

  model.beginUpdate();
  try {
    cell.value.removeAttribute("cardId");
    if (cell.value.removeAttribute) {
      cell.value.removeAttribute("pending");
      cell.value.removeAttribute("expanded");
      cell.value.removeAttribute("childCellIds");
      cell.value.removeAttribute("relationId");
    }
    model.setStyle(cell, buildUnlinkedStyle());
    graph.removeCellOverlays(cell);
  } finally {
    model.endUpdate();
  }
  return previousId;
}

/**
 * Re-link a cell (synced, unlinked, or plain DrawIO shape) to a different
 * card. Rewrites cardId, cardType, label so the cell points at the new
 * backend card.
 *
 * For cells that were already card-shaped (currently linked or previously
 * unlinked), we swap to the target card type's full `buildSyncedStyle` so
 * the visual is consistent with cards inserted via the picker.
 *
 * For plain DrawIO shapes — rectangles, ellipses, swimlanes the user drew
 * from the toolbar — we KEEP the user's original shape style and only
 * update fillColor + strokeColor + fontColor so the shape they drew gains
 * the card-type colour without losing its geometry. This is what users
 * expect from "Link to Existing Card" on a hand-drawn shape.
 */
export function relinkCell(
  iframe: HTMLIFrameElement,
  cellId: string,
  opts: { cardId: string; cardType: string; name: string; color: string; icon?: string },
): boolean {
  const ctx = getMxGraph(iframe);
  if (!ctx) return false;
  const { win, graph } = ctx;

  const model = graph.getModel();
  const cell = model.getCell(cellId);
  if (!cell) return false;

  model.beginUpdate();
  try {
    let value = cell.value;
    // Was this cell previously associated with a card? If so we treat it
    // as card-shaped and replace the visual style entirely.
    const wasCardShaped =
      !!value?.getAttribute && (
        !!value.getAttribute("cardId") || !!value.getAttribute("cardType")
      );

    if (!value?.setAttribute) {
      // Plain shape with a string label (or null) — wrap it in an XML
      // user-object so we have somewhere to write cardId / cardType.
      const xmlDoc = win.mxUtils.createXmlDocument();
      const obj = xmlDoc.createElement("object");
      obj.setAttribute("label", typeof value === "string" ? value : "");
      model.setValue(cell, obj);
      value = obj;
    }
    value.setAttribute("cardId", opts.cardId);
    value.setAttribute("cardType", opts.cardType);
    value.setAttribute("label", opts.name);
    if (value.removeAttribute) {
      value.removeAttribute("pending");
      value.removeAttribute("expanded");
      value.removeAttribute("childCellIds");
    }
    if (wasCardShaped) {
      model.setStyle(cell, buildSyncedStyle(opts.color, opts.icon));
    } else {
      // Preserve the user's shape — only update fill + stroke + font
      // colour so the cell visibly belongs to the target card type
      // without losing the rectangle / ellipse / swimlane shape.
      const current = (model.getStyle(cell) || "") as string;
      const stroke = darken(opts.color);
      const next = current
        .split(";")
        .filter(Boolean)
        .filter(
          (p) =>
            !p.startsWith("fillColor=") &&
            !p.startsWith("strokeColor=") &&
            !p.startsWith("fontColor="),
        )
        .concat([
          `fillColor=${opts.color}`,
          `strokeColor=${stroke}`,
          `fontColor=${readableTextColor(opts.color)}`,
        ])
        .join(";");
      model.setStyle(cell, next);
    }
    graph.refresh(cell);
  } finally {
    model.endUpdate();
  }
  return true;
}

/**
 * Identify the kind of cell under the right-click for the context menu.
 * Returns one of: "synced", "pending", "unlinked", "plain", or null.
 */
export function classifyCell(
  iframe: HTMLIFrameElement,
  cellId: string,
): "synced" | "pending" | "unlinked" | "plain" | null {
  const ctx = getMxGraph(iframe);
  if (!ctx) return null;
  const { graph } = ctx;
  const cell = graph.getModel().getCell(cellId);
  if (!cell) return null;
  // Edges are out of scope for link/unlink classification.
  if (cell.edge) return null;

  const cardId = cell.value?.getAttribute?.("cardId");
  const pending = cell.value?.getAttribute?.("pending") === "1";
  if (cardId && pending) return "pending";
  if (cardId) return "synced";
  if (cell.value?.getAttribute) return "unlinked";
  return "plain";
}

/**
 * Read a cell's label — used when "Convert to Card" pre-fills the create
 * dialog from a plain DrawIO shape's label.
 */
export function getCellLabel(iframe: HTMLIFrameElement, cellId: string): string {
  const ctx = getMxGraph(iframe);
  if (!ctx) return "";
  const cell = ctx.graph.getModel().getCell(cellId);
  if (!cell) return "";
  const v = cell.value;
  if (typeof v === "string") return v;
  return v?.getAttribute?.("label") || "";
}

/**
 * Convert a plain DrawIO shape into a pending card cell. Keeps the cell's
 * geometry, but replaces its user object with a pending card user object
 * and re-styles it with the card-type color (dashed border).
 */
export function convertShapeToPendingCard(
  iframe: HTMLIFrameElement,
  cellId: string,
  opts: { tempId: string; type: string; name: string; color: string; icon?: string },
): boolean {
  const ctx = getMxGraph(iframe);
  if (!ctx) return false;
  const { win, graph } = ctx;

  const model = graph.getModel();
  const cell = model.getCell(cellId);
  if (!cell) return false;

  model.beginUpdate();
  try {
    const xmlDoc = win.mxUtils.createXmlDocument();
    const obj = xmlDoc.createElement("object");
    obj.setAttribute("label", opts.name);
    obj.setAttribute("cardId", opts.tempId);
    obj.setAttribute("cardType", opts.type);
    obj.setAttribute("pending", "1");
    model.setValue(cell, obj);
    model.setStyle(cell, buildPendingStyle(opts.color, opts.icon));
    graph.refresh(cell);
  } finally {
    model.endUpdate();
  }
  return true;
}

/**
 * Convert any cell into a swimlane container. Used by the "Convert to
 * Container" context-menu action so a hand-drawn shape (or any existing
 * cell) becomes a drop target for other cards. The cell keeps its
 * cardId / cardType if it had any — only the style + minimum size
 * change. Other card cells dragged onto a container are automatically
 * re-parented by mxGraph; the editor's parent-change listener picks up
 * the move and prompts to persist it as a `parent_id` update.
 */
export function convertShapeToContainer(
  iframe: HTMLIFrameElement,
  cellId: string,
  fallbackLabel: string,
): boolean {
  const ctx = getMxGraph(iframe);
  if (!ctx) return false;
  const { win, graph } = ctx;

  const model = graph.getModel();
  const cell = model.getCell(cellId);
  if (!cell) return false;

  model.beginUpdate();
  try {
    // Ensure the cell carries an XML user-object so the swimlane header
    // can show a label.
    let value = cell.value;
    if (!value?.setAttribute) {
      const xmlDoc = win.mxUtils.createXmlDocument();
      const obj = xmlDoc.createElement("object");
      const seedLabel =
        typeof value === "string" && value ? value : fallbackLabel;
      obj.setAttribute("label", seedLabel || fallbackLabel);
      model.setValue(cell, obj);
      value = obj;
    } else if (!value.getAttribute("label")) {
      value.setAttribute("label", fallbackLabel);
    }

    // Make sure the container is big enough to hold cells — 320×220 is
    // wide enough for a 3×2 grid of standard cards with padding.
    const geo = graph.getCellGeometry(cell);
    if (geo) {
      const w = Math.max(geo.width || 0, 320);
      const h = Math.max(geo.height || 0, 220);
      if (w !== geo.width || h !== geo.height) {
        graph.resizeCell(cell, new win.mxRectangle(geo.x, geo.y, w, h));
      }
    }

    // Preserve any existing fill colour so the user's earlier choice
    // doesn't disappear; default to a neutral grey-blue.
    const currentStyle = String(model.getStyle(cell) || "");
    const fillMatch = /fillColor=([^;]+)/.exec(currentStyle);
    const fill = fillMatch?.[1] || "#90a4ae";
    const stroke = darken(fill);
    model.setStyle(
      cell,
      [
        "shape=swimlane",
        "startSize=28",
        "horizontal=1",
        `fillColor=${fill}`,
        `fontColor=${readableTextColor(fill)}`,
        `strokeColor=${stroke}`,
        "fontSize=12",
        "fontStyle=1",
        "rounded=1",
        "arcSize=12",
        "html=1",
        "whiteSpace=wrap",
        "swimlaneLine=0",
      ].join(";"),
    );
    graph.refresh(cell);
  } finally {
    model.endUpdate();
  }
  return true;
}

/* ------------------------------------------------------------------ */
/*  Parent-change listener (drag-into-container / drag-out)             */
/* ------------------------------------------------------------------ */

/** Awaiting / queued parent_id change captured from a drag-into-container
 *  or drag-out-of-container gesture. `kind = "attach"` flips parent_id to
 *  `parentCardId`; `kind = "detach"` clears it (makes the card a root). */
export interface PendingParentChange {
  kind: "attach" | "detach";
  cellId: string;
  cardId: string;
  cardName: string;
  cardType: string;
  /** Target parent for `attach`. For `detach`, the parent the user just
   *  removed the card from (used by the dialog text only). */
  parentCardId: string | null;
  parentCardName: string;
  /** Cell ids captured at the moment of the move so the abort path can
   *  put the cell back under its previous mxGraph parent. */
  oldParentCellId: string | null;
  /** Cell geometry at the moment of the move so revert can restore
   *  the visual position too (model.add re-parents but doesn't move). */
  oldGeometry?: { x: number; y: number; width: number; height: number };
}

/**
 * Decide whether a nested child cell has been dragged OUT of its parent's
 * bounds and should be force-detached to the canvas root. mxGraph child
 * geometry is relative to the parent, so "inside" means the child's box fits
 * within `[0, parent.width] × [0, parent.height]`.
 *
 * A **collapsed / folded** parent is special-cased: mxGraph swaps a folded
 * swimlane's geometry down to its header height while leaving the (now hidden)
 * children at their full expanded-layout coordinates, so every child would
 * falsely test as "escaped". You can't drag a hidden child out of a collapsed
 * container anyway, so this returns `false` for a collapsed parent — preventing
 * the spurious per-child detach prompts that fire on the next canvas click.
 */
export function childEscapedParentBounds(
  cellGeo: { x: number; y: number; width: number; height: number },
  parentGeo: { x: number; y: number; width: number; height: number },
  parentCollapsed: boolean,
): boolean {
  if (parentCollapsed) return false;
  const insideX = cellGeo.x >= 0 && cellGeo.x + cellGeo.width <= parentGeo.width;
  const insideY = cellGeo.y >= 0 && cellGeo.y + cellGeo.height <= parentGeo.height;
  return !(insideX && insideY);
}

export interface ParentChangeEvent {
  cellId: string;
  cardId: string | null;
  cardName: string;
  cardType: string;
  /** Cell id of the new parent, or null when the cell moved back to
   *  the graph's default parent (became a top-level vertex again). */
  newParentCellId: string | null;
  newParentCardId: string | null;
  newParentName: string;
  newParentType: string;
  /** Same shape for the old parent. */
  oldParentCellId: string | null;
  oldParentCardId: string | null;
  oldParentName: string;
  oldParentType: string;
  /** Cell geometry at the moment of the LAST recorded sighting
   *  (i.e. before this parent change). Restored on revert so the
   *  cell lands back where the user grabbed it from rather than at
   *  (0, 0) of the destination parent. */
  oldGeometry?: { x: number; y: number; width: number; height: number };
}

/**
 * Hook the model so we get a callback whenever a card cell's parent
 * changes — i.e. it was dragged INTO a container or OUT of one. The
 * editor uses this to prompt the user to persist the change as a
 * `parent_id` update on the underlying Card.
 *
 * Implementation: on every model CHANGE we walk every card cell and
 * diff its current parent against the last-known one we recorded.
 * Detecting via the change-list itself (`mxChildChange`) was unreliable
 * — DrawIO's bundled mxGraph can be minified, so `instanceof` /
 * `constructor.name` checks don't match — and several DrawIO drag
 * paths skip the standard child-change emission entirely. The diff is
 * O(N) per change which is fine for diagram-sized graphs.
 *
 * Returns a cleanup function that removes the listener.
 */
export function attachParentChangeListener(
  iframe: HTMLIFrameElement,
  onParentChanged: (ev: ParentChangeEvent) => void,
): () => void {
  const ctx = getMxGraph(iframe);
  if (!ctx) return () => {};
  const { win, graph } = ctx;
  const model = graph.getModel();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cardOf = (cell: any) => {
    if (!cell?.value?.getAttribute) return null;
    const cardId = cell.value.getAttribute("cardId");
    if (!cardId) return null;
    return {
      cellId: cell.id,
      cardId,
      cardType: cell.value.getAttribute("cardType") || "",
      label: cell.value.getAttribute("label") || "",
    };
  };

  /** parentCellId + geometry of every card cell at last observation.
   *  `parentId = null` = graph default parent. Cells we haven't seen
   *  before are added silently so the first sighting doesn't fire a
   *  spurious event. We capture geometry too so revert can put the
   *  cell back at its visual pre-move location. */
  interface KnownState {
    parentId: string | null;
    x: number;
    y: number;
    width: number;
    height: number;
  }
  const knownState = new Map<string, KnownState>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snapshotState = (cell: any): KnownState => {
    const geo = cell.getGeometry ? cell.getGeometry() : null;
    return {
      parentId: cell.parent?.id ?? null,
      x: geo?.x ?? 0,
      y: geo?.y ?? 0,
      width: geo?.width ?? 0,
      height: geo?.height ?? 0,
    };
  };
  const seedKnown = () => {
    const cells = model.cells || {};
    for (const k of Object.keys(cells)) {
      const cell = cells[k];
      if (!cardOf(cell)) continue;
      knownState.set(cell.id, snapshotState(cell));
    }
  };
  seedKnown();

  /**
   * Cells we should NEVER raise a parent-change event for, even when
   * their mxGraph parent changes. We used to include drill-down and
   * roll-up children here, but that silently swallowed real
   * drag-out / cross-container moves: when mxGraph re-parented a
   * drilled-down child to the canvas root, the diff saw the parent
   * change, isManaged returned true (marker still present), the diff
   * silently refreshed knownState, and onParentChanged never fired.
   *
   * Only `parentGroupCell` stays — those are expansion-group cells
   * that flip in and out as the user collapses / re-expands a group
   * and don't correspond to a user-intended hierarchy change.
   */
  const isManaged = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cell: any,
  ) => !!cell.value.getAttribute("parentGroupCell");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isMeaningfulParent = (cell: any) => {
    if (!cell) return false;
    if (cell === graph.getDefaultParent()) return false;
    const id = typeof cell.getId === "function" ? cell.getId() : cell.id;
    if (id === "0" || id === "1") return false;
    return true;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listener = () => {
    const cells = model.cells || {};
    for (const k of Object.keys(cells)) {
      const cell = cells[k];
      const cardInfo = cardOf(cell);
      if (!cardInfo) continue;

      // Drill-down children, roll-up children, and expansion-group
      // children are intentional artefacts of those features. We still
      // record their parent so we can detect a real future move, but
      // never raise a parent-change event for them — their cardId →
      // parent_id mapping is owned by the container itself.
      if (isManaged(cell)) {
        knownState.set(cell.id, snapshotState(cell));
        continue;
      }

      const newParentId = cell.parent?.id ?? null;
      // First sighting: record silently.
      if (!knownState.has(cell.id)) {
        knownState.set(cell.id, snapshotState(cell));
        continue;
      }
      const prior = knownState.get(cell.id)!;
      const oldParentId = prior.parentId;
      if (oldParentId === newParentId) {
        // No parent change — refresh geometry so the next change has
        // an up-to-date "before" snapshot.
        knownState.set(cell.id, snapshotState(cell));
        continue;
      }

      // Parent actually changed — resolve both sides + fire.
      const newParentCell = isMeaningfulParent(cell.parent)
        ? cell.parent
        : null;
      const oldParentCell =
        oldParentId && oldParentId !== "0" && oldParentId !== "1"
          ? model.getCell(oldParentId)
          : null;
      const newParentCard = cardOf(newParentCell);
      const oldParentCard = cardOf(oldParentCell);
      knownState.set(cell.id, snapshotState(cell));
      onParentChanged({
        cellId: cardInfo.cellId,
        cardId: cardInfo.cardId,
        cardName: cardInfo.label,
        cardType: cardInfo.cardType,
        newParentCellId: newParentCell?.id ?? null,
        newParentCardId: newParentCard?.cardId ?? null,
        newParentName: newParentCard?.label ?? "",
        newParentType: newParentCard?.cardType ?? "",
        oldParentCellId: oldParentCell?.id ?? null,
        oldParentCardId: oldParentCard?.cardId ?? null,
        oldParentName: oldParentCard?.label ?? "",
        oldParentType: oldParentCard?.cardType ?? "",
        oldGeometry: {
          x: prior.x,
          y: prior.y,
          width: prior.width,
          height: prior.height,
        },
      });
    }
  };

  model.addListener(win.mxEvent.CHANGE, listener);
  // Belt-and-braces: also re-run the diff after every mxGraph move and
  // after every mouse-up inside the canvas. DrawIO's drag pipeline can
  // skip the model's CHANGE event for some gestures (esp. when the
  // graph's `cellsMoved` is overridden). The redundant triggers are
  // cheap and cover those cases.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const moveCellsListener = () => listener();
  try {
    graph.addListener(win.mxEvent.MOVE_CELLS, moveCellsListener);
  } catch {
    // ignore — older mxGraph builds without MOVE_CELLS
  }
  const onMouseUp = () => {
    // Defer one tick so any open transaction has settled.
    setTimeout(() => {
      // Force-detach: walk every card cell and check whether its visual
      // bounds escape its parent's bounds. mxGraph's
      // `shouldRemoveCellsFromParent` override sometimes fails in
      // DrawIO's drag pipeline, so we do the check ourselves and
      // re-parent the cell to the default parent when a user
      // unmistakably dragged it out. The model change here triggers
      // the diff listener immediately, which fires onParentChanged
      // for the editor to surface the detach dialog.
      const cells = model.cells || {};
      const defaultParent = graph.getDefaultParent();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toDetach: any[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toDetachOffsets: Array<{ x: number; y: number }> = [];
      for (const k of Object.keys(cells)) {
        const cell = cells[k];
        if (!cell?.value?.getAttribute) continue;
        if (cell.edge) continue;
        if (!cell.value.getAttribute("cardId")) continue;
        // Expansion-group children (parentGroupCell) are still
        // skipped — those are temporary visual artefacts owned by
        // the group's expand/collapse cycle and shouldn't be
        // detachable via drag. Drill-down / roll-up children, on
        // the other hand, ARE legitimately detachable: the user
        // promoting one into a stand-alone card is a real edit.
        if (cell.value.getAttribute("parentGroupCell")) continue;
        const parent = cell.parent;
        if (!parent || parent === defaultParent) continue;
        // Parent must be a swimlane (not the root layer cells "0"/"1").
        const parentId =
          typeof parent.getId === "function" ? parent.getId() : parent.id;
        if (parentId === "0" || parentId === "1") continue;
        const cellGeo = cell.getGeometry ? cell.getGeometry() : null;
        const parentGeo = parent.getGeometry ? parent.getGeometry() : null;
        if (!cellGeo || !parentGeo) continue;
        // A folded swimlane reports its shrunken (header-height) bounds while
        // its children keep their expanded-layout geometry — never treat those
        // as escaped, or collapsing a container would detach every child.
        const parentCollapsed =
          parent.collapsed === true ||
          (typeof model.isCollapsed === "function" && model.isCollapsed(parent));
        if (!childEscapedParentBounds(cellGeo, parentGeo, parentCollapsed)) continue;
        // Escaped the parent — convert the cell's geometry to absolute
        // coordinates so it lands where the user dropped it after we
        // re-parent to root.
        toDetach.push(cell);
        toDetachOffsets.push({
          x: (parentGeo.x ?? 0) + (cellGeo.x ?? 0),
          y: (parentGeo.y ?? 0) + (cellGeo.y ?? 0),
        });
      }
      if (toDetach.length > 0) {
        model.beginUpdate();
        try {
          for (let i = 0; i < toDetach.length; i++) {
            const cell = toDetach[i];
            const offset = toDetachOffsets[i];
            // Strip management markers so the subsequent diff fires
            // the parent-change event. Without this clear, the
            // `isManaged` filter below silently swallows the event
            // and the user's force-detach gesture goes unnoticed
            // by the confirmation flow.
            const v = cell.value;
            if (v?.removeAttribute) {
              v.removeAttribute("drillDownChild");
              v.removeAttribute("rollUpChild");
            }
            const existing = cell.getGeometry();
            const newGeo = new win.mxGeometry(
              offset.x,
              offset.y,
              existing?.width ?? 0,
              existing?.height ?? 0,
            );
            model.setGeometry(cell, newGeo);
            model.add(defaultParent, cell);
          }
        } finally {
          model.endUpdate();
        }
      }
      // Now run the standard diff pass which catches both the force-
      // detached cells we just re-parented AND any other parent
      // changes mxGraph applied during the drag.
      listener();
    }, 0);
  };
  try {
    graph.container?.addEventListener?.("mouseup", onMouseUp);
  } catch {
    // ignore
  }
  return () => {
    try {
      model.removeListener(listener);
    } catch {
      // graph torn down
    }
    try {
      graph.removeListener(moveCellsListener);
    } catch {
      // ignore
    }
    try {
      graph.container?.removeEventListener?.("mouseup", onMouseUp);
    } catch {
      // ignore
    }
  };
}

/**
 * Revert a single parent change by re-parenting the cell back under the
 * old parent and restoring its geometry. Without the geometry
 * restoration the cell snaps to (0, 0) of the destination parent
 * after re-parent — which is rarely where the user grabbed it from.
 *
 * Falls back to the graph's default parent if the captured old-parent
 * cellId no longer exists.
 */
export function revertParentChange(
  iframe: HTMLIFrameElement,
  cellId: string,
  oldParentCellId: string | null,
  oldGeometry?: { x: number; y: number; width: number; height: number },
): boolean {
  const ctx = getMxGraph(iframe);
  if (!ctx) return false;
  const { win, graph } = ctx;
  const model = graph.getModel();
  const cell = model.getCell(cellId);
  if (!cell) return false;
  const oldParent =
    (oldParentCellId && model.getCell(oldParentCellId)) ||
    graph.getDefaultParent();
  model.beginUpdate();
  try {
    model.add(oldParent, cell);
    if (oldGeometry) {
      const geo = new win.mxGeometry(
        oldGeometry.x,
        oldGeometry.y,
        oldGeometry.width,
        oldGeometry.height,
      );
      model.setGeometry(cell, geo);
    }
    graph.refresh(cell);
  } finally {
    model.endUpdate();
  }
  return true;
}

/* ------------------------------------------------------------------ */
/*  Phase 3 — chevron expand menu (per relation type)                  */
/* ------------------------------------------------------------------ */

/**
 * Replace the +/- overlay with a chevron that opens an MUI Menu in the
 * parent window. Click position is captured so the menu can anchor near the
 * overlay regardless of canvas zoom/scroll.
 */
export function addChevronOverlay(
  iframe: HTMLIFrameElement,
  cellId: string,
  onClick: (anchor: { x: number; y: number }) => void,
): boolean {
  const ctx = getMxGraph(iframe);
  if (!ctx) return false;
  const { win, graph } = ctx;
  const cell = graph.getModel().getCell(cellId);
  if (!cell) return false;

  graph.removeCellOverlays(cell);
  // Sit on the card's right edge but lifted above the vertical centre, so the
  // affordance clears mxGraph's East connection arrow (which lives at the
  // right-middle border) while the enlarged hit target keeps it easy to click.
  const overlay = new win.mxCellOverlay(
    new win.mxImage(CHEVRON_OVERLAY, 24, 24),
    "Expand related cards",
    win.mxConstants.ALIGN_RIGHT,
    win.mxConstants.ALIGN_MIDDLE,
    new win.mxPoint(0, -14),
  );
  overlay.cursor = "pointer";
  overlay.addListener(win.mxEvent.CLICK, (_s: unknown, evt: { properties?: { event?: MouseEvent } }) => {
    // mxCellOverlay's CLICK fires with the wrapped DOM event in
    // `properties.event` (mxGraph's own event abstraction). Fall back to
    // the cell's screen position when the event isn't surfaced.
    const e = evt?.properties?.event;
    let x = 0;
    let y = 0;
    if (e && typeof e.clientX === "number") {
      // The overlay lives inside the iframe; translate to the parent's
      // viewport so the MUI Menu anchor lands where the user clicked.
      const rect = iframe.getBoundingClientRect();
      x = rect.left + e.clientX;
      y = rect.top + e.clientY;
    } else {
      const rect = iframe.getBoundingClientRect();
      const geo = graph.getCellGeometry(cell);
      const s = graph.view.scale;
      const tr = graph.view.translate;
      const container = graph.container as HTMLElement;
      if (geo) {
        x = rect.left + ((geo.x + geo.width + tr.x) * s - container.scrollLeft);
        y = rect.top + ((geo.y + geo.height / 2 + tr.y) * s - container.scrollTop);
      } else {
        x = rect.left + 100;
        y = rect.top + 100;
      }
    }
    onClick({ x, y });
  });
  graph.addCellOverlay(cell, overlay);
  return true;
}

export type ExpandPlacement = "right" | "below" | "above";

/**
 * Insert child cells around a parent. Variant of expandCardGroup that
 * accepts a placement direction so the same helper backs Show Dependency
 * (right), Drill-Down (below) and Roll-Up (above).
 */
export function expandCardGroupAt(
  iframe: HTMLIFrameElement,
  parentCellId: string,
  children: ExpandChildData[],
  placement: ExpandPlacement,
): ExpandedEdgeInfo[] {
  const ctx = getMxGraph(iframe);
  if (!ctx) return [];
  const { win, graph } = ctx;

  const model = graph.getModel();
  const root = graph.getDefaultParent();
  const parentCell = model.getCell(parentCellId);
  if (!parentCell) return [];

  const geo = graph.getCellGeometry(parentCell);
  if (!geo) return [];

  const inserted: ExpandedEdgeInfo[] = [];
  model.beginUpdate();
  try {
    if (placement === "right") {
      // Stack children vertically to the right (matches the original
      // expandCardGroup behaviour).
      let totalH = 0;
      for (let i = 0; i < children.length; i++) {
        if (i > 0) {
          totalH +=
            children[i].type !== children[i - 1].type ? TYPE_GROUP_GAP : CHILD_GAP_Y;
        }
        totalH += CHILD_CARD_H;
      }
      const startX = geo.x + geo.width + CHILD_GAP_X;
      const startY = geo.y + geo.height / 2 - totalH / 2;
      let yOff = 0;
      for (let i = 0; i < children.length; i++) {
        if (i > 0) {
          yOff += children[i].type !== children[i - 1].type ? TYPE_GROUP_GAP : CHILD_GAP_Y;
        }
        const ch = children[i];
        inserted.push(
          insertChildVertex(win, graph, root, parentCell, parentCellId, ch, startX, startY + yOff, i),
        );
        yOff += CHILD_CARD_H;
      }
    } else {
      // Below or above: tile children in rows, centered horizontally on the
      // parent. We use simple wrapping so wide expansions don't run off the
      // canvas.
      const perRow = Math.max(1, Math.floor((geo.width + CHILD_GAP_X) / (CHILD_CARD_W + CHILD_GAP_X)));
      const cols = Math.min(perRow, Math.max(1, Math.ceil(Math.sqrt(children.length))));
      const rowCount = Math.ceil(children.length / cols);
      const rowH = CHILD_CARD_H + CHILD_GAP_Y;
      const totalH = rowCount * rowH - CHILD_GAP_Y;
      const totalW = cols * CHILD_CARD_W + (cols - 1) * CHILD_GAP_X;
      const startX = geo.x + geo.width / 2 - totalW / 2;
      const startY =
        placement === "below"
          ? geo.y + geo.height + CHILD_GAP_X
          : geo.y - CHILD_GAP_X - totalH;
      for (let i = 0; i < children.length; i++) {
        const r = Math.floor(i / cols);
        const c = i % cols;
        const x = startX + c * (CHILD_CARD_W + CHILD_GAP_X);
        const y = startY + r * rowH;
        inserted.push(
          insertChildVertex(win, graph, root, parentCell, parentCellId, children[i], x, y, i),
        );
      }
    }

    const pv = parentCell.value;
    if (pv?.setAttribute) {
      pv.setAttribute("expanded", "1");
      pv.setAttribute("childCellIds", inserted.map((c) => c.cellId).join(","));
    }
  } finally {
    model.endUpdate();
  }

  return inserted;
}

function insertChildVertex(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  win: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  graph: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  root: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parentCell: any,
  parentCellId: string,
  ch: ExpandChildData,
  x: number,
  y: number,
  index: number,
): ExpandedEdgeInfo {
  const cid = `fsg-${ch.id.slice(0, 8)}-${Date.now()}-${index}`;
  const edgeCellId = `fse-${cid}`;
  const stroke = darken(ch.color);
  const style = [
    "rounded=1",
    "whiteSpace=wrap",
    "html=1",
    `fillColor=${ch.color}`,
    `fontColor=${readableTextColor(ch.color)}`,
    `strokeColor=${stroke}`,
    "fontSize=11",
    "fontStyle=1",
    "arcSize=12",
    ...iconStyleParts(ch.icon),
  ].join(";");

  const xmlDoc = win.mxUtils.createXmlDocument();
  const obj = xmlDoc.createElement("object");
  obj.setAttribute("label", ch.name);
  obj.setAttribute("cardId", ch.id);
  obj.setAttribute("cardType", ch.type);
  obj.setAttribute("parentGroupCell", parentCellId);

  const vertex = graph.insertVertex(
    root,
    cid,
    obj,
    x,
    y,
    CHILD_CARD_W,
    CHILD_CARD_H,
    style,
  );
  // Stamp the edge with relationId both on the XML user-object (so saves
  // serialise correctly) and via the returned info so the editor's
  // cellId → relation-meta side-table can mirror it. The side-table is
  // the authoritative source for in-session deletes — see the
  // `getRelationIdForEdge` resolver in CellLifecycleHandlers.
  const edge = graph.insertEdge(
    root,
    edgeCellId,
    "",
    parentCell,
    vertex,
    `edgeStyle=entityRelationEdgeStyle;strokeColor=${ch.color};strokeWidth=1.5;endArrow=none;startArrow=none`,
  );
  const edgeObj = xmlDoc.createElement("object");
  edgeObj.setAttribute("label", "");
  if (ch.relationType) edgeObj.setAttribute("relationType", ch.relationType);
  if (ch.relationId) edgeObj.setAttribute("relationId", ch.relationId);
  graph.getModel().setValue(edge, edgeObj);
  return {
    cellId: cid,
    cardId: ch.id,
    edgeCellId,
    relationId: ch.relationId,
    relationType: ch.relationType,
  };
}

/* ------------------------------------------------------------------ */
/*  Hierarchy container rendering — Drill-Down + Roll-Up               */
/* ------------------------------------------------------------------ */

/** Return true when the cell already renders as a swimlane container —
 *  i.e. the user previously drilled down into it. */
export function isContainerCell(iframe: HTMLIFrameElement, cellId: string): boolean {
  const ctx = getMxGraph(iframe);
  if (!ctx) return false;
  const { graph } = ctx;
  const cell = graph.getModel().getCell(cellId);
  if (!cell) return false;
  const style = String(graph.getModel().getStyle(cell) || "");
  return style.includes("shape=swimlane");
}

/** Return true when the cell currently lives INSIDE another swimlane
 *  container — i.e. the user previously rolled it up or drilled into its
 *  parent. Used to block double-roll-ups that would create a phantom
 *  duplicate container on top. */
export function isInsideContainer(iframe: HTMLIFrameElement, cellId: string): boolean {
  const ctx = getMxGraph(iframe);
  if (!ctx) return false;
  const { graph } = ctx;
  const cell = graph.getModel().getCell(cellId);
  if (!cell) return false;
  const parent = cell.getParent ? cell.getParent() : cell.parent;
  if (!parent) return false;
  // Default parent / layer cells are not containers.
  if (parent === graph.getDefaultParent()) return false;
  if (!parent.value?.getAttribute) return false;
  const parentStyle = String(graph.getModel().getStyle(parent) || "");
  return parentStyle.includes("shape=swimlane");
}

/** Return the set of cardIds currently nested as direct children of
 *  the given parent cell. Used by the Expand menu so users can see
 *  which hierarchy children are already inside a drill-down container
 *  and which ones are still missing. */
export function getNestedCardIds(
  iframe: HTMLIFrameElement,
  parentCellId: string,
): Set<string> {
  const out = new Set<string>();
  const ctx = getMxGraph(iframe);
  if (!ctx) return out;
  const { graph } = ctx;
  const model = graph.getModel();
  const parentCell = model.getCell(parentCellId);
  if (!parentCell) return out;
  const childCount =
    typeof model.getChildCount === "function"
      ? model.getChildCount(parentCell)
      : 0;
  for (let i = 0; i < childCount; i++) {
    const child = model.getChildAt(parentCell, i);
    if (!child?.value?.getAttribute) continue;
    const cardId = child.value.getAttribute("cardId");
    if (cardId) out.add(cardId);
  }
  return out;
}

/** Return the cellId of an existing on-canvas card cell for the given
 *  cardId (top-level, non-container, non-child-of-container). Used to
 *  detect "this card is already on the diagram, don't duplicate". */
export function findExistingCardCellId(
  iframe: HTMLIFrameElement,
  cardId: string,
): string | null {
  const ctx = getMxGraph(iframe);
  if (!ctx) return null;
  const { graph } = ctx;
  const cells = graph.getModel().cells || {};
  for (const k of Object.keys(cells)) {
    const cell = cells[k];
    if (!cell?.value?.getAttribute) continue;
    if (cell.edge) continue;
    if (cell.value.getAttribute("cardId") !== cardId) continue;
    if (cell.value.getAttribute("parentGroupCell")) continue;
    return cell.id;
  }
  return null;
}


export interface HierarchyChild {
  id: string;
  name: string;
  type: string;
  color: string;
  /** Card-type Material Symbols icon name. Optional. */
  icon?: string;
}

/**
 * Turn the current card cell into a swimlane container holding the given
 * hierarchy children inside it. The header bar keeps the parent's label
 * and colour; children are tiled in a 3-wide grid below the header.
 *
 * Returns the inserted child cellIds + cardIds (registered by the caller
 * so the periodic dedup scan ignores them).
 */
export function drillDownInto(
  iframe: HTMLIFrameElement,
  parentCellId: string,
  children: HierarchyChild[],
): Array<{ cellId: string; cardId: string }> {
  const ctx = getMxGraph(iframe);
  if (!ctx) return [];
  const { win, graph } = ctx;
  const model = graph.getModel();
  const parentCell = model.getCell(parentCellId);
  if (!parentCell) return [];

  const geo = graph.getCellGeometry(parentCell);
  if (!geo) return [];

  // Layout constants tuned to feel like LeanIX's container drill-down.
  const HEADER = 28;
  const PAD = 12;
  const CHILD_W = 180;
  const CHILD_H = 50;
  const GAP = 10;

  // Is the cell already rendered as a swimlane container? If so, we
  // APPEND the new children rather than redoing the whole layout — that
  // preserves the existing children's positions and lets the user
  // backfill a child they previously removed without rebuilding the
  // group from scratch.
  const currentStyle = String(model.getStyle(parentCell) || "");
  const isAlreadyContainer = currentStyle.includes("shape=swimlane");
  const existingChildCount =
    isAlreadyContainer && typeof model.getChildCount === "function"
      ? model.getChildCount(parentCell)
      : 0;

  const totalCount = existingChildCount + children.length;
  const COLS = Math.min(3, Math.max(1, totalCount));
  const ROWS = Math.ceil(totalCount / COLS);
  const requiredW = COLS * CHILD_W + (COLS - 1) * GAP + PAD * 2;
  const requiredH = HEADER + PAD + ROWS * CHILD_H + (ROWS - 1) * GAP + PAD;
  const containerW = Math.max(geo.width, requiredW);
  const containerH = Math.max(geo.height, requiredH);

  const inserted: Array<{ cellId: string; cardId: string }> = [];
  model.beginUpdate();
  try {
    graph.resizeCell(
      parentCell,
      new win.mxRectangle(geo.x, geo.y, containerW, containerH),
    );

    // First-time drill-down: convert the cell to a swimlane. Re-drills
    // leave the existing style alone so we don't lose user-applied
    // tweaks (custom fill colour from "Convert to Container", for
    // example).
    if (!isAlreadyContainer) {
      const parentColor =
        /fillColor=([^;]+)/.exec(currentStyle)?.[1] || "#0f7eb5";
      const stroke = darken(parentColor);
      model.setStyle(
        parentCell,
        [
          "shape=swimlane",
          "startSize=" + HEADER,
          "horizontal=1",
          `fillColor=${parentColor}`,
          `fontColor=${readableTextColor(parentColor)}`,
          `strokeColor=${stroke}`,
          "fontSize=12",
          "fontStyle=1",
          "rounded=1",
          "arcSize=12",
          "html=1",
          "whiteSpace=wrap",
          "swimlaneLine=0",
        ].join(";"),
      );
    }

    // Insert each new child at the next free slot in the grid.
    for (let i = 0; i < children.length; i++) {
      const ch = children[i];
      const slot = existingChildCount + i;
      const r = Math.floor(slot / COLS);
      const c = slot % COLS;
      const x = PAD + c * (CHILD_W + GAP);
      const y = HEADER + PAD + r * (CHILD_H + GAP);

      const cellId = `dd-${ch.id.slice(0, 8)}-${Date.now()}-${i}`;
      const childStroke = darken(ch.color);
      const childStyle = [
        "rounded=1",
        "whiteSpace=wrap",
        "html=1",
        `fillColor=${ch.color}`,
        `fontColor=${readableTextColor(ch.color)}`,
        `strokeColor=${childStroke}`,
        "fontSize=11",
        "fontStyle=1",
        "arcSize=12",
        ...iconStyleParts(ch.icon),
      ].join(";");

      const xmlDoc = win.mxUtils.createXmlDocument();
      const obj = xmlDoc.createElement("object");
      obj.setAttribute("label", ch.name);
      obj.setAttribute("cardId", ch.id);
      obj.setAttribute("cardType", ch.type);
      // Mark as a drill-down child so future scans don't mistake the inner
      // cells for top-level cards.
      obj.setAttribute("drillDownChild", "1");

      graph.insertVertex(parentCell, cellId, obj, x, y, CHILD_W, CHILD_H, childStyle);
      inserted.push({ cellId, cardId: ch.id });
    }

    // Stash the inner cell ids on the parent so collapse can find them.
    // Preserve any existing ids so a backfill doesn't clobber prior
    // drills.
    const pv = parentCell.value;
    if (pv?.setAttribute) {
      const prior = (pv.getAttribute?.("drillDownChildIds") || "")
        .split(",")
        .filter(Boolean);
      const next = [...prior, ...inserted.map((c) => c.cellId)];
      pv.setAttribute("drillDownChildIds", next.join(","));
    }
  } finally {
    model.endUpdate();
  }

  return inserted;
}

/**
 * Roll-Up — wrap the current card cell + selected siblings inside a new
 * parent container. The container goes to the canvas root and the existing
 * cells are re-parented inside it. The original cells keep their identity
 * (cardId, cellId) so the dedup scan stays happy.
 */
export function rollUpInto(
  iframe: HTMLIFrameElement,
  currentCellId: string,
  parent: { id: string; name: string; type: string; color: string },
  siblings: Array<{ cellId: string | null; card: HierarchyChild }>,
): { parentCellId: string; insertedSiblings: Array<{ cellId: string; cardId: string }> } | null {
  const ctx = getMxGraph(iframe);
  if (!ctx) return null;
  const { win, graph } = ctx;
  const model = graph.getModel();
  const current = model.getCell(currentCellId);
  if (!current) return null;
  const currentGeo = graph.getCellGeometry(current);
  if (!currentGeo) return null;

  // Build the list of vertices to nest: the current card + a vertex per
  // sibling. Siblings that already exist on the canvas keep their cell;
  // missing ones are freshly inserted.
  const HEADER = 28;
  const PAD = 12;
  const CHILD_W = 180;
  const CHILD_H = 50;
  const GAP = 10;
  const count = 1 + siblings.length;
  const COLS = Math.min(3, Math.max(1, count));
  const ROWS = Math.ceil(count / COLS);
  const containerW = COLS * CHILD_W + (COLS - 1) * GAP + PAD * 2;
  const containerH = HEADER + PAD + ROWS * CHILD_H + (ROWS - 1) * GAP + PAD;

  const parentStroke = darken(parent.color);
  const parentCellId = `ru-${parent.id.slice(0, 8)}-${Date.now()}`;

  const inserted: Array<{ cellId: string; cardId: string }> = [];

  model.beginUpdate();
  try {
    // Insert the new container at the canvas root, anchored near the
    // current card so the user sees the relationship.
    const xmlDoc = win.mxUtils.createXmlDocument();
    const parentObj = xmlDoc.createElement("object");
    parentObj.setAttribute("label", parent.name);
    parentObj.setAttribute("cardId", parent.id);
    parentObj.setAttribute("cardType", parent.type);

    const containerX = Math.max(0, currentGeo.x - PAD);
    const containerY = Math.max(0, currentGeo.y - HEADER - PAD);
    const containerVertex = graph.insertVertex(
      graph.getDefaultParent(),
      parentCellId,
      parentObj,
      containerX,
      containerY,
      containerW,
      containerH,
      [
        "shape=swimlane",
        "startSize=" + HEADER,
        "horizontal=1",
        `fillColor=${parent.color}`,
        `fontColor=${readableTextColor(parent.color)}`,
        `strokeColor=${parentStroke}`,
        "fontSize=12",
        "fontStyle=1",
        "rounded=1",
        "arcSize=12",
        "html=1",
        "whiteSpace=wrap",
        "swimlaneLine=0",
      ].join(";"),
    );

    // Reposition + reparent the current card as the first child.
    graph.resizeCell(
      current,
      new win.mxRectangle(PAD, HEADER + PAD, CHILD_W, CHILD_H),
    );
    model.add(containerVertex, current);

    // Place one cell per sibling. Two paths:
    //   - `existingCellId` set → the sibling is already on the canvas; move
    //     that cell into the container, preserving its identity, style and
    //     chevron overlay. Mirrors how the current card is re-parented, so
    //     (like the current card) it is NOT stamped `rollUpChild` and NOT
    //     added to `inserted` — it's already registered by the caller.
    //   - `existingCellId` null → the sibling isn't on the canvas yet; create
    //     a fresh cell stamped `rollUpChild` and return it in `inserted`.
    siblings.forEach(({ cellId: existingCellId, card }, i) => {
      const slot = i + 1;
      const r = Math.floor(slot / COLS);
      const c = slot % COLS;
      const x = PAD + c * (CHILD_W + GAP);
      const y = HEADER + PAD + r * (CHILD_H + GAP);

      if (existingCellId) {
        const existing = model.getCell(existingCellId);
        if (existing) {
          graph.resizeCell(
            existing,
            new win.mxRectangle(x, y, CHILD_W, CHILD_H),
          );
          model.add(containerVertex, existing);
        }
        return;
      }

      const newCellId = `ruc-${card.id.slice(0, 8)}-${Date.now()}-${i}`;
      const childStroke = darken(card.color);
      const childStyle = [
        "rounded=1",
        "whiteSpace=wrap",
        "html=1",
        `fillColor=${card.color}`,
        `fontColor=${readableTextColor(card.color)}`,
        `strokeColor=${childStroke}`,
        "fontSize=11",
        "fontStyle=1",
        "arcSize=12",
        ...iconStyleParts(card.icon),
      ].join(";");

      const childObj = xmlDoc.createElement("object");
      childObj.setAttribute("label", card.name);
      childObj.setAttribute("cardId", card.id);
      childObj.setAttribute("cardType", card.type);
      childObj.setAttribute("rollUpChild", "1");

      graph.insertVertex(
        containerVertex,
        newCellId,
        childObj,
        x,
        y,
        CHILD_W,
        CHILD_H,
        childStyle,
      );
      inserted.push({ cellId: newCellId, cardId: card.id });
    });
  } finally {
    model.endUpdate();
  }

  return { parentCellId, insertedSiblings: inserted };
}

/* ------------------------------------------------------------------ */
/*  Phase 5 — view perspectives (color cells by attribute)             */
/* ------------------------------------------------------------------ */

/**
 * Iterate over every synced card cell and apply a fill color taken from
 * `colorByCardId`. Falls back to `defaultColor` when a card id is missing
 * or has no entry in the map. Used by the View Selector to recolor cells
 * by an attribute (lifecycle, criticality, …).
 */
export function applyViewToGraph(
  iframe: HTMLIFrameElement,
  colorByCardId: Map<string, string>,
  defaultColor: string,
): number {
  const ctx = getMxGraph(iframe);
  if (!ctx) return 0;
  const { graph } = ctx;
  const model = graph.getModel();
  const cells = model.cells || {};

  let touched = 0;
  model.beginUpdate();
  try {
    for (const k of Object.keys(cells)) {
      const cell = cells[k];
      if (!cell?.value?.getAttribute) continue;
      // Skip edges + child group cells (they take the parent's color anyway).
      if (cell.edge) continue;
      const cardId = cell.value.getAttribute("cardId");
      if (!cardId || cardId.startsWith("pending-")) continue;
      const color = colorByCardId.get(cardId) || defaultColor;
      const stroke = darken(color);
      const styleStr = (model.getStyle(cell) || "") as string;
      const next = styleStr
        .split(";")
        .filter(Boolean)
        .filter((p) => !p.startsWith("fillColor=") && !p.startsWith("strokeColor="))
        .concat([`fillColor=${color}`, `strokeColor=${stroke}`])
        .join(";");
      model.setStyle(cell, next);
      touched += 1;
    }
  } finally {
    model.endUpdate();
  }
  return touched;
}

/**
 * Restore each synced cell's style to its card-type color. Called when the
 * user switches the view back to "Card colors".
 */
export function resetViewColors(
  iframe: HTMLIFrameElement,
  colorByType: Map<string, string>,
  fallback: string,
): number {
  const ctx = getMxGraph(iframe);
  if (!ctx) return 0;
  const { graph } = ctx;
  const model = graph.getModel();
  const cells = model.cells || {};
  let touched = 0;
  model.beginUpdate();
  try {
    for (const k of Object.keys(cells)) {
      const cell = cells[k];
      if (!cell?.value?.getAttribute) continue;
      if (cell.edge) continue;
      const cardId = cell.value.getAttribute("cardId");
      if (!cardId) continue;
      const cardType = cell.value.getAttribute("cardType") || "";
      const color = colorByType.get(cardType) || fallback;
      const stroke = darken(color);
      const styleStr = (model.getStyle(cell) || "") as string;
      const next = styleStr
        .split(";")
        .filter(Boolean)
        .filter((p) => !p.startsWith("fillColor=") && !p.startsWith("strokeColor="))
        .concat([`fillColor=${color}`, `strokeColor=${stroke}`])
        .join(";");
      model.setStyle(cell, next);
      touched += 1;
    }
  } finally {
    model.endUpdate();
  }
  return touched;
}

/**
 * Add (or refresh) the card-type icon on every card-shaped cell already on the
 * canvas. Used by the "Apply card-type icons" toolbar action so cards placed on
 * a diagram before the icon feature existed can be upgraded in one click.
 *
 * Only touches rounded-rect card cells (those carrying a `cardType` attribute);
 * swimlane containers, ellipses, images and other hand-drawn shapes are skipped
 * so their geometry is preserved. The operation is additive and idempotent —
 * existing icon tokens are stripped and re-applied from the current metamodel,
 * so it also corrects any drift. Cells whose type has no bundled icon are left
 * as a plain coloured rectangle.
 */
export function applyCardTypeIcons(
  iframe: HTMLIFrameElement,
  iconByType: Map<string, string>,
): number {
  const ctx = getMxGraph(iframe);
  if (!ctx) return 0;
  const { graph } = ctx;
  const model = graph.getModel();
  const cells = model.cells || {};
  let touched = 0;
  model.beginUpdate();
  try {
    for (const k of Object.keys(cells)) {
      const cell = cells[k];
      if (!cell?.value?.getAttribute) continue;
      if (cell.edge) continue;
      const cardType = cell.value.getAttribute("cardType");
      if (!cardType) continue;
      const styleStr = (model.getStyle(cell) || "") as string;
      // Preserve swimlane containers / ellipses / images / user shapes — only
      // our default-rectangle card cells (no `shape=`) and already-iconed
      // `shape=label` cells are eligible.
      const shapeMatch = styleStr.match(/(?:^|;)shape=([^;]+)/);
      if (shapeMatch && shapeMatch[1] !== "label") continue;
      const kept = styleStr
        .split(";")
        .filter(Boolean)
        .filter(
          (p) =>
            !(
              p === "shape=label" ||
              p.startsWith("image=") ||
              p.startsWith("imageAlign=") ||
              p.startsWith("imageVerticalAlign=") ||
              p.startsWith("imageWidth=") ||
              p.startsWith("imageHeight=") ||
              p.startsWith("spacing")
            ),
        );
      const next = kept.concat(iconStyleParts(iconByType.get(cardType))).join(";");
      if (next !== styleStr) {
        model.setStyle(cell, next);
        touched += 1;
      }
    }
  } finally {
    model.endUpdate();
  }
  return touched;
}

/* ------------------------------------------------------------------ */
/*  Layered Dependency View → DrawIO diagram serialiser               */
/* ------------------------------------------------------------------ */

/** A card to render onto a generated diagram, positioned in graph space. */
export interface DiagramCardInput {
  cardId: string;
  cardType: string;
  name: string;
  color: string;
  /** Card-type Material Symbols icon name (e.g. "apps"). Optional. */
  icon?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A relation edge between two cards on a generated diagram. */
export interface DiagramRelInput {
  sourceCardId: string;
  targetCardId: string;
  relationType: string;
  label: string;
  color: string;
}

/** A background swim-lane box (one per EA layer). */
export interface DiagramLayerInput {
  label: string;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Serialise a set of positioned cards, relation edges and layer boxes into a
 * complete DrawIO `<mxGraphModel>` XML string — without touching a live graph.
 *
 * Used by the Layered Dependency View's "Create diagram" action to turn the
 * on-screen graph into a real, editable diagram. Card cells carry `cardId` /
 * `cardType` (so they stay dynamically connected to the inventory and are
 * picked up by the backend's card-ref extraction). Relation edges are stamped
 * with `relationType` for display but deliberately carry NO `pending="1"` flag
 * and NO `relationId`, so the editor's sync treats them as already-existing
 * relations and never tries to re-create them (see `scanDiagramItems`).
 *
 * Layer boxes are plain cells with no `cardId`, so they're ignored by card-ref
 * extraction and render behind the cards (emitted first).
 */
export function buildLdvDiagramXml(
  cards: DiagramCardInput[],
  rels: DiagramRelInput[],
  layers: DiagramLayerInput[],
): string {
  const r = (n: number) => Math.round(n);
  const parts: string[] = [];

  // Layer swim-lanes first so they paint behind the cards.
  layers.forEach((lyr, i) => {
    const style = [
      "rounded=1",
      "arcSize=2",
      `fillColor=${tint(lyr.color)}`,
      `strokeColor=${lyr.color}`,
      "strokeWidth=1.5",
      "dashed=1",
      "dashPattern=8 6",
      "verticalAlign=top",
      "align=left",
      "fontStyle=1",
      "fontSize=13",
      `fontColor=${darken(lyr.color)}`,
      "spacingLeft=10",
      "spacingTop=6",
      "html=1",
    ].join(";");
    parts.push(
      `<mxCell id="layer-${i}" value="${escapeXml(lyr.label)}" style="${escapeXml(style)}" ` +
        `vertex="1" parent="1">` +
        `<mxGeometry x="${r(lyr.x)}" y="${r(lyr.y)}" width="${r(lyr.w)}" height="${r(lyr.h)}" ` +
        `as="geometry"/></mxCell>`,
    );
  });

  // Cards. The id lives on the wrapping <object> (mxGraph's UserObject
  // encoding); edges reference these ids.
  const cellIdByCard = new Map<string, string>();
  cards.forEach((c, i) => {
    const cellId = `card-${i}-${c.cardId.slice(0, 8)}`;
    cellIdByCard.set(c.cardId, cellId);
    const { style } = buildCardCellData({
      cardId: c.cardId,
      cardType: c.cardType,
      name: c.name,
      color: c.color,
      icon: c.icon,
      x: c.x,
      y: c.y,
    });
    parts.push(
      `<object id="${escapeXml(cellId)}" label="${escapeXml(c.name)}" ` +
        `cardId="${escapeXml(c.cardId)}" cardType="${escapeXml(c.cardType)}">` +
        `<mxCell style="${escapeXml(style)}" vertex="1" parent="1">` +
        `<mxGeometry x="${r(c.x)}" y="${r(c.y)}" width="${r(c.w)}" height="${r(c.h)}" ` +
        `as="geometry"/></mxCell></object>`,
    );
  });

  // Relation edges between cards that both made it onto the diagram.
  let edgeIdx = 0;
  for (const rel of rels) {
    const src = cellIdByCard.get(rel.sourceCardId);
    const tgt = cellIdByCard.get(rel.targetCardId);
    if (!src || !tgt) continue;
    const style =
      `edgeStyle=entityRelationEdgeStyle;strokeColor=${rel.color};strokeWidth=1.5;` +
      `endArrow=none;startArrow=none;fontSize=10;fontColor=#666;html=1;`;
    // Only stamp a relationType for real relations; synthetic/hierarchy edges
    // (empty type) render as plain labelled lines.
    const relTypeAttr = rel.relationType
      ? ` relationType="${escapeXml(rel.relationType)}"`
      : "";
    parts.push(
      `<object id="edge-${edgeIdx}" label="${escapeXml(rel.label)}"${relTypeAttr}>` +
        `<mxCell style="${escapeXml(style)}" edge="1" parent="1" ` +
        `source="${escapeXml(src)}" target="${escapeXml(tgt)}">` +
        `<mxGeometry relative="1" as="geometry"/></mxCell></object>`,
    );
    edgeIdx += 1;
  }

  return (
    `<mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" ` +
    `connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" ` +
    `pageHeight="1100" math="0" shadow="0">` +
    `<root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
    parts.join("") +
    `</root></mxGraphModel>`
  );
}
