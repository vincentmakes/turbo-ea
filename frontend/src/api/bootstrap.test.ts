/**
 * `primeBootstrap` pushes `/settings/bootstrap` into the per-hook singleton
 * caches. These tests cover the retention windows the Audit log reads; each
 * test re-imports fresh modules because both the primer and the hooks memoise
 * at module level.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
}));

import { api } from "@/api/client";

const BASE = {
  currency: "EUR",
  date_format: "YYYY-MM-DD",
  app_title: "Turbo EA",
  navbar_bg: "",
  navbar_fg: "",
  bpm_enabled: true,
  ppm_enabled: false,
  turbolens_enabled: false,
  grc_enabled: true,
  sponsor_button_enabled: true,
  file_uploads_enabled: true,
  enabled_locales: ["en"],
  fiscal_year_start: 1,
  archive_retention_days: 30,
  bpm_row_order: [],
  show_principles_tab: true,
  compliance_regulations: [],
  resource_types: [],
  login_tagline: "",
  login_tagline_hidden: false,
  login_help_text: "",
  login_help_link: "",
  smtp_configured: false,
};

async function fresh() {
  vi.resetModules();
  const boot = await import("./bootstrap");
  return { boot };
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
});

describe("primeBootstrap — audit-log retention", () => {
  it("primes both retention windows from one bootstrap read", async () => {
    const { boot } = await fresh();
    vi.mocked(api.get).mockResolvedValueOnce({
      ...BASE,
      audit_log_retention_days: 180,
      mutation_batch_retention_days: 21,
    });
    await boot.primeBootstrap();
    expect(api.get).toHaveBeenCalledWith("/settings/bootstrap");

    // The hook is now primed: mounting it must not fetch its own endpoint.
    const { renderHook } = await import("@testing-library/react");
    const { useAuditLogRetentionDays } = await import("@/hooks/useAuditLogRetentionDays");
    const { result } = renderHook(() => useAuditLogRetentionDays());
    expect(result.current.auditLogRetentionDays).toBe(180);
    expect(result.current.mutationBatchRetentionDays).toBe(21);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("keeps 0 (keep forever) rather than treating it as missing", async () => {
    const { boot } = await fresh();
    vi.mocked(api.get).mockResolvedValueOnce({
      ...BASE,
      audit_log_retention_days: 0,
      mutation_batch_retention_days: 15,
    });
    await boot.primeBootstrap();
    const { renderHook } = await import("@testing-library/react");
    const { useAuditLogRetentionDays } = await import("@/hooks/useAuditLogRetentionDays");
    const { result } = renderHook(() => useAuditLogRetentionDays());
    expect(result.current.auditLogRetentionDays).toBe(0);
  });

  it("leaves the hook unprimed when an older backend sends neither field", async () => {
    const { boot } = await fresh();
    vi.mocked(api.get).mockResolvedValueOnce({ ...BASE });
    await boot.primeBootstrap();
    vi.mocked(api.get).mockResolvedValueOnce({ days: 99 });
    const { renderHook, waitFor } = await import("@testing-library/react");
    const { useAuditLogRetentionDays } = await import("@/hooks/useAuditLogRetentionDays");
    const { result } = renderHook(() => useAuditLogRetentionDays());
    // Not primed, so the hook falls back to its own endpoint.
    await waitFor(() => expect(result.current.auditLogRetentionDays).toBe(99));
    expect(api.get).toHaveBeenLastCalledWith("/settings/audit-log-retention-days");
    expect(result.current.mutationBatchRetentionDays).toBe(15);
  });

  it("primes the batch window alone when only it is present", async () => {
    const { boot } = await fresh();
    vi.mocked(api.get).mockResolvedValueOnce({ ...BASE, mutation_batch_retention_days: 3 });
    await boot.primeBootstrap();
    const { renderHook } = await import("@testing-library/react");
    const { useAuditLogRetentionDays } = await import("@/hooks/useAuditLogRetentionDays");
    const { result } = renderHook(() => useAuditLogRetentionDays());
    expect(result.current.mutationBatchRetentionDays).toBe(3);
    expect(result.current.auditLogRetentionDays).toBe(365);
  });

  it("a failed bootstrap read is swallowed and leaves the cache empty", async () => {
    const { boot } = await fresh();
    vi.mocked(api.get).mockRejectedValueOnce(new Error("down"));
    await expect(boot.primeBootstrap()).resolves.toBeUndefined();
    vi.mocked(api.get).mockResolvedValueOnce({
      ...BASE,
      audit_log_retention_days: 12,
      mutation_batch_retention_days: 4,
    });
    // Not marked primed, so a second call reads again.
    await boot.primeBootstrap();
    expect(api.get).toHaveBeenCalledTimes(2);
  });
});
