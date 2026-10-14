import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn(),
  },
}));

import { api } from "@/api/client";

// The module caches at module level, so each test re-imports a fresh copy.
async function load() {
  return import("./useAuditLogRetentionDays");
}

describe("useAuditLogRetentionDays", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.resetModules();
  });

  it("starts from the defaults before the fetch lands", async () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    const mod = await load();
    const { result } = renderHook(() => mod.useAuditLogRetentionDays());
    expect(result.current.auditLogRetentionDays).toBe(365);
    expect(result.current.mutationBatchRetentionDays).toBe(15);
    expect(result.current.auditLogRetentionLoaded).toBe(false);
    expect(mod.DEFAULT_AUDIT_LOG_RETENTION_DAYS).toBe(365);
    expect(mod.DEFAULT_MUTATION_BATCH_RETENTION_DAYS).toBe(15);
  });

  it("reads the audit-log window from its endpoint when not primed", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ days: 90 });
    const mod = await load();
    const { result } = renderHook(() => mod.useAuditLogRetentionDays());
    await waitFor(() => expect(result.current.auditLogRetentionLoaded).toBe(true));
    expect(result.current.auditLogRetentionDays).toBe(90);
    expect(result.current.mutationBatchRetentionDays).toBe(15);
    expect(api.get).toHaveBeenCalledWith("/settings/audit-log-retention-days");
  });

  it("falls back to the defaults when the fetch fails", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("down"));
    const mod = await load();
    const { result } = renderHook(() => mod.useAuditLogRetentionDays());
    await waitFor(() => expect(result.current.auditLogRetentionLoaded).toBe(true));
    expect(result.current.auditLogRetentionDays).toBe(365);
    expect(result.current.mutationBatchRetentionDays).toBe(15);
  });

  it("a bootstrap prime skips the fetch and carries both windows", async () => {
    const mod = await load();
    mod.invalidateAuditLogRetentionDays({
      auditLogRetentionDays: 0,
      mutationBatchRetentionDays: 30,
    });
    const { result } = renderHook(() => mod.useAuditLogRetentionDays());
    expect(result.current.auditLogRetentionDays).toBe(0);
    expect(result.current.mutationBatchRetentionDays).toBe(30);
    expect(result.current.auditLogRetentionLoaded).toBe(true);
    expect(api.get).not.toHaveBeenCalled();
  });

  it("a bare number updates only the audit-log window, live", async () => {
    const mod = await load();
    mod.invalidateAuditLogRetentionDays({ mutationBatchRetentionDays: 20 });
    const { result } = renderHook(() => mod.useAuditLogRetentionDays());
    act(() => mod.invalidateAuditLogRetentionDays(730));
    expect(result.current.auditLogRetentionDays).toBe(730);
    expect(result.current.mutationBatchRetentionDays).toBe(20);
  });

  it("ignores non-numeric fields of a partial prime", async () => {
    const mod = await load();
    mod.invalidateAuditLogRetentionDays({
      auditLogRetentionDays: undefined,
      mutationBatchRetentionDays: 7,
    });
    const { result } = renderHook(() => mod.useAuditLogRetentionDays());
    expect(result.current.auditLogRetentionDays).toBe(365);
    expect(result.current.mutationBatchRetentionDays).toBe(7);
  });

  it("invalidate() with no value re-reads the endpoint and keeps the batch window", async () => {
    const mod = await load();
    mod.invalidateAuditLogRetentionDays({ auditLogRetentionDays: 10, mutationBatchRetentionDays: 25 });
    const { result } = renderHook(() => mod.useAuditLogRetentionDays());
    vi.mocked(api.get).mockResolvedValueOnce({ days: 120 });
    act(() => result.current.invalidateAuditLogRetention());
    await waitFor(() => expect(result.current.auditLogRetentionDays).toBe(120));
    expect(result.current.mutationBatchRetentionDays).toBe(25);

    act(() => result.current.invalidateAuditLogRetention(5));
    expect(result.current.auditLogRetentionDays).toBe(5);
  });

  it("shares one inflight request across hooks mounted in the same tick", async () => {
    let resolve: (v: { days: number }) => void = () => {};
    vi.mocked(api.get).mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const mod = await load();
    const a = renderHook(() => mod.useAuditLogRetentionDays());
    const b = renderHook(() => mod.useAuditLogRetentionDays());
    expect(api.get).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ days: 42 }));
    expect(a.result.current.auditLogRetentionDays).toBe(42);
    expect(b.result.current.auditLogRetentionDays).toBe(42);
  });

  it("stops notifying an unmounted hook", async () => {
    const mod = await load();
    mod.invalidateAuditLogRetentionDays(1);
    const { result, unmount } = renderHook(() => mod.useAuditLogRetentionDays());
    unmount();
    mod.invalidateAuditLogRetentionDays(2);
    expect(result.current.auditLogRetentionDays).toBe(1);
  });
});
