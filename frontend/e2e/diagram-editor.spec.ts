/**
 * The DrawIO diagram editor: the demo landscape loads with its cards and
 * relations, a card inserted from the context menu reaches the saved XML, and
 * the chevron's Expand menu adds a related card as a child of the expanded one.
 * Mutations run on a copy of the demo diagram that `afterAll` deletes.
 */
import { drawio, expect, gotoApp, readCanvas, test, waitForDrawio, BASE_URL, STORAGE_STATE } from "./fixtures";
import { t } from "./i18n";

test.describe.configure({ mode: "serial" });

test.describe("diagram editor", () => {
  let copyId: string | null = null;

  test.beforeEach(({ page }) => {
    // The editor's beforeunload guard fires while a change is pending.
    page.on("dialog", (dialog) => dialog.accept().catch(() => {}));
  });

  test.afterAll(async ({ playwright }) => {
    if (!copyId) return;
    const api = await playwright.request.newContext({ baseURL: BASE_URL, storageState: STORAGE_STATE });
    await api.delete(`/api/v1/diagrams/${copyId}`);
    await api.dispose();
  });

  test("loads the demo landscape with its cards and relation edges", async ({ page, demo }) => {
    await gotoApp(page, `/diagrams/${demo.landscapeDiagramId}/edit`);
    const frame = await waitForDrawio(page);
    await expect.poll(async () => (await readCanvas(frame)).cards.length).toBe(8);
    const canvas = await readCanvas(frame);
    expect(canvas.edges).toHaveLength(3);
    expect(new Set(canvas.cards.map((c) => c.cardId)).size).toBe(8);
  });

  /** An Application the landscape does not show, inserted by the second spec. */
  let candidate: { id: string; name: string } | null = null;

  test("inserts an existing card from the context menu and saves it into the diagram", async ({ page, demo, playwright }) => {
    const api = await playwright.request.newContext({ baseURL: BASE_URL, storageState: STORAGE_STATE });
    const original = (await (await api.get(`/api/v1/diagrams/${demo.landscapeDiagramId}`)).json()) as {
      data: unknown;
      card_ids: string[];
    };
    const apps = (await (await api.get("/api/v1/cards?type=Application&page_size=100")).json()) as {
      items: { id: string; name: string }[];
    };
    candidate = apps.items.find((c) => !original.card_ids.includes(c.id) && c.name.length <= 40) ?? null;
    expect(candidate, "an Application absent from the landscape").not.toBeNull();
    const created = await api.post("/api/v1/diagrams", {
      data: { name: `E2E copy ${Date.now()}`, data: original.data },
    });
    expect(created.ok(), `POST /diagrams answered ${created.status()}`).toBeTruthy();
    copyId = ((await created.json()) as { id: string }).id;
    await api.dispose();

    await gotoApp(page, `/diagrams/${copyId}/edit`);
    const frame = await waitForDrawio(page);
    const before = await readCanvas(frame);
    expect(before.cards.some((c) => c.cardId === candidate!.id)).toBe(false);

    // Right-click an empty spot of the canvas: DrawIO's popup menu carries the
    // SPA's own entries, which post back to the parent window.
    const container = drawio(page).locator(".geDiagramContainer");
    const box = await container.boundingBox();
    if (!box) throw new Error("no canvas box");
    await container.click({ button: "right", position: { x: box.width - 60, y: box.height - 60 } });
    // The menu item is a <tr> whose <td> carries the same class: target the cell.
    await drawio(page).locator("td.mxPopupMenuItem", { hasText: "Insert Existing Card" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder(t("common:cardPicker.searchPlaceholder")).fill(candidate!.name);
    const row = dialog.getByTestId("card-picker-list").getByText(candidate!.name, { exact: true }).first();
    await expect(row).toBeVisible();
    await row.click();
    await dialog.getByRole("button", { name: t("diagrams:insertDialog.insertSelected", { count: 1 }) }).click();

    await expect.poll(async () => (await readCanvas(frame)).cards.some((c) => c.cardId === candidate!.id)).toBe(true);

    // DrawIO's own save (Ctrl+S) posts the XML to the SPA, which PATCHes it.
    const saved = page.waitForResponse(
      (r) => r.url().includes(`/api/v1/diagrams/${copyId}`) && r.request().method() === "PATCH",
      { timeout: 30_000 },
    );
    await container.click({ position: { x: box.width - 40, y: box.height - 40 } });
    await page.keyboard.press("Control+s");
    const response = await saved;
    expect(response.ok()).toBeTruthy();
    const body = JSON.parse(response.request().postData() ?? "{}") as { data?: { xml?: string } };
    expect(body.data?.xml ?? "").toContain(candidate!.id);
  });

  test("expands a card's related cards from the chevron menu", async ({ page, demo }) => {
    expect(copyId, "the previous spec creates the copy").not.toBeNull();
    await gotoApp(page, `/diagrams/${copyId}/edit`);
    const frame = await waitForDrawio(page);
    const canvas = await readCanvas(frame);
    expect(canvas.cards.some((c) => c.cardId === candidate!.id), "the inserted card survived the save").toBe(true);
    // SAP S/4HANA sits on the landscape and carries relations to expand.
    const sapCell = canvas.cards.find((c) => c.cardId === demo.sapId);
    expect(sapCell).toBeDefined();

    // Fire the chevron overlay's CLICK the way mxGraph does, with a DOM-event
    // shaped payload so the menu anchors to it.
    await expect
      .poll(() =>
        frame.evaluate((cellId) => {
          type Overlay = { fireEvent: (evt: unknown) => void };
          const w = window as unknown as {
            __turboGraph: { getModel: () => { getCell: (id: string) => unknown }; getCellOverlays: (c: unknown) => Overlay[] | null };
            mxEventObject: new (name: string, ...args: unknown[]) => unknown;
            mxEvent: { CLICK: string };
          };
          const cell = w.__turboGraph.getModel().getCell(cellId);
          const overlays = w.__turboGraph.getCellOverlays(cell) ?? [];
          if (overlays.length === 0) return false;
          overlays[0].fireEvent(new w.mxEventObject(w.mxEvent.CLICK, "event", { clientX: 200, clientY: 200 }));
          return true;
        }, sapCell!.cellId),
      )
      .toBe(true);

    await expect(page.getByText(t("diagrams:editor.expandMenu.title"))).toBeVisible();
    const menu = page.getByRole("menu");
    const firstDependency = menu.getByRole("menuitem").filter({ has: page.getByRole("checkbox") }).first();
    await expect(firstDependency).toBeEnabled();
    await firstDependency.click();
    await menu.getByRole("button", { name: t("diagrams:editor.expandMenu.insertDeps", { count: 1 }) }).click();

    await expect
      .poll(async () => (await readCanvas(frame)).cards.filter((c) => c.parentGroupCell === sapCell!.cellId).length)
      .toBeGreaterThan(0);
  });
});
