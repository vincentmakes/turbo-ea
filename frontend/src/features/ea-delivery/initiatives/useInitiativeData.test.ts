import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { Card } from "@/types";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// The signed-in role's app-level permissions; the wildcard unless a test narrows it.
const auth = vi.hoisted(() => ({ permissions: { "*": true } as Record<string, boolean> }));
vi.mock("@/hooks/AuthContext", () => ({
  useAuthContext: () => ({ user: { id: "u1", permissions: auth.permissions } }),
}));

import { api } from "@/api/client";
import { useInitiativeData } from "./useInitiativeData";

function makeInitiative(over: Partial<Card>): Card {
  return {
    id: over.id ?? "x",
    name: over.name ?? "Init",
    type: "Initiative",
    status: over.status ?? "ACTIVE",
    ...over,
  } as Card;
}

const ACTIVE = makeInitiative({ id: "a1", name: "Active One", status: "ACTIVE" });
const ARCHIVED = makeInitiative({ id: "z1", name: "Archived One", status: "ARCHIVED" });

function mockApi(initiatives: Card[]) {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url.startsWith("/cards")) {
      return Promise.resolve({ items: initiatives }) as never;
    }
    // /diagrams, /soaw, /adr all return arrays
    return Promise.resolve([]) as never;
  });
}

function cardCalls() {
  return vi
    .mocked(api.get)
    .mock.calls.filter((c) => String(c[0]).startsWith("/cards"));
}

describe("useInitiativeData", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    localStorage.clear();
    auth.permissions = { "*": true };
  });

  it("always fetches both ACTIVE and ARCHIVED initiatives regardless of status filter", async () => {
    // Persisted filter forces ARCHIVED on mount — the fetch must still ask for both.
    localStorage.setItem(
      "turboea-delivery-filters",
      JSON.stringify({ statusFilter: "ARCHIVED" }),
    );
    mockApi([ARCHIVED]);

    const { result } = renderHook(() => useInitiativeData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const calls = cardCalls();
    expect(calls).toHaveLength(1);
    expect(String(calls[0][0])).toContain("type=Initiative");
    expect(String(calls[0][0])).toContain("status=ACTIVE,ARCHIVED");
    expect(String(calls[0][0])).not.toMatch(/status=ARCHIVED(?!,|\w)/);
  });

  it("narrows filteredInitiatives by status client-side without trapping the user", async () => {
    // Install has an active initiative but no archived ones.
    mockApi([ACTIVE]);

    const { result } = renderHook(() => useInitiativeData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Default ACTIVE filter shows the active initiative.
    expect(result.current.statusFilter).toBe("ACTIVE");
    expect(result.current.initiatives).toHaveLength(1);
    expect(result.current.filteredInitiatives).toHaveLength(1);

    // Switching to ARCHIVED yields an empty *filtered* list, but `initiatives`
    // stays populated so the sidebar/filters remain mounted (issue #659).
    act(() => result.current.setStatusFilter("ARCHIVED"));
    await waitFor(() =>
      expect(result.current.filteredInitiatives).toHaveLength(0),
    );
    expect(result.current.initiatives).toHaveLength(1);

    // Changing the status filter must NOT trigger another network fetch.
    expect(cardCalls()).toHaveLength(1);

    // And the user can switch straight back to ACTIVE.
    act(() => result.current.setStatusFilter("ACTIVE"));
    await waitFor(() =>
      expect(result.current.filteredInitiatives).toHaveLength(1),
    );
    expect(cardCalls()).toHaveLength(1);
  });

  it("keeps both statuses available so an archived filter matches archived cards", async () => {
    mockApi([ACTIVE, ARCHIVED]);

    const { result } = renderHook(() => useInitiativeData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.initiatives).toHaveLength(2);
    expect(result.current.filteredInitiatives).toEqual([ACTIVE]);

    act(() => result.current.setStatusFilter("ARCHIVED"));
    await waitFor(() =>
      expect(result.current.filteredInitiatives).toEqual([ARCHIVED]),
    );
  });
});

describe("useInitiativeData — revisions", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    localStorage.clear();
    auth.permissions = { "*": true };
  });

  it("lists SoAWs and decisions without their earlier revisions", async () => {
    mockApi([ACTIVE]);
    const { result } = renderHook(() => useInitiativeData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const urls = vi.mocked(api.get).mock.calls.map((c) => c[0]);
    expect(urls).toContain("/soaw?include_earlier=false");
    expect(urls).toContain("/adr?include_earlier=false");
    expect(urls).not.toContain("/soaw");
    expect(urls).not.toContain("/adr");
  });
});

// Issue #1400: the page opens for a role that holds only one of the document
// permissions, so a list the role may not read must not be requested at all.
describe("useInitiativeData — what the role may read", () => {
  const SOAW = { id: "s1", name: "SoAW one", initiative_id: "a1" };
  const ADR = { id: "d1", title: "Decision one", linked_cards: [{ id: "a1", type: "Initiative" }] };
  const DIAGRAM = { id: "g1", name: "Diagram one", card_ids: ["a1"] };

  /** Every list answers, and the ones in `refused` answer as the API would: 403. */
  function mockLists(refused: string[] = []) {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (refused.some((prefix) => url.startsWith(prefix))) {
        return Promise.reject(new Error("Insufficient permissions")) as never;
      }
      if (url.startsWith("/cards")) return Promise.resolve({ items: [ACTIVE] }) as never;
      if (url.startsWith("/soaw")) return Promise.resolve([SOAW]) as never;
      if (url.startsWith("/adr")) return Promise.resolve([ADR]) as never;
      return Promise.resolve([DIAGRAM]) as never;
    });
  }

  const requested = () => vi.mocked(api.get).mock.calls.map((c) => String(c[0]));

  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    localStorage.clear();
    auth.permissions = { "*": true };
  });

  it("loads all three lists for a role that may read them all", async () => {
    mockLists();
    const { result } = renderHook(() => useInitiativeData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(requested()).toEqual([
      "/cards?type=Initiative&page_size=500&status=ACTIVE,ARCHIVED",
      "/diagrams",
      "/soaw?include_earlier=false",
      "/adr?include_earlier=false",
    ]);
    expect(result.current.diagrams).toEqual([DIAGRAM]);
    expect(result.current.soaws).toEqual([SOAW]);
    expect(result.current.adrs).toEqual([ADR]);
  });

  it("loads decisions alone for a decision reader, with no failed page", async () => {
    auth.permissions = { "adr.view": true, "adr.comment": true };
    mockLists(["/soaw", "/diagrams"]);
    const { result } = renderHook(() => useInitiativeData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(requested()).toEqual([
      "/cards?type=Initiative&page_size=500&status=ACTIVE,ARCHIVED",
      "/adr?include_earlier=false",
    ]);
    expect(result.current.error).toBe("");
    expect(result.current.adrs).toEqual([ADR]);
    expect(result.current.soaws).toEqual([]);
    expect(result.current.diagrams).toEqual([]);
    expect(result.current.tree[0].adrs).toEqual([ADR]);
  });

  it("loads SoAWs alone for a SoAW reader", async () => {
    auth.permissions = { "soaw.view": true };
    mockLists(["/adr", "/diagrams"]);
    const { result } = renderHook(() => useInitiativeData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(requested()).toEqual([
      "/cards?type=Initiative&page_size=500&status=ACTIVE,ARCHIVED",
      "/soaw?include_earlier=false",
    ]);
    expect(result.current.error).toBe("");
    expect(result.current.soaws).toEqual([SOAW]);
    expect(result.current.adrs).toEqual([]);
  });

  it("loads diagrams only with diagrams.view", async () => {
    auth.permissions = { "soaw.view": true, "adr.view": true, "diagrams.view": true };
    mockLists();
    const { result } = renderHook(() => useInitiativeData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(requested()).toContain("/diagrams");
    expect(result.current.diagrams).toEqual([DIAGRAM]);
  });
});
