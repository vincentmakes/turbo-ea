/**
 * CardDetail regressions: the mandatory-items list names the other card type
 * by its label and the relation by its translated verb, the list does not
 * follow the user to the next card, and a failed subtype save or logo action
 * is shown beside the card instead of replacing the page.
 *
 * `CardDetailContent`, the dialogs, the logo menu and the approval badge are
 * stubbed down to the props CardDetail hands them — each has its own tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { Link } from "react-router";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

vi.mock("@/hooks/useAiStatus", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useAiStatus")>("@/hooks/useAiStatus");
  return {
    ...actual,
    useAiStatus: () => ({
      aiStatus: { enabled: false, configured: false, enabled_types: [], running_models: [] },
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

vi.mock("@/features/cards/CardDetailContent", () => ({
  default: (props: { card: { name: string }; beforeTabs?: ReactNode }) => (
    <div>
      {props.beforeTabs}
      <div data-testid="content" data-name={props.card.name} />
    </div>
  ),
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
import { ApiError } from "@/api/client";
import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { makeCardType, makeRelationType, makeSubtype } from "@/test/fixtures/metamodel";
import { renderWithProviders } from "@/test/render";
import i18n from "@/i18n";
import type { Card } from "@/types";

const APP = makeCardType({
  key: "Application",
  label: "Business App",
  icon: "apps",
  subtypes: [
    makeSubtype({ key: "businessApp", label: "Business Application" }),
    makeSubtype({ key: "microservice", label: "Microservice" }),
  ],
});
const ITC = makeCardType({ key: "ITComponent", label: "IT Component", icon: "memory" });

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
  status: "ACTIVE",
  approval_status: "DRAFT",
  data_quality: 60,
  lifecycle: {},
  attributes: {},
  reference: "APP-0007",
} as unknown as Card;
const C2 = { ...CARD, id: "c2", name: "ERP", reference: "APP-0008" } as unknown as Card;

const BLOCKED = "Cannot approve — missing mandatory items";

function blocked() {
  return new ApiError("blocked", 400, {
    code: "approval_blocked_mandatory_missing",
    missing_relations: [
      { key: "relAppToITC", label: "runs on", side: "source", other_type_key: "ITComponent" },
    ],
    missing_tag_groups: [],
  });
}

function renderPage() {
  return renderWithProviders(
    <>
      <CardDetail />
      <Link to="/cards/c2">go-c2</Link>
    </>,
    { route: "/cards/c1", routes: [{ path: "/cards/:id" }] },
  );
}

beforeEach(() => {
  hookState.reset();
  mockApi.reset();
  withMetamodel([APP, ITC]);
  mockApi.on("get", "/cards/c1", CARD);
  mockApi.on("get", "/cards/c1/my-permissions", { effective: PERMS });
  mockApi.on("get", "/cards/c1/me/observe", { is_observer: false, observer_role_available: false });
  mockApi.on("get", "/cards/c2", C2);
  mockApi.on("get", "/cards/c2/my-permissions", { effective: PERMS });
  mockApi.on("get", "/cards/c2/me/observe", { is_observer: false, observer_role_available: false });
  mockApi.on("get", "/favorites", []);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CardDetail — mandatory items blocking approval", () => {
  it("names the other card type by its label, not its key", async () => {
    mockApi.on("post", /^\/cards\/c1\/approval-status/, () => {
      throw blocked();
    });
    const { user } = renderPage();
    await user.click(await screen.findByText("approval-approve"));
    expect(await screen.findByText(BLOCKED)).toBeInTheDocument();
    expect(screen.getByText("Relation: runs on (IT Component)")).toBeInTheDocument();
    expect(screen.queryByText("Relation: runs on (ITComponent)")).not.toBeInTheDocument();
  });

  it("does not carry the list over to the next card", async () => {
    mockApi.on("post", /^\/cards\/c1\/approval-status/, () => {
      throw blocked();
    });
    const { user } = renderPage();
    await user.click(await screen.findByText("approval-approve"));
    expect(await screen.findByText(BLOCKED)).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "go-c2" }));
    await waitFor(() => expect(screen.getByTestId("content")).toHaveAttribute("data-name", "ERP"));
    expect(screen.queryByText(BLOCKED)).not.toBeInTheDocument();
  });
});

describe("CardDetail — a failed subtype save", () => {
  it("keeps the card on screen and shows the error beside it", async () => {
    mockApi.fail("patch", "/cards/c1", 500);
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Change subtype" }));
    await user.click(await screen.findByRole("menuitem", { name: "Microservice" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("PATCH /cards/c1 failed");
    // The page is still the card: header, subtype control and content.
    expect(screen.getByRole("heading", { name: "CRM" })).toBeInTheDocument();
    expect(screen.getByTestId("content")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change subtype" })).toHaveTextContent(
      "Business Application",
    );

    await user.click(within(alert).getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("clears the error once a later subtype save goes through", async () => {
    let calls = 0;
    mockApi.on("patch", "/cards/c1", (_p: string, body: unknown) => {
      calls += 1;
      if (calls === 1) throw new ApiError("Subtype rejected", 422, "nope");
      return { ...CARD, ...(body as object) };
    });
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Change subtype" }));
    await user.click(await screen.findByRole("menuitem", { name: "Microservice" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Subtype rejected");

    await user.click(screen.getByRole("button", { name: "Change subtype" }));
    await user.click(await screen.findByRole("menuitem", { name: "Microservice" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Change subtype" })).toHaveTextContent("Microservice"),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("names a failure that carries no message generically", async () => {
    mockApi.on("patch", "/cards/c1", () => Promise.reject("offline"));
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Change subtype" }));
    await user.click(await screen.findByRole("menuitem", { name: "Microservice" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.getByRole("heading", { name: "CRM" })).toBeInTheDocument();
  });

  it("does not carry the error over to the next card", async () => {
    mockApi.fail("patch", "/cards/c1", 500);
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Change subtype" }));
    await user.click(await screen.findByRole("menuitem", { name: "Microservice" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("PATCH /cards/c1 failed");

    await user.click(screen.getByRole("link", { name: "go-c2" }));
    await waitFor(() => expect(screen.getByTestId("content")).toHaveAttribute("data-name", "ERP"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("CardDetail — the verb of a missing mandatory relation", () => {
  const USES = makeRelationType({
    key: "relAppToITC",
    label: "uses",
    reverse_label: "is used by",
    source_type_key: "Application",
    target_type_key: "ITComponent",
    translations: { label: { de: "verwendet" }, reverse_label: { de: "wird verwendet von" } },
  });
  const SUPPLIES = makeRelationType({
    key: "relProviderToApp",
    label: "supplies",
    reverse_label: "is supplied by",
    source_type_key: "Provider",
    target_type_key: "Application",
    translations: { label: { de: "liefert" }, reverse_label: { de: "wird geliefert von" } },
  });

  it("is said in the user's language, from the end the card sits on", async () => {
    withMetamodel([APP, ITC], [USES, SUPPLIES]);
    mockApi.on("post", /^\/cards\/c1\/approval-status/, () => {
      // The backend names the verb in its own (untranslated) words.
      throw new ApiError("blocked", 400, {
        code: "approval_blocked_mandatory_missing",
        missing_relations: [
          { key: "relAppToITC", label: "uses", side: "source", other_type_key: "ITComponent" },
          { key: "relProviderToApp", label: "is supplied by", side: "target", other_type_key: "Provider" },
          // A type the metamodel no longer knows keeps the backend's word.
          { key: "relGone", label: "legacy verb", side: "source", other_type_key: "ITComponent" },
        ],
        missing_tag_groups: [],
      });
    });
    const previous = i18n.language;
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    try {
      const { user } = renderPage();
      await user.click(await screen.findByText("approval-approve"));
      expect(await screen.findByText("Beziehung: verwendet (IT Component)")).toBeInTheDocument();
      expect(screen.getByText("Beziehung: wird geliefert von (Provider)")).toBeInTheDocument();
      expect(screen.getByText("Beziehung: legacy verb (IT Component)")).toBeInTheDocument();
      expect(screen.queryByText(/Beziehung: uses/)).not.toBeInTheDocument();
    } finally {
      await act(async () => {
        await i18n.changeLanguage(previous);
      });
    }
  });
});

describe("CardDetail — a failed logo action", () => {
  it("keeps the card on screen and shows the error beside it", async () => {
    const { user } = renderPage();
    await user.click(await screen.findByText("logo-fail"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Logo upload failed");
    // The page is still the card: header, logo menu and content.
    expect(screen.getByRole("heading", { name: "CRM" })).toBeInTheDocument();
    expect(screen.getByTestId("content")).toBeInTheDocument();
    expect(screen.getByText("logo-fail")).toBeInTheDocument();

    await user.click(within(alert).getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("clears the error once a later logo change goes through", async () => {
    const { user } = renderPage();
    await user.click(await screen.findByText("logo-fail"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Logo upload failed");

    await user.click(screen.getByText("logo-ok"));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "CRM" })).toBeInTheDocument();
  });

  it("does not carry the error over to the next card", async () => {
    const { user } = renderPage();
    await user.click(await screen.findByText("logo-fail"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Logo upload failed");

    await user.click(screen.getByRole("link", { name: "go-c2" }));
    await waitFor(() => expect(screen.getByTestId("content")).toHaveAttribute("data-name", "ERP"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("CardDetail — a failed approval transition", () => {
  it("shows the error spaced above the content, and closes it from its close button", async () => {
    mockApi.fail("post", /^\/cards\/c1\/approval-status/, 503);
    const { user } = renderPage();
    await user.click(await screen.findByText("approval-approve"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("POST /cards/c1/approval-status?action=approve failed");
    expect(alert).toHaveStyle({ marginBottom: "16px" });

    await user.click(within(alert).getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("clears the error once a later transition goes through", async () => {
    let calls = 0;
    mockApi.on("post", /^\/cards\/c1\/approval-status/, () => {
      calls += 1;
      if (calls === 1) throw new ApiError("Server unavailable", 503, null);
      return {};
    });
    const { user } = renderPage();
    await user.click(await screen.findByText("approval-approve"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Server unavailable");

    await user.click(screen.getByText("approval-approve"));
    await waitFor(() => expect(screen.getByTestId("approval")).toHaveTextContent("APPROVED"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("CardDetail — error spacing", () => {
  it("spaces a failed subtype save's error above the content", async () => {
    mockApi.fail("patch", "/cards/c1", 500);
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Change subtype" }));
    await user.click(await screen.findByRole("menuitem", { name: "Microservice" }));
    expect(await screen.findByRole("alert")).toHaveStyle({ marginBottom: "16px" });
  });

  it("spaces a failed logo action's error above the content", async () => {
    const { user } = renderPage();
    await user.click(await screen.findByText("logo-fail"));
    expect(await screen.findByRole("alert")).toHaveStyle({ marginBottom: "16px" });
  });
});
