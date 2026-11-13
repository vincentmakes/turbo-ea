/**
 * Report charts print as flat pictures. Chrome prints a canvas that was
 * repainted for print by replaying its drawing commands as vectors, and
 * ECharts starts every paint with `clearRect`, which Chrome's PDF backend
 * writes as a transparency group with an alpha soft mask (`/SMask` with
 * `/S /Alpha`). Apple's PDF viewers draw those as white boxes over the chart.
 * `EChart` therefore shows an opaque bitmap copy of each chart while the page
 * prints, so the PDF carries one image per chart and no soft mask at all.
 *
 * `page.pdf()` is called WITHOUT `page.emulateMedia({ media: "print" })`:
 * emulating print first makes Chrome print a bitmap snapshot of the canvas
 * and hides the bug. `page.pdf` is Chromium-only, as is the suite.
 */
import type { Page } from "@playwright/test";

import { expect, gotoApp, test } from "./fixtures";

/** How much ink each chart's first canvas holds (a sample of its alpha channel). */
function chartInk(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll(".echart-container")].map((el) => {
      const canvas = el.querySelector("canvas");
      const ctx = canvas && canvas.width > 0 ? canvas.getContext("2d") : null;
      if (!canvas || !ctx) return 0;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0;
      for (let i = 3; i < data.length; i += 16) if (data[i] > 0) ink++;
      return ink;
    }),
  );
}

/** Waits until at least `min` charts are drawn and their entry animation has ended. */
async function waitForCharts(page: Page, min: number): Promise<number> {
  let previous = "";
  let count = 0;
  await expect
    .poll(
      async () => {
        const ink = await chartInk(page);
        const signature = JSON.stringify(ink);
        const settled = ink.length >= min && ink.every((v) => v > 0) && signature === previous;
        previous = signature;
        count = ink.length;
        return settled;
      },
      { intervals: [250], timeout: 30_000, message: "the report's charts never finished drawing" },
    )
    .toBe(true);
  return count;
}

function pdfStats(pdf: Buffer) {
  const text = pdf.toString("latin1");
  const count = (re: RegExp) => (text.match(re) ?? []).length;
  return {
    alphaMasks: count(/\/S\s*\/Alpha/g),
    softMasks: count(/\/SMask\b/g),
    images: count(/\/Subtype\s*\/Image/g),
  };
}

async function printAndCheck(page: Page, charts: number) {
  await page.evaluate(() => document.fonts.ready);
  const pdf = await page.pdf({ format: "A4", landscape: true });
  const stats = pdfStats(pdf);
  expect(stats.alphaMasks, "an alpha soft mask in the PDF: Apple's viewers draw it as a white box").toBe(0);
  expect(stats.softMasks, "the printed chart copies are opaque and carry no soft mask").toBe(0);
  expect(stats.images, "every chart prints as an image").toBeGreaterThanOrEqual(charts);
  // Printing ends cleanly: the live charts are back and no copy is left over.
  await expect(page.locator(".echart-container canvas:not([aria-hidden])").first()).toBeVisible();
  await expect(page.locator(".echart-print-copy")).toHaveCount(0);
}

test("the Initiative Report prints its spend charts as images without soft masks", async ({ page, demo }) => {
  await gotoApp(page, `/ppm/${demo.migrationId}/report`);
  const charts = await waitForCharts(page, 3);
  await printAndCheck(page, charts);
});

test("a dark-theme Initiative Report prints its headings and their icons in ink", async ({ page, demo }) => {
  // The page prints on white, so text and icons set directly on it in the
  // dark theme's light colour would vanish (print.css). This test reads
  // computed colours only, so emulating print media is harmless here.
  await page.addInitScript(() => localStorage.setItem("turboea-theme-mode", "dark"));
  await gotoApp(page, `/ppm/${demo.migrationId}/report`);
  const heading = page.locator(".ppm-report-heading").first();
  await expect(heading).toBeVisible();
  const colours = () =>
    page.evaluate(() => {
      const colour = (el: Element | null) => (el ? getComputedStyle(el).color : null);
      const head = document.querySelector(".ppm-report-heading");
      return {
        icon: colour(head?.querySelector(".material-symbols-outlined") ?? null),
        text: colour(head?.querySelector(".MuiTypography-root") ?? null),
        title: colour(document.querySelector(".report-title")),
        typeIcon: colour(document.querySelector(".report-title")?.previousElementSibling ?? null),
      };
    });
  const onScreen = await colours();
  await page.emulateMedia({ media: "print" });
  const printed = await colours();
  await page.emulateMedia({ media: null });
  const ink = "rgb(51, 51, 51)";
  expect(onScreen.icon, "on screen the dark theme keeps its light heading icon").not.toBe(ink);
  expect(printed.icon, "a section heading's icon prints in ink").toBe(ink);
  expect(printed.text, "a section heading prints in ink").toBe(ink);
  expect(printed.title, "the report title prints in ink").toBe(ink);
  expect(printed.typeIcon, "the card-type icon keeps its own colour").toBe(onScreen.typeIcon);
  expect(printed.typeIcon).not.toBe(ink);
});

test("the Cost report prints its chart as an image without soft masks", async ({ page }) => {
  await gotoApp(page, "/reports/cost");
  const charts = await waitForCharts(page, 1);
  await printAndCheck(page, charts);
});
