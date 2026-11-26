import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useDateFormat", () => ({
  useDateFormat: () => ({ formatDateTime: (v: string) => `D(${v})` }),
}));

import { api } from "@/api/client";
import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import type { CommunityCatalogue, CommunityLanguage } from "@/types";
import CommunityLanguages, { CATALOGUE_PATH } from "./CommunityLanguages";

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`admin:${key}`, opts) as string;

const DUTCH: CommunityLanguage = {
  code: "nl",
  name: "Nederlands",
  english_name: "Dutch",
  rtl: false,
  app_version: "2.214.0",
  sha256: "a".repeat(64),
  size: 1000,
  commit: "c".repeat(40),
  updated: "2026-11-20T10:00:00Z",
  coverage: 87.6,
  strings: 7000,
  ui_strings: 6800,
  metamodel_strings: 200,
  installed: false,
  installed_from_community: false,
  update_available: false,
};
const HEBREW: CommunityLanguage = {
  ...DUTCH,
  code: "he",
  name: "עברית",
  english_name: "Hebrew",
  rtl: true,
  coverage: null,
  installed: true,
  installed_from_community: true,
  update_available: true,
};
/** Added on this server by hand; the library has the same code. */
const POLISH: CommunityLanguage = {
  ...DUTCH,
  code: "pl",
  name: "Polski",
  english_name: "Polish",
  installed: true,
  installed_from_community: false,
  update_available: true,
};
const SWEDISH: CommunityLanguage = {
  ...DUTCH,
  code: "sv",
  name: "Svenska",
  english_name: "Swedish",
  installed: true,
  installed_from_community: true,
};

function catalogue(over: Partial<CommunityCatalogue> = {}): CommunityCatalogue {
  return {
    enabled: true,
    url: "https://example.org/index.json",
    fetched_at: "2026-11-26T08:00:00+00:00",
    error: null,
    languages: [DUTCH, HEBREW, SWEDISH, POLISH],
    ...over,
  };
}

const REFRESH = `${CATALOGUE_PATH}?refresh=true`;
const onInstalled = vi.fn();

function renderBlock() {
  return renderWithProviders(<CommunityLanguages onInstalled={onInstalled} />);
}

function row(code: string) {
  return within(screen.getByTestId(`community-language-${code}`));
}

beforeEach(() => {
  mockApi.reset();
  onInstalled.mockReset();
  expect(api).toBe(mockApi.api);
});

describe("CommunityLanguages", () => {
  it("lists each language with its coverage, version, marker and action", async () => {
    mockApi.on("get", CATALOGUE_PATH, catalogue());
    renderBlock();
    expect(await screen.findByText("Nederlands")).toBeInTheDocument();
    expect(CATALOGUE_PATH).toBe("/custom-locales/catalogue");

    const nl = row("nl");
    expect(
      nl.getByText(
        [
          "nl · Dutch",
          t("customLocales.community.coverage", { percent: 88 }),
          t("customLocales.community.madeFor", { version: "2.214.0" }),
        ].join(" · "),
      ),
    ).toBeInTheDocument();
    expect(nl.getByText(t("customLocales.community.unreviewed"))).toBeInTheDocument();
    expect(nl.getByRole("button", { name: t("customLocales.community.installNamed", { name: "Nederlands" }) })).toBeEnabled();
    expect(nl.queryByText(t("customLocales.community.installed"))).toBeNull();
    expect(nl.getByText("Nederlands")).toHaveAttribute("lang", "nl");
    expect(nl.getByText("Nederlands")).toHaveAttribute("dir", "ltr");

    // Installed, the library has another pack: Update.
    const he = row("he");
    expect(he.getByText("עברית")).toHaveAttribute("dir", "rtl");
    expect(
      he.getByText(
        ["he · Hebrew", t("customLocales.community.madeFor", { version: "2.214.0" })].join(" · "),
      ),
    ).toBeInTheDocument();
    expect(he.getByText(t("customLocales.community.updateAvailable"))).toBeInTheDocument();
    expect(he.getByTestId("community-status")).toHaveClass("MuiChip-colorInfo");
    expect(he.getByRole("button", { name: t("customLocales.community.updateNamed", { name: "עברית" }) })).toBeEnabled();
    expect(he.getByText(t("customLocales.community.unreviewed"))).toBeInTheDocument();

    // Installed and current: no action.
    const sv = row("sv");
    expect(sv.getByText(t("customLocales.community.installed"))).toBeInTheDocument();
    expect(sv.queryByRole("button")).toBeNull();
    expect(sv.queryByText(t("customLocales.community.updateAvailable"))).toBeNull();
    expect(sv.getByTestId("community-status")).toHaveClass("MuiChip-colorSuccess");

    // Added here by hand: never "Update available" — the pack would be merged
    // into the admin's own language, and the button says so.
    const pl = row("pl");
    expect(pl.getByText(t("customLocales.community.addedHere"))).toBeInTheDocument();
    expect(pl.queryByText(t("customLocales.community.updateAvailable"))).toBeNull();
    expect(pl.getByTestId("community-status")).toHaveClass("MuiChip-colorDefault");
    expect(
      pl.getByRole("button", { name: t("customLocales.community.mergeNamed", { name: "Polski" }) }),
    ).toHaveTextContent(t("customLocales.community.merge"));
    expect(nl.queryByTestId("community-status")).toBeNull();

    expect(
      screen.getByText(t("customLocales.community.fetchedAt", { date: "D(2026-11-26T08:00:00+00:00)" })),
    ).toBeInTheDocument();

    // Not loading any more: no bar.
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("shows a bar while the list loads", async () => {
    let release!: (v: CommunityCatalogue) => void;
    mockApi.on("get", CATALOGUE_PATH, () => new Promise((r) => (release = r)));
    renderBlock();
    expect(
      await screen.findByRole("progressbar", { name: t("customLocales.community.loading") }),
    ).toBeInTheDocument();
    release(catalogue());
    await screen.findByText("Nederlands");
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("shows no date for a list it has never downloaded", async () => {
    mockApi.on("get", CATALOGUE_PATH, catalogue({ fetched_at: null, error: "catalogue_unreachable", languages: [] }));
    renderBlock();
    await screen.findByRole("alert");
    expect(screen.queryByText(/D\(/)).toBeNull();
  });

  it("re-reads the cached list when the section's languages changed", async () => {
    mockApi.on("get", CATALOGUE_PATH, catalogue());
    function Harness() {
      const [version, setVersion] = useState(0);
      return (
        <>
          <button onClick={() => setVersion((v) => v + 1)}>bump</button>
          <CommunityLanguages onInstalled={onInstalled} listVersion={version} />
        </>
      );
    }
    const { user } = renderWithProviders(<Harness />);
    await screen.findByText("Nederlands");
    expect(mockApi.callsOf("get", CATALOGUE_PATH)).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "bump" }));
    await waitFor(() => expect(mockApi.callsOf("get", CATALOGUE_PATH)).toHaveLength(2));
    expect(mockApi.callsOf("get", REFRESH)).toHaveLength(0);
  });

  it("locks Refresh while a read is out", async () => {
    let release!: (v: CommunityCatalogue) => void;
    mockApi.on("get", CATALOGUE_PATH, catalogue());
    mockApi.on("get", REFRESH, () => new Promise((r) => (release = r)));
    const { user } = renderBlock();
    await screen.findByText("Nederlands");
    const refresh = screen.getByRole("button", { name: t("customLocales.community.refresh") });
    expect(refresh).toBeEnabled();
    await user.click(refresh);
    await waitFor(() => expect(refresh).toBeDisabled());
    release(catalogue());
    await waitFor(() => expect(refresh).toBeEnabled());
  });

  it("downloads the library's list again only on Refresh", async () => {
    mockApi.on("get", CATALOGUE_PATH, catalogue({ languages: [DUTCH] }));
    mockApi.on("get", REFRESH, catalogue());
    const { user } = renderBlock();
    await screen.findByText("Nederlands");
    expect(screen.queryByText("Svenska")).toBeNull();
    await user.click(screen.getByRole("button", { name: t("customLocales.community.refresh") }));
    expect(await screen.findByText("Svenska")).toBeInTheDocument();
    expect(mockApi.callsOf("get", REFRESH)).toHaveLength(1);
    expect(mockApi.callsOf("get", CATALOGUE_PATH)).toHaveLength(1);
  });

  it("says when the library is switched off, and offers no refresh", async () => {
    mockApi.on("get", CATALOGUE_PATH, catalogue({ enabled: false, languages: [DUTCH] }));
    renderBlock();
    expect(await screen.findByText(t("customLocales.community.disabled"))).toBeInTheDocument();
    expect(screen.queryByText("Nederlands")).toBeNull();
    expect(screen.queryByRole("button", { name: t("customLocales.community.refresh") })).toBeNull();
    expect(screen.queryByText(t("customLocales.community.empty"))).toBeNull();
  });

  it("says when the library has no languages", async () => {
    mockApi.on("get", CATALOGUE_PATH, catalogue({ languages: [] }));
    renderBlock();
    expect(await screen.findByText(t("customLocales.community.empty"))).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says when the library cannot be reached, with nothing cached", async () => {
    mockApi.on("get", CATALOGUE_PATH, catalogue({ error: "catalogue_unreachable", languages: [] }));
    renderBlock();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(t("customLocales.errors.catalogue_unreachable"));
    expect(alert).not.toHaveTextContent(t("customLocales.community.staleList"));
    expect(screen.queryByText(t("customLocales.community.empty"))).toBeNull();
  });

  it("keeps the cached list under a failed refresh, and says so", async () => {
    mockApi.on("get", CATALOGUE_PATH, catalogue({ error: "catalogue_invalid", languages: [DUTCH] }));
    renderBlock();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      `${t("customLocales.errors.catalogue_invalid")} ${t("customLocales.community.staleList")}`,
    );
    expect(screen.getByText("Nederlands")).toBeInTheDocument();
  });

  it("names an error code it does not know as a load failure", async () => {
    mockApi.on("get", CATALOGUE_PATH, catalogue({ error: "something_new", languages: [] }));
    renderBlock();
    expect(await screen.findByRole("alert")).toHaveTextContent(t("customLocales.community.loadFailed"));
  });

  it("says when the request itself fails, and offers to try again", async () => {
    mockApi.fail("get", CATALOGUE_PATH, 429, "boom");
    mockApi.on("get", REFRESH, catalogue());
    const { user } = renderBlock();
    expect(await screen.findByRole("alert")).toHaveTextContent(t("customLocales.community.loadFailed"));
    expect(screen.queryByText(t("customLocales.community.disabled"))).toBeNull();
    await user.click(screen.getByRole("button", { name: t("customLocales.community.refresh") }));
    expect(await screen.findByText("Nederlands")).toBeInTheDocument();
  });

  it("after Refresh, an install re-reads the cached list, not a new download", async () => {
    mockApi.on("get", CATALOGUE_PATH, catalogue({ languages: [DUTCH] }));
    mockApi.on("get", REFRESH, catalogue({ languages: [DUTCH] }));
    mockApi.on("post", "/custom-locales/catalogue/nl/install", {
      applied: 1,
      unchanged: 0,
      cleared: 0,
      rejected: [],
      unknown: 0,
      created: true,
      kept_manual: 0,
      locale: { code: "nl" },
    });
    const { user } = renderBlock();
    await screen.findByText("Nederlands");
    await user.click(screen.getByRole("button", { name: t("customLocales.community.refresh") }));
    await waitFor(() => expect(mockApi.callsOf("get", REFRESH)).toHaveLength(1));
    await user.click(row("nl").getByRole("button"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: t("customLocales.community.install") }));
    await within(dialog).findByTestId("import-report");
    await waitFor(() => expect(mockApi.callsOf("get", CATALOGUE_PATH)).toHaveLength(2));
    expect(mockApi.callsOf("get", REFRESH)).toHaveLength(1);
  });

  it("installs through the dialog, then re-reads the cached list and tells the section", async () => {
    let reads = 0;
    mockApi.on("get", CATALOGUE_PATH, () => {
      reads += 1;
      return catalogue({
        languages: [reads === 1 ? DUTCH : { ...DUTCH, installed: true, installed_from_community: true }],
      });
    });
    mockApi.on("post", "/custom-locales/catalogue/nl/install", {
      applied: 3,
      unchanged: 0,
      cleared: 0,
      rejected: [],
      unknown: 0,
      created: true,
      kept_manual: 0,
      locale: { code: "nl" },
    });
    const { user } = renderBlock();
    await screen.findByText("Nederlands");
    await user.click(row("nl").getByRole("button"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: t("customLocales.community.install") }));
    await within(dialog).findByText(t("customLocales.community.addedDisabled", { name: "Nederlands" }));
    expect(onInstalled).toHaveBeenCalledWith("nl");
    await waitFor(() => expect(row("nl").getByText(t("customLocales.community.installed"))).toBeInTheDocument());
    // The cached list, not a new download.
    expect(mockApi.callsOf("get", REFRESH)).toHaveLength(0);
    expect(reads).toBe(2);

    await user.click(within(dialog).getByRole("button", { name: i18n.t("common:actions.close") as string }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
