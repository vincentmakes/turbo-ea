/**
 * PrinciplesPanel — the read-only GRC Governance → Principles list: active
 * principles only, in sort order, each numbered and carrying its reference.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import "@/i18n";
import { mockApi } from "@/test/apiMock";
import type { EAPrinciple } from "@/types";
import PrinciplesPanel from "./PrinciplesPanel";

const PATH = "/metamodel/principles";

const PRINCIPLES: EAPrinciple[] = [
  { id: "b", reference_number: "P-002", title: "Cloud first", is_active: true, sort_order: 20 },
  {
    id: "a",
    reference_number: "P-001",
    title: "Reuse first",
    description: "Prefer reuse",
    rationale: "Cheaper\n\nFaster",
    implications: "Check the catalogue",
    is_active: true,
    sort_order: 10,
  },
  { id: "c", reference_number: "P-003", title: "Retired", is_active: false, sort_order: 0 },
  { id: "d", reference_number: null, title: "Unnumbered", is_active: true, sort_order: 30 },
];

function card(title: string): HTMLElement {
  const el = screen.getByText(title).closest(".MuiCard-root");
  if (!(el instanceof HTMLElement)) throw new Error(`no card for ${title}`);
  return el;
}

beforeEach(() => {
  mockApi.reset();
});

describe("PrinciplesPanel", () => {
  it("lists the active principles in sort order with their number and reference", async () => {
    mockApi.on("get", PATH, PRINCIPLES);
    render(<PrinciplesPanel />);

    await screen.findByText("Reuse first");
    const titles = screen.getAllByRole("heading").map((h) => h.textContent);
    // The panel heading, then one title per active principle in sort order,
    // each followed by its reference.
    expect(titles).toEqual([
      "Architecture Principles",
      "Reuse firstP-001",
      "Cloud firstP-002",
      "Unnumbered",
    ]);
    expect(screen.queryByText("Retired")).not.toBeInTheDocument();

    const reuse = card("Reuse first");
    expect(within(reuse).getByText("1")).toBeInTheDocument();
    expect(within(reuse).getByText("P-001")).toBeInTheDocument();
    expect(within(reuse).getByText("Prefer reuse")).toBeInTheDocument();
    expect(within(reuse).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Cheaper",
      "Faster",
      "Check the catalogue",
    ]);

    const cloud = card("Cloud first");
    expect(within(cloud).getByText("2")).toBeInTheDocument();
    expect(within(cloud).getByText("P-002")).toBeInTheDocument();

    const unnumbered = card("Unnumbered");
    expect(within(unnumbered).getByText("3")).toBeInTheDocument();
    expect(within(unnumbered).queryByText(/^P-/)).not.toBeInTheDocument();
  });

  it("shows the empty state when no principle is active", async () => {
    mockApi.on("get", PATH, [PRINCIPLES[2]]);
    render(<PrinciplesPanel />);
    expect(await screen.findByText(/No active principles yet/)).toBeInTheDocument();
  });
});
