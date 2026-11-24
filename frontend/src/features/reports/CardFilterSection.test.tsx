import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { buildFilterCatalog } from "@/lib/fieldFilters";
import CardFilterSection, { type CardFilterSectionProps } from "./CardFilterSection";
import { EMPTY_CARD_FILTERS, clearCardFilterValues, type RelationFilterOption } from "./cardFilters";
import type { FieldDef, SectionDef } from "./portfolioHelpers";

/** A catalog with labels taken as they are. */
const catalogOf = (sections: SectionDef[]) =>
  buildFilterCatalog<FieldDef, FieldDef>(sections, {
    canViewCosts: false,
    sectionLabel: (s) => s.section,
    descriptionLabel: "Description",
    resolveField: (f) => f,
  });
const FIT: FieldDef = { key: "fit", label: "Fit", type: "single_select", options: [{ key: "good", label: "Good" }] };
const RISK: FieldDef = { key: "risk", label: "Risk", type: "single_select", options: [{ key: "high", label: "High" }] };

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
    catalog: [],
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
      catalog: catalogOf([{ section: "Main", fields: [FIT] }]),
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
    const props = renderSection({ catalog: catalogOf([{ section: "Main", fields: [FIT] }]) });
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
  describe("the Fields row and Add filter (#1425)", () => {
    const CATALOG = catalogOf([
      { section: "Main", fields: [FIT] },
      { section: "Compliance", hideInFilters: true, fields: [RISK] },
    ]);

    it("keeps a hidden section's field out of the row, behind Add filter", () => {
      const props = renderSection({ catalog: CATALOG });
      expect(facet("Fit")).toBeInTheDocument();
      expect(facet("Risk")).not.toBeInTheDocument();
      fireEvent.click(screen.getByText("Add filter"));
      fireEvent.click(screen.getByRole("option", { name: "Risk" }));
      expect(props.onChange).toHaveBeenLastCalledWith({ ...EMPTY_CARD_FILTERS, filterFields: ["risk"] });
    });

    it("shows a hidden section's field once added, with a remove button", () => {
      const value = { ...EMPTY_CARD_FILTERS, filterFields: ["risk"] };
      const props = renderSection({ catalog: CATALOG, value });
      expect(facet("Risk")).toBeInTheDocument();
      // Everything is shown, so nothing is left to add.
      expect(screen.queryByText("Add filter")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Remove the Risk filter" }));
      expect(props.onChange).toHaveBeenLastCalledWith({ ...EMPTY_CARD_FILTERS, filterFields: [] });
    });

    it("shows a hidden section's field that holds a value, without it being added", () => {
      renderSection({ catalog: CATALOG, value: { ...EMPTY_CARD_FILTERS, attrFilters: { risk: ["high"] } } });
      expect(facet("Risk")).toBeInTheDocument();
    });

    it("renders the Fields row for a catalog of hidden fields only, with just the chip", () => {
      renderSection({ catalog: catalogOf([{ section: "Compliance", hideInFilters: true, fields: [RISK] }]) });
      expect(screen.getByText("Fields")).toBeInTheDocument();
      expect(facet("Risk")).not.toBeInTheDocument();
      expect(screen.getByText("Add filter")).toBeInTheDocument();
    });

    it("keeps the subtype select first in the row", () => {
      renderSection({ catalog: CATALOG, subtypeOptions: [{ key: "saas", label: "SaaS" }] });
      const boxes = screen.getAllByRole("combobox");
      expect(boxes).toHaveLength(2);
      expect(boxes[0]).toBe(facet("Subtype"));
      expect(boxes[1]).toBe(facet("Fit"));
    });

    it("keeps the added rows through Clear all", () => {
      const value = {
        ...EMPTY_CARD_FILTERS,
        attrFilters: { risk: ["high"] },
        tagFilterIds: ["t"],
        includeDescendants: true,
        filterFields: ["risk"],
      };
      const props = renderSection({ catalog: CATALOG, value });
      const clearChip = screen.getByText("Clear all").closest(".MuiChip-root") as HTMLElement;
      fireEvent.click(within(clearChip).getByTestId("CancelIcon"));
      expect(props.onClearAll).toHaveBeenCalledTimes(1);
    });

    it("still shows an added row once its value is cleared by Clear all", () => {
      const value = { ...EMPTY_CARD_FILTERS, attrFilters: { risk: ["high"] }, filterFields: ["risk"] };
      // What the reports hand their setter on Clear all.
      renderSection({ catalog: CATALOG, value: clearCardFilterValues(value) });
      expect(facet("Risk")).toBeInTheDocument();
    });

    it("does not count the added fields", () => {
      renderSection({ catalog: CATALOG, value: { ...EMPTY_CARD_FILTERS, filterFields: ["risk"] } });
      expect(screen.queryByText("Clear all")).not.toBeInTheDocument();
    });
  });

  describe("text, number and date conditions (#1425)", () => {
    const CODE: FieldDef = { key: "code", label: "Code", type: "text" };
    const PRICE: FieldDef = { key: "price", label: "Price", type: "cost" };
    const CATALOG = catalogOf([{ section: "Main", fields: [FIT, CODE, PRICE] }]);

    it("counts a condition on a catalog field and offers Clear all", () => {
      const value = { ...EMPTY_CARD_FILTERS, attrConditions: { code: { contains: "ORG" } }, tagFilterIds: ["t"] };
      renderSection({ catalog: CATALOG, value });
      const header = screen.getByRole("button", { name: /Application Filters/ });
      expect(within(header).getByText("2")).toBeInTheDocument();
      expect(screen.getByText("Clear all")).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Code" })).toHaveValue("ORG");
    });

    it("neither counts nor shows a condition on a field out of the reader's catalog", () => {
      renderSection({ catalog: CATALOG, value: { ...EMPTY_CARD_FILTERS, attrConditions: { price: { min: 1 } } } });
      expect(screen.queryByText("Clear all")).not.toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "Price" })).not.toBeInTheDocument();
    });

    it("adds a text field and reports what is typed as a condition", () => {
      const props = renderSection({ catalog: CATALOG });
      fireEvent.click(screen.getByText("Add filter"));
      expect(screen.queryByRole("option", { name: "Price" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("option", { name: "Code" }));
      expect(props.onChange).toHaveBeenLastCalledWith({ ...EMPTY_CARD_FILTERS, filterFields: ["code"] });
    });
  });
});
