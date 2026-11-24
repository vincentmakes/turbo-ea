/**
 * The rows of a web portal's Display configuration table, grouped: the
 * built-in properties, one group per metamodel section of the card type and
 * the relation types. A group's checkbox ticks or unticks every row of the
 * group in one column, so a type with many fields (an extension can add a
 * whole section) is configured section by section rather than row by row.
 *
 * Pure: the dialog resolves labels and passes them in.
 */

/** A column of the table that a toggle stores: the summary card or the expanded detail. */
export type DisplaySurface = "card" | "detail";

/** `card_config.toggles` as the dialog edits it. */
export type DisplayToggles = Record<string, { card: boolean; detail: boolean }>;

/** One row of the table. */
export interface DisplayRow {
  /** The `card_config.toggles` key: a built-in key, `field:<key>` or `rel:<key>`. */
  key: string;
  /** What the row shows. */
  label: string;
  /** A muted note after the label (a relation's verb). */
  hint?: string;
  /** Shown on the summary card / in the expanded detail while the row has no toggle. */
  defaultCard: boolean;
  defaultDetail: boolean;
  /** The visitor filter this row's checkbox writes, when the row can ever be one. */
  filterKey?: string;
}

/** One group of rows, under a header that ticks them all. */
export interface DisplayGroup {
  key: string;
  label: string;
  rows: DisplayRow[];
}

/** A row's name as a reader hears it: the label, and the hint in brackets. */
export function rowName(row: Pick<DisplayRow, "label" | "hint">): string {
  return row.hint ? `${row.label} (${row.hint})` : row.label;
}

/** The section that card detail folds into its Description section. */
const DESCRIPTION_SECTION = "__description";

/** How many fields, counted over the whole schema, the summary card shows by default. */
const FIELDS_ON_CARD_BY_DEFAULT = 3;

/** A `fields_schema` section, as much of it as the grouping reads. */
export interface DisplaySchemaSection<F> {
  section: string;
  fields: readonly F[];
  translations?: Record<string, string>;
}

export interface FieldGroupLabels<F> {
  /** A section's display label (its translation, else its name). */
  sectionLabel: (section: DisplaySchemaSection<F>) => string;
  /** The label of the `__description` section, which has no name of its own. */
  descriptionLabel: string;
  fieldLabel: (field: F) => string;
  /** Can the field ever be a visitor filter (`canBeVisitorFilter`). */
  canBeFilter: (field: F) => boolean;
}

/**
 * One group per section of `fields_schema` that holds a field, in schema
 * order. A field is on the summary card by default when it is among the
 * first three of the whole schema — the rule the portal applies to a field
 * with no toggle — and in the expanded detail always.
 */
export function fieldGroups<F extends { key: string }>(
  schema: readonly DisplaySchemaSection<F>[],
  labels: FieldGroupLabels<F>,
): DisplayGroup[] {
  const out: DisplayGroup[] = [];
  let position = 0;
  schema.forEach((section, index) => {
    const rows = section.fields.map((field): DisplayRow => {
      const key = `field:${field.key}`;
      const row: DisplayRow = {
        key,
        label: labels.fieldLabel(field),
        defaultCard: position < FIELDS_ON_CARD_BY_DEFAULT,
        defaultDetail: true,
        filterKey: labels.canBeFilter(field) ? key : undefined,
      };
      position += 1;
      return row;
    });
    if (rows.length === 0) return;
    out.push({
      key: `section:${index}`,
      label: section.section === DESCRIPTION_SECTION ? labels.descriptionLabel : labels.sectionLabel(section),
      rows,
    });
  });
  return out;
}

/** Is the row shown on `surface`: its toggle when it has one, else its default. */
export function rowChecked(
  toggles: Readonly<Record<string, { card?: boolean; detail?: boolean } | undefined>>,
  row: Pick<DisplayRow, "key" | "defaultCard" | "defaultDetail">,
  surface: DisplaySurface,
): boolean {
  const tog = toggles[row.key];
  if (tog) return tog[surface] === true;
  return surface === "card" ? row.defaultCard : row.defaultDetail;
}

/** A group checkbox's state over its rows' values: all ticked, some, or none. */
export function groupCheckState(values: readonly boolean[]): { checked: boolean; indeterminate: boolean } {
  const ticked = values.filter(Boolean).length;
  return {
    checked: ticked > 0 && ticked === values.length,
    indeterminate: ticked > 0 && ticked < values.length,
  };
}

/**
 * `toggles` with every row of `rows` shown or hidden on `surface`. Each row's
 * toggle is written whole, the other column kept at what it shows now
 * (its default included), as a click on the row's own checkbox does.
 */
export function setSurfaceForRows(
  toggles: Readonly<DisplayToggles>,
  rows: readonly Pick<DisplayRow, "key" | "defaultCard" | "defaultDetail">[],
  surface: DisplaySurface,
  value: boolean,
): DisplayToggles {
  const next: DisplayToggles = { ...toggles };
  for (const row of rows) {
    next[row.key] = {
      card: surface === "card" ? value : rowChecked(toggles, row, "card"),
      detail: surface === "detail" ? value : rowChecked(toggles, row, "detail"),
    };
  }
  return next;
}
