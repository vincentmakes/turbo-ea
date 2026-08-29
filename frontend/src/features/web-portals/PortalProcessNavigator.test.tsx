import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";

/*
 * The load-bearing mock.
 *
 * The navigator's data access goes through a source injected on the context, but
 * that is a convention rather than a type-level guarantee: a new `api.get` added
 * inside one of its sub-components would compile and then 401 every portal
 * visitor. Making the authenticated client throw on any call is what turns that
 * silent breakage into a failing test.
 */
const apiCalled = vi.fn();
vi.mock("@/api/client", () => {
  const boom = (...args: unknown[]) => {
    apiCalled(...args);
    throw new Error("A portal must never call the authenticated API client");
  };
  return { api: { get: boom, post: boom, patch: boom, put: boom, delete: boom } };
});

// The metamodel is unreachable without a session; the portal must resolve its
// process types from the public payload's fields_schema instead.
vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => {
    throw new Error("A portal must never read the metamodel");
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => {
    throw new Error("A portal has no authenticated user");
  },
}));

vi.mock("@/features/bpm/BpmnViewer", () => ({
  default: ({ bpmnXml }: { bpmnXml: string }) => (
    <div data-testid="bpmn-viewer">{bpmnXml ? "BPMN loaded" : ""}</div>
  ),
}));

const publicGet = vi.fn();
vi.mock("./publicApi", () => ({ publicGet: (...a: unknown[]) => publicGet(...a) }));

import PortalProcessNavigator from "./PortalProcessNavigator";
import type { PublicPortal } from "@/types";

const PORTAL = {
  id: "p1",
  name: "Process House",
  slug: "house",
  card_type: "BusinessProcess",
  view: "process_navigator",
  card_config: {},
  type_info: {
    key: "BusinessProcess",
    label: "Business Process",
    icon: "route",
    color: "#028f00",
    subtypes: [],
    fields_schema: [
      {
        section: "Classification",
        fields: [
          {
            key: "processType",
            label: "Process Type",
            type: "single_select",
            options: [
              { key: "core", label: "Core", color: "#1976d2" },
              { key: "support", label: "Support", color: "#607d8b" },
              { key: "management", label: "Management", color: "#9c27b0" },
            ],
          },
        ],
      },
    ],
  },
  relation_types: [],
  tag_groups: [],
} as unknown as PublicPortal;

const MAP = {
  row_order: ["management", "core", "support"],
  organizations: [{ token: "o0", name: "Finance Dept" }],
  items: [
    {
      id: "proc-1",
      name: "Order to Cash",
      subtype: "core",
      parent_id: null,
      description: "How money reaches the company",
      lifecycle: { active: "2026-01-01" },
      attributes: { processType: "core", maturity: "managed" },
      org_tokens: ["o0"],
      has_flow: true,
      step_count: 2,
    },
  ],
};

const FLOW = {
  revision: 1,
  bpmn_xml: "<definitions/>",
  svg_thumbnail: null,
  steps: [
    {
      bpmn_element_id: "Task_1",
      element_type: "task",
      name: "Approve order",
      lane_name: "Finance",
      is_automated: false,
      sequence_order: 0,
      application_name: null,
      data_object_name: null,
      it_component_name: null,
      organizations: [],
    },
  ],
};

/** Surfaces the router's query string, which MemoryRouter keeps off window.location. */
function LocationProbe() {
  return <div data-testid="search">{useLocation().search}</div>;
}

function renderPortal(portal: PublicPortal = PORTAL) {
  return render(
    <MemoryRouter>
      <PortalProcessNavigator slug="house" portal={portal} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  publicGet.mockImplementation((path: string) =>
    path.includes("/flow") ? Promise.resolve(FLOW) : Promise.resolve(MAP),
  );
});

describe("PortalProcessNavigator", () => {
  it("renders the house from the public payload alone", async () => {
    renderPortal();
    expect(await screen.findByText("Order to Cash")).toBeInTheDocument();
    expect(apiCalled).not.toHaveBeenCalled();
    expect(publicGet).toHaveBeenCalledWith(
      "/web-portals/public/house/bpm/process-map",
      expect.anything(),
    );
  });

  it("never links to a card", async () => {
    const { container } = renderPortal();
    await screen.findByText("Order to Cash");
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs.some((h) => h?.includes("/cards/"))).toBe(false);
  });

  it("offers the house view only — no matrix, no dependencies", async () => {
    renderPortal();
    await screen.findByText("Order to Cash");
    expect(screen.queryByRole("button", { name: /matrix/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /dependenc/i })).not.toBeInTheDocument();
  });

  it("opens a drawer with Overview, Steps and Flow but not Apps or Data", async () => {
    const user = userEvent.setup();
    renderPortal();
    await user.click(await screen.findByText("Order to Cash"));

    await waitFor(() => expect(screen.getAllByRole("tab").length).toBe(3));
    const tabNames = screen.getAllByRole("tab").map((t) => t.textContent ?? "");
    expect(tabNames.some((n) => /app/i.test(n))).toBe(false);
    expect(tabNames.some((n) => /data/i.test(n))).toBe(false);
  });

  it("shows the description from the map rather than fetching the card", async () => {
    const user = userEvent.setup();
    renderPortal();
    await user.click(await screen.findByText("Order to Cash"));
    expect(await screen.findByText("How money reaches the company")).toBeInTheDocument();
    expect(apiCalled).not.toHaveBeenCalled();
  });

  it("renders the published flow through the shared viewer", async () => {
    const user = userEvent.setup();
    renderPortal();
    await user.click(await screen.findByText("Order to Cash"));
    const tabs = await screen.findAllByRole("tab");
    await user.click(tabs[2]);

    await waitFor(() =>
      expect(publicGet).toHaveBeenCalledWith(
        "/web-portals/public/house/bpm/processes/proc-1/flow",
        expect.anything(),
      ),
    );
    expect(apiCalled).not.toHaveBeenCalled();
  });

  it("opens at the level and overlay the portal configures", async () => {
    // The stored-preference reader looks for `displayLevel`, not `level`, so a
    // configured opening level was silently ignored until the container mapped
    // the two. The URL is where that choice becomes observable: the navigator
    // writes a parameter only when the state departs from the built-in default.
    renderPortal({
      ...PORTAL,
      card_config: { bpm: { default_level: 4, default_overlay: "riskLevel" } },
    } as unknown as PublicPortal);
    await screen.findByText("Order to Cash");
    await waitFor(() => {
      const search = screen.getByTestId("search").textContent ?? "";
      expect(search).toContain("level=4");
      expect(search).toContain("overlay=riskLevel");
    });
  });

  it("shows a step without linked-system names when the switch is off", async () => {
    const user = userEvent.setup();
    renderPortal();
    await user.click(await screen.findByText("Order to Cash"));
    const tabs = await screen.findAllByRole("tab");
    await user.click(tabs[1]);

    expect(await screen.findByText("Approve order")).toBeInTheDocument();
    // `show_element_links` is off by default, so the backend sends no names and
    // the row renders none. Nothing here should name a system.
    expect(screen.queryByText("SecretERP")).not.toBeInTheDocument();
  });

  it("publishes linked-system names when the portal enables them", async () => {
    const user = userEvent.setup();
    publicGet.mockImplementation((path: string) =>
      path.includes("/flow")
        ? Promise.resolve({
            ...FLOW,
            steps: [{ ...FLOW.steps[0], application_name: "NexaCore ERP" }],
          })
        : Promise.resolve(MAP),
    );
    renderPortal();
    await user.click(await screen.findByText("Order to Cash"));
    const tabs = await screen.findAllByRole("tab");
    await user.click(tabs[1]);

    expect(await screen.findByText("NexaCore ERP")).toBeInTheDocument();
  });
});
