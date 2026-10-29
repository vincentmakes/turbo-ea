/**
 * SectionPaper: a workspace or admin section's surface. On a dashboard in
 * customize mode it is the live section plus the frame's controls in its own
 * title row — the drag handle before the icon, the buttons after the
 * section's own action.
 */
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import i18n from "@/i18n";
import { renderWithProviders } from "@/test/render";
import { CARD_SHADOW } from "@/theme/tokens";
import type { DashboardWidget } from "@/types";
import WidgetFrame, { DRAG_HANDLE_CLASS } from "../widgets/WidgetFrame";
import SectionPaper, { EmptyState } from "./SectionPaper";

const tc = (k: string) => i18n.t(`common:${k}`) as string;
const TODOS: DashboardWidget = { id: "t", type: "my_todos", title: null, config: {}, layout: { x: 0, y: 0, w: 6, h: 6 } };
const follows = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
// jsdom drops the space after the comma between two shadows.
const css = (shadow: string) => shadow.replace(/\s/g, "");

function renderSection(editing: boolean, handlers: { onConfigure?: () => void; onRemove?: () => void } = {}) {
  return renderWithProviders(
    <WidgetFrame widget={TODOS} editing={editing} {...handlers}>
      <SectionPaper icon="task_alt" title="My todos" action={<a href="/todos">View all</a>}>
        <EmptyState message="Nothing to do" />
      </SectionPaper>
    </WidgetFrame>,
    { theme: true },
  );
}

function icon(name: string): HTMLElement {
  return Array.from(document.querySelectorAll<HTMLElement>(".material-symbols-outlined")).find(
    (el) => el.textContent === name,
  )!;
}

describe("SectionPaper", () => {
  it("in customize mode puts the handle before its icon and the buttons after its own action", async () => {
    const onConfigure = vi.fn();
    const onRemove = vi.fn();
    const { user } = renderSection(true, { onConfigure, onRemove });
    const handle = screen.getByTestId("widget-drag-handle");
    const title = screen.getByText("My todos");
    const action = screen.getByRole("link", { name: "View all" });
    const configure = screen.getByRole("button", { name: tc("dashboard.widgets.configure") });
    const remove = screen.getByRole("button", { name: tc("dashboard.widgets.remove") });
    expect(follows(handle, icon("task_alt"))).toBe(true);
    expect(follows(icon("task_alt"), title)).toBe(true);
    expect(follows(title, action)).toBe(true);
    expect(follows(action, configure)).toBe(true);
    expect(follows(configure, remove)).toBe(true);
    // One row, inside the section's own paper; the whole icon + title group drags.
    const paper = title.closest(".MuiPaper-root")!;
    expect(paper).toContainElement(handle);
    expect(paper).toContainElement(screen.getByTestId("section-actions"));
    expect(handle.parentElement).toHaveClass(DRAG_HANDLE_CLASS);
    expect(handle.parentElement).toHaveStyle({ cursor: "grab" });
    expect(handle.parentElement).toContainElement(title);
    expect(handle.parentElement).not.toContainElement(action);
    // The live section otherwise: one title, the same variant, the body.
    expect(screen.getAllByText("My todos")).toHaveLength(1);
    expect(title).toHaveClass("MuiTypography-subtitle1");
    expect(screen.getByText("Nothing to do")).toBeInTheDocument();
    await user.click(configure);
    await user.click(remove);
    expect(onConfigure).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("shows neither outside customize mode", () => {
    renderSection(false, { onConfigure: () => {}, onRemove: () => {} });
    expect(screen.getByText("My todos")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View all" })).toBeInTheDocument();
    expect(screen.queryByTestId("widget-drag-handle")).toBeNull();
    expect(screen.queryByTestId("section-actions")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.querySelector(`.${DRAG_HANDLE_CLASS}`)).toBeNull();
  });

  it("shows neither off a dashboard", () => {
    renderWithProviders(
      <SectionPaper icon="task_alt" title="My todos">
        body
      </SectionPaper>,
    );
    expect(screen.getByText("My todos")).toBeInTheDocument();
    expect(screen.queryByTestId("widget-drag-handle")).toBeNull();
    expect(document.querySelector(`.${DRAG_HANDLE_CLASS}`)).toBeNull();
  });

  it("is lifted on the soft shadow in customize mode only, drawn around it by the frame", () => {
    const { container, unmount } = renderSection(true);
    const frame = container.querySelector<HTMLElement>("[data-widget-id]")!;
    expect(css(getComputedStyle(frame).boxShadow)).toBe(css(CARD_SHADOW.soft));
    expect(getComputedStyle(screen.getByText("My todos").closest(".MuiPaper-root")!).boxShadow).toBe("");
    unmount();
    const live = renderSection(false).container.querySelector<HTMLElement>("[data-widget-id]")!;
    expect(getComputedStyle(live).boxShadow).toBe("");
  });
});
