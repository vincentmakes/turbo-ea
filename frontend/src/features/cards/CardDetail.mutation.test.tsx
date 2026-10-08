/**
 * CardDetail page behaviour pinned for mutation testing, beyond
 * `CardDetail.test.tsx` / `CardDetail.branches.test.tsx`: the state the page
 * shows before its side requests answer, moving between two cards without a
 * remount, the unsaved-title guard, the double-click guards on the overflow
 * actions, the approval error classification, the header's logo / subtype /
 * type-label rules, the AI apply payload and the dialogs' close paths.
 *
 * `CardDetailContent`, the dialogs, the logo menu, the approval badge and the
 * AI panel are stubbed down to the props CardDetail hands them — each has its
 * own tests; what is under test here is what the page does with them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

const local = vi.hoisted(() => ({
  ai: { enabled: false, configured: false, enabled_types: [] as string[], running_models: [] },
  retention: 30,
}));
vi.mock("@/hooks/useAiStatus", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useAiStatus")>("@/hooks/useAiStatus");
  return { ...actual, useAiStatus: () => ({ aiStatus: local.ai, aiStatusLoaded: true }) };
});
vi.mock("@/hooks/useArchiveRetentionDays", () => ({
  useArchiveRetentionDays: () => ({ archiveRetentionDays: local.retention, loaded: true }),
}));

vi.mock("@/features/cards/sections", () => ({
  CardIdPill: ({ reference }: { reference: string }) => <span data-testid="card-id">{reference}</span>,
  DataQualityPill: ({ value }: { value: number }) => <span data-testid="dq">{value}%</span>,
}));

vi.mock("@/features/cards/CardDetailContent", () => ({
  default: (props: {
    card: { name: string };
    beforeTabs?: ReactNode;
    initialTab?: number;
    initialSubTab?: number;
    onAiSuggest?: () => void;
    aiBusy?: boolean;
    onDirtyChange?: (d: boolean) => void;
  }) => (
    <div>
      {props.beforeTabs}
      <div
        data-testid="content"
        data-name={props.card.name}
        data-tab={String(props.initialTab)}
        data-subtab={String(props.initialSubTab)}
        data-busy={String(props.aiBusy)}
      />
      {props.onAiSuggest && <button onClick={props.onAiSuggest}>content-ai-suggest</button>}
      <button onClick={() => props.onDirtyChange?.(true)}>content-dirty</button>
    </div>
  ),
}));

vi.mock("@/features/cards/ArchiveDeleteDialog", () => ({
  default: ({
    open,
    mode,
    onClose,
    onConfirmed,
  }: {
    open: boolean;
    mode: string;
    onClose: () => void;
    onConfirmed: () => void;
  }) =>
    open ? (
      <div data-testid={`${mode}-dialog`}>
        <button onClick={onConfirmed}>{mode}-confirm</button>
        <button onClick={onClose}>{mode}-close</button>
      </div>
    ) : null,
}));

vi.mock("@/features/cards/RestoreDialog", () => ({
  default: ({
    open,
    cardId,
    cardName,
    onClose,
    onConfirmed,
  }: {
    open: boolean;
    cardId: string;
    cardName: string;
    onClose: () => void;
    onConfirmed: (c: Record<string, unknown>) => void;
  }) =>
    open ? (
      <div data-testid="restore-dialog">
        <button
          onClick={() =>
            onConfirmed({
              id: cardId,
              name: cardName,
              type: "Application",
              status: "ACTIVE",
              approval_status: "DRAFT",
              data_quality: 40,
              lifecycle: {},
              attributes: {},
            })
          }
        >
          restore-confirm
        </button>
        <button onClick={onClose}>restore-close</button>
      </div>
    ) : null,
}));

vi.mock("@/components/CardLogoMenu", () => ({
  default: ({ hasLogo, anchorEl }: { hasLogo: boolean; anchorEl: HTMLElement | null }) => (
    <div data-testid="logo-menu" data-has-logo={String(hasLogo)} data-open={String(!!anchorEl)} />
  ),
}));

// The real badge fires `onAction` and forgets the promise; this stand-in keeps
// it, so a failed transition the page did NOT handle itself (shown as an error,
// or turned into the mandatory-items list) would surface as `approval-failure`.
vi.mock("@/components/ApprovalStatusBadge", () => ({
  default: function ApprovalBadgeStub({
    status,
    canChange,
    onAction,
  }: {
    status: string;
    canChange: boolean;
    onAction?: (a: "approve" | "reject" | "reset") => unknown;
  }) {
    const [failure, setFailure] = useState("");
    return (
      <div>
        <span data-testid="approval">{status}</span>
        {canChange &&
          onAction &&
          (["approve", "reject", "reset"] as const).map((a) => (
            <button
              key={a}
              onClick={() => {
                setFailure("");
                Promise.resolve(onAction(a)).catch((e: unknown) =>
                  setFailure(e instanceof Error ? e.message : String(e)),
                );
              }}
            >
              approval-{a}
            </button>
          ))}
        {failure && <span data-testid="approval-failure">{failure}</span>}
      </div>
    );
  },
}));

vi.mock("@/components/AiSuggestPanel", () => ({
  default: ({
    response,
    loading,
    error,
    onApply,
    onDismiss,
  }: {
    response: unknown;
    loading: boolean;
    error: string;
    onApply: (p: { description: string; fields?: Record<string, unknown> }) => Promise<void>;
    onDismiss: () => void;
  }) => (
    <div data-testid="ai-panel" data-loading={String(loading)}>
      {error && <span data-testid="ai-error">{error}</span>}
      {!!response && <span>ai-response</span>}
      <button onClick={() => onApply({ description: "Suggested text" })}>apply-description</button>
      <button onClick={() => onApply({ description: "", fields: { vendor: "Acme" } })}>
        apply-fields
      </button>
      <button onClick={onDismiss}>ai-dismiss</button>
    </div>
  ),
}));

import CardDetail from "./CardDetail";
import { ApiError } from "@/api/client";
import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { makeCardType, makeSubtype } from "@/test/fixtures/metamodel";
import { renderWithProviders } from "@/test/render";
import type { Card } from "@/types";

const APP = makeCardType({
  key: "Application",
  label: "Business App",
  icon: "apps",
  allow_card_logo: true,
  subtypes: [
    makeSubtype({ key: "businessApp", label: "Business Application" }),
    makeSubtype({ key: "microservice", label: "Microservice" }),
  ],
});
/** A type with no subtypes key at all, and no custom logo. */
const PLAIN = makeCardType({ key: "Plain", label: "Plain Type", icon: "category" });
/** A type whose subtype list exists but is empty. */
const EMPTY_SUBTYPES = makeCardType({ key: "Bare", label: "Bare Type", icon: "category", subtypes: [] });

const PERMS = {
  can_view: true,
  can_edit: true,
  can_archive: true,
  can_delete: true,
  can_approval_status: true,
  can_manage_stakeholders: true,
  can_manage_relations: true,
  can_manage_documents: true,
  can_manage_comments: true,
  can_create_comments: true,
  can_bpm_edit: true,
  can_bpm_manage_drafts: true,
  can_bpm_approve: true,
  can_manage_adr_links: true,
  can_manage_diagram_links: true,
  can_view_costs: true,
};

const CARD = {
  id: "c1",
  name: "CRM",
  type: "Application",
  subtype: "businessApp",
  description: "Customer system",
  status: "ACTIVE",
  approval_status: "DRAFT",
  data_quality: 60,
  lifecycle: {},
  attributes: { shared: false },
  reference: "APP-0007",
} as unknown as Card;

const C2 = { ...CARD, id: "c2", name: "ERP", reference: "APP-0008" } as unknown as Card;

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

function renderPage(route = "/cards/c1") {
  return renderWithProviders(
    <>
      <CardDetail />
      <LocationProbe />
      <Link to="/cards/c2">go-c2</Link>
    </>,
    {
      route,
      routes: [
        { path: "/cards/:id" },
        { path: "/inventory", element: <LocationProbe /> },
        { path: "/", element: <LocationProbe /> },
      ],
    },
  );
}

const location = () => screen.getByTestId("location").textContent;

function deferred<T = unknown>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function openActions(user: ReturnType<typeof renderPage>["user"]) {
  await user.click(await screen.findByRole("button", { name: "More actions" }));
  return screen.findByRole("menu");
}

function routeCard(card: Partial<Card> = {}) {
  mockApi.on("get", "/cards/c1", { ...CARD, ...card });
}

function routeC2(perms: Partial<typeof PERMS> = {}) {
  mockApi.on("get", "/cards/c2", C2);
  mockApi.on("get", "/cards/c2/my-permissions", { effective: { ...PERMS, ...perms } });
  mockApi.on("get", "/cards/c2/me/observe", { is_observer: false, observer_role_available: false });
}

/** Whether the page currently asks the browser to confirm a reload / tab close. */
function guardsUnload(): boolean {
  const ev = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(ev);
  return ev.defaultPrevented;
}

const content = () => screen.getByTestId("content");

beforeEach(() => {
  hookState.reset();
  mockApi.reset();
  local.ai = { enabled: false, configured: false, enabled_types: [], running_models: [] };
  local.retention = 30;
  withMetamodel([APP, PLAIN, EMPTY_SUBTYPES]);
  routeCard();
  mockApi.on("get", "/cards/c1/my-permissions", { effective: PERMS });
  mockApi.on("get", "/favorites", []);
  mockApi.on("get", "/cards/c1/me/observe", { is_observer: false, observer_role_available: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("CardDetail — before the side requests answer", () => {
  it("offers 'add to favorites' and no observe action while their probes are pending", async () => {
    mockApi.on("get", "/favorites", () => new Promise(() => {}));
    mockApi.on("get", "/cards/c1/me/observe", () => new Promise(() => {}));
    const { user } = renderPage();
    const menu = await openActions(user);
    expect(within(menu).getByRole("menuitem", { name: /Add to favorites/ })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: /observ/i })).not.toBeInTheDocument();
  });

  it("shows no AI panel and is not busy once the card is in", async () => {
    local.ai = { enabled: true, configured: true, enabled_types: [], running_models: [] };
    renderPage();
    expect(await screen.findByText("content-ai-suggest")).toBeInTheDocument();
    expect(content()).toHaveAttribute("data-busy", "false");
    expect(screen.queryByTestId("ai-panel")).not.toBeInTheDocument();
  });

  it("starts without a back-to-top button", async () => {
    renderPage();
    await screen.findByTestId("content");
    expect(screen.queryByRole("button", { name: "Back to top" })).not.toBeInTheDocument();
  });

  it("shows back-to-top only once scrolled past 300px", async () => {
    renderPage();
    await screen.findByTestId("content");
    try {
      Object.defineProperty(window, "scrollY", { value: 300, configurable: true });
      act(() => {
        fireEvent.scroll(window);
      });
      expect(screen.queryByRole("button", { name: "Back to top" })).not.toBeInTheDocument();

      Object.defineProperty(window, "scrollY", { value: 301, configurable: true });
      act(() => {
        fireEvent.scroll(window);
      });
      expect(screen.getByRole("button", { name: "Back to top" })).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    }
  });

  it("fetches nothing when mounted without a card id", () => {
    renderWithProviders(<CardDetail />, { route: "/cards", routes: [{ path: "/cards" }] });
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(mockApi.calls).toEqual([]);
  });
});

describe("CardDetail — deep links", () => {
  it("passes no sub-tab when the URL names none, and keeps the other query params", async () => {
    renderPage("/cards/c1?foo=bar");
    await screen.findByTestId("content");
    expect(content()).toHaveAttribute("data-subtab", "undefined");
    expect(content()).toHaveAttribute("data-tab", "0");
    expect(location()).toBe("/cards/c1?foo=bar");
  });

  it("drops the tab query without adding a history entry", async () => {
    const { user } = renderWithProviders(
      <>
        <CardDetail />
        <LocationProbe />
      </>,
      {
        route: "/cards/c1?tab=2",
        routes: [{ path: "/cards/:id" }],
      },
    );
    const back = await screen.findByRole("button", { name: /arrow_back/ });
    await waitFor(() => expect(location()).toBe("/cards/c1"));
    // The arrow goes back one entry: with a replace there is none left on the
    // card, so the router stays put; a push would land on `?tab=2` again.
    await user.click(back);
    expect(location()).toBe("/cards/c1");
  });
});

describe("CardDetail — moving to another card", () => {
  it("loads the next card, its permissions, and resets the deep-link tabs", async () => {
    routeC2({ can_edit: false });
    const { user } = renderPage("/cards/c1?tab=2&subtab=1");
    await waitFor(() => expect(content()).toHaveAttribute("data-tab", "2"));
    expect(content()).toHaveAttribute("data-subtab", "1");
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();

    await user.click(screen.getByText("go-c2"));
    await waitFor(() => expect(content()).toHaveAttribute("data-name", "ERP"));
    expect(screen.getByRole("heading", { name: "ERP" })).toBeInTheDocument();
    expect(content()).toHaveAttribute("data-tab", "0");
    expect(content()).toHaveAttribute("data-subtab", "undefined");
    expect(mockApi.callsOf("get", "/cards/c2/my-permissions")).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument());
  });

  it("does not carry the previous card's permissions while the next ones load", async () => {
    mockApi.on("get", "/cards/c1/my-permissions", { effective: { ...PERMS, can_edit: false } });
    routeC2();
    mockApi.on("get", "/cards/c2/my-permissions", () => new Promise(() => {}));
    const { user } = renderPage();
    await screen.findByTestId("content");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument());

    await user.click(screen.getByText("go-c2"));
    await waitFor(() => expect(content()).toHaveAttribute("data-name", "ERP"));
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("forgets the favourite and observer state when the next card's probes fail", async () => {
    mockApi.on("get", "/favorites", [{ id: "f1", card_id: "c1" }]);
    mockApi.on("get", "/cards/c1/me/observe", { is_observer: true, observer_role_available: true });
    routeC2();
    const { user } = renderPage();

    let menu = await openActions(user);
    expect(await within(menu).findByRole("menuitem", { name: /Remove from favorites/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /Stop observing/ })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

    mockApi.fail("get", "/favorites", 500);
    mockApi.fail("get", "/cards/c2/me/observe", 500);
    await user.click(screen.getByText("go-c2"));
    await waitFor(() => expect(content()).toHaveAttribute("data-name", "ERP"));
    await waitFor(() => expect(mockApi.callsOf("get", "/cards/c2/me/observe")).toHaveLength(1));

    menu = await openActions(user);
    await waitFor(() =>
      expect(within(menu).getByRole("menuitem", { name: /Add to favorites/ })).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(within(menu).queryByRole("menuitem", { name: /observ/i })).not.toBeInTheDocument(),
    );
  });
});

describe("CardDetail — favourites and observing", () => {
  it("is a favourite only when the card itself is in the list", async () => {
    mockApi.on("get", "/favorites", [{ id: "f9", card_id: "other" }]);
    const { user } = renderPage();
    await waitFor(() => expect(mockApi.callsOf("get", "/favorites")).toHaveLength(1));
    const menu = await openActions(user);
    expect(within(menu).getByRole("menuitem", { name: /Add to favorites/ })).toBeInTheDocument();
  });

  it("is a favourite when the card is among several", async () => {
    mockApi.on("get", "/favorites", [
      { id: "f9", card_id: "other" },
      { id: "f1", card_id: "c1" },
    ]);
    const { user } = renderPage();
    const menu = await openActions(user);
    expect(await within(menu).findByRole("menuitem", { name: /Remove from favorites/ })).toBeInTheDocument();
  });

  it("ignores a second favourite click while the first is saving, then shows the new state", async () => {
    const d = deferred();
    mockApi.on("post", "/favorites/c1", () => d.promise);
    const { user } = renderPage();

    let menu = await openActions(user);
    await user.click(within(menu).getByRole("menuitem", { name: /Add to favorites/ }));
    menu = await openActions(user);
    const item = within(menu).getByRole("menuitem", { name: /Add to favorites/ });
    expect(item).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(item);
    expect(mockApi.callsOf("post", "/favorites/c1")).toHaveLength(1);

    await act(async () => {
      d.resolve({});
    });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    menu = await openActions(user);
    expect(within(menu).getByRole("menuitem", { name: /Remove from favorites/ })).not.toHaveAttribute(
      "aria-disabled",
    );
  });

  it("ignores a second observe click while the first is saving", async () => {
    mockApi.on("get", "/cards/c1/me/observe", { is_observer: false, observer_role_available: true });
    const d = deferred();
    mockApi.on("post", "/cards/c1/me/observe", () => d.promise);
    const { user } = renderPage();

    let menu = await openActions(user);
    await user.click(await within(menu).findByRole("menuitem", { name: /Observe this card/ }));
    menu = await openActions(user);
    const item = within(menu).getByRole("menuitem", { name: /Observe this card/ });
    expect(item).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(item);
    expect(mockApi.callsOf("post", "/cards/c1/me/observe")).toHaveLength(1);
    await act(async () => {
      d.resolve({});
    });
  });

  it("shows the observe icon for each state and flips back after stopping", async () => {
    mockApi.on("get", "/cards/c1/me/observe", { is_observer: true, observer_role_available: true });
    mockApi.on("delete", "/cards/c1/me/observe", {});
    const { user } = renderPage();

    let menu = await openActions(user);
    const stop = await within(menu).findByRole("menuitem", { name: /Stop observing/ });
    expect(within(stop).getByText("visibility")).toBeInTheDocument();
    await user.click(stop);
    expect(await screen.findByText("You have stopped observing this card")).toBeInTheDocument();

    menu = await openActions(user);
    const observe = await within(menu).findByRole("menuitem", { name: /Observe this card/ });
    expect(within(observe).getByText("visibility_off")).toBeInTheDocument();
  });

  it("closes the observe snackbar on Escape", async () => {
    mockApi.on("get", "/cards/c1/me/observe", { is_observer: false, observer_role_available: true });
    mockApi.on("post", "/cards/c1/me/observe", {});
    const { user } = renderPage();
    const menu = await openActions(user);
    await user.click(await within(menu).findByRole("menuitem", { name: /Observe this card/ }));
    expect(await screen.findByText("You are now observing this card")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("hides the observe action when the observer probe fails", async () => {
    mockApi.fail("get", "/cards/c1/me/observe", 500);
    const { user } = renderPage();
    await waitFor(() => expect(mockApi.callsOf("get", "/cards/c1/me/observe")).toHaveLength(1));
    const menu = await openActions(user);
    await waitFor(() =>
      expect(within(menu).queryByRole("menuitem", { name: /observ/i })).not.toBeInTheDocument(),
    );
  });

  it("closes the menu after opening the card in a new tab", async () => {
    vi.spyOn(window, "open").mockImplementation(() => null);
    const { user } = renderPage();
    const menu = await openActions(user);
    await user.click(within(menu).getByRole("menuitem", { name: /Open in new tab/ }));
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });
});

describe("CardDetail — unsaved title edits", () => {
  async function beginEdit(user: ReturnType<typeof renderPage>["user"]) {
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    return screen.getByRole("textbox", { name: "Name" });
  }

  it("is not dirty when the editor is open but nothing changed", async () => {
    routeCard({ alias: undefined });
    const { user } = renderPage();
    await beginEdit(user);
    expect(guardsUnload()).toBe(false);
  });

  it("is not dirty with an unchanged alias either", async () => {
    routeCard({ alias: "Legacy" });
    const { user } = renderPage();
    await beginEdit(user);
    expect(screen.getByRole("textbox", { name: "Alias" })).toHaveValue("Legacy");
    expect(guardsUnload()).toBe(false);
  });

  it("is dirty when only the name changed", async () => {
    const { user } = renderPage();
    const name = await beginEdit(user);
    await user.type(name, "X");
    expect(guardsUnload()).toBe(true);
  });

  it("is dirty when only the alias changed", async () => {
    const { user } = renderPage();
    await beginEdit(user);
    await user.type(screen.getByRole("textbox", { name: "Alias" }), "Legacy");
    expect(guardsUnload()).toBe(true);
  });

  it("is dirty when a section reports unsaved changes", async () => {
    const { user } = renderPage();
    await screen.findByTestId("content");
    expect(guardsUnload()).toBe(false);
    await user.click(screen.getByText("content-dirty"));
    expect(guardsUnload()).toBe(true);
  });

  it("asks before leaving with a changed title, and stays when declined", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { user } = renderPage();
    const name = await beginEdit(user);
    await user.type(name, "X");

    await user.click(screen.getByRole("link", { name: "go-c2" }));
    expect(confirm).toHaveBeenCalledWith("You have unsaved changes. Leave without saving?");
    expect(location()).toBe("/cards/c1");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("CRMX");
  });

  it("leaves a deleted card without asking, even with a changed title", async () => {
    // The unsaved title of a card that no longer exists has nowhere to go,
    // so declining a prompt must not strand the user on its page.
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { user } = renderPage();
    const name = await beginEdit(user);
    await user.type(name, "X");

    const menu = await openActions(user);
    await user.click(within(menu).getByRole("menuitem", { name: /Delete/ }));
    await user.click(await screen.findByText("delete-confirm"));
    await waitFor(() => expect(location()).toBe("/inventory"));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.queryByTestId("delete-dialog")).not.toBeInTheDocument();
  });

  it("leaves a deleted card without asking when a section has unsaved changes", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { user } = renderPage();
    await user.click(await screen.findByText("content-dirty"));

    const menu = await openActions(user);
    await user.click(within(menu).getByRole("menuitem", { name: /Delete/ }));
    await user.click(await screen.findByText("delete-confirm"));
    await waitFor(() => expect(location()).toBe("/inventory"));
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("CardDetail — inline name editing", () => {
  it("shows the alias placeholder and an un-invalid name field", async () => {
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    expect(screen.getByRole("textbox", { name: "Alias" })).toHaveAttribute("placeholder", "e.g. CRM-v2");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveAttribute("aria-invalid", "false");
  });

  it("marks the name invalid when emptied, and clears the error on the next edit", async () => {
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    const name = screen.getByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("This field is required")).toBeInTheDocument();
    expect(name).toHaveAttribute("aria-invalid", "true");

    // Typing the unchanged name back and saving closes the editor without a
    // request; reopening starts clean.
    await user.type(name, "CRM");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("textbox", { name: "Name" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.queryByText("This field is required")).not.toBeInTheDocument();
    expect(mockApi.callsOf("patch")).toHaveLength(0);
  });

  it("treats a whitespace-only name as empty", async () => {
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    const name = screen.getByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.type(name, "   ");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("This field is required")).toBeInTheDocument();
    expect(mockApi.callsOf("patch")).toHaveLength(0);
  });

  it("trims the name and alias, and clears a whitespace-only alias", async () => {
    mockApi.on("patch", "/cards/c1", (_p: string, body: unknown) => ({ ...CARD, ...(body as object) }));
    routeCard({ alias: "Old" });
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    const name = screen.getByRole("textbox", { name: "Name" });
    const alias = screen.getByRole("textbox", { name: "Alias" });
    await user.clear(name);
    await user.type(name, "  CRM Cloud  ");
    await user.clear(alias);
    await user.type(alias, "  Legacy  ");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockApi.callsOf("patch", "/cards/c1")).toHaveLength(1));
    expect(mockApi.callsOf("patch", "/cards/c1")[0].body).toEqual({ name: "CRM Cloud", alias: "Legacy" });

    await screen.findByRole("heading", { name: "CRM Cloud" });
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByRole("textbox", { name: "Alias" }));
    await user.type(screen.getByRole("textbox", { name: "Alias" }), "   ");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockApi.callsOf("patch", "/cards/c1")).toHaveLength(2));
    expect(mockApi.callsOf("patch", "/cards/c1")[1].body).toEqual({ name: "CRM Cloud", alias: null });
  });

  it("disables the editor and drops the old error while the save is in flight", async () => {
    const d = deferred();
    mockApi.on("patch", "/cards/c1", () => d.promise);
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    const name = screen.getByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("This field is required")).toBeInTheDocument();

    await user.type(name, "CRM Cloud");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(name).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.queryByText("This field is required")).not.toBeInTheDocument();
    await act(async () => {
      d.resolve({ ...CARD, name: "CRM Cloud" });
    });
    expect(await screen.findByRole("heading", { name: "CRM Cloud" })).toBeInTheDocument();
  });

  it("consumes Enter and Escape in the title editor", async () => {
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    // Enter with an unchanged name just closes the editor.
    expect(fireEvent.keyDown(screen.getByRole("textbox", { name: "Name" }), { key: "Enter" })).toBe(false);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(fireEvent.keyDown(screen.getByRole("textbox", { name: "Alias" }), { key: "Escape" })).toBe(false);
    expect(screen.queryByRole("textbox", { name: "Name" })).not.toBeInTheDocument();
  });

  it("names the edit button and the alias line in their tooltips", async () => {
    routeCard({ alias: "Legacy" });
    const { user } = renderPage();
    await user.hover(await screen.findByRole("button", { name: "Edit" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Edit");
    expect(screen.getByTestId("card-alias")).toHaveAttribute("aria-label", "Alias");
  });
});

describe("CardDetail — header", () => {
  it("names the overflow button in its tooltip", async () => {
    const { user } = renderPage();
    await user.hover(await screen.findByRole("button", { name: "More actions" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("More actions");
  });

  it("shows the type's label rather than its key", async () => {
    renderPage();
    expect(await screen.findByText("Business App")).toBeInTheDocument();
    expect(screen.queryByText("Application")).not.toBeInTheDocument();
  });

  it("renders a card whose type is not in the metamodel, keyed by its type", async () => {
    routeCard({ type: "Mystery", subtype: undefined });
    local.ai = { enabled: true, configured: true, enabled_types: [], running_models: [] };
    mockApi.on("post", "/ai/suggest", () => new Promise(() => {}));
    const { user } = renderPage();
    expect(await screen.findByText("Mystery")).toBeInTheDocument();
    expect(screen.getByTestId("card-id")).toHaveTextContent("APP-0007");
    expect(screen.queryByLabelText("Change logo")).not.toBeInTheDocument();
    // The AI panel renders without the type's field schema.
    await user.click(screen.getByText("content-ai-suggest"));
    expect(await screen.findByTestId("ai-panel")).toHaveAttribute("data-loading", "true");
  });

  it("shows no subtype slot for a type without subtypes", async () => {
    routeCard({ type: "Plain", subtype: undefined });
    renderPage();
    expect(await screen.findByText("Plain Type")).toBeInTheDocument();
    expect(screen.queryByText("·")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change subtype" })).not.toBeInTheDocument();
  });

  it("shows no subtype slot for a type with an empty subtype list", async () => {
    routeCard({ type: "Bare", subtype: undefined });
    renderPage();
    expect(await screen.findByText("Bare Type")).toBeInTheDocument();
    expect(screen.queryByText("·")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change subtype" })).not.toBeInTheDocument();
  });

  it("offers 'Set subtype' for an editable card without one", async () => {
    routeCard({ subtype: undefined });
    renderPage();
    expect(await screen.findByRole("button", { name: "Change subtype" })).toHaveTextContent("Set subtype");
  });

  it("shows only the separator for a read-only card without a subtype", async () => {
    mockApi.on("get", "/cards/c1/my-permissions", { effective: { ...PERMS, can_edit: false } });
    routeCard({ subtype: undefined });
    renderPage();
    await screen.findByTestId("content");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Change subtype" })).not.toBeInTheDocument();
    // The separator is followed directly by the reference pill.
    expect(screen.getByText("·").nextElementSibling).toBe(screen.getByTestId("card-id"));
  });

  it("shows a plain subtype label to a reader who cannot edit", async () => {
    mockApi.on("get", "/cards/c1/my-permissions", { effective: { ...PERMS, can_edit: false } });
    renderPage();
    await screen.findByTestId("content");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Change subtype" })).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Business Application")).toBeInTheDocument();
  });

  it("does not offer the subtype picker on an archived card", async () => {
    routeCard({ status: "ARCHIVED", archived_at: new Date().toISOString() });
    renderPage();
    await screen.findByText(/This card is archived\./);
    expect(screen.queryByRole("button", { name: "Change subtype" })).not.toBeInTheDocument();
    expect(screen.getByText("Business Application")).toBeInTheDocument();
  });

  it("focuses the current subtype when the picker opens, and closes on Escape", async () => {
    routeCard({ subtype: "microservice" });
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Change subtype" }));
    const menu = await screen.findByRole("menu");
    await waitFor(() => expect(within(menu).getByRole("menuitem", { name: "Microservice" })).toHaveFocus());
    expect(within(menu).getByRole("menuitem", { name: "Microservice" })).toHaveClass("Mui-selected");
    expect(within(menu).getByRole("menuitem", { name: "None" })).not.toHaveClass("Mui-selected");
    expect(within(menu).getByRole("menuitem", { name: "Business Application" })).not.toHaveClass(
      "Mui-selected",
    );

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("marks 'None' as current for a card without a subtype", async () => {
    routeCard({ subtype: undefined });
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Change subtype" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "None" })).toHaveClass("Mui-selected");
  });

  it("disables the subtype picker while the change saves", async () => {
    const d = deferred();
    mockApi.on("patch", "/cards/c1", () => d.promise);
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Change subtype" }));
    await user.click(await screen.findByRole("menuitem", { name: "Microservice" }));
    expect(screen.getByRole("button", { name: "Change subtype", hidden: true })).toBeDisabled();
    await act(async () => {
      d.resolve({ ...CARD, subtype: "microservice" });
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Change subtype" })).toBeEnabled());
  });
});

describe("CardDetail — logo", () => {
  function logoTile(icon: string) {
    // icon glyph → its tile → the tooltip-wrapped clickable box
    return screen.getByText(icon).parentElement!.parentElement!;
  }

  it("offers the logo editor on an editable card of a logo-enabled type", async () => {
    renderPage();
    expect(await screen.findByLabelText("Change logo")).toBeInTheDocument();
    expect(screen.getByText("photo_camera")).toBeInTheDocument();
    expect(screen.getByTestId("logo-menu")).toHaveAttribute("data-has-logo", "false");
  });

  it("tells the logo menu when the card has a logo", async () => {
    routeCard({ logo_updated_at: "2026-10-01T00:00:00Z" });
    renderPage();
    await screen.findByTestId("content");
    expect(screen.getByTestId("logo-menu")).toHaveAttribute("data-has-logo", "true");
  });

  it("offers no logo editor for a type without custom logos", async () => {
    routeCard({ type: "Plain", subtype: undefined });
    const { user } = renderPage();
    await screen.findByText("Plain Type");
    expect(screen.queryByLabelText("Change logo")).not.toBeInTheDocument();
    expect(screen.queryByText("photo_camera")).not.toBeInTheDocument();
    expect(logoTile("category").getAttribute("aria-label") ?? "").toBe("");
    await user.click(logoTile("category"));
    expect(screen.getByTestId("logo-menu")).toHaveAttribute("data-open", "false");
  });

  it("offers no logo editor on an archived card", async () => {
    routeCard({ status: "ARCHIVED", archived_at: new Date().toISOString() });
    renderPage();
    await screen.findByText(/This card is archived\./);
    expect(screen.queryByLabelText("Change logo")).not.toBeInTheDocument();
    expect(screen.queryByText("photo_camera")).not.toBeInTheDocument();
  });
});

describe("CardDetail — archived card", () => {
  it("counts the purge down from the archive date", async () => {
    routeCard({
      status: "ARCHIVED",
      archived_at: new Date(Date.now() - 5 * 86400000 - 60000).toISOString(),
    });
    renderPage();
    const banner = await screen.findByText(/This card is archived\./);
    expect(banner).toHaveTextContent("It will be permanently deleted in 25 days.");
    expect(banner).not.toHaveTextContent("kept indefinitely");
  });

  it("offers neither archive nor delete in the overflow menu", async () => {
    routeCard({ status: "ARCHIVED", archived_at: new Date().toISOString() });
    const { user } = renderPage();
    await screen.findByText(/This card is archived\./);
    const menu = await openActions(user);
    expect(within(menu).queryByRole("menuitem", { name: /Delete/ })).not.toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: /Archive/ })).not.toBeInTheDocument();
  });

  it("closes the restore dialog on cancel and after restoring", async () => {
    routeCard({ status: "ARCHIVED", archived_at: new Date().toISOString() });
    const { user } = renderPage();
    await screen.findByText(/This card is archived\./);
    await user.click(screen.getByRole("button", { name: /Restore/ }));
    await user.click(await screen.findByText("restore-close"));
    expect(screen.queryByTestId("restore-dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Restore/ }));
    await user.click(await screen.findByText("restore-confirm"));
    await waitFor(() => expect(screen.queryByText(/This card is archived\./)).not.toBeInTheDocument());
    expect(screen.queryByTestId("restore-dialog")).not.toBeInTheDocument();
  });

  it("closes the archive dialog once the archive went through", async () => {
    const { user } = renderPage();
    const menu = await openActions(user);
    await user.click(within(menu).getByRole("menuitem", { name: /Archive/ }));
    routeCard({ status: "ARCHIVED", archived_at: new Date().toISOString() });
    await user.click(await screen.findByText("archive-confirm"));
    expect(await screen.findByText(/This card is archived\./)).toBeInTheDocument();
    expect(screen.queryByTestId("archive-dialog")).not.toBeInTheDocument();
  });

  it("offers no delete in the overflow menu without the delete right", async () => {
    mockApi.on("get", "/cards/c1/my-permissions", { effective: { ...PERMS, can_delete: false } });
    const { user } = renderPage();
    await waitFor(() => expect(mockApi.callsOf("get", "/cards/c1/my-permissions")).toHaveLength(1));
    const menu = await openActions(user);
    await waitFor(() =>
      expect(within(menu).queryByRole("menuitem", { name: /Delete/ })).not.toBeInTheDocument(),
    );
    expect(within(menu).getByRole("menuitem", { name: /Archive/ })).toBeInTheDocument();
  });
});

describe("CardDetail — approval", () => {
  const BLOCKED = "Cannot approve — missing mandatory items";

  function blockedDetail(
    relations: { key: string; label: string; side: string; other_type_key: string }[],
    tagGroups: { id: string; name: string }[],
  ) {
    return {
      code: "approval_blocked_mandatory_missing",
      missing_relations: relations,
      missing_tag_groups: tagGroups,
    };
  }

  const REL = { key: "relAppToITC", label: "runs on", side: "source", other_type_key: "ITComponent" };

  it("clears the mandatory-items list once an approval goes through", async () => {
    let calls = 0;
    mockApi.on("post", /^\/cards\/c1\/approval-status/, () => {
      calls += 1;
      if (calls === 1) throw new ApiError("blocked", 400, blockedDetail([REL], []));
      return {};
    });
    const { user } = renderPage();
    await user.click(await screen.findByText("approval-approve"));
    expect(await screen.findByText(BLOCKED)).toBeInTheDocument();

    await user.click(screen.getByText("approval-approve"));
    await waitFor(() => expect(screen.getByTestId("approval")).toHaveTextContent("APPROVED"));
    expect(screen.queryByText(BLOCKED)).not.toBeInTheDocument();
  });

  it("lists missing tag groups even with no missing relation", async () => {
    mockApi.fail("post", /^\/cards\/c1\/approval-status/, 400, blockedDetail([], [{ id: "g1", name: "Criticality" }]));
    const { user } = renderPage();
    await user.click(await screen.findByText("approval-approve"));
    expect(await screen.findByText(BLOCKED)).toBeInTheDocument();
    expect(screen.getByText("Tag group: Criticality")).toBeInTheDocument();
  });

  it("lists missing relations even with no missing tag group", async () => {
    mockApi.fail("post", /^\/cards\/c1\/approval-status/, 400, blockedDetail([REL], []));
    const { user } = renderPage();
    await user.click(await screen.findByText("approval-approve"));
    expect(await screen.findByText(BLOCKED)).toBeInTheDocument();
    expect(screen.getByText("Relation: runs on (ITComponent)")).toBeInTheDocument();
  });

  it("shows no list when the block names nothing", async () => {
    mockApi.fail("post", /^\/cards\/c1\/approval-status/, 400, blockedDetail([], []));
    const { user } = renderPage();
    await user.click(await screen.findByText("approval-approve"));
    await waitFor(() => expect(mockApi.callsOf("post")).toHaveLength(1));
    // The handler settled without rethrowing, and without calling it an error.
    await act(async () => {});
    expect(screen.queryByText(BLOCKED)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByTestId("approval-failure")).not.toBeInTheDocument();
    expect(screen.getByTestId("approval")).toHaveTextContent("DRAFT");
  });

  it("shows a block-shaped error that is not a 400 as an error, not as the list", async () => {
    mockApi.fail("post", /^\/cards\/c1\/approval-status/, 409, blockedDetail([REL], []));
    const { user } = renderPage();
    await user.click(await screen.findByText("approval-approve"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "POST /cards/c1/approval-status?action=approve failed",
    );
    expect(screen.queryByText(BLOCKED)).not.toBeInTheDocument();
    // Handled on the page: nothing is rethrown to the badge.
    await act(async () => {});
    expect(screen.queryByTestId("approval-failure")).not.toBeInTheDocument();
    expect(screen.getByTestId("approval")).toHaveTextContent("DRAFT");
  });

  it("shows a 400 whose detail is null as an error", async () => {
    mockApi.fail("post", /^\/cards\/c1\/approval-status/, 400, null);
    const { user } = renderPage();
    await user.click(await screen.findByText("approval-approve"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "POST /cards/c1/approval-status?action=approve failed",
    );
    await act(async () => {});
    expect(screen.queryByTestId("approval-failure")).not.toBeInTheDocument();
  });

  it("shows a 400 carrying another code as an error, not as the list", async () => {
    mockApi.fail("post", /^\/cards\/c1\/approval-status/, 400, { code: "something_else" });
    const { user } = renderPage();
    await user.click(await screen.findByText("approval-approve"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "POST /cards/c1/approval-status?action=approve failed",
    );
    expect(screen.queryByText(BLOCKED)).not.toBeInTheDocument();
    await act(async () => {});
    expect(screen.queryByTestId("approval-failure")).not.toBeInTheDocument();
  });

  it("shows a look-alike that is not an ApiError as an error, not as the list", async () => {
    mockApi.on("post", /^\/cards\/c1\/approval-status/, () =>
      Promise.reject(
        Object.assign(new Error("not an api error"), { status: 400, detail: blockedDetail([REL], []) }),
      ),
    );
    const { user } = renderPage();
    await user.click(await screen.findByText("approval-approve"));
    expect(await screen.findByRole("alert")).toHaveTextContent("not an api error");
    expect(screen.queryByText(BLOCKED)).not.toBeInTheDocument();
    await act(async () => {});
    expect(screen.queryByTestId("approval-failure")).not.toBeInTheDocument();
  });

  it("replaces an earlier failure's error with the mandatory-items list", async () => {
    let calls = 0;
    mockApi.on("post", /^\/cards\/c1\/approval-status/, () => {
      calls += 1;
      if (calls === 1) throw new ApiError("Server unavailable", 503, null);
      throw new ApiError("blocked", 400, blockedDetail([REL], []));
    });
    const { user } = renderPage();
    await user.click(await screen.findByText("approval-approve"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Server unavailable");

    await user.click(screen.getByText("approval-approve"));
    expect(await screen.findByText(BLOCKED)).toBeInTheDocument();
    expect(screen.queryByText("Server unavailable")).not.toBeInTheDocument();
  });

  it("falls back to a generic message for a failure that is not an Error", async () => {
    mockApi.on("post", /^\/cards\/c1\/approval-status/, () => Promise.reject("nope"));
    const { user } = renderPage();
    await user.click(await screen.findByText("approval-approve"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("does not carry a failed transition's error over to the next card", async () => {
    routeC2();
    mockApi.fail("post", /^\/cards\/c1\/approval-status/, 500);
    const { user } = renderPage();
    await user.click(await screen.findByText("approval-approve"));
    expect(await screen.findByRole("alert")).toHaveTextContent("approval-status?action=approve failed");

    await user.click(screen.getByRole("link", { name: "go-c2" }));
    await waitFor(() => expect(content()).toHaveAttribute("data-name", "ERP"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("CardDetail — AI suggestions", () => {
  beforeEach(() => {
    local.ai = { enabled: true, configured: true, enabled_types: [], running_models: [] };
  });

  it("offers no suggestion when AI is off for the instance", async () => {
    local.ai = { enabled: false, configured: true, enabled_types: [], running_models: [] };
    renderPage();
    await screen.findByTestId("content");
    expect(screen.queryByText("content-ai-suggest")).not.toBeInTheDocument();
  });

  it("offers no suggestion to a reader who cannot edit", async () => {
    mockApi.on("get", "/cards/c1/my-permissions", { effective: { ...PERMS, can_edit: false } });
    renderPage();
    await screen.findByTestId("content");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument());
    expect(screen.queryByText("content-ai-suggest")).not.toBeInTheDocument();
  });

  it("is busy while the suggestion is generated", async () => {
    const d = deferred();
    mockApi.on("post", "/ai/suggest", () => d.promise);
    const { user } = renderPage();
    await user.click(await screen.findByText("content-ai-suggest"));
    expect(content()).toHaveAttribute("data-busy", "true");
    expect(screen.getByTestId("ai-panel")).toHaveAttribute("data-loading", "true");
    await act(async () => {
      d.resolve({ suggestions: {}, sources: [] });
    });
    expect(content()).toHaveAttribute("data-busy", "false");
  });

  it("applies extra fields onto the card's own attributes, without an empty description", async () => {
    mockApi.on("post", "/ai/suggest", { suggestions: {}, sources: [] });
    mockApi.on("patch", "/cards/c1", (_p: string, body: unknown) => ({ ...CARD, ...(body as object) }));
    const { user } = renderPage();
    await user.click(await screen.findByText("content-ai-suggest"));
    await user.click(await screen.findByText("apply-fields"));
    await waitFor(() => expect(mockApi.callsOf("patch", "/cards/c1")).toHaveLength(1));
    const body = mockApi.callsOf("patch", "/cards/c1")[0].body as Record<string, unknown>;
    expect(body).toEqual({ attributes: { shared: false, vendor: "Acme" } });
    expect(body).not.toHaveProperty("description");
  });

  it("applies a description alone without touching the attributes", async () => {
    mockApi.on("post", "/ai/suggest", { suggestions: {}, sources: [] });
    mockApi.on("patch", "/cards/c1", (_p: string, body: unknown) => ({ ...CARD, ...(body as object) }));
    const { user } = renderPage();
    await user.click(await screen.findByText("content-ai-suggest"));
    await user.click(await screen.findByText("apply-description"));
    await waitFor(() => expect(mockApi.callsOf("patch", "/cards/c1")).toHaveLength(1));
    const body = mockApi.callsOf("patch", "/cards/c1")[0].body as Record<string, unknown>;
    expect(body).toEqual({ description: "Suggested text" });
    expect(body).not.toHaveProperty("attributes");
  });

  it("dismisses a suggestion and offers a new one", async () => {
    mockApi.on("post", "/ai/suggest", { suggestions: {}, sources: [] });
    const { user } = renderPage();
    await user.click(await screen.findByText("content-ai-suggest"));
    expect(await screen.findByText("ai-response")).toBeInTheDocument();
    expect(screen.queryByText("content-ai-suggest")).not.toBeInTheDocument();
    await user.click(screen.getByText("ai-dismiss"));
    expect(screen.queryByTestId("ai-panel")).not.toBeInTheDocument();
    expect(screen.getByText("content-ai-suggest")).toBeInTheDocument();
  });

  it("dismisses a failed suggestion", async () => {
    mockApi.on("post", "/ai/suggest", () => Promise.reject(new Error("model offline")));
    const { user } = renderPage();
    await user.click(await screen.findByText("content-ai-suggest"));
    expect(await screen.findByTestId("ai-error")).toHaveTextContent("model offline");
    await user.click(screen.getByText("ai-dismiss"));
    expect(screen.queryByTestId("ai-panel")).not.toBeInTheDocument();
  });
});
