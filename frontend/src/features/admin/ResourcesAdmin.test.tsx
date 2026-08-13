import { describe, it, expect } from "vitest";
import { buildResourceFacetBindings } from "./ResourcesAdmin";
import { EMPTY_RESOURCE_FILTERS, type ResourceFilters } from "./ResourcesFilterSidebar";
import type { RepositoryResource } from "@/types";
import type { CellMenuContext } from "@/components/grid/useCellContextMenu";

const ROW = {
  id: "r1",
  kind: "file",
  card_id: "card-1",
  card_name: "NexaCore ERP",
  card_type: "Application",
  card_archived: false,
  name: "Architecture.pdf",
  category: "diagram",
  mime_type: "application/pdf",
  size: 1024,
  url: null,
  created_by: "user-7",
  creator_name: "Dana Lee",
  created_at: "2026-04-01T10:00:00Z",
} as RepositoryResource;

function harness(initial: Partial<ResourceFilters> = {}) {
  let filters: ResourceFilters = { ...EMPTY_RESOURCE_FILTERS, ...initial };
  const ref = {
    get current() {
      return filters;
    },
  };
  const bindings = buildResourceFacetBindings(ref, (fn) => {
    filters = fn(filters);
  });
  return { bindings, read: () => filters };
}

const ctx = (colId: string, filterValue: unknown, data: RepositoryResource = ROW) =>
  ({ colId, filterValue, data, displayValue: "", filterKind: "text" }) as CellMenuContext<
    RepositoryResource
  >;

describe("buildResourceFacetBindings", () => {
  it("binds only the columns that have a server-side facet", () => {
    const { bindings } = harness();
    expect(Object.keys(bindings).sort()).toEqual([
      "card_name",
      "card_type",
      "category",
      "creator_name",
      "kind",
      "mime_type",
      "name",
    ]);
    // No facet exists for these — the menu offers Copy value only.
    expect(bindings.size).toBeUndefined();
    expect(bindings.url).toBeUndefined();
    expect(bindings.created_at).toBeUndefined();
  });

  it("never writes a column filter — this grid filters server-side", () => {
    const { bindings } = harness();
    for (const binding of Object.values(bindings)) {
      expect(binding.columnFilter).toBe(false);
    }
  });

  it("maps multi-select facets from the raw cell value", () => {
    const { bindings, read } = harness();
    const c = ctx("mime_type", "application/pdf");
    expect(bindings.mime_type.toFacetValue(c)).toBe("application/pdf");
    bindings.mime_type.setValues(["application/pdf"], c);
    expect(read().mimeTypes).toEqual(["application/pdf"]);
    expect(bindings.mime_type.getValues()).toEqual(["application/pdf"]);
    bindings.mime_type.setValues([], c);
    expect(read().mimeTypes).toEqual([]);
  });

  it("maps the uploader column onto the creator id, not the display name", () => {
    const { bindings, read } = harness();
    const c = ctx("creator_name", "Dana Lee");
    expect(bindings.creator_name.toFacetValue(c)).toBe("user-7");
    bindings.creator_name.setValues(["user-7"], c);
    expect(read().createdBy).toBe("user-7");
    expect(bindings.creator_name.getValues()).toEqual(["user-7"]);
    bindings.creator_name.setValues([], c);
    expect(read().createdBy).toBe("");
  });

  it("builds the card facet's full option from the clicked row", () => {
    const { bindings, read } = harness();
    const c = ctx("card_name", "NexaCore ERP");
    expect(bindings.card_name.toFacetValue(c)).toBe("card-1");
    bindings.card_name.setValues(["card-1"], c);
    expect(read().card).toEqual({ id: "card-1", name: "NexaCore ERP", type: "Application" });
    expect(bindings.card_name.getValues()).toEqual(["card-1"]);
    bindings.card_name.setValues([], c);
    expect(read().card).toBeNull();
  });

  it("routes the name column into the search box", () => {
    const { bindings, read } = harness();
    const c = ctx("name", "Architecture.pdf");
    bindings.name.setValues(["Architecture.pdf"], c);
    expect(read().search).toBe("Architecture.pdf");
    expect(bindings.name.getValues()).toEqual(["Architecture.pdf"]);
  });

  it("does not mirror a blank category", () => {
    const { bindings } = harness();
    expect(bindings.category.toFacetValue(ctx("category", null))).toBeNull();
    expect(bindings.category.toFacetValue(ctx("category", "diagram"))).toBe("diagram");
  });
});
