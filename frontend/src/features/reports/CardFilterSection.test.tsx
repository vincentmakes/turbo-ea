import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import CardFilterSection, { type CardFilterSectionProps } from "./CardFilterSection";
import { EMPTY_CARD_FILTERS, type RelationFilterOption } from "./cardFilters";

const relation = (typeKey: string, hierarchical = false): RelationFilterOption => ({
  typeKey,
  label: typeKey,
  icon: "link",
  hierarchical,
  options: [{ key: `${typeKey}-1`, label: `${typeKey} One` }],
});

function renderSection(over: Partial<CardFilterSectionProps> = {}) {
  const props: CardFilterSectionProps = {
    label: "Application Filters",
    collapsed: false,
    onToggle: vi.fn(),
    value: EMPTY_CARD_FILTERS,
    onChange: vi.fn(),
    relationOptions: [],
    tagGroups: [],
    subtypeOptions: [],
    fields: [],
    relSubtypes: [],
    onClearAll: vi.fn(),
    ...over,
  };
  render(<CardFilterSection {...props} />);
  return props;
}

const facet = (name: string) => screen.queryByRole("combobox", { name });

describe("CardFilterSection", () => {
  it("renders a row per kind of filter the type offers", () => {
    renderSection({
      relationOptions: [relation("Organization")],
      tagGroups: [{ id: "g", name: "Origin", mode: "multi", tags: [{ id: "t", name: "In-house" }] }],
      subtypeOptions: [{ key: "saas", label: "SaaS" }],
      fields: [{ key: "fit", label: "Fit", type: "single_select", options: [{ key: "good", label: "Good" }] }],
      relSubtypes: [
        {
          composite: "r::usage",
          relTypeKey: "r",
          fieldKey: "usage",
          relatedTypeKey: "Organization",
          comboLabel: "uses · Usage",
          options: [{ key: "owner", label: "Owner" }],
        },
      ],
    });
    // "Tags" is the row's title and the picker's label.
    for (const row of ["Related By", "Tags", "Fields", "Relation Subtypes"]) {
      expect(screen.getAllByText(row).length).toBeGreaterThan(0);
    }
    for (const name of ["Organization", "Subtype", "Fit", "uses · Usage"]) expect(facet(name)).toBeInTheDocument();
  });

  it("reports a tag pick as the new tag list", () => {
    const value = { ...EMPTY_CARD_FILTERS, tagFilterIds: ["t1"] };
    const props = renderSection({
      value,
      tagGroups: [
        { id: "g", name: "Origin", mode: "multi", tags: [{ id: "t1", name: "In-house" }, { id: "t2", name: "Bought" }] },
      ],
    });
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Tags" }));
    fireEvent.click(within(screen.getByRole("listbox")).getByText("Bought"));
    expect(props.onChange).toHaveBeenLastCalledWith({ ...value, tagFilterIds: ["t1", "t2"] });
  });

  it("reports a field pick under the field's key", () => {
    const props = renderSection({
      fields: [{ key: "fit", label: "Fit", type: "single_select", options: [{ key: "good", label: "Good" }] }],
    });
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Fit" }));
    fireEvent.click(within(screen.getByRole("listbox")).getByText("Good"));
    expect(props.onChange).toHaveBeenLastCalledWith({ ...EMPTY_CARD_FILTERS, attrFilters: { fit: ["good"] } });
  });

  it("renders no empty rows", () => {
    renderSection();
    for (const row of ["Related By", "Tags", "Fields", "Relation Subtypes"]) {
      expect(screen.queryByText(row)).not.toBeInTheDocument();
    }
  });

  it("offers Include sub-cards only when a related type has a hierarchy", () => {
    renderSection({ relationOptions: [relation("Organization")] });
    expect(screen.queryByRole("checkbox", { name: "Include sub-cards" })).not.toBeInTheDocument();
  });

  it("toggles Include sub-cards without touching the picks", () => {
    const value = { ...EMPTY_CARD_FILTERS, relationFilters: { BusinessCapability: ["x"] } };
    const props = renderSection({ value, relationOptions: [relation("BusinessCapability", true)] });
    const toggle = screen.getByRole("checkbox", { name: "Include sub-cards" });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(props.onChange).toHaveBeenCalledWith({ ...value, includeDescendants: true });
  });

  it("folds relation facets past two behind a More chip", () => {
    renderSection({ relationOptions: ["A", "B", "C", "D"].map((k) => relation(k)) });
    expect(facet("C")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("2 more"));
    expect(facet("D")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Less"));
    expect(facet("D")).not.toBeInTheDocument();
  });

  it("counts the picks and clears them, a search alone included", () => {
    const value = { ...EMPTY_CARD_FILTERS, subtypeFilters: ["saas"], tagFilterIds: ["t1", "t2"] };
    const props = renderSection({ value, subtypeOptions: [{ key: "saas", label: "SaaS" }] });
    const header = screen.getByRole("button", { name: /Application Filters/ });
    expect(within(header).getByText("3")).toBeInTheDocument();
    const clearChip = screen.getByText("Clear all").closest(".MuiChip-root") as HTMLElement;
    fireEvent.click(within(clearChip).getByTestId("CancelIcon"));
    expect(props.onClearAll).toHaveBeenCalledTimes(1);
  });

  it("offers Clear all for a search with no picks", () => {
    renderSection({ search: "erp" });
    expect(screen.getByText("Clear all")).toBeInTheDocument();
  });

  it("hides Clear all when nothing narrows the cards", () => {
    renderSection({ value: { ...EMPTY_CARD_FILTERS, includeDescendants: true } });
    expect(screen.queryByText("Clear all")).not.toBeInTheDocument();
  });

  it("explains instead of offering rows when the filters cannot apply", () => {
    renderSection({ relationOptions: [relation("Organization")], disabledReason: "Pick a type first" });
    expect(screen.getByText("Pick a type first")).toBeInTheDocument();
    expect(screen.queryByText("Related By")).not.toBeInTheDocument();
  });
});
