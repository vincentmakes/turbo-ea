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
