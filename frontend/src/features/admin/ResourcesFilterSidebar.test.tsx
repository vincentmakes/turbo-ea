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
    enabled,
    label,
  }: {
    value: { id: string; name: string } | null;
    onChange: (v: { id: string; name: string; type: string } | null) => void;
    enabled?: boolean;
    label?: string;
  }) => (
    <div>
      {/* `enabled` gates the real picker's `/cards` fetch. */}
      <span data-testid="picker-enabled">{String(enabled)}</span>
      <span data-testid="picker-label">{label}</span>
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

/**
 * A section's clickable header, found by its label. Its text is the chevron
 * glyph, the section glyph, the label and — only when something is selected —
 * the count chip, so `textContent` reads e.g. `expand_morefolder_openKind1`.
 */
function sectionHeader(label: string): HTMLElement {
  const header = screen.getByText(label, { selector: "p" }).parentElement;
  if (!header) throw new Error(`no header for ${label}`);
  return header;
}

/** Whether a sidebar tab carries the "something changed here" dot beside its label. */
function hasChangeDot(tabName: string): boolean {
  const label = screen.getByRole("tab", { name: tabName }).firstElementChild;
  return (label?.childElementCount ?? 0) > 0;
}

/** The checkbox inside a Columns-tab or option row. */
function rowCheckbox(name: RegExp): HTMLInputElement {
  return within(screen.getByRole("button", { name })).getByRole("checkbox") as HTMLInputElement;
}

const EVERY_FILTER: ResourceFilters = {
  search: "spec",
  kinds: ["file"],
  cardTypes: ["Application"],
  categories: ["contract"],
  mimeTypes: ["application/pdf"],
  createdBy: "u1",
  card: { id: "card-1", name: "ERP Core", type: "Application" },
  archived: "archived",
  dateFrom: "2026-01-01",
  dateTo: "2026-02-01",
};

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

describe("ResourcesFilterSidebar sections", () => {
  it("opens on Search, Kind and Card type with the rest folded, each header with its glyph", () => {
    render(<Harness />);

    expect(screen.getByRole("tab", { name: "Filters" })).toHaveAttribute("aria-selected", "true");
    expect(sectionHeader("Search").textContent).toBe("expand_moresearchSearch");
    expect(sectionHeader("Kind").textContent).toBe("expand_morefolder_openKind");
    expect(sectionHeader("Card type").textContent).toBe("expand_morecategoryCard type");
    expect(sectionHeader("Category / link type").textContent).toBe("chevron_rightsellCategory / link type");
    expect(sectionHeader("File type").textContent).toBe("chevron_rightdescriptionFile type");
    expect(sectionHeader("Card").textContent).toBe("chevron_rightdashboardCard");
    expect(sectionHeader("Added by").textContent).toBe("chevron_rightpersonAdded by");
    expect(sectionHeader("Archived cards").textContent).toBe("chevron_rightinventory_2Archived cards");
    expect(sectionHeader("Date added").textContent).toBe("chevron_rightscheduleDate added");

    expect(screen.getByPlaceholderText("Name, card or URL…")).toBeVisible();
    expect(screen.getByRole("button", { name: /File/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /Application/ })).toBeVisible();
    expect(screen.getByText("Contract")).not.toBeVisible();
    expect(screen.getByText("PDF")).not.toBeVisible();
    expect(screen.getByText("pick card")).not.toBeVisible();
    expect(screen.getByText("All")).not.toBeVisible();
    expect(screen.getByLabelText("From")).not.toBeVisible();
  });

  it("folds and unfolds each section from its header without touching the others", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const open = ["Search", "Kind", "Card type"];
    for (const label of open) {
      await user.click(sectionHeader(label));
      expect(sectionHeader(label).textContent).toMatch(/^chevron_right/);
      for (const other of open.filter((l) => l !== label)) {
        expect(sectionHeader(other).textContent).toMatch(/^expand_more/);
      }
      await user.click(sectionHeader(label));
      expect(sectionHeader(label).textContent).toMatch(/^expand_more/);
    }

    for (const label of ["Archived cards", "Date added"]) {
      await user.click(sectionHeader(label));
      expect(sectionHeader(label).textContent).toMatch(/^expand_more/);
      expect(sectionHeader("Search").textContent).toMatch(/^expand_more/);
      await user.click(sectionHeader(label));
      expect(sectionHeader(label).textContent).toMatch(/^chevron_right/);
    }

    await user.click(sectionHeader("Kind"));
    await waitFor(() => expect(screen.getByText("File")).not.toBeVisible());
    await user.click(sectionHeader("Date added"));
    await waitFor(() => expect(screen.getByLabelText("From")).toBeVisible());
  });

  it("counts every section's selections on its header and all of them on the rail", () => {
    const { unmount } = render(<Harness initialFilters={EVERY_FILTER} />);

    expect(sectionHeader("Search").textContent).toBe("expand_moresearchSearch1");
    expect(sectionHeader("Kind").textContent).toBe("expand_morefolder_openKind1");
    expect(sectionHeader("Card type").textContent).toBe("expand_morecategoryCard type1");
    expect(sectionHeader("Category / link type").textContent).toBe("chevron_rightsellCategory / link type1");
    expect(sectionHeader("File type").textContent).toBe("chevron_rightdescriptionFile type1");
    expect(sectionHeader("Card").textContent).toBe("chevron_rightdashboardCard1");
    expect(sectionHeader("Added by").textContent).toBe("chevron_rightpersonAdded by1");
    expect(sectionHeader("Archived cards").textContent).toBe("chevron_rightinventory_2Archived cards1");
    expect(sectionHeader("Date added").textContent).toBe("chevron_rightscheduleDate added2");
    expect(hasChangeDot("Filters")).toBe(true);
    unmount();

    // Ten active filters — one per field, the date range counting each end.
    render(<Harness collapsed initialFilters={EVERY_FILTER} />);
    expect(screen.getByText("10")).toBeInTheDocument();
  });

  it("does not count a search of only spaces, nor the default archived state", () => {
    const { unmount } = render(
      <Harness initialFilters={{ ...EMPTY_RESOURCE_FILTERS, search: "   " }} />,
    );
    expect(sectionHeader("Search").textContent).toBe("expand_moresearchSearch");
    expect(sectionHeader("Archived cards").textContent).toBe("chevron_rightinventory_2Archived cards");
    expect(screen.queryByRole("button", { name: /Clear filters/ })).not.toBeInTheDocument();
    expect(hasChangeDot("Filters")).toBe(false);
    unmount();

    render(<Harness collapsed initialFilters={{ ...EMPTY_RESOURCE_FILTERS, search: "   " }} />);
    expect(screen.getByRole("button", { name: "Expand filters" })).toBeInTheDocument();
    expect(screen.queryByText("1")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("counts the archived filter only once it narrows", async () => {
    const user = userEvent.setup();
    render(<Harness initialFilters={{ ...EMPTY_RESOURCE_FILTERS, archived: "active" }} />);

    expect(sectionHeader("Archived cards").textContent).toBe("chevron_rightinventory_2Archived cards1");
    await user.click(sectionHeader("Archived cards"));
    await user.click(screen.getByText("All"));
    expect(lastFilters().archived).toBe("any");
    expect(sectionHeader("Archived cards").textContent).toBe("expand_moreinventory_2Archived cards");
  });

  it("fills the chip of the selected archived state only", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(sectionHeader("Archived cards"));

    const chip = (label: string) => screen.getByText(label).closest(".MuiChip-root");
    expect(chip("All")).toHaveClass("MuiChip-filled");
    expect(chip("Active")).toHaveClass("MuiChip-outlined");
    expect(chip("Archived")).toHaveClass("MuiChip-outlined");

    await user.click(screen.getByText("Archived"));
    expect(chip("Archived")).toHaveClass("MuiChip-filled");
    expect(chip("All")).toHaveClass("MuiChip-outlined");
  });

  it("keeps the other filters when one field changes after another", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByPlaceholderText("Name, card or URL…"), "a");
    await user.click(sectionHeader("Archived cards"));
    await user.click(screen.getByText("Archived"));
    expect(lastFilters()).toEqual({ ...EMPTY_RESOURCE_FILTERS, search: "a", archived: "archived" });
  });

  it("shows Anyone in the creator select while nobody is picked", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(sectionHeader("Added by"));

    await waitFor(() => expect(screen.getByRole("combobox")).toHaveTextContent("Anyone"));
  });

  it("enables the card picker once its section opens, and keeps it enabled when folded again", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByTestId("picker-enabled")).toHaveTextContent("false");
    expect(screen.getByTestId("picker-label")).toHaveTextContent("Any card");

    await user.click(sectionHeader("Card"));
    expect(screen.getByTestId("picker-enabled")).toHaveTextContent("true");
    // Wait for the section to finish opening before folding it again.
    const collapse = screen.getByTestId("picker-enabled").closest(".MuiCollapse-root") as HTMLElement;
    await waitFor(() => expect(collapse).toHaveClass("MuiCollapse-entered"));

    await user.click(sectionHeader("Card"));
    expect(sectionHeader("Card").textContent).toMatch(/^chevron_right/);
    expect(screen.getByTestId("picker-enabled")).toHaveTextContent("true");
  });

  it("keeps an option row's checkbox out of the tab order — the row is the control", () => {
    render(<Harness />);
    expect(rowCheckbox(/File/)).toHaveAttribute("tabindex", "-1");
  });
});

describe("ResourcesFilterSidebar tabs and rail", () => {
  it("shows no count on the rail and no dots on the tabs while nothing is filtered or hidden", () => {
    const { unmount } = render(<Harness collapsed />);
    expect(screen.getByRole("button", { name: "Expand filters" })).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    unmount();

    render(<Harness />);
    expect(hasChangeDot("Filters")).toBe(false);
    expect(hasChangeDot("Columns")).toBe(false);
  });

  it("marks the Columns tab once a column is hidden", () => {
    render(<Harness initialColumns={new Set([...LOCKED_RESOURCE_COLUMNS, "size"])} />);
    expect(hasChangeDot("Columns")).toBe(true);
    expect(hasChangeDot("Filters")).toBe(false);
  });
});

describe("ResourcesFilterSidebar select all", () => {
  async function openColumns(columns: Set<string>) {
    const user = userEvent.setup();
    render(<Harness initialColumns={columns} />);
    await user.click(screen.getByRole("tab", { name: "Columns" }));
    return user;
  }

  it("is ticked and disabled with every column shown", async () => {
    await openColumns(ALL_COLUMNS);

    const all = rowCheckbox(/Select all/);
    expect(all).toBeChecked();
    expect(all).toHaveAttribute("data-indeterminate", "false");
    expect(sectionHeader("Show or hide columns").textContent).toBe("expand_moregrid_viewShow or hide columns11");
    expect(screen.getByText("11 selected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reset/ })).not.toBeInTheDocument();
  });

  it("is empty with only the locked columns shown", async () => {
    await openColumns(new Set(LOCKED_RESOURCE_COLUMNS));

    const all = rowCheckbox(/Select all/);
    expect(all).not.toBeChecked();
    expect(all).toHaveAttribute("data-indeterminate", "false");
  });

  it("is indeterminate with some optional columns shown", async () => {
    await openColumns(new Set([...LOCKED_RESOURCE_COLUMNS, "size"]));

    const all = rowCheckbox(/Select all/);
    expect(all).not.toBeChecked();
    expect(all).toHaveAttribute("data-indeterminate", "true");
  });

  it("labels each locked row as always visible and never hides one on click", async () => {
    await openColumns(ALL_COLUMNS);

    const locked = screen.getAllByLabelText("Always visible");
    expect(locked).toHaveLength(LOCKED_RESOURCE_COLUMNS.size);
    expect(within(locked[0]).getByRole("button", { name: /Kind/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Kind/ }));
    expect(spies.columns).not.toHaveBeenCalled();
  });
});

describe("ResourcesFilterSidebar resize listeners", () => {
  it("claims the mouse-down and releases both document listeners on mouse up", () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    try {
      const { container } = render(<Harness />);
      const handle = container.firstElementChild?.lastElementChild as HTMLElement;

      // `fireEvent` returns false when the handler called preventDefault (no text selection).
      expect(fireEvent.mouseDown(handle, { clientX: 100 })).toBe(false);
      const added = (type: string) => add.mock.calls.filter((c) => c[0] === type).pop()?.[1];
      const onMove = added("mousemove");
      const onUp = added("mouseup");
      expect(onMove).toBeTypeOf("function");
      expect(onUp).toBeTypeOf("function");

      fireEvent.mouseUp(document);
      expect(remove).toHaveBeenCalledWith("mousemove", onMove);
      expect(remove).toHaveBeenCalledWith("mouseup", onUp);
    } finally {
      add.mockRestore();
      remove.mockRestore();
    }
  });
});
