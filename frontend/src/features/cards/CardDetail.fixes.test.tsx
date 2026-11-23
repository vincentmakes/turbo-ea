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

vi.mock("@/features/cards/CardDetailContent", () => ({
  default: (props: {
    card: { name: string; description?: string };
    beforeTabs?: ReactNode;
    onAiSuggest?: () => void;
  }) => (
    <div>
      {props.beforeTabs}
      {props.onAiSuggest && <button onClick={props.onAiSuggest}>ai-suggest</button>}
      <div
        data-testid="content"
        data-name={props.card.name}
        data-description={props.card.description ?? ""}
      />
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
import {
  makeCardType,
  makeField,
  makeRelationType,
  makeSection,
  makeSubtype,
} from "@/test/fixtures/metamodel";
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
  ai.enabled = false;
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
  it("shows the error, and closes it from its close button", async () => {
    mockApi.fail("post", /^\/cards\/c1\/approval-status/, 503);
    const { user } = renderPage();
    await user.click(await screen.findByText("approval-approve"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("POST /cards/c1/approval-status?action=approve failed");

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


describe("CardDetail — AI suggestions do not follow the user to the next card", () => {
  const SKIPPED = /Description applied\. The other suggested values could not be saved/;
  const SUGGESTION = {
    suggestions: {
      description: { value: "A CRM suite.", confidence: 0.9 },
      shared: { value: true, confidence: 0.7 },
    },
    sources: [],
  };
  const APP_AI = makeCardType({
    key: "Application",
    label: "Business App",
    icon: "apps",
    subtypes: [
      makeSubtype({ key: "businessApp", label: "Business Application" }),
      makeSubtype({ key: "microservice", label: "Microservice", hidden_fields: ["shared"] }),
    ],
    fields_schema: [
      makeSection({ fields: [makeField({ key: "shared", label: "Shared", type: "boolean" })] }),
    ],
  });

  beforeEach(() => {
    ai.enabled = true;
    withMetamodel([APP_AI, ITC]);
    mockApi.on("post", "/ai/suggest", SUGGESTION);
  });

  /** A PATCH /cards/c1 that refuses attributes, so the description is saved alone. */
  function refuseValues() {
    mockApi.on("patch", "/cards/c1", (_p: string, body: unknown) => {
      if ("attributes" in (body as object)) throw new ApiError("Shared is computed", 422, null);
      return { ...CARD, ...(body as object) };
    });
  }

  const goToC2 = async (user: ReturnType<typeof renderPage>["user"]) => {
    await user.click(screen.getByRole("link", { name: "go-c2" }));
    await waitFor(() => expect(screen.getByTestId("content")).toHaveAttribute("data-name", "ERP"));
  };

  it("keeps the next card's suggestion busy when the previous card's one settles late", async () => {
    let answerC1: (v: unknown) => void = () => {};
    mockApi.on("post", "/ai/suggest", () => new Promise((resolve) => (answerC1 = resolve)));
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "ai-suggest" }));
    expect(await screen.findByText("Generating description...")).toBeInTheDocument();
    await goToC2(user);
    mockApi.on("post", "/ai/suggest", () => new Promise(() => {}));
    await user.click(screen.getByRole("button", { name: "ai-suggest" }));
    expect(await screen.findByText("Generating description...")).toBeInTheDocument();
    await act(async () => answerC1(SUGGESTION));
    expect(screen.getByText("Generating description...")).toBeInTheDocument();
    expect(screen.queryByText("AI Suggestions")).not.toBeInTheDocument();
    expect(mockApi.callsOf("post", "/ai/suggest")).toHaveLength(2);
  });

  it("drops the skipped-values warning on the next card", async () => {
    refuseValues();
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "ai-suggest" }));
    await user.click(await screen.findByRole("button", { name: /Apply suggestions/ }));
    expect(await screen.findByText(SKIPPED)).toBeInTheDocument();
    await goToC2(user);
    expect(screen.queryByText(SKIPPED)).not.toBeInTheDocument();
  });

  it("drops a suggestion made for the previous card and offers a new one", async () => {
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "ai-suggest" }));
    expect(await screen.findByText("AI Suggestions")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ai-suggest" })).not.toBeInTheDocument();
    await goToC2(user);
    expect(screen.queryByText("AI Suggestions")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ai-suggest" })).toBeInTheDocument();
  });

  it("drops a failed suggestion of the previous card", async () => {
    mockApi.fail("post", "/ai/suggest", 502, "provider down");
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "ai-suggest" }));
    expect(await screen.findByText("AI Suggestion Failed")).toBeInTheDocument();
    await goToC2(user);
    expect(screen.queryByText("AI Suggestion Failed")).not.toBeInTheDocument();
  });

  it("ignores a suggestion that arrives after the switch", async () => {
    let answer: (v: unknown) => void = () => {};
    mockApi.on("post", "/ai/suggest", () => new Promise((resolve) => (answer = resolve)));
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "ai-suggest" }));
    expect(await screen.findByText("Generating description...")).toBeInTheDocument();
    await goToC2(user);
    expect(screen.queryByText("Generating description...")).not.toBeInTheDocument();
    await act(async () => answer(SUGGESTION));
    expect(screen.queryByText("AI Suggestions")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ai-suggest" })).toBeInTheDocument();
  });

  it("ignores a failed suggestion that arrives after the switch", async () => {
    let fail: (e: unknown) => void = () => {};
    mockApi.on("post", "/ai/suggest", () => new Promise((_resolve, reject) => (fail = reject)));
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "ai-suggest" }));
    await goToC2(user);
    await act(async () => fail(new Error("late failure")));
    expect(screen.queryByText("late failure")).not.toBeInTheDocument();
  });

  it("does not paint an apply that lands after the switch onto the next card", async () => {
    let land: () => void = () => {};
    mockApi.on("patch", "/cards/c1", (_p: string, body: unknown) => {
      if ("attributes" in (body as object)) {
        return new Promise((_resolve, reject) => {
          land = () => reject(new ApiError("Shared is computed", 422, null));
        });
      }
      return { ...CARD, ...(body as object) };
    });
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "ai-suggest" }));
    await user.click(await screen.findByRole("button", { name: /Apply suggestions/ }));
    await goToC2(user);
    await act(async () => land());
    await waitFor(() => expect(mockApi.callsOf("patch", "/cards/c1")).toHaveLength(2));
    expect(screen.getByTestId("content")).toHaveAttribute("data-name", "ERP");
    expect(screen.getByTestId("content")).toHaveAttribute("data-description", "");
    expect(screen.queryByText(SKIPPED)).not.toBeInTheDocument();
  });

  it("clears the warning when a new suggestion is asked for", async () => {
    refuseValues();
    let answer: (v: unknown) => void = () => {};
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "ai-suggest" }));
    await user.click(await screen.findByRole("button", { name: /Apply suggestions/ }));
    expect(await screen.findByText(SKIPPED)).toBeInTheDocument();
    mockApi.on("post", "/ai/suggest", () => new Promise((resolve) => (answer = resolve)));
    await user.click(screen.getByRole("button", { name: "ai-suggest" }));
    expect(screen.queryByText(SKIPPED)).not.toBeInTheDocument();
    await act(async () => answer(SUGGESTION));
  });

  it("shows and applies a suggestion when the URL spells the card id in upper case", async () => {
    // The backend accepts any UUID spelling in the path but always answers
    // with the canonical lower-case id, so the route param and card.id differ.
    const LOWER = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
    const UPPER = LOWER.toUpperCase();
    const card = { ...CARD, id: LOWER } as unknown as Card;
    mockApi.on("get", `/cards/${UPPER}`, card);
    mockApi.on("get", `/cards/${UPPER}/my-permissions`, { effective: PERMS });
    mockApi.on("get", `/cards/${UPPER}/me/observe`, {
      is_observer: false,
      observer_role_available: false,
    });
    mockApi.on("patch", `/cards/${LOWER}`, (_p: string, body: unknown) => ({
      ...card,
      ...(body as object),
    }));
    const { user } = renderWithProviders(<CardDetail />, {
      route: `/cards/${UPPER}`,
      routes: [{ path: "/cards/:id" }],
    });
    await user.click(await screen.findByRole("button", { name: "ai-suggest" }));
    expect(await screen.findByText("AI Suggestions")).toBeInTheDocument();
    expect(screen.queryByText("Generating description...")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Apply suggestions/ }));
    await waitFor(() =>
      expect(screen.getByTestId("content")).toHaveAttribute("data-description", "A CRM suite."),
    );
    expect(screen.queryByText("AI Suggestions")).not.toBeInTheDocument();
  });

  it("does not offer a value for a field the card's subtype hides", async () => {
    mockApi.on("get", "/cards/c1", { ...CARD, subtype: "microservice" });
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "ai-suggest" }));
    expect(await screen.findByText("AI Suggestions")).toBeInTheDocument();
    expect(screen.queryByText("Shared")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Apply description/ })).toBeInTheDocument();
  });
});
