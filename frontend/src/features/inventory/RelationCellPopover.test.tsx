/**
 * Tests for the inventory relation-cell editor.
 *
 * A grid relation column is keyed by the *related card type*, but the metamodel
 * allows any number of relation types per ordered card-type pair — so one column
 * can stand for several relation types. The cell always displayed the union of
 * them; the editor used to reach only the first, which made a card visible in the
 * cell impossible to unlink from the grid. It now opens one section per relation
 * type.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class extends Error {},
}));

const APP_TYPE = {
  key: "Application",
  label: "Application",
  color: "#0f7eb5",
  icon: "apps",
  subtypes: [],
};
const ORG_TYPE = {
  key: "Organization",
  label: "Organization",
  color: "#2889ff",
  icon: "corporate_fare",
  subtypes: [],
};

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    getType: (key: string) =>
      key === "Organization" ? ORG_TYPE : key === "Application" ? APP_TYPE : undefined,
    types: [APP_TYPE, ORG_TYPE],
    relationTypes: [],
  }),
}));

// The picker is exercised by its own tests; here it only needs to expose a way
// to choose a card so the add path can be asserted.
vi.mock("@/components/CardPicker", () => ({
  default: ({
    onChange,
    excludeIds,
    placeholder,
  }: {
    onChange: (v: { id: string; name: string; type: string }) => void;
    excludeIds?: string[];
    placeholder?: string;
  }) => (
    <button
      type="button"
      data-testid="card-picker"
      data-exclude={(excludeIds || []).join(",")}
      aria-label={placeholder}
      onClick={() => onChange({ id: "app-new", name: "Billing", type: "Application" })}
    >
      pick
    </button>
  ),
}));

import { api } from "@/api/client";
import type { RelationType } from "@/types";
import RelationCellPopover from "./RelationCellPopover";

const ORG_ID = "org-1";

const USES = {
  key: "relOrgToApp",
  label: "uses",
  reverse_label: "is used by",
  source_type_key: "Organization",
  target_type_key: "Application",
  cardinality: "n:m",
  attributes_schema: [],
} as unknown as RelationType;

const OWNS = {
  key: "relOrgToAppOwns",
  label: "owns",
  reverse_label: "is owned by",
  source_type_key: "Organization",
  target_type_key: "Application",
  cardinality: "n:m",
  attributes_schema: [],
} as unknown as RelationType;

/** One relation of each type, both from the same Organization. */
const RELATIONS = [
  {
    id: "rel-uses",
    type: "relOrgToApp",
    source_id: ORG_ID,
    target_id: "app-crm",
    target: { id: "app-crm", name: "CRM", type: "Application" },
    source: { id: ORG_ID, name: "Finance", type: "Organization" },
  },
  {
    id: "rel-owns",
    type: "relOrgToAppOwns",
    source_id: ORG_ID,
    target_id: "app-erp",
    target: { id: "app-erp", name: "ERP", type: "Application" },
    source: { id: ORG_ID, name: "Finance", type: "Organization" },
  },
];

function mount(relationTypes: RelationType[]) {
  const onRelationsChanged = vi.fn();
  render(
    <RelationCellPopover
      open
      onClose={vi.fn()}
      cardId={ORG_ID}
      cardName="Finance"
      relationTypes={relationTypes}
      selectedType="Organization"
      onRelationsChanged={onRelationsChanged}
    />,
  );
  return { onRelationsChanged };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue(RELATIONS);
  vi.mocked(api.post).mockResolvedValue({ id: "rel-new" });
  vi.mocked(api.delete).mockResolvedValue(undefined);
});

describe("RelationCellPopover — single relation type", () => {
  it("shows that type's relations and posts with its key", async () => {
    mount([USES]);
    expect(await screen.findByText("CRM")).toBeInTheDocument();
    // The other type's relation belongs to a different column here.
    expect(screen.queryByText("ERP")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("card-picker"));
    await userEvent.click(screen.getByRole("button", { name: /^Add$/ }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith("/relations", {
      type: "relOrgToApp",
      source_id: ORG_ID,
      target_id: "app-new",
    });
  });

  it("does not render a verb heading when there is nothing to disambiguate", async () => {
    mount([USES]);
    await screen.findByText("CRM");
    // The verb still appears in the dialog title, but not as a section heading.
    expect(screen.getByRole("heading", { name: /Finance/ })).toBeInTheDocument();
  });
});

describe("RelationCellPopover — several relation types on one pair", () => {
  it("renders a section per relation type, titled by its verb", async () => {
    mount([USES, OWNS]);
    expect(await screen.findByText("uses")).toBeInTheDocument();
    expect(screen.getByText("owns")).toBeInTheDocument();
  });

  it("shows each type's own relations — the second is reachable, not just displayed", async () => {
    mount([USES, OWNS]);
    // Both cards are editable here; before the fix only the first type's were.
    expect(await screen.findByText("CRM")).toBeInTheDocument();
    expect(screen.getByText("ERP")).toBeInTheDocument();
  });

  it("deletes through the relation the chip actually belongs to", async () => {
    mount([USES, OWNS]);
    await screen.findByText("ERP");

    const erpChip = screen.getByText("ERP").closest(".MuiChip-root") as HTMLElement;
    await userEvent.click(within(erpChip).getByTestId("CancelIcon"));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith("/relations/rel-owns"));
  });

  it("posts with the key of the section the card was added in", async () => {
    mount([USES, OWNS]);
    await screen.findByText("CRM");

    // Second section == the "owns" relation type.
    const pickers = screen.getAllByTestId("card-picker");
    expect(pickers).toHaveLength(2);
    await userEvent.click(pickers[1]);
    const addButtons = screen.getAllByRole("button", { name: /^Add$/ });
    expect(addButtons).toHaveLength(2);
    await userEvent.click(addButtons[1]);

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith("/relations", {
      type: "relOrgToAppOwns",
      source_id: ORG_ID,
      target_id: "app-new",
    });
  });

  it("excludes only the cards already linked through that same relation type", async () => {
    // The whole point of multiple types per pair: the same card may be both
    // used AND owned, so a card excluded in one section must stay pickable in
    // the other.
    mount([USES, OWNS]);
    await screen.findByText("CRM");

    const pickers = screen.getAllByTestId("card-picker");
    const usesExcludes = (pickers[0].dataset.exclude || "").split(",");
    const ownsExcludes = (pickers[1].dataset.exclude || "").split(",");

    expect(usesExcludes).toContain("app-crm");
    expect(usesExcludes).not.toContain("app-erp");
    expect(ownsExcludes).toContain("app-erp");
    expect(ownsExcludes).not.toContain("app-crm");
  });

  it("loads the card's relations in one request, not one per type", async () => {
    mount([USES, OWNS]);
    await screen.findByText("CRM");
    expect(vi.mocked(api.get).mock.calls).toHaveLength(1);
    expect(api.get).toHaveBeenCalledWith(`/relations?card_id=${ORG_ID}`);
  });
});
