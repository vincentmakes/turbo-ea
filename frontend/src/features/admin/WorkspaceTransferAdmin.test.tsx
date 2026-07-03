import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import WorkspaceTransferAdmin from "./WorkspaceTransferAdmin";

vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
    getRaw: vi.fn(),
  },
}));
vi.mock("@/api/bootstrap", () => ({
  primeBootstrap: vi.fn().mockResolvedValue(undefined),
  resetBootstrap: vi.fn(),
}));
vi.mock("@/hooks/useMetamodel", () => ({
  invalidateCache: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/hooks/useCalculatedFields", () => ({
  invalidateCalculatedFields: vi.fn(),
}));

import { primeBootstrap, resetBootstrap } from "@/api/bootstrap";
import { api } from "@/api/client";
import { invalidateCalculatedFields } from "@/hooks/useCalculatedFields";
import { invalidateCache } from "@/hooks/useMetamodel";

describe("WorkspaceTransferAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom lacks URL.createObjectURL — stub it for the download path.
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:x";
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  });

  it("downloads a bundle when Export is clicked", async () => {
    const blob = new Blob(["zip"], { type: "application/zip" });
    (api.getRaw as ReturnType<typeof vi.fn>).mockResolvedValue({
      blob: async () => blob,
      headers: { get: () => 'attachment; filename="workspace_export.zip"' },
    });

    render(<WorkspaceTransferAdmin />);
    await userEvent.click(screen.getByText("Export bundle"));

    await waitFor(() => {
      expect(api.getRaw).toHaveBeenCalledWith(
        expect.stringContaining("/admin/workspace/export"),
      );
    });
  });

  it("uploads a bundle and renders the dry-run preview", async () => {
    (api.upload as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "t1",
      filename: "ws.zip",
      status: "parsing",
    });
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "t1",
      filename: "ws.zip",
      status: "previewed",
      diff: {
        dry_run: true,
        sections: [
          { sheet: "Cards", created: 3, updated: 0, skipped: 1, conflict: 0, failed: 0, errors: [] },
        ],
        totals: { created: 3, updated: 0, skipped: 1, conflict: 0, failed: 0 },
      },
    });

    const { container } = render(<WorkspaceTransferAdmin />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["zip"], "ws.zip", { type: "application/zip" });
    await userEvent.upload(fileInput, file);

    // Polling resolves to a "previewed" transfer with a diff → Apply appears.
    await waitFor(
      () => expect(screen.getByText("Apply import")).toBeInTheDocument(),
      { timeout: 4000 },
    );
    expect(screen.getByText("Cards")).toBeInTheDocument();
  });

  it("explains skips and shows an advisory when the bundle's version differs", async () => {
    (api.upload as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "t2",
      filename: "ws.zip",
      status: "parsing",
    });
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "t2",
      filename: "ws.zip",
      status: "previewed",
      source_app_version: "0.0.1-other",
      diff: {
        dry_run: true,
        sections: [
          {
            sheet: "StakeholderRoles",
            created: 0,
            updated: 0,
            skipped: 30,
            conflict: 0,
            failed: 0,
            errors: [],
            skip_reasons: { identical: 30 },
          },
        ],
        totals: { created: 0, updated: 0, skipped: 30, conflict: 0, failed: 0 },
      },
    });

    const { container } = render(<WorkspaceTransferAdmin />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, new File(["zip"], "ws.zip"));

    // Version advisory (source ≠ current build version).
    await waitFor(
      () =>
        expect(
          screen.getByText(/exported from Turbo EA 0\.0\.1-other/),
        ).toBeInTheDocument(),
      { timeout: 4000 },
    );

    // Skipped legend + expandable skip-reason breakdown.
    expect(
      screen.getAllByText(/already exists on this instance/).length,
    ).toBeGreaterThan(0);
    await userEvent.click(screen.getByLabelText("Toggle details"));
    expect(screen.getByText(/Already present — identical/)).toBeInTheDocument();
    expect(screen.getByText(/× 30/)).toBeInTheDocument();
  });

  it("re-primes the app caches once the apply completes", { timeout: 15000 }, async () => {
    (api.upload as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "t3",
      filename: "ws.zip",
      status: "parsing",
    });
    const report = {
      dry_run: false,
      sections: [],
      totals: { created: 1, updated: 0, skipped: 0, conflict: 0, failed: 0 },
    };
    (api.get as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: "t3", filename: "ws.zip", status: "previewed", diff: report })
      .mockResolvedValue({ id: "t3", filename: "ws.zip", status: "applied", result: report });
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "t3",
      filename: "ws.zip",
      status: "applying",
    });

    const { container } = render(<WorkspaceTransferAdmin />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, new File(["zip"], "ws.zip"));
    await waitFor(() => expect(screen.getByText("Apply import")).toBeInTheDocument(), {
      timeout: 4000,
    });

    await userEvent.click(screen.getByText("Apply import"));
    await waitFor(
      () => expect(screen.getByText("Import applied successfully.")).toBeInTheDocument(),
      { timeout: 6000 },
    );

    expect(resetBootstrap).toHaveBeenCalledTimes(1);
    expect(primeBootstrap).toHaveBeenCalledTimes(1);
    expect(invalidateCache).toHaveBeenCalledTimes(1);
    expect(invalidateCalculatedFields).toHaveBeenCalledTimes(1);
  });
});
