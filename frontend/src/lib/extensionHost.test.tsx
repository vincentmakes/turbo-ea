import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() },
}));

import { api } from "@/api/client";
import {
  ExtensionBoundary,
  getExtensionLoadErrors,
  getExtensionRoutes,
  getRegisteredExtensions,
  initExtensionHost,
  loadUiExtensions,
  registerExtension,
  resetExtensionHost,
  UI_SDK_VERSION,
} from "./extensionHost";

const mockGet = api.get as ReturnType<typeof vi.fn>;

describe("extensionHost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetExtensionHost();
    delete window.TurboEA;
  });

  it("exposes the SDK global with register()", () => {
    initExtensionHost();
    expect(window.TurboEA).toBeDefined();
    expect(window.TurboEA?.sdk.React).toBeDefined();
    expect(window.TurboEA?.sdk.api).toBeDefined();
    expect(typeof window.TurboEA?.register).toBe("function");
  });

  it("registers a plugin and lists its routes", () => {
    const Page = () => <div>ext page</div>;
    registerExtension("sample-ext", {
      key: "sample-ext",
      sdkVersion: UI_SDK_VERSION,
      routes: [
        { id: "main", path: "/ext/sample-ext", label: "Sample", icon: "extension", component: Page },
      ],
    });
    expect(getRegisteredExtensions()).toHaveLength(1);
    expect(getExtensionRoutes()).toHaveLength(1);
    expect(getExtensionRoutes()[0].route.path).toBe("/ext/sample-ext");
  });

  it("rejects a plugin with a mismatched key or incompatible SDK major", () => {
    registerExtension("a", { key: "b", sdkVersion: UI_SDK_VERSION });
    expect(getRegisteredExtensions()).toHaveLength(0);
    expect(getExtensionLoadErrors()["a"]).toMatch(/key mismatch/);

    registerExtension("c", { key: "c", sdkVersion: "9.0" });
    expect(getRegisteredExtensions()).toHaveLength(0);
    expect(getExtensionLoadErrors()["c"]).toMatch(/SDK/);
  });

  it("re-registration replaces the previous plugin", () => {
    registerExtension("x", { key: "x", sdkVersion: UI_SDK_VERSION, routes: [] });
    registerExtension("x", {
      key: "x",
      sdkVersion: UI_SDK_VERSION,
      routes: [
        { id: "r", path: "/ext/x", label: "X", icon: "star", component: () => null },
      ],
    });
    expect(getRegisteredExtensions()).toHaveLength(1);
    expect(getExtensionRoutes()).toHaveLength(1);
  });

  it("swallows a failing ui-manifest fetch (no extensions, no crash)", async () => {
    mockGet.mockRejectedValue(new Error("404"));
    await loadUiExtensions();
    expect(getRegisteredExtensions()).toHaveLength(0);
  });

  it("records an import failure per extension without throwing", async () => {
    mockGet.mockResolvedValue([
      {
        key: "broken-ext",
        version: "1.0.0",
        entry: "/api/v1/ext-assets/broken-ext/1.0.0/entry.js",
        entitlement_state: "active",
      },
    ]);
    await loadUiExtensions();
    expect(getExtensionLoadErrors()["broken-ext"]).toBeTruthy();
    expect(getRegisteredExtensions()).toHaveLength(0);
  });

  it("ExtensionBoundary catches a crashing component", () => {
    const Bomb = () => {
      throw new Error("kaboom");
    };
    // Silence React's error logging for the expected throw.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ExtensionBoundary extensionKey="sample-ext">
        <Bomb />
      </ExtensionBoundary>,
    );
    spy.mockRestore();
    expect(screen.getByText(/failed to render/)).toBeInTheDocument();
    expect(screen.getByText(/kaboom/)).toBeInTheDocument();
  });
});
