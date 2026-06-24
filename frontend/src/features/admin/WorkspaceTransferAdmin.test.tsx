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

import { api } from "@/api/client";

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
});
