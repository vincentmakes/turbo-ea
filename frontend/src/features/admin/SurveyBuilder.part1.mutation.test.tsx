/**
 * SurveyBuilder — the component's state, loading and request handling (the
 * first third of the file): step labels, the page subject, extension field
 * types and field-type chips, hydrating an opened draft, the related-card
 * "via relation" narrowing, and the save / preview / send round-trips.
 *
 * Complements `SurveyBuilder.test.tsx` and `SurveyBuilder.branches.test.tsx`.
 * Built on the shared test kit with the real router; `CardPicker` is stubbed,
 * since the builder only cares which cards come back.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import { useLocation, useNavigate } from "react-router";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

// The extension registry, swappable per test: a type listed here is "installed
// and active", anything else under `ext.` is not.
const ext = vi.hoisted(() => ({ fieldTypes: {} as Record<string, unknown> }));
vi.mock("@/lib/extensionHost", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/extensionHost")>()),
  useExtensionFieldTypes: () => ext.fieldTypes,
}));

vi.mock("@/components/CardPicker", () => ({
  default: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value?: { id: string; name: string; type: string }[];
    onChange: (v: { id: string; name: string; type: string }[]) => void;
  }) => {
    const specific = label.startsWith("Search cards by name");
    return (
      <div data-testid={specific ? "specific-picker" : "related-picker"}>
        {(value ?? []).map((v, i) => (
          <span key={`${v.id}-${i}`}>{v.name}</span>
        ))}
        {specific ? (
          <button
            onClick={() =>
              onChange([...(value ?? []), { id: "app-9", name: "Picked App", type: "Application" }])
            }
          >
            pick specific
          </button>
        ) : (
          <>
            <button onClick={() => onChange([{ id: "org-9", name: "Picked Org", type: "Organization" }])}>
              related: Org
            </button>
            <button onClick={() => onChange([{ id: "itc-9", name: "Picked ITC", type: "ITComponent" }])}>
              related: ITC
            </button>
          </>
        )}
      </div>
    );
  },
}));

import SurveyBuilder from "./SurveyBuilder";
import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import {
  makeCardType,
  makeField,
  makeOption,
  makeRelationType,
  makeSection,
} from "@/test/fixtures/metamodel";
import { renderWithProviders } from "@/test/render";
import { resetPageTitle, usePageTitleSlots } from "@/hooks/usePageTitle";
import type { RelationType, SectionDef } from "@/types";

const APP = makeCardType({
  key: "Application",
  label: "Application",
  fields_schema: [
    makeSection({
      section: "General",
      fields: [
        makeField({ key: "notes", label: "Notes", type: "text" }),
        makeField({
          key: "criticality",
          label: "Criticality",
          type: "single_select",
          options: [makeOption({ key: "high", label: "High" })],
        }),
      ],
    }),
  ],
});
const ORG = makeCardType({ key: "Organization", label: "Organization" });
const ITC = makeCardType({ key: "ITComponent", label: "IT Component" });

function rel(
  key: string,
  source: string,
  target: string,
  label: string,
  reverse: string,
  extra: Partial<RelationType> = {},
): RelationType {
  return makeRelationType({
    key,
    source_type_key: source,
    target_type_key: target,
    label,
    reverse_label: reverse,
    ...extra,
  });
}

const ORG_OWNS_APP = rel("relOrgToAppOwns", "Organization", "Application", "owns", "is owned by");
const APP_USED_BY_ORG = rel("relAppToOrg", "Application", "Organization", "is used by", "uses");

const ROLES = [{ key: "responsible", label: "Business Owner", allowed_types: null, translations: {} }];

const PREVIEW = {
  total_cards: 1,
  total_matched: 1,
  skipped: [],
  total_users: 1,
  total_requests: 1,
  targets: [
    {
      card_id: "c1",
      card_name: "CRM",
      card_type: "Application",
      users: [{ user_id: "u1", display_name: "Ada", email: "a@x", roles: [] }],
    },
  ],
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

/** What the page publishes as the browser tab's subject. */
function SubjectProbe() {
  return <div data-testid="subject">{usePageTitleSlots().subject?.text ?? ""}</div>;
}

function GoTo({ to }: { to: string }) {
  const navigate = useNavigate();
  return <button onClick={() => navigate(to)}>go {to}</button>;
}

function renderBuilder(route = "/admin/surveys/new") {
  return renderWithProviders(
    <>
      <SurveyBuilder />
      <SubjectProbe />
      <GoTo to="/admin/surveys/survey-8" />
    </>,
    {
      route,
      routes: [
        { path: "/admin/surveys/new" },
        { path: "/admin/surveys/:id" },
        { path: "/admin/surveys", element: <LocationProbe /> },
        { path: "/admin/surveys/:id/results", element: <LocationProbe /> },
      ],
    },
  );
}

type User = ReturnType<typeof renderBuilder>["user"];

const next = () => screen.getByRole("button", { name: /^Next/ });

async function toTarget(user: User, name = "Owner check") {
  await user.type(await screen.findByLabelText(/Survey Name/), name);
  await user.click(next());
  await screen.findByText("Target Cards");
}

async function pickType(user: User) {
  await user.click(screen.getByRole("combobox", { name: /^Type/ }));
  await user.click(await screen.findByRole("option", { name: /Application/ }));
}

async function toFields(user: User) {
  await toTarget(user);
  await pickType(user);
  await user.click(screen.getByRole("checkbox", { name: /Business Owner/ }));
  await user.click(next());
  await screen.findByText("Select Fields");
}

/** Walk to the preview step with one field picked; the caller awaits the outcome. */
async function toPreview(user: User) {
  await toFields(user);
  await user.click(screen.getByText("Criticality"));
  await user.click(next());
  await screen.findByText("Preview & Send", { selector: "h6" });
}

/** The body of the most recent draft write, create or update. */
function lastDraft(): Record<string, unknown> {
  const writes = mockApi.calls.filter(
    (c) =>
      (c.method === "post" && c.path === "/surveys") ||
      (c.method === "patch" && /^\/surveys\/[^/]+$/.test(c.path)),
  );
  return writes[writes.length - 1].body as Record<string, unknown>;
}

const rowOf = (text: string) => screen.getByText(text).closest("tr") as HTMLElement;

beforeEach(() => {
  hookState.reset();
  mockApi.reset();
  resetPageTitle();
  ext.fieldTypes = {};
  withMetamodel([APP, ORG, ITC], [ORG_OWNS_APP, APP_USED_BY_ORG]);
  mockApi.on("get", "/tag-groups", []);
  mockApi.on("get", /^\/stakeholder-roles/, ROLES);
  mockApi.on("post", "/surveys", { id: "survey-1" });
  mockApi.on("patch", "/surveys/survey-1", {});
  mockApi.on("post", "/surveys/survey-1/preview", PREVIEW);
});

afterEach(() => {
  // A created draft rewrites the address bar outside the router.
  window.history.replaceState(null, "", "/");
});

describe("SurveyBuilder — a fresh survey", () => {
  it("names the four steps, shows no error and loads nothing", async () => {
    renderBuilder();
    await screen.findByLabelText(/Survey Name/);

    for (const step of ["Basics", "Target", "Fields", "Preview & Send"]) {
      expect(screen.getByText(step)).toBeInTheDocument();
    }
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // There is no draft to read on a new survey.
    expect(mockApi.callsOf("get", /^\/surveys/)).toHaveLength(0);
  });

  it("publishes the draft name as the page subject as it is typed", async () => {
    const { user } = renderBuilder();
    await user.type(await screen.findByLabelText(/Survey Name/), "Annual refresh");
    await waitFor(() => expect(screen.getByTestId("subject")).toHaveTextContent("Annual refresh"));
  });

  it("offers no attribute filter row and no tags until asked for", async () => {
    const { user } = renderBuilder();
    await toTarget(user);
    expect(screen.queryByRole("combobox", { name: /^Operator/ })).not.toBeInTheDocument();

    await pickType(user);
    await user.click(screen.getByRole("button", { name: /Save Draft/ }));
    await waitFor(() => expect(mockApi.callsOf("post", "/surveys")).toHaveLength(1));
    const filters = lastDraft().target_filters as Record<string, unknown>;
    expect(filters.tag_ids).toBeUndefined();
    expect(filters.attribute_filters).toBeUndefined();
  });

  it("still renders the target step when tags and roles cannot be loaded", async () => {
    mockApi.fail("get", "/tag-groups", 500);
    mockApi.fail("get", /^\/stakeholder-roles/, 500);
    const { user } = renderBuilder();
    await toTarget(user);

    expect(screen.getByLabelText(/Select tags/)).toBeInTheDocument();
    // No roles to offer, so no role tickboxes.
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("fills the tag picker from the tag groups", async () => {
    mockApi.on("get", "/tag-groups", [
      { id: "g1", name: "Tier", mode: "multi", mandatory: false, tags: [{ id: "t1", name: "Gold" }] },
    ]);
    const { user } = renderBuilder();
    await toTarget(user);
    await pickType(user);

    await user.click(screen.getByLabelText(/Select tags/));
    await user.click(await screen.findByRole("option", { name: "Gold" }));
    expect(screen.getByText("Tier: Gold")).toBeInTheDocument();
  });

  it("starts a custom staleness window at 180 days", async () => {
    const { user } = renderBuilder();
    await toTarget(user);
    await pickType(user);

    await user.click(screen.getByRole("button", { name: /Custom/ }));
    expect(screen.getByLabelText(/Not updated for/)).toHaveValue(180);
    await user.click(screen.getByRole("button", { name: /Save Draft/ }));
    await waitFor(() => expect(mockApi.callsOf("post", "/surveys")).toHaveLength(1));
    expect((lastDraft().target_filters as Record<string, unknown>).not_updated_for).toEqual({
      value: 180,
      unit: "days",
    });
  });
});

describe("SurveyBuilder — fields step", () => {
  it("labels each field's type and warns only on an inactive extension type", async () => {
    withMetamodel(
      [
        makeCardType({
          key: "Application",
          label: "Application",
          fields_schema: [
            makeSection({
              section: "General",
              fields: [
                makeField({ key: "notes", label: "Notes", type: "text" }),
                makeField({ key: "criticality", label: "Criticality", type: "single_select" }),
                makeField({ key: "score", label: "Risk score", type: "ext.acme.score" }),
                makeField({ key: "heat", label: "Heat", type: "ext.acme.heat" }),
              ],
            }),
          ],
        }),
      ],
      [],
    );
    ext.fieldTypes = { "ext.acme.heat": { extKey: "acme", contribution: { type: "ext.acme.heat" } } };
    const { user } = renderBuilder();
    await toFields(user);

    const inactive =
      "This field type comes from an extension that isn't installed and active. Responses will use a plain input and won't display on the card until the extension is active.";
    expect(within(rowOf("Notes")).getByText("Text")).toBeInTheDocument();
    expect(within(rowOf("Criticality")).getByText("Single Select")).toBeInTheDocument();
    // A type core does not know keeps its raw key.
    expect(within(rowOf("Risk score")).getByText("ext.acme.score")).toBeInTheDocument();

    expect(within(rowOf("Risk score")).getByLabelText(inactive)).toBeInTheDocument();
    expect(within(rowOf("Heat")).queryByLabelText(inactive)).not.toBeInTheDocument();
    expect(within(rowOf("Notes")).queryByLabelText(inactive)).not.toBeInTheDocument();
    expect(within(rowOf("Criticality")).queryByLabelText(inactive)).not.toBeInTheDocument();
  });

  it("says the type has no fields when a section carries none", async () => {
    withMetamodel(
      [makeCardType({ key: "Application", label: "Application", fields_schema: [{ section: "Empty" } as SectionDef] })],
      [],
    );
    const { user } = renderBuilder();
    await toFields(user);
    expect(screen.getByText("This type has no configurable fields.")).toBeInTheDocument();
  });

  it("saves a picked select field with its options", async () => {
    const { user } = renderBuilder();
    await toFields(user);
    await user.click(screen.getByText("Criticality"));
    await user.click(screen.getByRole("button", { name: /Save Draft/ }));

    await waitFor(() => expect(mockApi.callsOf("patch", "/surveys/survey-1")).toHaveLength(1));
    expect(lastDraft().fields).toEqual([
      {
        key: "criticality",
        section: "General",
        label: "Criticality",
        type: "single_select",
        options: [{ key: "high", label: "High" }],
        action: "maintain",
      },
    ]);
  });

  it("lists the incoming side only for relation types that point at the target", async () => {
    const { user } = renderBuilder();
    await toFields(user);

    const table = screen.getByRole("columnheader", { name: "Relationship" }).closest("table")!;
    const labels = [...table.querySelectorAll("tbody tr")].map(
      (tr) => tr.querySelectorAll("td")[1].textContent,
    );
    expect(labels).toEqual(["is owned by", "is used by"]);
  });
});

describe("SurveyBuilder — narrowing related cards to one relation", () => {
  beforeEach(() => {
    withMetamodel(
      [APP, ORG, ITC],
      [
        ORG_OWNS_APP,
        APP_USED_BY_ORG,
        rel("relOrgFundsApp", "Organization", "Application", "funds", "is funded by", { is_hidden: true }),
        rel("relAppToItc", "Application", "ITComponent", "runs on", "hosts"),
        rel("relItcToOrg", "ITComponent", "Organization", "serves", "is served by"),
        rel("relOrgToItc", "Organization", "ITComponent", "operates", "is operated by"),
        rel("relItcToApp", "ITComponent", "Application", "supports", "is supported by"),
      ],
    );
  });

  it("offers exactly the visible relation types between the target and the picked cards", async () => {
    const { user } = renderBuilder();
    await toTarget(user);
    await pickType(user);
    await user.click(screen.getByText("related: Org"));

    await user.click(await screen.findByRole("combobox", { name: /Via relation/ }));
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Any relation", "is owned by", "is used by"]);
  });

  it("drops a chosen relation once the picked cards can no longer use it", async () => {
    const { user } = renderBuilder();
    await toTarget(user);
    await pickType(user);
    await user.click(screen.getByText("related: Org"));
    await user.click(await screen.findByRole("combobox", { name: /Via relation/ }));
    await user.click(screen.getByRole("option", { name: "is owned by" }));

    // An IT Component is reached through two other relation types.
    await user.click(screen.getByText("related: ITC"));
    expect(screen.getByRole("combobox", { name: /Via relation/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Save Draft/ }));
    await waitFor(() => expect(mockApi.callsOf("post", "/surveys")).toHaveLength(1));
    const filters = lastDraft().target_filters as Record<string, unknown>;
    expect(filters.related_ids).toEqual(["itc-9"]);
    expect(filters.relation_type_key).toBeUndefined();
  });
});

describe("SurveyBuilder — saving a draft", () => {
  it("saves the trimmed name and moves the address bar to the new draft", async () => {
    const { user } = renderBuilder();
    await toTarget(user, "  Trimmed name  ");
    await pickType(user);
    await user.click(screen.getByRole("button", { name: /Save Draft/ }));

    await waitFor(() => expect(mockApi.callsOf("post", "/surveys")).toHaveLength(1));
    expect(lastDraft().name).toBe("Trimmed name");
    await waitFor(() => expect(window.location.pathname).toBe("/admin/surveys/survey-1"));
  });

  it("disables the button while the save is in flight", async () => {
    const pending = deferred<{ id: string }>();
    mockApi.on("post", "/surveys", () => pending.promise);
    const { user } = renderBuilder();
    await toTarget(user);
    await pickType(user);
    await user.click(screen.getByRole("button", { name: /Save Draft/ }));

    expect(await screen.findByRole("button", { name: "Saving..." })).toBeDisabled();
    await act(async () => pending.resolve({ id: "survey-1" }));
    expect(await screen.findByRole("button", { name: "Save Draft" })).toBeEnabled();
  });

  it("clears the previous error when a save succeeds", async () => {
    let attempt = 0;
    mockApi.on("post", "/surveys", () => {
      attempt += 1;
      if (attempt === 1) throw new Error("db down");
      return { id: "survey-1" };
    });
    const { user } = renderBuilder();
    await toTarget(user);
    await pickType(user);

    await user.click(screen.getByRole("button", { name: /Save Draft/ }));
    expect(await screen.findByText("db down")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Save Draft/ }));
    await waitFor(() => expect(mockApi.callsOf("post", "/surveys")).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});

describe("SurveyBuilder — preview", () => {
  it("shows a spinner instead of the Load Preview button while the preview runs", async () => {
    const pending = deferred<typeof PREVIEW>();
    mockApi.on("post", "/surveys/survey-1/preview", () => pending.promise);
    const { user } = renderBuilder();
    await toFields(user);
    await user.click(screen.getByText("Criticality"));
    await user.click(next());

    // From the step's first render, not after a beat with the button showing.
    await screen.findByText("Preview & Send", { selector: "h6" });
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load Preview" })).not.toBeInTheDocument();
    await act(async () => pending.resolve(PREVIEW));
    expect(await screen.findByText("CRM")).toBeInTheDocument();
  });

  it("does not preview a draft it could not save, and offers the manual preview", async () => {
    mockApi.fail("post", "/surveys", 500);
    const { user } = renderBuilder();
    await toFields(user);
    await user.click(screen.getByText("Criticality"));
    await user.click(next());

    expect(await screen.findByRole("button", { name: "Load Preview" })).toBeInTheDocument();
    // The Target step's save and the preview's own save (the step into the
    // preview saves only through it), both refused.
    expect(mockApi.callsOf("post", "/surveys")).toHaveLength(2);
    expect(screen.getByText("POST /surveys failed")).toBeInTheDocument();
    expect(mockApi.callsOf("post", /preview/)).toHaveLength(0);
  });

  it("clears the earlier error once a retried preview works", async () => {
    let fail = true;
    mockApi.on("post", "/surveys/survey-1/preview", () => {
      if (fail) throw new Error("preview down");
      return PREVIEW;
    });
    const { user } = renderBuilder();
    await toPreview(user);
    expect(await screen.findByText("preview down")).toBeInTheDocument();

    fail = false;
    await user.click(screen.getByRole("button", { name: "Load Preview" }));
    expect(await screen.findByText("CRM")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("falls back to a generic message for a non-Error preview failure", async () => {
    mockApi.on("post", "/surveys/survey-1/preview", () => Promise.reject("nope"));
    const { user } = renderBuilder();
    await toPreview(user);
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
  });
});

describe("SurveyBuilder — sending", () => {
  it("clears a failed send's error and shows progress while the retry is in flight", async () => {
    const pending = deferred<object>();
    let attempt = 0;
    mockApi.on("post", "/surveys/survey-1/send", () => {
      attempt += 1;
      if (attempt === 1) throw new Error("already sent");
      return pending.promise;
    });
    const { user } = renderBuilder();
    await toPreview(user);
    await screen.findByText("CRM");

    await user.click(screen.getByRole("button", { name: /Send Survey/ }));
    expect(await screen.findByText("already sent")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Send Survey/ }));
    expect(await screen.findByRole("button", { name: /Sending\.\.\./ })).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await act(async () => pending.resolve({}));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/admin/surveys/survey-1/results"),
    );
  });
});

describe("SurveyBuilder — opening a saved draft", () => {
  const SAVED = {
    id: "survey-7",
    name: "Saved",
    description: "Internal note",
    message: "Hello there",
    status: "draft",
    target_type_key: "Application",
  };

  beforeEach(() => {
    mockApi.on("patch", "/surveys/survey-7", {});
  });

  it("restores the basics of a draft with no filters, roles or fields, and saves them empty", async () => {
    mockApi.on("get", "/surveys/survey-7", SAVED);
    const { user } = renderBuilder("/admin/surveys/survey-7");

    await waitFor(() => expect(screen.getByLabelText(/Survey Name/)).toHaveValue("Saved"));
    expect(screen.getByLabelText(/^Description/)).toHaveValue("Internal note");
    expect(screen.getByLabelText(/Message to Respondents/)).toHaveValue("Hello there");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Save Draft/ }));
    await waitFor(() => expect(mockApi.callsOf("patch", "/surveys/survey-7")).toHaveLength(1));
    const body = lastDraft();
    expect(body.target_roles).toEqual([]);
    expect(body.fields).toEqual([]);
    expect(body.target_filters).toEqual({});

    await user.click(next());
    await screen.findByText("Target Cards");
    expect(screen.queryByRole("combobox", { name: /^Operator/ })).not.toBeInTheDocument();
  });

  it("restores the draft's tags", async () => {
    mockApi.on("get", "/tag-groups", [
      { id: "g1", name: "Tier", mode: "multi", mandatory: false, tags: [{ id: "t1", name: "Gold" }] },
    ]);
    mockApi.on("get", "/surveys/survey-7", {
      ...SAVED,
      target_roles: ["responsible"],
      target_filters: { tag_ids: ["t1"] },
      fields: [],
    });
    const { user } = renderBuilder("/admin/surveys/survey-7");
    await waitFor(() => expect(screen.getByLabelText(/Survey Name/)).toHaveValue("Saved"));
    await user.click(next());

    expect(await screen.findByText("Tier: Gold")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Save Draft/ }));
    await waitFor(() => expect(mockApi.callsOf("patch", "/surveys/survey-7").length).toBeGreaterThan(0));
    expect((lastDraft().target_filters as Record<string, unknown>).tag_ids).toEqual(["t1"]);
  });

  it("restores a preset staleness window as that preset", async () => {
    mockApi.on("get", "/surveys/survey-7", {
      ...SAVED,
      target_roles: ["responsible"],
      target_filters: { not_updated_for: { value: 6, unit: "months" } },
      fields: [],
    });
    const { user } = renderBuilder("/admin/surveys/survey-7");
    await waitFor(() => expect(screen.getByLabelText(/Survey Name/)).toHaveValue("Saved"));
    await user.click(next());
    await screen.findByText("Target Cards");

    expect(screen.getByRole("button", { name: "6 months" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Custom/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByLabelText(/Not updated for/)).not.toBeInTheDocument();
    expect(screen.getByText(/Cards last changed before/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Save Draft/ }));
    await waitFor(() => expect(mockApi.callsOf("patch", "/surveys/survey-7").length).toBeGreaterThan(0));
    expect((lastDraft().target_filters as Record<string, unknown>).not_updated_for).toEqual({
      value: 6,
      unit: "months",
    });
  });

  it("restores a custom window together with its unit", async () => {
    mockApi.on("get", "/surveys/survey-7", {
      ...SAVED,
      target_roles: ["responsible"],
      target_filters: { not_updated_for: { value: 3, unit: "months" } },
      fields: [],
    });
    const { user } = renderBuilder("/admin/surveys/survey-7");
    await waitFor(() => expect(screen.getByLabelText(/Survey Name/)).toHaveValue("Saved"));
    await user.click(next());
    await screen.findByText("Target Cards");

    expect(screen.getByRole("button", { name: /Custom/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText(/Not updated for/)).toHaveValue(3);
    expect(screen.getByRole("combobox", { name: /^Unit/ })).toHaveTextContent("months");
  });

  it("loads the survey the route names when it changes in place", async () => {
    mockApi.on("get", "/surveys/survey-7", {
      ...SAVED,
      target_roles: ["responsible"],
      target_filters: { card_ids: ["app-1"] },
      fields: [],
    });
    mockApi.on("get", "/surveys/survey-8", {
      ...SAVED,
      id: "survey-8",
      name: "Second",
      target_roles: ["responsible"],
      target_filters: { card_ids: ["app-2"] },
      fields: [],
    });
    mockApi.on("get", "/cards/app-1", { id: "app-1", name: "Hydrated App", type: "Application" });
    mockApi.on("get", "/cards/app-2", { id: "app-2", name: "Second App", type: "Application" });
    const { user } = renderBuilder("/admin/surveys/survey-7");
    await waitFor(() => expect(screen.getByLabelText(/Survey Name/)).toHaveValue("Saved"));
    await user.click(next());
    expect(await screen.findByText("Hydrated App")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "go /admin/surveys/survey-8" }));
    expect(await screen.findByText("Second App")).toBeInTheDocument();
    // The first survey's chip goes with it.
    expect(screen.queryByText("Hydrated App")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Back$/ }));
    await waitFor(() => expect(screen.getByLabelText(/Survey Name/)).toHaveValue("Second"));
  });

  it("does not refetch cards it already shows when another filter changes", async () => {
    mockApi.on("get", "/surveys/survey-7", {
      ...SAVED,
      target_roles: ["responsible"],
      target_filters: { card_ids: ["app-1"] },
      fields: [],
    });
    mockApi.on("get", "/cards/app-1", { id: "app-1", name: "Hydrated App", type: "Application" });
    const { user } = renderBuilder("/admin/surveys/survey-7");
    await waitFor(() => expect(screen.getByLabelText(/Survey Name/)).toHaveValue("Saved"));
    await user.click(next());
    expect(await screen.findByText("Hydrated App")).toBeInTheDocument();

    await user.click(screen.getByText("related: Org"));
    await user.click(screen.getByText("pick specific"));
    expect(await screen.findByText("Picked App")).toBeInTheDocument();
    expect(mockApi.callsOf("get", /^\/cards\//).map((c) => c.path)).toEqual(["/cards/app-1"]);
  });

  it("hydrates a card once even when a second lookup for it overlaps the first", async () => {
    const pending = deferred<object>();
    mockApi.on("get", "/surveys/survey-7", {
      ...SAVED,
      target_roles: ["responsible"],
      target_filters: { card_ids: ["app-1"] },
      fields: [],
    });
    mockApi.on("get", "/cards/app-1", () => pending.promise);
    const { user } = renderBuilder("/admin/surveys/survey-7");
    await waitFor(() => expect(screen.getByLabelText(/Survey Name/)).toHaveValue("Saved"));
    await user.click(next());
    await screen.findByText("Target Cards");

    // Changing the related filter re-runs the lookup while the first is pending.
    await user.click(screen.getByText("related: Org"));
    expect(mockApi.callsOf("get", "/cards/app-1")).toHaveLength(2);

    await act(async () => pending.resolve({ id: "app-1", name: "Hydrated App", type: "Application" }));
    await screen.findByText("Hydrated App");
    await act(async () => {});
    expect(screen.getAllByText("Hydrated App")).toHaveLength(1);
  });
});
