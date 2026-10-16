/**
 * HierarchySection — grouping the children by subtype (discussion #1269).
 *
 * The same rule and control as a relation group's subtype buckets (#792):
 * on by default once two real subtypes and at least eight children are
 * present, offered as a toggle whenever two real subtypes are, absent
 * otherwise; buckets in metamodel order with a trailing "No subtype" bucket
 * that also catches stale keys; each bucket collapsible on its own.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/components/CardPicker", () => ({ default: () => null }));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { makeCardType } from "@/test/fixtures/metamodel";
import { renderWithProviders } from "@/test/render";
import { HierarchySection } from "./index";
import type { Card, HierarchyData, HierarchyNode } from "@/types";

const ORG = makeCardType({
  key: "Organization",
  label: "Organization",
  icon: "corporate_fare",
  has_hierarchy: true,
  // Metamodel order: Region before Business Unit, the reverse of alphabetical.
  subtypes: [
    { key: "region", label: "Region" },
    { key: "businessUnit", label: "Business Unit", translations: { de: "Geschäftsbereich" } },
    { key: "team", label: "Team" },
  ],
  hierarchy_labels: [{ key: "owned", label: "Owned" }],
});

const CARD = {
  id: "b",
  type: "Organization",
  name: "Company B",
  status: "ACTIVE",
  approval_status: "DRAFT",
  data_quality: 0,
} as unknown as Card;

const child = (id: string, name: string, subtype?: string | null): HierarchyNode => ({
  id,
  name,
  type: "Organization",
  subtype,
});

function hierarchyOf(children: HierarchyNode[]): HierarchyData {
  return { ancestors: [], children, level: 1 } as HierarchyData;
}

// Eight children across two real subtypes, one unclassified and one carrying
// a key the metamodel no longer defines.
const MANY = hierarchyOf([
  child("c1", "Sales", "businessUnit"),
  child("c2", "Finance", "businessUnit"),
  child("c3", "Operations", "businessUnit"),
  child("c4", "EMEA", "region"),
  child("c5", "APAC", "region"),
  child("c6", "Americas", "region"),
  child("c7", "Shared Services", null),
  child("c8", "Legacy Unit", "retiredKey"),
]);

const FEW = hierarchyOf([
  child("c1", "Sales", "businessUnit"),
  child("c4", "EMEA", "region"),
  child("c7", "Shared Services"),
]);

function renderSection(data: HierarchyData, canEdit = true) {
  mockApi.on("get", "/cards/b/hierarchy", data);
  return renderWithProviders(
    <HierarchySection card={CARD} onUpdate={vi.fn()} canEdit={canEdit} />,
    { route: "/cards/b" },
  );
}

/** The bucket header buttons, in render order (not the section's own summary). */
const bucketHeaders = () =>
  screen
    .getAllByRole("button")
    .filter(
      (b) =>
        b.hasAttribute("aria-expanded") && !b.classList.contains("MuiAccordionSummary-root"),
    );

/** A header's label + count, without the chevron glyph's ligature text. */
const headerText = (h: HTMLElement) =>
  (h.textContent ?? "").replace(/^(expand_more|chevron_right)/, "");

beforeEach(() => {
  hookState.reset();
  mockApi.reset();
  withMetamodel([ORG]);
  mockApi.on("patch", /^\/cards\//, {});
});

describe("HierarchySection — subtype grouping", () => {
  it("groups a long, diverse child list by default, in metamodel order", async () => {
    renderSection(MANY);
    await screen.findByText("Sales");

    expect(bucketHeaders().map(headerText)).toEqual([
      "Region3",
      "Business Unit3",
      "No subtype2",
    ]);
    // Rows inside a bucket are alphabetical; the stale key lands in No subtype.
    const noSubtype = bucketHeaders()[2].parentElement as HTMLElement;
    const names = within(noSubtype)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(names[0]).toContain("Legacy Unit");
    expect(names[1]).toContain("Shared Services");
    expect(screen.getByRole("button", { name: "Show as flat list" })).toBeInTheDocument();
  });

  it("collapses one bucket without touching the others", async () => {
    const { user } = renderSection(MANY);
    await screen.findByText("Sales");

    const region = screen.getByRole("button", { name: /Region/ });
    expect(region).toHaveAttribute("aria-expanded", "true");
    await user.click(region);

    expect(region).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(screen.queryByText("EMEA")).not.toBeInTheDocument());
    expect(screen.getByText("Sales")).toBeInTheDocument();
    expect(screen.getByText("Shared Services")).toBeInTheDocument();
  });

  it("switches between the grouped and the flat list", async () => {
    const { user } = renderSection(MANY);
    await screen.findByText("Sales");

    await user.click(screen.getByRole("button", { name: "Show as flat list" }));
    expect(bucketHeaders()).toHaveLength(0);
    expect(screen.getAllByRole("listitem")).toHaveLength(8);

    await user.click(screen.getByRole("button", { name: "Group by subtype" }));
    expect(bucketHeaders()).toHaveLength(3);
  });

  it("keeps a short list flat but offers the toggle", async () => {
    const { user } = renderSection(FEW);
    await screen.findByText("Sales");

    expect(bucketHeaders()).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Group by subtype" }));
    expect(bucketHeaders().map(headerText)).toEqual([
      "Region1",
      "Business Unit1",
      "No subtype1",
    ]);
  });

  it("offers no toggle while only one real subtype is present", async () => {
    renderSection(
      hierarchyOf(
        Array.from({ length: 9 }, (_, i) => child(`c${i}`, `Unit ${i}`, i < 5 ? "team" : null)),
      ),
    );
    await screen.findByText("Unit 0");

    expect(bucketHeaders()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Group by subtype" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show as flat list" })).not.toBeInTheDocument();
  });

  it("offers no toggle when the type defines no subtypes", async () => {
    withMetamodel([{ ...ORG, subtypes: [] }]);
    renderSection(MANY);
    await screen.findByText("Sales");

    expect(bucketHeaders()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Group by subtype" })).not.toBeInTheDocument();
  });

  it("keeps each row's link type and unlink inside a bucket", async () => {
    const { user } = renderSection(MANY);
    await screen.findByText("Sales");

    const businessUnit = screen.getByRole("button", { name: /Business Unit/ })
      .parentElement as HTMLElement;
    const sales = within(businessUnit)
      .getAllByRole("listitem")
      .find((li) => li.textContent?.includes("Sales")) as HTMLElement;
    await user.click(within(sales).getByTitle("Remove from hierarchy"));

    await waitFor(() => expect(mockApi.callsOf("patch", "/cards/c1")).toHaveLength(1));
    expect(mockApi.callsOf("patch", "/cards/c1")[0].body).toEqual({ parent_id: null });
  });
});
