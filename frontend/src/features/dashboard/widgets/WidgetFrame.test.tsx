import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import i18n from "@/i18n";
import { renderWithProviders } from "@/test/render";
import { CARD_SHADOW } from "@/theme/tokens";
import type { DashboardWidget, WidgetType } from "@/types";
import WidgetFrame, { DRAG_HANDLE_CLASS, useWidgetControls, useWidgetEditing } from "./WidgetFrame";

const tc = (k: string) => i18n.t(`common:${k}`);

function w(type: WidgetType, title: string | null = null, config: Record<string, unknown> = {}): DashboardWidget {
  return { id: "w1", type, title, config, layout: { x: 0, y: 0, w: 6, h: 5 } };
}

/** The frame's outer element: the card, or the box around a tile or a section. */
function frameOf(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>("[data-widget-id]")!;
}

/** Stands in for a tile: places the controls it is handed. */
function ControlsProbe() {
  const controls = useWidgetControls();
  const editing = useWidgetEditing();
  return (
    <div data-testid="probe" data-editing={String(editing)}>
      {controls ? (
        <>
          <span data-testid="probe-handle">{controls.handle}</span>
          <span data-testid="probe-actions">{controls.actions}</span>
        </>
      ) : (
        "no controls"
      )}
    </div>
  );
}

function Boom(): never {
  throw new Error("kaboom");
}

describe("WidgetFrame", () => {
  it("titles a chart with its own title and shows no customize controls when not editing", () => {
    renderWithProviders(
      <WidgetFrame widget={w("chart", "Apps by status")} editing={false}>
        <div>body</div>
      </WidgetFrame>,
    );
    expect(screen.getByText("Apps by status")).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
    expect(document.querySelector(`.${DRAG_HANDLE_CLASS}`)).toBeNull();
    expect(screen.queryByRole("button", { name: tc("dashboard.widgets.configure") })).toBeNull();
    expect(screen.queryByRole("button", { name: tc("dashboard.widgets.remove") })).toBeNull();
  });

  it("falls back to the registry label", () => {
    renderWithProviders(
      <WidgetFrame widget={w("browse_by_type")} editing={false}>
        <div />
      </WidgetFrame>,
    );
    expect(screen.getByText(tc("dashboard.browseByType"))).toBeInTheDocument();
  });

  it("adds no title row to a widget that brings its own surface", () => {
    renderWithProviders(
      <WidgetFrame widget={w("my_todos")} editing={false}>
        <div>section</div>
      </WidgetFrame>,
    );
    expect(screen.queryByText(tc("dashboard.workspace.myTodos"))).toBeNull();
    expect(screen.getByText("section")).toBeInTheDocument();
  });

  it("in customize mode gives a carded widget a caption header with the drag handle, and wires configure and remove", async () => {
    const onConfigure = vi.fn();
    const onRemove = vi.fn();
    const { user } = renderWithProviders(
      <WidgetFrame widget={w("recent_activity")} editing onConfigure={onConfigure} onRemove={onRemove}>
        <div>section</div>
      </WidgetFrame>,
    );
    const handle = screen.getByTestId("widget-drag-handle");
    expect(handle).toHaveClass(DRAG_HANDLE_CLASS);
    expect(handle).toHaveTextContent(tc("dashboard.recentActivity"));
    expect(handle.querySelector(".MuiTypography-caption")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: tc("dashboard.widgets.configure") }));
    await user.click(screen.getByRole("button", { name: tc("dashboard.widgets.remove") }));
    expect(onConfigure).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("keeps a titled widget's header in customize mode: the handle around its title, the buttons after it", async () => {
    const onConfigure = vi.fn();
    const onRemove = vi.fn();
    const { container, user } = renderWithProviders(
      <WidgetFrame widget={w("chart", "Apps by status")} editing onConfigure={onConfigure} onRemove={onRemove}>
        <ControlsProbe />
      </WidgetFrame>,
    );
    const handle = screen.getByTestId("widget-drag-handle");
    expect(handle).toHaveTextContent("Apps by status");
    expect(handle.querySelector("h6, .MuiTypography-subtitle1")).not.toBeNull();
    const configure = screen.getByRole("button", { name: tc("dashboard.widgets.configure") });
    const remove = screen.getByRole("button", { name: tc("dashboard.widgets.remove") });
    // Same row, handle first, buttons after it; none of it inside the body.
    expect(handle.parentElement).toBe(configure.parentElement);
    expect(handle.compareDocumentPosition(configure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(configure.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId("widget-body")).not.toContainElement(handle);
    // The frame drew them; the widget is told it is being arranged but handed nothing.
    expect(screen.getByTestId("probe")).toHaveAttribute("data-editing", "true");
    expect(screen.getByTestId("probe")).toHaveTextContent("no controls");
    expect(container.querySelectorAll(`.${DRAG_HANDLE_CLASS}`)).toHaveLength(1);
    await user.click(configure);
    await user.click(remove);
    expect(onConfigure).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  describe("a widget that draws its own surface (every KPI tile and section)", () => {
    for (const type of ["kpi", "my_todos", "needs_attention", "top_contributors"] as const) {
      it(`in customize mode gives a ${type} no header and no card, and hands it the handle and the buttons`, async () => {
        const onConfigure = vi.fn();
        const onRemove = vi.fn();
        const { container, user } = renderWithProviders(
          <WidgetFrame widget={w(type, "Apps")} editing onConfigure={onConfigure} onRemove={onRemove}>
            <ControlsProbe />
          </WidgetFrame>,
        );
        // No header: the title is the tile's to draw, and nothing sits outside the body.
        expect(screen.queryByText("Apps")).toBeNull();
        const frame = frameOf(container);
        expect(frame.children).toHaveLength(1);
        expect(frame.firstElementChild).toBe(screen.getByTestId("widget-body"));
        // No card from the frame.
        expect(container.querySelector(".MuiCard-root, .MuiPaper-root")).toBeNull();
        // The controls, handed through context.
        expect(screen.getByTestId("probe")).toHaveAttribute("data-editing", "true");
        const handle = screen.getByTestId("widget-drag-handle");
        expect(screen.getByTestId("probe-handle")).toContainElement(handle);
        expect(handle).toHaveClass(DRAG_HANDLE_CLASS);
        expect(handle).toHaveAttribute("title", tc("dashboard.widgets.dragToMove"));
        expect(handle).toHaveStyle({ cursor: "grab" });
        expect(container.querySelectorAll(`.${DRAG_HANDLE_CLASS}`)).toHaveLength(1);
        const actions = screen.getByTestId("probe-actions");
        const configure = screen.getByRole("button", { name: tc("dashboard.widgets.configure") });
        const remove = screen.getByRole("button", { name: tc("dashboard.widgets.remove") });
        expect(actions).toContainElement(configure);
        expect(actions).toContainElement(remove);
        await user.click(configure);
        expect(onConfigure).toHaveBeenCalledTimes(1);
        expect(onRemove).not.toHaveBeenCalled();
        await user.click(remove);
        expect(onRemove).toHaveBeenCalledTimes(1);
      });
    }

    it("hands over only the buttons it has handlers for", () => {
      renderWithProviders(
        <WidgetFrame widget={w("kpi")} editing onRemove={() => {}}>
          <ControlsProbe />
        </WidgetFrame>,
      );
      expect(screen.getByTestId("widget-drag-handle")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: tc("dashboard.widgets.configure") })).toBeNull();
      expect(screen.getByRole("button", { name: tc("dashboard.widgets.remove") })).toBeInTheDocument();
    });

    it("hands over nothing outside customize mode", () => {
      const { container } = renderWithProviders(
        <WidgetFrame widget={w("kpi", "Apps")} editing={false} onConfigure={() => {}} onRemove={() => {}}>
          <ControlsProbe />
        </WidgetFrame>,
      );
      expect(screen.getByTestId("probe")).toHaveAttribute("data-editing", "false");
      expect(screen.getByTestId("probe")).toHaveTextContent("no controls");
      expect(container.querySelector(`.${DRAG_HANDLE_CLASS}`)).toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.queryByText("Apps")).toBeNull();
      expect(container.querySelector(".MuiCard-root")).toBeNull();
    });

    it("draws the controls above the error when it fails to render in customize mode", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const onConfigure = vi.fn();
      const onRemove = vi.fn();
      const { user } = renderWithProviders(
        <WidgetFrame widget={w("my_todos")} editing onConfigure={onConfigure} onRemove={onRemove}>
          <Boom />
        </WidgetFrame>,
      );
      const title = tc("dashboard.workspace.myTodos");
      expect(screen.getByText(`${tc("errors.failedToRender")} ${title}`)).toBeInTheDocument();
      const handle = screen.getByTestId("widget-drag-handle");
      expect(handle).toHaveClass(DRAG_HANDLE_CLASS);
      expect(handle).toHaveTextContent(title);
      await user.click(screen.getByRole("button", { name: tc("dashboard.widgets.configure") }));
      await user.click(screen.getByRole("button", { name: tc("dashboard.widgets.remove") }));
      expect(onConfigure).toHaveBeenCalledTimes(1);
      expect(onRemove).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it("draws no header above the error outside customize mode", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      renderWithProviders(
        <WidgetFrame widget={w("my_todos")} editing={false} onRemove={() => {}}>
          <Boom />
        </WidgetFrame>,
      );
      const title = tc("dashboard.workspace.myTodos");
      expect(screen.getByText(`${tc("errors.failedToRender")} ${title}`)).toBeInTheDocument();
      expect(screen.queryByTestId("widget-drag-handle")).toBeNull();
      expect(screen.queryByText(title)).toBeNull();
      expect(screen.queryByRole("button", { name: tc("dashboard.widgets.remove") })).toBeNull();
      spy.mockRestore();
    });
  });

  it("omits buttons without a handler", () => {
    renderWithProviders(
      <WidgetFrame widget={w("chart")} editing>
        <div />
      </WidgetFrame>,
    );
    expect(screen.getByTestId("widget-drag-handle")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: tc("dashboard.widgets.configure") })).toBeNull();
    expect(screen.queryByRole("button", { name: tc("dashboard.widgets.remove") })).toBeNull();
  });

  it("contains a widget that throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderWithProviders(
      <>
        <WidgetFrame widget={w("chart", "Broken")} editing={false}>
          <Boom />
        </WidgetFrame>
        <div>still here</div>
      </>,
    );
    expect(screen.getByText(`${tc("errors.failedToRender")} Broken`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: tc("actions.retry") })).toBeInTheDocument();
    expect(screen.getByText("still here")).toBeInTheDocument();
    spy.mockRestore();
  });

  it("lays the body out to fill the frame", () => {
    renderWithProviders(
      <WidgetFrame widget={w("chart")} editing={false}>
        <div />
      </WidgetFrame>,
    );
    const body = screen.getByTestId("widget-body");
    expect(body).toHaveStyle({ flex: "1", minHeight: "0", display: "flex", flexDirection: "column" });
  });

  describe("customize-mode shadow", () => {
    // jsdom drops the space after the comma between two shadows.
    const css = (shadow: string) => shadow.replace(/\),\s*/g, "),");

    // A widget that draws its own surface gets the shadow on the frame's box,
    // which the surface fills: the body's overflow would clip one drawn on the surface.
    for (const type of ["chart", "recent_activity", "kpi", "my_todos"] as const) {
      it(`lifts a ${type} frame on the soft card shadow, faded in, with no outline, while customising`, () => {
        const { container } = renderWithProviders(
          <WidgetFrame widget={w(type)} editing>
            <div />
          </WidgetFrame>,
          { theme: true },
        );
        const style = getComputedStyle(frameOf(container));
        expect(style.boxShadow).toBe(css(CARD_SHADOW.soft));
        expect(style.transition).toBe("box-shadow 150ms");
        expect(style.outline).toBe("");
      });
    }

    for (const type of ["chart", "recent_activity", "my_todos", "kpi"] as const) {
      it(`draws neither a shadow nor an outline on a ${type} frame outside customize mode`, () => {
        const { container } = renderWithProviders(
          <WidgetFrame widget={w(type)} editing={false}>
            <div />
          </WidgetFrame>,
          { theme: true },
        );
        const style = getComputedStyle(frameOf(container));
        expect(style.boxShadow).toBe("");
        expect(style.outline).toBe("");
      });
    }
  });
});
