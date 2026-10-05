/**
 * TurboLens → Assessments tab: the saved Architecture-AI runs from
 * `GET /turbolens/assessments`, and the three places a row leads — the
 * read-only viewer (row click), the linked initiative card, and the
 * Architect wizard to resume a saved (not yet committed) assessment.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

import { mockApi } from "@/test/apiMock";
import { hookState } from "@/test/hooks";
import { renderWithProviders } from "@/test/render";
import type { TurboLensAssessment } from "@/types";
import TurboLensAssessments from "./TurboLensAssessments";

const LIST_URL = "/turbolens/assessments";

function assessment(
  overrides: Partial<TurboLensAssessment> & { id: string; title: string },
): TurboLensAssessment {
  return {
    requirement: "",
    status: "saved",
    session_data: null,
    initiative_id: null,
    created_by: null,
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

const SAVED = assessment({
  id: "a-1",
  title: "CRM replacement",
  created_by_name: "Ada Lovelace",
  created_at: "2026-02-01T09:00:00Z",
});
const COMMITTED = assessment({
  id: "a-2",
  title: "Data platform",
  status: "committed",
  initiative_id: "init-9",
  initiative_name: "Data Platform Initiative",
  created_at: "2026-02-03T09:00:00Z",
});
const COMMITTED_UNNAMED = assessment({
  id: "a-3",
  title: "Unnamed link",
  status: "committed",
  initiative_id: "init-10",
});

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <output data-testid="location">{`${pathname}${search}`}</output>;
}

function renderTab() {
  return renderWithProviders(
    <>
      <TurboLensAssessments />
      <LocationProbe />
    </>,
    { route: "/turbolens?tab=assessments" },
  );
}

function rowOf(title: string): HTMLElement {
  return screen.getByText(title).closest("tr") as HTMLElement;
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
});

describe("TurboLensAssessments", () => {
  it("lists every assessment with its status, author, initiative and date", async () => {
    mockApi.on("get", LIST_URL, [SAVED, COMMITTED, COMMITTED_UNNAMED]);
    renderTab();

    expect(screen.getByRole("heading", { name: "Architecture Assessments" })).toBeInTheDocument();
    await screen.findByText("CRM replacement");

    const saved = rowOf("CRM replacement");
    expect(within(saved).getByText("Ada Lovelace")).toBeInTheDocument();
    expect(within(saved).getByText("Saved")).toBeInTheDocument();
    expect(within(saved).getByText("2026-02-01")).toBeInTheDocument();
    expect(within(saved).getByRole("button", { name: /Resume/ })).toBeInTheDocument();
    // No initiative yet: the cell is a dash.
    expect(within(saved).queryByRole("button", { name: /Initiative/ })).not.toBeInTheDocument();

    const committed = rowOf("Data platform");
    expect(within(committed).getByText("Committed")).toBeInTheDocument();
    expect(within(committed).getByRole("button", { name: /Data Platform Initiative/ })).toBeInTheDocument();
    // A committed assessment cannot be resumed.
    expect(within(committed).queryByRole("button", { name: /Resume/ })).not.toBeInTheDocument();
    // No author, no date → dashes.
    expect(within(committed).getAllByText("—")).toHaveLength(1);

    // An initiative without a name falls back to the column label.
    const unnamed = rowOf("Unnamed link");
    expect(within(unnamed).getByRole("button", { name: /Linked Initiative/ })).toBeInTheDocument();
    expect(within(unnamed).getAllByText("—")).toHaveLength(2);
  });

  it("opens the read-only viewer when a row is clicked", async () => {
    mockApi.on("get", LIST_URL, [SAVED]);
    const { user } = renderTab();

    await user.click(await screen.findByText("CRM replacement"));
    expect(screen.getByTestId("location")).toHaveTextContent("/turbolens/assessments/a-1");
  });

  it("resumes a saved assessment in the Architect wizard without opening the viewer", async () => {
    mockApi.on("get", LIST_URL, [SAVED]);
    const { user } = renderTab();

    await screen.findByText("CRM replacement");
    await user.click(within(rowOf("CRM replacement")).getByRole("button", { name: /Resume/ }));
    expect(screen.getByTestId("location")).toHaveTextContent("/turbolens?tab=architect&resume=a-1");
  });

  it("opens the linked initiative card without opening the viewer", async () => {
    mockApi.on("get", LIST_URL, [COMMITTED]);
    const { user } = renderTab();

    await user.click(await screen.findByRole("button", { name: /Data Platform Initiative/ }));
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/cards\/init-9$/);
  });

  it("shows the empty state when there are no assessments", async () => {
    mockApi.on("get", LIST_URL, []);
    renderTab();

    await waitFor(() => expect(mockApi.callsOf("get", LIST_URL)).toHaveLength(1));
    expect(
      screen.getByText("No assessments yet. Complete an architecture assessment to see it here."),
    ).toBeInTheDocument();
  });

  it("keeps the empty state when the list cannot be loaded", async () => {
    mockApi.fail("get", LIST_URL);
    renderTab();

    await waitFor(() => expect(mockApi.callsOf("get", LIST_URL)).toHaveLength(1));
    expect(screen.getByText(/No assessments yet/)).toBeInTheDocument();
  });
});
