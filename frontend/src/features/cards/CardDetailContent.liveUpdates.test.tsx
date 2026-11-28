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
/** The relation write the Relations stub has out: settle it from the test. */
const relationWrite = vi.hoisted(() => ({
  resolve: null as null | ((v: unknown) => void),
  reject: null as null | ((e: unknown) => void),
}));
vi.mock("@/features/cards/sections", async () => {
  const { useTrackOwnCardWrite } = await import("@/features/cards/ownCardWrite");
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
    HierarchySection: ({ refreshKey }: { refreshKey?: number }) => (
      <div data-testid="hierarchy-section" data-refresh={refreshKey} />
    ),
    SuccessorsSection: ({ refreshKey }: { refreshKey?: number }) => (
      <div data-testid="successors-section" data-refresh={refreshKey} />
    ),
    // Like the real one: a pick in the add dialog writes the relation at once
    // (through the own-write tracker) and refreshes the card only on close.
    RelationsSection: function RelationsStub({
      refreshKey,
      onCardUpdate,
    }: {
      refreshKey?: number;
      onCardUpdate?: () => void;
    }) {
      const trackOwnWrite = useTrackOwnCardWrite();
      const pick = () => {
        void trackOwnWrite(
          () =>
            new Promise((resolve, reject) => {
              relationWrite.resolve = resolve;
              relationWrite.reject = reject;
            }),
        ).catch(() => {});
      };
      return (
        <div data-testid="relations-section" data-refresh={refreshKey}>
          <button onClick={pick}>pick relation</button>
          <button onClick={() => onCardUpdate?.()}>close add dialog</button>
        </div>
      );
    },
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
import {
  isLiveCardUpdate,
  useSaveOrigin,
  useScoreGain,
} from "@/features/cards/gamification/useScoreGain";
import { LIVE_RETRY_DELAYS_MS, OWN_WRITE_GRACE_MS } from "@/features/cards/useLiveCardUpdates";
import { emitEvent, hookState } from "@/test/hooks";
import type { Card, LiveCardUpdates } from "@/types";
import CardDetailContent from "./CardDetailContent";

const APP_TYPE = {
  key: "Application",
  label: "Application",
  icon: "apps",
  color: "#0f7eb5",
  has_hierarchy: true,
  has_successors: true,
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
  act(() => emitEvent({ event: "event.stream.hello", stream_id: streamId, watch_ttl_seconds: 300 }));
}
/**
 * Hello, registration, and the one catch-up read the first registration
 * brings (the page read the card before the watch existed) — consumed, so a
 * test starts from a watched card with no read counted.
 */
async function watching(onCardUpdate?: ReturnType<typeof vi.fn>) {
  hello();
  await advance(0);
  await advance(400);
  vi.mocked(api.get).mockClear();
  onCardUpdate?.mockClear();
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
    expires_in: 300,
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

  it("re-reads once when the watch is first registered, silently", async () => {
    // A change committed between the page's own read and the registration
    // pinged nobody: the first registration catches up.
    const { onCardUpdate } = renderContent();
    hello();
    await advance(0);
    expect(cardReads()).toBe(0);
    await advance(400);
    expect(cardReads()).toBe(1);
    expect(onCardUpdate).toHaveBeenCalledWith(fresh);
    expect(isLiveCardUpdate(onCardUpdate.mock.calls[0][0])).toBe(true);
    // Once: later refreshes of the watch read nothing.
    await advance(300_000);
    expect(cardReads()).toBe(1);
  });

  it("re-reads the card once after the debounce and reloads the lists hanging off it", async () => {
    const { onCardUpdate } = renderContent();
    await watching(onCardUpdate);
    const before = {
      relations: Number(refreshOf("relations-section")),
      lifecycles: Number(refreshOf("relation-lifecycles-panel")),
      hierarchy: Number(refreshOf("hierarchy-section")),
      successors: Number(refreshOf("successors-section")),
    };

    ping();
    await advance(399);
    expect(cardReads()).toBe(0);
    await advance(1);
    expect(cardReads()).toBe(1);
    expect(onCardUpdate).toHaveBeenCalledTimes(1);
    expect(onCardUpdate).toHaveBeenCalledWith(fresh);
    // Marked, so the host's score-gain animation treats it as a new baseline.
    expect(isLiveCardUpdate(onCardUpdate.mock.calls[0][0])).toBe(true);
    expect(Number(refreshOf("relations-section"))).toBe(before.relations + 1);
    expect(Number(refreshOf("relation-lifecycles-panel"))).toBe(before.lifecycles + 1);
    expect(Number(refreshOf("hierarchy-section"))).toBe(before.hierarchy + 1);
    expect(Number(refreshOf("successors-section"))).toBe(before.successors + 1);
  });

  it("makes several pings within the window one read, at most 2 s after the first", async () => {
    renderContent();
    await watching();
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
    await watching();
    ping("card-2");
    await advance(5000);
    expect(cardReads()).toBe(0);
  });

  it("holds the re-read while a section is in edit mode, untouched, and runs it after", async () => {
    const { onCardUpdate } = renderContent();
    await watching(onCardUpdate);
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
    const { onCardUpdate } = renderContent();
    await watching(onCardUpdate);
    let answer: (c: Card) => void = () => {};
    vi.mocked(api.get).mockImplementation((path: string) =>
      path === "/cards/card-1" ? new Promise<Card>((r) => (answer = r)) : Promise.resolve([]),
    );
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
    // The held catch-up and the ping: one read.
    expect(cardReads()).toBe(1);
  });

  it("holds while the tab is hidden and runs when it is shown", async () => {
    renderContent();
    await watching();
    setHidden(true);
    ping();
    await advance(5000);
    expect(cardReads()).toBe(0);
    setHidden(false);
    await advance(0);
    expect(cardReads()).toBe(1);
  });

  it("stops watching the card after a 404, and reads nothing more", async () => {
    const { onCardUpdate } = renderContent();
    await watching(onCardUpdate);
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/cards/card-1") throw new ApiError("Not found", 404);
      return [];
    });
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

  it("retries a failed re-read after 1, 2 and 5 s, then waits for the next ping", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { onCardUpdate } = renderContent();
    await watching(onCardUpdate);
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/cards/card-1") throw new TypeError("Failed to fetch");
      return [];
    });
    expect([...LIVE_RETRY_DELAYS_MS]).toEqual([1000, 2000, 5000]);
    ping();
    await advance(400);
    expect(cardReads()).toBe(1);
    await advance(999);
    expect(cardReads()).toBe(1);
    await advance(1);
    expect(cardReads()).toBe(2);
    await advance(2000);
    expect(cardReads()).toBe(3);
    await advance(5000);
    expect(cardReads()).toBe(4);
    // Given up until something changes again.
    await advance(60_000);
    expect(cardReads()).toBe(4);
    expect(onCardUpdate).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    // The next ping reads again, and that works once the server does.
    vi.mocked(api.get).mockImplementation(async (path: string) =>
      path === "/cards/card-1" ? fresh : [],
    );
    ping();
    await advance(400);
    expect(cardReads()).toBe(5);
    expect(onCardUpdate).toHaveBeenCalledWith(fresh);
    errorSpy.mockRestore();
  });

  it("recovers from one failed re-read within a second", async () => {
    const { onCardUpdate } = renderContent();
    await watching(onCardUpdate);
    let reads = 0;
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path !== "/cards/card-1") return [];
      reads += 1;
      if (reads === 1) throw new ApiError("Boom", 500);
      return fresh;
    });
    ping();
    await advance(400);
    expect(onCardUpdate).not.toHaveBeenCalled();
    await advance(1000);
    expect(cardReads()).toBe(2);
    expect(onCardUpdate).toHaveBeenCalledWith(fresh);
  });

  it("cancels a waiting retry when the card closes", async () => {
    const { unmount } = render(
      <MemoryRouter>
        <CardDetailContent card={card} perms={perms} onCardUpdate={vi.fn()} showLdvSection={false} />
      </MemoryRouter>,
    );
    await watching();
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/cards/card-1") throw new ApiError("Boom", 503);
      return [];
    });
    ping();
    await advance(400);
    expect(cardReads()).toBe(1);
    unmount();
    await advance(10_000);
    expect(cardReads()).toBe(1);
  });

  it("never lets a read started before the viewer's own save land after it", async () => {
    const own = { ...card, description: "mine" } as unknown as Card;
    vi.mocked(api.patch).mockResolvedValue(own);
    const { onCardUpdate } = renderContent();
    await watching(onCardUpdate);
    let answer: (c: Card) => void = () => {};
    vi.mocked(api.get).mockImplementation((path: string) =>
      path === "/cards/card-1" ? new Promise<Card>((r) => (answer = r)) : Promise.resolve([]),
    );
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

  it("gives the host's own writes the same protection through liveUpdatesRef", async () => {
    const liveUpdatesRef = { current: null as LiveCardUpdates | null };
    const { onCardUpdate } = renderContent({ liveUpdatesRef });
    await watching(onCardUpdate);
    expect(liveUpdatesRef.current).not.toBeNull();
    let answer: (c: Card) => void = () => {};
    vi.mocked(api.get).mockImplementation((path: string) =>
      path === "/cards/card-1" ? new Promise<Card>((r) => (answer = r)) : Promise.resolve([]),
    );
    ping();
    await advance(400);
    const stale = answer;

    // The host renames the card while that read is out.
    const renamed = { ...card, name: "Renamed by me" } as unknown as Card;
    let saved: (c: Card) => void = () => {};
    let result: Promise<Card> = Promise.resolve(renamed);
    act(() => {
      result = liveUpdatesRef.current!.ownWrite(() => new Promise<Card>((r) => (saved = r)));
    });
    await act(async () => stale(card));
    expect(onCardUpdate).not.toHaveBeenCalled();
    // A ping while the host's write is out waits for it.
    vi.mocked(api.get).mockImplementation(async (path: string) =>
      path === "/cards/card-1" ? fresh : [],
    );
    ping();
    await advance(5000);
    expect(cardReads()).toBe(1);
    await act(async () => saved(renamed));
    await expect(result).resolves.toBe(renamed);
    await advance(399);
    expect(cardReads()).toBe(1);
    await advance(1);
    expect(cardReads()).toBe(2);
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

describe("CardDetailContent — live updates and the score gain", () => {
  /** A host shaped like the card page: it stores the card and plays gains. */
  function Host({
    gains,
    liveUpdatesRef,
  }: {
    gains: Array<{ delta: number; anchor: string | null }>;
    liveUpdatesRef?: { current: LiveCardUpdates | null };
  }) {
    const [shown, setShown] = React.useState<Card>(card);
    const [origin, reportOrigin] = useSaveOrigin();
    const gain = useScoreGain(shown.id, shown.data_quality, true, origin, isLiveCardUpdate(shown));
    const seen = React.useRef<number | null>(null);
    React.useEffect(() => {
      if (gain && gain.nonce !== seen.current) {
        seen.current = gain.nonce;
        gains.push({ delta: gain.delta, anchor: gain.originAnchor });
      }
    }, [gain, gains]);
    return (
      <MemoryRouter>
        <CardDetailContent
          card={shown}
          perms={perms}
          onCardUpdate={setShown}
          onSaveOrigin={reportOrigin}
          showLdvSection={false}
          liveUpdatesRef={liveUpdatesRef}
        />
      </MemoryRouter>
    );
  }

  const scored = (dq: number) => ({ ...card, data_quality: dq }) as unknown as Card;
  const serve = (dq: number) =>
    vi.mocked(api.get).mockImplementation(async (path: string) =>
      path === "/cards/card-1" ? scored(dq) : [],
    );
  async function commitRelation() {
    await act(async () => {
      relationWrite.resolve?.({});
    });
  }
  async function failRelation() {
    await act(async () => {
      relationWrite.reject?.(new Error("refused"));
    });
  }

  beforeEach(() => {
    relationWrite.resolve = null;
    relationWrite.reject = null;
  });

  it("plays the gain of a relation the viewer added exactly once, at the section", async () => {
    const gains: Array<{ delta: number; anchor: string | null }> = [];
    render(<Host gains={gains} />);
    serve(50);
    await watching();

    // The pick writes the relation; its ping's re-read wins the race against
    // the dialog's own refresh on close.
    fireEvent.click(screen.getByRole("button", { name: "pick relation" }));
    serve(70);
    await commitRelation();
    ping();
    await advance(400);
    expect(gains).toEqual([{ delta: 20, anchor: "card-section-relations" }]);

    // Closing the dialog refreshes the card: same score, no second gain.
    fireEvent.click(screen.getByRole("button", { name: "close add dialog" }));
    await advance(0);
    expect(gains).toHaveLength(1);
  });

  it("counts the own write's re-read even after an earlier ping's re-read landed during the write", async () => {
    const gains: Array<{ delta: number; anchor: string | null }> = [];
    render(<Host gains={gains} />);
    serve(50);
    await watching();

    fireEvent.click(screen.getByRole("button", { name: "pick relation" }));
    // A ping from before the write commits: its re-read is applied while the
    // write is out (and plays as own — nothing is consumed by it).
    serve(60);
    ping();
    await advance(400);
    expect(cardReads()).toBe(1);
    // The write commits; its own ping's re-read still counts as own.
    serve(80);
    await commitRelation();
    ping();
    await advance(400);
    expect(cardReads()).toBe(2);
    expect(gains.at(-1)).toEqual({ delta: 20, anchor: "card-section-relations" });
  });

  it("plays nothing when another user raised the score", async () => {
    const gains: Array<{ delta: number; anchor: string | null }> = [];
    render(<Host gains={gains} />);
    serve(50);
    await watching();
    serve(80);
    ping();
    await advance(400);
    expect(cardReads()).toBe(1);
    expect(gains).toEqual([]);
  });

  it("plays someone else's change silently after the viewer's write failed", async () => {
    const gains: Array<{ delta: number; anchor: string | null }> = [];
    render(<Host gains={gains} />);
    serve(50);
    await watching();
    fireEvent.click(screen.getByRole("button", { name: "pick relation" }));
    await failRelation();
    serve(80);
    ping();
    await advance(400);
    expect(cardReads()).toBe(1);
    expect(gains).toEqual([]);
  });

  it("plays someone else's change silently once the grace after an own write is over", async () => {
    const gains: Array<{ delta: number; anchor: string | null }> = [];
    render(<Host gains={gains} />);
    serve(50);
    await watching();
    fireEvent.click(screen.getByRole("button", { name: "pick relation" }));
    await commitRelation();
    expect(OWN_WRITE_GRACE_MS).toBe(5000);
    // The re-read's result is applied 400 ms after the ping: start the ping
    // just late enough for that to fall outside the grace window.
    await advance(OWN_WRITE_GRACE_MS - 399);
    serve(80);
    ping();
    await advance(400);
    expect(cardReads()).toBe(1);
    expect(gains).toEqual([]);
  });

  it("keeps a section's own write when a host write fails meanwhile", async () => {
    const gains: Array<{ delta: number; anchor: string | null }> = [];
    const liveUpdatesRef = { current: null as LiveCardUpdates | null };
    render(<Host gains={gains} liveUpdatesRef={liveUpdatesRef} />);
    serve(50);
    await watching();

    fireEvent.click(screen.getByRole("button", { name: "pick relation" }));
    // A rename fails while the relation write is still out...
    await act(async () => {
      await liveUpdatesRef
        .current!.ownWrite(() => Promise.reject(new Error("conflict")))
        .catch(() => {});
    });
    // ...and the relation then commits: its re-read is still the viewer's.
    serve(70);
    await commitRelation();
    ping();
    await advance(400);
    expect(gains).toEqual([{ delta: 20, anchor: "card-section-relations" }]);
  });

  it("keeps a just-succeeded section write when a host write fails right after", async () => {
    const gains: Array<{ delta: number; anchor: string | null }> = [];
    const liveUpdatesRef = { current: null as LiveCardUpdates | null };
    render(<Host gains={gains} liveUpdatesRef={liveUpdatesRef} />);
    serve(50);
    await watching();

    fireEvent.click(screen.getByRole("button", { name: "pick relation" }));
    await commitRelation();
    await act(async () => {
      await liveUpdatesRef
        .current!.ownWrite(() => Promise.reject(new Error("conflict")))
        .catch(() => {});
    });
    serve(70);
    ping();
    await advance(400);
    expect(gains).toEqual([{ delta: 20, anchor: "card-section-relations" }]);
  });
});
