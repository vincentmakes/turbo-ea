/**
 * Mutation-hardening tests for EaDeliveryReport: the initial state each dialog
 * starts from, the page header, what the handlers do before the workspace has
 * reported its data, and the SoAW context menu's labels and close behaviour.
 *
 * Every child the page wires together is stubbed (as in
 * `EaDeliveryReport.test.tsx`) and records the props it last received, so a
 * test can read the page's state off them and drive its handlers directly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import i18n from "@/i18n";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
import { mockApi } from "@/test/apiMock";

const captured = vi.hoisted(() => ({} as Record<string, Record<string, unknown>>));

vi.mock("@/features/ea-delivery/initiatives", () => ({
  InitiativesTab: (props: Record<string, unknown>) => {
    captured.InitiativesTab = props;
    return <div data-testid="initiatives-tab" />;
  },
  useInitiativeData: vi.fn(),
}));

vi.mock("@/features/ea-delivery/initiatives/NewArtefactSplitButton", () => ({
  default: (props: Record<string, unknown>) => {
    captured.NewArtefactSplitButton = props;
    return <div data-testid="new-artefact-split-button" />;
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

/** Shows the current URL and offers buttons that move the history around. */
function LocationProbe() {
  const loc = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <div data-testid="location">{loc.pathname + loc.search}</div>
      <button type="button" onClick={() => navigate(-1)}>
        go back
      </button>
      <button type="button" onClick={() => navigate("/reports/ea-delivery?other=2")}>
        go elsewhere
      </button>
    </>
  );
}

let refetch: ReturnType<typeof vi.fn>;

function renderPage(
  opts: { entries?: string[]; index?: number; withData?: boolean } = {},
) {
  const { entries = ["/reports/ea-delivery"], index, withData = true } = opts;
  const utils = render(
    <MemoryRouter initialEntries={entries} initialIndex={index ?? entries.length - 1}>
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

/** Collect errors thrown inside React event handlers instead of losing them. */
function collectErrors() {
  const errors: unknown[] = [];
  const onError = (e: ErrorEvent) => {
    errors.push(e.error);
    e.preventDefault();
  };
  window.addEventListener("error", onError);
  return { errors, stop: () => window.removeEventListener("error", onError) };
}

beforeEach(() => {
  mockApi.reset();
  mockApi.lenient([]);
  for (const k of Object.keys(captured)) delete captured[k];
  refetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("EaDeliveryReport — header", () => {
  it("shows the translated page title and subtitle", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "EA Delivery" })).toBeInTheDocument();
    expect(
      screen.getByText(/^Manage TOGAF-aligned architecture deliverables/),
    ).toBeInTheDocument();
  });

  it("shows no error alert on a fresh page", () => {
    renderPage();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("EaDeliveryReport — the dialogs' starting state", () => {
  it("renders every dialog closed and empty before anything was picked", () => {
    renderPage({ withData: false });
    expect(screen.queryByTestId("CreateSoAWDialog-open")).not.toBeInTheDocument();
    expect(screen.queryByTestId("CreateAdrDialog-open")).not.toBeInTheDocument();
    expect(screen.queryByTestId("LinkDiagramsDialog-open")).not.toBeInTheDocument();
    expect(screen.queryByTestId("CreateDiagramDialog-open")).not.toBeInTheDocument();

    expect(captured.CreateSoAWDialog.fixedInitiativeId).toBeUndefined();
    expect(captured.CreateSoAWDialog.initiatives).toEqual([]);
    expect(captured.CreateAdrDialog.preLinkedCards).toEqual([]);
    expect(captured.CreateDiagramDialog.initialCardIds).toEqual([]);
    expect(captured.LinkDiagramsDialog.linkInitiativeId).toBe("");
    expect(captured.LinkDiagramsDialog.linkSelected).toEqual([]);
    expect(captured.LinkDiagramsDialog.linking).toBe(false);
    expect(captured.LinkDiagramsDialog.diagrams).toEqual([]);
    expect(captured.LinkDiagramsDialog.initiatives).toEqual([]);
  });

  it("hands the link dialog the workspace's initiatives once it has reported them", async () => {
    renderPage();
    await call("InitiativesTab", "onLinkDiagrams", "init-1");
    expect(captured.LinkDiagramsDialog.initiatives).toEqual(INITIATIVES);
    expect(captured.LinkDiagramsDialog.diagrams).toEqual(DIAGRAMS);
    expect(captured.LinkDiagramsDialog.linkInitiativeId).toBe("init-1");
  });
});

describe("EaDeliveryReport — initiative selection in the URL", () => {
  it("replaces the history entry rather than pushing one", async () => {
    const user = userEvent.setup();
    renderPage({ entries: ["/before", "/reports/ea-delivery"], index: 1 });
    await call("InitiativesTab", "onSelectInitiative", "init-1");
    expect(location()).toBe("/reports/ea-delivery?initiative=init-1");
    await user.click(screen.getByRole("button", { name: "go back" }));
    expect(location()).toBe("/before");
  });

  it("builds on the current query string, not the one the page opened with", async () => {
    const user = userEvent.setup();
    renderPage({ entries: ["/reports/ea-delivery?keep=1"] });
    await user.click(screen.getByRole("button", { name: "go elsewhere" }));
    expect(location()).toBe("/reports/ea-delivery?other=2");
    await call("InitiativesTab", "onSelectInitiative", "init-1");
    expect(location()).toBe("/reports/ea-delivery?other=2&initiative=init-1");
  });
});

describe("EaDeliveryReport — linking diagrams", () => {
  it("unticks one of several pre-selected diagrams and keeps the rest", async () => {
    renderPage();
    await call("InitiativesTab", "onLinkDiagrams", "other");
    expect(captured.LinkDiagramsDialog.linkSelected).toEqual(["d1", "d3"]);
    await call("LinkDiagramsDialog", "onToggle", "d1");
    expect(captured.LinkDiagramsDialog.linkSelected).toEqual(["d3"]);
    await call("LinkDiagramsDialog", "onToggle", "d1");
    expect(captured.LinkDiagramsDialog.linkSelected).toEqual(["d3", "d1"]);
  });

  it("does not save or refresh before an initiative was chosen", async () => {
    renderPage();
    await call("LinkDiagramsDialog", "onSave");
    expect(refetch).not.toHaveBeenCalled();
    expect(mockApi.callsOf("patch")).toHaveLength(0);
    expect(captured.LinkDiagramsDialog.linking).toBe(false);
  });

  it("reports the save as in progress until the patches land", async () => {
    let release: (v: unknown) => void = () => {};
    mockApi.on(
      "patch",
      /^\/diagrams\//,
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderPage();
    await call("InitiativesTab", "onLinkDiagrams", "init-1");
    await call("LinkDiagramsDialog", "onToggle", "d2");
    let saving: Promise<unknown> = Promise.resolve();
    act(() => {
      saving = (captured.LinkDiagramsDialog.onSave as () => Promise<unknown>)();
    });
    await waitFor(() => expect(captured.LinkDiagramsDialog.linking).toBe(true));
    await act(async () => {
      release({});
      await saving;
    });
    expect(captured.LinkDiagramsDialog.linking).toBe(false);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("saves cleanly (nothing to patch) when the workspace never reported its data", async () => {
    renderPage({ withData: false });
    await call("InitiativesTab", "onLinkDiagrams", "init-1");
    expect(screen.getByTestId("LinkDiagramsDialog-open")).toBeInTheDocument();
    await call("LinkDiagramsDialog", "onSave");
    expect(mockApi.callsOf("patch")).toHaveLength(0);
    expect(screen.queryByTestId("LinkDiagramsDialog-open")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("dismisses an error alert completely", async () => {
    mockApi.fail("patch", /^\/diagrams\//, 500);
    const user = userEvent.setup();
    renderPage();
    await call("InitiativesTab", "onUnlinkDiagram", DIAGRAMS[0], "init-1");
    expect(await screen.findByRole("alert")).toHaveTextContent("PATCH /diagrams/d1 failed");
    await user.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("words a failed unlink in the language the user switched to", async () => {
    mockApi.on("patch", /^\/diagrams\//, () => Promise.reject(42));
    renderPage();
    try {
      await act(async () => {
        await i18n.changeLanguage("de");
      });
      await call("InitiativesTab", "onUnlinkDiagram", DIAGRAMS[0], "init-1");
      expect(await screen.findByText("Diagramm konnte nicht getrennt werden")).toBeInTheDocument();
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
      localStorage.clear();
    }
  });

  it("unlinks without error when the workspace never reported its data", async () => {
    mockApi.on("patch", /^\/diagrams\//, {});
    renderPage({ withData: false });
    await call("InitiativesTab", "onUnlinkDiagram", DIAGRAMS[0], "init-1");
    expect(mockApi.callsOf("patch")).toHaveLength(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("EaDeliveryReport — create callbacks before the workspace reported its data", () => {
  it("navigates to a created SoAW", async () => {
    renderPage({ withData: false });
    await call("CreateSoAWDialog", "onCreated", { id: "soaw-7" });
    expect(location()).toBe("/ea-delivery/soaw/soaw-7");
  });

  it("navigates to a created ADR", async () => {
    renderPage({ withData: false });
    await call("CreateAdrDialog", "onCreated", { id: "adr-7" });
    expect(location()).toBe("/ea-delivery/adr/adr-7");
  });

  it("accepts a created diagram", async () => {
    renderPage({ withData: false });
    await call("CreateDiagramDialog", "onCreated");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("opens an ADR for an initiative with nothing pre-linked", async () => {
    renderPage({ withData: false });
    await call("NewArtefactSplitButton", "onSelect", "adr", "init-1");
    expect(screen.getByTestId("CreateAdrDialog-open")).toBeInTheDocument();
    expect(captured.CreateAdrDialog.preLinkedCards).toEqual([]);
  });

  it("opens nothing for an artefact kind it does not know", async () => {
    renderPage();
    await call("NewArtefactSplitButton", "onSelect", "spreadsheet", "init-1");
    expect(screen.queryByTestId("CreateAdrDialog-open")).not.toBeInTheDocument();
    expect(screen.queryByTestId("CreateSoAWDialog-open")).not.toBeInTheDocument();
    expect(screen.queryByTestId("CreateDiagramDialog-open")).not.toBeInTheDocument();
  });
});

describe("EaDeliveryReport — the SoAW context menu", () => {
  async function openMenu() {
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    await call("InitiativesTab", "onSoawContextMenu", anchor, { id: "soaw-1" });
    return screen.findByRole("menu");
  }

  it("labels its three actions", async () => {
    renderPage();
    await openMenu();
    expect(screen.getByText("Preview")).toBeInTheDocument();
    expect(screen.getByText("Edit")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("closes after opening the preview", async () => {
    const user = userEvent.setup();
    renderPage();
    await openMenu();
    await user.click(screen.getByText("Preview"));
    expect(location()).toBe("/ea-delivery/soaw/soaw-1/preview");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("closes after opening the editor", async () => {
    const user = userEvent.setup();
    renderPage();
    await openMenu();
    await user.click(screen.getByText("Edit"));
    expect(location()).toBe("/ea-delivery/soaw/soaw-1");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("ignores a second click on Preview while the menu is closing", async () => {
    const collector = collectErrors();
    try {
      renderPage({ entries: ["/reports/ea-delivery"] });
      await openMenu();
      const item = screen.getByText("Preview");
      fireEvent.click(item);
      fireEvent.click(item);
      expect(location()).toBe("/ea-delivery/soaw/soaw-1/preview");
      expect(collector.errors).toEqual([]);
    } finally {
      collector.stop();
    }
  });

  it("ignores a second click on Edit while the menu is closing", async () => {
    const collector = collectErrors();
    try {
      renderPage();
      await openMenu();
      const item = screen.getByText("Edit");
      fireEvent.click(item);
      fireEvent.click(item);
      expect(location()).toBe("/ea-delivery/soaw/soaw-1");
      expect(collector.errors).toEqual([]);
    } finally {
      collector.stop();
    }
  });

  it("asks for confirmation with the translated question", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    renderPage();
    await openMenu();
    await user.click(screen.getByText("Delete"));
    expect(confirmSpy).toHaveBeenCalledWith("Delete this Statement of Architecture Work?");
  });

  it("deletes cleanly when the workspace never reported its data", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockApi.on("delete", "/soaw/soaw-1", undefined);
    const user = userEvent.setup();
    renderPage({ withData: false });
    await openMenu();
    await user.click(screen.getByText("Delete"));
    await waitFor(() => expect(mockApi.callsOf("delete", "/soaw/soaw-1")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
