import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The tab strip and the section order, driven through the real component with
// every tab body and section stubbed to a marker, so what is asserted is which
// tab opens and in which order the sections render — not what they contain.

const flags = vi.hoisted(() => ({
  ppmEnabled: false,
  grcEnabled: false,
  counts: { risks: [] as unknown[], compliance: [] as unknown[], adrs: [] as unknown[] },
}));

vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn((url: string) => {
      if (url.endsWith("/risks")) return Promise.resolve(flags.counts.risks);
      if (url.endsWith("/compliance-findings")) return Promise.resolve(flags.counts.compliance);
      if (url.startsWith("/adr/by-card/")) return Promise.resolve(flags.counts.adrs);
      return Promise.resolve([]);
    }),
    patch: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class extends Error {},
}));

vi.mock("@/hooks/useMetamodel", () => ({ useMetamodel: vi.fn() }));
vi.mock("@/hooks/useCalculatedFields", () => ({
  useCalculatedFields: () => ({ calculatedFields: {}, isCalculated: () => false, loading: false }),
}));
vi.mock("@/hooks/useCurrency", () => ({
  useCurrency: () => ({ fmt: (v: number) => `$${v}`, fmtShort: (v: number) => `$${v}`, symbol: "$" }),
}));
vi.mock("@/hooks/usePpmEnabled", () => ({ usePpmEnabled: () => ({ ppmEnabled: flags.ppmEnabled }) }));
vi.mock("@/hooks/useGrcEnabled", () => ({ useGrcEnabled: () => ({ grcEnabled: flags.grcEnabled }) }));
const noteVisit = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useCardTabActivity", () => ({
  useCardTabActivity: () => ({ hasUpdates: () => false, noteVisit }),
}));
vi.mock("@/hooks/AuthContext", () => ({
  useOptionalAuthUser: () => null,
  useAuthContext: () => ({ user: { id: "u1", permissions: { "*": true } } }),
}));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ can: () => true }) }));

vi.mock("@/components/EolLinkSection", () => ({ default: () => <div data-testid="sec-eol" /> }));
vi.mock("@/features/bpm/ProcessFlowTab", () => ({
  default: () => <div data-testid="panel-processFlow" />,
}));
vi.mock("@/features/bpm/ProcessAssessmentPanel", () => ({
  default: () => <div data-testid="panel-assessments" />,
}));
vi.mock("@/features/cards/sections/SoAWTab", () => ({
  default: () => <div data-testid="panel-soaw" />,
}));

vi.mock("@/features/cards/sections", () => {
  const marker = (id: string) => () => <div data-testid={id} />;
  return {
    AttributeSection: ({ section }: { section: { section: string } }) => (
      <div data-testid={`sec-custom-${section.section}`} />
    ),
    DescriptionSection: marker("sec-description"),
    LifecycleSection: marker("sec-lifecycle"),
    HierarchySection: marker("sec-hierarchy"),
    SuccessorsSection: marker("sec-successors"),
    RelationsSection: marker("sec-relations"),
    LayeredDependencySection: marker("sec-ldv"),
    TagsSection: marker("sec-tags"),
    CommentsTab: marker("panel-comments"),
    TodosTab: marker("panel-todos"),
    StakeholdersTab: marker("panel-stakeholders"),
    ResourcesTab: marker("panel-resources"),
    AdrsTab: marker("panel-adrs"),
    HistoryTab: marker("panel-history"),
    RisksTab: marker("panel-risks"),
    ComplianceTab: marker("panel-compliance"),
  };
});

import { useMetamodel } from "@/hooks/useMetamodel";
import { registerExtension, resetExtensionHost, UI_SDK_VERSION } from "@/lib/extensionHost";
import type { Card } from "@/types";
import CardDetailContent from "./CardDetailContent";

function typeFor(key: string, over: Record<string, unknown> = {}) {
  return {
    key,
    label: key,
    icon: "apps",
    color: "#0f7eb5",
    has_hierarchy: false,
    has_successors: false,
    subtypes: [],
    fields_schema: [{ section: "Commercials", fields: [{ key: "a", label: "A", type: "text" }] }],
    section_config: {},
    ...over,
  };
}

function cardOf(type: string): Card {
  return {
    id: `card-${type}`,
    name: "Thing",
    type,
    status: "ACTIVE",
    approval_status: "DRAFT",
    data_quality: 0,
    lifecycle: {},
    attributes: {},
    tags: [],
    stakeholders: [],
  } as unknown as Card;
}

const perms = {
  can_view: true,
  can_edit: true,
  can_manage_adr_links: false,
} as unknown as Parameters<typeof CardDetailContent>[0]["perms"];

function useType(type: ReturnType<typeof typeFor>) {
  vi.mocked(useMetamodel).mockReturnValue({
    types: [type],
    relationTypes: [],
    loading: false,
    getType: (k: string) => (k === type.key ? type : undefined),
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
  } as unknown as ReturnType<typeof useMetamodel>);
}

function renderCard(card: Card, initialTab?: number | string, cardPerms = perms) {
  return render(
    <MemoryRouter initialEntries={["/cards/x"]}>
      <Routes>
        <Route
          path="/cards/x"
          element={
            <CardDetailContent
              card={card}
              perms={cardPerms}
              onCardUpdate={() => {}}
              initialTab={initialTab}
            />
          }
        />
        <Route path="/ppm/:id" element={<div data-testid="ppm-page" />} />
      </Routes>
    </MemoryRouter>,
  );
}

const tabNames = () => screen.getAllByRole("tab").map((t) => t.textContent);
const selectedTab = () =>
  screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true")
    ?.textContent;

beforeEach(() => {
  resetExtensionHost();
  noteVisit.mockClear();
  flags.ppmEnabled = false;
  flags.grcEnabled = false;
  flags.counts = { risks: [], compliance: [], adrs: [] };
});

describe("CardDetailContent tab strip", () => {
  it("gives a process its flow and assessment tabs and opens an index link on the flow", async () => {
    useType(typeFor("BusinessProcess"));
    renderCard(cardOf("BusinessProcess"), 1);
    expect(tabNames()).toEqual([
      "Card",
      "Process Flow",
      "Assessments",
      "Comments",
      "Todos",
      "Stakeholders",
      "Resources",
      "History",
    ]);
    expect(selectedTab()).toBe("Process Flow");
    expect(await screen.findByTestId("panel-processFlow")).toBeInTheDocument();
    await waitFor(() => expect(noteVisit).toHaveBeenCalledWith("processFlow"));
  });

  it("opens the tab a link names by key, such as Resources", async () => {
    useType(typeFor("Application"));
    renderCard(cardOf("Application"), "resources");
    expect(selectedTab()).toBe("Resources");
    expect(await screen.findByTestId("panel-resources")).toBeInTheDocument();
  });

  it("opens the Card tab for a key the strip does not carry", () => {
    useType(typeFor("Application"));
    renderCard(cardOf("Application"), "assessments");
    expect(selectedTab()).toBe("Card");
    expect(screen.getByTestId("sec-description")).toBeInTheDocument();
  });

  it("keeps the GRC and ADR tabs that have items once their counts load", async () => {
    flags.grcEnabled = true;
    flags.counts = { risks: [{ id: "r" }], compliance: [], adrs: [] };
    useType(typeFor("Application"));
    renderCard(cardOf("Application"));
    await waitFor(() =>
      expect(tabNames()).toEqual([
        "Card",
        "Comments",
        "Todos",
        "Stakeholders",
        "Resources",
        "Risks",
        "History",
      ]),
    );
  });

  it("keeps the ADR tab on an empty card for someone who can link a decision", async () => {
    useType(typeFor("Application"));
    renderCard(cardOf("Application"), undefined, {
      ...perms,
      can_manage_adr_links: true,
    } as typeof perms);
    await waitFor(() => expect(tabNames()).toContain("ADRs"));
  });

  it("falls back to the Card tab when the open tab's count settles at 0", async () => {
    flags.grcEnabled = true;
    useType(typeFor("Application"));
    renderCard(cardOf("Application"), "risks");
    expect(selectedTab()).toBe("Risks");
    await waitFor(() => expect(selectedTab()).toBe("Card"));
    expect(screen.queryByTestId("panel-risks")).not.toBeInTheDocument();
  });

  it("keeps the selected tab when a tab before it disappears", async () => {
    flags.grcEnabled = true;
    useType(typeFor("Application"));
    renderCard(cardOf("Application"), "history");
    expect(selectedTab()).toBe("History");
    await waitFor(() => expect(tabNames()).not.toContain("Risks"));
    expect(selectedTab()).toBe("History");
    expect(screen.getByTestId("panel-history")).toBeInTheDocument();
  });

  it("gives an initiative SoAW and PPM tabs, and the PPM tab opens the PPM page", async () => {
    flags.ppmEnabled = true;
    useType(typeFor("Initiative"));
    renderCard(cardOf("Initiative"));
    expect(tabNames()).toEqual([
      "Card",
      "SoAW",
      "Comments",
      "Todos",
      "Stakeholders",
      "Resources",
      "History",
      "PPM",
    ]);
    fireEvent.click(screen.getByRole("tab", { name: "SoAW" }));
    expect(await screen.findByTestId("panel-soaw")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "PPM" }));
    expect(await screen.findByTestId("ppm-page")).toBeInTheDocument();
    expect(noteVisit).not.toHaveBeenCalledWith("ppm");
  });

  it("switches panels by tab and notes each visit", async () => {
    useType(typeFor("Application"));
    renderCard(cardOf("Application"));
    for (const [name, panel, key] of [
      ["Comments", "panel-comments", "comments"],
      ["Todos", "panel-todos", "todos"],
      ["Stakeholders", "panel-stakeholders", "stakeholders"],
      ["History", "panel-history", "history"],
    ]) {
      fireEvent.click(screen.getByRole("tab", { name }));
      expect(await screen.findByTestId(panel)).toBeInTheDocument();
      expect(noteVisit).toHaveBeenCalledWith(key);
    }
  });

  it("appends an extension tab after the built-in ones and renders it when chosen", async () => {
    registerExtension("acme", {
      key: "acme",
      sdkVersion: UI_SDK_VERSION,
      cardTabs: [
        { id: "costs", label: "Costs", component: () => <div data-testid="ext-costs" /> },
        {
          id: "procs",
          label: "Procs",
          appliesTo: ["BusinessProcess"],
          component: () => <div data-testid="ext-procs" />,
        },
      ],
    });
    useType(typeFor("Application"));
    renderCard(cardOf("Application"));
    expect(tabNames().slice(-2)).toEqual(["History", "Costs"]);
    fireEvent.click(screen.getByRole("tab", { name: "Costs" }));
    expect(await screen.findByTestId("ext-costs")).toBeInTheDocument();
    expect(noteVisit).not.toHaveBeenCalledWith(expect.stringContaining("ext:"));
  });
});

describe("CardDetailContent section order", () => {
  const order = () =>
    Array.from(document.querySelectorAll("[data-testid^='sec-']")).map((n) =>
      n.getAttribute("data-testid"),
    );

  it("renders the built-in order with no stored one", () => {
    useType(typeFor("Application", { has_hierarchy: true, has_successors: true }));
    renderCard(cardOf("Application"));
    expect(order()).toEqual([
      "sec-description",
      "sec-eol",
      "sec-lifecycle",
      "sec-custom-Commercials",
      "sec-hierarchy",
      "sec-successors",
      "sec-tags",
      "sec-relations",
      "sec-ldv",
    ]);
  });

  it("follows a stored order, splicing tags in before relations", () => {
    useType(
      typeFor("Application", {
        section_config: { __order: ["relations", "custom:0", "description"] },
      }),
    );
    renderCard(cardOf("Application"));
    expect(order()).toEqual([
      "sec-tags",
      "sec-relations",
      "sec-custom-Commercials",
      "sec-description",
      "sec-ldv",
    ]);
  });

  it("leaves out a section the metamodel hides", () => {
    useType(typeFor("Application", { section_config: { eol: { hidden: true } } }));
    renderCard(cardOf("Application"));
    expect(within(document.body).queryByTestId("sec-eol")).not.toBeInTheDocument();
    expect(screen.getByTestId("sec-lifecycle")).toBeInTheDocument();
  });
});
