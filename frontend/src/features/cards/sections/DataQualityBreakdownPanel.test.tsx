/**
 * The data-quality breakdown docked as a side panel (#1334): fetched as soon
 * as it opens and again after a rescore, fixed on the right under the app bar,
 * open through any number of jumps, closed only by its Close button.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
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
    relationTypes: [],
    loading: false,
    getType: (key: string) => TYPES.find((t) => t.key === key),
  }),
}));

import { api } from "@/api/client";
import type { CardType, DataQualityBreakdown } from "@/types";
import {
  DATA_QUALITY_PANEL_WIDTH,
  DATA_QUALITY_PANEL_Z_INDEX,
  DataQualityBreakdownPanel,
} from "./DataQualityBreakdownPanel";

const TYPES = [
  {
    key: "Application",
    label: "Application",
    fields_schema: [
      { section: "Details", fields: [{ key: "cost", label: "Annual Cost", type: "cost" }] },
    ],
  },
] as unknown as CardType[];

const BREAKDOWN: DataQualityBreakdown = {
  score: 75,
  ungated_score: 75,
  total_weight: 4,
  filled_weight: 3,
  blocked_by_required: [],
  factors: [
    { kind: "description", key: "description", weight: 1, filled: true, gain: null, score_if_filled: null },
    { kind: "lifecycle", key: "lifecycle", weight: 1, filled: false, gain: 12.5, score_if_filled: 87.5 },
    { kind: "field", key: "cost", weight: 1, filled: false, gain: 25, score_if_filled: 100, section: "Details" },
  ],
};

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.get).mockResolvedValue(BREAKDOWN);
});

function renderPanel(value = 74.6) {
  const onJump = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <DataQualityBreakdownPanel
      cardId="c1"
      cardType="Application"
      value={value}
      onJump={onJump}
      onClose={onClose}
    />,
  );
  const rerender = (next: number) =>
    view.rerender(
      <DataQualityBreakdownPanel
        cardId="c1"
        cardType="Application"
        value={next}
        onJump={onJump}
        onClose={onClose}
      />,
    );
  return { onJump, onClose, rerender, panel: screen.getByTestId("data-quality-panel") };
}

describe("DataQualityBreakdownPanel", () => {
  it("fetches the breakdown as soon as it docks, and lists it", async () => {
    const { panel } = renderPanel();
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.get).mock.calls[0][0]).toBe("/cards/c1/data-quality");
    await within(panel).findByText("To raise the score");
    expect(
      within(panel)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Fill Annual Cost+25%", "Set lifecycle dates+12.5%"]);
  });

  it("is a complementary region named after the rounded score", () => {
    const { panel } = renderPanel();
    expect(screen.getByRole("complementary", { name: "75% data quality" })).toBe(panel);
    expect(panel.tagName).toBe("ASIDE");
    expect(within(panel).getByTestId("data-quality-breakdown-header")).toHaveTextContent(
      /^75% data qualityclose$/,
    );
  });

  it("is fixed on the right, under the app bar, above the sticky bar", () => {
    const { panel } = renderPanel();
    expect(DATA_QUALITY_PANEL_WIDTH).toBe(320);
    expect(DATA_QUALITY_PANEL_Z_INDEX).toBe(1095);
    expect(panel).toHaveStyle({
      position: "fixed",
      top: "64px",
      right: "0px",
      bottom: "0px",
      width: "320px",
      zIndex: "1095",
      boxSizing: "border-box",
      overflowY: "auto",
      borderLeftWidth: "1px",
      borderLeftStyle: "solid",
    });
  });

  it("hands a jump to the page and stays open", async () => {
    const { panel, onJump, onClose } = renderPanel();
    await userEvent.click(await within(panel).findByRole("button", { name: "Fill Annual Cost" }));
    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump).toHaveBeenCalledWith({
      tab: "card",
      anchor: "card-section-custom-details",
      sectionAnchor: "card-section-custom-details",
      fieldKey: "cost",
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(within(panel).getByRole("button", { name: "Set lifecycle dates" })).toBeInTheDocument();
  });

  it("closes from its header", async () => {
    const { panel, onClose, onJump } = renderPanel();
    const close = within(panel).getByRole("button", { name: "Close" });
    expect(close).toHaveAttribute("data-testid", "data-quality-panel-close");
    expect(close).toHaveTextContent(/^close$/);
    expect(within(panel).getByTestId("data-quality-breakdown-header")).toContainElement(close);
    await userEvent.hover(close);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(/^Close$/);
    await userEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onJump).not.toHaveBeenCalled();
  });

  it("refetches once a save rescores the card", async () => {
    const { panel, rerender } = renderPanel(74.6);
    await within(panel).findByText("To raise the score");
    expect(api.get).toHaveBeenCalledTimes(1);
    rerender(74.6);
    expect(api.get).toHaveBeenCalledTimes(1);
    rerender(87.5);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.get).mock.calls[1][0]).toBe("/cards/c1/data-quality");
    expect(screen.getByRole("complementary", { name: "88% data quality" })).toBeInTheDocument();
  });
});
