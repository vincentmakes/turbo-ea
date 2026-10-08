/**
 * HierarchySection regression: the hierarchy is keyed on the card, so a late
 * reply for the card shown before must never replace the current card's tree
 * (nor its error the current card's tree).
 */
import { act, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { makeCardType } from "@/test/fixtures/metamodel";
import { renderWithProviders, wrapWithProviders } from "@/test/render";
import { HierarchySection } from "./index";
import type { Card, HierarchyData } from "@/types";

const ORG = makeCardType({
  key: "Organization",
  label: "Organization",
  icon: "corporate_fare",
  has_hierarchy: true,
});

const CARD_B = {
  id: "b",
  type: "Organization",
  name: "Company B",
  status: "ACTIVE",
  approval_status: "DRAFT",
  data_quality: 0,
} as unknown as Card;
const CARD_C = { ...CARD_B, id: "c", name: "Company C" } as unknown as Card;

const B_TREE: HierarchyData = {
  ancestors: [{ id: "a", name: "Company A", type: "Organization" }],
  children: [{ id: "b1", name: "Company B1", type: "Organization" }],
  level: 2,
} as HierarchyData;
const C_TREE: HierarchyData = {
  ancestors: [],
  children: [{ id: "c1", name: "Company C1", type: "Organization" }],
  level: 1,
} as HierarchyData;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  hookState.reset();
  mockApi.reset();
  withMetamodel([ORG]);
  mockApi.on("get", "/cards/c/hierarchy", C_TREE);
});

describe("HierarchySection — moving to another card", () => {
  it("ignores a late hierarchy for the card shown before", async () => {
    const late = deferred<HierarchyData>();
    mockApi.on("get", "/cards/b/hierarchy", () => late.promise);
    const { rerender } = renderWithProviders(<HierarchySection card={CARD_B} onUpdate={vi.fn()} />);
    await waitFor(() => expect(mockApi.callsOf("get", "/cards/b/hierarchy")).toHaveLength(1));

    rerender(wrapWithProviders(<HierarchySection card={CARD_C} onUpdate={vi.fn()} />));
    expect(await screen.findByText("Company C1")).toBeInTheDocument();

    await act(async () => late.resolve(B_TREE));
    expect(screen.queryByText("Company B1")).not.toBeInTheDocument();
    expect(screen.queryByText("Company A")).not.toBeInTheDocument();
    expect(screen.getByText("Company C1")).toBeInTheDocument();
    expect(screen.getByText("Level 1")).toBeInTheDocument();
  });

  it("ignores a late failure for the card shown before", async () => {
    const late = deferred<HierarchyData>();
    mockApi.on("get", "/cards/b/hierarchy", () => late.promise);
    const { rerender } = renderWithProviders(<HierarchySection card={CARD_B} onUpdate={vi.fn()} />);
    await waitFor(() => expect(mockApi.callsOf("get", "/cards/b/hierarchy")).toHaveLength(1));

    rerender(wrapWithProviders(<HierarchySection card={CARD_C} onUpdate={vi.fn()} />));
    expect(await screen.findByText("Company C1")).toBeInTheDocument();

    await act(async () => late.reject(new Error("Company B's tree failed")));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Company C1")).toBeInTheDocument();
  });
});
