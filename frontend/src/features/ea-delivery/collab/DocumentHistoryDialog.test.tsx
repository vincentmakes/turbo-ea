import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import type { DocumentHistoryEntry, DocumentHistoryPage } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
// The two panes have their own tests: here they only say what they show.
vi.mock("./VersionViewPane", () => ({
  default: ({ entryId }: { entryId: string }) => <div data-testid="version-pane">view:{entryId}</div>,
}));
vi.mock("./VersionChangesPane", () => ({
  default: ({ pair }: { pair: { from: string; to: string } }) => (
    <div data-testid="changes-pane">
      changes:{pair.from}→{pair.to}
    </div>
  ),
}));

import { mockApi } from "@/test/apiMock";
import { setViewportWidth } from "@/test/matchMedia";
import { renderWithProviders } from "@/test/render";
import DocumentHistoryDialog from "./DocumentHistoryDialog";

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

function renderDialog(props: Partial<React.ComponentProps<typeof DocumentHistoryDialog>> = {}) {
  const onClose = vi.fn();
  return {
    onClose,
    ...renderWithProviders(
      <DocumentHistoryDialog
        owner={{ kind: "adr", id: "a1" }}
        label="ADR-012 · Adopt Kafka"
        status="draft"
        onClose={onClose}
        {...props}
      />,
    ),
  };
}

const timeline = () => within(screen.getByTestId("history-timeline"));
const versionPane = () => within(screen.getByTestId("history-version"));

beforeEach(() => {
  mockApi.reset();
});

describe("DocumentHistoryDialog", () => {
  it("shows the title and the document, the timeline newest first, and the newest version selected", async () => {
    mockApi.on("get", FIRST, page({ entries: [created, v1, v2, rejected, signature, restored] }));
    renderDialog();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("History")).toBeInTheDocument();
    expect(within(dialog).getByText("ADR-012 · Adopt Kafka")).toBeInTheDocument();
    const rows = await screen.findAllByTestId(/^history-(rs|sg|rj|v2|v1|c)$/);
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
    expect(within(rows[1]).getByText("Note: Fine by me")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Reason: Too costly")).toBeInTheDocument();
    expect(within(rows[3]).getByText(/^Gone User, /)).toBeInTheDocument();
    // The restore row holds a version: the newest one, selected on open.
    for (const [i, marked] of [[0, true], [1, false], [2, false], [3, true], [4, true], [5, false]] as const) {
      expect(within(rows[i]).queryAllByLabelText("Saved version")).toHaveLength(marked ? 1 : 0);
      expect(within(rows[i]).queryAllByRole("button")).toHaveLength(marked ? 1 : 0);
    }
    expect(within(rows[0]).getByRole("button")).toHaveAttribute("aria-current", "true");
    expect(within(rows[3]).getByRole("button")).not.toHaveAttribute("aria-current");
    expect(versionPane().getByTestId("version-pane")).toHaveTextContent("view:rs");
    expect(versionPane().getByTestId("selected-version")).toHaveTextContent(/^Restored an earlier version, 2026-10-06/);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("selects another version from the timeline", async () => {
    mockApi.on("get", FIRST, page());
    const { user } = renderDialog();
    await user.click(within(await screen.findByTestId("history-v1")).getByRole("button"));
    expect(versionPane().getByTestId("version-pane")).toHaveTextContent("view:v1");
    expect(within(screen.getByTestId("history-v1")).getByRole("button")).toHaveAttribute("aria-current", "true");
    expect(within(screen.getByTestId("history-rs")).getByRole("button")).not.toHaveAttribute("aria-current");
  });

  it("switches to Changes against the version before, and compares with another one picked", async () => {
    mockApi.on("get", FIRST, page());
    const { user } = renderDialog();
    await user.click(within(await screen.findByTestId("history-v2")).getByRole("button"));
    expect(screen.getByRole("button", { name: "Version", pressed: true })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Changes" }));
    expect(await screen.findByTestId("changes-pane")).toHaveTextContent("changes:v1→v2");
    expect(screen.queryByTestId("version-pane")).toBeNull();

    const picker = screen.getByRole("combobox", { name: "Compare with" });
    expect(picker).toHaveTextContent(/^Saved, 2026-10-02/);
    await user.click(picker);
    const options = await screen.findAllByRole("option");
    // Every other version, newest first: the restore row, then v1.
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringMatching(/^Restored an earlier version, 2026-10-06.* · Ada$/),
      expect.stringMatching(/^Saved, 2026-10-02.* · Ada$/),
    ]);
    await user.click(options[0]);
    expect(await screen.findByTestId("changes-pane")).toHaveTextContent("changes:v2→rs");

    // Another version selected: back to its default comparison, mode kept.
    await user.click(within(screen.getByTestId("history-rs")).getByRole("button"));
    expect(await screen.findByTestId("changes-pane")).toHaveTextContent("changes:v2→rs");
    await user.click(within(screen.getByTestId("history-v1")).getByRole("button"));
    expect(await screen.findByTestId("changes-pane")).toHaveTextContent("changes:v1→v2");

    await user.click(screen.getByRole("button", { name: "Version" }));
    expect(screen.getByTestId("version-pane")).toHaveTextContent("view:v1");
    expect(screen.queryByRole("combobox", { name: "Compare with" })).toBeNull();
  });

  it("does not load the comparison until Changes is shown", async () => {
    mockApi.on("get", FIRST, page());
    renderDialog();
    await screen.findByTestId("version-pane");
    expect(screen.queryByTestId("changes-pane")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Compare with" })).toBeNull();
  });

  it("says when there is only one version to compare", async () => {
    mockApi.on("get", FIRST, page({ total: 2, entries: [v1, created] }));
    const { user } = renderDialog();
    await screen.findByTestId("version-pane");
    await user.click(screen.getByRole("button", { name: "Changes" }));
    expect(
      screen.getByText("This is the only saved version: there is nothing to compare it with."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("changes-pane")).toBeNull();
  });

  it("says when no version has been saved yet, and when nothing happened yet", async () => {
    mockApi.on("get", FIRST, page({ total: 1, entries: [created] }));
    const { unmount } = renderDialog();
    expect(await screen.findByText("No version of this document has been saved yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Changes" })).toBeNull();
    unmount();
    mockApi.on("get", FIRST, page({ total: 0, entries: [] }));
    renderDialog();
    expect(await screen.findByText("Nothing has happened to this document yet.")).toBeInTheDocument();
  });

  it("shows a reader who may not see versions the timeline only", async () => {
    mockApi.on("get", FIRST, page({ can_view_versions: false, can_restore: false }));
    renderDialog();
    await screen.findByTestId("history-v1");
    expect(timeline().queryAllByRole("button")).toHaveLength(0);
    expect(timeline().queryAllByLabelText("Saved version")).toHaveLength(0);
    expect(versionPane().getByText("Saved versions are shown to editors and signatories only.")).toBeInTheDocument();
    expect(screen.queryByTestId("version-pane")).toBeNull();
    expect(screen.queryByRole("button", { name: "Changes" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Restore this version$/ })).toBeNull();
  });

  it("offers Restore on a draft only, to a reader the server allows", async () => {
    mockApi.on("get", FIRST, page());
    const { unmount } = renderDialog({ status: "signed" });
    await screen.findByTestId("version-pane");
    expect(screen.queryByRole("button", { name: /Restore this version$/ })).toBeNull();
    unmount();
    mockApi.on("get", FIRST, page({ can_restore: false }));
    renderDialog();
    await screen.findByTestId("version-pane");
    expect(screen.queryByRole("button", { name: /Restore this version$/ })).toBeNull();
  });

  it("restores the selected version after a confirmation that warns about unsaved edits, then closes", async () => {
    mockApi.on("get", FIRST, page());
    const detail = { id: "a1", title: "Restored" };
    mockApi.on("post", "/adr/a1/history/v1/restore", detail);
    const onRestored = vi.fn();
    const { user, onClose } = renderDialog({ isDirty: () => true, onRestored });
    await user.click(within(await screen.findByTestId("history-v1")).getByRole("button"));
    await user.click(screen.getByRole("button", { name: /Restore this version$/ }));
    const confirm = within(await screen.findByRole("dialog", { name: "Restore this version?" }));
    expect(confirm.getByText(/^The text, dates and people of the version of 2026-10-02/)).toBeInTheDocument();
    expect(confirm.getByText("Your unsaved edits will be discarded.")).toBeInTheDocument();
    expect(confirm.getByText("Links, linked cards and files are not restored.")).toBeInTheDocument();
    await user.click(confirm.getByRole("button", { name: "Restore" }));
    await waitFor(() =>
      expect(mockApi.callsOf("post")).toEqual([{ method: "post", path: "/adr/a1/history/v1/restore", body: {} }]),
    );
    expect(onRestored).toHaveBeenCalledWith(detail);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not warn about edits when there are none, and cancels without a request", async () => {
    mockApi.on("get", FIRST, page());
    const { user, onClose } = renderDialog({ isDirty: () => false });
    await screen.findByTestId("version-pane");
    await user.click(screen.getByRole("button", { name: /Restore this version$/ }));
    const confirm = within(await screen.findByRole("dialog", { name: "Restore this version?" }));
    expect(confirm.queryByText("Your unsaved edits will be discarded.")).toBeNull();
    await user.click(confirm.getByRole("button", { name: "Cancel" }));
    expect(mockApi.callsOf("post")).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("says when the document is no longer a draft, and stays open", async () => {
    mockApi.on("get", FIRST, page());
    mockApi.fail("post", "/adr/a1/history/rs/restore", 409, { error: "not_draft" });
    const onRestored = vi.fn();
    const { user, onClose } = renderDialog({ onRestored });
    await screen.findByTestId("version-pane");
    await user.click(screen.getByRole("button", { name: /Restore this version$/ }));
    await user.click(within(await screen.findByRole("dialog", { name: "Restore this version?" })).getByRole("button", { name: "Restore" }));
    expect(
      await screen.findByText("Only a draft can be restored: this document is no longer a draft."),
    ).toBeInTheDocument();
    expect(onRestored).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("loads the next page on request", async () => {
    mockApi.on("get", FIRST, page({ total: 7 }));
    const older = entry({ id: "old", kind: "baseline", created_at: "2026-09-01T09:00:00Z" });
    mockApi.on("get", "/adr/a1/history?page=2&page_size=20", page({ total: 7, entries: [created, older] }));
    const { user } = renderDialog();
    await user.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByTestId("history-old")).toBeInTheDocument();
    expect(screen.getAllByTestId("history-c")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("says when the history cannot be read", async () => {
    mockApi.fail("get", FIRST, 403, "Insufficient permissions");
    renderDialog();
    expect(await timeline().findByText(`GET ${FIRST} failed`)).toBeInTheDocument();
    expect(screen.queryByTestId("version-pane")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("shows a spinner in both panes while the timeline loads", () => {
    mockApi.on("get", FIRST, () => new Promise(() => {}));
    renderDialog();
    expect(timeline().getByRole("progressbar")).toBeInTheDocument();
    expect(versionPane().getByRole("progressbar")).toBeInTheDocument();
  });

  it("reads the timeline again on the page's refresh signal while open", async () => {
    mockApi.on("get", FIRST, () => page());
    function Page() {
      const [key, setKey] = useState("k1");
      return (
        <>
          <button type="button" onClick={() => setKey("k2")}>
            saved
          </button>
          <DocumentHistoryDialog owner={{ kind: "adr", id: "a1" }} label="L" status="draft" refreshKey={key} onClose={vi.fn()} />
        </>
      );
    }
    renderWithProviders(<Page />);
    await screen.findByTestId("history-v1");
    expect(mockApi.callsOf("get", FIRST)).toHaveLength(1);
    // The dialog is modal: press the page's button directly.
    fireEvent.click(screen.getByRole("button", { name: "saved", hidden: true }));
    await waitFor(() => expect(mockApi.callsOf("get", FIRST)).toHaveLength(2));
  });

  it("closes from its Close button", async () => {
    mockApi.on("get", FIRST, page());
    const { user, onClose } = renderDialog();
    await screen.findByTestId("version-pane");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("below md, is full screen and shows one pane at a time", async () => {
    act(() => setViewportWidth(700));
    mockApi.on("get", FIRST, page());
    const { user } = renderDialog();
    await screen.findByTestId("history-v2");
    expect(screen.getByRole("dialog").className).toMatch(/paperFullScreen/);
    expect(screen.queryByTestId("history-version")).toBeNull();
    await user.click(within(screen.getByTestId("history-v2")).getByRole("button"));
    expect(screen.queryByTestId("history-timeline")).toBeNull();
    expect(versionPane().getByTestId("version-pane")).toHaveTextContent("view:v2");
    await user.click(screen.getByRole("button", { name: /Back$/ }));
    expect(screen.getByTestId("history-timeline")).toBeInTheDocument();
    expect(screen.queryByTestId("history-version")).toBeNull();
  });

  it("from md up, shows both panes and no Back control", async () => {
    mockApi.on("get", FIRST, page());
    renderDialog();
    await screen.findByTestId("version-pane");
    expect(screen.getByTestId("history-timeline")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Back$/ })).toBeNull();
    expect(screen.getByRole("dialog").className).not.toMatch(/paperFullScreen/);
  });

  it("does not compare the oldest loaded version with a newer one while earlier versions are not loaded", async () => {
    const SECOND = "/adr/a1/history?page=2&page_size=20";
    const v0 = entry({ id: "v0", created_at: "2026-09-01T09:00:00Z" });
    mockApi.on("get", FIRST, page({ total: 8 }));
    mockApi.on("get", SECOND, page({ total: 8, entries: [v0, entry({ id: "b", kind: "baseline", has_content: false, created_at: "2026-08-01T09:00:00Z" })] }));
    const { user } = renderDialog();
    await user.click(within(await screen.findByTestId("history-v1")).getByRole("button"));
    await user.click(screen.getByRole("button", { name: "Changes" }));
    const line = await versionPane().findByTestId("earlier-not-loaded");
    expect(line).toHaveTextContent("Earlier versions are not loaded yet: only the loaded ones can be compared.");
    expect(screen.queryByTestId("changes-pane")).toBeNull();
    expect(screen.queryByText("This is the only saved version: there is nothing to compare it with.")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Compare with" })).toBeNull();
    await user.click(within(line).getByRole("button", { name: "Load more" }));
    expect(await screen.findByTestId("changes-pane")).toHaveTextContent("changes:v0→v1");
    expect(screen.queryByTestId("earlier-not-loaded")).toBeNull();
    expect(mockApi.callsOf("get", SECOND)).toHaveLength(1);
  });

  it("says beside the Compare with picker that only loaded versions are offered while more can be loaded", async () => {
    mockApi.on("get", FIRST, page({ total: 8 }));
    const { user } = renderDialog();
    await user.click(within(await screen.findByTestId("history-v2")).getByRole("button"));
    await user.click(screen.getByRole("button", { name: "Changes" }));
    expect(await screen.findByTestId("changes-pane")).toHaveTextContent("changes:v1→v2");
    expect(screen.getByRole("combobox", { name: "Compare with" })).toBeInTheDocument();
    expect(versionPane().getByTestId("earlier-not-loaded")).toHaveTextContent("Earlier versions are not loaded yet");
  });

  it("does not call a version the only one while earlier rows are left to load", async () => {
    mockApi.on("get", FIRST, page({ total: 5, entries: [v1, created] }));
    const { user } = renderDialog();
    await screen.findByTestId("version-pane");
    await user.click(screen.getByRole("button", { name: "Changes" }));
    expect(await versionPane().findByTestId("earlier-not-loaded")).toBeInTheDocument();
    expect(screen.queryByText("This is the only saved version: there is nothing to compare it with.")).toBeNull();
  });

  it("keeps the version on screen when the timeline is read again with a newer one", async () => {
    const newer = entry({ id: "v9", created_at: "2026-10-09T09:00:00Z" });
    let reads = 0;
    mockApi.on("get", FIRST, () => {
      reads += 1;
      return reads === 1 ? page() : page({ total: 7, entries: [newer, restored, signature, rejected, v2, v1, created] });
    });
    function Page() {
      const [key, setKey] = useState("k1");
      return (
        <>
          <button type="button" onClick={() => setKey("k2")}>
            saved
          </button>
          <DocumentHistoryDialog owner={{ kind: "adr", id: "a1" }} label="L" status="draft" refreshKey={key} onClose={vi.fn()} />
        </>
      );
    }
    renderWithProviders(<Page />);
    expect(await versionPane().findByTestId("version-pane")).toHaveTextContent("view:rs");
    fireEvent.click(screen.getByRole("button", { name: "saved", hidden: true }));
    expect(await screen.findByTestId("history-v9")).toBeInTheDocument();
    expect(versionPane().getByTestId("version-pane")).toHaveTextContent("view:rs");
    expect(within(screen.getByTestId("history-rs")).getByRole("button")).toHaveAttribute("aria-current", "true");
    expect(within(screen.getByTestId("history-v9")).getByRole("button")).not.toHaveAttribute("aria-current");
  });

  it("falls back to the newest version when the pinned one is no longer listed", async () => {
    let reads = 0;
    mockApi.on("get", FIRST, () => {
      reads += 1;
      return reads === 1 ? page() : page({ total: 5, entries: [restored, signature, rejected, v2, created] });
    });
    function Page() {
      const [key, setKey] = useState("k1");
      return (
        <>
          <button type="button" onClick={() => setKey("k2")}>
            saved
          </button>
          <DocumentHistoryDialog owner={{ kind: "adr", id: "a1" }} label="L" status="draft" refreshKey={key} onClose={vi.fn()} />
        </>
      );
    }
    const { user } = renderWithProviders(<Page />);
    await user.click(within(await screen.findByTestId("history-v1")).getByRole("button"));
    expect(versionPane().getByTestId("version-pane")).toHaveTextContent("view:v1");
    fireEvent.click(screen.getByRole("button", { name: "saved", hidden: true }));
    await waitFor(() => expect(screen.queryByTestId("history-v1")).toBeNull());
    expect(versionPane().getByTestId("version-pane")).toHaveTextContent("view:rs");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("below md, tells a reader who may not see versions why none opens, above the timeline", async () => {
    act(() => setViewportWidth(700));
    mockApi.on("get", FIRST, page({ can_view_versions: false, can_restore: false }));
    renderDialog();
    await screen.findByTestId("history-v1");
    expect(screen.queryByTestId("history-version")).toBeNull();
    const note = timeline().getByText("Saved versions are shown to editors and signatories only.");
    const firstRow = screen.getByTestId("history-rs");
    expect(note.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("below md, says above the timeline when no version has been saved yet", async () => {
    act(() => setViewportWidth(700));
    mockApi.on("get", FIRST, page({ total: 1, entries: [created] }));
    renderDialog();
    expect(await timeline().findByText("No version of this document has been saved yet.")).toBeInTheDocument();
  });

  it("from md up, says it in the version pane only", async () => {
    mockApi.on("get", FIRST, page({ can_view_versions: false, can_restore: false }));
    renderDialog();
    await screen.findByTestId("history-v1");
    expect(timeline().queryByText("Saved versions are shown to editors and signatories only.")).toBeNull();
    expect(versionPane().getByText("Saved versions are shown to editors and signatories only.")).toBeInTheDocument();
  });
});
