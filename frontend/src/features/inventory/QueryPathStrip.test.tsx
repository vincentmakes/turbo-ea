import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  makeCardType,
  makeField,
  makeOption,
  makeRelationType,
  makeSection,
  makeSubtype,
} from "@/test/fixtures/metamodel";
import type { ActiveQuery } from "@/types";
import QueryPathStrip from "./QueryPathStrip";

vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useIsRtl", () => import("@/test/hooks").then((m) => m.useIsRtlModule()));

import { hookState, withMetamodel } from "@/test/hooks";

// Labels deliberately differ from keys, so a key leaking into the strip fails.
const ORG = makeCardType({ key: "Organization", label: "Org Unit", icon: "corporate_fare" });
const APP = makeCardType({
  key: "Application",
  label: "Business App",
  icon: "apps",
  fields_schema: [
    makeSection({
      fields: [
        makeField({
          key: "criticality",
          label: "Business Criticality",
          type: "single_select",
          options: [makeOption({ key: "high", label: "Mission critical" })],
        }),
        makeField({ key: "isCloud", label: "Cloud hosted", type: "boolean" }),
      ],
    }),
  ],
});
const INIT = makeCardType({
  key: "Initiative",
  label: "Change Initiative",
  subtypes: [makeSubtype({ key: "proj", label: "Project" })],
  fields_schema: [
    makeSection({
      fields: [
        makeField({
          key: "initiativeStatus",
          label: "Delivery Status",
          type: "single_select",
          options: [makeOption({ key: "onTrack", label: "On Track" })],
        }),
      ],
    }),
  ],
});
const REL_ORG_TO_APP = makeRelationType({
  key: "relOrgToApp",
  label: "uses",
  reverse_label: "is used by",
  source_type_key: "Organization",
  target_type_key: "Application",
});
const REL_INIT_TO_APP = makeRelationType({
  key: "relInitiativeToApp",
  label: "affects",
  reverse_label: "is affected by",
  source_type_key: "Initiative",
  target_type_key: "Application",
});

const VIEW: ActiveQuery = {
  viewId: "bm-q",
  name: "Orgs on live apps in flight",
  createdVia: "mcp",
  query: {
    type: "Organization",
    where: { approval_status: ["APPROVED"] },
    related: [
      {
        relation: "relOrgToApp",
        type: "Application",
        where: {
          lifecycle_phase: ["active", "none"],
          attributes: { criticality: ["high", "__empty__"], isCloud: ["true"] },
        },
        related: [
          {
            relation: "relInitiativeToApp",
            type: "Initiative",
            where: { subtype: ["proj"], attributes: { initiativeStatus: ["onTrack"] } },
          },
        ],
      },
      { relation: "relOrgToApp", type: "Application", negate: true },
    ],
  },
};

beforeEach(() => {
  hookState.reset();
  withMetamodel([ORG, APP, INIT], [REL_ORG_TO_APP, REL_INIT_TO_APP]);
});

function arrows(): HTMLElement[] {
  return screen
    .getAllByTestId("query-path-hop")
    .map((hop) => within(hop).getAllByText("arrow_forward")[0]);
}

describe("QueryPathStrip", () => {
  it("renders nothing without an active query", () => {
    const { container } = render(<QueryPathStrip view={null} onLeave={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the view and says it is generated and editable only via MCP", () => {
    render(<QueryPathStrip view={VIEW} onLeave={() => {}} />);
    const strip = screen.getByTestId("query-path-strip");
    expect(strip.querySelector('[data-origin="mcp"]')).not.toBeNull();
    expect(within(strip).getByText("Orgs on live apps in flight")).toBeInTheDocument();
    const caption = within(strip).getByText("Generated via MCP · editable only via MCP");
    // The tooltip explains what can and cannot be changed here.
    expect(caption).toHaveAttribute(
      "title",
      expect.stringContaining("Ask the assistant to change or re-save it"),
    );
  });

  it("resolves type labels, never keys", () => {
    render(<QueryPathStrip view={VIEW} onLeave={() => {}} />);
    expect(screen.getByText("Org Unit")).toBeInTheDocument();
    expect(screen.getAllByText("Business App")).toHaveLength(2);
    expect(screen.getByText("Change Initiative")).toBeInTheDocument();
    expect(screen.queryByText("Organization")).not.toBeInTheDocument();
    expect(screen.queryByText("Initiative")).not.toBeInTheDocument();
  });

  it("reads each hop's verb from the side under view", () => {
    render(<QueryPathStrip view={VIEW} onLeave={() => {}} />);
    const hops = screen.getAllByTestId("query-path-hop");
    expect(hops).toHaveLength(3);
    // Organization is relOrgToApp's source: the forward verb.
    expect(within(hops[0]).getAllByText("uses")[0]).toBeInTheDocument();
    // Application is relInitiativeToApp's target: the reverse verb.
    expect(within(hops[1]).getByText("is affected by")).toBeInTheDocument();
    expect(screen.queryByText("affects")).not.toBeInTheDocument();
  });

  it("prefixes a negated hop with has no and joins sibling hops with and", () => {
    render(<QueryPathStrip view={VIEW} onLeave={() => {}} />);
    const hops = screen.getAllByTestId("query-path-hop");
    expect(within(hops[2]).getByText("has no uses")).toBeInTheDocument();
    expect(screen.getAllByText("and")).toHaveLength(1);
    expect(screen.getAllByText(/has no/)).toHaveLength(1);
  });

  it("labels each condition with its field and option labels", () => {
    render(<QueryPathStrip view={VIEW} onLeave={() => {}} />);
    expect(screen.getByText("Approval Status: Approved")).toBeInTheDocument();
    expect(screen.getByText("Lifecycle: Active, (empty)")).toBeInTheDocument();
    expect(screen.getByText("Business Criticality: Mission critical, (empty)")).toBeInTheDocument();
    expect(screen.getByText("Cloud hosted: Yes")).toBeInTheDocument();
    expect(screen.getByText("Subtype: Project")).toBeInTheDocument();
    expect(screen.getByText("Delivery Status: On Track")).toBeInTheDocument();
  });

  it("shows No for a false flag and the raw value for free text", () => {
    const view: ActiveQuery = {
      ...VIEW,
      query: {
        type: "Application",
        where: { attributes: { isCloud: ["false"], notInSchema: ["abc"] } },
      },
    };
    render(<QueryPathStrip view={view} onLeave={() => {}} />);
    expect(screen.getByText("Cloud hosted: No")).toBeInTheDocument();
    expect(screen.getByText("notInSchema: abc")).toBeInTheDocument();
    expect(screen.queryByTestId("query-path-hop")).not.toBeInTheDocument();
  });

  it("leaves the view from the close button", () => {
    const onLeave = vi.fn();
    render(<QueryPathStrip view={VIEW} onLeave={onLeave} />);
    const leave = screen.getByRole("button", { name: "Leave this view" });
    expect(leave).toHaveAttribute("data-testid", "query-path-leave");
    expect(onLeave).not.toHaveBeenCalled();
    fireEvent.click(leave);
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("points the arrows the reading direction", () => {
    const { unmount } = render(<QueryPathStrip view={VIEW} onLeave={() => {}} />);
    for (const arrow of arrows()) expect(arrow.style.transform).toBe("");
    unmount();

    hookState.isRtl = true;
    render(<QueryPathStrip view={VIEW} onLeave={() => {}} />);
    const flipped = arrows();
    expect(flipped).toHaveLength(3);
    for (const arrow of flipped) expect(arrow.style.transform).toBe("scaleX(-1)");
  });
});
