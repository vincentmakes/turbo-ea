/**
 * PortalPpmPortfolio — the PPM board a published web portal serves.
 *
 * The board itself (`PpmPortfolioView`) is stubbed down to the props it is
 * handed: this container owns only the public fetch per grouping, the
 * portal-configured defaults, the subtype definitions it forwards and where
 * opening an initiative navigates.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { useLocation } from "react-router";
import type {
  PortalPpmPortfolio as Payload,
  PpmPortfolioItem,
  PublicPortal,
} from "@/types";
import type { PpmPortfolioViewProps } from "@/features/ppm/PpmPortfolioView";

const publicGet = vi.fn();
vi.mock("./publicApi", () => ({ publicGet: (...a: unknown[]) => publicGet(...a) }));

let lastProps: PpmPortfolioViewProps | null = null;
vi.mock("@/features/ppm/PpmPortfolioView", () => ({
  default: (props: PpmPortfolioViewProps) => {
    lastProps = props;
    return (
      <div data-testid="board" data-loading={String(props.loading)}>
        {props.items.map((i) => i.name).join(",")}
      </div>
    );
  },
}));

import { renderWithProviders } from "@/test/render";
import PortalPpmPortfolio from "./PortalPpmPortfolio";

function item(id: string, name: string): PpmPortfolioItem {
  return {
    id,
    name,
    subtype: "project",
    start_date: null,
    end_date: null,
    group_id: "tok-1",
    group_name: "Sales",
    stakeholders: [],
    latest_report: null,
  };
}

const health = { onTrack: 1, atRisk: 0, offTrack: 0, noReport: 0 };

function payload(groupBy: string, items: PpmPortfolioItem[]): Payload {
  return {
    group_by: groupBy,
    group_options: [{ type_key: "Organization", label: "Organization" }, { type_key: "Platform", label: "Platform" }],
    dashboard: { total_initiatives: items.length, health_schedule: health },
    items,
  };
}

const SUBTYPES = [{ key: "project", label: "Project" }];

function portal(card_config?: Record<string, unknown>): PublicPortal {
  return {
    id: "p1",
    name: "Exec board",
    slug: "exec",
    card_type: "Initiative",
    view: "ppm_portfolio",
    card_config,
    type_info: {
      key: "Initiative",
      label: "Initiative",
      icon: "rocket_launch",
      color: "#33cc58",
      fields_schema: [],
      subtypes: SUBTYPES,
    },
    relation_types: [],
    tag_groups: [],
  };
}

function Probe() {
  const { pathname, search } = useLocation();
  return <div data-testid="landed">{`${pathname}${search}`}</div>;
}

function renderBoard(p: PublicPortal = portal(), route = "/portal/exec") {
  return renderWithProviders(<PortalPpmPortfolio slug="exec" portal={p} />, {
    route,
    user: null,
    routes: [{ path: "/portal/exec" }, { path: "/ppm/:id", element: <Probe /> }],
  });
}

const pathFor = (groupBy: string) => `/web-portals/public/exec/ppm/portfolio?group_by=${encodeURIComponent(groupBy)}`;

beforeEach(() => {
  lastProps = null;
  publicGet.mockReset();
  publicGet.mockImplementation(async (path: string) =>
    path.includes("group_by=Platform")
      ? payload("Platform", [item("i2", "Cloud Move")])
      : payload("Organization", [item("i1", "ERP Upgrade")]),
  );
});

describe("PortalPpmPortfolio", () => {
  it("fetches the board grouped by Organization by default and hands it to the view", async () => {
    renderBoard();
    expect(screen.getByTestId("board")).toHaveAttribute("data-loading", "true");
    await waitFor(() => expect(screen.getByTestId("board")).toHaveAttribute("data-loading", "false"));

    expect(publicGet).toHaveBeenCalledTimes(1);
    expect(publicGet.mock.calls[0][0]).toBe(pathFor("Organization"));
    expect(publicGet.mock.calls[0][1]).toEqual({ signal: expect.any(AbortSignal) });
    expect(screen.getByTestId("board")).toHaveTextContent("ERP Upgrade");
    expect(lastProps).toMatchObject({
      dashboard: { total_initiatives: 1 },
      groupOptions: [{ type_key: "Organization" }, { type_key: "Platform" }],
      subtypeDefs: SUBTYPES,
      initialGroupBy: "Organization",
      initialSubtype: "",
      showTitle: false,
    });
    // No shell: the portal board renders bare, without export.
    expect(lastProps?.shell).toBeUndefined();
  });

  it("opens on the grouping and subtype the portal is configured with", async () => {
    renderBoard(portal({ ppm: { default_group_by: "Platform", default_subtype: "program" } }));
    await waitFor(() => expect(screen.getByTestId("board")).toHaveTextContent("Cloud Move"));
    expect(publicGet.mock.calls[0][0]).toBe(pathFor("Platform"));
    expect(lastProps).toMatchObject({ initialGroupBy: "Platform", initialSubtype: "program" });
  });

  it("lets a groupBy in the URL override the portal default for the first fetch", async () => {
    renderBoard(portal(), "/portal/exec?groupBy=Business%20Unit");
    await waitFor(() => expect(publicGet).toHaveBeenCalled());
    expect(publicGet.mock.calls[0][0]).toBe(pathFor("Business Unit"));
  });

  it("refetches when the visitor changes the grouping", async () => {
    renderBoard();
    await waitFor(() => expect(screen.getByTestId("board")).toHaveTextContent("ERP Upgrade"));
    act(() => lastProps?.onGroupByChange?.("Platform"));
    await waitFor(() => expect(screen.getByTestId("board")).toHaveTextContent("Cloud Move"));
    expect(publicGet.mock.calls.map((c) => c[0])).toEqual([pathFor("Organization"), pathFor("Platform")]);
  });

  it("forwards no subtypes when the portal carries no type info", async () => {
    renderBoard({ ...portal(), type_info: null });
    await waitFor(() => expect(screen.getByTestId("board")).toHaveAttribute("data-loading", "false"));
    expect(lastProps?.subtypeDefs).toEqual([]);
  });

  it("opens an initiative, or its reports tab, inside the app", async () => {
    renderBoard();
    await waitFor(() => expect(screen.getByTestId("board")).toHaveTextContent("ERP Upgrade"));
    act(() => lastProps?.onOpen?.(item("i1", "ERP Upgrade"), "reports"));
    expect(await screen.findByTestId("landed")).toHaveTextContent("/ppm/i1?tab=reports");
  });

  it("opens an initiative's detail by default", async () => {
    renderBoard();
    await waitFor(() => expect(screen.getByTestId("board")).toHaveTextContent("ERP Upgrade"));
    act(() => lastProps?.onOpen?.(item("i1", "ERP Upgrade")));
    expect(await screen.findByTestId("landed")).toHaveTextContent(/^\/ppm\/i1$/);
  });

  it("clears the spinner when the fetch fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    publicGet.mockRejectedValue(new Error("portal_locked"));
    renderBoard();
    await waitFor(() => expect(screen.getByTestId("board")).toHaveAttribute("data-loading", "false"));
    expect(lastProps?.items).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
