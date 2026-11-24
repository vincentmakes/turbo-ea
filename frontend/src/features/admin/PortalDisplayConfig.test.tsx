import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";

import i18n from "@/i18n";
import { renderWithProviders } from "@/test/render";

import PortalDisplayConfig from "./PortalDisplayConfig";
import type { DisplayGroup, DisplayToggles } from "./portalDisplayGroups";

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`admin:${key}`, opts) as string;

const GENERAL: DisplayGroup = {
  key: "general",
  label: "General",
  rows: [
    { key: "description", label: "Description", defaultCard: true, defaultDetail: true },
    { key: "lifecycle", label: "Lifecycle", defaultCard: true, defaultDetail: true },
  ],
};

const BUSINESS: DisplayGroup = {
  key: "section:0",
  label: "Business",
  rows: [
    { key: "field:crit", label: "Criticality", defaultCard: true, defaultDetail: true, filterKey: "field:crit" },
    { key: "field:code", label: "Code", defaultCard: false, defaultDetail: true, filterKey: "field:code" },
    { key: "field:spend", label: "Spend", defaultCard: false, defaultDetail: true },
  ],
};

const COMPLIANCE: DisplayGroup = {
  key: "section:1",
  label: "Compliance",
  rows: [
    { key: "field:risk", label: "Risk", defaultCard: false, defaultDetail: true, filterKey: "field:risk" },
  ],
};

const RELATIONS: DisplayGroup = {
  key: "relations",
  label: "Related Items",
  rows: [
    {
      key: "rel:r1",
      label: "IT Component",
      hint: "uses",
      defaultCard: false,
      defaultDetail: false,
      filterKey: "rel:r1",
    },
  ],
};

/** The table over real state, as the dialog holds it; `onFilters` sees every filter change. */
function Harness({
  initialToggles = {},
  eligible = ["field:crit", "field:code", "field:risk"],
  initialFilters = ["field:crit"],
  onFilters = () => {},
  subtypeRow = false,
  sections = [BUSINESS, COMPLIANCE],
  relations = RELATIONS,
}: {
  initialToggles?: DisplayToggles;
  eligible?: string[];
  initialFilters?: string[];
  onFilters?: (keys: string[], checked: boolean) => void;
  subtypeRow?: boolean;
  sections?: DisplayGroup[];
  relations?: DisplayGroup | null;
}) {
  const [toggles, setToggles] = useState<DisplayToggles>(initialToggles);
  const [picked, setPicked] = useState<string[]>(initialFilters);
  return (
    <>
      <PortalDisplayConfig
        general={GENERAL}
        sections={sections}
        relations={relations}
        subtypeRow={subtypeRow}
        toggles={toggles}
        onTogglesChange={setToggles}
        filters={{
          eligible: new Set(eligible),
          checked: new Set(picked),
          onChange: (keys, checked) => {
            onFilters(keys, checked);
            setPicked((prev) => (checked ? [...prev, ...keys] : prev.filter((k) => !keys.includes(k))));
          },
        }}
      />
      <output data-testid="toggles">{JSON.stringify(toggles)}</output>
    </>
  );
}

const box = (name: string) => screen.getByRole("checkbox", { name });
const groupCard = (section: string) => box(t("webPortals.groupOnCard", { section }));
const groupDetail = (section: string) => box(t("webPortals.groupInDetail", { section }));
const groupFilter = (section: string) => box(t("webPortals.groupAsFilter", { section }));
const rowCard = (item: string) => box(t("webPortals.showOnCard", { item }));
const rowDetail = (item: string) => box(t("webPortals.showInDetail", { item }));
const stored = () => JSON.parse(screen.getByTestId("toggles").textContent ?? "{}");

describe("PortalDisplayConfig", () => {
  it("groups the rows: General, the custom field sections under their heading, then related items", () => {
    renderWithProviders(<Harness />);
    const rows = screen.getAllByRole("row").map((r) => r.textContent);
    expect(rows[1]).toContain("General");
    expect(rows[1]).toContain(t("webPortals.groupCount", { count: 2 }));
    expect(rows[4]).toBe(t("webPortals.customFields"));
    expect(rows[5]).toContain("Business");
    expect(rows[5]).toContain(t("webPortals.groupCount", { count: 3 }));
    expect(rows[rows.length - 2]).toContain("Related Items");
    expect(rows[rows.length - 1]).toContain("IT Component (uses)");
  });

  it("half-fills a group's box while its rows are mixed, ticks them all, then unticks them all", async () => {
    const { user } = renderWithProviders(<Harness />);
    expect(groupCard("Business")).not.toBeChecked();
    expect(groupCard("Business")).toHaveAttribute("data-indeterminate", "true");

    await user.click(groupCard("Business"));
    expect(groupCard("Business")).toBeChecked();
    expect(groupCard("Business")).toHaveAttribute("data-indeterminate", "false");
    for (const item of ["Criticality", "Code", "Spend"]) expect(rowCard(item)).toBeChecked();
    // Each row is written whole, the detail kept at what it showed; other groups untouched.
    expect(stored()).toEqual({
      "field:crit": { card: true, detail: true },
      "field:code": { card: true, detail: true },
      "field:spend": { card: true, detail: true },
    });

    await user.click(groupCard("Business"));
    expect(groupCard("Business")).not.toBeChecked();
    expect(groupCard("Business")).toHaveAttribute("data-indeterminate", "false");
    for (const item of ["Criticality", "Code", "Spend"]) expect(rowCard(item)).not.toBeChecked();
    expect(rowCard("Risk")).not.toBeChecked();
  });

  it("follows its rows: a full column checks the group box, the detail column keeps the card", async () => {
    const { user } = renderWithProviders(<Harness />);
    expect(groupDetail("General")).toBeChecked();
    expect(groupCard("General")).toBeChecked();

    await user.click(rowDetail("Lifecycle"));
    expect(groupDetail("General")).toHaveAttribute("data-indeterminate", "true");
    expect(stored()).toEqual({ lifecycle: { card: true, detail: false } });

    await user.click(groupDetail("General"));
    expect(groupDetail("General")).toBeChecked();
    expect(stored()).toEqual({
      description: { card: true, detail: true },
      lifecycle: { card: true, detail: true },
    });
  });

  it("ticks the eligible filters of a group, and has no filter box where no row can be one", async () => {
    const onFilters = vi.fn();
    const { user } = renderWithProviders(<Harness onFilters={onFilters} />);
    // Criticality ticked, Code not; Spend can never be a filter.
    expect(groupFilter("Business")).toHaveAttribute("data-indeterminate", "true");
    await user.click(groupFilter("Business"));
    expect(onFilters).toHaveBeenLastCalledWith(["field:crit", "field:code"], true);
    expect(groupFilter("Business")).toBeChecked();
    expect(box(t("webPortals.visitorFilterFor", { item: "Code" }))).toBeChecked();

    await user.click(groupFilter("Business"));
    expect(onFilters).toHaveBeenLastCalledWith(["field:crit", "field:code"], false);
    expect(groupFilter("Business")).not.toBeChecked();

    expect(screen.queryByRole("checkbox", { name: t("webPortals.groupAsFilter", { section: "General" }) })).toBeNull();
  });

  it("disables a group's filter box while none of its rows can be a filter now", () => {
    renderWithProviders(<Harness eligible={["field:crit"]} />);
    // The relation is shown nowhere: its row and its group are greyed out.
    expect(groupFilter("Related Items")).toBeDisabled();
    expect(groupFilter("Related Items")).not.toBeChecked();
    expect(box(t("webPortals.visitorFilterFor", { item: "IT Component (uses)" }))).toBeDisabled();
    expect(groupFilter("Business")).toBeEnabled();
  });

  it("reads and writes a group's filters over the rows that can be one now, never the others", async () => {
    const onFilters = vi.fn();
    // Code can be a filter, but not now (shown nowhere): Criticality alone decides.
    const { user } = renderWithProviders(<Harness eligible={["field:crit"]} onFilters={onFilters} />);
    expect(groupFilter("Business")).toBeChecked();
    expect(groupFilter("Business")).toHaveAttribute("data-indeterminate", "false");
    await user.click(groupFilter("Business"));
    expect(onFilters).toHaveBeenLastCalledWith(["field:crit"], false);
    expect(onFilters).toHaveBeenCalledTimes(1);
  });

  it("never shows a filter as ticked while it cannot be one, and says why", async () => {
    const { user } = renderWithProviders(<Harness eligible={[]} initialFilters={["field:crit"]} />);
    const crit = box(t("webPortals.visitorFilterFor", { item: "Criticality" }));
    expect(crit).toBeDisabled();
    expect(crit).not.toBeChecked();
    // The tooltip sits on the span around the checkbox: a disabled control takes no pointer events.
    await user.hover(crit.closest(".MuiCheckbox-root")!.parentElement!);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(t("webPortals.visitorFilterNeedsShown"));
  });

  it("announces a half-filled group as mixed", () => {
    renderWithProviders(<Harness />);
    expect(groupCard("Business")).toHaveAttribute("aria-checked", "mixed");
    expect(groupCard("General")).not.toHaveAttribute("aria-checked");
    expect(groupFilter("Business")).toHaveAttribute("aria-checked", "mixed");
  });

  it("shows no Custom fields heading without sections, and no Related items group without relation types", () => {
    const { unmount } = renderWithProviders(<Harness sections={[]} relations={{ ...RELATIONS, rows: [] }} />);
    expect(screen.queryByText(t("webPortals.customFields"))).toBeNull();
    expect(screen.queryByText("Related Items")).toBeNull();
    expect(screen.getByText("General")).toBeInTheDocument();
    unmount();
    renderWithProviders(<Harness relations={null} />);
    expect(screen.getByText(t("webPortals.customFields"))).toBeInTheDocument();
    expect(screen.queryByText("Related Items")).toBeNull();
  });

  it("folds a group away and back, its box still ticking every row while folded", async () => {
    const { user } = renderWithProviders(<Harness />);
    const fold = screen.getByRole("button", { name: t("webPortals.foldGroup", { section: "Business" }) });
    expect(fold).toHaveAttribute("aria-expanded", "true");
    await user.click(fold);
    expect(screen.queryByText("Criticality")).toBeNull();
    expect(screen.getByText("Risk")).toBeInTheDocument();

    await user.click(groupCard("Business"));
    expect(stored()["field:code"]).toEqual({ card: true, detail: true });

    const unfold = screen.getByRole("button", { name: t("webPortals.unfoldGroup", { section: "Business" }) });
    expect(unfold).toHaveAttribute("aria-expanded", "false");
    await user.click(unfold);
    expect(rowCard("Code")).toBeChecked();
  });

  it("shows the subtype row with its filter box only when asked to", () => {
    const { unmount } = renderWithProviders(<Harness subtypeRow eligible={["subtype"]} initialFilters={["subtype"]} />);
    expect(box(t("webPortals.visitorFilterFor", { item: t("webPortals.subtypeFilterRow") }))).toBeChecked();
    unmount();
    renderWithProviders(<Harness />);
    expect(screen.queryByText(t("webPortals.subtypeFilterRow"))).toBeNull();
  });
});
