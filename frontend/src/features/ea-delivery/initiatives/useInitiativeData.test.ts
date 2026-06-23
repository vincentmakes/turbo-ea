import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { Card } from "@/types";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
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
