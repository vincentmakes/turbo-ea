import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
}));
vi.mock("@/hooks/useMetamodel", () => ({
  invalidateCache: vi.fn().mockResolvedValue(undefined),
}));

import { api } from "@/api/client";

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
} = {}) {
  mockGet.mockImplementation(async (path: string) => {
    if (path === "/admin/extensions") return extensions;
    if (path === "/admin/extensions/license") {
      if (license) return license;
      throw new Error("No license installed");
    }
    if (path === "/admin/extensions/store/catalog") return catalog;
    throw new Error(`unexpected GET ${path}`);
  });
}

async function openInstalledTab() {
  await userEvent.click(screen.getByRole("tab", { name: "Installed" }));
}

describe("ExtensionsAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the empty state and the no-license hint on the Installed tab", async () => {
    primeInitialLoad();
    render(<ExtensionsAdmin />);
    await openInstalledTab();
    await waitFor(() =>
      expect(screen.getByText("No extensions installed yet.")).toBeInTheDocument(),
    );
    expect(screen.getByText(/No license installed/)).toBeInTheDocument();
  });

  it("lists installed extensions with entitlement chips and licensee summary", async () => {
    primeInitialLoad({ extensions: [SAMPLE_EXT], license: LICENSE });
    render(<ExtensionsAdmin />);
    await openInstalledTab();
    await waitFor(() => expect(screen.getByText("Sample Extension")).toBeInTheDocument());
    expect(screen.getByText("Licensed to ACME Corp")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    // Active entitlement → no Renew button on the row.
    expect(screen.queryByText("Renew", { selector: "button" })).not.toBeInTheDocument();
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
    render(<ExtensionsAdmin />);
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
    render(<ExtensionsAdmin />);
    await openInstalledTab();
    await waitFor(() => expect(screen.getByText("Sample Extension")).toBeInTheDocument());

    await userEvent.click(screen.getByText("Renew", { selector: "button" }));
    await waitFor(() => expect(screen.getByText("Apply a license")).toBeInTheDocument());
  });

  it("applies a pasted license through the dialog", async () => {
    primeInitialLoad();
    mockPut.mockResolvedValue(LICENSE);
    render(<ExtensionsAdmin />);
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
      }),
    );
    await waitFor(() => expect(screen.getByText("Licensed to ACME Corp")).toBeInTheDocument());
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

    const { container } = render(<ExtensionsAdmin />);
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

    const { container } = render(<ExtensionsAdmin />);
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
    render(<ExtensionsAdmin />);
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
    render(<ExtensionsAdmin />);
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
    render(<ExtensionsAdmin />);
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

    render(<ExtensionsAdmin />);
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
    render(<ExtensionsAdmin />);
    await waitFor(() => expect(screen.getByText("No Demo Pack")).toBeInTheDocument());

    const demoLinks = screen.getAllByText("See it in action");
    expect(demoLinks).toHaveLength(1);
    expect(demoLinks[0].closest("a")).toHaveAttribute("href", "https://youtu.be/demo");
    expect(demoLinks[0].closest("a")).toHaveAttribute("target", "_blank");
  });

  it("Buy opens the payment link with a claim token and starts polling", async () => {
    primeInitialLoad({
      catalog: { configured: true, reachable: true, store_url: "https://x", items: [STORE_ITEM] },
    });
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

    render(<ExtensionsAdmin />);
    await waitFor(() => expect(screen.getByText("ESG Content Pack")).toBeInTheDocument());

    await userEvent.click(screen.getByText("Buy", { selector: "button" }));
    expect(openSpy).toHaveBeenCalledTimes(1);
    const url = openSpy.mock.calls[0][0] as string;
    expect(url).toMatch(/^https:\/\/buy\.stripe\.test\/pl_1\?client_reference_id=[\w-]{16,}$/);
    // Waiting state shows on the card while the claim poll runs.
    expect(screen.getByText(/Waiting for payment confirmation/)).toBeInTheDocument();
    openSpy.mockRestore();
  });

  it("shows the not-configured hint on the Store tab by default", async () => {
    primeInitialLoad();
    render(<ExtensionsAdmin />);
    await waitFor(() =>
      expect(screen.getByText(/No extension store is configured/)).toBeInTheDocument(),
    );
  });

  it("shows the unreachable hint when the store is configured but offline", async () => {
    primeInitialLoad({
      catalog: { configured: true, reachable: false, store_url: "https://x", items: [] },
    });
    render(<ExtensionsAdmin />);
    await waitFor(() =>
      expect(screen.getByText(/store could not be reached/)).toBeInTheDocument(),
    );
  });
});
