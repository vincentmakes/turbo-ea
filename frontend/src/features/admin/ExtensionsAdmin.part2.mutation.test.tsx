/**
 * ExtensionsAdmin, part 2 of the mutation pass: the page's action handlers and
 * the install dialog's body.
 *
 * - the checkout URL (store session vs payment link, trailing slash, kind) and
 *   the claim poll that keeps asking until the purchase lands;
 * - which store items install straight away, without the license gate
 *   (free listings, free / grace entitlements);
 * - the install pipeline as one modal: what it shows while the bundle uploads,
 *   while it verifies, on the preview (summary, per-sheet table, release
 *   notes), while it applies and once installed — and that a re-upload, a
 *   discard or a declined update leaves nothing of the previous run behind;
 * - the in-flight state of the Installed tab's own actions (toggle, uninstall,
 *   remove license, renew, manage subscription);
 * - the page chrome: restart warning, license problem, instance-ID chip and
 *   every Store-tab state (unreadable, blocked, empty);
 * - the same surfaces in Spanish, which is what proves their strings come from
 *   the locale files rather than the inline English defaults.
 *
 * The pipeline polls every 2 s and the claim every 5 s, so every test runs
 * under fake timers that also follow real time (Testing Library's waits keep
 * ticking) and advances the clock explicitly. Routes the polls read answer
 * from a mutable value, so an extra poll re-reads the same state.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useExtensionCapabilities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useExtensionCapabilities")>()),
  invalidateExtensionCapabilities: vi.fn(),
}));

import ExtensionsAdmin from "./ExtensionsAdmin";
import { ApiError } from "@/api/client";
import { invalidateExtensionCapabilities } from "@/hooks/useExtensionCapabilities";
import i18n from "@/i18n";
import { registerExtension, resetExtensionHost, UI_SDK_VERSION } from "@/lib/extensionHost";
import { mockApi } from "@/test/apiMock";
import { installWindowOpen } from "@/test/dom";

const invalidateCaps = invalidateExtensionCapabilities as unknown as ReturnType<typeof vi.fn>;

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
  uploaded_at: "2026-07-01T00:00:00Z",
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

function catalogOf(items: unknown[], extra: Record<string, unknown> = {}) {
  return { configured: true, reachable: true, store_url: "", items, ...extra };
}

const INSTANCE = "TEA-ABCD-EFGH-JKLM";

function prime({
  extensions = [EXT] as unknown[],
  license = LICENSE as unknown,
  catalog = OFFLINE_CATALOG as unknown,
  instanceId = "",
} = {}) {
  mockApi.on("get", "/admin/extensions", () => extensions);
  if (license) mockApi.on("get", "/admin/extensions/license", license);
  else mockApi.fail("get", "/admin/extensions/license", 404, "No license installed");
  mockApi.on("get", "/admin/extensions/store/catalog", catalog);
  mockApi.on("get", "/admin/extensions/instance", { instance_id: instanceId });
  mockApi.fail("get", "/settings/extension-store-status", 403);
}

function renderPage(path = "/admin/extensions?tab=installed") {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
  const result = render(
    <MemoryRouter initialEntries={[path]}>
      <ExtensionsAdmin />
    </MemoryRouter>,
  );
  return { ...result, user };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T = unknown>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** The one hidden input every "Install from file…" trigger opens. */
function bundleInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[accept=".teax,.zip"]') as HTMLInputElement;
}

function pickBundle(container: HTMLElement, name = "sample.teax") {
  fireEvent.change(bundleInput(container), { target: { files: [new File(["zip"], name)] } });
}

const HELP = /Upload a signed \.teax bundle/;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mockApi.reset();
  invalidateCaps.mockClear();
  localStorage.clear();
  resetExtensionHost();
});

afterEach(() => {
  vi.useRealTimers();
  resetExtensionHost();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Page chrome
// ---------------------------------------------------------------------------

describe("ExtensionsAdmin part 2 — page chrome", () => {
  it("warns about a restart when any one installed extension needs it", async () => {
    prime({
      extensions: [EXT, { ...EXT, key: "code-ext", name: "Code Extension", status: "needs_restart" }],
    });
    renderPage();
    await screen.findByText("Code Extension");
    expect(screen.getByText(/Restart the backend container to finish/)).toBeInTheDocument();
  });

  it("shows no restart warning when every installed extension is running", async () => {
    prime();
    renderPage();
    await screen.findByText("Sample Extension");
    expect(screen.queryByText(/Restart the backend container/)).not.toBeInTheDocument();
  });

  it("surfaces why the stored license is not in effect", async () => {
    prime({ license: { ...LICENSE, problem: "This license is bound to another instance." } });
    renderPage();
    expect(await screen.findByText("This license is bound to another instance.")).toBeInTheDocument();
  });

  it("keeps a space between the consulting pitch and its link", async () => {
    prime({ license: null });
    renderPage("/admin/extensions");
    const link = await screen.findByRole("link", { name: "More info here" });
    expect(link.closest("[role=alert]")).toHaveTextContent("specific business needs. More info here.");
  });

  it("flips the instance-ID chip to a check while the copy is fresh, then back", async () => {
    prime({ instanceId: INSTANCE });
    const { user } = renderPage();
    const chip = (await screen.findByText(`Instance ID: ${INSTANCE}`)).closest(".MuiChip-root") as HTMLElement;
    const icon = () => chip.querySelector(".material-symbols-outlined")?.textContent;
    expect(icon()).toBe("content_copy");

    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await user.click(chip);
    expect(writeText).toHaveBeenCalledWith(INSTANCE);
    expect(icon()).toBe("check");

    await advance(2100);
    expect(icon()).toBe("content_copy");
  });

  it("still acknowledges the copy where the browser offers no clipboard", async () => {
    prime({ instanceId: INSTANCE });
    const { user } = renderPage();
    const chip = (await screen.findByText(`Instance ID: ${INSTANCE}`)).closest(".MuiChip-root") as HTMLElement;
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    await user.click(chip);
    expect(chip.querySelector(".material-symbols-outlined")?.textContent).toBe("check");
  });

  it("renders the Installed tab for a UI extension that contributes no admin panel", async () => {
    prime();
    registerExtension("sample-ext", { key: "sample-ext", sdkVersion: UI_SDK_VERSION });
    renderPage();
    expect(await screen.findByText("Sample Extension")).toBeInTheDocument();
    expect(screen.getByText("Installed extensions")).toBeInTheDocument();
    expect(screen.queryByText(/failed to render/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Store tab states
// ---------------------------------------------------------------------------

describe("ExtensionsAdmin part 2 — store states", () => {
  it("treats an unreadable catalogue as an unconfigured store", async () => {
    prime({ license: null });
    mockApi.fail("get", "/admin/extensions/store/catalog", 502);
    renderPage("/admin/extensions");
    expect(
      await screen.findByText(/No extension store is configured on this instance/),
    ).toBeInTheDocument();
  });

  it("names the HTTP status when the store refused the request", async () => {
    prime({
      license: null,
      catalog: { ...OFFLINE_CATALOG, configured: true, reason: "blocked", status_code: 403 },
    });
    renderPage("/admin/extensions");
    expect(
      await screen.findByText(/refused this instance's request \(HTTP 403\)\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/could not be reached/)).not.toBeInTheDocument();
  });

  it("leaves the status blank when the refusal carried none", async () => {
    prime({
      license: null,
      catalog: { ...OFFLINE_CATALOG, configured: true, reason: "blocked", status_code: null },
    });
    renderPage("/admin/extensions");
    expect(await screen.findByText(/refused this instance's request \(HTTP \)\./)).toBeInTheDocument();
  });

  it("says so when the store has published nothing yet", async () => {
    prime({ license: null, catalog: catalogOf([]) });
    renderPage("/admin/extensions");
    expect(await screen.findByText("No extensions published yet.")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Checkout and claim
// ---------------------------------------------------------------------------

describe("ExtensionsAdmin part 2 — checkout", () => {
  it("opens the store's own checkout in a new tab, trimming the store URL's trailing slash", async () => {
    prime({
      license: null,
      instanceId: INSTANCE,
      catalog: catalogOf([{ ...STORE_ITEM, trial_link: "https://buy.stripe.test/trial_1" }], {
        store_url: "https://store.test/",
      }),
    });
    const open = installWindowOpen();
    const { user } = renderPage("/admin/extensions");

    await user.click(await screen.findByRole("button", { name: /Try free/ }));
    expect(open).toHaveBeenCalledTimes(1);
    const [url, target, features] = open.mock.calls[0];
    expect(url).toMatch(
      /^https:\/\/store\.test\/checkout\?item=esg-pack&kind=trial&ref=[\w-]{16,}&instance=TEA-ABCD-EFGH-JKLM$/,
    );
    expect(target).toBe("_blank");
    expect(features).toBe("noopener");
  });

  it("falls back to the payment link, appending to its own query string", async () => {
    // A catalogue that names no store URL at all (an older store's payload).
    const withoutStoreUrl = {
      configured: true,
      reachable: true,
      items: [{ ...STORE_ITEM, payment_link: "https://buy.stripe.test/pl_1?locale=en" }],
    };
    prime({ license: null, instanceId: INSTANCE, catalog: withoutStoreUrl });
    const open = installWindowOpen();
    const { user } = renderPage("/admin/extensions");

    await user.click(await screen.findByText("Buy", { selector: "button" }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toMatch(
      /^https:\/\/buy\.stripe\.test\/pl_1\?locale=en&client_reference_id=[\w-]{16,}-TEA-ABCD-EFGH-JKLM$/,
    );
  });

  it("keeps polling the claim until the purchase lands", async () => {
    prime({ license: null, catalog: catalogOf([STORE_ITEM]) });
    let claims = 0;
    mockApi.on("post", "/admin/extensions/store/claim", () =>
      ++claims >= 2 ? { status: "applied" } : { status: "pending" },
    );
    installWindowOpen();
    const { user } = renderPage("/admin/extensions");

    await user.click(await screen.findByText("Buy", { selector: "button" }));
    await advance(5000);
    await waitFor(() => expect(claims).toBe(1));
    expect(screen.queryByText("Purchase confirmed — license applied.")).not.toBeInTheDocument();
    await advance(5000);
    expect(await screen.findByText("Purchase confirmed — license applied.")).toBeInTheDocument();
    expect(claims).toBe(2);
  });

  it("continues a gated update after the purchase with what the store knows about it", async () => {
    prime({
      extensions: [
        {
          ...EXT,
          key: "esg-pack",
          name: "ESG Content Pack",
          entitlement: { state: "expired", plan: null, expires_at: null, grace_until: null },
        },
      ],
      catalog: catalogOf([
        { ...STORE_ITEM, installed_version: "1.0.0", update_available: true, version: "1.1.0" },
      ]),
    });
    mockApi.on("post", "/admin/extensions/store/claim", { status: "applied" });
    mockApi.on("post", "/admin/extensions/store/install", {
      id: "s1",
      filename: "esg.teax",
      status: "verifying",
    });
    mockApi.on("get", "/admin/extensions/install/s1", {
      id: "s1",
      filename: "esg.teax",
      status: "previewed",
      extension_key: "esg-pack",
      diff: {
        changelog: { version: "1.1.0", from_version: "1.0.0", notes: "- Paid release.", source: "bundle" },
      },
    });
    installWindowOpen();
    const { user } = renderPage();

    await user.click(await screen.findByText("Update to 1.1.0"));
    const gate = await screen.findByRole("dialog");
    await user.click(within(gate).getByRole("button", { name: /Buy — 990 EUR \/ year/ }));
    await advance(5000);
    await waitFor(() => expect(mockApi.callsOf("post", "/admin/extensions/store/install")).toHaveLength(1));
    await advance(2000);
    expect(await screen.findByText("Update ESG Content Pack to 1.1.0?")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Install click: straight install vs license gate
// ---------------------------------------------------------------------------

describe("ExtensionsAdmin part 2 — install without a license gate", () => {
  it.each([
    ["a free extension", { free: true, entitlement_state: "unlicensed", payment_link: "" }],
    ["a free entitlement", { entitlement_state: "free" }],
    ["an entitlement in its grace period", { entitlement_state: "grace" }],
  ])("installs %s straight away", async (_label, overrides) => {
    prime({ license: null, catalog: catalogOf([{ ...STORE_ITEM, ...overrides }]) });
    mockApi.on("post", "/admin/extensions/store/install", () => new Promise(() => {}));
    const { user } = renderPage("/admin/extensions");

    await user.click(await screen.findByText("Install", { selector: "button" }));
    expect(mockApi.callsOf("post", "/admin/extensions/store/install")[0]?.body).toEqual({ key: "esg-pack" });
    expect(screen.queryByText("License required")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The install dialog, walked through a manual upload
// ---------------------------------------------------------------------------

const PREVIEW_DIFF = {
  totals: { created: 2, updated: 3, skipped: 4, conflict: 0, failed: 1 },
  sections: [
    { sheet: "CardTypes", created: 2, updated: 0, skipped: 0, conflict: 0, failed: 0, errors: [] },
    { sheet: "Relations", created: 0, updated: 3, skipped: 0, conflict: 0, failed: 0, errors: [] },
    { sheet: "Tags", created: 0, updated: 0, skipped: 4, conflict: 0, failed: 1, errors: [] },
    { sheet: "Untouched", created: 0, updated: 0, skipped: 0, conflict: 0, failed: 0, errors: [] },
  ],
  changelog: {
    version: "1.0.0",
    from_version: "0.9.0",
    notes: "## 1.0.0\n\n- Manual release notes.",
    source: "bundle",
  },
};

const PLAIN_DIFF = { totals: { created: 1, updated: 0, skipped: 0, conflict: 0, failed: 0 } };

function installRow(status: string, extra: Record<string, unknown> = {}) {
  return { id: "i1", filename: "sample.teax", status, extension_key: "sample-ext", ...extra };
}

describe("ExtensionsAdmin part 2 — install dialog", () => {
  it("walks one upload through uploading, verifying, the preview, applying and installed", async () => {
    prime();
    const upload = deferred();
    mockApi.on("upload", "/admin/extensions/install", () => upload.promise);
    let current: unknown = installRow("verifying");
    mockApi.on("get", "/admin/extensions/install/i1", () => current);
    const apply = deferred();
    mockApi.on("post", "/admin/extensions/install/i1/apply", () => apply.promise);
    const { container, user } = renderPage("/admin/extensions");
    await screen.findByText("Install from file…", { selector: "button" });

    // Uploading: the trigger says so, the dialog explains what happens next.
    pickBundle(container);
    const dlg = await screen.findByRole("dialog");
    expect(screen.getByText("Uploading…", { selector: "button" })).toBeDisabled();
    expect(within(dlg).getByText(HELP)).toBeInTheDocument();
    expect(within(dlg).getByRole("progressbar")).toBeInTheDocument();
    expect(within(dlg).queryByRole("alert")).not.toBeInTheDocument();

    // Verifying: still working, the explanation has served its purpose.
    await act(async () => upload.resolve(installRow("verifying")));
    expect(await within(dlg).findByText("verifying")).toBeInTheDocument();
    expect(within(dlg).queryByText(HELP)).not.toBeInTheDocument();
    expect(within(dlg).getByRole("progressbar")).toBeInTheDocument();

    // The preview: summary, per-sheet table and the bundle's release notes.
    current = installRow("previewed", { extension_version: "1.0.0", diff: PREVIEW_DIFF });
    await advance(2000);
    const installBtn = await within(dlg).findByText("Install extension", { selector: "button" });
    expect(within(dlg).queryByText(HELP)).not.toBeInTheDocument();
    expect(within(dlg).queryByRole("progressbar")).not.toBeInTheDocument();
    expect(within(dlg).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(dlg).getByText("sample-ext 0.9.0 → 1.0.0")).toBeInTheDocument();
    expect(within(dlg).getByText("Manual release notes.")).toBeInTheDocument();
    expect(within(dlg).getByText(/^Content preview/).textContent).toBe(
      "Content preview — Created: 2, Updated: 3, Skipped: 4, Failed: 1",
    );
    const rows = within(dlg)
      .getAllByRole("row")
      .map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent));
    expect(rows).toEqual([
      ["CardTypes", "2 created", "", "", ""],
      ["Relations", "", "3 updated", "", ""],
      ["Tags", "", "", "4 skipped", "1"],
    ]);

    // Applying: the button waits, no progress bar or upload hint comes back.
    await user.click(installBtn);
    await waitFor(() => expect(installBtn).toBeDisabled());
    expect(within(dlg).queryByText(HELP)).not.toBeInTheDocument();
    expect(within(dlg).queryByRole("progressbar")).not.toBeInTheDocument();

    // Installed: the notes were for the decision, which has been taken.
    current = installRow("installed", { extension_version: "1.0.0", diff: PREVIEW_DIFF });
    await act(async () => apply.resolve(installRow("applying", { diff: PREVIEW_DIFF })));
    await advance(2000);
    expect(await within(dlg).findByText("Extension installed.")).toBeInTheDocument();
    expect(within(dlg).queryByText("Manual release notes.")).not.toBeInTheDocument();
  });

  it("keeps a failed upload on screen, then starts each re-upload from a clean slate", async () => {
    prime();
    mockApi.fail("upload", "/admin/extensions/install", 400, "bad bundle");
    mockApi.on("get", "/admin/extensions/install/i1", installRow("previewed", { filename: "first.teax", diff: PLAIN_DIFF }));
    const { container } = renderPage("/admin/extensions");
    await screen.findByText("Install from file…", { selector: "button" });

    pickBundle(container);
    const error = await screen.findByText("UPLOAD /admin/extensions/install failed");
    expect(error.closest("[role=alert]")).not.toBeNull();
    const dlg = screen.getByRole("dialog");
    expect(within(dlg).queryByText(HELP)).not.toBeInTheDocument();
    expect(within(dlg).queryByRole("progressbar")).not.toBeInTheDocument();
    // The error is the dialog's whole content: it stays until dismissed.
    await advance(1000);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("UPLOAD /admin/extensions/install failed")).toBeInTheDocument();

    // A re-upload drops the old error straight away.
    const second = deferred();
    mockApi.on("upload", "/admin/extensions/install", () => second.promise);
    pickBundle(container, "first.teax");
    await screen.findByText("Uploading…", { selector: "button" });
    expect(screen.queryByText("UPLOAD /admin/extensions/install failed")).not.toBeInTheDocument();
    await act(async () => second.resolve(installRow("verifying", { filename: "first.teax" })));
    await advance(2000);
    await screen.findByText("Install extension", { selector: "button" });
    expect(screen.getByText("first.teax")).toBeInTheDocument();

    // …and a further one drops the previous preview.
    const third = deferred();
    mockApi.on("upload", "/admin/extensions/install", () => third.promise);
    pickBundle(container, "second.teax");
    await screen.findByText("Uploading…", { selector: "button" });
    expect(screen.queryByText("first.teax")).not.toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByText(HELP)).toBeInTheDocument();
  });

  it("applies a preview that carries no diff at all", async () => {
    prime();
    mockApi.on("upload", "/admin/extensions/install", installRow("verifying"));
    mockApi.on("get", "/admin/extensions/install/i1", installRow("previewed"));
    mockApi.on("post", "/admin/extensions/install/i1/apply", () => new Promise(() => {}));
    const { container, user } = renderPage("/admin/extensions");
    await screen.findByText("Install from file…", { selector: "button" });

    pickBundle(container);
    await advance(2000);
    await user.click(await screen.findByText("Install extension", { selector: "button" }));
    await waitFor(() => expect(mockApi.callsOf("post", "/admin/extensions/install/i1/apply")).toHaveLength(1));
  });

  it("opens the file picker from Install from file…", async () => {
    prime();
    const { container, user } = renderPage("/admin/extensions");
    const clicked = vi.fn();
    bundleInput(container).addEventListener("click", clicked);
    await user.click(await screen.findByText("Install from file…", { selector: "button" }));
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the picker comes back without a file", async () => {
    prime();
    const { container } = renderPage("/admin/extensions");
    await screen.findByText("Install from file…", { selector: "button" });
    fireEvent.change(bundleInput(container), { target: { files: [] } });
    expect(mockApi.callsOf("upload")).toHaveLength(0);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clears the picker after an upload so the same file can be chosen again", async () => {
    prime();
    mockApi.on("upload", "/admin/extensions/install", installRow("verifying"));
    mockApi.on("get", "/admin/extensions/install/i1", installRow("verifying"));
    const { container, user } = renderPage("/admin/extensions");
    await screen.findByText("Install from file…", { selector: "button" });
    const input = bundleInput(container);
    await user.upload(input, new File(["zip"], "sample.teax"));
    await waitFor(() => expect(mockApi.callsOf("upload")).toHaveLength(1));
    await waitFor(() => expect(input.value).toBe(""));
  });
});

// ---------------------------------------------------------------------------
// The install dialog, around a one-click store install
// ---------------------------------------------------------------------------

describe("ExtensionsAdmin part 2 — one-click store install", () => {
  const ACTIVE_ITEM = { ...STORE_ITEM, entitlement_state: "active" };

  it("opens the dialog as the request leaves, and a later upload does not borrow the tile's spinner", async () => {
    prime({ catalog: catalogOf([ACTIVE_ITEM]) });
    const post = deferred();
    mockApi.on("post", "/admin/extensions/store/install", () => post.promise);
    mockApi.on("get", "/admin/extensions/install/s1", {
      id: "s1",
      filename: "esg.teax",
      status: "previewed",
      diff: { totals: { created: 0, updated: 0, skipped: 0, conflict: 0, failed: 2 } },
    });
    const { container, user } = renderPage("/admin/extensions");

    await user.click(await screen.findByText("Install", { selector: "button" }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByText("Install extension")).toBeInTheDocument();
    expect(screen.getByText("Installing…", { selector: "button" })).toBeInTheDocument();

    await act(async () => post.resolve({ id: "s1", filename: "esg.teax", status: "verifying" }));
    await advance(2000);
    // The dry run reported failures: the run stops on its preview for review.
    await within(dlg).findByText("Install extension", { selector: "button" });

    mockApi.on("upload", "/admin/extensions/install", () => new Promise(() => {}));
    pickBundle(container);
    await screen.findByText("Uploading…", { selector: "button" });
    expect(screen.queryByText("Installing…")).not.toBeInTheDocument();
    expect(screen.getByText("Install", { selector: "button" })).toBeDisabled();
  });

  it.each([
    ["a preview with totals", { diff: { totals: { created: 1, updated: 0, skipped: 0, conflict: 0, failed: 0 } } }],
    ["a preview whose diff has no totals", { diff: {} }],
    ["a preview without a diff", {}],
  ])("reads as installing while it auto-applies (%s)", async (_label, extra) => {
    prime({ catalog: catalogOf([ACTIVE_ITEM]) });
    mockApi.on("post", "/admin/extensions/store/install", { id: "s1", filename: "esg.teax", status: "verifying" });
    mockApi.on("get", "/admin/extensions/install/s1", {
      id: "s1",
      filename: "esg.teax",
      status: "previewed",
      ...extra,
    });
    mockApi.on("post", "/admin/extensions/install/s1/apply", () => new Promise(() => {}));
    const { user } = renderPage("/admin/extensions");

    await user.click(await screen.findByText("Install", { selector: "button" }));
    await advance(2000);
    await waitFor(() =>
      expect(mockApi.callsOf("post", "/admin/extensions/install/s1/apply")).toHaveLength(1),
    );
    const dlg = screen.getByRole("dialog");
    expect(within(dlg).getByText("installing")).toBeInTheDocument();
    expect(within(dlg).queryByText("previewed")).not.toBeInTheDocument();
    expect(within(dlg).queryByText("Install extension", { selector: "button" })).not.toBeInTheDocument();
  });

  it("declining an update closes both dialogs and does not arm the next upload to auto-apply", async () => {
    prime({
      catalog: catalogOf([
        { ...ACTIVE_ITEM, installed_version: "1.0.0", update_available: true, version: "1.1.0" },
      ]),
    });
    mockApi.on("post", "/admin/extensions/store/install", { id: "s1", filename: "esg.teax", status: "verifying" });
    mockApi.on("get", "/admin/extensions/install/s1", {
      id: "s1",
      filename: "esg.teax",
      status: "previewed",
      extension_key: "esg-pack",
      diff: { changelog: { version: "1.1.0", from_version: "1.0.0", notes: "- Better.", source: "bundle" } },
    });
    mockApi.on("delete", "/admin/extensions/install/s1", undefined);
    mockApi.on("upload", "/admin/extensions/install", installRow("verifying"));
    mockApi.on("get", "/admin/extensions/install/i1", installRow("previewed", { diff: PLAIN_DIFF }));
    const { container, user } = renderPage("/admin/extensions");

    await user.click(await screen.findByText("Update to 1.1.0", { selector: "button" }));
    await advance(2000);
    const confirm = (await screen.findByText("Update ESG Content Pack to 1.1.0?")).closest(
      "[role=dialog]",
    ) as HTMLElement;
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(mockApi.callsOf("delete", "/admin/extensions/install/s1")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // A manual upload afterwards stops on its preview, as manual uploads do.
    pickBundle(container);
    await advance(2000);
    await screen.findByText("Install extension", { selector: "button" });
    await advance(2000);
    expect(mockApi.callsOf("post", /\/apply$/)).toHaveLength(0);
    expect(within(screen.getByRole("dialog")).getByText("previewed")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Discarding and closing
// ---------------------------------------------------------------------------

describe("ExtensionsAdmin part 2 — discard and close", () => {
  it("a discarded preview does not arm the next upload to auto-apply", async () => {
    prime();
    mockApi.on("upload", "/admin/extensions/install", installRow("verifying"));
    mockApi.on("get", "/admin/extensions/install/i1", installRow("previewed", { diff: PLAIN_DIFF }));
    mockApi.on("delete", "/admin/extensions/install/i1", undefined);
    const { container, user } = renderPage("/admin/extensions");
    await screen.findByText("Install from file…", { selector: "button" });

    pickBundle(container);
    await advance(2000);
    await screen.findByText("Install extension", { selector: "button" });
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    pickBundle(container);
    await advance(2000);
    await screen.findByText("Install extension", { selector: "button" });
    await advance(2000);
    expect(mockApi.callsOf("post", /\/apply$/)).toHaveLength(0);
  });

  it("stops polling the moment Discard is pressed, before the server answers", async () => {
    prime();
    mockApi.on("upload", "/admin/extensions/install", installRow("verifying"));
    mockApi.on("get", "/admin/extensions/install/i1", installRow("verifying"));
    const del = deferred();
    mockApi.on("delete", "/admin/extensions/install/i1", () => del.promise);
    const { container, user } = renderPage("/admin/extensions");
    await screen.findByText("Install from file…", { selector: "button" });

    pickBundle(container);
    const dlg = await screen.findByRole("dialog");
    await within(dlg).findByText("verifying");
    const polled = mockApi.callsOf("get", "/admin/extensions/install/i1").length;
    await user.click(within(dlg).getByRole("button", { name: "Discard" }));
    await advance(2500);
    expect(mockApi.callsOf("get", "/admin/extensions/install/i1")).toHaveLength(polled);

    await act(async () => del.resolve(undefined));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("a status answer landing during the discard does not bring the run back", async () => {
    prime();
    mockApi.on("upload", "/admin/extensions/install", installRow("verifying"));
    const firstPoll = deferred();
    let polls = 0;
    mockApi.on("get", "/admin/extensions/install/i1", () => {
      polls += 1;
      return polls === 1 ? firstPoll.promise : installRow("verifying");
    });
    const del = deferred();
    mockApi.on("delete", "/admin/extensions/install/i1", () => del.promise);
    const { container, user } = renderPage("/admin/extensions");
    await screen.findByText("Install from file…", { selector: "button" });

    pickBundle(container);
    const dlg = await screen.findByRole("dialog");
    await within(dlg).findByText("verifying");
    await advance(2000);
    await waitFor(() => expect(polls).toBe(1));
    await user.click(within(dlg).getByRole("button", { name: "Discard" }));

    // The in-flight status answer lands first, then the DELETE: no timer runs between them.
    await act(async () => {
      firstPoll.resolve(installRow("verifying"));
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
      del.resolve(undefined);
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await advance(2500);
    expect(polls).toBe(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Installed tab actions in flight
// ---------------------------------------------------------------------------

describe("ExtensionsAdmin part 2 — installed tab actions", () => {
  const toggle = () => screen.getByRole("checkbox", { name: "Toggle extension" });

  it("holds the switch while a toggle is saved, then releases it and drops the capability cache", async () => {
    prime();
    const put = deferred();
    mockApi.on("put", "/admin/extensions/sample-ext/enabled", () => put.promise);
    const { user } = renderPage();

    await user.click(await screen.findByRole("checkbox", { name: "Toggle extension" }));
    await waitFor(() => expect(toggle()).toBeDisabled());
    expect(invalidateCaps).not.toHaveBeenCalled();
    await act(async () => put.resolve({}));
    await waitFor(() => expect(toggle()).toBeEnabled());
    expect(invalidateCaps).toHaveBeenCalledTimes(1);
  });

  it("holds the uninstall confirmation while it runs and closes it whatever the outcome", async () => {
    prime();
    const first = deferred();
    mockApi.on("delete", "/admin/extensions/sample-ext", () => first.promise);
    const { user } = renderPage();

    await user.click(await screen.findByRole("button", { name: /Uninstall/ }));
    let dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Uninstall" }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Uninstall" })).toBeDisabled());

    await act(async () => first.reject(new ApiError("Uninstall refused", 500, null)));
    expect(await screen.findByText("Uninstall refused")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(invalidateCaps).not.toHaveBeenCalled();

    mockApi.on("delete", "/admin/extensions/sample-ext", undefined);
    await user.click(screen.getByRole("button", { name: /Uninstall/ }));
    dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Uninstall" });
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() => expect(invalidateCaps).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("holds the license removal while it runs and lets it be retried after a failure", async () => {
    prime();
    const first = deferred();
    mockApi.on("delete", "/admin/extensions/license", () => first.promise);
    const { user } = renderPage();

    await user.click(await screen.findByRole("button", { name: "Remove license" }));
    let dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Remove license$/ }));
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: /Remove license$/ })).toBeDisabled(),
    );
    await act(async () => first.reject(new ApiError("Removal refused", 500, null)));
    expect(await screen.findByText("Removal refused")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(invalidateCaps).not.toHaveBeenCalled();

    mockApi.on("delete", "/admin/extensions/license", undefined);
    await user.click(screen.getByRole("button", { name: "Remove license" }));
    dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: /Remove license$/ });
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() => expect(invalidateCaps).toHaveBeenCalledTimes(1));
  });

  it("holds Renew while the store is asked and releases it afterwards", async () => {
    prime({ extensions: [{ ...EXT, entitlement: { ...EXT.entitlement, state: "expired" } }] });
    const post = deferred();
    mockApi.on("post", "/admin/extensions/store/refresh-license", () => post.promise);
    const { user } = renderPage();
    const renew = () => screen.getByRole("button", { name: /Renew/ });

    await user.click(await screen.findByRole("button", { name: /Renew/ }));
    await waitFor(() => expect(renew()).toBeDisabled());
    await act(async () => post.resolve({ refreshed: true }));
    expect(await screen.findByText("License refreshed from the store.")).toBeInTheDocument();
    await waitFor(() => expect(renew()).toBeEnabled());
  });

  it("holds Manage subscription while the portal link is fetched, then opens it in a new tab", async () => {
    prime({ license: { ...LICENSE, store_managed: true } });
    const post = deferred();
    mockApi.on("post", "/admin/extensions/store/billing-portal", () => post.promise);
    const open = installWindowOpen();
    const { user } = renderPage();
    const manage = () => screen.getByRole("button", { name: /Manage subscription/ });

    await user.click(await screen.findByRole("button", { name: /Manage subscription/ }));
    await waitFor(() => expect(manage()).toBeDisabled());
    await act(async () => post.resolve({ url: "https://billing.test/session" }));
    await waitFor(() => expect(manage()).toBeEnabled());
    expect(open).toHaveBeenCalledWith("https://billing.test/session", "_blank", "noopener");
  });
});

// ---------------------------------------------------------------------------
// Localisation: every string on these surfaces comes from the locale files.
// Spanish, because every one of these keys reads differently there — in
// English the inline defaults repeat the en.json text word for word, so only
// another locale can tell a translated string from a hard-coded one.
// ---------------------------------------------------------------------------

describe("ExtensionsAdmin part 2 — Spanish locale", () => {
  beforeEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("es");
    });
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("translates the page chrome", async () => {
    prime({
      instanceId: INSTANCE,
      extensions: [EXT, { ...EXT, key: "code-ext", name: "Code Extension", status: "needs_restart" }],
    });
    renderPage();
    await screen.findByText("Code Extension");

    expect(screen.getByRole("heading", { name: "Extensiones" })).toBeInTheDocument();
    expect(screen.getByText(`ID de instancia: ${INSTANCE}`)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/La identidad de licencia de esta instancia/),
    ).toBeInTheDocument();
    expect(screen.getByText(/sin cambiar el núcleo/)).toBeInTheDocument();
    expect(screen.getByText(/Las extensiones las desarrolla y firma Turbo EA/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Más información aquí" })).toBeInTheDocument();
    expect(screen.getByText(/Reinicie el contenedor del backend/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Tienda" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Instaladas" })).toBeInTheDocument();
  });

  it.each([
    ["an unconfigured store", OFFLINE_CATALOG, /No hay ninguna tienda de extensiones configurada/],
    [
      "a refused request",
      { ...OFFLINE_CATALOG, configured: true, reason: "blocked", status_code: 403 },
      /rechazó la solicitud de esta instancia \(HTTP 403\)/,
    ],
    [
      "an offline store",
      { ...OFFLINE_CATALOG, configured: true, reason: "offline" },
      /No se pudo acceder a la tienda de extensiones/,
    ],
    ["an empty catalogue", catalogOf([]), /Aún no se han publicado extensiones/],
  ])("translates the notice for %s", async (_label, catalog, text) => {
    prime({ license: null, catalog });
    renderPage("/admin/extensions");
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it("translates the install dialog from upload to installed", async () => {
    prime();
    const upload = deferred();
    mockApi.on("upload", "/admin/extensions/install", () => upload.promise);
    let current: unknown = installRow("previewed", { diff: PREVIEW_DIFF });
    mockApi.on("get", "/admin/extensions/install/i1", () => current);
    mockApi.on("post", "/admin/extensions/install/i1/apply", () => {
      current = installRow("installed", { diff: PREVIEW_DIFF });
      return installRow("applying", { diff: PREVIEW_DIFF });
    });
    const { container, user } = renderPage("/admin/extensions");
    await screen.findByText("Instalar desde archivo…", { selector: "button" });

    pickBundle(container);
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByText(/Suba un paquete \.teax firmado/)).toBeInTheDocument();

    await act(async () => upload.resolve(installRow("verifying")));
    await advance(2000);
    const apply = await within(dlg).findByText("Instalar extensión", { selector: "button" });
    expect(within(dlg).getByText(/^Vista previa del contenido/).textContent).toBe(
      "Vista previa del contenido — Creados: 2, Actualizados: 3, Omitidos: 4, Fallidos: 1",
    );
    expect(within(dlg).getByText("2 creado(s)")).toBeInTheDocument();
    expect(within(dlg).getByText("3 actualizado(s)")).toBeInTheDocument();
    expect(within(dlg).getByText("4 omitido(s)")).toBeInTheDocument();

    await user.click(apply);
    await advance(2000);
    expect(await within(dlg).findByText("Extensión instalada.")).toBeInTheDocument();
  });

  it("translates the notices of the license actions", async () => {
    prime({
      extensions: [{ ...EXT, entitlement: { ...EXT.entitlement, state: "expired" } }],
      license: { ...LICENSE, store_managed: true },
    });
    mockApi.fail("post", "/admin/extensions/store/billing-portal", 502);
    mockApi.on("post", "/admin/extensions/store/refresh-license", { refreshed: false });
    mockApi.on("delete", "/admin/extensions/license", undefined);
    const { user } = renderPage();

    await user.click(await screen.findByRole("button", { name: /Gestionar suscripción/ }));
    expect(
      await screen.findByText(/No se pudo contactar con la tienda de extensiones/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Renovar/ }));
    expect(
      await screen.findByText(/La tienda no tiene una licencia más reciente/),
    ).toBeInTheDocument();
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    mockApi.on("post", "/admin/extensions/store/refresh-license", { refreshed: true });
    await user.click(screen.getByRole("button", { name: /Renovar/ }));
    expect(await screen.findByText("Licencia actualizada desde la tienda.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Eliminar licencia" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: /Eliminar licencia$/ }),
    );
    expect(await screen.findByText(/Licencia eliminada\./)).toBeInTheDocument();
  });
});
