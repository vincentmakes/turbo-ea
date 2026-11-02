/**
 * DiagramEditor — what an expanded group remembers between one expansion and
 * the next. Collapsing removes the children, so the editor writes down which
 * cards and relations the user removed and where they put the rest; the next
 * expansion from the expand menu leaves the removed ones out, puts the others
 * back, and the orange `!` forgets it all.
 *
 * Same harness as `DiagramEditor.colours.test.tsx`: DrawIO never loads in
 * jsdom, so every `drawio-shapes` helper is a spy, and the test drives the
 * editor through the callbacks DrawIO would fire.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";

vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    types: [{ key: "Application", label: "Application", icon: "apps", color: "#0f7eb5", sort_order: 1, fields_schema: [] }],
    relationTypes: [],
    loading: false,
  }),
}));

vi.mock("./drawio-shapes", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(
    Object.entries(actual).map(([k, v]) => [k, typeof v === "function" ? vi.fn() : v]),
  );
});
vi.mock("./cardLogoImage", () => ({ composeCardLogoImage: vi.fn(async () => "data:image/png;base64,AAA") }));

const { stub } = vi.hoisted(() => ({
  stub: (name: string) => ({ default: () => <div data-testid={name} /> }),
}));
vi.mock("./InsertCardsDialog", () => stub("insert"));
vi.mock("@/components/CardDetailSidePanel", () => stub("side"));
vi.mock("./ColorBySelector", () => stub("color-by"));
vi.mock("@/components/cardDisplay/ShowOnCardSelector", () => stub("show-on-card"));
vi.mock("./CreateOnDiagramDialog", () => stub("create"));
vi.mock("./RelationPickerDialog", () => stub("rel-picker"));
vi.mock("./DiagramSyncPanel", () => ({
  default: (p: { onSyncAll: () => void }) => <button onClick={p.onSyncAll}>sync-all</button>,
}));
vi.mock("./ExpandMenu", () => ({
  default: ({ target, onPick }: { target: unknown; onPick: (p: unknown, t: unknown) => void }) =>
    target ? (
      <button
        onClick={() =>
          onPick({ mode: "show", entries: [{ relation_type_key: "rel", direction: "outgoing" }] }, target)
        }
      >
        pick-show
      </button>
    ) : null,
}));

import { api } from "@/api/client";
import { AuthProvider } from "@/hooks/AuthContext";
import type { User } from "@/types";
import * as shapes from "./drawio-shapes";
import type { ChildLayout } from "./drawio-shapes";
import DiagramEditor from "./DiagramEditor";

const admin = { id: "u1", email: "a@x", display_name: "Admin", permissions: { "*": true } } as unknown as User;

/** One pending card on the canvas; syncing it makes cell `c1` the card `id-A`. */
const SCAN = {
  pendingCards: [{ cellId: "c1", tempId: "p1", type: "Application", name: "A" }],
  pendingRels: [],
  syncedFS: [],
  syncedChildren: [],
};

/** A's two neighbours: X over r1, Y over r2. */
const NEIGHBOURS = [
  { id: "r1", type: "rel", source_id: "id-A", target_id: "x1", source: { id: "id-A", name: "A", type: "Application" }, target: { id: "x1", name: "X", type: "Application" } },
  { id: "r2", type: "rel", source_id: "id-A", target_id: "x2", source: { id: "id-A", name: "A", type: "Application" }, target: { id: "x2", name: "Y", type: "Application" } },
];

const layout = (x: number): ChildLayout => ({ x, y: 0, width: 180, height: 50, style: "s", detail: [] });

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={["/diagrams/d1/edit"]}>
      <AuthProvider user={admin} refreshUser={async () => {}}>
        <Routes>
          <Route path="/diagrams/:id/edit" element={<DiagramEditor />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

/** Children handed to the n-th `expandCardGroupAt` call (1-based). */
const expandedChildren = (n: number) => vi.mocked(shapes.expandCardGroupAt).mock.calls[n - 1][2];

/** Open the expand menu from c1's current chevron and pick Show. */
async function expandFromChevron(times: number) {
  const chevrons = vi.mocked(shapes.addChevronOverlay).mock.calls.filter((c) => c[1] === "c1");
  const openMenu = chevrons.at(-1)![2];
  act(() => openMenu({ x: 0, y: 0 }));
  fireEvent.click(await screen.findByText("pick-show"));
  await waitFor(() => expect(shapes.expandCardGroupAt).toHaveBeenCalledTimes(times));
}

/** Click c1's `−` overlay. */
function collapse() {
  const minus = vi.mocked(shapes.addExpandOverlay).mock.calls.filter((c) => c[1] === "c1");
  act(() => minus.at(-1)![3]());
}

/** Render, sync the pending card and expand it once. */
async function expandOnce() {
  renderEditor();
  await screen.findByText("Landscape");
  fireEvent.click(screen.getByText("sync-all"));
  await waitFor(() => expect(shapes.markCellSynced).toHaveBeenCalled());
  await expandFromChevron(1);
  expect(expandedChildren(1).map((c) => c.id)).toEqual(["x1", "x2"]);
}

beforeEach(() => {
  vi.mocked(shapes.scanDiagramItems).mockReturnValue(SCAN as never);
  vi.mocked(shapes.expandCardGroupAt).mockReturnValue([]);
  vi.mocked(shapes.collapseCardGroup).mockReturnValue({ removedCellIds: [] });
  vi.mocked(shapes.captureGroupChildLayout).mockImplementation(() => new Map());
  vi.mocked(shapes.applyViewToGraph).mockReturnValue({ restored: 0, painted: 0 } as never);
  vi.mocked(shapes.readCardCellBoxes).mockReturnValue([]);
  vi.mocked(api.post).mockImplementation(async (_p: string, body: unknown) => ({
    id: `id-${(body as { name: string }).name}`,
  }));
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path === "/diagrams/d1") return { id: "d1", name: "Landscape", type: "free", data: { xml: "" } };
    if (path.startsWith("/relations?")) return NEIGHBOURS;
    if (path.startsWith("/cards?")) return { items: [] };
    return [];
  });
});
afterEach(() => vi.clearAllMocks());

describe("DiagramEditor expand memory", () => {
  it("leaves out a card removed while the group was expanded and offers the `!`", async () => {
    await expandOnce();
    expect(shapes.addResyncOverlay).not.toHaveBeenCalled();

    // The user deleted Y (and its edge r2) from the canvas, then collapses.
    vi.mocked(shapes.getGroupChildCardIds).mockReturnValue(new Set(["x1"]));
    vi.mocked(shapes.getGroupChildRelationIds).mockReturnValue(new Set(["r1"]));
    collapse();
    expect(screen.queryByText("Collapse this group?")).not.toBeInTheDocument();
    expect(shapes.collapseCardGroup).toHaveBeenCalledWith(expect.anything(), "c1");
    expect(vi.mocked(shapes.addResyncOverlay).mock.calls.map((c) => c[1])).toEqual(["c1"]);

    await expandFromChevron(2);
    const children = expandedChildren(2);
    expect(children.map((c) => c.id)).toEqual(["x1"]);
    expect(children[0]).toMatchObject({ name: "X", relationId: "r1" });
    // The expanded group still leaves Y out, so it keeps the `!`.
    expect(vi.mocked(shapes.addResyncOverlay).mock.calls.map((c) => c[1])).toEqual(["c1", "c1"]);
  });

  it("puts a child back where the user moved it, after the confirm dialog", async () => {
    // Baseline at expand time, then the user drags X to x=500.
    vi.mocked(shapes.captureGroupChildLayout)
      .mockImplementationOnce(() => new Map([["x1", layout(100)]]))
      .mockImplementation(() => new Map([["x1", layout(500)]]));
    await expandOnce();

    vi.mocked(shapes.getGroupChildCardIds).mockReturnValue(new Set(["x1", "x2"]));
    vi.mocked(shapes.getGroupChildRelationIds).mockReturnValue(new Set(["r1", "r2"]));
    collapse();
    expect(await screen.findByText("Collapse this group?")).toBeInTheDocument();
    expect(shapes.collapseCardGroup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    expect(shapes.collapseCardGroup).toHaveBeenCalledWith(expect.anything(), "c1");
    // Nothing was removed, so no `!`.
    expect(shapes.addResyncOverlay).not.toHaveBeenCalled();

    await expandFromChevron(2);
    const children = expandedChildren(2);
    expect(children.map((c) => c.id)).toEqual(["x1", "x2"]);
    expect(children[0].layout).toEqual(layout(500));
    expect(children[1].layout).toBeUndefined();
  });

  it("forgets the removals when the `!` is clicked, without a fetch", async () => {
    await expandOnce();
    vi.mocked(shapes.getGroupChildCardIds).mockReturnValue(new Set(["x1"]));
    vi.mocked(shapes.getGroupChildRelationIds).mockReturnValue(new Set(["r1"]));
    collapse();

    const relationFetches = () =>
      vi.mocked(api.get).mock.calls.filter(([p]) => String(p).startsWith("/relations?")).length;
    const before = relationFetches();
    const chevronsBefore = vi.mocked(shapes.addChevronOverlay).mock.calls.length;
    const forget = vi.mocked(shapes.addResyncOverlay).mock.calls.at(-1)![2];
    act(() => forget());
    expect(await screen.findByText("Relations restored from inventory")).toBeInTheDocument();
    expect(relationFetches()).toBe(before);
    // The collapsed cell gets its chevron back, without the `!`.
    expect(shapes.isGroupExpanded).toHaveBeenCalledWith(expect.anything(), "c1");
    expect(vi.mocked(shapes.addChevronOverlay).mock.calls.slice(chevronsBefore).map((c) => c[1])).toEqual(["c1"]);

    await expandFromChevron(2);
    expect(expandedChildren(2).map((c) => c.id)).toEqual(["x1", "x2"]);
    expect(shapes.addResyncOverlay).toHaveBeenCalledTimes(1);
  });

  it("gives an expanded group its `−` back when the `!` is clicked", async () => {
    await expandOnce();
    vi.mocked(shapes.getGroupChildCardIds).mockReturnValue(new Set(["x1"]));
    vi.mocked(shapes.getGroupChildRelationIds).mockReturnValue(new Set(["r1"]));
    collapse();
    await expandFromChevron(2);

    vi.mocked(shapes.isGroupExpanded).mockReturnValue(true);
    const minusBefore = vi.mocked(shapes.addExpandOverlay).mock.calls.length;
    const forget = vi.mocked(shapes.addResyncOverlay).mock.calls.at(-1)![2];
    act(() => forget());
    const added = vi.mocked(shapes.addExpandOverlay).mock.calls.slice(minusBefore);
    expect(added.map((c) => [c[1], c[2]])).toEqual([["c1", true]]);

    // That `−` collapses the group like the one it replaced.
    vi.mocked(shapes.getGroupChildCardIds).mockReturnValue(new Set(["x1"]));
    vi.mocked(shapes.getGroupChildRelationIds).mockReturnValue(new Set(["r1"]));
    act(() => added[0][3]());
    expect(shapes.collapseCardGroup).toHaveBeenCalledTimes(2);
    // Forgotten, and nothing drawn this time was removed: no `!`.
    expect(shapes.addResyncOverlay).toHaveBeenCalledTimes(2);
  });
});
