/**
 * Tests for the shared reference-catalogue tree browser.
 *
 * The browser is pure presentation over a `CatalogueNode[]` it is handed: it
 * indexes the tree, filters it (search, level, industry, deprecated), tracks
 * which branches are open, and reports a subtree selection to its owner. The
 * selection is controlled, so the tests mount it under a small harness that
 * keeps the `Set` in state the way `CataloguePage` does.
 */
import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";

import i18n from "@/i18n";
import { renderWithProviders } from "@/test/render";

import CatalogueBrowser from "./CatalogueBrowser";
import type { CatalogueKindConfig, CatalogueNode } from "./types";

/* ------------------------------------------------------------------------- */
/*  Fixtures                                                                  */
/* ------------------------------------------------------------------------- */

const CONFIG: CatalogueKindConfig = {
  kind: "capability",
  basePath: "/capability-catalogue",
  payloadKey: "capabilities",
  idPrefix: "BC-",
  i18nNamespace: "catalogue",
  inventoryCardType: "BusinessCapability",
  accentColor: "#003399",
  selectionColor: "#D63384",
  levelLabel: (level) => (level === 0 ? "Macro" : `L${level}`),
  heroIcon: "account_tree",
};

function node(overrides: Partial<CatalogueNode> & { id: string; name: string; level: number }): CatalogueNode {
  return { parent_id: null, description: null, existing_card_id: null, ...overrides };
}

/**
 * Finance (Cross-Industry)
 *   Billing
 *     Invoicing
 *   Treasury            ← already a card
 * Sales (Retail)
 *   Lead Management     ← deprecated
 * Manufacturing (Manufacturing; Automotive)
 */
const NODES: CatalogueNode[] = [
  node({ id: "BC-1", name: "Finance", level: 1, industry: "Cross-Industry", description: "Money in, money out." }),
  node({ id: "BC-1.1", name: "Billing", level: 2, parent_id: "BC-1", industry: "Cross-Industry", aliases: ["Invoicing ops"] }),
  node({ id: "BC-1.1.1", name: "Invoicing", level: 3, parent_id: "BC-1.1", industry: "Cross-Industry" }),
  node({ id: "BC-1.2", name: "Treasury", level: 2, parent_id: "BC-1", industry: "Cross-Industry", existing_card_id: "ca4d0000-0000-4000-8000-000000000001" }),
  node({ id: "BC-2", name: "Sales", level: 1, industry: "Retail" }),
  node({ id: "BC-2.1", name: "Lead Management", level: 2, parent_id: "BC-2", industry: "Retail", deprecated: true }),
  node({ id: "BC-3", name: "Manufacturing", level: 1, industry: "Manufacturing; Automotive" }),
];

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`cards:catalogue.${key}`, opts) as string;

/** `CatalogueBrowser` under the controlled selection its page gives it. */
function Harness({
  data = NODES,
  initial = new Set<string>(),
  onSelectedChange = () => {},
  onOpenDetail = () => {},
}: {
  data?: CatalogueNode[];
  initial?: Set<string>;
  onSelectedChange?: (next: Set<string>) => void;
  onOpenDetail?: (id: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(initial);
  return (
    <CatalogueBrowser
      data={data}
      selected={selected}
      onSelectedChange={(next) => {
        setSelected(next);
        onSelectedChange(next);
      }}
      onOpenDetail={onOpenDetail}
      config={CONFIG}
    />
  );
}

function renderBrowser(props: Parameters<typeof Harness>[0] = {}) {
  return renderWithProviders(<Harness {...props} />);
}

const actionBar = () => document.querySelector(".tcc-action-bar")!.textContent ?? "";
const rowName = (name: string) => screen.getByRole("button", { name });
const selectBox = (id: string, name: string) => screen.getByRole("checkbox", { name: `Select ${id} ${name}` });
const chevronFor = (name: string) => {
  const row = rowName(name).closest(".tcc-row")!;
  return within(row as HTMLElement).getByRole("button", { name: /^(Expand|Collapse)$/ });
};

/* ------------------------------------------------------------------------- */
/*  Rendering                                                                 */
/* ------------------------------------------------------------------------- */

describe("CatalogueBrowser — tree", () => {
  it("groups the roots by their first industry, Cross-Industry first, and opens L1 by default", () => {
    renderBrowser();

    const headings = Array.from(document.querySelectorAll(".MuiTypography-overline"))
      .map((el) => el.textContent)
      .filter((text) => text !== t("levelLabel"));
    expect(headings).toEqual(["Cross-Industry", "Manufacturing", "Retail"]);

    expect(rowName("Finance")).toBeInTheDocument();
    expect(rowName("Billing")).toBeInTheDocument();
    expect(rowName("Treasury")).toBeInTheDocument();
    // Billing is an L2 and starts collapsed, so its child stays hidden.
    expect(screen.queryByRole("button", { name: "Invoicing" })).not.toBeInTheDocument();
    // Deprecated entries are hidden until asked for.
    expect(screen.queryByRole("button", { name: "Lead Management" })).not.toBeInTheDocument();
  });

  it("counts the matches against the whole catalogue", () => {
    renderBrowser();
    expect(actionBar()).toContain(`6 ${t("matchCount", { count: 6 })} · 7 ${t("total")}`);
    expect(actionBar()).not.toContain(t("selectedLabel"));
  });

  it("renders every level as a chip plus the Macro tier when present", () => {
    renderBrowser({
      data: [node({ id: "MC-10", name: "Run the business", level: 0 }), ...NODES.map((n) => (n.id === "BC-1" ? { ...n, parent_id: "MC-10" } : n))],
    });
    for (const label of ["Macro", "L1", "L2", "L3"]) {
      expect(screen.getByText(label, { selector: ".MuiChip-label" })).toBeInTheDocument();
    }
    // With a macro tier the roots are the macros, opened so their L1s show.
    expect(rowName("Run the business")).toBeInTheDocument();
    expect(rowName("Finance")).toBeInTheDocument();
    // An L1 under a macro is an ordinary row and starts collapsed.
    expect(screen.queryByRole("button", { name: "Billing" })).not.toBeInTheDocument();
  });

  it("files roots without an industry under the General group, after the named ones", () => {
    renderBrowser({
      data: [
        node({ id: "weird id", name: "Unparseable", level: 1 }),
        node({ id: "ZZ-2", name: "Zed two", level: 1 }),
        node({ id: "ZZ-1", name: "Zed one", level: 1 }),
        node({ id: "BC-10", name: "Ten", level: 1, industry: "Retail" }),
        node({ id: "BC-9", name: "Nine", level: 1, industry: "Retail" }),
      ],
    });
    const headings = Array.from(document.querySelectorAll(".MuiTypography-overline"))
      .map((el) => el.textContent)
      .filter((text) => text !== t("levelLabel"));
    expect(headings).toEqual(["Retail", t("industryGroupUnknown")]);
    // Numeric segments sort numerically (9 before 10) and families
    // alphabetically. Current behaviour, documented rather than endorsed: an id
    // that does not parse is given the family "~" — ASCII-last, so evidently
    // meant to sort last — but families are compared with `localeCompare`,
    // under which punctuation collates BEFORE letters, so it lands ahead of
    // the "ZZ" family instead.
    const names = Array.from(document.querySelectorAll(".tcc-l1-name")).map((el) => el.textContent);
    expect(names).toEqual(["Nine", "Ten", "Unparseable", "Zed one", "Zed two"]);
  });

  it("marks an entry that is already a card with a tick instead of a checkbox", () => {
    renderBrowser();
    expect(screen.queryByRole("checkbox", { name: "Select BC-1.2 Treasury" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Already a card: Treasury")).toBeInTheDocument();
    expect(selectBox("BC-1.1", "Billing")).toBeInTheDocument();
  });

  it("opens the detail of whichever name is clicked", async () => {
    const onOpenDetail = vi.fn();
    const { user } = renderBrowser({ onOpenDetail });
    await user.click(rowName("Finance"));
    expect(onOpenDetail).toHaveBeenLastCalledWith("BC-1");
    await user.click(rowName("Billing"));
    expect(onOpenDetail).toHaveBeenLastCalledWith("BC-1.1");
  });
});

/* ------------------------------------------------------------------------- */
/*  Expand / collapse                                                         */
/* ------------------------------------------------------------------------- */

describe("CatalogueBrowser — expand and collapse", () => {
  it("toggles one branch through its chevron", async () => {
    const { user } = renderBrowser();
    await user.click(chevronFor("Billing"));
    expect(rowName("Invoicing")).toBeInTheDocument();
    await user.click(chevronFor("Billing"));
    expect(screen.queryByRole("button", { name: "Invoicing" })).not.toBeInTheDocument();
  });

  it("expands and collapses everything at once", async () => {
    const { user } = renderBrowser();
    await user.click(screen.getByRole("button", { name: t("expandAll") }));
    expect(rowName("Invoicing")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: t("collapseAll") }));
    expect(screen.queryByRole("button", { name: "Invoicing" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Billing" })).not.toBeInTheDocument();
    expect(rowName("Finance")).toBeInTheDocument();
  });

  it("steps the whole tree one level at a time", async () => {
    const { user } = renderBrowser();
    const stepper = screen.getByRole("group", { name: "Expand by level" });
    const expand = within(stepper).getByRole("button", { name: "Expand one level" });
    const collapse = within(stepper).getByRole("button", { name: "Collapse one level" });

    // L1 is open, L2 is not: depth 1 of 3.
    expect(stepper).toHaveTextContent(t("levelStepper", { current: 2, max: 3 }));
    await user.click(expand);
    expect(rowName("Invoicing")).toBeInTheDocument();
    expect(stepper).toHaveTextContent(t("levelStepper", { current: 3, max: 3 }));
    expect(expand).toBeDisabled();

    await user.click(collapse);
    expect(screen.queryByRole("button", { name: "Invoicing" })).not.toBeInTheDocument();
    await user.click(collapse);
    expect(screen.queryByRole("button", { name: "Billing" })).not.toBeInTheDocument();
    expect(collapse).toBeDisabled();
  });

  it("steps a single L1 branch independently", async () => {
    const { user } = renderBrowser();
    const finance = rowName("Finance").closest("section")!;
    const expand = within(finance).getByRole("button", { name: t("expandOneLevel") });
    const collapse = within(finance).getByRole("button", { name: t("collapseOneLevel") });
    const sales = rowName("Sales").closest("section")!;
    // Sales has no expandable children, so it can only ever collapse.
    expect(within(sales).getByRole("button", { name: t("expandOneLevel") })).toBeDisabled();

    await user.click(expand);
    expect(rowName("Invoicing")).toBeInTheDocument();
    expect(expand).toBeDisabled();

    await user.click(collapse);
    expect(screen.queryByRole("button", { name: "Invoicing" })).not.toBeInTheDocument();
    expect(rowName("Billing")).toBeInTheDocument();
    await user.click(collapse);
    expect(screen.queryByRole("button", { name: "Billing" })).not.toBeInTheDocument();
    // Other branches are untouched.
    expect(rowName("Sales")).toBeInTheDocument();
    expect(collapse).toBeDisabled();
  });
});

/* ------------------------------------------------------------------------- */
/*  Filters                                                                   */
/* ------------------------------------------------------------------------- */

describe("CatalogueBrowser — filters", () => {
  it("searches id, name, description and aliases on the raw input and keeps ancestors for context", async () => {
    const { user } = renderBrowser();
    const search = screen.getByPlaceholderText(t("searchPlaceholder"));

    await user.type(search, "invoic");
    // Both Billing (alias) and Invoicing (name) match; Finance stays as their ancestor.
    expect(actionBar()).toContain(`2 ${t("matchCount", { count: 2 })} · 7 ${t("total")}`);
    expect(rowName("Finance")).toBeInTheDocument();
    expect(rowName("Billing")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sales" })).not.toBeInTheDocument();
    await user.click(chevronFor("Billing"));
    expect(rowName("Invoicing")).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "money out");
    expect(actionBar()).toContain(`1 ${t("matchCount", { count: 1 })}`);
    expect(rowName("Finance")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Billing" })).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "bc-3");
    expect(rowName("Manufacturing")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finance" })).not.toBeInTheDocument();
  });

  it("shows the empty state when nothing matches and resets", async () => {
    const { user } = renderBrowser();
    await user.type(screen.getByPlaceholderText(t("searchPlaceholder")), "zzz");
    expect(screen.getByText(t("noMatches"))).toBeInTheDocument();
    expect(screen.getByText(t("adjustFilters"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("selectVisible") })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: t("resetFilters") }));
    expect(screen.queryByText(t("noMatches"))).not.toBeInTheDocument();
    expect(rowName("Finance")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(t("searchPlaceholder"))).toHaveValue("");
  });

  it("narrows by level through the chips", async () => {
    const { user } = renderBrowser();
    await user.click(screen.getByText("L2", { selector: ".MuiChip-label" }));
    await user.click(screen.getByText("L3", { selector: ".MuiChip-label" }));
    expect(actionBar()).toContain(`3 ${t("matchCount", { count: 3 })}`);
    expect(rowName("Finance")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Billing" })).not.toBeInTheDocument();

    // Dropping L1 as well does not hide the roots: they stay as ancestors of nothing,
    // so the tree is empty.
    await user.click(screen.getByText("L1", { selector: ".MuiChip-label" }));
    expect(screen.getByText(t("noMatches"))).toBeInTheDocument();
  });

  it("includes deprecated entries only when asked", async () => {
    const { user } = renderBrowser();
    await user.click(screen.getByText(t("deprecatedToggle"), { selector: ".MuiChip-label" }));
    expect(rowName("Lead Management")).toBeInTheDocument();
    expect(screen.getByText("Dep.")).toBeInTheDocument();
    // Everything matches now, so the "total" suffix disappears.
    expect(actionBar()).toContain(`7 ${t("matchCount", { count: 7 })}`);
    expect(actionBar()).not.toContain(t("total"));
  });

  it("filters by industry from the dropdown and clears it again", async () => {
    const { user } = renderBrowser();
    const trigger = screen.getByRole("button", { name: new RegExp(`${t("industryTriggerLabel")}.*${t("industryValueAll")}`) });
    await user.click(trigger);

    const menu = await screen.findByRole("menu");
    const rows = within(menu).getAllByRole("menuitem").map((m) => m.textContent);
    // Cross-Industry is pinned to the top; the rest is alphabetical and split per ";".
    expect(rows).toEqual(["Cross-Industry", "Automotive", "Manufacturing", "Retail"]);

    // Picking an industry keeps the menu open (it is modal, so the tree behind
    // it is aria-hidden); close it before reading the tree.
    await user.click(within(menu).getByRole("menuitem", { name: "Retail" }));
    await user.keyboard("{Escape}");
    expect(rowName("Sales")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finance" })).not.toBeInTheDocument();
    expect(trigger).toHaveTextContent("Retail");

    await user.click(trigger);
    await user.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: "Automotive" }));
    await user.keyboard("{Escape}");
    expect(rowName("Manufacturing")).toBeInTheDocument();
    expect(rowName("Sales")).toBeInTheDocument();
    expect(trigger).toHaveTextContent(t("industryValueNSelected", { count: 2 }));

    // "Clear (n)" empties the filter and closes the menu on its own.
    await user.click(trigger);
    await user.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", { name: t("industryClearN", { count: 2 }) }),
    );
    expect(rowName("Finance")).toBeInTheDocument();
    expect(trigger).toHaveTextContent(t("industryValueAll"));
  });

  it("hides the industry filter when there is only one industry", () => {
    renderBrowser({ data: NODES.filter((n) => n.industry === "Cross-Industry") });
    expect(screen.queryByText(t("industryTriggerLabel"))).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------- */
/*  Selection                                                                 */
/* ------------------------------------------------------------------------- */

describe("CatalogueBrowser — selection", () => {
  it("selects a node with its visible, creatable subtree and deselects the same way", async () => {
    const onSelectedChange = vi.fn();
    const { user } = renderBrowser({ onSelectedChange });

    await user.click(selectBox("BC-1", "Finance"));
    // Treasury is already a card, so it is skipped; a collapsed descendant still counts.
    expect(onSelectedChange).toHaveBeenLastCalledWith(new Set(["BC-1", "BC-1.1", "BC-1.1.1"]));
    expect(actionBar()).toContain(`3 ${t("selectedLabel")}`);
    expect(selectBox("BC-1", "Finance")).toBeChecked();
    expect(selectBox("BC-1.1", "Billing")).toBeChecked();
    expect(rowName("Finance").closest("section")).toHaveClass("is-selected");

    await user.click(selectBox("BC-1", "Finance"));
    expect(onSelectedChange).toHaveBeenLastCalledWith(new Set());
    expect(selectBox("BC-1.1", "Billing")).not.toBeChecked();
  });

  it("marks a root indeterminate when only part of its subtree is selected", async () => {
    const { user } = renderBrowser();
    await user.click(selectBox("BC-1.1", "Billing"));
    const finance = selectBox("BC-1", "Finance") as HTMLInputElement;
    expect(finance).not.toBeChecked();
    expect(finance.indeterminate).toBe(true);
    expect(rowName("Billing").closest(".tcc-row")).toHaveClass("is-selected");
  });

  it("leaves a filtered-out descendant alone when selecting its ancestor", async () => {
    const onSelectedChange = vi.fn();
    const { user } = renderBrowser({ onSelectedChange });
    await user.click(screen.getByText("L3", { selector: ".MuiChip-label" }));
    await user.click(selectBox("BC-1", "Finance"));
    expect(onSelectedChange).toHaveBeenLastCalledWith(new Set(["BC-1", "BC-1.1"]));
  });

  it("selects everything visible and clears the selection", async () => {
    const onSelectedChange = vi.fn();
    const { user } = renderBrowser({ onSelectedChange });
    const clear = screen.getByRole("button", { name: t("clearSelection") });
    expect(clear).toBeDisabled();

    await user.click(screen.getByRole("button", { name: t("selectVisible") }));
    expect(onSelectedChange).toHaveBeenLastCalledWith(
      new Set(["BC-1", "BC-1.1", "BC-1.1.1", "BC-2", "BC-3"]),
    );
    expect(actionBar()).toContain(`5 ${t("selectedLabel")}`);

    await user.click(clear);
    expect(onSelectedChange).toHaveBeenLastCalledWith(new Set());
    expect(clear).toBeDisabled();
  });

  it("keeps a selection made before a filter narrowed the view", async () => {
    const { user } = renderBrowser({ initial: new Set(["BC-2"]) });
    expect(selectBox("BC-2", "Sales")).toBeChecked();
    await user.type(screen.getByPlaceholderText(t("searchPlaceholder")), "finance");
    expect(actionBar()).toContain(`1 ${t("selectedLabel")}`);
  });
});
