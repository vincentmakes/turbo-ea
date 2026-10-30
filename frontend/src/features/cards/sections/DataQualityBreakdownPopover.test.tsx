/**
 * The breakdown popover both the data-quality pill and the sticky score bar
 * open (#1334): the required-field warning, every unmet slot with its gain and
 * jump link, and the slots that already count.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    types: TYPES,
    relationTypes: [],
    loading: false,
    getType: (key: string) => TYPES.find((t) => t.key === key),
  }),
}));

import type { CardType, DataQualityBreakdown, DataQualityFactor } from "@/types";
import { DataQualityBreakdownPopover } from "./DataQualityBreakdownPopover";
import { rankUnmet } from "./dataQualityFactors";
import type { DataQualityBreakdownState } from "./useDataQualityBreakdown";

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
] as unknown as CardType[];

function factor(
  kind: DataQualityFactor["kind"],
  key: string,
  filled: boolean,
  gain: number | null,
  extra: Partial<DataQualityFactor> = {},
): DataQualityFactor {
  return { kind, key, weight: 1, filled, gain, score_if_filled: null, ...extra };
}

const FACTORS = [
  factor("field", "team", true, null),
  factor("lifecycle", "lifecycle", false, 12.5),
  factor("field", "cost", false, 25),
  factor("description", "description", true, null),
  factor("stakeholders", "stakeholders", false, 10),
];

function state(over: Partial<DataQualityBreakdown> = {}, rest: Partial<DataQualityBreakdownState> = {}) {
  const data: DataQualityBreakdown = {
    score: 40,
    ungated_score: 40,
    total_weight: 5,
    filled_weight: 2,
    blocked_by_required: [],
    factors: FACTORS,
    ...over,
  };
  const blocked = data.blocked_by_required;
  return {
    data,
    loading: false,
    error: null,
    blocked,
    unmet: rankUnmet(data.factors, blocked),
    met: data.factors.filter((f) => f.filled),
    ...rest,
  } satisfies DataQualityBreakdownState;
}

function renderPopover(
  props: Partial<Parameters<typeof DataQualityBreakdownPopover>[0]> = {},
) {
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  const onClose = vi.fn();
  render(
    <DataQualityBreakdownPopover
      anchorEl={anchor}
      onClose={onClose}
      value={40}
      cardType="Application"
      breakdown={state()}
      {...props}
    />,
  );
  return { onClose, dialog: screen.getByRole("dialog") };
}

describe("DataQualityBreakdownPopover", () => {
  it("renders nothing without an anchor", () => {
    render(
      <DataQualityBreakdownPopover anchorEl={null} onClose={vi.fn()} value={40} breakdown={state()} />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("heads with the score and lists every unmet slot by gain, each with its gain chip", () => {
    const { dialog } = renderPopover();
    expect(dialog).toHaveAttribute("aria-label", "40% data quality");
    expect(within(dialog).getByText("40% data quality")).toBeInTheDocument();
    expect(within(dialog).getByText("To raise the score")).toBeInTheDocument();
    const rows = within(dialog)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(rows).toEqual([
      "Fill Annual Cost+25%",
      "Set lifecycle dates+12.5%",
      "Assign a stakeholder+10%",
    ]);
    expect(within(dialog).getByText("+25%").closest(".MuiChip-root")).toHaveClass(
      "MuiChip-colorSuccess",
      "MuiChip-outlined",
    );
    // Without onJump the rows are text: the counted toggle is the only button.
    expect(within(dialog).getAllByRole("button")).toHaveLength(1);
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  // jsdom lays nothing out: give the anchor a box, so the edge it lines up
  // with shows in the paper's position.
  function anchoredAt(left: number, width: number) {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    anchor.getBoundingClientRect = () =>
      ({ left, width, top: 100, height: 20, right: left + width, bottom: 120 }) as DOMRect;
    return anchor;
  }

  it("opens under the anchor's left edge by default", () => {
    renderPopover({ anchorEl: anchoredAt(200, 100) });
    expect(document.querySelector(".MuiPopover-paper")).toHaveStyle({ left: "200px", top: "120px" });
  });

  it("lines up with the anchor's right edge when asked", () => {
    renderPopover({ anchorEl: anchoredAt(200, 100), align: "right" });
    expect(document.querySelector(".MuiPopover-paper")).toHaveStyle({ left: "300px", top: "120px" });
  });

  it("shows the slots that already count behind a toggle", async () => {
    const { dialog } = renderPopover();
    const toggle = within(dialog).getByRole("button", { name: /^Already counted \(2\)/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(dialog).queryByText("Team")).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(within(dialog).getByText("Team")).toBeInTheDocument();
    expect(within(dialog).getByText("Description")).toBeInTheDocument();
  });

  it("closes, then jumps to where the slot is filled", async () => {
    const order: string[] = [];
    const onJump = vi.fn(() => order.push("jump"));
    const onClose = vi.fn(() => order.push("close"));
    renderPopover({ onJump, onClose });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByRole("button")).toHaveLength(4);
    await userEvent.click(within(dialog).getByRole("button", { name: "Set lifecycle dates" }));
    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump).toHaveBeenCalledWith({
      tab: "card",
      anchor: "card-section-lifecycle",
      sectionAnchor: "card-section-lifecycle",
    });
    expect(order).toEqual(["close", "jump"]);
  });

  it("names the required fields holding the score at 0, with the ungated score", () => {
    const { dialog } = renderPopover({
      value: 0,
      breakdown: state({ score: 0, ungated_score: 33.3, blocked_by_required: ["code", "cost"] }),
    });
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      /^The score stays at 0% until these required fields are filled: Business Code, Annual Cost Without them it would be 33\.3%\.$/,
    );
    // The gating field leads, with a neutral "required" chip instead of a gain.
    const first = within(dialog).getAllByRole("listitem")[0];
    expect(first).toHaveTextContent(/^Fill Annual Cost→ required$/);
    const chip = within(first).getByText("→ required").closest(".MuiChip-root");
    expect(chip).toHaveClass("MuiChip-colorDefault");
    expect(chip).not.toHaveClass("MuiChip-colorSuccess");
  });

  it("says so when every slot already counts", () => {
    const { dialog } = renderPopover({
      breakdown: state({ factors: FACTORS.filter((f) => f.filled) }),
    });
    expect(within(dialog).getByText("Every slot counts — nothing left to fill.")).toBeInTheDocument();
    expect(within(dialog).queryByText("To raise the score")).not.toBeInTheDocument();
  });

  it("hides the counted toggle when nothing counts yet", () => {
    const { dialog } = renderPopover({
      breakdown: state({ factors: FACTORS.filter((f) => !f.filled) }),
    });
    expect(within(dialog).queryByRole("button", { name: /Already counted/ })).not.toBeInTheDocument();
  });

  it("spins while the breakdown loads", () => {
    const empty = { data: undefined, blocked: [], unmet: [], met: [] };
    const { dialog } = renderPopover({
      breakdown: { ...empty, loading: true, error: null },
    });
    expect(within(dialog).getByRole("progressbar")).toBeInTheDocument();
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports a breakdown that failed to load", () => {
    const { dialog } = renderPopover({
      breakdown: { data: undefined, blocked: [], unmet: [], met: [], loading: false, error: new Error("x") },
    });
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      /^The breakdown could not be loaded\.$/,
    );
    expect(within(dialog).queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("hides the spinner and the error once a breakdown is there", () => {
    const { dialog } = renderPopover({
      breakdown: state({}, { loading: true, error: new Error("x") }),
    });
    expect(within(dialog).queryByRole("progressbar")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("The breakdown could not be loaded.")).not.toBeInTheDocument();
  });
});
