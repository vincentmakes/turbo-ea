import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import i18n from "@/i18n";
import { renderWithProviders } from "@/test/render";
import { buildTheme } from "@/theme";
import type { DashboardWidget, WidgetType } from "@/types";
import WidgetFrame, { DRAG_HANDLE_CLASS } from "./WidgetFrame";

const tc = (k: string) => i18n.t(`common:${k}`);

function w(type: WidgetType, title: string | null = null, config: Record<string, unknown> = {}): DashboardWidget {
  return { id: "w1", type, title, config, layout: { x: 0, y: 0, w: 6, h: 5 } };
}

/** The frame's outer element: the card, or the box around a widget that brings its own surface. */
function frameOf(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>("[data-widget-id]")!;
}

const RESTING_SHADOW = buildTheme("light").shadows[3];

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

  it("in customize mode shows the drag handle and wires configure and remove", async () => {
    const onConfigure = vi.fn();
    const onRemove = vi.fn();
    const { user } = renderWithProviders(
      <WidgetFrame widget={w("my_todos")} editing onConfigure={onConfigure} onRemove={onRemove}>
        <div>section</div>
      </WidgetFrame>,
    );
    const handle = screen.getByTestId("widget-drag-handle");
    expect(handle).toHaveClass(DRAG_HANDLE_CLASS);
    expect(handle).toHaveTextContent(tc("dashboard.workspace.myTodos"));
    await user.click(screen.getByRole("button", { name: tc("dashboard.widgets.configure") }));
    await user.click(screen.getByRole("button", { name: tc("dashboard.widgets.remove") }));
    expect(onConfigure).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
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
    for (const type of ["chart", "kpi"] as const) {
      it(`lifts a ${type} frame on a soft shadow, with no outline, while customising`, () => {
        const { container } = renderWithProviders(
          <WidgetFrame widget={w(type)} editing>
            <div />
          </WidgetFrame>,
          { theme: true },
        );
        const style = getComputedStyle(frameOf(container));
        expect(RESTING_SHADOW).not.toBe("none");
        expect(style.boxShadow).toBe(RESTING_SHADOW);
        expect(style.outlineStyle).toBe("");
        expect(style.outline).toBe("");
      });

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
