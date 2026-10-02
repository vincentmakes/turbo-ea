import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
// The export dialog has its own test (MigrationExportDialog.test.tsx); here it
// only needs to prove the page mounts it with the exportable sources.
vi.mock("./MigrationExportDialog", () => ({
  default: (props: { open: boolean; sources: { key: string; label: string }[] }) =>
    props.open ? (
      <div data-testid="migration-export-dialog">{props.sources.map((s) => s.key).join(",")}</div>
    ) : null,
}));

import i18n from "@/i18n";
import { invalidateCache } from "@/hooks/useMetamodel";
import { mockApi } from "@/test/apiMock";
import { hookState } from "@/test/hooks";
import { renderWithProviders, userWith } from "@/test/render";
import MigrationAdmin from "./MigrationAdmin";

// The page calls `t(key, defaultValue, opts)` under `["admin", "common"]`; a
// handful of its keys (`migration.conflicts.*`, `migration.mapping.*`,
// `migration.filter.all`, `common.close`) are not in the locale files and
// render their inline default, so the expected strings are computed the same
// way rather than assumed.
function T(key: string, defaultValue?: string, opts: Record<string, unknown> = {}): string {
  return i18n.t(key, { ns: ["admin", "common"], defaultValue, ...opts }) as string;
}

// MUI renders `startIcon` as the Material Symbol's name in text, so a button's
// accessible name is "<icon><label>"; match on the label alone.
const named = (label: string) => (name: string) => name === label || name.endsWith(label);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SOURCES = [
  { key: "leanix", label: "SAP LeanIX", accepted_extensions: [".xlsx"], supports_export: true },
  { key: "ardoq", label: "Ardoq", accepted_extensions: [".json", ".zip"], supports_export: false },
];

interface Migration {
  id: string;
  name: string;
  source_type: string;
  status: string;
  file_hash: string;
  file_size: number | null;
  snapshot_version: string | null;
  stats: Record<string, unknown> | null;
  metamodel_diff: Record<string, unknown> | null;
  field_mappings: Record<string, Record<string, string>> | null;
  error_message: string | null;
  parsed_at: string | null;
  applied_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

function makeMigration(overrides: Partial<Migration> & { id: string; name: string }): Migration {
  return {
    source_type: "leanix",
    status: "parsed",
    file_hash: "h",
    file_size: 2048,
    snapshot_version: "2026.05",
    stats: null,
    metamodel_diff: null,
    field_mappings: null,
    error_message: null,
    parsed_at: "2026-09-30T10:01:00Z",
    applied_at: null,
    created_at: "2026-09-30T10:00:00Z",
    updated_at: null,
    ...overrides,
  };
}

const PARSED = makeMigration({
  id: "m1",
  name: "LeanIX prod",
  stats: {
    entities: 12,
    relation_count: 3,
    tag_count: 2,
    cards: { create: 5, update: 1, skip: 0, conflict: 1, unknown_type: 2 },
    relations: { create: 3 },
    tags: { groups_create: 1, tags_create: 2, links: 4 },
  },
});

const APPLIED = makeMigration({
  id: "m2",
  name: "Older import",
  status: "applied",
  file_size: 5 * 1024 * 1024,
  snapshot_version: null,
  error_message: "Something broke on apply",
  applied_at: "2026-09-01T12:00:00Z",
  stats: {
    fact_sheets: 7,
    apply: { created: 6, updated: 0, skipped: 1, conflicts: 0, errors: 2 },
  },
});

const UPLOADED = makeMigration({
  id: "m3",
  name: "Still parsing",
  status: "uploaded",
  file_size: null,
  stats: null,
});

interface StagedRecord {
  id: string;
  entity_kind: string;
  source_id: string;
  source_type: string;
  card_type_key: string | null;
  action: string;
  status: string;
  diff: Record<string, unknown> | null;
  error_message: string | null;
  target_id: string | null;
  display_name: string | null;
  source_data?: Record<string, unknown>;
}

function row(overrides: Partial<StagedRecord> & { id: string; entity_kind: string }): StagedRecord {
  return {
    source_id: overrides.id,
    source_type: "leanix",
    card_type_key: null,
    action: "create",
    status: "pending",
    diff: null,
    error_message: null,
    target_id: null,
    display_name: null,
    ...overrides,
  };
}

const PREVIEW_ROWS: Record<string, StagedRecord[]> = {
  card: [
    row({ id: "c-1", entity_kind: "card", source_id: "fs-1", card_type_key: "Application", display_name: "Alpha App" }),
    row({
      id: "c-2",
      entity_kind: "card",
      source_id: "fs-2",
      card_type_key: "Application",
      display_name: "Beta App",
      action: "update",
      diff: { name: { old: "Beta", new: "Beta App" }, attributes: { alias: "b" } },
    }),
    row({
      id: "c-3",
      entity_kind: "card",
      source_id: "fs-3",
      card_type_key: "ITComponent",
      display_name: "Gamma Server",
      action: "conflict",
      diff: { reason: "Unknown parent" },
    }),
  ],
  user: [row({ id: "u-1", entity_kind: "user", source_id: "user-1", display_name: "Dana Lee" })],
  card_tag: [
    row({ id: "ct-1", entity_kind: "card_tag", source_id: "fs-1:tag-1", status: "error", error_message: "Tag missing" }),
  ],
  metamodel_field: [
    row({
      id: "mf-1",
      entity_kind: "metamodel_field",
      source_id: "Application:customField",
      card_type_key: "Application",
      source_data: {
        field_key: "customField",
        label: "Custom Field",
        native_data_type: "STRING",
        target_type: "Application",
      },
    }),
    row({
      id: "mf-2",
      entity_kind: "metamodel_field",
      source_id: "ITComponent:extra",
      card_type_key: "ITComponent",
      source_data: { field_key: "extra", target_type: "ITComponent" },
    }),
    row({
      id: "mf-3",
      entity_kind: "metamodel_field",
      source_id: "Provider:weird",
      action: "conflict",
      diff: { reason: "Type not mapped" },
      source_data: { field_key: "weird", target_type: "Provider" },
    }),
  ],
};

const MAPPING_OPTIONS = {
  blocks: [
    {
      native_type: "Application",
      target_tea_type: "Application",
      target_type_label: "Application",
      source_fields: [
        {
          source_field_key: "customField",
          label: "Custom Field",
          native_data_type: "STRING",
          tea_type: "text",
          target_tea_type: "Application",
          mapped_to: null as string | null,
        },
      ],
      available_targets: [
        { key: "businessCriticality", label: "Business Criticality", type: "single_select", section: "Business Information" },
        { key: "alias", label: "Alias", type: "text", section: null },
      ],
    },
  ],
  auto_mapped_columns: [
    { source_column: "name", tea_target: "name" },
    { source_column: "displayName", tea_target: "name" },
  ],
};

const PREVIEW_RE = /^\/migration\/([^/]+)\/preview\?entity_kind=([a-z_]+)&limit=10000$/;

function scriptDefaults(migrations: Migration[] = [PARSED, APPLIED]) {
  mockApi.on("get", "/migration", () => migrations);
  mockApi.on("get", "/migration/sources", SOURCES);
  mockApi.on("get", PREVIEW_RE, (path) => {
    const [, , kind] = PREVIEW_RE.exec(path)!;
    const items = PREVIEW_ROWS[kind] ?? [];
    return { items, total: items.length, offset: 0, limit: 10000 };
  });
  mockApi.on("get", /^\/migration\/[^/]+\/field-mappings$/, MAPPING_OPTIONS);
  mockApi.on("post", /^\/migration\/[^/]+\/apply$/, (path) => {
    const id = path.split("/")[2];
    return { ...(migrations.find((m) => m.id === id) ?? PARSED), status: "applied" };
  });
  mockApi.on("delete", /^\/migration\/[^/]+$/, {});
  mockApi.on("upload", "/migration/upload", {});
}

async function openDetail(user: ReturnType<typeof renderWithProviders>["user"], name: string) {
  await user.click(screen.getByText(name));
  const dialog = await screen.findByRole("dialog");
  // The staged tables render once every preview kind has landed.
  await within(dialog).findByRole("tab", { name: `${T("migration.kind.card")} (3)` });
  return dialog;
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  vi.mocked(invalidateCache).mockClear();
  scriptDefaults();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

describe("MigrationAdmin list", () => {
  it("loads the sources and the migrations into the table", async () => {
    renderWithProviders(<MigrationAdmin />);

    expect(await screen.findByText("LeanIX prod")).toBeInTheDocument();
    expect(screen.getByText("Older import")).toBeInTheDocument();
    expect(mockApi.callsOf("get", "/migration")).toHaveLength(1);
    expect(mockApi.callsOf("get", "/migration/sources")).toHaveLength(1);

    const parsedRow = screen.getByText("LeanIX prod").closest("tr")!;
    // Source key resolved to the adapter's label; status, size and entity count.
    expect(within(parsedRow).getByText("SAP LeanIX")).toBeInTheDocument();
    expect(within(parsedRow).getByText("parsed")).toBeInTheDocument();
    expect(within(parsedRow).getByText("2.0 KB")).toBeInTheDocument();
    expect(within(parsedRow).getByText("12")).toBeInTheDocument();
    expect(within(parsedRow).getByText("2026.05")).toBeInTheDocument();
    // Only a parsed/previewed row offers the apply action.
    expect(
      within(parsedRow).getByRole("button", { name: T("migration.applyTooltip") }),
    ).toBeInTheDocument();

    const appliedRow = screen.getByText("Older import").closest("tr")!;
    expect(within(appliedRow).getByText("5.0 MB")).toBeInTheDocument();
    // `fact_sheets` is the legacy name of the entity count.
    expect(within(appliedRow).getByText("7")).toBeInTheDocument();
    expect(
      within(appliedRow).queryByRole("button", { name: T("migration.applyTooltip") }),
    ).not.toBeInTheDocument();

    expect(screen.getByRole("button", { name: named(T("migration.newButton")) })).toBeEnabled();
  });

  it("shows the empty state when there are no migrations", async () => {
    mockApi.on("get", "/migration", []);
    renderWithProviders(<MigrationAdmin />);
    expect(await screen.findByText(T("migration.empty"))).toBeInTheDocument();
  });

  it("surfaces a list failure and disables New migration when no source is registered", async () => {
    mockApi.fail("get", "/migration", 500);
    mockApi.on("get", "/migration/sources", []);
    renderWithProviders(<MigrationAdmin />);

    expect(await screen.findByRole("alert")).toHaveTextContent("GET /migration failed");
    expect(screen.getByRole("button", { name: named(T("migration.newButton")) })).toBeDisabled();
  });

  it("renders a progress bar on a migration still being parsed and polls the list", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let listing: Migration[] = [UPLOADED];
    mockApi.on("get", "/migration", () => listing);
    renderWithProviders(<MigrationAdmin />);

    const uploadedRow = (await screen.findByText("Still parsing")).closest("tr")!;
    expect(within(uploadedRow).getByRole("progressbar")).toBeInTheDocument();
    // Size and entity count are unknown until the parse lands.
    expect(within(uploadedRow).getAllByText("—")).toHaveLength(2);

    // 3 s later the list is refreshed; once nothing is active the poll stops.
    listing = [{ ...UPLOADED, status: "parsed" }];
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    await waitFor(() => expect(mockApi.callsOf("get", "/migration")).toHaveLength(2));
    await waitFor(() => expect(within(uploadedRow).queryByRole("progressbar")).not.toBeInTheDocument());

    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(mockApi.callsOf("get", "/migration")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Export gating
// ---------------------------------------------------------------------------

describe("MigrationAdmin export", () => {
  it("offers the export to a holder of admin.export_workspace and mounts the dialog with the exportable sources", async () => {
    const { user } = renderWithProviders(<MigrationAdmin />);
    await screen.findByText("LeanIX prod");

    await user.click(screen.getByRole("button", { name: named(T("migration.export.button")) }));
    // Only LeanIX advertises `supports_export`.
    expect(screen.getByTestId("migration-export-dialog")).toHaveTextContent("leanix");
  });

  it("hides the export from a user without admin.export_workspace", async () => {
    renderWithProviders(<MigrationAdmin />, { user: userWith("admin.migrate") });
    await screen.findByText("LeanIX prod");
    expect(screen.queryByRole("button", { name: named(T("migration.export.button")) })).not.toBeInTheDocument();
  });

  it("hides the export when no registered adapter can write its format", async () => {
    mockApi.on("get", "/migration/sources", SOURCES.map((s) => ({ ...s, supports_export: false })));
    renderWithProviders(<MigrationAdmin />);
    await screen.findByText("LeanIX prod");
    expect(screen.queryByRole("button", { name: named(T("migration.export.button")) })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

describe("MigrationAdmin upload", () => {
  function fileInput(): HTMLInputElement {
    return document.querySelector('input[type="file"]') as HTMLInputElement;
  }

  it("defaults to the first source, takes its accept list from accepted_extensions and uploads the snapshot", async () => {
    const { user } = renderWithProviders(<MigrationAdmin />);
    await screen.findByText("LeanIX prod");

    await user.click(screen.getByRole("button", { name: named(T("migration.newButton")) }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(T("migration.upload.title"))).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox")).toHaveTextContent("SAP LeanIX");
    expect(fileInput()).toHaveAttribute("accept", ".xlsx");
    const submit = within(dialog).getByRole("button", { name: T("migration.upload.submit") });
    expect(submit).toBeDisabled();

    // Switching the source platform re-derives the accept list.
    await user.click(within(dialog).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Ardoq" }));
    expect(fileInput()).toHaveAttribute("accept", ".json,.zip");

    await user.type(within(dialog).getByLabelText(T("migration.upload.name")), "Ardoq export");
    const file = new File(["{}"], "ardoq.json", { type: "application/json" });
    fireEvent.change(fileInput(), { target: { files: [file] } });
    expect(within(dialog).getByText("ardoq.json")).toBeInTheDocument();
    expect(within(dialog).getByText("2 B")).toBeInTheDocument();
    expect(submit).toBeEnabled();

    await user.click(submit);
    await waitFor(() =>
      expect(mockApi.api.upload).toHaveBeenCalledWith("/migration/upload", file, "file", {
        name: "Ardoq export",
        source_key: "ardoq",
        include_archived: "false",
      }),
    );
    // The dialog closes and the list reloads.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("get", "/migration")).toHaveLength(2);
  });

  it("sends include_archived=true when the checkbox is ticked", async () => {
    const { user } = renderWithProviders(<MigrationAdmin />);
    await screen.findByText("LeanIX prod");
    await user.click(screen.getByRole("button", { name: named(T("migration.newButton")) }));
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText(T("migration.upload.name")), "With archived");
    fireEvent.change(fileInput(), { target: { files: [new File(["x"], "snap.xlsx")] } });
    await user.click(within(dialog).getByRole("checkbox"));
    await user.click(within(dialog).getByRole("button", { name: T("migration.upload.submit") }));

    await waitFor(() =>
      expect(mockApi.api.upload).toHaveBeenCalledWith(
        "/migration/upload",
        expect.any(File),
        "file",
        expect.objectContaining({ source_key: "leanix", include_archived: "true" }),
      ),
    );
  });

  it("keeps the dialog open and shows the error when the upload fails", async () => {
    mockApi.fail("upload", "/migration/upload", 400, "bad file");
    const { user } = renderWithProviders(<MigrationAdmin />);
    await screen.findByText("LeanIX prod");
    await user.click(screen.getByRole("button", { name: named(T("migration.newButton")) }));
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText(T("migration.upload.name")), "Broken");
    fireEvent.change(fileInput(), { target: { files: [new File(["x"], "snap.xlsx")] } });
    await user.click(within(dialog).getByRole("button", { name: T("migration.upload.submit") }));

    expect(await screen.findByText("UPLOAD /migration/upload failed")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mockApi.callsOf("get", "/migration")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Detail dialog
// ---------------------------------------------------------------------------

describe("MigrationAdmin detail", () => {
  it("opens a migration, fetches every preview kind plus the field mappings, and renders stats and staged rows", async () => {
    const { user } = renderWithProviders(<MigrationAdmin />);
    await screen.findByText("LeanIX prod");
    const dialog = await openDetail(user, "LeanIX prod");

    // One preview request per entity kind, all against the selected id.
    const previewPaths = mockApi.callsOf("get", PREVIEW_RE).map((c) => c.path);
    expect(previewPaths).toHaveLength(12);
    expect(previewPaths).toContain("/migration/m1/preview?entity_kind=card&limit=10000");
    expect(previewPaths).toContain("/migration/m1/preview?entity_kind=comment&limit=10000");
    expect(mockApi.callsOf("get", "/migration/m1/field-mappings")).toHaveLength(1);

    // Header chips and the stats block.
    expect(within(dialog).getByText("SAP LeanIX")).toBeInTheDocument();
    expect(within(dialog).getByText("12 entities")).toBeInTheDocument();
    expect(within(dialog).getByText("3 relations")).toBeInTheDocument();
    expect(within(dialog).getByText("2 tags")).toBeInTheDocument();
    expect(within(dialog).getByText("5 create")).toBeInTheDocument();
    expect(within(dialog).getByText("2 unmapped type")).toBeInTheDocument();
    expect(within(dialog).getByText("1 new groups")).toBeInTheDocument();
    expect(within(dialog).getByText("4 card↔tag links")).toBeInTheDocument();
    expect(within(dialog).queryByText(T("migration.detail.applyResult"))).not.toBeInTheDocument();

    // Tab labels carry the staged totals.
    expect(within(dialog).getByRole("tab", { name: `${T("migration.kind.user")} (1)` })).toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: `${T("migration.kind.metamodel_field")} (3)` })).toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: `${T("migration.kind.comment")} (0)` })).toBeInTheDocument();

    // The Cards tab: names, source ids, type, action chips and the note cell.
    expect(within(dialog).getByText("Alpha App")).toBeInTheDocument();
    expect(within(dialog).getByText("fs-2")).toBeInTheDocument();
    const betaRow = within(dialog).getByText("Beta App").closest("tr")!;
    expect(within(betaRow).getByText("update")).toBeInTheDocument();
    // An update lists the changed field names; the old → new values sit in the tooltip.
    expect(within(betaRow).getByText("name, attributes")).toBeInTheDocument();
    const gammaRow = within(dialog).getByText("Gamma Server").closest("tr")!;
    expect(within(gammaRow).getByText("conflict")).toBeInTheDocument();
    expect(within(gammaRow).getByText("Unknown parent")).toBeInTheDocument();
    expect(within(within(dialog).getByText("Alpha App").closest("tr")!).getByText("—")).toBeInTheDocument();
  });

  it("switches tabs and renders error rows without a name column", async () => {
    const { user } = renderWithProviders(<MigrationAdmin />);
    await screen.findByText("LeanIX prod");
    const dialog = await openDetail(user, "LeanIX prod");

    await user.click(within(dialog).getByRole("tab", { name: `${T("migration.kind.card_tag")} (1)` }));
    expect(within(dialog).getByText("fs-1:tag-1")).toBeInTheDocument();
    expect(within(dialog).getByText("Tag missing")).toBeInTheDocument();
    expect(within(dialog).getByText("error")).toBeInTheDocument();
    // No row carries a display_name, so the Name column is dropped.
    expect(within(dialog).queryByRole("columnheader", { name: T("migration.col.name") })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("tab", { name: `${T("migration.kind.comment")} (0)` }));
    expect(within(dialog).getByText(T("migration.detail.noStaged"))).toBeInTheDocument();
  });

  it("narrows the staged rows with the filter pills and restores them with All", async () => {
    const { user } = renderWithProviders(<MigrationAdmin />);
    await screen.findByText("LeanIX prod");
    const dialog = await openDetail(user, "LeanIX prod");

    expect(within(dialog).getByText(`${T("migration.filter.all", "All")} (3)`)).toBeInTheDocument();
    await user.click(within(dialog).getByText("ITComponent (1)"));
    expect(within(dialog).queryByText("Alpha App")).not.toBeInTheDocument();
    expect(within(dialog).getByText("Gamma Server")).toBeInTheDocument();

    // Clicking the active pill again clears the filter.
    await user.click(within(dialog).getByText("ITComponent (1)"));
    expect(within(dialog).getByText("Alpha App")).toBeInTheDocument();

    await user.click(within(dialog).getByText("Application (2)"));
    expect(within(dialog).queryByText("Gamma Server")).not.toBeInTheDocument();
    await user.click(within(dialog).getByText(`${T("migration.filter.all", "All")} (3)`));
    expect(within(dialog).getByText("Gamma Server")).toBeInTheDocument();
  });

  it("warns about conflicts, jumps to the tab from a chip, and applies only after confirmation", async () => {
    const { user } = renderWithProviders(<MigrationAdmin />);
    await screen.findByText("LeanIX prod");
    const dialog = await openDetail(user, "LeanIX prod");

    // One card conflict plus one custom-field conflict.
    expect(
      within(dialog).getByText(
        T("migration.conflicts.warning", "{{count}} row(s) couldn't be resolved and will be skipped on apply.", { count: 2 }),
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByText(`${T("migration.kind.metamodel_field")}: 1`));
    expect(within(dialog).getByRole("tab", { name: `${T("migration.kind.metamodel_field")} (3)` })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.click(within(dialog).getByRole("button", { name: named(T("migration.detail.apply")) }));
    const confirm = await screen.findByText(T("migration.conflicts.confirmTitle", "Apply with unresolved conflicts?"));
    expect(mockApi.callsOf("post")).toHaveLength(0);

    // Cancel first: nothing is sent.
    const confirmDialog = confirm.closest('[role="dialog"]')!;
    await user.click(within(confirmDialog).getByRole("button", { name: T("common.cancel", "Cancel") }));
    await waitFor(() => expect(screen.queryByText(T("migration.conflicts.confirmTitle", "Apply with unresolved conflicts?"))).not.toBeInTheDocument());
    expect(mockApi.callsOf("post")).toHaveLength(0);

    await user.click(within(dialog).getByRole("button", { name: named(T("migration.detail.apply")) }));
    const again = (await screen.findByText(T("migration.conflicts.confirmTitle", "Apply with unresolved conflicts?"))).closest('[role="dialog"]')!;
    await user.click(within(again).getByRole("button", { name: T("migration.conflicts.confirmApply", "Apply and skip conflicts") }));

    await waitFor(() => expect(mockApi.callsOf("post", "/migration/m1/apply")).toHaveLength(1));
    // New types landed in the metamodel: the cached snapshot is dropped, then the list reloads.
    await waitFor(() => expect(invalidateCache).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockApi.callsOf("get", "/migration")).toHaveLength(2));
  });

  it("edits a field mapping, saves it with PUT and re-reads the options", async () => {
    mockApi.on("put", "/migration/m1/field-mappings", (_path, body) => ({
      ...PARSED,
      field_mappings: (body as { field_mappings: Record<string, Record<string, string>> }).field_mappings,
    }));
    const { user } = renderWithProviders(<MigrationAdmin />);
    await screen.findByText("LeanIX prod");
    const dialog = await openDetail(user, "LeanIX prod");

    await user.click(within(dialog).getByRole("tab", { name: `${T("migration.kind.metamodel_field")} (3)` }));
    // Auto-mapped core columns are listed, with the rename spelled out.
    expect(within(dialog).getByText("displayName").closest(".MuiAlert-root")).toHaveTextContent(
      "name · displayName → name",
    );
    // One section per target type: the mappable row, the one without a block, the conflict.
    expect(within(dialog).getByText("Custom Field")).toBeInTheDocument();
    expect(within(dialog).getByText("STRING")).toBeInTheDocument();
    expect(
      within(dialog).getByText(T("migration.mapping.noTargets", "No target type yet — will land as a new custom field.")),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Type not mapped")).toBeInTheDocument();

    const save = within(dialog).getByRole("button", { name: named(T("migration.mapping.save", "Save mappings")) });
    expect(save).toBeDisabled();

    const select = within(dialog).getByRole("combobox");
    expect(select).toHaveTextContent(T("migration.mapping.option.newCustom", "(Import as new custom field — default)"));
    await user.click(select);
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByText(T("migration.mapping.option.skip", "(Do not import this field)"))).toBeInTheDocument();
    expect(within(listbox).getByText("Business Information · single_select")).toBeInTheDocument();
    await user.click(within(listbox).getByText("Business Criticality"));
    expect(select).toHaveTextContent("Business Criticality");
    expect(save).toBeEnabled();

    await user.click(save);
    await waitFor(() =>
      expect(mockApi.callsOf("put", "/migration/m1/field-mappings")[0]?.body).toEqual({
        field_mappings: { Application: { customField: "businessCriticality" } },
      }),
    );
    // The options are re-read so the draft's "dirty" baseline follows the server.
    await waitFor(() => expect(mockApi.callsOf("get", "/migration/m1/field-mappings")).toHaveLength(2));
  });

  it("reports a failed mapping save inside the tab", async () => {
    mockApi.fail("put", "/migration/m1/field-mappings", 422, "nope");
    const { user } = renderWithProviders(<MigrationAdmin />);
    await screen.findByText("LeanIX prod");
    const dialog = await openDetail(user, "LeanIX prod");
    await user.click(within(dialog).getByRole("tab", { name: `${T("migration.kind.metamodel_field")} (3)` }));

    await user.click(within(dialog).getByRole("combobox"));
    await user.click(within(await screen.findByRole("listbox")).getByText(T("migration.mapping.option.skip", "(Do not import this field)")));
    await user.click(within(dialog).getByRole("button", { name: named(T("migration.mapping.save", "Save mappings")) }));

    expect(await within(dialog).findByText("PUT /migration/m1/field-mappings failed")).toBeInTheDocument();
    expect(mockApi.callsOf("put")[0].body).toEqual({ field_mappings: { Application: { customField: "__skip__" } } });
  });

  it("shows the apply result, the error report link and a read-only mapping tab on an applied migration", async () => {
    const { user } = renderWithProviders(<MigrationAdmin />);
    await screen.findByText("Older import");
    await user.click(screen.getByText("Older import"));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("tab", { name: `${T("migration.kind.card")} (3)` });

    expect(within(dialog).getByText("Something broke on apply")).toBeInTheDocument();
    expect(within(dialog).getByText("7 entities")).toBeInTheDocument();
    expect(within(dialog).getByText(T("migration.detail.applyResult"))).toBeInTheDocument();
    expect(within(dialog).getByText("6 created")).toBeInTheDocument();
    expect(within(dialog).getByText("2 errors")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: named(T("migration.detail.downloadErrors")) })).toHaveAttribute(
      "href",
      "/api/v1/migration/m2/errors.csv",
    );
    expect(within(dialog).queryByRole("button", { name: named(T("migration.detail.apply")) })).not.toBeInTheDocument();
    // Applied: no conflict banner even though conflict rows are staged.
    expect(within(dialog).queryByText(T("migration.conflicts.confirmTitle", "Apply with unresolved conflicts?"))).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("tab", { name: `${T("migration.kind.metamodel_field")} (3)` }));
    expect(within(dialog).queryByRole("button", { name: named(T("migration.mapping.save", "Save mappings")) })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("combobox")).toHaveAttribute("aria-disabled", "true");

    await user.click(within(dialog).getByRole("button", { name: T("common.close", "Close") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("does not load field mappings for a migration that has not been parsed yet, and follows the poll into parsed", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let listing: Migration[] = [UPLOADED];
    mockApi.on("get", "/migration", () => listing);
    mockApi.on("get", "/migration/m3", () => listing[0]);
    const { user } = renderWithProviders(<MigrationAdmin />);
    await screen.findByText("Still parsing");

    await user.click(screen.getByText("Still parsing"));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("tab", { name: `${T("migration.kind.card")} (3)` });
    expect(mockApi.callsOf("get", /field-mappings$/)).toHaveLength(0);
    expect(within(dialog).getByText("uploaded")).toBeInTheDocument();

    // The next poll says "parsed": the open detail re-reads itself and its previews.
    listing = [{ ...UPLOADED, status: "parsed" }];
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    await waitFor(() => expect(mockApi.callsOf("get", "/migration/m3")).toHaveLength(1));
    await waitFor(() => expect(within(dialog).getByText("parsed")).toBeInTheDocument());
    await waitFor(() => expect(mockApi.callsOf("get", PREVIEW_RE)).toHaveLength(24));
  });
});

// ---------------------------------------------------------------------------
// Row actions
// ---------------------------------------------------------------------------

describe("MigrationAdmin row actions", () => {
  it("applies straight from the row and refreshes the metamodel cache", async () => {
    const { user } = renderWithProviders(<MigrationAdmin />);
    await screen.findByText("LeanIX prod");
    const parsedRow = screen.getByText("LeanIX prod").closest("tr")!;

    await user.click(within(parsedRow).getByRole("button", { name: T("migration.applyTooltip") }));
    await waitFor(() => expect(mockApi.callsOf("post", "/migration/m1/apply")).toHaveLength(1));
    await waitFor(() => expect(invalidateCache).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockApi.callsOf("get", "/migration")).toHaveLength(2));
    // The row click handler is stopped at the actions cell: no detail opened.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the apply error and leaves the metamodel cache alone when the apply fails", async () => {
    mockApi.fail("post", "/migration/m1/apply", 409, "busy");
    const { user } = renderWithProviders(<MigrationAdmin />);
    await screen.findByText("LeanIX prod");
    const parsedRow = screen.getByText("LeanIX prod").closest("tr")!;

    await user.click(within(parsedRow).getByRole("button", { name: T("migration.applyTooltip") }));
    expect(await screen.findByRole("alert")).toHaveTextContent("POST /migration/m1/apply failed");
    expect(invalidateCache).not.toHaveBeenCalled();
    expect(mockApi.callsOf("get", "/migration")).toHaveLength(1);

    // The alert is dismissible.
    await user.click(within(screen.getByRole("alert")).getByRole("button"));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("deletes only after the confirmation, with the migration named in the prompt", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { user } = renderWithProviders(<MigrationAdmin />);
    await screen.findByText("LeanIX prod");
    const parsedRow = screen.getByText("LeanIX prod").closest("tr")!;
    const deleteButton = within(within(parsedRow).getByLabelText(T("common.delete", "Delete"))).getByRole("button");

    await user.click(deleteButton);
    expect(confirmSpy).toHaveBeenCalledWith(T("migration.confirmDelete", undefined, { name: "LeanIX prod" }));
    expect(mockApi.callsOf("delete")).toHaveLength(0);

    confirmSpy.mockReturnValue(true);
    await user.click(deleteButton);
    await waitFor(() => expect(mockApi.callsOf("delete", "/migration/m1")).toHaveLength(1));
    await waitFor(() => expect(mockApi.callsOf("get", "/migration")).toHaveLength(2));
  });

  it("closes the detail dialog when the open migration is deleted", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user } = renderWithProviders(<MigrationAdmin />);
    await screen.findByText("LeanIX prod");
    await openDetail(user, "LeanIX prod");

    const parsedRow = screen.getByText("LeanIX prod", { selector: "td" }).closest("tr")!;
    // The table sits behind the open dialog, i.e. aria-hidden.
    await user.click(
      within(within(parsedRow).getByLabelText(T("common.delete", "Delete"))).getByRole("button", { hidden: true }),
    );
    await waitFor(() => expect(mockApi.callsOf("delete", "/migration/m1")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("surfaces a failed delete", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockApi.fail("delete", "/migration/m1", 500);
    const { user } = renderWithProviders(<MigrationAdmin />);
    await screen.findByText("LeanIX prod");
    const parsedRow = screen.getByText("LeanIX prod").closest("tr")!;

    await user.click(within(within(parsedRow).getByLabelText(T("common.delete", "Delete"))).getByRole("button"));
    expect(await screen.findByRole("alert")).toHaveTextContent("DELETE /migration/m1 failed");
  });
});
