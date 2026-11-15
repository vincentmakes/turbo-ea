import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FiscalYearTimeTravel from "./FiscalYearTimeTravel";

const YEARS = [2022, 2023, 2024, 2025, 2026, 2027];

beforeEach(() => {
  // jsdom has no ResizeObserver; the slider measures its track with one.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

function setup(value: number, props: Partial<React.ComponentProps<typeof FiscalYearTimeTravel>> = {}) {
  const onChange = vi.fn();
  render(
    <FiscalYearTimeTravel
      years={YEARS}
      currentFy={2026}
      value={value}
      onChange={onChange}
      {...props}
    />,
  );
  return onChange;
}

describe("FiscalYearTimeTravel", () => {
  it("steps are exactly the given years in order", () => {
    setup(2022);
    // The mark labels only: the current step is also read out beside the slider.
    const marks = document.querySelectorAll(".MuiSlider-markLabel");
    expect(Array.from(marks, (el) => el.textContent)).toEqual(
      YEARS.map((y) => `FY${String(y).slice(2)}`),
    );
    expect(screen.getAllByRole("slider")).toHaveLength(1);
    const slider = screen.getByRole("slider");
    expect(slider).toHaveAttribute("aria-valuemin", "2022");
    expect(slider).toHaveAttribute("aria-valuemax", "2027");
  });

  it("announces the long name", () => {
    const { unmount } = render(
      <FiscalYearTimeTravel years={YEARS} currentFy={2026} value={2026} onChange={vi.fn()} />,
    );
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "FY26 - Current");
    unmount();
    render(
      <FiscalYearTimeTravel years={YEARS} currentFy={2026} value={2027} onChange={vi.fn()} />,
    );
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "FY27 - Forecast");
  });

  it("announces the served year when given", () => {
    setup(2027, { servedYear: 2026 });
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "FY26 - Current");
  });

  it("selecting a step calls onChange with the fiscal year", async () => {
    const onChange = setup(2024);
    const slider = screen.getByRole("slider");
    slider.focus();
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith(2025);
    onChange.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "Next fiscal year" }));
    expect(onChange).toHaveBeenCalledWith(2025);
    onChange.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "Previous fiscal year" }));
    expect(onChange).toHaveBeenCalledWith(2023);
  });

  it("the first year disables previous and the last disables next", () => {
    const { unmount } = render(
      <FiscalYearTimeTravel years={YEARS} currentFy={2026} value={2022} onChange={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Previous fiscal year" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next fiscal year" })).toBeEnabled();
    unmount();
    render(
      <FiscalYearTimeTravel years={YEARS} currentFy={2026} value={2027} onChange={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Next fiscal year" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous fiscal year" })).toBeEnabled();
  });

  it("names the slider", () => {
    setup(2026);
    expect(screen.getByRole("slider", { name: "Fiscal year" })).toBeInTheDocument();
  });

  it("renders nothing with fewer than two years", () => {
    const { container } = render(
      <FiscalYearTimeTravel years={[2026]} currentFy={2026} value={2026} onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
