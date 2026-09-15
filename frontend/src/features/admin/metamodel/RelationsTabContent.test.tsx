/**
 * The Relations tab shell, rendered by both the landscape-wide Relation Types
 * tab and a card type's own Relations tab.
 *
 * Two things are worth guarding:
 *  - **Manage translations sits above everything it covers.** It governs both
 *    sub-tabs, so it stays above the sub-tab row rather than inside either
 *    panel — which is where it lived before the link types existed.
 *  - **Landscape leads with the relation types.** Hierarchy link types are a
 *    niche most installs never configure, so they are the second sub-tab and
 *    are not on screen until asked for.
 *  - **Card-type mode has no translations button at all.** The drawer header
 *    already carries one, reachable from every tab, and the dialog behind it
 *    covers this type's link types plus its label, subtypes, fields and roles.
 *    Two same-named buttons writing the same column is what shipped once.
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
  it("opens on the relation types, with the hierarchy list behind its own tab", async () => {
    renderTab();
    // First sub-tab, and the default: the list everyone uses.
    expect(screen.getByTestId("relation-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("hierarchy-section")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: /hierarchy link types/i }));
    expect(screen.getByTestId("hierarchy-section")).toBeInTheDocument();
    expect(screen.queryByTestId("relation-panel")).not.toBeInTheDocument();
  });

  it("keeps Manage translations above the sub-tabs it governs", () => {
    renderTab();
    const button = screen.getByRole("button", { name: /translations/i });
    // It covers both sub-tabs, so it belongs above the row, not in a panel.
    const tab = screen.getByRole("tab", { name: /hierarchy link types/i });
    expect(button.compareDocumentPosition(tab)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("stacks both, with no sub-tabs, in card-type mode", () => {
    renderTab("Organization");
    // One hierarchy row is lighter than a tab to reach it, so the drawer keeps
    // the two stacked.
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.getByTestId("hierarchy-section")).toBeInTheDocument();
    expect(screen.getByTestId("relation-panel")).toBeInTheDocument();
  });

  it("hands the dialog every relation and every configured vocabulary", async () => {
    renderTab();
    await userEvent.click(screen.getByRole("button", { name: /translations/i }));
    expect(screen.getByTestId("rel-keys")).toHaveTextContent("orgToApp,appToIface");
    // Application has the flag but an empty vocabulary — nothing to translate.
    expect(screen.getByTestId("ct-keys")).toHaveTextContent("Organization");
  });

  it("offers no translations button in card-type mode", () => {
    renderTab("Organization");
    // The drawer header's Translate button is the single route there, and it
    // covers strictly more than this one did.
    expect(screen.queryByRole("button", { name: /translations/i })).not.toBeInTheDocument();
    // The vocabulary editor and the relation editor still render.
    expect(screen.getByTestId("hierarchy-section")).toBeInTheDocument();
    expect(screen.getByTestId("relation-panel")).toBeInTheDocument();
  });

  it("offers no translations button when there is nothing to translate", () => {
    renderTab(undefined, [APP], []);
    expect(screen.queryByRole("button", { name: /translations/i })).not.toBeInTheDocument();
  });
});
