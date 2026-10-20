/**
 * The portal board nests its rows by parent exactly as the in-app board does.
 *
 * The public payload carries `parent_id` only when the parent is itself a
 * published row, so the shared view gets everything it needs from that one
 * field. This renders the real view (the sibling test stubs it) to prove the
 * portal path reaches the tree.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { PortalPpmPortfolio as Payload, PpmPortfolioItem, PublicPortal } from "@/types";
import { renderWithProviders } from "@/test/render";
import { setViewportWidth } from "@/test/matchMedia";

const publicGet = vi.fn();
vi.mock("@/features/web-portals/publicApi", () => ({
  publicGet: (...a: unknown[]) => publicGet(...a),
}));

vi.mock("@/hooks/useCurrency", () => ({
  useCurrency: () => ({
    currency: "CHF",
    fmt: { format: (v: number) => `CHF ${v}` },
    fmtShort: (v: number) => `CHF${v}`,
    symbol: "CHF",
  }),
}));

vi.mock("@/hooks/useDateFormat", () => ({
  useDateFormat: () => ({ formatDate: (d: string) => d, dateFormat: "YYYY-MM-DD" }),
}));

import PortalPpmPortfolio from "./PortalPpmPortfolio";

const row = (id: string, name: string, parent_id: string | null): PpmPortfolioItem => ({
  id,
  name,
  subtype: "project",
  parent_id,
  start_date: null,
  end_date: null,
  group_id: "g0",
  group_name: "Sales",
  stakeholders: [],
  latest_report: null,
});

const PORTAL: PublicPortal = {
  id: "p1",
  name: "Exec board",
  slug: "exec",
  card_type: "Initiative",
  view: "ppm_portfolio",
  type_info: {
    key: "Initiative",
    label: "Initiative",
    icon: "rocket_launch",
    color: "#33cc58",
    fields_schema: [],
    subtypes: [{ key: "project", label: "Project" }],
  },
  relation_types: [],
  tag_groups: [],
};

function payload(items: PpmPortfolioItem[]): Payload {
  return {
    group_by: "Organization",
    group_options: [{ type_key: "Organization", label: "Organization" }],
    dashboard: {
      total_initiatives: items.length,
      health_schedule: { onTrack: 0, atRisk: 0, offTrack: 0, noReport: items.length },
    },
    items,
  };
}

beforeEach(() => {
  setViewportWidth(1600);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  publicGet.mockReset();
});

const depthOf = (name: string) =>
  (screen.getByText(name).closest("[data-depth]") as HTMLElement).dataset.depth;

describe("PortalPpmPortfolio hierarchy", () => {
  it("nests a published child under its published parent", async () => {
    publicGet.mockResolvedValue(
      payload([row("c", "ERP Phase 1", "p"), row("p", "ERP Replacement", null)]),
    );
    renderWithProviders(<PortalPpmPortfolio slug="exec" portal={PORTAL} />, {
      route: "/portal/exec",
      user: null,
      routes: [{ path: "/portal/exec" }],
    });
    await waitFor(() => expect(screen.getByLabelText("Show hierarchy")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Show hierarchy"));
    expect(depthOf("ERP Replacement")).toBe("0");
    expect(depthOf("ERP Phase 1")).toBe("1");
  });

  it("offers no hierarchy when the portal publishes no parent", async () => {
    publicGet.mockResolvedValue(
      payload([row("c", "ERP Phase 1", null), row("p", "ERP Replacement", null)]),
    );
    renderWithProviders(<PortalPpmPortfolio slug="exec" portal={PORTAL} />, {
      route: "/portal/exec",
      user: null,
      routes: [{ path: "/portal/exec" }],
    });
    await waitFor(() => expect(screen.getByText("ERP Phase 1")).toBeInTheDocument());
    expect(screen.queryByLabelText("Show hierarchy")).toBeNull();
    expect(screen.getByLabelText("Sub-group by subtype")).toBeInTheDocument();
  });
});

describe("PortalPpmPortfolio grouped by a subtype", () => {
  const PROGRAM_PORTAL: PublicPortal = {
    ...PORTAL,
    card_config: { ppm: { default_group_by: "subtype:program" } },
    type_info: {
      ...PORTAL.type_info!,
      subtypes: [
        { key: "program", label: "Programme" },
        { key: "project", label: "Project" },
      ],
    },
  };
  const anchor: PpmPortfolioItem = {
    ...row("g", "Transformation", null),
    subtype: "program",
    group_id: "g0",
    group_name: "Transformation",
    group_anchor: true,
  };

  it("opens on the portal's subtype grouping, named from the published subtypes", async () => {
    publicGet.mockResolvedValue({
      ...payload([anchor, { ...row("c", "ERP Phase 1", "g"), group_name: "Transformation" }]),
      group_by: "subtype:program",
    });
    renderWithProviders(<PortalPpmPortfolio slug="exec" portal={PROGRAM_PORTAL} />, {
      route: "/portal/exec",
      user: null,
      routes: [{ path: "/portal/exec" }],
    });
    await waitFor(() => expect(screen.getByText("ERP Phase 1")).toBeInTheDocument());
    expect(publicGet.mock.calls[0][0]).toBe(
      "/web-portals/public/exec/ppm/portfolio?group_by=subtype%3Aprogram",
    );
    // The Group by control names the subtype by its label, and the program is
    // its group's header with its line beneath, never a row.
    expect(screen.getAllByRole("combobox")[0]).toHaveTextContent("Programme");
    expect(screen.getByText("Transformation")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-anchor-line]")).toHaveLength(1);
    expect(document.querySelector("[data-anchor-line]")).toHaveTextContent("Programme");
    expect(
      Array.from(document.querySelectorAll("[data-depth]")).map((el) => el.textContent),
    ).toEqual(["ERP Phase 1"]);
  });
});
