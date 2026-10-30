/**
 * Where the card page shows the open data-quality breakdown (#1334): docked
 * beside the page on a wide window, in a drawer from the right otherwise —
 * the same content and the same Close button either way.
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
import { DataQualityBreakdownHost } from "./DataQualityBreakdownHost";

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

function renderHost(docked: boolean, value = 74.6) {
  const order: string[] = [];
  const onJump = vi.fn(() => order.push("jump"));
  const onClose = vi.fn(() => order.push("close"));
  const view = render(
    <DataQualityBreakdownHost
      cardId="c1"
      cardType="Application"
      value={value}
      onJump={onJump}
      onClose={onClose}
      docked={docked}
    />,
  );
  const rerender = (next: number) =>
    view.rerender(
      <DataQualityBreakdownHost
        cardId="c1"
        cardType="Application"
        value={next}
        onJump={onJump}
        onClose={onClose}
        docked={docked}
      />,
    );
  return { onJump, onClose, order, rerender };
}

describe("DataQualityBreakdownHost", () => {
  describe("docked", () => {
    it("is the side panel, with no drawer", async () => {
      renderHost(true);
      const panel = screen.getByRole("complementary", { name: "75% data quality" });
      expect(panel).toHaveAttribute("data-testid", "data-quality-panel");
      expect(screen.queryByTestId("data-quality-drawer")).not.toBeInTheDocument();
      expect(screen.queryByRole("presentation")).not.toBeInTheDocument();
      await within(panel).findByText("To raise the score");
      expect(within(panel).getByTestId("data-quality-panel-close")).toBeInTheDocument();
    });

    it("stays open through a jump", async () => {
      const { onJump, onClose } = renderHost(true);
      const panel = screen.getByTestId("data-quality-panel");
      await userEvent.click(await within(panel).findByRole("button", { name: "Set lifecycle dates" }));
      expect(onJump).toHaveBeenCalledWith({
        tab: "card",
        anchor: "card-section-lifecycle",
        sectionAnchor: "card-section-lifecycle",
      });
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("in a drawer", () => {
    it("shows the same content in a right-hand drawer, fetched as it opens", async () => {
      renderHost(false);
      const drawer = screen.getByTestId("data-quality-drawer");
      expect(drawer).toHaveClass("MuiDrawer-root", "MuiModal-root");
      expect(drawer.querySelector(".MuiDrawer-paper")).toHaveClass("MuiDrawer-paperAnchorRight");
      expect(screen.queryByTestId("data-quality-panel")).not.toBeInTheDocument();
      const region = within(drawer).getByRole("region", { name: "75% data quality" });
      await within(region).findByText("To raise the score");
      expect(
        within(region)
          .getAllByRole("listitem")
          .map((li) => li.textContent),
      ).toEqual(["Fill Annual Cost+25%", "Set lifecycle dates+12.5%"]);
      expect(api.get).toHaveBeenCalledTimes(1);
      expect(vi.mocked(api.get).mock.calls[0][0]).toBe("/cards/c1/data-quality");
    });

    it("closes from its header's Close button", async () => {
      const { onClose, onJump } = renderHost(false);
      const close = screen.getByRole("button", { name: "Close" });
      expect(close).toHaveAttribute("data-testid", "data-quality-drawer-close");
      expect(close).toHaveTextContent(/^close$/);
      expect(screen.getByTestId("data-quality-breakdown-header")).toContainElement(close);
      await userEvent.click(close);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onJump).not.toHaveBeenCalled();
    });

    it("closes on Escape, as a drawer does", async () => {
      const { onClose } = renderHost(false);
      await userEvent.keyboard("{Escape}");
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("closes before a jump, so the page scrolls with nothing over it", async () => {
      const { onJump, onClose, order } = renderHost(false);
      const drawer = screen.getByTestId("data-quality-drawer");
      await userEvent.click(await within(drawer).findByRole("button", { name: "Fill Annual Cost" }));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onJump).toHaveBeenCalledTimes(1);
      expect(onJump).toHaveBeenCalledWith({
        tab: "card",
        anchor: "card-section-custom-details",
        sectionAnchor: "card-section-custom-details",
        fieldKey: "cost",
      });
      expect(order).toEqual(["close", "jump"]);
    });

    it("refetches once a save rescores the card", async () => {
      const { rerender } = renderHost(false);
      await screen.findByText("To raise the score");
      rerender(87.5);
      await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
      expect(screen.getByRole("region", { name: "88% data quality" })).toBeInTheDocument();
    });
  });
});
