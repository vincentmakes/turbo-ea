/**
 * Relation dates edited in one place show in the other: the Relations section
 * and the Lifecycle section's relation lifecycles panel reload each other, and
 * both refetch the card (its data quality score counts only relations in
 * effect today).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn().mockResolvedValue([]), patch: vi.fn(), post: vi.fn(), delete: vi.fn() },
  ApiError: class extends Error {},
}));

vi.mock("@/hooks/useMetamodel", () => ({ useMetamodel: vi.fn() }));
vi.mock("@/hooks/useCalculatedFields", () => ({
  useCalculatedFields: () => ({ calculatedFields: {}, isCalculated: () => false, loading: false }),
}));
vi.mock("@/hooks/useCurrency", () => ({
  useCurrency: () => ({ fmt: (v: number) => `$${v}`, fmtShort: (v: number) => `$${v}`, symbol: "$" }),
}));
vi.mock("@/hooks/usePpmEnabled", () => ({ usePpmEnabled: () => ({ ppmEnabled: false }) }));
vi.mock("@/hooks/useGrcEnabled", () => ({ useGrcEnabled: () => ({ grcEnabled: false }) }));
vi.mock("@/hooks/useCardTabActivity", () => ({
  useCardTabActivity: () => ({ hasUpdates: () => false, noteVisit: () => {} }),
}));
vi.mock("@/hooks/AuthContext", () => ({
  useOptionalAuthUser: () => null,
  useAuthContext: () => ({ user: { id: "u1", permissions: { "*": true } } }),
}));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ can: () => true }) }));

vi.mock("@/components/EolLinkSection", () => ({ default: () => null }));
vi.mock("@/features/bpm/ProcessFlowTab", () => ({ default: () => null }));
vi.mock("@/features/bpm/ProcessAssessmentPanel", () => ({ default: () => null }));
vi.mock("@/features/cards/sections/SoAWTab", () => ({ default: () => null }));

// Every section stubbed; the two that share relation dates expose their
// refresh wiring.
vi.mock("@/features/cards/sections", async () => {
  const stub = () => null;
  return {
    // A custom section that changes a relation (a relation-typed field).
    AttributeSection: ({ onRelationChange }: { onRelationChange?: () => void }) => (
      <button onClick={onRelationChange}>attribute relation changed</button>
    ),
    DescriptionSection: stub,
    // The footer is what the Lifecycle section is handed; render it as given.
    LifecycleSection: ({
      footer,
      maintained,
    }: {
      footer?: React.ReactNode;
      maintained?: unknown;
    }) => (
      <div
        data-testid="lifecycle-section"
        data-maintained={maintained === undefined ? "undefined" : JSON.stringify(maintained)}
      >
        {footer}
      </div>
    ),
    HierarchySection: stub,
    SuccessorsSection: stub,
    RelationsSection: ({
      refreshKey,
      onCardUpdate,
    }: {
      refreshKey?: number;
      onCardUpdate?: () => void;
    }) => (
      <div data-testid="relations-section" data-refresh={refreshKey}>
        <button onClick={onCardUpdate}>relations changed</button>
      </div>
    ),
    LayeredDependencySection: stub,
    CommentsTab: stub,
    TodosTab: stub,
    StakeholdersTab: stub,
    ResourcesTab: stub,
    AdrsTab: stub,
    HistoryTab: stub,
    RisksTab: stub,
    ComplianceTab: stub,
    TagsSection: stub,
    DataQualityPill: stub,
  };
});

vi.mock("@/features/cards/sections/RelationLifecyclesPanel", () => ({
  default: (props: {
    cardId: string;
    cardTypeKey: string;
    cardLifecycle?: Record<string, string>;
    canManageRelations: boolean;
    refreshKey?: number;
    onChanged?: () => void;
  }) => (
    <div
      data-testid="relation-lifecycles-panel"
      data-refresh={props.refreshKey}
      data-props={JSON.stringify({
        cardId: props.cardId,
        cardTypeKey: props.cardTypeKey,
        cardLifecycle: props.cardLifecycle,
        canManageRelations: props.canManageRelations,
      })}
    >
      <button onClick={props.onChanged}>panel changed</button>
    </div>
  ),
}));

import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import type { Card } from "@/types";
import CardDetailContent from "./CardDetailContent";

const APP_TYPE = {
  key: "Application",
  label: "Application",
  icon: "apps",
  color: "#0f7eb5",
  has_hierarchy: false,
  subtypes: [],
  fields_schema: [{ section: "Ownership", fields: [{ key: "owner", label: "Owner", type: "text" }] }],
  section_config: {},
};

const card = {
  id: "card-1",
  name: "My App",
  type: "Application",
  description: "",
  status: "ACTIVE",
  approval_status: "DRAFT",
  data_quality: 50,
  lifecycle: { active: "2024-01-01" },
  attributes: {},
  tags: [],
  stakeholders: [],
} as unknown as Card;

const perms = {
  can_view: true,
  can_edit: true,
  can_manage_relations: true,
} as unknown as Parameters<typeof CardDetailContent>[0]["perms"];

const refreshed = { ...card, data_quality: 80 } as unknown as Card;

function renderContent(onSaveOrigin?: (anchor: string) => void, shown: Card = card) {
  const onCardUpdate = vi.fn();
  render(
    <MemoryRouter>
      <CardDetailContent
        card={shown}
        perms={perms}
        onCardUpdate={onCardUpdate}
        onSaveOrigin={onSaveOrigin}
        showLdvSection={false}
      />
    </MemoryRouter>,
  );
  return onCardUpdate;
}

const refreshOf = (testId: string) => screen.getByTestId(testId).getAttribute("data-refresh");
const cardFetches = () =>
  vi.mocked(api.get).mock.calls.filter(([path]) => path === "/cards/card-1").length;

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.get).mockImplementation(async (path: string) =>
    path === "/cards/card-1" ? refreshed : [],
  );
  vi.mocked(useMetamodel).mockReturnValue({
    types: [APP_TYPE],
    relationTypes: [],
    loading: false,
    getType: (k: string) => (k === "Application" ? APP_TYPE : undefined),
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
  } as unknown as ReturnType<typeof useMetamodel>);
});

describe("CardDetailContent — relation lifecycles", () => {
  it("puts the panel in the Lifecycle section, for this card", async () => {
    renderContent();
    const panel = await screen.findByTestId("relation-lifecycles-panel");
    expect(screen.getByTestId("lifecycle-section")).toContainElement(panel);
    expect(JSON.parse(panel.getAttribute("data-props")!)).toEqual({
      cardId: "card-1",
      cardTypeKey: "Application",
      cardLifecycle: { active: "2024-01-01" },
      canManageRelations: true,
    });
    expect(refreshOf("relation-lifecycles-panel")).toBe("0");
  });

  it("reloads the panel and refetches the card when the Relations section changes", async () => {
    const onCardUpdate = renderContent();
    await screen.findByTestId("relations-section");
    fireEvent.click(screen.getByRole("button", { name: "relations changed" }));
    await waitFor(() => expect(onCardUpdate).toHaveBeenCalledWith(refreshed));
    expect(refreshOf("relation-lifecycles-panel")).toBe("1");
    // The Relations section reloads itself; it is not asked to again.
    expect(refreshOf("relations-section")).toBe("0");
    expect(cardFetches()).toBe(1);
  });

  it("reloads the Relations section and refetches the card when the panel saves", async () => {
    const onCardUpdate = renderContent();
    await screen.findByTestId("relation-lifecycles-panel");
    fireEvent.click(screen.getByRole("button", { name: "panel changed" }));
    await waitFor(() => expect(onCardUpdate).toHaveBeenCalledWith(refreshed));
    expect(refreshOf("relations-section")).toBe("1");
    expect(refreshOf("relation-lifecycles-panel")).toBe("0");
    expect(cardFetches()).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "panel changed" }));
    await waitFor(() => expect(refreshOf("relations-section")).toBe("2"));
  });

  it("names the Lifecycle section as where a panel save came from", async () => {
    const onSaveOrigin = vi.fn();
    const onCardUpdate = renderContent(onSaveOrigin);
    await screen.findByTestId("relation-lifecycles-panel");
    fireEvent.click(screen.getByRole("button", { name: "panel changed" }));
    await waitFor(() => expect(onCardUpdate).toHaveBeenCalledWith(refreshed));
    expect(onSaveOrigin).toHaveBeenCalledWith("card-section-lifecycle");
    expect(onSaveOrigin).toHaveBeenCalledTimes(1);
  });

  it("reloads both the Relations section and the panel when a section's relation field changes", async () => {
    renderContent();
    await screen.findByTestId("relation-lifecycles-panel");
    fireEvent.click(screen.getByRole("button", { name: "attribute relation changed" }));
    await waitFor(() => expect(refreshOf("relations-section")).toBe("1"));
    expect(refreshOf("relation-lifecycles-panel")).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "attribute relation changed" }));
    await waitFor(() => expect(refreshOf("relations-section")).toBe("2"));
    expect(refreshOf("relation-lifecycles-panel")).toBe("2");
  });
});

describe("CardDetailContent — lifecycle phases an extension maintains", () => {
  it("hands the card's lifecycle_maintained to the Lifecycle section", async () => {
    const maintained = { ext: "acme-sync", name: "Acme Sync", phases: ["endOfLife"] };
    renderContent(undefined, { ...card, lifecycle_maintained: maintained } as Card);
    const section = await screen.findByTestId("lifecycle-section");
    expect(JSON.parse(section.getAttribute("data-maintained")!)).toEqual(maintained);
  });

  it("passes null when the card carries none", async () => {
    renderContent();
    const section = await screen.findByTestId("lifecycle-section");
    expect(section.getAttribute("data-maintained")).toBe("null");
  });
});
