import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() },
}));

import { api } from "@/api/client";
import { AuthProvider } from "@/hooks/AuthContext";
import type { User } from "@/types";
import {
  ExtensionBoundary,
  ExtensionSlot,
  getExtensionAdrExportSections,
  getExtensionAdrGridColumns,
  getExtensionAdrPanels,
  getExtensionFieldTypes,
  getExtensionFieldVisibilityProviders,
  getExtensionLoadErrors,
  getExtensionRoutes,
  getExtensionRoutesForGroup,
  getExtensionSlots,
  getExtensionSurveyTemplates,
  getRegisteredExtensions,
  initExtensionHost,
  loadUiExtensions,
  registerExtension,
  resetExtensionHost,
  UI_SDK_VERSION,
  type ExtensionNavGroup,
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

  it("exposes the SDK 1.6–1.8 report/dashboard surface", () => {
    initExtensionHost();
    const sdk = window.TurboEA?.sdk as Record<string, unknown>;
    // SDK 1.6 — saved reports
    expect(typeof sdk.useSavedReport).toBe("function");
    expect(sdk.SaveReportDialog).toBeDefined();
    // SDK 1.7 — report-building kit
    expect(sdk.ReportShell).toBeDefined();
    expect(sdk.FilterSelect).toBeDefined();
    expect(sdk.CardDetailSidePanel).toBeDefined();
    // SDK 1.8 — dashboard-building additions
    expect(typeof sdk.useCurrency).toBe("function");
    expect(sdk.MetricCard).toBeDefined();
    expect(sdk.ReportLegend).toBeDefined();
    expect(sdk.UserMultiSelect).toBeDefined();
    expect(typeof sdk.loadRecharts).toBe("function");
    // SDK 1.9 — theme-aware chart chrome
    expect(typeof sdk.useChartTheme).toBe("function");
    expect(typeof sdk.useThumbnailCapture).toBe("function");
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

  it("registers namespaced field types and drops mis-namespaced ones", () => {
    const Rating = () => <div>rating</div>;
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerExtension("plus", {
      key: "plus",
      sdkVersion: UI_SDK_VERSION,
      fieldTypes: [
        { type: "ext.plus.rating", label: "Rating", display: Rating, editor: Rating },
        // Wrong namespace — must be ignored.
        { type: "ext.other.bad", label: "Bad", display: Rating },
        { type: "rating", label: "Unqualified", display: Rating },
      ],
    });
    spy.mockRestore();
    const types = getExtensionFieldTypes();
    expect(Object.keys(types)).toEqual(["ext.plus.rating"]);
    expect(types["ext.plus.rating"].extKey).toBe("plus");
    expect(types["ext.plus.rating"].contribution.label).toBe("Rating");
  });

  it("returns a stable field-type snapshot until the registry changes", () => {
    registerExtension("plus", {
      key: "plus",
      sdkVersion: UI_SDK_VERSION,
      fieldTypes: [{ type: "ext.plus.rating", label: "Rating", display: () => null }],
    });
    // Same reference across calls (required for useSyncExternalStore).
    expect(getExtensionFieldTypes()).toBe(getExtensionFieldTypes());
    resetExtensionHost();
    expect(getExtensionFieldTypes()).toEqual({});
  });

  it("returns only routes that requested a given nav group", () => {
    registerExtension("rep", {
      key: "rep",
      sdkVersion: UI_SDK_VERSION,
      routes: [
        {
          id: "grouped",
          path: "/ext/rep/report",
          label: "Report",
          icon: "insights",
          navGroup: "reports",
          component: () => null,
        },
        { id: "top", path: "/ext/rep/page", label: "Page", icon: "star", component: () => null },
        // Unrecognised group — must not surface under "reports".
        {
          id: "bad",
          path: "/ext/rep/bad",
          label: "Bad",
          icon: "warning",
          navGroup: "bogus" as ExtensionNavGroup,
          component: () => null,
        },
      ],
    });
    const inReports = getExtensionRoutesForGroup("reports");
    expect(inReports).toHaveLength(1);
    expect(inReports[0].route.path).toBe("/ext/rep/report");
    // All three routes are still registered/renderable via the wildcard outlet.
    expect(getExtensionRoutes()).toHaveLength(3);
  });

  it("aggregates survey templates in order and drops invalid ones", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerExtension("daaf", {
      key: "daaf",
      sdkVersion: UI_SDK_VERSION,
      surveyTemplates: [
        { id: "quarterly", label: "Quarterly review", icon: "event",
          build: () => ({ name: "Q review", target_type_key: "Application" }) },
        // invalid: no build
        { id: "bad", label: "Bad" } as never,
      ],
    });
    spy.mockRestore();
    const tpls = getExtensionSurveyTemplates();
    expect(tpls).toHaveLength(1);
    expect(tpls[0].extKey).toBe("daaf");
    expect(tpls[0].contribution.id).toBe("quarterly");
    expect(tpls[0].contribution.build()).toEqual({
      name: "Q review",
      target_type_key: "Application",
    });
    // Stable snapshot until the registry changes.
    expect(getExtensionSurveyTemplates()).toBe(getExtensionSurveyTemplates());
    resetExtensionHost();
    expect(getExtensionSurveyTemplates()).toEqual([]);
  });

  it("aggregates field-visibility providers in registration order and drops invalid ones", () => {
    const ProviderA = () => null;
    const ProviderB = () => null;
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerExtension("aaa", { key: "aaa", sdkVersion: UI_SDK_VERSION, fieldVisibility: ProviderA });
    // Invalid: not a function → dropped.
    registerExtension("bad", {
      key: "bad",
      sdkVersion: UI_SDK_VERSION,
      fieldVisibility: {} as never,
    });
    registerExtension("bbb", { key: "bbb", sdkVersion: UI_SDK_VERSION, fieldVisibility: ProviderB });
    spy.mockRestore();

    const providers = getExtensionFieldVisibilityProviders();
    expect(providers.map((p) => p.extKey)).toEqual(["aaa", "bbb"]);
    expect(providers[0].provider).toBe(ProviderA);
    expect(providers[1].provider).toBe(ProviderB);
    // Extensions without a provider contribute nothing.
    registerExtension("plain", { key: "plain", sdkVersion: UI_SDK_VERSION });
    expect(getExtensionFieldVisibilityProviders().map((p) => p.extKey)).toEqual(["aaa", "bbb"]);
    // Stable snapshot until the registry changes.
    expect(getExtensionFieldVisibilityProviders()).toBe(getExtensionFieldVisibilityProviders());
    resetExtensionHost();
    expect(getExtensionFieldVisibilityProviders()).toEqual([]);
  });

  it("aggregates ADR panels in order and drops invalid ones", () => {
    const Panel = () => <div>panel</div>;
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerExtension("daaf", {
      key: "daaf",
      sdkVersion: UI_SDK_VERSION,
      adrPanels: [
        { id: "savings", permission: "ext.daaf.view", component: Panel },
        // invalid: no component
        { id: "bad" } as never,
      ],
    });
    spy.mockRestore();
    const panels = getExtensionAdrPanels();
    expect(panels).toHaveLength(1);
    expect(panels[0].extKey).toBe("daaf");
    expect(panels[0].contribution.id).toBe("savings");
    expect(panels[0].contribution.permission).toBe("ext.daaf.view");
    resetExtensionHost();
    expect(getExtensionAdrPanels()).toEqual([]);
  });

  it("aggregates ADR export sections and drops invalid ones", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerExtension("daaf", {
      key: "daaf",
      sdkVersion: UI_SDK_VERSION,
      adrExportSections: [
        {
          id: "savings",
          build: () => [{ heading: "Savings", paragraphs: ["Total: 50k"] }],
        },
        // invalid: no build
        { id: "bad" } as never,
      ],
    });
    spy.mockRestore();
    const builders = getExtensionAdrExportSections();
    expect(builders).toHaveLength(1);
    expect(builders[0].extKey).toBe("daaf");
    expect(builders[0].contribution.build({})).toEqual([
      { heading: "Savings", paragraphs: ["Total: 50k"] },
    ]);
    // Stable snapshot until the registry changes.
    expect(getExtensionAdrExportSections()).toBe(getExtensionAdrExportSections());
    resetExtensionHost();
    expect(getExtensionAdrExportSections()).toEqual([]);
  });

  it("aggregates ADR grid columns and drops invalid ones", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerExtension("vs", {
      key: "vs",
      sdkVersion: UI_SDK_VERSION,
      adrGridColumns: [
        {
          id: "savings",
          label: "Savings",
          align: "right",
          value: (adr) => (adr.attributes?.["ext.vs.total"] as string) ?? null,
          sortValue: () => 1200,
        },
        // invalid: no value()
        { id: "bad", label: "Bad" } as never,
        // invalid: no label
        { id: "worse", value: () => "x" } as never,
      ],
    });
    spy.mockRestore();
    const cols = getExtensionAdrGridColumns();
    expect(cols).toHaveLength(1);
    expect(cols[0].extKey).toBe("vs");
    expect(cols[0].contribution.id).toBe("savings");
    expect(cols[0].contribution.align).toBe("right");
    expect(
      cols[0].contribution.value({ attributes: { "ext.vs.total": "€1.2k" } } as never),
    ).toBe("€1.2k");
    expect(cols[0].contribution.sortValue?.({} as never)).toBe(1200);
    // Stable snapshot until the registry changes.
    expect(getExtensionAdrGridColumns()).toBe(getExtensionAdrGridColumns());
    resetExtensionHost();
    expect(getExtensionAdrGridColumns()).toEqual([]);
  });

  it("pins the current UI SDK version", () => {
    expect(UI_SDK_VERSION).toBe("1.13");
  });

  it("aggregates generic slots (component + data), sorts by order, drops invalid ones", () => {
    const Panel = () => <div>panel</div>;
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerExtension("vs", {
      key: "vs",
      sdkVersion: UI_SDK_VERSION,
      slots: [
        { slot: "risk.detail.panel", id: "savings", component: Panel, order: 2 },
        { slot: "risk.detail.panel", id: "early", component: Panel, order: 1 },
        { slot: "adr.export.extra", id: "data", build: () => ({ heading: "S" }) },
        // invalid: neither component nor build
        { slot: "risk.detail.panel", id: "bad" } as never,
        // invalid: both component and build (must be XOR)
        { slot: "risk.detail.panel", id: "both", component: Panel, build: () => 1 } as never,
        // invalid: no id
        { slot: "risk.detail.panel", component: Panel } as never,
      ],
    });
    spy.mockRestore();
    // Only the two valid component slots survive, sorted by `order`.
    const panels = getExtensionSlots("risk.detail.panel");
    expect(panels.map((s) => s.contribution.id)).toEqual(["early", "savings"]);
    expect(panels[0].extKey).toBe("vs");
    // Data slot on a different name resolves independently and its build() runs.
    const data = getExtensionSlots("adr.export.extra");
    expect(data).toHaveLength(1);
    expect(data[0].contribution.build?.({})).toEqual({ heading: "S" });
    // Unknown slot name → empty.
    expect(getExtensionSlots("nope")).toEqual([]);
    // Stable snapshot per name until the registry changes (useSyncExternalStore).
    expect(getExtensionSlots("risk.detail.panel")).toBe(getExtensionSlots("risk.detail.panel"));
    resetExtensionHost();
    expect(getExtensionSlots("risk.detail.panel")).toEqual([]);
  });

  it("ExtensionSlot renders permitted, matching component slots and hides the rest", () => {
    const Chip = () => <div>slot-chip</div>;
    registerExtension("vs", {
      key: "vs",
      sdkVersion: UI_SDK_VERSION,
      slots: [
        { slot: "card.detail.header", id: "open", component: Chip },
        // Hidden: viewer lacks the permission.
        { slot: "card.detail.header", id: "gated", permission: "ext.vs.view", component: Chip },
        // Hidden: appliesTo does not match the context card type.
        { slot: "card.detail.header", id: "typed", appliesTo: ["Application"], component: Chip },
      ],
    });
    const user = { permissions: {} } as unknown as User;
    render(
      <AuthProvider user={user} refreshUser={async () => {}}>
        <ExtensionSlot name="card.detail.header" context={{ cardType: "DataObject" }} />
      </AuthProvider>,
    );
    // Only the ungated, type-agnostic "open" slot renders.
    expect(screen.getAllByText("slot-chip")).toHaveLength(1);
  });

  it("renders contributions at the seeded adr.header and adr.signature.footer slots", () => {
    // Guards the two ADR slot names ADREditor/ADRPreview drop; a contribution
    // receives the location's context (adrId/signed/attributes) as props.
    const Seen = (props: { signed?: boolean }) => (
      <div>{props.signed ? "signed-footer" : "footer"}</div>
    );
    const Jump = () => <div>jump</div>;
    registerExtension("vs", {
      key: "vs",
      sdkVersion: UI_SDK_VERSION,
      slots: [
        { slot: "adr.header", id: "jump", component: Jump },
        { slot: "adr.signature.footer", id: "realization", component: Seen },
      ],
    });
    const user = { permissions: {} } as unknown as User;
    render(
      <AuthProvider user={user} refreshUser={async () => {}}>
        <ExtensionSlot name="adr.header" context={{ adrId: "a1", signed: true }} />
        <ExtensionSlot
          name="adr.signature.footer"
          context={{ adrId: "a1", signed: true, attributes: {} }}
        />
      </AuthProvider>,
    );
    expect(screen.getByText("jump")).toBeInTheDocument();
    expect(screen.getByText("signed-footer")).toBeInTheDocument();
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
