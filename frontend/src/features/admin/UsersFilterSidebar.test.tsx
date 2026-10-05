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
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
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

/**
 * A section's clickable header, found by its label. Its text is the chevron
 * glyph, the section glyph, the label and — only when something is selected —
 * the count chip, so `textContent` reads e.g. `expand_moreshieldRole1`.
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
    // The button's name carries its glyph too, so match the label as a substring.
    expect(screen.queryByRole("button", { name: /Reset columns/ })).not.toBeInTheDocument();

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

describe("UsersFilterSidebar sections", () => {
  it("opens on Search, Role, Status and Auth with Advanced folded, each header with its glyph", () => {
    render(<Harness />);

    expect(sectionHeader("Search").textContent).toBe("expand_moresearchSearch");
    expect(sectionHeader("Role").textContent).toBe("expand_moreshieldRole");
    expect(sectionHeader("Status").textContent).toBe("expand_morecheck_circleStatus");
    expect(sectionHeader("Auth").textContent).toBe("expand_morevpn_keyAuth");
    expect(sectionHeader("Advanced").textContent).toBe("chevron_righttuneAdvanced");

    expect(screen.getByPlaceholderText("Search users…")).toBeVisible();
    expect(screen.getByRole("button", { name: "Admin" })).toBeVisible();
    expect(screen.getByText("Active")).toBeVisible();
    expect(screen.getByText("SSO")).toBeVisible();
    expect(screen.getByText("Invited only")).not.toBeVisible();
  });

  it("folds and unfolds each section from its header without touching the others", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    for (const label of ["Search", "Role", "Status", "Auth"]) {
      await user.click(sectionHeader(label));
      expect(sectionHeader(label).textContent).toMatch(/^chevron_right/);
      for (const other of ["Search", "Role", "Status", "Auth"].filter((l) => l !== label)) {
        expect(sectionHeader(other).textContent).toMatch(/^expand_more/);
      }
      await user.click(sectionHeader(label));
      expect(sectionHeader(label).textContent).toMatch(/^expand_more/);
    }
    await waitFor(() => expect(screen.getByRole("button", { name: "Admin" })).toBeVisible());

    await user.click(sectionHeader("Role"));
    await waitFor(() => expect(screen.getByText("Admin")).not.toBeVisible());

    await user.click(sectionHeader("Advanced"));
    expect(sectionHeader("Advanced").textContent).toMatch(/^expand_more/);
    await waitFor(() => expect(screen.getByText("Invited only")).toBeVisible());
    await user.click(sectionHeader("Advanced"));
    expect(sectionHeader("Advanced").textContent).toMatch(/^chevron_right/);
    expect(sectionHeader("Search").textContent).toMatch(/^expand_more/);
  });

  it("counts each section's selections on its header, never showing a zero", () => {
    render(
      <Harness
        initialFilters={{
          search: "ann",
          roles: ["admin"],
          statuses: ["active", "invited"],
          authMethods: ["sso"],
          invited: true,
        }}
      />,
    );

    // Search has no count: its text is either there or not.
    expect(sectionHeader("Search").textContent).toBe("expand_moresearchSearch");
    expect(sectionHeader("Role").textContent).toBe("expand_moreshieldRole1");
    expect(sectionHeader("Status").textContent).toBe("expand_morecheck_circleStatus2");
    expect(sectionHeader("Auth").textContent).toBe("expand_morevpn_keyAuth1");
    expect(sectionHeader("Advanced").textContent).toBe("chevron_righttuneAdvanced1");
    expect(screen.getByRole("button", { name: /Clear all \(6\)/ })).toBeInTheDocument();
  });

  it("deselects one status of several, keeping the rest", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByText("Active"));
    await user.click(screen.getByText("Disabled"));
    expect(lastFilters().statuses).toEqual(["active", "inactive"]);
    await user.click(screen.getByText("Active"));
    expect(lastFilters().statuses).toEqual(["inactive"]);
  });

  it("fills the selected status and auth chips and outlines the rest", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const chip = (label: string) => screen.getByText(label).closest(".MuiChip-root");

    for (const label of ["Active", "Invited", "Disabled", "Local", "SSO"]) {
      expect(chip(label)).toHaveClass("MuiChip-outlined");
    }
    await user.click(screen.getByText("Invited"));
    await user.click(screen.getByText("SSO"));
    expect(chip("Invited")).toHaveClass("MuiChip-filled");
    expect(chip("SSO")).toHaveClass("MuiChip-filled");
    expect(chip("Active")).toHaveClass("MuiChip-outlined");
    expect(chip("Local")).toHaveClass("MuiChip-outlined");
  });
});

describe("UsersFilterSidebar active count", () => {
  it("counts auth methods and statuses on the rail", () => {
    render(
      <Harness
        collapsed
        initialFilters={{ ...EMPTY_USER_FILTERS, authMethods: ["local", "sso"], statuses: ["active"] }}
      />,
    );
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("does not count a search of only spaces", () => {
    const { unmount } = render(
      <Harness collapsed initialFilters={{ ...EMPTY_USER_FILTERS, search: "   " }} />,
    );
    expect(screen.queryByText("1")).not.toBeInTheDocument();
    unmount();

    render(<Harness initialFilters={{ ...EMPTY_USER_FILTERS, search: "   " }} />);
    expect(screen.queryByRole("button", { name: /Clear all/ })).not.toBeInTheDocument();
    expect(hasChangeDot("Filters")).toBe(false);
  });

  it("marks the Filters tab while a filter is active and the Columns tab once columns differ", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(hasChangeDot("Filters")).toBe(false);
    expect(hasChangeDot("Columns")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Admin" }));
    expect(hasChangeDot("Filters")).toBe(true);
    expect(hasChangeDot("Columns")).toBe(false);

    await user.click(screen.getByRole("tab", { name: "Columns" }));
    await user.click(screen.getByRole("button", { name: /Locale/ }));
    expect(hasChangeDot("Columns")).toBe(true);
  });
});

describe("UsersFilterSidebar column changes", () => {
  it("offers Reset once a column is added to the defaults", async () => {
    const user = userEvent.setup();
    render(<Harness initialColumns={new Set([...DEFAULT_USER_COLUMNS, "locale"])} />);
    await user.click(screen.getByRole("tab", { name: "Columns" }));

    expect(screen.getByRole("button", { name: /Reset columns/ })).toBeInTheDocument();
    expect(hasChangeDot("Columns")).toBe(true);
  });

  it("offers Reset when as many columns are shown as by default but not the same ones", async () => {
    const user = userEvent.setup();
    const swapped = new Set([...DEFAULT_USER_COLUMNS].filter((k) => k !== "last_login"));
    swapped.add("locale");
    render(<Harness initialColumns={swapped} />);
    await user.click(screen.getByRole("tab", { name: "Columns" }));

    expect(screen.getByRole("button", { name: /Reset columns/ })).toBeInTheDocument();
  });

  it("shows Name ticked even when it is missing from the selection, and other columns as stored", async () => {
    const user = userEvent.setup();
    render(<Harness initialColumns={new Set(["email"])} />);
    await user.click(screen.getByRole("tab", { name: "Columns" }));

    expect(within(screen.getByRole("button", { name: /Name/ })).getByRole("checkbox")).toBeChecked();
    expect(within(screen.getByRole("button", { name: /Email/ })).getByRole("checkbox")).toBeChecked();
    expect(within(screen.getByRole("button", { name: /Locale/ })).getByRole("checkbox")).not.toBeChecked();
  });

  it("never hides the locked Name column, even when its disabled row is clicked", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("tab", { name: "Columns" }));

    fireEvent.click(screen.getByRole("button", { name: /Name/ }));
    expect(spies.columns).not.toHaveBeenCalled();
  });
});

describe("UsersFilterSidebar resize listeners", () => {
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
