import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ApiError, api } from "@/api/client";
import { MAX_ATTACHMENT_BYTES } from "@/lib/attachmentFormats";
import CostImportDialog from "./CostImportDialog";

vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  api: { upload: vi.fn() },
}));
it("previews and applies costs, showing actual results", async () => {
  const applied = vi.fn();
  vi.mocked(api.upload)
    .mockResolvedValueOnce({
      matched: 2,
      applied: 0,
      clears_renewal_count: 1,
      skipped: [{ row: 4, reason: "invalid_amount" }],
    } as never)
    .mockResolvedValueOnce({
      matched: 1,
      applied: 1,
      clears_renewal_count: 0,
      skipped: [
        { row: 7, reason: "invalid_year" },
        { row: 9, reason: "card_not_found" },
      ],
    } as never);
  render(<CostImportDialog open onClose={vi.fn()} onApplied={applied} />);
  expect(screen.getByRole("link", { name: "Download Excel template" })).toHaveAttribute(
    "href",
    "/api/v1/costs/import/template",
  );
  expect(screen.getByRole("link", { name: "Download Excel template" })).toHaveAttribute(
    "target",
    "_blank",
  );
  expect(screen.getByRole("link", { name: "Download Excel template" })).toHaveAttribute(
    "rel",
    "noopener",
  );
  expect(
    screen.getByText(/UUID from the card URL.*display reference.*Card ID pill/),
  ).toBeInTheDocument();
  const file = new File(["x"], "costs.xlsx");
  await userEvent.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file);
  expect(await screen.findByText(/1 renewal date will be cleared/)).toBeInTheDocument();
  expect(screen.getByText("Invalid amount")).toBeInTheDocument();
  expect(applied).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Apply 2 rows" }));
  await waitFor(() => expect(applied).toHaveBeenCalledTimes(1));
  expect(screen.getByText(/1 row applied/)).toBeInTheDocument();
  expect(screen.getByText("Invalid fiscal year")).toBeInTheDocument();
  expect(screen.getByText("2 rows skipped")).toBeInTheDocument();
  expect(screen.getByText("7")).toBeInTheDocument();
  expect(screen.getByText("9")).toBeInTheDocument();
  expect(screen.queryByText("Invalid amount")).not.toBeInTheDocument();
});

it("rejects invalid files and oversized workbooks", async () => {
  vi.mocked(api.upload).mockReset();
  render(<CostImportDialog open onClose={vi.fn()} onApplied={vi.fn()} />);
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await userEvent.upload(input, new File(["x"], "bad.csv"), { applyAccept: false });
  expect(screen.getByText("Choose an .xlsx workbook.")).toBeInTheDocument();
  const large = new File(["x"], "large.xlsx");
  Object.defineProperty(large, "size", { value: MAX_ATTACHMENT_BYTES + 1 });
  await userEvent.upload(input, large);
  expect(screen.getByText(/file must be no larger/)).toBeInTheDocument();
  expect(api.upload).not.toHaveBeenCalled();
});
it("does not refresh on zero applied or a failed write", async () => {
  vi.mocked(api.upload).mockReset();
  const notify = vi.fn();
  const preview = { matched: 2, applied: 0, clears_renewal_count: 0, skipped: [] };
  vi.mocked(api.upload)
    .mockResolvedValueOnce(preview as never)
    .mockResolvedValueOnce(preview as never)
    .mockResolvedValueOnce(preview as never)
    .mockRejectedValueOnce(
      new ApiError("Conflict", 409, { code: "cost_import_write_failed", applied: 0 }),
    );
  render(<CostImportDialog open onClose={vi.fn()} onApplied={notify} />);
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await userEvent.upload(input, new File(["x"], "costs.xlsx"));
  await userEvent.click(await screen.findByRole("button", { name: "Apply 2 rows" }));
  expect(await screen.findByText("0 rows applied")).toBeInTheDocument();
  expect(notify).not.toHaveBeenCalled();
  await userEvent.upload(input, new File(["x"], "costs.xlsx"));
  await userEvent.click(await screen.findByRole("button", { name: "Apply 2 rows" }));
  expect(await screen.findByText(/Import failed; no rows were applied/)).toBeInTheDocument();
  expect(notify).not.toHaveBeenCalled();
});
