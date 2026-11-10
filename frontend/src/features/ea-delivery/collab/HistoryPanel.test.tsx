import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import type { DocumentHistoryEntry, DocumentHistoryPage } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
// The two version dialogs have their own tests: here they only say they opened.
vi.mock("./VersionViewDialog", () => ({
  default: ({ entry }: { entry: { id: string } }) => <div role="dialog">view:{entry.id}</div>,
}));
vi.mock("./VersionCompareDialog", () => ({
  default: ({ initial }: { initial: { from: string; to: string } }) => (
    <div role="dialog">
      compare:{initial.from}→{initial.to}
    </div>
  ),
}));

import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import HistoryPanel from "./HistoryPanel";

function entry(overrides: Partial<DocumentHistoryEntry> = {}): DocumentHistoryEntry {
  return {
    id: "e1",
    kind: "save",
    actor: { id: "u1", display_name: "Ada" },
    actor_name: "Ada",
    note: null,
    created_at: "2026-11-01T10:00:00Z",
    has_content: true,
    ...overrides,
  };
}

const created = entry({ id: "c", kind: "created", has_content: false, created_at: "2026-10-01T09:00:00Z" });
const v1 = entry({ id: "v1", created_at: "2026-10-02T09:00:00Z" });
const v2 = entry({ id: "v2", created_at: "2026-10-03T09:00:00Z", actor: null, actor_name: "Gone User" });
const rejected = entry({ id: "rj", kind: "rejected", note: "Too costly", has_content: false, created_at: "2026-10-04T09:00:00Z" });
const signature = entry({ id: "sg", kind: "signature", note: "Fine by me", has_content: false, created_at: "2026-10-05T09:00:00Z" });
const restored = entry({
  id: "rs",
  kind: "restored",
  note: "v1",
  created_at: "2026-10-06T09:00:00Z",
  restored_from: { id: "v1", kind: "save", created_at: "2026-10-02T09:00:00Z" },
});

function page(overrides: Partial<DocumentHistoryPage> = {}): DocumentHistoryPage {
  return {
    can_view_versions: true,
    can_restore: true,
    total: 6,
    entries: [restored, signature, rejected, v2, v1, created],
    ...overrides,
  };
}

const FIRST = "/adr/a1/history?page=1&page_size=20";

function renderPanel(props: Partial<React.ComponentProps<typeof HistoryPanel>> = {}) {
  return renderWithProviders(<HistoryPanel owner={{ kind: "adr", id: "a1" }} status="draft" {...props} />);
}

beforeEach(() => {
  mockApi.reset();
});

describe("HistoryPanel", () => {
  it("lists what happened, newest first, with who, the reason, the signing note and the restored source", async () => {
    mockApi.on("get", FIRST, page({ entries: [created, v1, v2, rejected, signature, restored] }));
    renderPanel();
    const rows = await screen.findAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "history-rs",
      "history-sg",
      "history-rj",
      "history-v2",
      "history-v1",
      "history-c",
    ]);
    expect(within(rows[0]).getByText("Restored an earlier version")).toBeInTheDocument();
    expect(within(rows[0]).getByText(/^Restored the version of 2026-10-02/)).toBeInTheDocument();
    // The note is the source's id: never shown.
    expect(within(rows[0]).queryByText(/v1/)).toBeNull();
    expect(within(rows[1]).getByText("Signed by a signatory")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Note: Fine by me")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Reason: Too costly")).toBeInTheDocument();
    expect(within(rows[3]).getByText(/^Gone User, /)).toBeInTheDocument();
    expect(within(rows[5]).getByText("Created")).toBeInTheDocument();
    // A step without content offers nothing to view.
    expect(within(rows[5]).queryByRole("button", { name: "View" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("offers no View, Compare or Restore to a reader who may not see versions", async () => {
    mockApi.on("get", FIRST, page({ can_view_versions: false, can_restore: false }));
    renderPanel();
    await screen.findAllByRole("listitem");
    expect(screen.queryByRole("button", { name: "View" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Compare" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
    expect(screen.getByText("Saved versions are shown to editors and signatories only.")).toBeInTheDocument();
  });

  it("opens a version and a comparison against the version before it", async () => {
    mockApi.on("get", FIRST, page());
    const { user } = renderPanel();
    const row = within(await screen.findByTestId("history-v2"));
    await user.click(row.getByRole("button", { name: "View" }));
    expect(await screen.findByText("view:v2")).toBeInTheDocument();
    await user.click(row.getByRole("button", { name: "Compare" }));
    expect(await screen.findByText("compare:v1→v2")).toBeInTheDocument();
  });

  it("offers Restore on a draft only", async () => {
    mockApi.on("get", FIRST, page());
    renderPanel({ status: "in_review" });
    await screen.findAllByRole("listitem");
    expect(screen.getAllByRole("button", { name: "View" })).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
  });

  it("restores after a confirmation that warns about unsaved edits, and hands the detail back", async () => {
    mockApi.on("get", FIRST, page());
    const detail = { id: "a1", title: "Restored" };
    mockApi.on("post", "/adr/a1/history/v1/restore", detail);
    const onRestored = vi.fn();
    const { user } = renderPanel({ isDirty: () => true, onRestored });
    await user.click(within(await screen.findByTestId("history-v1")).getByRole("button", { name: "Restore" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("Your unsaved edits will be discarded.")).toBeInTheDocument();
    expect(dialog.getByText("Links, linked cards and files are not restored.")).toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "Restore" }));
    await waitFor(() =>
      expect(mockApi.callsOf("post")).toEqual([{ method: "post", path: "/adr/a1/history/v1/restore", body: {} }]),
    );
    expect(onRestored).toHaveBeenCalledWith(detail);
    expect(await screen.findByText("Version restored")).toBeInTheDocument();
    await waitFor(() => expect(mockApi.callsOf("get", FIRST)).toHaveLength(2));
  });

  it("does not warn about edits when there are none, and cancels without a request", async () => {
    mockApi.on("get", FIRST, page());
    const { user } = renderPanel({ isDirty: () => false });
    await user.click(within(await screen.findByTestId("history-v1")).getByRole("button", { name: "Restore" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.queryByText("Your unsaved edits will be discarded.")).toBeNull();
    await user.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(mockApi.callsOf("post")).toEqual([]);
  });

  it("says when the document is no longer a draft", async () => {
    mockApi.on("get", FIRST, page());
    mockApi.fail("post", "/adr/a1/history/v1/restore", 409, { error: "not_draft" });
    const onRestored = vi.fn();
    const { user } = renderPanel({ onRestored });
    await user.click(within(await screen.findByTestId("history-v1")).getByRole("button", { name: "Restore" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Restore" }));
    expect(
      await screen.findByText("Only a draft can be restored: this document is no longer a draft."),
    ).toBeInTheDocument();
    expect(onRestored).not.toHaveBeenCalled();
  });

  it("loads the next page on request", async () => {
    mockApi.on("get", FIRST, page({ total: 7 }));
    const older = entry({ id: "old", kind: "baseline", created_at: "2026-09-01T09:00:00Z" });
    mockApi.on("get", "/adr/a1/history?page=2&page_size=20", page({ total: 7, entries: [created, older] }));
    const { user } = renderPanel();
    await user.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByTestId("history-old")).toBeInTheDocument();
    expect(screen.getAllByTestId("history-c")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("says when the history cannot be read", async () => {
    mockApi.fail("get", FIRST, 403, "Insufficient permissions");
    renderPanel();
    expect(await screen.findByText(`GET ${FIRST} failed`)).toBeInTheDocument();
  });
});
