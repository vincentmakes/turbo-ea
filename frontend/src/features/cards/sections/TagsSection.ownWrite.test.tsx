/**
 * A tag save runs its requests through the own-write tracker: the card page's
 * live re-read can then bring the change back with its score gain, whichever
 * of it and the section's own refresh lands first.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));
// The picker has its own tests: here it is one button that picks a tag.
vi.mock("@/components/TagPicker", () => ({
  default: ({ onChange }: { onChange: (ids: string[]) => void }) => (
    <button onClick={() => onChange(["t1"])}>pick tag</button>
  ),
}));

import { api } from "@/api/client";
import { OwnCardWriteContext, type TrackOwnCardWrite } from "@/features/cards/ownCardWrite";
import TagsSection from "./TagsSection";
import type { Card } from "@/types";

const card = { id: "card-1", type: "Application", name: "Some App", tags: [] } as unknown as Card;
const GROUP = {
  id: "g1",
  name: "Domain",
  mode: "multi",
  mandatory: false,
  restrict_to_types: null,
  tags: [{ id: "t1", name: "Finance", color: null, tag_group_id: "g1" }],
};

describe("TagsSection — own writes", () => {
  it("runs the tag post through the own-write tracker, then refreshes the card", async () => {
    const order: string[] = [];
    const track: TrackOwnCardWrite = async (run) => {
      order.push("track");
      const result = await run();
      order.push("tracked");
      return result;
    };
    vi.mocked(api.get).mockResolvedValue([GROUP]);
    vi.mocked(api.post).mockImplementation(async () => {
      order.push("post");
      return undefined as never;
    });
    const onUpdate = vi.fn(() => order.push("refresh"));
    render(
      <OwnCardWriteContext.Provider value={track}>
        <TagsSection
          card={card}
          onUpdate={onUpdate}
          editOn={{ anchor: "card-section-tags", nonce: 1, tagGroupId: "g1" }}
        />
      </OwnCardWriteContext.Provider>,
    );
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "pick tag" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(order).toEqual(["track", "post", "tracked", "refresh"]));
    expect(api.post).toHaveBeenCalledWith("/cards/card-1/tags", ["t1"]);
  });
});
