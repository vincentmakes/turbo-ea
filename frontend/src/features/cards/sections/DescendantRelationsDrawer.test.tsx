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
        ? { key: "Application", label: "Application", color: "#0f7eb5", subtypes: [] }
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
  rows: [
    { id: "a1", name: "Billing Engine", type: "Application", subtype: null, via: [{ id: "s1", name: "Card Payments", type: "BusinessCapability" }] },
    {
      id: "a2",
      name: "Payments Gateway",
      type: "Application",
      subtype: null,
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
