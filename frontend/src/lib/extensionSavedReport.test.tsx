import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class extends Error {},
}));

import { api } from "@/api/client";
import { initExtensionHost, resetExtensionHost, useExtensionSavedReport } from "./extensionHost";

beforeEach(() => {
  vi.clearAllMocks();
  resetExtensionHost();
  delete window.TurboEA;
});

describe("SDK saved-report participation (SDK 1.6)", () => {
  it("exposes the saved-report + report-building kit on window.TurboEA.sdk", () => {
    initExtensionHost();
    expect(window.TurboEA?.sdk.useSavedReport).toBeTypeOf("function");
    expect(window.TurboEA?.sdk.SaveReportDialog).toBeTypeOf("function");
    // SDK 1.7 — report-building kit (ReportShell/CardDetailSidePanel are lazy
    // wrappers with Suspense inside; FilterSelect is the plain component).
    expect(window.TurboEA?.sdk.ReportShell).toBeTypeOf("function");
    expect(window.TurboEA?.sdk.FilterSelect).toBeTypeOf("function");
    expect(window.TurboEA?.sdk.CardDetailSidePanel).toBeTypeOf("function");
  });

  it("useSavedReport exposes the SDK 1.13 localStorage-persistence layer", () => {
    // consumeConfig / persistConfig / resetAll let an extension report keep its
    // filters + selection across a refresh exactly like a core report.
    function Probe() {
      const saved = useExtensionSavedReport("ext:daaf:quadrant");
      const ok =
        typeof saved.consumeConfig === "function" &&
        typeof saved.persistConfig === "function" &&
        typeof saved.resetAll === "function";
      return <div>{ok ? "has-persistence" : "missing"}</div>;
    }
    render(
      <MemoryRouter initialEntries={["/ext/daaf/quadrant"]}>
        <Probe />
      </MemoryRouter>,
    );
    expect(screen.getByText("has-persistence")).toBeInTheDocument();
  });

  it("useSavedReport loads the config for ?saved_report_id=", async () => {
    vi.mocked(api.get).mockResolvedValue({
      id: "r1",
      name: "Saved Quadrant",
      report_type: "ext:daaf:quadrant",
      config: { xAxis: "criticality", subtype: "SaaS" },
    });

    function Probe() {
      const { config, savedReportId, name } = useExtensionSavedReport("ext:daaf:quadrant");
      if (!config) return <div>no saved report</div>;
      return (
        <div>
          loaded:{savedReportId}:{name}:{String(config.xAxis)}
        </div>
      );
    }
    render(
      <MemoryRouter initialEntries={["/ext/daaf/quadrant?saved_report_id=r1"]}>
        <Probe />
      </MemoryRouter>,
    );
    expect(await screen.findByText("loaded:r1:Saved Quadrant:criticality")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith("/saved-reports/r1");
  });

  it("useSavedReport returns nulls without ?saved_report_id=", () => {
    function Probe() {
      const { config, savedReportId } = useExtensionSavedReport("ext:daaf:quadrant");
      return <div>{config === null && savedReportId === null ? "nulls" : "unexpected"}</div>;
    }
    render(
      <MemoryRouter initialEntries={["/ext/daaf/quadrant"]}>
        <Probe />
      </MemoryRouter>,
    );
    expect(screen.getByText("nulls")).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("the SDK SaveReportDialog POSTs the namespaced report_type", async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue({ id: "new-1" });
    initExtensionHost();
    const Dialog = window.TurboEA!.sdk.SaveReportDialog as React.ComponentType<{
      open: boolean;
      onClose: () => void;
      reportType: string;
      config: Record<string, unknown>;
    }>;

    render(
      <MemoryRouter>
        <Dialog
          open
          onClose={() => {}}
          reportType="ext:daaf:quadrant"
          config={{ xAxis: "criticality" }}
        />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText(/Name/), "Autonomy Quadrant");
    // The button's accessible name includes the icon ligature ("save Save").
    await user.click(screen.getByRole("button", { name: /Save$/ }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith(
      "/saved-reports",
      expect.objectContaining({
        report_type: "ext:daaf:quadrant",
        name: "Autonomy Quadrant",
        config: { xAxis: "criticality" },
        visibility: "private",
      }),
    );
  });
});
