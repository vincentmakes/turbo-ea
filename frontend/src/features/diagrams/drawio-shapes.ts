/**
 * Helpers for DrawIO fact-sheet shape insertion and extraction.
 *
 * Insertion now works via a custom "insertFactSheetCell" postMessage handled
 * by PreConfig.js inside the DrawIO iframe, which calls mxGraph.insertVertex
 * directly.  This avoids the XML merge action and its root-cell conflicts.
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

/**
 * Build the postMessage payload for inserting a fact sheet shape.
 * Sent to the DrawIO iframe where PreConfig.js handles it via the mxGraph API.
 */
export function buildFactSheetCell(opts: InsertFactSheetOpts): Record<string, unknown> {
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
    action: "insertFactSheetCell",
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
