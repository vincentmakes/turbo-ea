import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import type { DashboardWidget } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("../RecentActivity", () => ({
  default: (props: { events: unknown[]; maxRows?: number; defaultFilter?: string }) => (
    <div data-testid="activity">{JSON.stringify(props)}</div>
  ),
}));

import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import { DashboardSourcesProvider } from "../DashboardSources";
import RecentActivityWidget from "./RecentActivityWidget";

function w(config: Record<string, unknown> = {}): DashboardWidget {
  return { id: "ra", type: "recent_activity", title: null, config, layout: { x: 0, y: 0, w: 7, h: 6 } };
}

const EVENTS = [{ id: "e1", event_type: "card.created" }];

function renderIt(widget: DashboardWidget, provider = true) {
  const body = <RecentActivityWidget widget={widget} />;
  return renderWithProviders(provider ? <DashboardSourcesProvider widgets={[widget]}>{body}</DashboardSourcesProvider> : body);
}

beforeEach(() => {
  mockApi.reset();
  mockApi.on("get", "/reports/dashboard", { recent_events: EVENTS, by_type: {} });
});

describe("RecentActivityWidget", () => {
  it("feeds the shared dashboard payload's events with the configured rows and tab", async () => {
    renderIt(w({ max_rows: 5, filter: "approvals" }));
    const el = await screen.findByTestId("activity");
    expect(JSON.parse(el.textContent!)).toEqual({ events: EVENTS, maxRows: 5, defaultFilter: "approvals" });
  });

  it("ignores a malformed config", async () => {
    renderIt(w({ max_rows: -1, filter: "nonsense" }));
    const el = await screen.findByTestId("activity");
    expect(JSON.parse(el.textContent!)).toEqual({ events: EVENTS, defaultFilter: "all" });
  });

  it("fetches the payload itself outside a dashboard", async () => {
    renderIt(w(), false);
    expect(await screen.findByTestId("activity")).toBeInTheDocument();
    expect(mockApi.callsOf("get", "/reports/dashboard")).toHaveLength(1);
  });

  it("reports a failed fetch", async () => {
    mockApi.fail("get", "/reports/dashboard", 500);
    renderIt(w());
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByTestId("activity")).toBeNull();
  });
});
