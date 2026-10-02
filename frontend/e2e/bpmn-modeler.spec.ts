/**
 * The BPMN modeler (bpmn-js): the published Order to Cash flow renders its
 * steps, the palette and the properties panel work, and a change saves into
 * the draft version.
 */
import { expect, gotoApp, test } from "./fixtures";
import { t } from "./i18n";

test.describe("BPMN modeler", () => {
  test("renders the demo flow with its palette and properties panel", async ({ page, demo }) => {
    await gotoApp(page, `/bpm/processes/${demo.orderToCashId}/flow?versionId=${demo.orderToCashDraftId}`);
    await expect(page.locator(".djs-container")).toBeVisible();
    await expect(page.locator('[data-element-id="Task_ReceiveOrder"]')).toBeVisible();
    await expect(page.locator('[data-element-id="Task_CreditCheck"]')).toBeVisible();
    await expect(page.locator(".djs-palette")).toBeVisible();

    await page.getByTestId("bpmn-fit-to-screen").click();
    await expect(page.locator('[data-element-id="Task_ReceiveOrder"]')).toBeVisible();

    const panel = page.getByTestId("bpmn-properties-panel");
    if (!(await panel.isVisible())) await page.getByTestId("bpmn-toggle-properties").click();
    await expect(panel).toBeVisible();
    await expect(panel.locator(".bio-properties-panel")).toBeVisible();
  });

  test("saves a renamed step into the draft", async ({ page, demo }) => {
    await gotoApp(page, `/bpm/processes/${demo.orderToCashId}/flow?versionId=${demo.orderToCashDraftId}`);
    const task = page.locator('[data-element-id="Task_ReceiveOrder"]');
    await expect(task).toBeVisible();
    await task.click();

    const panel = page.getByTestId("bpmn-properties-panel");
    if (!(await panel.isVisible())) await page.getByTestId("bpmn-toggle-properties").click();
    // The General group may open collapsed; its header toggles the entries.
    const name = panel.locator("#bio-properties-panel-name");
    if (!(await name.isVisible())) {
      await panel.locator(".bio-properties-panel-group-header", { hasText: "General" }).first().click();
    }
    await expect(name).toBeVisible();
    const stamp = `Receive Order ${Date.now() % 100000}`;
    await name.fill(stamp);
    await name.blur();

    // The button's accessible name starts with its icon glyph ("save Save").
    const save = page.getByRole("button", { name: new RegExp(`${t("bpm:modeler.save")}$`) });
    await expect(save).toBeEnabled();
    const patched = page.waitForResponse(
      (r) => r.url().includes(`/flow/versions/${demo.orderToCashDraftId}`) && r.request().method() === "PATCH",
      { timeout: 30_000 },
    );
    await save.click();
    const response = await patched;
    expect(response.ok()).toBeTruthy();
    expect(response.request().postData() ?? "").toContain(stamp);
    await expect(page.getByText(t("bpm:modeler.draftSaved"))).toBeVisible();
  });
});
