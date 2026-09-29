import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import MigrationExportDialog from "./MigrationExportDialog";

vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn(),
    getRaw: vi.fn(),
  },
}));

import { api } from "@/api/client";

const SOURCES = [{ key: "leanix", label: "SAP LeanIX" }];

describe("MigrationExportDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom lacks URL.createObjectURL — stub it for the download path.
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:x";
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
    // jsdom cannot navigate; the download anchor's click must not try to.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  it("downloads the selected platform's export with the archived flag off by default", async () => {
    const blob = new Blob(["xlsx"]);
    (api.getRaw as ReturnType<typeof vi.fn>).mockResolvedValue({
      blob: async () => blob,
      headers: { get: () => 'attachment; filename="leanix_export_2026.xlsx"' },
    });
    const onClose = vi.fn();

    render(<MigrationExportDialog open sources={SOURCES} onClose={onClose} />);
    expect(screen.getByText("SAP LeanIX")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /download/i }));

    await waitFor(() => {
      expect(api.getRaw).toHaveBeenCalledWith(
        "/migration/export?source_key=leanix&include_archived=false",
      );
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("passes include_archived=true when the checkbox is ticked", async () => {
    (api.getRaw as ReturnType<typeof vi.fn>).mockResolvedValue({
      blob: async () => new Blob(["xlsx"]),
      headers: { get: () => "" },
    });

    render(<MigrationExportDialog open sources={SOURCES} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: /download/i }));

    await waitFor(() => {
      expect(api.getRaw).toHaveBeenCalledWith(
        "/migration/export?source_key=leanix&include_archived=true",
      );
    });
  });

  it("shows the error and stays open when the download fails", async () => {
    (api.getRaw as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Forbidden"));
    const onClose = vi.fn();

    render(<MigrationExportDialog open sources={SOURCES} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: /download/i }));

    expect(await screen.findByText("Forbidden")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
