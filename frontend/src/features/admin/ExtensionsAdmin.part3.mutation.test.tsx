/**
 * ExtensionsAdmin — the page body from the Store grid down: tag filters and
 * catalogue sections, the Installed tab's license strip and extension table,
 * the install pipeline dialog, the license / entitlement-downgrade dialogs and
 * the remove / uninstall / update / version-downgrade confirmations.
 *
 * Two kinds of assertion live here. Behaviour (which row carries the update
 * chip, when a button is inert, which dialog closes) is checked in English.
 * Every label on these surfaces is a `t(key, englishDefault)` pair whose
 * default equals the English locale, so a wrong key would still read right in
 * English; the Spanish suites below are what prove each label resolves its own
 * key, i.e. that the page is actually translated.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

import ExtensionsAdmin from "./ExtensionsAdmin";
import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import { DEFAULT_DATE_FORMAT, formatDateWith } from "@/hooks/useDateFormat";
import { resetExtensionHost } from "@/lib/extensionHost";

const EXT = {
  key: "sample-ext",
  name: "Sample Extension",
  version: "1.0.0",
  status: "installed",
  enabled: true,
  capabilities: ["content"],
  entitlement: { state: "active", plan: "enterprise", expires_at: null, grace_until: null },
};

const LICENSE = {
  licensee: "ACME Corp",
  customer_id: "cus_1",
  grace_days: 30,
  entitlements: [{ extension_key: "sample-ext", plan: "enterprise", expires_at: null }],
  uploaded_at: "2026-07-01T12:00:00Z",
};

const STORE_ITEM = {
  key: "esg-pack",
  name: "ESG Content Pack",
  description: "Adds ESG capabilities.",
  price: "990 EUR / year",
  payment_link: "https://buy.stripe.test/pl_1",
  version: "1.0.0",
  installed_version: null,
  update_available: false,
  entitlement_state: "unlicensed",
};

const OFFLINE_CATALOG = { configured: false, reachable: false, store_url: "", items: [] };

function online(items: unknown[]) {
  return { configured: true, reachable: true, store_url: "", items };
}

function prime({
  extensions = [EXT] as unknown[],
  license = LICENSE as unknown,
  catalog = OFFLINE_CATALOG as unknown,
} = {}) {
  mockApi.on("get", "/admin/extensions", () => extensions);
  if (license) mockApi.on("get", "/admin/extensions/license", license);
  else mockApi.fail("get", "/admin/extensions/license", 404, "No license installed");
  mockApi.on("get", "/admin/extensions/store/catalog", catalog);
  mockApi.on("get", "/admin/extensions/instance", { instance_id: "" });
  mockApi.fail("get", "/settings/extension-store-status", 403);
}

function renderPage(path = "/admin/extensions?tab=installed") {
  const user = userEvent.setup();
  const result = render(
    <MemoryRouter initialEntries={[path]}>
      <ExtensionsAdmin />
    </MemoryRouter>,
  );
  return { ...result, user };
}

/** A request the test resolves (or never resolves) itself. */
function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** The bundle file input — the only one outside a dialog. */
function bundleInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

/** Upload a bundle from the Store tab; the upload answers with `created`. */
async function uploadBundle(created: unknown) {
  mockApi.on("upload", "/admin/extensions/install", created);
  // The status poll fires 2s later; keep it answering the same row.
  mockApi.on("get", /^\/admin\/extensions\/install\//, created);
  mockApi.on("delete", /^\/admin\/extensions\/install\//, undefined);
  const rendered = renderPage("/admin/extensions");
  await rendered.user.upload(bundleInput(rendered.container), new File(["zip"], "sample.teax"));
  return rendered;
}

const PREVIEWED = {
  id: "i1",
  filename: "sample.teax",
  status: "previewed",
  extension_key: "sample-ext",
  extension_version: "1.0.0",
  diff: { totals: { created: 1, updated: 0, skipped: 0, conflict: 0, failed: 0 } },
};

/** Collect errors thrown inside event handlers. */
function collectErrors() {
  const errors: unknown[] = [];
  const onError = (e: ErrorEvent) => {
    errors.push(e.error);
    e.preventDefault();
  };
  window.addEventListener("error", onError);
  return { errors, stop: () => window.removeEventListener("error", onError) };
}

function chipOf(el: HTMLElement): HTMLElement {
  return el.closest(".MuiChip-root") as HTMLElement;
}

function rowOf(text: string): HTMLElement {
  return screen.getByText(text).closest("tr") as HTMLElement;
}

beforeEach(() => {
  mockApi.reset();
  localStorage.clear();
  resetExtensionHost();
});

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (i18n.language !== "en") await i18n.changeLanguage("en");
});

// ---------------------------------------------------------------------------
// Store tab
// ---------------------------------------------------------------------------

describe("ExtensionsAdmin — store tag filter", () => {
  const TAGGED = online([
    { ...STORE_ITEM, key: "a", name: "Alpha Ext", tags: ["integration"] },
    { ...STORE_ITEM, key: "b", name: "Beta Ext", tags: ["reporting"] },
  ]);

  it("marks All as the selected filter until a tag is picked, then the tag", async () => {
    prime({ catalog: TAGGED });
    const { user } = renderPage("/admin/extensions");
    await screen.findByText("Alpha Ext");

    const all = chipOf(screen.getByText("All"));
    const integration = chipOf(screen.getByText("integration"));
    expect(all).toHaveClass("MuiChip-filled", "MuiChip-colorPrimary");
    expect(integration).toHaveClass("MuiChip-outlined");
    expect(integration).not.toHaveClass("MuiChip-filled");
    // Nothing is filtered out yet, so there is no "no match" hint.
    expect(screen.queryByText("No extensions match the selected tags.")).not.toBeInTheDocument();

    await user.click(integration);
    expect(chipOf(screen.getByText("All"))).toHaveClass("MuiChip-outlined", "MuiChip-colorDefault");
    expect(chipOf(screen.getByText("integration"))).toHaveClass("MuiChip-filled", "MuiChip-colorPrimary");
    expect(chipOf(screen.getByText("reporting"))).toHaveClass("MuiChip-outlined");
    expect(screen.queryByText("Beta Ext")).not.toBeInTheDocument();
  });

  it("says so when the selected tags match no extension (AND filter)", async () => {
    prime({ catalog: TAGGED });
    const { user } = renderPage("/admin/extensions");
    await screen.findByText("Alpha Ext");

    await user.click(screen.getByText("integration"));
    await user.click(screen.getByText("reporting"));
    expect(screen.getByText("No extensions match the selected tags.")).toBeInTheDocument();
    expect(screen.queryByText("Alpha Ext")).not.toBeInTheDocument();
    expect(screen.queryByText("Beta Ext")).not.toBeInTheDocument();

    await user.click(screen.getByText("All"));
    expect(screen.getByText("Alpha Ext")).toBeInTheDocument();
    expect(screen.queryByText("No extensions match the selected tags.")).not.toBeInTheDocument();
  });

  it("renders one keyed section per category without React key collisions", async () => {
    const errors = vi.spyOn(console, "error");
    prime({
      catalog: online([
        { ...STORE_ITEM, key: "a", name: "Alpha Ext", category: "integrations" },
        { ...STORE_ITEM, key: "b", name: "Beta Ext", category: "regulations" },
        { ...STORE_ITEM, key: "c", name: "Gamma Ext", category: "not-a-known-slug" },
      ]),
    });
    renderPage("/admin/extensions");
    await screen.findByText("Alpha Ext");

    expect(screen.getByRole("heading", { name: "Integrations" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Regulations" })).toBeInTheDocument();
    // An unknown slug lands in the trailing Other section rather than vanishing.
    expect(screen.getByRole("heading", { name: "Other" })).toBeInTheDocument();
    expect(screen.getByText("Gamma Ext")).toBeInTheDocument();
    const keyWarnings = errors.mock.calls.filter((args) =>
      args.some((a) => typeof a === "string" && a.includes("same key")),
    );
    expect(keyWarnings).toHaveLength(0);
  });

  it("keeps the Installed tab's content off the Store tab", async () => {
    prime({ catalog: online([STORE_ITEM]) });
    renderPage("/admin/extensions");
    await screen.findByText("ESG Content Pack");
    expect(screen.queryByText("Installed extensions")).not.toBeInTheDocument();
    expect(screen.queryByText("Licensed to ACME Corp")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Installed tab
// ---------------------------------------------------------------------------

describe("ExtensionsAdmin — installed table", () => {
  it("shows the license upload date in the configured date format", async () => {
    prime();
    renderPage();
    await screen.findByText("Licensed to ACME Corp");
    expect(
      screen.getByText(`uploaded ${formatDateWith(DEFAULT_DATE_FORMAT, LICENSE.uploaded_at)}`),
    ).toBeInTheDocument();
  });

  it("offers an update only for the catalogue entry of that extension, and uses its logo", async () => {
    prime({
      catalog: online([
        // Another extension's update must not leak onto this row…
        {
          ...STORE_ITEM,
          key: "other-ext",
          update_available: true,
          version: "9.9.9",
          logo: "https://store.test/other.png",
        },
        // …and this extension's own entry has nothing newer.
        {
          ...STORE_ITEM,
          key: "sample-ext",
          installed_version: "1.0.0",
          update_available: false,
          logo: "https://store.test/own.png",
        },
      ]),
    });
    renderPage();
    await screen.findByText("Sample Extension");

    expect(screen.queryByText(/Update to/)).not.toBeInTheDocument();
    const logo = rowOf("Sample Extension").querySelector("img");
    expect(logo).not.toBeNull();
    expect(logo).toHaveAttribute("src", "https://store.test/own.png");
  });

  it("captions each row with its key and capabilities, and flags a load error", async () => {
    prime({
      extensions: [
        { ...EXT, capabilities: ["content", "ui"], last_error: "Bundle signature mismatch" },
        { ...EXT, key: "bare-ext", name: "Bare Extension", capabilities: [] },
      ],
    });
    renderPage();
    await screen.findByText("Sample Extension");

    expect(screen.getByText("sample-ext · content, ui")).toBeInTheDocument();
    // No capabilities: the key alone, with no dangling separator.
    expect(screen.getByText("bare-ext")).toBeInTheDocument();

    expect(screen.getAllByText("Load error")).toHaveLength(1);
    expect(within(rowOf("Sample Extension")).getByText("Load error")).toBeInTheDocument();
    expect(within(rowOf("Bare Extension")).queryByText("Load error")).not.toBeInTheDocument();
    // The raw error text is the chip's tooltip, never inline in the cell.
    expect(screen.queryByText("Bundle signature mismatch")).not.toBeInTheDocument();
  });

  it("labels the status chip through the locale, not with the raw status", async () => {
    prime({ extensions: [{ ...EXT, status: "needs_restart" }] });
    renderPage();
    await screen.findByText("Sample Extension");
    expect(within(rowOf("Sample Extension")).getByText("Restart required")).toBeInTheDocument();
  });

  it("offers Renew for a lapsed entitlement but not for a free one", async () => {
    prime({
      extensions: [
        { ...EXT, entitlement: { ...EXT.entitlement, state: "free" } },
        {
          ...EXT,
          key: "lapsed-ext",
          name: "Lapsed Extension",
          entitlement: { ...EXT.entitlement, state: "expired" },
        },
      ],
    });
    renderPage();
    await screen.findByText("Sample Extension");
    expect(within(rowOf("Sample Extension")).queryByRole("button", { name: /Renew/ })).not.toBeInTheDocument();
    expect(within(rowOf("Lapsed Extension")).getByRole("button", { name: /Renew/ })).toBeInTheDocument();
  });

  it("disables the enable switch while its toggle is in flight", async () => {
    prime();
    const put = deferred();
    mockApi.on("put", "/admin/extensions/sample-ext/enabled", () => put.promise);
    const { user } = renderPage();

    const toggle = await screen.findByRole("checkbox", { name: "Toggle extension" });
    expect(toggle).toBeEnabled();
    await user.click(toggle);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Toggle extension" })).toBeDisabled());
    await act(async () => put.resolve({}));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Toggle extension" })).toBeEnabled());
  });

  it("turns the update chip into an inert spinner while its install starts", async () => {
    prime({
      catalog: online([
        {
          ...STORE_ITEM,
          key: "sample-ext",
          installed_version: "1.0.0",
          update_available: true,
          version: "1.1.0",
          entitlement_state: "active",
        },
      ]),
    });
    const post = deferred();
    mockApi.on("post", "/admin/extensions/store/install", () => post.promise);
    const { user } = renderPage();

    const chip = chipOf(await screen.findByText("Update to 1.1.0"));
    expect(within(chip).getByText("upgrade")).toBeInTheDocument();
    expect(within(chip).queryByRole("progressbar")).not.toBeInTheDocument();
    expect(chip).not.toHaveAttribute("aria-disabled", "true");

    await user.click(chip);
    const busy = chipOf(await screen.findByText("Updating…"));
    expect(within(busy).getByRole("progressbar", { hidden: true })).toBeInTheDocument();
    expect(within(busy).queryByText("upgrade")).not.toBeInTheDocument();
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(mockApi.callsOf("post", "/admin/extensions/store/install")[0].body).toEqual({
      key: "sample-ext",
    });
  });
});

// ---------------------------------------------------------------------------
// Install pipeline dialog
// ---------------------------------------------------------------------------

describe("ExtensionsAdmin — install dialog", () => {
  it("names the bundle's key and version and shows its status", async () => {
    prime();
    await uploadBundle(PREVIEWED);
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("sample-ext 1.0.0")).toBeInTheDocument();
    expect(within(dialog).getByText("previewed")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Discard" })).toBeInTheDocument();
  });

  it("shows the key alone when the bundle carries no version", async () => {
    prime();
    await uploadBundle({ ...PREVIEWED, extension_version: null });
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("sample-ext")).toBeInTheDocument();
  });

  it("shows no key chip before the bundle's key is known", async () => {
    prime();
    await uploadBundle({ id: "i1", filename: "sample.teax", status: "previewed", extension_key: null });
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("previewed")).toBeInTheDocument();
    expect(within(dialog).queryByText(/null|undefined/)).not.toBeInTheDocument();
  });

  it("offers no way out while the bundle is being applied", async () => {
    prime();
    await uploadBundle({ ...PREVIEWED, status: "applying" });
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("applying")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Discard" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });

  it("labels a one-click store install as installing while it auto-applies", async () => {
    prime({ catalog: online([{ ...STORE_ITEM, entitlement_state: "active" }]) });
    mockApi.on("post", "/admin/extensions/store/install", { ...PREVIEWED, id: "s1", extension_key: "esg-pack" });
    mockApi.on("get", "/admin/extensions/install/s1", { ...PREVIEWED, id: "s1", extension_key: "esg-pack" });
    mockApi.on("post", "/admin/extensions/install/s1/apply", () => new Promise(() => {}));
    const { user } = renderPage("/admin/extensions");

    await user.click(await screen.findByText("Install", { selector: "button" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("installing")).toBeInTheDocument();
    expect(within(dialog).queryByText("previewed")).not.toBeInTheDocument();
  });

  it("closes an error-only dialog with Escape once nothing is running", async () => {
    prime();
    mockApi.fail("upload", "/admin/extensions/install", 400, "bad bundle");
    const { container, user } = renderPage("/admin/extensions");
    await user.upload(bundleInput(container), new File(["zip"], "broken.teax"));

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("UPLOAD /admin/extensions/install failed")).toBeInTheDocument();
    expect(within(dialog).getByText("Install extension")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("closes the version-downgrade confirmation once the older version is confirmed", async () => {
    prime();
    const { user } = await uploadBundle({
      ...PREVIEWED,
      diff: { ...PREVIEWED.diff, downgrade: { from: "2.0.0", to: "1.0.0" } },
    });
    mockApi.on("post", "/admin/extensions/install/i1/apply", { ...PREVIEWED, status: "applying" });

    await user.click(await screen.findByText("Install extension", { selector: "button" }));
    await user.click(await screen.findByRole("button", { name: /Install older version/ }));
    await waitFor(() => expect(screen.queryByText("Install an older version?")).not.toBeInTheDocument());
    expect(mockApi.callsOf("post", "/admin/extensions/install/i1/apply")).toHaveLength(1);
  });

  it("applies the older version once when its confirmation is double-clicked", async () => {
    prime();
    const { user } = await uploadBundle({
      ...PREVIEWED,
      diff: { ...PREVIEWED.diff, downgrade: { from: "2.0.0", to: "1.0.0" } },
    });
    mockApi.on("post", "/admin/extensions/install/i1/apply", () => new Promise(() => {}));

    await user.click(await screen.findByText("Install extension", { selector: "button" }));
    const confirm = await screen.findByRole("button", { name: /Install older version/ });
    const caught = collectErrors();
    try {
      // The second click lands while the dialog fades out.
      fireEvent.click(confirm);
      fireEvent.click(confirm);
      await waitFor(() => expect(mockApi.callsOf("post", "/admin/extensions/install/i1/apply")).toHaveLength(1));
      expect(mockApi.callsOf("post", "/admin/extensions/install/i1/apply")[0].body).toEqual({
        confirm_downgrade: true,
      });
      expect(caught.errors).toEqual([]);
    } finally {
      caught.stop();
    }
  });
});

// ---------------------------------------------------------------------------
// License dialog, install gate, entitlement downgrade
// ---------------------------------------------------------------------------

describe("ExtensionsAdmin — license dialog", () => {
  async function openPlainDialog(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByText("Licensed to ACME Corp");
    await user.click(screen.getByRole("button", { name: "Enter license…" }));
    return screen.findByRole("dialog");
  }

  it("keeps Apply license inert until there is non-blank text, with no error shown", async () => {
    prime();
    const { user } = renderPage();
    const dialog = await openPlainDialog(user);

    expect(within(dialog).getByText("Apply a license")).toBeInTheDocument();
    // Only the install gate explains why a license is needed.
    expect(within(dialog).queryByText(/verified but needs a license/)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    const apply = within(dialog).getByRole("button", { name: /Apply license/ });
    expect(apply).toBeDisabled();

    const box = within(dialog).getByPlaceholderText("Paste license text here…");
    await user.type(box, "   ");
    expect(apply).toBeDisabled();
    await user.type(box, "LIC");
    expect(apply).toBeEnabled();
  });

  it("shows a failed apply as an error alert inside the dialog", async () => {
    prime();
    mockApi.fail("put", "/admin/extensions/license", 400, "bad");
    const { user } = renderPage();
    const dialog = await openPlainDialog(user);
    await user.type(within(dialog).getByPlaceholderText("Paste license text here…"), "LIC");
    await user.click(within(dialog).getByRole("button", { name: /Apply license/ }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("PUT /admin/extensions/license failed");
  });

  it("closes the downgrade warning when the admin applies anyway", async () => {
    prime();
    mockApi.fail("put", "/admin/extensions/license", 409, {
      code: "entitlement_downgrade",
      dropped: ["sample-ext"],
    });
    const { user } = renderPage();
    const dialog = await openPlainDialog(user);
    await user.type(within(dialog).getByPlaceholderText("Paste license text here…"), "narrow");
    await user.click(within(dialog).getByRole("button", { name: /Apply license/ }));

    const warning = (await screen.findByText("This license drops active entitlements")).closest(
      "[role=dialog]",
    ) as HTMLElement;
    // The confirmed retry goes through.
    mockApi.on("put", "/admin/extensions/license", {});
    await user.click(within(warning).getByRole("button", { name: /Apply anyway/ }));
    await waitFor(() =>
      expect(screen.queryByText("This license drops active entitlements")).not.toBeInTheDocument(),
    );
    expect(mockApi.callsOf("put", "/admin/extensions/license").map((c) => c.body)).toEqual([
      { text: "narrow", confirm: false },
      { text: "narrow", confirm: true },
    ]);
  });
});

describe("ExtensionsAdmin — install gate", () => {
  it("offers a trial only to an unlicensed listing that has one", async () => {
    prime({
      extensions: [
        { ...EXT, key: "esg-pack", name: "ESG Content Pack", entitlement: { ...EXT.entitlement, state: "expired" } },
      ],
      catalog: online([
        {
          ...STORE_ITEM,
          installed_version: "1.0.0",
          update_available: true,
          version: "1.1.0",
          // A lapsed subscription is not a trial candidate, link or not.
          entitlement_state: "expired",
          trial_link: "https://buy.stripe.test/trial_1",
        },
      ]),
    });
    const { user } = renderPage();
    await user.click(await screen.findByText("Update to 1.1.0"));
    const gate = await screen.findByRole("dialog");
    expect(within(gate).getByText("License required")).toBeInTheDocument();
    expect(
      within(gate).getByText(/^ESG Content Pack needs a license entitlement to run\./),
    ).toBeInTheDocument();
    expect(within(gate).getByRole("button", { name: /Buy — 990 EUR \/ year/ })).toBeInTheDocument();
    expect(within(gate).queryByRole("button", { name: /Start 30-day trial/ })).not.toBeInTheDocument();
  });

  it("offers no trial when the listing has no trial link, and a plain Buy without a price", async () => {
    prime({ catalog: online([{ ...STORE_ITEM, price: "" }]) });
    const { user } = renderPage("/admin/extensions");
    await user.click(await screen.findByText("Install", { selector: "button" }));
    const gate = await screen.findByRole("dialog");
    expect(within(gate).getByText("License required")).toBeInTheDocument();
    expect(within(gate).getByText("Buy", { selector: "button" })).toBeInTheDocument();
    expect(within(gate).queryByRole("button", { name: /Start 30-day trial/ })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The same surfaces in Spanish: each label resolves its own locale key.
// ---------------------------------------------------------------------------

describe("ExtensionsAdmin — translated (es)", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("es");
  });

  it("translates the store's filters, the no-match hint and the purchase note", async () => {
    prime({
      catalog: online([
        { ...STORE_ITEM, key: "a", name: "Alpha Ext", tags: ["integration"] },
        { ...STORE_ITEM, key: "b", name: "Beta Ext", tags: ["reporting"] },
      ]),
    });
    const { user } = renderPage("/admin/extensions");
    await screen.findByText("Alpha Ext");
    expect(screen.getByText("Todas")).toBeInTheDocument();
    expect(screen.getByText(/^El pago se abre en una pestaña nueva/)).toBeInTheDocument();

    await user.click(screen.getByText("integration"));
    await user.click(screen.getByText("reporting"));
    expect(
      screen.getByText("Ninguna extensión coincide con las etiquetas seleccionadas."),
    ).toBeInTheDocument();
  });

  it("translates the license strip and the installed table", async () => {
    prime({
      extensions: [
        {
          ...EXT,
          last_error: "boom",
          entitlement: { ...EXT.entitlement, state: "expired" },
        },
      ],
      license: { ...LICENSE, store_managed: true },
      catalog: online([
        {
          ...STORE_ITEM,
          key: "sample-ext",
          installed_version: "1.0.0",
          update_available: true,
          version: "1.1.0",
        },
      ]),
    });
    renderPage();

    expect(await screen.findByText("Licencia otorgada a ACME Corp")).toBeInTheDocument();
    expect(
      screen.getByText(`subida el ${formatDateWith(DEFAULT_DATE_FORMAT, LICENSE.uploaded_at)}`),
    ).toBeInTheDocument();
    expect(screen.getByText("Gestionar suscripción", { selector: "button" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Introducir licencia…" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar licencia" })).toBeInTheDocument();

    expect(screen.getByText("Extensiones instaladas")).toBeInTheDocument();
    for (const header of ["Nombre", "Versión", "Estado", "Licencia", "Habilitada"]) {
      expect(screen.getByRole("columnheader", { name: header })).toBeInTheDocument();
    }
    expect(screen.getByText("Error de carga")).toBeInTheDocument();
    expect(screen.getByText("Actualizar a 1.1.0")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Alternar extensión" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Renovar/ })).toBeInTheDocument();
    // The Uninstall button is named by its tooltip and labelled by its text.
    expect(screen.getByRole("button", { name: "Desinstalar" })).toBeInTheDocument();
    expect(screen.getByText("Desinstalar", { selector: "button" })).toBeInTheDocument();
  });

  it("translates the no-license hint and the empty list", async () => {
    prime({ extensions: [], license: null });
    renderPage();
    expect(await screen.findByText("Aún no hay extensiones instaladas.")).toBeInTheDocument();
    expect(screen.getByText(/^No hay licencia instalada\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Introducir licencia…" })).toBeInTheDocument();
  });

  it("translates the remove-license and uninstall confirmations", async () => {
    prime();
    const { user } = renderPage();

    await user.click(await screen.findByRole("button", { name: "Eliminar licencia" }));
    let dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("¿Eliminar licencia?")).toBeInTheDocument();
    expect(within(dialog).getByText(/^Las extensiones con licencia se desactivarán/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Eliminar licencia$/ })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Desinstalar" }));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("¿Desinstalar la extensión?")).toBeInTheDocument();
    expect(within(dialog).getByText(/^Se eliminan los archivos de la extensión/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Desinstalar" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("translates the license dialog and the entitlement-downgrade warning", async () => {
    prime();
    mockApi.fail("put", "/admin/extensions/license", 409, {
      code: "entitlement_downgrade",
      dropped: ["sample-ext"],
    });
    const { user } = renderPage();
    await screen.findByText("Licencia otorgada a ACME Corp");
    await user.click(screen.getByRole("button", { name: "Introducir licencia…" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Aplicar una licencia")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Subir archivo de licencia…/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
    await user.type(within(dialog).getByPlaceholderText("Pegue el texto de la licencia aquí…"), "narrow");
    await user.click(within(dialog).getByRole("button", { name: /Aplicar licencia/ }));

    const warning = (await screen.findByText("Esta licencia elimina derechos activos")).closest(
      "[role=dialog]",
    ) as HTMLElement;
    expect(within(warning).getByText(/^Su instancia mantiene una sola licencia/)).toBeInTheDocument();
    expect(within(warning).getByText(/^Si esperaba que esta licencia cubriera/)).toBeInTheDocument();
    expect(within(warning).getByRole("button", { name: /Aplicar de todos modos/ })).toBeInTheDocument();
    expect(within(warning).getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
  });

  it("translates the install gate and its waiting state", async () => {
    prime({
      extensions: [
        { ...EXT, key: "esg-pack", name: "ESG Content Pack", entitlement: { ...EXT.entitlement, state: "expired" } },
        { ...EXT, key: "cheap-pack", name: "Cheap Pack", entitlement: { ...EXT.entitlement, state: "expired" } },
      ],
      catalog: online([
        {
          ...STORE_ITEM,
          installed_version: "1.0.0",
          update_available: true,
          version: "1.1.0",
          trial_link: "https://buy.stripe.test/trial_1",
        },
        {
          ...STORE_ITEM,
          key: "cheap-pack",
          name: "Cheap Pack",
          price: "",
          installed_version: "1.0.0",
          update_available: true,
          version: "2.1.0",
        },
      ]),
    });
    vi.spyOn(window, "open").mockReturnValue(null);
    const { user } = renderPage();

    await user.click(await screen.findByText("Actualizar a 2.1.0"));
    let gate = await screen.findByRole("dialog");
    expect(within(gate).getByText("Comprar", { selector: "button" })).toBeInTheDocument();
    await user.click(within(gate).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByText("Actualizar a 1.1.0"));
    gate = await screen.findByRole("dialog");
    expect(within(gate).getByText("Licencia necesaria")).toBeInTheDocument();
    expect(within(gate).getByText(/^ESG Content Pack necesita un derecho de licencia/)).toBeInTheDocument();
    expect(within(gate).getByRole("button", { name: /Iniciar prueba de 30 días/ })).toBeInTheDocument();
    await user.click(within(gate).getByRole("button", { name: /Comprar — 990 EUR \/ year/ }));
    expect(await within(gate).findByText(/^Esperando la confirmación del pago/)).toBeInTheDocument();
  });

  it("translates the update chip's busy label and the pending install dialog", async () => {
    prime({
      catalog: online([
        {
          ...STORE_ITEM,
          key: "sample-ext",
          installed_version: "1.0.0",
          update_available: true,
          version: "1.1.0",
          entitlement_state: "active",
        },
      ]),
    });
    mockApi.on("post", "/admin/extensions/store/install", () => new Promise(() => {}));
    const { user } = renderPage();

    await user.click(await screen.findByText("Actualizar a 1.1.0"));
    expect(await screen.findByText("Actualizando…")).toBeInTheDocument();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Instalar extensión")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
  });

  it("translates the preview's actions and the license gate an unlicensed apply opens", async () => {
    prime();
    const { user } = await uploadBundle(PREVIEWED);
    mockApi.fail("post", "/admin/extensions/install/i1/apply", 403, "unlicensed");

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("button", { name: "Descartar" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /Instalar extensión/ }));

    const gate = (await screen.findByText("Licencia necesaria")).closest("[role=dialog]") as HTMLElement;
    expect(within(gate).getByText(/^Esta extensión está verificada/)).toBeInTheDocument();
  });

  it("translates the version-downgrade confirmation", async () => {
    prime();
    const { user } = await uploadBundle({
      ...PREVIEWED,
      diff: { ...PREVIEWED.diff, downgrade: { from: "2.0.0", to: "1.0.0" } },
    });

    await user.click(await screen.findByRole("button", { name: /Instalar extensión/ }));
    const confirm = (await screen.findByText("¿Instalar una versión anterior?")).closest(
      "[role=dialog]",
    ) as HTMLElement;
    expect(
      within(confirm).getByText(/^Esto instalará la versión 1\.0\.0 sobre la versión 2\.0\.0/),
    ).toBeInTheDocument();
    expect(within(confirm).getByRole("button", { name: /Instalar versión anterior/ })).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByText("¿Instalar una versión anterior?")).not.toBeInTheDocument());
  });

  it("translates the error-only install dialog", async () => {
    prime();
    mockApi.fail("upload", "/admin/extensions/install", 400, "bad bundle");
    const { container, user } = renderPage("/admin/extensions");
    await user.upload(bundleInput(container), new File(["zip"], "broken.teax"));
    const dialog = await screen.findByRole("dialog");
    // Close appears once the failed upload is no longer in flight.
    expect(await within(dialog).findByRole("button", { name: "Cerrar" })).toBeInTheDocument();
    expect(within(dialog).getByText("Instalar extensión")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Update confirmation (reached only from the status poll)
// ---------------------------------------------------------------------------

describe("ExtensionsAdmin — update confirmation", () => {
  it("asks before installing an update, in the viewer's language, and closes once confirmed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await i18n.changeLanguage("es");
    prime({
      catalog: online([
        {
          ...STORE_ITEM,
          entitlement_state: "active",
          installed_version: "1.0.0",
          update_available: true,
          version: "1.1.0",
        },
      ]),
    });
    mockApi.on("post", "/admin/extensions/store/install", { id: "s1", filename: "esg.teax", status: "verifying" });
    mockApi.on("get", "/admin/extensions/install/s1", {
      id: "s1",
      filename: "esg.teax",
      status: "previewed",
      extension_key: "esg-pack",
      diff: { changelog: { version: "1.1.0", from_version: "1.0.0", notes: "- Fixes.", source: "bundle" } },
    });
    mockApi.on("post", "/admin/extensions/install/s1/apply", () => new Promise(() => {}));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <MemoryRouter initialEntries={["/admin/extensions"]}>
        <ExtensionsAdmin />
      </MemoryRouter>,
    );

    await user.click(await screen.findByText("Actualizar a 1.1.0", { selector: "button" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    const title = await screen.findByText("¿Actualizar ESG Content Pack a 1.1.0?");
    const confirm = title.closest("[role=dialog]") as HTMLElement;
    expect(within(confirm).getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
    const install = within(confirm).getByRole("button", { name: "Instalar" });
    const caught = collectErrors();
    try {
      // A double click: the second lands while the dialog fades out and must
      // neither apply twice nor throw.
      fireEvent.click(install);
      fireEvent.click(install);
      await waitFor(() =>
        expect(screen.queryByText("¿Actualizar ESG Content Pack a 1.1.0?")).not.toBeInTheDocument(),
      );
      expect(mockApi.callsOf("post", "/admin/extensions/install/s1/apply")).toHaveLength(1);
      expect(caught.errors).toEqual([]);
    } finally {
      caught.stop();
    }
  });
});
