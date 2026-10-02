/**
 * The PPM Gantt (gantt-task-react): the demo initiative's timeline renders its
 * bars and both milestones.
 */
import { expect, gotoApp, test } from "./fixtures";

test("the initiative Gantt renders bars and milestones", async ({ page, demo }) => {
  await gotoApp(page, `/ppm/${demo.migrationId}?tab=gantt`);
  await expect(page.getByTestId("gantt-main")).toBeVisible();
  await expect.poll(() => page.locator('[data-testid^="task-bar-"]').count()).toBeGreaterThan(0);
  await expect(page.getByTestId("task-milestone-Go/No-Go Decision")).toBeVisible();
  await expect(page.getByTestId("task-milestone-Go-Live")).toBeVisible();
});
