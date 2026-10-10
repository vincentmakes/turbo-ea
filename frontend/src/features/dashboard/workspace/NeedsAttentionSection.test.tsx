/**
 * NeedsAttentionSection: the workspace's call to action. A card per thing
 * waiting on the user — overdue todos, broken cards they hold a role on —
 * each opening the list that resolves it; nothing at all when nothing waits.
 */
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { useLocation } from "react-router";

import { renderWithProviders } from "@/test/render";
import NeedsAttentionSection from "./NeedsAttentionSection";

function Where() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{pathname + search}</div>;
}

function renderSection(overdueTodoCount: number, brokenCardCount: number) {
  return renderWithProviders(
    <NeedsAttentionSection overdueTodoCount={overdueTodoCount} brokenCardCount={brokenCardCount} />,
    {
      routes: [
        { path: "/" },
        { path: "/todos", element: <Where /> },
        { path: "/inventory", element: <Where /> },
      ],
    },
  );
}

describe("NeedsAttentionSection", () => {
  it("renders nothing when nothing waits", () => {
    const { container } = renderSection(0, 0);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows overdue todos alone and opens the todo list", async () => {
    const { user } = renderSection(3, 0);
    expect(screen.getByText("Needs my attention")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("3 overdue todos")).toBeInTheDocument();
    expect(screen.getByText("schedule")).toBeInTheDocument();
    expect(screen.queryByText(/broken card/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: /overdue todos/ }));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/todos$/);
  });

  it("shows broken cards alone and opens them in the inventory", async () => {
    const { user } = renderSection(0, 1);
    expect(screen.getByText("1 broken card you're responsible for")).toBeInTheDocument();
    expect(screen.getByText("report")).toBeInTheDocument();
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /broken card/ }));
    expect(screen.getByTestId("where")).toHaveTextContent(
      "/inventory?approval_status=BROKEN&mine=stakeholder",
    );
  });

  it("puts overdue todos before broken cards, each with a Review cue", () => {
    renderSection(1, 2);
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([
      "schedule11 overdue todoReviewchevron_right",
      "report22 broken cards you're responsible forReviewchevron_right",
    ]);
  });
});
