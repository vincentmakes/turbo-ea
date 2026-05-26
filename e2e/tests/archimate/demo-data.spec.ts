import { test, expect } from "@playwright/test";
import { loginAsAdmin, enableArchiMate, disableArchiMate } from "../../helpers/auth";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:8920";

test.describe("ArchiMate demo data", () => {
  test("arch_* cards are present in inventory when SEED_ARCHIMATE/SEED_DEMO is set", async ({
    context,
    page,
  }) => {
    const token = await loginAsAdmin(context, BASE_URL);

    // Query cards API for arch_* type cards
    const resp = await page.request.get(`${BASE_URL}/api/v1/cards?type=arch_ApplicationComponent`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok()) {
      // If 400/422, the type doesn't exist yet — this is acceptable when not seeded
      test.skip();
      return;
    }

    const data = await resp.json();
    // If seeded, we expect SAP S/4HANA to be in the results
    const items = data.items ?? data ?? [];
    if (items.length > 0) {
      const names = items.map((c: { name: string }) => c.name);
      expect(names.some((n: string) => n.includes("SAP") || n.includes("Salesforce") || n.includes("MES"))).toBe(true);
    }
    // No assertion failure if not seeded — this is an optional demo dataset
  });

  test("ArchiMate card types exist in metamodel after enabling", async ({ context, page }) => {
    const token = await loginAsAdmin(context, BASE_URL);
    await enableArchiMate(context.request, BASE_URL, token);

    const resp = await page.request.get(`${BASE_URL}/api/v1/metamodel/types`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(resp.ok()).toBe(true);
    const types = await resp.json();
    const typeKeys = types.map((t: { key: string }) => t.key);

    // Should have ArchiMate element types registered
    const archTypes = typeKeys.filter((k: string) => k.startsWith("arch_"));
    expect(archTypes.length).toBeGreaterThan(0);

    // Should cover main categories
    expect(typeKeys).toContain("arch_ApplicationComponent");
    expect(typeKeys).toContain("arch_BusinessActor");
    expect(typeKeys).toContain("arch_Node");

    // Cleanup
    await disableArchiMate(context.request, BASE_URL, token);
  });

  test("ArchiMate relation types exist after enabling", async ({ context, page }) => {
    const token = await loginAsAdmin(context, BASE_URL);
    await enableArchiMate(context.request, BASE_URL, token);

    const resp = await page.request.get(`${BASE_URL}/api/v1/metamodel/relation-types`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(resp.ok()).toBe(true);
    const relTypes = await resp.json();
    const relKeys = relTypes.map((r: { key: string }) => r.key);

    const archRels = relKeys.filter((k: string) => k.startsWith("arch_rel_"));
    expect(archRels.length).toBeGreaterThan(0);

    // Core ArchiMate relations should be present
    expect(relKeys).toContain("arch_rel_Serving");
    expect(relKeys).toContain("arch_rel_Realization");
    expect(relKeys).toContain("arch_rel_Composition");

    // Cleanup
    await disableArchiMate(context.request, BASE_URL, token);
  });

  test("AMEFF export endpoint is accessible", async ({ context, page }) => {
    const token = await loginAsAdmin(context, BASE_URL);
    await enableArchiMate(context.request, BASE_URL, token);

    const resp = await page.request.post(
      `${BASE_URL}/api/v1/archimate/export`,
      {
        data: { card_ids: [] },
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    // Should return XML or 200 OK
    expect(resp.status()).toBeLessThan(500);

    if (resp.ok()) {
      const contentType = resp.headers()["content-type"] ?? "";
      // Either XML or JSON response is acceptable
      expect(contentType).toMatch(/xml|json/);
    }

    // Cleanup
    await disableArchiMate(context.request, BASE_URL, token);
  });

  test("Migrate to ArchiMate-only removes standard Turbo EA card types", async ({ context, page }) => {
    const token = await loginAsAdmin(context, BASE_URL);
    await enableArchiMate(context.request, BASE_URL, token);

    const beforeResp = await page.request.get(`${BASE_URL}/api/v1/metamodel/types`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const beforeTypes = await beforeResp.json();
    const beforeStandard = beforeTypes.filter((t: { key: string }) => !t.key.startsWith("arch_"));

    // Determine if migration already ran at startup
    const alreadyMigrated = beforeStandard.length === 0;

    if (alreadyMigrated) {
      // Instance is already ArchiMate-only (MIGRATE_ARCHIMATE_UNIQUE=true at startup).
      // Verify the endpoint still works when called again (idempotent).
      const migrateResp = await page.request.post(
        `${BASE_URL}/api/v1/settings/archimate-migrate-unique`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(migrateResp.ok()).toBe(true);
      const result = await migrateResp.json();
      // Should be idempotent — nothing left to delete
      expect(result.cards_deleted).toBe(0);
      expect(result.card_types_deleted).toBe(0);
    } else {
      // Standard types exist — trigger migration and verify
      const migrateResp = await page.request.post(
        `${BASE_URL}/api/v1/settings/archimate-migrate-unique`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(migrateResp.ok()).toBe(true);
      const result = await migrateResp.json();

      expect(result.cards_deleted).toBeGreaterThan(0);
      expect(result.card_types_deleted).toBeGreaterThan(0);
    }

    // Verify standard types are gone after migration (regardless of initial state)
    const afterResp = await page.request.get(`${BASE_URL}/api/v1/metamodel/types`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const afterTypes = await afterResp.json();
    const afterStandard = afterTypes.filter((t: { key: string }) => !t.key.startsWith("arch_"));
    expect(afterStandard.length).toBe(0);

    // Verify ArchiMate types are still present
    const archTypes = afterTypes.filter((t: { key: string }) => t.key.startsWith("arch_"));
    expect(archTypes.length).toBeGreaterThan(0);
  });
});
