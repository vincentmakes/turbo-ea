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

  it("carries its jump anchor and opens on a jump request", async () => {
    const { container, rerender } = render(
      <TagsSection card={card} onUpdate={() => {}} initialExpanded={false} />,
    );
    await waitFor(() => expect(summary()).toBeTruthy());
    expect(container.querySelector(".MuiAccordion-root")!.id).toBe("card-section-tags");
    expect(summary().getAttribute("aria-expanded")).toBe("false");

    rerender(<TagsSection card={card} onUpdate={() => {}} initialExpanded={false} expandOn={1} />);
    await waitFor(() => expect(summary().getAttribute("aria-expanded")).toBe("true"));
  });
});

describe("TagsSection — a jump opens the tag editor", () => {
  const GROUP = {
    id: "g1",
    name: "Domain",
    mode: "multi",
    mandatory: true,
    restrict_to_types: null,
    tags: [{ id: "t1", name: "Finance", color: null, tag_group_id: "g1" }],
  };
  const request = (nonce = 1) => ({ anchor: "card-section-tags", nonce, tagGroupId: "g1" });

  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it("opens the tag editor on a jump once the groups are loaded", async () => {
    vi.mocked(api.get).mockResolvedValue([GROUP]);
    render(<TagsSection card={card} onUpdate={() => {}} editOn={request()} />);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/^Edit tags/);
    expect(api.get).toHaveBeenCalledWith("/tag-groups");
  });

  it("waits for the groups: no editor before /tag-groups answers", async () => {
    let answer: (groups: unknown[]) => void = () => {};
    vi.mocked(api.get).mockReturnValue(new Promise((resolve) => (answer = resolve)));
    render(<TagsSection card={card} onUpdate={() => {}} editOn={request()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    answer([GROUP]);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("never opens it when no group applies to the card", async () => {
    vi.mocked(api.get).mockResolvedValue([{ ...GROUP, restrict_to_types: ["Organization"] }]);
    render(<TagsSection card={card} onUpdate={() => {}} editOn={request()} />);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("never opens it without edit rights", async () => {
    vi.mocked(api.get).mockResolvedValue([GROUP]);
    render(<TagsSection card={card} onUpdate={() => {}} canEdit={false} editOn={request()} />);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit tags" })).not.toBeInTheDocument();
  });
});
