/**
 * The Layered Dependency View's Filter button (the funnel): one menu with a
 * Card types section and, below it, a Relation types section.
 *
 * Mounted on its own, never through `LayeredDependencyView`: React Flow cannot
 * lay out under jsdom, so anything rendered inside that view is untestable.
 * The rules pinned here, per section: only what is on the view is listed, a
 * hidden entry stays listed with the count ticking it would bring back, each
 * section's header and Show all count and reset that section alone, and a
 * section with no rows is not rendered. The button's badge sums the hidden
 * entries actually present in both sections. Relation rows are named by verb
 * and card-type pair, so two types sharing a verb can be told apart.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LdvScopeFilter from "./LdvScopeFilter";
import { setViewportWidth } from "@/test/matchMedia";
import { withMetamodel } from "@/test/hooks";
import { CARD_TYPES, makeRelationType } from "@/test/fixtures/metamodel";
import type { CardType } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

/* The types handed to the component carry label = key, so a relation end named
   from them reads "ITComponent"; the metamodel's own (CARD_TYPES) read
   "IT Component" — which tells the two lookups apart. */
function type(key: string, sort_order: number): CardType {
  return {
    key,
    label: key,
    icon: `icon-${key}`,
    color: "#0f7eb5",
    category: "Application & Data",
    sort_order,
    fields_schema: [],
  } as unknown as CardType;
}

const TYPES = [
  type("ITComponent", 3),
  type("Application", 1),
  type("BusinessCapability", 2),
  // Not on the canvas in these tests.
  type("Provider", 4),
];

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

const BUTTON = "Filter the view";
const TYPE_ROWS = [
  "icon-ApplicationApplication7",
  "icon-BusinessCapabilityBusinessCapability3",
  "icon-ITComponentITComponent2",
];
const RELATION_ROWS = [
  "uses · Application → BusinessCapability3",
  "sends data to · Application → Application2",
  "uses · Application → ITComponent4",
];

interface SetupOpts {
  hiddenTypes?: string[];
  hiddenRelations?: string[];
  typeCounts?: Array<[string, number]>;
  relationCounts?: Array<[string, number]>;
  fallbackLabels?: Map<string, string>;
  types?: CardType[];
  container?: Element | null;
}

function setup(opts: SetupOpts = {}) {
  const onTypesChange = vi.fn();
  const onRelationTypesChange = vi.fn();
  render(
    <LdvScopeFilter
      types={opts.types ?? TYPES}
      typeCounts={
        new Map(
          opts.typeCounts ?? [
            ["Application", 7],
            ["BusinessCapability", 3],
            ["ITComponent", 2],
          ],
        )
      }
      hiddenTypeKeys={opts.hiddenTypes ?? []}
      onTypesChange={onTypesChange}
      relationTypes={RELATION_TYPES}
      relationCounts={
        new Map(
          opts.relationCounts ?? [
            ["relAppToITC", 4],
            ["relAppToApp", 2],
            ["relAppToBC", 3],
          ],
        )
      }
      relationFallbackLabels={opts.fallbackLabels}
      hiddenRelationTypeKeys={opts.hiddenRelations ?? []}
      onRelationTypesChange={onRelationTypesChange}
      container={opts.container}
    />,
  );
  return { onTypesChange, onRelationTypesChange };
}

const filterButton = () => screen.getByRole("button", { name: BUTTON });
const badge = () => filterButton().querySelector(".MuiBadge-badge")!;

async function openMenu() {
  await userEvent.click(filterButton());
  return screen.getByRole("menu");
}

const rowTexts = (scope: HTMLElement) =>
  within(scope).getAllByRole("menuitem").map((r) => r.textContent);

/** A section header's hidden-count chip, or null when it shows none. */
function headerCount(scope: HTMLElement, label: string): string | null {
  const header = within(scope).getByText(label);
  return header.querySelector(".MuiChip-label")?.textContent ?? null;
}

const showAllButtons = (scope: HTMLElement) =>
  within(scope).getAllByRole("button", { name: "Show all" });

beforeEach(() => withMetamodel(CARD_TYPES, RELATION_TYPES));
afterEach(() => setViewportWidth(1280));

describe("LdvScopeFilter — one menu, two sections", () => {
  it("lists card types, then relation types, each under its own header and hint", async () => {
    setup();
    const menu = await openMenu();
    expect(rowTexts(menu)).toEqual([...TYPE_ROWS, ...RELATION_ROWS]);
    const cardHeader = within(menu).getByText("Card types");
    const relationHeader = within(menu).getByText("Relation types");
    // The Card types header comes first in the document.
    expect(
      cardHeader.compareDocumentPosition(relationHeader) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(menu).getByText(/^Untick a card type/)).toBeInTheDocument();
    expect(within(menu).getByText(/^Untick a relation type/)).toBeInTheDocument();
    expect(showAllButtons(menu)).toHaveLength(2);
    // One divider, between the two sections.
    expect(menu.querySelectorAll(".MuiDivider-root")).toHaveLength(1);
    // What is not on the view is not offered.
    expect(within(menu).queryByText("Provider")).toBeNull();
    expect(within(menu).queryByText(/provides/)).toBeNull();
  });

  it("counts each section's hidden entries on its own header, and sums them on the badge", () => {
    // Provider and relProviderToITC are keys left over from another diagram:
    // they must not count anywhere.
    setup({
      hiddenTypes: ["Application", "Provider"],
      hiddenRelations: ["relAppToITC", "relAppToBC", "relProviderToITC"],
    });
    expect(badge().textContent).toBe("3");
  });

  it("shows each section's own hidden count in its header", async () => {
    setup({
      hiddenTypes: ["Application", "Provider"],
      hiddenRelations: ["relAppToITC", "relAppToBC", "relProviderToITC"],
    });
    const menu = await openMenu();
    expect(headerCount(menu, "Card types")).toBe("1");
    expect(headerCount(menu, "Relation types")).toBe("2");
  });

  it("badges a hidden card type alone with exactly 1", () => {
    setup({ hiddenTypes: ["BusinessCapability"] });
    expect(badge().textContent).toBe("1");
  });

  it("badges hidden relation types alone with exactly their number", () => {
    setup({ hiddenRelations: ["relAppToITC", "relAppToApp"] });
    expect(badge().textContent).toBe("2");
  });

  it("shows no badge and no header counts when only stale keys are hidden", async () => {
    setup({ hiddenTypes: ["Provider"], hiddenRelations: ["relProviderToITC"] });
    expect(badge()).toHaveClass("MuiBadge-invisible");
    expect(filterButton().textContent).not.toMatch(/\d/);
    const menu = await openMenu();
    expect(headerCount(menu, "Card types")).toBeNull();
    expect(headerCount(menu, "Relation types")).toBeNull();
  });

  it("Show all in the Card types section resets only the card types", async () => {
    const { onTypesChange, onRelationTypesChange } = setup({
      hiddenTypes: ["Application"],
      hiddenRelations: ["relAppToBC"],
    });
    const menu = await openMenu();
    const [typesShowAll, relationsShowAll] = showAllButtons(menu);
    expect(typesShowAll).toBeEnabled();
    expect(relationsShowAll).toBeEnabled();
    await userEvent.click(typesShowAll);
    expect(onTypesChange).toHaveBeenCalledTimes(1);
    expect(onTypesChange).toHaveBeenCalledWith([]);
    expect(onRelationTypesChange).not.toHaveBeenCalled();
  });

  it("Show all in the Relation types section resets only the relation types", async () => {
    const { onTypesChange, onRelationTypesChange } = setup({
      hiddenTypes: ["Application"],
      hiddenRelations: ["relAppToBC"],
    });
    const menu = await openMenu();
    await userEvent.click(showAllButtons(menu)[1]);
    expect(onRelationTypesChange).toHaveBeenCalledTimes(1);
    expect(onRelationTypesChange).toHaveBeenCalledWith([]);
    expect(onTypesChange).not.toHaveBeenCalled();
  });

  it("disables only the Card types Show all when only relation types are hidden", async () => {
    setup({ hiddenRelations: ["relAppToBC"], hiddenTypes: ["Provider"] });
    const menu = await openMenu();
    const [typesShowAll, relationsShowAll] = showAllButtons(menu);
    expect(typesShowAll).toBeDisabled();
    expect(relationsShowAll).toBeEnabled();
  });

  it("disables only the Relation types Show all when only card types are hidden", async () => {
    setup({ hiddenTypes: ["ITComponent"], hiddenRelations: ["relProviderToITC"] });
    const menu = await openMenu();
    const [typesShowAll, relationsShowAll] = showAllButtons(menu);
    expect(typesShowAll).toBeEnabled();
    expect(relationsShowAll).toBeDisabled();
  });

  it("does not render the Relation types section when the view has no lines", async () => {
    setup({ relationCounts: [] });
    const menu = await openMenu();
    expect(within(menu).getByText("Card types")).toBeInTheDocument();
    expect(within(menu).queryByText("Relation types")).toBeNull();
    expect(within(menu).queryByText(/^Untick a relation type/)).toBeNull();
    expect(rowTexts(menu)).toEqual(TYPE_ROWS);
    expect(showAllButtons(menu)).toHaveLength(1);
    expect(menu.querySelectorAll(".MuiDivider-root")).toHaveLength(0);
  });

  it("does not render the Card types section when the view has no cards to list", async () => {
    setup({ typeCounts: [] });
    const menu = await openMenu();
    expect(within(menu).queryByText("Card types")).toBeNull();
    expect(within(menu).queryByText(/^Untick a card type/)).toBeNull();
    expect(within(menu).getByText("Relation types")).toBeInTheDocument();
    expect(rowTexts(menu)).toEqual(RELATION_ROWS);
    expect(showAllButtons(menu)).toHaveLength(1);
    expect(menu.querySelectorAll(".MuiDivider-root")).toHaveLength(0);
  });

  it("follows the view when its counts change after mount", async () => {
    const props = {
      types: TYPES,
      hiddenTypeKeys: [],
      onTypesChange: vi.fn(),
      relationTypes: RELATION_TYPES,
      hiddenRelationTypeKeys: [],
      onRelationTypesChange: vi.fn(),
    };
    const { rerender } = render(
      <LdvScopeFilter
        {...props}
        typeCounts={new Map([["Application", 1]])}
        relationCounts={new Map([["relAppToApp", 1]])}
      />,
    );
    rerender(
      <LdvScopeFilter
        {...props}
        typeCounts={new Map([["Provider", 2]])}
        relationCounts={new Map([["relProviderToITC", 5]])}
      />,
    );
    const menu = await openMenu();
    expect(rowTexts(menu)).toEqual(["icon-ProviderProvider2", "provides · Provider → ITComponent5"]);
  });

  it("closes the menu with Escape", async () => {
    setup();
    await openMenu();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("renders the menu inside the fullscreened element it is given", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    setup({ container: host });
    const menu = await openMenu();
    expect(host.contains(menu)).toBe(true);
    host.remove();
  });
});

describe("LdvScopeFilter — Card types section", () => {
  it("hides a type when its row is unticked", async () => {
    const { onTypesChange, onRelationTypesChange } = setup({ hiddenTypes: ["ITComponent"] });
    const menu = await openMenu();
    await userEvent.click(within(menu).getByText("BusinessCapability"));
    expect(onTypesChange).toHaveBeenCalledWith(["ITComponent", "BusinessCapability"]);
    expect(onRelationTypesChange).not.toHaveBeenCalled();
  });

  it("keeps a hidden type listed, unticked, so it can be brought back", async () => {
    const { onTypesChange } = setup({ hiddenTypes: ["Application", "ITComponent"] });
    const menu = await openMenu();
    const row = within(menu).getByText("Application").closest("li")!;
    expect(within(row).getByRole("checkbox")).not.toBeChecked();
    // Its count still shows what ticking it would restore.
    expect(row.textContent).toBe("icon-ApplicationApplication7");
    const shown = within(menu).getByText("BusinessCapability").closest("li")!;
    expect(within(shown).getByRole("checkbox")).toBeChecked();
    await userEvent.click(within(menu).getByText("Application"));
    expect(onTypesChange).toHaveBeenCalledWith(["ITComponent"]);
  });
});

describe("LdvScopeFilter — Relation types section", () => {
  it("hides a relation type when its row is unticked", async () => {
    const { onTypesChange, onRelationTypesChange } = setup({ hiddenRelations: ["relAppToApp"] });
    const menu = await openMenu();
    await userEvent.click(within(menu).getByText("uses · Application → ITComponent"));
    expect(onRelationTypesChange).toHaveBeenCalledWith(["relAppToApp", "relAppToITC"]);
    expect(onTypesChange).not.toHaveBeenCalled();
  });

  it("keeps a hidden relation type listed, unticked, so it can be brought back", async () => {
    const { onRelationTypesChange } = setup({ hiddenRelations: ["relAppToBC", "relAppToApp"] });
    const menu = await openMenu();
    const row = within(menu).getByText("uses · Application → BusinessCapability").closest("li")!;
    expect(within(row).getByRole("checkbox")).not.toBeChecked();
    expect(row.textContent).toBe("uses · Application → BusinessCapability3");
    const shown = within(menu).getByText("uses · Application → ITComponent").closest("li")!;
    expect(within(shown).getByRole("checkbox")).toBeChecked();
    await userEvent.click(within(menu).getByText("uses · Application → BusinessCapability"));
    expect(onRelationTypesChange).toHaveBeenCalledWith(["relAppToApp"]);
  });

  it("names an unknown key by the line's own label, else by the key, and lists it last", async () => {
    setup({
      relationCounts: [
        ["adHocB", 1],
        ["adHocA", 5],
        ["relAppToITC", 4],
      ],
      fallbackLabels: new Map([["adHocA", "talks to"]]),
    });
    const menu = await openMenu();
    expect(rowTexts(menu).slice(TYPE_ROWS.length)).toEqual([
      "uses · Application → ITComponent4",
      "talks to5",
      "adHocB1",
    ]);
  });

  it("names an unknown key by the key itself when no fallback labels are given", async () => {
    setup({ relationCounts: [["adHocA", 5]] });
    const menu = await openMenu();
    expect(rowTexts(menu).slice(TYPE_ROWS.length)).toEqual(["adHocA5"]);
  });

  it("names an end missing from the types prop from the whole metamodel", async () => {
    // A consumer may pass only the card types on its canvas.
    setup({
      types: [type("Application", 1)],
      typeCounts: [["Application", 1]],
      relationCounts: [["relAppToITC", 4]],
    });
    const menu = await openMenu();
    expect(rowTexts(menu)).toEqual([
      "icon-ApplicationApplication1",
      "uses · Application → IT Component4",
    ]);
  });

  it("falls back to the raw key for an end the metamodel does not know either", async () => {
    withMetamodel([], RELATION_TYPES);
    setup({ types: [], typeCounts: [], relationCounts: [["relAppToITC", 4]] });
    const menu = await openMenu();
    expect(rowTexts(menu)).toEqual(["uses · Application → ITComponent4"]);
  });
});

describe("LdvScopeFilter — phone sheet", () => {
  beforeEach(() => setViewportWidth(500));

  async function openSheet() {
    await userEvent.click(filterButton());
    return screen.getByRole("dialog");
  }

  it("opens as one full-screen sheet holding both sections", async () => {
    const { onTypesChange, onRelationTypesChange } = setup({ hiddenTypes: ["Application"] });
    const sheet = await openSheet();
    // The sheet, not the anchored menu.
    expect(document.querySelector(".MuiMenu-paper")).toBeNull();
    expect(within(sheet).getByText(BUTTON)).toBeInTheDocument();
    expect(within(sheet).getByText("Card types")).toBeInTheDocument();
    expect(within(sheet).getByText("Relation types")).toBeInTheDocument();
    expect(rowTexts(sheet)).toEqual([...TYPE_ROWS, ...RELATION_ROWS]);
    expect(headerCount(sheet, "Card types")).toBe("1");

    await userEvent.click(within(sheet).getByText("uses · Application → ITComponent"));
    expect(onRelationTypesChange).toHaveBeenCalledWith(["relAppToITC"]);
    await userEvent.click(within(sheet).getByText("BusinessCapability"));
    expect(onTypesChange).toHaveBeenCalledWith(["Application", "BusinessCapability"]);
  });

  it("closes with Done", async () => {
    setup();
    const sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes with Escape", async () => {
    setup();
    await openSheet();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("renders inside the fullscreened element it is given", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    setup({ container: host });
    const sheet = await openSheet();
    expect(host.contains(sheet)).toBe(true);
    host.remove();
  });
});
