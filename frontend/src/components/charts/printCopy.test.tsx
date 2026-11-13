import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { installCanvas } from "@/test/dom";
import { PRINT_COLORS } from "@/theme/tokens";
import { isOpaqueColour, printBackground } from "./printCopy";

describe("printBackground", () => {
  it("takes the nearest ancestor's opaque background, skipping see-through ones", () => {
    render(
      <div data-testid="outer" style={{ backgroundColor: "rgb(1, 2, 3)" }}>
        <div data-testid="card" style={{ backgroundColor: "rgb(40, 50, 60)" }}>
          <div style={{ backgroundColor: "rgba(200, 0, 0, 0.5)" }}>
            <div data-testid="chart" />
          </div>
        </div>
      </div>,
    );
    expect(printBackground(screen.getByTestId("chart"))).toBe("rgb(40, 50, 60)");
    expect(printBackground(screen.getByTestId("outer"))).toBe("rgb(1, 2, 3)");
  });

  it("starts at the element itself", () => {
    render(
      <div style={{ backgroundColor: "rgb(1, 2, 3)" }}>
        <div data-testid="chart" style={{ backgroundColor: "rgb(9, 9, 9)" }} />
      </div>,
    );
    expect(printBackground(screen.getByTestId("chart"))).toBe("rgb(9, 9, 9)");
  });

  it("falls back to paper white when nothing paints an opaque background", () => {
    const el = document.createElement("div");
    expect(printBackground(el)).toBe(PRINT_COLORS.paper);
    render(
      <div style={{ backgroundColor: "rgba(0, 0, 0, 0)" }}>
        <div data-testid="chart" />
      </div>,
    );
    expect(printBackground(screen.getByTestId("chart"))).toBe(PRINT_COLORS.paper);
  });
});

describe("isOpaqueColour", () => {
  it.each([
    ["rgb(255, 255, 255)", true],
    ["rgba(18, 18, 18, 1)", true],
    ["rgba(0, 0, 0, 0)", false],
    ["rgba(10, 20, 30, 0.5)", false],
    ["rgba(10, 20, 30, 0.999)", false],
    ["hsl(0, 0%, 100%)", true],
    ["hsla(0, 0%, 100%, 0.2)", false],
    ["hsla(0, 0%, 100%, 1)", true],
    ["color(srgb 1 1 1)", true],
    ["color(srgb 1 1 1 / 1)", true],
    ["color(srgb 1 1 1 / 0.4)", false],
    ["color(srgb 1 1 1 / 100%)", true],
    ["color(srgb 1 1 1 / 50%)", false],
    ["oklch(0.5 0.1 200 / 99%)", false],
    ["transparent", false],
    ["", false],
  ])("%s → %s", (value, opaque) => {
    expect(isOpaqueColour(value)).toBe(opaque);
  });
});

describe("the print copy's classes, as the module defines them", () => {
  let restoreCanvas: (() => void) | undefined;
  afterEach(() => {
    restoreCanvas?.();
    restoreCanvas = undefined;
  });

  it("marks the copy and its chart with the classes print.css hides and shows", async () => {
    // Loaded fresh inside the test, so the module's own constants are the
    // ones measured here, not a copy imported before the test ran.
    vi.resetModules();
    const fresh = await import("./printCopy");
    expect(fresh.ECHART_PRINT_COPY_CLASS).toBe("echart-print-copy");
    expect(fresh.ECHART_PRINTING_CLASS).toBe("echart-printing");

    restoreCanvas = installCanvas();
    const picture = Object.assign(document.createElement("canvas"), { width: 30, height: 20 });
    const chart = {
      isDisposed: () => false,
      resize: vi.fn(),
      getZr: () => ({ flush: vi.fn() }),
      renderToCanvas: vi.fn(() => picture),
    };
    const el = document.createElement("div");
    fresh.drawPrintCopy(el, chart as unknown as Parameters<typeof fresh.drawPrintCopy>[1]);
    expect(el.className).toBe("echart-printing");
    expect(el.lastElementChild?.className).toBe("echart-print-copy");

    fresh.removePrintCopy(el);
    expect(el.className).toBe("");
    expect(el.children).toHaveLength(0);
  });
});
