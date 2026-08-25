import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import LayeredDependencySection from "./LayeredDependencySection";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { get: vi.fn() } };
});

vi.mock("@/hooks/useMetamodel", () => ({ useMetamodel: vi.fn() }));

vi.mock("@/hooks/AuthContext", () => ({
  useAuthContext: () => ({ user: { permissions: { "*": true } } }),
}));

// React Flow cannot lay out in jsdom, and this suite is about what the section
// hands the view, not about what the view draws with it — the ring geometry has
// its own tests in `ldvFocusRing.test.ts`.
type LdvProps = {
  onNodeExpand?: (id: string) => void;
  onExpandReset?: () => void;
  expandedIds?: Set<string>;
  centerId?: string;
};
const ldvProps: LdvProps[] = [];
vi.mock("@/features/reports/LayeredDependencyView", () => ({
  default: (props: LdvProps) => {
    ldvProps.push(props);
    return <div data-testid="ldv" />;
  },
}));

import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";

const GRAPH = {
  nodes: [
    { id: "erp", name: "Core ERP", type: "Application" },
    { id: "portal", name: "Web Portal", type: "Application" },
    { id: "crm", name: "CRM Cloud", type: "Application" },
  ],
  edges: [
    { source: "erp", target: "portal", type: "app_to_app", label: "uses" },
    { source: "portal", target: "crm", type: "app_to_app", label: "uses" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  ldvProps.length = 0;
  vi.mocked(api.get).mockResolvedValue(GRAPH);
  vi.mocked(useMetamodel).mockReturnValue({
    types: [{ key: "Application", label: "Application", icon: "apps", color: "#0f7eb5" }],
    relationTypes: [],
    loading: false,
    getType: () => undefined,
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
  } as unknown as ReturnType<typeof useMetamodel>);
});

async function renderSection() {
  render(<LayeredDependencySection cardId="erp" />);
  await screen.findByTestId("ldv");
}

/** The props of the most recent render of the mocked view. */
const latest = () => ldvProps[ldvProps.length - 1];

describe("LayeredDependencySection expand mode", () => {
  it("hands the expanded set to the view, so expanded cards can be ringed", async () => {
    // The bug this pins: the section tracked `expandedNodes` and used it for its
    // own BFS but never passed it on, so `isExpanded` was always false and the
    // card page expanded cards with no ring to show for it — unlike the report.
    await renderSection();
    expect(latest().expandedIds).toBeInstanceOf(Set);

    act(() => latest().onNodeExpand?.("portal"));
    expect(latest().expandedIds?.has("portal")).toBe(true);
  });

  it("keeps the centred card out of the expanded set", async () => {
    // The two rings are different widths and the centre wins, so conflating them
    // would silently downgrade the centre's ring.
    await renderSection();
    act(() => latest().onNodeExpand?.("portal"));
    expect(latest().centerId).toBe("erp");
    expect(latest().expandedIds?.has("erp")).toBe(false);
  });

  it("un-expands a card that is clicked a second time", async () => {
    await renderSection();
    act(() => latest().onNodeExpand?.("portal"));
    act(() => latest().onNodeExpand?.("portal"));
    expect(latest().expandedIds?.has("portal")).toBe(false);
  });

  it("clears every ring when expand mode is switched off", async () => {
    await renderSection();
    act(() => latest().onNodeExpand?.("portal"));
    act(() => latest().onNodeExpand?.("crm"));
    expect(latest().expandedIds?.size).toBe(2);

    act(() => latest().onExpandReset?.());
    expect(latest().expandedIds?.size).toBe(0);
  });
});
