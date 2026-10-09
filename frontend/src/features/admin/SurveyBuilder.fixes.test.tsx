/**
 * SurveyBuilder, regression tests: a reopened draft keeps its "via relation"
 * narrowing, a draft whose target type is gone does not pass the Target step,
 * an in-place route change drops the previous survey's card chips, and the
 * preview step opens on its spinner rather than flashing "Load Preview".
 *
 * Same harness as `SurveyBuilder.part1.mutation.test.tsx`: the real router,
 * `CardPicker` stubbed to the list of cards it holds.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { useNavigate } from "react-router";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

type Picked = { id: string; name: string; type: string };
vi.mock("@/components/CardPicker", () => ({
  default: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value?: Picked[];
    onChange: (v: Picked[]) => void;
  }) => {
    const specific = label.startsWith("Search cards by name");
    return (
      <div data-testid={specific ? "specific-picker" : "related-picker"}>
        {(value ?? []).map((v, i) => (
          <span key={`${v.id}-${i}`}>{v.name}</span>
        ))}
        {!specific && (
          <>
            <button onClick={() => onChange([{ id: "org-9", name: "Picked Org", type: "Organization" }])}>
              related: Org
            </button>
            <button
              onClick={() =>
                onChange([
                  { id: "itc-1", name: "First ITC", type: "ITComponent" },
                  { id: "itc-2", name: "Second ITC", type: "ITComponent" },
                ])
              }
            >
              related: two ITCs
            </button>
            <button onClick={() => onChange([])}>related: none</button>
          </>
        )}
      </div>
    );
  },
}));

import SurveyBuilder from "./SurveyBuilder";
import i18n from "@/i18n";
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

const APP = makeCardType({
  key: "Application",
  label: "Application",
  fields_schema: [
    makeSection({
      section: "General",
      fields: [
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
const RETIRED = makeCardType({ key: "Retired", label: "Legacy systems", is_hidden: true });

const ORG_OWNS_APP = makeRelationType({
  key: "relOrgToAppOwns",
  source_type_key: "Organization",
  target_type_key: "Application",
  label: "owns",
  reverse_label: "is owned by",
});
const APP_USED_BY_ORG = makeRelationType({
  key: "relAppToOrg",
  source_type_key: "Application",
  target_type_key: "Organization",
  label: "is used by",
  reverse_label: "uses",
});

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

const SAVED = {
  id: "survey-7",
  name: "Saved",
  description: "",
  message: "",
  status: "draft",
  target_type_key: "Application",
  target_roles: ["responsible"],
  fields: [],
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function GoTo({ to }: { to: string }) {
  const navigate = useNavigate();
  return <button onClick={() => navigate(to)}>go {to}</button>;
}

function renderBuilder(route = "/admin/surveys/new") {
  return renderWithProviders(
    <>
      <SurveyBuilder />
      <GoTo to="/admin/surveys/survey-8" />
    </>,
    {
      route,
      routes: [{ path: "/admin/surveys/new" }, { path: "/admin/surveys/:id" }],
    },
  );
}

const next = () => screen.getByRole("button", { name: /^Next/ });

function lastDraft(): Record<string, unknown> {
  const writes = mockApi.calls.filter(
    (c) =>
      (c.method === "post" && c.path === "/surveys") ||
      (c.method === "patch" && /^\/surveys\/[^/]+$/.test(c.path)),
  );
  return writes[writes.length - 1].body as Record<string, unknown>;
}

async function openDraft() {
  await waitFor(() => expect(screen.getByLabelText(/Survey Name/)).toHaveValue("Saved"));
}

beforeEach(() => {
  hookState.reset();
  mockApi.reset();
  withMetamodel([APP, ORG, RETIRED], [ORG_OWNS_APP, APP_USED_BY_ORG]);
  mockApi.on("get", "/tag-groups", []);
  mockApi.on("get", /^\/stakeholder-roles/, ROLES);
  mockApi.on("post", "/surveys", { id: "survey-1" });
  mockApi.on("patch", "/surveys/survey-1", {});
  mockApi.on("patch", "/surveys/survey-7", {});
  mockApi.on("patch", "/surveys/survey-8", {});
  mockApi.on("post", "/surveys/survey-1/preview", PREVIEW);
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("SurveyBuilder — a reopened draft's relation narrowing", () => {
  beforeEach(() => {
    mockApi.on("get", "/surveys/survey-7", {
      ...SAVED,
      target_filters: { related_ids: ["org-1"], relation_type_key: "relOrgToAppOwns" },
    });
    mockApi.on("get", "/cards/org-1", { id: "org-1", name: "Acme", type: "Organization" });
  });

  it("shows the stored relation on the Target step and saves it again", async () => {
    const { user } = renderBuilder("/admin/surveys/survey-7");
    await openDraft();
    await user.click(next());
    await screen.findByText("Target Cards");
    expect(await screen.findByText("Acme")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /Via relation/ })).toHaveTextContent("is owned by");

    // The step change auto-saved it.
    await waitFor(() => expect(mockApi.callsOf("patch", "/surveys/survey-7")).toHaveLength(1));
    expect((lastDraft().target_filters as Record<string, unknown>).relation_type_key).toBe(
      "relOrgToAppOwns",
    );

    await user.click(screen.getByRole("button", { name: /Save Draft/ }));
    await waitFor(() => expect(mockApi.callsOf("patch", "/surveys/survey-7")).toHaveLength(2));
    expect(lastDraft().target_filters).toMatchObject({
      related_ids: ["org-1"],
      relation_type_key: "relOrgToAppOwns",
    });
  });

  it("keeps it while the related cards are still being looked up", async () => {
    const card = deferred<object>();
    mockApi.on("get", "/cards/org-1", () => card.promise);
    const { user } = renderBuilder("/admin/surveys/survey-7");
    await openDraft();

    await user.click(screen.getByRole("button", { name: /Save Draft/ }));
    await waitFor(() => expect(mockApi.callsOf("patch", "/surveys/survey-7")).toHaveLength(1));
    expect((lastDraft().target_filters as Record<string, unknown>).relation_type_key).toBe(
      "relOrgToAppOwns",
    );
    await act(async () => card.resolve({ id: "org-1", name: "Acme", type: "Organization" }));
  });

  it("keeps it while one of the related cards cannot be looked up", async () => {
    // The Organization the narrowing applies to is one the author cannot read;
    // the IT Component beside it is known, but cannot judge the narrowing alone.
    mockApi.on("get", "/surveys/survey-7", {
      ...SAVED,
      target_filters: { related_ids: ["itc-1", "org-1"], relation_type_key: "relOrgToAppOwns" },
    });
    mockApi.on("get", "/cards/itc-1", { id: "itc-1", name: "Kafka", type: "ITComponent" });
    mockApi.fail("get", "/cards/org-1", 404, "Card not found");
    const { user } = renderBuilder("/admin/surveys/survey-7");
    await openDraft();
    await user.click(next());
    expect(await screen.findByText("Kafka")).toBeInTheDocument();
    await waitFor(() => expect(mockApi.callsOf("patch", "/surveys/survey-7")).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: /Save Draft/ }));
    await waitFor(() => expect(mockApi.callsOf("patch", "/surveys/survey-7")).toHaveLength(2));
    expect(lastDraft().target_filters).toMatchObject({
      related_ids: ["itc-1", "org-1"],
      relation_type_key: "relOrgToAppOwns",
    });
  });
});

describe("SurveyBuilder — Next on a survey opened in place", () => {
  it("does not auto-save a survey whose stored name is blank", async () => {
    mockApi.on("get", "/surveys/survey-7", { ...SAVED, target_filters: {} });
    mockApi.on("get", "/surveys/survey-8", {
      ...SAVED,
      id: "survey-8",
      name: "   ",
      target_filters: {},
    });
    const { user } = renderBuilder("/admin/surveys/survey-7");
    await openDraft();
    await user.click(next());
    await screen.findByText("Target Cards");
    await waitFor(() => expect(mockApi.callsOf("patch", "/surveys/survey-7")).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: "go /admin/surveys/survey-8" }));
    await waitFor(() => expect(mockApi.callsOf("get", "/surveys/survey-8")).toHaveLength(1));
    await user.click(next());
    // On to the Fields step, without writing the blank-named survey.
    expect(await screen.findByText("Select Fields")).toBeInTheDocument();
    expect(mockApi.callsOf("patch", "/surveys/survey-8")).toHaveLength(0);
    expect(mockApi.callsOf("post", "/surveys")).toHaveLength(0);
  });
});

describe("SurveyBuilder — a draft whose target type is gone", () => {
  // A hidden type is still in the metamodel, so it is named by its label.
  for (const [what, typeKey, shown] of [
    ["removed from the metamodel", "Deleted", "Deleted"],
    ["hidden", "Retired", "Legacy systems"],
  ] as const) {
    it(`refuses to leave the Target step for a type ${what}`, async () => {
      mockApi.on("get", "/surveys/survey-7", { ...SAVED, target_type_key: typeKey, target_filters: {} });
      const { user } = renderBuilder("/admin/surveys/survey-7");
      await openDraft();
      await user.click(next());
      await screen.findByText("Target Cards");

      await user.click(next());
      expect(await screen.findByText("Please select a target card type")).toBeInTheDocument();
      expect(screen.getByText("Target Cards")).toBeInTheDocument();
      expect(screen.queryByText("Select Fields")).not.toBeInTheDocument();
    });

    it(`names a type ${what} as unavailable, without MUI's out-of-range warning`, async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        mockApi.on("get", "/surveys/survey-7", { ...SAVED, target_type_key: typeKey, target_filters: {} });
        const { user } = renderBuilder("/admin/surveys/survey-7");
        await openDraft();
        await user.click(next());
        await screen.findByText("Target Cards");

        const typeSelect = screen.getByRole("combobox", { name: /^Type/ });
        expect(typeSelect).toHaveTextContent(`${shown} (unavailable)`);
        await user.click(typeSelect);
        expect(await screen.findByRole("option", { name: `${shown} (unavailable)` })).toHaveAttribute(
          "aria-disabled",
          "true",
        );
        // A type that is offered replaces it.
        await user.click(screen.getByRole("option", { name: /Application/ }));
        await waitFor(() =>
          expect(screen.getByRole("combobox", { name: /^Type/ })).toHaveTextContent("Application"),
        );
        await user.click(screen.getByRole("combobox", { name: /^Type/ }));
        await screen.findByRole("option", { name: /Application/ });
        expect(screen.queryByRole("option", { name: /unavailable/ })).not.toBeInTheDocument();

        const outOfRange = warn.mock.calls.filter((args) => String(args[0]).includes("out-of-range"));
        expect(outOfRange).toEqual([]);
      } finally {
        warn.mockRestore();
      }
    });
  }

  it("does not call a stored type unavailable while the metamodel is still loading", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      hookState.metamodel = { types: [], relationTypes: [], loading: true };
      mockApi.on("get", "/surveys/survey-7", { ...SAVED, target_filters: {} });
      const { user } = renderBuilder("/admin/surveys/survey-7");
      await openDraft();
      await user.click(next());
      await screen.findByText("Target Cards");

      const typeSelect = screen.getByRole("combobox", { name: /^Type/ });
      expect(typeSelect).toHaveTextContent("Application");
      expect(typeSelect).not.toHaveTextContent("unavailable");
      const outOfRange = warn.mock.calls.filter((args) => String(args[0]).includes("out-of-range"));
      expect(outOfRange).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("SurveyBuilder — the route changing in place", () => {
  it("drops the previous survey's specific and related card chips", async () => {
    mockApi.on("get", "/surveys/survey-7", {
      ...SAVED,
      target_filters: { card_ids: ["app-1"], related_ids: ["org-1"] },
    });
    mockApi.on("get", "/surveys/survey-8", {
      ...SAVED,
      id: "survey-8",
      name: "Second",
      target_filters: { card_ids: ["app-2"], related_ids: ["org-2"] },
    });
    mockApi.on("get", "/cards/app-1", { id: "app-1", name: "First App", type: "Application" });
    mockApi.on("get", "/cards/org-1", { id: "org-1", name: "First Org", type: "Organization" });
    mockApi.on("get", "/cards/app-2", { id: "app-2", name: "Second App", type: "Application" });
    mockApi.on("get", "/cards/org-2", { id: "org-2", name: "Second Org", type: "Organization" });
    const { user } = renderBuilder("/admin/surveys/survey-7");
    await openDraft();
    await user.click(next());
    expect(await screen.findByText("First App")).toBeInTheDocument();
    expect(await screen.findByText("First Org")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "go /admin/surveys/survey-8" }));
    expect(await screen.findByText("Second App")).toBeInTheDocument();
    expect(await screen.findByText("Second Org")).toBeInTheDocument();
    expect(screen.queryByText("First App")).not.toBeInTheDocument();
    expect(screen.queryByText("First Org")).not.toBeInTheDocument();
    // Exactly the new survey's chip in each picker, nothing left over.
    expect(screen.getByTestId("specific-picker").querySelectorAll("span")).toHaveLength(1);
    expect(screen.getByTestId("related-picker").querySelectorAll("span")).toHaveLength(1);
  });
});

describe("SurveyBuilder — a card lookup that outlives its survey", () => {
  it("does not bring the previous survey's chips back when its lookups land late", async () => {
    mockApi.on("get", "/surveys/survey-7", {
      ...SAVED,
      target_filters: { card_ids: ["app-1"], related_ids: ["org-1"] },
    });
    mockApi.on("get", "/surveys/survey-8", {
      ...SAVED,
      id: "survey-8",
      name: "Second",
      target_filters: { card_ids: ["app-2"], related_ids: ["org-2"] },
    });
    const firstApp = deferred<object>();
    const firstOrg = deferred<object>();
    mockApi.on("get", "/cards/app-1", () => firstApp.promise);
    mockApi.on("get", "/cards/org-1", () => firstOrg.promise);
    mockApi.on("get", "/cards/app-2", { id: "app-2", name: "Second App", type: "Application" });
    mockApi.on("get", "/cards/org-2", { id: "org-2", name: "Second Org", type: "Organization" });
    const { user } = renderBuilder("/admin/surveys/survey-7");
    await openDraft();
    await user.click(next());
    await screen.findByText("Target Cards");
    await waitFor(() => expect(mockApi.callsOf("get", "/cards/org-1")).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: "go /admin/surveys/survey-8" }));
    expect(await screen.findByText("Second App")).toBeInTheDocument();
    expect(await screen.findByText("Second Org")).toBeInTheDocument();

    // The first survey's lookups answer only now.
    await act(async () => {
      firstApp.resolve({ id: "app-1", name: "First App", type: "Application" });
      firstOrg.resolve({ id: "org-1", name: "First Org", type: "Organization" });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByText("First App")).not.toBeInTheDocument();
    expect(screen.queryByText("First Org")).not.toBeInTheDocument();
    expect(screen.getByTestId("specific-picker").querySelectorAll("span")).toHaveLength(1);
    expect(screen.getByTestId("related-picker").querySelectorAll("span")).toHaveLength(1);
  });
});

describe("SurveyBuilder — narrowing picked related cards", () => {
  async function toTargetWithType(user: ReturnType<typeof renderBuilder>["user"]) {
    await user.type(await screen.findByLabelText(/Survey Name/), "Owner check");
    await user.click(next());
    await screen.findByText("Target Cards");
    await user.click(screen.getByRole("combobox", { name: /^Type/ }));
    await user.click(await screen.findByRole("option", { name: /Application/ }));
  }

  async function narrowToOwnedBy(user: ReturnType<typeof renderBuilder>["user"]) {
    await user.click(screen.getByText("related: Org"));
    await user.click(await screen.findByRole("combobox", { name: /Via relation/ }));
    await user.click(await screen.findByRole("option", { name: "is owned by" }));
    expect(screen.getByRole("combobox", { name: /Via relation/ })).toHaveTextContent("is owned by");
  }

  it("forgets the narrowing when the related cards are cleared", async () => {
    const { user } = renderBuilder();
    await toTargetWithType(user);
    await narrowToOwnedBy(user);

    await user.click(screen.getByText("related: none"));
    await waitFor(() =>
      expect(screen.queryByRole("combobox", { name: /Via relation/ })).not.toBeInTheDocument(),
    );
    // Picking the card again starts un-narrowed.
    await user.click(screen.getByText("related: Org"));
    expect(await screen.findByRole("combobox", { name: /Via relation/ })).toHaveTextContent(
      "Any relation",
    );
    await user.click(screen.getByRole("button", { name: /Save Draft/ }));
    await waitFor(() => expect(mockApi.callsOf("post", "/surveys")).toHaveLength(1));
    expect((lastDraft().target_filters as Record<string, unknown>).relation_type_key).toBeUndefined();
  });

  it("drops the narrowing when several cards it cannot apply to replace the picked one", async () => {
    const { user } = renderBuilder();
    await toTargetWithType(user);
    await narrowToOwnedBy(user);

    await user.click(screen.getByText("related: two ITCs"));
    await user.click(screen.getByRole("button", { name: /Save Draft/ }));
    await waitFor(() => expect(mockApi.callsOf("post", "/surveys")).toHaveLength(1));
    const filters = lastDraft().target_filters as Record<string, unknown>;
    expect(filters.related_ids).toEqual(["itc-1", "itc-2"]);
    expect(filters.relation_type_key).toBeUndefined();
  });
});

describe("SurveyBuilder — entering the preview step", () => {
  it("opens on the spinner, never on the Load Preview button", async () => {
    const pending = deferred<typeof PREVIEW>();
    mockApi.on("post", "/surveys/survey-1/preview", () => pending.promise);
    const { user } = renderBuilder();
    await user.type(await screen.findByLabelText(/Survey Name/), "Owner check");
    await user.click(next());
    await screen.findByText("Target Cards");
    await user.click(screen.getByRole("combobox", { name: /^Type/ }));
    await user.click(await screen.findByRole("option", { name: /Application/ }));
    await user.click(screen.getByRole("checkbox", { name: /Business Owner/ }));
    await user.click(next());
    await screen.findByText("Select Fields");
    await user.click(screen.getByText("Criticality"));

    await user.click(next());
    await screen.findByText("Preview & Send", { selector: "h6" });
    expect(screen.queryByRole("button", { name: "Load Preview" })).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    await act(async () => pending.resolve(PREVIEW));
    expect(await screen.findByText("CRM")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load Preview" })).not.toBeInTheDocument();
  });
});

describe("SurveyBuilder — entering the preview writes the draft once", () => {
  it("creates one survey when the earlier auto-save failed", async () => {
    let attempt = 0;
    mockApi.on("post", "/surveys", () => {
      attempt += 1;
      if (attempt === 1) throw new Error("db down");
      return { id: `survey-${attempt - 1}` };
    });
    mockApi.on("post", /^\/surveys\/survey-\d+\/preview$/, PREVIEW);
    const { user } = renderBuilder();
    await user.type(await screen.findByLabelText(/Survey Name/), "Owner check");
    await user.click(next());
    await screen.findByText("Target Cards");
    await user.click(screen.getByRole("combobox", { name: /^Type/ }));
    await user.click(await screen.findByRole("option", { name: /Application/ }));
    await user.click(screen.getByRole("checkbox", { name: /Business Owner/ }));
    await user.click(next());
    // The Target step's auto-save was refused: there is still no draft id.
    expect(await screen.findByText("db down")).toBeInTheDocument();
    await screen.findByText("Select Fields");
    await user.click(screen.getByText("Criticality"));

    await user.click(next());
    expect(await screen.findByText("CRM")).toBeInTheDocument();
    // The refused save and ONE create — not a create for the step and another
    // for the preview.
    expect(mockApi.callsOf("post", "/surveys")).toHaveLength(2);
    expect(mockApi.callsOf("post", /\/preview$/).map((c) => c.path)).toEqual([
      "/surveys/survey-1/preview",
    ]);
  });

  it("saves an existing draft once before previewing it", async () => {
    mockApi.on("get", "/surveys/survey-7", { ...SAVED, target_filters: {} });
    mockApi.on("post", "/surveys/survey-7/preview", PREVIEW);
    const { user } = renderBuilder("/admin/surveys/survey-7");
    await openDraft();
    await user.click(next());
    await screen.findByText("Target Cards");
    await user.click(next());
    await screen.findByText("Select Fields");
    await waitFor(() => expect(mockApi.callsOf("patch", "/surveys/survey-7")).toHaveLength(2));
    await user.click(screen.getByText("Criticality"));

    await user.click(next());
    expect(await screen.findByText("CRM")).toBeInTheDocument();
    expect(mockApi.callsOf("patch", "/surveys/survey-7")).toHaveLength(3);
    // The one save carries the field just ticked, and lands before the preview.
    expect((lastDraft().fields as { key: string }[]).map((f) => f.key)).toEqual(["criticality"]);
    const order = mockApi.calls
      .filter((c) => c.path.startsWith("/surveys/survey-7"))
      .map((c) => `${c.method} ${c.path}`);
    expect(order.slice(-2)).toEqual(["patch /surveys/survey-7", "post /surveys/survey-7/preview"]);
  });
});

describe("SurveyBuilder — the Via relation select", () => {
  it("shows «Any relation» while no relation is chosen", async () => {
    const { user } = renderBuilder();
    await user.type(await screen.findByLabelText(/Survey Name/), "Owner check");
    await user.click(next());
    await screen.findByText("Target Cards");
    await user.click(screen.getByRole("combobox", { name: /^Type/ }));
    await user.click(await screen.findByRole("option", { name: /Application/ }));
    await user.click(screen.getByText("related: Org"));

    expect(await screen.findByRole("combobox", { name: /Via relation/ })).toHaveTextContent(
      "Any relation",
    );
  });
});

/** Name the survey, then on the Target step pick Application and a role. */
async function toTargetReady(user: ReturnType<typeof renderBuilder>["user"]) {
  await user.type(await screen.findByLabelText(/Survey Name/), "Owner check");
  await user.click(next());
  await screen.findByText("Target Cards");
  await user.click(screen.getByRole("combobox", { name: /^Type/ }));
  await user.click(await screen.findByRole("option", { name: /Application/ }));
  await user.click(screen.getByRole("checkbox", { name: /Business Owner/ }));
}

describe("SurveyBuilder — Next acts once", () => {
  it("creates one draft and moves one step on a double click before the draft exists", async () => {
    const created = deferred<{ id: string }>();
    mockApi.on("post", "/surveys", () => created.promise);
    const { user } = renderBuilder();
    await toTargetReady(user);

    await user.dblClick(next());
    await waitFor(() => expect(mockApi.callsOf("post", "/surveys")).toHaveLength(1));
    expect(next()).toBeDisabled();

    await act(async () => created.resolve({ id: "survey-1" }));
    // The Fields step, with its own validation still ahead — not the preview.
    expect(await screen.findByText("Select Fields")).toBeInTheDocument();
    expect(screen.queryByText("Preview & Send", { selector: "h6" })).not.toBeInTheDocument();
    expect(mockApi.callsOf("post", "/surveys")).toHaveLength(1);
    await waitFor(() => expect(next()).toBeEnabled());
  });

  it("ignores a second click that lands before the first one re-renders", async () => {
    const created = deferred<{ id: string }>();
    mockApi.on("post", "/surveys", () => created.promise);
    const { user } = renderBuilder();
    await toTargetReady(user);

    const button = next();
    await act(async () => {
      button.click();
      button.click();
    });
    expect(mockApi.callsOf("post", "/surveys")).toHaveLength(1);

    await act(async () => created.resolve({ id: "survey-1" }));
    expect(await screen.findByText("Select Fields")).toBeInTheDocument();
    expect(screen.queryByText("Preview & Send", { selector: "h6" })).not.toBeInTheDocument();
  });
});

describe("SurveyBuilder — one draft however the saves overlap", () => {
  it("creates one survey on a double click of Save Draft", async () => {
    const created = deferred<{ id: string }>();
    mockApi.on("post", "/surveys", () => created.promise);
    const { user } = renderBuilder();
    await toTargetReady(user);

    const save = screen.getByRole("button", { name: /Save Draft/ });
    await act(async () => {
      save.click();
      save.click();
    });
    await act(async () => created.resolve({ id: "survey-1" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Save Draft/ })).toBeEnabled());
    expect(mockApi.callsOf("post", "/surveys")).toHaveLength(1);
  });

  it("does not create a second survey when Next follows Save Draft", async () => {
    const created = deferred<{ id: string }>();
    mockApi.on("post", "/surveys", () => created.promise);
    const { user } = renderBuilder();
    await toTargetReady(user);

    await user.click(screen.getByRole("button", { name: /Save Draft/ }));
    await waitFor(() => expect(mockApi.callsOf("post", "/surveys")).toHaveLength(1));
    await user.click(next());
    expect(mockApi.callsOf("post", "/surveys")).toHaveLength(1);

    await act(async () => created.resolve({ id: "survey-1" }));
    expect(await screen.findByText("Select Fields")).toBeInTheDocument();
    expect(mockApi.callsOf("post", "/surveys")).toHaveLength(1);
    // Next's own save went to the survey Save Draft created.
    await waitFor(() => expect(mockApi.callsOf("patch", "/surveys/survey-1")).toHaveLength(1));
  });

  it("previews the survey Save Draft is creating instead of creating another", async () => {
    let attempt = 0;
    const created = deferred<{ id: string }>();
    mockApi.on("post", "/surveys", () => {
      attempt += 1;
      if (attempt === 1) throw new Error("db down");
      return created.promise;
    });
    const { user } = renderBuilder();
    await toTargetReady(user);
    await user.click(next());
    // The Target step's auto-save was refused: there is still no draft id.
    expect(await screen.findByText("db down")).toBeInTheDocument();
    await screen.findByText("Select Fields");
    await user.click(screen.getByText("Criticality"));

    await user.click(screen.getByRole("button", { name: /Save Draft/ }));
    await waitFor(() => expect(mockApi.callsOf("post", "/surveys")).toHaveLength(2));
    await user.click(next());
    await screen.findByText("Preview & Send", { selector: "h6" });

    await act(async () => created.resolve({ id: "survey-1" }));
    expect(await screen.findByText("CRM")).toBeInTheDocument();
    // The refused save and ONE create; the preview read that survey, after the
    // write that carries the field just ticked.
    expect(mockApi.callsOf("post", "/surveys")).toHaveLength(2);
    expect(mockApi.callsOf("post", /\/preview$/).map((c) => c.path)).toEqual([
      "/surveys/survey-1/preview",
    ]);
    expect((lastDraft().fields as { key: string }[]).map((f) => f.key)).toEqual(["criticality"]);
  });
});

describe("SurveyBuilder — the Via relation select when the related cards change", () => {
  const ITC = makeCardType({ key: "ITComponent", label: "IT Component" });
  const APP_RUNS_ON_ITC = makeRelationType({
    key: "relAppToITC",
    source_type_key: "Application",
    target_type_key: "ITComponent",
    label: "runs on",
    reverse_label: "hosts",
  });
  const ITC_SERVES_APP = makeRelationType({
    key: "relITCToApp",
    source_type_key: "ITComponent",
    target_type_key: "Application",
    label: "serves",
    reverse_label: "is served by",
  });

  beforeEach(() => {
    withMetamodel(
      [APP, ORG, RETIRED, ITC],
      [ORG_OWNS_APP, APP_USED_BY_ORG, APP_RUNS_ON_ITC, ITC_SERVES_APP],
    );
  });

  it("shows «Any relation», without MUI's out-of-range warning, once the chosen one no longer applies", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { user } = renderBuilder();
      await toTargetReady(user);
      await user.click(screen.getByText("related: Org"));
      await user.click(await screen.findByRole("combobox", { name: /Via relation/ }));
      await user.click(await screen.findByRole("option", { name: "is owned by" }));
      await waitFor(() =>
        expect(screen.getByRole("combobox", { name: /Via relation/ })).toHaveTextContent(
          "is owned by",
        ),
      );

      // Cards of another type: the select stays, offering their two relations.
      await user.click(screen.getByText("related: two ITCs"));
      await waitFor(() =>
        expect(screen.getByRole("combobox", { name: /Via relation/ })).toHaveTextContent(
          "Any relation",
        ),
      );
      await user.click(screen.getByRole("combobox", { name: /Via relation/ }));
      expect(await screen.findByRole("option", { name: "runs on" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "is served by" })).toBeInTheDocument();

      const outOfRange = warn.mock.calls.filter((args) => String(args[0]).includes("out-of-range"));
      expect(outOfRange).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("SurveyBuilder — Back while Next is saving", () => {
  const back = () => screen.getByRole("button", { name: /Back$/ });

  it("is disabled until Next's save has finished", async () => {
    const created = deferred<{ id: string }>();
    mockApi.on("post", "/surveys", () => created.promise);
    const { user } = renderBuilder();
    await toTargetReady(user);
    expect(back()).toBeEnabled();

    await user.click(next());
    await waitFor(() => expect(mockApi.callsOf("post", "/surveys")).toHaveLength(1));
    expect(back()).toBeDisabled();

    await act(async () => created.resolve({ id: "survey-1" }));
    expect(await screen.findByText("Select Fields")).toBeInTheDocument();
    await waitFor(() => expect(back()).toBeEnabled());
  });

  it("ignores a Back click that lands before Next re-renders", async () => {
    const created = deferred<{ id: string }>();
    mockApi.on("post", "/surveys", () => created.promise);
    const { user } = renderBuilder();
    await toTargetReady(user);

    const nextButton = next();
    const backButton = back();
    await act(async () => {
      nextButton.click();
      backButton.click();
    });
    // Still on the Target step while the save runs — not sent back to Basics.
    expect(screen.getByText("Target Cards")).toBeInTheDocument();

    await act(async () => created.resolve({ id: "survey-1" }));
    // Next's step, not the one Back would have bounced it to.
    expect(await screen.findByText("Select Fields")).toBeInTheDocument();
    expect(screen.queryByText("Target Cards")).not.toBeInTheDocument();
  });
});

describe("SurveyBuilder — messages after a language switch", () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  const toGerman = () =>
    act(async () => {
      await i18n.changeLanguage("de");
    });

  it("words a failed Save Draft in the language now in use", async () => {
    mockApi.on("post", "/surveys", () => Promise.reject("offline"));
    const { user } = renderBuilder();
    await toTargetReady(user);

    await toGerman();
    await user.click(screen.getByRole("button", { name: "Entwurf speichern" }));
    expect(await screen.findByText("Etwas ist schiefgelaufen")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });

  it("words a failed preview in the language now in use", async () => {
    mockApi.on("post", "/surveys/survey-1/preview", () => Promise.reject("offline"));
    const { user } = renderBuilder();
    await toTargetReady(user);
    await user.click(next());
    await screen.findByText("Select Fields");
    await user.click(screen.getByText("Criticality"));
    await user.click(next());
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();

    await toGerman();
    await user.click(await screen.findByRole("button", { name: "Vorschau laden" }));
    expect(await screen.findByText("Etwas ist schiefgelaufen")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });

  it("words a failed load in the language chosen while it was loading", async () => {
    let failLoad!: (reason: unknown) => void;
    mockApi.on("get", "/surveys/survey-7", () => new Promise((_, reject) => (failLoad = reject)));
    renderBuilder("/admin/surveys/survey-7");
    await waitFor(() => expect(mockApi.callsOf("get", "/surveys/survey-7")).toHaveLength(1));

    await toGerman();
    await act(async () => failLoad("offline"));
    expect(await screen.findByText("Etwas ist schiefgelaufen")).toBeInTheDocument();
  });

  it("keeps the open draft and its edits — no reload — when the language changes", async () => {
    mockApi.on("get", "/surveys/survey-7", { ...SAVED, target_filters: {} });
    const { user } = renderBuilder("/admin/surveys/survey-7");
    await openDraft();
    const nameField = screen.getByLabelText(/Survey Name/);
    await user.clear(nameField);
    await user.type(nameField, "Edited");

    await toGerman();
    await waitFor(() => expect(screen.getByRole("button", { name: /Weiter/ })).toBeInTheDocument());
    expect(mockApi.callsOf("get", "/surveys/survey-7")).toHaveLength(1);
    expect(screen.getByDisplayValue("Edited")).toBeInTheDocument();
  });
});
