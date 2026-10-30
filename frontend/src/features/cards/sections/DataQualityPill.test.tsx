/**
 * The data-quality pill explains its score (#1334): the tooltip names the
 * three unmet slots that would raise it most, a click opens every slot, and a
 * card held at 0% by empty required fields says which ones.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class extends Error {},
  isAbortError: () => false,
}));

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    types: TYPES,
    relationTypes: RELATION_TYPES,
    loading: false,
    getType: (key: string) => TYPES.find((t) => t.key === key),
  }),
}));

import { api } from "@/api/client";
import type { CardType, DataQualityBreakdown, DataQualityFactor, RelationType } from "@/types";
import { DataQualityPill } from "./DataQualityPill";

const TYPES = [
  {
    key: "Application",
    label: "Application",
    fields_schema: [
      {
        section: "Details",
        fields: [
          { key: "team", label: "Team", type: "text" },
          { key: "cost", label: "Annual Cost", type: "cost" },
          { key: "code", label: "Business Code", type: "text", required: true },
        ],
      },
    ],
  },
  { key: "Organization", label: "Organization", fields_schema: [] },
] as unknown as CardType[];

const RELATION_TYPES = [
  {
    key: "relOrgToApp",
    label: "owns",
    reverse_label: "is owned by",
    source_type_key: "Organization",
    target_type_key: "Application",
  },
] as unknown as RelationType[];

function factor(
  kind: DataQualityFactor["kind"],
  key: string,
  filled: boolean,
  score_if_filled: number | null,
  extra: Partial<DataQualityFactor> = {},
): DataQualityFactor {
  return { kind, key, weight: 1, filled, score_if_filled, ...extra };
}

/** Five unmet slots (one clear winner, then ties in server order), two met. */
const BREAKDOWN: DataQualityBreakdown = {
  score: 37.5,
  ungated_score: 37.5,
  total_weight: 8,
  filled_weight: 3,
  blocked_by_required: [],
  factors: [
    factor("field", "team", true, null, { section: "Details" }),
    factor("field", "cost", false, 62.5, { section: "Details", weight: 2 }),
    factor("description", "description", true, null),
    factor("lifecycle", "lifecycle", false, 50),
    factor("relation", "relOrgToApp", false, 50, {
      side: "target",
      other_type_key: "Organization",
      label: "is owned by",
    }),
    factor("tag_group", "g-1", false, 50, { name: "Criticality" }),
    factor("stakeholders", "stakeholders", false, 50),
  ],
};

const URL = "/cards/c1/data-quality";

function renderPill(value = 37.5, props: { cardId?: string; cardType?: string } = { cardId: "c1", cardType: "Application" }) {
  return render(<DataQualityPill value={value} {...props} />);
}

async function hoverPill() {
  await userEvent.hover(screen.getByText(/^\d+%$/));
  return screen.findByRole("tooltip");
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.get).mockResolvedValue(BREAKDOWN);
});

describe("DataQualityPill", () => {
  it("without a card id is the plain pill: the score and nothing to fetch", async () => {
    renderPill(62.4, {});
    expect(screen.getByText("62%")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    const tip = await hoverPill();
    expect(tip).toHaveTextContent(/^62% data quality$/);
    fireEvent.click(screen.getByText("62%"));
    expect(screen.queryByText("To raise the score")).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("fetches nothing until the pill is hovered, focused or clicked", () => {
    renderPill();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("on hover names the three biggest gains with the score each reaches, then how many more", async () => {
    renderPill();
    const tip = await hoverPill();
    expect(api.get).toHaveBeenCalledWith(URL, expect.anything());
    await waitFor(() => expect(within(tip).getByText(/Annual Cost/)).toBeInTheDocument());
    const lines = Array.from(tip.querySelectorAll(".MuiTypography-root")).map((el) => el.textContent);
    expect(lines).toEqual([
      "38% data quality",
      "Fill Annual Cost → 62.5%",
      "Set lifecycle dates → 50%",
      // A target-side relation reads with its reverse verb.
      "Add relation: is owned by Organization → 50%",
      "+2 more · click for details",
    ]);
    // Already-counted slots are not suggestions.
    expect(tip).not.toHaveTextContent("Team");
  });

  it("fetches once however often it is hovered", async () => {
    renderPill();
    await hoverPill();
    await userEvent.unhover(screen.getByText("38%"));
    await hoverPill();
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
  });

  it("says nothing more when three or fewer slots are unmet", async () => {
    vi.mocked(api.get).mockResolvedValue({
      ...BREAKDOWN,
      factors: BREAKDOWN.factors.slice(0, 4),
    });
    renderPill();
    const tip = await hoverPill();
    await waitFor(() => expect(tip).toHaveTextContent("Set lifecycle dates → 50%"));
    expect(tip).not.toHaveTextContent("more");
  });

  it("on click lists every unmet slot by gain, then the slots that already count", async () => {
    renderPill();
    await userEvent.click(screen.getByTestId("data-quality-pill"));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("To raise the score");
    const rows = within(dialog)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(rows).toEqual([
      "Fill Annual Cost→ 62.5%",
      "Set lifecycle dates→ 50%",
      "Add relation: is owned by Organization→ 50%",
      "Tag with Criticality→ 50%",
      "Assign a stakeholder→ 50%",
    ]);
    // Counted slots sit behind a toggle, by name.
    expect(within(dialog).queryByText("Team")).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: /Already counted \(2\)/ }));
    expect(within(dialog).getByText("Team")).toBeInTheDocument();
    expect(within(dialog).getByText("Description")).toBeInTheDocument();
    // No warning on an ungated card.
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("opens from the keyboard too", async () => {
    renderPill();
    const pill = screen.getByTestId("data-quality-pill");
    expect(pill).toHaveAttribute("role", "button");
    expect(pill).toHaveAttribute("aria-label", "38% data quality — show what raises it");
    act(() => pill.focus());
    fireEvent.keyDown(pill, { key: "Enter" });
    expect(await screen.findByText("To raise the score")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("names the required fields that hold the score at 0, and what it would be without them", async () => {
    vi.mocked(api.get).mockResolvedValue({
      ...BREAKDOWN,
      score: 0,
      ungated_score: 33.3,
      blocked_by_required: ["code", "cost"],
      // `code` weighs less than the optional lifecycle slot: by gain alone it
      // would sink below the slots that cannot move the score yet.
      factors: [...BREAKDOWN.factors, factor("field", "code", false, 45.8, { section: "Details" })],
    });
    renderPill(0);
    const tip = await hoverPill();
    await waitFor(() =>
      expect(tip).toHaveTextContent("Held at 0% until the required fields are filled"),
    );
    // The gating fields lead, marked as required rather than with a figure
    // that filling them alone cannot reach.
    expect(tip).toHaveTextContent(
      "Fill Annual Cost → requiredFill Business Code → requiredSet lifecycle dates → 50%+3 more",
    );
    await userEvent.unhover(screen.getByText("0%"));
    await userEvent.click(screen.getByTestId("data-quality-pill"));
    const dialog = await screen.findByRole("dialog");
    const alert = within(dialog).getByRole("alert");
    expect(alert).toHaveTextContent(
      "The score stays at 0% until these required fields are filled: Business Code, Annual Cost Without them it would be 33.3%.",
    );
    const rows = within(dialog)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(rows.slice(0, 3)).toEqual([
      "Fill Annual Cost→ required",
      "Fill Business Code→ required",
      "Set lifecycle dates→ 50%",
    ]);
  });

  it("tells a self-referencing relation's two mandatory ends apart", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(api.get).mockResolvedValue({
      ...BREAKDOWN,
      factors: [
        factor("relation", "relOrgToApp", false, 50, {
          side: "source",
          other_type_key: "Application",
          label: "owns",
        }),
        factor("relation", "relOrgToApp", false, 50, {
          side: "target",
          other_type_key: "Organization",
          label: "is owned by",
        }),
      ],
    });
    renderPill();
    await userEvent.click(screen.getByTestId("data-quality-pill"));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Add relation: owns Application");
    expect(within(dialog).getByText("Add relation: is owned by Organization")).toBeInTheDocument();
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/same key/);
    consoleError.mockRestore();
  });

  it("never shows a field's key when the metamodel does not know the field", async () => {
    vi.mocked(api.get).mockResolvedValue({
      ...BREAKDOWN,
      factors: [factor("field", "ghostField", false, 80), factor("relation", "ghostRel", false, 70)],
      blocked_by_required: ["ghostField"],
    });
    renderPill();
    await userEvent.click(screen.getByTestId("data-quality-pill"));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Fill a field");
    expect(within(dialog).getByText("Add a required relation")).toBeInTheDocument();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("filled: A field");
    expect(dialog).not.toHaveTextContent("ghost");
  });

  it("says so when every slot already counts", async () => {
    vi.mocked(api.get).mockResolvedValue({
      ...BREAKDOWN,
      score: 100,
      factors: BREAKDOWN.factors.filter((f) => f.filled),
    });
    renderPill(100);
    await userEvent.click(screen.getByTestId("data-quality-pill"));
    expect(await screen.findByText("Every slot counts — nothing left to fill.")).toBeInTheDocument();
  });

  it("refetches on the next hover once the score has moved", async () => {
    const { rerender } = renderPill();
    await hoverPill();
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    await userEvent.unhover(screen.getByText("38%"));

    rerender(<DataQualityPill value={70} cardId="c1" cardType="Application" />);
    // Nothing is fetched until someone looks again …
    expect(api.get).toHaveBeenCalledTimes(1);
    await hoverPill();
    // … and then the fresh breakdown is.
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it("reports a breakdown that fails to load", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("boom"));
    renderPill();
    await userEvent.click(screen.getByTestId("data-quality-pill"));
    expect(await screen.findByText("The breakdown could not be loaded.")).toBeInTheDocument();
  });
});
