/**
 * The Layered Dependency View (React Flow): a deep link centres the card, the
 * graph draws its neighbours and edges, and a neighbour opens the card panel.
 */
import { expect, gotoApp, test } from "./fixtures";

test("the dependency view centres a deep-linked card and opens a neighbour", async ({ page, demo, request }) => {
  await gotoApp(page, `/reports/dependencies?center=${demo.sapId}`);
  await expect(page.locator('button[value="c4"][aria-pressed="true"]')).toBeVisible();
  const centre = page.locator(`.react-flow__node[data-id="${demo.sapId}"]`);
  await expect(centre).toBeVisible();
  await expect.poll(() => page.locator(".react-flow__edge").count()).toBeGreaterThan(0);

  // Card nodes only: the four layer boxes are React Flow nodes as well.
  const neighbour = page.locator(`.react-flow__node-ldvNode:not([data-id="${demo.sapId}"])`).first();
  await expect(neighbour).toBeVisible();
  // The node's text starts with its type icon glyph, so take the name from the card itself.
  const neighbourId = await neighbour.getAttribute("data-id");
  expect(neighbourId).toBeTruthy();
  const card = (await (await request.get(`/api/v1/cards/${neighbourId}`)).json()) as { name: string };
  await neighbour.click();
  await expect(page.getByRole("presentation").getByText(card.name, { exact: true }).first()).toBeVisible();
});
