/**
 * The card page's own writes of the card (subtype, approval, logo, …) go
 * through the content's live-update handle (`liveUpdatesRef`), so a live
 * re-read in flight can never land after them with the card as it was — and
 * a re-read that landed while one was out is not overwritten by a stale copy.
 * `CardDetailContent` is stubbed: it fills the handle with a fake whose
 * `ownWrite` lets a "live re-read" store a card between the write and the
 * page storing the write's result.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

// AI suggestions are off unless a suite switches them on.
const ai = vi.hoisted(() => ({ enabled: false }));
vi.mock("@/hooks/useAiStatus", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useAiStatus")>("@/hooks/useAiStatus");
  return {
    ...actual,
    useAiStatus: () => ({
      aiStatus: {
        enabled: ai.enabled,
        configured: ai.enabled,
        enabled_types: [],
        running_models: [],
      },
      aiStatusLoaded: true,
    }),
  };
});
vi.mock("@/hooks/useArchiveRetentionDays", () => ({
  useArchiveRetentionDays: () => ({ archiveRetentionDays: 30, loaded: true }),
}));

vi.mock("@/features/cards/sections", () => ({
  CardIdPill: ({ reference }: { reference: string }) => <span data-testid="card-id">{reference}</span>,
  DataQualityPill: ({ value }: { value: number }) => <span data-testid="dq">{value}%</span>,
}));

const live = vi.hoisted(() => ({
  ownWrite: [] as string[],
  supersede: 0,
  /** Stored by the fake `ownWrite` after the write, before the page stores. */
  landsDuring: null as Record<string, unknown> | null,
}));

vi.mock("@/features/cards/CardDetailContent", () => ({
  default: (props: {
    card: { name: string; approval_status?: string };
    beforeTabs?: ReactNode;
    onCardUpdate: (c: unknown) => void;
    liveUpdatesRef?: { current: unknown };
  }) => {
    if (props.liveUpdatesRef) {
      props.liveUpdatesRef.current = {
        supersede: () => {
          live.supersede += 1;
        },
        trackOwnWrite: (run: () => Promise<unknown>) => run(),
        editingCb: () => () => {},
        ownWrite: async (write: () => Promise<unknown>) => {
          live.ownWrite.push("write");
          const result = await write();
          if (live.landsDuring) props.onCardUpdate({ ...props.card, ...live.landsDuring });
          return result;
        },
      };
    }
    return (
      <div>
        {props.beforeTabs}
        <div data-testid="content" data-name={props.card.name} />
      </div>
    );
  },
}));

vi.mock("@/features/cards/ArchiveDeleteDialog", () => ({ default: () => null }));
vi.mock("@/features/cards/RestoreDialog", () => ({ default: () => null }));
vi.mock("@/components/CardLogoMenu", () => ({
  default: ({
    cardId,
    onChanged,
    onError,
  }: {
    cardId: string;
    onChanged: (id: string, at: string | null) => void;
    onError?: (message: string) => void;
  }) => (
    <div>
      <button onClick={() => onError?.("Logo upload failed")}>logo-fail</button>
      <button onClick={() => onChanged(cardId, "2026-10-01T00:00:00Z")}>logo-ok</button>
    </div>
  ),
}));

vi.mock("@/components/ApprovalStatusBadge", () => ({
  default: ({
    status,
    onAction,
  }: {
    status: string;
    onAction?: (a: "approve" | "reject" | "reset") => unknown;
  }) => (
    <div>
      <span data-testid="approval">{status}</span>
      <button onClick={() => onAction?.("approve")}>approval-approve</button>
    </div>
  ),
}));

import CardDetail from "./CardDetail";
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

const PERMS = {
  can_view: true,
  can_edit: true,
  can_archive: true,
  can_delete: true,
  can_approval_status: true,
  can_manage_relations: true,
};

const CARD = {
  id: "c1",
  name: "CRM",
  type: "Application",
  subtype: "businessApp",
  status: "ACTIVE",
  approval_status: "DRAFT",
  data_quality: 60,
  lifecycle: {},
  attributes: {},
  reference: "APP-0007",
} as unknown as Card;

function renderPage() {
  return renderWithProviders(<CardDetail />, {
    route: "/cards/c1",
    routes: [{ path: "/cards/:id" }],
  });
}

beforeEach(() => {
  hookState.reset();
  mockApi.reset();
  ai.enabled = false;
  live.ownWrite = [];
  live.supersede = 0;
  live.landsDuring = null;
  withMetamodel([APP]);
  mockApi.on("get", "/cards/c1", CARD);
  mockApi.on("get", "/cards/c1/my-permissions", { effective: PERMS });
  mockApi.on("get", "/cards/c1/me/observe", { is_observer: false, observer_role_available: false });
  mockApi.on("get", "/favorites", []);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CardDetail — the page's own writes and live updates", () => {
  it("saves the subtype through the live-update handle", async () => {
    mockApi.on("patch", "/cards/c1", { ...CARD, subtype: "microservice" });
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Change subtype" }));
    await user.click(await screen.findByRole("menuitem", { name: "Microservice" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Change subtype" })).toHaveTextContent(
        "Microservice",
      ),
    );
    expect(live.ownWrite).toEqual(["write"]);
  });

  it("keeps a card a live re-read stored while the approval was out", async () => {
    mockApi.on("post", /^\/cards\/c1\/approval-status/, {});
    live.landsDuring = { name: "Renamed elsewhere" };
    const { user } = renderPage();
    await user.click(await screen.findByText("approval-approve"));
    expect(await screen.findByText("APPROVED")).toBeInTheDocument();
    expect(live.ownWrite).toEqual(["write"]);
    // The status is applied to the card as it is now, not to the copy the
    // click started from.
    expect(screen.getByTestId("content")).toHaveAttribute("data-name", "Renamed elsewhere");
  });

  it("supersedes a live re-read in flight when the logo changed", async () => {
    const { user } = renderPage();
    await screen.findByTestId("content");
    const before = live.supersede;
    await user.click(screen.getByText("logo-ok"));
    expect(live.supersede).toBe(before + 1);
  });
});
