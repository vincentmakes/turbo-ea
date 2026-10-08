/**
 * ExtensionsAdmin — the page's state machine, pinned tightly enough that a
 * changed condition or a dropped reset is noticed (lines 1–640 of the page:
 * tab routing, the tag filter, loading, the install pipeline's poll, the update
 * confirmation, the license dialog and the purchase-claim poll).
 *
 * The install pipeline polls every 2s and the claim poll every 5s, so every
 * test here runs on fake `setTimeout`s and walks the clock explicitly — no
 * `findBy` / `waitFor`, which would poll on the faked clock. `settle()` drains
 * the mocked API's promise chains through the real `setImmediate`.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, useLocation, useNavigate, useNavigationType } from "react-router";
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
import { invalidateCache as invalidateMetamodel } from "@/hooks/useMetamodel";
import { resetPageTitle, usePageTitleSlots } from "@/hooks/usePageTitle";
import { resetExtensionHost } from "@/lib/extensionHost";
import { mockApi } from "@/test/apiMock";

// ── Fixtures ────────────────────────────────────────────────────────────────

const EXT = {
  key: "sample-ext",
  name: "Sample Extension",
  version: "1.0.0",
  status: "installed",
  enabled: true,
  capabilities: ["content"],
  entitlement: { state: "active", plan: "enterprise", expires_at: null, grace_until: null },
};

const OTHER_EXT = { ...EXT, key: "other-ext", name: "Other Extension" };

const LICENSE = {
  licensee: "ACME Corp",
  customer_id: "cus_1",
  grace_days: 30,
  entitlements: [{ extension_key: "sample-ext", plan: "enterprise", expires_at: null }],
  uploaded_at: "2026-07-01T00:00:00Z",
};

const OFFLINE_CATALOG = { configured: false, reachable: false, store_url: "", items: [] };

/** Unlicensed, paid, no trial: the tile offers Buy and Install. */
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

const ACTIVE_ITEM = { ...STORE_ITEM, entitlement_state: "active" };

const UPDATE_ITEM = {
  ...STORE_ITEM,
  entitlement_state: "active",
  installed_version: "1.0.0",
  update_available: true,
  version: "1.1.0",
};

function catalogOf(...items: unknown[]) {
  // An empty store_url keeps checkout on the static payment link.
  return { configured: true, reachable: true, store_url: "", items };
}

const ZERO_TOTALS = { created: 0, updated: 0, skipped: 0, conflict: 0, failed: 0 };

const BUNDLE_NOTES = {
  version: "1.1.0",
  from_version: "1.0.0",
  notes: "## 1.1.0\n\n### Fixed\n- The outbox no longer drains into nothing.",
  source: "bundle",
};

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
  mockApi.fail("get", "/settings/date-format", 404);
}

// ── Harness ─────────────────────────────────────────────────────────────────

/** Where the router is, how it got there, and the page's published tab. */
function Probe() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();
  const { section } = usePageTitleSlots();
  return (
    <>
      <span data-testid="search">{location.search}</span>
      <span data-testid="nav-type">{navigationType}</span>
      <span data-testid="section">{section?.text ?? ""}</span>
      <button type="button" onClick={() => navigate("/admin/extensions?tab=installed")}>
        follow a link to the Installed tab
      </button>
    </>
  );
}

function renderPage(path = "/admin/extensions") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ExtensionsAdmin />
      <Probe />
    </MemoryRouter>,
  );
}

/**
 * Synchronous events: user-event's async wrapper waits on a `setTimeout`,
 * which never fires on a clock only the test advances.
 */
const click = (el: Element) => fireEvent.click(el);
const typeLicense = (text: string) =>
  fireEvent.change(screen.getByPlaceholderText("Paste license text here…"), {
    target: { value: text },
  });

/** Drain every pending promise chain (the real `setImmediate` is not faked). */
async function settle() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
  }
}

/** Let pending work land, walk the fake clock, then let what it started finish. */
async function tick(ms: number) {
  await settle();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await settle();
}

/** A promise the test resolves by hand, to hold a request in flight. */
function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const tab = (name: string) => screen.getByRole("tab", { name });
const dialogTitled = (title: string | RegExp) =>
  screen.getByText(title).closest("[role=dialog]") as HTMLElement;
const tileOf = (name: string) => screen.getByText(name).closest(".MuiCard-root") as HTMLElement;
const bundleInput = (container: HTMLElement) =>
  container.querySelector('input[type="file"][accept=".teax,.zip"]') as HTMLInputElement;

/** jsdom's File has no `text()`; the page reads a license file through it. */
function licenseFile(text: string): File {
  const file = new File([text], "acme.tealic");
  Object.defineProperty(file, "text", { value: async () => text });
  return file;
}

beforeEach(() => {
  mockApi.reset();
  localStorage.clear();
  resetExtensionHost();
  resetPageTitle();
  vi.mocked(invalidateExtensionCapabilities).mockClear();
  vi.mocked(invalidateMetamodel).mockClear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
});

afterEach(() => {
  if (vi.isFakeTimers()) vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetExtensionHost();
});

// ── Tabs ────────────────────────────────────────────────────────────────────

describe("ExtensionsAdmin — tabs", () => {
  it("opens on the Store tab by default and names it as the page section", async () => {
    prime();
    renderPage();
    await settle();
    expect(tab("Store")).toHaveAttribute("aria-selected", "true");
    expect(tab("Installed")).toHaveAttribute("aria-selected", "false");
    expect(screen.getByTestId("section")).toHaveTextContent(/^Store$/);
    expect(screen.getByText(/No extension store is configured/)).toBeInTheDocument();
  });

  it("reopens the tab this browser remembers when the URL names none", async () => {
    localStorage.setItem("turboea.extensions.tab", "installed");
    prime();
    renderPage();
    await settle();
    expect(tab("Installed")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Installed extensions")).toBeInTheDocument();
    expect(screen.getByTestId("section")).toHaveTextContent(/^Installed$/);
  });

  it("ignores a remembered value that is not a tab", async () => {
    localStorage.setItem("turboea.extensions.tab", "bogus");
    prime();
    renderPage();
    await settle();
    expect(tab("Store")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("section")).toHaveTextContent(/^Store$/);
  });

  it("switching tabs rewrites the URL in place, the section and the remembered tab", async () => {
    prime();
    renderPage();
    await settle();
    expect(localStorage.getItem("turboea.extensions.tab")).toBe("store");

    click(tab("Installed"));
    await settle();
    expect(tab("Installed")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("search")).toHaveTextContent(/^\?tab=installed$/);
    // replace, not push: tab switches do not pile up in the history.
    expect(screen.getByTestId("nav-type")).toHaveTextContent(/^REPLACE$/);
    expect(screen.getByTestId("section")).toHaveTextContent(/^Installed$/);
    expect(localStorage.getItem("turboea.extensions.tab")).toBe("installed");

    click(tab("Store"));
    await settle();
    expect(tab("Store")).toHaveAttribute("aria-selected", "true");
    // The Store is the default, so it carries no ?tab= at all.
    expect(screen.getByTestId("search")).toBeEmptyDOMElement();
    expect(screen.getByTestId("section")).toHaveTextContent(/^Store$/);
    expect(localStorage.getItem("turboea.extensions.tab")).toBe("store");
  });

  it("follows the URL when it changes after the page has mounted", async () => {
    prime();
    renderPage();
    await settle();
    expect(tab("Store")).toHaveAttribute("aria-selected", "true");

    click(screen.getByRole("button", { name: "follow a link to the Installed tab" }));
    await settle();
    expect(tab("Installed")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Installed extensions")).toBeInTheDocument();
  });
});

// ── First paint and loading ─────────────────────────────────────────────────

describe("ExtensionsAdmin — loading", () => {
  it("paints a progress bar and no instance ID before anything has loaded", () => {
    prime({ instanceId: "TEA-AAAA-BBBB-CCCC" });
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/admin/extensions"]}>
        <ExtensionsAdmin />
      </MemoryRouter>,
    );
    expect(html).toContain('role="progressbar"');
    expect(html).not.toContain("Instance ID");
    expect(html).not.toContain("No extension store is configured");

    // A ?tab= in the URL decides the very first paint, not a later effect.
    const installed = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/admin/extensions?tab=installed"]}>
        <ExtensionsAdmin />
      </MemoryRouter>,
    );
    expect(installed).toContain("Installed extensions");
  });

  it("shows the instance ID with a copy icon until it is copied", async () => {
    prime({ instanceId: "TEA-1234-5678-9ABC" });
    renderPage();
    await settle();
    const chip = screen
      .getByText("Instance ID: TEA-1234-5678-9ABC")
      .closest(".MuiChip-root") as HTMLElement;
    const icon = () => chip.querySelector(".material-symbols-outlined")?.textContent;
    expect(icon()).toBe("content_copy");

    click(chip);
    await settle();
    expect(icon()).toBe("check");
    // …and back to the copy glyph after two seconds.
    await tick(2000);
    expect(icon()).toBe("content_copy");
  });

  it("does not turn a failed instance lookup into a page error", async () => {
    prime();
    mockApi.fail("get", "/admin/extensions/instance", 500);
    renderPage("/admin/extensions?tab=installed");
    await settle();
    expect(screen.getByText("Sample Extension")).toBeInTheDocument();
    expect(screen.queryByText(/Cannot read|instance_id/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Instance ID/)).not.toBeInTheDocument();
  });

  it("clears an earlier load error once a reload succeeds", async () => {
    let failList = true;
    prime();
    mockApi.on("get", "/admin/extensions", () => {
      if (failList) throw new ApiError("Extension list unavailable", 503, null);
      return [EXT];
    });
    mockApi.on("put", "/admin/extensions/license", {});
    renderPage("/admin/extensions?tab=installed");
    await settle();
    expect(screen.getByText("Extension list unavailable")).toBeInTheDocument();

    failList = false;
    click(screen.getByRole("button", { name: /Enter license/ }));
    typeLicense("LICENSE");
    click(screen.getByRole("button", { name: /Apply license/ }));
    await settle();
    expect(screen.queryByText("Extension list unavailable")).not.toBeInTheDocument();
    expect(screen.getByText("Sample Extension")).toBeInTheDocument();
  });
});

// ── Store tags and logos ────────────────────────────────────────────────────

describe("ExtensionsAdmin — store filter", () => {
  const ALPHA = { ...STORE_ITEM, key: "a-ext", name: "Alpha Ext", tags: ["commercial", "zeta"] };
  const BETA = { ...STORE_ITEM, key: "b-ext", name: "Beta Ext", tags: ["free", "beta"] };

  it("orders the model tags first, the rest alphabetically, and toggles each pill", async () => {
    prime({ catalog: catalogOf(ALPHA, BETA) });
    renderPage();
    await settle();
    const bar = screen.getByText("All").closest(".MuiStack-root") as HTMLElement;
    expect(
      Array.from(bar.querySelectorAll(".MuiChip-label")).map((el) => el.textContent),
    ).toEqual(["All", "free", "commercial", "beta", "zeta"]);

    const shown = () =>
      ["Alpha Ext", "Beta Ext"].filter((name) => screen.queryByText(name) !== null);

    click(screen.getByText("zeta"));
    expect(shown()).toEqual(["Alpha Ext"]);
    // A second click deselects it.
    click(screen.getByText("zeta"));
    expect(shown()).toEqual(["Alpha Ext", "Beta Ext"]);

    // Tags AND together…
    click(screen.getByText("free"));
    expect(shown()).toEqual(["Beta Ext"]);
    click(screen.getByText("zeta"));
    expect(shown()).toEqual([]);
    expect(screen.getByText("No extensions match the selected tags.")).toBeInTheDocument();
    // …and deselecting one keeps the other.
    click(screen.getByText("free"));
    expect(shown()).toEqual(["Alpha Ext"]);
  });

  it("shows an installed extension's own logo on its store tile", async () => {
    prime({
      extensions: [
        { ...EXT, key: "esg-pack", name: "ESG Content Pack", logo_url: "/ext-assets/esg-pack/logo.png" },
      ],
      catalog: catalogOf({
        ...STORE_ITEM,
        installed_version: "1.0.0",
        logo: "https://store.test/esg.png",
      }),
    });
    const { container } = renderPage();
    await settle();
    expect(container.querySelector('img[src="/ext-assets/esg-pack/logo.png"]')).not.toBeNull();
    expect(container.querySelector('img[src="https://store.test/esg.png"]')).toBeNull();
  });
});

// ── The install pipeline ────────────────────────────────────────────────────

const PREVIEWED = {
  id: "i1",
  filename: "sample.teax",
  status: "previewed",
  extension_key: "sample-ext",
  extension_version: "1.0.0",
  diff: { totals: { ...ZERO_TOTALS, created: 1 } },
};

/** Upload a bundle through the page's one hidden file input. */
async function uploadBundle(container: HTMLElement, name = "sample.teax") {
  fireEvent.change(bundleInput(container), { target: { files: [new File(["zip"], name)] } });
  await settle();
}

describe("ExtensionsAdmin — install pipeline", () => {
  it("stops polling once a run is discarded", async () => {
    prime();
    mockApi.on("upload", "/admin/extensions/install", { id: "i1", filename: "slow.teax", status: "verifying" });
    mockApi.on("get", "/admin/extensions/install/i1", { id: "i1", filename: "slow.teax", status: "verifying" });
    mockApi.on("delete", "/admin/extensions/install/i1", undefined);
    const { container } = renderPage();
    await settle();
    await uploadBundle(container, "slow.teax");
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("slow.teax")).toBeInTheDocument();

    click(within(dialog).getByText("Discard", { selector: "button" }));
    await tick(500);
    expect(mockApi.callsOf("delete", "/admin/extensions/install/i1")).toHaveLength(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await tick(10_000);
    expect(mockApi.callsOf("get", "/admin/extensions/install/i1")).toHaveLength(0);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stops both polls when the page unmounts", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    prime({ catalog: catalogOf(STORE_ITEM) });
    mockApi.on("post", "/admin/extensions/store/claim", { status: "pending" });
    mockApi.on("upload", "/admin/extensions/install", { id: "i1", filename: "slow.teax", status: "verifying" });
    mockApi.on("get", "/admin/extensions/install/i1", { id: "i1", filename: "slow.teax", status: "verifying" });
    const { container, unmount } = renderPage();
    await settle();
    click(within(tileOf("ESG Content Pack")).getByText("Buy", { selector: "button" }));
    await uploadBundle(container, "slow.teax");
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    unmount();
    await tick(20_000);
    expect(mockApi.callsOf("post", "/admin/extensions/store/claim")).toHaveLength(0);
    expect(mockApi.callsOf("get", "/admin/extensions/install/i1")).toHaveLength(0);
  });

  it("tells a server-side downgrade apart from every other refusal of the apply", async () => {
    prime();
    mockApi.on("upload", "/admin/extensions/install", { id: "i1", filename: "sample.teax", status: "verifying" });
    mockApi.on("get", "/admin/extensions/install/i1", PREVIEWED);
    const refusals: [ApiError, string][] = [
      [new ApiError("Refused: another conflict", 409, { code: "other" }), "Refused: another conflict"],
      [
        new ApiError("Refused: not a conflict", 422, {
          code: "version_downgrade",
          installed: "2.0.0",
          bundle: "1.0.0",
        }),
        "Refused: not a conflict",
      ],
      [new ApiError("Refused: conflict, no detail", 409, undefined), "Refused: conflict, no detail"],
      [new ApiError("Refused: conflict, null detail", 409, null), "Refused: conflict, null detail"],
    ];
    const queue = refusals.map(([error]) => error);
    const success = deferred();
    mockApi.on("post", "/admin/extensions/install/i1/apply", () => {
      const refusal = queue.shift();
      if (refusal) throw refusal;
      return success.promise;
    });
    const { container } = renderPage();
    await settle();
    await uploadBundle(container);
    await tick(2000);

    // A manual upload stops at its preview — nothing applies on its own.
    const dialog = screen.getByRole("dialog");
    const applyButton = () => within(dialog).getByText("Install extension", { selector: "button" });
    expect(applyButton()).toBeEnabled();
    expect(mockApi.callsOf("post", /\/apply$/)).toHaveLength(0);

    for (const [, message] of refusals) {
      click(applyButton());
      await settle();
      expect(within(dialog).getByText(message)).toBeInTheDocument();
      expect(screen.queryByText("Install an older version?")).not.toBeInTheDocument();
    }

    // A fresh attempt clears the last error and holds the button while it runs.
    click(applyButton());
    await settle();
    expect(applyButton()).toBeDisabled();
    expect(within(dialog).queryByText("Refused: conflict, null detail")).not.toBeInTheDocument();

    await act(async () => success.resolve({ id: "i1", filename: "sample.teax", status: "applying" }));
    await settle();
    // The run moves on at once, not at the next poll.
    expect(within(dialog).queryByText("Install extension", { selector: "button" })).not.toBeInTheDocument();
    expect(within(dialog).getByText("applying")).toBeInTheDocument();
  });

  it("retries the apply on its own once the license it was refused for is applied", async () => {
    prime();
    mockApi.on("upload", "/admin/extensions/install", { id: "i1", filename: "sample.teax", status: "verifying" });
    mockApi.on("get", "/admin/extensions/install/i1", PREVIEWED);
    let applies = 0;
    mockApi.on("post", "/admin/extensions/install/i1/apply", () => {
      applies += 1;
      if (applies === 1) throw new ApiError("Not licensed", 403, null);
      return { id: "i1", filename: "sample.teax", status: "applying" };
    });
    mockApi.on("put", "/admin/extensions/license", {});
    const { container } = renderPage();
    await settle();
    await uploadBundle(container);
    await tick(2000);

    click(screen.getByText("Install extension", { selector: "button" }));
    await settle();
    const gate = dialogTitled("License required");
    expect(within(gate).getByText(/verified but needs a license to finish installing/)).toBeInTheDocument();
    typeLicense("LICENSE");
    click(within(gate).getByText("Apply license", { selector: "button" }));
    await settle();
    expect(mockApi.callsOf("post", "/admin/extensions/install/i1/apply")).toHaveLength(2);
  });

  it("walks a one-click store install from the POST through to installed", async () => {
    prime({ catalog: catalogOf(ACTIVE_ITEM) });
    const created = deferred();
    mockApi.on("post", "/admin/extensions/store/install", () => created.promise);
    const statuses = ["verifying", "previewed", "installed"];
    mockApi.on("get", "/admin/extensions/install/s1", () => ({
      id: "s1",
      filename: "esg.teax",
      status: statuses.shift() ?? "installed",
      diff: null,
    }));
    mockApi.on("post", "/admin/extensions/install/s1/apply", {
      id: "s1",
      filename: "esg.teax",
      status: "applying",
    });
    renderPage();
    await settle();

    click(screen.getByText("Install", { selector: "button" }));
    await settle();
    // The dialog is up while the store request is still in flight…
    expect(within(screen.getByRole("dialog")).getByText("Install extension")).toBeInTheDocument();
    expect(mockApi.callsOf("post", "/admin/extensions/store/install")[0].body).toEqual({
      key: "esg-pack",
    });
    // …and shows the run the moment it exists, before the first poll.
    await act(async () => created.resolve({ id: "s1", filename: "esg.teax", status: "verifying" }));
    await settle();
    expect(within(screen.getByRole("dialog")).getByText("esg.teax")).toBeInTheDocument();
    expect(mockApi.callsOf("get", "/admin/extensions/install/s1")).toHaveLength(0);

    await tick(2000); // verifying: keep polling
    expect(mockApi.callsOf("get", "/admin/extensions/install/s1")).toHaveLength(1);
    expect(mockApi.callsOf("post", /\/apply$/)).toHaveLength(0);

    await tick(2000); // previewed with no report at all: applies straight on
    expect(mockApi.callsOf("post", "/admin/extensions/install/s1/apply")).toHaveLength(1);
    expect(screen.queryByText(/Cannot read/)).not.toBeInTheDocument();
    expect(mockApi.callsOf("get", "/admin/extensions")).toHaveLength(1);
    expect(invalidateMetamodel).not.toHaveBeenCalled();
    expect(invalidateExtensionCapabilities).not.toHaveBeenCalled();

    await tick(2000); // installed
    expect(screen.getByText("Extension installed.")).toBeInTheDocument();
    // What an install can change is reloaded.
    expect(mockApi.callsOf("get", "/admin/extensions")).toHaveLength(2);
    expect(invalidateMetamodel).toHaveBeenCalled();
    expect(invalidateExtensionCapabilities).toHaveBeenCalled();
  });

  it("never applies a one-click install whose verification failed", async () => {
    prime({ catalog: catalogOf(ACTIVE_ITEM) });
    mockApi.on("post", "/admin/extensions/store/install", { id: "s1", filename: "esg.teax", status: "verifying" });
    mockApi.on("get", "/admin/extensions/install/s1", {
      id: "s1",
      filename: "esg.teax",
      status: "failed",
      error_message: "Bundle signature verification failed",
    });
    mockApi.on("post", "/admin/extensions/install/s1/apply", {
      id: "s1",
      filename: "esg.teax",
      status: "applying",
    });
    renderPage();
    await settle();
    click(screen.getByText("Install", { selector: "button" }));
    await tick(2000);

    const dialog = dialogTitled("esg.teax");
    expect(within(dialog).getByText("Bundle signature verification failed")).toBeInTheDocument();
    await tick(10_000);
    expect(mockApi.callsOf("post", /\/apply$/)).toHaveLength(0);
    expect(within(dialog).getByText("Discard", { selector: "button" })).toBeInTheDocument();
  });

  it("stops a one-click install at a downgrade the preview found, back to manual if declined", async () => {
    prime({ catalog: catalogOf(ACTIVE_ITEM) });
    mockApi.on("post", "/admin/extensions/store/install", { id: "s1", filename: "esg.teax", status: "verifying" });
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
    expect(
      within(confirm).getByText(/install version 1\.0\.0 over the currently installed 2\.0\.0/),
    ).toBeInTheDocument();
    expect(mockApi.callsOf("post", /\/apply$/)).toHaveLength(0);

    click(within(confirm).getByText("Cancel", { selector: "button" }));
    await tick(500);
    const install = dialogTitled("esg.teax");
    expect(within(install).getByText("Install extension", { selector: "button" })).toBeEnabled();
    expect(within(install).getByText("Discard", { selector: "button" })).toBeInTheDocument();
  });

  it("stops a one-click install the server flags as a downgrade, back to manual if declined", async () => {
    prime({ catalog: catalogOf(ACTIVE_ITEM) });
    mockApi.on("post", "/admin/extensions/store/install", { id: "s1", filename: "esg.teax", status: "verifying" });
    mockApi.on("get", "/admin/extensions/install/s1", {
      id: "s1",
      filename: "esg.teax",
      status: "previewed",
      diff: { totals: ZERO_TOTALS },
    });
    mockApi.fail("post", "/admin/extensions/install/s1/apply", 409, { code: "version_downgrade" });
    renderPage();
    await settle();
    click(screen.getByText("Install", { selector: "button" }));
    await settle();
    await tick(2000);

    expect(mockApi.callsOf("post", "/admin/extensions/install/s1/apply")).toHaveLength(1);
    const confirm = dialogTitled("Install an older version?");
    // Versions the server did not name read as "?", never as blanks.
    expect(
      within(confirm).getByText(/install version \? over the currently installed \?/),
    ).toBeInTheDocument();

    click(within(confirm).getByText("Cancel", { selector: "button" }));
    await tick(500);
    const install = dialogTitled("esg.teax");
    expect(within(install).getByText("Install extension", { selector: "button" })).toBeEnabled();
    expect(within(install).queryByRole("progressbar")).not.toBeInTheDocument();
  });
});

// ── Update confirmation ─────────────────────────────────────────────────────

describe("ExtensionsAdmin — update confirmation", () => {
  const ALPHA_ITEM = { ...ACTIVE_ITEM, key: "alpha-pack", name: "Alpha Pack" };

  function primeUpdate(preview: () => Record<string, unknown>, extensions: unknown[] = [EXT]) {
    prime({ extensions, catalog: catalogOf(ALPHA_ITEM, UPDATE_ITEM) });
    mockApi.on("post", "/admin/extensions/store/install", { id: "s1", filename: "esg.teax", status: "verifying" });
    mockApi.on("get", "/admin/extensions/install/s1", () => ({
      id: "s1",
      filename: "esg.teax",
      status: "previewed",
      ...preview(),
    }));
    mockApi.on("delete", "/admin/extensions/install/s1", undefined);
  }

  async function startUpdate() {
    click(screen.getByText("Update to 1.1.0", { selector: "button" }));
    await settle();
    await tick(2000);
  }

  it("pauses an update on the bundle's own notes, without asking the store", async () => {
    primeUpdate(() => ({ extension_key: "esg-pack", diff: { changelog: BUNDLE_NOTES } }));
    renderPage();
    await settle();
    await startUpdate();

    const confirm = dialogTitled("Update ESG Content Pack to 1.1.0?");
    expect(within(confirm).getByText(/outbox no longer drains/)).toBeInTheDocument();
    expect(within(confirm).queryByRole("progressbar")).not.toBeInTheDocument();
    expect(mockApi.callsOf("get", /store\/changelog/)).toHaveLength(0);
    expect(mockApi.callsOf("post", /\/apply$/)).toHaveLength(0);
    // Behind it the run is a reviewable preview, not a spinner.
    const install = dialogTitled("esg.teax");
    expect(within(install).getByText("Discard", { selector: "button" })).toBeInTheDocument();
  });

  it("asks the store for notes the bundle lacks, showing progress until they arrive", async () => {
    primeUpdate(() => ({
      extension_key: "esg-pack",
      diff: { changelog: { ...BUNDLE_NOTES, notes: "" } },
    }));
    const notes = deferred();
    mockApi.on("get", /^\/admin\/extensions\/store\/changelog\//, () => notes.promise);
    renderPage();
    await settle();
    await startUpdate();

    const confirm = dialogTitled("Update ESG Content Pack to 1.1.0?");
    expect(within(confirm).getByRole("progressbar")).toBeInTheDocument();
    expect(mockApi.callsOf("get", /store\/changelog/)[0].path).toBe(
      "/admin/extensions/store/changelog/esg-pack?version=1.1.0&from_version=1.0.0",
    );

    await act(async () =>
      notes.resolve({
        version: "1.1.0",
        from_version: "1.0.0",
        notes: "## 1.1.0\n\n- Store-side release notes.",
        source: "store",
      }),
    );
    await settle();
    expect(within(confirm).queryByRole("progressbar")).not.toBeInTheDocument();
    expect(within(confirm).getByText(/Store-side release notes/)).toBeInTheDocument();
  });

  it("a declined update stays declined when its notes arrive late", async () => {
    primeUpdate(() => ({
      extension_key: "esg-pack",
      diff: { changelog: { ...BUNDLE_NOTES, notes: "" } },
    }));
    const notes = deferred();
    mockApi.on("get", /^\/admin\/extensions\/store\/changelog\//, () => notes.promise);
    renderPage();
    await settle();
    await startUpdate();

    const confirm = dialogTitled("Update ESG Content Pack to 1.1.0?");
    click(within(confirm).getByText("Cancel", { selector: "button" }));
    await tick(500);
    expect(mockApi.callsOf("delete", "/admin/extensions/install/s1")).toHaveLength(1);
    expect(screen.queryByText(/^Update .*\?$/)).not.toBeInTheDocument();

    await act(async () =>
      notes.resolve({ version: "1.1.0", from_version: "1.0.0", notes: "## late", source: "store" }),
    );
    await tick(500);
    expect(screen.queryByText(/to 1\.1\.0\?$/)).not.toBeInTheDocument();
    expect(screen.getByText("Extensions")).toBeInTheDocument();
  });

  it("names an update from the catalogue, else the installed list, else its key, else its bundle", async () => {
    let preview: Record<string, unknown> = {};
    primeUpdate(() => preview, [OTHER_EXT, EXT]);
    // An answer with no notes: whatever it says about versions is not used.
    mockApi.on("get", /^\/admin\/extensions\/store\/changelog\//, {
      version: "9.9.9",
      from_version: "1.0.0",
      notes: "",
      source: "none",
    });
    renderPage();
    await settle();

    const cases: [Record<string, unknown>, string][] = [
      [{ extension_key: "sample-ext", diff: { changelog: BUNDLE_NOTES } }, "Update Sample Extension to 1.1.0?"],
      [{ extension_key: "mystery-ext", diff: { changelog: BUNDLE_NOTES } }, "Update mystery-ext to 1.1.0?"],
      [
        { extension_key: "esg-pack", diff: { changelog: { ...BUNDLE_NOTES, notes: "" } } },
        "Update ESG Content Pack to 1.1.0?",
      ],
      // No key at all: named by its bundle, and nothing to ask the store about.
      [{ diff: { changelog: { ...BUNDLE_NOTES, notes: "" } } }, "Update esg.teax to 1.1.0?"],
    ];
    for (const [next, title] of cases) {
      preview = next;
      await startUpdate();
      const confirm = dialogTitled(title);
      click(within(confirm).getByText("Cancel", { selector: "button" }));
      await tick(500);
      expect(screen.queryByText(title)).not.toBeInTheDocument();
    }
    // Only the keyed update without notes asked the store.
    expect(mockApi.callsOf("get", /store\/changelog/).map((c) => c.path)).toEqual([
      "/admin/extensions/store/changelog/esg-pack?version=1.1.0&from_version=1.0.0",
    ]);
  });
});

// ── The license dialog ──────────────────────────────────────────────────────

describe("ExtensionsAdmin — license dialog", () => {
  const LICENSE_PATH = "/admin/extensions/license";
  const openLicenseDialog = () => {
    click(screen.getByRole("button", { name: /Enter license/ }));
    return screen.getByRole("dialog");
  };

  it("Cancel closes the dialog and forgets the draft, the error and the gate", async () => {
    prime();
    mockApi.on("put", LICENSE_PATH, () => {
      throw new ApiError("License signature invalid", 400, "bad");
    });
    renderPage("/admin/extensions?tab=installed");
    await settle();

    let dialog = openLicenseDialog();
    expect(within(dialog).getByText("Apply a license")).toBeInTheDocument();
    typeLicense("draft-license");
    click(within(dialog).getByText("Apply license", { selector: "button" }));
    await settle();
    expect(within(dialog).getByText("License signature invalid")).toBeInTheDocument();

    click(within(dialog).getByText("Cancel", { selector: "button" }));
    await tick(500);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    dialog = openLicenseDialog();
    expect(within(dialog).getByText("Apply a license")).toBeInTheDocument();
    expect(within(dialog).queryByText(/needs a license to finish installing/)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Paste license text here…")).toHaveValue("");
    expect(within(dialog).queryByText("License signature invalid")).not.toBeInTheDocument();
  });

  it("a successful apply closes the dialog, drops the capability cache and leaves it clean", async () => {
    prime();
    const pending = deferred();
    let attempts = 0;
    mockApi.on("put", LICENSE_PATH, () => {
      attempts += 1;
      if (attempts === 1) throw new ApiError("License signature invalid", 400, "bad");
      return pending.promise;
    });
    renderPage("/admin/extensions?tab=installed");
    await settle();

    let dialog = openLicenseDialog();
    typeLicense("signed-license");
    click(within(dialog).getByText("Apply license", { selector: "button" }));
    await settle();
    expect(within(dialog).getByText("License signature invalid")).toBeInTheDocument();

    click(within(dialog).getByText("Apply license", { selector: "button" }));
    await settle();
    // In flight: the last error is gone and nothing can be resubmitted.
    expect(within(dialog).queryByText("License signature invalid")).not.toBeInTheDocument();
    expect(within(dialog).getByText("Apply license", { selector: "button" })).toBeDisabled();
    expect(within(dialog).getByText("Upload license file…", { selector: "button" })).toBeDisabled();
    expect(invalidateExtensionCapabilities).not.toHaveBeenCalled();

    await act(async () => pending.resolve({}));
    await tick(500);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(invalidateExtensionCapabilities).toHaveBeenCalledTimes(1);
    expect(mockApi.callsOf("put", LICENSE_PATH)[1].body).toEqual({
      text: "signed-license",
      confirm: false,
    });

    dialog = openLicenseDialog();
    expect(within(dialog).getByText("Apply a license")).toBeInTheDocument();
    expect(within(dialog).queryByText(/needs a license to finish installing/)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Paste license text here…")).toHaveValue("");
  });

  it("asks for confirmation only on a 409 entitlement_downgrade; every other refusal is an error", async () => {
    prime();
    const refusals = [
      new ApiError("Refused: wrong status", 400, {
        code: "entitlement_downgrade",
        dropped: ["sample-ext"],
      }),
      new ApiError("Refused: another conflict", 409, { code: "instance_mismatch" }),
      new ApiError("Refused: bare conflict", 409, null),
      new ApiError("Refused: drops entitlements", 409, { code: "entitlement_downgrade" }),
    ];
    mockApi.on("put", LICENSE_PATH, () => {
      throw refusals.shift();
    });
    renderPage("/admin/extensions?tab=installed");
    await settle();
    const dialog = openLicenseDialog();
    typeLicense("narrow-license");

    for (const message of [
      "Refused: wrong status",
      "Refused: another conflict",
      "Refused: bare conflict",
    ]) {
      click(within(dialog).getByText("Apply license", { selector: "button" }));
      await settle();
      expect(within(dialog).getByText(message)).toBeInTheDocument();
      expect(screen.queryByText("This license drops active entitlements")).not.toBeInTheDocument();
    }

    click(within(dialog).getByText("Apply license", { selector: "button" }));
    await settle();
    const warning = dialogTitled("This license drops active entitlements");
    // The refusal named no extensions, so there is nothing to list.
    expect(within(warning).queryAllByText("extension_off")).toHaveLength(0);
  });

  it("clears the file picker after reading a license file, and ignores an empty pick", async () => {
    // user-event's upload is what models the picker's value; it needs real timers.
    vi.useRealTimers();
    prime();
    mockApi.on("put", LICENSE_PATH, () => {
      throw new ApiError("License signature invalid", 400, "bad");
    });
    const user = userEvent.setup();
    renderPage("/admin/extensions?tab=installed");
    await screen.findByText("Licensed to ACME Corp");
    await user.click(screen.getByRole("button", { name: /Enter license/ }));
    const dialog = await screen.findByRole("dialog");
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;

    await user.upload(input, licenseFile("LICENSE-TEXT"));
    expect(await within(dialog).findByText("License signature invalid")).toBeInTheDocument();
    expect(mockApi.callsOf("put", LICENSE_PATH)[0].body).toEqual({
      text: "LICENSE-TEXT",
      confirm: false,
    });
    // Cleared, so choosing the same file again still fires a change.
    expect(input.value).toBe("");

    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", onRejection);
    try {
      fireEvent.change(input, { target: { files: [] } });
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      process.off("unhandledRejection", onRejection);
    }
    expect(rejections).toEqual([]);
    expect(mockApi.callsOf("put", LICENSE_PATH)).toHaveLength(1);
  });
});

// ── Purchase claims ─────────────────────────────────────────────────────────

describe("ExtensionsAdmin — purchase claim", () => {
  const CLAIM_PATH = "/admin/extensions/store/claim";

  it("opens the payment link with a URL-safe claim token from the browser's CSPRNG", async () => {
    // 0xFB 0xFF 0xBF encodes to "+/+/" — two characters a URL cannot carry.
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(((array: Uint8Array) => {
      array.forEach((_, i) => {
        array[i] = [0xfb, 0xff, 0xbf][i % 3];
      });
      return array;
    }) as unknown as typeof crypto.getRandomValues);
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    prime({ catalog: catalogOf(STORE_ITEM) });
    mockApi.on("post", CLAIM_PATH, { status: "pending" });
    renderPage();
    await settle();

    click(within(tileOf("ESG Content Pack")).getByText("Buy", { selector: "button" }));
    const token = "-_".repeat(16);
    expect(open).toHaveBeenCalledWith(
      `https://buy.stripe.test/pl_1?client_reference_id=${token}`,
      "_blank",
      "noopener",
    );
    await tick(5000);
    expect(mockApi.callsOf("post", CLAIM_PATH)[0].body).toEqual({ token });
  });

  it("a purchase confirmed from the gate closes it and resumes the install", async () => {
    let paid = false;
    vi.spyOn(window, "open").mockReturnValue(null);
    prime({ catalog: catalogOf(STORE_ITEM) });
    mockApi.on("get", "/admin/extensions/store/catalog", () =>
      catalogOf(paid ? ACTIVE_ITEM : STORE_ITEM),
    );
    mockApi.on("put", "/admin/extensions/license", () => {
      throw new ApiError("License signature invalid", 400, "bad");
    });
    let claims = 0;
    mockApi.on("post", CLAIM_PATH, () => {
      claims += 1;
      if (claims === 1) return { status: "pending" };
      paid = true;
      return { status: "applied" };
    });
    mockApi.on("post", "/admin/extensions/store/install", { id: "s1", filename: "esg.teax", status: "verifying" });
    mockApi.on("get", "/admin/extensions/install/s1", {
      id: "s1",
      filename: "esg.teax",
      status: "previewed",
      diff: { totals: ZERO_TOTALS },
    });
    mockApi.fail("post", "/admin/extensions/install/s1/apply", 403, "unlicensed");
    renderPage();
    await settle();

    click(within(tileOf("ESG Content Pack")).getByText("Install", { selector: "button" }));
    const gate = dialogTitled("License required");
    // A paste that fails first…
    typeLicense("garbage");
    click(within(gate).getByText("Apply license", { selector: "button" }));
    await settle();
    expect(within(gate).getByText("License signature invalid")).toBeInTheDocument();
    // …then a checkout.
    click(within(gate).getByText("Buy — 990 EUR / year", { selector: "button" }));
    expect(within(gate).getByText(/Waiting for payment confirmation/)).toBeInTheDocument();

    await tick(5000);
    expect(claims).toBe(1);
    expect(screen.queryByText("Purchase confirmed — license applied.")).not.toBeInTheDocument();
    expect(within(gate).getByText(/Waiting for payment confirmation/)).toBeInTheDocument();

    await tick(5000);
    expect(claims).toBe(2);
    expect(screen.getByText("Purchase confirmed — license applied.")).toBeInTheDocument();
    expect(mockApi.callsOf("post", "/admin/extensions/store/install").map((c) => c.body)).toEqual([
      { key: "esg-pack" },
    ]);
    await tick(500);
    expect(screen.queryByPlaceholderText("Paste license text here…")).not.toBeInTheDocument();
    expect(screen.queryByText(/Waiting for payment confirmation/)).not.toBeInTheDocument();

    // The resumed install is refused for a license after all: the gate
    // reopens without the earlier paste's error.
    await tick(2000);
    const regate = dialogTitled("License required");
    expect(within(regate).getByText(/verified but needs a license to finish installing/)).toBeInTheDocument();
    expect(within(regate).queryByText("License signature invalid")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Paste license text here…")).toHaveValue("");
  });

  it("a second checkout replaces the first poll; a purchase from a tile installs nothing", async () => {
    const ALPHA = { ...STORE_ITEM, key: "alpha-pack", name: "Alpha Pack", payment_link: "https://buy.stripe.test/alpha" };
    const BETA = { ...STORE_ITEM, key: "beta-pack", name: "Beta Pack", payment_link: "https://buy.stripe.test/beta" };
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    prime({ catalog: catalogOf(ALPHA, BETA) });
    mockApi.on("post", CLAIM_PATH, { status: "applied" });
    renderPage();
    await settle();

    click(within(tileOf("Alpha Pack")).getByText("Buy", { selector: "button" }));
    click(within(tileOf("Beta Pack")).getByText("Buy", { selector: "button" }));
    const betaToken = new URL(open.mock.calls[1][0] as string).searchParams.get(
      "client_reference_id",
    );
    await tick(5000);
    expect(mockApi.callsOf("post", CLAIM_PATH).map((c) => c.body)).toEqual([{ token: betaToken }]);
    expect(screen.getByText("Purchase confirmed — license applied.")).toBeInTheDocument();
    // Bought outside an install, so nothing is waiting to resume.
    expect(mockApi.callsOf("post", "/admin/extensions/store/install")).toHaveLength(0);
    await tick(20_000);
    expect(mockApi.callsOf("post", CLAIM_PATH)).toHaveLength(1);
  });

  it("gives up after 120 unanswered polls and offers Buy again", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    prime({ catalog: catalogOf(STORE_ITEM) });
    mockApi.on("post", CLAIM_PATH, { status: "pending" });
    renderPage();
    await settle();
    const tile = tileOf("ESG Content Pack");
    click(within(tile).getByText("Buy", { selector: "button" }));
    expect(within(tile).getByText(/Waiting for payment confirmation/)).toBeInTheDocument();

    for (let i = 0; i < 119; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
    }
    await settle();
    expect(mockApi.callsOf("post", CLAIM_PATH)).toHaveLength(119);
    expect(screen.queryByText(/No payment confirmation received/)).not.toBeInTheDocument();
    expect(within(tile).getByText(/Waiting for payment confirmation/)).toBeInTheDocument();

    await tick(5000);
    expect(mockApi.callsOf("post", CLAIM_PATH)).toHaveLength(120);
    expect(screen.getByText(/No payment confirmation received/)).toBeInTheDocument();
    expect(within(tile).queryByText(/Waiting for payment confirmation/)).not.toBeInTheDocument();
    expect(within(tile).getByText("Buy", { selector: "button" })).toBeInTheDocument();
    await tick(20_000);
    expect(mockApi.callsOf("post", CLAIM_PATH)).toHaveLength(120);
  });
});
