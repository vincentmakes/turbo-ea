/**
 * NeedsAttentionSection: the workspace's call to action. A card per thing
 * waiting on the user — overdue todos, broken cards they hold a role on —
 * each opening the list that resolves it; nothing at all when nothing waits.
 */
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { useLocation } from "react-router";

import i18n from "@/i18n";
import { renderWithProviders } from "@/test/render";
import { CARD_SHADOW } from "@/theme/tokens";
import type { DashboardWidget } from "@/types";
import WidgetFrame, { DRAG_HANDLE_CLASS } from "../widgets/WidgetFrame";
import NeedsAttentionSection from "./NeedsAttentionSection";

const tc = (k: string) => i18n.t(`common:${k}`) as string;
const WIDGET: DashboardWidget = {
  id: "na",
  type: "needs_attention",
  title: null,
  config: {},
  layout: { x: 0, y: 0, w: 12, h: 3 },
};
const follows = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

/** The section inside its dashboard frame. */
function renderFramed(
  overdueTodoCount: number,
  brokenCardCount: number,
  editing: boolean,
  handlers: { onConfigure?: () => void; onRemove?: () => void } = {},
) {
  return renderWithProviders(
    <WidgetFrame widget={WIDGET} editing={editing} {...handlers}>
      <NeedsAttentionSection overdueTodoCount={overdueTodoCount} brokenCardCount={brokenCardCount} />
    </WidgetFrame>,
    { theme: true },
  );
}

function Where() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{pathname + search}</div>;
}

function renderSection(overdueTodoCount: number, brokenCardCount: number) {
  return renderWithProviders(
    <NeedsAttentionSection overdueTodoCount={overdueTodoCount} brokenCardCount={brokenCardCount} />,
    {
      routes: [
        { path: "/" },
        { path: "/todos", element: <Where /> },
        { path: "/inventory", element: <Where /> },
      ],
    },
  );
}

describe("NeedsAttentionSection", () => {
  it("renders nothing when nothing waits", () => {
    const { container } = renderSection(0, 0);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows overdue todos alone and opens the todo list", async () => {
    const { user } = renderSection(3, 0);
    expect(screen.getByText("Needs my attention")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("3 overdue todos")).toBeInTheDocument();
    expect(screen.getByText("schedule")).toBeInTheDocument();
    expect(screen.queryByText(/broken card/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: /overdue todos/ }));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/todos$/);
  });

  it("shows broken cards alone and opens them in the inventory", async () => {
    const { user } = renderSection(0, 1);
    expect(screen.getByText("1 broken card you're responsible for")).toBeInTheDocument();
    expect(screen.getByText("report")).toBeInTheDocument();
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /broken card/ }));
    expect(screen.getByTestId("where")).toHaveTextContent(
      "/inventory?approval_status=BROKEN&mine=stakeholder",
    );
  });

  it("puts overdue todos before broken cards, each with a Review cue", () => {
    renderSection(1, 2);
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([
      "schedule11 overdue todoReviewchevron_right",
      "report22 broken cards you're responsible forReviewchevron_right",
    ]);
  });
});

describe("NeedsAttentionSection in customize mode", () => {
  it("puts the handle before its icon and the buttons at the end of its title row, wired", async () => {
    const onConfigure = vi.fn();
    const onRemove = vi.fn();
    const { user } = renderFramed(2, 1, true, { onConfigure, onRemove });
    const handle = screen.getByTestId("widget-drag-handle");
    const icon = screen.getByText("priority_high");
    const title = screen.getByText("Needs my attention");
    const configure = screen.getByRole("button", { name: tc("dashboard.widgets.configure") });
    const remove = screen.getByRole("button", { name: tc("dashboard.widgets.remove") });
    expect(follows(handle, icon)).toBe(true);
    expect(follows(icon, title)).toBe(true);
    expect(follows(title, configure)).toBe(true);
    expect(follows(configure, remove)).toBe(true);
    // Before the attention cards: the controls sit in the title row.
    expect(follows(remove, screen.getByRole("button", { name: /overdue todos/ }))).toBe(true);
    expect(handle.parentElement).toHaveClass(DRAG_HANDLE_CLASS);
    expect(handle.parentElement).toContainElement(title);
    expect(screen.getByTestId("section-actions")).toContainElement(configure);
    expect(screen.getAllByText("Needs my attention")).toHaveLength(1);
    await user.click(configure);
    await user.click(remove);
    expect(onConfigure).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("where")).toBeNull();
  });

  it("keeps its title row and controls with nothing waiting, so it can still be removed", async () => {
    const onRemove = vi.fn();
    const { user } = renderFramed(0, 0, true, { onRemove });
    expect(screen.getByText("Needs my attention")).toBeInTheDocument();
    expect(screen.getByTestId("widget-drag-handle")).toBeInTheDocument();
    expect(screen.queryByText(/overdue todo|broken card/)).toBeNull();
    await user.click(screen.getByRole("button", { name: tc("dashboard.widgets.remove") }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("shows no controls outside customize mode, and nothing at all with nothing waiting", () => {
    const { unmount } = renderFramed(2, 0, false, { onConfigure: () => {}, onRemove: () => {} });
    expect(screen.getByText("Needs my attention")).toBeInTheDocument();
    expect(screen.queryByTestId("widget-drag-handle")).toBeNull();
    expect(screen.queryByTestId("section-actions")).toBeNull();
    expect(document.querySelector(`.${DRAG_HANDLE_CLASS}`)).toBeNull();
    unmount();
    renderFramed(0, 0, false, { onRemove: () => {} });
    expect(screen.queryByText("Needs my attention")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("is lifted on the soft shadow in customize mode only, drawn around it by the frame", () => {
    const flat = (v: string) => v.replace(/\s/g, "");
    const { container, unmount } = renderFramed(1, 0, true);
    expect(flat(getComputedStyle(container.querySelector("[data-widget-id]")!).boxShadow)).toBe(flat(CARD_SHADOW.soft));
    unmount();
    const live = renderFramed(1, 0, false).container.querySelector("[data-widget-id]")!;
    expect(getComputedStyle(live).boxShadow).toBe("");
  });
});
