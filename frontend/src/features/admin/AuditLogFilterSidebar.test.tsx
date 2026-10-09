/**
 * AuditLogFilterSidebar: the Audit Log's filter and column panel. It is fully
 * controlled, so these tests drive it through a harness that keeps the state
 * and check what each control hands back.
 */
import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AuditLogFilterSidebar, {
  AUDIT_GRID_COLUMNS,
  EMPTY_AUDIT_FILTERS,
  LOCKED_AUDIT_COLUMNS,
  type AuditLogFilters,
} from "./AuditLogFilterSidebar";

type Props = React.ComponentProps<typeof AuditLogFilterSidebar>;

const ALL_COLUMNS = new Set(AUDIT_GRID_COLUMNS.map((c) => c.id));

function setup(over: Partial<Props> = {}, initial: Partial<AuditLogFilters> = {}) {
  const spies = {
    onFiltersChange: vi.fn(),
    onToggleCollapse: vi.fn(),
    onWidthChange: vi.fn(),
    onVisibleColumnsChange: vi.fn(),
    onToggleFrozen: vi.fn(),
    onResetColumns: vi.fn(),
    onColumnOrderChange: vi.fn(),
  };
  function Harness() {
    const [filters, setFilters] = useState<AuditLogFilters>({
      ...EMPTY_AUDIT_FILTERS,
      ...initial,
    });
    return (
      <AuditLogFilterSidebar
        filters={filters}
        onFiltersChange={(f) => {
          spies.onFiltersChange(f);
          setFilters(f);
        }}
        collapsed={false}
        onToggleCollapse={spies.onToggleCollapse}
        width={280}
        onWidthChange={spies.onWidthChange}
        visibleColumns={ALL_COLUMNS}
        onVisibleColumnsChange={spies.onVisibleColumnsChange}
        frozenColumns={new Set()}
        onToggleFrozen={spies.onToggleFrozen}
        onResetColumns={spies.onResetColumns}
        columnOrderItems={[]}
        columnOrder={[]}
        onColumnOrderChange={spies.onColumnOrderChange}
        {...over}
      />
    );
  }
  const user = userEvent.setup();
  const view = render(<Harness />);
  return { user, view, ...spies };
}

const lastFilters = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.at(-1)![0] as AuditLogFilters;

describe("collapsed", () => {
  it("is a rail that counts the active filters and expands", async () => {
    const { user, onToggleCollapse } = setup(
      { collapsed: true },
      {
        search: "x",
        origins: ["mcp", "web"],
        toolName: " ",
        dateTo: "2026-01-01",
      },
    );
    // search, two origins, the date — a blank tool name does not count
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button"));
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  it("counts one per search, origin, status, tool name and date", () => {
    setup(
      { collapsed: true },
      {
        search: "x",
        origins: ["api"],
        statuses: ["committed", "open"],
        toolName: "sync",
        dateFrom: "2026-01-01",
        dateTo: "2026-02-01",
      },
    );
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("shows no count when nothing is filtered", () => {
    setup({ collapsed: true }, { search: "  " });
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.queryByText("1")).not.toBeInTheDocument();
  });
});

describe("filters tab", () => {
  it("toggles origins and statuses in and out of the selection", async () => {
    const { user, onFiltersChange } = setup();
    await user.click(screen.getByText("MCP (AI agent)"));
    expect(lastFilters(onFiltersChange).origins).toEqual(["mcp"]);
    await user.click(screen.getByText("Extension"));
    expect(lastFilters(onFiltersChange).origins).toEqual(["mcp", "ext"]);
    await user.click(screen.getByText("MCP (AI agent)"));
    expect(lastFilters(onFiltersChange).origins).toEqual(["ext"]);

    await user.click(screen.getByText("Dry-run only"));
    expect(lastFilters(onFiltersChange)).toEqual({
      ...EMPTY_AUDIT_FILTERS,
      origins: ["ext"],
      statuses: ["dry_run"],
    });
    expect(
      within(screen.getByText("Dry-run only").closest("[role=button]")!).getByRole("checkbox"),
    ).toBeChecked();
  });

  it("lists every origin and status", () => {
    setup();
    for (const label of ["MCP (AI agent)", "Web UI", "API", "Extension"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    for (const label of ["Committed", "Dry-run only", "Open / errored"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("types into the search and, once opened, the tool name", async () => {
    const { user, onFiltersChange } = setup();
    await user.type(screen.getByPlaceholderText("Search actor or tool…"), "ad");
    expect(lastFilters(onFiltersChange).search).toBe("ad");
    await user.click(screen.getByText("Tool name"));
    await user.type(screen.getByPlaceholderText("e.g. create_cards_bulk"), "sync");
    expect(lastFilters(onFiltersChange)).toEqual({
      ...EMPTY_AUDIT_FILTERS,
      search: "ad",
      toolName: "sync",
    });
  });

  it("collapses and reopens a section", async () => {
    const { user } = setup();
    const search = () => screen.queryByPlaceholderText("Search actor or tool…");
    expect(search()).toBeVisible();
    await user.click(screen.getByText("Search"));
    await vi.waitFor(() => expect(search()).not.toBeVisible());
    await user.click(screen.getByText("Search"));
    await vi.waitFor(() => expect(search()).toBeVisible());
  });

  it("clears every filter at once, and offers to only when one is set", async () => {
    const { user, onFiltersChange } = setup({}, { origins: ["api"], dateFrom: "2026-01-01" });
    await user.click(screen.getByRole("button", { name: /Clear filters/ }));
    expect(lastFilters(onFiltersChange)).toEqual(EMPTY_AUDIT_FILTERS);
    expect(screen.queryByRole("button", { name: /Clear filters/ })).not.toBeInTheDocument();
  });

  it("collapses from the header", async () => {
    const { user, onToggleCollapse } = setup();
    await user.click(screen.getByText("chevron_left"));
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });
});

describe("filters tab sections", () => {
  /** DateField commits on blur, so drive focus → change → blur like a user would. */
  function setDate(label: string, value: string) {
    const input = screen.getByLabelText(label);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
  }

  it("opens search, origin and status, and keeps tool and date closed", () => {
    setup();
    for (const label of ["Search", "Origin", "Status", "Tool name", "Date range"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("Web UI")).toBeVisible();
    expect(screen.getByText("Committed")).toBeVisible();
    expect(screen.getByPlaceholderText("e.g. create_cards_bulk")).not.toBeVisible();
    expect(screen.getByLabelText("From")).not.toBeVisible();
  });

  it.each([
    ["Origin", "Web UI"],
    ["Status", "Committed"],
  ])("folds the %s section away", async (section, option) => {
    const { user } = setup();
    await user.click(screen.getByText(section));
    await vi.waitFor(() => expect(screen.getByText(option)).not.toBeVisible());
  });

  it("filters by a date range", async () => {
    const { user, onFiltersChange } = setup();
    await user.click(screen.getByText("Date range"));
    await vi.waitFor(() => expect(screen.getByLabelText("From")).toBeVisible());
    setDate("From", "2026-01-01");
    expect(lastFilters(onFiltersChange).dateFrom).toBe("2026-01-01");
    setDate("To", "2026-02-01");
    expect(lastFilters(onFiltersChange)).toEqual({
      ...EMPTY_AUDIT_FILTERS,
      dateFrom: "2026-01-01",
      dateTo: "2026-02-01",
    });
  });
});

describe("columns tab", () => {
  async function openColumns(over: Partial<Props> = {}) {
    const s = setup(over);
    await s.user.click(screen.getByRole("tab", { name: "Columns" }));
    return s;
  }

  it("shows and hides a column, but never a locked one", async () => {
    const { user, onVisibleColumnsChange } = await openColumns();
    await user.click(screen.getByText("Actor"));
    const next = onVisibleColumnsChange.mock.calls.at(-1)![0] as Set<string>;
    expect([...next].sort()).toEqual(
      [...ALL_COLUMNS].filter((c) => c !== "actor_display_name").sort(),
    );
    onVisibleColumnsChange.mockClear();
    // Locked rows are disabled; even a click that gets through changes nothing.
    for (const id of LOCKED_AUDIT_COLUMNS) {
      const key = AUDIT_GRID_COLUMNS.find((c) => c.id === id)!.labelKey;
      const label = {
        "auditLog.columns.when": "When",
        "auditLog.columns.tool": "Tool",
        "auditLog.columns.actions": "Actions",
      }[key]!;
      const row = screen.getByText(label).closest("[role=button]")!;
      expect(row).toHaveAttribute("aria-disabled", "true");
      fireEvent.click(row);
    }
    expect(onVisibleColumnsChange).not.toHaveBeenCalled();
  });

  it("adds a hidden column back", async () => {
    const visible = new Set([...ALL_COLUMNS].filter((c) => c !== "origin"));
    const { user, onVisibleColumnsChange } = await openColumns({
      visibleColumns: visible,
    });
    await user.click(screen.getByText("Origin"));
    expect(onVisibleColumnsChange.mock.calls.at(-1)![0]).toEqual(ALL_COLUMNS);
  });

  it("offers Reset only once a column is hidden", async () => {
    await openColumns();
    expect(screen.getByText("Toggle columns to show or hide.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset" })).not.toBeInTheDocument();
  });

  it("resets the columns", async () => {
    const visible = new Set([...ALL_COLUMNS].filter((c) => c !== "event_count"));
    const { user, onResetColumns } = await openColumns({
      visibleColumns: visible,
    });
    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(onResetColumns).toHaveBeenCalledTimes(1);
  });

  it("freezes a column from its pin, without hiding it", async () => {
    const { user, onToggleFrozen, onVisibleColumnsChange } = await openColumns({
      frozenColumns: new Set(["created_at"]),
    });
    const pins = screen.getAllByRole("button", { name: "Freeze column" });
    expect(pins).toHaveLength(AUDIT_GRID_COLUMNS.length - 1);
    await user.click(pins[0]);
    expect(onToggleFrozen).toHaveBeenCalledWith("tool_name");
    expect(onVisibleColumnsChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Unfreeze column" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("resize handle", () => {
  it("drags the width within 220–480px and stops on release", () => {
    const { view, onWidthChange } = setup();
    const handle = view.container.firstElementChild!.lastElementChild as HTMLElement;
    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 150 });
    expect(onWidthChange).toHaveBeenLastCalledWith(330);
    fireEvent.mouseMove(document, { clientX: 1000 });
    expect(onWidthChange).toHaveBeenLastCalledWith(480);
    fireEvent.mouseMove(document, { clientX: -1000 });
    expect(onWidthChange).toHaveBeenLastCalledWith(220);
    fireEvent.mouseUp(document);
    onWidthChange.mockClear();
    fireEvent.mouseMove(document, { clientX: 160 });
    expect(onWidthChange).not.toHaveBeenCalled();
  });
});
