import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class extends Error {},
}));

import { api } from "@/api/client";
import { registerExtension, resetExtensionHost, UI_SDK_VERSION } from "@/lib/extensionHost";
import SavedReportsPage from "./SavedReportsPage";

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
