import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CardMultiPicker from "./CardMultiPicker";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
}));

const TYPES = [
  {
    key: "Application",
    label: "Application",
    color: "#0f7eb5",
    icon: "apps",
    has_hierarchy: false,
    is_hidden: false,
    sort_order: 1,
  },
  {
    key: "BusinessCapability",
    label: "Business Capability",
    color: "#003399",
    icon: "account_tree",
    has_hierarchy: true,
    is_hidden: false,
    sort_order: 2,
  },
  {
    key: "Secret",
    label: "Secret",
    color: "#000000",
    icon: "lock",
    has_hierarchy: false,
    is_hidden: true,
    sort_order: 3,
  },
];

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    types: TYPES,
    relationTypes: [],
    loading: false,
    getType: (key: string) => TYPES.find((t) => t.key === key),
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
  }),
}));

import { api } from "@/api/client";

/**
 *  Sales
 *    ├─ Lead Management
 *    └─ Quoting
 *  Finance
 *
 * plus two Applications, so a facet change genuinely swaps the loaded set.
 */
const CAPABILITIES = [
  { id: "sales", name: "Sales", type: "BusinessCapability", parent_id: null },
  { id: "leads", name: "Lead Management", type: "BusinessCapability", parent_id: "sales" },
  { id: "quoting", name: "Quoting", type: "BusinessCapability", parent_id: "sales" },
  { id: "finance", name: "Finance", type: "BusinessCapability", parent_id: null },
];
const APPLICATIONS = [
  { id: "sap", name: "SAP S/4HANA", type: "Application", parent_id: null },
  { id: "sfdc", name: "Salesforce", type: "Application", parent_id: null },
];
const ALL = [...CAPABILITIES, ...APPLICATIONS];

/**
 * An HONEST mock: it honours `type=` and `search=` exactly as the backend
 * does. The dropped-selection bug this component exists to fix is only visible
 * when the loaded set actually changes between a tick and Apply — a mock that
 * always returns everything makes such a test pass vacuously.
 */
function respond(path: string) {
  if (path.startsWith("/cards/counts")) {
    return Promise.resolve({
      by_type: [
        { type: "Application", count: APPLICATIONS.length },
        { type: "BusinessCapability", count: CAPABILITIES.length },
      ],
      total: ALL.length,
    });
  }
  const url = new URL(path, "http://x");
  let items = ALL;
  const ids = url.searchParams.get("ids");
  if (ids) {
    const wanted = new Set(ids.split(","));
    items = items.filter((c) => wanted.has(c.id));
    return Promise.resolve({ items, total: items.length });
  }
  const typeParam = url.searchParams.get("type");
  if (typeParam) {
    const keys = new Set(typeParam.split(","));
    items = items.filter((c) => keys.has(c.type));
  }
  const search = url.searchParams.get("search");
  if (search) {
    const q = search.toLowerCase();
    items = items.filter((c) => c.name.toLowerCase().includes(q));
  }
  return Promise.resolve({ items, total: items.length });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation((path: string) => respond(path) as never);
});

function renderPicker(props: Partial<React.ComponentProps<typeof CardMultiPicker>> = {}) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(
    <CardMultiPicker open value={[]} onChange={onChange} onClose={onClose} {...props} />,
  );
  return { onChange, onClose };
}

/** The results list, so a query can't stray into the rail or the chip row. */
async function list() {
  return await screen.findByTestId("card-picker-list");
}

/** The result row whose name is exactly `name`. */
async function row(name: string) {
  const label = await within(await list()).findByText(name, { exact: true });
  return label.closest('[role="button"]') as HTMLElement;
}

/** Whether the results list currently offers a row with this exact name. */
async function listHas(name: string) {
  return Boolean(within(await list()).queryByText(name, { exact: true }));
}

/** The type rail's chip for a type label. */
async function railChip(label: string) {
  return within(await screen.findByTestId("card-picker-rail")).getByText(label);
}

describe("CardMultiPicker", () => {
  it("browses on open when the caller names its types", async () => {
    renderPicker({ types: "BusinessCapability" });
    expect(await screen.findByText("Sales")).toBeTruthy();
    // One type ⇒ no rail.
    expect(screen.queryByText("Type")).toBeNull();
  });

  it("asks first when no types are given, then loads once a facet is picked", async () => {
    const user = userEvent.setup();
    renderPicker();
    expect(await screen.findAllByText(/Pick a type or start typing/i)).not.toHaveLength(0);
    expect(await listHas("Sales")).toBe(false);

    await user.click(await railChip("Application"));
    expect(await row("SAP S/4HANA")).toBeTruthy();
    expect(await listHas("Sales")).toBe(false);
  });

  it("never offers a hidden type on the rail", async () => {
    renderPicker();
    expect(await railChip("Application")).toBeTruthy();
    expect(within(await screen.findByTestId("card-picker-rail")).queryByText("Secret")).toBeNull();
  });

  it("narrows the rail to the caller's types", async () => {
    renderPicker({ types: ["Application"] });
    const rail = screen.queryByTestId("card-picker-rail");
    // One type ⇒ single pane, no rail at all.
    expect(rail).toBeNull();
  });

  // ── The two regressions the Map-based selection exists to prevent ──────────

  it("keeps a pick made before the facet changed", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker({ types: ["Application", "BusinessCapability"] });

    await user.click(await row("SAP S/4HANA"));
    // Facet away from Applications — `useCardSearch` replaces `items` entirely,
    // so the ticked card is no longer anywhere in the loaded page.
    await user.click(await railChip("Application"));
    await waitFor(async () => expect(await listHas("SAP S/4HANA")).toBe(false));
    await user.click(await row("Finance"));

    await user.click(screen.getByRole("button", { name: /^Apply/ }));
    const [ids, cards] = onChange.mock.calls[0];
    expect(new Set(ids)).toEqual(new Set(["sap", "finance"]));
    // The CARD, not just the id: a picker that resolved the selection against
    // the loaded page would hand back an undefined here (the InsertCardsDialog
    // bug) — the id list alone would look fine.
    expect(cards.map((c: { name: string }) => c.name).sort()).toEqual([
      "Finance",
      "SAP S/4HANA",
    ]);
  });

  it("keeps a pick made before the search changed", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker({ types: ["Application"] });

    await user.click(await row("SAP S/4HANA"));
    await user.type(screen.getByPlaceholderText(/Search by name/i), "Salesforce");
    await waitFor(async () => expect(await listHas("SAP S/4HANA")).toBe(false));
    await user.click(await row("Salesforce"));

    await user.click(screen.getByRole("button", { name: /^Apply/ }));
    const [ids, cards] = onChange.mock.calls[0];
    expect(new Set(ids)).toEqual(new Set(["sap", "sfdc"]));
    expect(cards.map((c: { name: string }) => c.name).sort()).toEqual([
      "SAP S/4HANA",
      "Salesforce",
    ]);
  });

  // ── Hierarchy + roots ─────────────────────────────────────────────────────

  it("renders the hierarchy and marks descendants implied when roots is on", async () => {
    const user = userEvent.setup();
    renderPicker({ types: "BusinessCapability", roots: true });
    await user.click(await row("Sales"));

    await waitFor(() => {
      expect(screen.getAllByText("included").length).toBe(2);
    });
    // The implied row's checkbox is not tickable.
    const leads = await row("Lead Management");
    expect(within(leads).getByRole("checkbox")).toHaveProperty("disabled", true);
  });

  it("applies the deduped root set, not the closure", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker({ types: "BusinessCapability", roots: true });
    await user.click(await row("Quoting"));
    await user.click(await row("Sales"));

    await user.click(screen.getByRole("button", { name: /^Apply/ }));
    expect(onChange.mock.calls[0][0]).toEqual(["sales"]);
  });

  it("leaves descendants independently tickable without roots", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker({ types: "BusinessCapability" });
    await user.click(await row("Sales"));
    await user.click(await row("Quoting"));

    expect(screen.queryByText("included")).toBeNull();
    await user.click(screen.getByRole("button", { name: /^Apply/ }));
    expect(new Set(onChange.mock.calls[0][0])).toEqual(new Set(["sales", "quoting"]));
  });

  // ── The honest counter ────────────────────────────────────────────────────

  it("shows the closure size only when the whole type is loaded", async () => {
    const user = userEvent.setup();
    renderPicker({ types: "BusinessCapability", roots: true });
    await user.click(await row("Sales"));
    // Tree mode with every pick loaded ⇒ the number is real: Sales + 2 children.
    expect(await screen.findByText(/1 picked · 3 in scope/)).toBeTruthy();
  });

  it("falls back to a number-free caption when the closure is not knowable", async () => {
    const user = userEvent.setup();
    // Two types faceted ⇒ no hierarchy is built, so descendants are unknown.
    renderPicker({ types: ["Application", "BusinessCapability"], roots: true });
    await user.click(await row("Sales"));
    expect(await screen.findByText(/1 picked · descendants included/)).toBeTruthy();
  });

  it("counts plainly when roots is off", async () => {
    const user = userEvent.setup();
    renderPicker({ types: "Application" });
    await user.click(await row("SAP S/4HANA"));
    expect(await screen.findByText(/^1 picked$/)).toBeTruthy();
  });

  // ── Modes, seeding, chips ─────────────────────────────────────────────────

  it("single mode applies and closes on the first click", async () => {
    const user = userEvent.setup();
    const { onChange, onClose } = renderPicker({ types: "Application", mode: "single" });
    await user.click(await row("Salesforce"));
    expect(onChange).toHaveBeenCalledWith(["sfdc"], [expect.objectContaining({ id: "sfdc" })]);
    expect(onClose).toHaveBeenCalled();
  });

  it("seeds from value and resolves labels the browse cannot reach", async () => {
    // "sap" is an Application, but only capabilities are faceted — its chip
    // must still read as a name, not a placeholder.
    renderPicker({ types: "BusinessCapability", value: ["sap"] });
    expect(await screen.findByRole("button", { name: "SAP S/4HANA" })).toBeTruthy();
  });

  it("removes a pick from its chip", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker({ types: "Application", value: ["sap"] });
    const chip = await screen.findByRole("button", { name: "SAP S/4HANA" });
    await user.click(within(chip).getByTestId("CancelIcon"));
    await user.click(screen.getByRole("button", { name: /^Apply$/ }));
    expect(onChange.mock.calls[0][0]).toEqual([]);
  });

  it("select-all-shown takes only what is on screen", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker({ types: "Application", showSelectAll: true });
    await user.type(screen.getByPlaceholderText(/Search by name/i), "Salesforce");
    await waitFor(async () => expect(await listHas("SAP S/4HANA")).toBe(false));
    await user.click(screen.getByRole("button", { name: /Select all shown/ }));
    await user.click(screen.getByRole("button", { name: /^Apply/ }));
    expect(onChange.mock.calls[0][0]).toEqual(["sfdc"]);
  });

  it("honours a custom apply label", async () => {
    renderPicker({ types: "Application", applyLabel: (n) => `Insert selected (${n})` });
    expect(await screen.findByRole("button", { name: "Insert selected (0)" })).toBeTruthy();
  });
});
