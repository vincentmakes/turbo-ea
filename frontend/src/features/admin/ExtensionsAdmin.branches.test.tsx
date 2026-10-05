/**
 * ExtensionsAdmin branches beyond `ExtensionsAdmin.test.tsx`: page-load
 * failure, enable / disable, uninstall and license removal (confirm, cancel,
 * failure), the license dialog's file upload and failures, the entitlement
 * downgrade dialog's cancel paths, Buy / trial from the install gate, the
 * instance-ID copy chip, extension admin panels, and the apply step's 403
 * (license gate), 409 (version downgrade) and generic failures.
 *
 * Built on the shared test kit. The install pipeline polls every 2s with real
 * timers, so the tests that walk it wait up to 5s like the sibling file does.
 */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

import ExtensionsAdmin from "./ExtensionsAdmin";
import { ApiError } from "@/api/client";
import { mockApi } from "@/test/apiMock";
import { registerExtension, resetExtensionHost, UI_SDK_VERSION } from "@/lib/extensionHost";

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
  trial_link: "https://buy.stripe.test/trial_1",
  version: "1.0.0",
  installed_version: null,
  update_available: false,
  entitlement_state: "unlicensed",
};

const OFFLINE_CATALOG = { configured: false, reachable: false, store_url: "", items: [] };

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
  const user = userEvent.setup();
  const result = render(
    <MemoryRouter initialEntries={[path]}>
      <ExtensionsAdmin />
    </MemoryRouter>,
  );
  return { ...result, user };
}

beforeEach(() => {
  mockApi.reset();
  localStorage.clear();
  resetExtensionHost();
});

afterEach(() => {
  resetExtensionHost();
  vi.restoreAllMocks();
});

describe("ExtensionsAdmin — page state", () => {
  it("shows the load error when the extension list cannot be read", async () => {
    prime();
    mockApi.fail("get", "/admin/extensions", 500);
    renderPage();
    expect(await screen.findByText("GET /admin/extensions failed")).toBeInTheDocument();
  });

  it("still lists installed extensions when the catalogue and instance reads fail", async () => {
    prime();
    mockApi.fail("get", "/admin/extensions/store/catalog", 502);
    mockApi.fail("get", "/admin/extensions/instance", 500);
    renderPage();
    expect(await screen.findByText("Sample Extension")).toBeInTheDocument();
    expect(screen.queryByText(/Instance ID/)).not.toBeInTheDocument();
  });

  it("shows a failed license renewal as a page error", async () => {
    prime({
      extensions: [{ ...EXT, entitlement: { ...EXT.entitlement, state: "expired" } }],
    });
    mockApi.fail("post", "/admin/extensions/store/refresh-license", 502);
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: /Renew/ }));
    expect(await screen.findByText("POST /admin/extensions/store/refresh-license failed")).toBeInTheDocument();
  });

  it("copies the instance ID from its chip", async () => {
    prime({ instanceId: "TEA-ABCD-EFGH-JKLM" });
    const { user } = renderPage();
    const chip = await screen.findByText("Instance ID: TEA-ABCD-EFGH-JKLM");
    // After userEvent.setup(), which installs a clipboard stub of its own.
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await user.click(chip);
    expect(writeText).toHaveBeenCalledWith("TEA-ABCD-EFGH-JKLM");
  });

  it("renders admin panels contributed by installed UI extensions", async () => {
    prime();
    registerExtension("sample-ext", {
      key: "sample-ext",
      sdkVersion: UI_SDK_VERSION,
      adminPanels: [{ id: "cfg", label: "Sample settings", component: () => <p>panel body</p> }],
    });
    renderPage();
    expect(await screen.findByText("Sample settings")).toBeInTheDocument();
    expect(screen.getByText("panel body")).toBeInTheDocument();
  });
});

describe("ExtensionsAdmin — installed extensions", () => {
  it("disables an extension and reloads the list", async () => {
    let exts = [EXT];
    prime();
    mockApi.on("get", "/admin/extensions", () => exts);
    mockApi.on("put", "/admin/extensions/sample-ext/enabled", () => {
      exts = [{ ...EXT, enabled: false }];
      return {};
    });
    const { user } = renderPage();

    const toggle = await screen.findByRole("checkbox", { name: "Toggle extension" });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Toggle extension" })).not.toBeChecked());
    expect(mockApi.callsOf("put", "/admin/extensions/sample-ext/enabled")[0].body).toEqual({ enabled: false });
  });

  it("shows a failed toggle as a page error", async () => {
    prime();
    mockApi.fail("put", "/admin/extensions/sample-ext/enabled", 500);
    const { user } = renderPage();
    await user.click(await screen.findByRole("checkbox", { name: "Toggle extension" }));
    expect(await screen.findByText("PUT /admin/extensions/sample-ext/enabled failed")).toBeInTheDocument();
  });

  it("uninstalls after confirmation, and cancelling or Escape leaves it alone", async () => {
    let exts: unknown[] = [EXT];
    prime();
    mockApi.on("get", "/admin/extensions", () => exts);
    mockApi.on("delete", "/admin/extensions/sample-ext", () => {
      exts = [];
      return undefined;
    });
    const { user } = renderPage();

    await user.click(await screen.findByRole("button", { name: /Uninstall/ }));
    let dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Uninstall/ }));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("delete")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: /Uninstall/ }));
    dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Uninstall" }));
    expect(await screen.findByText("No extensions installed yet.")).toBeInTheDocument();
  });

  it("shows a failed uninstall as a page error", async () => {
    prime();
    mockApi.fail("delete", "/admin/extensions/sample-ext", 500);
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: /Uninstall/ }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Uninstall" }));
    expect(await screen.findByText("DELETE /admin/extensions/sample-ext failed")).toBeInTheDocument();
  });
});

/**
 * Before the license loads, the page shows the no-license hint with its own
 * "Enter license…" button, which is replaced once it does — so wait for the
 * licensee line rather than clicking whichever button shows first.
 */
async function openLicenseDialog(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText("Licensed to ACME Corp");
  await user.click(screen.getByRole("button", { name: "Enter license…" }));
}

/** jsdom's File has no `text()`; the page reads a license file through it. */
function licenseFile(text: string): File {
  const file = new File([text], "acme.tealic");
  Object.defineProperty(file, "text", { value: async () => text });
  return file;
}

describe("ExtensionsAdmin — license", () => {
  it("removes the license after confirmation and announces it", async () => {
    let lic: unknown = LICENSE;
    prime();
    mockApi.on("get", "/admin/extensions/license", () => {
      if (!lic) throw new ApiError("none", 404, null);
      return lic;
    });
    mockApi.on("delete", "/admin/extensions/license", () => {
      lic = null;
      return undefined;
    });
    const { user } = renderPage();

    await user.click(await screen.findByRole("button", { name: "Remove license" }));
    let dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Remove license" }));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Remove license" }));
    dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Remove license$/ }));
    const notice = await screen.findByText(/License removed\./);
    await waitFor(() => expect(screen.getByText(/No license installed/)).toBeInTheDocument());
    // The confirmation closes after the reload; until then the page is inert.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(within(notice.closest("[role=alert]") as HTMLElement).getByRole("button", { name: /close/i }));
    expect(screen.queryByText(/License removed\./)).not.toBeInTheDocument();
  });

  it("shows a failed license removal as a page error", async () => {
    prime();
    mockApi.fail("delete", "/admin/extensions/license", 500);
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Remove license" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /Remove license$/ }));
    expect(await screen.findByText("DELETE /admin/extensions/license failed")).toBeInTheDocument();
  });

  it("applies a license from a file, and shows an apply failure in the dialog", async () => {
    prime();
    let fail = true;
    mockApi.on("put", "/admin/extensions/license", () => {
      if (fail) throw new ApiError("License signature invalid", 400, "bad");
      return {};
    });
    const { user } = renderPage();

    await openLicenseDialog(user);
    const dialog = await screen.findByRole("dialog");
    const fileInput = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    const clicked = vi.fn();
    fileInput.addEventListener("click", clicked);
    await user.click(within(dialog).getByRole("button", { name: /Upload license file/ }));
    expect(clicked).toHaveBeenCalled();

    await user.upload(fileInput, licenseFile("LICENSE-TEXT"));
    expect(await within(dialog).findByText("License signature invalid")).toBeInTheDocument();
    expect(mockApi.callsOf("put", "/admin/extensions/license")[0].body).toEqual({
      text: "LICENSE-TEXT",
      confirm: false,
    });

    fail = false;
    await user.upload(fileInput, licenseFile("LICENSE-TEXT"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("cancels the entitlement-downgrade warning without applying", async () => {
    prime();
    mockApi.fail("put", "/admin/extensions/license", 409, {
      code: "entitlement_downgrade",
      dropped: ["sample-ext", "gone-ext"],
    });
    const { user } = renderPage();

    await openLicenseDialog(user);
    await user.type(await screen.findByPlaceholderText("Paste license text here…"), "narrow");
    await user.click(screen.getByRole("button", { name: /Apply license/ }));

    expect(await screen.findByText("This license drops active entitlements")).toBeInTheDocument();
    const warning = screen.getByText("This license drops active entitlements").closest("[role=dialog]") as HTMLElement;
    // An installed key resolves to its name; an unknown one shows as the key.
    expect(within(warning).getByText("Sample Extension")).toBeInTheDocument();
    expect(within(warning).getByText("gone-ext")).toBeInTheDocument();
    await user.click(within(warning).getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByText("This license drops active entitlements")).not.toBeInTheDocument(),
    );
    expect(mockApi.callsOf("put", "/admin/extensions/license")).toHaveLength(1);

    // Escape dismisses it as well.
    await user.click(screen.getByRole("button", { name: /Apply license/ }));
    await screen.findByText("This license drops active entitlements");
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByText("This license drops active entitlements")).not.toBeInTheDocument(),
    );
  });
});

describe("ExtensionsAdmin — install gate checkout", () => {
  const CATALOG = { configured: true, reachable: true, store_url: "", items: [STORE_ITEM] };

  it("starts a trial straight from a store tile", async () => {
    prime({ catalog: CATALOG, license: null });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { user } = renderPage("/admin/extensions");

    await user.click(await screen.findByRole("button", { name: /Try free/ }));
    expect(open.mock.calls[0][0]).toMatch(/^https:\/\/buy\.stripe\.test\/trial_1\?client_reference_id=/);
  });

  /** An installed but unlicensed extension whose update opens the gate. */
  function primeGatedUpdate() {
    prime({
      extensions: [
        {
          ...EXT,
          key: "esg-pack",
          name: "ESG Content Pack",
          entitlement: { state: "expired", plan: null, expires_at: null, grace_until: null },
        },
      ],
      catalog: {
        ...CATALOG,
        items: [{ ...STORE_ITEM, installed_version: "1.0.0", update_available: true, version: "1.1.0" }],
      },
    });
  }

  it("offers a trial in the license gate of an unlicensed update", async () => {
    primeGatedUpdate();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { user } = renderPage();

    await user.click(await screen.findByText("Update to 1.1.0"));
    const gate = await screen.findByRole("dialog");
    expect(within(gate).getByText("License required")).toBeInTheDocument();
    await user.click(within(gate).getByRole("button", { name: /Start 30-day trial/ }));
    expect(open.mock.calls[0][0]).toMatch(/^https:\/\/buy\.stripe\.test\/trial_1\?client_reference_id=/);
    // The gate now waits for the checkout instead of offering it again.
    expect(await within(gate).findByText(/Waiting for payment confirmation/)).toBeInTheDocument();
    expect(within(gate).queryByRole("button", { name: /Start 30-day trial/ })).not.toBeInTheDocument();
  });

  it("buys from the license gate at the listed price", async () => {
    primeGatedUpdate();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { user } = renderPage();

    await user.click(await screen.findByText("Update to 1.1.0"));
    const gate = await screen.findByRole("dialog");
    await user.click(within(gate).getByRole("button", { name: /Buy — 990 EUR \/ year/ }));
    expect(open.mock.calls[0][0]).toMatch(/^https:\/\/buy\.stripe\.test\/pl_1\?client_reference_id=/);
  });

  it("shows a failed store install in the install dialog", async () => {
    prime({ catalog: { ...CATALOG, items: [{ ...STORE_ITEM, entitlement_state: "active" }] } });
    mockApi.fail("post", "/admin/extensions/store/install", 502, "store down");
    const { user } = renderPage("/admin/extensions");

    await user.click(await screen.findByText("Install", { selector: "button" }));
    expect(await screen.findByText("POST /admin/extensions/store/install failed")).toBeInTheDocument();
  });

  it("deselects a tag pill on a second click", async () => {
    prime({
      catalog: {
        ...CATALOG,
        items: [
          { ...STORE_ITEM, key: "a", name: "Alpha Ext", tags: ["integration"] },
          { ...STORE_ITEM, key: "b", name: "Beta Ext", tags: ["free"] },
        ],
      },
    });
    const { user } = renderPage("/admin/extensions");
    await screen.findByText("Alpha Ext");

    await user.click(screen.getByText("integration"));
    expect(screen.queryByText("Beta Ext")).not.toBeInTheDocument();
    await user.click(screen.getByText("integration"));
    expect(screen.getByText("Beta Ext")).toBeInTheDocument();
  });
});

describe("ExtensionsAdmin — applying an uploaded bundle", () => {
  const PREVIEWED = {
    id: "i1",
    filename: "sample.teax",
    status: "previewed",
    extension_key: "sample-ext",
    extension_version: "1.0.0",
    diff: { totals: { created: 1, updated: 0, skipped: 0, conflict: 0, failed: 0 } },
  };

  /** Upload a bundle and wait for its preview's "Install extension" button. */
  async function uploadAndPreview(previewed: Record<string, unknown> = PREVIEWED) {
    prime();
    mockApi.on("upload", "/admin/extensions/install", { id: "i1", filename: "sample.teax", status: "verifying" });
    mockApi.on("get", "/admin/extensions/install/i1", previewed);
    mockApi.on("delete", "/admin/extensions/install/i1", undefined);
    const rendered = renderPage("/admin/extensions");
    await screen.findByText("Install from file…", { selector: "button" });
    const input = rendered.container.querySelector('input[type="file"]') as HTMLInputElement;
    await rendered.user.upload(input, new File(["zip"], "sample.teax"));
    await waitFor(
      () => expect(screen.getByText("Install extension", { selector: "button" })).toBeInTheDocument(),
      { timeout: 5000 },
    );
    return rendered;
  }

  it("opens the license gate on a 403 and cancels back to the preview", async () => {
    const { user } = await uploadAndPreview();
    mockApi.fail("post", "/admin/extensions/install/i1/apply", 403, "unlicensed");

    await user.click(screen.getByText("Install extension", { selector: "button" }));
    expect(await screen.findByText(/verified but needs a license to finish installing/)).toBeInTheDocument();
    const gate = screen.getByText("License required").closest("[role=dialog]") as HTMLElement;
    await user.click(within(gate).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText("License required")).not.toBeInTheDocument());
    expect(screen.getByText("Install extension", { selector: "button" })).toBeInTheDocument();
  }, 10000);

  it("asks before installing over a newer version when the server flags a downgrade", async () => {
    const { user } = await uploadAndPreview();
    mockApi.fail("post", "/admin/extensions/install/i1/apply", 409, {
      code: "version_downgrade",
      installed: "2.0.0",
      bundle: "1.0.0",
    });

    await user.click(screen.getByText("Install extension", { selector: "button" }));
    expect(await screen.findByText("Install an older version?")).toBeInTheDocument();
    expect(screen.getByText(/version 1\.0\.0 over the currently installed 2\.0\.0/)).toBeInTheDocument();
    const confirm = screen.getByText("Install an older version?").closest("[role=dialog]") as HTMLElement;
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText("Install an older version?")).not.toBeInTheDocument());
  }, 10000);

  it("confirms a downgrade the preview already knew about, applying with the flag", async () => {
    const { user } = await uploadAndPreview({
      ...PREVIEWED,
      diff: { ...PREVIEWED.diff, downgrade: { from: "2.0.0", to: "1.0.0" } },
    });
    mockApi.on("post", "/admin/extensions/install/i1/apply", { ...PREVIEWED, status: "applying" });

    await user.click(screen.getByText("Install extension", { selector: "button" }));
    expect(await screen.findByText("Install an older version?")).toBeInTheDocument();
    // Escape dismisses without applying…
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("Install an older version?")).not.toBeInTheDocument());
    expect(mockApi.callsOf("post", "/admin/extensions/install/i1/apply")).toHaveLength(0);

    // …and confirming applies with the downgrade acknowledged.
    await user.click(screen.getByText("Install extension", { selector: "button" }));
    await user.click(await screen.findByRole("button", { name: /Install older version/ }));
    await waitFor(() => expect(mockApi.callsOf("post", "/admin/extensions/install/i1/apply")).toHaveLength(1));
    expect(mockApi.callsOf("post", "/admin/extensions/install/i1/apply")[0].body).toEqual({
      confirm_downgrade: true,
    });
  }, 10000);

  it("shows any other apply failure inside the install dialog", async () => {
    const { user } = await uploadAndPreview();
    mockApi.fail("post", "/admin/extensions/install/i1/apply", 500);

    await user.click(screen.getByText("Install extension", { selector: "button" }));
    expect(
      await within(screen.getByRole("dialog")).findByText("POST /admin/extensions/install/i1/apply failed"),
    ).toBeInTheDocument();
  }, 10000);

  it("reports a failing status poll", async () => {
    prime();
    mockApi.on("upload", "/admin/extensions/install", { id: "i1", filename: "sample.teax", status: "verifying" });
    mockApi.fail("get", "/admin/extensions/install/i1", 500);
    const { container, user } = renderPage("/admin/extensions");
    await screen.findByText("Install from file…", { selector: "button" });
    await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, new File(["zip"], "x.teax"));
    expect(
      await screen.findByText("GET /admin/extensions/install/i1 failed", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  }, 10000);
});

describe("ExtensionsAdmin — one-click store install stops for review", () => {
  it("stops at the preview when the dry run reported failures", async () => {
    prime({
      catalog: {
        configured: true,
        reachable: true,
        store_url: "",
        items: [{ ...STORE_ITEM, entitlement_state: "active" }],
      },
    });
    mockApi.on("post", "/admin/extensions/store/install", { id: "s1", filename: "esg.teax", status: "verifying" });
    mockApi.on("get", "/admin/extensions/install/s1", {
      id: "s1",
      filename: "esg.teax",
      status: "previewed",
      diff: { totals: { created: 0, updated: 0, skipped: 0, conflict: 0, failed: 2 } },
    });
    const { user } = renderPage("/admin/extensions");

    await user.click(await screen.findByText("Install", { selector: "button" }));
    await waitFor(
      () => expect(screen.getByText("Install extension", { selector: "button" })).toBeInTheDocument(),
      { timeout: 5000 },
    );
    expect(mockApi.callsOf("post", /\/apply$/)).toHaveLength(0);
  }, 10000);

  it("fetches the store's notes for an update whose bundle carries none, and Escape declines it", async () => {
    const UPDATE = {
      ...STORE_ITEM,
      entitlement_state: "active",
      installed_version: "1.0.0",
      update_available: true,
      version: "1.1.0",
    };
    prime({ catalog: { configured: true, reachable: true, store_url: "", items: [UPDATE] } });
    mockApi.on("post", "/admin/extensions/store/install", { id: "s1", filename: "esg.teax", status: "verifying" });
    mockApi.on("get", "/admin/extensions/install/s1", {
      id: "s1",
      filename: "esg.teax",
      status: "previewed",
      extension_key: "esg-pack",
      diff: { changelog: { version: "1.1.0", from_version: "1.0.0", notes: "", source: "bundle" } },
    });
    mockApi.on("get", /^\/admin\/extensions\/store\/changelog\/esg-pack\?/, {
      version: "1.1.0",
      from_version: "1.0.0",
      notes: "## 1.1.0\n\n- Store-side release notes.",
      source: "store",
    });
    mockApi.on("delete", "/admin/extensions/install/s1", undefined);
    const { user } = renderPage("/admin/extensions");

    await user.click(await screen.findByText("Update to 1.1.0", { selector: "button" }));
    await waitFor(
      () => expect(screen.getByText("Update ESG Content Pack to 1.1.0?")).toBeInTheDocument(),
      { timeout: 5000 },
    );
    expect(await screen.findByText(/Store-side release notes/)).toBeInTheDocument();
    expect(mockApi.callsOf("get", /store\/changelog/)[0].path).toBe(
      "/admin/extensions/store/changelog/esg-pack?version=1.1.0&from_version=1.0.0",
    );

    await act(async () => {
      await user.keyboard("{Escape}");
    });
    await waitFor(() => expect(mockApi.callsOf("delete", "/admin/extensions/install/s1")).toHaveLength(1));
    expect(mockApi.callsOf("post", /\/apply$/)).toHaveLength(0);
  }, 10000);
});
