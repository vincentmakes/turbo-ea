/**
 * Generates DrawIO mxGraphModel XML for inserting fact sheet shapes.
 *
 * Uses <object> elements with custom attributes (factSheetId, factSheetType)
 * so we can extract references when parsing the saved diagram XML.
 * This is the standard DrawIO pattern for metadata on cells.
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

/** Escape XML special characters */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface InsertFactSheetOpts {
  factSheetId: string;
  factSheetType: string;
  name: string;
  color: string;
  x: number;
  y: number;
}

/**
 * Build the mxGraphModel XML to merge a single fact sheet shape into DrawIO.
 * The shape is a rounded rectangle colored by the type, with metadata stored
 * as attributes on the <object> element.
 */
export function buildFactSheetXml(opts: InsertFactSheetOpts): string {
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

  return [
    '<mxGraphModel><root>',
    `<object label="${esc(name)}" factSheetId="${esc(factSheetId)}" factSheetType="${esc(factSheetType)}" id="${cellId}">`,
    `<mxCell style="${style}" vertex="1" parent="1">`,
    `<mxGeometry x="${x}" y="${y}" width="180" height="60" as="geometry"/>`,
    "</mxCell>",
    "</object>",
    "</root></mxGraphModel>",
  ].join("");
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
