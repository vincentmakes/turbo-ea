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

// ---------------------------------------------------------------------------
// Behavioural detail: what each section header, chip and button hands back.
// ---------------------------------------------------------------------------

/** The header row of a filter section (the Box wrapping the label). */
const headerOf = (labelKey: string) => screen.getByText(t(labelKey)).parentElement!;

const SECTIONS: {
  labelKey: string;
  icon: string;
  expanded: boolean;
  set: Partial<SecurityLogFilters>;
  blank?: Partial<SecurityLogFilters>;
}[] = [
  {
    labelKey: "securityLog.filters.sectionSearch",
    icon: "search",
    expanded: true,
    set: { q: "dana" },
    blank: { q: "   " },
  },
  {
    labelKey: "securityLog.filters.sectionCategory",
    icon: "category",
    expanded: true,
    set: { category: "auth" },
  },
  {
    labelKey: "securityLog.filters.sectionOutcome",
    icon: "rule",
    expanded: true,
    set: { outcome: "failure" },
  },
  {
    labelKey: "securityLog.filters.sectionAction",
    icon: "bolt",
    expanded: true,
    set: { action: "auth.logout" },
  },
  {
    labelKey: "securityLog.filters.sectionActor",
    icon: "person",
    expanded: false,
    set: { actor: "a@b" },
    blank: { actor: "  " },
  },
  {
    labelKey: "securityLog.filters.sectionIp",
    icon: "lan",
    expanded: false,
    set: { ip: "10.0.0.1" },
    blank: { ip: " " },
  },
  {
    labelKey: "securityLog.filters.sectionDate",
    icon: "event",
    expanded: false,
    set: { dateFrom: "2026-01-01" },
  },
];

describe("section headers", () => {
  it.each(SECTIONS)("$labelKey shows its icon and no count while unset", ({ labelKey, icon, expanded }) => {
    setup();
    const header = headerOf(labelKey);
    expect(within(header).getByText(icon)).toBeInTheDocument();
    expect(within(header).getByText(expanded ? "expand_more" : "chevron_right")).toBeInTheDocument();
    expect(within(header).queryByText("1")).not.toBeInTheDocument();
  });

  it.each(SECTIONS)("$labelKey counts its active filter", ({ labelKey, set }) => {
    setup({}, set);
    expect(within(headerOf(labelKey)).getByText("1")).toBeInTheDocument();
    // Only that section counts it.
    for (const other of SECTIONS.filter((s) => s.labelKey !== labelKey)) {
      expect(within(headerOf(other.labelKey)).queryByText("1")).not.toBeInTheDocument();
    }
  });

  it.each(SECTIONS.filter((s) => s.blank))("$labelKey ignores whitespace-only text", ({ labelKey, blank }) => {
    setup({}, blank);
    expect(within(headerOf(labelKey)).queryByText("1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("change-dot")).not.toBeInTheDocument();
  });

  it("the date section counts each end of the range", () => {
    setup({}, { dateTo: "2026-01-02" });
    expect(within(headerOf("securityLog.filters.sectionDate")).getByText("1")).toBeInTheDocument();
  });

  it("clicking a header flips its expand glyph", async () => {
    const { user } = setup();
    const search = headerOf("securityLog.filters.sectionSearch");
    await user.click(search);
    expect(within(search).getByText("chevron_right")).toBeInTheDocument();
    const actor = headerOf("securityLog.filters.sectionActor");
    await user.click(actor);
    expect(within(actor).getByText("expand_more")).toBeInTheDocument();
    // Toggling one section leaves the others alone.
    expect(
      within(headerOf("securityLog.filters.sectionCategory")).getByText("expand_more"),
    ).toBeInTheDocument();
    expect(
      within(headerOf("securityLog.filters.sectionIp")).getByText("chevron_right"),
    ).toBeInTheDocument();
  });
});

describe("state chips", () => {
  it("toggling a category keeps every other filter and toggling again clears it", async () => {
    const { user, onFiltersChange } = setup({}, { q: "dana", outcome: "success" });
    const label = t("securityLog.categories.admin");
    await user.click(screen.getByRole("button", { name: label }));
    expect(lastFilters(onFiltersChange)).toEqual({
      ...EMPTY_SECURITY_FILTERS,
      q: "dana",
      outcome: "success",
      category: "admin",
    });
    await user.click(screen.getByRole("button", { name: label }));
    expect(lastFilters(onFiltersChange)).toEqual({
      ...EMPTY_SECURITY_FILTERS,
      q: "dana",
      outcome: "success",
    });
    expect(onFiltersChange).toHaveBeenCalledTimes(2);
  });

  it("renders the picked chip filled and the rest outlined", () => {
    setup({}, { category: "access", outcome: "failure" });
    const filled = (key: string) =>
      screen.getByRole("button", { name: t(key) }).classList.contains("MuiChip-filled");
    expect(filled("securityLog.categories.access")).toBe(true);
    expect(filled("securityLog.categories.auth")).toBe(false);
    expect(filled("securityLog.categories.admin")).toBe(false);
    expect(filled("securityLog.outcomes.failure")).toBe(true);
    expect(filled("securityLog.outcomes.success")).toBe(false);
    expect(
      screen.getByRole("button", { name: t("securityLog.categories.auth") }),
    ).toHaveClass("MuiChip-outlined");
  });

  it("lists exactly the known categories and outcomes", () => {
    setup();
    for (const key of ["auth", "admin", "access"]) {
      expect(screen.getByRole("button", { name: t(`securityLog.categories.${key}`) })).toBeInTheDocument();
    }
    for (const key of ["success", "failure"]) {
      expect(screen.getByRole("button", { name: t(`securityLog.outcomes.${key}`) })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(5);
  });

  it("outcome toggles clear on a second click and leave the category alone", async () => {
    const { user, onFiltersChange } = setup({}, { category: "auth" });
    const failure = t("securityLog.outcomes.failure");
    await user.click(screen.getByRole("button", { name: failure }));
    expect(lastFilters(onFiltersChange)).toEqual({
      ...EMPTY_SECURITY_FILTERS,
      category: "auth",
      outcome: "failure",
    });
    await user.click(screen.getByRole("button", { name: failure }));
    expect(lastFilters(onFiltersChange)).toEqual({ ...EMPTY_SECURITY_FILTERS, category: "auth" });
  });
});

describe("text fields and Clear filters", () => {
  it("offers a clear adornment only once the field has text", async () => {
    const { user, onFiltersChange } = setup({}, { category: "auth" });
    const clear = t("securityLog.filters.clear");
    expect(screen.queryByRole("button", { name: clear })).not.toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", { name: t("securityLog.filters.searchPlaceholder") }),
      "x",
    );
    expect(screen.getAllByRole("button", { name: clear })).toHaveLength(1);
    expect(lastFilters(onFiltersChange)).toEqual({ ...EMPTY_SECURITY_FILTERS, category: "auth", q: "x" });
    await user.click(screen.getByRole("button", { name: clear }));
    expect(lastFilters(onFiltersChange)).toEqual({ ...EMPTY_SECURITY_FILTERS, category: "auth" });
    expect(screen.queryByRole("button", { name: clear })).not.toBeInTheDocument();
  });

  it("typing in one field keeps the others", async () => {
    const { user, onFiltersChange } = setup({}, { category: "auth", ip: "1.1.1.1" });
    await user.click(headerOf("securityLog.filters.sectionActor"));
    await user.type(
      screen.getByRole("textbox", { name: t("securityLog.filters.actorPlaceholder") }),
      "d",
    );
    expect(lastFilters(onFiltersChange)).toEqual({
      ...EMPTY_SECURITY_FILTERS,
      category: "auth",
      ip: "1.1.1.1",
      actor: "d",
    });
  });

  it("Clear filters appears with any active filter and restores the defaults", async () => {
    const all: SecurityLogFilters = {
      q: "x",
      category: "auth",
      outcome: "failure",
      action: "auth.logout",
      actor: "a",
      ip: "1",
      dateFrom: "2026-01-01",
      dateTo: "2026-01-02",
    };
    const { user, onFiltersChange } = setup({}, all);
    const clearAll = screen.getByRole("button", { name: /filter_alt_off/ });
    expect(clearAll).toHaveTextContent(t("securityLog.filters.clear"));
    await user.click(clearAll);
    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    expect(lastFilters(onFiltersChange)).toEqual(EMPTY_SECURITY_FILTERS);
    expect(screen.queryByRole("button", { name: /filter_alt_off/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId("change-dot")).not.toBeInTheDocument();
  });

  it("the change dot sits on the Filters tab, not the Columns tab", () => {
    setup({}, { outcome: "success" });
    const filtersTab = screen.getByRole("tab", { name: t("securityLog.filters.tabFilters") });
    const columnsTab = screen.getByRole("tab", { name: t("securityLog.filters.tabColumns") });
    expect(within(filtersTab).getByTestId("change-dot")).toBeInTheDocument();
    expect(within(columnsTab).queryByTestId("change-dot")).not.toBeInTheDocument();
  });
});

describe("action list", () => {
  it("is sorted by translated label and colours nothing it cannot match", () => {
    setup({ actions: ["zz.unknown", "auth.logout", "auth.login.failed"] });
    const labels = ["auth.login.failed", "auth.logout", "zz.unknown"].map((a) =>
      i18n.t(`admin:securityLog.actionLabels.${a.replace(/\./g, "_")}`, { defaultValue: a }),
    ) as string[];
    const expected = [...labels].sort((a, b) => a.localeCompare(b));
    const rendered = expected.map((l) => screen.getByText(l));
    for (let i = 1; i < rendered.length; i++) {
      expect(
        rendered[i - 1].compareDocumentPosition(rendered[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it("lists a duplicate action once", () => {
    setup({ actions: ["auth.logout", "auth.logout"] }, { action: "auth.logout" });
    expect(screen.getAllByText(t("securityLog.actionLabels.auth_logout"))).toHaveLength(1);
  });

  it("checks only the selected action", () => {
    setup({}, { action: "auth.logout" });
    const row = (label: string) =>
      within(screen.getByText(label).closest("[role='button']") as HTMLElement).getByRole(
        "checkbox",
      );
    expect(row(t("securityLog.actionLabels.auth_logout"))).toBeChecked();
    expect(row(t("securityLog.actionLabels.auth_login_failed"))).not.toBeChecked();
  });
});

describe("collapsed rail counts", () => {
  it("counts every active filter", () => {
    setup(
      { collapsed: true },
      {
        q: "x",
        category: "auth",
        outcome: "failure",
        action: "auth.logout",
        actor: "a",
        ip: "1",
        dateFrom: "2026-01-01",
        dateTo: "2026-01-02",
      },
    );
    const rail = screen.getByTestId("security-sidebar-rail");
    expect(within(rail).getByText("8")).toBeInTheDocument();
    expect(within(rail).getByText("chevron_right")).toBeInTheDocument();
    expect(screen.queryByTestId("security-sidebar-resize")).not.toBeInTheDocument();
  });

  it("shows a single active filter as 1", () => {
    setup({ collapsed: true }, { dateTo: "2026-01-02" });
    expect(within(screen.getByTestId("security-sidebar-rail")).getByText("1")).toBeInTheDocument();
  });
});

describe("columns tab detail", () => {
  async function openColumns(over: Partial<Props> = {}) {
    const s = setup(over);
    await s.user.click(screen.getByRole("tab", { name: t("securityLog.filters.tabColumns") }));
    return s;
  }
  const rowOf = (labelKey: string) =>
    screen.getByText(t(labelKey)).closest("[role='button']") as HTMLElement;

  it("renders every column with its glyph, locked ones disabled and the rest enabled", async () => {
    await openColumns();
    for (const c of SECURITY_GRID_COLUMNS) {
      const row = rowOf(c.labelKey);
      expect(within(row).getByText(c.icon)).toBeInTheDocument();
      const box = within(row).getByRole("checkbox");
      expect(box).toBeChecked();
      if (LOCKED_SECURITY_COLUMNS.has(c.id)) {
        expect(row).toHaveAttribute("aria-disabled", "true");
        expect(box).toBeDisabled();
      } else {
        expect(row).not.toHaveAttribute("aria-disabled");
        expect(box).not.toBeDisabled();
      }
    }
    expect(LOCKED_SECURITY_COLUMNS.size).toBe(2);
    expect([...LOCKED_SECURITY_COLUMNS].sort()).toEqual(["action", "created_at"]);
  });

  it("a locked column explains itself on hover", async () => {
    const { user } = await openColumns();
    await user.hover(rowOf("securityLog.columns.when").parentElement!);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      t("securityLog.filters.alwaysVisible"),
    );
  });

  it("unchecks hidden columns and counts what is shown", async () => {
    const visible = new Set(["created_at", "action", "ip", "origin"]);
    await openColumns({ visibleColumns: visible });
    expect(within(rowOf("securityLog.columns.ip")).getByRole("checkbox")).toBeChecked();
    expect(within(rowOf("securityLog.columns.actor")).getByRole("checkbox")).not.toBeChecked();
    expect(
      screen.getByText(t("securityLog.filters.selectedCount", { count: 4 })),
    ).toBeInTheDocument();
    const selectAll = within(rowOf("securityLog.filters.selectAll")).getByRole("checkbox");
    expect(selectAll).not.toBeChecked();
    expect(selectAll).toHaveAttribute("data-indeterminate", "true");
    expect(rowOf("securityLog.filters.selectAll")).not.toHaveAttribute("aria-disabled");
  });

  it("Select all is neither checked nor indeterminate with only the locked columns", async () => {
    await openColumns({ visibleColumns: new Set(LOCKED_SECURITY_COLUMNS) });
    const selectAll = within(rowOf("securityLog.filters.selectAll")).getByRole("checkbox");
    expect(selectAll).not.toBeChecked();
    expect(selectAll).toHaveAttribute("data-indeterminate", "false");
  });

  it("Select all is checked, not indeterminate, with every column shown", async () => {
    await openColumns();
    const selectAll = within(rowOf("securityLog.filters.selectAll")).getByRole("checkbox");
    expect(selectAll).toBeChecked();
    expect(selectAll).toHaveAttribute("data-indeterminate", "false");
  });

  it("toggling a column keeps the others", async () => {
    const visible = new Set(["created_at", "action", "ip"]);
    const { user, onVisibleColumnsChange } = await openColumns({ visibleColumns: visible });
    await user.click(rowOf("securityLog.columns.origin"));
    expect([...(onVisibleColumnsChange.mock.calls.at(-1)![0] as Set<string>)].sort()).toEqual(
      ["action", "created_at", "ip", "origin"],
    );
    // The page's own set is never mutated in place.
    expect([...visible].sort()).toEqual(["action", "created_at", "ip"]);
  });

  it("hides Reset when the page offers none", async () => {
    await openColumns({
      visibleColumns: new Set(["created_at", "action"]),
      onResetColumns: undefined,
    });
    expect(screen.queryByText(t("securityLog.filters.reset"))).not.toBeInTheDocument();
    const columnsTab = screen.getByRole("tab", { name: t("securityLog.filters.tabColumns") });
    expect(within(columnsTab).getByTestId("change-dot")).toBeInTheDocument();
  });

  it("returns to the filters on the Filters tab", async () => {
    const { user } = await openColumns();
    expect(screen.queryByText(t("securityLog.filters.sectionSearch"))).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: t("securityLog.filters.tabFilters") }));
    expect(screen.getByText(t("securityLog.filters.sectionSearch"))).toBeInTheDocument();
    expect(screen.queryByText(t("securityLog.filters.selectAll"))).not.toBeInTheDocument();
  });
});
