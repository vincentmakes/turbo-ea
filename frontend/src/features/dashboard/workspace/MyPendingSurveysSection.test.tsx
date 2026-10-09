/**
 * MyPendingSurveysSection: surveys waiting for the user's answers, five at
 * most. A survey opens its first pending card's form; one with no pending
 * card falls back to the surveys tab.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { useLocation } from "react-router";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import MyPendingSurveysSection from "./MyPendingSurveysSection";

const MY = "/surveys/my";

const survey = (id: string, cards: string[], pending = cards.length) => ({
  survey_id: id,
  survey_name: `Survey ${id}`,
  pending_count: pending,
  items: cards.map((c) => ({ response_id: `r-${c}`, card_id: c, card_name: `Card ${c}` })),
});

function Where() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{pathname + search}</div>;
}

function renderSection() {
  return renderWithProviders(<MyPendingSurveysSection />, {
    routes: [
      { path: "/" },
      { path: "/surveys/:surveyId/respond/:cardId", element: <Where /> },
      { path: "/todos", element: <Where /> },
    ],
  });
}

beforeEach(() => {
  mockApi.reset();
});

describe("MyPendingSurveysSection", () => {
  it("loads the user's surveys, showing progress until they arrive", async () => {
    mockApi.on("get", MY, [survey("a", ["c1", "c2"])]);
    renderSection();
    expect(screen.getByText("My Pending Surveys")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(await screen.findByText("Survey a")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(mockApi.callsOf("get", MY)).toHaveLength(1);
  });

  it("shows each survey's pending count", async () => {
    mockApi.on("get", MY, [survey("a", ["c1"], 7)]);
    renderSection();
    const row = (await screen.findByText("Survey a")).parentElement!;
    expect(within(row).getByText("7")).toBeInTheDocument();
  });

  it("lists five surveys at most", async () => {
    mockApi.on(
      "get",
      MY,
      Array.from({ length: 7 }, (_, i) => survey(`s${i}`, ["c1"])),
    );
    renderSection();
    expect(await screen.findByText("Survey s4")).toBeInTheDocument();
    expect(screen.queryByText("Survey s5")).not.toBeInTheDocument();
  });

  it("says so when nothing waits", async () => {
    mockApi.on("get", MY, []);
    renderSection();
    expect(await screen.findByText("No surveys waiting for your input.")).toBeInTheDocument();
  });

  it("shows the empty state when the load fails", async () => {
    mockApi.fail("get", MY, 500);
    renderSection();
    expect(await screen.findByText("No surveys waiting for your input.")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("opens the form for the first pending card", async () => {
    mockApi.on("get", MY, [survey("a", ["c1", "c2"])]);
    const { user } = renderSection();
    await user.click(await screen.findByText("Survey a"));
    expect(screen.getByTestId("where")).toHaveTextContent("/surveys/a/respond/c1");
  });

  it("falls back to the surveys tab for a survey with no pending card", async () => {
    mockApi.on("get", MY, [survey("a", [], 0)]);
    const { user } = renderSection();
    await user.click(await screen.findByText("Survey a"));
    expect(screen.getByTestId("where")).toHaveTextContent("/todos?tab=surveys");
  });

  it("links to every survey", async () => {
    mockApi.on("get", MY, []);
    renderSection();
    expect(screen.getByRole("link", { name: "View all →" })).toHaveAttribute(
      "href",
      "/todos?tab=surveys",
    );
    await screen.findByText("No surveys waiting for your input.");
  });
});
