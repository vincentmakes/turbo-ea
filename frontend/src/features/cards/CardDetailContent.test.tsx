import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — keep AttributeSection REAL (so hiddenFieldKeys is actually honored),
// stub every other section/tab and the heavy hooks.
// ---------------------------------------------------------------------------

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
  useAuthContext: () => ({ user: { id: "u1", permissions: { "*": true } } }),
}));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ can: () => true }) }));

vi.mock("@/components/EolLinkSection", () => ({ default: () => null }));
vi.mock("@/features/bpm/ProcessFlowTab", () => ({ default: () => null }));
vi.mock("@/features/bpm/ProcessAssessmentPanel", () => ({ default: () => null }));
vi.mock("@/features/cards/sections/SoAWTab", () => ({ default: () => null }));

// Real AttributeSection; everything else in the barrel stubbed to null so we
// don't drag in React Flow / heavy tab deps.
vi.mock("@/features/cards/sections", async () => {
  const mod = (await vi.importActual(
    "@/features/cards/sections/AttributeSection",
  )) as { default: unknown };
  const stub = () => null;
  return {
    AttributeSection: mod.default,
    DescriptionSection: stub,
    LifecycleSection: stub,
    HierarchySection: stub,
    SuccessorsSection: stub,
    RelationsSection: stub,
    LayeredDependencySection: stub,
    CommentsTab: stub,
    TodosTab: stub,
    StakeholdersTab: stub,
    ResourcesTab: stub,
    HistoryTab: stub,
    RisksTab: stub,
    ComplianceTab: stub,
    TagsSection: stub,
    DataQualityPill: stub,
  };
});

import { useMetamodel } from "@/hooks/useMetamodel";
import { registerExtension, resetExtensionHost, UI_SDK_VERSION } from "@/lib/extensionHost";
import type { Card } from "@/types";
import CardDetailContent from "./CardDetailContent";

const APP_TYPE = {
  key: "Application",
  label: "Application",
  icon: "apps",
  color: "#0f7eb5",
  has_hierarchy: false,
  subtypes: [],
  fields_schema: [
    {
      section: "Indicators",
      fields: [
        { key: "fieldA", label: "Indicator A", type: "text" },
        { key: "fieldB", label: "Indicator B", type: "text" },
      ],
    },
  ],
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
  lifecycle: {},
  attributes: { fieldA: "a", fieldB: "b" },
  tags: [],
  stakeholders: [],
} as unknown as Card;

const perms = {
  can_view: true,
  can_edit: true,
  can_view_costs: true,
} as unknown as Parameters<typeof CardDetailContent>[0]["perms"];

/** A headless provider that reports `keys` hidden for extension `daaf` on mount. */
function hideProvider(keys: string[]) {
  return function Provider({ report }: { report: (k: string, ks: string[]) => void }) {
    React.useEffect(() => {
      report("daaf", keys);
    }, [report]);
    return null;
  };
}

function renderContent() {
  return render(
    <MemoryRouter>
      <CardDetailContent card={card} perms={perms} onCardUpdate={() => {}} showLdvSection={false} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetExtensionHost();
  vi.mocked(useMetamodel).mockReturnValue({
    types: [APP_TYPE],
    relationTypes: [],
    loading: false,
    getType: (k: string) => (k === "Application" ? APP_TYPE : undefined),
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
  } as unknown as ReturnType<typeof useMetamodel>);
});

describe("CardDetailContent extension field visibility", () => {
  it("shows all fields when no provider hides anything", async () => {
    renderContent();
    expect(await screen.findByText("Indicator A")).toBeInTheDocument();
    expect(screen.getByText("Indicator B")).toBeInTheDocument();
    expect(screen.getByText("Indicators")).toBeInTheDocument();
  });

  it("hides a field a provider reports, keeps the rest", async () => {
    registerExtension("daaf", {
      key: "daaf",
      sdkVersion: UI_SDK_VERSION,
      fieldVisibility: hideProvider(["fieldB"]),
    });
    renderContent();
    // The section + the non-hidden field stay; the reported field disappears.
    expect(await screen.findByText("Indicator A")).toBeInTheDocument();
    expect(screen.getByText("Indicators")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Indicator B")).not.toBeInTheDocument());
  });

  it("collapses the whole section when a provider hides all its fields", async () => {
    registerExtension("daaf", {
      key: "daaf",
      sdkVersion: UI_SDK_VERSION,
      fieldVisibility: hideProvider(["fieldA", "fieldB"]),
    });
    renderContent();
    // Section header and both fields are gone once every field is hidden.
    await waitFor(() => expect(screen.queryByText("Indicators")).not.toBeInTheDocument());
    expect(screen.queryByText("Indicator A")).not.toBeInTheDocument();
    expect(screen.queryByText("Indicator B")).not.toBeInTheDocument();
  });
});
