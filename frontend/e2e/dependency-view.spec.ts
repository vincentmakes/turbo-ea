/**
 * The Layered Dependency View (React Flow): a deep link centres the card, the
 * graph draws its neighbours and edges, and a neighbour opens the card panel.
 */
import { expect, gotoApp, test } from "./fixtures";
import { t } from "./i18n";

test("the dependency view centres a deep-linked card and opens a neighbour", async ({ page, demo, request }) => {
  await gotoApp(page, `/reports/dependencies?center=${demo.sapId}`);
  await expect(page.locator('button[value="c4"][aria-pressed="true"]')).toBeVisible();
  const centre = page.locator(`.react-flow__node[data-id="${demo.sapId}"]`);
  await expect(centre).toBeVisible();
  await expect.poll(() => page.locator(".react-flow__edge").count()).toBeGreaterThan(0);

  // Card nodes only: the four layer boxes are React Flow nodes as well. React
  // Flow's zoom controls float over the canvas, and where the layout puts a
  // neighbour depends on the demo data's order, so take one nothing covers:
  // the element at its centre must be the node itself.
  const uncoveredNeighbour = () =>
    page.evaluate((centreId) => {
      const nodes = document.querySelectorAll<HTMLElement>(
        `.react-flow__node-ldvNode:not([data-id="${centreId}"])`,
      );
      for (const node of nodes) {
        const box = node.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        if (hit && node.contains(hit)) return node.dataset.id ?? null;
      }
      return null;
    }, demo.sapId);
  await expect.poll(uncoveredNeighbour).not.toBeNull();
  const neighbourId = await uncoveredNeighbour();
  const neighbour = page.locator(`.react-flow__node[data-id="${neighbourId}"]`);
  await expect(neighbour).toBeVisible();
  // The node's text starts with its type icon glyph, so take the name from the card itself.
  const card = (await (await request.get(`/api/v1/cards/${neighbourId}`)).json()) as { name: string };
  await neighbour.click();
  await expect(page.getByRole("presentation").getByText(card.name, { exact: true }).first()).toBeVisible();
});

test("shows a card's alias under its name once the Alias line is ticked", async ({ page, demo, request }) => {
  // The demo landscape carries no aliases, so give the centred card one for
  // the length of this spec and take it away again at the end.
  const alias = `E2E-${Date.now().toString(36)}`;
  const set = await request.patch(`/api/v1/cards/${demo.sapId}`, { data: { alias } });
  expect(set.ok(), `PATCH /cards answered ${set.status()}`).toBeTruthy();
  try {
    await gotoApp(page, `/reports/dependencies?center=${demo.sapId}`);
    const centre = page.locator(`.react-flow__node[data-id="${demo.sapId}"]`);
    await expect(centre).toBeVisible();
    await expect(centre).not.toContainText(alias);

    await page.getByRole("button", { name: t("common:cardDisplay.showOnCard") }).click();
    await page.getByRole("menu").getByText(t("common:labels.alias"), { exact: true }).click();
    await page.keyboard.press("Escape");

    // Rendered as a detail line like the subtype: the label, then the value.
    await expect(centre).toContainText(`${t("common:labels.alias")}:`);
    await expect(centre).toContainText(alias);
  } finally {
    await request.patch(`/api/v1/cards/${demo.sapId}`, { data: { alias: null } });
  }
});

test("a layer box's left edge follows a card dragged out of it and back", async ({ page, demo }) => {
  await gotoApp(page, `/reports/dependencies?center=${demo.sapId}`);
  const centre = page.locator(`.react-flow__node[data-id="${demo.sapId}"]`);
  await expect(centre).toBeVisible();

  // The layer box a card sits in, found by geometry: the DOM does not carry
  // React Flow's parentId, but a card is always drawn inside its box.
  const laneOf = (cardId: string) =>
    page.evaluate((id) => {
      const card = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`);
      if (!card) return null;
      const c = card.getBoundingClientRect();
      const cx = c.left + c.width / 2;
      const cy = c.top + c.height / 2;
      for (const lane of document.querySelectorAll<HTMLElement>(".react-flow__node-ldvGroup")) {
        const r = lane.getBoundingClientRect();
        if (cx > r.left && cx < r.right && cy > r.top && cy < r.bottom) return lane.dataset.id ?? null;
      }
      return null;
    }, cardId);
  await expect.poll(() => laneOf(demo.sapId)).not.toBeNull();
  const lane = page.locator(`.react-flow__node[data-id="${await laneOf(demo.sapId)}"]`);

  const laid = (await lane.boundingBox())!;
  const start = (await centre.boundingBox())!;
  const grab = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
  // Far enough that the card must leave the box on the left. 20 px a move is
  // an ordinary hand's pace; it is also more than the box's inset at the
  // fitted zoom, so every move presses the card against the edge, which is
  // where React Flow's own copy of the card's position used to go stale and
  // swallow the moves (the box stopped growing and the card lagged the pointer).
  const out = Math.round(start.x - laid.x + 150);
  const STEP = 20;

  // React Flow starts a drag on the first move *past* its 1 px threshold and
  // measures the grab from there, so open with two hand-sized nudges; a 20 px
  // opener would leave the card 20 px behind the pointer for the whole drag.
  const steps = (from: number, to: number) => {
    const xs: number[] = [];
    for (let dx = from; from < to ? dx < to : dx > to; dx += from < to ? STEP : -STEP) xs.push(dx);
    return [...xs, to];
  };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x - 1, grab.y);
  await page.mouse.move(grab.x - 2, grab.y);
  for (const dx of steps(2 + STEP, out)) await page.mouse.move(grab.x - dx, grab.y);

  // Out of its box for the drag, the card is still drawn on top of the cards
  // and boxes it crosses rather than sliding under them.
  expect(Number(await centre.evaluate((n) => (n as HTMLElement).style.zIndex))).toBeGreaterThan(1);
  // The card stays under the pointer, and the box's left edge went with it.
  await expect
    .poll(async () => Math.abs((await centre.boundingBox())!.x - (start.x - out)))
    .toBeLessThan(3);
  const grown = (await lane.boundingBox())!;
  expect(grown.x).toBeLessThan(start.x - out);
  expect(grown.x).toBeLessThan(laid.x - 100);
  expect(Math.abs(grown.x + grown.width - (laid.x + laid.width))).toBeLessThan(2);

  for (const dx of steps(out - STEP, 0)) await page.mouse.move(grab.x - dx, grab.y);
  await page.mouse.up();

  // Back in its box once released, at a child's ordinary stacking order.
  await expect.poll(async () => Number(await centre.evaluate((n) => (n as HTMLElement).style.zIndex))).toBe(1);
  // Back where it started: the box shrinks back to its laid-out rectangle.
  await expect.poll(async () => Math.abs((await lane.boundingBox())!.x - laid.x)).toBeLessThan(1);
  const back = (await lane.boundingBox())!;
  expect(Math.abs(back.width - laid.width)).toBeLessThan(2);
  const home = (await centre.boundingBox())!;
  expect(Math.abs(home.x - start.x)).toBeLessThan(3);
});
