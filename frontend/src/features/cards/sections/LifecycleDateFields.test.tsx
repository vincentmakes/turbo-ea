import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import LifecycleDateFields from "./LifecycleDateFields";

const lifecycle = {
  plan: "2020-01-01",
  active: "2022-01-01",
  phaseOut: "2029-01-01",
  endOfLife: "2030-01-01",
};

describe("LifecycleDateFields — locked phases", () => {
  it("renders every field editable and unbounded without lockedPhases", () => {
    const { container } = render(
      <LifecycleDateFields lifecycle={lifecycle} onChange={() => {}} />,
    );
    const inputs = container.querySelectorAll("input");
    expect(inputs).toHaveLength(5);
    inputs.forEach((input) => {
      expect(input).not.toBeDisabled();
      expect(input).not.toHaveAttribute("min");
      expect(input).not.toHaveAttribute("max");
    });
    expect(screen.queryByTestId("lifecycle-maintained-chip")).toBeNull();
  });

  it("disables a locked phase, chips it and never reports a change to it", () => {
    const onChange = vi.fn();
    const { container } = render(
      <LifecycleDateFields
        lifecycle={lifecycle}
        onChange={onChange}
        lockedPhases={["endOfLife"]}
        lockedBy="Acme Sync"
      />,
    );
    const eol = container.querySelector('[data-phase="endOfLife"] input') as HTMLInputElement;
    expect(eol).toBeDisabled();
    const chip = screen.getByTestId("lifecycle-maintained-chip");
    expect(chip.dataset.maintainedPhase).toBe("endOfLife");
    expect(chip).toHaveTextContent(i18n.t("cards:lifecycle.maintained.chip"));

    const phaseOut = container.querySelector('[data-phase="phaseOut"] input') as HTMLInputElement;
    expect(phaseOut).toHaveAttribute("max", "2030-01-01");
    fireEvent.focus(phaseOut);
    fireEvent.change(phaseOut, { target: { value: "2029-06-01" } });
    fireEvent.blur(phaseOut);
    expect(onChange).toHaveBeenCalledWith({ ...lifecycle, phaseOut: "2029-06-01" });
  });

  it("prefers the order warning over the bound hint", () => {
    const outOfOrder = { ...lifecycle, phaseOut: "2031-01-01" };
    const { container } = render(
      <LifecycleDateFields
        lifecycle={outOfOrder}
        onChange={() => {}}
        lockedPhases={["endOfLife"]}
        lockedBy="Acme Sync"
      />,
    );
    const hint = i18n.t("cards:lifecycle.maintained.boundHint");
    const box = (phase: string) => container.querySelector(`[data-phase="${phase}"]`) as HTMLElement;
    expect(within(box("phaseOut")).queryByText(hint)).toBeNull();
    expect(within(box("active")).getByText(hint)).toBeInTheDocument();
  });
});
