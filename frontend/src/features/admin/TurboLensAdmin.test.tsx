/**
 * TurboLens settings panel: the status chips read from `/turbolens/status`, the
 * module toggle (and its singleton invalidation), and the dashboard link.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

const h = vi.hoisted(() => ({ invalidateTurboLens: vi.fn() }));
vi.mock("@/hooks/useTurboLensReady", () => ({
  useTurboLensReady: () => ({
    turboLensReady: true,
    turboLensAiConfigured: true,
    turboLensEnabled: true,
    turboLensLoaded: true,
    invalidateTurboLens: h.invalidateTurboLens,
  }),
}));

import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import TurboLensAdmin from "./TurboLensAdmin";

const STATUS = "/turbolens/status";
const TOGGLE = "/settings/turbolens-enabled";

function renderPage() {
  return renderWithProviders(<TurboLensAdmin />, {
    route: "/admin/settings",
    routes: [
      { path: "/admin/settings" },
      { path: "/turbolens", element: <div>TurboLens dashboard page</div> },
    ],
  });
}

beforeEach(() => {
  mockApi.reset();
  h.invalidateTurboLens.mockClear();
  mockApi.on("get", STATUS, { ai_configured: true, ready: true, enabled: true });
});

describe("TurboLensAdmin", () => {
  it("renders the status chips and opens the dashboard when ready", async () => {
    const { user } = renderPage();

    expect(screen.getByText("Third-party data exchange")).toBeInTheDocument();
    const toggle = screen.getByRole("checkbox");
    // Nothing is editable until the status has arrived.
    expect(toggle).toBeDisabled();
    await waitFor(() => expect(toggle).toBeEnabled());

    expect(screen.getAllByText("TurboLens enabled")).toHaveLength(2);
    expect(screen.getByText("AI Configured")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.queryByText(/requires a capable AI provider/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Open TurboLens Dashboard/ }));
    expect(await screen.findByText("TurboLens dashboard page")).toBeInTheDocument();
  });

  it("explains the missing AI provider and keeps the dashboard locked", async () => {
    mockApi.on("get", STATUS, { ai_configured: false, ready: false, enabled: true });
    renderPage();

    expect(await screen.findByText(/requires a capable AI provider/)).toBeInTheDocument();
    expect(screen.getByText("AI Not Configured")).toBeInTheDocument();
    expect(screen.getByText("Not Ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open TurboLens Dashboard/ })).toBeDisabled();
  });

  it("leaves the toggle disabled when the status cannot be loaded", async () => {
    mockApi.fail("get", STATUS);
    renderPage();

    await waitFor(() => expect(mockApi.callsOf("get", STATUS)).toHaveLength(1));
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByText("AI Not Configured")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open TurboLens Dashboard/ })).toBeDisabled();
  });

  it("saves the toggle, re-derives readiness and invalidates the singleton", async () => {
    mockApi.on("patch", TOGGLE, {});
    const { user } = renderPage();
    const toggle = screen.getByRole("checkbox");
    await waitFor(() => expect(toggle).toBeEnabled());

    await user.click(toggle);

    await waitFor(() => expect(mockApi.callsOf("patch", TOGGLE)).toHaveLength(1));
    expect(mockApi.callsOf("patch", TOGGLE)[0].body).toEqual({ enabled: false });
    expect(await screen.findByText("TurboLens setting saved")).toBeInTheDocument();
    expect(screen.getAllByText("TurboLens disabled")).toHaveLength(2);
    expect(screen.getByText("Not Ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open TurboLens Dashboard/ })).toBeDisabled();
    expect(h.invalidateTurboLens).toHaveBeenCalledTimes(1);
  });

  it("reports a failed save and keeps the module enabled", async () => {
    mockApi.fail("patch", TOGGLE);
    const { user } = renderPage();
    const toggle = screen.getByRole("checkbox");
    await waitFor(() => expect(toggle).toBeEnabled());

    await user.click(toggle);

    expect(await screen.findByText(`PATCH ${TOGGLE} failed`)).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(h.invalidateTurboLens).not.toHaveBeenCalled();
  });
});
