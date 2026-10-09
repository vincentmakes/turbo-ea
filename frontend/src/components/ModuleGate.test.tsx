/**
 * ModuleGate: the route wrapper for an optional module. It waits for the
 * module's flag, renders the page when the module is on, and a placeholder
 * pointing at the module's settings when it is off.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

type Flags = { enabled: boolean; loaded: boolean };
const flags: Record<"bpm" | "ppm" | "turbolens" | "grc", Flags> = {
  bpm: { enabled: true, loaded: true },
  ppm: { enabled: true, loaded: true },
  turbolens: { enabled: true, loaded: true },
  grc: { enabled: true, loaded: true },
};

vi.mock("@/hooks/useBpmEnabled", () => ({
  useBpmEnabled: () => ({ bpmEnabled: flags.bpm.enabled, bpmLoaded: flags.bpm.loaded }),
}));
vi.mock("@/hooks/usePpmEnabled", () => ({
  usePpmEnabled: () => ({ ppmEnabled: flags.ppm.enabled, ppmLoaded: flags.ppm.loaded }),
}));
vi.mock("@/hooks/useTurboLensReady", () => ({
  useTurboLensReady: () => ({
    turboLensEnabled: flags.turbolens.enabled,
    turboLensLoaded: flags.turbolens.loaded,
  }),
}));
vi.mock("@/hooks/useGrcEnabled", () => ({
  useGrcEnabled: () => ({ grcEnabled: flags.grc.enabled, grcLoaded: flags.grc.loaded }),
}));

import ModuleGate from "./ModuleGate";

type Module = keyof typeof flags;
const MODULES: Module[] = ["bpm", "ppm", "turbolens", "grc"];

function Where() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{pathname + search}</div>;
}

function renderGate(module: Module) {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={["/module"]}>
      <Routes>
        <Route
          path="/module"
          element={
            <ModuleGate module={module}>
              <p>the module page</p>
            </ModuleGate>
          }
        />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  return user;
}

beforeEach(() => {
  for (const m of MODULES) flags[m] = { enabled: true, loaded: true };
});

describe("ModuleGate", () => {
  it.each(MODULES)("waits for the %s flag before deciding", (module) => {
    flags[module] = { enabled: false, loaded: false };
    renderGate(module);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText("the module page")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it.each(MODULES)("renders the page when %s is on", (module) => {
    renderGate(module);
    expect(screen.getByText("the module page")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("reads only its own module's flag", () => {
    // Every other module off and unloaded: BPM still renders.
    for (const m of MODULES) flags[m] = { enabled: false, loaded: false };
    flags.bpm = { enabled: true, loaded: true };
    renderGate("bpm");
    expect(screen.getByText("the module page")).toBeInTheDocument();
  });

  it.each([
    ["bpm", "BPM", "/admin/settings?tab=bpm"],
    ["ppm", "PPM", "/admin/settings?tab=ppm"],
    ["turbolens", "TurboLens", "/admin/settings?tab=turbolens"],
    ["grc", "GRC", "/admin/settings"],
  ] as const)("names %s and opens its settings when it is off", async (module, label, settings) => {
    flags[module] = { enabled: false, loaded: true };
    const user = renderGate(module);
    expect(screen.queryByText("the module page")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: `${label} is disabled` })).toBeInTheDocument();
    expect(
      screen.getByText(
        `The ${label} module is currently disabled by an administrator. Enable it from the admin settings to access this area.`,
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Open settings/ }));
    expect(screen.getByTestId("where")).toHaveTextContent(settings);
  });

  it("goes back to the dashboard", async () => {
    flags.ppm = { enabled: false, loaded: true };
    const user = renderGate("ppm");
    await user.click(screen.getByRole("button", { name: "Back to dashboard" }));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/$/);
  });
});
