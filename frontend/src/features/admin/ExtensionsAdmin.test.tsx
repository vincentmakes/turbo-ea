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

  it("lists installed extensions with entitlement chips", async () => {
    primeInitialLoad({ extensions: [SAMPLE_EXT], license: LICENSE });
    render(<ExtensionsAdmin />);
    await openInstalledTab();
    await waitFor(() => expect(screen.getByText("Sample Extension")).toBeInTheDocument());
    expect(screen.getByText("Licensed to ACME Corp")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Installed", { selector: ".MuiChip-label" })).toBeInTheDocument();
  });

  it("shows the restart banner for extensions with runtime code", async () => {
    primeInitialLoad({
      extensions: [{ ...SAMPLE_EXT, status: "needs_restart", capabilities: ["backend"] }],
      license: LICENSE,
    });
    render(<ExtensionsAdmin />);
    await waitFor(() =>
      expect(screen.getByText(/Restart the backend container/)).toBeInTheDocument(),
    );
  });

  it("applies a pasted license", async () => {
    primeInitialLoad();
    mockPut.mockResolvedValue(LICENSE);
    render(<ExtensionsAdmin />);
    await openInstalledTab();
    await waitFor(() =>
      expect(screen.getByText("No extensions installed yet.")).toBeInTheDocument(),
    );

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

  it("surfaces a rejected license as an error", async () => {
    primeInitialLoad();
    mockPut.mockRejectedValue(new Error("Invalid license: signature verification failed"));
    render(<ExtensionsAdmin />);
    await openInstalledTab();
    await waitFor(() =>
      expect(screen.getByText("No extensions installed yet.")).toBeInTheDocument(),
    );
    await userEvent.type(screen.getByPlaceholderText("Paste license text here…"), "garbage");
    await userEvent.click(screen.getByText("Apply license"));
    await waitFor(() =>
      expect(
        screen.getByText(/signature verification failed/),
      ).toBeInTheDocument(),
    );
  });

  it("uploads a bundle, shows the preview, and installs it", async () => {
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
    await openInstalledTab();
    await waitFor(() => expect(screen.getByText("Licensed to ACME Corp")).toBeInTheDocument());

    const inputs = container.querySelectorAll('input[type="file"]');
    const bundleInput = inputs[1] as HTMLInputElement; // [0] = license file input
    await userEvent.upload(bundleInput, new File(["zip"], "sample.teax"));

    await waitFor(
      () => expect(screen.getByText("Install extension", { selector: "button" })).toBeInTheDocument(),
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
    await openInstalledTab();
    await waitFor(() =>
      expect(screen.getByText("No extensions installed yet.")).toBeInTheDocument(),
    );
    const inputs = container.querySelectorAll('input[type="file"]');
    await userEvent.upload(inputs[1] as HTMLInputElement, new File(["zip"], "evil.teax"));

    await waitFor(
      () =>
        expect(
          screen.getByText(/was not signed by the trusted vendor key/),
        ).toBeInTheDocument(),
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
    expect(screen.getByText(/Data it created/)).toBeInTheDocument();
  });

  it("shows the not-configured hint on the Store tab by default", async () => {
    primeInitialLoad();
    render(<ExtensionsAdmin />);
    await waitFor(() =>
      expect(screen.getByText(/No extension store is configured/)).toBeInTheDocument(),
    );
  });

  it("renders catalogue items with Buy opening the payment link in a new tab", async () => {
    primeInitialLoad({
      catalog: { configured: true, reachable: true, store_url: "https://x", items: [STORE_ITEM] },
    });
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

    render(<ExtensionsAdmin />);
    await waitFor(() => expect(screen.getByText("ESG Content Pack")).toBeInTheDocument());
    expect(screen.getByText("990 EUR / year")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Buy", { selector: "button" }));
    expect(openSpy).toHaveBeenCalledWith("https://buy.stripe.test/pl_1", "_blank", "noopener");
    openSpy.mockRestore();
  });

  it("installs from the store through the shared preview pipeline", async () => {
    const licensedItem = { ...STORE_ITEM, entitlement_state: "active" };
    const previewed = {
      id: "s1",
      filename: "esg-pack-1.0.0.teax",
      status: "previewed",
      extension_key: "esg-pack",
      extension_version: "1.0.0",
      diff: {
        dry_run: true,
        sections: [],
        totals: { created: 3, updated: 0, skipped: 0, conflict: 0, failed: 0 },
      },
    };
    mockGet.mockImplementation(async (path: string) => {
      if (path === "/admin/extensions") return [];
      if (path === "/admin/extensions/license") return LICENSE;
      if (path === "/admin/extensions/store/catalog")
        return { configured: true, reachable: true, store_url: "https://x", items: [licensedItem] };
      if (path.startsWith("/admin/extensions/install/")) return previewed;
      throw new Error(`unexpected GET ${path}`);
    });
    mockPost.mockResolvedValue({ id: "s1", filename: "esg-pack-1.0.0.teax", status: "verifying" });

    render(<ExtensionsAdmin />);
    await waitFor(() => expect(screen.getByText("ESG Content Pack")).toBeInTheDocument());
    // Licensed item shows no Buy button.
    expect(screen.queryByText("Buy", { selector: "button" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("Install", { selector: "button" }));
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith("/admin/extensions/store/install", {
        key: "esg-pack",
      }),
    );
    await waitFor(
      () => expect(screen.getByText("Install extension", { selector: "button" })).toBeInTheDocument(),
      { timeout: 4000 },
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
