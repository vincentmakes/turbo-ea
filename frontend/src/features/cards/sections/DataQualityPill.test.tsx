/**
 * The data-quality pill explains its score (#1334): the tooltip names the
 * three unmet slots that would raise it most (and, on a card held at 0% by
 * empty required fields, says so), and a click asks the page to open the full
 * breakdown. The breakdown itself is `DataQualityBreakdownContent`, tested on
 * its own.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

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
import type { ScoreGain } from "@/features/cards/gamification/scoreGain";
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

function renderPill(
  value = 37.5,
  props: {
    cardId?: string;
    cardType?: string;
    onOpenBreakdown?: () => void;
    breakdownOpen?: boolean;
  } = { cardId: "c1", cardType: "Application" },
) {
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
    renderPill(37.5, { cardId: "c1", cardType: "Application", onOpenBreakdown: vi.fn() });
    act(() => screen.getByTestId("data-quality-pill").focus());
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.get).mock.calls[0][0]).toBe(URL);
  });

  it("names the required fields that hold the score at 0 first, marked as required", async () => {
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
    // A real gain is green; a gating field's mark is not.
    expect(within(tip).getByText("+12.5%")).toHaveStyle({ color: "rgb(76, 175, 80)" });
    expect(within(tip).getAllByText("→ required")[0]).not.toHaveStyle({ color: "rgb(76, 175, 80)" });
  });

  it("shows only the headline when the breakdown fails to load", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("boom"));
    renderPill();
    const tip = await hoverPill();
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    expect(tip).toHaveTextContent(/^38% data quality$/);
  });

  describe("opening the full breakdown", () => {
    function renderOpening(breakdownOpen = false) {
      const onOpenBreakdown = vi.fn();
      const view = renderPill(37.5, {
        cardId: "c1",
        cardType: "Application",
        onOpenBreakdown,
        breakdownOpen,
      });
      return { onOpenBreakdown, view, pill: screen.getByTestId("data-quality-pill") };
    }

    it("is a button that says what it opens", () => {
      const { pill } = renderOpening();
      expect(pill).toHaveAttribute("role", "button");
      expect(pill).toHaveAttribute("tabindex", "0");
      expect(pill).toHaveAttribute("aria-label", "38% data quality — show what raises it");
      expect(pill).toHaveAttribute("aria-haspopup", "dialog");
      expect(pill).toHaveAttribute("aria-expanded", "false");
      expect(pill).toHaveStyle({ cursor: "pointer" });
    });

    it("asks the page to open it on click, and renders nothing of its own", async () => {
      const { pill, onOpenBreakdown } = renderOpening();
      await userEvent.click(pill);
      expect(onOpenBreakdown).toHaveBeenCalledTimes(1);
      expect(onOpenBreakdown).toHaveBeenCalledWith();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByText("To raise the score")).not.toBeInTheDocument();
    });

    it("opens it with Enter", () => {
      const { pill, onOpenBreakdown } = renderOpening();
      act(() => pill.focus());
      fireEvent.keyDown(pill, { key: "Enter" });
      expect(onOpenBreakdown).toHaveBeenCalledTimes(1);
    });

    it("opens it with Space as well, without scrolling the page", () => {
      const { pill, onOpenBreakdown } = renderOpening();
      act(() => pill.focus());
      const space = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
      act(() => {
        pill.dispatchEvent(space);
      });
      expect(space.defaultPrevented).toBe(true);
      expect(onOpenBreakdown).toHaveBeenCalledTimes(1);
      // Any other key does nothing.
      const other = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
      act(() => {
        pill.dispatchEvent(other);
      });
      expect(other.defaultPrevented).toBe(false);
      expect(onOpenBreakdown).toHaveBeenCalledTimes(1);
    });

    it("says whether it is open", () => {
      const { pill, view, onOpenBreakdown } = renderOpening();
      expect(pill).toHaveAttribute("aria-expanded", "false");
      view.rerender(
        <DataQualityPill
          value={37.5}
          cardId="c1"
          cardType="Application"
          onOpenBreakdown={onOpenBreakdown}
          breakdownOpen
        />,
      );
      expect(screen.getByTestId("data-quality-pill")).toHaveAttribute("aria-expanded", "true");
    });

    it("stands its tooltip down while the breakdown is open", async () => {
      renderOpening(true);
      await userEvent.hover(screen.getByText("38%"));
      await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });
  });

  describe("without onOpenBreakdown (the card preview)", () => {
    it("still explains itself on hover, but is no button and a click does nothing", async () => {
      renderPill();
      const pill = screen.getByTestId("data-quality-pill");
      expect(pill).not.toHaveAttribute("role");
      expect(pill).not.toHaveAttribute("tabindex");
      expect(pill).not.toHaveAttribute("aria-haspopup");
      expect(pill).not.toHaveAttribute("aria-expanded");
      expect(pill).not.toHaveStyle({ cursor: "pointer" });
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      const tip = await hoverPill();
      await waitFor(() => expect(tip).toHaveTextContent("Fill Annual Cost +25%"));
      fireEvent.click(pill);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByText("To raise the score")).not.toBeInTheDocument();
    });
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

  it("keeps the tooltip's rows as text", async () => {
    renderPill(37.5, { cardId: "c1", cardType: "Application", onOpenBreakdown: vi.fn() });
    const tooltip = await hoverPill();
    await within(tooltip).findByText(/Set lifecycle dates/);
    expect(within(tooltip).queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("DataQualityPill — gamified (animate)", () => {
  const ANCHOR = "card-section-description";
  const gain = (
    from: number,
    to: number,
    nonce = 1,
    originAnchor: string | null = null,
  ): ScoreGain => ({
    from,
    to,
    delta: Math.round((to - from) * 10) / 10,
    milestone: null,
    nonce,
    direction: to < from ? "loss" : "gain",
    originAnchor,
  });

  it("without animate stays the plain pill and ignores a gain", () => {
    render(<DataQualityPill value={44.2} gain={gain(37.5, 44.2)} />);
    expect(screen.getByText("44%")).toBeInTheDocument();
    expect(screen.queryByTestId("score-bar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("data-quality-pill-motion")).not.toBeInTheDocument();
    expect(screen.queryByTestId("score-gain-burst")).not.toBeInTheDocument();
  });

  it("with animate draws the fill as the shared ScoreBar, tinted like the plain fill", () => {
    render(<DataQualityPill value={62.4} animate />);
    expect(screen.getByText("62%")).toBeInTheDocument();
    const bar = screen.getByTestId("score-bar");
    expect(bar).toHaveStyle({ position: "absolute", opacity: "0.18" });
    expect(screen.getByTestId("score-bar-fill")).toHaveStyle({
      transform: "scaleX(0.62)",
      backgroundColor: "rgb(255, 152, 0)",
    });
    expect(screen.getByTestId("data-quality-pill-motion")).not.toHaveClass("dq-pop");
    expect(screen.queryByTestId("score-gain-burst")).not.toBeInTheDocument();
  });

  it("on a gain pops, plays the burst, and counts the figure up", async () => {
    const { rerender } = render(<DataQualityPill value={41.5} animate gain={null} />);
    rerender(<DataQualityPill value={48.2} animate gain={gain(41.5, 48.2, 1)} />);

    const root = screen.getByTestId("data-quality-pill-motion");
    expect(root).toHaveClass("dq-pop");
    expect(root).toHaveClass("dq-pop-alt");
    expect(screen.getByTestId("score-gain-float")).toHaveTextContent(/^\+6\.7%$/);
    expect(screen.getByRole("status")).toHaveTextContent(/^\+6\.7% data quality$/);
    expect(screen.getByTestId("score-bar-ghost")).toHaveStyle({ transform: "scaleX(0.48)" });
    // Same band: no glow.
    expect(screen.queryByTestId("data-quality-glow")).not.toBeInTheDocument();
    // The figure starts from the old score and counts up.
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(await screen.findByText("48%", {}, { timeout: 2000 })).toBeInTheDocument();
  });

  it("alternates the pop class so the next gain replays it", () => {
    const { rerender } = render(<DataQualityPill value={40} animate gain={null} />);
    rerender(<DataQualityPill value={50} animate gain={gain(40, 50, 2)} />);
    const root = screen.getByTestId("data-quality-pill-motion");
    expect(root).toHaveClass("dq-pop");
    expect(root).not.toHaveClass("dq-pop-alt");
  });

  it("pulses a ring in the new band's colour when the score changes band", () => {
    const { rerender } = render(<DataQualityPill value={75} animate gain={null} />);
    rerender(<DataQualityPill value={85} animate gain={gain(75, 85)} />);
    const glow = screen.getByTestId("data-quality-glow");
    expect(glow).toHaveClass("dq-glow");
    expect(glow).toHaveStyle({ borderColor: "rgb(76, 175, 80)", borderWidth: "2px" });
  });

  it("plays nothing for a drop", () => {
    const { rerender } = render(<DataQualityPill value={85} animate gain={null} />);
    rerender(<DataQualityPill value={60} animate gain={null} />);
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByTestId("data-quality-pill-motion")).not.toHaveClass("dq-pop");
    expect(screen.queryByTestId("score-gain-burst")).not.toBeInTheDocument();
    expect(screen.queryByTestId("data-quality-glow")).not.toBeInTheDocument();
  });

  it("hands its animated root to the page as the orb's landing target", () => {
    const onRootRef = vi.fn();
    render(<DataQualityPill value={50} animate onRootRef={onRootRef} />);
    expect(onRootRef).toHaveBeenCalledWith(screen.getByTestId("data-quality-pill-motion"));
  });

  describe("a gain flying in from the saved section", () => {
    it("previews the new level but holds the fill, count, pop and burst until impact", async () => {
      const { rerender } = render(<DataQualityPill value={41.5} animate gain={null} />);
      rerender(
        <DataQualityPill value={48.2} animate gain={gain(41.5, 48.2, 1, ANCHOR)} impactNonce={null} />,
      );
      expect(screen.getByTestId("score-bar-ghost")).toHaveStyle({ transform: "scaleX(0.48)" });
      const fill = screen.getByTestId("score-bar-fill");
      await new Promise((r) => setTimeout(r, 80));
      expect(getComputedStyle(fill).transform).toBe("scaleX(0.415)");
      expect(screen.getByText("42%")).toBeInTheDocument();
      const root = screen.getByTestId("data-quality-pill-motion");
      expect(root).not.toHaveClass("dq-pop");
      expect(root).not.toHaveClass("dq-impact");
      expect(screen.queryByTestId("score-gain-burst")).not.toBeInTheDocument();
      expect(screen.queryByTestId("data-quality-flash")).not.toBeInTheDocument();
      expect(screen.queryByTestId("data-quality-halo")).not.toBeInTheDocument();
      // The announcement does not wait for the orb.
      expect(screen.getByRole("status")).toHaveTextContent(/^\+6\.7% data quality$/);
    });

    it("waits for its own impact, not an earlier one", () => {
      const { rerender } = render(<DataQualityPill value={41.5} animate gain={null} />);
      rerender(
        <DataQualityPill value={48.2} animate gain={gain(41.5, 48.2, 5, ANCHOR)} impactNonce={4} />,
      );
      expect(screen.getByTestId("data-quality-pill-motion")).not.toHaveClass("dq-pop");
      expect(screen.queryByTestId("score-gain-burst")).not.toBeInTheDocument();
    });

    it("on impact pops, flashes, haloes, glows, shines, bursts and counts up", async () => {
      const g = gain(75, 85, 3, ANCHOR);
      const { rerender } = render(<DataQualityPill value={75} animate gain={null} />);
      rerender(<DataQualityPill value={85} animate gain={g} impactNonce={null} />);
      rerender(<DataQualityPill value={85} animate gain={g} impactNonce={3} />);

      const root = screen.getByTestId("data-quality-pill-motion");
      expect(root).toHaveClass("dq-pop");
      expect(root).toHaveClass("dq-pop-alt");
      expect(root).toHaveClass("dq-impact");
      const flash = screen.getByTestId("data-quality-flash");
      expect(flash).toHaveClass("dq-flash");
      expect(flash).toHaveStyle({ position: "absolute", opacity: "0", backgroundColor: "rgb(255, 255, 255)" });
      const halo = screen.getByTestId("data-quality-halo");
      expect(halo).toHaveClass("dq-halo");
      expect(halo).toHaveStyle({ borderColor: "rgb(76, 175, 80)", borderWidth: "2px", opacity: "0" });
      const glow = screen.getByTestId("data-quality-impact-glow");
      expect(glow).toHaveClass("dq-impact-glow");
      expect(getComputedStyle(glow).boxShadow).toMatch(
        /^0 0 18px 2px (#4caf50|rgb\(76, 175, 80\))$/,
      );
      expect(screen.getByTestId("data-quality-shine")).toHaveClass("dq-shine");
      // The halo replaces the band-change ring on an impact.
      expect(screen.queryByTestId("data-quality-glow")).not.toBeInTheDocument();
      expect(screen.getByTestId("score-gain-float")).toHaveTextContent(/^\+10%$/);

      const fill = screen.getByTestId("score-bar-fill");
      expect(fill).toHaveStyle({ transition: "transform 500ms cubic-bezier(0, 0, 0, 1) 0ms" });
      await waitFor(() => expect(fill).toHaveStyle({ transform: "scaleX(0.85)" }));
      expect(await screen.findByText("85%", {}, { timeout: 2000 })).toBeInTheDocument();
    });

    it("plays at once, statically, under reduced motion", () => {
      const original = window.matchMedia;
      onTestFinished(() => {
        window.matchMedia = original;
      });
      window.matchMedia = vi.fn().mockImplementation((q: string) => ({
        matches: q.includes("prefers-reduced-motion"),
        media: q,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      const { rerender } = render(<DataQualityPill value={41.5} animate gain={null} />);
      rerender(
        <DataQualityPill value={48.2} animate gain={gain(41.5, 48.2, 1, ANCHOR)} impactNonce={null} />,
      );
      expect(screen.getByText("48%")).toBeInTheDocument();
      expect(screen.getByTestId("score-gain-chip")).toHaveTextContent(/^\+6\.7%$/);
      expect(screen.queryByTestId("data-quality-flash")).not.toBeInTheDocument();
      expect(screen.getByTestId("data-quality-pill-motion")).not.toHaveClass("dq-pop");
    });
  });

  describe("a loss", () => {
    it("drains in red and counts down at once, dims the figure, and never pops or flashes", async () => {
      const { rerender } = render(<DataQualityPill value={48.2} animate gain={null} />);
      rerender(
        <DataQualityPill value={41.5} animate gain={gain(48.2, 41.5, 2, ANCHOR)} impactNonce={null} />,
      );
      expect(screen.getByTestId("score-bar-ghost")).toHaveStyle({
        backgroundColor: "rgb(244, 67, 54)",
      });
      const figure = screen.getByTestId("data-quality-figure");
      expect(figure).toHaveClass("dq-dim");
      expect(figure).toHaveTextContent(/^48%$/);
      const root = screen.getByTestId("data-quality-pill-motion");
      expect(root).not.toHaveClass("dq-pop");
      expect(root).not.toHaveClass("dq-impact");
      // The orb carries the "−6.7%" off to the section: nothing floats here.
      expect(screen.queryByTestId("score-gain-burst")).not.toBeInTheDocument();
      expect(screen.queryByTestId("data-quality-flash")).not.toBeInTheDocument();
      expect(screen.queryByTestId("data-quality-halo")).not.toBeInTheDocument();
      expect(screen.queryByTestId("data-quality-glow")).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(/^\u22126\.7% data quality$/);

      await waitFor(() =>
        expect(screen.getByTestId("score-bar-fill")).toHaveStyle({ transform: "scaleX(0.42)" }),
      );
      expect(await screen.findByText("42%", {}, { timeout: 2000 })).toBeInTheDocument();
    });

    it("an impact for a loss changes nothing", () => {
      const g = gain(85, 75, 2, ANCHOR);
      const { rerender } = render(<DataQualityPill value={85} animate gain={null} />);
      rerender(<DataQualityPill value={75} animate gain={g} impactNonce={2} />);
      expect(screen.getByTestId("data-quality-pill-motion")).not.toHaveClass("dq-pop");
      expect(screen.queryByTestId("data-quality-flash")).not.toBeInTheDocument();
      expect(screen.queryByTestId("data-quality-glow")).not.toBeInTheDocument();
      expect(screen.queryByTestId("score-gain-burst")).not.toBeInTheDocument();
    });

    it("floats a red minus over the pill when it has no section to fly to", () => {
      const { rerender } = render(<DataQualityPill value={48.2} animate gain={null} />);
      rerender(<DataQualityPill value={41.5} animate gain={gain(48.2, 41.5, 2)} />);
      const float = screen.getByTestId("score-gain-float");
      expect(float).toHaveTextContent(/^\u22126\.7%$/);
      expect(float).toHaveStyle({ color: "rgb(244, 67, 54)" });
      expect(screen.queryAllByTestId("score-gain-confetti")).toHaveLength(0);
    });
  });

  it("still opens the breakdown with animate on", async () => {
    const onOpenBreakdown = vi.fn();
    render(
      <DataQualityPill
        value={37.5}
        cardId="c1"
        cardType="Application"
        onOpenBreakdown={onOpenBreakdown}
        animate
      />,
    );
    await userEvent.click(screen.getByTestId("data-quality-pill"));
    expect(onOpenBreakdown).toHaveBeenCalledTimes(1);
  });
});
