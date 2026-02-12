/**
 * Helpers for DrawIO fact-sheet shape insertion and extraction.
 *
 * Insertion uses same-origin access to the DrawIO iframe — we call
 * graph.insertVertex() directly from the parent window, bypassing
 * postMessage entirely.  This is the most reliable approach because
 * it avoids XML merge root-cell conflicts and plugin lifecycle issues.
 */

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

export interface InsertFactSheetOpts {
  factSheetId: string;
  factSheetType: string;
  name: string;
  color: string;
  x: number;
  y: number;
}

/** Shape data needed for direct mxGraph API insertion */
export interface FactSheetCellData {
  cellId: string;
  label: string;
  factSheetId: string;
  factSheetType: string;
  x: number;
  y: number;
  width: number;
  height: number;
  style: string;
}

/**
 * Build the data for inserting a fact sheet shape via the mxGraph API.
 */
export function buildFactSheetCellData(opts: InsertFactSheetOpts): FactSheetCellData {
  const { factSheetId, factSheetType, name, color, x, y } = opts;
  const stroke = darken(color);
  const cellId = `fs-${factSheetId.slice(0, 8)}-${Date.now()}`;

  const style = [
    "rounded=1",
    "whiteSpace=wrap",
    "html=1",
    `fillColor=${color}`,
    "fontColor=#ffffff",
    `strokeColor=${stroke}`,
    "fontSize=12",
    "fontStyle=1",
    "arcSize=12",
    "shadow=1",
  ].join(";");

  return {
    cellId,
    label: name,
    factSheetId,
    factSheetType,
    x,
    y,
    width: 180,
    height: 60,
    style,
  };
}

/**
 * Insert a fact sheet shape directly into the DrawIO graph via same-origin
 * iframe access.  Returns true on success, false if the graph isn't ready.
 */
export function insertFactSheetIntoGraph(
  iframe: HTMLIFrameElement,
  data: FactSheetCellData
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
    obj.setAttribute("factSheetId", data.factSheetId);
    obj.setAttribute("factSheetType", data.factSheetType);

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
 * Parse diagram XML and return the set of factSheetId values found.
 * Used client-side for display; the backend does its own authoritative parse.
 */
export function extractFactSheetIds(xml: string): string[] {
  const ids: string[] = [];
  const re = /factSheetId="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

/* ------------------------------------------------------------------ */
/*  Pending (unsynchronised) cell helpers                              */
/* ------------------------------------------------------------------ */

/** Style for a pending (not-yet-synced) fact sheet cell — dashed border */
function buildPendingStyle(color: string): string {
  const stroke = darken(color);
  return [
    "rounded=1", "whiteSpace=wrap", "html=1",
    `fillColor=${color}`, "fontColor=#ffffff",
    `strokeColor=${stroke}`, "fontSize=12",
    "fontStyle=1", "arcSize=12",
    "dashed=1", "dashPattern=5 3",
  ].join(";");
}

/** Style for a synced (normal) fact sheet cell */
function buildSyncedStyle(color: string): string {
  const stroke = darken(color);
  return [
    "rounded=1", "whiteSpace=wrap", "html=1",
    `fillColor=${color}`, "fontColor=#ffffff",
    `strokeColor=${stroke}`, "fontSize=12",
    "fontStyle=1", "arcSize=12", "shadow=1",
  ].join(";");
}

/**
 * Insert a pending (not-yet-synced) fact sheet cell.
 * Uses a dashed border to distinguish it from synced cells.
 */
export function insertPendingFactSheet(
  iframe: HTMLIFrameElement,
  opts: { tempId: string; type: string; name: string; color: string; x: number; y: number },
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
  obj.setAttribute("factSheetId", opts.tempId);
  obj.setAttribute("factSheetType", opts.type);
  obj.setAttribute("pending", "1");

  model.beginUpdate();
  try {
    graph.insertVertex(parent, cellId, obj, opts.x, opts.y, 180, 60, buildPendingStyle(opts.color));
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
 * Mark a pending cell as synced: update its factSheetId to the real one
 * and switch from dashed to solid style.
 */
export function markCellSynced(
  iframe: HTMLIFrameElement,
  cellId: string,
  realFactSheetId: string,
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
      obj.setAttribute("factSheetId", realFactSheetId);
      if (obj.removeAttribute) obj.removeAttribute("pending");
    }
    model.setStyle(cell, buildSyncedStyle(color));
  } finally {
    model.endUpdate();
  }
  return true;
}

/**
 * Mark a pending relation edge as synced (remove dashed style).
 */
export function markEdgeSynced(
  iframe: HTMLIFrameElement,
  edgeCellId: string,
  color: string,
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
  sourceFactSheetId: string;
  targetFactSheetId: string;
  sourceName: string;
  targetName: string;
}

export interface ScannedSyncedFS {
  cellId: string;
  factSheetId: string;
  name: string;
  type: string;
}

/**
 * Scan the graph for pending and synced items.
 */
export function scanDiagramItems(iframe: HTMLIFrameElement): {
  pendingFS: ScannedPendingFS[];
  pendingRels: ScannedPendingRel[];
  syncedFS: ScannedSyncedFS[];
} {
  const pendingFS: ScannedPendingFS[] = [];
  const pendingRels: ScannedPendingRel[] = [];
  const syncedFS: ScannedSyncedFS[] = [];

  const ctx = getMxGraph(iframe);
  if (!ctx) return { pendingFS, pendingRels, syncedFS };
  const { graph } = ctx;

  const cells = graph.getModel().cells || {};
  for (const k of Object.keys(cells)) {
    const cell = cells[k];
    if (!cell?.value?.getAttribute) continue;

    const isPending = cell.value.getAttribute("pending") === "1";
    const fsId = cell.value.getAttribute("factSheetId");
    const relType = cell.value.getAttribute("relationType");

    if (relType && isPending) {
      // Pending relation edge
      const src = graph.getModel().getTerminal(cell, true);
      const tgt = graph.getModel().getTerminal(cell, false);
      pendingRels.push({
        edgeCellId: cell.id,
        relationType: relType,
        relationLabel: cell.value.getAttribute("label") || relType,
        sourceFactSheetId: src?.value?.getAttribute?.("factSheetId") || "",
        targetFactSheetId: tgt?.value?.getAttribute?.("factSheetId") || "",
        sourceName: src?.value?.getAttribute?.("label") || "?",
        targetName: tgt?.value?.getAttribute?.("label") || "?",
      });
    } else if (fsId && isPending) {
      // Pending fact sheet vertex
      pendingFS.push({
        cellId: cell.id,
        tempId: fsId,
        type: cell.value.getAttribute("factSheetType") || "",
        name: cell.value.getAttribute("label") || "",
      });
    } else if (fsId && !isPending && !cell.value.getAttribute("parentGroupCell")) {
      // Synced top-level fact sheet vertex
      syncedFS.push({
        cellId: cell.id,
        factSheetId: fsId,
        name: cell.value.getAttribute("label") || "",
        type: cell.value.getAttribute("factSheetType") || "",
      });
    }
  }

  return { pendingFS, pendingRels, syncedFS };
}

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

const CHILD_CARD_W = 160;
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
  relationType: string;
}

/**
 * Add a +/− overlay icon to a fact sheet cell.
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

  const overlay = new win.mxCellOverlay(
    new win.mxImage(expanded ? MINUS_OVERLAY : PLUS_OVERLAY, 20, 20),
    expanded ? "Collapse" : "Expand related fact sheets",
    win.mxConstants.ALIGN_RIGHT,
    win.mxConstants.ALIGN_MIDDLE,
    new win.mxPoint(0, 0),
  );
  overlay.cursor = "pointer";
  overlay.addListener(win.mxEvent.CLICK, () => onClick());

  graph.addCellOverlay(cell, overlay);
  return true;
}

/**
 * Insert child vertices + edges around a parent fact sheet cell.
 * Children are laid out in a column to the right, grouped by type.
 */
export function expandFactSheetGroup(
  iframe: HTMLIFrameElement,
  parentCellId: string,
  children: ExpandChildData[],
): Array<{ cellId: string; factSheetId: string }> {
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

  const inserted: Array<{ cellId: string; factSheetId: string }> = [];
  model.beginUpdate();
  try {
    let yOff = 0;
    for (let i = 0; i < children.length; i++) {
      if (i > 0) {
        yOff += children[i].type !== children[i - 1].type ? TYPE_GROUP_GAP : CHILD_GAP_Y;
      }
      const ch = children[i];
      const cid = `fsg-${ch.id.slice(0, 8)}-${Date.now()}-${i}`;
      const stroke = darken(ch.color);
      const style = [
        "rounded=1", "whiteSpace=wrap", "html=1",
        `fillColor=${ch.color}`, "fontColor=#ffffff",
        `strokeColor=${stroke}`, "fontSize=11",
        "fontStyle=1", "arcSize=12",
      ].join(";");

      const xmlDoc = win.mxUtils.createXmlDocument();
      const obj = xmlDoc.createElement("object");
      obj.setAttribute("label", ch.name);
      obj.setAttribute("factSheetId", ch.id);
      obj.setAttribute("factSheetType", ch.type);
      obj.setAttribute("parentGroupCell", parentCellId);

      const vertex = graph.insertVertex(
        root, cid, obj, startX, startY + yOff, CHILD_CARD_W, CHILD_CARD_H, style,
      );

      graph.insertEdge(
        root, `fse-${cid}`, "",
        parentCell, vertex,
        `edgeStyle=entityRelationEdgeStyle;strokeColor=${ch.color};strokeWidth=1.5;endArrow=none;startArrow=none`,
      );

      inserted.push({ cellId: cid, factSheetId: ch.id });
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
export function collapseFactSheetGroup(
  iframe: HTMLIFrameElement,
  parentCellId: string,
): boolean {
  const ctx = getMxGraph(iframe);
  if (!ctx) return false;
  const { graph } = ctx;

  const model = graph.getModel();
  const parentCell = model.getCell(parentCellId);
  if (!parentCell) return false;

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

  if (toRemove.length === 0) return false;

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

  return true;
}

/**
 * Scan all cells and add expand/collapse overlays to every fact sheet cell
 * (including children from previous expansions).
 */
export function refreshFactSheetOverlays(
  iframe: HTMLIFrameElement,
  onToggle: (cellId: string, factSheetId: string, currentlyExpanded: boolean) => void,
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

    const fsId = cell.value.getAttribute("factSheetId");
    if (!fsId) continue;

    let expanded = cell.value.getAttribute("expanded") === "1";
    // If marked expanded but children were deleted, treat as collapsed
    if (expanded && !parentsWithChildren.has(cell.id)) expanded = false;

    addExpandOverlay(iframe, cell.id, expanded, () => {
      onToggle(cell.id, fsId, expanded);
    });
  }
}
