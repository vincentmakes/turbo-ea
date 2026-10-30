/**
 * Tests for the descendant relation roll-up drawer (#863).
 *
 * The invariant worth guarding is that the drawer is *read-only* and lazy:
 * nothing is fetched until it opens, rows carry their `via` provenance, and
 * there is no add/unlink affordance anywhere in it.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
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
// Partial mock: rows are router links (#1335), so `Link` must stay real.
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, useNavigate: () => navigate };
});

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

/** Build a row; rows are returned pre-sorted by the server. */
function row(
  id: string,
  name: string,
  subtype: string | null,
  lifecycle: Record<string, string>,
  via = [{ id: "s1", name: "Card Payments", type: "BusinessCapability" }],
) {
  return { id, name, type: "Application", subtype, lifecycle, via };
}

/** No subtypes, no lifecycle — both grouping levels are skipped. */
const payload = {
  total: 2,
  via_total: 2,
  rows: [
    row("a1", "Billing Engine", null, {}),
    row("a2", "Payments Gateway", null, {}, [
      { id: "s1", name: "Card Payments", type: "BusinessCapability" },
      { id: "s2", name: "Direct Debit", type: "BusinessCapability" },
    ]),
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

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

/**
 * jsdom cannot follow a real link: a click the app leaves to the browser
 * (Ctrl / Cmd / Shift) would log "Not implemented: navigation". Stop the
 * default on `document`, after React's root listener has seen the click.
 */
function stopBrowserNavigation(e: Event) {
  e.preventDefault();
}

function renderDrawer(open = true, isSource = true, onClose: () => void = () => {}) {
  return render(
    <MemoryRouter initialEntries={["/cards/root-1"]}>
      <DescendantRelationsDrawer
        open={open}
        onClose={onClose}
        cardId="root-1"
        rt={rt}
        isSource={isSource}
      />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe("DescendantRelationsDrawer", () => {
  it("asks for the side it was opened from", async () => {
    // A self-referencing type rolls up per side; the drawer for the incoming
    // group must not show the outgoing peers.
    vi.mocked(api.get).mockResolvedValue(payload);
    renderDrawer(true, false);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(vi.mocked(api.get).mock.calls[0][0]).toContain("direction=incoming");
  });

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

  it("marks lifecycle with a labelled dot, and nothing when undated", async () => {
    const mixed = {
      total: 2,
      via_total: 1,
      rows: [
        row("m1", "Alpha", null, { active: "2020-01-01" }),
        row("m2", "Bravo", null, {}),
      ],
    };
    vi.mocked(api.get).mockResolvedValue(mixed);
    renderDrawer();
    await waitFor(() => expect(screen.getByText("Alpha")).toBeInTheDocument());
    // The phase name lives on the dot's accessible label / tooltip, not in a
    // chip — and the undated card gets no dot at all.
    expect(screen.getAllByLabelText("Active")).toHaveLength(1);
    expect(screen.queryByLabelText("Not Set")).not.toBeInTheDocument();
  });

  it("groups by subtype, with lifecycle shown per row as a dot", async () => {
    const many = {
      total: 4,
      via_total: 1,
      rows: [
        row("b1", "Alpha", "businessApplication", { endOfLife: "2020-01-01" }),
        row("b2", "Bravo", "businessApplication", { active: "2020-01-01" }),
        row("b3", "Charlie", "businessApplication", { active: "2020-01-01" }),
        row("m1", "Delta", "microservice", { active: "2020-01-01" }),
      ],
    };
    vi.mocked(api.get).mockResolvedValue(many);
    renderDrawer();

    await waitFor(() => expect(screen.getByText("Business Application")).toBeInTheDocument());
    expect(screen.getByText("Microservice")).toBeInTheDocument();
    // Lifecycle is a per-row dot, not a heading — no phase-grouping rows.
    expect(screen.getAllByLabelText("Active")).toHaveLength(3);
    expect(screen.getAllByLabelText("End of Life")).toHaveLength(1);
  });

  it("groups a uniform subtype too — one header beats N identical chips", async () => {
    // The old threshold refused to group here, which is exactly the case
    // where grouping pays most: 3 rows carrying the same chip.
    const uniform = {
      total: 3,
      via_total: 1,
      rows: [
        row("u1", "Alpha", "businessApplication", { active: "2020-01-01" }),
        row("u2", "Bravo", "businessApplication", { active: "2020-01-01" }),
        row("u3", "Charlie", "businessApplication", { active: "2020-01-01" }),
      ],
    };
    vi.mocked(api.get).mockResolvedValue(uniform);
    renderDrawer();
    await waitFor(() => expect(screen.getByText("Business Application")).toBeInTheDocument());
    // One heading for all three rows, rather than three identical chips.
    expect(screen.getAllByText("Business Application")).toHaveLength(1);
  });

  it("carries no subtype or lifecycle chips on the rows themselves", async () => {
    const uniform = {
      total: 2,
      via_total: 1,
      rows: [
        row("u1", "Alpha", "businessApplication", { active: "2020-01-01" }),
        row("u2", "Bravo", "businessApplication", { active: "2020-01-01" }),
      ],
    };
    vi.mocked(api.get).mockResolvedValue(uniform);
    renderDrawer();
    await waitFor(() => expect(screen.getByText("Alpha")).toBeInTheDocument());
    // The subtype is named once in the heading, never repeated per row, and
    // the phase is a dot rather than a chip with a visible label.
    expect(screen.getAllByText("Business Application")).toHaveLength(1);
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
  });

  it("skips the subtype heading when no row carries one", async () => {
    vi.mocked(api.get).mockResolvedValue(payload);
    renderDrawer();
    await waitFor(() => expect(screen.getByText("Billing Engine")).toBeInTheDocument());
    expect(screen.queryByText("Business Application")).not.toBeInTheDocument();
    expect(screen.queryByText("No subtype")).not.toBeInTheDocument();
  });

  it("preserves the server's row order", async () => {
    // The backend sorts by subtype → lifecycle urgency → name; the client must
    // not re-sort and undo it.
    const ordered = {
      total: 3,
      via_total: 1,
      rows: [
        row("c1", "Zeta", null, { endOfLife: "2020-01-01" }),
        row("c2", "Alpha", null, { phaseOut: "2020-01-01" }),
        row("c3", "Beta", null, {}),
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
      document.body.querySelectorAll("li.MuiListItem-root"),
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

  describe("opening a card (#1335)", () => {
    it("makes each row a link, closing the drawer on a plain click", async () => {
      vi.mocked(api.get).mockResolvedValue(payload);
      const onClose = vi.fn();
      renderDrawer(true, true, onClose);
      const row = (await screen.findByText("Billing Engine")).closest("a");
      expect(row).toHaveAttribute("href", "/cards/a1");

      await userEvent.click(screen.getByText("Billing Engine"));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("location")).toHaveTextContent("/cards/a1");
    });

    it("leaves the drawer open on a Ctrl-click — the card opens in a new tab", async () => {
      vi.mocked(api.get).mockResolvedValue(payload);
      const onClose = vi.fn();
      renderDrawer(true, true, onClose);
      const name = await screen.findByText("Billing Engine");
      document.addEventListener("click", stopBrowserNavigation);
      fireEvent.click(name, { ctrlKey: true });
      document.removeEventListener("click", stopBrowserNavigation);
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByTestId("location")).toHaveTextContent("/cards/root-1");
    });

    it("makes each via chip its own link, beside the row's — never inside it", async () => {
      vi.mocked(api.get).mockResolvedValue(payload);
      const onClose = vi.fn();
      renderDrawer(true, true, onClose);
      const chip = (await screen.findByText("Direct Debit")).closest("a");
      expect(chip).toHaveAttribute("href", "/cards/s2");
      // No link nests in another: the chip's anchor has no anchor above it.
      expect(chip?.parentElement?.closest("a")).toBeNull();
      expect(screen.getByText("Billing Engine").closest("a")?.querySelector("a")).toBeNull();

      await userEvent.click(screen.getByText("Direct Debit"));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(navigate).not.toHaveBeenCalled();
      expect(screen.getByTestId("location")).toHaveTextContent("/cards/s2");
    });

    it("leaves the drawer open when a via chip is Cmd-clicked — the card opens in a new tab", async () => {
      vi.mocked(api.get).mockResolvedValue(payload);
      const onClose = vi.fn();
      renderDrawer(true, true, onClose);
      const chip = await screen.findByText("Direct Debit");
      document.addEventListener("click", stopBrowserNavigation);
      fireEvent.click(chip, { metaKey: true });
      document.removeEventListener("click", stopBrowserNavigation);
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByTestId("location")).toHaveTextContent("/cards/root-1");
    });
  });

  it("surfaces a load failure without crashing", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("boom"));
    renderDrawer();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
