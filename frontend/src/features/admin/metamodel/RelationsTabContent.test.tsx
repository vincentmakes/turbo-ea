/**
 * The Relations tab shell, rendered by both the landscape-wide Relation Types
 * tab and a card type's own Relations tab.
 *
 * Two things are worth guarding:
 *  - **Manage translations sits above everything it covers.** It governs the
 *    relation verbs *and* the hierarchy link types, so it must not read as a
 *    control belonging to the relation list alone — which is where it lived
 *    before the link types existed.
 *  - **Card-type mode scopes what the dialog will edit.** Translating from a
 *    card type's own tab must not silently open the whole landscape.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CardType, RelationType } from "@/types";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class extends Error {},
}));

/** The two children are covered by their own suites; stub them to their props. */
vi.mock("./HierarchyLinkTypesSection", () => ({
  default: () => <div data-testid="hierarchy-section" />,
}));
vi.mock("./RelationTypesPanel", () => ({
  default: () => <div data-testid="relation-panel" />,
}));
vi.mock("./RelationTranslationDialog", () => ({
  default: ({
    open,
    relationTypes,
    hierarchyTypes,
  }: {
    open: boolean;
    relationTypes: RelationType[];
    hierarchyTypes?: CardType[];
  }) =>
    open ? (
      <div data-testid="translate-dialog">
        <span data-testid="rel-keys">{relationTypes.map((r) => r.key).join(",")}</span>
        <span data-testid="ct-keys">{(hierarchyTypes || []).map((c) => c.key).join(",")}</span>
      </div>
    ) : null,
}));

import RelationsTabContent from "./RelationsTabContent";

const ORG = {
  key: "Organization",
  label: "Organization",
  has_hierarchy: true,
  hierarchy_labels: [{ key: "commercial", label: "Commercial" }],
} as unknown as CardType;

const APP = {
  key: "Application",
  label: "Application",
  has_hierarchy: true,
  hierarchy_labels: [],
} as unknown as CardType;

function rel(key: string, source: string, target: string) {
  return {
    key,
    label: "uses",
    reverse_label: "is used by",
    source_type_key: source,
    target_type_key: target,
    cardinality: "n:m",
    attributes_schema: [],
  } as unknown as RelationType;
}

const RELATIONS = [rel("orgToApp", "Organization", "Application"), rel("appToIface", "Application", "Interface")];

function renderTab(scopeTypeKey?: string, types = [ORG, APP], relationTypes = RELATIONS) {
  render(
    <RelationsTabContent
      types={types}
      relationTypes={relationTypes}
      onRefresh={vi.fn()}
      scopeTypeKey={scopeTypeKey}
    />,
  );
}

describe("RelationsTabContent", () => {
  it("puts Manage translations above both sections it governs", () => {
    renderTab();
    const button = screen.getByRole("button", { name: /translations/i });
    const hierarchy = screen.getByTestId("hierarchy-section");
    // It covers the link types too, so it cannot sit inside the relation list.
    expect(button.compareDocumentPosition(hierarchy)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      hierarchy.compareDocumentPosition(screen.getByTestId("relation-panel")),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("hands the dialog every relation and every configured vocabulary", async () => {
    renderTab();
    await userEvent.click(screen.getByRole("button", { name: /translations/i }));
    expect(screen.getByTestId("rel-keys")).toHaveTextContent("orgToApp,appToIface");
    // Application has the flag but an empty vocabulary — nothing to translate.
    expect(screen.getByTestId("ct-keys")).toHaveTextContent("Organization");
  });

  it("narrows both lists to the card type in scope", async () => {
    renderTab("Organization");
    await userEvent.click(screen.getByRole("button", { name: /translations/i }));
    // `appToIface` touches neither end of Organization.
    expect(screen.getByTestId("rel-keys")).toHaveTextContent("orgToApp");
    expect(screen.getByTestId("rel-keys")).not.toHaveTextContent("appToIface");
    expect(screen.getByTestId("ct-keys")).toHaveTextContent("Organization");
  });

  it("offers no translations button when there is nothing to translate", () => {
    renderTab("Application", [APP], []);
    expect(screen.queryByRole("button", { name: /translations/i })).not.toBeInTheDocument();
  });
});
