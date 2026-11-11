import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";

// The discussion has its own tests: here it says what it was given, and
// reports an open-thread count when asked to.
const tabs = vi.hoisted(() => ({
  discussion: [] as Record<string, unknown>[],
}));
vi.mock("./DiscussionPanel", async () => {
  const { useContext } = await import("react");
  const { DocumentMentionContext } = await import("../mentions/documentMentionContext");
  return {
  default: (props: { focusThreadId?: string | null; onOpenCountChange?: (n: number) => void }) => {
    tabs.discussion.push(props);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const mentionContext = useContext(DocumentMentionContext);
    return (
      <div data-testid="discussion-tab">
        <span data-testid="mention-context">{JSON.stringify(mentionContext ?? null)}</span>
        focus:{String(props.focusThreadId)}
        <button type="button" onClick={() => props.onOpenCountChange?.(5)}>
          report-five
        </button>
      </div>
    );
  },
  };
});

import { useState } from "react";
import { useNavigate } from "react-router";
import { setViewportWidth } from "@/test/matchMedia";
import { renderWithProviders } from "@/test/render";
import DocumentSidePanel from "./DocumentSidePanel";
import { PANEL_STATE_KEY } from "./panelState";

const SECTIONS = [{ key: "general", label: "General" }];

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
    const onOpenCountChange = vi.fn();
    const { user } = renderPanel({ openThreadCount: 2, onOpenCountChange });
    const aside = screen.getByRole("complementary", { name: "Discussion" });
    // A title, not tabs: History opens from the page's header.
    expect(within(aside).getByRole("heading", { name: /^Discussion/ })).toBeInTheDocument();
    expect(within(aside).queryByRole("tab")).toBeNull();
    expect(within(aside).queryByText("History")).toBeNull();
    expect(within(aside).getByTestId("open-thread-badge")).toHaveTextContent("2");
    expect(screen.getByTestId("document")).toBeInTheDocument();
    expect(tabs.discussion[0]).toMatchObject({ owner: { kind: "adr", id: "a1" }, sections: SECTIONS, focusThreadId: null });

    await user.click(screen.getByRole("button", { name: "report-five" }));
    expect(within(aside).getByTestId("open-thread-badge")).toHaveTextContent("5");
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

  it("hands the discussion the refresh key, so a review action re-reads it", () => {
    renderPanel({ refreshKey: "2026-11-11T10:00:00Z" });
    expect(tabs.discussion.at(-1)).toMatchObject({ refreshKey: "2026-11-11T10:00:00Z" });
  });

  it("shows a newer detail's count over an older live one, until the discussion reports again", async () => {
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
    await user.click(screen.getByRole("button", { name: "report-five" }));
    expect(badge()).toHaveTextContent("5");
    // A review action's reply: the detail now says 3.
    await user.click(screen.getByRole("button", { name: "reject" }));
    expect(badge()).toHaveTextContent("3");
    // The discussion's callback kept its identity: it is not re-reported.
    expect(new Set(tabs.discussion.map((p) => p.onOpenCountChange)).size).toBe(1);
    await user.click(screen.getByRole("button", { name: "report-five" }));
    expect(badge()).toHaveTextContent("5");
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
