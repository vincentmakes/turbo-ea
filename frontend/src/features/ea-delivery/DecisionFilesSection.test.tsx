import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), getRaw: vi.fn(), upload: vi.fn(), delete: vi.fn() },
  isAbortError: () => false,
}));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
vi.mock("@/hooks/useFileUploadsEnabled", () =>
  import("@/test/hooks").then((m) => m.useFileUploadsEnabledModule()),
);

import { api } from "@/api/client";
import { hookState } from "@/test/hooks";
import { MAX_ATTACHMENT_BYTES } from "@/lib/attachmentFormats";
import type { DecisionFile } from "@/types";
import DecisionFilesSection, { fileDownloadPath, filesPath, uploadRefusal } from "./DecisionFilesSection";

const PDF: DecisionFile = {
  id: "f1",
  name: "board-minutes.pdf",
  mime_type: "application/pdf",
  size: 2048,
  created_at: "2026-06-01T10:00:00Z",
  created_by: { user_id: "u1", display_name: "Ada" },
};
const PNG: DecisionFile = {
  id: "f2",
  name: "diagram.png",
  mime_type: "image/png",
  size: 10,
  created_at: "2026-06-02T10:00:00Z",
  created_by: null,
};

let served: DecisionFile[] = [PDF];

/** A mock answer that rejects only when called (no eager rejected promise). */
const rejecting = (err: unknown) => async () => {
  throw err;
};

beforeEach(() => {
  hookState.reset();
  served = [PDF];
  vi.mocked(api.get).mockReset();
  vi.mocked(api.get).mockImplementation(async () => served as never);
  vi.mocked(api.upload).mockReset();
  vi.mocked(api.delete).mockReset();
  vi.mocked(api.getRaw).mockReset();
});

const file = (name: string, size = 10) => {
  const f = new File(["x"], name);
  Object.defineProperty(f, "size", { value: size });
  return f;
};

describe("helpers", () => {
  it("builds the routes", () => {
    expect(filesPath("a1")).toBe("/adr/a1/files");
    expect(fileDownloadPath("a1", "f9")).toBe("/adr/a1/files/f9/download");
  });

  it("refuses a wrong type first, then a file over the cap", () => {
    expect(uploadRefusal({ name: "evil.exe", size: 1 })).toBe("type");
    expect(uploadRefusal({ name: "evil.exe", size: MAX_ATTACHMENT_BYTES + 1 })).toBe("type");
    expect(uploadRefusal({ name: "a.pdf", size: MAX_ATTACHMENT_BYTES + 1 })).toBe("size");
    expect(uploadRefusal({ name: "a.pdf", size: MAX_ATTACHMENT_BYTES })).toBeNull();
  });
});

describe("DecisionFilesSection", () => {
  it("lists the files with size and uploader, and downloads one", async () => {
    served = [PDF, PNG];
    const blob = new Blob(["x"]);
    vi.mocked(api.getRaw).mockResolvedValue({ blob: async () => blob } as never);
    const createUrl = vi.fn(() => "blob:1");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<DecisionFilesSection adrId="a1" editable={false} />);
    expect(await screen.findByText("diagram.png")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith("/adr/a1/files", expect.anything());
    expect(screen.getByText("2 KB · uploaded by Ada on 2026-06-01")).toBeInTheDocument();
    expect(screen.getByText("10 B · uploaded on 2026-06-02")).toBeInTheDocument();
    // Read-only: no upload, no delete.
    expect(screen.queryByRole("button", { name: /Upload File/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();

    await userEvent.click(screen.getAllByRole("button", { name: "Download" })[0]);
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(api.getRaw).toHaveBeenCalledWith("/adr/a1/files/f1/download");
    expect(createUrl).toHaveBeenCalledWith(blob);
    expect(revoke).toHaveBeenCalledWith("blob:1");
    click.mockRestore();
  });

  it("reports a failed download", async () => {
    vi.mocked(api.getRaw).mockImplementation(rejecting(new Error("x")));
    render(<DecisionFilesSection adrId="a1" editable={false} />);
    await userEvent.click(await screen.findByRole("button", { name: "Download" }));
    expect(await screen.findByText("Failed to download the file")).toBeInTheDocument();
  });

  it("shows the given files without fetching when not live, and the locked hint", () => {
    render(<DecisionFilesSection adrId="a1" files={[PNG]} editable={false} locked live={false} />);
    expect(screen.getByText("diagram.png")).toBeInTheDocument();
    expect(
      screen.getByText("Files are locked with the decision: recall the signatures or revise it to change them."),
    ).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("says so when there are no files", async () => {
    served = [];
    render(<DecisionFilesSection adrId="a1" editable={false} />);
    expect(await screen.findByText("No files attached.")).toBeInTheDocument();
    expect(screen.queryByText(/locked with the decision/)).toBeNull();
  });

  it("uploads an accepted file and refetches the list", async () => {
    vi.mocked(api.upload).mockResolvedValue(PNG as never);
    render(<DecisionFilesSection adrId="a1" editable />);
    expect(await screen.findByText("board-minutes.pdf")).toBeInTheDocument();
    expect(screen.getByText("Maximum file size: 20 MB")).toBeInTheDocument();
    const input = screen.getByTestId("decision-file-input") as HTMLInputElement;
    expect(input.accept).toContain(".pdf");
    served = [PDF, PNG];
    const pdf = file("notes.pdf");
    fireEvent.change(input, { target: { files: [pdf] } });
    await waitFor(() => expect(api.upload).toHaveBeenCalledWith("/adr/a1/files", pdf, "file"));
    expect(await screen.findByText("diagram.png")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("refuses a wrong type and a too-large file before uploading", async () => {
    render(<DecisionFilesSection adrId="a1" editable />);
    const input = await screen.findByTestId("decision-file-input");
    fireEvent.change(input, { target: { files: [file("tool.exe")] } });
    expect(await screen.findByText("File type not allowed")).toBeInTheDocument();
    fireEvent.change(input, { target: { files: [file("big.pdf", MAX_ATTACHMENT_BYTES + 1)] } });
    expect(await screen.findByText("File exceeds maximum size of 20 MB")).toBeInTheDocument();
    expect(api.upload).not.toHaveBeenCalled();
  });

  it("shows the server's reason for a refused upload, or a fallback", async () => {
    vi.mocked(api.upload).mockImplementationOnce(rejecting(new Error("File content does not match its '.pdf' extension.")));
    vi.mocked(api.upload).mockImplementationOnce(rejecting("odd"));
    render(<DecisionFilesSection adrId="a1" editable />);
    const input = await screen.findByTestId("decision-file-input");
    fireEvent.change(input, { target: { files: [file("a.pdf")] } });
    expect(await screen.findByText("File content does not match its '.pdf' extension.")).toBeInTheDocument();
    fireEvent.change(input, { target: { files: [file("a.pdf")] } });
    expect(await screen.findByText("Failed to upload the file")).toBeInTheDocument();
  });

  it("offers no upload when file uploads are switched off", async () => {
    hookState.fileUploads = { fileUploadsEnabled: false, fileUploadsLoaded: true };
    render(<DecisionFilesSection adrId="a1" editable />);
    expect(await screen.findByText("board-minutes.pdf")).toBeInTheDocument();
    expect(screen.queryByTestId("decision-file-input")).toBeNull();
    // Deleting stays possible.
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("deletes after confirming, and not on cancel", async () => {
    const user = userEvent.setup();
    vi.mocked(api.delete).mockResolvedValue(undefined as never);
    render(<DecisionFilesSection adrId="a1" editable />);
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    let dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("Delete board-minutes.pdf from this decision?")).toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.delete).not.toHaveBeenCalled();

    served = [];
    await user.click(screen.getByRole("button", { name: "Delete" }));
    dialog = within(await screen.findByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: "Delete" }));
    expect(api.delete).toHaveBeenCalledWith("/adr/a1/files/f1");
    expect(await screen.findByText("No files attached.")).toBeInTheDocument();
  });

  it("reports a failed delete", async () => {
    const user = userEvent.setup();
    vi.mocked(api.delete).mockImplementation(rejecting(new Error("x")));
    render(<DecisionFilesSection adrId="a1" editable />);
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Failed to delete the file")).toBeInTheDocument();
  });
});
