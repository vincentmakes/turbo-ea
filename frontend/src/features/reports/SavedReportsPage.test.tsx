import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class extends Error {},
}));

import { api } from "@/api/client";
import { registerExtension, resetExtensionHost, UI_SDK_VERSION } from "@/lib/extensionHost";
import SavedReportsPage from "./SavedReportsPage";
import { EXTENSION_REPORT_COLOR, UNKNOWN_REPORT_COLOR } from "./savedReportStyles";
import { alpha, createTheme } from "@mui/material/styles";

const EXT_REPORT = {
  id: "r1",
  name: "My Quadrant",
  description: "",
  report_type: "ext:daaf:quadrant",
  config: { xAxis: "criticality" },
  visibility: "private",
  thumbnail: null,
  is_owner: true,
  owner_name: "Me",
};

function renderGallery() {
  return render(
    <MemoryRouter initialEntries={["/reports/saved"]}>
      <Routes>
        <Route path="/reports/saved" element={<SavedReportsPage />} />
        <Route path="/ext/daaf/quadrant" element={<div>EXT REPORT PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetExtensionHost();
  vi.mocked(api.get).mockResolvedValue([EXT_REPORT]);
});

describe("SavedReportsPage — extension saved reports", () => {
  it("styles an ext:* card with the registered route's label/icon and opens its path", async () => {
    const user = userEvent.setup();
    registerExtension("daaf", {
      key: "daaf",
      sdkVersion: UI_SDK_VERSION,
      routes: [
        {
          id: "quadrant",
          path: "/ext/daaf/quadrant",
          label: "Autonomy Quadrant",
          icon: "scatter_plot",
          component: () => null,
        },
      ],
    });

    renderGallery();
    // The card uses the extension route's label, not the raw namespaced type.
    expect(await screen.findByText("Autonomy Quadrant")).toBeInTheDocument();
    expect(screen.queryByText("ext:daaf:quadrant")).not.toBeInTheDocument();

    // Opening navigates to the route's path with ?saved_report_id=.
    await user.click(screen.getByText("My Quadrant"));
    expect(await screen.findByText("EXT REPORT PAGE")).toBeInTheDocument();
  });

  it("degrades gracefully when the extension is not loaded: raw label, click is a no-op", async () => {
    const user = userEvent.setup();
    renderGallery();
    // Falls back to the raw type as the label; the card still renders.
    expect(await screen.findByText("ext:daaf:quadrant")).toBeInTheDocument();
    await user.click(screen.getByText("My Quadrant"));
    // No navigation happened — the gallery is still on screen.
    expect(screen.getByText("My Quadrant")).toBeInTheDocument();
    expect(screen.queryByText("EXT REPORT PAGE")).not.toBeInTheDocument();
  });

  it("core report types keep their style and path", async () => {
    vi.mocked(api.get).mockResolvedValue([
      { ...EXT_REPORT, id: "r2", name: "Portfolio Q1", report_type: "portfolio" },
    ]);
    renderGallery();
    expect(await screen.findByText("Portfolio Q1")).toBeInTheDocument();
    // Core label comes from savedReportStyles, untouched by extension logic.
    expect(screen.queryByText("portfolio")).not.toBeInTheDocument();
  });
});

describe("SavedReportsPage — tile colours", () => {
  /** The background a `:hover` rule on the element's own class sets, in rgb. */
  function hoverBackground(el: Element): string {
    const classes = Array.from(el.classList).filter((c) => c.startsWith("css-"));
    const rules = Array.from(document.styleSheets)
      .flatMap((sheet) => Array.from(sheet.cssRules))
      .filter((r): r is CSSStyleRule => "selectorText" in r)
      .filter((r) => classes.some((c) => r.selectorText === `.${c}:hover`))
      .filter((r) => r.style.getPropertyValue("background-color") !== "");
    return rules[rules.length - 1]?.style.getPropertyValue("background-color") ?? "";
  }

  it("colours an extension report's tile in the extension colour, with its route's icon", async () => {
    registerExtension("daaf", {
      key: "daaf",
      sdkVersion: UI_SDK_VERSION,
      routes: [{ id: "quadrant", path: "/ext/daaf/quadrant", label: "Autonomy Quadrant", icon: "scatter_plot", component: () => null }],
    });
    renderGallery();
    const chip = (await screen.findByText("Autonomy Quadrant")).closest(".MuiChip-root")!;
    expect(chip).toHaveStyle({ color: EXTENSION_REPORT_COLOR });
    expect(chip).toHaveTextContent("scatter_plot");
  });

  it("colours a report of an unknown type grey, with the generic analytics icon", async () => {
    renderGallery();
    const chip = (await screen.findByText("ext:daaf:quadrant")).closest(".MuiChip-root")!;
    expect(chip).toHaveStyle({ color: UNKNOWN_REPORT_COLOR });
    expect(chip).toHaveTextContent("analytics");
  });

  it("pins the owner's menu button top-right on a white wash that firms up on hover", async () => {
    renderGallery();
    const button = (await screen.findByText("more_vert")).closest("button")!;
    const white = createTheme().palette.common.white;
    expect(button).toHaveStyle({ position: "absolute", backgroundColor: alpha(white, 0.85) });
    expect(hoverBackground(button)).toBe(alpha(white, 0.95));
  });
});
