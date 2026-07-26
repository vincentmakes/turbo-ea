import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { api } from "@/api/client";
import TagsSection from "./TagsSection";
import type { Card } from "@/types";

const card = {
  id: "card-1",
  type: "Application",
  name: "NexaCore ERP",
  tags: [],
} as unknown as Card;

// MUI keeps the collapsed panel mounted but marks the summary button
// aria-expanded, which is what a user's screen reader (and the visual state)
// actually reflects.
const isExpanded = () => screen.getByRole("button", { expanded: true }) !== null;
const summary = () => document.querySelector(".MuiAccordionSummary-root")!;

describe("TagsSection expansion", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.get).mockResolvedValue([]);
  });

  it("renders collapsed when initialExpanded is false", async () => {
    render(<TagsSection card={card} onUpdate={() => {}} initialExpanded={false} />);
    await waitFor(() => expect(summary()).toBeTruthy());
    expect(summary().getAttribute("aria-expanded")).toBe("false");
  });

  it("renders expanded when initialExpanded is true", async () => {
    render(<TagsSection card={card} onUpdate={() => {}} initialExpanded />);
    await waitFor(() => expect(summary()).toBeTruthy());
    expect(isExpanded()).toBe(true);
  });

  it("follows initialExpanded when it arrives after mount", async () => {
    // The regression guard: section_config loads asynchronously, so a section
    // first renders with the fallback and is only later told to collapse. With
    // MUI's uncontrolled `defaultExpanded` this update was ignored and the
    // admin's "collapsed by default" setting silently did nothing.
    const { rerender } = render(
      <TagsSection card={card} onUpdate={() => {}} initialExpanded />,
    );
    await waitFor(() => expect(summary()).toBeTruthy());
    expect(summary().getAttribute("aria-expanded")).toBe("true");

    rerender(<TagsSection card={card} onUpdate={() => {}} initialExpanded={false} />);
    await waitFor(() =>
      expect(summary().getAttribute("aria-expanded")).toBe("false"),
    );
  });
});
