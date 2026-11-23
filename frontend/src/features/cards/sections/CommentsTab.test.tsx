import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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

  describe("deleting a comment", () => {
    const deletable = () => [
      comment("c1", { content: "Mine", can: { delete: true } }),
      comment("c2", { content: "Theirs", can: { delete: false } }),
      comment("c3", { content: "Older payload" }),
    ];

    it("offers the delete button only on comments the server says the caller may delete", async () => {
      vi.mocked(api.get).mockResolvedValue(deletable());
      render(<CommentsTab fsId="card-1" canCreateComments={false} />);
      await screen.findByText("Mine");
      const buttons = screen.getAllByRole("button", { name: "Delete" });
      expect(buttons).toHaveLength(1);
      const mine = screen.getByText("Mine").closest(".MuiCard-root") as HTMLElement;
      expect(within(mine).getByRole("button", { name: "Delete" })).toBe(buttons[0]);
      expect(screen.queryByText("Delete this comment? This cannot be undone.")).toBeNull();
    });

    it("asks for confirmation inline, and Cancel closes it without deleting", async () => {
      vi.mocked(api.get).mockResolvedValue(deletable());
      render(<CommentsTab fsId="card-1" canCreateComments={false} />);
      await userEvent.click(await screen.findByRole("button", { name: "Delete" }));

      const mine = screen.getByText("Mine").closest(".MuiCard-root") as HTMLElement;
      expect(within(mine).getByText("Delete this comment? This cannot be undone.")).toBeInTheDocument();
      expect(screen.getAllByText("Delete this comment? This cannot be undone.")).toHaveLength(1);

      await userEvent.click(within(mine).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByText("Delete this comment? This cannot be undone.")).toBeNull();
      expect(api.delete).not.toHaveBeenCalled();
      expect(api.get).toHaveBeenCalledTimes(1);
    });

    it("deletes on confirm and reloads the list", async () => {
      vi.mocked(api.get)
        .mockResolvedValueOnce(deletable())
        .mockResolvedValueOnce([comment("c2", { content: "Theirs", can: { delete: false } })]);
      vi.mocked(api.delete).mockResolvedValue(undefined);
      render(<CommentsTab fsId="card-1" canCreateComments={false} />);
      await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
      const row = screen.getByText("Delete this comment? This cannot be undone.").parentElement as HTMLElement;
      await userEvent.click(within(row).getByRole("button", { name: "Delete" }));

      expect(api.delete).toHaveBeenCalledWith("/comments/c1");
      await waitFor(() => expect(screen.queryByText("Mine")).toBeNull());
      expect(api.get).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Theirs")).toBeInTheDocument();
      expect(screen.queryByText("Delete this comment? This cannot be undone.")).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("shows an error and keeps the comment when the delete fails", async () => {
      vi.mocked(api.get).mockResolvedValue(deletable());
      vi.mocked(api.delete).mockRejectedValue(new Error("boom"));
      render(<CommentsTab fsId="card-1" canCreateComments={false} />);
      await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
      const row = screen.getByText("Delete this comment? This cannot be undone.").parentElement as HTMLElement;
      const confirm = within(row).getByRole("button", { name: "Delete" });
      await userEvent.click(confirm);

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "The comment could not be deleted. Try again.",
      );
      expect(screen.getByText("Mine")).toBeInTheDocument();
      expect(screen.getByText("Delete this comment? This cannot be undone.")).toBeInTheDocument();
      expect(confirm).toBeEnabled();
      expect(api.get).toHaveBeenCalledTimes(1);
    });

    it("clears an earlier error when the confirmation is opened again", async () => {
      vi.mocked(api.get).mockResolvedValue(deletable());
      vi.mocked(api.delete).mockRejectedValue(new Error("boom"));
      render(<CommentsTab fsId="card-1" canCreateComments={false} />);
      const open = await screen.findByRole("button", { name: "Delete" });
      await userEvent.click(open);
      const row = screen.getByText("Delete this comment? This cannot be undone.").parentElement as HTMLElement;
      await userEvent.click(within(row).getByRole("button", { name: "Delete" }));
      await screen.findByRole("alert");
      await userEvent.click(within(row).getByRole("button", { name: "Cancel" }));
      await userEvent.click(open);
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });
});
