import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import LifecycleBadge, { getCurrentPhase } from "./LifecycleBadge";

// ---------------------------------------------------------------------------
// getCurrentPhase — pure logic tests
// ---------------------------------------------------------------------------

describe("getCurrentPhase", () => {
  // Fix "today" to 2025-06-15 for deterministic tests
  const TODAY = "2025-06-15";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null for undefined lifecycle", () => {
    expect(getCurrentPhase(undefined)).toBeNull();
  });

  it("returns null for empty lifecycle", () => {
    expect(getCurrentPhase({})).toBeNull();
  });

  it("returns 'active' when active date is in the past", () => {
    expect(getCurrentPhase({ active: "2024-01-01" })).toBe("active");
  });

  it("returns 'plan' when only plan date is set and in the past", () => {
    expect(getCurrentPhase({ plan: "2025-01-01" })).toBe("plan");
  });

  it("returns 'plan' when plan date is in the future", () => {
    expect(getCurrentPhase({ plan: "2026-01-01" })).toBe("plan");
  });

  it("returns 'endOfLife' when endOfLife date is in the past", () => {
    expect(
      getCurrentPhase({
        plan: "2020-01-01",
        active: "2021-01-01",
        endOfLife: "2025-01-01",
      })
    ).toBe("endOfLife");
  });

  it("returns 'phaseOut' when phaseOut is past but endOfLife is future", () => {
    expect(
      getCurrentPhase({
        active: "2023-01-01",
        phaseOut: "2025-06-01",
        endOfLife: "2026-01-01",
      })
    ).toBe("phaseOut");
  });

  it("returns 'phaseIn' when phaseIn is past but active is future", () => {
    expect(
      getCurrentPhase({
        plan: "2024-01-01",
        phaseIn: "2025-06-01",
        active: "2025-12-01",
      })
    ).toBe("phaseIn");
  });

  it("returns most advanced past phase (priority order)", () => {
    // All dates in the past — endOfLife has highest priority
    expect(
      getCurrentPhase({
        plan: "2020-01-01",
        phaseIn: "2021-01-01",
        active: "2022-01-01",
        phaseOut: "2023-01-01",
        endOfLife: "2024-01-01",
      })
    ).toBe("endOfLife");
  });
});

// ---------------------------------------------------------------------------
// LifecycleBadge component rendering
// ---------------------------------------------------------------------------

describe("LifecycleBadge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when no lifecycle", () => {
    const { container } = render(<LifecycleBadge />);
    expect(container.firstChild).toBeNull();
  });

  it("renders Active chip", () => {
    render(<LifecycleBadge lifecycle={{ active: "2024-01-01" }} />);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("renders End of Life chip", () => {
    render(<LifecycleBadge lifecycle={{ endOfLife: "2025-01-01" }} />);
    expect(screen.getByText("End of Life")).toBeInTheDocument();
  });

  it("renders Plan chip for future plan date", () => {
    render(<LifecycleBadge lifecycle={{ plan: "2026-01-01" }} />);
    expect(screen.getByText("Plan")).toBeInTheDocument();
  });

  it("renders Phase Out chip", () => {
    render(
      <LifecycleBadge
        lifecycle={{ active: "2023-01-01", phaseOut: "2025-06-01" }}
      />
    );
    expect(screen.getByText("Phase Out")).toBeInTheDocument();
  });
});

describe("getCurrentPhase asOfMs (time travel)", () => {
  const lc = {
    plan: "2020-01-01",
    active: "2022-01-01",
    phaseOut: "2030-01-01",
    endOfLife: "2032-01-01",
  };
  const at = (iso: string) => new Date(iso).getTime();

  it("reports the phase in force on the given date, not today", () => {
    expect(getCurrentPhase(lc, at("2021-01-01"))).toBe("plan");
    expect(getCurrentPhase(lc, at("2025-01-01"))).toBe("active");
    expect(getCurrentPhase(lc, at("2031-01-01"))).toBe("phaseOut");
    expect(getCurrentPhase(lc, at("2033-01-01"))).toBe("endOfLife");
  });

  it("reports nothing before the first phase date", () => {
    expect(getCurrentPhase(lc, at("2019-01-01"))).toBe("plan");
    expect(getCurrentPhase({ active: "2030-01-01" }, at("2019-01-01"))).toBeNull();
  });

  it("falls back to today when no date is given", () => {
    expect(getCurrentPhase(lc)).toBe(getCurrentPhase(lc, Date.now()));
  });
});
