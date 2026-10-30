import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A data-quality jump (#1334) through the real component: which tab opens,
// which section is asked to expand, and which element is scrolled to. Sections
// are markers carrying their real anchor ids and the `expandOn` they receive.

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(() => Promise.resolve([])), patch: vi.fn(), post: vi.fn(), delete: vi.fn() },
  ApiError: class extends Error {},
}));
vi.mock("@/hooks/useMetamodel", () => ({ useMetamodel: vi.fn() }));
vi.mock("@/hooks/useCalculatedFields", () => ({
  useCalculatedFields: () => ({ calculatedFields: {}, isCalculated: () => false, loading: false }),
}));
vi.mock("@/hooks/useCurrency", () => ({
  useCurrency: () => ({ fmt: (v: number) => `$${v}`, fmtShort: (v: number) => `$${v}`, symbol: "$" }),
}));
vi.mock("@/hooks/usePpmEnabled", () => ({ usePpmEnabled: () => ({ ppmEnabled: false }) }));
vi.mock("@/hooks/useGrcEnabled", () => ({ useGrcEnabled: () => ({ grcEnabled: false }) }));
vi.mock("@/hooks/useCardTabActivity", () => ({
  useCardTabActivity: () => ({ hasUpdates: () => false, noteVisit: vi.fn() }),
}));
vi.mock("@/hooks/AuthContext", () => ({
  useOptionalAuthUser: () => null,
  useAuthContext: () => ({ user: { id: "u1", permissions: { "*": true } } }),
}));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ can: () => true }) }));
vi.mock("@/components/EolLinkSection", () => ({ default: () => <div data-testid="sec-eol" /> }));

vi.mock("@/features/cards/sections", async () => {
  const jump = await vi.importActual<typeof import("./dataQualityJump")>("./dataQualityJump");
  const section =
    (name: string, id: string) =>
    ({ expandOn }: { expandOn?: number }) => (
      <div data-testid={`sec-${name}`} id={id} data-expand-on={String(expandOn)} />
    );
  const marker = (id: string) => () => <div data-testid={id} />;
  return {
    AttributeSection: ({
      section: s,
      expandOn,
    }: {
      section: { section: string };
      expandOn?: number;
    }) => (
      <div
        data-testid={`sec-custom-${s.section}`}
        id={jump.customSectionAnchor(s.section)}
        data-expand-on={String(expandOn)}
      />
    ),
    DescriptionSection: section("description", jump.sectionAnchor("description")),
    LifecycleSection: section("lifecycle", jump.sectionAnchor("lifecycle")),
    TagsSection: section("tags", jump.sectionAnchor("tags")),
    RelationsSection: ({ expandOn }: { expandOn?: number }) => (
      <div
        data-testid="sec-relations"
        id={jump.sectionAnchor("relations")}
        data-expand-on={String(expandOn)}
      >
        <div data-testid="group-rel" id={jump.relationGroupAnchor("relShown", "source")} />
      </div>
    ),
    HierarchySection: marker("sec-hierarchy"),
    SuccessorsSection: marker("sec-successors"),
    LayeredDependencySection: marker("sec-ldv"),
    CommentsTab: marker("panel-comments"),
    TodosTab: marker("panel-todos"),
    StakeholdersTab: marker("panel-stakeholders"),
    ResourcesTab: marker("panel-resources"),
    AdrsTab: marker("panel-adrs"),
    HistoryTab: marker("panel-history"),
    RisksTab: marker("panel-risks"),
    ComplianceTab: marker("panel-compliance"),
  };
});

import { useMetamodel } from "@/hooks/useMetamodel";
import type { Card } from "@/types";
import CardDetailContent from "./CardDetailContent";
import type { DataQualityJumpTarget } from "./dataQualityJump";

const TYPE = {
  key: "Application",
  label: "Application",
  icon: "apps",
  color: "#0f7eb5",
  has_hierarchy: false,
  has_successors: false,
  subtypes: [],
  fields_schema: [{ section: "Cost Data", fields: [{ key: "a", label: "A", type: "text" }] }],
  section_config: {},
};

const CARD = {
  id: "card-1",
  name: "Thing",
  type: "Application",
  status: "ACTIVE",
  approval_status: "DRAFT",
  data_quality: 0,
  lifecycle: {},
  attributes: {},
  tags: [],
  stakeholders: [],
} as unknown as Card;

const perms = {
  can_view: true,
  can_edit: true,
  can_manage_adr_links: false,
} as unknown as Parameters<typeof CardDetailContent>[0]["perms"];

type Focus = { target: DataQualityJumpTarget; nonce: number } | null;

function view(focusTarget: Focus, initialTab: string | number = 0) {
  return (
    <MemoryRouter>
      <CardDetailContent
        card={CARD}
        perms={perms}
        onCardUpdate={() => {}}
        initialTab={initialTab}
        focusTarget={focusTarget}
      />
    </MemoryRouter>
  );
}

const selectedTab = () =>
  screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true")
    ?.textContent;
const expandOnOf = (testId: string) => screen.getByTestId(testId).getAttribute("data-expand-on");

const scrolled: string[] = [];
const scrollArgs: unknown[] = [];

beforeEach(() => {
  vi.mocked(useMetamodel).mockReturnValue({
    types: [TYPE],
    relationTypes: [],
    loading: false,
    getType: (k: string) => (k === TYPE.key ? TYPE : undefined),
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
  } as unknown as ReturnType<typeof useMetamodel>);
  scrolled.length = 0;
  scrollArgs.length = 0;
  Element.prototype.scrollIntoView = vi.fn(function (this: Element, arg?: unknown) {
    scrolled.push(this.id);
    scrollArgs.push(arg);
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const lifecycle: DataQualityJumpTarget = {
  tab: "card",
  anchor: "card-section-lifecycle",
  sectionAnchor: "card-section-lifecycle",
};

describe("CardDetailContent data-quality jump", () => {
  it("opens the Stakeholders tab for a stakeholder slot, scrolling nowhere", async () => {
    vi.useFakeTimers();
    render(view({ target: { tab: "stakeholders" }, nonce: 1 }));
    expect(selectedTab()).toBe("Stakeholders");
    expect(screen.getByTestId("panel-stakeholders")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(scrolled).toEqual([]);
  });

  it("switches back to the Card tab, expands the section and scrolls to it after a beat", () => {
    vi.useFakeTimers();
    const { rerender } = render(view(null, "resources"));
    expect(selectedTab()).toBe("Resources");

    rerender(view({ target: lifecycle, nonce: 5 }, "resources"));
    expect(selectedTab()).toBe("Card");
    expect(expandOnOf("sec-lifecycle")).toBe("5");
    expect(expandOnOf("sec-description")).toBe("undefined");
    expect(expandOnOf("sec-tags")).toBe("undefined");
    expect(expandOnOf("sec-relations")).toBe("undefined");
    expect(expandOnOf("sec-custom-Cost Data")).toBe("undefined");

    // The tab has to mount (and the section start to open) before the scroll.
    act(() => vi.advanceTimersByTime(249));
    expect(scrolled).toEqual([]);
    act(() => vi.advanceTimersByTime(1));
    expect(scrolled).toEqual(["card-section-lifecycle"]);
    expect(scrollArgs).toEqual([{ behavior: "smooth", block: "start" }]);
  });

  it("acts once per nonce: the same jump again does nothing, a new one acts again", () => {
    vi.useFakeTimers();
    const { rerender } = render(view({ target: lifecycle, nonce: 1 }));
    act(() => vi.advanceTimersByTime(250));
    expect(scrolled).toHaveLength(1);

    rerender(view({ target: { ...lifecycle }, nonce: 1 }));
    act(() => vi.advanceTimersByTime(500));
    expect(scrolled).toHaveLength(1);
    expect(expandOnOf("sec-lifecycle")).toBe("1");

    rerender(view({ target: lifecycle, nonce: 2 }));
    expect(expandOnOf("sec-lifecycle")).toBe("2");
    act(() => vi.advanceTimersByTime(250));
    expect(scrolled).toHaveLength(2);
  });

  it("scrolls to a relation group, expanding the Relations section", () => {
    vi.useFakeTimers();
    render(
      view({
        target: {
          tab: "card",
          anchor: "card-relation-relShown-source",
          sectionAnchor: "card-section-relations",
        },
        nonce: 3,
      }),
    );
    expect(expandOnOf("sec-relations")).toBe("3");
    act(() => vi.advanceTimersByTime(250));
    expect(scrolled).toEqual(["card-relation-relShown-source"]);
  });

  it("falls back to the section when the group is not rendered", () => {
    vi.useFakeTimers();
    render(
      view({
        target: {
          tab: "card",
          anchor: "card-relation-relMissing-target",
          sectionAnchor: "card-section-relations",
        },
        nonce: 4,
      }),
    );
    act(() => vi.advanceTimersByTime(250));
    expect(scrolled).toEqual(["card-section-relations"]);
  });

  it("expands an attribute section by its slugged name", () => {
    vi.useFakeTimers();
    render(
      view({
        target: {
          tab: "card",
          anchor: "card-section-custom-cost-data",
          sectionAnchor: "card-section-custom-cost-data",
        },
        nonce: 9,
      }),
    );
    expect(expandOnOf("sec-custom-Cost Data")).toBe("9");
    expect(expandOnOf("sec-lifecycle")).toBe("undefined");
    act(() => vi.advanceTimersByTime(250));
    expect(scrolled).toEqual(["card-section-custom-cost-data"]);
  });

  it("drops a pending scroll when it unmounts", () => {
    vi.useFakeTimers();
    const { unmount } = render(view({ target: lifecycle, nonce: 1 }));
    unmount();
    act(() => vi.advanceTimersByTime(1000));
    expect(scrolled).toEqual([]);
  });

  it("does nothing without a jump", async () => {
    render(view(null));
    await waitFor(() => expect(selectedTab()).toBe("Card"));
    expect(expandOnOf("sec-lifecycle")).toBe("undefined");
    expect(scrolled).toEqual([]);
  });
});
