/**
 * CardDetail page logic beyond `CardDetail.test.tsx`: deep-link tabs, the
 * favourite / observe / copy-link actions, approval transitions (including the
 * mandatory-items block), inline name and subtype edits and their failures,
 * archive / restore / delete wiring, AI suggestions, the logo menu callbacks
 * and the PPM auto-field probe.
 *
 * `CardDetailContent` and the three dialogs are stubbed down to the props
 * CardDetail hands them — each has its own tests; what is under test here is
 * what the page does with their callbacks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation } from "react-router";

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
    card: { name: string; description?: string; attributes?: Record<string, unknown> };
    beforeTabs?: ReactNode;
    initialTab?: number | string;
    initialSubTab?: number;
    autoFieldKeys?: string[];
    onAiSuggest?: () => void;
    aiBusy?: boolean;
    onDirtyChange?: (d: boolean) => void;
  }) => (
    <div>
      {props.beforeTabs}
      <div
        data-testid="content"
        data-tab={String(props.initialTab)}
        data-subtab={String(props.initialSubTab)}
        data-auto={(props.autoFieldKeys ?? []).join(",")}
        data-busy={String(props.aiBusy)}
      >
        {props.card.description}
        {JSON.stringify(props.card.attributes ?? {})}
      </div>
      {props.onAiSuggest && <button onClick={props.onAiSuggest}>content-ai-suggest</button>}
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
  default: ({
    cardId,
    anchorEl,
    onClose,
    onChanged,
    onNotify,
    onError,
  }: {
    cardId: string;
    anchorEl: HTMLElement | null;
    onClose: () => void;
    onChanged: (id: string, at: string | null) => void;
    onNotify?: (m: string) => void;
    onError?: (m: string) => void;
  }) =>
    anchorEl ? (
      <div data-testid="logo-menu">
        <button onClick={() => onChanged(cardId, "2026-10-01T00:00:00Z")}>logo-changed</button>
        <button onClick={() => onNotify?.("Logo saved")}>logo-notify</button>
        <button onClick={() => onError?.("Logo failed")}>logo-error</button>
        <button onClick={onClose}>logo-close</button>
      </div>
    ) : null,
}));

import CardDetail from "./CardDetail";
import { ApiError } from "@/api/client";
import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { makeCardType, makeField, makeSection, makeSubtype } from "@/test/fixtures/metamodel";
import { makeUser, renderWithProviders } from "@/test/render";
import { AuthProvider } from "@/hooks/AuthContext";
import { setViewportWidth } from "@/test/matchMedia";
import type { Card } from "@/types";

const APP = makeCardType({
  key: "Application",
  label: "Application",
  allow_card_logo: true,
  subtypes: [
    makeSubtype({ key: "businessApp", label: "Business Application" }),
    makeSubtype({ key: "microservice", label: "Microservice" }),
  ],
  fields_schema: [
    makeSection({ fields: [makeField({ key: "shared", label: "Shared", type: "boolean" })] }),
  ],
});
const INITIATIVE = makeCardType({ key: "Initiative", label: "Initiative" });

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

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

function renderPage(route = "/cards/c1") {
  return renderWithProviders(
    <>
      <CardDetail />
      <LocationProbe />
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

async function openActions(user: ReturnType<typeof renderPage>["user"]) {
  await user.click(await screen.findByRole("button", { name: "More actions" }));
  return screen.findByRole("menu");
}

function routeCard(card: Partial<Card> = {}) {
  mockApi.on("get", "/cards/c1", { ...CARD, ...card });
}

beforeEach(() => {
  hookState.reset();
  mockApi.reset();
  local.ai = { enabled: false, configured: false, enabled_types: [], running_models: [] };
  local.retention = 30;
  withMetamodel([APP, INITIATIVE]);
  routeCard();
  mockApi.on("get", "/cards/c1/my-permissions", { effective: PERMS });
  mockApi.on("get", "/favorites", []);
  mockApi.on("get", "/cards/c1/me/observe", { is_observer: false, observer_role_available: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CardDetail — loading and deep links", () => {
  it("opens the tab and sub-tab named in the URL, then drops the query", async () => {
    renderPage("/cards/c1?tab=2&subtab=1");
    await waitFor(() => expect(screen.getByTestId("content")).toHaveAttribute("data-tab", "2"));
    expect(screen.getByTestId("content")).toHaveAttribute("data-subtab", "1");
    await waitFor(() => expect(location()).toBe("/cards/c1"));
  });

  it("hands a non-numeric tab on as a key and drops an unparseable sub-tab", async () => {
    // The content resolves the key against its own tab strip and opens the
    // Card tab for one it does not carry (cardTabs.test.ts, resolveCardTab).
    renderPage("/cards/c1?tab=abc&subtab=zz");
    await waitFor(() => expect(screen.getByTestId("content")).toHaveAttribute("data-subtab", "0"));
    expect(screen.getByTestId("content")).toHaveAttribute("data-tab", "abc");
  });

  it("keeps the default permissions when the permission probe fails", async () => {
    mockApi.fail("get", "/cards/c1/my-permissions", 500);
    renderPage();
    expect(await screen.findByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("shows the card reference and goes back with the arrow", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/inventory", "/cards/c1"]} initialIndex={1}>
        <AuthProvider user={makeUser()} refreshUser={async () => {}}>
          <Routes>
            <Route path="/cards/:id" element={<CardDetail />} />
            <Route path="/inventory" element={<LocationProbe />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByTestId("card-id")).toHaveTextContent("APP-0007");
    await user.click(screen.getByRole("button", { name: /arrow_back/ }));
    expect(await screen.findByTestId("location")).toHaveTextContent("/inventory");
  });

  it("marks PPM-computed fields on an Initiative with budget and cost lines", async () => {
    routeCard({ type: "Initiative", subtype: undefined });
    mockApi.on("get", "/ppm/initiatives/c1/has-costs", { has_budget_lines: true, has_cost_lines: true });
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("content")).toHaveAttribute("data-auto", "costBudget,costActual"),
    );
  });

  it("marks nothing when the PPM probe fails", async () => {
    routeCard({ type: "Initiative", subtype: undefined });
    mockApi.fail("get", "/ppm/initiatives/c1/has-costs", 403);
    renderPage();
    await waitFor(() => expect(mockApi.callsOf("get", "/ppm/initiatives/c1/has-costs")).toHaveLength(1));
    expect(screen.getByTestId("content")).toHaveAttribute("data-auto", "");
  });
});

describe("CardDetail — overflow actions", () => {
  it("removes and re-adds the card as a favourite", async () => {
    mockApi.on("get", "/favorites", [{ id: "f1", card_id: "c1" }]);
    mockApi.on("delete", "/favorites/c1", {});
    mockApi.on("post", "/favorites/c1", {});
    const { user } = renderPage();

    let menu = await openActions(user);
    await user.click(await within(menu).findByRole("menuitem", { name: /Remove from favorites/ }));
    await waitFor(() => expect(mockApi.callsOf("delete", "/favorites/c1")).toHaveLength(1));

    menu = await openActions(user);
    await user.click(await within(menu).findByRole("menuitem", { name: /Add to favorites/ }));
    await waitFor(() => expect(mockApi.callsOf("post", "/favorites/c1")).toHaveLength(1));
  });

  it("treats a failing favourite toggle and favourites read as best-effort", async () => {
    mockApi.fail("get", "/favorites", 500);
    mockApi.fail("post", "/favorites/c1", 500);
    const { user } = renderPage();
    const menu = await openActions(user);
    await user.click(within(menu).getByRole("menuitem", { name: /Add to favorites/ }));
    await waitFor(() => expect(mockApi.callsOf("post", "/favorites/c1")).toHaveLength(1));
    // Still "add": the failed write changed nothing.
    const again = await openActions(user);
    expect(within(again).getByRole("menuitem", { name: /Add to favorites/ })).toBeEnabled();
  });

  it("observes and stops observing, announcing each", async () => {
    mockApi.on("get", "/cards/c1/me/observe", { is_observer: false, observer_role_available: true });
    mockApi.on("post", "/cards/c1/me/observe", {});
    mockApi.on("delete", "/cards/c1/me/observe", {});
    const { user } = renderPage();

    let menu = await openActions(user);
    await user.click(await within(menu).findByRole("menuitem", { name: /Observe this card/ }));
    expect(await screen.findByText("You are now observing this card")).toBeInTheDocument();

    menu = await openActions(user);
    await user.click(within(menu).getByRole("menuitem", { name: /Stop observing/ }));
    expect(await screen.findByText("You have stopped observing this card")).toBeInTheDocument();
  });

  it("hides Observe when the observer probe fails", async () => {
    mockApi.fail("get", "/cards/c1/me/observe", 500);
    const { user } = renderPage();
    const menu = await openActions(user);
    expect(within(menu).queryByRole("menuitem", { name: /Observe/ })).not.toBeInTheDocument();
  });

  it("keeps the observe state when the toggle fails", async () => {
    mockApi.on("get", "/cards/c1/me/observe", { is_observer: true, observer_role_available: false });
    mockApi.fail("delete", "/cards/c1/me/observe", 500);
    const { user } = renderPage();
    let menu = await openActions(user);
    await user.click(await within(menu).findByRole("menuitem", { name: /Stop observing/ }));
    await waitFor(() => expect(mockApi.callsOf("delete", "/cards/c1/me/observe")).toHaveLength(1));
    menu = await openActions(user);
    expect(within(menu).getByRole("menuitem", { name: /Stop observing/ })).toBeInTheDocument();
  });

  it("opens the card in a new tab", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { user } = renderPage();
    const menu = await openActions(user);
    await user.click(within(menu).getByRole("menuitem", { name: /Open in new tab/ }));
    expect(open).toHaveBeenCalledWith("/cards/c1", "_blank", "noopener,noreferrer");
  });

  it("copies the card link, and falls back to a prompt without a clipboard", async () => {
    const { user } = renderPage();
    // After userEvent.setup(), which installs a clipboard stub of its own.
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    let menu = await openActions(user);
    await user.click(within(menu).getByRole("menuitem", { name: /Copy link/ }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/cards/c1`);
    expect(await screen.findByText("Link copied to clipboard")).toBeInTheDocument();

    writeText.mockRejectedValueOnce(new Error("denied"));
    const prompt = vi.spyOn(window, "prompt").mockImplementation(() => null);
    menu = await openActions(user);
    await user.click(within(menu).getByRole("menuitem", { name: /Copy link/ }));
    await waitFor(() =>
      expect(prompt).toHaveBeenCalledWith("Copy this link manually:", `${window.location.origin}/cards/c1`),
    );
  });

  it("refreshes after an archive, and leaves for the inventory when the card is gone", async () => {
    const { user } = renderPage();
    let menu = await openActions(user);
    await user.click(within(menu).getByRole("menuitem", { name: /Archive/ }));
    // Closing the dialog does nothing.
    await user.click(await screen.findByText("archive-close"));
    expect(screen.queryByTestId("archive-dialog")).not.toBeInTheDocument();

    routeCard({ status: "ARCHIVED", archived_at: new Date().toISOString() });
    menu = await openActions(user);
    await user.click(within(menu).getByRole("menuitem", { name: /Archive/ }));
    await user.click(await screen.findByText("archive-confirm"));
    expect(await screen.findByText(/This card is archived\./)).toBeInTheDocument();
  });

  it("navigates to the inventory when the refresh after archiving fails", async () => {
    const { user } = renderPage();
    const menu = await openActions(user);
    await user.click(within(menu).getByRole("menuitem", { name: /Archive/ }));
    mockApi.fail("get", "/cards/c1", 404);
    await user.click(await screen.findByText("archive-confirm"));
    await waitFor(() => expect(location()).toBe("/inventory"));
  });

  it("navigates to the inventory after a delete, and closes the dialog on cancel", async () => {
    const { user } = renderPage();
    let menu = await openActions(user);
    await user.click(within(menu).getByRole("menuitem", { name: /Delete/ }));
    await user.click(await screen.findByText("delete-close"));
    expect(screen.queryByTestId("delete-dialog")).not.toBeInTheDocument();

    menu = await openActions(user);
    await user.click(within(menu).getByRole("menuitem", { name: /Delete/ }));
    await user.click(await screen.findByText("delete-confirm"));
    await waitFor(() => expect(location()).toBe("/inventory"));
  });

  it("leaves a deleted card with unsaved edits by moving forward, never back through history", async () => {
    // The unsaved-changes guard parks a sentinel entry in the real browser
    // history and steps back over it once the page is no longer dirty. That
    // step must not race the push to the inventory, or the browser can land
    // back on the deleted card.
    window.history.replaceState(null, "", "/inventory");
    window.history.pushState(null, "", "/cards/c1");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    try {
      render(
        <BrowserRouter>
          <AuthProvider user={makeUser()} refreshUser={async () => {}}>
            <Routes>
              <Route path="/cards/:id" element={<CardDetail />} />
              <Route path="/inventory" element={<LocationProbe />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>,
      );
      await user.click(await screen.findByRole("button", { name: "Edit" }));
      await user.type(screen.getByRole("textbox", { name: "Name" }), "X");
      const back = vi.spyOn(window.history, "back");

      await user.click(screen.getByRole("button", { name: "More actions" }));
      await user.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: /Delete/ }));
      await user.click(await screen.findByText("delete-confirm"));

      await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/inventory"));
      expect(window.location.pathname).toBe("/inventory");
      expect(back).not.toHaveBeenCalled();
      expect(confirm).not.toHaveBeenCalled();
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });
});

describe("CardDetail — archived card", () => {
  it("counts down to the purge and restores through the dialog", async () => {
    routeCard({ status: "ARCHIVED", archived_at: new Date().toISOString() });
    const { user } = renderPage();

    expect(await screen.findByText(/It will be permanently deleted in 30 days\./)).toBeInTheDocument();
    // An archived card offers neither archive nor delete in the overflow menu.
    const menu = await openActions(user);
    expect(within(menu).queryByRole("menuitem", { name: /Archive/ })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: /Restore/ }));
    await user.click(await screen.findByText("restore-close"));
    await user.click(screen.getByRole("button", { name: /Restore/ }));
    await user.click(await screen.findByText("restore-confirm"));
    await waitFor(() => expect(screen.queryByText(/This card is archived\./)).not.toBeInTheDocument());
    expect(screen.getByTestId("dq")).toHaveTextContent("40%");
  });

  it("says the card is kept indefinitely when retention is off, and deletes from the banner", async () => {
    local.retention = 0;
    routeCard({ status: "ARCHIVED", archived_at: new Date().toISOString() });
    const { user } = renderPage();

    const banner = await screen.findByText(/This card is archived\./);
    expect(banner).toHaveTextContent("It is kept indefinitely.");
    expect(banner).not.toHaveTextContent(/permanently deleted in/);
    await user.click(within(banner.closest("[role=alert]") as HTMLElement).getByRole("button", { name: /Delete/ }));
    expect(await screen.findByTestId("delete-dialog")).toBeInTheDocument();
  });

  it("hides the banner actions without archive or delete rights", async () => {
    mockApi.on("get", "/cards/c1/my-permissions", {
      effective: { ...PERMS, can_archive: false, can_delete: false },
    });
    routeCard({ status: "ARCHIVED", archived_at: new Date().toISOString() });
    renderPage();
    const banner = await screen.findByText(/This card is archived\./);
    await waitFor(() =>
      expect(within(banner.closest("[role=alert]") as HTMLElement).queryByRole("button")).toBeNull(),
    );
  });
});

describe("CardDetail — approval", () => {
  async function pickApproval(user: ReturnType<typeof renderPage>["user"], action: RegExp) {
    await user.click(await screen.findByText("Draft"));
    await user.click(await screen.findByRole("menuitem", { name: action }));
  }

  it("approves, rejects and resets, reflecting each status", async () => {
    mockApi.on("post", /^\/cards\/c1\/approval-status/, {});
    const { user } = renderPage();

    await pickApproval(user, /Approve/);
    expect(await screen.findByText("Approved")).toBeInTheDocument();
    expect(mockApi.callsOf("post")[0].path).toBe("/cards/c1/approval-status?action=approve");

    await user.click(screen.getByText("Approved"));
    await user.click(await screen.findByRole("menuitem", { name: /Reject/ }));
    expect(await screen.findByText("Rejected")).toBeInTheDocument();

    await user.click(screen.getByText("Rejected"));
    await user.click(await screen.findByRole("menuitem", { name: /Reset to Draft/ }));
    expect(await screen.findByText("Draft")).toBeInTheDocument();
  });

  it("lists the mandatory items that block approval, and dismisses the list", async () => {
    mockApi.on("post", /^\/cards\/c1\/approval-status/, () => {
      throw new ApiError("blocked", 400, {
        code: "approval_blocked_mandatory_missing",
        missing_relations: [{ key: "relAppToITC", label: "runs on", side: "source", other_type_key: "ITComponent" }],
        missing_tag_groups: [{ id: "g1", name: "Criticality" }],
      });
    });
    const { user } = renderPage();

    await pickApproval(user, /Approve/);
    expect(await screen.findByText("Cannot approve — missing mandatory items")).toBeInTheDocument();
    expect(screen.getByText("Relation: runs on (ITComponent)")).toBeInTheDocument();
    expect(screen.getByText("Tag group: Criticality")).toBeInTheDocument();
    // Still a draft.
    expect(screen.getByText("Draft")).toBeInTheDocument();

    const alert = screen.getByText("Cannot approve — missing mandatory items").closest("[role=alert]") as HTMLElement;
    await user.click(within(alert).getByRole("button", { name: /close/i }));
    expect(screen.queryByText("Cannot approve — missing mandatory items")).not.toBeInTheDocument();
  });

  it("says why a transition failed for any other reason, and clears it once one goes through", async () => {
    let calls = 0;
    mockApi.on("post", /^\/cards\/c1\/approval-status/, () => {
      calls += 1;
      if (calls === 1) throw new ApiError("You may not approve this card", 403, "forbidden");
      return {};
    });
    const { user } = renderPage();

    await pickApproval(user, /Approve/);
    expect(await screen.findByRole("alert")).toHaveTextContent("You may not approve this card");
    expect(screen.queryByText("Cannot approve — missing mandatory items")).not.toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();

    await pickApproval(user, /Approve/);
    expect(await screen.findByText("Approved")).toBeInTheDocument();
    expect(screen.queryByText("You may not approve this card")).not.toBeInTheDocument();
  });

  it("dismisses a failed transition's error", async () => {
    mockApi.fail("post", /^\/cards\/c1\/approval-status/, 500);
    const { user } = renderPage();

    await pickApproval(user, /Reject/);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("POST /cards/c1/approval-status?action=reject failed");
    await user.click(within(alert).getByRole("button", { name: /close/i }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("CardDetail — inline name editing", () => {
  it("saves with Enter and cancels with Escape", async () => {
    mockApi.on("patch", "/cards/c1", (_p: string, body: unknown) => ({ ...CARD, ...(body as object) }));
    const { user } = renderPage();

    await user.click(await screen.findByRole("button", { name: "Edit" }));
    const name = screen.getByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.type(name, "CRM Cloud{Enter}");
    expect(await screen.findByRole("heading", { name: "CRM Cloud" })).toBeInTheDocument();
    expect(mockApi.callsOf("patch", "/cards/c1")[0].body).toEqual({ name: "CRM Cloud", alias: null });

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.type(screen.getByRole("textbox", { name: "Alias" }), "Legacy{Escape}");
    expect(screen.queryByRole("textbox", { name: "Name" })).not.toBeInTheDocument();
    expect(mockApi.callsOf("patch")).toHaveLength(1);
  });

  it("requires a name and closes without saving when nothing changed", async () => {
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    const name = screen.getByRole("textbox", { name: "Name" });

    await user.clear(name);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("This field is required")).toBeInTheDocument();

    await user.type(name, "CRM");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("textbox", { name: "Name" })).not.toBeInTheDocument();
    expect(mockApi.callsOf("patch")).toHaveLength(0);
  });

  it("shows the server's message under the field when the save fails", async () => {
    mockApi.fail("patch", "/cards/c1", 409, "taken");
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), " 2{Enter}");
    expect(await screen.findByText("PATCH /cards/c1 failed")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Name" })).toBeInTheDocument();
  });

  it("stringifies a non-API failure", async () => {
    mockApi.on("patch", "/cards/c1", () => Promise.reject("offline"));
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), " 2{Enter}");
    expect(await screen.findByText("offline")).toBeInTheDocument();
  });
});

describe("CardDetail — inline subtype editing", () => {
  it("changes, keeps and clears the subtype", async () => {
    mockApi.on("patch", "/cards/c1", (_p: string, body: unknown) => ({ ...CARD, ...(body as object) }));
    const { user } = renderPage();

    await user.click(await screen.findByRole("button", { name: "Change subtype" }));
    await user.click(await screen.findByRole("menuitem", { name: "Microservice" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Change subtype" })).toHaveTextContent("Microservice"),
    );
    expect(mockApi.callsOf("patch", "/cards/c1")[0].body).toEqual({ subtype: "microservice" });

    // Picking the current one is a no-op.
    await user.click(screen.getByRole("button", { name: "Change subtype" }));
    await user.click(await screen.findByRole("menuitem", { name: "Microservice" }));
    expect(mockApi.callsOf("patch")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Change subtype" }));
    await user.click(await screen.findByRole("menuitem", { name: "None" }));
    await waitFor(() => expect(mockApi.callsOf("patch")).toHaveLength(2));
    expect(mockApi.callsOf("patch")[1].body).toEqual({ subtype: null });
  });

  it("shows the error beside the card when the subtype save fails", async () => {
    mockApi.fail("patch", "/cards/c1", 500);
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Change subtype" }));
    await user.click(await screen.findByRole("menuitem", { name: "Microservice" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("PATCH /cards/c1 failed");
    // The card is still on screen, with its subtype unchanged.
    expect(screen.getByRole("heading", { name: "CRM" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change subtype" })).toHaveTextContent(
      "Business Application",
    );
  });

  it("shows a plain subtype label to a reader who cannot edit", async () => {
    mockApi.on("get", "/cards/c1/my-permissions", { effective: { ...PERMS, can_edit: false } });
    renderPage();
    // Wait for the card AND the permissions before asserting what is absent —
    // both buttons are also absent while the page is still loading.
    expect(await screen.findByText("Business Application")).toBeInTheDocument();
    await waitFor(() => expect(mockApi.callsOf("get", "/cards/c1/my-permissions")).toHaveLength(1));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Change subtype" })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });
});

describe("CardDetail — AI suggestions", () => {
  beforeEach(() => {
    local.ai = { enabled: true, configured: true, enabled_types: [], running_models: [] };
  });

  it("asks for a suggestion and applies the description and fields", async () => {
    mockApi.on("post", "/ai/suggest", {
      suggestions: {
        description: { value: "A CRM.", confidence: 0.9 },
        shared: { value: true, confidence: 0.7 },
      },
      sources: [],
    });
    mockApi.on("patch", "/cards/c1", (_p: string, body: unknown) => ({ ...CARD, ...(body as object) }));
    const { user } = renderPage();

    await user.click(await screen.findByText("content-ai-suggest"));
    expect(mockApi.callsOf("post", "/ai/suggest")[0].body).toEqual({
      type_key: "Application",
      subtype: "businessApp",
      name: "CRM",
    });
    // While a suggestion is shown the trigger is withdrawn.
    await user.click(await screen.findByRole("button", { name: /Apply suggestions/ }));
    await waitFor(() => expect(screen.getByTestId("content")).toHaveTextContent("A CRM."));
    expect(mockApi.callsOf("patch", "/cards/c1")[0].body).toEqual({
      description: "A CRM.",
      attributes: { shared: true },
    });
    expect(screen.getByText("content-ai-suggest")).toBeInTheDocument();
  });

  it("shows a failed suggestion and dismisses it", async () => {
    mockApi.on("post", "/ai/suggest", () => Promise.reject("model offline"));
    const { user } = renderPage();
    await user.click(await screen.findByText("content-ai-suggest"));
    expect(await screen.findByText("model offline")).toBeInTheDocument();
    await user.click(screen.getByText("Close", { selector: "button" }));
    expect(screen.queryByText("model offline")).not.toBeInTheDocument();
  });

  it("does not offer suggestions on an archived card", async () => {
    routeCard({ status: "ARCHIVED", archived_at: new Date().toISOString() });
    renderPage();
    await screen.findByText(/This card is archived\./);
    expect(screen.queryByText("content-ai-suggest")).not.toBeInTheDocument();
  });
});

describe("CardDetail — logo menu, scroll and mobile", () => {
  it("routes the logo menu's callbacks to the card, the snackbar and the error state", async () => {
    const { user } = renderPage();
    await user.click(await screen.findByLabelText("Change logo"));
    await user.click(await screen.findByText("logo-notify"));
    expect(await screen.findByText("Logo saved")).toBeInTheDocument();
    await user.click(screen.getByText("logo-changed"));
    await user.click(screen.getByText("logo-close"));
    expect(screen.queryByTestId("logo-menu")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Change logo"));
    await user.click(await screen.findByText("logo-error"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Logo failed");
    // Beside the card, not instead of it.
    expect(screen.getByRole("heading", { name: "CRM" })).toBeInTheDocument();
    expect(screen.getByTestId("content")).toBeInTheDocument();
  });

  it("shows a back-to-top button once the page is scrolled", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { user } = renderPage();
    await screen.findByTestId("content");

    Object.defineProperty(window, "scrollY", { value: 500, configurable: true });
    act(() => {
      fireEvent.scroll(window);
    });
    const fab = screen.getByRole("button", { name: "Back to top", hidden: true });
    await user.click(fab);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  });

  it("renders the compact header on a phone", async () => {
    setViewportWidth(400);
    renderPage();
    expect(await screen.findByRole("heading", { name: "CRM", level: 6 })).toBeInTheDocument();
  });
});
