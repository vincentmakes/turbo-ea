import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { api } from "@/api/client";
import { MemoryRouter } from "react-router";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — keep AttributeSection REAL (so hiddenFieldKeys is actually honored),
// stub every other section/tab and the heavy hooks.
// ---------------------------------------------------------------------------

vi.mock("@/api/client", () => ({
  api: { get: vi.fn().mockResolvedValue([]), patch: vi.fn(), post: vi.fn(), delete: vi.fn() },
  ApiError: class extends Error {},
  isAbortError: () => false,
}));

vi.mock("@/hooks/useMetamodel", () => ({ useMetamodel: vi.fn() }));
vi.mock("@/hooks/useCalculatedFields", () => ({
  useCalculatedFields: () => ({ calculatedFields: {}, isCalculated: () => false, loading: false }),
}));
vi.mock("@/hooks/useCurrency", () => ({
  useCurrency: () => ({ fmt: { format: (v: number) => "$" + v }, fmtShort: (v: number) => `$${v}`, symbol: "$" }),
}));
const pml = vi.hoisted(() => ({ enabled: false, canView: true }));
vi.mock("@/hooks/usePpmEnabled", () => ({ usePpmEnabled: () => ({ ppmEnabled: pml.enabled }) }));
vi.mock("@/hooks/useGrcEnabled", () => ({ useGrcEnabled: () => ({ grcEnabled: false }) }));
vi.mock("@/hooks/useCardTabActivity", () => ({
  useCardTabActivity: () => ({ hasUpdates: () => false, noteVisit: () => {} }),
}));
vi.mock("@/hooks/AuthContext", () => ({
  useOptionalAuthUser: () => null,
  useAuthContext: () => ({ user: { id: "u1", permissions: { "*": true } } }),
}));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ can: (permission: string) => permission !== "ppm.view" || pml.canView }) }));

vi.mock("@/features/ppm/PpmInitiativeFinancials", () => ({ default: ({ data }: { data?: { actual_invoiced?: string } }) => <span data-testid="initiative-financials">{data?.actual_invoiced}</span> }));
vi.mock("@/features/ppm/PpmInitiativeTimeline", () => ({ default: ({ schedule }: { schedule?: { start_date?: string; actual_start_date?: string } }) => <span data-testid="initiative-timeline">{schedule?.start_date} {schedule?.actual_start_date}</span> }));
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
    RelationsSection: ({ initialExpanded }: { initialExpanded: boolean }) => (
      <div data-testid="relations" data-expanded={initialExpanded} />
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

import Box from "@mui/material/Box";
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

function renderContent(boScoped = false) {
  return render(
    <MemoryRouter>
      <CardDetailContent card={card} perms={perms} onCardUpdate={() => {}} showLdvSection={false} boScoped={boScoped} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetExtensionHost();
  pml.enabled = false;
  pml.canView = true;
  vi.mocked(api.get).mockReset().mockResolvedValue([]);
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
  it("shows the BO relationships above the other sections in the diagram panel", async () => {
    renderContent(true);
    const relations = screen.getByTestId("relations");
    const attributes = await screen.findByText("Indicators");
    expect(relations).toHaveAttribute("data-expanded", "true");
    expect(relations.compareDocumentPosition(attributes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps inventory extension providers and header slots out of a scoped card", async () => {
    registerExtension("daaf", {
      key: "daaf",
      sdkVersion: UI_SDK_VERSION,
      fieldVisibility: hideProvider(["fieldB"]),
      slots: [{ slot: "card.detail.header", id: "scoped", component: () => <span>Inventory slot</span> }],
    });

    renderContent(true);

    expect(await screen.findByText("Indicator A")).toBeInTheDocument();
    expect(screen.getByText("Indicator B")).toBeInTheDocument();
    expect(screen.queryByText("Inventory slot")).not.toBeInTheDocument();
  });

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

describe("CardDetailContent extension header slot", () => {
  const Chip = ({ label }: { label: string }) => <span>{label}</span>;

  it("lays several contributions out in one row", async () => {
    registerExtension("one", {
      key: "one",
      sdkVersion: UI_SDK_VERSION,
      slots: [
        { slot: "card.detail.header", id: "a", component: () => <Chip label="chip-a" /> },
      ],
    });
    registerExtension("two", {
      key: "two",
      sdkVersion: UI_SDK_VERSION,
      slots: [
        { slot: "card.detail.header", id: "b", component: () => <Chip label="chip-b" /> },
      ],
    });
    renderContent();
    const chipA = await screen.findByText("chip-a");
    const chipB = screen.getByText("chip-b");
    const row = screen.getByTestId("card-header-slot");
    // Both live in the SAME container, and that container is a flex row — the
    // thing that stops two extensions' chips stacking on separate lines.
    expect(row).toContainElement(chipA);
    expect(row).toContainElement(chipB);
    expect(row).toHaveStyle({ display: "flex" });
  });

  it("neutralises a contribution's own margin so old bundles still line up", async () => {
    // `align-items: center` centres a flex item's MARGIN box, so a contribution
    // that spaces itself — as every extension built before this row does —
    // renders higher than a margin-less sibling. Measured in Chromium with the
    // shapes actually installed (12px band / no margin / 8px band): three
    // baselines 6px apart before this rule, one baseline after.
    //
    // jsdom has no layout engine and only a partial cascade — it does not apply
    // a child-combinator rule to `getComputedStyle` — so what is checkable HERE
    // is that the rule is emitted against the row's own class, doubled for
    // specificity so it outranks the child's own emotion class. The layout
    // consequence is proven in the browser, not here.
    registerExtension("one", {
      key: "one",
      sdkVersion: UI_SDK_VERSION,
      slots: [
        {
          slot: "card.detail.header",
          id: "banded",
          component: () => (
            <Box data-testid="banded" sx={{ mb: 1.5 }}>
              chip-a
            </Box>
          ),
        },
      ],
    });
    renderContent();
    await screen.findByTestId("banded");
    const row = screen.getByTestId("card-header-slot");
    const rowClass = [...row.classList].find((c) => c.startsWith("css-"));
    const css = [...document.querySelectorAll("style")].map((s) => s.textContent).join("");
    // `.css-x.css-x>*{margin:0px}` — (0,2,0) beats the child's own (0,1,0),
    // which a single `& > *` would only tie with and lose on source order.
    expect(css).toContain(`.${rowClass}.${rowClass}>*{margin:0px;}`);
  });

  it("leaves the row empty when a contribution renders nothing", async () => {
    registerExtension("one", {
      key: "one",
      sdkVersion: UI_SDK_VERSION,
      slots: [{ slot: "card.detail.header", id: "a", component: () => null }],
    });
    renderContent();
    // `&:empty` then hides the band, so an undecorated card keeps no stray margin.
    await waitFor(() => expect(screen.getByTestId("card-header-slot")).toBeEmptyDOMElement());
  });
});

describe("CardDetailContent Initiative summaries", () => {
  function initiative(summaryConfig = {}, canViewCosts = true) {
    const type = {
      ...APP_TYPE, key: "Initiative",
      fields_schema: [{
        section: "Cost & Timeline", fields: [
          { key: "costBudget", label: "Budget", type: "cost" },
          { key: "costActual", label: "Actual Cost", type: "cost" },
          { key: "startDate", label: "Start Date", type: "date" },
          { key: "actualStart", label: "Actual Start", type: "date" },
          { key: "endDate", label: "End Date", type: "date" },
          { key: "actualEnd", label: "Actual End", type: "date" },
        ],
      }],
      section_config: summaryConfig,
    };
    vi.mocked(useMetamodel).mockReturnValue({
      ...vi.mocked(useMetamodel)(), getType: () => type,
    } as unknown as ReturnType<typeof useMetamodel>);
    vi.mocked(api.get).mockImplementation(async (path) => path.endsWith("/financials")
      ? { initiative_id: card.id, actual_invoiced: "30.11" }
      : path.endsWith("/schedule")
        ? { initiative_id: card.id, start_date: "2026-04-01", actual_start_date: "2026-05-15" }
        : []);
    const record = { ...card, type: "Initiative", attributes: {
      costBudget: 100, costActual: 70, startDate: "2026-04-01", actualStart: "2026-05-15",
      endDate: "2026-09-30", actualEnd: "2026-10-15",
    } };
    vi.mocked(api.patch).mockResolvedValue(record);
    return render(<MemoryRouter><CardDetailContent card={record} perms={{ ...perms, can_view_costs: canViewCosts }}
      onCardUpdate={() => {}} showLdvSection={false} showPpmTab={false} /></MemoryRouter>);
  }

  it("places protected Financials and Timeline inside the configured groups", async () => {
    pml.enabled = true;
    initiative();
    const summary = screen.getByRole("button", { name: /cost & timeline/i }).closest(".MuiAccordion-root");
    expect(summary).toContainElement(await screen.findByTestId("initiative-financials"));
    expect(summary).toContainElement(await screen.findByTestId("initiative-timeline"));
    const group = screen.getByText("Cost", { exact: true }).parentElement;
    expect(group).toContainElement(screen.getByTestId("initiative-financials"));
    expect(screen.getByText("Timeline", { exact: true }).parentElement).toContainElement(
      screen.getByTestId("initiative-timeline"),
    );
  });

  it("keeps ordinary Metamodel fields when PML is disabled", () => {
    initiative();
    expect(screen.getByText("Actual Cost")).toBeInTheDocument();
    expect(screen.getByText("Actual Start")).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith(expect.stringMatching(/\/(financials|schedule)$/), expect.anything());
    expect(screen.queryByTestId("initiative-financials")).not.toBeInTheDocument();
    expect(screen.queryByTestId("initiative-timeline")).not.toBeInTheDocument();
  });

  it("does not mount private requests on hidden sections or without PML access", () => {
    pml.enabled = true;
    const view = initiative({ "custom:0": { hidden: true } });
    expect(api.get).not.toHaveBeenCalledWith(expect.stringMatching(/\/(financials|schedule)$/), expect.anything());
    view.unmount();
    pml.canView = false;
    initiative();
    expect(api.get).not.toHaveBeenCalledWith(expect.stringMatching(/\/(financials|schedule)$/), expect.anything());
  });

  it("refreshes the same Initiative schedule after saving the date without requesting financials for restricted readers", async () => {
    pml.enabled = true;
    initiative({}, false);
    const schedule = await screen.findByTestId("initiative-timeline");
    expect(schedule).toHaveTextContent("2026-05-15");
    expect(api.get).not.toHaveBeenCalledWith(expect.stringMatching(/\/financials$/), expect.anything());
    vi.mocked(api.get).mockImplementation(async (path) => path.endsWith("/schedule")
      ? { initiative_id: card.id, start_date: "2026-04-01", actual_start_date: "2026-06-02" }
      : []);
    const accordion = schedule.closest<HTMLElement>(".MuiAccordion-root");
    if (accordion) accordion.scrollIntoView = vi.fn();
    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    fireEvent.change(screen.getByLabelText("Actual Start"), { target: { value: "2026-06-02" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByTestId("initiative-timeline")).toHaveTextContent("2026-06-02"));
    expect(screen.getByTestId("initiative-timeline")).toHaveTextContent("2026-04-01");
    expect(api.patch).toHaveBeenCalledWith("/cards/" + card.id, expect.objectContaining({ attributes: expect.objectContaining({ actualStart: "2026-06-02" }) }));
  });
});
