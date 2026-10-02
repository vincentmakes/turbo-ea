import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useCurrency", () => import("@/test/hooks").then((m) => m.useCurrencyModule()));
// `useDateFormat` runs for real: it reads one setting through the scripted api
// and formats with the same `formatDateTimeWith` the assertions use.

import i18n from "@/i18n";
import { formatDateTimeWith } from "@/hooks/useDateFormat";
import { mockApi } from "@/test/apiMock";
import { CARD_TYPES, RELATION_TYPES } from "@/test/fixtures/metamodel";
import { hookState, withMetamodel } from "@/test/hooks";
import { renderWithProviders } from "@/test/render";
import type { SnowConnection, SnowMapping, SnowStagedRecord, SnowSyncRun } from "@/types";
import ServiceNowAdmin from "./ServiceNowAdmin";

const T = (key: string, opts: Record<string, unknown> = {}) =>
  i18n.t(key, { ns: ["admin", "common"], ...opts }) as string;

// MUI renders `startIcon` as the Material Symbol's name in text, so a button's
// accessible name is "<icon><label>"; match on the label alone.
const named = (label: string) => (name: string) => name === label || name.endsWith(label);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CONN_PROD: SnowConnection = {
  id: "c1",
  name: "Prod SNOW",
  instance_url: "https://acme.service-now.com",
  auth_type: "basic",
  is_active: true,
  test_status: "success",
  mapping_count: 2,
};

const CONN_DEV: SnowConnection = {
  id: "c2",
  name: "Dev SNOW",
  instance_url: "https://dev.service-now.com",
  auth_type: "oauth2",
  is_active: false,
  test_status: "failed",
  mapping_count: 0,
};

const MAP_APP: SnowMapping = {
  id: "m1",
  connection_id: "c1",
  card_type_key: "Application",
  snow_table: "cmdb_ci_business_app",
  sync_direction: "snow_to_turbo",
  sync_mode: "conservative",
  max_deletion_ratio: 0.5,
  filter_query: "active=true",
  skip_staging: false,
  is_active: true,
  field_mappings: [
    {
      id: "f1",
      turbo_field: "name",
      snow_field: "name",
      direction: "snow_leads",
      transform_type: null,
      transform_config: null,
      default_value: null,
      is_identity: true,
    },
    {
      id: "f2",
      turbo_field: "attributes.businessCriticality",
      snow_field: "",
      direction: "turbo_leads",
      transform_type: "value_map",
      transform_config: null,
      default_value: "businessCritical",
      is_identity: false,
    },
  ],
};

const MAP_ITC: SnowMapping = {
  id: "m2",
  connection_id: "c1",
  card_type_key: "ITComponent",
  snow_table: "cmdb_ci_server",
  sync_direction: "bidirectional",
  sync_mode: "additive",
  max_deletion_ratio: 0.25,
  filter_query: null,
  skip_staging: true,
  is_active: true,
  field_mappings: [],
};

// Inactive, on a connection that no longer exists, for a type the metamodel
// does not know: every fallback branch of the card at once.
const MAP_OFF: SnowMapping = {
  id: "m3",
  connection_id: "gone",
  card_type_key: "Ghost",
  snow_table: "x_ghost",
  sync_direction: "turbo_to_snow",
  sync_mode: "strict",
  max_deletion_ratio: 1,
  filter_query: null,
  skip_staging: false,
  is_active: false,
  field_mappings: [],
};

const RUNS: SnowSyncRun[] = [
  {
    id: "r1",
    connection_id: "c1",
    mapping_id: "m1",
    status: "completed",
    direction: "pull",
    started_at: "2026-09-30T10:00:00Z",
    completed_at: "2026-09-30T10:00:12Z",
    stats: { fetched: 40, created: 3, updated: 5, deleted: 1, errors: 0 },
  },
  {
    id: "r2",
    connection_id: "c1",
    mapping_id: "m2",
    status: "failed",
    direction: "push",
    started_at: "2026-09-29T08:00:00Z",
    completed_at: null,
    stats: { processed: 7, errors: 2 },
    error_message: "boom",
  },
];

const STAGED: SnowStagedRecord[] = [
  {
    id: "s1",
    snow_sys_id: "abc123",
    card_id: "abcdef12-0000-4000-8000-000000000001",
    action: "create",
    status: "pending",
    diff: { name: { old: null, new: "X" }, description: { old: "a", new: "b" } },
  },
  {
    id: "s2",
    snow_sys_id: "def456",
    card_id: null,
    action: "delete",
    status: "error",
    diff: null,
    error_message: "Guard tripped",
  },
];

/** The mutable server state the GET routes read, so a save's reload reflects it. */
let connections: SnowConnection[];
let mappings: SnowMapping[];

function scriptDefaults() {
  connections = [CONN_PROD, CONN_DEV];
  mappings = [MAP_APP, MAP_ITC, MAP_OFF];
  mockApi.on("get", "/settings/date-format", { date_format: "YYYY-MM-DD" });
  mockApi.on("get", "/servicenow/connections", () => connections);
  mockApi.on("get", "/servicenow/mappings", () => mappings);
  mockApi.on("get", "/servicenow/sync/runs?limit=50", RUNS);
  mockApi.on("get", /^\/servicenow\/sync\/runs\/[^/]+\/staged$/, STAGED);
  mockApi.on("post", "/servicenow/connections", (_p, body) => ({ id: "c3", ...(body as object) }));
  mockApi.on("patch", /^\/servicenow\/connections\/[^/]+$/, {});
  mockApi.on("delete", /^\/servicenow\/connections\/[^/]+$/, {});
  mockApi.on("post", /^\/servicenow\/connections\/[^/]+\/test$/, { success: true, message: "Reached 1 record" });
  mockApi.on("post", "/servicenow/mappings", (_p, body) => ({ id: "m9", ...(body as object) }));
  mockApi.on("patch", /^\/servicenow\/mappings\/[^/]+$/, (path, body) => {
    const id = path.split("/").pop()!;
    mappings = mappings.map((m) => (m.id === id ? { ...m, ...(body as Partial<SnowMapping>) } : m));
    return mappings.find((m) => m.id === id);
  });
  mockApi.on("delete", /^\/servicenow\/mappings\/[^/]+$/, {});
  mockApi.on("post", /^\/servicenow\/sync\/(pull|push)\/[^/]+$/, { id: "r3" });
}

/**
 * Set a text input in one change event. The mapping dialog re-renders its whole
 * form on every keystroke, so per-character typing is what made its tests slow;
 * the page reads `event.target.value` either way (the Autocomplete's
 * `onInputChange` included).
 */
function setValue(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

function card(text: string | RegExp): HTMLElement {
  return screen.getByText(text).closest(".MuiCard-root") as HTMLElement;
}

async function openTab(user: ReturnType<typeof renderWithProviders>["user"], key: string) {
  await user.click(screen.getByRole("tab", { name: T(key) }));
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel(CARD_TYPES, RELATION_TYPES);
  scriptDefaults();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

describe("ServiceNowAdmin connections", () => {
  it("lists the connections with their auth, test state, activity and mapping count", async () => {
    renderWithProviders(<ServiceNowAdmin />);
    expect(screen.getByRole("tab", { name: T("servicenow.tabs.connections") })).toHaveAttribute("aria-selected", "true");

    const prod = (await screen.findByText("Prod SNOW")).closest(".MuiCard-root") as HTMLElement;
    expect(mockApi.callsOf("get", "/servicenow/connections")).toHaveLength(1);
    expect(within(prod).getByText("https://acme.service-now.com")).toBeInTheDocument();
    expect(within(prod).getByText("BASIC")).toBeInTheDocument();
    expect(within(prod).getByText(T("servicenow.connections.connected"))).toBeInTheDocument();
    expect(within(prod).getByText(T("servicenow.connections.mappingCount", { count: 2 }))).toBeInTheDocument();
    expect(within(prod).queryByText(T("servicenow.connections.inactive"))).not.toBeInTheDocument();

    const dev = card("Dev SNOW");
    expect(within(dev).getByText("OAUTH2")).toBeInTheDocument();
    expect(within(dev).getByText(T("servicenow.connections.failed"))).toBeInTheDocument();
    expect(within(dev).getByText(T("servicenow.connections.inactive"))).toBeInTheDocument();
    expect(within(dev).getByText(T("servicenow.connections.mappingCount", { count: 0 }))).toBeInTheDocument();
  });

  it("shows the empty state and the load error", async () => {
    connections = [];
    const { unmount } = renderWithProviders(<ServiceNowAdmin />);
    expect(await screen.findByText(T("servicenow.connections.noConnections"))).toBeInTheDocument();
    unmount();

    mockApi.fail("get", "/servicenow/connections", 500);
    renderWithProviders(<ServiceNowAdmin />);
    expect(await screen.findByRole("alert")).toHaveTextContent("GET /servicenow/connections failed");
  });

  it("creates a basic-auth connection and reloads the list", async () => {
    const { user } = renderWithProviders(<ServiceNowAdmin />);
    await screen.findByText("Prod SNOW");

    await user.click(screen.getByRole("button", { name: named(T("servicenow.connections.addConnection")) }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(T("servicenow.connections.dialog.newConnection"))).toBeInTheDocument();
    const create = within(dialog).getByRole("button", { name: T("common:actions.create") });
    expect(create).toBeDisabled();

    await user.type(within(dialog).getByLabelText(T("common:labels.name")), "New SNOW");
    const url = within(dialog).getByLabelText(T("servicenow.connections.dialog.instanceUrl"));
    expect(url).toHaveValue("https://");
    await user.type(url, "new.service-now.com");
    await user.type(within(dialog).getByLabelText(T("servicenow.connections.dialog.username")), "svc");
    await user.type(within(dialog).getByLabelText(T("servicenow.connections.dialog.password")), "s3cret");
    expect(create).toBeEnabled();
    await user.click(create);

    await waitFor(() =>
      expect(mockApi.callsOf("post", "/servicenow/connections")[0]?.body).toEqual({
        name: "New SNOW",
        instance_url: "https://new.service-now.com",
        auth_type: "basic",
        username: "svc",
        password: "s3cret",
        client_id: "",
        client_secret: "",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("get", "/servicenow/connections")).toHaveLength(2);
  });

  it("edits a connection, switching it to OAuth 2.0 with the keep-existing hint on the secret", async () => {
    const { user } = renderWithProviders(<ServiceNowAdmin />);
    await screen.findByText("Prod SNOW");

    await user.click(within(card("Prod SNOW")).getByRole("button", { name: T("common:actions.edit") }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(T("servicenow.connections.dialog.editConnection"))).toBeInTheDocument();
    expect(within(dialog).getByLabelText(T("common:labels.name"))).toHaveValue("Prod SNOW");
    // Credentials are never echoed back; the password field only hints at keeping them.
    expect(within(dialog).getByLabelText(T("servicenow.connections.dialog.password"))).toHaveAttribute(
      "placeholder",
      T("servicenow.connections.dialog.keepExisting"),
    );

    await user.click(within(dialog).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: T("servicenow.connections.dialog.oauth2") }));
    await user.type(within(dialog).getByLabelText(T("servicenow.connections.dialog.clientId")), "cid");
    expect(within(dialog).getByLabelText(T("servicenow.connections.dialog.clientSecret"))).toHaveAttribute(
      "placeholder",
      T("servicenow.connections.dialog.keepExisting"),
    );
    await user.click(within(dialog).getByRole("button", { name: T("common:actions.save") }));

    await waitFor(() =>
      expect(mockApi.callsOf("patch", "/servicenow/connections/c1")[0]?.body).toEqual(
        expect.objectContaining({ name: "Prod SNOW", auth_type: "oauth2", client_id: "cid", client_secret: "" }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("keeps the dialog open with the error when the save fails", async () => {
    mockApi.fail("post", "/servicenow/connections", 422, "bad url");
    const { user } = renderWithProviders(<ServiceNowAdmin />);
    await screen.findByText("Prod SNOW");
    await user.click(screen.getByRole("button", { name: named(T("servicenow.connections.addConnection")) }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(T("common:labels.name")), "Broken");
    await user.click(within(dialog).getByRole("button", { name: T("common:actions.create") }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("POST /servicenow/connections failed");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("tests a connection and reports the outcome inline, success and failure alike", async () => {
    mockApi.on("post", "/servicenow/connections/c2/test", { success: false, message: "401 Unauthorized" });
    const { user } = renderWithProviders(<ServiceNowAdmin />);
    await screen.findByText("Prod SNOW");

    await user.click(within(card("Prod SNOW")).getByRole("button", { name: T("servicenow.connections.testTooltip") }));
    const ok = await within(card("Prod SNOW")).findByRole("alert");
    expect(ok).toHaveTextContent("Reached 1 record");
    expect(ok).toHaveClass("MuiAlert-standardSuccess");
    expect(mockApi.callsOf("post", "/servicenow/connections/c1/test")).toHaveLength(1);
    // A test refreshes the list so the stored test_status chip follows.
    expect(mockApi.callsOf("get", "/servicenow/connections")).toHaveLength(2);

    await user.click(within(card("Dev SNOW")).getByRole("button", { name: T("servicenow.connections.testTooltip") }));
    const failed = await within(card("Dev SNOW")).findByRole("alert");
    expect(failed).toHaveTextContent("401 Unauthorized");
    expect(failed).toHaveClass("MuiAlert-standardError");
    // Only one result is shown at a time.
    expect(within(card("Prod SNOW")).queryByRole("alert")).not.toBeInTheDocument();

    await user.click(within(failed).getByRole("button"));
    await waitFor(() => expect(within(card("Dev SNOW")).queryByRole("alert")).not.toBeInTheDocument());
  });

  it("reports a test whose request itself failed", async () => {
    mockApi.fail("post", "/servicenow/connections/c1/test", 502);
    const { user } = renderWithProviders(<ServiceNowAdmin />);
    await screen.findByText("Prod SNOW");
    await user.click(within(card("Prod SNOW")).getByRole("button", { name: T("servicenow.connections.testTooltip") }));
    expect(await within(card("Prod SNOW")).findByRole("alert")).toHaveTextContent(
      "POST /servicenow/connections/c1/test failed",
    );
  });

  it("deletes a connection only after the confirmation", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { user } = renderWithProviders(<ServiceNowAdmin />);
    await screen.findByText("Prod SNOW");
    const del = within(card("Prod SNOW")).getByRole("button", { name: T("common:actions.delete") });

    await user.click(del);
    expect(confirmSpy).toHaveBeenCalledWith(T("servicenow.connections.deleteConfirm"));
    expect(mockApi.callsOf("delete")).toHaveLength(0);

    confirmSpy.mockReturnValue(true);
    await user.click(del);
    await waitFor(() => expect(mockApi.callsOf("delete", "/servicenow/connections/c1")).toHaveLength(1));
    await waitFor(() => expect(mockApi.callsOf("get", "/servicenow/connections")).toHaveLength(2));
  });

  it("surfaces a failed delete", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockApi.fail("delete", "/servicenow/connections/c1", 500);
    const { user } = renderWithProviders(<ServiceNowAdmin />);
    await screen.findByText("Prod SNOW");
    await user.click(within(card("Prod SNOW")).getByRole("button", { name: T("common:actions.delete") }));
    expect(await screen.findByRole("alert")).toHaveTextContent("DELETE /servicenow/connections/c1 failed");
  });
});

// ---------------------------------------------------------------------------
// Mappings
// ---------------------------------------------------------------------------

describe("ServiceNowAdmin mappings", () => {
  it("lists the mappings with their type, table, connection, mode, field count and field table", async () => {
    const { user } = renderWithProviders(<ServiceNowAdmin />);
    await screen.findByText("Prod SNOW");
    await openTab(user, "servicenow.tabs.mappings");

    const app = (await screen.findByText("cmdb_ci_business_app")).closest(".MuiCard-root") as HTMLElement;
    expect(mockApi.callsOf("get", "/servicenow/mappings")).toHaveLength(1);
    expect(within(app).getByText(/^Application/)).toBeInTheDocument();
    expect(within(app).getByText(/Prod SNOW · snow to turbo · conservative mode · 2 fields/)).toBeInTheDocument();
    expect(within(app).getByLabelText(T("common:status.active"))).toBeChecked();
    // The field table: identity key, constant rows, default values, direction chips, transform.
    const nameRow = within(app).getAllByText("name", { selector: "td" })[0].closest("tr")!;
    expect(within(nameRow).getByText("key")).toBeInTheDocument();
    expect(within(nameRow).getByText(T("servicenow.mappings.direction.snowLeads"))).toBeInTheDocument();
    expect(within(nameRow).getByText(T("servicenow.mappings.dialog.direct"))).toBeInTheDocument();
    const critRow = within(app).getByText("attributes.businessCriticality").closest("tr")!;
    expect(within(critRow).getByText(T("servicenow.mappings.dialog.constantTag"))).toBeInTheDocument();
    expect(within(critRow).getByText("businessCritical")).toBeInTheDocument();
    expect(within(critRow).getByText(T("servicenow.mappings.direction.turboLeads"))).toBeInTheDocument();
    expect(within(critRow).getByText("value_map")).toBeInTheDocument();

    // Unknown type and connection degrade to the raw key and a placeholder; inactive is dimmed.
    const off = card("x_ghost");
    expect(within(off).getByText(/^Ghost/)).toBeInTheDocument();
    expect(within(off).getByText(new RegExp(T("servicenow.mappings.unknownConnection")))).toBeInTheDocument();
    expect(within(off).getByLabelText(T("common:status.active"))).not.toBeChecked();
  });

  it("asks for a connection first, and shows the empty state without mappings", async () => {
    connections = [];
    const { user, unmount } = renderWithProviders(<ServiceNowAdmin />);
    await openTab(user, "servicenow.tabs.mappings");
    expect(await screen.findByText(T("servicenow.mappings.noConnectionsHint"))).toBeInTheDocument();
    unmount();

    connections = [CONN_PROD];
    mappings = [];
    const second = renderWithProviders(<ServiceNowAdmin />);
    await openTab(second.user, "servicenow.tabs.mappings");
    expect(await screen.findByText(T("servicenow.mappings.noMappings"))).toBeInTheDocument();
  });

  it("toggles a mapping's activity with a PATCH", async () => {
    const { user } = renderWithProviders(<ServiceNowAdmin />);
    await openTab(user, "servicenow.tabs.mappings");
    const app = (await screen.findByText("cmdb_ci_business_app")).closest(".MuiCard-root") as HTMLElement;

    await user.click(within(app).getByLabelText(T("common:status.active")));
    await waitFor(() =>
      expect(mockApi.callsOf("patch", "/servicenow/mappings/m1")[0]?.body).toEqual({ is_active: false }),
    );
    await waitFor(() => expect(within(card("cmdb_ci_business_app")).getByLabelText(T("common:status.active"))).not.toBeChecked());
  });

  it("deletes a mapping after the confirmation", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user } = renderWithProviders(<ServiceNowAdmin />);
    await openTab(user, "servicenow.tabs.mappings");
    const app = (await screen.findByText("cmdb_ci_business_app")).closest(".MuiCard-root") as HTMLElement;

    await user.click(within(app).getByRole("button", { name: T("common:actions.delete") }));
    expect(confirmSpy).toHaveBeenCalledWith(`${T("common:actions.delete")}?`);
    await waitFor(() => expect(mockApi.callsOf("delete", "/servicenow/mappings/m1")).toHaveLength(1));
    await waitFor(() => expect(mockApi.callsOf("get", "/servicenow/mappings")).toHaveLength(2));
  });

  it("creates a mapping with the field rows the dialog shows", async () => {
    const { user } = renderWithProviders(<ServiceNowAdmin />);
    await openTab(user, "servicenow.tabs.mappings");
    await screen.findByText("cmdb_ci_business_app");

    await user.click(screen.getByRole("button", { name: named(T("servicenow.mappings.addMapping")) }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(T("servicenow.mappings.dialog.newMapping"))).toBeInTheDocument();
    const create = within(dialog).getByRole("button", { name: T("common:actions.create") });
    expect(create).toBeDisabled();
    expect(within(dialog).getByText(T("servicenow.mappings.dialog.selectCardTypeHint"))).toBeInTheDocument();

    // Four selects in a fresh dialog, in layout order: connection, type, direction, mode.
    // None carries an accessible name (the InputLabel has no id), hence the index.
    const [connection, type, , mode] = within(dialog).getAllByRole("combobox");
    expect(connection).toHaveTextContent("Prod SNOW");
    await user.click(type);
    const options = await screen.findByRole("listbox");
    // A hidden type is not offered.
    expect(within(options).queryByRole("option", { name: "Secret" })).not.toBeInTheDocument();
    await user.click(within(options).getByRole("option", { name: "Application" }));
    await user.click(mode);
    await user.click(await screen.findByRole("option", { name: T("servicenow.mappings.dialog.strict") }));
    setValue(within(dialog).getByLabelText(T("servicenow.mappings.dialog.snowTable")), "ci_app");
    setValue(within(dialog).getByLabelText(T("servicenow.mappings.dialog.filterQuery")), "q=1");
    await user.click(within(dialog).getByLabelText(T("servicenow.mappings.dialog.skipStaging")));
    expect(within(dialog).getByText(T("servicenow.mappings.dialog.skipStagingWarning"))).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: named(T("servicenow.mappings.dialog.addField")) }));
    expect(within(dialog).queryByText(T("servicenow.mappings.dialog.selectCardTypeHint"))).not.toBeInTheDocument();
    setValue(within(dialog).getByLabelText(T("servicenow.mappings.dialog.turboEaField")), "x.thing");
    setValue(within(dialog).getByLabelText(T("servicenow.mappings.dialog.snowFieldLabel")), "u_thing");
    await user.click(within(dialog).getByRole("checkbox", { name: "ID" }));
    // A second row left without a source field or a default is not sent.
    await user.click(within(dialog).getByRole("button", { name: named(T("servicenow.mappings.dialog.addField")) }));
    setValue(within(dialog).getAllByLabelText(T("servicenow.mappings.dialog.turboEaField"))[1], "x.zzz");

    expect(create).toBeEnabled();
    await user.click(create);
    await waitFor(() =>
      expect(mockApi.callsOf("post", "/servicenow/mappings")[0]?.body).toEqual({
        connection_id: "c1",
        card_type_key: "Application",
        snow_table: "ci_app",
        sync_direction: "snow_to_turbo",
        sync_mode: "strict",
        max_deletion_ratio: 0.5,
        filter_query: "q=1",
        skip_staging: true,
        field_mappings: [
          {
            turbo_field: "x.thing",
            snow_field: "u_thing",
            direction: "snow_leads",
            transform_type: "direct",
            transform_config: null,
            default_value: null,
            is_identity: true,
          },
        ],
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("get", "/servicenow/mappings")).toHaveLength(2);
  });

  it("stores the typed Turbo EA field path, never the option's display label (2.156.2)", async () => {
    // The row's Autocomplete is `freeSolo` with a controlled `value`. Once the
    // typed text equalled an option path, MUI re-synced the input to the
    // option's label ("name — Name") and fired `onInputChange` with reason
    // "reset"; the handler wrote that label into `turbo_field`, and the
    // backend then split `attributes.<label>` into an attribute key that does
    // not exist. The input now shows the path and only typing is written.
    const { user } = renderWithProviders(<ServiceNowAdmin />);
    await openTab(user, "servicenow.tabs.mappings");
    await screen.findByText("cmdb_ci_business_app");
    await user.click(screen.getByRole("button", { name: named(T("servicenow.mappings.addMapping")) }));
    const dialog = await screen.findByRole("dialog");
    const [, type] = within(dialog).getAllByRole("combobox");
    await user.click(type);
    await user.click(within(await screen.findByRole("listbox")).getByRole("option", { name: "Application" }));
    setValue(within(dialog).getByLabelText(T("servicenow.mappings.dialog.snowTable")), "t");

    // Row 1: the path typed in full.
    await user.click(within(dialog).getByRole("button", { name: named(T("servicenow.mappings.dialog.addField")) }));
    setValue(within(dialog).getAllByLabelText(T("servicenow.mappings.dialog.turboEaField"))[0], "name");
    setValue(within(dialog).getAllByLabelText(T("servicenow.mappings.dialog.snowFieldLabel"))[0], "name");
    // Row 2: the same option picked from the list.
    await user.click(within(dialog).getByRole("button", { name: named(T("servicenow.mappings.dialog.addField")) }));
    const second = within(dialog).getAllByLabelText(T("servicenow.mappings.dialog.turboEaField"))[1];
    await user.click(second);
    // Row 1's popup is still open (set without focus, so nothing blurred it);
    // pick from the listbox this input owns.
    const listbox = document.getElementById(second.getAttribute("aria-controls")!)!;
    await user.click(within(listbox).getByRole("option", { name: "description — Description" }));
    setValue(within(dialog).getAllByLabelText(T("servicenow.mappings.dialog.snowFieldLabel"))[1], "sd");
    // The inputs show the path, not the label form.
    expect(
      within(dialog)
        .getAllByLabelText(T("servicenow.mappings.dialog.turboEaField"))
        .map((el) => (el as HTMLInputElement).value),
    ).toEqual(["name", "description"]);
    await user.click(within(dialog).getByRole("button", { name: T("common:actions.create") }));

    await waitFor(() => expect(mockApi.callsOf("post", "/servicenow/mappings")).toHaveLength(1));
    const body = mockApi.callsOf("post", "/servicenow/mappings")[0].body as { field_mappings: { turbo_field: string }[] };
    expect(body.field_mappings.map((fm) => fm.turbo_field)).toEqual(["name", "description"]);
  });

  it("saves an edited field list and shows exactly that list afterwards, in the card and in the reopened dialog", async () => {
    const { user } = renderWithProviders(<ServiceNowAdmin />);
    await openTab(user, "servicenow.tabs.mappings");
    const app = (await screen.findByText("cmdb_ci_business_app")).closest(".MuiCard-root") as HTMLElement;

    await user.click(within(app).getByRole("button", { name: T("common:actions.edit") }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(T("servicenow.mappings.dialog.editMapping"))).toBeInTheDocument();
    // The connection is fixed once a mapping exists.
    expect(within(dialog).getAllByRole("combobox")[0]).toHaveAttribute("aria-disabled", "true");
    expect(within(dialog).getByLabelText(T("servicenow.mappings.dialog.snowTable"))).toHaveValue("cmdb_ci_business_app");
    expect(within(dialog).getByLabelText(T("servicenow.mappings.dialog.filterQuery"))).toHaveValue("active=true");
    expect(within(dialog).getByText(T("servicenow.mappings.dialog.maxDeletionRatio", { value: 50 }))).toBeInTheDocument();

    const snowFields = within(dialog).getAllByLabelText(T("servicenow.mappings.dialog.snowFieldLabel"));
    expect(snowFields.map((i) => (i as HTMLInputElement).value)).toEqual(["name", ""]);
    // The single_select default renders through the type-aware editor with the option's label.
    expect(within(dialog).getByText("Business Critical")).toBeInTheDocument();

    setValue(snowFields[1], "u_crit");
    await user.click(within(dialog).getByRole("button", { name: named(T("servicenow.mappings.dialog.addField")) }));
    setValue(within(dialog).getAllByLabelText(T("servicenow.mappings.dialog.turboEaField"))[2], "x.notes");
    setValue(within(dialog).getAllByLabelText(T("servicenow.mappings.dialog.snowFieldLabel"))[2], "cmt");
    await user.click(within(dialog).getByRole("button", { name: T("common:actions.save") }));

    await waitFor(() => expect(mockApi.callsOf("patch", "/servicenow/mappings/m1")).toHaveLength(1));
    const body = mockApi.callsOf("patch", "/servicenow/mappings/m1")[0].body as SnowMapping;
    expect(body.field_mappings).toEqual([
      { turbo_field: "name", snow_field: "name", direction: "snow_leads", transform_type: "direct", transform_config: null, default_value: null, is_identity: true },
      { turbo_field: "attributes.businessCriticality", snow_field: "u_crit", direction: "turbo_leads", transform_type: "value_map", transform_config: null, default_value: "businessCritical", is_identity: false },
      { turbo_field: "x.notes", snow_field: "cmt", direction: "snow_leads", transform_type: "direct", transform_config: null, default_value: null, is_identity: false },
    ]);
    expect(body).toEqual(expect.objectContaining({ connection_id: "c1", card_type_key: "Application", max_deletion_ratio: 0.5 }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // The reloaded card carries the saved list…
    const reloaded = await screen.findByText(/Prod SNOW · snow to turbo · conservative mode · 3 fields/);
    const reloadedCard = reloaded.closest(".MuiCard-root") as HTMLElement;
    expect(within(reloadedCard).getByText("x.notes")).toBeInTheDocument();
    expect(within(reloadedCard).getByText("cmt")).toBeInTheDocument();
    expect(within(reloadedCard).getByText("u_crit")).toBeInTheDocument();

    // …and so does the dialog when it is opened again.
    await user.click(within(reloadedCard).getByRole("button", { name: T("common:actions.edit") }));
    const again = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(
        within(again)
          .getAllByLabelText(T("servicenow.mappings.dialog.snowFieldLabel"))
          .map((i) => (i as HTMLInputElement).value),
      ).toEqual(["name", "u_crit", "cmt"]),
    );
  });

  it("drops a row and resets a default when its target field changes", async () => {
    const { user } = renderWithProviders(<ServiceNowAdmin />);
    await openTab(user, "servicenow.tabs.mappings");
    const app = (await screen.findByText("cmdb_ci_business_app")).closest(".MuiCard-root") as HTMLElement;
    await user.click(within(app).getByRole("button", { name: T("common:actions.edit") }));
    const dialog = await screen.findByRole("dialog");

    // Remove the identity row.
    await user.click(within(dialog).getAllByRole("button", { name: "close" })[0]);
    expect(within(dialog).getAllByLabelText(T("servicenow.mappings.dialog.snowFieldLabel"))).toHaveLength(1);
    // Retargeting the remaining row clears its (now possibly mistyped) default.
    const target = within(dialog).getByLabelText(T("servicenow.mappings.dialog.turboEaField"));
    setValue(target, "x.crit");
    expect(within(dialog).queryByText("Business Critical")).not.toBeInTheDocument();
    setValue(within(dialog).getByLabelText(T("servicenow.mappings.dialog.snowFieldLabel")), "crit");
    await user.click(within(dialog).getByRole("button", { name: T("common:actions.save") }));

    await waitFor(() => expect(mockApi.callsOf("patch", "/servicenow/mappings/m1")).toHaveLength(1));
    const body = mockApi.callsOf("patch", "/servicenow/mappings/m1")[0].body as SnowMapping;
    expect(body.field_mappings).toEqual([
      expect.objectContaining({ turbo_field: "x.crit", snow_field: "crit", default_value: null }),
    ]);
  });

  it("keeps the dialog open with the error when the mapping save fails", async () => {
    mockApi.fail("patch", "/servicenow/mappings/m1", 400, "bad");
    const { user } = renderWithProviders(<ServiceNowAdmin />);
    await openTab(user, "servicenow.tabs.mappings");
    const app = (await screen.findByText("cmdb_ci_business_app")).closest(".MuiCard-root") as HTMLElement;
    await user.click(within(app).getByRole("button", { name: T("common:actions.edit") }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: T("common:actions.save") }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("PATCH /servicenow/mappings/m1 failed");
  });
});

// ---------------------------------------------------------------------------
// Sync dashboard
// ---------------------------------------------------------------------------

describe("ServiceNowAdmin sync dashboard", () => {
  it("lists the active mappings with the sync actions their direction allows, and the run history", async () => {
    const { user } = renderWithProviders(<ServiceNowAdmin />);
    await openTab(user, "servicenow.tabs.syncDashboard");

    const app = (await screen.findByText(/cmdb_ci_business_app/)).closest(".MuiCard-root") as HTMLElement;
    expect(mockApi.callsOf("get", "/servicenow/sync/runs?limit=50")).toHaveLength(1);
    expect(within(app).getByRole("button", { name: named(T("servicenow.sync.pull")) })).toBeInTheDocument();
    expect(within(app).queryByRole("button", { name: named(T("servicenow.sync.push")) })).not.toBeInTheDocument();
    const itc = card(/cmdb_ci_server/);
    expect(within(itc).getByRole("button", { name: named(T("servicenow.sync.pull")) })).toBeInTheDocument();
    expect(within(itc).getByRole("button", { name: named(T("servicenow.sync.push")) })).toBeInTheDocument();
    // The inactive mapping is not offered for syncing.
    expect(screen.queryByText(/x_ghost/)).not.toBeInTheDocument();

    const done = screen.getByText("completed").closest("tr")!;
    expect(
      await within(done).findByText(formatDateTimeWith("YYYY-MM-DD", "2026-09-30T10:00:00Z")),
    ).toBeInTheDocument();
    expect(within(done).getByText("pull")).toBeInTheDocument();
    expect(within(done).getByText("40")).toBeInTheDocument();
    expect(within(done).getByText("3")).toBeInTheDocument();
    expect(within(done).getByText("12s")).toBeInTheDocument();
    const failed = screen.getByText("failed").closest("tr")!;
    // `processed` stands in for `fetched`; an unfinished run has no duration.
    expect(within(failed).getByText("7")).toBeInTheDocument();
    expect(within(failed).getByText("2")).toBeInTheDocument();
    expect(within(failed).getByText("-")).toBeInTheDocument();
  });

  it("shows the empty states", async () => {
    mappings = [MAP_OFF];
    mockApi.on("get", "/servicenow/sync/runs?limit=50", []);
    const { user } = renderWithProviders(<ServiceNowAdmin />);
    await openTab(user, "servicenow.tabs.syncDashboard");
    expect(await screen.findByText(T("servicenow.sync.noActiveMappings"))).toBeInTheDocument();
    expect(screen.getByText(T("servicenow.sync.noRuns"))).toBeInTheDocument();
  });

  it("runs a pull and a push against the mapping's endpoint and reloads", async () => {
    const { user } = renderWithProviders(<ServiceNowAdmin />);
    await openTab(user, "servicenow.tabs.syncDashboard");
    const app = (await screen.findByText(/cmdb_ci_business_app/)).closest(".MuiCard-root") as HTMLElement;

    await user.click(within(app).getByRole("button", { name: named(T("servicenow.sync.pull")) }));
    await waitFor(() => expect(mockApi.callsOf("post", "/servicenow/sync/pull/m1")).toHaveLength(1));
    await waitFor(() => expect(mockApi.callsOf("get", "/servicenow/sync/runs?limit=50")).toHaveLength(2));

    await user.click(within(card(/cmdb_ci_server/)).getByRole("button", { name: named(T("servicenow.sync.push")) }));
    await waitFor(() => expect(mockApi.callsOf("post", "/servicenow/sync/push/m2")).toHaveLength(1));
    await waitFor(() => expect(mockApi.callsOf("get", "/servicenow/sync/runs?limit=50")).toHaveLength(3));
  });

  it("surfaces a failed sync in a dismissible alert", async () => {
    mockApi.fail("post", "/servicenow/sync/pull/m1", 500);
    const { user } = renderWithProviders(<ServiceNowAdmin />);
    await openTab(user, "servicenow.tabs.syncDashboard");
    const app = (await screen.findByText(/cmdb_ci_business_app/)).closest(".MuiCard-root") as HTMLElement;

    await user.click(within(app).getByRole("button", { name: named(T("servicenow.sync.pull")) }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("POST /servicenow/sync/pull/m1 failed");
    await user.click(within(alert).getByRole("button"));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("opens a run's staged records and renders each row", async () => {
    const { user } = renderWithProviders(<ServiceNowAdmin />);
    await openTab(user, "servicenow.tabs.syncDashboard");
    await screen.findByText(/cmdb_ci_business_app/);

    const done = screen.getByText("completed").closest("tr")!;
    await user.click(within(done).getByRole("button", { name: T("servicenow.sync.viewStaged") }));
    const dialog = await screen.findByRole("dialog");
    expect(mockApi.callsOf("get", "/servicenow/sync/runs/r1/staged")).toHaveLength(1);
    expect(within(dialog).getByText(/Staged Records — pull sync/)).toBeInTheDocument();

    const created = (await within(dialog).findByText("abc123")).closest("tr")!;
    expect(within(created).getByText("create")).toBeInTheDocument();
    expect(within(created).getByText("pending")).toBeInTheDocument();
    expect(within(created).getByText("abcdef12...")).toBeInTheDocument();
    expect(within(created).getByText("name, description")).toBeInTheDocument();
    const deleted = within(dialog).getByText("def456").closest("tr")!;
    expect(within(deleted).getByText("delete")).toBeInTheDocument();
    expect(within(deleted).getByText("Guard tripped")).toBeInTheDocument();
    expect(within(deleted).getAllByText("-")).toHaveLength(2);

    await user.click(within(dialog).getByRole("button", { name: T("common:actions.close") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows the empty staged state and a failed staged load", async () => {
    mockApi.on("get", "/servicenow/sync/runs/r1/staged", []);
    mockApi.fail("get", "/servicenow/sync/runs/r2/staged", 500);
    const { user } = renderWithProviders(<ServiceNowAdmin />);
    await openTab(user, "servicenow.tabs.syncDashboard");
    await screen.findByText(/cmdb_ci_business_app/);

    await user.click(within(screen.getByText("completed").closest("tr")!).getByRole("button", { name: T("servicenow.sync.viewStaged") }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(T("servicenow.sync.noStagedRecords"))).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: T("common:actions.close") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(within(screen.getByText("failed").closest("tr")!).getByRole("button", { name: T("servicenow.sync.viewStaged") }));
    // The staged dialog stays open over the error, so the page's alert is aria-hidden.
    expect(await screen.findByText("GET /servicenow/sync/runs/r2/staged failed")).toBeInTheDocument();
  });
});
