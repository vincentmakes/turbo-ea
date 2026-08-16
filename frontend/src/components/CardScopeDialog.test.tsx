import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CardScopeDialog, { dedupeScopeRoots } from "./CardScopeDialog";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
}));

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    types: [],
    relationTypes: [],
    loading: false,
    getType: (key: string) => ({ key, label: key, color: "#123456" }),
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
  }),
}));

import { api } from "@/api/client";

/**
 *  Sales
 *    ├─ Lead Management
 *    │    └─ Lead Scoring
 *    ├─ Scoping
 *    └─ Quoting
 *  Scorecard Tools
 *  Finance
 *
 * Shaped for the ranking tests: against the query "sco", "Sales" and "Lead
 * Management" don't match on their own names but hold matching descendants,
 * while "Scorecard Tools" and "Scoping" match directly and start with it. In
 * plain alphabetical order "Sales" would precede both.
 */
const CARDS = [
  { id: "sales", name: "Sales", type: "BusinessCapability", parent_id: null },
  { id: "leads", name: "Lead Management", type: "BusinessCapability", parent_id: "sales" },
  { id: "scoring", name: "Lead Scoring", type: "BusinessCapability", parent_id: "leads" },
  { id: "scoping", name: "Scoping", type: "BusinessCapability", parent_id: "sales" },
  { id: "quoting", name: "Quoting", type: "BusinessCapability", parent_id: "sales" },
  { id: "scoretools", name: "Scorecard Tools", type: "BusinessCapability", parent_id: null },
  { id: "finance", name: "Finance", type: "BusinessCapability", parent_id: null },
];

const PARENTS = new Map<string, string | null>(CARDS.map((c) => [c.id, c.parent_id]));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue({ items: CARDS, total: CARDS.length });
});

function renderDialog(props: Partial<React.ComponentProps<typeof CardScopeDialog>> = {}) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(
    <CardScopeDialog
      open
      onClose={onClose}
      types="BusinessCapability"
      value={[]}
      onChange={onChange}
      {...props}
    />,
  );
  return { onChange, onClose };
}

describe("dedupeScopeRoots", () => {
  it("drops a descendant when its ancestor is also picked", () => {
    expect(dedupeScopeRoots(["sales", "leads"], PARENTS)).toEqual(["sales"]);
  });

  it("is order-independent", () => {
    expect(dedupeScopeRoots(["leads", "sales"], PARENTS)).toEqual(["sales"]);
  });

  it("drops a deep descendant, not just a direct child", () => {
    expect(dedupeScopeRoots(["scoring", "sales"], PARENTS)).toEqual(["sales"]);
  });

  it("keeps siblings and unrelated branches", () => {
    expect(dedupeScopeRoots(["leads", "quoting", "finance"], PARENTS)).toEqual([
      "leads",
      "quoting",
      "finance",
    ]);
  });

  it("keeps an id whose parent chain is unknown", () => {
    // A card outside the loaded set, or deleted since the scope was saved —
    // the caller decides whether it survives, not this helper.
    expect(dedupeScopeRoots(["ghost"], PARENTS)).toEqual(["ghost"]);
  });

  it("terminates on a cyclic parent chain", () => {
    const cyclic = new Map<string, string | null>([
      ["a", "b"],
      ["b", "a"],
    ]);
    expect(dedupeScopeRoots(["a"], cyclic)).toEqual(["a"]);
  });
});

describe("CardScopeDialog", () => {
  it("browses the whole hierarchy on open, without typing first", async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByText("Sales")).toBeInTheDocument());
    for (const name of ["Lead Management", "Lead Scoring", "Quoting", "Finance"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it("renders descendants of a checked card as implied, not as separate picks", async () => {
    const user = userEvent.setup();
    const { onChange } = renderDialog();
    await waitFor(() => expect(screen.getByText("Sales")).toBeInTheDocument());

    await user.click(screen.getByRole("checkbox", { name: "Sales" }));

    // The subtree reads as included…
    expect(screen.getByRole("checkbox", { name: "Lead Management" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Lead Scoring" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Quoting" })).toBeDisabled();
    // …but a sibling branch is untouched.
    expect(screen.getByRole("checkbox", { name: "Finance" })).not.toBeDisabled();

    // …and only the root is applied.
    await user.click(screen.getByRole("button", { name: /Apply/ }));
    expect(onChange).toHaveBeenCalledWith(["sales"]);
  });

  it("lets an ancestor pick subsume a descendant already picked", async () => {
    const user = userEvent.setup();
    const { onChange } = renderDialog();
    await waitFor(() => expect(screen.getByText("Lead Management")).toBeInTheDocument());

    await user.click(screen.getByRole("checkbox", { name: "Lead Management" }));
    await user.click(screen.getByRole("checkbox", { name: "Sales" }));
    await user.click(screen.getByRole("button", { name: /Apply/ }));

    expect(onChange).toHaveBeenCalledWith(["sales"]);
  });

  it("narrows on the first character, with no debounce to wait out", async () => {
    const user = userEvent.setup();
    renderDialog();
    await waitFor(() => expect(screen.getByText("Finance")).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText(/Search cards/), "F");

    // Asserted synchronously — no `waitFor`, no timer advance. Filtering runs
    // on the raw input, so the row is already gone by the time typing
    // resolves. Keying it off the debounced value would leave "Sales" on
    // screen for another 300ms and fail here.
    expect(screen.queryByRole("checkbox", { name: "Sales" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Finance" })).toBeInTheDocument();
  });

  it("ranks a branch by its best descendant, not by its own name", async () => {
    const user = userEvent.setup();
    renderDialog();
    await waitFor(() => expect(screen.getByText("Sales")).toBeInTheDocument());

    // "scor" rather than "sco" so the two roots can't tie: it excludes
    // "Scoping", leaving Sales to be ranked by "Lead Scoring" two levels down.
    await user.type(screen.getByPlaceholderText(/Search cards/), "scor");

    const rendered = screen
      .getAllByRole("button")
      .map((el) => el.textContent ?? "")
      .filter((text) => text.length > 0);
    const rootOrder = rendered.filter(
      (t) => t.includes("Scorecard Tools") || t.includes("Sales"),
    );

    // "Scorecard Tools" starts with the term (rank 1); "Sales" matches nothing
    // itself and is ranked 2 through "Lead Scoring" beneath it. Ranking by
    // each node's own name would bury Sales entirely, and plain alphabetical
    // order would put it first.
    expect(rootOrder[0]).toContain("Scorecard Tools");
    expect(rootOrder[1]).toContain("Sales");
  });

  it("orders siblings by relevance, beating alphabetical order", async () => {
    const user = userEvent.setup();
    renderDialog();
    await waitFor(() => expect(screen.getByText("Sales")).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText(/Search cards/), "sco");

    const rendered = screen.getAllByRole("button").map((el) => el.textContent ?? "");
    const scopingAt = rendered.findIndex((t) => t.includes("Scoping"));
    const leadsAt = rendered.findIndex((t) => t.includes("Lead Management"));

    // Both are children of Sales. "Scoping" matches directly; "Lead
    // Management" only carries a match below it. Alphabetically it would be
    // the other way round.
    expect(scopingAt).toBeGreaterThanOrEqual(0);
    expect(leadsAt).toBeGreaterThanOrEqual(0);
    expect(scopingAt).toBeLessThan(leadsAt);
  });

  it("keeps ancestors visible when a deep child matches the search", async () => {
    const user = userEvent.setup();
    renderDialog();
    await waitFor(() => expect(screen.getByText("Lead Scoring")).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText(/Search cards/), "Scoring");

    await waitFor(() => expect(screen.queryByText("Finance")).not.toBeInTheDocument());
    // The match, plus its whole parent chain, so it is never orphaned.
    expect(screen.getByText("Lead Scoring")).toBeInTheDocument();
    expect(screen.getByText("Lead Management")).toBeInTheDocument();
    expect(screen.getByText("Sales")).toBeInTheDocument();
  });

  it("keeps a selection made before the search term changed", async () => {
    const user = userEvent.setup();
    const { onChange } = renderDialog();
    await waitFor(() => expect(screen.getByText("Finance")).toBeInTheDocument());

    await user.click(screen.getByRole("checkbox", { name: "Finance" }));
    await user.type(screen.getByPlaceholderText(/Search cards/), "Quoting");
    // Gone from the candidate list…
    await waitFor(() =>
      expect(screen.queryByRole("checkbox", { name: "Finance" })).not.toBeInTheDocument(),
    );
    // …but still selected, which is exactly what the chip is there to show.
    expect(screen.getByText("Finance")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Quoting" }));
    await user.click(screen.getByRole("button", { name: /Apply/ }));

    expect(onChange).toHaveBeenCalledWith(["finance", "quoting"]);
  });

  it("seeds from the incoming value and labels chips from initialOptions", async () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {})); // never resolves
    renderDialog({ value: ["sales"], initialOptions: CARDS });

    // The chip is labelled without waiting for this dialog's own fetch.
    await waitFor(() => expect(screen.getByText("1 selected")).toBeInTheDocument());
    expect(screen.getByText("Sales")).toBeInTheDocument();
  });

  it("clear all empties the selection", async () => {
    const user = userEvent.setup();
    const { onChange } = renderDialog({ value: ["sales"], initialOptions: CARDS });
    await waitFor(() => expect(screen.getByText("1 selected")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Clear all" }));
    await user.click(screen.getByRole("button", { name: /Apply/ }));

    expect(onChange).toHaveBeenCalledWith([]);
  });
});
