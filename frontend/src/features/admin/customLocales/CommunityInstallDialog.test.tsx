import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { api } from "@/api/client";
import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import type { CommunityInstallResult, CommunityLanguage } from "@/types";
import CommunityInstallDialog from "./CommunityInstallDialog";
import { installPath } from "./customLocaleUtils";

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`admin:${key}`, opts) as string;
const tc = (key: string) => i18n.t(`common:${key}`) as string;

const DUTCH: CommunityLanguage = {
  code: "nl",
  name: "Nederlands",
  english_name: "Dutch",
  rtl: false,
  app_version: "2.214.0",
  sha256: "a".repeat(64),
  size: 1000,
  commit: null,
  updated: null,
  coverage: 50,
  strings: 10,
  ui_strings: 10,
  metamodel_strings: 0,
  installed: false,
  installed_from_community: false,
  update_available: false,
};
const INSTALLED: CommunityLanguage = {
  ...DUTCH,
  installed: true,
  installed_from_community: true,
  update_available: true,
};
/** The same code added here by hand. */
const HAND_MADE: CommunityLanguage = { ...DUTCH, installed: true, update_available: true };
const PATH = "/custom-locales/catalogue/nl/install";

function result(over: Partial<CommunityInstallResult> = {}): CommunityInstallResult {
  return {
    applied: 5,
    unchanged: 1,
    cleared: 0,
    rejected: [],
    unknown: 0,
    unknown_keys: [],
    created: true,
    kept_manual: 0,
    locale: {
      code: "nl",
      name: "Nederlands",
      english_name: "Dutch",
      rtl: false,
      enabled: false,
      stats: null,
      job: null,
      source: "community",
    },
    ...over,
  };
}

const onClose = vi.fn();
const onInstalled = vi.fn();

function renderDialog(language: CommunityLanguage = DUTCH) {
  return renderWithProviders(
    <CommunityInstallDialog language={language} onClose={onClose} onInstalled={onInstalled} />,
  );
}

beforeEach(() => {
  mockApi.reset();
  onClose.mockReset();
  onInstalled.mockReset();
  expect(api).toBe(mockApi.api);
});

describe("CommunityInstallDialog", () => {
  it("says plainly what an install does before anything is downloaded", async () => {
    renderDialog();
    expect(
      screen.getByText(t("customLocales.community.installTitle", { name: "Nederlands" })),
    ).toBeInTheDocument();
    expect(screen.getByText(t("customLocales.community.unreviewedWarning"))).toBeInTheDocument();
    expect(screen.getByText(t("customLocales.community.installExplain"))).toBeInTheDocument();
    // A first install has no hand-corrected strings to keep.
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(mockApi.callsOf("post", PATH)).toHaveLength(0);
    expect(installPath("pt-BR")).toBe("/custom-locales/catalogue/pt-BR/install");
  });

  it("installs, then shows the merge report and that the language is off", async () => {
    mockApi.on("post", PATH, result({ rejected: [{ namespace: "common", key: "actions.save", reason: "markup_not_in_source" }] }));
    const { user } = renderDialog();
    await user.click(screen.getByRole("button", { name: t("customLocales.community.install") }));
    expect(
      await screen.findByText(t("customLocales.community.addedDisabled", { name: "Nederlands" })),
    ).toBeInTheDocument();
    expect(mockApi.callsOf("post", PATH)[0].body).toEqual({ overwrite_manual: false });
    expect(onInstalled).toHaveBeenCalledWith("nl");
    expect(screen.getByTestId("import-report")).toHaveTextContent(
      t("customLocales.import.result", { applied: 5, unchanged: 1, cleared: 0, rejected: 1, unknown: 0 }),
    );
    expect(screen.getByText("common · actions.save")).toBeInTheDocument();
    expect(screen.getByText(t("customLocales.reasons.markup_not_in_source"))).toBeInTheDocument();
    // Done: the confirmation and the Install button are gone.
    expect(screen.queryByText(t("customLocales.community.installExplain"))).toBeNull();
    expect(screen.queryByRole("button", { name: t("customLocales.community.install") })).toBeNull();
    expect(screen.queryByText(t("customLocales.community.keptManual", { count: 0 }))).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("on an update keeps hand-corrected strings unless asked", async () => {
    mockApi.on("post", PATH, result({ created: false, kept_manual: 2 }));
    const { user } = renderDialog(INSTALLED);
    expect(
      screen.getByText(t("customLocales.community.updateTitle", { name: "Nederlands" })),
    ).toBeInTheDocument();
    expect(screen.getByText(t("customLocales.community.updateExplain"))).toBeInTheDocument();
    const box = screen.getByRole("checkbox", { name: t("customLocales.community.overwriteManual") });
    expect(box).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: t("customLocales.community.update") }));
    expect(
      await screen.findByText(t("customLocales.community.updated", { name: "Nederlands" })),
    ).toBeInTheDocument();
    expect(mockApi.callsOf("post", PATH)[0].body).toEqual({ overwrite_manual: false });
    expect(screen.getByText(t("customLocales.community.keptManual", { count: 2 }))).toBeInTheDocument();
  });

  it("says that a pack is merged into a language added here by hand", async () => {
    mockApi.on("post", PATH, result({ created: false }));
    const { user } = renderDialog(HAND_MADE);
    expect(
      screen.getByText(t("customLocales.community.mergeTitle", { name: "Nederlands" })),
    ).toBeInTheDocument();
    expect(screen.getByText(t("customLocales.community.mergeExplain"))).toBeInTheDocument();
    expect(screen.queryByText(t("customLocales.community.updateExplain"))).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: t("customLocales.community.overwriteManual") }));
    await user.click(screen.getByRole("button", { name: t("customLocales.community.merge") }));
    await screen.findByTestId("import-report");
    expect(mockApi.callsOf("post", PATH)[0].body).toEqual({ overwrite_manual: true });
  });

  it("closes on Escape, but not while it installs", async () => {
    let release!: (v: CommunityInstallResult) => void;
    mockApi.on("post", PATH, () => new Promise((r) => (release = r)));
    const { user } = renderDialog();
    await user.click(screen.getByRole("button", { name: t("customLocales.community.install") }));
    await screen.findByRole("progressbar");
    // On the dialog itself: the clicked button is gone once the report shows,
    // and a key pressed on <body> never reaches the modal.
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    release(result());
    await screen.findByTestId("import-report");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("replaces them when the admin ticks the box", async () => {
    mockApi.on("post", PATH, result({ created: false }));
    const { user } = renderDialog(INSTALLED);
    await user.click(screen.getByRole("checkbox", { name: t("customLocales.community.overwriteManual") }));
    await user.click(screen.getByRole("button", { name: t("customLocales.community.update") }));
    await screen.findByTestId("import-report");
    expect(mockApi.callsOf("post", PATH)[0].body).toEqual({ overwrite_manual: true });
  });

  it("shows a progress bar and locks the buttons while it installs", async () => {
    let release!: (v: CommunityInstallResult) => void;
    mockApi.on("post", PATH, () => new Promise((r) => (release = r)));
    const { user } = renderDialog(INSTALLED);
    await user.click(screen.getByRole("button", { name: t("customLocales.community.update") }));
    expect(
      await screen.findByRole("progressbar", { name: t("customLocales.community.installing") }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: tc("actions.close") })).toBeDisabled();
    expect(screen.getByRole("button", { name: t("customLocales.community.update") })).toBeDisabled();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    release(result());
    await screen.findByTestId("import-report");
    expect(screen.getByRole("button", { name: tc("actions.close") })).toBeEnabled();
  });

  it("explains a refusal by its code and lets the admin try again", async () => {
    mockApi.fail("post", PATH, 502, "pack_checksum_mismatch");
    const { user } = renderDialog();
    await user.click(screen.getByRole("button", { name: t("customLocales.community.install") }));
    expect(await screen.findByText(t("customLocales.errors.pack_checksum_mismatch"))).toBeInTheDocument();
    expect(onInstalled).not.toHaveBeenCalled();
    expect(screen.queryByTestId("import-report")).toBeNull();
    // The error clears when the next attempt starts.
    mockApi.on("post", PATH, result());
    await user.click(screen.getByRole("button", { name: t("customLocales.community.install") }));
    await screen.findByTestId("import-report");
    expect(screen.queryByText(t("customLocales.errors.pack_checksum_mismatch"))).toBeNull();
  });

  it("falls back to a general message for an unknown failure", async () => {
    mockApi.fail("post", PATH, 500, "boom");
    const { user } = renderDialog();
    await user.click(screen.getByRole("button", { name: t("customLocales.community.install") }));
    expect(await screen.findByText(t("customLocales.community.installFailed"))).toBeInTheDocument();
  });

  it("closes on Close", async () => {
    const { user } = renderDialog();
    await user.click(screen.getByRole("button", { name: tc("actions.close") }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
