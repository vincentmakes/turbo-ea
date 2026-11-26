/**
 * A relation's own lifecycle on card detail.
 *
 * A relation may carry the five card phases. What card detail owes:
 *  - a row whose dates say something carries a chip — planned, "until" an end
 *    ahead, or ended — whatever the type's Track lifecycle switch says;
 *  - the clock that edits the dates is offered only when the type tracks a
 *    lifecycle AND the person may manage relations, and saves a PATCH whose
 *    response is merged into the row;
 *  - ended rows are tucked behind a per-group toggle, and the counts and the
 *    mandatory hint read the relations IN EFFECT — exactly what the backend's
 *    completeness score reads, so the two never disagree.
 *
 * Dates sit far in the past (2000) or the future (2999) so the cases hold
 * whatever day the suite runs.
 */
import { fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: MemoryRouter });

vi.mock("@/hooks/AuthContext", () => ({
  useOptionalAuthUser: () => null,
  useAuthContext: () => ({
    user: { id: "u1", email: "a@test.com", display_name: "Admin", permissions: { "*": true } },
    refreshUser: vi.fn(),
  }),
}));

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class extends Error {},
  isAbortError: () => false,
}));

// A recognisable format, so a test can tell the date was put through it.
vi.mock("@/hooks/useDateFormat", () => ({
  useDateFormat: () => ({
    formatDate: (d?: string | null) => (d ? `<${d}>` : ""),
    formatDateTime: (d?: string | null) => (d ? `<${d}>` : ""),
  }),
}));

const mm = vi.hoisted(() => ({ relationTypes: [] as Record<string, unknown>[] }));

const ORG_TYPE = { key: "Organization", label: "Organization", color: "#2889ff", subtypes: [] };
const APP_TYPE = { key: "Application", label: "Application", color: "#0f7eb5", subtypes: [] };

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    getType: (key: string) =>
      key === "Organization" ? ORG_TYPE : key === "Application" ? APP_TYPE : undefined,
    types: [APP_TYPE, ORG_TYPE],
    relationTypes: mm.relationTypes,
  }),
}));

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, useNavigate: () => vi.fn() };
});

import { api } from "@/api/client";
import type { Relation } from "@/types";
import RelationsSection from "./RelationsSection";

const FS = "app-1";

const usedBy = {
  key: "appToOrg",
  label: "is used by",
  reverse_label: "uses",
  source_type_key: "Application",
  target_type_key: "Organization",
  source_visible: true,
  target_visible: true,
  source_mandatory: false,
  target_mandatory: false,
  cardinality: "n:m",
  attributes_schema: [],
  lifecycle_enabled: true,
};

const PAST = "2000-01-01";
const FUTURE = "2999-01-01";

function relation(id: string, name: string, lifecycle?: Record<string, string>): Relation {
  return {
    id,
    type: "appToOrg",
    source_id: FS,
    target_id: `org-${id}`,
    source: { id: FS, type: "Application", name: "NexaCore ERP" },
    target: { id: `org-${id}`, type: "Organization", name },
    ...(lifecycle ? { lifecycle } : {}),
  };
}

function mockRows(rows: Relation[]) {
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url.startsWith("/relations")) return rows as never;
    return [] as never;
  });
}

async function openSection(props: Record<string, unknown> = {}) {
  render(<RelationsSection fsId={FS} cardTypeKey="Application" initialExpanded {...props} />);
  await waitFor(() => expect(api.get).toHaveBeenCalled());
}

/** The list row naming a related card. */
function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest("li") as HTMLElement;
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.patch).mockReset();
  mm.relationTypes = [usedBy];
});

describe("phase chip on the row", () => {
  it("says planned from the go-live date", async () => {
    mockRows([relation("1", "Finance", { plan: PAST, active: FUTURE })]);
    await openSection();
    const chip = await within(rowOf("Finance")).findByText(`Planned · from <${FUTURE}>`);
    expect(chip.closest("[data-phase]")).toHaveAttribute("data-phase", "plan");
  });

  it("says a bare Planned when no go-live date is set, in Phase In once that date passed", async () => {
    mockRows([relation("1", "Finance", { plan: PAST, phaseIn: PAST })]);
    await openSection();
    const chip = await within(rowOf("Finance")).findByText("Planned");
    expect(chip.closest("[data-phase]")).toHaveAttribute("data-phase", "phaseIn");
  });

  it("says until the end date when in effect with an end ahead", async () => {
    mockRows([relation("1", "Finance", { active: PAST, endOfLife: FUTURE })]);
    await openSection();
    const chip = await within(rowOf("Finance")).findByText(`Until <${FUTURE}>`);
    expect(chip.closest("[data-phase]")).toHaveAttribute("data-phase", "active");
  });

  it("draws an end ahead in Phase Out once that date passed", async () => {
    mockRows([relation("1", "Finance", { active: PAST, phaseOut: PAST, endOfLife: FUTURE })]);
    await openSection();
    const chip = await within(rowOf("Finance")).findByText(`Until <${FUTURE}>`);
    expect(chip.closest("[data-phase]")).toHaveAttribute("data-phase", "phaseOut");
  });

  it("says ended with the end date", async () => {
    mockRows([relation("1", "Finance", { active: PAST, endOfLife: "2001-02-03" })]);
    await openSection();
    await userEvent.click(await screen.findByRole("button", { name: /Show ended \(1\)$/ }));
    const chip = within(rowOf("Finance")).getByText("Ended <2001-02-03>");
    expect(chip.closest("[data-phase]")).toHaveAttribute("data-phase", "endOfLife");
  });

  it("shows no chip for an undated relation or one active with no end", async () => {
    mockRows([relation("1", "Finance"), relation("2", "Legal", { active: PAST })]);
    await openSection();
    await screen.findByText("Finance");
    expect(rowOf("Finance").querySelector("[data-phase]")).toBeNull();
    expect(rowOf("Legal").querySelector("[data-phase]")).toBeNull();
  });

  it("shows the chip on a type whose Track lifecycle switch is off", async () => {
    mm.relationTypes = [{ ...usedBy, lifecycle_enabled: false }];
    mockRows([relation("1", "Finance", { active: FUTURE })]);
    await openSection();
    expect(await within(rowOf("Finance")).findByText(`Planned · from <${FUTURE}>`)).toBeInTheDocument();
  });
});

describe("the clock", () => {
  it("is offered only when the type tracks a lifecycle and the person may manage relations", async () => {
    mockRows([relation("1", "Finance")]);
    await openSection();
    await screen.findByText("Finance");
    expect(
      within(rowOf("Finance")).getByRole("button", { name: "Set relation dates" }),
    ).toBeInTheDocument();
  });

  it("is absent when the type does not track a lifecycle", async () => {
    mm.relationTypes = [{ ...usedBy, lifecycle_enabled: false }];
    mockRows([relation("1", "Finance", { active: PAST, endOfLife: FUTURE })]);
    await openSection();
    await screen.findByText("Finance");
    expect(within(rowOf("Finance")).queryByRole("button", { name: /relation dates/ })).toBeNull();
  });

  it("is absent without manage permission", async () => {
    mockRows([relation("1", "Finance")]);
    await openSection({ canManageRelations: false });
    await screen.findByText("Finance");
    expect(within(rowOf("Finance")).queryByRole("button", { name: /relation dates/ })).toBeNull();
  });

  it("is muted and dashed while undated, primary once dated", async () => {
    mockRows([relation("1", "Finance"), relation("2", "Legal", { active: PAST })]);
    await openSection();
    await screen.findByText("Finance");
    const undated = within(rowOf("Finance")).getByRole("button", { name: "Set relation dates" });
    const dated = within(rowOf("Legal")).getByRole("button", { name: "Edit relation dates" });
    expect(undated).toHaveStyle({ borderStyle: "dashed" });
    expect(dated).not.toHaveStyle({ borderStyle: "dashed" });
  });

  it("saves the dates as a PATCH, merges the response into the row and refreshes the card", async () => {
    const onCardUpdate = vi.fn();
    mockRows([relation("1", "Finance")]);
    vi.mocked(api.patch).mockResolvedValue({
      ...relation("1", "Finance"),
      source: undefined,
      target: undefined,
      lifecycle: { active: FUTURE },
    } as never);
    await openSection({ onCardUpdate });
    await screen.findByText("Finance");
    await userEvent.click(
      within(rowOf("Finance")).getByRole("button", { name: "Set relation dates" }),
    );

    const popover = await screen.findByRole("presentation");
    expect(within(popover).getByText("Relation lifecycle")).toBeInTheDocument();
    // One field per phase, labelled with the card lifecycle's phase names.
    for (const label of ["Plan", "Phase In", "Active", "Phase Out", "End of Life"]) {
      expect(within(popover).getByLabelText(label)).toBeInTheDocument();
    }
    fireEvent.change(within(popover).getByLabelText("Active"), { target: { value: FUTURE } });
    await userEvent.click(within(popover).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/relations/1", { lifecycle: { active: FUTURE } }),
    );
    // The row keeps its card name (the response carried no refs) and now
    // carries the planned chip from the merged dates.
    expect(
      await within(rowOf("Finance")).findByText(`Planned · from <${FUTURE}>`),
    ).toBeInTheDocument();
    expect(onCardUpdate).toHaveBeenCalledTimes(1);
  });

  it("shows the out-of-order warning the card lifecycle shows", async () => {
    mockRows([relation("1", "Finance", { active: "2010-01-01", endOfLife: "2005-01-01" })]);
    await openSection();
    await userEvent.click(await screen.findByRole("button", { name: /Show ended \(1\)$/ }));
    await userEvent.click(
      within(rowOf("Finance")).getByRole("button", { name: "Edit relation dates" }),
    );
    const popover = await screen.findByRole("presentation");
    expect(within(popover).getByText("After End of Life (<2005-01-01>)")).toBeInTheDocument();
  });

  it("clears every date and sends an empty lifecycle", async () => {
    mockRows([relation("1", "Finance", { plan: PAST, active: FUTURE })]);
    vi.mocked(api.patch).mockResolvedValue({ ...relation("1", "Finance"), lifecycle: {} } as never);
    await openSection();
    await screen.findByText("Finance");
    await userEvent.click(
      within(rowOf("Finance")).getByRole("button", { name: "Edit relation dates" }),
    );
    const popover = await screen.findByRole("presentation");
    expect(within(popover).getByLabelText("Active")).toHaveValue(FUTURE);
    const clear = within(popover).getByRole("button", { name: /Clear dates$/ });
    expect(clear).toBeEnabled();
    await userEvent.click(clear);
    expect(within(popover).getByLabelText("Active")).toHaveValue("");
    expect(clear).toBeDisabled();
    await userEvent.click(within(popover).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/relations/1", { lifecycle: {} }));
    await waitFor(() => expect(rowOf("Finance").querySelector("[data-phase]")).toBeNull());
  });

  it("keeps the popover open and says why when the save fails", async () => {
    mockRows([relation("1", "Finance")]);
    vi.mocked(api.patch).mockRejectedValue(new Error("Unknown lifecycle phase"));
    await openSection();
    await screen.findByText("Finance");
    await userEvent.click(
      within(rowOf("Finance")).getByRole("button", { name: "Set relation dates" }),
    );
    const popover = await screen.findByRole("presentation");
    await userEvent.click(within(popover).getByRole("button", { name: "Save" }));
    expect(await within(popover).findByText("Unknown lifecycle phase")).toBeInTheDocument();
  });

  it("cancels without a PATCH", async () => {
    mockRows([relation("1", "Finance")]);
    await openSection();
    await screen.findByText("Finance");
    await userEvent.click(
      within(rowOf("Finance")).getByRole("button", { name: "Set relation dates" }),
    );
    const popover = await screen.findByRole("presentation");
    await userEvent.click(within(popover).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText("Relation lifecycle")).toBeNull());
    expect(api.patch).not.toHaveBeenCalled();
  });
});

describe("ended relations are tucked away", () => {
  it("hides ended rows behind a per-group toggle, keeping planned ones in view", async () => {
    mockRows([
      relation("1", "Finance"),
      relation("2", "Legal", { active: PAST, endOfLife: "2001-01-01" }),
      relation("3", "Sales", { active: FUTURE }),
    ]);
    await openSection();
    await screen.findByText("Finance");
    expect(screen.queryByText("Legal")).toBeNull();
    expect(screen.getByText("Sales")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Show ended \(1\)$/ }));
    expect(screen.getByText("Legal")).toBeInTheDocument();
    expect(rowOf("Legal")).toHaveAttribute("data-ended", "true");
    expect(rowOf("Finance")).not.toHaveAttribute("data-ended");

    await userEvent.click(screen.getByRole("button", { name: /Hide ended$/ }));
    expect(screen.queryByText("Legal")).toBeNull();
  });

  it("counts every ended row in the toggle", async () => {
    mockRows([
      relation("1", "Finance", { endOfLife: PAST }),
      relation("2", "Legal", { endOfLife: "2001-01-01" }),
    ]);
    await openSection();
    expect(await screen.findByRole("button", { name: /Show ended \(2\)$/ })).toBeInTheDocument();
  });

  it("offers no toggle when nothing has ended", async () => {
    mockRows([relation("1", "Finance", { active: FUTURE })]);
    await openSection();
    await screen.findByText("Finance");
    expect(screen.queryByRole("button", { name: /Show ended/ })).toBeNull();
  });

  it("hides ended rows inside the provider / consumer buckets too, and counts only rows in effect", async () => {
    mm.relationTypes = [
      {
        ...usedBy,
        attributes_schema: [
          {
            key: "flowDirection",
            label: "Flow",
            type: "single_select",
            options: [
              { key: "forward", label: "Forward" },
              { key: "reverse", label: "Reverse" },
            ],
          },
        ],
      },
    ];
    const withFlow = (r: Relation) => ({ ...r, attributes: { flowDirection: "forward" } });
    mockRows([
      withFlow(relation("1", "Finance")),
      withFlow(relation("2", "Legal", { endOfLife: PAST })),
      withFlow(relation("3", "Sales", { active: FUTURE })),
    ]);
    await openSection();
    await screen.findByText("Finance");
    expect(screen.queryByText("Legal")).toBeNull();
    const header = screen.getByText("Provided Organization").parentElement as HTMLElement;
    // Finance counts; Sales is planned and Legal ended.
    expect(within(header).getByText("1")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Show ended \(1\)$/ }));
    expect(screen.getByText("Legal")).toBeInTheDocument();
    expect(within(header).getByText("1")).toBeInTheDocument();
  });
});

describe("counts and the mandatory hint read relations in effect", () => {
  const mandatory = { ...usedBy, source_mandatory: true };

  it("flags a required side whose only relations are planned or ended", async () => {
    mm.relationTypes = [mandatory];
    mockRows([
      relation("1", "Finance", { active: FUTURE }),
      relation("2", "Legal", { endOfLife: PAST }),
    ]);
    await openSection();
    await screen.findByText("Finance");
    expect(
      screen.getByText("None of these relations is in effect today — this relation is required."),
    ).toBeInTheDocument();
    // Not the "no relations yet" hint: there are rows.
    expect(screen.queryByText("No relations yet — this relation is required.")).toBeNull();
  });

  it("does not flag a required side with a relation in effect", async () => {
    mm.relationTypes = [mandatory];
    mockRows([relation("1", "Finance"), relation("2", "Legal", { active: FUTURE })]);
    await openSection();
    await screen.findByText("Finance");
    expect(screen.queryByText(/None of these relations is in effect today/)).toBeNull();
  });

  it("does not flag an optional side whose relations are all planned", async () => {
    mockRows([relation("1", "Finance", { active: FUTURE })]);
    await openSection();
    await screen.findByText("Finance");
    expect(screen.queryByText(/None of these relations is in effect today/)).toBeNull();
  });

  it("keeps the plain empty hint for a required side with no relation at all", async () => {
    mm.relationTypes = [mandatory];
    mockRows([]);
    await openSection();
    expect(
      await screen.findByText("No relations yet — this relation is required."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/None of these relations is in effect today/)).toBeNull();
  });

  it("counts only relations in effect in the section header", async () => {
    mockRows([
      relation("1", "Finance"),
      relation("2", "Legal", { endOfLife: PAST }),
      relation("3", "Sales", { active: FUTURE }),
      relation("4", "Marketing", { active: PAST, endOfLife: FUTURE }),
    ]);
    await openSection();
    await screen.findByText("Finance");
    const summary = screen.getByText("Relations").parentElement as HTMLElement;
    expect(within(summary).getByText("2")).toBeInTheDocument();
  });
});
