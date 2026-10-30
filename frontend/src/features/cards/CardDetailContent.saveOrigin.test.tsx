import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Gamified data quality flies a gain from the section that saved it (Part F):
// every section's save reports that section's anchor through `onSaveOrigin`,
// right before `onCardUpdate`, in the same tick. Sections are buttons that
// call the callback they were handed.

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn() },
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
  useCardTabActivity: () => ({ hasUpdates: () => false, noteVisit: vi.fn() }),
}));
vi.mock("@/hooks/AuthContext", () => ({
  useOptionalAuthUser: () => null,
  useAuthContext: () => ({ user: { id: "u1", permissions: { "*": true } } }),
}));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ can: () => true }) }));
vi.mock("@/components/EolLinkSection", () => ({
  default: ({ onSave }: { onSave: (u: Record<string, unknown>) => Promise<void> }) => (
    <button data-testid="save-eol" onClick={() => onSave({ eol: 1 })} />
  ),
}));

vi.mock("@/features/cards/sections", () => {
  type Save = { onSave: (u: Record<string, unknown>) => Promise<void> };
  const saver =
    (name: string) =>
    ({ onSave }: Save) => (
      // A real section reports a failed save itself; swallow it like one.
      <button data-testid={`save-${name}`} onClick={() => onSave({ from: name }).catch(() => {})} />
    );
  const caller = (name: string, prop: string) => (props: Record<string, unknown>) => (
    <button data-testid={`save-${name}`} onClick={() => (props[prop] as () => void)()} />
  );
  const marker = (id: string) => () => <div data-testid={id} />;
  return {
    DescriptionSection: saver("description"),
    LifecycleSection: saver("lifecycle"),
    AttributeSection: saver("attributes"),
    TagsSection: caller("tags", "onUpdate"),
    HierarchySection: caller("hierarchy", "onUpdate"),
    RelationsSection: caller("relations", "onCardUpdate"),
    StakeholdersTab: caller("stakeholders", "onRefresh"),
    SuccessorsSection: marker("sec-successors"),
    LayeredDependencySection: marker("sec-ldv"),
    CommentsTab: marker("panel-comments"),
    TodosTab: marker("panel-todos"),
    ResourcesTab: marker("panel-resources"),
    AdrsTab: marker("panel-adrs"),
    HistoryTab: marker("panel-history"),
    RisksTab: marker("panel-risks"),
    ComplianceTab: marker("panel-compliance"),
  };
});

import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import type { Card } from "@/types";
import CardDetailContent from "./CardDetailContent";

const TYPE = {
  key: "Application",
  label: "Application",
  icon: "apps",
  color: "#0f7eb5",
  has_hierarchy: true,
  has_successors: false,
  subtypes: [],
  fields_schema: [
    { section: "Application Information", fields: [{ key: "a", label: "A", type: "text" }] },
  ],
  section_config: {},
};

const CARD = {
  id: "card-1",
  name: "Thing",
  type: "Application",
  status: "ACTIVE",
  approval_status: "DRAFT",
  data_quality: 40,
  lifecycle: {},
  attributes: {},
  tags: [],
  stakeholders: [],
} as unknown as Card;
const SAVED = { ...CARD, data_quality: 60 } as Card;

const perms = {
  can_view: true,
  can_edit: true,
  can_manage_relations: true,
  can_manage_stakeholders: true,
  can_manage_adr_links: false,
} as unknown as Parameters<typeof CardDetailContent>[0]["perms"];

let events: string[];

function renderContent(initialTab: string | number = 0, withOrigin = true) {
  const onCardUpdate = vi.fn((c: Card) => events.push(`update:${c.data_quality}`));
  const onSaveOrigin = vi.fn((anchor: string) => events.push(`origin:${anchor}`));
  render(
    <MemoryRouter>
      <CardDetailContent
        card={CARD}
        perms={perms}
        onCardUpdate={onCardUpdate}
        onSaveOrigin={withOrigin ? onSaveOrigin : undefined}
        initialTab={initialTab}
      />
    </MemoryRouter>,
  );
  return { onCardUpdate, onSaveOrigin };
}

async function save(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByTestId(`save-${name}`));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  events = [];
  vi.mocked(useMetamodel).mockReturnValue({
    types: [TYPE],
    relationTypes: [],
    loading: false,
    getType: (k: string) => (k === TYPE.key ? TYPE : undefined),
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
  } as unknown as ReturnType<typeof useMetamodel>);
  vi.mocked(api.get).mockImplementation((path: string) =>
    Promise.resolve(path === `/cards/${CARD.id}` ? SAVED : []),
  );
  vi.mocked(api.patch).mockResolvedValue(SAVED);
});

describe("CardDetailContent save origin", () => {
  it.each([
    ["description", "card-section-description", { from: "description" }],
    ["lifecycle", "card-section-lifecycle", { from: "lifecycle" }],
    ["attributes", "card-section-custom-application-information", { from: "attributes" }],
  ])("a %s save patches the card, then reports its section before the update", async (name, anchor, body) => {
    renderContent();
    await save(name);
    expect(api.patch).toHaveBeenCalledWith("/cards/card-1", body);
    expect(events).toEqual([`origin:${anchor}`, "update:60"]);
  });

  it.each([
    ["tags", "card-section-tags"],
    ["relations", "card-section-relations"],
    ["hierarchy", "card-section-hierarchy"],
  ])("a %s change refetches the card, then reports its section before the update", async (name, anchor) => {
    renderContent();
    await save(name);
    expect(api.get).toHaveBeenCalledWith("/cards/card-1");
    expect(events).toEqual([`origin:${anchor}`, "update:60"]);
  });

  it("a stakeholder change reports the Stakeholders tab panel, which carries that id", async () => {
    renderContent("stakeholders");
    const panel = document.getElementById("card-tab-stakeholders");
    expect(panel).not.toBeNull();
    expect(panel).toContainElement(screen.getByTestId("save-stakeholders"));
    await save("stakeholders");
    expect(events).toEqual(["origin:card-tab-stakeholders", "update:60"]);
  });

  it("an End of Life save reports no origin", async () => {
    renderContent();
    await save("eol");
    expect(api.patch).toHaveBeenCalledWith("/cards/card-1", { eol: 1 });
    expect(events).toEqual(["update:60"]);
  });

  it("reports nothing for a save that fails", async () => {
    vi.mocked(api.patch).mockRejectedValueOnce(new Error("nope"));
    renderContent();
    await save("description");
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(events).toEqual([]);
  });

  it("still updates the card when nobody listens for the origin", async () => {
    const { onCardUpdate } = renderContent(0, false);
    await save("tags");
    expect(onCardUpdate).toHaveBeenCalledWith(SAVED);
    expect(events).toEqual(["update:60"]);
  });
});
