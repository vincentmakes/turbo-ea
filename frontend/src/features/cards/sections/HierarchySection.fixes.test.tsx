/**
 * HierarchySection regression: the hierarchy is keyed on the card, so a late
 * reply for the card shown before must never replace the current card's tree
 * (nor its error the current card's tree).
 */
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

describe("HierarchySection — loading and errors", () => {
  it("shows a progress bar and no error while the hierarchy loads", async () => {
    const pending = deferred<HierarchyData>();
    mockApi.on("get", "/cards/b/hierarchy", () => pending.promise);
    renderWithProviders(<HierarchySection card={CARD_B} onUpdate={vi.fn()} />);
    await waitFor(() => expect(mockApi.callsOf("get", "/cards/b/hierarchy")).toHaveLength(1));

    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await act(async () => pending.resolve(B_TREE));
    expect(await screen.findByText("Company B1")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows a failed load's error, with no progress bar", async () => {
    mockApi.fail("get", "/cards/b/hierarchy", 500);
    renderWithProviders(<HierarchySection card={CARD_B} onUpdate={vi.fn()} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("GET /cards/b/hierarchy failed");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("re-reads the hierarchy from the alert's Retry button", async () => {
    mockApi.fail("get", "/cards/b/hierarchy", 500);
    const user = userEvent.setup();
    renderWithProviders(<HierarchySection card={CARD_B} onUpdate={vi.fn()} />);
    const alert = await screen.findByRole("alert");

    mockApi.on("get", "/cards/b/hierarchy", B_TREE);
    await user.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Company B1")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mockApi.callsOf("get", "/cards/b/hierarchy")).toHaveLength(2);
  });

  it("clears a failed removal's error once the parent is removed", async () => {
    mockApi.on("get", "/cards/b/hierarchy", B_TREE);
    mockApi.fail("patch", "/cards/b", 500);
    const onUpdate = vi.fn();
    const { user } = renderWithProviders(<HierarchySection card={CARD_B} onUpdate={onUpdate} />);
    await user.click(await screen.findByTitle("Remove parent"));
    expect(await screen.findByRole("alert")).toHaveTextContent("PATCH /cards/b failed");

    mockApi.on("patch", "/cards/b", {});
    await user.click(screen.getByTitle("Remove parent"));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
