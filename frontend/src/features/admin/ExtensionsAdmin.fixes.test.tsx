/**
 * ExtensionsAdmin, regression tests for bugs the mutation pass surfaced:
 *
 * - a purchase confirmed by the claim poll closes the license dialog without
 *   leaving the earlier paste or its error for the next opening;
 * - a status reply that lands after Discard finished does not bring the run
 *   back;
 * - "Apply anyway" cannot submit an empty license while its dialog fades out;
 * - the update and downgrade confirmations keep their text through the exit,
 *   and an update without an extension key is named by its bundle;
 * - the intro describes the Store as well as the file-based flow, in every
 *   locale.
 *
 * Same harness as the part-1 mutation tests: fake `setTimeout`s walked
 * explicitly, the mocked API drained through the real `setImmediate`.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
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
import i18n from "@/i18n";
import { resetPageTitle } from "@/hooks/usePageTitle";
import { resetExtensionHost } from "@/lib/extensionHost";
import { mockApi } from "@/test/apiMock";

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

const OFFLINE_CATALOG = { configured: false, reachable: false, store_url: "", items: [] };

const STORE_ITEM = {
  key: "esg-pack",
  name: "ESG Content Pack",
  description: "Adds ESG capabilities.",
  price: "990 EUR / year",
  payment_link: "https://buy.stripe.test/pl_1",
  version: "1.0.0",
  installed_version: null as string | null,
  update_available: false,
  entitlement_state: "unlicensed",
};

const UPDATE_ITEM = {
  ...STORE_ITEM,
  entitlement_state: "active",
  installed_version: "1.0.0",
  update_available: true,
  version: "1.1.0",
};

const ZERO_TOTALS = { created: 0, updated: 0, skipped: 0, conflict: 0, failed: 0 };

const BUNDLE_NOTES = {
  version: "1.1.0",
  from_version: "1.0.0",
  notes: "## 1.1.0\n\n### Fixed\n- The outbox no longer drains into nothing.",
  source: "bundle",
};

const CLAIM_PATH = "/admin/extensions/store/claim";
const LICENSE_PATH = "/admin/extensions/license";

function catalogOf(...items: unknown[]) {
  return { configured: true, reachable: true, store_url: "", items };
}

function prime({
  extensions = [EXT] as unknown[],
  license = LICENSE as unknown,
  catalog = OFFLINE_CATALOG as unknown,
} = {}) {
  mockApi.on("get", "/admin/extensions", () => extensions);
  if (license) mockApi.on("get", LICENSE_PATH, license);
  else mockApi.fail("get", LICENSE_PATH, 404, "No license installed");
  mockApi.on("get", "/admin/extensions/store/catalog", catalog);
  mockApi.on("get", "/admin/extensions/instance", { instance_id: "" });
  mockApi.fail("get", "/settings/extension-store-status", 403);
  mockApi.fail("get", "/settings/date-format", 404);
}

function renderPage(path = "/admin/extensions") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ExtensionsAdmin />
    </MemoryRouter>,
  );
}

const click = (el: Element) => fireEvent.click(el);
const licenseBox = () => screen.getByPlaceholderText("Paste license text here…");
const typeLicense = (text: string) => fireEvent.change(licenseBox(), { target: { value: text } });

async function settle() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
  }
}

async function tick(ms: number) {
  await settle();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await settle();
}

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const dialogTitled = (title: string | RegExp) =>
  screen.getByText(title).closest("[role=dialog]") as HTMLElement;
const tileOf = (name: string) => screen.getByText(name).closest(".MuiCard-root") as HTMLElement;
const tab = (name: string) => screen.getByRole("tab", { name });

beforeEach(() => {
  mockApi.reset();
  localStorage.clear();
  resetExtensionHost();
  resetPageTitle();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
});

afterEach(() => {
  if (vi.isFakeTimers()) vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetExtensionHost();
});

// ── License dialog after a confirmed purchase ──────────────────────────────

describe("ExtensionsAdmin — license dialog after a confirmed purchase", () => {
  const EXPIRED = { ...EXT, entitlement: { ...EXT.entitlement, state: "expired" } };

  /** Buy from a tile, then fail a paste in "Enter license…" while the claim is polled. */
  async function failPasteWhileClaiming() {
    vi.spyOn(window, "open").mockReturnValue(null);
    prime({ extensions: [EXPIRED], catalog: catalogOf(STORE_ITEM) });
    mockApi.on("put", LICENSE_PATH, () => {
      throw new ApiError("License signature invalid", 400, "bad");
    });
    mockApi.on("post", CLAIM_PATH, { status: "applied" });
    mockApi.on("post", "/admin/extensions/store/refresh-license", { refreshed: false });
    renderPage();
    await settle();

    click(within(tileOf("ESG Content Pack")).getByText("Buy", { selector: "button" }));
    click(tab("Installed"));
    await settle();
    click(screen.getByRole("button", { name: /Enter license/ }));
    const dialog = screen.getByRole("dialog");
    typeLicense("garbage");
    click(within(dialog).getByText("Apply license", { selector: "button" }));
    await settle();
    expect(within(dialog).getByText("License signature invalid")).toBeInTheDocument();

    // The purchase lands: the dialog closes.
    await tick(5000);
    expect(screen.getByText("Purchase confirmed — license applied.")).toBeInTheDocument();
    await tick(500);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  }

  it("reopens 'Enter license…' empty, without the earlier paste's error", async () => {
    await failPasteWhileClaiming();

    click(screen.getByRole("button", { name: /Enter license/ }));
    const dialog = screen.getByRole("dialog");
    expect(licenseBox()).toHaveValue("");
    expect(within(dialog).queryByText("License signature invalid")).not.toBeInTheDocument();
    expect(within(dialog).getByText("Apply license", { selector: "button" })).toBeDisabled();
  });

  it("drops the paste's error as the purchase closes the dialog, as Cancel does", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    prime({ extensions: [EXPIRED], catalog: catalogOf(STORE_ITEM) });
    mockApi.on("put", LICENSE_PATH, () => {
      throw new ApiError("License signature invalid", 400, "bad");
    });
    mockApi.on("post", CLAIM_PATH, { status: "applied" });
    renderPage();
    await settle();

    click(within(tileOf("ESG Content Pack")).getByText("Buy", { selector: "button" }));
    click(tab("Installed"));
    await settle();
    click(screen.getByRole("button", { name: /Enter license/ }));
    const dialog = screen.getByRole("dialog");
    typeLicense("garbage");
    click(within(dialog).getByText("Apply license", { selector: "button" }));
    await settle();
    expect(within(dialog).getByText("License signature invalid")).toBeInTheDocument();

    await tick(5000);
    expect(screen.getByText("Purchase confirmed — license applied.")).toBeInTheDocument();
    // Still fading out, already without the failed paste's error.
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).queryByText("License signature invalid")).not.toBeInTheDocument();
    await tick(500);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the Renew fallback empty, without the earlier paste's error", async () => {
    await failPasteWhileClaiming();

    click(screen.getByText("Renew", { selector: "button" }));
    await settle();
    expect(screen.getByText(/The store has no newer license/)).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(licenseBox()).toHaveValue("");
    expect(within(dialog).queryByText("License signature invalid")).not.toBeInTheDocument();
  });
});

// ── A paste that fails after Cancel ────────────────────────────────────────

describe("ExtensionsAdmin — a paste that fails after the dialog was cancelled", () => {
  it("does not greet the next opening with that paste's error", async () => {
    const EXPIRED = { ...EXT, entitlement: { ...EXT.entitlement, state: "expired" } };
    prime({ extensions: [EXPIRED] });
    let rejectPut!: (err: unknown) => void;
    mockApi.on(
      "put",
      LICENSE_PATH,
      () =>
        new Promise((_, reject) => {
          rejectPut = reject;
        }),
    );
    renderPage();
    await settle();
    click(tab("Installed"));
    await settle();

    click(screen.getByRole("button", { name: /Enter license/ }));
    let dialog = screen.getByRole("dialog");
    typeLicense("garbage");
    click(within(dialog).getByText("Apply license", { selector: "button" }));
    await settle();
    click(within(dialog).getByText("Cancel", { selector: "button" }));
    // The PUT only fails now, with the dialog already closing.
    await act(async () => rejectPut(new ApiError("License signature invalid", 400, "bad")));
    await tick(500);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    click(screen.getByRole("button", { name: /Enter license/ }));
    dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByText("License signature invalid")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });
});

// ── A purchase confirmed while the apply gate is open ──────────────────────

describe("ExtensionsAdmin — a purchase confirmed over the apply gate", () => {
  it("retries the refused apply, and leaves no gate behind for the next license dialog", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    prime({ catalog: catalogOf(STORE_ITEM) });
    let paid = false;
    mockApi.on("post", CLAIM_PATH, () => ({ status: paid ? "applied" : "pending" }));
    mockApi.on("upload", "/admin/extensions/install", {
      id: "i1",
      filename: "sample.teax",
      status: "verifying",
    });
    let installed = false;
    mockApi.on("get", "/admin/extensions/install/i1", () => ({
      id: "i1",
      filename: "sample.teax",
      status: installed ? "installed" : "previewed",
      extension_key: "sample-ext",
      extension_version: "1.0.0",
      diff: { totals: { ...ZERO_TOTALS, created: 1 } },
    }));
    let applies = 0;
    mockApi.on("post", "/admin/extensions/install/i1/apply", () => {
      applies += 1;
      if (applies === 1) throw new ApiError("Not licensed", 403, null);
      installed = true;
      return { id: "i1", filename: "sample.teax", status: "applying" };
    });
    const { container } = renderPage();
    await settle();

    // A checkout from a tile is still being confirmed…
    click(within(tileOf("ESG Content Pack")).getByText("Buy", { selector: "button" }));
    // …while an uploaded bundle is refused for want of a license.
    fireEvent.change(
      container.querySelector('input[type="file"][accept=".teax,.zip"]') as HTMLInputElement,
      { target: { files: [new File(["zip"], "sample.teax")] } },
    );
    await settle();
    await tick(2000);
    click(screen.getByText("Install extension", { selector: "button" }));
    await settle();
    const gate = dialogTitled("License required");
    expect(within(gate).getByText(/needs a license to finish installing/)).toBeInTheDocument();

    // The purchase lands: the refused apply continues, as a pasted license would.
    paid = true;
    await tick(5000);
    expect(screen.getByText("Purchase confirmed — license applied.")).toBeInTheDocument();
    expect(mockApi.callsOf("post", "/admin/extensions/install/i1/apply")).toHaveLength(2);
    await tick(2000);
    expect(screen.queryByText(/needs a license to finish installing/)).not.toBeInTheDocument();
    click(screen.getByText("Close", { selector: "button" }));
    await tick(500);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // The next license dialog is a plain one, not the apply gate.
    click(tab("Installed"));
    await settle();
    click(screen.getByRole("button", { name: /Enter license/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Apply a license")).toBeInTheDocument();
    expect(within(dialog).queryByText(/needs a license to finish installing/)).not.toBeInTheDocument();
    mockApi.on("put", LICENSE_PATH, {});
    typeLicense("another-license");
    click(within(dialog).getByText("Apply license", { selector: "button" }));
    await settle();
    expect(mockApi.callsOf("post", "/admin/extensions/install/i1/apply")).toHaveLength(2);
  });
});

// ── Discard racing a status reply ──────────────────────────────────────────

describe("ExtensionsAdmin — a status reply after Discard", () => {
  it("does not reopen the dialog or resume polling a discarded install", async () => {
    prime();
    mockApi.on("upload", "/admin/extensions/install", {
      id: "i1",
      filename: "slow.teax",
      status: "verifying",
    });
    const firstPoll = deferred();
    let polls = 0;
    mockApi.on("get", "/admin/extensions/install/i1", () => {
      polls += 1;
      return polls === 1
        ? firstPoll.promise
        : { id: "i1", filename: "slow.teax", status: "verifying" };
    });
    mockApi.on("delete", "/admin/extensions/install/i1", undefined);
    const { container } = renderPage();
    await settle();
    fireEvent.change(
      container.querySelector('input[type="file"][accept=".teax,.zip"]') as HTMLInputElement,
      { target: { files: [new File(["zip"], "slow.teax")] } },
    );
    await settle();
    // The first status request is now in flight.
    await tick(2000);
    expect(polls).toBe(1);

    click(within(screen.getByRole("dialog")).getByText("Discard", { selector: "button" }));
    await tick(500);
    expect(mockApi.callsOf("delete", "/admin/extensions/install/i1")).toHaveLength(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // …and only now does the status reply arrive.
    await act(async () =>
      firstPoll.resolve({
        id: "i1",
        filename: "slow.teax",
        status: "previewed",
        extension_key: "sample-ext",
        diff: { totals: { ...ZERO_TOTALS, created: 1 } },
      }),
    );
    await tick(500);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await tick(10_000);
    expect(polls).toBe(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("ExtensionsAdmin — a failed status reply after Discard", () => {
  it("does not reopen the dialog with its error", async () => {
    prime();
    mockApi.on("upload", "/admin/extensions/install", {
      id: "i1",
      filename: "slow.teax",
      status: "verifying",
    });
    let fail!: (e: unknown) => void;
    mockApi.on(
      "get",
      "/admin/extensions/install/i1",
      () => new Promise((_resolve, reject) => (fail = reject)),
    );
    mockApi.on("delete", "/admin/extensions/install/i1", undefined);
    const { container } = renderPage();
    await settle();
    fireEvent.change(
      container.querySelector('input[type="file"][accept=".teax,.zip"]') as HTMLInputElement,
      { target: { files: [new File(["zip"], "slow.teax")] } },
    );
    await settle();
    await tick(2000);

    click(within(screen.getByRole("dialog")).getByText("Discard", { selector: "button" }));
    await tick(500);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await act(async () => fail(new Error("GET /admin/extensions/install/i1 failed")));
    await tick(500);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("GET /admin/extensions/install/i1 failed")).not.toBeInTheDocument();
  });
});

// ── Entitlement downgrade while the dialog fades out ───────────────────────

describe("ExtensionsAdmin — entitlement downgrade confirmation", () => {
  it("cannot submit an empty license while the confirmation fades out", async () => {
    prime();
    mockApi.on("put", LICENSE_PATH, (_path, body) => {
      if (!(body as { confirm: boolean }).confirm) {
        throw new ApiError("Conflict", 409, {
          code: "entitlement_downgrade",
          dropped: ["sample-ext"],
        });
      }
      return {};
    });
    renderPage("/admin/extensions?tab=installed");
    await settle();

    click(screen.getByRole("button", { name: /Enter license/ }));
    typeLicense("narrower-license");
    click(within(screen.getByRole("dialog")).getByText("Apply license", { selector: "button" }));
    await settle();
    const confirm = dialogTitled("This license drops active entitlements");
    const applyAnyway = within(confirm).getByText("Apply anyway", { selector: "button" });

    click(applyAnyway);
    // The confirmed PUT answers while the dialog is still on its way out.
    await settle();
    expect(applyAnyway).toBeDisabled();
    click(applyAnyway);
    await settle();

    expect(mockApi.callsOf("put", LICENSE_PATH).map((c) => c.body)).toEqual([
      { text: "narrower-license", confirm: false },
      { text: "narrower-license", confirm: true },
    ]);
  });

  for (const action of ["Cancel", "Apply anyway"]) {
    it(`keeps the dropped extensions listed while the confirmation closes on ${action}`, async () => {
      prime();
      mockApi.on("put", LICENSE_PATH, (_path, body) => {
        if (!(body as { confirm: boolean }).confirm) {
          throw new ApiError("Conflict", 409, {
            code: "entitlement_downgrade",
            dropped: ["sample-ext", "gone-ext"],
          });
        }
        return {};
      });
      renderPage("/admin/extensions?tab=installed");
      await settle();

      click(screen.getByRole("button", { name: /Enter license/ }));
      typeLicense("narrower-license");
      click(within(screen.getByRole("dialog")).getByText("Apply license", { selector: "button" }));
      await settle();
      const confirm = dialogTitled("This license drops active entitlements");
      expect(within(confirm).getByText("Sample Extension")).toBeInTheDocument();
      expect(within(confirm).getByText("gone-ext")).toBeInTheDocument();

      click(within(confirm).getByText(action, { selector: "button" }));
      await settle();
      // Still fading out: the same list, not an empty one.
      expect(within(confirm).getByText("Sample Extension")).toBeInTheDocument();
      expect(within(confirm).getByText("gone-ext")).toBeInTheDocument();
      await tick(500);
      expect(screen.queryByText("This license drops active entitlements")).not.toBeInTheDocument();
    });
  }
});

// ── Update and downgrade confirmations ─────────────────────────────────────

describe("ExtensionsAdmin — update and downgrade confirmations", () => {
  function primeUpdate(preview: Record<string, unknown>) {
    prime({ catalog: catalogOf(UPDATE_ITEM) });
    mockApi.on("post", "/admin/extensions/store/install", {
      id: "s1",
      filename: "esg.teax",
      status: "verifying",
    });
    mockApi.on("get", "/admin/extensions/install/s1", {
      id: "s1",
      filename: "esg.teax",
      status: "previewed",
      ...preview,
    });
    mockApi.on("delete", "/admin/extensions/install/s1", undefined);
    mockApi.on("post", "/admin/extensions/install/s1/apply", {
      id: "s1",
      filename: "esg.teax",
      status: "applying",
    });
    mockApi.on("get", /^\/admin\/extensions\/store\/changelog\//, {
      version: "1.1.0",
      from_version: "1.0.0",
      notes: "",
      source: "none",
    });
  }

  async function startUpdate() {
    renderPage();
    await settle();
    click(screen.getByText("Update to 1.1.0", { selector: "button" }));
    await settle();
    await tick(2000);
  }

  it("keeps the update title and notes while the confirmation closes on Cancel", async () => {
    primeUpdate({ extension_key: "esg-pack", diff: { changelog: BUNDLE_NOTES } });
    await startUpdate();
    const confirm = dialogTitled("Update ESG Content Pack to 1.1.0?");

    click(within(confirm).getByText("Cancel", { selector: "button" }));
    await settle();
    // Still fading out: the same title and notes, never "Update  to ?".
    expect(within(confirm).getByText("Update ESG Content Pack to 1.1.0?")).toBeInTheDocument();
    expect(within(confirm).getByText(/outbox no longer drains/)).toBeInTheDocument();
    expect(screen.queryByText(/^Update\s+to\s*\?$/)).not.toBeInTheDocument();
    await tick(500);
    expect(screen.queryByText("Update ESG Content Pack to 1.1.0?")).not.toBeInTheDocument();
  });

  it("keeps the update title while the confirmation closes on Install", async () => {
    primeUpdate({ extension_key: "esg-pack", diff: { changelog: BUNDLE_NOTES } });
    await startUpdate();
    const confirm = dialogTitled("Update ESG Content Pack to 1.1.0?");

    click(within(confirm).getByText("Install", { selector: "button" }));
    await settle();
    expect(within(confirm).getByText("Update ESG Content Pack to 1.1.0?")).toBeInTheDocument();
    expect(mockApi.callsOf("post", "/admin/extensions/install/s1/apply")).toHaveLength(1);
  });

  it("names an update without an extension key by its bundle", async () => {
    primeUpdate({ diff: { changelog: { ...BUNDLE_NOTES, notes: "" } } });
    await startUpdate();
    const confirm = dialogTitled("Update esg.teax to 1.1.0?");
    expect(within(confirm).getByText("esg.teax 1.0.0 → 1.1.0")).toBeInTheDocument();
    // Nothing to ask the store about without a key.
    expect(mockApi.callsOf("get", /store\/changelog/)).toHaveLength(0);
  });

  it("keeps the downgrade versions while the confirmation closes", async () => {
    prime({ catalog: catalogOf({ ...STORE_ITEM, entitlement_state: "active" }) });
    mockApi.on("post", "/admin/extensions/store/install", {
      id: "s1",
      filename: "esg.teax",
      status: "verifying",
    });
    mockApi.on("get", "/admin/extensions/install/s1", {
      id: "s1",
      filename: "esg.teax",
      status: "previewed",
      diff: { downgrade: { from: "2.0.0", to: "1.0.0" }, totals: ZERO_TOTALS },
    });
    renderPage();
    await settle();
    click(screen.getByText("Install", { selector: "button" }));
    await settle();
    await tick(2000);
    const confirm = dialogTitled("Install an older version?");

    click(within(confirm).getByText("Cancel", { selector: "button" }));
    await settle();
    expect(
      within(confirm).getByText(/install version 1\.0\.0 over the currently installed 2\.0\.0/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/install version\s+over/)).not.toBeInTheDocument();
  });
});

// ── Intro ──────────────────────────────────────────────────────────────────

describe("ExtensionsAdmin — intro", () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("describes one-click Store installs alongside the file-based flow", async () => {
    prime();
    renderPage();
    await settle();
    expect(
      screen.getByText(
        "Add customer-specific capabilities without changing the core. Install vendor-signed extensions one click at a time from the built-in Store, or upload the extension and license files directly — the file-based flow needs no connection to the Store, so everything still works on air-gapped instances.",
      ),
    ).toBeInTheDocument();
  });

  it("says the same in another locale", async () => {
    await act(async () => {
      await i18n.changeLanguage("es");
    });
    prime();
    renderPage();
    await settle();
    expect(screen.getByText(/Tienda integrada/)).toBeInTheDocument();
    expect(screen.queryByText(/se entregan como archivos/)).not.toBeInTheDocument();
  });
});
