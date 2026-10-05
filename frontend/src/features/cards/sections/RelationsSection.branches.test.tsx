/**
 * RelationsSection branches beyond `RelationsSection.test.tsx`: subtype
 * grouping (auto and manual), Provider / Consumer buckets for a `flowDirection`
 * type, the attribute popover's save / error / cancel, row delete and
 * navigation, mandatory groups, the descendant roll-up chip, relation types
 * with no group of their own (the Add menu), and the side a self-referencing
 * type hands the add dialog.
 *
 * `AddRelationsDialog` and `DescendantRelationsDrawer` are stubbed to the props
 * the section passes them; each has its own tests.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

vi.mock("./AddRelationsDialog", () => ({
  default: ({
    open,
    onClose,
    relationType,
    isSource,
  }: {
    open: boolean;
    onClose: (added: number) => void;
    relationType: { key: string } | null;
    isSource: boolean;
  }) =>
    open ? (
      <div data-testid="add-dialog" data-rt={relationType?.key} data-source={String(isSource)}>
        <button onClick={() => onClose(0)}>add-close-none</button>
        <button onClick={() => onClose(2)}>add-close-two</button>
      </div>
    ) : null,
}));
vi.mock("./DescendantRelationsDrawer", () => ({
  default: ({ open, onClose, rt, isSource }: { open: boolean; onClose: () => void; rt: { key: string }; isSource: boolean }) =>
    open ? (
      <div data-testid="rollup-drawer" data-rt={rt.key} data-source={String(isSource)}>
        <button onClick={onClose}>rollup-close</button>
      </div>
    ) : null,
}));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import {
  makeCardType,
  makeField,
  makeOption,
  makeRelationType,
  makeSubtype,
} from "@/test/fixtures/metamodel";
import { renderWithProviders } from "@/test/render";
import type { Relation, RelationType } from "@/types";
import RelationsSection from "./RelationsSection";

const FS = "app-1";

const APP = makeCardType({ key: "Application", label: "Application", has_hierarchy: true });
const ORG = makeCardType({
  key: "Organization",
  label: "Organization",
  color: "#2889ff",
  subtypes: [
    makeSubtype({ key: "bu", label: "Business Unit" }),
    makeSubtype({ key: "region", label: "Region" }),
  ],
});
const ITF = makeCardType({ key: "Interface", label: "Interface" });
const OBJ = makeCardType({ key: "Objective", label: "Objective" });

const SIDES = { source_visible: true, target_visible: true, source_mandatory: false, target_mandatory: false };

const APP_TO_ORG = makeRelationType({
  key: "appToOrg",
  label: "is used by",
  reverse_label: "uses",
  source_type_key: "Application",
  target_type_key: "Organization",
  cardinality: "n:m",
  ...SIDES,
  attributes_schema: [
    makeField({
      key: "usageType",
      label: "Usage Type",
      type: "single_select",
      options: [
        makeOption({ key: "owner", label: "Owner", color: "#1976d2" }),
        makeOption({ key: "user", label: "User" }),
      ],
    }),
    makeField({ key: "critical", label: "Critical", type: "boolean" }),
  ],
} as Partial<RelationType> & { key: string });

const APP_TO_ITF = makeRelationType({
  key: "appToItf",
  label: "provides",
  reverse_label: "is provided by",
  source_type_key: "Application",
  target_type_key: "Interface",
  cardinality: "n:m",
  ...SIDES,
  attributes_schema: [
    makeField({
      key: "flowDirection",
      label: "Flow",
      type: "single_select",
      options: [
        makeOption({ key: "forward", label: "Forward" }),
        makeOption({ key: "reverse", label: "Reverse" }),
        makeOption({ key: "bidirectional", label: "Both" }),
      ],
    }),
  ],
} as Partial<RelationType> & { key: string });

const APP_TO_OBJ_MANDATORY = makeRelationType({
  key: "appToObj",
  label: "supports",
  reverse_label: "is supported by",
  source_type_key: "Application",
  target_type_key: "Objective",
  cardinality: "n:1",
  ...SIDES,
  source_mandatory: true,
} as Partial<RelationType> & { key: string });

function rel(
  id: string,
  name: string,
  opts: { type?: string; targetType?: string; subtype?: string; attributes?: Record<string, unknown> } = {},
): Relation {
  const targetType = opts.targetType ?? "Organization";
  return {
    id,
    type: opts.type ?? "appToOrg",
    source_id: FS,
    target_id: `t-${id}`,
    attributes: opts.attributes,
    source: { id: FS, type: "Application", name: "NexaCore ERP" },
    target: { id: `t-${id}`, type: targetType, name, subtype: opts.subtype },
  } as Relation;
}

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderSection(
  props: Partial<{ canManageRelations: boolean; onCardUpdate: () => void; cardTypeKey: string; fsId: string; initialExpanded: boolean }> = {},
) {
  return renderWithProviders(
    <>
      <RelationsSection
        fsId={props.fsId ?? FS}
        cardTypeKey={props.cardTypeKey ?? "Application"}
        initialExpanded={props.initialExpanded ?? true}
        canManageRelations={props.canManageRelations}
        onCardUpdate={props.onCardUpdate}
      />
      <LocationProbe />
    </>,
    { route: `/cards/${FS}` },
  );
}

function routeRelations(rows: Relation[], cardId = FS) {
  mockApi.on("get", `/relations?card_id=${cardId}`, rows);
}

beforeEach(() => {
  hookState.reset();
  mockApi.reset();
  withMetamodel([APP, ORG, ITF, OBJ], [APP_TO_ORG]);
  mockApi.on("get", /\/descendant-relations\/summary$/, []);
  routeRelations([]);
});

describe("RelationsSection — rows", () => {
  it("navigates to the related card and deletes a row, refreshing the card", async () => {
    let rows = [rel("1", "Finance"), rel("2", "Legal")];
    mockApi.on("get", `/relations?card_id=${FS}`, () => rows);
    mockApi.on("delete", "/relations/1", () => {
      rows = [rel("2", "Legal")];
      return undefined;
    });
    const onCardUpdate = vi.fn();
    const { user } = renderSection({ onCardUpdate });

    await user.click(await screen.findByText("Legal"));
    expect(screen.getByTestId("location")).toHaveTextContent("/cards/t-2");

    const financeRow = screen.getByText("Finance").closest("li") as HTMLElement;
    await user.click(within(financeRow).getByRole("button", { name: /^close$/ }));
    await waitFor(() => expect(screen.queryByText("Finance")).not.toBeInTheDocument());
    expect(onCardUpdate).toHaveBeenCalled();
  });

  it("shows the section empty state when the relations cannot be loaded and no group is shown", async () => {
    withMetamodel([APP, ORG], [{ ...APP_TO_ORG, source_visible: false }]);
    mockApi.fail("get", `/relations?card_id=${FS}`, 500);
    renderSection();
    expect(await screen.findByText("No relations yet.")).toBeInTheDocument();
  });

  it("labels a row with no resolvable other end as unknown", async () => {
    routeRelations([{ ...rel("1", "x"), target: undefined } as unknown as Relation]);
    renderSection();
    expect(await screen.findByText("Unknown")).toBeInTheDocument();
  });

  it("collapses and re-expands the section", async () => {
    routeRelations([rel("1", "Finance")]);
    const { user } = renderSection();
    await screen.findByText("Finance");
    const summary = screen.getByRole("button", { name: /Relations/ });
    expect(summary).toHaveAttribute("aria-expanded", "true");
    await user.click(summary);
    expect(summary).toHaveAttribute("aria-expanded", "false");
  });
});

describe("RelationsSection — attribute popover", () => {
  it("edits a relation's attributes and shows the saved value as a pill", async () => {
    routeRelations([rel("1", "Finance")]);
    mockApi.on("patch", "/relations/1", (_p: string, body: unknown) => ({
      ...rel("1", "Finance"),
      attributes: (body as { attributes: Record<string, unknown> }).attributes,
      description: "updated",
    }));
    const { user } = renderSection();

    await user.click(await screen.findByRole("button", { name: "Edit details" }));
    expect(await screen.findByText("Optional details")).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Usage Type" }));
    await user.click(await screen.findByRole("option", { name: "Owner" }));
    await user.click(screen.getByRole("checkbox", { name: "Critical" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByText("Optional details")).not.toBeInTheDocument());
    expect(mockApi.callsOf("patch", "/relations/1")[0].body).toEqual({
      attributes: { usageType: "owner", critical: true },
    });
    expect(screen.getByText("Owner")).toBeInTheDocument();
    // The flag's tooltip is its label alone; the select's is "field: value".
    expect(screen.getByRole("button", { name: "Usage Type: Owner, Critical" })).toBeInTheDocument();
  });

  it("keeps the popover open with the error, and cancels without saving", async () => {
    routeRelations([rel("1", "Finance", { attributes: { usageType: "user" } })]);
    mockApi.fail("patch", "/relations/1", 422);
    const { user } = renderSection();

    await user.click(await screen.findByRole("button", { name: "Usage Type: User" }));
    await user.click(await screen.findByRole("button", { name: "Save" }));
    const alert = await screen.findByText("PATCH /relations/1 failed");
    await user.click(within(alert.closest("[role=alert]") as HTMLElement).getByRole("button"));
    expect(screen.queryByText("PATCH /relations/1 failed")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText("Optional details")).not.toBeInTheDocument());
  });

  it("falls back to a generic message for a non-Error save failure", async () => {
    routeRelations([rel("1", "Finance")]);
    mockApi.on("patch", "/relations/1", () => Promise.reject("nope"));
    const { user } = renderSection();
    await user.click(await screen.findByRole("button", { name: "Edit details" }));
    await user.click(await screen.findByRole("button", { name: "Save" }));
    expect(await screen.findByText("Failed to create relation")).toBeInTheDocument();
  });
});

describe("RelationsSection — flowDirection buckets", () => {
  beforeEach(() => {
    withMetamodel([APP, ORG, ITF], [APP_TO_ITF]);
  });

  it("buckets rows into provided / consumed / unspecified from the source side", async () => {
    routeRelations([
      rel("f", "Orders API", { type: "appToItf", targetType: "Interface", attributes: { flowDirection: "forward" } }),
      rel("r", "Billing Feed", { type: "appToItf", targetType: "Interface", attributes: { flowDirection: "reverse" } }),
      rel("b", "Sync Bus", { type: "appToItf", targetType: "Interface", attributes: { flowDirection: "bidirectional" } }),
      rel("u", "Legacy Link", { type: "appToItf", targetType: "Interface" }),
    ]);
    renderSection();

    await screen.findByText("Legacy Link");
    const text = document.body.textContent ?? "";
    const at = (s: string) => text.indexOf(s);
    expect(at("Provided Interface")).toBeLessThan(at("Orders API"));
    expect(at("Orders API")).toBeLessThan(at("Consumed Interface"));
    expect(at("Consumed Interface")).toBeLessThan(at("Billing Feed"));
    // A bidirectional row sits in both buckets.
    expect(screen.getAllByText("Sync Bus")).toHaveLength(2);
    expect(at("Unspecified")).toBeLessThan(at("Legacy Link"));
    // The bidirectional row's button names its direction.
    expect(screen.getAllByRole("button", { name: "Bidirectional" })).toHaveLength(2);
  });

  it("names the buckets Provider / Consumer from the target side and shows empty buckets", async () => {
    const incoming = {
      ...rel("x", "ERP", { type: "appToItf", attributes: { flowDirection: "forward" } }),
      source_id: "app-9",
      target_id: "itf-1",
      source: { id: "app-9", type: "Application", name: "ERP" },
      target: { id: "itf-1", type: "Interface", name: "Orders API" },
    } as Relation;
    routeRelations([incoming], "itf-1");
    renderSection({ cardTypeKey: "Interface", fsId: "itf-1" });

    expect(await screen.findByText("Provider Application")).toBeInTheDocument();
    expect(screen.getByText("Consumer Application")).toBeInTheDocument();
    expect(screen.getByText("None yet")).toBeInTheDocument();
    expect(screen.queryByText("Unspecified")).not.toBeInTheDocument();
  });
});

describe("RelationsSection — subtype grouping", () => {
  it("offers a manual toggle with two subtypes present, and collapses a bucket", async () => {
    routeRelations([
      rel("1", "Sales", { subtype: "bu" }),
      rel("2", "EMEA", { subtype: "region" }),
      rel("3", "Ad-hoc team"),
    ]);
    const { user } = renderSection();
    await screen.findByText("Ad-hoc team");

    await user.click(screen.getByRole("button", { name: "Group by subtype" }));
    expect(screen.getByText("Business Unit")).toBeInTheDocument();
    expect(screen.getByText("No subtype")).toBeInTheDocument();

    await user.click(screen.getByText("Region"));
    await waitFor(() => expect(screen.queryByText("EMEA")).not.toBeInTheDocument());
    await user.click(screen.getByText("Region"));
    expect(await screen.findByText("EMEA")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show as flat list" }));
    expect(screen.queryByText("Business Unit")).not.toBeInTheDocument();
  });

  it("groups automatically once the list is long and diverse", async () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      rel(String(i), `Org ${i}`, { subtype: i % 2 ? "bu" : "region" }),
    );
    routeRelations(rows);
    renderSection();
    expect(await screen.findByText("Business Unit")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show as flat list" })).toBeInTheDocument();
  });
});

describe("RelationsSection — group decorations", () => {
  it("marks a mandatory empty group as required", async () => {
    withMetamodel([APP, OBJ], [APP_TO_OBJ_MANDATORY]);
    renderSection();
    expect(await screen.findByText("Required")).toBeInTheDocument();
    expect(screen.getByText("No relations yet — this relation is required.")).toBeInTheDocument();
  });

  it("shows the descendant roll-up chip and opens its drawer", async () => {
    mockApi.on("get", `/cards/${FS}/descendant-relations/summary`, [
      { relation_type_key: "appToOrg", direction: "outgoing", count: 3 },
    ]);
    const { user } = renderSection();

    await user.click(await screen.findByText("+3 in sub-items"));
    const drawer = await screen.findByTestId("rollup-drawer");
    expect(drawer).toHaveAttribute("data-rt", "appToOrg");
    expect(drawer).toHaveAttribute("data-source", "true");
    await user.click(screen.getByText("rollup-close"));
    expect(screen.queryByTestId("rollup-drawer")).not.toBeInTheDocument();
  });

  it("asks for no roll-up while the section is collapsed", async () => {
    renderSection({ initialExpanded: false });
    await waitFor(() => expect(mockApi.callsOf("get", `/relations?card_id=${FS}`)).toHaveLength(1));
    expect(mockApi.callsOf("get", /descendant-relations/)).toHaveLength(0);
  });

  it("shows no chip when the roll-up request fails", async () => {
    mockApi.fail("get", `/cards/${FS}/descendant-relations/summary`, 500);
    renderSection();
    await waitFor(() => expect(mockApi.callsOf("get", /descendant-relations/)).toHaveLength(1));
    expect(screen.queryByText(/in sub-item/)).not.toBeInTheDocument();
  });

  it("offers no add or delete controls to a read-only user", async () => {
    routeRelations([rel("1", "Finance")]);
    renderSection({ canManageRelations: false });
    await screen.findByText("Finance");
    expect(screen.queryByRole("button", { name: /Add Organization/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^close$/ })).not.toBeInTheDocument();
  });
});

describe("RelationsSection — types without a group of their own", () => {
  const hiddenObj = { ...APP_TO_OBJ_MANDATORY, source_mandatory: false, source_visible: false };

  it("lists a hidden type's rows while it has any, and adds through the menu", async () => {
    withMetamodel([APP, ORG, OBJ], [APP_TO_ORG, hiddenObj]);
    routeRelations([rel("o", "Grow revenue", { type: "appToObj", targetType: "Objective" })]);
    const { user } = renderSection();

    expect(await screen.findByText("Grow revenue")).toBeInTheDocument();
    expect(screen.getByText("supports")).toBeInTheDocument();
    // While it holds rows the group carries its own + as well.
    await user.click(screen.getByRole("button", { name: /Add Objective · supports/ }));
    expect(await screen.findByTestId("add-dialog")).toHaveAttribute("data-rt", "appToObj");
    await user.click(screen.getByText("add-close-none"));

    await user.click(screen.getByRole("button", { name: /Add Relation/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Objective — supports" }));
    const dialog = await screen.findByTestId("add-dialog");
    expect(dialog).toHaveAttribute("data-rt", "appToObj");

    // Closing with adds reconciles; closing without does not.
    const before = mockApi.callsOf("get", `/relations?card_id=${FS}`).length;
    await user.click(screen.getByText("add-close-two"));
    await waitFor(() =>
      expect(mockApi.callsOf("get", `/relations?card_id=${FS}`).length).toBe(before + 1),
    );
  });

  it("closes the add menu on Escape and the dialog without a reconcile when nothing was added", async () => {
    withMetamodel([APP, ORG, OBJ], [APP_TO_ORG, hiddenObj]);
    const { user } = renderSection();

    await user.click(await screen.findByRole("button", { name: /Add Relation/ }));
    await screen.findByRole("menuitem", { name: "Objective — supports" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menuitem")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Add Organization/ }));
    const before = mockApi.callsOf("get", `/relations?card_id=${FS}`).length;
    await user.click(await screen.findByText("add-close-none"));
    expect(screen.queryByTestId("add-dialog")).not.toBeInTheDocument();
    expect(mockApi.callsOf("get", `/relations?card_id=${FS}`)).toHaveLength(before);
  });
});

describe("RelationsSection — self-referencing type sides", () => {
  const ORG_TO_ORG = makeRelationType({
    key: "orgToOrg",
    label: "has site",
    reverse_label: "is site of",
    source_type_key: "Organization",
    target_type_key: "Organization",
    cardinality: "n:m",
    ...SIDES,
  } as Partial<RelationType> & { key: string });

  it("hands the add dialog the side whose + was clicked", async () => {
    withMetamodel([ORG], [ORG_TO_ORG]);
    routeRelations([], "hq");
    const { user } = renderSection({ cardTypeKey: "Organization", fsId: "hq" });

    await user.click(await screen.findByRole("button", { name: /Add Organization · is site of/ }));
    expect(await screen.findByTestId("add-dialog")).toHaveAttribute("data-source", "false");
    await user.click(screen.getByText("add-close-none"));

    await user.click(screen.getByRole("button", { name: /Add Organization · has site/ }));
    expect(await screen.findByTestId("add-dialog")).toHaveAttribute("data-source", "true");
  });

  it("rolls up each side separately", async () => {
    withMetamodel([{ ...ORG, has_hierarchy: true }], [ORG_TO_ORG]);
    routeRelations([], "hq");
    mockApi.on("get", "/cards/hq/descendant-relations/summary", [
      { relation_type_key: "orgToOrg", direction: "incoming", count: 2 },
    ]);
    const { user } = renderSection({ cardTypeKey: "Organization", fsId: "hq" });

    await user.click(await screen.findByText("+2 in sub-items"));
    expect(await screen.findByTestId("rollup-drawer")).toHaveAttribute("data-source", "false");
    // Exactly one chip: the outgoing side has nothing rolled up.
    expect(screen.getAllByText(/in sub-item/)).toHaveLength(1);
  });

  it("lists a hidden self-pair's incoming row under the reverse verb", async () => {
    withMetamodel([ORG], [{ ...ORG_TO_ORG, source_visible: false, target_visible: false }]);
    routeRelations(
      [
        {
          id: "in-1",
          type: "orgToOrg",
          source_id: "branch",
          target_id: "hq",
          source: { id: "branch", type: "Organization", name: "Branch Office" },
          target: { id: "hq", type: "Organization", name: "HQ" },
        } as Relation,
      ],
      "hq",
    );
    renderSection({ cardTypeKey: "Organization", fsId: "hq" });

    expect(await screen.findByText("Branch Office")).toBeInTheDocument();
    expect(screen.getByText("is site of")).toBeInTheDocument();
    expect(screen.queryByText("has site")).not.toBeInTheDocument();
  });
});
