/**
 * Tests for the shared reference-catalogue page shell.
 *
 * The page loads one catalogue payload, gates the import on the per-type
 * create permission, batches the import POSTs, surfaces the result, and
 * manages the catalogue-update check. The tree browser has its own suite, so
 * it is stubbed to the two callbacks the page gives it — a selection and a
 * detail request — which keeps every test here about the shell.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, within, act } from "@testing-library/react";
import { useLocation } from "react-router";

import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import { hookState } from "@/test/hooks";
import { makeUser, renderWithProviders } from "@/test/render";

import CataloguePage from "./CataloguePage";
import type { CatalogueKindConfig, CatalogueNode, CataloguePayload, ImportResult, UpdateStatus } from "./types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useAuth", () => import("@/test/hooks").then((m) => m.useAuthModule()));

/** The browser's own suite covers the tree; here it is its two callbacks. */
vi.mock("./CatalogueBrowser", () => ({
  default: ({
    data,
    selected,
    onSelectedChange,
    onOpenDetail,
  }: {
    data: CatalogueNode[];
    selected: Set<string>;
    onSelectedChange: (next: Set<string>) => void;
    onOpenDetail: (id: string) => void;
  }) => (
    <div data-testid="browser" data-count={data.length} data-selected={Array.from(selected).join(",")}>
      <button onClick={() => onSelectedChange(new Set(data.filter((n) => !n.existing_card_id).map((n) => n.id)))}>
        stub-select-all
      </button>
      <button onClick={() => onSelectedChange(new Set([data[0]?.id].filter(Boolean) as string[]))}>
        stub-select-first
      </button>
      {data.map((n) => (
        <button key={n.id} onClick={() => onOpenDetail(n.id)}>
          stub-open-{n.id}
        </button>
      ))}
    </div>
  ),
}));

/* ------------------------------------------------------------------------- */
/*  Fixtures                                                                  */
/* ------------------------------------------------------------------------- */

const CONFIG: CatalogueKindConfig = {
  kind: "capability",
  basePath: "/capability-catalogue",
  payloadKey: "capabilities",
  idPrefix: "BC-",
  i18nNamespace: "catalogue",
  inventoryCardType: "BusinessCapability",
  accentColor: "#003399",
  selectionColor: "#D63384",
  levelLabel: (level) => (level === 0 ? "Macro" : `L${level}`),
  heroIcon: "account_tree",
};

function node(overrides: Partial<CatalogueNode> & { id: string; name: string; level: number }): CatalogueNode {
  return { parent_id: null, description: null, existing_card_id: null, ...overrides };
}

const NODES: CatalogueNode[] = [
  node({ id: "BC-1", name: "Finance", level: 1, industry: "Cross-Industry", description: "Money, see https://example.test/finance" }),
  node({
    id: "BC-1.1",
    name: "Billing",
    level: 2,
    parent_id: "BC-1",
    industry: "Cross-Industry; Retail",
    aliases: ["Invoicing ops", "AR"],
    references: ["https://example.test/billing"],
    deprecated: true,
    deprecation_reason: "Folded into Invoicing.",
  }),
  node({ id: "BC-1.1.1", name: "Invoicing", level: 3, parent_id: "BC-1.1", existing_card_id: "ca4d0000-0000-4000-8000-000000000001", description: "Sends the bills." }),
  node({ id: "BC-2", name: "Sales", level: 1, industry: "Retail" }),
];

function payload(nodes: CatalogueNode[] = NODES, version: Partial<CataloguePayload["version"]> = {}): CataloguePayload {
  return {
    version: {
      catalogue_version: "2026.4",
      schema_version: "1",
      generated_at: null,
      node_count: nodes.length,
      source: "bundled",
      bundled_version: "2026.4",
      available_locales: ["en"],
      active_locale: "en",
      ...version,
    },
    capabilities: nodes,
  };
}

function status(overrides: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    active_version: "2026.4",
    active_source: "bundled",
    bundled_version: "2026.4",
    cached_remote_version: null,
    remote: null,
    update_available: false,
    error: null,
    ...overrides,
  };
}

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`cards:catalogue.${key}`, opts) as string;
const tc = (key: string) => i18n.t(`common:${key}`) as string;

const ADMIN = makeUser();
const MEMBER_CREATOR = makeUser({
  role: "member",
  permissions: { "inventory.view": true, "inventory.create": true },
});
const MEMBER_VIEWER = makeUser({ role: "member", permissions: { "inventory.view": true } });

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{`${loc.pathname}${loc.search}`}</div>;
}

function renderPage(user = ADMIN) {
  hookState.auth.user = user;
  return renderWithProviders(<CataloguePage config={CONFIG} />, {
    route: "/capability-catalogue",
    user,
    routes: [{ path: "/capability-catalogue" }, { path: "/inventory", element: <LocationProbe /> }],
  });
}

async function selectAndOpenImport(user: ReturnType<typeof renderPage>["user"]) {
  await user.click(await screen.findByRole("button", { name: "stub-select-all" }));
  await user.click(screen.getByRole("button", { name: new RegExp(`${t("createSelected", { count: 3 })}$`) }));
  return screen.findByRole("dialog", { name: t("importConfirmTitle") });
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  mockApi.on("get", "/capability-catalogue?locale=en", payload());
  mockApi.on("get", "/capability-catalogue/update-status", status());
  mockApi.on("post", "/capability-catalogue/update-fetch", { catalogue_version: "2026.5" });
  mockApi.on("post", "/capability-catalogue/import", (_path, body) => {
    const ids = (body as { catalogue_ids: string[] }).catalogue_ids;
    const result: ImportResult = {
      created: ids.slice(1).map((id) => ({ catalogue_id: id, card_id: `card-${id}` })),
      skipped: ids.slice(0, 1).map((id) => ({ catalogue_id: id, card_id: `card-${id}`, reason: "exists" })),
      relinked: [],
      catalogue_version: "2026.4",
      auto_relations_created: 2,
    };
    return result;
  });
});

afterEach(() => {
  hookState.reset();
});

/* ------------------------------------------------------------------------- */
/*  Loading and gating                                                        */
/* ------------------------------------------------------------------------- */

describe("CataloguePage — loading", () => {
  it("loads the catalogue for the active locale and renders the header", async () => {
    renderPage();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    expect(await screen.findByRole("heading", { name: t("pageTitle") })).toBeInTheDocument();
    expect(screen.getByText(t("subtitle"))).toBeInTheDocument();
    expect(screen.getByText(t("versionChip", { version: "2026.4", count: 4 }))).toBeInTheDocument();
    expect(screen.getByLabelText(t("sourceBundled"))).toBeInTheDocument();
    expect(screen.getByTestId("browser")).toHaveAttribute("data-count", "4");
    expect(mockApi.callsOf("get", "/capability-catalogue?locale=en")).toHaveLength(1);
    // Nothing selected: no import bar.
    expect(screen.queryByRole("button", { name: /stub-select-all/ })).toBeEnabled();
    expect(screen.queryByText(t("clearSelection"))).not.toBeInTheDocument();
  });

  it("names a remotely fetched catalogue and falls back on the count keys", async () => {
    mockApi.on(
      "get",
      "/capability-catalogue?locale=en",
      payload(NODES, { source: "remote", bundled_version: "2026.3", node_count: undefined, process_count: 9 }),
    );
    renderPage();
    expect(await screen.findByText(t("versionChip", { version: "2026.4", count: 9 }))).toBeInTheDocument();
    expect(screen.getByLabelText(t("sourceRemote", { version: "2026.3" }))).toBeInTheDocument();
  });

  it("renders an empty catalogue without an import bar", async () => {
    mockApi.on("get", "/capability-catalogue?locale=en", payload([]));
    renderPage();
    expect(await screen.findByText(t("versionChip", { version: "2026.4", count: 0 }))).toBeInTheDocument();
    expect(screen.getByTestId("browser")).toHaveAttribute("data-count", "0");
    expect(screen.queryByText(t("clearSelection"))).not.toBeInTheDocument();
  });

  it("shows the server's message when the load fails", async () => {
    mockApi.fail("get", "/capability-catalogue?locale=en", 503, "Catalogue unavailable");
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Catalogue unavailable");
    expect(screen.queryByRole("heading", { name: t("pageTitle") })).not.toBeInTheDocument();
  });

  it("refuses a role denied View on the target card type", async () => {
    const denied = makeUser({
      role: "member",
      permissions: { "inventory.view": true, "inventory.create": true },
      type_permissions: { BusinessCapability: { "inventory.view": false } },
    });
    renderPage(denied);
    expect(await screen.findByRole("alert")).toHaveTextContent(tc("accessDenied.body"));
    expect(screen.queryByRole("heading", { name: t("pageTitle") })).not.toBeInTheDocument();
  });

  it("hides the update controls from a non-admin", async () => {
    renderPage(MEMBER_CREATOR);
    await screen.findByRole("heading", { name: t("pageTitle") });
    expect(screen.queryByRole("button", { name: new RegExp(`${t("checkUpdate")}$`) })).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------- */
/*  Import                                                                    */
/* ------------------------------------------------------------------------- */

describe("CataloguePage — import", () => {
  it("disables the create button for a role without the create permission", async () => {
    const { user } = renderPage(MEMBER_VIEWER);
    await user.click(await screen.findByRole("button", { name: "stub-select-all" }));

    expect(screen.getByText(t("readyToImport", { count: 3 }))).toBeInTheDocument();
    const create = screen.getByRole("button", { name: new RegExp(`${t("createSelected", { count: 3 })}$`) });
    expect(create).toBeDisabled();
    // The reason sits on the tooltip wrapper.
    expect(screen.getByLabelText(t("noCreatePermission"))).toBeInTheDocument();

    // The bar's own Clear empties the selection.
    await user.click(screen.getByRole("button", { name: t("clearSelection") }));
    expect(screen.queryByText(t("readyToImport", { count: 3 }))).not.toBeInTheDocument();
  });

  it("imports the selection in one batch and summarises the result", async () => {
    const { user } = renderPage(MEMBER_CREATOR);
    const dialog = await selectAndOpenImport(user);
    expect(dialog).toHaveTextContent(t("importConfirmBody", { count: 3 }));
    expect(dialog).toHaveTextContent(t("importConfirmHint"));

    await user.click(within(dialog).getByRole("button", { name: t("confirmCreate") }));

    const done = await screen.findByRole("dialog", { name: t("importDoneTitle") });
    expect(done).toHaveTextContent(t("importDoneBody", { created: 2, skipped: 1, relinked: 0 }));
    expect(done).toHaveTextContent(t("autoRelationsCreated", { count: 2 }));

    const posts = mockApi.callsOf("post", "/capability-catalogue/import");
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual({ catalogue_ids: ["BC-1", "BC-1.1", "BC-2"], locale: "en" });
    // The catalogue is reloaded so the new cards show as existing, and the selection is cleared.
    await waitFor(() => expect(mockApi.callsOf("get", "/capability-catalogue?locale=en")).toHaveLength(2));
    expect(screen.getByTestId("browser")).toHaveAttribute("data-selected", "");

    // Open inventory deep-links to the type the cards landed as.
    await user.click(within(done).getByRole("button", { name: t("openInventory") }));
    expect(await screen.findByTestId("location")).toHaveTextContent("/inventory?type=BusinessCapability");
  });

  it("lists the entries the server refused, with their reasons", async () => {
    const reason = 'A card of type BusinessCapability named "Sales" already exists at this level (existing card: ca4d0000-0000-4000-8000-000000000009).';
    mockApi.on("post", "/capability-catalogue/import", (_path, body) => {
      const ids = (body as { catalogue_ids: string[] }).catalogue_ids;
      const result: ImportResult = {
        created: ids.filter((id) => id !== "BC-2").map((id) => ({ catalogue_id: id, card_id: `card-${id}` })),
        skipped: [],
        relinked: [],
        failed: [{ catalogue_id: "BC-2", reason }],
        catalogue_version: "2026.4",
      };
      return result;
    });
    const { user } = renderPage();
    const dialog = await selectAndOpenImport(user);
    await user.click(within(dialog).getByRole("button", { name: t("confirmCreate") }));

    const done = await screen.findByRole("dialog", { name: t("importDoneTitle") });
    expect(done).toHaveTextContent(t("importDoneBody", { created: 2, skipped: 0, relinked: 0 }));
    expect(done).toHaveTextContent(t("importFailedBody", { count: 1 }));
    expect(done).toHaveTextContent(`BC-2 — ${reason}`);
    // The catalogue reloads as after any import, so the cards that did land show as existing.
    await waitFor(() => expect(mockApi.callsOf("get", "/capability-catalogue?locale=en")).toHaveLength(2));
  });

  it("renders a result from a backend that sends no failed list", async () => {
    mockApi.on("post", "/capability-catalogue/import", (_path, body) => {
      const ids = (body as { catalogue_ids: string[] }).catalogue_ids;
      // A backend older than 2.158.11: no `failed` key at all.
      const result: Omit<ImportResult, "failed"> = {
        created: ids.map((id) => ({ catalogue_id: id, card_id: `card-${id}` })),
        skipped: [],
        relinked: [],
        catalogue_version: "2026.4",
      };
      return result;
    });
    const { user } = renderPage();
    const dialog = await selectAndOpenImport(user);
    await user.click(within(dialog).getByRole("button", { name: t("confirmCreate") }));

    const done = await screen.findByRole("dialog", { name: t("importDoneTitle") });
    expect(done).toHaveTextContent(t("importDoneBody", { created: 3, skipped: 0, relinked: 0 }));
    // Only the summary alert: no warning block and no list of refused entries.
    expect(within(done).getAllByRole("alert")).toHaveLength(1);
    expect(within(done).queryAllByRole("list")).toHaveLength(0);
  });

  it("closes the summary and forgets it", async () => {
    const { user } = renderPage();
    const dialog = await selectAndOpenImport(user);
    await user.click(within(dialog).getByRole("button", { name: t("confirmCreate") }));
    const done = await screen.findByRole("dialog", { name: t("importDoneTitle") });
    await user.click(within(done).getByRole("button", { name: tc("actions.close") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("cancels the confirmation without posting", async () => {
    const { user } = renderPage();
    const dialog = await selectAndOpenImport(user);
    await user.click(within(dialog).getByRole("button", { name: tc("actions.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("post")).toHaveLength(0);
    // The selection survives a cancel.
    expect(screen.getByText(t("readyToImport", { count: 3 }))).toBeInTheDocument();
  });

  it("keeps the dialog open and shows the server's rejection", async () => {
    mockApi.fail("post", "/capability-catalogue/import", 400, "Too many at once");
    const { user } = renderPage();
    const dialog = await selectAndOpenImport(user);
    await user.click(within(dialog).getByRole("button", { name: t("confirmCreate") }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Too many at once");
    expect(within(dialog).getByRole("button", { name: t("confirmCreate") })).toBeEnabled();
    expect(screen.queryByRole("dialog", { name: t("importDoneTitle") })).not.toBeInTheDocument();
    // Nothing landed, so no reload either.
    expect(mockApi.callsOf("get", "/capability-catalogue?locale=en")).toHaveLength(1);
  });

  it("omits the relations line when the service does not report any", async () => {
    mockApi.on("post", "/capability-catalogue/import", {
      created: [],
      skipped: [{ catalogue_id: "BC-1", card_id: "c", reason: "exists" }],
      relinked: [{ catalogue_id: "BC-2", card_id: "c2", new_parent_card_id: "p" }],
      catalogue_version: "2026.4",
    } satisfies ImportResult);
    const { user } = renderPage();
    const dialog = await selectAndOpenImport(user);
    await user.click(within(dialog).getByRole("button", { name: t("confirmCreate") }));
    const done = await screen.findByRole("dialog", { name: t("importDoneTitle") });
    expect(done).toHaveTextContent(t("importDoneBody", { created: 0, skipped: 1, relinked: 1 }));
    expect(done).not.toHaveTextContent(t("autoRelationsCreated", { count: 2 }));
    // Nothing was created, so there is no inventory to open.
    expect(within(done).queryByRole("button", { name: t("openInventory") })).not.toBeInTheDocument();
  });

  it("batches a large selection and reports progress between batches", async () => {
    const many = Array.from({ length: 501 }, (_, i) => node({ id: `BC-${i + 1}`, name: `Cap ${i + 1}`, level: 1 }));
    mockApi.on("get", "/capability-catalogue?locale=en", payload(many));
    let releaseFirst: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let call = 0;
    mockApi.on("post", "/capability-catalogue/import", async (_path, body) => {
      const ids = (body as { catalogue_ids: string[] }).catalogue_ids;
      call += 1;
      if (call === 1) await firstGate;
      return {
        created: ids.map((id) => ({ catalogue_id: id, card_id: `card-${id}` })),
        skipped: [],
        relinked: [],
        catalogue_version: "2026.4",
      } satisfies ImportResult;
    });

    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "stub-select-all" }));
    await user.click(screen.getByRole("button", { name: new RegExp(`${t("createSelected", { count: 501 })}$`) }));
    const dialog = await screen.findByRole("dialog", { name: t("importConfirmTitle") });
    await user.click(within(dialog).getByRole("button", { name: t("confirmCreate") }));

    // Two batches of ≤ 500; the first is still in flight.
    expect(await within(dialog).findByText(t("importingProgress", { done: 0, total: 2 }))).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: t("confirmCreate") })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: tc("actions.cancel") })).toBeDisabled();

    await act(async () => releaseFirst());
    const done = await screen.findByRole("dialog", { name: t("importDoneTitle") });
    expect(done).toHaveTextContent(t("importDoneBody", { created: 501, skipped: 0, relinked: 0 }));
    const posts = mockApi.callsOf("post", "/capability-catalogue/import");
    expect(posts.map((p) => (p.body as { catalogue_ids: string[] }).catalogue_ids.length)).toEqual([500, 1]);
  });

  it("keeps and reports the partial result when a later batch fails", async () => {
    const many = Array.from({ length: 501 }, (_, i) => node({ id: `BC-${i + 1}`, name: `Cap ${i + 1}`, level: 1 }));
    mockApi.on("get", "/capability-catalogue?locale=en", payload(many));
    let call = 0;
    mockApi.on("post", "/capability-catalogue/import", (_path, body) => {
      const ids = (body as { catalogue_ids: string[] }).catalogue_ids;
      call += 1;
      if (call === 2) {
        throw Object.assign(new Error("POST failed"), { status: 500, detail: "db down" });
      }
      return {
        created: ids.map((id) => ({ catalogue_id: id, card_id: `card-${id}` })),
        skipped: [],
        relinked: [],
        catalogue_version: "2026.4",
      } satisfies ImportResult;
    });

    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "stub-select-all" }));
    await user.click(screen.getByRole("button", { name: new RegExp(`${t("createSelected", { count: 501 })}$`) }));
    const dialog = await screen.findByRole("dialog", { name: t("importConfirmTitle") });
    await user.click(within(dialog).getByRole("button", { name: t("confirmCreate") }));

    // The batches that landed are reported as a (partial) result.
    const done = await screen.findByRole("dialog", { name: t("importDoneTitle") });
    expect(done).toHaveTextContent(t("importDoneBody", { created: 500, skipped: 0, relinked: 0 }));
    expect(within(done).getByRole("button", { name: t("openInventory") })).toBeInTheDocument();
    // The failure of batch 2 is shown beside the partial result (it used to
    // be hidden, because the error alert only rendered while there was no
    // result), and the catalogue is reloaded so what landed reads as existing.
    const alerts = within(done).getAllByRole("alert").map((a) => a.textContent ?? "");
    expect(alerts.some((text) => text.includes("db down"))).toBe(true);
    expect(mockApi.callsOf("get", "/capability-catalogue?locale=en")).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------------- */
/*  Catalogue updates (admin)                                                 */
/* ------------------------------------------------------------------------- */

describe("CataloguePage — updates", () => {
  const checkButton = () => screen.findByRole("button", { name: new RegExp(`${t("checkUpdate")}$`) });

  it("confirms an up-to-date catalogue with a banner and a snackbar", async () => {
    const { user } = renderPage();
    await user.click(await checkButton());

    expect(await screen.findByText(t("updateUpToDate"))).toBeInTheDocument();
    const banner = screen.getByText(t("upToDateBanner", { version: "2026.4" })).closest(".MuiAlert-root")!;
    expect(banner).toBeInTheDocument();
    await user.click(within(banner as HTMLElement).getByRole("button"));
    expect(screen.queryByText(t("upToDateBanner", { version: "2026.4" }))).not.toBeInTheDocument();
  });

  it("offers to fetch a newer catalogue and reloads once it is active", async () => {
    mockApi.on(
      "get",
      "/capability-catalogue/update-status",
      status({
        update_available: true,
        remote: { catalogue_version: "2026.5", schema_version: "1", generated_at: null, node_count: 10 },
      }),
    );
    const { user } = renderPage();
    await user.click(await checkButton());

    const fetchButton = await screen.findByRole("button", { name: new RegExp(`${t("fetchUpdate", { version: "2026.5" })}$`) });
    expect(screen.queryByText(t("updateUpToDate"))).not.toBeInTheDocument();
    await user.click(fetchButton);

    expect(await screen.findByText(t("updateFetched", { version: "2026.5" }))).toBeInTheDocument();
    expect(mockApi.callsOf("post", "/capability-catalogue/update-fetch")).toHaveLength(1);
    await waitFor(() => expect(mockApi.callsOf("get", "/capability-catalogue?locale=en")).toHaveLength(2));
    expect(screen.queryByRole("button", { name: new RegExp(`${t("fetchUpdate", { version: "2026.5" })}$`) })).not.toBeInTheDocument();
  });

  it("shows the status endpoint's own error as a warning", async () => {
    mockApi.on("get", "/capability-catalogue/update-status", status({ error: "Registry unreachable" }));
    const { user } = renderPage();
    await user.click(await checkButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Registry unreachable");
    expect(screen.queryByText(t("updateUpToDate"))).not.toBeInTheDocument();
  });

  it("reports a failed check and a failed fetch in the snackbar", async () => {
    mockApi.fail("get", "/capability-catalogue/update-status", 502, "proxy down");
    const { user } = renderPage();
    await user.click(await checkButton());
    expect(await screen.findByText("proxy down")).toBeInTheDocument();

    mockApi.on(
      "get",
      "/capability-catalogue/update-status",
      status({ update_available: true, remote: { catalogue_version: "2026.5", schema_version: "1", generated_at: null } }),
    );
    mockApi.fail("post", "/capability-catalogue/update-fetch", 500, "fetch exploded");
    await user.click(await checkButton());
    await user.click(await screen.findByRole("button", { name: new RegExp(`${t("fetchUpdate", { version: "2026.5" })}$`) }));
    expect(await screen.findByText("fetch exploded")).toBeInTheDocument();
    expect(mockApi.callsOf("get", "/capability-catalogue?locale=en")).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------------- */
/*  Detail dialog                                                             */
/* ------------------------------------------------------------------------- */

describe("CataloguePage — detail", () => {
  it("shows a node with its breadcrumb, badges, metadata and subtree", async () => {
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "stub-open-BC-1.1" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Billing")).toBeInTheDocument();
    expect(within(dialog).getByText("BC-1.1")).toBeInTheDocument();
    expect(within(dialog).getByText("L2")).toBeInTheDocument();
    expect(within(dialog).getByText(t("deprecatedLabel"), { selector: ".MuiChip-label" })).toBeInTheDocument();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Folded into Invoicing.");
    // Industry splits on ";", aliases join, references link out.
    expect(within(dialog).getByText("Cross-Industry")).toBeInTheDocument();
    expect(within(dialog).getByText("Retail")).toBeInTheDocument();
    expect(within(dialog).getByText("Invoicing ops, AR")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "https://example.test/billing" })).toHaveAttribute("target", "_blank");
    // Its one descendant is listed, flagged as an existing card.
    expect(within(dialog).getByText(t("subtreeHeader", { count: 1 }))).toBeInTheDocument();
    expect(within(dialog).getByText("Invoicing")).toBeInTheDocument();
    expect(within(dialog).getByText("Sends the bills.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(t("alreadyExists"))).toBeInTheDocument();

    // The breadcrumb opens the parent, whose description is linkified.
    await user.click(within(dialog).getByRole("button", { name: "Finance" }));
    expect(within(dialog).getByRole("link", { name: "https://example.test/finance" })).toBeInTheDocument();
    expect(within(dialog).getByText(t("subtreeHeader", { count: 2 }))).toBeInTheDocument();
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("flags an existing card and renders the kind's extra detail section", async () => {
    const extras = vi.fn((n: CatalogueNode) => <div data-testid="extras">{n.id}</div>);
    hookState.auth.user = ADMIN;
    const { user } = renderWithProviders(<CataloguePage config={{ ...CONFIG, renderDetailExtras: extras }} />, {
      user: ADMIN,
    });
    await user.click(await screen.findByRole("button", { name: "stub-open-BC-1.1.1" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(t("alreadyExists"), { selector: ".MuiChip-label" })).toBeInTheDocument();
    expect(within(dialog).getByTestId("extras")).toHaveTextContent("BC-1.1.1");
    expect(within(dialog).queryByText(/Subtree/)).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------- */
/*  Back to top                                                               */
/* ------------------------------------------------------------------------- */

describe("CataloguePage — back to top", () => {
  it("reveals the button past 300px and scrolls the window back", async () => {
    const scrollTo = vi.fn();
    Object.defineProperty(window, "scrollTo", { value: scrollTo, configurable: true, writable: true });
    const { user } = renderPage();
    await screen.findByRole("heading", { name: t("pageTitle") });

    // Inside a closed <Fade> the button is `visibility: hidden`, and a hidden
    // node has an empty accessible name — so find it by its label attribute.
    const fab = screen.getByLabelText(t("backToTop"));
    expect(fab).not.toBeVisible();

    Object.defineProperty(window, "scrollY", { value: 400, configurable: true, writable: true });
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
    });
    await waitFor(() => expect(fab).toBeVisible());

    await user.click(fab);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true, writable: true });
  });
});
