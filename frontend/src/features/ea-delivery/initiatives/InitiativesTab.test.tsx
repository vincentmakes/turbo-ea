import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/components/CardDetailSidePanel", () => ({ default: () => null }));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { renderWithProviders, wrapWithProviders } from "@/test/render";
import { setViewportWidth } from "@/test/matchMedia";
import { cardPage, makeCard, makeCardType, makeSubtype } from "@/test/fixtures/metamodel";
import type { ArchitectureDecision, Card, DiagramSummary, SoAW } from "@/types";
import InitiativesTab from "./InitiativesTab";
import { UNLINKED_KEY } from "./InitiativeTreeSidebar";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const INITIATIVE_TYPE = makeCardType({
  key: "Initiative",
  label: "Initiative",
  category: "Strategy & Transformation",
  has_hierarchy: true,
  subtypes: [makeSubtype({ key: "program", label: "Program" })],
});

const PROGRAM: Card = makeCard({ id: "init-1", type: "Initiative", name: "Cloud Migration", subtype: "program" });
const CHILD: Card = makeCard({ id: "init-2", type: "Initiative", name: "Lift and shift", parent_id: "init-1" });
const OTHER: Card = makeCard({ id: "init-3", type: "Initiative", name: "Data Platform" });

const LINKED_SOAW = { id: "s1", name: "Migration SoAW", initiative_id: "init-1", status: "draft", revision_number: 1 } as unknown as SoAW;
const ORPHAN_SOAW = { id: "s2", name: "Orphan SoAW", initiative_id: null, status: "draft", revision_number: 1 } as unknown as SoAW;
const LINKED_DIAGRAM = { id: "d1", name: "Target landscape", card_ids: ["init-1"], card_count: 1 } as DiagramSummary;
const ORPHAN_DIAGRAM = { id: "d2", name: "Loose sketch", card_ids: [], card_count: 0 } as DiagramSummary;
const ORPHAN_ADR = {
  id: "a1",
  title: "Unattached decision",
  reference_number: "ADR-0007",
  status: "draft",
  linked_cards: [],
} as unknown as ArchitectureDecision;

const CARDS_URL = "/cards?type=Initiative&page_size=500&status=ACTIVE,ARCHIVED";

type Props = React.ComponentProps<typeof InitiativesTab>;

function renderTab(over: Partial<Props> = {}) {
  const handlers = {
    onSelectInitiative: vi.fn(),
    onCreateSoaw: vi.fn(),
    onCreateAdr: vi.fn(),
    onCreateDiagram: vi.fn(),
    onLinkDiagrams: vi.fn(),
    onUnlinkDiagram: vi.fn(),
    onSoawContextMenu: vi.fn(),
  };
  const utils = renderWithProviders(<InitiativesTab selectedInitiativeId={null} {...handlers} {...over} />);
  return { ...utils, ...handlers };
}

function scriptData(initiatives: Card[] = [PROGRAM, CHILD, OTHER]) {
  mockApi.on("get", CARDS_URL, cardPage(initiatives));
  mockApi.on("get", "/diagrams", [LINKED_DIAGRAM, ORPHAN_DIAGRAM]);
  mockApi.on("get", "/soaw", [LINKED_SOAW, ORPHAN_SOAW]);
  mockApi.on("get", "/adr", [ORPHAN_ADR]);
  mockApi.on("get", "/favorites?type=Initiative", [{ id: "f1", card_id: "init-3" }]);
  mockApi.on("post", /^\/favorites\//, { ok: true });
  mockApi.on("delete", /^\/favorites\//, undefined);
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel([INITIATIVE_TYPE]);
  localStorage.clear();
  scriptData();
});

// ---------------------------------------------------------------------------

describe("InitiativesTab", () => {
  it("shows a spinner, then the tree beside the empty workspace, and hands the data to onDataReady", async () => {
    const onDataReady = vi.fn();
    renderTab({ onDataReady });
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    expect(await screen.findByText("Cloud Migration")).toBeInTheDocument();
    expect(screen.getByText("Lift and shift")).toBeInTheDocument();
    expect(screen.getByText("Pick an initiative to start")).toBeInTheDocument();
    // Orphans: one SoAW, one diagram, one ADR.
    expect(screen.getByText("Unlinked artefacts")).toBeInTheDocument();
    expect(screen.getByText("3 initiatives")).toBeInTheDocument();
    await waitFor(() =>
      expect(onDataReady).toHaveBeenLastCalledWith(expect.objectContaining({ loading: false, initiatives: [PROGRAM, CHILD, OTHER] })),
    );
  });

  it("renders the no-initiatives hint when the inventory has none", async () => {
    mockApi.on("get", CARDS_URL, cardPage([]));
    renderTab();
    expect(await screen.findByText(/No initiatives found/)).toBeInTheDocument();
    expect(screen.queryByText("Pick an initiative to start")).not.toBeInTheDocument();
  });

  it("surfaces a load failure as a dismissible alert", async () => {
    mockApi.fail("get", "/diagrams", 500);
    const { user } = renderTab();
    const alert = await screen.findByText("GET /diagrams failed");
    expect(alert).toBeInTheDocument();
    await user.click(within(alert.closest(".MuiAlert-root") as HTMLElement).getByRole("button", { name: "Close" }));
    expect(screen.queryByText("GET /diagrams failed")).not.toBeInTheDocument();
    // Only the empty-inventory hint is left; the error alert is gone, not replaced.
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent(/No initiatives found/);
  });

  it("shows the selected initiative, selects from the tree and remembers the last pick", async () => {
    const { user, onSelectInitiative, onCreateSoaw, onCreateAdr, onLinkDiagrams, onUnlinkDiagram, onSoawContextMenu } =
      renderTab({ selectedInitiativeId: "init-1" });

    expect(await screen.findByRole("heading", { name: "Cloud Migration" })).toBeInTheDocument();
    expect(screen.getByText("Migration SoAW")).toBeInTheDocument();
    expect(screen.getByText("Target landscape")).toBeInTheDocument();

    // The deliverable callbacks are forwarded with the initiative id.
    await user.click(screen.getByRole("button", { name: /Add Architecture Decision$/ }));
    expect(onCreateAdr).toHaveBeenCalledWith([{ id: "init-1", name: "Cloud Migration", type: "Initiative" }]);
    await user.click(screen.getByRole("button", { name: /^add Add arrow_drop_down$/ }));
    await user.click(await screen.findByRole("menuitem", { name: /New Statement of Architecture Work/ }));
    expect(onCreateSoaw).toHaveBeenCalledWith("init-1");
    await user.click(screen.getByRole("button", { name: /Link diagrams to this initiative$/ }));
    expect(onLinkDiagrams).toHaveBeenCalledWith("init-1");
    await user.click(screen.getByRole("button", { name: "Unlink from this initiative" }));
    expect(onUnlinkDiagram).toHaveBeenCalledWith(expect.objectContaining({ id: "d1" }), "init-1");
    await user.click(screen.getByRole("button", { name: "more_vert" }));
    expect(onSoawContextMenu).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ id: "s1" }));

    await user.click(screen.getByText("Data Platform"));
    expect(onSelectInitiative).toHaveBeenCalledWith("init-3");
    expect(localStorage.getItem("turboea-delivery-last-selected")).toBe("init-3");
  });

  it("restores the last selected initiative when the URL names none", async () => {
    localStorage.setItem("turboea-delivery-last-selected", "init-2");
    const { onSelectInitiative } = renderTab();
    await screen.findByText("Cloud Migration");
    await waitFor(() => expect(onSelectInitiative).toHaveBeenCalledWith("init-2"));
  });

  it("creates artefacts from the empty workspace without an initiative", async () => {
    const { user, onCreateSoaw, onCreateDiagram, onCreateAdr } = renderTab();
    await screen.findByText("Pick an initiative to start");

    const open = async (label: RegExp) => {
      await user.click(screen.getByRole("button", { name: /New artefact/ }));
      await user.click(await screen.findByRole("menuitem", { name: label }));
    };
    await open(/New Statement of Architecture Work/);
    expect(onCreateSoaw).toHaveBeenCalledWith("");
    await open(/New Diagram/);
    expect(onCreateDiagram).toHaveBeenCalledWith(undefined);
    await open(/New Architecture Decision/);
    expect(onCreateAdr).toHaveBeenCalledWith([]);
  });

  it("renders the orphaned artefacts for the synthetic unlinked selection", async () => {
    renderTab({ selectedInitiativeId: UNLINKED_KEY });
    expect(await screen.findByRole("heading", { name: "Unlinked artefacts" })).toBeInTheDocument();
    expect(screen.getByText("Orphan SoAW")).toBeInTheDocument();
    expect(screen.getByText("Loose sketch")).toBeInTheDocument();
    expect(screen.getByText("Unattached decision")).toBeInTheDocument();
  });

  it("toggles favourites against the API and narrows the tree with the favourites-only filter", async () => {
    const { user } = renderTab({ selectedInitiativeId: "init-1" });
    await screen.findByRole("heading", { name: "Cloud Migration" });
    await waitFor(() => expect(mockApi.callsOf("get", "/favorites?type=Initiative")).toHaveLength(1));

    // The header star adds the selected initiative…
    await user.click(screen.getByRole("button", { name: "Add to favorites" }));
    await waitFor(() => expect(mockApi.callsOf("post", "/favorites/init-1")).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Remove from favorites" })).toBeInTheDocument();

    // …and the tree star removes the one the server reported.
    await user.click(screen.getByRole("button", { name: "Remove Data Platform from favorites" }));
    await waitFor(() => expect(mockApi.callsOf("delete", "/favorites/init-3")).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: "Favorites only" }));
    expect(localStorage.getItem("turboea-delivery-favorites-only")).toBe("true");
    expect(screen.queryByText("Data Platform")).not.toBeInTheDocument();
    // A non-favourite child of a favourite parent is lifted out; the parent stays.
    expect(screen.getByText("1 initiative")).toBeInTheDocument();
  });

  it("reverts an optimistic favourite when the request fails", async () => {
    mockApi.fail("post", /^\/favorites\//, 500);
    const { user } = renderTab({ selectedInitiativeId: "init-1" });
    await screen.findByRole("heading", { name: "Cloud Migration" });
    await user.click(screen.getByRole("button", { name: "Add to favorites" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Add to favorites" })).toBeInTheDocument());
  });

  it("reports when the filters leave no initiative and collapses the sidebar on request", async () => {
    const { user } = renderTab();
    await screen.findByText("Cloud Migration");

    await user.type(screen.getByPlaceholderText("Search initiatives…"), "zzz");
    expect(await screen.findByText("No initiatives match the current filters.", { selector: ".MuiAlert-message" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(localStorage.getItem("turboea-delivery-sidebar-collapsed")).toBe("true");
    expect(screen.queryByPlaceholderText("Search initiatives…")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(screen.getByPlaceholderText("Search initiatives…")).toBeInTheDocument();
  });

  it("moves the tree into a drawer on a phone-width viewport and closes it on selection", async () => {
    setViewportWidth(500);
    const { user, onSelectInitiative } = renderTab();
    await screen.findByText("Pick an initiative to start");
    expect(screen.queryByText("Cloud Migration")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Expand sidebar$/ }));
    const drawer = await screen.findByRole("presentation");
    expect(within(drawer).getByText("Initiatives")).toBeInTheDocument();
    await user.click(within(drawer).getByText("Cloud Migration"));
    expect(onSelectInitiative).toHaveBeenCalledWith("init-1");
    await waitFor(() => expect(screen.queryByText("Cloud Migration")).not.toBeInTheDocument());
  });

  it("titles the desktop sidebar, shows the status filter and counts every unlinked artefact", async () => {
    renderTab();
    await screen.findByText("Cloud Migration");

    expect(screen.getByText("Initiatives")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent("Active");
    // One orphan SoAW, one orphan diagram, one orphan ADR.
    const unlinked = screen.getByText("Unlinked artefacts").parentElement as HTMLElement;
    expect(within(unlinked).getByText("3")).toBeInTheDocument();
  });

  it("does not remember the synthetic unlinked selection as the last pick", async () => {
    const { user, onSelectInitiative } = renderTab();
    await screen.findByText("Cloud Migration");

    await user.click(screen.getByText("Unlinked artefacts"));
    expect(onSelectInitiative).toHaveBeenCalledWith(UNLINKED_KEY);
    expect(localStorage.getItem("turboea-delivery-last-selected")).toBeNull();
  });

  it("selects through the latest onSelectInitiative after a rerender", async () => {
    const handlers = {
      onCreateSoaw: vi.fn(),
      onCreateAdr: vi.fn(),
      onCreateDiagram: vi.fn(),
      onLinkDiagrams: vi.fn(),
      onUnlinkDiagram: vi.fn(),
      onSoawContextMenu: vi.fn(),
    };
    const first = vi.fn();
    const second = vi.fn();
    const { user, rerender } = renderWithProviders(
      <InitiativesTab selectedInitiativeId={null} onSelectInitiative={first} {...handlers} />,
    );
    await screen.findByText("Cloud Migration");

    rerender(
      wrapWithProviders(
        <InitiativesTab selectedInitiativeId={null} onSelectInitiative={second} {...handlers} />,
      ),
    );
    await user.click(screen.getByText("Data Platform"));
    expect(second).toHaveBeenCalledWith("init-3");
    expect(first).not.toHaveBeenCalled();
  });

  it("shows the empty workspace for an unknown selected id and creates unlinked artefacts from it", async () => {
    const { user, onCreateAdr, onCreateSoaw, onCreateDiagram } = renderTab({ selectedInitiativeId: "ghost" });
    expect(await screen.findByText("Pick an initiative to start")).toBeInTheDocument();

    const open = async (label: RegExp) => {
      await user.click(screen.getByRole("button", { name: /New artefact/ }));
      await user.click(await screen.findByRole("menuitem", { name: label }));
    };
    await open(/New Architecture Decision/);
    expect(onCreateAdr).toHaveBeenCalledWith([]);
    // A stale id (a deleted initiative in the URL) is never handed on.
    await open(/New Statement of Architecture Work/);
    expect(onCreateSoaw).toHaveBeenCalledWith("");
    await open(/New Diagram/);
    expect(onCreateDiagram).toHaveBeenCalledWith(undefined);
  });

  describe("restoring the last pick", () => {
    // onDataReady runs in the same effect flush as the restore effect, declared
    // before it: once it has seen `loading: false`, the restore has run.
    const loaded = (onDataReady: ReturnType<typeof vi.fn>) =>
      waitFor(() =>
        expect(onDataReady).toHaveBeenLastCalledWith(expect.objectContaining({ loading: false })),
      );

    it("leaves an explicit URL selection alone", async () => {
      localStorage.setItem("turboea-delivery-last-selected", "init-2");
      const onDataReady = vi.fn();
      const { onSelectInitiative } = renderTab({ selectedInitiativeId: "init-1", onDataReady });
      await loaded(onDataReady);
      expect(onSelectInitiative).not.toHaveBeenCalled();
    });

    it("selects nothing when nothing was saved", async () => {
      const onDataReady = vi.fn();
      const { onSelectInitiative } = renderTab({ onDataReady });
      await loaded(onDataReady);
      expect(onSelectInitiative).not.toHaveBeenCalled();
    });

    it("ignores a saved id that is no longer in the tree", async () => {
      localStorage.setItem("turboea-delivery-last-selected", "gone");
      const onDataReady = vi.fn();
      const { onSelectInitiative } = renderTab({ onDataReady });
      await loaded(onDataReady);
      expect(onSelectInitiative).not.toHaveBeenCalled();
    });
  });

  it("restores a collapsed sidebar from storage", async () => {
    localStorage.setItem("turboea-delivery-sidebar-collapsed", "true");
    renderTab();
    await screen.findByText("Pick an initiative to start");
    expect(screen.queryByPlaceholderText("Search initiatives…")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
  });

  it("restores favourites-only from storage and lifts a favourite child out of its parent", async () => {
    localStorage.setItem("turboea-delivery-favorites-only", "true");
    mockApi.on("get", "/favorites?type=Initiative", [{ id: "f2", card_id: "init-2" }]);
    renderTab();

    expect(await screen.findByText("Lift and shift")).toBeInTheDocument();
    expect(screen.queryByText("Cloud Migration")).not.toBeInTheDocument();
    expect(screen.queryByText("Data Platform")).not.toBeInTheDocument();
    expect(screen.getByText("1 initiative")).toBeInTheDocument();
  });

  it("puts a favourite back when removing it fails", async () => {
    mockApi.fail("delete", /^\/favorites\//, 500);
    const { user } = renderTab({ selectedInitiativeId: "init-3" });
    const remove = await screen.findByRole("button", { name: "Remove from favorites" });

    await user.click(remove);
    await waitFor(() => expect(mockApi.callsOf("delete", "/favorites/init-3")).toHaveLength(1));
    // The optimistic removal is rolled back once the request fails.
    expect(await screen.findByRole("button", { name: "Remove from favorites" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add to favorites" })).not.toBeInTheDocument();
  });

  describe("resizing the sidebar", () => {
    const handleOf = () => {
      const header = screen.getByText("Initiatives").parentElement as HTMLElement;
      return (header.parentElement as HTMLElement).nextElementSibling as HTMLElement;
    };
    const drag = (from: number, to: number) => {
      fireEvent.mouseDown(handleOf(), { clientX: from });
      fireEvent.mouseMove(document, { clientX: to });
      fireEvent.mouseUp(document);
    };

    it("persists the new width, starting from the default", async () => {
      renderTab();
      await screen.findByText("Cloud Migration");
      drag(100, 140);
      expect(localStorage.getItem("turboea-delivery-sidebar-width")).toBe("360");
      // The next drag starts from the width the first one left.
      drag(100, 110);
      expect(localStorage.getItem("turboea-delivery-sidebar-width")).toBe("370");
    });

    it("starts from the stored width", async () => {
      localStorage.setItem("turboea-delivery-sidebar-width", "400");
      renderTab();
      await screen.findByText("Cloud Migration");
      drag(100, 110);
      expect(localStorage.getItem("turboea-delivery-sidebar-width")).toBe("410");
    });

    it("falls back to the default width when storage cannot be read", async () => {
      const realGetItem = Storage.prototype.getItem;
      const getItem = vi
        .spyOn(Storage.prototype, "getItem")
        .mockImplementation(function (this: Storage, key: string) {
          if (key === "turboea-delivery-sidebar-width") throw new Error("denied");
          return realGetItem.call(this, key);
        });
      try {
        renderTab();
        await screen.findByText("Cloud Migration");
        drag(100, 120);
      } finally {
        getItem.mockRestore();
      }
      expect(localStorage.getItem("turboea-delivery-sidebar-width")).toBe("340");
    });
  });

  describe("on a phone-width viewport", () => {
    it("closes the drawer on Escape and from its close button", async () => {
      setViewportWidth(500);
      const { user } = renderTab();
      await screen.findByText("Pick an initiative to start");

      await user.click(screen.getByRole("button", { name: /Expand sidebar$/ }));
      await screen.findByText("Cloud Migration");
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByText("Cloud Migration")).not.toBeInTheDocument());

      await user.click(screen.getByRole("button", { name: /Expand sidebar$/ }));
      await screen.findByText("Cloud Migration");
      await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
      await waitFor(() => expect(screen.queryByText("Cloud Migration")).not.toBeInTheDocument());
    });
  });
});
