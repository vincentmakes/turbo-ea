/**
 * Tests for the descendant relation roll-up drawer (#863).
 *
 * The invariant worth guarding is that the drawer is *read-only* and lazy:
 * nothing is fetched until it opens, rows carry their `via` provenance, and
 * there is no add/unlink affordance anywhere in it.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class extends Error {},
}));

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    getType: (key: string) =>
      key === "Application"
        ? {
            key: "Application",
            label: "Application",
            color: "#0f7eb5",
            subtypes: [
              { key: "businessApplication", label: "Business Application" },
              { key: "microservice", label: "Microservice" },
            ],
          }
        : undefined,
    types: [],
    relationTypes: [],
  }),
}));

const navigate = vi.fn();
vi.mock("react-router", () => ({
  useNavigate: () => navigate,
}));

import { api } from "@/api/client";
import i18n from "@/i18n";
import type { RelationType } from "@/types";
import DescendantRelationsDrawer from "./DescendantRelationsDrawer";

const rt = {
  key: "capToApp",
  label: "is supported by",
  reverse_label: "supports",
  source_type_key: "BusinessCapability",
  target_type_key: "Application",
  cardinality: "n:m",
} as unknown as RelationType;

const payload = {
  total: 2,
  via_total: 2,
  rows: [
    {
      id: "a1",
      name: "Billing Engine",
      type: "Application",
      subtype: null,
      lifecycle: { active: "2020-01-01" },
      via: [{ id: "s1", name: "Card Payments", type: "BusinessCapability" }],
    },
    {
      id: "a2",
      name: "Payments Gateway",
      type: "Application",
      subtype: null,
      lifecycle: {},
      via: [
        { id: "s1", name: "Card Payments", type: "BusinessCapability" },
        { id: "s2", name: "Direct Debit", type: "BusinessCapability" },
      ],
    },
  ],
};

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  navigate.mockReset();
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (i18n.language !== "en") await i18n.changeLanguage("en");
});

function renderDrawer(open = true) {
  return render(
    <DescendantRelationsDrawer
      open={open}
      onClose={() => {}}
      cardId="root-1"
      rt={rt}
      isSource
    />,
  );
}

describe("DescendantRelationsDrawer", () => {
  it("fetches nothing while closed", () => {
    vi.mocked(api.get).mockResolvedValue(payload);
    renderDrawer(false);
    expect(api.get).not.toHaveBeenCalled();
  });

  it("lists rolled-up cards with their provenance chips", async () => {
    vi.mocked(api.get).mockResolvedValue(payload);
    renderDrawer();

    await waitFor(() => expect(screen.getByText("Billing Engine")).toBeInTheDocument());
    expect(screen.getByText("Payments Gateway")).toBeInTheDocument();

    // "Payments Gateway" is reached through two sub-capabilities — both show.
    expect(screen.getAllByText("Card Payments").length).toBeGreaterThan(0);
    expect(screen.getByText("Direct Debit")).toBeInTheDocument();

    expect(vi.mocked(api.get).mock.calls[0][0]).toContain(
      "/cards/root-1/descendant-relations?relation_type=capToApp",
    );
  });

  it("states how concentrated the roll-up is", async () => {
    vi.mocked(api.get).mockResolvedValue(payload);
    renderDrawer();
    // Counted over the whole result set, not just the visible page.
    await waitFor(() =>
      expect(screen.getByText(/2 cards · via 2 sub-items/i)).toBeInTheDocument(),
    );
  });

  it("shows a lifecycle badge only for cards that have a dated phase", async () => {
    vi.mocked(api.get).mockResolvedValue(payload);
    renderDrawer();
    // "Billing Engine" is active; "Payments Gateway" has no lifecycle at all,
    // so exactly one badge renders.
    await waitFor(() => expect(screen.getByText("Billing Engine")).toBeInTheDocument());
    expect(screen.getAllByText(/^Active$/i)).toHaveLength(1);
  });

  it("groups by subtype once the list is big and diverse enough", async () => {
    // 8 rows across two real subtypes — the same threshold the relations list
    // uses, so the two surfaces behave alike.
    const many = {
      total: 8,
      via_total: 1,
      rows: Array.from({ length: 8 }, (_, i) => ({
        id: `x${i}`,
        name: `App ${i}`,
        type: "Application",
        subtype: i < 5 ? "businessApplication" : "microservice",
        lifecycle: {},
        via: [{ id: "s1", name: "Card Payments", type: "BusinessCapability" }],
      })),
    };
    vi.mocked(api.get).mockResolvedValue(many);
    renderDrawer();

    await waitFor(() => expect(screen.getByText("Business Application")).toBeInTheDocument());
    expect(screen.getByText("Microservice")).toBeInTheDocument();
    // Bucket counts, not just labels.
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("stays flat below the grouping threshold", async () => {
    vi.mocked(api.get).mockResolvedValue(payload); // 2 rows
    renderDrawer();
    await waitFor(() => expect(screen.getByText("Billing Engine")).toBeInTheDocument());
    // No bucket headers — two rows do not need structure.
    expect(screen.queryByText("Business Application")).not.toBeInTheDocument();
  });

  it("preserves the server's row order", async () => {
    // The backend sorts by subtype → lifecycle urgency → name; the client must
    // not re-sort and undo it.
    const ordered = {
      total: 3,
      via_total: 1,
      rows: [
        { id: "c1", name: "Zeta", type: "Application", subtype: null, lifecycle: { endOfLife: "2020-01-01" }, via: [{ id: "s1", name: "Sub", type: "BusinessCapability" }] },
        { id: "c2", name: "Alpha", type: "Application", subtype: null, lifecycle: { phaseOut: "2020-01-01" }, via: [{ id: "s1", name: "Sub", type: "BusinessCapability" }] },
        { id: "c3", name: "Beta", type: "Application", subtype: null, lifecycle: {}, via: [{ id: "s1", name: "Sub", type: "BusinessCapability" }] },
      ],
    };
    vi.mocked(api.get).mockResolvedValue(ordered);
    renderDrawer();
    await waitFor(() => expect(screen.getByText("Zeta")).toBeInTheDocument());

    // The Drawer renders through a portal, so query the document, not the
    // render container.
    // Row text starts with the card name, then icon ligatures and chips, so
    // assert on the prefix rather than trying to tokenise the whole row.
    const rowTexts = Array.from(
      document.body.querySelectorAll(".MuiListItemButton-root"),
    ).map((el) => el.textContent ?? "");
    expect(rowTexts).toHaveLength(3);
    expect(rowTexts[0].startsWith("Zeta")).toBe(true);
    expect(rowTexts[1].startsWith("Alpha")).toBe(true);
    expect(rowTexts[2].startsWith("Beta")).toBe(true);
  });

  it("offers no write affordances", async () => {
    vi.mocked(api.get).mockResolvedValue(payload);
    renderDrawer();
    await waitFor(() => expect(screen.getByText("Billing Engine")).toBeInTheDocument());

    // Read-only by design: the rows belong to the descendant that owns them.
    expect(screen.queryByRole("button", { name: /add/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove|unlink|delete/i })).not.toBeInTheDocument();
  });

  it("shows an empty state rather than an error when nothing rolls up", async () => {
    vi.mocked(api.get).mockResolvedValue({ rows: [], total: 0 });
    renderDrawer();
    await waitFor(() =>
      expect(screen.getByText(/No cards are linked through sub-items/i)).toBeInTheDocument(),
    );
  });

  it("surfaces a load failure without crashing", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("boom"));
    renderDrawer();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
