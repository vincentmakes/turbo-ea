/**
 * Live card updates: a "this card changed" ping on the event stream re-reads
 * the open card — once per burst, never under an open form, never in a hidden
 * tab, and never with the score-gain animation the viewer's own saves play.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return {
    api: { get: vi.fn(), put: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn() },
    ApiError,
    isAbortError: (e: unknown) => e instanceof Error && e.name === "AbortError",
    isAuthenticated: () => true,
  };
});
vi.mock("@/hooks/useEventStream", () => import("@/test/hooks").then((m) => m.useEventStreamModule()));
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
  useCardTabActivity: () => ({ hasUpdates: () => false, noteVisit: () => {} }),
}));
vi.mock("@/hooks/AuthContext", () => ({
  useOptionalAuthUser: () => null,
  useAuthContext: () => ({ user: { id: "u1", permissions: { "*": true } } }),
}));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ can: () => true }) }));

vi.mock("@/components/EolLinkSection", () => ({ default: () => null }));
vi.mock("@/features/bpm/ProcessFlowTab", () => ({ default: () => null }));
vi.mock("@/features/bpm/ProcessAssessmentPanel", () => ({ default: () => null }));
vi.mock("@/features/cards/sections/SoAWTab", () => ({ default: () => null }));

// Every section stubbed; the two that share relation dates expose their
// refresh wiring.
// Every section stubbed; the three with an edit mode expose it, and the two
// relation lists show their refresh key.
const editingCbs = vi.hoisted(() => ({} as Record<string, (editing: boolean) => void>));
vi.mock("@/features/cards/sections", async () => {
  const stub = () => null;
  const editable =
    (name: string) =>
    ({ onEditingChange }: { onEditingChange?: (editing: boolean) => void }) => {
      if (onEditingChange) editingCbs[name] = onEditingChange;
      return null;
    };
  return {
    AttributeSection: editable("attribute"),
    DescriptionSection: ({
      card,
      onSave,
      onEditingChange,
    }: {
      card: { name: string; data_quality: number };
      onSave: (u: Record<string, unknown>) => Promise<void>;
      onEditingChange?: (editing: boolean) => void;
    }) => {
      if (onEditingChange) editingCbs.description = onEditingChange;
      return (
        <div data-testid="description" data-name={card.name}>
          <button onClick={() => void onSave({ description: "mine" })}>save description</button>
        </div>
      );
    },
    LifecycleSection: ({
      footer,
      onEditingChange,
    }: {
      footer?: React.ReactNode;
      onEditingChange?: (editing: boolean) => void;
    }) => {
      if (onEditingChange) editingCbs.lifecycle = onEditingChange;
      return <div>{footer}</div>;
    },
    HierarchySection: stub,
    SuccessorsSection: stub,
    RelationsSection: ({ refreshKey }: { refreshKey?: number }) => (
      <div data-testid="relations-section" data-refresh={refreshKey} />
    ),
    LayeredDependencySection: stub,
    CommentsTab: stub,
    TodosTab: stub,
    StakeholdersTab: stub,
    ResourcesTab: stub,
    AdrsTab: stub,
    HistoryTab: stub,
    RisksTab: stub,
    ComplianceTab: stub,
    TagsSection: editable("tags"),
    DataQualityPill: stub,
  };
});

vi.mock("@/features/cards/sections/RelationLifecyclesPanel", () => ({
  default: ({ refreshKey }: { refreshKey?: number }) => (
    <div data-testid="relation-lifecycles-panel" data-refresh={refreshKey} />
  ),
}));

import { ApiError, api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { resetCardWatch } from "@/hooks/useCardWatch";
import { isLiveCardUpdate } from "@/features/cards/gamification/useScoreGain";
import { emitEvent, hookState } from "@/test/hooks";
import type { Card } from "@/types";
import CardDetailContent from "./CardDetailContent";

const APP_TYPE = {
  key: "Application",
  label: "Application",
  icon: "apps",
  color: "#0f7eb5",
  has_hierarchy: false,
  subtypes: [],
  fields_schema: [{ section: "Ownership", fields: [{ key: "owner", label: "Owner", type: "text" }] }],
  section_config: {},
};

const card = {
  id: "card-1",
  name: "My App",
  type: "Application",
  description: "",
  status: "ACTIVE",
  approval_status: "DRAFT",
  data_quality: 50,
  lifecycle: { active: "2024-01-01" },
  attributes: {},
  tags: [],
  stakeholders: [],
} as unknown as Card;

const perms = {
  can_view: true,
  can_edit: true,
  can_manage_relations: true,
} as unknown as Parameters<typeof CardDetailContent>[0]["perms"];

const fresh = { ...card, name: "Renamed elsewhere", data_quality: 90 } as unknown as Card;

function renderContent(props: Partial<Parameters<typeof CardDetailContent>[0]> = {}) {
  const onCardUpdate = vi.fn();
  const view = render(
    <MemoryRouter>
      <CardDetailContent
        card={card}
        perms={perms}
        onCardUpdate={onCardUpdate}
        showLdvSection={false}
        {...props}
      />
    </MemoryRouter>,
  );
  const rerender = (next: Partial<Parameters<typeof CardDetailContent>[0]>) =>
    view.rerender(
      <MemoryRouter>
        <CardDetailContent
          card={card}
          perms={perms}
          onCardUpdate={onCardUpdate}
          showLdvSection={false}
          {...props}
          {...next}
        />
      </MemoryRouter>,
    );
  return { onCardUpdate, rerender };
}

const cardReads = () =>
  vi.mocked(api.get).mock.calls.filter(([path]) => path === "/cards/card-1").length;
const refreshOf = (testId: string) => screen.getByTestId(testId).getAttribute("data-refresh");

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function hello(streamId = "s-1") {
  act(() => emitEvent({ event: "event.stream.hello", stream_id: streamId, watch_ttl_seconds: 1800 }));
}
function ping(cardId = "card-1") {
  act(() => emitEvent({ event: "event.stream.card_changed", card_id: cardId }));
}
function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  hookState.reset();
  resetCardWatch();
  for (const k of Object.keys(editingCbs)) delete editingCbs[k];
  vi.mocked(api.get).mockReset();
  vi.mocked(api.get).mockImplementation(async (path: string) =>
    path === "/cards/card-1" ? fresh : [],
  );
  vi.mocked(api.put).mockReset();
  vi.mocked(api.put).mockImplementation(async (_p: string, body?: unknown) => ({
    card_ids: (body as { card_ids: string[] }).card_ids,
    expires_in: 1800,
  }));
  vi.mocked(api.patch).mockReset();
  vi.mocked(useMetamodel).mockReturnValue({
    types: [APP_TYPE],
    relationTypes: [],
    loading: false,
    getType: (k: string) => (k === "Application" ? APP_TYPE : undefined),
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
  } as unknown as ReturnType<typeof useMetamodel>);
});

afterEach(() => {
  setHidden(false);
  vi.useRealTimers();
});

describe("CardDetailContent — live card updates", () => {
  it("watches the open card once the stream says hello", async () => {
    renderContent();
    await advance(0);
    expect(api.put).not.toHaveBeenCalled();
    hello();
    await advance(0);
    expect(api.put).toHaveBeenCalledWith("/events/stream/s-1/watch", { card_ids: ["card-1"] });
  });

  it("re-reads the card once after the debounce and reloads both relation lists", async () => {
    const { onCardUpdate } = renderContent();
    hello();
    await advance(0);
    expect(refreshOf("relations-section")).toBe("0");
    expect(refreshOf("relation-lifecycles-panel")).toBe("0");

    ping();
    await advance(399);
    expect(cardReads()).toBe(0);
    await advance(1);
    expect(cardReads()).toBe(1);
    expect(onCardUpdate).toHaveBeenCalledTimes(1);
    expect(onCardUpdate).toHaveBeenCalledWith(fresh);
    // Marked, so the host's score-gain animation treats it as a new baseline.
    expect(isLiveCardUpdate(onCardUpdate.mock.calls[0][0])).toBe(true);
    expect(refreshOf("relations-section")).toBe("1");
    expect(refreshOf("relation-lifecycles-panel")).toBe("1");
  });

  it("makes several pings within the window one read, at most 2 s after the first", async () => {
    renderContent();
    hello();
    await advance(0);
    ping();
    await advance(300);
    ping();
    await advance(300);
    ping();
    await advance(399);
    expect(cardReads()).toBe(0);
    await advance(1);
    expect(cardReads()).toBe(1);

    // A steady stream of pings still reads by the 2 s cap.
    for (let i = 0; i < 6; i += 1) {
      ping();
      await advance(300);
    }
    // 1800 ms in: no read yet; the next ping cannot push it past 2000 ms.
    expect(cardReads()).toBe(1);
    ping();
    await advance(200);
    expect(cardReads()).toBe(2);
  });

  it("ignores a ping for another card", async () => {
    renderContent();
    hello();
    await advance(0);
    ping("card-2");
    await advance(5000);
    expect(cardReads()).toBe(0);
  });

  it("holds the re-read while a section is in edit mode, untouched, and runs it after", async () => {
    const { onCardUpdate } = renderContent();
    hello();
    await advance(0);
    act(() => editingCbs.description(true));
    ping();
    await advance(5000);
    expect(cardReads()).toBe(0);
    expect(onCardUpdate).not.toHaveBeenCalled();

    // A second section opening and the first closing: still held.
    act(() => editingCbs.attribute(true));
    act(() => editingCbs.description(false));
    await advance(5000);
    expect(cardReads()).toBe(0);

    act(() => editingCbs.attribute(false));
    await advance(0);
    expect(cardReads()).toBe(1);
    expect(onCardUpdate).toHaveBeenCalledWith(fresh);
  });

  it("drops a read that lands while editing began, and reads again after", async () => {
    let answer: (c: Card) => void = () => {};
    vi.mocked(api.get).mockImplementation((path: string) =>
      path === "/cards/card-1" ? new Promise<Card>((r) => (answer = r)) : Promise.resolve([]),
    );
    const { onCardUpdate } = renderContent();
    hello();
    await advance(0);
    ping();
    await advance(400);
    expect(cardReads()).toBe(1);
    act(() => editingCbs.lifecycle(true));
    await act(async () => answer(fresh));
    expect(onCardUpdate).not.toHaveBeenCalled();

    vi.mocked(api.get).mockImplementation(async (path: string) =>
      path === "/cards/card-1" ? fresh : [],
    );
    act(() => editingCbs.lifecycle(false));
    await advance(0);
    expect(cardReads()).toBe(2);
    expect(onCardUpdate).toHaveBeenCalledTimes(1);
  });

  it("holds while the host pauses (its title editor) and runs when it resumes", async () => {
    const { rerender } = renderContent({ pauseLiveUpdates: true });
    hello();
    await advance(0);
    ping();
    await advance(5000);
    expect(cardReads()).toBe(0);
    rerender({ pauseLiveUpdates: false });
    await advance(0);
    expect(cardReads()).toBe(1);
  });

  it("holds while the tab is hidden and runs when it is shown", async () => {
    renderContent();
    hello();
    await advance(0);
    setHidden(true);
    ping();
    await advance(5000);
    expect(cardReads()).toBe(0);
    setHidden(false);
    await advance(0);
    expect(cardReads()).toBe(1);
  });

  it("stops watching the card after a 404, and reads nothing more", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/cards/card-1") throw new ApiError("Not found", 404);
      return [];
    });
    const { onCardUpdate } = renderContent();
    hello();
    await advance(0);
    ping();
    await advance(400);
    expect(cardReads()).toBe(1);
    await advance(0);
    expect(api.put).toHaveBeenLastCalledWith("/events/stream/s-1/watch", { card_ids: [] });

    ping();
    await advance(5000);
    expect(cardReads()).toBe(1);
    expect(onCardUpdate).not.toHaveBeenCalled();
  });

  it("swallows any other failure and keeps watching", async () => {
    let reads = 0;
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path !== "/cards/card-1") return [];
      reads += 1;
      if (reads === 1) throw new ApiError("Boom", 500);
      return fresh;
    });
    const { onCardUpdate } = renderContent();
    hello();
    await advance(0);
    ping();
    await advance(400);
    expect(cardReads()).toBe(1);
    expect(onCardUpdate).not.toHaveBeenCalled();
    ping();
    await advance(400);
    expect(cardReads()).toBe(2);
    expect(onCardUpdate).toHaveBeenCalledWith(fresh);
  });

  it("never lets a read started before the viewer's own save land after it", async () => {
    let answer: (c: Card) => void = () => {};
    vi.mocked(api.get).mockImplementation((path: string) =>
      path === "/cards/card-1" ? new Promise<Card>((r) => (answer = r)) : Promise.resolve([]),
    );
    const own = { ...card, description: "mine" } as unknown as Card;
    vi.mocked(api.patch).mockResolvedValue(own);
    const { onCardUpdate } = renderContent();
    hello();
    await advance(0);
    ping();
    await advance(400);
    expect(cardReads()).toBe(1);
    const stale = answer;

    // The viewer saves while that read is out.
    fireEvent.click(screen.getByRole("button", { name: "save description" }));
    await advance(0);
    expect(onCardUpdate).toHaveBeenLastCalledWith(own);
    // The old read answers late with the card as it was: dropped.
    await act(async () => stale(card));
    expect(onCardUpdate).toHaveBeenCalledTimes(1);
    // ...and asked again, after the save.
    vi.mocked(api.get).mockImplementation(async (path: string) =>
      path === "/cards/card-1" ? fresh : [],
    );
    await advance(400);
    expect(cardReads()).toBe(2);
    expect(onCardUpdate).toHaveBeenLastCalledWith(fresh);
  });

  it("does nothing at all without a hello (an older backend)", async () => {
    const { onCardUpdate } = renderContent();
    ping();
    act(() => emitEvent({ event: "card.updated", card_id: "card-1" }));
    await advance(10_000);
    expect(api.put).not.toHaveBeenCalled();
    expect(cardReads()).toBe(0);
    expect(onCardUpdate).not.toHaveBeenCalled();
  });
});
