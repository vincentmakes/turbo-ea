/**
 * The Card Layout editor as the metamodel drawer mounts it: every action is an
 * immediate `PATCH /metamodel/types/{key}` (there is no Save button) followed
 * by `onRefresh`, so each test scripts the patch route and asserts the body of
 * the LAST patch it provoked.
 *
 * Drags are keyboard-driven through dnd-kit's `KeyboardSensor` (Space picks
 * up, Arrow keys move, Space drops, Escape cancels). jsdom reports a zero rect
 * for everything, so `stubLayout()` hands every sortable root and every
 * droppable container a distinct band stacked in DOM order; an Arrow key then
 * lands on "the next droppable in reading order". The `DragOverlay` is the one
 * exception: dnd-kit measures *it* as the dragged rect and positions it at the
 * active item's initial rect, so the stub reads that position back off the
 * overlay's inline style instead of giving it a band of its own.
 *
 * `moveFieldBetweenSections` has its own test (`CardLayoutEditor.test.ts`),
 * and `GroupTranslationsDialog` has `GroupTranslationsDialog.test.tsx`; here
 * both are reached through the editor.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import { makeCardType, makeField, makeSection } from "@/test/fixtures/metamodel";
import type { CardType, FieldDef, SectionConfig, SectionDef } from "@/types";
import CardLayoutEditor from "./CardLayoutEditor";

/* ------------------------------------------------------------------------- */
/*  Fixture                                                                   */
/* ------------------------------------------------------------------------- */

const DESCRIPTION_SECTION = makeSection({
  section: "__description",
  fields: [
    makeField({ key: "alias", label: "Alias", type: "text" }),
    makeField({ key: "code", label: "Code", type: "text" }),
  ],
});

// A two-column section with two grouped fields, an explicit empty group and a
// translated group header — the whole vocabulary of `fieldsToContainers`.
const DETAILS_SECTION = makeSection({
  section: "Details",
  columns: 2,
  groups: ["Grp", "Second", "Empty"],
  groupTranslations: { Grp: { de: "Gruppe" } },
  translations: { de: "Einzelheiten" },
  fields: [
    makeField({ key: "alpha", label: "Alpha", type: "text", required: true, weight: 2, column: 0 }),
    makeField({ key: "beta", label: "Beta", type: "number", column: 0 }),
    makeField({ key: "gamma", label: "Gamma", type: "single_select", column: 0, group: "Grp" }),
    makeField({ key: "sigma", label: "Sigma", type: "boolean", column: 0, group: "Second" }),
    makeField({ key: "delta", label: "Delta", type: "cost", column: 1 }),
  ],
});

const EXTRA_SECTION = makeSection({
  section: "Extra",
  fields: [makeField({ key: "epsilon", label: "Epsilon", type: "date" })],
});

// A saved order that predates `custom:1`, `tags` and `successors`, so the
// editor has to append / inject them; `eol` hidden; `Extra` configured under
// the legacy label key; a data-quality weight on Description.
const SAVED_CONFIG = {
  __order: ["description", "eol", "lifecycle", "custom:0", "hierarchy", "relations"],
  eol: { hidden: true },
  Extra: { defaultExpanded: false },
  __dataQuality: { description: 2 },
} as unknown as Record<string, SectionConfig>;

const TYPE: CardType = makeCardType({
  key: "Widget",
  label: "Widget",
  has_hierarchy: true,
  has_successors: true,
  fields_schema: [DESCRIPTION_SECTION, DETAILS_SECTION, EXTRA_SECTION],
  section_config: SAVED_CONFIG,
});

const PATCH_PATH = `/metamodel/types/${TYPE.key}`;

interface PatchBody {
  fields_schema?: SectionDef[];
  section_config?: Record<string, unknown> & { __order?: string[] };
}

function lastPatch(): PatchBody {
  const calls = mockApi.callsOf("patch");
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1].body as PatchBody;
}

const keysOf = (fields: FieldDef[] | undefined) => (fields ?? []).map((f) => f.key);
const byKey = (fields: FieldDef[] | undefined, key: string) => {
  const f = (fields ?? []).find((x) => x.key === key);
  if (!f) throw new Error(`no field ${key}`);
  return f;
};

interface Callbacks {
  onRefresh: Mock<() => void>;
  openAddField: Mock<(si: number) => void>;
  openEditField: Mock<(si: number, fi: number) => void>;
  promptDeleteField: Mock<(si: number, fi: number) => void>;
  promptDeleteSection: Mock<(si: number) => void> | undefined;
}

function setup(
  overrides: { cardType?: CardType; calculatedFieldKeys?: string[]; promptDeleteSection?: false } = {},
) {
  const cardType = overrides.cardType ?? TYPE;
  const cb: Callbacks = {
    onRefresh: vi.fn<() => void>(),
    openAddField: vi.fn<(si: number) => void>(),
    openEditField: vi.fn<(si: number, fi: number) => void>(),
    promptDeleteField: vi.fn<(si: number, fi: number) => void>(),
    promptDeleteSection: overrides.promptDeleteSection === false ? undefined : vi.fn<(si: number) => void>(),
  };
  const element = (type: CardType) => (
    <CardLayoutEditor
      cardType={type}
      onRefresh={cb.onRefresh}
      openAddField={cb.openAddField}
      openEditField={cb.openEditField}
      promptDeleteField={cb.promptDeleteField}
      promptDeleteSection={cb.promptDeleteSection}
      calculatedFieldKeys={overrides.calculatedFieldKeys ?? []}
    />
  );
  const utils = renderWithProviders(element(cardType));
  return { ...utils, ...cb, rerenderWith: (type: CardType) => utils.rerender(element(type)) };
}

/* ------------------------------------------------------------------------- */
/*  DOM helpers                                                               */
/* ------------------------------------------------------------------------- */

/** Every sortable root carries an inline `opacity` from `useSortable`. */
const SORTABLE_ROOT = '[style*="opacity"]';

/** The section row whose header reads `label`. */
function sectionRoot(label: string): HTMLElement {
  const header = screen
    .getAllByText(label, { selector: "p" })
    .find((el) => el.closest(SORTABLE_ROOT) !== null);
  if (!header) throw new Error(`no section ${label}`);
  return header.closest(SORTABLE_ROOT) as HTMLElement;
}

/** The section rows (top-level sortable roots) by their header label, in order. */
function sectionHeaders(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>(SORTABLE_ROOT))
    .filter((el) => el.parentElement?.closest(SORTABLE_ROOT) === null)
    .map((el) => el.querySelector("p")?.textContent ?? "");
}

/** The sortable root of the field card labelled `label`. */
function fieldRoot(label: string, scope: HTMLElement = document.body): HTMLElement {
  return within(scope).getByText(label, { selector: "p" }).closest(SORTABLE_ROOT) as HTMLElement;
}

/** The sortable root of the group headed `name`, inside `scope`. */
function groupRoot(name: string, scope: HTMLElement): HTMLElement {
  return within(scope).getByText(name, { selector: "p" }).closest(SORTABLE_ROOT) as HTMLElement;
}

/** The first drag handle inside `root` is the root's own (a header precedes its children). */
function handleOf(root: HTMLElement): HTMLElement {
  return within(root).getAllByRole("button", { name: "drag_indicator" })[0];
}

/** The droppable column labelled "Column N" inside a section. */
function columnOf(section: HTMLElement, label: string): HTMLElement {
  return within(section).getByText(label, { selector: "p" }).parentElement as HTMLElement;
}

/** The field labels rendered directly inside a container, in DOM order. */
function labelsIn(container: HTMLElement, candidates: string[]): string[] {
  return Array.from(container.querySelectorAll("p"))
    .map((p) => p.textContent ?? "")
    .filter((t) => candidates.includes(t));
}

const BAND = 40;
const ROW = 36;

function rectAt(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

/**
 * Elements that take part in a drag: sortable roots (inline `opacity`) and
 * their parents (the droppable columns and group bodies). Pre-order, so a
 * container's band sits just above its first child's.
 */
function layoutElements(): Element[] {
  const out: Element[] = [];
  for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
    const own = el.style.opacity !== "";
    const parent = Array.from(el.children).some((c) => (c as HTMLElement).style?.opacity !== "");
    if (own || parent) out.push(el);
  }
  return out;
}

function stubLayout(): () => void {
  const spy = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      // dnd-kit's DragOverlay: a `position: fixed` wrapper at the active item's
      // initial rect. It is what the collision rect is derived from, so it must
      // report exactly where the active item was — and dnd-kit measures the
      // wrapper's single CHILD (`getMeasurableNode`), so the child answers for
      // its host.
      const host = this.closest<HTMLElement>('[style*="position: fixed"]');
      if (host) {
        return rectAt(
          parseFloat(host.style.left) || 0,
          parseFloat(host.style.top) || 0,
          parseFloat(host.style.width) || 200,
          parseFloat(host.style.height) || ROW,
        );
      }
      const index = layoutElements().indexOf(this);
      // Anything else is a zero-size rect far below the page: never a
      // collision, and only a keyboard target when nothing else is left.
      if (index < 0) return rectAt(0, 1_000_000, 0, 0);
      return rectAt(0, BAND + index * BAND, 200, ROW);
    });
  return () => spy.mockRestore();
}

/* ------------------------------------------------------------------------- */

beforeEach(() => {
  mockApi.reset();
  mockApi.on("patch", PATCH_PATH, (_path, body) => ({ ...TYPE, ...(body as object) }));
});

describe("CardLayoutEditor — rendering", () => {
  it("lists the sections in the saved order, appending and injecting what the order predates", () => {
    setup();
    expect(sectionHeaders()).toEqual([
      "Description",
      "End of Life",
      "Lifecycle",
      "Details",
      "Hierarchy",
      "Lineage",
      "Tags",
      "Relations",
      "Extra",
    ]);
    expect(screen.getByText("Card Layout")).toBeInTheDocument();
    expect(screen.getByText("Drag sections to reorder...")).toBeInTheDocument();
  });

  it("falls back to the default order and skips hierarchy and lineage when the type has neither", () => {
    const flat = makeCardType({
      key: "Flat",
      fields_schema: [makeSection({ section: "Only", fields: [] })],
    });
    setup({ cardType: flat });
    expect(sectionHeaders()).toEqual(["Description", "End of Life", "Lifecycle", "Only", "Tags", "Relations"]);
  });

  it("drops hierarchy and lineage from a saved order the type cannot show, and ignores stale or unknown keys", () => {
    const stale = makeCardType({
      key: "Stale",
      fields_schema: [makeSection({ section: "Only", fields: [] })],
      section_config: {
        __order: ["lifecycle", "hierarchy", "successors", "custom:0", "custom:7", "bogus", "description", "relations"],
      } as unknown as Record<string, SectionConfig>,
    });
    setup({ cardType: stale });
    expect(sectionHeaders()).toEqual(["Lifecycle", "Only", "Description", "Tags", "Relations"]);
  });

  it("appends lineage and tags when a saved order has no relations entry to anchor them on", () => {
    const anchorless = makeCardType({
      key: "Anchorless",
      has_successors: true,
      fields_schema: [makeSection({ section: "Only", fields: [] })],
      section_config: { __order: ["custom:0", "description"] } as unknown as Record<string, SectionConfig>,
    });
    setup({ cardType: anchorless });
    expect(sectionHeaders()).toEqual(["Only", "Description", "Lineage", "Tags"]);
  });

  it("renders the Description section's protected built-ins plus its own fields", () => {
    setup();
    const description = sectionRoot("Description");
    expect(within(description).getByText("Name")).toBeInTheDocument();
    expect(within(description).getAllByText("Description", { selector: "p" }).length).toBeGreaterThan(1);
    expect(within(description).getByText("Alias")).toBeInTheDocument();
    expect(within(description).getByText("Code")).toBeInTheDocument();
    // The built-ins carry no edit / delete affordance; the custom fields do.
    expect(within(fieldRoot("Alias")).getByRole("button", { name: "edit" })).toBeInTheDocument();
    const nameCard = within(description).getByText("Name").closest("div") as HTMLElement;
    expect(within(nameCard).queryByRole("button", { name: "edit" })).not.toBeInTheDocument();
  });

  it("lays a custom section out as columns and groups, with the empty group inviting a drop", () => {
    setup();
    const details = sectionRoot("Details");
    const col0 = columnOf(details, "Column 1");
    const col1 = columnOf(details, "Column 2");
    expect(labelsIn(col0, ["Alpha", "Beta", "Gamma", "Sigma", "Delta"])).toEqual(["Alpha", "Beta", "Gamma", "Sigma"]);
    expect(labelsIn(col1, ["Alpha", "Beta", "Gamma", "Sigma", "Delta"])).toEqual(["Delta"]);
    expect(within(groupRoot("Grp", details)).getByText("Gamma")).toBeInTheDocument();
    expect(within(groupRoot("Second", details)).getByText("Sigma")).toBeInTheDocument();
    expect(within(groupRoot("Empty", details)).getByText("Drag fields here")).toBeInTheDocument();
    // The one-column Extra section shows no second column.
    const extra = sectionRoot("Extra");
    expect(within(extra).getByText("Column 1")).toBeInTheDocument();
    expect(within(extra).queryByText("Column 2")).not.toBeInTheDocument();
    // Field type chips use the human spelling of the type.
    expect(within(details).getByText("single select")).toBeInTheDocument();
  });

  it("marks calculated fields with a calc badge", () => {
    setup({ calculatedFieldKeys: ["alpha", "alias"] });
    const badges = screen.getAllByText("calc");
    expect(badges).toHaveLength(2);
    expect(fieldRoot("Alpha")).toContainElement(badges.find((b) => fieldRoot("Alpha").contains(b)) ?? null);
    expect(fieldRoot("Alias")).toContainElement(badges.find((b) => fieldRoot("Alias").contains(b)) ?? null);
  });

  it("tells an empty column to expect a drop and offers no move when there is nowhere to move to", () => {
    const solo = makeCardType({
      key: "Solo",
      fields_schema: [
        makeSection({ section: "Only", columns: 2, fields: [makeField({ key: "lonely", label: "Lonely" })] }),
      ],
    });
    setup({ cardType: solo });
    const only = sectionRoot("Only");
    expect(within(columnOf(only, "Column 2")).getByText("Drag fields here")).toBeInTheDocument();
    expect(within(fieldRoot("Lonely")).queryByRole("button", { name: "Move to another section" })).not.toBeInTheDocument();
  });
});

describe("CardLayoutEditor — section switches", () => {
  it("collapsing a section writes defaultExpanded=false under its key", async () => {
    const { user, onRefresh } = setup();
    const sw = within(sectionRoot("Description")).getByRole("checkbox", { name: "Collapsed by default" });
    expect(sw).not.toBeChecked();
    await user.click(sw);
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    const body = lastPatch();
    expect(body.fields_schema).toBeUndefined();
    expect(body.section_config).toEqual({ ...SAVED_CONFIG, description: { defaultExpanded: false } });
  });

  it("shows Relations collapsed by default and expands it with defaultExpanded=true", async () => {
    const { user, onRefresh } = setup();
    const sw = within(sectionRoot("Relations")).getByRole("checkbox", { name: "Collapsed by default" });
    expect(sw).toBeChecked();
    await user.click(sw);
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect(lastPatch().section_config?.relations).toEqual({ defaultExpanded: true });
  });

  it("reads a legacy label-keyed config but writes under the custom:N key", async () => {
    const { user, onRefresh } = setup();
    const sw = within(sectionRoot("Extra")).getByRole("checkbox", { name: "Collapsed by default" });
    expect(sw).toBeChecked();
    await user.click(sw);
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    const cfg = lastPatch().section_config!;
    expect(cfg["custom:1"]).toEqual({ defaultExpanded: true });
    expect(cfg.Extra).toEqual({ defaultExpanded: false });
  });

  it("hiding a section merges hidden=true into its existing config", async () => {
    const { user, onRefresh } = setup();
    await user.click(within(sectionRoot("Lifecycle")).getByRole("checkbox", { name: "Hidden from card detail" }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect(lastPatch().section_config?.lifecycle).toEqual({ hidden: true });
  });

  it("a hidden section disables its collapse switch and can be shown again", async () => {
    const { user, onRefresh } = setup();
    const eol = sectionRoot("End of Life");
    expect(within(eol).getByRole("checkbox", { name: "Collapsed by default" })).toBeDisabled();
    const hidden = within(eol).getByRole("checkbox", { name: "Hidden from card detail" });
    expect(hidden).toBeChecked();
    await user.click(hidden);
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect(lastPatch().section_config?.eol).toEqual({ hidden: false });
  });
});

describe("CardLayoutEditor — expand and collapse", () => {
  it("custom sections start expanded and toggle through the chevron and the header", async () => {
    const { user } = setup();
    const details = sectionRoot("Details");
    expect(within(details).getByText("Alpha")).toBeInTheDocument();
    await user.click(within(details).getByRole("button", { name: "expand_less" }));
    expect(within(details).queryByText("Alpha")).not.toBeInTheDocument();
    await user.click(within(details).getByText("Details", { selector: "p" }));
    expect(within(details).getByText("Alpha")).toBeInTheDocument();
    expect(within(details).getByRole("button", { name: "expand_less" })).toBeInTheDocument();
  });

  it("built-in sections other than Description cannot expand, and a hidden one loses its body", () => {
    const { rerenderWith } = setup();
    expect(within(sectionRoot("Lifecycle")).queryByRole("button", { name: /expand_/ })).not.toBeInTheDocument();
    rerenderWith({
      ...TYPE,
      section_config: { ...SAVED_CONFIG, "custom:0": { hidden: true } },
    });
    const details = sectionRoot("Details");
    expect(within(details).queryByText("Alpha")).not.toBeInTheDocument();
    expect(within(details).queryByRole("button", { name: /expand_/ })).not.toBeInTheDocument();
  });
});

describe("CardLayoutEditor — add and delete sections", () => {
  it("adds a section with Enter, writing the schema and an order ending in the new custom key", async () => {
    const { user, onRefresh } = setup();
    await user.click(screen.getByRole("button", { name: /Add Section/ }));
    const input = screen.getByPlaceholderText("Section name");
    // Enter on an empty name is a no-op.
    await user.type(input, "{Enter}");
    expect(mockApi.callsOf("patch")).toHaveLength(0);
    await user.type(input, "Risks{Enter}");
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    const body = lastPatch();
    expect(keysOf(body.fields_schema?.map((s) => ({ key: s.section }) as unknown as FieldDef))).toEqual([
      "__description",
      "Details",
      "Extra",
      "Risks",
    ]);
    expect(body.fields_schema?.[3]).toEqual({ section: "Risks", fields: [] });
    expect(body.section_config?.__order).toEqual([
      "description",
      "eol",
      "lifecycle",
      "custom:0",
      "hierarchy",
      "successors",
      "tags",
      "relations",
      "custom:1",
      "custom:2",
    ]);
    expect(body.section_config?.eol).toEqual({ hidden: true });
    // The input closes after the save.
    expect(screen.queryByPlaceholderText("Section name")).not.toBeInTheDocument();
  });

  it("adds a section with the Add button, which stays disabled while the name is empty", async () => {
    const { user, onRefresh } = setup();
    await user.click(screen.getByRole("button", { name: /Add Section/ }));
    const add = screen.getByRole("button", { name: "Add" });
    expect(add).toBeDisabled();
    await user.type(screen.getByPlaceholderText("Section name"), "Audit");
    await user.click(add);
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect(lastPatch().fields_schema?.[3].section).toBe("Audit");
  });

  it("cancels the add-section input without writing", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /Add Section/ }));
    await user.type(screen.getByPlaceholderText("Section name"), "Nope");
    await user.click(screen.getByRole("button", { name: "close" }));
    expect(screen.queryByPlaceholderText("Section name")).not.toBeInTheDocument();
    expect(mockApi.callsOf("patch")).toHaveLength(0);
    expect(screen.getByRole("button", { name: /Add Section/ })).toBeInTheDocument();
  });

  it("asks the drawer to delete a custom section by its schema index", async () => {
    const { user, promptDeleteSection } = setup();
    await user.click(within(sectionRoot("Extra")).getByRole("button", { name: "Delete section" }));
    expect(promptDeleteSection).toHaveBeenCalledWith(2);
    expect(within(sectionRoot("Lifecycle")).queryByRole("button", { name: "Delete section" })).not.toBeInTheDocument();
  });

  it("offers no delete when the drawer passes no handler", () => {
    setup({ promptDeleteSection: false });
    expect(screen.queryByRole("button", { name: "Delete section" })).not.toBeInTheDocument();
  });
});

describe("CardLayoutEditor — column toggle", () => {
  it("going to one column merges the second column into the first and keeps the groups", async () => {
    const { user, onRefresh } = setup();
    const details = sectionRoot("Details");
    expect(within(details).getByRole("button", { name: /2 Col/ })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(details).getByRole("button", { name: /1 Col/ }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    const body = lastPatch();
    const section = body.fields_schema![1];
    expect(section.columns).toBe(1);
    expect(keysOf(section.fields)).toEqual(["alpha", "beta", "gamma", "sigma", "delta"]);
    expect(section.fields.every((f) => f.column === 0)).toBe(true);
    expect(byKey(section.fields, "gamma").group).toBe("Grp");
    expect(byKey(section.fields, "delta").group).toBeUndefined();
    expect(section.groups).toEqual(["Grp", "Second", "Empty"]);
    expect(section.groupTranslations).toEqual({ Grp: { de: "Gruppe" } });
    expect(body.fields_schema![0]).toEqual(DESCRIPTION_SECTION);
    expect(body.fields_schema![2]).toEqual(EXTRA_SECTION);
  });

  it("going to two columns only records the column count", async () => {
    const { user, onRefresh } = setup();
    await user.click(within(sectionRoot("Extra")).getByRole("button", { name: /2 Col/ }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect(lastPatch().fields_schema![2]).toEqual({ ...EXTRA_SECTION, columns: 2 });
  });

  it("clicking the already selected count writes nothing", async () => {
    const { user, onRefresh } = setup();
    await user.click(within(sectionRoot("Details")).getByRole("button", { name: /2 Col/ }));
    expect(mockApi.callsOf("patch")).toHaveLength(0);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});

describe("CardLayoutEditor — groups", () => {
  it("adds a group with Enter, placing it at the end of the first column", async () => {
    const { user, onRefresh } = setup();
    const details = sectionRoot("Details");
    await user.click(within(details).getByRole("button", { name: /Group$/ }));
    const input = within(details).getByPlaceholderText("Group name");
    await user.type(input, "{Enter}");
    expect(mockApi.callsOf("patch")).toHaveLength(0);
    await user.type(input, "New{Enter}");
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    const section = lastPatch().fields_schema![1];
    expect(section.groups).toEqual(["Grp", "Second", "Empty", "New"]);
    expect(keysOf(section.fields)).toEqual(["alpha", "beta", "gamma", "sigma", "delta"]);
    // The input closed and the new (empty) group renders in place.
    expect(within(details).queryByPlaceholderText("Group name")).not.toBeInTheDocument();
    expect(within(columnOf(details, "Column 1")).getByText("New")).toBeInTheDocument();
  });

  it("adds a group with the Add button and refuses a name that already exists", async () => {
    const { user, onRefresh } = setup();
    const details = sectionRoot("Details");
    await user.click(within(details).getByRole("button", { name: /Group$/ }));
    const input = within(details).getByPlaceholderText("Group name");
    const add = within(details).getByRole("button", { name: "Add" });
    expect(add).toBeDisabled();
    await user.type(input, "Second");
    await user.click(add);
    expect(mockApi.callsOf("patch")).toHaveLength(0);
    await user.clear(input);
    await user.type(input, "Third");
    await user.click(add);
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect(lastPatch().fields_schema![1].groups).toEqual(["Grp", "Second", "Empty", "Third"]);
  });

  it("cancels the group name input", async () => {
    const { user } = setup();
    const details = sectionRoot("Details");
    await user.click(within(details).getByRole("button", { name: /Group$/ }));
    await user.type(within(details).getByPlaceholderText("Group name"), "Nope");
    await user.click(within(details).getByRole("button", { name: "close" }));
    expect(within(details).queryByPlaceholderText("Group name")).not.toBeInTheDocument();
    expect(mockApi.callsOf("patch")).toHaveLength(0);
  });

  it("renames a group from the pencil, carrying its translations to the new name", async () => {
    const { user, onRefresh } = setup();
    const details = sectionRoot("Details");
    await user.click(within(groupRoot("Grp", details)).getByRole("button", { name: "Rename group" }));
    const input = within(details).getByDisplayValue("Grp");
    await user.clear(input);
    await user.type(input, "Core{Enter}");
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    const section = lastPatch().fields_schema![1];
    expect(section.groups).toEqual(["Core", "Second", "Empty"]);
    expect(byKey(section.fields, "gamma").group).toBe("Core");
    expect(section.groupTranslations).toEqual({ Core: { de: "Gruppe" } });
    expect(keysOf(section.fields)).toEqual(["alpha", "beta", "gamma", "sigma", "delta"]);
  });

  it("renames on double-click and commits on blur, leaving other groups' translations alone", async () => {
    const { user, onRefresh } = setup();
    const details = sectionRoot("Details");
    await user.dblClick(within(details).getByText("Second", { selector: "p" }));
    const input = within(details).getByDisplayValue("Second");
    await user.clear(input);
    await user.type(input, "Two");
    await user.tab();
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    const section = lastPatch().fields_schema![1];
    expect(section.groups).toEqual(["Grp", "Two", "Empty"]);
    expect(byKey(section.fields, "sigma").group).toBe("Two");
    expect(section.groupTranslations).toEqual({ Grp: { de: "Gruppe" } });
  });

  it("Escape abandons a rename, and a rename to an existing or unchanged name writes nothing", async () => {
    const { user, onRefresh } = setup();
    const details = sectionRoot("Details");
    await user.click(within(groupRoot("Grp", details)).getByRole("button", { name: "Rename group" }));
    let input = within(details).getByDisplayValue("Grp");
    await user.clear(input);
    await user.type(input, "Dropped{Escape}");
    expect(within(details).queryByDisplayValue("Dropped")).not.toBeInTheDocument();
    expect(within(details).getByText("Grp", { selector: "p" })).toBeInTheDocument();

    await user.click(within(groupRoot("Grp", details)).getByRole("button", { name: "Rename group" }));
    input = within(details).getByDisplayValue("Grp");
    await user.clear(input);
    await user.type(input, "Second{Enter}");
    expect(mockApi.callsOf("patch")).toHaveLength(0);

    await user.click(within(groupRoot("Grp", details)).getByRole("button", { name: "Rename group" }));
    input = within(details).getByDisplayValue("Grp");
    await user.type(input, "{Enter}");
    expect(mockApi.callsOf("patch")).toHaveLength(0);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("removing a group drops its fields back into the column where the group stood", async () => {
    const { user, onRefresh } = setup();
    const details = sectionRoot("Details");
    await user.click(within(groupRoot("Grp", details)).getByRole("button", { name: /Remove group/ }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    const section = lastPatch().fields_schema![1];
    expect(keysOf(section.fields)).toEqual(["alpha", "beta", "gamma", "sigma", "delta"]);
    expect(byKey(section.fields, "gamma").group).toBeUndefined();
    expect(byKey(section.fields, "gamma").column).toBe(0);
    expect(byKey(section.fields, "sigma").group).toBe("Second");
    expect(section.groups).toEqual(["Second", "Empty"]);
  });

  it("edits a group's translations through the dialog, pruning blanks", async () => {
    const { user, onRefresh } = setup();
    const details = sectionRoot("Details");
    await user.click(within(groupRoot("Grp", details)).getByRole("button", { name: "Edit group translations" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Translations for “Grp”")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Deutsch")).toHaveValue("Gruppe");
    await user.type(within(dialog).getByLabelText("Français"), "Groupe");
    await user.type(within(dialog).getByLabelText("Español"), "   ");
    await user.click(within(dialog).getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect(lastPatch().fields_schema![1].groupTranslations).toEqual({ Grp: { de: "Gruppe", fr: "Groupe" } });
    expect(lastPatch().fields_schema![1].fields).toEqual(DETAILS_SECTION.fields);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("clearing every translation removes the map entirely", async () => {
    const { user, onRefresh } = setup();
    const details = sectionRoot("Details");
    await user.click(within(groupRoot("Grp", details)).getByRole("button", { name: "Edit group translations" }));
    const dialog = screen.getByRole("dialog");
    await user.clear(within(dialog).getByLabelText("Deutsch"));
    await user.click(within(dialog).getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    const section = lastPatch().fields_schema![1];
    expect(section.groupTranslations).toBeUndefined();
    expect("groupTranslations" in section).toBe(true);
  });

  it("cancels the translations dialog without writing", async () => {
    const { user } = setup();
    const details = sectionRoot("Details");
    await user.click(within(groupRoot("Second", details)).getByRole("button", { name: "Edit group translations" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Deutsch")).toHaveValue("");
    await user.click(within(dialog).getByRole("button", { name: /^Cancel$/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("patch")).toHaveLength(0);
  });
});

describe("CardLayoutEditor — field actions", () => {
  it("edit and delete hand the drawer the schema index of the section and the field's index in it", async () => {
    const { user, openEditField, promptDeleteField } = setup();
    await user.click(within(fieldRoot("Gamma")).getByRole("button", { name: "edit" }));
    expect(openEditField).toHaveBeenCalledWith(1, 2);
    await user.click(within(fieldRoot("Delta")).getByRole("button", { name: "delete" }));
    expect(promptDeleteField).toHaveBeenCalledWith(1, 4);
    // A grouped field reports the same schema-level index.
    await user.click(within(fieldRoot("Sigma")).getByRole("button", { name: "delete" }));
    expect(promptDeleteField).toHaveBeenCalledWith(1, 3);
    await user.click(within(fieldRoot("Epsilon")).getByRole("button", { name: "edit" }));
    expect(openEditField).toHaveBeenCalledWith(2, 0);
  });

  it("the Field button opens the add dialog on that section", async () => {
    const { user, openAddField } = setup();
    await user.click(within(sectionRoot("Details")).getByRole("button", { name: /Field$/ }));
    expect(openAddField).toHaveBeenCalledWith(1);
    await user.click(within(sectionRoot("Extra")).getByRole("button", { name: /Field$/ }));
    expect(openAddField).toHaveBeenCalledWith(2);
  });

  it("moves a field to another section through the menu, ungrouped at the target's end", async () => {
    const { user, onRefresh } = setup();
    await user.click(within(fieldRoot("Gamma")).getByRole("button", { name: "Move to another section" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Move to section")).toBeInTheDocument();
    // Neither the section itself nor the description bucket is offered.
    const items = within(menu).getAllByRole("menuitem");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent("Extra");
    expect(within(menu).queryByText("Details")).not.toBeInTheDocument();
    await user.click(within(menu).getByRole("menuitem", { name: /Extra/ }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    const body = lastPatch();
    expect(keysOf(body.fields_schema![1].fields)).toEqual(["alpha", "beta", "sigma", "delta"]);
    expect(keysOf(body.fields_schema![2].fields)).toEqual(["epsilon", "gamma"]);
    const moved = byKey(body.fields_schema![2].fields, "gamma");
    expect(moved.type).toBe("single_select");
    expect(moved.group).toBeUndefined();
    expect(moved.column).toBe(0);
    expect(body.section_config).toBeUndefined();
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("closing the move menu writes nothing", async () => {
    const { user, onRefresh } = setup();
    await user.click(within(fieldRoot("Epsilon")).getByRole("button", { name: "Move to another section" }));
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent("Details");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(mockApi.callsOf("patch")).toHaveLength(0);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});

describe("CardLayoutEditor — description fields", () => {
  it("edit, delete and add route to the __description section's schema index", async () => {
    const { user, openEditField, promptDeleteField, openAddField } = setup();
    await user.click(within(fieldRoot("Code")).getByRole("button", { name: "edit" }));
    expect(openEditField).toHaveBeenCalledWith(0, 1);
    await user.click(within(fieldRoot("Alias")).getByRole("button", { name: "delete" }));
    expect(promptDeleteField).toHaveBeenCalledWith(0, 0);
    await user.click(within(sectionRoot("Description")).getByRole("button", { name: /Field$/ }));
    expect(openAddField).toHaveBeenCalledWith(0);
    expect(mockApi.callsOf("patch")).toHaveLength(0);
  });

  it("creates the __description section on first use when the type has none", async () => {
    const solo = makeCardType({
      key: "Solo",
      fields_schema: [makeSection({ section: "Only", fields: [makeField({ key: "lonely", label: "Lonely" })] })],
    });
    mockApi.on("patch", "/metamodel/types/Solo", (_p, body) => ({ ...solo, ...(body as object) }));
    const { user, onRefresh, openAddField } = setup({ cardType: solo });
    await user.click(within(sectionRoot("Description")).getByRole("button", { name: /Field$/ }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect(openAddField).not.toHaveBeenCalled();
    expect(mockApi.callsOf("patch", "/metamodel/types/Solo")).toHaveLength(1);
    expect(lastPatch().fields_schema).toEqual([solo.fields_schema[0], { section: "__description", fields: [] }]);
  });
});

describe("CardLayoutEditor — keyboard drags", () => {
  let restoreLayout: () => void;
  beforeEach(() => {
    restoreLayout = stubLayout();
  });
  afterEach(() => restoreLayout());

  async function pickUp(user: ReturnType<typeof setup>["user"], root: HTMLElement) {
    const handle = handleOf(root);
    handle.focus();
    await user.keyboard("{ }");
  }

  it("reorders sections and persists the full order", async () => {
    const { user, onRefresh } = setup();
    await pickUp(user, sectionRoot("Description"));
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ }");
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    const body = lastPatch();
    expect(body.fields_schema).toBeUndefined();
    expect(body.section_config?.__order).toEqual([
      "eol",
      "description",
      "lifecycle",
      "custom:0",
      "hierarchy",
      "successors",
      "tags",
      "relations",
      "custom:1",
    ]);
    expect(body.section_config?.eol).toEqual({ hidden: true });
  });

  it("dropping a section back where it was writes nothing", async () => {
    const { user, onRefresh } = setup();
    await pickUp(user, sectionRoot("Lifecycle"));
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowUp}");
    await user.keyboard("{ }");
    expect(mockApi.callsOf("patch")).toHaveLength(0);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("reorders the Description section's own fields", async () => {
    const { user, onRefresh } = setup();
    await pickUp(user, fieldRoot("Alias"));
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ }");
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    const body = lastPatch();
    expect(keysOf(body.fields_schema![0].fields)).toEqual(["code", "alias"]);
    expect(body.fields_schema![1]).toEqual(DETAILS_SECTION);
  });

  it("dropping a description field on itself writes nothing", async () => {
    const { user } = setup();
    await pickUp(user, fieldRoot("Code"));
    await user.keyboard("{ArrowUp}");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ }");
    expect(mockApi.callsOf("patch")).toHaveLength(0);
  });

  it("reorders a field within its column", async () => {
    const { user, onRefresh } = setup();
    await pickUp(user, fieldRoot("Alpha"));
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ }");
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    const section = lastPatch().fields_schema![1];
    expect(keysOf(section.fields)).toEqual(["beta", "alpha", "gamma", "sigma", "delta"]);
    expect(byKey(section.fields, "alpha").column).toBe(0);
    expect(section.groups).toEqual(["Grp", "Second", "Empty"]);
  });

  it("moves a field into the group below it", async () => {
    const { user, onRefresh } = setup();
    await pickUp(user, fieldRoot("Beta"));
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ }");
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    const section = lastPatch().fields_schema![1];
    const grp = section.fields.filter((f) => f.group === "Grp").map((f) => f.key);
    expect(grp).toHaveLength(2);
    expect(grp).toEqual(expect.arrayContaining(["beta", "gamma"]));
    expect(byKey(section.fields, "beta").column).toBe(0);
    expect(keysOf(section.fields)[0]).toBe("alpha");
    expect(byKey(section.fields, "sigma").group).toBe("Second");
    expect(byKey(section.fields, "delta").column).toBe(1);
  });

  it("moves a field from the second column into a group ahead of its field", async () => {
    const { user, onRefresh } = setup();
    await pickUp(user, fieldRoot("Delta"));
    // First step lands on the column itself (a no-op), the second on Sigma.
    await user.keyboard("{ArrowUp}");
    await user.keyboard("{ArrowUp}");
    await user.keyboard("{ }");
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    const section = lastPatch().fields_schema![1];
    expect(byKey(section.fields, "delta").group).toBe("Second");
    expect(byKey(section.fields, "delta").column).toBe(0);
    const second = section.fields.filter((f) => f.group === "Second").map((f) => f.key);
    expect(second).toEqual(expect.arrayContaining(["delta", "sigma"]));
    expect(section.fields.some((f) => f.column === 1)).toBe(false);
    expect(keysOf(section.fields).slice(0, 3)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("reorders a group among its column's groups", async () => {
    const { user, onRefresh } = setup();
    const details = sectionRoot("Details");
    await pickUp(user, groupRoot("Grp", details));
    // Own body, own field, then the next group's body.
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ }");
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    const section = lastPatch().fields_schema![1];
    expect(keysOf(section.fields)).toEqual(["alpha", "beta", "sigma", "gamma", "delta"]);
    expect(byKey(section.fields, "sigma").group).toBe("Second");
    expect(byKey(section.fields, "gamma").group).toBe("Grp");
    expect(section.groups).toEqual(["Grp", "Second", "Empty"]);
  });

  it("moves a group into the other column", async () => {
    const { user, onRefresh } = setup();
    const details = sectionRoot("Details");
    await pickUp(user, groupRoot("Grp", details));
    for (let i = 0; i < 5; i++) await user.keyboard("{ArrowDown}");
    await user.keyboard("{ }");
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    const section = lastPatch().fields_schema![1];
    expect(keysOf(section.fields)).toEqual(["alpha", "beta", "sigma", "delta", "gamma"]);
    expect(byKey(section.fields, "gamma")).toMatchObject({ group: "Grp", column: 1 });
    expect(byKey(section.fields, "delta")).toMatchObject({ column: 1 });
    expect(byKey(section.fields, "sigma")).toMatchObject({ group: "Second", column: 0 });
    expect(section.groups).toEqual(["Grp", "Second", "Empty"]);
  });

  it("dropping a field on its own column saves the layout unchanged", async () => {
    const { user, onRefresh } = setup();
    // Up from the first field reaches the column container itself.
    await pickUp(user, fieldRoot("Alpha"));
    await user.keyboard("{ArrowUp}");
    await user.keyboard("{ }");
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    const section = lastPatch().fields_schema![1];
    expect(section.fields).toEqual(DETAILS_SECTION.fields.map((f) => ({ ...f, group: f.group, column: f.column })));
    expect(section.groups).toEqual(["Grp", "Second", "Empty"]);
  });

  it("Escape cancels a drag and restores the layout without writing", async () => {
    const { user, onRefresh } = setup();
    const details = sectionRoot("Details");
    await pickUp(user, fieldRoot("Beta"));
    await user.keyboard("{ArrowDown}");
    // Mid-drag the field already sits in the group.
    expect(within(groupRoot("Grp", details)).getByText("Beta")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(within(groupRoot("Grp", details)).queryByText("Beta")).not.toBeInTheDocument();
    expect(labelsIn(columnOf(details, "Column 1"), ["Alpha", "Beta", "Gamma", "Sigma"])).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
      "Sigma",
    ]);
    expect(mockApi.callsOf("patch")).toHaveLength(0);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("a drop with nothing underneath restores the layout without writing", async () => {
    const { user, onRefresh } = setup();
    // Delta is the last item; below it only the empty group's body remains,
    // which has no size, so the collision rect lands on nothing.
    await pickUp(user, fieldRoot("Delta"));
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ }");
    expect(mockApi.callsOf("patch")).toHaveLength(0);
    expect(onRefresh).not.toHaveBeenCalled();
    const details = sectionRoot("Details");
    expect(labelsIn(columnOf(details, "Column 2"), ["Delta"])).toEqual(["Delta"]);
  });
});

describe("CardLayoutEditor — failed save", () => {
  // Regression (2.157.0): every save in this editor used to be a bare
  // `await api.patch(...)` with no catch — a failed PATCH was an unhandled
  // rejection, the switch snapped back on the next refresh and nothing told
  // the admin the setting had not saved. Every save now goes through
  // `patchLayout`, which surfaces the alert and skips the refresh.
  it("surfaces a failed save instead of swallowing it", async () => {
    mockApi.fail("patch", PATCH_PATH, 500);
    const { user, onRefresh } = setup();
    await user.click(within(sectionRoot("Description")).getByRole("checkbox", { name: "Collapsed by default" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
