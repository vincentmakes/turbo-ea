/**
 * The print side of `EChart`: while the page prints, each chart is shown as a
 * flat, opaque picture of itself instead of its live canvases. See
 * `drawPrintCopy` for why, and `print.css` for the rules that hide the live
 * chart in print and the copy on screen.
 */
import type { ECharts } from "echarts/core";

import { PRINT_COLORS } from "@/theme/tokens";

/** The class on the flat picture that stands in for a chart while the page prints. */
export const ECHART_PRINT_COPY_CLASS = "echart-print-copy";

/** The class on a chart container while its print copy stands in for it. */
export const ECHART_PRINTING_CLASS = "echart-printing";

/** The scale the print copy is drawn at, so it stays sharp on paper. */
export const PRINT_PIXEL_RATIO = 3;

/**
 * Whether a computed CSS colour is fully opaque. Computed values come back as
 * `rgb…` (opaque), `rgba…` with the alpha as the fourth component, a
 * `color(…)` / modern form with the alpha after a slash, or `transparent`.
 */
export function isOpaqueColour(value: string): boolean {
  if (!value || value === "transparent") return false;
  const [, afterSlash] = value.split("/");
  const alpha =
    // Stryker disable next-line ConditionalExpression,StringLiteral: equivalent on the values that reach it, since getComputedStyle serialises a colour with alpha below 1 as rgba() / hsla() or with a slash, so a comma-form rgb() / hsl() never carries a fourth part
    afterSlash ?? (value.startsWith("rgba") || value.startsWith("hsla") ? value.split(",")[3] : undefined);
  if (alpha === undefined) return true;
  const amount = parseFloat(alpha);
  return (alpha.includes("%") ? amount / 100 : amount) >= 1;
}

/**
 * The colour a chart sits on: the computed background of the nearest
 * ancestor (the element itself included) that paints an opaque one, else
 * paper white. Reports print in the user's theme, so a dark card yields its
 * dark surface.
 */
export function printBackground(el: Element): string {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const colour = window.getComputedStyle(node).backgroundColor;
    if (isOpaqueColour(colour)) return colour;
  }
  return PRINT_COLORS.paper;
}

/** Removes a chart's print copy, if any, and shows the live chart again. */
export function removePrintCopy(el: HTMLElement): void {
  el.querySelectorAll(`:scope > .${ECHART_PRINT_COPY_CLASS}`).forEach((copy) => copy.remove());
  el.classList.remove(ECHART_PRINTING_CLASS);
}

/**
 * Re-lays the chart for the print page and puts a flat, opaque picture of it
 * in place of the live canvases (`print.css` hides those while the container
 * carries `ECHART_PRINTING_CLASS`, and never shows the copy on screen).
 *
 * Why a picture: Chrome prints a canvas repainted after print started by
 * replaying its drawing commands as vectors, and zrender opens every paint
 * with `clearRect`, which lands in the PDF as a transparency group with an
 * alpha soft mask; Apple's PDF viewers draw that as a white box over the
 * chart. A fresh canvas holding one `drawImage` of an opaque bitmap prints as
 * a plain image. `flush()` is needed because zrender repaints a resized chart
 * on the next animation frame, after the print has already read the canvas.
 */
export function drawPrintCopy(el: HTMLElement, chart: ECharts): void {
  removePrintCopy(el);
  if (chart.isDisposed()) return;
  chart.resize();
  chart.getZr().flush();
  const picture = chart.renderToCanvas({
    pixelRatio: PRINT_PIXEL_RATIO,
    backgroundColor: printBackground(el),
  });
  // A chart with no size has nothing to print; the live (empty) one stays.
  if (!picture.width || !picture.height) return;
  const copy = document.createElement("canvas");
  copy.width = picture.width;
  copy.height = picture.height;
  copy.className = ECHART_PRINT_COPY_CLASS;
  copy.setAttribute("aria-hidden", "true");
  copy.style.width = "100%";
  copy.style.height = "100%";
  copy.getContext("2d")?.drawImage(picture, 0, 0);
  el.appendChild(copy);
  el.classList.add(ECHART_PRINTING_CLASS);
}
