/**
 * The Resources admin filter sidebar rendered on its own: the collapsed rail,
 * every section of the Filters tab, the Columns tab and the resize handle.
 *
 * Controlled component, so a harness holds the filters and the visible-column
 * set and records each change callback. `CardPicker` (a `/cards` search) and
 * `ColumnOrderSection` (a dnd-kit list) have their own tests and are stubbed.
 */
import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";

vi.mock("@/components/CardPicker", () => ({
  default: ({
    value,
    onChange,
  }: {
    value: { id: string; name: string } | null;
    onChange: (v: { id: string; name: string; type: string } | null) => void;
  }) => (
    <div>
      <span data-testid="picked-card">{value?.name ?? ""}</span>
      <button
        type="button"
        onClick={() => onChange({ id: "card-1", name: "ERP Core", type: "Application" })}
      >
        pick card
      </button>
      <button type="button" onClick={() => onChange(null)}>
        clear card
      </button>
    </div>
  ),
}));
vi.mock("@/components/grid/ColumnOrderSection", () => ({
  default: ({ onReset }: { onReset?: () => void }) => (
    <button type="button" data-testid="order-reset" onClick={onReset}>
      order reset
    </button>
  ),
}));

import ResourcesFilterSidebar, {
  EMPTY_RESOURCE_FILTERS,
  LOCKED_RESOURCE_COLUMNS,
  RESOURCE_GRID_COLUMNS,
  type FilterOption,
  type ResourceFilters,
} from "./ResourcesFilterSidebar";

const CARD_TYPE_OPTIONS: FilterOption[] = [
  { id: "Application", label: "Application", icon: "apps", color: "#0f7eb5" },
  { id: "ITComponent", label: "IT Component", color: "#d29270" },
  { id: "Other", label: "Other" },
];
const CATEGORY_OPTIONS: FilterOption[] = [{ id: "contract", label: "Contract", icon: "gavel" }];
const CREATOR_OPTIONS: FilterOption[] = [{ id: "u1", label: "Test Admin" }];
const ALL_COLUMNS = new Set(RESOURCE_GRID_COLUMNS.map((c) => c.id));

const spies = {
  filters: vi.fn<(f: ResourceFilters) => void>(),
  columns: vi.fn<(c: Set<string>) => void>(),
  collapse: vi.fn(),
  width: vi.fn<(w: number) => void>(),
  frozen: vi.fn<(id: string) => void>(),
  resetColumns: vi.fn(),
  order: vi.fn<(o: string[]) => void>(),
  resetOrder: vi.fn(),
};

function Harness({
  initialFilters = EMPTY_RESOURCE_FILTERS,
  initialColumns = ALL_COLUMNS,
  collapsed = false,
  frozen = new Set<string>(),
}: {
  initialFilters?: ResourceFilters;
  initialColumns?: Set<string>;
  collapsed?: boolean;
  frozen?: Set<string>;
}) {
  const [filters, setFilters] = useState(initialFilters);
  const [columns, setColumns] = useState(initialColumns);
  return (
    <ResourcesFilterSidebar
      filters={filters}
      onFiltersChange={(f) => {
        spies.filters(f);
        setFilters(f);
      }}
      collapsed={collapsed}
      onToggleCollapse={spies.collapse}
      width={300}
      onWidthChange={spies.width}
      visibleColumns={columns}
      onVisibleColumnsChange={(c) => {
        spies.columns(c);
        setColumns(c);
      }}
      frozenColumns={frozen}
      onToggleFrozen={spies.frozen}
      onResetColumns={spies.resetColumns}
      columnOrderItems={RESOURCE_GRID_COLUMNS.map((c) => ({ colId: c.id, label: c.id }))}
      columnOrder={RESOURCE_GRID_COLUMNS.map((c) => c.id)}
      onColumnOrderChange={spies.order}
      onResetColumnOrder={spies.resetOrder}
      cardTypeOptions={CARD_TYPE_OPTIONS}
      categoryOptions={CATEGORY_OPTIONS}
      creatorOptions={CREATOR_OPTIONS}
    />
  );
}

function lastFilters(): ResourceFilters {
  const calls = spies.filters.mock.calls;
  return calls[calls.length - 1][0];
}

/** The flex wrapper holding a column row and its freeze pin (a sibling, never a child). */
function rowWithPin(button: HTMLElement): HTMLElement {
  let el: HTMLElement | null = button;
  while (el && !el.querySelector("[aria-pressed]")) el = el.parentElement;
  if (!el) throw new Error("no freeze pin beside this row");
  return el;
}

function lastColumns(): Set<string> {
  const calls = spies.columns.mock.calls;
  return calls[calls.length - 1][0];
}

/** Section headers are plain boxes; the label text is the click target. */
async function openSection(user: UserEvent, label: string) {
  await user.click(screen.getByText(label));
}

beforeEach(() => {
  for (const spy of Object.values(spies)) spy.mockClear();
});

describe("ResourcesFilterSidebar rail", () => {
  it("collapses to a rail with the active-filter count and expands on click", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        collapsed
        initialFilters={{
          ...EMPTY_RESOURCE_FILTERS,
          search: "x",
          kinds: ["file"],
          createdBy: "u1",
          archived: "active",
          dateFrom: "2026-01-01",
        }}
      />,
    );

    expect(screen.getByText("5")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand filters" }));
    expect(spies.collapse).toHaveBeenCalledTimes(1);
  });
});

describe("ResourcesFilterSidebar filters", () => {
  it("edits and clears the search, and clears every filter at once", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.queryByRole("button", { name: /Clear filters/ })).not.toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("Name, card or URL…"), "spec");
    expect(lastFilters().search).toBe("spec");
    await user.click(screen.getByRole("button", { name: "close" }));
    expect(lastFilters().search).toBe("");

    await user.type(screen.getByPlaceholderText("Name, card or URL…"), "a");
    await user.click(screen.getByRole("button", { name: /Clear filters/ }));
    expect(lastFilters()).toEqual(EMPTY_RESOURCE_FILTERS);
  });

  it("toggles kinds, card types, categories and file types in their lists", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: /File/ }));
    expect(lastFilters().kinds).toEqual(["file"]);
    await user.click(screen.getByRole("button", { name: /Link/ }));
    expect(lastFilters().kinds).toEqual(["file", "link"]);
    await user.click(screen.getByRole("button", { name: /File/ }));
    expect(lastFilters().kinds).toEqual(["link"]);

    // Card-type rows carry the metamodel glyph, a dot, or nothing.
    await user.click(screen.getByRole("button", { name: /Application/ }));
    await user.click(screen.getByRole("button", { name: /IT Component/ }));
    await user.click(screen.getByRole("button", { name: /Other/ }));
    expect(lastFilters().cardTypes).toEqual(["Application", "ITComponent", "Other"]);

    await openSection(user, "Category / link type");
    await user.click(screen.getByRole("button", { name: /Contract/ }));
    expect(lastFilters().categories).toEqual(["contract"]);

    await openSection(user, "File type");
    await user.click(screen.getByRole("button", { name: /PDF/ }));
    expect(lastFilters().mimeTypes).toEqual(["application/pdf"]);
  });

  it("sets the card, creator, archived state and date range", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await openSection(user, "Card");
    await user.click(screen.getByRole("button", { name: "pick card" }));
    expect(lastFilters().card).toEqual({ id: "card-1", name: "ERP Core", type: "Application" });
    expect(screen.getByTestId("picked-card")).toHaveTextContent("ERP Core");
    await user.click(screen.getByRole("button", { name: "clear card" }));
    expect(lastFilters().card).toBeNull();

    await openSection(user, "Added by");
    await user.click(screen.getByRole("combobox"));
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByRole("option", { name: "Anyone" })).toBeInTheDocument();
    await user.click(within(listbox).getByRole("option", { name: "Test Admin" }));
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    expect(lastFilters().createdBy).toBe("u1");

    await openSection(user, "Archived cards");
    await user.click(screen.getByText("Archived"));
    expect(lastFilters().archived).toBe("archived");
    await user.click(screen.getByText("Active"));
    expect(lastFilters().archived).toBe("active");

    await openSection(user, "Date added");
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-01-01" } });
    expect(lastFilters().dateFrom).toBe("2026-01-01");
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-02-01" } });
    expect(lastFilters().dateTo).toBe("2026-02-01");
  });
});

describe("ResourcesFilterSidebar columns", () => {
  it("shows the count, selects all, toggles a column, keeps locked rows and freezes", async () => {
    const user = userEvent.setup();
    render(<Harness initialColumns={new Set([...LOCKED_RESOURCE_COLUMNS, "size"])} frozen={new Set(["name"])} />);

    await user.click(screen.getByRole("tab", { name: "Columns" }));
    expect(screen.getByText("5 selected")).toBeInTheDocument();

    // A locked row is a disabled `ListItemButton` (a div), so it reads as aria-disabled.
    const kind = screen.getByRole("button", { name: /Kind/ });
    expect(kind).toHaveAttribute("aria-disabled", "true");
    expect(within(kind).getByRole("checkbox")).toBeChecked();

    await user.click(screen.getByRole("button", { name: /Size/ }));
    expect(lastColumns().has("size")).toBe(false);
    await user.click(screen.getByRole("button", { name: /URL/ }));
    expect(lastColumns().has("url")).toBe(true);

    const nameRow = rowWithPin(screen.getByRole("button", { name: /Name/ }));
    await user.click(within(nameRow).getByRole("button", { name: "Unfreeze column" }));
    expect(spies.frozen).toHaveBeenLastCalledWith("name");

    await user.click(screen.getByRole("button", { name: /Reset/ }));
    expect(spies.resetColumns).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId("order-reset"));
    expect(spies.resetOrder).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /Select all/ }));
    expect(lastColumns()).toEqual(ALL_COLUMNS);
    expect(screen.getByRole("button", { name: /Select all/ })).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("button", { name: /Reset/ })).not.toBeInTheDocument();
  });
});

describe("ResourcesFilterSidebar resize", () => {
  it("drags the handle within the width bounds and stops on mouse up", () => {
    const { container } = render(<Harness />);
    const handle = container.firstElementChild?.lastElementChild as HTMLElement;

    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 150 });
    expect(spies.width).toHaveBeenLastCalledWith(350);
    fireEvent.mouseMove(document, { clientX: -900 });
    expect(spies.width).toHaveBeenLastCalledWith(220);
    fireEvent.mouseMove(document, { clientX: 900 });
    expect(spies.width).toHaveBeenLastCalledWith(480);

    fireEvent.mouseUp(document);
    spies.width.mockClear();
    fireEvent.mouseMove(document, { clientX: 400 });
    expect(spies.width).not.toHaveBeenCalled();
  });
});
