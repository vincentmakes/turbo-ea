/**
 * Hierarchy link types as a section of the Relations tab (#1100 follow-up).
 *
 * It used to sit on the type drawer's main tab next to Subtypes. A parent→child
 * link is a relationship, so it belongs with the relation types — and it now
 * renders in both hosts from one component, which is what these cases pin.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HierarchyLinkTypesSection from "./HierarchyLinkTypesSection";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock("./HierarchyLabelsDialog", () => ({
  default: ({ open, cardType }: { open: boolean; cardType: { key: string } | null }) =>
    open ? <div data-testid="labels-dialog">{cardType?.key}</div> : null,
}));

const ORG = {
  key: "Organization",
  label: "Organization",
  icon: "corporate_fare",
  color: "#2889ff",
  has_hierarchy: true,
  hierarchy_labels: [
    { key: "commercial", label: "Commercial", color: "#2889ff" },
    { key: "sales", label: "Sales", color: "#33cc58" },
  ],
} as never;

/** Hierarchical but not yet configured — still listed, or the feature is undiscoverable. */
const CAPABILITY = {
  key: "BusinessCapability",
  label: "Business Capability",
  icon: "account_tree",
  color: "#003399",
  has_hierarchy: true,
  hierarchy_labels: [],
} as never;

/** Flat type — never appears. */
const INTERFACE = {
  key: "Interface",
  label: "Interface",
  icon: "sync_alt",
  color: "#02afa4",
  has_hierarchy: false,
} as never;

const TYPES = [ORG, CAPABILITY, INTERFACE];

beforeEach(() => vi.clearAllMocks());

describe("HierarchyLinkTypesSection", () => {
  it("lists every hierarchical type on the general tab, configured or not", () => {
    render(<HierarchyLinkTypesSection types={TYPES} onRefresh={vi.fn()} />);
    expect(screen.getByText("Organization")).toBeInTheDocument();
    expect(screen.getByText("Business Capability")).toBeInTheDocument();
    expect(screen.getByText("Commercial")).toBeInTheDocument();
    // An empty vocabulary still gets a row — hiding it would leave the feature
    // reachable only by someone who already knew it existed.
    expect(screen.getByText("No link types defined")).toBeInTheDocument();
  });

  it("heads the block without repeating the dialog's explanation", () => {
    render(<HierarchyLinkTypesSection types={TYPES} onRefresh={vi.fn()} />);
    // The heading stays — the tab stacks two lists and the rows would
    // otherwise be unidentifiable.
    expect(screen.getByText("Hierarchy link types")).toBeInTheDocument();
    // The prose does not: it is rendered by `HierarchyLabelsDialog`, the way
    // `RelationTypeValuesDialog` carries the relation-values one, and printing
    // it on the tab as well said the same thing twice.
    expect(screen.queryByText(/Label each parent-child link/i)).not.toBeInTheDocument();
  });

  it("never lists a non-hierarchical type", () => {
    render(<HierarchyLinkTypesSection types={TYPES} onRefresh={vi.fn()} />);
    expect(screen.queryByText("Interface")).not.toBeInTheDocument();
  });

  it("shows only the scoped type in the drawer", () => {
    render(
      <HierarchyLinkTypesSection types={TYPES} scopeTypeKey="Organization" onRefresh={vi.fn()} />,
    );
    expect(screen.getByText("Commercial")).toBeInTheDocument();
    expect(screen.queryByText("Business Capability")).not.toBeInTheDocument();
  });

  it("renders nothing for a non-hierarchical scoped type", () => {
    const { container } = render(
      <HierarchyLinkTypesSection types={TYPES} scopeTypeKey="Interface" onRefresh={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("opens the editor for the row's own card type", async () => {
    const user = userEvent.setup();
    render(<HierarchyLinkTypesSection types={TYPES} onRefresh={vi.fn()} />);

    const row = screen.getByText("Business Capability").closest("div")
      ?.parentElement as HTMLElement;
    await user.click(within(row).getByRole("button", { name: /edit link types/i }));
    // The dialog must receive the type whose row was clicked, not the first one.
    expect(await screen.findByTestId("labels-dialog")).toHaveTextContent("BusinessCapability");
  });
});
