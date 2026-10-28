import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

import { api } from "@/api/client";
import type { Comment } from "@/types";
import CommentsTab from "./CommentsTab";

function comment(id: string, over: Partial<Comment> = {}): Comment {
  return {
    id,
    card_id: "card-1",
    user_id: "u1",
    user_display_name: "Ada Admin",
    content: `Comment ${id}`,
    created_at: "2026-10-28T10:00:00Z",
    ...over,
  } as Comment;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CommentsTab", () => {
  it("shows each comment with its author, and the channel only when not the web UI", async () => {
    vi.mocked(api.get).mockResolvedValue([
      comment("c1", { content: "Drafted by the agent", created_via: "mcp" }),
      comment("c2", { content: "Typed by hand", created_via: "web", user_display_name: "Bo" }),
    ]);
    const { container } = render(<CommentsTab fsId="card-1" />);
    expect(await screen.findByText("Drafted by the agent")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith("/cards/card-1/comments");
    expect(screen.getByText("Typed by hand")).toBeInTheDocument();
    expect(screen.getByText("Bo")).toBeInTheDocument();
    const marked = Array.from(container.querySelectorAll("[data-origin]"));
    expect(marked.map((el) => el.getAttribute("data-origin"))).toEqual(["mcp"]);
    const agentCard = screen.getByText("Drafted by the agent").closest(".MuiCard-root")!;
    expect(agentCard.querySelector("[data-origin]")).not.toBeNull();
  });

  it("says so when there are no comments, and hides the box without permission", async () => {
    vi.mocked(api.get).mockResolvedValue([]);
    render(<CommentsTab fsId="card-1" canCreateComments={false} />);
    expect(await screen.findByText("No comments yet.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("posts a new comment and reloads the list", async () => {
    vi.mocked(api.get).mockResolvedValueOnce([]).mockResolvedValueOnce([comment("c3")]);
    vi.mocked(api.post).mockResolvedValue({});
    render(<CommentsTab fsId="card-1" />);
    await userEvent.type(screen.getByRole("textbox"), "Hello");
    await userEvent.click(screen.getByRole("button"));
    expect(api.post).toHaveBeenCalledWith("/cards/card-1/comments", { content: "Hello" });
    await waitFor(() => expect(screen.getByText("Comment c3")).toBeInTheDocument());
  });
});
