import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ExtensionsAdmin from "./ExtensionsAdmin";

vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  },
  // The component branches on `instanceof ApiError` (status + structured
  // detail), so the mock must ship a compatible class, not just `api`.
  ApiError: class ApiError extends Error {
    status: number;
    detail: unknown;
    constructor(message: string, status: number, detail: unknown) {
      super(message);
      this.status = status;
      this.detail = detail;
    }
  },
}));
vi.mock("@/hooks/useMetamodel", () => ({
  invalidateCache: vi.fn().mockResolvedValue(undefined),
}));

import { api, ApiError } from "@/api/client";
import { DEFAULT_DATE_FORMAT, formatDateWith } from "@/hooks/useDateFormat";

const mockGet = api.get as ReturnType<typeof vi.fn>;
const mockPost = api.post as ReturnType<typeof vi.fn>;
const mockPut = api.put as ReturnType<typeof vi.fn>;
const mockUpload = api.upload as ReturnType<typeof vi.fn>;
const mockDelete = api.delete as ReturnType<typeof vi.fn>;

const SAMPLE_EXT = {
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

const UNCONFIGURED_CATALOG = { configured: false, reachable: false, store_url: "", items: [] };

const STORE_ITEM = {
  key: "esg-pack",
  name: "ESG Content Pack",
  description: "Adds ESG capabilities to your metamodel.",
  price: "990 EUR / year",
  payment_link: "https://buy.stripe.test/pl_1",
  version: "1.0.0",
  installed_version: null,
  update_available: false,
  entitlement_state: "unlicensed",
};

function primeInitialLoad({
  extensions = [] as unknown[],
  license = null as unknown,
  catalog = UNCONFIGURED_CATALOG as unknown,
  instanceId = "",
  // Cached daily-store-check result. Null models an instance whose admin
  // lacks admin.settings (the endpoint's gate) — the status line then simply
  // does not render, which is what every pre-existing case here expects.
  storeCheck = null as unknown,
} = {}) {
  mockGet.mockImplementation(async (path: string) => {
    if (path === "/admin/extensions") return extensions;
    if (path === "/admin/extensions/license") {
      if (license) return license;
      throw new Error("No license installed");
    }
    if (path === "/admin/extensions/store/catalog") return catalog;
    if (path === "/admin/extensions/instance") return { instance_id: instanceId };
    if (path === "/settings/extension-store-status") {
      if (storeCheck) return storeCheck;
      throw new Error("Forbidden");
    }
    throw new Error(`unexpected GET ${path}`);
  });
}

const STORE_CHECK = {
  checked_at: "2026-08-26T04:00:00Z",
  error: null,
  seeded: true,
  known_count: 4,
  pending_updates: {},
  enabled: true,
  last_new: 0,
  last_updates: 0,
  last_notified: 0,
};

async function openInstalledTab() {
  await userEvent.click(screen.getByRole("tab", { name: "Installed" }));
}

// The page reads its tab from the URL (useSearchParams), so every render
// needs a router context.
function renderPage(initialPath = "/admin/extensions") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ExtensionsAdmin />
    </MemoryRouter>,
  );
}

describe("ExtensionsAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The tab is also remembered per browser — isolate tests from each other.
    localStorage.clear();
  });

  it("shows the empty state and the no-license hint on the Installed tab", async () => {
    primeInitialLoad();
    renderPage();
    await openInstalledTab();
    await waitFor(() =>
      expect(screen.getByText("No extensions installed yet.")).toBeInTheDocument(),
    );
    expect(screen.getByText(/No license installed/)).toBeInTheDocument();
  });

  it("opens on the Installed tab when the URL says ?tab=installed (refresh keeps the tab)", async () => {
    primeInitialLoad();
    renderPage("/admin/extensions?tab=installed");
    await waitFor(() =>
      expect(screen.getByText("No extensions installed yet.")).toBeInTheDocument(),
    );
    expect(screen.getByRole("tab", { name: "Installed" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("falls back to the Store tab on an unknown ?tab= value", async () => {
    primeInitialLoad();
    renderPage("/admin/extensions?tab=bogus");
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Store" })).toHaveAttribute("aria-selected", "true"),
    );
  });

  it("lists installed extensions with entitlement chips and licensee summary", async () => {
    primeInitialLoad({ extensions: [SAMPLE_EXT], license: LICENSE });
    renderPage();
    await openInstalledTab();
    await waitFor(() => expect(screen.getByText("Sample Extension")).toBeInTheDocument());
    expect(screen.getByText("Licensed to ACME Corp")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    // Active entitlement → no Renew button on the row.
    expect(screen.queryByText("Renew", { selector: "button" })).not.toBeInTheDocument();
  });

  it("says whether an active entitlement renews or runs out when the flag is known", async () => {
    primeInitialLoad({
      extensions: [
        {
          ...SAMPLE_EXT,
          entitlement: {
            state: "active",
            expires_at: "2027-07-01T00:00:00Z",
            grace_until: null,
            auto_renew: true,
          },
        },
        {
          ...SAMPLE_EXT,
          key: "other-ext",
          name: "Other Extension",
          entitlement: {
            state: "active",
            expires_at: "2027-07-01T00:00:00Z",
            grace_until: null,
            auto_renew: false,
          },
        },
        {
          ...SAMPLE_EXT,
          key: "manual-ext",
          name: "Manual Extension",
          entitlement: {
            state: "active",
            expires_at: "2027-07-01T00:00:00Z",
            grace_until: null,
            // No auto_renew → manual/pre-field license keeps today's caption.
          },
        },
      ],
      license: LICENSE,
    });
    renderPage();
    await openInstalledTab();
    await waitFor(() => expect(screen.getByText("Sample Extension")).toBeInTheDocument());
    expect(screen.getByText(/Renews on/)).toBeInTheDocument();
    expect(screen.getByText(/will not renew/)).toBeInTheDocument();
    expect(screen.getByText(/Active until/)).toBeInTheDocument();
  });

  it("offers Manage subscription only on store-managed licenses and opens the portal", async () => {
    primeInitialLoad({
      extensions: [SAMPLE_EXT],
      license: { ...LICENSE, store_managed: true },
    });
    mockPost.mockResolvedValue({ url: "https://billing.stripe.test/p/session_1" });
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    renderPage();
    await openInstalledTab();
    await waitFor(() => expect(screen.getByText("Licensed to ACME Corp")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Manage subscription/ }));
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith("/admin/extensions/store/billing-portal"),
    );
    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        "https://billing.stripe.test/p/session_1",
        "_blank",
        "noopener",
      ),
    );
    openSpy.mockRestore();
  });

  it("hides Manage subscription on manual licenses and hints when the store is unreachable", async () => {
    primeInitialLoad({ extensions: [SAMPLE_EXT], license: LICENSE }); // no store_managed
    renderPage();
    await openInstalledTab();
    await waitFor(() => expect(screen.getByText("Licensed to ACME Corp")).toBeInTheDocument());
    expect(
      screen.queryByRole("button", { name: /Manage subscription/ }),
    ).not.toBeInTheDocument();
  });

  it("shows the offline hint when the billing portal cannot be reached", async () => {
    primeInitialLoad({
      extensions: [SAMPLE_EXT],
      license: { ...LICENSE, store_managed: true },
    });
    mockPost.mockRejectedValue(new Error("boom"));
    renderPage();
    await openInstalledTab();
    await waitFor(() => expect(screen.getByText("Licensed to ACME Corp")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Manage subscription/ }));
    await waitFor(() =>
      expect(
        screen.getByText(/extension store could not be reached/i),
      ).toBeInTheDocument(),
    );
  });

  it("offers Renew on rows without an active entitlement and refreshes from the store", async () => {
    primeInitialLoad({
      extensions: [
        {
          ...SAMPLE_EXT,
          entitlement: { state: "grace", plan: "", expires_at: null, grace_until: null },
        },
      ],
      license: LICENSE,
    });
    mockPost.mockResolvedValue({ refreshed: true });
    renderPage();
    await openInstalledTab();
    await waitFor(() => expect(screen.getByText("Sample Extension")).toBeInTheDocument());

    await userEvent.click(screen.getByText("Renew", { selector: "button" }));
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith("/admin/extensions/store/refresh-license"),
    );
    await waitFor(() =>
      expect(screen.getByText(/License refreshed from the store/)).toBeInTheDocument(),
    );
  });

  it("falls back to the license dialog when the store has nothing newer", async () => {
    primeInitialLoad({
      extensions: [
        {
          ...SAMPLE_EXT,
          entitlement: { state: "expired", plan: "", expires_at: null, grace_until: null },
        },
      ],
      license: LICENSE,
    });
    mockPost.mockResolvedValue({ refreshed: false });
    renderPage();
    await openInstalledTab();
    await waitFor(() => expect(screen.getByText("Sample Extension")).toBeInTheDocument());

    await userEvent.click(screen.getByText("Renew", { selector: "button" }));
    await waitFor(() => expect(screen.getByText("Apply a license")).toBeInTheDocument());
  });

  it("applies a pasted license through the dialog", async () => {
    primeInitialLoad();
    mockPut.mockResolvedValue(LICENSE);
    renderPage();
    await openInstalledTab();
    await waitFor(() =>
      expect(screen.getByText(/No license installed/)).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByText("Enter license…", { selector: "button" }));
    await userEvent.type(
      screen.getByPlaceholderText("Paste license text here…"),
      "signed-license-text",
    );
    primeInitialLoad({ license: LICENSE });
    await userEvent.click(screen.getByText("Apply license"));

    await waitFor(() =>
      expect(mockPut).toHaveBeenCalledWith("/admin/extensions/license", {
        text: "signed-license-text",
        confirm: false,
      }),
    );
    await waitFor(() => expect(screen.getByText("Licensed to ACME Corp")).toBeInTheDocument());
  });

  it("asks for confirmation before applying a license that drops active entitlements", async () => {
    primeInitialLoad({ extensions: [SAMPLE_EXT] });
    mockPut.mockRejectedValueOnce(
      new ApiError("downgrade", 409, {
        code: "entitlement_downgrade",
        message: "downgrade",
        dropped: ["sample-ext"],
      }),
    );
    renderPage();
    await openInstalledTab();
    await userEvent.click(screen.getByText("Enter license…", { selector: "button" }));
    await userEvent.type(
      screen.getByPlaceholderText("Paste license text here…"),
      "narrow-license",
    );
    await userEvent.click(screen.getByText("Apply license"));

    // The 409 opens the confirmation dialog naming the dropped extension
    // (once in the list row, once inside the dialog).
    await waitFor(() =>
      expect(
        screen.getByText("This license drops active entitlements"),
      ).toBeInTheDocument(),
    );
    expect(screen.getAllByText("Sample Extension").length).toBeGreaterThan(1);

    mockPut.mockResolvedValue(LICENSE);
    primeInitialLoad({ extensions: [SAMPLE_EXT], license: LICENSE });
    await userEvent.click(screen.getByText("Apply anyway"));
    await waitFor(() =>
      expect(mockPut).toHaveBeenLastCalledWith("/admin/extensions/license", {
        text: "narrow-license",
        confirm: true,
      }),
    );
  });

  // ── "Install from file…" placement ────────────────────────────────────
  // The trigger is per-tab and per-state rather than page chrome in the
  // header: it renders in the toolbar above whichever list is on screen, and
  // inside the notice itself when the store is unusable — the state in which
  // it is the only way in. Exactly one is in the DOM at a time.
  describe("install-from-file placement", () => {
    /** True when `a` comes before `b` in document order. */
    const precedes = (a: Element, b: Element) =>
      !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    it("puts the button in the toolbar above the catalogue, not in the header", async () => {
      primeInitialLoad({
        license: LICENSE,
        catalog: { configured: true, reachable: true, store_url: "https://x", items: [STORE_ITEM] },
      });
      renderPage();

      const button = await screen.findByText("Install from file…", { selector: "button" });
      // The header row is the one carrying the page title.
      const header = screen.getByText("Extensions").closest("div") as HTMLElement;
      expect(header).not.toContainElement(button);
      // It sits above the catalogue, alongside the tag filters.
      expect(precedes(button, screen.getByText("ESG Content Pack"))).toBe(true);
    });

    it("carries the button inside the notice when the store cannot be reached", async () => {
      primeInitialLoad({
        license: LICENSE,
        catalog: { configured: true, reachable: false, store_url: "https://x", items: [] },
      });
      renderPage();

      // Not `findByRole("alert")` — the consulting notice above the tabs is
      // an Alert too, and it is the first one on the page.
      const alert = (await screen.findByText(/could not be reached/i)).closest(
        ".MuiAlert-root",
      ) as HTMLElement;
      expect(
        within(alert).getByText("Install from file…", { selector: "button" }),
      ).toBeInTheDocument();
      // The prose no longer sends the admin looking for it elsewhere.
      expect(alert.textContent).not.toMatch(/top of this page/i);
      expect(screen.getAllByText("Install from file…", { selector: "button" })).toHaveLength(1);
    });

    it("offers the button on the Installed tab too", async () => {
      primeInitialLoad({ extensions: [SAMPLE_EXT], license: LICENSE });
      renderPage("/admin/extensions?tab=installed");

      const button = await screen.findByText("Install from file…", { selector: "button" });
      expect(screen.getAllByText("Install from file…", { selector: "button" })).toHaveLength(1);
      // Above the list it adds to.
      expect(precedes(button, screen.getByText("Installed extensions"))).toBe(true);
    });

    it("uploads from the Installed tab through the same pipeline", async () => {
      primeInitialLoad({ extensions: [SAMPLE_EXT], license: LICENSE });
      mockUpload.mockResolvedValue({ id: "i9", filename: "other.teax", status: "verifying" });
      mockGet.mockImplementation(async (path: string) => {
        if (path === "/admin/extensions") return [SAMPLE_EXT];
        if (path === "/admin/extensions/license") return LICENSE;
        if (path === "/admin/extensions/store/catalog") return UNCONFIGURED_CATALOG;
        if (path === "/admin/extensions/instance") return { instance_id: "" };
        if (path.startsWith("/admin/extensions/install/"))
          return { id: "i9", filename: "other.teax", status: "verifying" };
        throw new Error(`unexpected GET ${path}`);
      });

      const { container } = renderPage("/admin/extensions?tab=installed");
      await screen.findByText("Install from file…", { selector: "button" });

      const bundleInput = container.querySelector('input[type="file"]') as HTMLInputElement;
      await userEvent.upload(bundleInput, new File(["zip"], "other.teax"));

      await waitFor(() => expect(mockUpload).toHaveBeenCalled());
      expect(mockUpload.mock.calls[0][0]).toBe("/admin/extensions/install");
    });
  });

  it("uploads a bundle from the Store tab, shows the preview, and installs it", async () => {
    primeInitialLoad({ license: LICENSE });
    mockUpload.mockResolvedValue({ id: "i1", filename: "sample.teax", status: "verifying" });
    const previewed = {
      id: "i1",
      filename: "sample.teax",
      status: "previewed",
      extension_key: "sample-ext",
      extension_version: "1.0.0",
      diff: {
        dry_run: true,
        sections: [
          {
            sheet: "CardTypes",
            created: 1,
            updated: 0,
            skipped: 0,
            conflict: 0,
            failed: 0,
            errors: [],
          },
        ],
        totals: { created: 1, updated: 0, skipped: 0, conflict: 0, failed: 0 },
      },
    };
    mockGet.mockImplementation(async (path: string) => {
      if (path === "/admin/extensions") return [];
      if (path === "/admin/extensions/license") return LICENSE;
      if (path === "/admin/extensions/store/catalog") return UNCONFIGURED_CATALOG;
      if (path.startsWith("/admin/extensions/install/")) return previewed;
      throw new Error(`unexpected GET ${path}`);
    });

    const { container } = renderPage();
    await waitFor(() =>
      expect(screen.getByText("Install from file…", { selector: "button" })).toBeInTheDocument(),
    );

    const bundleInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(bundleInput, new File(["zip"], "sample.teax"));

    await waitFor(
      () =>
        expect(screen.getByText("Install extension", { selector: "button" })).toBeInTheDocument(),
      { timeout: 4000 },
    );
    // Everything the pipeline produced — the preview AND the button that
    // acts on it — is inside the dialog, not at the foot of the page.
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("sample.teax")).toBeInTheDocument();
    expect(within(dialog).getByText("CardTypes")).toBeInTheDocument();
    expect(within(dialog).getByText("1 created")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Install extension", { selector: "button" }),
    ).toBeInTheDocument();
  });

  it("pins the install action in the dialog footer, below the scrolling preview", async () => {
    // The regression this replaces: the apply button sat at the foot of an
    // inline panel below the whole catalogue, so pressing "Install from
    // file…" in the header produced a button off-screen at the bottom of the
    // page. In DialogActions it cannot scroll away however long the preview.
    primeInitialLoad({ license: LICENSE });
    mockUpload.mockResolvedValue({ id: "i1", filename: "big.teax", status: "verifying" });
    mockGet.mockImplementation(async (path: string) => {
      if (path === "/admin/extensions") return [];
      if (path === "/admin/extensions/license") return LICENSE;
      if (path === "/admin/extensions/store/catalog") return UNCONFIGURED_CATALOG;
      if (path.startsWith("/admin/extensions/install/"))
        return {
          id: "i1",
          filename: "big.teax",
          status: "previewed",
          diff: {
            dry_run: true,
            // A long preview is exactly the case the inline panel got wrong.
            sections: Array.from({ length: 20 }, (_, i) => ({
              sheet: `Sheet${i}`,
              created: 1,
              updated: 0,
              skipped: 0,
              conflict: 0,
              failed: 0,
            })),
            totals: { created: 20, updated: 0, skipped: 0, conflict: 0, failed: 0 },
          },
        };
      throw new Error(`unexpected GET ${path}`);
    });

    const { container } = renderPage();
    await waitFor(() =>
      expect(screen.getByText("Install from file…", { selector: "button" })).toBeInTheDocument(),
    );
    await userEvent.upload(
      container.querySelector('input[type="file"]') as HTMLInputElement,
      new File(["zip"], "big.teax"),
    );

    const button = await screen.findByText(
      "Install extension",
      { selector: "button" },
      { timeout: 4000 },
    );
    // The button is a child of DialogActions, and the preview lives in the
    // separately-scrolling DialogContent — never one flow with it.
    const actions = button.closest(".MuiDialogActions-root");
    expect(actions).toBeTruthy();
    const content = screen.getByRole("dialog").querySelector(".MuiDialogContent-root");
    expect(content).toBeTruthy();
    expect(content!.contains(button)).toBe(false);
    expect(within(content as HTMLElement).getByText("Sheet19")).toBeInTheDocument();
    // Nothing install-related is left behind on the page itself.
    expect(container.querySelector(".MuiDialogActions-root")).toBeNull();
  });

  it("discards a previewed bundle and closes the dialog", async () => {
    primeInitialLoad({ license: LICENSE });
    mockUpload.mockResolvedValue({ id: "i7", filename: "sample.teax", status: "verifying" });
    mockDelete.mockResolvedValue(undefined);
    mockGet.mockImplementation(async (path: string) => {
      if (path === "/admin/extensions") return [];
      if (path === "/admin/extensions/license") return LICENSE;
      if (path === "/admin/extensions/store/catalog") return UNCONFIGURED_CATALOG;
      if (path.startsWith("/admin/extensions/install/"))
        return {
          id: "i7",
          filename: "sample.teax",
          status: "previewed",
          diff: { totals: { created: 1, updated: 0, skipped: 0, conflict: 0, failed: 0 } },
        };
      throw new Error(`unexpected GET ${path}`);
    });

    const { container } = renderPage();
    await waitFor(() =>
      expect(screen.getByText("Install from file…", { selector: "button" })).toBeInTheDocument(),
    );
    await userEvent.upload(
      container.querySelector('input[type="file"]') as HTMLInputElement,
      new File(["zip"], "sample.teax"),
    );
    await screen.findByText("Install extension", { selector: "button" }, { timeout: 4000 });

    await userEvent.click(screen.getByText("Discard", { selector: "button" }));
    expect(mockDelete).toHaveBeenCalledWith("/admin/extensions/install/i7");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("closes a finished install without deleting its audit row", async () => {
    // DELETE /install/{id} drops the extension_installs record — the audit
    // trail of what was installed and when. A completed install is closed,
    // never discarded.
    primeInitialLoad({ license: LICENSE });
    mockUpload.mockResolvedValue({ id: "i8", filename: "sample.teax", status: "verifying" });
    mockPost.mockResolvedValue({ id: "i8", filename: "sample.teax", status: "applying" });
    let applied = false;
    mockGet.mockImplementation(async (path: string) => {
      if (path === "/admin/extensions") return [];
      if (path === "/admin/extensions/license") return LICENSE;
      if (path === "/admin/extensions/store/catalog") return UNCONFIGURED_CATALOG;
      if (path === "/admin/extensions/instance") return { instance_id: "" };
      if (path === "/settings/extension-store-status") throw new Error("Forbidden");
      if (path.startsWith("/admin/extensions/install/"))
        return applied
          ? { id: "i8", filename: "sample.teax", status: "installed" }
          : {
              id: "i8",
              filename: "sample.teax",
              status: "previewed",
              diff: { totals: { created: 1, updated: 0, skipped: 0, conflict: 0, failed: 0 } },
            };
      throw new Error(`unexpected GET ${path}`);
    });

    const { container } = renderPage();
    await waitFor(() =>
      expect(screen.getByText("Install from file…", { selector: "button" })).toBeInTheDocument(),
    );
    await userEvent.upload(
      container.querySelector('input[type="file"]') as HTMLInputElement,
      new File(["zip"], "sample.teax"),
    );
    const apply = await screen.findByText(
      "Install extension",
      { selector: "button" },
      { timeout: 4000 },
    );

    applied = true;
    await userEvent.click(apply);
    await waitFor(() => expect(screen.getByText("Extension installed.")).toBeInTheDocument(), {
      timeout: 5000,
    });

    // Close, not Discard — and no DELETE.
    expect(screen.queryByText("Discard", { selector: "button" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("Close", { selector: "button" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockDelete).not.toHaveBeenCalled();
  }, 15000);

  it("cannot be dismissed by accident mid-flight, but Discard stays reachable", async () => {
    // A stray backdrop click or Escape mid-verify would orphan a run the
    // admin can no longer see — but an EXPLICIT way out has to remain, or a
    // verify that never terminates traps them in the modal for good.
    primeInitialLoad({ license: LICENSE });
    mockUpload.mockResolvedValue({ id: "i9", filename: "slow.teax", status: "verifying" });
    mockGet.mockImplementation(async (path: string) => {
      if (path === "/admin/extensions") return [];
      if (path === "/admin/extensions/license") return LICENSE;
      if (path === "/admin/extensions/store/catalog") return UNCONFIGURED_CATALOG;
      if (path.startsWith("/admin/extensions/install/"))
        return { id: "i9", filename: "slow.teax", status: "verifying" };
      throw new Error(`unexpected GET ${path}`);
    });

    const { container } = renderPage();
    await waitFor(() =>
      expect(screen.getByText("Install from file…", { selector: "button" })).toBeInTheDocument(),
    );
    await userEvent.upload(
      container.querySelector('input[type="file"]') as HTMLInputElement,
      new File(["zip"], "slow.teax"),
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("slow.teax")).toBeInTheDocument();
    // Nothing to apply yet, and no "Close" — the run has not finished.
    expect(
      within(dialog).queryByText("Install extension", { selector: "button" }),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Close", { selector: "button" })).not.toBeInTheDocument();
    // Escape and the backdrop are inert…
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.click(document.querySelector(".MuiBackdrop-root") as HTMLElement);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // …but Discard is right there.
    expect(within(dialog).getByText("Discard", { selector: "button" })).toBeInTheDocument();
  });

  it("reports an upload failure inside the dialog", async () => {
    primeInitialLoad({ license: LICENSE });
    mockUpload.mockRejectedValue(new Error("Upload rejected: not a zip archive"));

    const { container } = renderPage();
    await waitFor(() =>
      expect(screen.getByText("Install from file…", { selector: "button" })).toBeInTheDocument(),
    );
    await userEvent.upload(
      container.querySelector('input[type="file"]') as HTMLInputElement,
      new File(["nope"], "broken.teax"),
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/not a zip archive/)).toBeInTheDocument();
    // No upload exists to discard, so the way out is Close — a dialog with
    // no visible dismissal would be a dead end.
    expect(within(dialog).queryByText("Discard", { selector: "button" })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByText("Close", { selector: "button" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows a rejection when the bundle fails verification", async () => {
    primeInitialLoad();
    mockUpload.mockResolvedValue({ id: "i2", filename: "evil.teax", status: "verifying" });
    mockGet.mockImplementation(async (path: string) => {
      if (path === "/admin/extensions") return [];
      if (path === "/admin/extensions/license") throw new Error("nope");
      if (path === "/admin/extensions/store/catalog") return UNCONFIGURED_CATALOG;
      if (path.startsWith("/admin/extensions/install/")) {
        return {
          id: "i2",
          filename: "evil.teax",
          status: "failed",
          error_message:
            "Bundle signature verification failed — this extension was not signed by the trusted vendor key",
        };
      }
      throw new Error(`unexpected GET ${path}`);
    });

    const { container } = renderPage();
    await waitFor(() =>
      expect(screen.getByText("Install from file…", { selector: "button" })).toBeInTheDocument(),
    );
    const bundleInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(bundleInput, new File(["zip"], "evil.teax"));

    await waitFor(
      () =>
        expect(screen.getByText(/was not signed by the trusted vendor key/)).toBeInTheDocument(),
      { timeout: 4000 },
    );
  });

  it("asks for confirmation before uninstalling", async () => {
    primeInitialLoad({ extensions: [SAMPLE_EXT], license: LICENSE });
    renderPage();
    await openInstalledTab();
    await waitFor(() => expect(screen.getByText("Sample Extension")).toBeInTheDocument());
    await userEvent.click(screen.getByText("Uninstall", { selector: "button" }));
    expect(screen.getByText("Uninstall extension?")).toBeInTheDocument();
    expect(screen.getByText(/card types are hidden from the metamodel/)).toBeInTheDocument();
  });

  it("gates Install behind the license dialog for unlicensed items", async () => {
    primeInitialLoad({
      catalog: { configured: true, reachable: true, store_url: "https://x", items: [STORE_ITEM] },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("ESG Content Pack")).toBeInTheDocument());

    await userEvent.click(screen.getByText("Install", { selector: "button" }));
    // No install call yet — the gate dialog opens instead.
    expect(mockPost).not.toHaveBeenCalledWith("/admin/extensions/store/install", {
      key: "esg-pack",
    });
    expect(screen.getByText("License required")).toBeInTheDocument();
    expect(screen.getByText(/needs a license entitlement/)).toBeInTheDocument();
    expect(screen.getByText(/Buy — 990 EUR \/ year/)).toBeInTheDocument();
  });

  it("pasting a license in the gate continues the install automatically", async () => {
    primeInitialLoad({
      catalog: { configured: true, reachable: true, store_url: "https://x", items: [STORE_ITEM] },
    });
    mockPut.mockResolvedValue(LICENSE);
    mockPost.mockResolvedValue({ id: "s1", filename: "esg.teax", status: "verifying" });
    renderPage();
    await waitFor(() => expect(screen.getByText("ESG Content Pack")).toBeInTheDocument());

    await userEvent.click(screen.getByText("Install", { selector: "button" }));
    await userEvent.type(screen.getByPlaceholderText("Paste license text here…"), "lic-text");
    primeInitialLoad({
      license: LICENSE,
      catalog: {
        configured: true,
        reachable: true,
        store_url: "https://x",
        items: [{ ...STORE_ITEM, entitlement_state: "active" }],
      },
    });
    await userEvent.click(screen.getByText("Apply license"));

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith("/admin/extensions/store/install", {
        key: "esg-pack",
      }),
    );
  });

  it("one-click store install auto-applies straight through to installed", async () => {
    primeInitialLoad({
      license: LICENSE,
      catalog: {
        configured: true,
        reachable: true,
        store_url: "https://x",
        items: [{ ...STORE_ITEM, entitlement_state: "active" }],
      },
    });
    // POST store/install → verifying; POST .../apply → applying.
    mockPost.mockImplementation(async (path: string) => {
      if (path === "/admin/extensions/store/install")
        return { id: "s1", filename: "esg.teax", status: "verifying" };
      if (path === "/admin/extensions/install/s1/apply")
        return { id: "s1", filename: "esg.teax", status: "applying" };
      throw new Error(`unexpected POST ${path}`);
    });
    // The install poll walks verifying → previewed → installed.
    const statuses = ["previewed", "installed"];
    let call = 0;
    mockGet.mockImplementation(async (path: string) => {
      if (path === "/admin/extensions") return [];
      if (path === "/admin/extensions/license") return LICENSE;
      if (path === "/admin/extensions/store/catalog")
        return {
          configured: true,
          reachable: true,
          store_url: "https://x",
          items: [{ ...STORE_ITEM, entitlement_state: "active" }],
        };
      if (path.startsWith("/admin/extensions/install/")) {
        const status = statuses[Math.min(call++, statuses.length - 1)];
        const diff =
          status === "previewed"
            ? { totals: { created: 1, updated: 0, skipped: 0, conflict: 0, failed: 0 } }
            : null;
        return { id: "s1", filename: "esg.teax", status, diff };
      }
      throw new Error(`unexpected GET ${path}`);
    });

    renderPage();
    await waitFor(() => expect(screen.getByText("ESG Content Pack")).toBeInTheDocument());
    expect(screen.queryByText("Buy", { selector: "button" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("Install", { selector: "button" }));

    // Auto-apply fires without a second click: the apply endpoint is hit…
    await waitFor(
      () => expect(mockPost).toHaveBeenCalledWith("/admin/extensions/install/s1/apply"),
      { timeout: 5000 },
    );
    // …and no manual "Install extension" apply button is ever shown.
    expect(
      screen.queryByText("Install extension", { selector: "button" }),
    ).not.toBeInTheDocument();
  });

  it(
    "one-click store install stops at the downgrade confirmation instead of auto-applying",
    async () => {
      primeInitialLoad({
        license: LICENSE,
        catalog: {
          configured: true,
          reachable: true,
          store_url: "https://x",
          items: [{ ...STORE_ITEM, entitlement_state: "active" }],
        },
      });
      mockPost.mockImplementation(async (path: string) => {
        if (path === "/admin/extensions/store/install")
          return { id: "s1", filename: "esg.teax", status: "verifying" };
        if (path === "/admin/extensions/install/s1/apply")
          return { id: "s1", filename: "esg.teax", status: "applying" };
        throw new Error(`unexpected POST ${path}`);
      });
      mockGet.mockImplementation(async (path: string) => {
        if (path === "/admin/extensions") return [];
        if (path === "/admin/extensions/license") return LICENSE;
        if (path === "/admin/extensions/store/catalog")
          return {
            configured: true,
            reachable: true,
            store_url: "https://x",
            items: [{ ...STORE_ITEM, entitlement_state: "active" }],
          };
        if (path.startsWith("/admin/extensions/install/")) {
          // The dry-run flagged this bundle as OLDER than what is installed.
          return {
            id: "s1",
            filename: "esg.teax",
            status: "previewed",
            diff: {
              downgrade: { from: "2.0.0", to: "1.0.0" },
              totals: { created: 0, updated: 1, skipped: 0, conflict: 0, failed: 0 },
            },
          };
        }
        throw new Error(`unexpected GET ${path}`);
      });

      renderPage();
      await waitFor(() => expect(screen.getByText("ESG Content Pack")).toBeInTheDocument());
      await userEvent.click(screen.getByText("Install", { selector: "button" }));

      // The confirmation dialog opens instead of the silent auto-apply…
      await waitFor(
        () => expect(screen.getByText("Install an older version?")).toBeInTheDocument(),
        { timeout: 5000 },
      );
      expect(screen.getByText(/a downgrade/)).toBeInTheDocument();
      expect(mockPost).not.toHaveBeenCalledWith(
        "/admin/extensions/install/s1/apply",
        expect.anything(),
      );

      // …and confirming re-applies WITH the explicit confirm flag.
      await userEvent.click(screen.getByText("Install older version", { selector: "button" }));
      await waitFor(() =>
        expect(mockPost).toHaveBeenCalledWith("/admin/extensions/install/s1/apply", {
          confirm_downgrade: true,
        }),
      );
    },
    10000,
  );

  it("shows an update chip on the Installed tab and clicking it starts the store install", async () => {
    const updateItem = {
      ...STORE_ITEM,
      key: "sample-ext",
      name: "Sample Extension",
      version: "2.0.0",
      installed_version: "1.0.0",
      update_available: true,
      entitlement_state: "active",
    };
    primeInitialLoad({
      extensions: [SAMPLE_EXT],
      license: LICENSE,
      catalog: { configured: true, reachable: true, store_url: "https://x", items: [updateItem] },
    });
    mockPost.mockResolvedValue({ id: "s9", filename: "sample.teax", status: "verifying" });
    renderPage();
    await openInstalledTab();
    await waitFor(() => expect(screen.getByText("Sample Extension")).toBeInTheDocument());

    // The Version cell carries the chip because the catalog says a newer
    // version exists — no separate request is made for it.
    await userEvent.click(screen.getByText("Update to 2.0.0"));
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith("/admin/extensions/store/install", {
        key: "sample-ext",
      }),
    );
  });

  it("labels the button Install — never Update — for an extension that is not installed", async () => {
    // `update_available` without an `installed_version` is not an update:
    // there is no older version on this instance to move away from, so
    // "Update to 1.0.0" would name an act the admin never performed. The
    // plain Install already fetches whatever the catalogue publishes.
    primeInitialLoad({
      license: LICENSE,
      catalog: {
        configured: true,
        reachable: true,
        store_url: "https://x",
        items: [
          {
            ...STORE_ITEM,
            installed_version: null,
            update_available: true,
            entitlement_state: "active",
          },
        ],
      },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("ESG Content Pack")).toBeInTheDocument());
    expect(screen.getByText("Install", { selector: "button" })).toBeInTheDocument();
    expect(screen.queryByText(/Update to/)).not.toBeInTheDocument();
  });

  it("keeps the store button spinning for the whole install, apply included", async () => {
    // The regression: "previewed" is a TERMINAL status, so between the
    // preview landing and the auto-apply finishing the button re-enabled and
    // dropped its spinner — mid-install it read as though nothing happened.
    primeInitialLoad({
      license: LICENSE,
      catalog: {
        configured: true,
        reachable: true,
        store_url: "https://x",
        items: [{ ...STORE_ITEM, entitlement_state: "active" }],
      },
    });
    // Hold the apply POST open so the previewed → applied window — the one
    // that used to look idle — can actually be asserted on.
    let releaseApply: (value: unknown) => void = () => {};
    mockPost.mockImplementation(async (path: string) => {
      if (path === "/admin/extensions/store/install")
        return { id: "s1", filename: "esg.teax", status: "verifying" };
      if (path === "/admin/extensions/install/s1/apply")
        return new Promise((resolve) => {
          releaseApply = resolve;
        });
      throw new Error(`unexpected POST ${path}`);
    });
    let applied = false;
    mockGet.mockImplementation(async (path: string) => {
      if (path === "/admin/extensions") return [];
      if (path === "/admin/extensions/license") return LICENSE;
      if (path === "/admin/extensions/store/catalog")
        return {
          configured: true,
          reachable: true,
          store_url: "https://x",
          items: [{ ...STORE_ITEM, entitlement_state: "active" }],
        };
      if (path.startsWith("/admin/extensions/install/"))
        return applied
          ? { id: "s1", filename: "esg.teax", status: "installed" }
          : {
              id: "s1",
              filename: "esg.teax",
              status: "previewed",
              diff: { totals: { created: 1, updated: 0, skipped: 0, conflict: 0, failed: 0 } },
            };
      throw new Error(`unexpected GET ${path}`);
    });

    renderPage();
    await waitFor(() => expect(screen.getByText("ESG Content Pack")).toBeInTheDocument());
    await userEvent.click(screen.getByText("Install", { selector: "button" }));

    // Preview landed and the apply is in flight: still busy, still disabled.
    const busy = await screen.findByText("Installing…", { selector: "button" }, { timeout: 5000 });
    expect(busy).toBeDisabled();
    expect(busy.querySelector(".MuiCircularProgress-root")).toBeTruthy();

    applied = true;
    releaseApply({ id: "s1", filename: "esg.teax", status: "applying" });

    // …and it settles back to an actionable button once the install lands.
    await waitFor(
      () => expect(screen.getByText("Install", { selector: "button" })).toBeEnabled(),
      { timeout: 5000 },
    );
  }, 15000);

  it("shows update progress in the install dialog, whichever tab started it", async () => {
    // The progress used to render on the Store tab only, so an update
    // launched from this chip reported nothing at all on the tab in front of
    // the admin. #1063 moved it below both tabs — still off-screen at the
    // foot of the page. It is a modal now, which is tab-agnostic by
    // construction: the Installed tab stays selected behind it.
    const updateItem = {
      ...STORE_ITEM,
      key: "sample-ext",
      name: "Sample Extension",
      version: "2.0.0",
      installed_version: "1.0.0",
      update_available: true,
      entitlement_state: "active",
    };
    const catalog = {
      configured: true,
      reachable: true,
      store_url: "https://x",
      items: [updateItem],
    };
    primeInitialLoad({ extensions: [SAMPLE_EXT], license: LICENSE, catalog });
    mockPost.mockResolvedValue({ id: "s9", filename: "sample.teax", status: "verifying" });
    mockGet.mockImplementation(async (path: string) => {
      if (path === "/admin/extensions") return [SAMPLE_EXT];
      if (path === "/admin/extensions/license") return LICENSE;
      if (path === "/admin/extensions/store/catalog") return catalog;
      if (path === "/admin/extensions/instance") return { instance_id: "" };
      if (path.startsWith("/admin/extensions/install/"))
        return { id: "s9", filename: "sample.teax", status: "verifying" };
      throw new Error(`unexpected GET ${path}`);
    });

    renderPage();
    await openInstalledTab();
    await waitFor(() => expect(screen.getByText("Sample Extension")).toBeInTheDocument());
    await userEvent.click(screen.getByText("Update to 2.0.0"));

    // The chip reports its own progress…
    await waitFor(() => expect(screen.getByText("Updating…")).toBeInTheDocument(), {
      timeout: 5000,
    });
    // …and the pipeline is in the dialog, over the tab that started it.
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("sample.teax")).toBeInTheDocument();
    // hidden: true — the open modal marks the page behind it aria-hidden.
    expect(screen.getByRole("tab", { name: "Installed", hidden: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  }, 15000);

  it("offers Install from file… on both tabs", async () => {
    // It is the only way in for an air-gapped instance, so it must not be
    // reachable only from the tab whose store is unreachable.
    primeInitialLoad({ extensions: [SAMPLE_EXT], license: LICENSE });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText("Install from file…", { selector: "button" })).toBeInTheDocument(),
    );
    await openInstalledTab();
    expect(screen.getByText("Install from file…", { selector: "button" })).toBeInTheDocument();
  });

  it("shows no update chip when the catalog is unreachable (air-gapped)", async () => {
    primeInitialLoad({
      extensions: [SAMPLE_EXT],
      license: LICENSE,
      catalog: { configured: true, reachable: false, store_url: "https://x", items: [] },
    });
    renderPage();
    await openInstalledTab();
    await waitFor(() => expect(screen.getByText("Sample Extension")).toBeInTheDocument());
    expect(screen.queryByText(/Update to/)).not.toBeInTheDocument();
  });

  it("shows a 'See it in action' demo link only when the item has a demo_url", async () => {
    primeInitialLoad({
      catalog: {
        configured: true,
        reachable: true,
        store_url: "https://x",
        items: [
          { ...STORE_ITEM, demo_url: "https://youtu.be/demo" },
          { ...STORE_ITEM, key: "no-demo", name: "No Demo Pack", demo_url: "" },
        ],
      },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("No Demo Pack")).toBeInTheDocument());

    // The demo link lives in the detail drawer now — a compact tile carries
    // only the actions that move an extension towards being installed.
    expect(screen.queryByText("See it in action")).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: /Open details for ESG Content Pack/ }),
    );
    const demoLink = await screen.findByText("See it in action");
    expect(demoLink.closest("a")).toHaveAttribute("href", "https://youtu.be/demo");
    expect(demoLink.closest("a")).toHaveAttribute("target", "_blank");

    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByText("See it in action")).not.toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole("button", { name: /Open details for No Demo Pack/ }));
    expect(screen.queryByText("See it in action")).not.toBeInTheDocument();
  });

  it("filters store items by clicking category tag pills (multi-select AND, All resets)", async () => {
    primeInitialLoad({
      catalog: {
        configured: true,
        reachable: true,
        store_url: "https://x",
        items: [
          {
            ...STORE_ITEM,
            key: "a-ext",
            name: "Alpha Ext",
            tags: ["commercial", "integration", "jira"],
          },
          {
            ...STORE_ITEM,
            key: "b-ext",
            name: "Beta Ext",
            free: true,
            payment_link: "",
            tags: ["free", "value-creation"],
          },
        ],
      },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("Alpha Ext")).toBeInTheDocument());
    expect(screen.getByText("Beta Ext")).toBeInTheDocument();

    // Every tag pill renders in the filter bar and nowhere else: a compact
    // tile has no room for them, so they moved into the detail drawer.
    expect(screen.getAllByText("free")).toHaveLength(1);
    expect(screen.getAllByText("commercial")).toHaveLength(1);
    expect(screen.getAllByText("integration")).toHaveLength(1);

    // one pill narrows the grid
    await userEvent.click(screen.getByText("integration"));
    expect(screen.getByText("Alpha Ext")).toBeInTheDocument();
    expect(screen.queryByText("Beta Ext")).not.toBeInTheDocument();

    // a second pill ANDs with the first — nothing carries both
    await userEvent.click(screen.getByText("free"));
    expect(screen.queryByText("Alpha Ext")).not.toBeInTheDocument();
    expect(
      screen.getByText("No extensions match the selected tags."),
    ).toBeInTheDocument();

    // «All» resets the filter
    await userEvent.click(screen.getByText("All"));
    expect(screen.getByText("Alpha Ext")).toBeInTheDocument();
    expect(screen.getByText("Beta Ext")).toBeInTheDocument();
  });

  it("groups store items into sections in the fixed order, Other last", async () => {
    primeInitialLoad({
      catalog: {
        configured: true,
        reachable: true,
        store_url: "https://x",
        items: [
          // catalogue order deliberately differs from section order
          { ...STORE_ITEM, key: "reg", name: "Reg Ext", category: "regulations" },
          { ...STORE_ITEM, key: "odd", name: "Odd Ext", category: "not-a-section" },
          { ...STORE_ITEM, key: "str", name: "Strat Ext", category: "strategy" },
        ],
      },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("Reg Ext")).toBeInTheDocument());

    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    // Integrations is empty and therefore omitted; the unknown slug lands
    // under Other, which always trails.
    expect(headings).toEqual(["Strategy, Planning & Transformation", "Regulations", "Other"]);
    const strat = screen.getByText("Strategy, Planning & Transformation");
    const reg = screen.getByText("Regulations");
    expect(strat.compareDocumentPosition(screen.getByText("Strat Ext"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByText("Strat Ext").compareDocumentPosition(reg)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("drops a section heading when the tag filter empties it", async () => {
    primeInitialLoad({
      catalog: {
        configured: true,
        reachable: true,
        store_url: "https://x",
        items: [
          { ...STORE_ITEM, key: "a", name: "Alpha Ext", category: "integrations", tags: ["commercial", "jira"] },
          { ...STORE_ITEM, key: "b", name: "Beta Ext", category: "regulations", tags: ["commercial", "dora"] },
        ],
      },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("Alpha Ext")).toBeInTheDocument());
    expect(screen.getByText("Integrations")).toBeInTheDocument();
    expect(screen.getByText("Regulations")).toBeInTheDocument();

    await userEvent.click(screen.getByText("jira"));
    expect(screen.getByText("Integrations")).toBeInTheDocument();
    expect(screen.queryByText("Regulations")).not.toBeInTheDocument();
    expect(screen.queryByText("Beta Ext")).not.toBeInTheDocument();
  });

  it("renders a flat grid with no section headings for a catalogue without categories", async () => {
    primeInitialLoad({
      catalog: {
        configured: true,
        reachable: true,
        store_url: "https://x",
        items: [STORE_ITEM, { ...STORE_ITEM, key: "b", name: "Beta Ext" }],
      },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("Beta Ext")).toBeInTheDocument());
    expect(screen.queryByRole("heading", { level: 3 })).not.toBeInTheDocument();
    expect(screen.queryByText("Other")).not.toBeInTheDocument();
  });

  it("shows no tag filter bar when the catalogue carries no tags", async () => {
    primeInitialLoad({
      catalog: { configured: true, reachable: true, store_url: "https://x", items: [STORE_ITEM] },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("ESG Content Pack")).toBeInTheDocument());
    expect(screen.queryByText("All")).not.toBeInTheDocument();
  });

  it("Buy opens the payment link with a claim token and starts polling", async () => {
    primeInitialLoad({
      catalog: { configured: true, reachable: true, store_url: "https://x", items: [STORE_ITEM] },
    });
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

    renderPage();
    await waitFor(() => expect(screen.getByText("ESG Content Pack")).toBeInTheDocument());

    await userEvent.click(screen.getByText("Buy", { selector: "button" }));
    expect(openSpy).toHaveBeenCalledTimes(1);
    const url = openSpy.mock.calls[0][0] as string;
    expect(url).toMatch(/^https:\/\/buy\.stripe\.test\/pl_1\?client_reference_id=[\w-]{16,}$/);
    // Waiting state shows on the card while the claim poll runs.
    expect(screen.getByText(/Waiting for payment confirmation/)).toBeInTheDocument();
    openSpy.mockRestore();
  });

  it(
    "claim poll sends the FULL client_reference_id incl. the instance suffix",
    async () => {
      // The store resolves the checkout by an EXACT client_reference_id
      // match: polling with the bare token while the session carries
      // token-instance never resolves — the "waiting for payment
      // confirmation forever" bug.
      primeInitialLoad({
        catalog: {
          configured: true,
          reachable: true,
          store_url: "https://x",
          items: [STORE_ITEM],
        },
        instanceId: "TEA-AAAA-AAAA-AAAM",
      });
      const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
      mockPost.mockResolvedValue({ status: "pending" });

      renderPage();
      await waitFor(() => expect(screen.getByText("ESG Content Pack")).toBeInTheDocument());
      await userEvent.click(screen.getByText("Buy", { selector: "button" }));

      // With a known instance id the checkout goes through the store's
      // server-created session endpoint (no typed instance field) …
      const url = new URL(openSpy.mock.calls[0][0] as string);
      expect(url.pathname).toBe("/checkout");
      expect(url.searchParams.get("kind")).toBe("buy");
      expect(url.searchParams.get("instance")).toBe("TEA-AAAA-AAAA-AAAM");
      // … and the session's client_reference_id is <ref>-<instance>, which
      // is exactly what the claim poll must send.
      const ref = `${url.searchParams.get("ref")}-TEA-AAAA-AAAA-AAAM`;

      // the first poll fires after CLAIM_POLL_MS (5s) of real time
      await waitFor(
        () =>
          expect(mockPost).toHaveBeenCalledWith("/admin/extensions/store/claim", {
            token: ref,
          }),
        { timeout: 7000 },
      );
      openSpy.mockRestore();
    },
    12000,
  );

  it("store card shows the live entitlement chip with the trial expiry date", async () => {
    const trialItem = {
      ...STORE_ITEM,
      installed_version: "1.0.0", // chip must show even while installed
      entitlement_state: "active",
      entitlement_trial: true,
      entitlement_expires_at: "2026-09-20T00:00:00Z",
      entitlement_auto_renew: false,
    };
    primeInitialLoad({
      catalog: { configured: true, reachable: true, store_url: "https://x", items: [trialItem] },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("ESG Content Pack")).toBeInTheDocument());
    // dates follow the app-wide configured format, not the browser locale
    expect(
      screen.getByText(
        `Trial until ${formatDateWith(DEFAULT_DATE_FORMAT, "2026-09-20T00:00:00Z")}`,
      ),
    ).toBeInTheDocument();
  });

  it("store card shows the renewal date for a paid yearly entitlement", async () => {
    const paidItem = {
      ...STORE_ITEM,
      entitlement_state: "active",
      entitlement_expires_at: "2027-08-21T00:00:00Z",
      entitlement_auto_renew: true,
    };
    primeInitialLoad({
      catalog: { configured: true, reachable: true, store_url: "https://x", items: [paidItem] },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("ESG Content Pack")).toBeInTheDocument());
    expect(screen.getByText(/Renews on/)).toBeInTheDocument();
  });

  it("shows the not-configured hint on the Store tab by default", async () => {
    primeInitialLoad();
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/No extension store is configured/)).toBeInTheDocument(),
    );
  });

  it("shows the unreachable hint when the store is configured but offline", async () => {
    primeInitialLoad({
      catalog: { configured: true, reachable: false, store_url: "https://x", items: [] },
    });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/store could not be reached/)).toBeInTheDocument(),
    );
  });

  // ---- compact tiles + the detail drawer --------------------------------

  it("opens the detail drawer from a tile and shows what the tile omits", async () => {
    primeInitialLoad({
      catalog: {
        configured: true,
        reachable: true,
        store_url: "https://x",
        items: [{ ...STORE_ITEM, long_description: "The long story.", homepage: "https://h" }],
      },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("ESG Content Pack")).toBeInTheDocument());

    // The tile carries the short description only.
    expect(screen.queryByText("The long story.")).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: /Open details for ESG Content Pack/ }),
    );
    expect(await screen.findByText("The long story.")).toBeInTheDocument();
    expect(screen.getByText("Source").closest("a")).toHaveAttribute("href", "https://h");
  });

  it("swaps the drawer's content when a different tile is opened", async () => {
    primeInitialLoad({
      catalog: {
        configured: true,
        reachable: true,
        store_url: "https://x",
        items: [
          { ...STORE_ITEM, long_description: "Alpha story." },
          {
            ...STORE_ITEM,
            key: "b-ext",
            name: "Beta Ext",
            long_description: "Beta story.",
          },
        ],
      },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("Beta Ext")).toBeInTheDocument());

    await userEvent.click(
      screen.getByRole("button", { name: /Open details for ESG Content Pack/ }),
    );
    expect(await screen.findByText("Alpha story.")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("Alpha story.")).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Open details for Beta Ext/ }));
    expect(await screen.findByText("Beta story.")).toBeInTheDocument();
    expect(screen.queryByText("Alpha story.")).not.toBeInTheDocument();
  });

  it("renders an installed extension's own logo on the Installed tab", async () => {
    primeInitialLoad({
      extensions: [{ ...SAMPLE_EXT, logo_url: "/api/v1/ext-assets/sample-ext/1.0.0/logo.png" }],
    });
    renderPage();
    await openInstalledTab();
    await waitFor(() => expect(screen.getByText("Sample Extension")).toBeInTheDocument());
    expect(
      document.querySelector('img[src="/api/v1/ext-assets/sample-ext/1.0.0/logo.png"]'),
    ).toBeInTheDocument();
  });

  // ---- the daily store check, made visible ------------------------------

  it("reports when the store was last checked", async () => {
    primeInitialLoad({
      catalog: { configured: true, reachable: true, store_url: "https://x", items: [STORE_ITEM] },
      storeCheck: STORE_CHECK,
    });
    renderPage();
    expect(await screen.findByText(/Store checked/)).toBeInTheDocument();
  });

  it("surfaces a failing store check instead of leaving it silent", async () => {
    // The whole point: without this, "I never get notified" cannot be told
    // apart from "the fetch has been refused for a fortnight".
    primeInitialLoad({
      catalog: { configured: true, reachable: true, store_url: "https://x", items: [STORE_ITEM] },
      storeCheck: { ...STORE_CHECK, error: "Store refused the request (HTTP 403)" },
    });
    renderPage();
    expect(
      await screen.findByText(/Store refused the request \(HTTP 403\)/),
    ).toBeInTheDocument();
  });

  it("runs the check on demand and reports what it found", async () => {
    primeInitialLoad({
      catalog: { configured: true, reachable: true, store_url: "https://x", items: [STORE_ITEM] },
      storeCheck: STORE_CHECK,
    });
    mockPost.mockImplementation(async (path: string) => {
      if (path === "/settings/extension-store-check")
        return { configured: true, disabled: false, new: 2, updates: 1, error: null };
      throw new Error(`unexpected POST ${path}`);
    });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Check now/ }));

    expect(mockPost).toHaveBeenCalledWith("/settings/extension-store-check", {});
    expect(await screen.findByText("2 new, 1 updated")).toBeInTheDocument();
  });

  it("says so when store notices are switched off", async () => {
    primeInitialLoad({
      catalog: { configured: true, reachable: true, store_url: "https://x", items: [STORE_ITEM] },
      storeCheck: { ...STORE_CHECK, enabled: false },
    });
    mockPost.mockImplementation(async () => ({ configured: true, disabled: true }));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Check now/ }));
    expect(await screen.findByText(/switched off/)).toBeInTheDocument();
  });
});
