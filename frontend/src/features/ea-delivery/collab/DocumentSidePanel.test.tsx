import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";

// The two tabs have their own tests: here they say what they were given, and
// the discussion reports an open-thread count when asked to.
const tabs = vi.hoisted(() => ({
  discussion: [] as Record<string, unknown>[],
  history: [] as Record<string, unknown>[],
}));
vi.mock("./DiscussionPanel", () => ({
  default: (props: { focusThreadId?: string | null; onOpenCountChange?: (n: number) => void }) => {
    tabs.discussion.push(props);
    return (
      <div data-testid="discussion-tab">
        focus:{String(props.focusThreadId)}
        <button type="button" onClick={() => props.onOpenCountChange?.(5)}>
          report-five
        </button>
      </div>
    );
  },
}));
vi.mock("./HistoryPanel", () => ({
  default: (props: Record<string, unknown>) => {
    tabs.history.push(props);
    return <div data-testid="history-tab" />;
  },
}));

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
    <DocumentSidePanel owner={{ kind: "adr", id: "a1" }} status="draft" sections={SECTIONS} {...props}>
      <div data-testid="document">the document</div>
    </DocumentSidePanel>,
    { route },
  );
}

beforeEach(() => {
  window.localStorage.clear();
  tabs.discussion.length = 0;
  tabs.history.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  setViewportWidth(1280);
});

describe("DocumentSidePanel", () => {
  it("renders the document alone for a document not saved yet", () => {
    renderPanel({ owner: null });
    expect(screen.getByTestId("document")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("button", { name: "Discussion and history" })).toBeNull();
  });

  it("opens beside the document on Discussion, with the detail's open-thread count, then the live one", async () => {
    const onOpenCountChange = vi.fn();
    const { user } = renderPanel({ openThreadCount: 2, onOpenCountChange });
    const aside = screen.getByRole("complementary", { name: "Discussion and history" });
    expect(within(aside).getByRole("tab", { name: /Discussion/, selected: true })).toBeInTheDocument();
    expect(within(aside).getByTestId("open-thread-badge")).toHaveTextContent("2");
    expect(screen.getByTestId("document")).toBeInTheDocument();
    expect(tabs.discussion[0]).toMatchObject({ owner: { kind: "adr", id: "a1" }, sections: SECTIONS, focusThreadId: null });

    await user.click(screen.getByRole("button", { name: "report-five" }));
    expect(within(aside).getByTestId("open-thread-badge")).toHaveTextContent("5");
    expect(onOpenCountChange).toHaveBeenCalledWith(5);
  });

  it("switches to History, handing it what a restore needs, and remembers the tab", async () => {
    const isDirty = () => true;
    const onRestored = vi.fn();
    const { user } = renderPanel({ refreshKey: "k1", isDirty, onRestored, status: "in_review" });
    await user.click(screen.getByRole("tab", { name: /History/ }));
    expect(screen.getByTestId("history-tab")).toBeInTheDocument();
    expect(tabs.history[tabs.history.length - 1]).toMatchObject({
      owner: { kind: "adr", id: "a1" },
      status: "in_review",
      refreshKey: "k1",
      isDirty,
      onRestored,
    });
    expect(JSON.parse(window.localStorage.getItem(PANEL_STATE_KEY) ?? "{}")).toEqual({ open: true, tab: "history" });
  });

  it("closes to a button that reopens it, and remembers it closed", async () => {
    const { user, unmount } = renderPanel({ openThreadCount: 1 });
    await user.click(screen.getByRole("button", { name: "Close the panel" }));
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(PANEL_STATE_KEY) ?? "{}")).toEqual({ open: false, tab: "discussion" });
    unmount();

    renderPanel();
    expect(screen.queryByRole("complementary")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Discussion and history" }));
    expect(screen.getByRole("complementary", { name: "Discussion and history" })).toBeInTheDocument();
  });

  it("opens on the thread a notification names, whatever was remembered", () => {
    window.localStorage.setItem(PANEL_STATE_KEY, JSON.stringify({ open: false, tab: "history" }));
    renderPanel({}, "/ea-delivery/adr/a1/preview?thread=t7");
    expect(screen.getByRole("tab", { name: /Discussion/, selected: true })).toBeInTheDocument();
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
    await user.click(screen.getByRole("tab", { name: /History/ }));
    expect(screen.getByTestId("history-tab")).toBeInTheDocument();
  });

  it("below lg, opens in a drawer from a button", async () => {
    act(() => setViewportWidth(800));
    const { user } = renderPanel({ openThreadCount: 3 });
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    const fab = screen.getByRole("button", { name: "Discussion and history" });
    expect(within(fab).getByText("3")).toBeInTheDocument();
    await user.click(fab);
    expect(await screen.findByRole("tab", { name: /Discussion/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close the panel" }));
    await waitFor(() => expect(screen.queryByRole("tab")).toBeNull());
  });

  it("below lg, opens the drawer at once for a notification's thread", async () => {
    act(() => setViewportWidth(800));
    renderPanel({}, "/ea-delivery/adr/a1/preview?thread=t2");
    expect(await screen.findByTestId("discussion-tab")).toHaveTextContent("focus:t2");
  });
});
