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
    const doc = iframe.contentDocument;
    if (!win || !doc) return false;

    // Obtain the graph.  After DrawIO init the reference is stored by our
    // bootstrap (see DiagramEditor's init handler) on window.__turboGraph.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const graph: any = win.__turboGraph;
    if (!graph) return false;

    const model = graph.getModel();
    const parent = graph.getDefaultParent();

    // Create an <object> element carrying the custom attributes that the
    // backend regex will extract (factSheetId, factSheetType).
    const obj = doc.createElement("object");
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
