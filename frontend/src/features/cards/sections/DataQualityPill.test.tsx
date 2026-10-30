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

/** The fixture card sits at 37.5%, so a slot's target score is that plus its gain. */
const BASE_SCORE = 37.5;

function factor(
  kind: DataQualityFactor["kind"],
  key: string,
  filled: boolean,
  gain: number | null,
  extra: Partial<DataQualityFactor> = {},
): DataQualityFactor {
  const score_if_filled = gain === null ? null : Math.round((BASE_SCORE + gain) * 10) / 10;
  return { kind, key, weight: 1, filled, gain, score_if_filled, ...extra };
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
    factor("field", "cost", false, 25, { section: "Details", weight: 2 }),
    factor("description", "description", true, null),
    factor("lifecycle", "lifecycle", false, 12.5),
    factor("relation", "relOrgToApp", false, 12.5, {
      side: "target",
      other_type_key: "Organization",
      label: "is owned by",
    }),
    factor("tag_group", "g-1", false, 12.5, { name: "Criticality" }),
    factor("stakeholders", "stakeholders", false, 12.5),
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
      "Fill Annual Cost +25%",
      "Set lifecycle dates +12.5%",
      // A target-side relation reads with its reverse verb.
      "Add relation: is owned by Organization +12.5%",
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
    await waitFor(() => expect(tip).toHaveTextContent("Set lifecycle dates +12.5%"));
    expect(tip).not.toHaveTextContent("more");
  });

  it("names exactly three unmet slots in gain order, with no 'more' line", async () => {
    vi.mocked(api.get).mockResolvedValue({
      ...BREAKDOWN,
      // Served smallest gain first, and one tag group without a name.
      factors: [
        factor("tag_group", "g-9", false, 5, { name: null }),
        factor("lifecycle", "lifecycle", false, 12.5),
        factor("field", "cost", false, 25, { section: "Details", weight: 2 }),
      ],
    });
    renderPill();
    const tip = await hoverPill();
    await waitFor(() => expect(tip).toHaveTextContent("Tag with +5%"));
    // Each gain is its own span, so it can be coloured apart from the action text.
    expect(within(tip).getByText("+25%").tagName).toBe("SPAN");
    expect(tip).toHaveTextContent(
      "38% data qualityFill Annual Cost +25%Set lifecycle dates +12.5%Tag with +5%",
    );
    expect(tip).not.toHaveTextContent("more");
  });

  it("fetches on keyboard focus too", async () => {
    renderPill();
    act(() => screen.getByTestId("data-quality-pill").focus());
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.get).mock.calls[0][0]).toBe(URL);
  });

  it("opens on Space as well, without scrolling the page", async () => {
    renderPill();
    const pill = screen.getByTestId("data-quality-pill");
    act(() => pill.focus());
    const space = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    act(() => {
      pill.dispatchEvent(space);
    });
    expect(space.defaultPrevented).toBe(true);
    expect(await screen.findByText("To raise the score")).toBeInTheDocument();
    // Any other key leaves it closed.
    const { unmount } = renderPill();
    const other = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
    act(() => {
      screen.getAllByTestId("data-quality-pill")[1].dispatchEvent(other);
    });
    expect(other.defaultPrevented).toBe(false);
    unmount();
  });

  it("names a counted tag group by nothing rather than by its id when it has no name", async () => {
    vi.mocked(api.get).mockResolvedValue({
      ...BREAKDOWN,
      score: 100,
      factors: [
        factor("tag_group", "g-1", true, null, { name: "Criticality" }),
        factor("tag_group", "g-77", true, null, { name: null }),
      ],
    });
    renderPill(100);
    await userEvent.click(screen.getByTestId("data-quality-pill"));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      await within(dialog).findByRole("button", { name: /Already counted \(2\)/ }),
    );
    const names = within(dialog)
      .getAllByRole("listitem")
      .map((li) => li.querySelector("p")?.textContent);
    expect(names).toEqual(["Criticality", ""]);
    expect(dialog).not.toHaveTextContent("g-77");
  });

  it("tells assistive tech about the popover", async () => {
    renderPill();
    const pill = screen.getByTestId("data-quality-pill");
    expect(pill).toHaveAttribute("aria-haspopup", "dialog");
    expect(pill).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(pill);
    await screen.findByRole("dialog");
    expect(pill).toHaveAttribute("aria-expanded", "true");
  });

  it("names every kind of counted slot, and a field the metamodel forgot", async () => {
    vi.mocked(api.get).mockResolvedValue({
      ...BREAKDOWN,
      score: 100,
      factors: [
        factor("field", "team", true, null, { section: "Details" }),
        factor("field", "ghost", true, null),
        factor("description", "description", true, null),
        factor("lifecycle", "lifecycle", true, null),
        factor("relation", "relOrgToApp", true, null, {
          side: "source",
          other_type_key: "Application",
          label: "owns",
        }),
        factor("relation", "ghostRel", true, null, { side: "source" }),
        factor("tag_group", "g-1", true, null, { name: "Criticality" }),
        factor("stakeholders", "stakeholders", true, null),
      ],
    });
    renderPill(100);
    await userEvent.click(screen.getByTestId("data-quality-pill"));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      await within(dialog).findByRole("button", { name: /Already counted \(8\)/ }),
    );
    const names = within(dialog)
      .getAllByRole("listitem")
      .map((li) => li.querySelector("p")?.textContent);
    expect(names).toEqual([
      "Team",
      "A field",
      "Description",
      "Lifecycle dates",
      "owns Application",
      "A required relation",
      "Criticality",
      "A stakeholder assigned",
    ]);
    expect(dialog).not.toHaveTextContent("ghost");
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
      "Fill Annual Cost+25%",
      "Set lifecycle dates+12.5%",
      "Add relation: is owned by Organization+12.5%",
      "Tag with Criticality+12.5%",
      "Assign a stakeholder+12.5%",
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
      factors: [...BREAKDOWN.factors, factor("field", "code", false, 8.3, { section: "Details" })],
    });
    renderPill(0);
    const tip = await hoverPill();
    await waitFor(() =>
      expect(tip).toHaveTextContent("Held at 0% until the required fields are filled"),
    );
    // The gating fields lead, marked as required rather than with a figure
    // that filling them alone cannot reach.
    expect(tip).toHaveTextContent(
      "Fill Annual Cost → requiredFill Business Code → requiredSet lifecycle dates +12.5%+3 more",
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
      "Set lifecycle dates+12.5%",
    ]);
    // A gain is green; a gating field's "required" chip is not.
    expect(within(dialog).getAllByText("+12.5%")[0].closest(".MuiChip-root")).toHaveClass(
      "MuiChip-colorSuccess",
    );
    const required = within(dialog).getAllByText("→ required")[0].closest(".MuiChip-root");
    expect(required).not.toHaveClass("MuiChip-colorSuccess");
    expect(required).toHaveClass("MuiChip-colorDefault");
  });

  it("tells a self-referencing relation's two mandatory ends apart", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(api.get).mockResolvedValue({
      ...BREAKDOWN,
      factors: [
        factor("relation", "relOrgToApp", false, 12.5, {
          side: "source",
          other_type_key: "Application",
          label: "owns",
        }),
        factor("relation", "relOrgToApp", false, 12.5, {
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
      factors: [factor("field", "ghostField", false, 42.5), factor("relation", "ghostRel", false, 32.5)],
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
