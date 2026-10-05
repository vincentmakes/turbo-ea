/**
 * The Users admin filter sidebar rendered on its own: the collapsed rail, the
 * Filters tab (search, roles, status, auth, advanced, clear all), the Columns
 * tab (locked row, toggles, freeze pins, reset) and the resize handle.
 *
 * The component is controlled, so a small harness holds `filters` and the
 * selected-column set in state and records every change callback; the
 * assertions read the last argument. `ColumnOrderSection` is a dnd-kit list
 * with its own tests and is stubbed down to its reset button.
 */
import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/components/grid/ColumnOrderSection", () => ({
  default: ({ onReset }: { onReset?: () => void }) => (
    <button type="button" data-testid="order-reset" onClick={onReset}>
      order reset
    </button>
  ),
}));

import type { AppRole } from "@/types";
import UsersFilterSidebar, {
  DEFAULT_USER_COLUMNS,
  EMPTY_USER_FILTERS,
  USER_COLUMNS,
  type UserFilters,
} from "./UsersFilterSidebar";

function makeRole(overrides: Partial<AppRole> & { key: string; label: string }): AppRole {
  return {
    id: `role-${overrides.key}`,
    is_system: false,
    is_default: false,
    is_archived: false,
    color: "#1976d2",
    permissions: {},
    sort_order: 0,
    ...overrides,
  };
}

const ROLES = [
  makeRole({ key: "admin", label: "Admin", color: "#d32f2f" }),
  makeRole({ key: "member", label: "Member" }),
  makeRole({ key: "retired", label: "Retired", is_archived: true }),
];

const spies = {
  filters: vi.fn<(f: UserFilters) => void>(),
  columns: vi.fn<(c: Set<string>) => void>(),
  collapse: vi.fn(),
  width: vi.fn<(w: number) => void>(),
  frozen: vi.fn<(id: string) => void>(),
  resetColumns: vi.fn(),
  order: vi.fn<(o: string[]) => void>(),
  resetOrder: vi.fn(),
};

function Harness({
  initialFilters = EMPTY_USER_FILTERS,
  initialColumns = DEFAULT_USER_COLUMNS,
  collapsed = false,
  frozen = new Set<string>(),
  withReset = true,
}: {
  initialFilters?: UserFilters;
  initialColumns?: Set<string>;
  collapsed?: boolean;
  frozen?: Set<string>;
  withReset?: boolean;
}) {
  const [filters, setFilters] = useState(initialFilters);
  const [columns, setColumns] = useState(initialColumns);
  return (
    <UsersFilterSidebar
      roles={ROLES}
      filters={filters}
      onFiltersChange={(f) => {
        spies.filters(f);
        setFilters(f);
      }}
      collapsed={collapsed}
      onToggleCollapse={spies.collapse}
      width={300}
      onWidthChange={spies.width}
      selectedColumns={columns}
      onSelectedColumnsChange={(c) => {
        spies.columns(c);
        setColumns(c);
      }}
      frozenColumns={frozen}
      onToggleFrozen={spies.frozen}
      onResetColumns={withReset ? spies.resetColumns : undefined}
      columnOrderItems={USER_COLUMNS.map((c) => ({ colId: c.colId, label: c.key }))}
      columnOrder={USER_COLUMNS.map((c) => c.colId)}
      onColumnOrderChange={spies.order}
      onResetColumnOrder={spies.resetOrder}
    />
  );
}

function lastFilters(): UserFilters {
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

beforeEach(() => {
  for (const spy of Object.values(spies)) spy.mockClear();
});

describe("UsersFilterSidebar rail", () => {
  it("collapses to a rail with the active-filter count and expands on click", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        collapsed
        initialFilters={{ ...EMPTY_USER_FILTERS, search: "x", roles: ["admin"], invited: true }}
      />,
    );

    expect(screen.getByText("3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand filters" }));
    expect(spies.collapse).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("hides the count chip on the rail when nothing is active", () => {
    render(<Harness collapsed />);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});

describe("UsersFilterSidebar filters", () => {
  it("edits the search text and clears it from the adornment", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const search = screen.getByPlaceholderText("Search users…");
    await user.type(search, "ann");
    expect(lastFilters().search).toBe("ann");

    await user.click(screen.getByRole("button", { name: "close" }));
    expect(lastFilters().search).toBe("");
  });

  it("toggles roles, hiding archived ones, and the status and auth chips", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.queryByText("Retired")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Admin" }));
    expect(lastFilters().roles).toEqual(["admin"]);
    await user.click(screen.getByRole("button", { name: "Member" }));
    expect(lastFilters().roles).toEqual(["admin", "member"]);
    await user.click(screen.getByRole("button", { name: "Admin" }));
    expect(lastFilters().roles).toEqual(["member"]);

    await user.click(screen.getByText("Invited"));
    expect(lastFilters().statuses).toEqual(["invited"]);
    await user.click(screen.getByText("Invited"));
    expect(lastFilters().statuses).toEqual([]);

    await user.click(screen.getByText("SSO"));
    expect(lastFilters().authMethods).toEqual(["sso"]);
    await user.click(screen.getByText("Local"));
    expect(lastFilters().authMethods).toEqual(["sso", "local"]);
    await user.click(screen.getByText("SSO"));
    expect(lastFilters().authMethods).toEqual(["local"]);
  });

  it("opens the advanced section for the invited-only switch and clears everything", async () => {
    const user = userEvent.setup();
    render(<Harness initialFilters={{ ...EMPTY_USER_FILTERS, roles: ["admin"], statuses: ["active"] }} />);

    await user.click(screen.getByText("Advanced"));
    await user.click(screen.getByLabelText("Invited only"));
    expect(lastFilters().invited).toBe(true);

    await user.click(screen.getByRole("button", { name: /Clear all \(3\)/ }));
    expect(lastFilters()).toEqual(EMPTY_USER_FILTERS);
    expect(screen.queryByRole("button", { name: /Clear all/ })).not.toBeInTheDocument();
  });
});

describe("UsersFilterSidebar columns", () => {
  it("toggles columns, keeps Name locked, freezes a column and resets", async () => {
    const user = userEvent.setup();
    render(<Harness frozen={new Set(["email"])} />);

    await user.click(screen.getByRole("tab", { name: "Columns" }));

    // A locked row is a disabled `ListItemButton` (a div), so it reads as aria-disabled.
    const name = screen.getByRole("button", { name: /Name/ });
    expect(name).toHaveAttribute("aria-disabled", "true");
    expect(within(name).getByRole("checkbox")).toBeChecked();
    expect(screen.queryByRole("button", { name: "Reset columns" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Locale/ }));
    expect(lastColumns().has("locale")).toBe(true);
    await user.click(screen.getByRole("button", { name: /Email/ }));
    expect(lastColumns().has("email")).toBe(false);

    // The pins are siblings of the rows; the Email pin reads as frozen.
    const emailRow = rowWithPin(screen.getByRole("button", { name: /Email/ }));
    await user.click(within(emailRow).getByRole("button", { name: "Unfreeze column" }));
    expect(spies.frozen).toHaveBeenLastCalledWith("email");
    const nameRow = rowWithPin(name);
    await user.click(within(nameRow).getByRole("button", { name: "Freeze column" }));
    expect(spies.frozen).toHaveBeenLastCalledWith("display_name");

    await user.click(screen.getByRole("button", { name: /Reset columns/ }));
    expect(spies.resetColumns).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId("order-reset"));
    expect(spies.resetOrder).toHaveBeenCalledTimes(1);
  });

  it("offers no reset without a handler", async () => {
    const user = userEvent.setup();
    render(<Harness withReset={false} initialColumns={new Set(["name"])} />);
    await user.click(screen.getByRole("tab", { name: "Columns" }));
    expect(screen.queryByRole("button", { name: /Reset columns/ })).not.toBeInTheDocument();
  });
});

describe("UsersFilterSidebar resize", () => {
  it("drags the handle within the width bounds and stops on mouse up", () => {
    const { container } = render(<Harness />);
    const handle = container.firstElementChild?.lastElementChild as HTMLElement;

    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 150 });
    expect(spies.width).toHaveBeenLastCalledWith(350);
    fireEvent.mouseMove(document, { clientX: -900 });
    expect(spies.width).toHaveBeenLastCalledWith(220);
    fireEvent.mouseMove(document, { clientX: 900 });
    expect(spies.width).toHaveBeenLastCalledWith(500);

    fireEvent.mouseUp(document);
    spies.width.mockClear();
    fireEvent.mouseMove(document, { clientX: 400 });
    expect(spies.width).not.toHaveBeenCalled();
  });
});
