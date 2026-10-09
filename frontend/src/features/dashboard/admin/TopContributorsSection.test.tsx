/**
 * TopContributorsSection: who changed the most in the last 30 days, each with
 * a bar scaled to the busiest contributor. A row opens user management.
 */
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { useLocation } from "react-router";

import { renderWithProviders } from "@/test/render";
import TopContributorsSection, { type ContributorRow } from "./TopContributorsSection";

const person = (id: string, name: string, events: number): ContributorRow => ({
  user_id: id,
  display_name: name,
  email: `${id}@example.com`,
  event_count: events,
});

function Where() {
  const { pathname } = useLocation();
  return <div data-testid="where">{pathname}</div>;
}

function renderSection(rows: ContributorRow[], loading = false) {
  return renderWithProviders(<TopContributorsSection rows={rows} loading={loading} />, {
    routes: [{ path: "/" }, { path: "/admin/users", element: <Where /> }],
  });
}

/** The fill of the bar under a contributor's name. */
const barOf = (name: string) =>
  screen.getByText(name).nextElementSibling!.firstElementChild as HTMLElement;

describe("TopContributorsSection", () => {
  it("shows a progress bar while loading", () => {
    renderSection([person("a", "Ada", 3)], true);
    expect(screen.getByText("Top contributors (last 30d)")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText("Ada")).not.toBeInTheDocument();
  });

  it("says so when nobody changed anything", () => {
    renderSection([]);
    expect(screen.getByText("No mutating activity in the last 30 days.")).toBeInTheDocument();
  });

  it("lists each contributor with their event count", () => {
    renderSection([person("a", "Ada", 12), person("b", "Bo", 1)]);
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("12 events")).toBeInTheDocument();
    expect(screen.getByText("Bo")).toBeInTheDocument();
    expect(screen.getByText("1 event")).toBeInTheDocument();
  });

  it("scales each bar to the busiest contributor", () => {
    renderSection([person("a", "Ada", 8), person("b", "Bo", 2)]);
    expect(barOf("Ada")).toHaveStyle({ width: "100%" });
    expect(barOf("Bo")).toHaveStyle({ width: "25%" });
  });

  it("draws empty bars when nobody has an event", () => {
    renderSection([person("a", "Ada", 0)]);
    expect(barOf("Ada")).toHaveStyle({ width: "0%" });
  });

  it("opens user management", async () => {
    const { user } = renderSection([person("a", "Ada", 3)]);
    await user.click(screen.getByText("Ada"));
    expect(screen.getByTestId("where")).toHaveTextContent("/admin/users");
  });
});
