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

  async function previewWith(section: Record<string, unknown>) {
    (api.upload as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "t3",
      filename: "ws.zip",
      status: "parsing",
    });
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "t3",
      filename: "ws.zip",
      status: "previewed",
      diff: {
        dry_run: true,
        sections: [
          {
            sheet: "Diagrams",
            created: 2,
            updated: 0,
            skipped: 0,
            conflict: 0,
            failed: 0,
            errors: [],
            ...section,
          },
        ],
        totals: { created: 2, updated: 0, skipped: 0, conflict: 0, failed: 0 },
      },
    });
    const { container } = render(<WorkspaceTransferAdmin />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, new File(["zip"], "ws.zip"));
    await waitFor(() => expect(screen.getByText("Diagrams")).toBeInTheDocument(), {
      timeout: 4000,
    });
  }

  it("breaks down what translating the ids inside a section did", async () => {
    await previewWith({
      references: { remapped: 12, relinked_by_name: 3, ambiguous: 1 },
      errors: ["diagram card 'CRM' (Application) matches several cards"],
    });
    await userEvent.click(screen.getByLabelText("Toggle details"));
    expect(screen.getByText("References")).toBeInTheDocument();
    expect(
      screen.getByText("Ids translated to this instance's cards, relations and tags × 12"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Diagram cards relinked by card type and name (older bundle) × 3"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Diagram card matching several cards — left unchanged × 1"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("diagram card 'CRM' (Application) matches several cards"),
    ).toBeInTheDocument();
  });

  it("offers details for a section whose only news is its references", async () => {
    await previewWith({ references: { healed: 2 } });
    await userEvent.click(screen.getByLabelText("Toggle details"));
    expect(screen.getByText("Rows from an earlier import repaired × 2")).toBeInTheDocument();
    expect(screen.queryByText("Skip reasons")).not.toBeInTheDocument();
  });

  it("shows no details toggle when nothing was translated", async () => {
    await previewWith({ references: {} });
    expect(screen.queryByLabelText("Toggle details")).not.toBeInTheDocument();
    expect(screen.queryByText("References")).not.toBeInTheDocument();
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
