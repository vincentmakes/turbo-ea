/**
 * SecurityLogFilterSidebar: the Security & admin log's filter and column
 * panel. Fully controlled, so the tests drive it through a harness that keeps
 * the filter state and check what each control hands back.
 */
import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import i18n from "@/i18n";
import SecurityLogFilterSidebar, {
  EMPTY_SECURITY_FILTERS,
  LOCKED_SECURITY_COLUMNS,
  SECURITY_GRID_COLUMNS,
  countActiveSecurityFilters,
  type SecurityLogFilters,
} from "./SecurityLogFilterSidebar";

type Props = React.ComponentProps<typeof SecurityLogFilterSidebar>;

const ALL_COLUMNS = new Set(SECURITY_GRID_COLUMNS.map((c) => c.id));
const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`admin:${key}`, opts) as string;

function setup(over: Partial<Props> = {}, initial: Partial<SecurityLogFilters> = {}) {
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
    const [filters, setFilters] = useState<SecurityLogFilters>({
      ...EMPTY_SECURITY_FILTERS,
      ...initial,
    });
    return (
      <SecurityLogFilterSidebar
        filters={filters}
        onFiltersChange={(f) => {
          spies.onFiltersChange(f);
          setFilters(f);
        }}
        actions={["auth.login.failed", "auth.logout", "zz.unknown"]}
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

const lastFilters = (spy: ReturnType<typeof vi.fn>) =>
  spy.mock.calls.at(-1)![0] as SecurityLogFilters;

describe("countActiveSecurityFilters", () => {
  it("counts each set filter once and ignores blank text", () => {
    expect(countActiveSecurityFilters(EMPTY_SECURITY_FILTERS)).toBe(0);
    expect(
      countActiveSecurityFilters({
        q: "x",
        category: "auth",
        outcome: "failure",
        action: "auth.logout",
        actor: "a",
        ip: "1",
        dateFrom: "2026-01-01",
        dateTo: "2026-01-02",
      }),
    ).toBe(8);
    expect(countActiveSecurityFilters({ ...EMPTY_SECURITY_FILTERS, q: "  ", actor: " ", ip: " " })).toBe(0);
  });
});

describe("collapsed rail", () => {
  it("shows the active-filter count and expands", async () => {
    const { user, onToggleCollapse } = setup(
      { collapsed: true },
      { category: "auth", ip: "1.2.3.4", q: " " },
    );
    expect(screen.getByTestId("security-sidebar-rail")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: t("securityLog.filters.expand") }));
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  it("shows no count chip when nothing is filtered", () => {
    setup({ collapsed: true });
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});

describe("filters tab", () => {
  it("collapses from the header and has no change dot while empty", async () => {
    const { user, onToggleCollapse } = setup();
    expect(screen.queryByTestId("change-dot")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /filter_alt_off/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: t("securityLog.filters.collapse") }));
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  it("types a search, shows the change dot, and clears it from the adornment", async () => {
    const { user, onFiltersChange } = setup();
    const box = screen.getByRole("textbox", { name: t("securityLog.filters.searchPlaceholder") });
    await user.type(box, "dana");
    expect(lastFilters(onFiltersChange).q).toBe("dana");
    expect(screen.getAllByTestId("change-dot")).toHaveLength(1);
    await user.click(screen.getAllByRole("button", { name: t("securityLog.filters.clear") })[0]);
    expect(lastFilters(onFiltersChange).q).toBe("");
  });

  it("category chips are single-select toggles", async () => {
    const { user, onFiltersChange } = setup();
    const auth = screen.getByRole("button", { name: t("securityLog.categories.auth") });
    expect(auth).toHaveAttribute("aria-pressed", "false");
    await user.click(auth);
    expect(lastFilters(onFiltersChange).category).toBe("auth");
    expect(screen.getByRole("button", { name: t("securityLog.categories.auth") })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: t("securityLog.categories.access") }));
    expect(lastFilters(onFiltersChange).category).toBe("access");
    await user.click(screen.getByRole("button", { name: t("securityLog.categories.access") }));
    expect(lastFilters(onFiltersChange).category).toBe("");
  });

  it("outcome chips are single-select toggles", async () => {
    const { user, onFiltersChange } = setup();
    await user.click(screen.getByRole("button", { name: t("securityLog.outcomes.failure") }));
    expect(lastFilters(onFiltersChange).outcome).toBe("failure");
    await user.click(screen.getByRole("button", { name: t("securityLog.outcomes.success") }));
    expect(lastFilters(onFiltersChange).outcome).toBe("success");
  });

  it("lists actions by translated label, with the raw key as secondary text", async () => {
    const { user, onFiltersChange } = setup();
    const label = t("securityLog.actionLabels.auth_login_failed");
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText("auth.login.failed")).toBeInTheDocument();
    // An action with no label shows its key once, not twice.
    expect(screen.getAllByText("zz.unknown")).toHaveLength(1);

    await user.click(screen.getByText(label));
    expect(lastFilters(onFiltersChange).action).toBe("auth.login.failed");
    await user.click(screen.getByText(t("securityLog.actionLabels.auth_logout")));
    expect(lastFilters(onFiltersChange).action).toBe("auth.logout");
    await user.click(screen.getByText(t("securityLog.actionLabels.auth_logout")));
    expect(lastFilters(onFiltersChange).action).toBe("");
  });

  it("keeps a selected action listed even when the server no longer reports it", () => {
    setup({ actions: [] }, { action: "auth.register" });
    expect(screen.getByText(t("securityLog.actionLabels.auth_register"))).toBeInTheDocument();
    expect(screen.queryByText(t("securityLog.filters.noActions"))).not.toBeInTheDocument();
  });

  it("says so when no action has been recorded", () => {
    setup({ actions: [] });
    expect(screen.getByText(t("securityLog.filters.noActions"))).toBeInTheDocument();
  });

  it("filters by actor, IP and date, then clears everything", async () => {
    const { user, onFiltersChange } = setup();
    await user.click(screen.getByText(t("securityLog.filters.sectionActor")));
    await user.type(
      screen.getByRole("textbox", { name: t("securityLog.filters.actorPlaceholder") }),
      "a@b",
    );
    expect(lastFilters(onFiltersChange).actor).toBe("a@b");
    await user.click(screen.getByText(t("securityLog.filters.sectionIp")));
    await user.type(screen.getByRole("textbox", { name: t("securityLog.filters.ipPlaceholder") }), "10.");
    expect(lastFilters(onFiltersChange).ip).toBe("10.");

    await user.click(screen.getByText(t("securityLog.filters.sectionDate")));
    const from = screen.getByLabelText(t("securityLog.filters.dateFrom"));
    fireEvent.change(from, { target: { value: "2026-03-01" } });
    fireEvent.blur(from);
    expect(lastFilters(onFiltersChange).dateFrom).toBe("2026-03-01");
    const to = screen.getByLabelText(t("securityLog.filters.dateTo"));
    fireEvent.change(to, { target: { value: "2026-03-09" } });
    fireEvent.blur(to);
    expect(lastFilters(onFiltersChange).dateTo).toBe("2026-03-09");

    await user.click(screen.getByRole("button", { name: /filter_alt_off/ }));
    expect(lastFilters(onFiltersChange)).toEqual(EMPTY_SECURITY_FILTERS);
  });

  it("section headers carry a count", () => {
    setup({}, { category: "auth", dateFrom: "2026-01-01", dateTo: "2026-01-02" });
    const header = screen.getByText(t("securityLog.filters.sectionDate")).parentElement!;
    expect(within(header).getByText("2")).toBeInTheDocument();
  });

  it("resizes within its bounds", () => {
    const { onWidthChange } = setup();
    const handle = screen.getByTestId("security-sidebar-resize");
    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 150 });
    expect(onWidthChange).toHaveBeenLastCalledWith(330);
    fireEvent.mouseMove(document, { clientX: 1000 });
    expect(onWidthChange).toHaveBeenLastCalledWith(480);
    fireEvent.mouseMove(document, { clientX: -1000 });
    expect(onWidthChange).toHaveBeenLastCalledWith(220);
    fireEvent.mouseUp(document);
    onWidthChange.mockClear();
    fireEvent.mouseMove(document, { clientX: 200 });
    expect(onWidthChange).not.toHaveBeenCalled();
  });
});

describe("columns tab", () => {
  async function openColumns(over: Partial<Props> = {}) {
    const s = setup(over);
    await s.user.click(screen.getByRole("tab", { name: t("securityLog.filters.tabColumns") }));
    return s;
  }

  it("lists every column with locked ones disabled and a freeze pin on each", async () => {
    await openColumns();
    for (const c of SECURITY_GRID_COLUMNS) {
      expect(screen.getByText(t(c.labelKey))).toBeInTheDocument();
    }
    expect(screen.getByText(t("securityLog.filters.selectedCount", { count: 10 }))).toBeInTheDocument();
    const lockedRow = screen.getByText(t("securityLog.columns.action")).closest("[role='button']")!;
    expect(lockedRow).toHaveAttribute("aria-disabled", "true");
    expect(LOCKED_SECURITY_COLUMNS.has("created_at")).toBe(true);
    // No change: no reset, no dot, Select all disabled.
    expect(screen.queryByText(t("securityLog.filters.reset"))).not.toBeInTheDocument();
    expect(screen.queryByTestId("change-dot")).not.toBeInTheDocument();
    expect(
      screen.getByText(t("securityLog.filters.selectAll")).closest("[role='button']"),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("toggles an unlocked column and ignores a locked one", async () => {
    const { user, onVisibleColumnsChange } = await openColumns();
    await user.click(screen.getByText(t("securityLog.columns.ip")));
    const next = onVisibleColumnsChange.mock.calls.at(-1)![0] as Set<string>;
    expect(next.has("ip")).toBe(false);
    expect(next.size).toBe(9);
  });

  it("re-adds a hidden column", async () => {
    const visible = new Set([...ALL_COLUMNS].filter((c) => c !== "ip"));
    const { user, onVisibleColumnsChange } = await openColumns({ visibleColumns: visible });
    await user.click(screen.getByText(t("securityLog.columns.ip")));
    expect((onVisibleColumnsChange.mock.calls.at(-1)![0] as Set<string>).has("ip")).toBe(true);
  });

  it("with hidden columns: change dot, Reset and Select all", async () => {
    const visible = new Set(["created_at", "action", "ip"]);
    const { user, onResetColumns, onVisibleColumnsChange } = await openColumns({
      visibleColumns: visible,
    });
    expect(screen.getAllByTestId("change-dot")).toHaveLength(1);
    await user.click(screen.getByText(t("securityLog.filters.reset")));
    expect(onResetColumns).toHaveBeenCalledTimes(1);
    await user.click(screen.getByText(t("securityLog.filters.selectAll")));
    expect(onVisibleColumnsChange).toHaveBeenLastCalledWith(ALL_COLUMNS);
  });

  it("the freeze pin toggles the column, locked ones included", async () => {
    const { user, onToggleFrozen, onVisibleColumnsChange } = await openColumns({
      frozenColumns: new Set(["ip"]),
    });
    const freeze = i18n.t("common:grid.freezeColumn") as string;
    const unfreeze = i18n.t("common:grid.unfreezeColumn") as string;
    const pins = screen.getAllByRole("button", { name: freeze });
    // One pin per column; `ip` is frozen so its pin reads "Unfreeze".
    expect(pins).toHaveLength(SECURITY_GRID_COLUMNS.length - 1);
    expect(screen.getByRole("button", { name: unfreeze })).toHaveAttribute("aria-pressed", "true");
    // The first pin is `created_at`, a locked column — still clickable.
    await user.click(pins[0]);
    expect(onToggleFrozen).toHaveBeenCalledWith("created_at");
    await user.click(screen.getByRole("button", { name: unfreeze }));
    expect(onToggleFrozen).toHaveBeenLastCalledWith("ip");
    // A pin click never toggles visibility.
    expect(onVisibleColumnsChange).not.toHaveBeenCalled();
  });
});
