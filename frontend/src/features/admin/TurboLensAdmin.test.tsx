/**
 * TurboLens settings panel: the status chips read from `/turbolens/status`, the
 * module toggle (and its singleton invalidation), and the dashboard link.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

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
import { renderWithProviders, wrapWithProviders } from "@/test/render";
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

describe("TurboLensAdmin — state transitions", () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  it("paints the module as enabled, with no message and no spinner, before the status arrives", () => {
    const html = renderToStaticMarkup(wrapWithProviders(<TurboLensAdmin />));
    // The label and the chip both read "enabled" until the server says otherwise.
    expect(html.split("TurboLens enabled")).toHaveLength(3);
    expect(html).not.toContain("TurboLens disabled");
    // Only the third-party warning: no error alert, no open snackbar.
    expect(html.split('role="alert"')).toHaveLength(2);
    expect(html).not.toContain('role="progressbar"');
  });

  it("renders the panel copy", async () => {
    renderPage();
    expect(
      screen.getByText("Manage connections to TurboLens instances for AI-powered analysis."),
    ).toBeInTheDocument();
    expect(screen.getByText(/AI features may send card metadata/)).toBeInTheDocument();
    expect(screen.getByText("TurboLens Intelligence")).toBeInTheDocument();
    expect(screen.getByText(/AI-powered vendor analysis, duplicate detection/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeEnabled());
    // Loaded and idle: still only the warning, and no spinner.
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("treats a status without an enabled flag as enabled", async () => {
    mockApi.on("get", STATUS, { ai_configured: true, ready: true });
    renderPage();
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeEnabled());
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getAllByText("TurboLens enabled")).toHaveLength(2);
  });

  it("reflects a module the server reports as disabled", async () => {
    mockApi.on("get", STATUS, { ai_configured: true, ready: false, enabled: false });
    renderPage();
    await waitFor(() => expect(screen.getByRole("checkbox")).not.toBeChecked());
    expect(screen.getAllByText("TurboLens disabled")).toHaveLength(2);
  });

  it("shows a spinner and locks the toggle while the save is in flight", async () => {
    const gate = deferred<unknown>();
    mockApi.on("patch", TOGGLE, () => gate.promise);
    const { user } = renderPage();
    const toggle = screen.getByRole("checkbox");
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

    await user.click(toggle);

    expect(await screen.findByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeDisabled();

    gate.resolve({});
    await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());
    expect(screen.getByRole("checkbox")).toBeEnabled();
  });

  it("switching the module on makes it ready when AI is configured", async () => {
    mockApi.on("get", STATUS, { ai_configured: true, ready: false, enabled: false });
    mockApi.on("patch", TOGGLE, {});
    const { user } = renderPage();
    const toggle = screen.getByRole("checkbox");
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(screen.getByText("Not Ready")).toBeInTheDocument();

    await user.click(toggle);

    expect(await screen.findByText("TurboLens setting saved")).toBeInTheDocument();
    expect(mockApi.callsOf("patch", TOGGLE)[0].body).toEqual({ enabled: true });
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("AI Configured")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByRole("checkbox")).toBeEnabled();
    expect(screen.getByRole("button", { name: /Open TurboLens Dashboard/ })).toBeEnabled();
  });

  it("keeps the AI chip after switching the module off", async () => {
    mockApi.on("patch", TOGGLE, {});
    const { user } = renderPage();
    const toggle = screen.getByRole("checkbox");
    await waitFor(() => expect(toggle).toBeEnabled());

    await user.click(toggle);

    expect(await screen.findByText("TurboLens setting saved")).toBeInTheDocument();
    expect(screen.getByText("AI Configured")).toBeInTheDocument();
    // The status is still known, so the toggle can be flipped back.
    expect(screen.getByRole("checkbox")).toBeEnabled();
  });

  it("clears an earlier error when the next save succeeds", async () => {
    mockApi.fail("patch", TOGGLE);
    const { user } = renderPage();
    const toggle = screen.getByRole("checkbox");
    await waitFor(() => expect(toggle).toBeEnabled());

    await user.click(toggle);
    expect(await screen.findByText(`PATCH ${TOGGLE} failed`)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeEnabled());

    mockApi.on("patch", TOGGLE, {});
    await user.click(screen.getByRole("checkbox"));

    expect(await screen.findByText("TurboLens setting saved")).toBeInTheDocument();
    expect(screen.queryByText(`PATCH ${TOGGLE} failed`)).not.toBeInTheDocument();
    // The warning and the snackbar: the error alert is gone.
    expect(screen.getAllByRole("alert")).toHaveLength(2);
  });

  it("lets the user dismiss the error", async () => {
    mockApi.fail("patch", TOGGLE);
    const { user } = renderPage();
    const toggle = screen.getByRole("checkbox");
    await waitFor(() => expect(toggle).toBeEnabled());

    await user.click(toggle);
    expect(await screen.findByText(`PATCH ${TOGGLE} failed`)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(screen.queryByText(`PATCH ${TOGGLE} failed`)).not.toBeInTheDocument(),
    );
    // Only the third-party warning is left.
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("falls back to a generic message when the failure is not an Error", async () => {
    mockApi.on("patch", TOGGLE, () => Promise.reject("nope"));
    const { user } = renderPage();
    const toggle = screen.getByRole("checkbox");
    await waitFor(() => expect(toggle).toBeEnabled());

    await user.click(toggle);

    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
  });

  it("closes the saved snackbar on Escape", async () => {
    mockApi.on("patch", TOGGLE, {});
    const { user } = renderPage();
    const toggle = screen.getByRole("checkbox");
    await waitFor(() => expect(toggle).toBeEnabled());

    await user.click(toggle);
    expect(await screen.findByText("TurboLens setting saved")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(1));
    expect(screen.queryByText("TurboLens setting saved")).not.toBeInTheDocument();
  });
});
