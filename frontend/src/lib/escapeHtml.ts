/**
 * Escape a string for safe interpolation into HTML — a print document's
 * fragments, a chart tooltip's `formatter` output (ECharts renders a string
 * tooltip as HTML). A leaf module, so a chart helper can use it without
 * pulling in the print path.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
