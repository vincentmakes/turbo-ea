import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { DocumentThread } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

// The discussion has its own tests: here it says what it was given (the
// focused thread, the shared view's threads and filter).
const tabs = vi.hoisted(() => ({
  discussion: [] as Record<string, unknown>[],
}));
vi.mock("./DiscussionPanel", async () => {
  const { useContext } = await import("react");
  const { DocumentMentionContext } = await import("../mentions/documentMentionContext");
  return {
  default: (props: {
    focusThreadId?: string | null;
    view: {
      filter: string[];
      showResolved: boolean;
      composeSection: { section: string; request: number } | null;
      discussion: { threads: { id: string }[] };
    };
  }) => {
    tabs.discussion.push(props);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const mentionContext = useContext(DocumentMentionContext);
    return (
      <div data-testid="discussion-tab">
        <span data-testid="mention-context">{JSON.stringify(mentionContext ?? null)}</span>
        focus:{String(props.focusThreadId)}
        <span data-testid="panel-filter">{JSON.stringify(props.view.filter)}</span>
        <span data-testid="panel-unfolded">{String(props.view.showResolved)}</span>
        <span data-testid="panel-compose">{JSON.stringify(props.view.composeSection)}</span>
        <span data-testid="panel-threads">{props.view.discussion.threads.map((th) => th.id).join(",")}</span>
      </div>
    );
  },
  };
});

import { useState } from "react";
import { useNavigate } from "react-router";
import { mockApi } from "@/test/apiMock";
import { setViewportWidth } from "@/test/matchMedia";
import { renderWithProviders } from "@/test/render";
import DocumentSidePanel from "./DocumentSidePanel";
import SectionDiscussionMarker from "./SectionDiscussionMarker";
import { PANEL_STATE_KEY } from "./panelState";

function thread(overrides: Partial<DocumentThread> = {}): DocumentThread {
  return {
    id: "t1",
    kind: "comment",
    section: null,
    revision_id: "a1",
    revision_number: 1,
    author: { id: "u1", display_name: "Ada" },
    author_name: "Ada",
    body: "<p>Hi</p>",
    created_at: "2026-11-01T10:00:00Z",
    edited_at: null,
    deleted: false,
    resolved_at: null,
    resolved_by: null,
    can: { edit: true, delete: true, resolve: true },
    replies: [],
    ...overrides,
  };
}

/** Serve the discussion of a1 (a fresh payload per read) with `threads`. */
function serve(threads: DocumentThread[]) {
  mockApi.on("get", "/adr/a1/comments", () => ({
    can: { comment: true, moderate: false },
    open_count: threads.length,
    threads,
  }));
}

const FIVE_OPEN = ["a", "b", "c", "d", "e"].map((id) => thread({ id }));

const SECTIONS = [
  { key: "general", label: "General" },
  { key: "context", label: "Context" },
  { key: "decision", label: "Decision" },
];

function renderPanel(
  props: Partial<React.ComponentProps<typeof DocumentSidePanel>> = {},
  route = "/ea-delivery/adr/a1/preview",
) {
  return renderWithProviders(
    <DocumentSidePanel owner={{ kind: "adr", id: "a1" }} sections={SECTIONS} {...props}>
      <div data-testid="document">the document</div>
    </DocumentSidePanel>,
    { route },
  );
}

beforeEach(() => {
  window.localStorage.clear();
  tabs.discussion.length = 0;
  mockApi.reset();
  serve([]);
});

afterEach(() => {
  vi.restoreAllMocks();
  setViewportWidth(1280);
});

describe("DocumentSidePanel mention context", () => {
  it("gives the discussion's comment editors the document's mention context", async () => {
    renderPanel({ mentionContext: { linkedCardIds: ["c1"], priorityUserIds: ["u1"] } });
    expect(await screen.findByTestId("mention-context")).toHaveTextContent(
      '{"linkedCardIds":["c1"],"priorityUserIds":["u1"]}',
    );
  });

  it("gives none when the page passes none", async () => {
    renderPanel();
    expect(await screen.findByTestId("mention-context")).toHaveTextContent("null");
  });
});

describe("DocumentSidePanel", () => {
  it("renders the document alone for a document not saved yet", () => {
    renderPanel({ owner: null });
    expect(screen.getByTestId("document")).toBeInTheDocument();
    expect(screen.queryByTestId("discussion-tab")).toBeNull();
    expect(screen.queryByRole("button", { name: "Open the discussion" })).toBeNull();
  });

  it("opens beside the document on Discussion, with the detail's open-thread count, then the live one", async () => {
    serve(FIVE_OPEN);
    const onOpenCountChange = vi.fn();
    renderPanel({ openThreadCount: 2, onOpenCountChange });
    const aside = screen.getByRole("complementary", { name: "Discussion" });
    // A title, not tabs: History opens from the page's header.
    expect(within(aside).getByRole("heading", { name: /^Discussion/ })).toBeInTheDocument();
    expect(within(aside).queryByRole("tab")).toBeNull();
    expect(within(aside).queryByText("History")).toBeNull();
    expect(within(aside).getByTestId("open-thread-badge")).toHaveTextContent("2");
    expect(screen.getByTestId("document")).toBeInTheDocument();
    expect(tabs.discussion[0]).toMatchObject({ owner: { kind: "adr", id: "a1" }, sections: SECTIONS, focusThreadId: null });

    await waitFor(() => expect(within(aside).getByTestId("open-thread-badge")).toHaveTextContent("5"));
    expect(onOpenCountChange).toHaveBeenCalledWith(5);
  });

  it("loads a state the earlier build stored with a tab, and stores the open flag only", async () => {
    window.localStorage.setItem(PANEL_STATE_KEY, JSON.stringify({ open: true, tab: "history" }));
    const { user } = renderPanel();
    const aside = screen.getByRole("complementary", { name: "Discussion" });
    expect(within(aside).getByTestId("discussion-tab")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close the panel" }));
    expect(JSON.parse(window.localStorage.getItem(PANEL_STATE_KEY) ?? "{}")).toEqual({ open: false });
  });

  it("closes to a button that reopens it, and remembers it closed", async () => {
    const { user, unmount } = renderPanel({ openThreadCount: 1 });
    await user.click(screen.getByRole("button", { name: "Close the panel" }));
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(PANEL_STATE_KEY) ?? "{}")).toEqual({ open: false });
    unmount();

    renderPanel();
    expect(screen.queryByRole("complementary")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Open the discussion" }));
    expect(screen.getByRole("complementary", { name: "Discussion" })).toBeInTheDocument();
  });

  it("opens on the thread a notification names, whatever was remembered", () => {
    window.localStorage.setItem(PANEL_STATE_KEY, JSON.stringify({ open: false, tab: "history" }));
    renderPanel({}, "/ea-delivery/adr/a1/preview?thread=t7");
    expect(screen.getByRole("complementary", { name: "Discussion" })).toBeInTheDocument();
    expect(screen.getByTestId("discussion-tab")).toHaveTextContent("focus:t7");
  });

  it("still works when storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { user } = renderPanel();
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close the panel" }));
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("below lg, opens in a drawer from a button", async () => {
    act(() => setViewportWidth(800));
    const { user } = renderPanel({ openThreadCount: 3 });
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.queryByTestId("discussion-tab")).toBeNull();
    const fab = screen.getByRole("button", { name: "Open the discussion" });
    expect(within(fab).getByText("3")).toBeInTheDocument();
    await user.click(fab);
    expect(await screen.findByRole("heading", { name: /^Discussion/ })).toBeInTheDocument();
    expect(screen.getByTestId("discussion-tab")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close the panel" }));
    await waitFor(() => expect(screen.queryByTestId("discussion-tab")).toBeNull());
  });

  it("below lg, opens the drawer at once for a notification's thread", async () => {
    act(() => setViewportWidth(800));
    renderPanel({}, "/ea-delivery/adr/a1/preview?thread=t2");
    expect(await screen.findByTestId("discussion-tab")).toHaveTextContent("focus:t2");
  });

  it("reads the discussion again when the refresh key changes, and reports the count after each read", async () => {
    serve([thread({ id: "a" })]);
    const onOpenCountChange = vi.fn();
    function Page() {
      const [key, setKey] = useState("v1");
      return (
        <DocumentSidePanel
          owner={{ kind: "adr", id: "a1" }}
          sections={SECTIONS}
          refreshKey={key}
          onOpenCountChange={onOpenCountChange}
        >
          <button type="button" onClick={() => setKey(key === "v1" ? "v2" : "v3")}>
            save
          </button>
        </DocumentSidePanel>
      );
    }
    const { user } = renderWithProviders(<Page />);
    await waitFor(() => expect(onOpenCountChange).toHaveBeenCalledWith(1));
    expect(mockApi.callsOf("get", "/adr/a1/comments")).toHaveLength(1);

    serve([thread({ id: "a" }), thread({ id: "r", kind: "rejection" })]);
    await user.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onOpenCountChange).toHaveBeenLastCalledWith(2));
    expect(screen.getByTestId("panel-threads")).toHaveTextContent("a,r");
    expect(mockApi.callsOf("get", "/adr/a1/comments")).toHaveLength(2);

    // The same count read again is still reported (the page's own count may have moved).
    const before = onOpenCountChange.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onOpenCountChange.mock.calls.length).toBe(before + 1));
    expect(onOpenCountChange).toHaveBeenLastCalledWith(2);
  });

  it("counts only this revision's open threads, not resolved ones, signing notes or earlier revisions'", async () => {
    serve([
      thread({ id: "a" }),
      thread({ id: "b", kind: "rejection" }),
      thread({ id: "c", resolved_at: "2026-11-02T00:00:00Z" }),
      thread({ id: "s", kind: "sign_note" }),
      thread({ id: "e", revision_id: "a0", revision_number: 0 }),
    ]);
    const onOpenCountChange = vi.fn();
    renderPanel({ onOpenCountChange });
    await waitFor(() => expect(onOpenCountChange).toHaveBeenLastCalledWith(2));
  });

  it("shows a newer detail's count over an older live one, until the discussion is read again", async () => {
    serve(FIVE_OPEN);
    const onOpenCountChange = vi.fn();
    function Page() {
      const [detailCount, setDetailCount] = useState(2);
      return (
        <DocumentSidePanel
          owner={{ kind: "adr", id: "a1" }}
          sections={SECTIONS}
          openThreadCount={detailCount}
          onOpenCountChange={onOpenCountChange}
        >
          <button type="button" onClick={() => setDetailCount(3)}>
            reject
          </button>
        </DocumentSidePanel>
      );
    }
    const { user } = renderWithProviders(<Page />);
    const badge = () => within(screen.getByRole("complementary")).getByTestId("open-thread-badge");
    await waitFor(() => expect(badge()).toHaveTextContent("5"));
    // A review action's reply: the detail now says 3.
    await user.click(screen.getByRole("button", { name: "reject" }));
    expect(badge()).toHaveTextContent("3");
    expect(onOpenCountChange).toHaveBeenCalledTimes(1);
    // The next read wins again.
    fireEvent(window, new Event("focus"));
    await waitFor(() => expect(badge()).toHaveTextContent("5"));
    expect(onOpenCountChange).toHaveBeenCalledTimes(2);
  });

  it("opens on Discussion when a notification for the open document arrives", async () => {
    function GoToThread() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate("/ea-delivery/adr/a1/preview?thread=t9")}>
          bell
        </button>
      );
    }
    window.localStorage.setItem(PANEL_STATE_KEY, JSON.stringify({ open: false, tab: "history" }));
    const { user } = renderWithProviders(
      <DocumentSidePanel owner={{ kind: "adr", id: "a1" }} sections={SECTIONS}>
        <GoToThread />
      </DocumentSidePanel>,
      { route: "/ea-delivery/adr/a1/preview" },
    );
    expect(screen.queryByRole("complementary")).toBeNull();
    await user.click(screen.getByRole("button", { name: "bell" }));
    const aside = await screen.findByRole("complementary", { name: "Discussion" });
    expect(within(aside).getByTestId("discussion-tab")).toHaveTextContent("focus:t9");
  });

  it("below lg, opens the drawer when a notification for the open document arrives", async () => {
    act(() => setViewportWidth(800));
    function GoToThread() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate("?thread=t4")}>
          bell
        </button>
      );
    }
    const { user } = renderWithProviders(
      <DocumentSidePanel owner={{ kind: "adr", id: "a1" }} sections={SECTIONS}>
        <GoToThread />
      </DocumentSidePanel>,
      { route: "/ea-delivery/adr/a1/preview" },
    );
    expect(screen.queryByTestId("discussion-tab")).toBeNull();
    await user.click(screen.getByRole("button", { name: "bell" }));
    expect(await screen.findByTestId("discussion-tab")).toHaveTextContent("focus:t4");
  });

  it("keeps the document mounted, and its state, when the width crosses lg", async () => {
    const mounts = vi.fn();
    function Typed() {
      const [value, setValue] = useState("");
      useState(() => mounts());
      return <input aria-label="reason" value={value} onChange={(e) => setValue(e.target.value)} />;
    }
    for (const owner of [{ kind: "adr" as const, id: "a1" }, null]) {
      mounts.mockClear();
      act(() => setViewportWidth(1280));
      const { user, unmount } = renderWithProviders(
        <DocumentSidePanel owner={owner} sections={SECTIONS}>
          <Typed />
        </DocumentSidePanel>,
      );
      await user.type(screen.getByLabelText("reason"), "Too costly");
      act(() => setViewportWidth(800));
      expect(screen.getByLabelText("reason")).toHaveValue("Too costly");
      act(() => setViewportWidth(1280));
      expect(screen.getByLabelText("reason")).toHaveValue("Too costly");
      expect(mounts).toHaveBeenCalledTimes(1);
      unmount();
    }
  });
});

describe("DocumentSidePanel section markers", () => {
  const MARKED = [
    thread({ id: "a", section: "context" }),
    thread({ id: "b", section: "context" }),
    thread({ id: "c", section: "decision", resolved_at: "2026-11-02T00:00:00Z" }),
  ];

  function renderMarked(owner: { kind: "adr"; id: string } | null = { kind: "adr", id: "a1" }, route?: string) {
    return renderWithProviders(
      <DocumentSidePanel owner={owner} sections={SECTIONS}>
        <h2>
          Context <SectionDiscussionMarker section="context" />
        </h2>
        <h2>
          Decision <SectionDiscussionMarker section="decision" />
        </h2>
      </DocumentSidePanel>,
      route ? { route } : undefined,
    );
  }

  it("reads the discussion once for the panel and the markers together", async () => {
    serve(MARKED);
    renderMarked();
    expect((await screen.findByTestId("section-marker-context")).querySelector(".MuiBadge-badge")).toHaveTextContent(/^2$/);
    expect(screen.getByTestId("panel-threads")).toHaveTextContent("a,b,c");
    expect(mockApi.callsOf("get")).toHaveLength(1);
    expect(mockApi.callsOf("get", "/adr/a1/comments")).toHaveLength(1);
  });

  it("shows the markers while the panel is closed", async () => {
    window.localStorage.setItem(PANEL_STATE_KEY, JSON.stringify({ open: false }));
    serve(MARKED);
    renderMarked();
    expect(screen.queryByRole("complementary")).toBeNull();
    expect((await screen.findByTestId("section-marker-context")).querySelector(".MuiBadge-badge")).toHaveTextContent(/^2$/);
    expect(screen.getByTestId("section-marker-decision")).toBeInTheDocument();
  });

  it("opens the closed panel filtered to the marker's section alone", async () => {
    window.localStorage.setItem(PANEL_STATE_KEY, JSON.stringify({ open: false }));
    serve(MARKED);
    const { user } = renderMarked();
    await user.click(await screen.findByRole("button", { name: "2 open threads on this section" }));
    const aside = screen.getByRole("complementary", { name: "Discussion" });
    expect(within(aside).getByTestId("panel-filter")).toHaveTextContent('["context"]');
    expect(JSON.parse(window.localStorage.getItem(PANEL_STATE_KEY) ?? "{}")).toEqual({ open: true });
    // Another marker replaces the filter, it does not add to it.
    await user.click(screen.getByRole("button", { name: "Resolved discussion on this section" }));
    expect(within(aside).getByTestId("panel-filter")).toHaveTextContent('["decision"]');
  });

  it("unfolds the resolved threads from a muted marker only, never from one with open threads", async () => {
    window.localStorage.setItem(PANEL_STATE_KEY, JSON.stringify({ open: false }));
    serve(MARKED);
    const { user } = renderMarked();
    await user.click(await screen.findByRole("button", { name: "2 open threads on this section" }));
    const aside = screen.getByRole("complementary", { name: "Discussion" });
    expect(within(aside).getByTestId("panel-unfolded")).toHaveTextContent("false");
    await user.click(screen.getByRole("button", { name: "Resolved discussion on this section" }));
    expect(within(aside).getByTestId("panel-filter")).toHaveTextContent('["decision"]');
    expect(within(aside).getByTestId("panel-unfolded")).toHaveTextContent("true");
  });

  it("below lg, opens the drawer filtered to the marker's section", async () => {
    act(() => setViewportWidth(800));
    serve(MARKED);
    const { user } = renderMarked();
    expect(screen.queryByTestId("discussion-tab")).toBeNull();
    await user.click(await screen.findByTestId("section-marker-decision"));
    expect(await screen.findByTestId("panel-filter")).toHaveTextContent('["decision"]');
  });

  it("starts with no filter when a notification's thread is opened after a marker", async () => {
    serve(MARKED);
    function GoToThread() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate("?thread=c")}>
          bell
        </button>
      );
    }
    const { user } = renderWithProviders(
      <DocumentSidePanel owner={{ kind: "adr", id: "a1" }} sections={SECTIONS}>
        <SectionDiscussionMarker section="context" />
        <GoToThread />
      </DocumentSidePanel>,
      { route: "/ea-delivery/adr/a1/preview" },
    );
    await user.click(await screen.findByTestId("section-marker-context"));
    expect(screen.getByTestId("panel-filter")).toHaveTextContent('["context"]');
    await user.click(screen.getByRole("button", { name: "bell" }));
    expect(screen.getByTestId("panel-filter")).toHaveTextContent("[]");
  });

  it("updates a marker when the discussion is read again", async () => {
    serve(MARKED);
    renderMarked();
    expect((await screen.findByTestId("section-marker-context")).querySelector(".MuiBadge-badge")).toHaveTextContent(/^2$/);
    serve([thread({ id: "a", section: "context", resolved_at: "2026-11-03T00:00:00Z" })]);
    fireEvent(window, new Event("focus"));
    // The decision's thread is gone: its marker now offers to start one.
    await waitFor(() =>
      expect(screen.getByTestId("section-marker-decision")).toHaveAccessibleName("Comment on this section"),
    );
    expect(screen.getByTestId("section-marker-context")).toHaveAccessibleName("Resolved discussion on this section");
  });

  it("shows no marker, and reads nothing, for a document not saved yet", async () => {
    serve(MARKED);
    renderMarked(null);
    await act(async () => {});
    expect(screen.queryByTestId("section-marker-context")).toBeNull();
    expect(mockApi.callsOf("get")).toHaveLength(0);
  });

  it("asks the composer for the marker's section on every click, the same section twice included", async () => {
    window.localStorage.setItem(PANEL_STATE_KEY, JSON.stringify({ open: false }));
    serve(MARKED);
    const { user } = renderMarked();
    const marker = await screen.findByRole("button", { name: "2 open threads on this section" });
    await user.click(marker);
    const aside = screen.getByRole("complementary", { name: "Discussion" });
    expect(within(aside).getByTestId("panel-compose")).toHaveTextContent('{"section":"context","request":1}');
    await user.click(marker);
    expect(within(aside).getByTestId("panel-compose")).toHaveTextContent('{"section":"context","request":2}');
    await user.click(screen.getByRole("button", { name: "Resolved discussion on this section" }));
    expect(within(aside).getByTestId("panel-compose")).toHaveTextContent('{"section":"decision","request":3}');
  });

  it("puts a marker on a section with no thread for a reader who may comment, and opens the panel on it", async () => {
    window.localStorage.setItem(PANEL_STATE_KEY, JSON.stringify({ open: false }));
    serve([thread({ id: "a", section: "context" })]);
    const { user } = renderMarked();
    const add = await screen.findByRole("button", { name: "Comment on this section" });
    expect(add).toHaveAttribute("data-testid", "section-marker-decision");
    await user.click(add);
    const aside = screen.getByRole("complementary", { name: "Discussion" });
    expect(within(aside).getByTestId("panel-filter")).toHaveTextContent('["decision"]');
    expect(within(aside).getByTestId("panel-unfolded")).toHaveTextContent("false");
    expect(within(aside).getByTestId("panel-compose")).toHaveTextContent('{"section":"decision","request":1}');
  });

  it("below lg, opens the drawer from a marker on a section with no thread", async () => {
    act(() => setViewportWidth(800));
    serve([]);
    const { user } = renderMarked();
    await user.click(await screen.findByTestId("section-marker-context"));
    expect(await screen.findByTestId("panel-filter")).toHaveTextContent('["context"]');
    expect(screen.getByTestId("panel-compose")).toHaveTextContent('{"section":"context","request":1}');
  });

  it("gives a reader who may not comment no marker on a quiet section, and no composer request", async () => {
    window.localStorage.setItem(PANEL_STATE_KEY, JSON.stringify({ open: false }));
    mockApi.on("get", "/adr/a1/comments", () => ({
      can: { comment: false, moderate: false },
      open_count: 1,
      threads: [thread({ id: "a", section: "context" })],
    }));
    const { user } = renderMarked();
    await user.click(await screen.findByRole("button", { name: "1 open thread on this section" }));
    expect(screen.queryByTestId("section-marker-decision")).toBeNull();
    const aside = screen.getByRole("complementary", { name: "Discussion" });
    expect(within(aside).getByTestId("panel-filter")).toHaveTextContent('["context"]');
    expect(within(aside).getByTestId("panel-compose")).toHaveTextContent("null");
  });
});
