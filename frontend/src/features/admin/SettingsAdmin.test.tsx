/**
 * Page test for Admin → Settings.
 *
 * The General tab is the page's own code and is driven for real; every lazy
 * sub-tab is a marker so the tab routing can be asserted without mounting
 * ten more admin pages. The boot-time singleton hooks are mocked so each
 * `invalidate*` broadcast is a `vi.fn` the tests can assert on — the page's
 * contract is "PATCH the setting, then tell every mounted consumer".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";

import i18n from "@/i18n";
import { SUPPORTED_LOCALES } from "@/i18n";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
vi.mock("@/hooks/useGrcEnabled", () => import("@/test/hooks").then((m) => m.useGrcEnabledModule()));
vi.mock("@/hooks/useFileUploadsEnabled", () =>
  import("@/test/hooks").then((m) => m.useFileUploadsEnabledModule()),
);

// Hooks without a factory in `@/test/hooks`: the real module with the
// broadcast replaced, so the constants (`DEFAULT_APP_TITLE`, …) stay real.
const h = vi.hoisted(() => ({
  currencyInvalidate: vi.fn(),
  invalidateAppTitle: vi.fn(),
  invalidateSponsorButtonEnabled: vi.fn(),
  invalidateArchiveRetentionDays: vi.fn(),
  invalidateLoginBranding: vi.fn(),
  localesInvalidate: vi.fn(),
  /** Stable array — the page keys an effect on its identity. */
  enabledLocales: [] as string[],
}));

vi.mock("@/hooks/useCurrency", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useCurrency")>("@/hooks/useCurrency");
  return {
    ...actual,
    useCurrency: () => ({
      currency: "USD",
      symbol: "$",
      loading: false,
      fmt: { format: (v: number) => `$${v}` },
      fmtShort: (v: number) => `$${v}`,
      invalidate: h.currencyInvalidate,
    }),
  };
});
vi.mock("@/hooks/useAppTitle", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useAppTitle")>("@/hooks/useAppTitle");
  return { ...actual, invalidateAppTitle: h.invalidateAppTitle };
});
vi.mock("@/hooks/useSponsorButtonEnabled", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useSponsorButtonEnabled")>(
    "@/hooks/useSponsorButtonEnabled",
  );
  return { ...actual, invalidateSponsorButtonEnabled: h.invalidateSponsorButtonEnabled };
});
vi.mock("@/hooks/useArchiveRetentionDays", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useArchiveRetentionDays")>(
    "@/hooks/useArchiveRetentionDays",
  );
  return { ...actual, invalidateArchiveRetentionDays: h.invalidateArchiveRetentionDays };
});
vi.mock("@/hooks/useLoginBranding", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useLoginBranding")>(
    "@/hooks/useLoginBranding",
  );
  return { ...actual, invalidateLoginBranding: h.invalidateLoginBranding };
});
vi.mock("@/hooks/useNavbarStyle", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useNavbarStyle")>(
    "@/hooks/useNavbarStyle",
  );
  return { ...actual, useNavbarStyle: () => ({ bg: "#112233", fg: "#ffffff" }) };
});
vi.mock("@/hooks/useEnabledLocales", () => ({
  useEnabledLocales: () => ({
    enabledLocales: h.enabledLocales,
    invalidateEnabledLocales: h.localesInvalidate,
  }),
}));

// The lazy sub-tabs are other pages with their own tests; here they are markers.
vi.mock("./AuthAdmin", () => ({ default: () => <div data-testid="tab-auth" /> }));
vi.mock("./EolAdmin", () => ({ default: () => <div data-testid="tab-eol" /> }));
vi.mock("./WebPortalsAdmin", () => ({ default: () => <div data-testid="tab-web-portals" /> }));
vi.mock("./IntegrationsHub", () => ({ default: () => <div data-testid="tab-integrations" /> }));
vi.mock("./AiAdmin", () => ({ default: () => <div data-testid="tab-ai" /> }));
vi.mock("./TurboLensAdmin", () => ({ default: () => <div data-testid="tab-turbolens" /> }));
vi.mock("./MigrationHub", () => ({ default: () => <div data-testid="tab-migration" /> }));
vi.mock("./AuditLogAdmin", () => ({ default: () => <div data-testid="tab-audit-log" /> }));
vi.mock("./ResourcesAdmin", () => ({ default: () => <div data-testid="tab-resources" /> }));
vi.mock("./NavbarStyleCard", () => ({
  default: ({ onSaved }: { onSaved: (m: string) => void }) => (
    <button type="button" data-testid="navbar-style-card" onClick={() => onSaved("navbar saved")} />
  ),
}));
vi.mock("@/components/SponsorshipDialog", () => ({
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="sponsor-dialog" /> : null),
}));

import { invalidateCache as invalidateMetamodel } from "@/hooks/useMetamodel";
import { invalidateDateFormat, DEFAULT_DATE_FORMAT } from "@/hooks/useDateFormat";
import { invalidateGrcEnabled } from "@/hooks/useGrcEnabled";
import { invalidateFileUploadsEnabled } from "@/hooks/useFileUploadsEnabled";
import { mockApi } from "@/test/apiMock";
import { installCanvas } from "@/test/dom";
import { hookState } from "@/test/hooks";
import { renderWithProviders } from "@/test/render";

import SettingsAdmin from "./SettingsAdmin";

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`admin:${key}`, opts) as string;
const tc = (key: string) => i18n.t(`common:${key}`) as string;

/**
 * A `startIcon` button's accessible name is the Material Symbol ligature
 * text followed by the label ("save" + "Save"), so a button is matched on
 * how its name ends, never on the bare label.
 */
const endsWith = (label: string) => new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

const BOOTSTRAP = {
  currency: "USD",
  date_format: DEFAULT_DATE_FORMAT,
  app_title: "Acme EA",
  bpm_enabled: true,
  bpm_require_separate_approver: false,
  ppm_enabled: false,
  grc_enabled: true,
  sponsor_button_enabled: true,
  update_check_enabled: true,
  announce_upgrades_enabled: true,
  extension_notices_enabled: true,
  file_uploads_enabled: true,
  enabled_locales: [...SUPPORTED_LOCALES],
  fiscal_year_start: 1,
  archive_retention_days: 30,
  login_tagline: "Welcome",
  login_tagline_hidden: false,
  login_help_text: "",
  login_help_link: "",
};

const EMAIL = {
  method: "smtp_basic",
  smtp_host: "",
  smtp_port: 587,
  smtp_user: "",
  smtp_password: "",
  smtp_from: "noreply@turboea.local",
  smtp_tls: true,
  app_base_url: "",
  oauth_provider: "microsoft",
  oauth_tenant_id: "",
  oauth_client_id: "",
  oauth_client_secret: "",
  graph_sender: "",
  oauth_scope: "",
  oauth_token_endpoint: "",
  service_account_json: "",
  configured: false,
};

function scriptLoad(overrides: {
  bootstrap?: Partial<typeof BOOTSTRAP>;
  email?: Partial<typeof EMAIL>;
  logo?: boolean;
  favicon?: boolean;
} = {}) {
  mockApi.on("get", "/settings/bootstrap", { ...BOOTSTRAP, ...overrides.bootstrap });
  mockApi.on("get", "/settings/email", { ...EMAIL, ...overrides.email });
  mockApi.on("get", "/settings/logo/info", {
    has_custom_logo: overrides.logo ?? false,
    mime_type: "image/png",
  });
  mockApi.on("get", "/settings/favicon/info", {
    has_custom_favicon: overrides.favicon ?? false,
    mime_type: "image/png",
  });
}

/** The General tab, once its four reads have landed. */
async function renderGeneral(route = "/admin/settings") {
  const result = renderWithProviders(<SettingsAdmin />, { route });
  await screen.findByRole("heading", { name: t("settings.currency.title") });
  return result;
}

/** `within()` the card whose h6 heading is `title`. */
function section(title: string) {
  const heading = screen.getByRole("heading", { name: title });
  const paper = heading.closest(".MuiPaper-root");
  if (!paper) throw new Error(`no Paper around heading "${title}"`);
  return within(paper as HTMLElement);
}

async function pickOption(
  user: ReturnType<typeof renderWithProviders>["user"],
  combobox: HTMLElement,
  option: RegExp | string,
) {
  await user.click(combobox);
  await user.click(await screen.findByRole("option", { name: option }));
}

// The currency list probes glyph support through a canvas (`currencySymbolOverride`);
// jsdom has none, and the probe is guarded, so this only keeps the log clean.
let restoreCanvas: () => void = () => {};

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  vi.clearAllMocks();
  restoreCanvas = installCanvas();
  h.enabledLocales = [...SUPPORTED_LOCALES];
  scriptLoad();
});

afterEach(() => {
  restoreCanvas();
  vi.useRealTimers();
});

describe("SettingsAdmin — initial load", () => {
  it("reads the four settings routes once and renders what they return", async () => {
    scriptLoad({
      bootstrap: { ppm_enabled: true, archive_retention_days: 45 },
      email: { configured: true, smtp_host: "smtp.acme.test" },
      logo: true,
    });
    await renderGeneral();

    for (const path of [
      "/settings/bootstrap",
      "/settings/email",
      "/settings/logo/info",
      "/settings/favicon/info",
    ]) {
      expect(mockApi.callsOf("get", path)).toHaveLength(1);
    }

    expect(screen.getByDisplayValue("Acme EA")).toBeInTheDocument();
    expect(screen.getByDisplayValue("smtp.acme.test")).toBeInTheDocument();
    expect(section(t("settings.logo.title")).getByText(t("settings.logo.custom"))).toBeInTheDocument();
    expect(section(t("settings.favicon.title")).getByText(t("settings.logo.default"))).toBeInTheDocument();
    expect(section(t("settings.ppm.title")).getByText(t("settings.ppm.enabled"))).toBeInTheDocument();
    expect(section(t("settings.email.title")).getByText(t("settings.smtp.configured"))).toBeInTheDocument();
    expect(
      section(t("settings.dataManagement.title")).getByText(
        t("settings.dataManagement.daysChip", { count: 45 }),
      ),
    ).toBeInTheDocument();
    expect(
      section(t("settings.locales.title")).getByText(
        `${SUPPORTED_LOCALES.length}/${SUPPORTED_LOCALES.length}`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("navbar-style-card")).toBeInTheDocument();
  });

  it("shows a spinner until the reads land", () => {
    mockApi.reset();
    mockApi.on("get", "/settings/*", () => new Promise(() => {}));
    renderWithProviders(<SettingsAdmin />);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: t("settings.currency.title") })).toBeNull();
  });

  it("renders the alert, not a blank page, when a read fails", async () => {
    mockApi.fail("get", "/settings/bootstrap", 500, "boom");
    await renderGeneral();
    expect(screen.getByRole("alert")).toHaveTextContent("GET /settings/bootstrap failed");
    // Defaults stand in for the values that never arrived.
    expect(section(t("settings.bpm.title")).getByText(t("settings.bpm.enabled"))).toBeInTheDocument();
  });
});

describe("SettingsAdmin — appearance", () => {
  it("saves the trimmed app title and broadcasts it", async () => {
    const { user } = await renderGeneral();
    mockApi.on("patch", "/settings/app-title", {});
    const card = section(t("settings.appTitle.title"));
    const input = card.getByDisplayValue("Acme EA");
    await user.clear(input);
    await user.type(input, "  Globex  ");
    await user.click(card.getByRole("button", { name: endsWith(tc("actions.save")) }));

    await screen.findByText(t("settings.appTitle.updated"));
    expect(mockApi.callsOf("patch", "/settings/app-title")[0].body).toEqual({ app_title: "Globex" });
    expect(h.invalidateAppTitle).toHaveBeenCalledWith("Globex");
  });

  it("uploads a logo through the hidden file input and offers the reset afterwards", async () => {
    const { user } = await renderGeneral();
    mockApi.on("upload", "/settings/logo", {});
    mockApi.on("delete", "/settings/logo", {});
    const card = section(t("settings.logo.title"));
    expect(card.queryByRole("button", { name: endsWith(t("settings.logo.reset")) })).toBeNull();

    const file = new File(["png"], "logo.png", { type: "image/png" });
    const input = document.querySelectorAll<HTMLInputElement>('input[type="file"]')[0];
    fireEvent.change(input, { target: { files: [file] } });

    await screen.findByText(t("settings.logo.updated"));
    expect(mockApi.callsOf("upload", "/settings/logo")[0].body).toBe(file);
    expect(card.getByText(t("settings.logo.custom"))).toBeInTheDocument();

    await user.click(card.getByRole("button", { name: endsWith(t("settings.logo.reset")) }));
    await screen.findByText(t("settings.logo.resetSuccess"));
    expect(mockApi.callsOf("delete", "/settings/logo")).toHaveLength(1);
    expect(card.getByText(t("settings.logo.default"))).toBeInTheDocument();
  });

  it("uploads and resets the favicon, refreshing the document icon links", async () => {
    const link = document.createElement("link");
    link.rel = "icon";
    link.href = "/old.ico";
    document.head.appendChild(link);
    try {
      scriptLoad({ favicon: true });
      const { user } = await renderGeneral();
      mockApi.on("upload", "/settings/favicon", {});
      mockApi.on("delete", "/settings/favicon", {});
      const card = section(t("settings.favicon.title"));

      const file = new File(["ico"], "favicon.png", { type: "image/png" });
      const input = document.querySelectorAll<HTMLInputElement>('input[type="file"]')[1];
      fireEvent.change(input, { target: { files: [file] } });
      await screen.findByText(t("settings.favicon.updated"));
      expect(mockApi.callsOf("upload", "/settings/favicon")[0].body).toBe(file);
      expect(link.href).toContain("/api/v1/settings/favicon?v=");

      await user.click(card.getByRole("button", { name: endsWith(t("settings.logo.reset")) }));
      await screen.findByText(t("settings.favicon.resetSuccess"));
      expect(mockApi.callsOf("delete", "/settings/favicon")).toHaveLength(1);
      expect(card.getByText(t("settings.logo.default"))).toBeInTheDocument();
    } finally {
      link.remove();
    }
  });

  it("surfaces an upload failure as the page alert", async () => {
    await renderGeneral();
    mockApi.fail("upload", "/settings/logo", 413, "too large");
    const input = document.querySelectorAll<HTMLInputElement>('input[type="file"]')[0];
    fireEvent.change(input, { target: { files: [new File(["x"], "big.png", { type: "image/png" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("UPLOAD /settings/logo failed");
  });

  it("saves the login-page branding and broadcasts the echoed values", async () => {
    const { user } = await renderGeneral();
    mockApi.on("patch", "/settings/login-branding", (_p, body) => body);
    const card = section(t("settings.loginBranding.title"));
    const tagline = card.getByRole("textbox", { name: t("settings.loginBranding.tagline") });
    await user.clear(tagline);
    await user.type(tagline, " Hello ");
    await user.click(card.getByRole("checkbox", { name: t("settings.loginBranding.hideTagline") }));
    await user.click(card.getByRole("button", { name: endsWith(tc("actions.save")) }));

    await screen.findByText(t("settings.loginBranding.savedSuccess"));
    expect(mockApi.callsOf("patch", "/settings/login-branding")[0].body).toEqual({
      login_tagline: "Hello",
      login_tagline_hidden: true,
      login_help_text: "",
      login_help_link: "",
    });
    expect(h.invalidateLoginBranding).toHaveBeenCalledWith({
      tagline: "Hello",
      taglineHidden: true,
      helpText: "",
      helpLink: "",
    });
  });

  it("relays the navbar card's save message into the snackbar", async () => {
    const { user } = await renderGeneral();
    await user.click(screen.getByTestId("navbar-style-card"));
    expect(await screen.findByText("navbar saved")).toBeInTheDocument();
  });
});

describe("SettingsAdmin — currency, date format, fiscal year", () => {
  it("keeps Save disabled until the currency changes, then PATCHes and invalidates", async () => {
    const { user } = await renderGeneral();
    mockApi.on("patch", "/settings/currency", {});
    const card = section(t("settings.currency.title"));
    const save = card.getByRole("button", { name: endsWith(tc("actions.save")) });
    expect(save).toBeDisabled();

    await pickOption(user, card.getByRole("combobox", { name: t("settings.currency.label") }), /^EUR/);
    expect(save).toBeEnabled();
    await user.click(save);

    await screen.findByText(t("settings.currency.updated"));
    expect(mockApi.callsOf("patch", "/settings/currency")[0].body).toEqual({ currency: "EUR" });
    expect(h.currencyInvalidate).toHaveBeenCalledWith("EUR");
  });

  it("saves a new date format and updates the chip", async () => {
    const { user } = await renderGeneral();
    mockApi.on("patch", "/settings/date-format", {});
    const card = section(t("settings.dateFormat.title"));
    expect(card.getByText(DEFAULT_DATE_FORMAT)).toBeInTheDocument();
    const save = card.getByRole("button", { name: endsWith(tc("actions.save")) });
    expect(save).toBeDisabled();

    await pickOption(user, card.getByRole("combobox", { name: t("settings.dateFormat.label") }), /^YYYY-MM-DD/);
    await user.click(save);

    await screen.findByText(t("settings.dateFormat.updated"));
    expect(mockApi.callsOf("patch", "/settings/date-format")[0].body).toEqual({
      date_format: "YYYY-MM-DD",
    });
    expect(invalidateDateFormat).toHaveBeenCalledWith("YYYY-MM-DD");
    expect(card.getByText("YYYY-MM-DD")).toBeInTheDocument();
    expect(save).toBeDisabled();
  });

  it("saves the fiscal year start month on selection", async () => {
    const { user } = await renderGeneral();
    mockApi.on("patch", "/settings/fiscal-year-start", {});
    const card = section(t("settings.fiscal.title"));
    await pickOption(user, card.getByRole("combobox", { name: t("settings.fiscal.startMonth") }), /\(4\)$/);

    await screen.findByText(t("settings.fiscal.savedSuccess"));
    expect(mockApi.callsOf("patch", "/settings/fiscal-year-start")[0].body).toEqual({ month: 4 });
  });

  it("reports a failed save through the alert and leaves the value selectable again", async () => {
    const { user } = await renderGeneral();
    mockApi.fail("patch", "/settings/fiscal-year-start", 500);
    const card = section(t("settings.fiscal.title"));
    await pickOption(user, card.getByRole("combobox", { name: t("settings.fiscal.startMonth") }), /\(7\)$/);
    expect(await screen.findByRole("alert")).toHaveTextContent("PATCH /settings/fiscal-year-start failed");
    expect(card.getByRole("combobox")).toBeEnabled();
  });
});

describe("SettingsAdmin — module toggles", () => {
  it("turns BPM off, invalidates the metamodel and locks the separate-approver switch", async () => {
    const { user } = await renderGeneral();
    mockApi.on("patch", "/settings/bpm-enabled", {});
    const card = section(t("settings.bpm.title"));
    const approver = card.getByRole("checkbox", { name: t("settings.bpm.separateApprover") });
    expect(approver).toBeEnabled();

    await user.click(card.getByRole("checkbox", { name: t("settings.bpm.visible") }));

    await screen.findByText(t("settings.bpm.disabledSuccess"));
    expect(mockApi.callsOf("patch", "/settings/bpm-enabled")[0].body).toEqual({ enabled: false });
    expect(invalidateMetamodel).toHaveBeenCalled();
    expect(card.getByText(t("settings.bpm.disabled"))).toBeInTheDocument();
    expect(card.getByRole("checkbox", { name: t("settings.bpm.hidden") })).not.toBeChecked();
    expect(approver).toBeDisabled();
  });

  it("saves the separate-approver requirement", async () => {
    const { user } = await renderGeneral();
    mockApi.on("patch", "/settings/bpm-separate-approver", {});
    await user.click(
      section(t("settings.bpm.title")).getByRole("checkbox", { name: t("settings.bpm.separateApprover") }),
    );
    await screen.findByText(t("settings.bpm.separateApproverSaved"));
    expect(mockApi.callsOf("patch", "/settings/bpm-separate-approver")[0].body).toEqual({ enabled: true });
  });

  it("turns PPM on", async () => {
    const { user } = await renderGeneral();
    mockApi.on("patch", "/settings/ppm-enabled", {});
    const card = section(t("settings.ppm.title"));
    await user.click(card.getByRole("checkbox", { name: t("settings.ppm.hidden") }));
    await screen.findByText(t("settings.ppm.enabledSuccess"));
    expect(mockApi.callsOf("patch", "/settings/ppm-enabled")[0].body).toEqual({ enabled: true });
    expect(card.getByText(t("settings.ppm.enabled"))).toBeInTheDocument();
  });

  it("turns GRC off and broadcasts the flag", async () => {
    const { user } = await renderGeneral();
    mockApi.on("patch", "/settings/grc-enabled", {});
    await user.click(section(t("settings.grc.title")).getByRole("checkbox", { name: t("settings.grc.visible") }));
    await screen.findByText(t("settings.grc.disabledSuccess"));
    expect(mockApi.callsOf("patch", "/settings/grc-enabled")[0].body).toEqual({ enabled: false });
    expect(invalidateGrcEnabled).toHaveBeenCalledWith(false);
  });

  it("keeps the switch where it was when the toggle fails", async () => {
    const { user } = await renderGeneral();
    mockApi.fail("patch", "/settings/grc-enabled", 500);
    const card = section(t("settings.grc.title"));
    await user.click(card.getByRole("checkbox", { name: t("settings.grc.visible") }));
    expect(await screen.findByRole("alert")).toHaveTextContent("PATCH /settings/grc-enabled failed");
    expect(card.getByRole("checkbox", { name: t("settings.grc.visible") })).toBeChecked();
    expect(invalidateGrcEnabled).not.toHaveBeenCalled();
  });

  it("turns file uploads off and broadcasts the flag", async () => {
    const { user } = await renderGeneral();
    mockApi.on("patch", "/settings/file-uploads-enabled", {});
    await user.click(
      section(t("settings.fileUploads.title")).getByRole("checkbox", { name: t("settings.fileUploads.visible") }),
    );
    await screen.findByText(t("settings.fileUploads.disabledSuccess"));
    expect(mockApi.callsOf("patch", "/settings/file-uploads-enabled")[0].body).toEqual({ enabled: false });
    expect(invalidateFileUploadsEnabled).toHaveBeenCalledWith(false);
  });

  it("saves the three notification toggles to their own routes", async () => {
    const { user } = await renderGeneral();
    mockApi.on("patch", "/settings/update-check-enabled", {});
    mockApi.on("patch", "/settings/announce-upgrades-enabled", {});
    mockApi.on("patch", "/settings/extension-notices-enabled", {});
    const card = section(t("settings.updateCheck.title"));

    await user.click(card.getByRole("checkbox", { name: t("settings.updateCheck.on") }));
    await screen.findByText(t("settings.updateCheck.disabledSuccess"));
    await user.click(card.getByRole("checkbox", { name: t("settings.announceUpgrades.on") }));
    await screen.findByText(t("settings.announceUpgrades.disabledSuccess"));
    await user.click(card.getByRole("checkbox", { name: t("settings.extensionNotices.on") }));
    await screen.findByText(t("settings.extensionNotices.disabledSuccess"));

    expect(mockApi.callsOf("patch", "/settings/update-check-enabled")[0].body).toEqual({ enabled: false });
    expect(mockApi.callsOf("patch", "/settings/announce-upgrades-enabled")[0].body).toEqual({ enabled: false });
    expect(mockApi.callsOf("patch", "/settings/extension-notices-enabled")[0].body).toEqual({ enabled: false });
  });

  it("hides the sponsor button from the menu and opens the sponsorship dialog", async () => {
    const { user } = await renderGeneral();
    mockApi.on("patch", "/settings/sponsor-button-enabled", {});
    const card = section(t("settings.sponsorButton.title"));
    expect(screen.queryByTestId("sponsor-dialog")).toBeNull();
    await user.click(
      card.getByRole("button", { name: endsWith(i18n.t("nav:userMenu.sponsorship") as string) }),
    );
    expect(screen.getByTestId("sponsor-dialog")).toBeInTheDocument();

    await user.click(card.getByRole("checkbox", { name: t("settings.sponsorButton.visible") }));
    await screen.findByText(t("settings.sponsorButton.disabledSuccess"));
    expect(mockApi.callsOf("patch", "/settings/sponsor-button-enabled")[0].body).toEqual({ enabled: false });
    expect(h.invalidateSponsorButtonEnabled).toHaveBeenCalledWith(false);
  });
});

describe("SettingsAdmin — archived-card retention", () => {
  it("saves a new number of days and broadcasts it", async () => {
    const { user } = await renderGeneral();
    mockApi.on("patch", "/settings/archive-retention-days", {});
    const card = section(t("settings.dataManagement.title"));
    const save = card.getByRole("button", { name: endsWith(tc("actions.save")) });
    expect(save).toBeDisabled();

    const input = card.getByRole("spinbutton", { name: t("settings.dataManagement.retentionDays") });
    await user.clear(input);
    await user.type(input, "90");
    await user.click(save);

    await screen.findByText(t("settings.dataManagement.savedSuccess"));
    expect(mockApi.callsOf("patch", "/settings/archive-retention-days")[0].body).toEqual({ days: 90 });
    expect(h.invalidateArchiveRetentionDays).toHaveBeenCalledWith(90);
    expect(card.getByText(t("settings.dataManagement.daysChip", { count: 90 }))).toBeInTheDocument();
  });

  it("'keep indefinitely' writes 0 and shows the warning chip", async () => {
    const { user } = await renderGeneral();
    mockApi.on("patch", "/settings/archive-retention-days", {});
    const card = section(t("settings.dataManagement.title"));
    await user.click(card.getByRole("checkbox", { name: t("settings.dataManagement.keepIndefinitely") }));
    expect(card.getByRole("spinbutton")).toBeDisabled();
    await user.click(card.getByRole("button", { name: endsWith(tc("actions.save")) }));

    await screen.findByText(t("settings.dataManagement.savedSuccess"));
    expect(mockApi.callsOf("patch", "/settings/archive-retention-days")[0].body).toEqual({ days: 0 });
    expect(card.getByText(t("settings.dataManagement.indefiniteChip"))).toBeInTheDocument();
  });

  it("rejects an out-of-range value without calling the API", async () => {
    const { user } = await renderGeneral();
    const card = section(t("settings.dataManagement.title"));
    const input = card.getByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "5000");
    await user.click(card.getByRole("button", { name: endsWith(tc("actions.save")) }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      t("settings.dataManagement.invalid", { max: 3650 }),
    );
    expect(mockApi.callsOf("patch")).toHaveLength(0);
  });
});

describe("SettingsAdmin — enabled languages", () => {
  it("saves the checked set and broadcasts only the locales the server confirmed", async () => {
    const { user } = await renderGeneral();
    mockApi.on("patch", "/settings/enabled-locales", (_p, body) => ({
      locales: [...(body as { locales: string[] }).locales, "xx"],
    }));
    const card = section(t("settings.locales.title"));
    await user.click(card.getByRole("checkbox", { name: "Deutsch" }));
    expect(card.getByText(`${SUPPORTED_LOCALES.length - 1}/${SUPPORTED_LOCALES.length}`)).toBeInTheDocument();
    await user.click(card.getByRole("button", { name: endsWith(tc("actions.save")) }));

    await screen.findByText(t("settings.locales.savedSuccess"));
    const expected = SUPPORTED_LOCALES.filter((l) => l !== "de");
    expect(mockApi.callsOf("patch", "/settings/enabled-locales")[0].body).toEqual({ locales: expected });
    // The unknown "xx" the server echoed is dropped before the broadcast.
    expect(h.localesInvalidate).toHaveBeenCalledWith(expected);
  });

  it("will not let the last enabled locale be unchecked", async () => {
    scriptLoad({ bootstrap: { enabled_locales: ["en"] } });
    await renderGeneral();
    const card = section(t("settings.locales.title"));
    expect(card.getByText(`1/${SUPPORTED_LOCALES.length}`)).toBeInTheDocument();
    expect(card.getByRole("checkbox", { name: "English" })).toBeDisabled();
    expect(card.getByRole("checkbox", { name: "Deutsch" })).toBeEnabled();
  });
});

describe("SettingsAdmin — email delivery", () => {
  it("saves the SMTP form and takes the configured flag from the echo", async () => {
    const { user } = await renderGeneral();
    mockApi.on("patch", "/settings/email", (_p, body) => ({
      ...EMAIL,
      ...(body as object),
      smtp_password: "********",
      configured: true,
    }));
    const card = section(t("settings.email.title"));
    expect(card.getByText(t("settings.smtp.notConfigured"))).toBeInTheDocument();
    expect(card.getByRole("button", { name: endsWith(t("settings.smtp.sendTest")) })).toBeDisabled();

    await user.type(card.getByRole("textbox", { name: t("settings.smtp.host") }), "smtp.acme.test");
    await user.type(card.getByRole("textbox", { name: t("settings.smtp.username") }), "mailer");
    await user.type(card.getByLabelText(t("settings.smtp.password")), "s3cret");
    await user.click(card.getByRole("checkbox", { name: t("settings.smtp.useTls") }));
    await user.click(card.getByRole("button", { name: endsWith(tc("actions.save")) }));

    await screen.findByText(t("settings.smtp.savedSuccess"));
    const body = mockApi.callsOf("patch", "/settings/email")[0].body as Record<string, unknown>;
    expect(body).toMatchObject({
      method: "smtp_basic",
      smtp_host: "smtp.acme.test",
      smtp_user: "mailer",
      smtp_password: "s3cret",
      smtp_tls: false,
      smtp_from: "noreply@turboea.local",
    });
    expect(card.getByText(t("settings.smtp.configured"))).toBeInTheDocument();
    // The masked secret the server echoed replaces what was typed.
    expect(card.getByLabelText(t("settings.smtp.password"))).toHaveValue("********");
    expect(card.getByRole("button", { name: endsWith(t("settings.smtp.sendTest")) })).toBeEnabled();
  });

  it("sends a test email and names the recipient", async () => {
    scriptLoad({ email: { configured: true } });
    const { user } = await renderGeneral();
    mockApi.on("post", "/settings/email/test", { ok: true, sent_to: "admin@test.local" });
    await user.click(section(t("settings.email.title")).getByRole("button", { name: endsWith(t("settings.smtp.sendTest")) }));
    await screen.findByText(t("settings.smtp.testSent", { email: "admin@test.local" }));
    expect(mockApi.callsOf("post", "/settings/email/test")).toHaveLength(1);
  });

  it("shows the ApiError message when the test send fails", async () => {
    scriptLoad({ email: { configured: true } });
    const { user } = await renderGeneral();
    mockApi.fail("post", "/settings/email/test", 502, "SMTP refused");
    await user.click(section(t("settings.email.title")).getByRole("button", { name: endsWith(t("settings.smtp.sendTest")) }));
    expect(await screen.findByRole("alert")).toHaveTextContent("POST /settings/email/test failed");
  });

  it("shows the save failure as the alert", async () => {
    const { user } = await renderGeneral();
    mockApi.fail("patch", "/settings/email", 400, "bad host");
    await user.click(section(t("settings.email.title")).getByRole("button", { name: endsWith(tc("actions.save")) }));
    expect(await screen.findByRole("alert")).toHaveTextContent("PATCH /settings/email failed");
  });

  it("swaps the form for the Graph API transport", async () => {
    const { user } = await renderGeneral();
    const card = section(t("settings.email.title"));
    await pickOption(
      user,
      card.getByRole("combobox", { name: t("settings.email.method") }),
      t("settings.email.method.graphApi"),
    );
    expect(card.getByText(t("settings.email.hint.graphApi"))).toBeInTheDocument();
    expect(card.queryByRole("textbox", { name: t("settings.smtp.host") })).toBeNull();
    expect(card.queryByRole("checkbox", { name: t("settings.smtp.useTls") })).toBeNull();
    expect(card.getByRole("textbox", { name: t("settings.email.graphSender") })).toBeInTheDocument();
    expect(card.getByRole("textbox", { name: t("settings.email.tenantId") })).toBeInTheDocument();
    // The provider is pinned to Microsoft for Graph.
    expect(card.getByRole("combobox", { name: t("settings.email.oauthProvider") })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("asks for a service-account JSON for Google SMTP OAuth", async () => {
    const { user } = await renderGeneral();
    const card = section(t("settings.email.title"));
    await pickOption(
      user,
      card.getByRole("combobox", { name: t("settings.email.method") }),
      t("settings.email.method.smtpOauth"),
    );
    expect(card.getByText(t("settings.email.hint.smtpOauth"))).toBeInTheDocument();
    expect(card.getByRole("textbox", { name: t("settings.email.senderMailbox") })).toBeInTheDocument();
    expect(card.getByRole("textbox", { name: t("settings.email.tenantId") })).toBeInTheDocument();

    await pickOption(
      user,
      card.getByRole("combobox", { name: t("settings.email.oauthProvider") }),
      t("settings.email.provider.google"),
    );
    expect(card.getByRole("textbox", { name: t("settings.email.serviceAccountJson") })).toBeInTheDocument();
    expect(card.queryByRole("textbox", { name: t("settings.email.tenantId") })).toBeNull();
  });
});

describe("SettingsAdmin — tab routing", () => {
  it("opens the General tab with no ?tab and the named tab otherwise", async () => {
    await renderGeneral();
    expect(screen.getByRole("tab", { name: t("settings.tabs.general") })).toHaveAttribute("aria-selected", "true");
  });

  it.each([
    ["authentication", "tab-auth"],
    ["ai", "tab-ai"],
    ["eol", "tab-eol"],
    ["web-portals", "tab-web-portals"],
    ["integrations", "tab-integrations"],
    ["turbolens", "tab-turbolens"],
    ["migration", "tab-migration"],
    ["audit-log", "tab-audit-log"],
    ["resources", "tab-resources"],
  ])("?tab=%s mounts its lazy page", async (tab, testId) => {
    renderWithProviders(<SettingsAdmin />, { route: `/admin/settings?tab=${tab}` });
    expect(await screen.findByTestId(testId)).toBeInTheDocument();
    // The General tab's reads are not issued while another tab shows.
    expect(mockApi.callsOf("get", "/settings/bootstrap")).toHaveLength(0);
  });

  it("resolves the legacy ?tab=servicenow alias to the Integrations hub", async () => {
    renderWithProviders(<SettingsAdmin />, { route: "/admin/settings?tab=servicenow" });
    expect(await screen.findByTestId("tab-integrations")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: t("settings.tabs.integrations") })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("falls back to General for an unknown tab key", async () => {
    await renderGeneral("/admin/settings?tab=nonsense");
    expect(screen.getByRole("tab", { name: t("settings.tabs.general") })).toHaveAttribute("aria-selected", "true");
  });

  it("switches tabs through the URL and back to General", async () => {
    const { user } = await renderGeneral();
    await user.click(screen.getByRole("tab", { name: t("settings.tabs.eol") }));
    expect(await screen.findByTestId("tab-eol")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: t("settings.currency.title") })).toBeNull();

    await user.click(screen.getByRole("tab", { name: t("settings.tabs.general") }));
    await screen.findByRole("heading", { name: t("settings.currency.title") });
    expect(screen.queryByTestId("tab-eol")).toBeNull();
    // Remounting the General tab re-reads the settings.
    expect(mockApi.callsOf("get", "/settings/bootstrap")).toHaveLength(2);
  });
});

describe("SettingsAdmin — snackbar", () => {
  it("clears the toast after its auto-hide delay", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = await renderGeneral();
    mockApi.on("patch", "/settings/ppm-enabled", {});
    await user.click(section(t("settings.ppm.title")).getByRole("checkbox", { name: t("settings.ppm.hidden") }));
    await screen.findByText(t("settings.ppm.enabledSuccess"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4500);
    });
    await waitFor(() => expect(screen.queryByText(t("settings.ppm.enabledSuccess"))).toBeNull());
  });
});
