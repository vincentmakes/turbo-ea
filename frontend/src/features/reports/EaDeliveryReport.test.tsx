import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";

// The page's extension-capability hooks chain `.then` on api.get during mount,
// so unmatched GETs answer with an empty list rather than rejecting.
vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
import { mockApi } from "@/test/apiMock";

/**
 * Every child the page wires together is stubbed, and each stub records the
 * props it last received so a test can drive the page's handlers directly —
 * the children have their own tests; what is under test here is the wiring.
 */
const captured = vi.hoisted(() => ({} as Record<string, Record<string, unknown>>));

vi.mock("@/features/ea-delivery/initiatives", () => ({
  InitiativesTab: (props: Record<string, unknown>) => {
    captured.InitiativesTab = props;
    return (
      <div data-testid="initiatives-tab" data-selected={String(props.selectedInitiativeId)} />
    );
  },
  useInitiativeData: vi.fn(),
}));

vi.mock("@/features/ea-delivery/initiatives/NewArtefactSplitButton", () => ({
  default: (props: Record<string, unknown>) => {
    captured.NewArtefactSplitButton = props;
    return (
      <div
        data-testid="new-artefact-split-button"
        data-initiative={String(props.initiativeId)}
      />
    );
  },
  __esModule: true,
}));

vi.mock("@/features/ea-delivery/initiatives/InitiativeTreeSidebar", () => ({
  default: () => null,
  UNLINKED_KEY: "__unlinked__",
}));

function dialogStub(name: string) {
  return {
    default: (props: Record<string, unknown>) => {
      captured[name] = props;
      return props.open ? <div data-testid={`${name}-open`} /> : null;
    },
  };
}

vi.mock("@/features/ea-delivery/CreateSoAWDialog", () => dialogStub("CreateSoAWDialog"));
vi.mock("@/features/ea-delivery/CreateAdrDialog", () => dialogStub("CreateAdrDialog"));
vi.mock("@/features/ea-delivery/LinkDiagramsDialog", () => dialogStub("LinkDiagramsDialog"));
vi.mock("@/features/diagrams/CreateDiagramDialog", () => dialogStub("CreateDiagramDialog"));

import EaDeliveryReport from "./EaDeliveryReport";

type Fn = (...args: unknown[]) => unknown;
const call = (name: string, prop: string, ...args: unknown[]) =>
  act(async () => {
    await (captured[name][prop] as Fn)(...args);
  });

const INITIATIVES = [{ id: "init-1", name: "Cloud Move", type: "Initiative" }];
const DIAGRAMS = [
  { id: "d1", name: "Linked", card_ids: ["init-1", "other"] },
  { id: "d2", name: "Unlinked", card_ids: [] },
  { id: "d3", name: "Elsewhere", card_ids: ["other"] },
];

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

let refetch: ReturnType<typeof vi.fn>;

function renderPage(route = "/reports/ea-delivery", withData = true) {
  const utils = render(
    <MemoryRouter initialEntries={[route]}>
      <EaDeliveryReport />
      <LocationProbe />
    </MemoryRouter>,
  );
  if (withData) {
    act(() => {
      (captured.InitiativesTab.onDataReady as Fn)({
        initiatives: INITIATIVES,
        diagrams: DIAGRAMS,
        refetch,
      });
    });
  }
  return utils;
}

const location = () => screen.getByTestId("location").textContent;

beforeEach(() => {
  mockApi.reset();
  mockApi.lenient([]);
  for (const k of Object.keys(captured)) delete captured[k];
  refetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("EaDeliveryReport", () => {
  it("renders the relocated Initiatives workspace under a Reports header", () => {
    render(
      <MemoryRouter initialEntries={["/reports/ea-delivery"]}>
        <EaDeliveryReport />
      </MemoryRouter>,
    );
    // InitiativesTab + the artefact split button slot in correctly.
    expect(screen.getByTestId("initiatives-tab")).toBeInTheDocument();
    expect(screen.getByTestId("new-artefact-split-button")).toBeInTheDocument();
  });

  describe("initiative selection", () => {
    it("reads the selected initiative from the URL and hands it to the split button", () => {
      renderPage("/reports/ea-delivery?initiative=init-1");
      expect(screen.getByTestId("initiatives-tab")).toHaveAttribute("data-selected", "init-1");
      expect(screen.getByTestId("new-artefact-split-button")).toHaveAttribute(
        "data-initiative",
        "init-1",
      );
    });

    it("does not hand the Unlinked bucket to the split button as an initiative", () => {
      renderPage("/reports/ea-delivery?initiative=__unlinked__");
      expect(screen.getByTestId("new-artefact-split-button")).toHaveAttribute(
        "data-initiative",
        "undefined",
      );
    });

    it("writes a selection into the URL and removes it when cleared", async () => {
      renderPage("/reports/ea-delivery?keep=1");
      await call("InitiativesTab", "onSelectInitiative", "init-1");
      expect(location()).toBe("/reports/ea-delivery?keep=1&initiative=init-1");
      await call("InitiativesTab", "onSelectInitiative", null);
      expect(location()).toBe("/reports/ea-delivery?keep=1");
    });
  });

  describe("the New artefact dispatcher", () => {
    it("opens the SoAW dialog fixed to the initiative and navigates to the created SoAW", async () => {
      renderPage();
      await call("NewArtefactSplitButton", "onSelect", "soaw", "init-1");
      expect(screen.getByTestId("CreateSoAWDialog-open")).toBeInTheDocument();
      expect(captured.CreateSoAWDialog.fixedInitiativeId).toBe("init-1");
      await call("CreateSoAWDialog", "onCreated", { id: "soaw-9" });
      expect(refetch).toHaveBeenCalled();
      expect(location()).toBe("/ea-delivery/soaw/soaw-9");
    });

    it("leaves the SoAW dialog unfixed for the Unlinked bucket and closes it", async () => {
      renderPage();
      await call("NewArtefactSplitButton", "onSelect", "soaw", "__unlinked__");
      expect(captured.CreateSoAWDialog.fixedInitiativeId).toBeUndefined();
      expect(captured.CreateSoAWDialog.initiatives).toEqual(INITIATIVES);
      await call("CreateSoAWDialog", "onClose");
      expect(screen.queryByTestId("CreateSoAWDialog-open")).not.toBeInTheDocument();
    });

    it("opens the diagram dialog seeded with the initiative, or with no cards", async () => {
      renderPage();
      await call("NewArtefactSplitButton", "onSelect", "diagram", "init-1");
      expect(captured.CreateDiagramDialog.initialCardIds).toEqual(["init-1"]);
      await call("CreateDiagramDialog", "onCreated");
      expect(refetch).toHaveBeenCalledTimes(1);
      await call("CreateDiagramDialog", "onClose");
      expect(screen.queryByTestId("CreateDiagramDialog-open")).not.toBeInTheDocument();

      await call("NewArtefactSplitButton", "onSelect", "diagram");
      expect(captured.CreateDiagramDialog.initialCardIds).toEqual([]);
      expect(screen.getByTestId("CreateDiagramDialog-open")).toBeInTheDocument();
    });

    it("pre-links the initiative on a new ADR and navigates to it once created", async () => {
      renderPage();
      await call("NewArtefactSplitButton", "onSelect", "adr", "init-1");
      expect(captured.CreateAdrDialog.preLinkedCards).toEqual([
        { id: "init-1", name: "Cloud Move", type: "Initiative" },
      ]);
      await call("CreateAdrDialog", "onCreated", { id: "adr-3" });
      expect(refetch).toHaveBeenCalled();
      expect(location()).toBe("/ea-delivery/adr/adr-3");
    });

    it("opens an ADR with nothing pre-linked for an unknown or absent initiative", async () => {
      renderPage();
      await call("NewArtefactSplitButton", "onSelect", "adr", "missing");
      expect(captured.CreateAdrDialog.preLinkedCards).toEqual([]);
      await call("CreateAdrDialog", "onClose");
      expect(screen.queryByTestId("CreateAdrDialog-open")).not.toBeInTheDocument();

      await call("NewArtefactSplitButton", "onSelect", "adr");
      expect(captured.CreateAdrDialog.preLinkedCards).toEqual([]);
      expect(screen.getByTestId("CreateAdrDialog-open")).toBeInTheDocument();
    });

    it("never fixes a SoAW or a diagram to a stale initiative id from the URL", async () => {
      // A deleted initiative still in the URL: the header button hands it on as-is.
      renderPage("/reports/ea-delivery?initiative=deleted-1");
      expect(captured.NewArtefactSplitButton.initiativeId).toBe("deleted-1");

      await call("NewArtefactSplitButton", "onSelect", "soaw", "deleted-1");
      expect(screen.getByTestId("CreateSoAWDialog-open")).toBeInTheDocument();
      expect(captured.CreateSoAWDialog.fixedInitiativeId).toBeUndefined();
      expect(captured.CreateSoAWDialog.initiatives).toEqual(INITIATIVES);

      await call("NewArtefactSplitButton", "onSelect", "diagram", "deleted-1");
      expect(screen.getByTestId("CreateDiagramDialog-open")).toBeInTheDocument();
      expect(captured.CreateDiagramDialog.initialCardIds).toEqual([]);
    });

    it("fixes nothing before the workspace has reported its initiatives", async () => {
      renderPage("/reports/ea-delivery?initiative=init-1", false);
      await call("NewArtefactSplitButton", "onSelect", "soaw", "init-1");
      expect(screen.getByTestId("CreateSoAWDialog-open")).toBeInTheDocument();
      expect(captured.CreateSoAWDialog.fixedInitiativeId).toBeUndefined();

      await call("NewArtefactSplitButton", "onSelect", "diagram", "init-1");
      expect(captured.CreateDiagramDialog.initialCardIds).toEqual([]);
    });

    it("fixes a SoAW and a diagram to the URL's initiative once it is loaded", async () => {
      renderPage("/reports/ea-delivery?initiative=init-1");
      await call("NewArtefactSplitButton", "onSelect", "soaw", "init-1");
      expect(captured.CreateSoAWDialog.fixedInitiativeId).toBe("init-1");
      await call("NewArtefactSplitButton", "onSelect", "diagram", "init-1");
      expect(captured.CreateDiagramDialog.initialCardIds).toEqual(["init-1"]);
    });

    it("forwards the workspace's own create callbacks", async () => {
      renderPage();
      await call("InitiativesTab", "onCreateAdr");
      expect(captured.CreateAdrDialog.preLinkedCards).toEqual([]);
      await call("InitiativesTab", "onCreateSoaw", "init-1");
      expect(captured.CreateSoAWDialog.fixedInitiativeId).toBe("init-1");
    });
  });

  describe("linking diagrams", () => {
    it("pre-selects the diagrams already linked and patches only the ones that changed", async () => {
      mockApi.on("patch", /^\/diagrams\//, {});
      renderPage();
      await call("InitiativesTab", "onLinkDiagrams", "init-1");
      expect(screen.getByTestId("LinkDiagramsDialog-open")).toBeInTheDocument();
      expect(captured.LinkDiagramsDialog.linkSelected).toEqual(["d1"]);

      // Unlink d1, link d2, leave d3 alone.
      await call("LinkDiagramsDialog", "onToggle", "d1");
      await call("LinkDiagramsDialog", "onToggle", "d2");
      expect(captured.LinkDiagramsDialog.linkSelected).toEqual(["d2"]);
      await call("LinkDiagramsDialog", "onSave");

      const patches = mockApi.callsOf("patch");
      expect(patches).toEqual([
        { method: "patch", path: "/diagrams/d1", body: { card_ids: ["other"] } },
        { method: "patch", path: "/diagrams/d2", body: { card_ids: ["init-1"] } },
      ]);
      expect(refetch).toHaveBeenCalled();
      expect(screen.queryByTestId("LinkDiagramsDialog-open")).not.toBeInTheDocument();
      expect(captured.LinkDiagramsDialog.linking).toBe(false);
    });

    it("surfaces a failed save and keeps the dialog open; the alert can be dismissed", async () => {
      mockApi.fail("patch", /^\/diagrams\//, 500, "nope");
      const user = userEvent.setup();
      renderPage();
      await call("InitiativesTab", "onLinkDiagrams", "init-1");
      await call("LinkDiagramsDialog", "onToggle", "d2");
      await call("LinkDiagramsDialog", "onSave");
      expect(await screen.findByText("PATCH /diagrams/d2 failed")).toBeInTheDocument();
      expect(screen.getByTestId("LinkDiagramsDialog-open")).toBeInTheDocument();
      expect(refetch).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: /close/i }));
      expect(screen.queryByText("PATCH /diagrams/d2 failed")).not.toBeInTheDocument();
    });

    it("falls back to a translated message when the failure is not an Error", async () => {
      mockApi.on("patch", /^\/diagrams\//, () => Promise.reject("plain string"));
      renderPage();
      await call("InitiativesTab", "onLinkDiagrams", "init-1");
      await call("LinkDiagramsDialog", "onToggle", "d2");
      await call("LinkDiagramsDialog", "onSave");
      expect(await screen.findByText("Failed to link diagrams")).toBeInTheDocument();
    });

    it("does nothing on save before an initiative was chosen, and closes on request", async () => {
      renderPage();
      await call("LinkDiagramsDialog", "onSave");
      expect(mockApi.callsOf("patch")).toHaveLength(0);

      await call("InitiativesTab", "onLinkDiagrams", "init-1");
      await call("LinkDiagramsDialog", "onClose");
      expect(screen.queryByTestId("LinkDiagramsDialog-open")).not.toBeInTheDocument();
    });

    it("selects nothing when the workspace has not reported its data yet", async () => {
      renderPage("/reports/ea-delivery", false);
      await call("InitiativesTab", "onLinkDiagrams", "init-1");
      expect(captured.LinkDiagramsDialog.linkSelected).toEqual([]);
      expect(captured.LinkDiagramsDialog.diagrams).toEqual([]);
    });

    it("unlinks one diagram from the initiative", async () => {
      mockApi.on("patch", /^\/diagrams\//, {});
      renderPage();
      await call("InitiativesTab", "onUnlinkDiagram", DIAGRAMS[0], "init-1");
      expect(mockApi.callsOf("patch")[0]).toMatchObject({
        path: "/diagrams/d1",
        body: { card_ids: ["other"] },
      });
      expect(refetch).toHaveBeenCalled();
    });

    it("reports a failed unlink, with a fallback for non-Error rejections", async () => {
      mockApi.fail("patch", /^\/diagrams\//, 500);
      renderPage();
      await call("InitiativesTab", "onUnlinkDiagram", DIAGRAMS[0], "init-1");
      expect(await screen.findByText("PATCH /diagrams/d1 failed")).toBeInTheDocument();

      mockApi.on("patch", /^\/diagrams\//, () => Promise.reject(42));
      await call("InitiativesTab", "onUnlinkDiagram", DIAGRAMS[0], "init-1");
      expect(await screen.findByText("Failed to unlink diagram")).toBeInTheDocument();
    });
  });

  describe("the SoAW context menu", () => {
    async function openMenu() {
      const anchor = document.createElement("div");
      document.body.appendChild(anchor);
      await call("InitiativesTab", "onSoawContextMenu", anchor, { id: "soaw-1" });
      return screen.findByRole("menu");
    }

    it("navigates to the preview", async () => {
      const user = userEvent.setup();
      renderPage();
      await openMenu();
      await user.click(screen.getByRole("menuitem", { name: /preview/i }));
      expect(location()).toBe("/ea-delivery/soaw/soaw-1/preview");
    });

    it("navigates to the editor", async () => {
      const user = userEvent.setup();
      renderPage();
      await openMenu();
      await user.click(screen.getByRole("menuitem", { name: /edit/i }));
      expect(location()).toBe("/ea-delivery/soaw/soaw-1");
    });

    it("deletes after confirmation and refreshes the workspace", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      mockApi.on("delete", "/soaw/soaw-1", undefined);
      const user = userEvent.setup();
      renderPage();
      await openMenu();
      await user.click(screen.getByRole("menuitem", { name: /delete/i }));
      await waitFor(() => expect(refetch).toHaveBeenCalled());
      expect(mockApi.callsOf("delete", "/soaw/soaw-1")).toHaveLength(1);
      await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    });

    it("keeps the SoAW when the confirmation is declined", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(false);
      const user = userEvent.setup();
      renderPage();
      await openMenu();
      await user.click(screen.getByRole("menuitem", { name: /delete/i }));
      expect(mockApi.callsOf("delete")).toHaveLength(0);
    });

    it("shows a failed delete, with a fallback for non-Error rejections", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      mockApi.fail("delete", "/soaw/soaw-1", 500);
      const user = userEvent.setup();
      renderPage();
      await openMenu();
      await user.click(screen.getByRole("menuitem", { name: /delete/i }));
      expect(await screen.findByText("DELETE /soaw/soaw-1 failed")).toBeInTheDocument();

      mockApi.on("delete", "/soaw/soaw-1", () => Promise.reject(null));
      await openMenu();
      await user.click(screen.getByRole("menuitem", { name: /delete/i }));
      expect(await screen.findByText("Failed to delete")).toBeInTheDocument();
    });

    it("closes on Escape", async () => {
      const user = userEvent.setup();
      renderPage();
      await openMenu();
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    });
  });
});
