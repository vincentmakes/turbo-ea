import { render, screen, waitFor } from "@testing-library/react";
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
} = {}) {
  mockGet.mockImplementation(async (path: string) => {
    if (path === "/admin/extensions") return extensions;
    if (path === "/admin/extensions/license") {
      if (license) return license;
      throw new Error("No license installed");
    }
    if (path === "/admin/extensions/store/catalog") return catalog;
    if (path === "/admin/extensions/instance") return { instance_id: instanceId };
    throw new Error(`unexpected GET ${path}`);
  });
}

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
    expect(screen.getByText("CardTypes")).toBeInTheDocument();
    expect(screen.getByText("1 created")).toBeInTheDocument();
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

    const demoLinks = screen.getAllByText("See it in action");
    expect(demoLinks).toHaveLength(1);
    expect(demoLinks[0].closest("a")).toHaveAttribute("href", "https://youtu.be/demo");
    expect(demoLinks[0].closest("a")).toHaveAttribute("target", "_blank");
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

    // model tags render in the filter bar ONLY — on the card they would just
    // repeat the Free chip / price, so cards carry topical tags alone
    expect(screen.getAllByText("free")).toHaveLength(1);
    expect(screen.getAllByText("commercial")).toHaveLength(1);
    expect(screen.getAllByText("integration")).toHaveLength(2); // bar + Alpha card

    // one pill narrows the grid (the pill renders in the bar AND on the card)
    await userEvent.click(screen.getAllByText("integration")[0]);
    expect(screen.getByText("Alpha Ext")).toBeInTheDocument();
    expect(screen.queryByText("Beta Ext")).not.toBeInTheDocument();

    // a second pill ANDs with the first — nothing carries both
    await userEvent.click(screen.getAllByText("free")[0]);
    expect(screen.queryByText("Alpha Ext")).not.toBeInTheDocument();
    expect(
      screen.getByText("No extensions match the selected categories."),
    ).toBeInTheDocument();

    // «All» resets the filter
    await userEvent.click(screen.getByText("All"));
    expect(screen.getByText("Alpha Ext")).toBeInTheDocument();
    expect(screen.getByText("Beta Ext")).toBeInTheDocument();
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
});
