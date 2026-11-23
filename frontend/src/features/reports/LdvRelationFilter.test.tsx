/**
 * The Layered Dependency View's "Relation types" button.
 *
 * Mounted on its own, never through `LayeredDependencyView` (React Flow cannot
 * lay out under jsdom). The rules it encodes mirror the Card types menu: only
 * relation types drawn on this view are listed, a hidden one stays listed with
 * the count ticking it would bring back, and the badge counts only what is
 * hidden *and* on this view. On top of that, a row is named by its verb and the
 * card-type pair it joins, so two types sharing a verb can be told apart.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import LdvRelationFilter from "./LdvRelationFilter";
import { setViewportWidth } from "@/test/matchMedia";
import { CARD_TYPES, makeRelationType } from "@/test/fixtures/metamodel";

const RELATION_TYPES = [
  makeRelationType({
    key: "relAppToITC",
    label: "uses",
    source_type_key: "Application",
    target_type_key: "ITComponent",
    sort_order: 2,
  }),
  // Same verb as relAppToITC, different pair — the type pair tells them apart.
  makeRelationType({
    key: "relAppToBC",
    label: "uses",
    source_type_key: "Application",
    target_type_key: "BusinessCapability",
    sort_order: 1,
  }),
  // Same sort_order as relAppToITC: the key breaks the tie.
  makeRelationType({
    key: "relAppToApp",
    label: "sends data to",
    source_type_key: "Application",
    target_type_key: "Application",
    sort_order: 2,
  }),
  // Not on the view in these tests.
  makeRelationType({
    key: "relProviderToITC",
    label: "provides",
    source_type_key: "Provider",
    target_type_key: "ITComponent",
    sort_order: 0,
  }),
];

const BUTTON = "Relation types";

function setup(
  opts: {
    hidden?: string[];
    counts?: Array<[string, number]>;
    fallbackLabels?: Map<string, string>;
  } = {},
) {
  const onChange = vi.fn();
  render(
    <LdvRelationFilter
      relationTypes={RELATION_TYPES}
      types={CARD_TYPES}
      relationCounts={
        new Map(
          opts.counts ?? [
            ["relAppToITC", 4],
            ["relAppToApp", 2],
            ["relAppToBC", 3],
          ],
        )
      }
      fallbackLabels={opts.fallbackLabels}
      hiddenRelationTypeKeys={opts.hidden ?? []}
      onChange={onChange}
    />,
  );
  return { onChange };
}

async function openMenu() {
  await userEvent.click(screen.getByRole("button", { name: BUTTON }));
  return screen.getByRole("menu");
}

afterEach(() => setViewportWidth(1280));

describe("LdvRelationFilter", () => {
  it("lists only the relation types on the view, by verb and type pair, in (sort_order, key) order", async () => {
    setup();
    const menu = await openMenu();
    const rows = within(menu).getAllByRole("menuitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      "uses · Application → Business Capability3",
      "sends data to · Application → Application2",
      "uses · Application → IT Component4",
    ]);
    // A relation type with no line here is not offered.
    expect(within(menu).queryByText(/provides/)).toBeNull();
  });

  it("hides a relation type when its row is unticked", async () => {
    const { onChange } = setup({ hidden: ["relAppToApp"] });
    const menu = await openMenu();
    await userEvent.click(within(menu).getByText("uses · Application → IT Component"));
    expect(onChange).toHaveBeenCalledWith(["relAppToApp", "relAppToITC"]);
  });

  it("keeps a hidden relation type listed, unticked, so it can be brought back", async () => {
    const { onChange } = setup({ hidden: ["relAppToBC", "relAppToApp"] });
    const menu = await openMenu();
    const row = within(menu).getByText("uses · Application → Business Capability").closest("li")!;
    expect(within(row).getByRole("checkbox")).not.toBeChecked();
    expect(row.textContent).toContain("3");
    const shown = within(menu).getByText("uses · Application → IT Component").closest("li")!;
    expect(within(shown).getByRole("checkbox")).toBeChecked();
    await userEvent.click(within(menu).getByText("uses · Application → Business Capability"));
    expect(onChange).toHaveBeenCalledWith(["relAppToApp"]);
  });

  it("badges only the hidden relation types that are on this view", () => {
    // relProviderToITC is a key left over from another diagram.
    setup({ hidden: ["relAppToITC", "relAppToBC", "relProviderToITC"] });
    expect(screen.getByRole("button", { name: BUTTON }).textContent).toContain("2");
    expect(screen.getByRole("button", { name: BUTTON }).textContent).not.toContain("3");
  });

  it("shows nothing on the badge when only a stale key is hidden", () => {
    setup({ hidden: ["relProviderToITC"] });
    expect(screen.getByRole("button", { name: BUTTON }).textContent).not.toMatch(/\d/);
  });

  it("restores every relation type with Show all", async () => {
    const { onChange } = setup({ hidden: ["relAppToITC"] });
    const menu = await openMenu();
    const showAll = within(menu).getByRole("button", { name: "Show all" });
    expect(showAll).toBeEnabled();
    await userEvent.click(showAll);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("disables Show all when nothing on this view is hidden", async () => {
    setup({ hidden: ["relProviderToITC"] });
    const menu = await openMenu();
    expect(within(menu).getByRole("button", { name: "Show all" })).toBeDisabled();
  });

  it("names a relation type the metamodel does not know by the line's own label, else its key", async () => {
    setup({
      counts: [
        ["adHocB", 1],
        ["adHocA", 5],
        ["relAppToITC", 4],
      ],
      fallbackLabels: new Map([["adHocA", "talks to"]]),
    });
    const menu = await openMenu();
    const rows = within(menu).getAllByRole("menuitem");
    // Known types first, then unknown keys in key order.
    expect(rows.map((r) => r.textContent)).toEqual([
      "uses · Application → IT Component4",
      "talks to5",
      "adHocB1",
    ]);
  });

  it("opens as a full-screen sheet on a phone", async () => {
    setViewportWidth(500);
    const { onChange } = setup();
    await userEvent.click(screen.getByRole("button", { name: BUTTON }));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByText(BUTTON)).toBeInTheDocument();
    await userEvent.click(within(sheet).getByText("uses · Application → IT Component"));
    expect(onChange).toHaveBeenCalledWith(["relAppToITC"]);
  });
});
