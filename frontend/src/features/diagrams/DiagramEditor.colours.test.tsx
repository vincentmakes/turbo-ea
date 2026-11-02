/**
 * DiagramEditor — the colours it hands the canvas. DrawIO never loads in
 * jsdom, so every `drawio-shapes` helper is a spy and the dialogs are stubs
 * that show the props they were given; each test drives the editor through
 * the same callbacks DrawIO and the dialogs would, and asserts the colour
 * that reached the graph API or the dialog.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { alpha } from "@mui/material/styles";
import { DEFAULT_LAYER_COLOR, WARNING_STRONG_COLOR } from "@/theme/tokens";

vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const APP_COLOR = "#0f7eb5";
vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    types: [{ key: "Application", label: "Application", icon: "apps", color: "#0f7eb5", sort_order: 1, fields_schema: [] }],
    relationTypes: [],
    loading: false,
  }),
}));

// Every canvas helper is a spy; the few whose result the editor reads get one below.
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
vi.mock("./CreateOnDiagramDialog", () => ({
  default: ({ onCreate }: { onCreate: (d: { type: string; name: string }) => void }) => (
    <>
      <button onClick={() => onCreate({ type: "Application", name: "New app" })}>create-app</button>
      <button onClick={() => onCreate({ type: "Mystery", name: "New thing" })}>create-mystery</button>
    </>
  ),
}));
vi.mock("./RelationPickerDialog", () => ({
  default: ({ open, endpoints }: { open: boolean; endpoints: unknown }) =>
    open ? <pre data-testid="rel-endpoints">{JSON.stringify(endpoints)}</pre> : null,
}));
vi.mock("./DiagramSyncPanel", () => ({
  default: (p: { pendingCards: unknown; pendingRels: unknown; onSyncAll: () => void }) => (
    <>
      <pre data-testid="pending">{JSON.stringify({ cards: p.pendingCards, rels: p.pendingRels })}</pre>
      <button onClick={p.onSyncAll}>sync-all</button>
    </>
  ),
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
import DiagramEditor from "./DiagramEditor";
import { composeCardLogoImage } from "./cardLogoImage";

const admin = { id: "u1", email: "a@x", display_name: "Admin", permissions: { "*": true } } as unknown as User;

/** What the canvas scan reports: two pending cards (one of a type the
 *  metamodel does not know), an edge from each, and one synced card. */
const SCAN = {
  pendingCards: [
    { cellId: "c1", tempId: "p1", type: "Application", name: "A" },
    { cellId: "c2", tempId: "p2", type: "Mystery", name: "M" },
  ],
  pendingRels: [
    { edgeCellId: "e1", relationType: "rel", relationLabel: "", sourceName: "A", targetName: "B", sourceCardId: "p1", targetCardId: "k1" },
    { edgeCellId: "e2", relationType: "rel", relationLabel: "", sourceName: "M", targetName: "B", sourceCardId: "p2", targetCardId: "k1" },
  ],
  syncedFS: [{ cellId: "k-cell", cardId: "k1", type: "Application", name: "K" }],
  syncedChildren: [],
};

const NEIGHBOURS = [
  { id: "r1", type: "rel", source_id: "id-A", target_id: "x1", source: { id: "id-A", name: "A", type: "Application" }, target: { id: "x1", name: "X", type: "Application" } },
  { id: "r2", type: "rel", source_id: "id-A", target_id: "x2", source: { id: "id-A", name: "A", type: "Application" }, target: { id: "x2", name: "Y", type: "Mystery" } },
];

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

beforeEach(() => {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path === "/diagrams/d1") return { id: "d1", name: "Landscape", type: "free", data: { xml: "" } };
    return [];
  });
});
afterEach(() => vi.clearAllMocks());

describe("DiagramEditor colours", () => {
  it("pulses the sync button in the strong warning colour", async () => {
    renderEditor();
    expect(await screen.findByText("Landscape")).toBeInTheDocument();
    const css = Array.from(document.querySelectorAll("style")).map((s) => s.textContent).join("");
    expect(css).toContain(
      `@keyframes turboea-pulse{0%,100%{box-shadow:0 0 0 0 ${alpha(WARNING_STRONG_COLOR, 0.5)};}` +
        `50%{box-shadow:0 0 0 6px ${alpha(WARNING_STRONG_COLOR, 0)};}}`,
    );
  });

  it.each([
    ["the colours DrawIO reports", { sourceColor: "#123456", targetColor: "#654321" }, "#123456", "#654321"],
    ["the default layer colour when it reports none", {}, DEFAULT_LAYER_COLOR, DEFAULT_LAYER_COLOR],
  ])("opens the relation picker for a drawn edge with %s", async (_n, colours, source, target) => {
    renderEditor();
    await screen.findByText("Landscape");
    const msg = { event: "edgeConnected", edgeCellId: "e1", sourceType: "Application", targetType: "Application", ...colours };
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(msg) }));
    });
    const endpoints = JSON.parse((await screen.findByTestId("rel-endpoints")).textContent!);
    expect(endpoints).toMatchObject({ sourceColor: source, targetColor: target });
  });

  it("draws a new card in its type colour and lists pending work in type colours", async () => {
    vi.mocked(shapes.insertPendingCard).mockReturnValue("cell-new");
    vi.mocked(shapes.scanDiagramItems).mockReturnValue(SCAN as never);
    renderEditor();
    await screen.findByText("Landscape");
    fireEvent.click(screen.getByText("create-app"));
    fireEvent.click(screen.getByText("create-mystery"));
    const colours = vi.mocked(shapes.insertPendingCard).mock.calls.map((c) => c[1].color);
    expect(colours).toEqual([APP_COLOR, DEFAULT_LAYER_COLOR]);

    const pending = JSON.parse(screen.getByTestId("pending").textContent!);
    expect(pending.cards.map((c: { typeColor: string }) => c.typeColor)).toEqual([APP_COLOR, DEFAULT_LAYER_COLOR]);
    expect(pending.rels.map((r: { sourceColor: string }) => r.sourceColor)).toEqual([APP_COLOR, DEFAULT_LAYER_COLOR]);
  });

  it("marks synced cards in their type colour and expands neighbours in theirs", async () => {
    vi.mocked(shapes.scanDiagramItems).mockReturnValue(SCAN as never);
    vi.mocked(shapes.expandCardGroupAt).mockReturnValue([]);
    vi.mocked(shapes.applyViewToGraph).mockReturnValue({ restored: 0, painted: 0 } as never);
    vi.mocked(shapes.readCardCellBoxes).mockReturnValue([{ cardId: "k1", w: 200, h: 60 }] as never);
    vi.mocked(api.post).mockImplementation(async (_p: string, body: unknown) => ({
      id: `id-${(body as { name: string }).name}`,
    }));
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/diagrams/d1") return { id: "d1", name: "Landscape", type: "free", data: { xml: "" } };
      if (path.startsWith("/relations?")) return NEIGHBOURS;
      if (path.startsWith("/cards?")) return { items: [{ id: "k1", name: "K", type: "Application", logo_updated_at: "2026-01-01" }] };
      return [];
    });
    renderEditor();
    await screen.findByText("Landscape");

    fireEvent.click(screen.getByText("sync-all"));
    await waitFor(() => expect(shapes.markCellSynced).toHaveBeenCalledTimes(2));
    expect(vi.mocked(shapes.markCellSynced).mock.calls.map((c) => [c[1], c[3]])).toEqual([
      ["c1", APP_COLOR],
      ["c2", DEFAULT_LAYER_COLOR],
    ]);

    // The synced card's chevron opens the expand menu; Show inserts its neighbours.
    const openMenu = vi.mocked(shapes.addChevronOverlay).mock.calls[0][2];
    act(() => openMenu({ x: 0, y: 0 }));
    fireEvent.click(await screen.findByText("pick-show"));
    await waitFor(() => expect(shapes.expandCardGroupAt).toHaveBeenCalled());
    const children = vi.mocked(shapes.expandCardGroupAt).mock.calls[0][2];
    expect(children.map((c) => [c.name, c.color])).toEqual([
      ["X", APP_COLOR],
      ["Y", DEFAULT_LAYER_COLOR],
    ]);

    // …and the display pass that follows restores base colours and composes logos.
    await waitFor(() => expect(shapes.applyViewToGraph).toHaveBeenCalled());
    const restore = vi.mocked(shapes.applyViewToGraph).mock.calls[0][2];
    expect(restore).toEqual({ colorByType: new Map([["Application", APP_COLOR]]), fallback: DEFAULT_LAYER_COLOR });
    await waitFor(() => expect(composeCardLogoImage).toHaveBeenCalled());
    expect(vi.mocked(composeCardLogoImage).mock.calls[0].slice(1)).toEqual(["apps", APP_COLOR, 200, 60]);
  });
});
