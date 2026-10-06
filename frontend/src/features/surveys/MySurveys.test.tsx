/**
 * MySurveys — the list of surveys waiting on the signed-in user.
 *
 * Pins what `/surveys/my` renders (one card per survey with its pending
 * count, linkified message and one row per card to answer), navigation to
 * the respond page, and the empty and error states.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { useLocation } from "react-router";
import type { MySurveyItem } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import MySurveys from "./MySurveys";

const SURVEYS: MySurveyItem[] = [
  {
    survey_id: "s1",
    survey_name: "Q3 application review",
    survey_message: "Please confirm owners.\nGuide: https://wiki.example.com/q3",
    survey_status: "active",
    target_type_key: "Application",
    pending_count: 2,
    items: [
      { response_id: "r1", card_id: "c1", card_name: "NexaCore ERP" },
      { response_id: "r2", card_id: "c2", card_name: "Billing Hub" },
    ],
  },
  {
    survey_id: "s2",
    survey_name: "Vendor check",
    survey_message: "",
    survey_status: "active",
    target_type_key: "Provider",
    pending_count: 1,
    items: [{ response_id: "r3", card_id: "c3", card_name: "Acme Corp" }],
  },
];

function Probe() {
  const { pathname } = useLocation();
  return <div data-testid="landed">{pathname}</div>;
}

function renderPage() {
  return renderWithProviders(<MySurveys />, {
    routes: [{ path: "/" }, { path: "/surveys/:surveyId/respond/:cardId", element: <Probe /> }],
  });
}

const surveyCard = (name: string) =>
  screen.getByText(name).closest(".MuiCard-root") as HTMLElement;

beforeEach(() => {
  mockApi.reset();
  mockApi.on("get", "/surveys/my", SURVEYS);
});

describe("MySurveys", () => {
  it("shows a spinner, then one card per pending survey", async () => {
    renderPage();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(await screen.findByText("My Surveys")).toBeInTheDocument();

    const q3 = surveyCard("Q3 application review");
    expect(within(q3).getByText("2 pending")).toBeInTheDocument();
    expect(within(q3).getByRole("link", { name: "https://wiki.example.com/q3" })).toBeInTheDocument();
    expect(within(q3).getByText("NexaCore ERP")).toBeInTheDocument();
    expect(within(q3).getByText("Billing Hub")).toBeInTheDocument();
    expect(within(q3).getAllByText("Respond")).toHaveLength(2);

    const vendor = surveyCard("Vendor check");
    expect(within(vendor).getByText("1 pending")).toBeInTheDocument();
    expect(within(vendor).getByText("Acme Corp")).toBeInTheDocument();
    expect(within(vendor).queryByRole("link")).not.toBeInTheDocument();

    // A successful load shows neither an error nor the all-caught-up note.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("No pending surveys. You're all caught up!")).not.toBeInTheDocument();
  });

  it("opens the respond page for the card that was clicked", async () => {
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: /Billing Hub/ }));
    expect(await screen.findByTestId("landed")).toHaveTextContent("/surveys/s1/respond/c2");
  });

  it("says so when nothing is pending", async () => {
    mockApi.on("get", "/surveys/my", []);
    renderPage();
    expect(await screen.findByText("No pending surveys. You're all caught up!")).toBeInTheDocument();
  });

  it("shows the load error and lets the user dismiss it", async () => {
    mockApi.fail("get", "/surveys/my", 500);
    const { user } = renderPage();
    const error = await screen.findByText("GET /surveys/my failed");
    const alert = error.closest('[role="alert"]') as HTMLElement;
    await user.click(within(alert).getByRole("button", { name: "Close" }));
    expect(screen.queryByText("GET /surveys/my failed")).not.toBeInTheDocument();
    // The error alert is gone altogether; only the informational note remains.
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    // The empty-state note still renders under the error.
    expect(screen.getByText("No pending surveys. You're all caught up!")).toBeInTheDocument();
  });

  it("falls back to a generic message when the failure is not an Error", async () => {
    mockApi.on("get", "/surveys/my", () => Promise.reject("offline"));
    renderPage();
    expect(await screen.findByText("Failed to load surveys")).toBeInTheDocument();
  });
});
