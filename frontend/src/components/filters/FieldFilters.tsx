import { useMemo } from "react";
import type { ReactNode } from "react";
import type { FacetFieldLike } from "@/lib/fieldFacets";
import {
  activeFieldKeys,
  addFilterField,
  addableFields,
  rowsToRender,
} from "@/lib/fieldFilters";
import type { FieldFilterState, FilterCatalog } from "@/lib/fieldFilters";
import AddFilterMenu from "./AddFilterMenu";
import FieldFilterControl from "./FieldFilterControl";

export interface FieldFiltersProps<F extends FacetFieldLike> {
  /** The card type's filter catalog (`buildFilterCatalog`). */
  catalog: FilterCatalog<F>;
  value: FieldFilterState;
  /** A change to the Fields row: values, added fields, or both at once. */
  onChange: (patch: Partial<FieldFilterState>) => void;
  /** Controls placed before the field rows (the subtype select). */
  children?: ReactNode;
  /**
   * Filters that always show, placed after the fields shown by default and
   * before the added ones (the portal's relation and tag filters), so the
   * added fields and the "Add filter" chip always come last.
   */
  fixed?: ReactNode;
}

/**
 * The body of a filter block's Fields row: the leading controls, the fields
 * shown by default, the `fixed` filters, the fields the person added (or
 * that hold a value — `rowsToRender`), then the "Add filter" chip, always
 * last and rendered only when the catalog has a field the row does not show
 * yet. Fully controlled: the block owns the value and its persistence.
 */
export default function FieldFilters<F extends FacetFieldLike>({
  catalog,
  value,
  onChange,
  children,
  fixed,
}: FieldFiltersProps<F>) {
  const rows = useMemo(
    () => rowsToRender(catalog, value.filterFields, activeFieldKeys(value)),
    [catalog, value],
  );
  const addable = useMemo(() => addableFields(catalog, rows), [catalog, rows]);

  return (
    <>
      {children}
      {rows
        .filter((row) => !row.removable)
        .map((row) => (
          <FieldFilterControl key={row.field.key} row={row} value={value} onChange={onChange} />
        ))}
      {fixed}
      {rows
        .filter((row) => row.removable)
        .map((row) => (
          <FieldFilterControl key={row.field.key} row={row} value={value} onChange={onChange} />
        ))}
      {addable.length > 0 && (
        <AddFilterMenu
          sections={addable}
          onAdd={(key) => onChange({ filterFields: addFilterField(value.filterFields, key) })}
        />
      )}
    </>
  );
}
