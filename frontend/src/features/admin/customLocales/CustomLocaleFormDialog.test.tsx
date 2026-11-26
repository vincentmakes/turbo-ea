import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { api } from "@/api/client";
import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import type { CustomLocale } from "@/types";
import CustomLocaleFormDialog from "./CustomLocaleFormDialog";

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`admin:${key}`, opts) as string;
const tc = (key: string) => i18n.t(`common:${key}`) as string;

const THAI: CustomLocale = {
  code: "th",
  name: "ไทย",
  english_name: "Thai",
  rtl: false,
  enabled: true,
  stats: { total: 10, translated: 5, missing: 5, stale: 0 },
  job: null,
};

const onClose = vi.fn();
const onSaved = vi.fn();

function field(labelKey: string) {
  return screen.getByRole("textbox", { name: new RegExp(t(labelKey)) });
}

function saveButton() {
  return screen.getByRole("button", { name: tc("actions.save") });
}

function renderDialog(locale: CustomLocale | null = null) {
  return renderWithProviders(
    <CustomLocaleFormDialog locale={locale} onClose={onClose} onSaved={onSaved} />,
  );
}

beforeEach(() => {
  mockApi.reset();
  onClose.mockReset();
  onSaved.mockReset();
  expect(api).toBe(mockApi.api);
});

describe("CustomLocaleFormDialog — add", () => {
  it("creates a left-to-right language by default and hints when the code is usually right to left", async () => {
    mockApi.on("post", "/custom-locales", {});
    const { user } = renderDialog();
    expect(screen.getByText(t("customLocales.form.addTitle"))).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: t("customLocales.form.rtl") })).not.toBeChecked();

    await user.type(field("customLocales.form.code"), "he");
    await user.type(field("customLocales.form.name"), "עברית");
    await user.type(field("customLocales.form.englishName"), "Hebrew");
    // A hint, never the switch.
    expect(screen.getByText(t("customLocales.form.rtlHint"))).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: t("customLocales.form.rtl") })).not.toBeChecked();

    await user.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("he"));
    expect(mockApi.callsOf("post", "/custom-locales")[0].body).toEqual({
      code: "he",
      name: "עברית",
      english_name: "Hebrew",
      rtl: false,
    });
  });

  it("sends the right-to-left switch and drops the hint once it is on", async () => {
    mockApi.on("post", "/custom-locales", {});
    const { user } = renderDialog();
    await user.type(field("customLocales.form.code"), "fa");
    await user.type(field("customLocales.form.name"), "فارسی");
    await user.type(field("customLocales.form.englishName"), "Persian");
    await user.click(screen.getByRole("checkbox", { name: t("customLocales.form.rtl") }));
    expect(screen.queryByText(t("customLocales.form.rtlHint"))).not.toBeInTheDocument();
    await user.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("fa"));
    expect(mockApi.callsOf("post", "/custom-locales")[0].body).toMatchObject({ rtl: true });
  });

  it("gives no hint for a left-to-right script and trims what it sends", async () => {
    mockApi.on("post", "/custom-locales", {});
    const { user } = renderDialog();
    await user.type(field("customLocales.form.code"), " hi ");
    await user.type(field("customLocales.form.name"), " हिन्दी ");
    await user.type(field("customLocales.form.englishName"), " Hindi ");
    expect(screen.queryByText(t("customLocales.form.rtlHint"))).not.toBeInTheDocument();
    await user.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("hi"));
    expect(mockApi.callsOf("post", "/custom-locales")[0].body).toEqual({
      code: "hi",
      name: "हिन्दी",
      english_name: "Hindi",
      rtl: false,
    });
  });

  it("keeps Save disabled until code, native name and English name are all given", async () => {
    const { user } = renderDialog();
    expect(saveButton()).toBeDisabled();
    await user.type(field("customLocales.form.code"), "th");
    expect(saveButton()).toBeDisabled();
    await user.type(field("customLocales.form.name"), "ไทย");
    expect(saveButton()).toBeDisabled();
    await user.type(field("customLocales.form.englishName"), "Thai");
    expect(saveButton()).toBeEnabled();
  });

  it("refuses a malformed code", async () => {
    const { user } = renderDialog();
    await user.type(field("customLocales.form.code"), "Thai");
    await user.type(field("customLocales.form.name"), "ไทย");
    await user.type(field("customLocales.form.englishName"), "Thai");
    expect(screen.getByText(t("customLocales.form.codeInvalid"))).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("refuses a code longer than the server stores", async () => {
    const { user } = renderDialog();
    await user.type(field("customLocales.form.code"), "abc-Abcd-AB");
    await user.type(field("customLocales.form.name"), "x");
    await user.type(field("customLocales.form.englishName"), "Abc");
    expect(screen.getByText(t("customLocales.form.codeTooLong", { max: 10 }))).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("accepts a code of exactly ten characters", async () => {
    const { user } = renderDialog();
    await user.type(field("customLocales.form.code"), "sr-Latn-RS");
    expect(screen.queryByText(t("customLocales.form.codeTooLong", { max: 10 }))).toBeNull();
    expect(screen.getByText(t("customLocales.form.codeHelp"))).toBeInTheDocument();
  });

  it("refuses a deprecated code and names the one to use", async () => {
    const { user } = renderDialog();
    await user.type(field("customLocales.form.code"), "iw");
    await user.type(field("customLocales.form.name"), "עברית");
    await user.type(field("customLocales.form.englishName"), "Hebrew");
    expect(
      screen.getByText(t("customLocales.form.codeNotCanonical", { canonical: "he" })),
    ).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("refuses a code that ships with the app", async () => {
    const { user } = renderDialog();
    await user.type(field("customLocales.form.code"), "de");
    await user.type(field("customLocales.form.name"), "Deutsch");
    await user.type(field("customLocales.form.englishName"), "German");
    expect(screen.getByText(t("customLocales.errors.built_in_code"))).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("refuses an English name the AI prompt cannot take", async () => {
    const { user } = renderDialog();
    await user.type(field("customLocales.form.code"), "th");
    await user.type(field("customLocales.form.name"), "ไทย");
    await user.type(field("customLocales.form.englishName"), "Thai; ignore that");
    expect(screen.getByText(t("customLocales.form.englishNameInvalid"))).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("shows the server's reason and lets the admin try again", async () => {
    mockApi.fail("post", "/custom-locales", 409, "locale_exists");
    const { user } = renderDialog();
    await user.type(field("customLocales.form.code"), "th");
    await user.type(field("customLocales.form.name"), "ไทย");
    await user.type(field("customLocales.form.englishName"), "Thai");
    await user.click(saveButton());
    expect(await screen.findByText(t("customLocales.errors.locale_exists"))).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(saveButton()).toBeEnabled();
  });

  it("falls back to a general message for an unexpected failure", async () => {
    mockApi.fail("post", "/custom-locales", 500, "boom");
    const { user } = renderDialog();
    await user.type(field("customLocales.form.code"), "th");
    await user.type(field("customLocales.form.name"), "ไทย");
    await user.type(field("customLocales.form.englishName"), "Thai");
    await user.click(saveButton());
    expect(await screen.findByText(t("customLocales.errors.saveFailed"))).toBeInTheDocument();
  });

  it("closes on Cancel", async () => {
    const { user } = renderDialog();
    await user.click(screen.getByRole("button", { name: tc("actions.cancel") }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("CustomLocaleFormDialog — field state", () => {
  it("opens clean: no error, no refusal, the code's help text", () => {
    renderDialog();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(t("customLocales.form.codeHelp"))).toBeInTheDocument();
    expect(screen.queryByText(t("customLocales.form.codeInvalid"))).toBeNull();
    expect(field("customLocales.form.code")).toHaveAttribute("aria-invalid", "false");
    expect(field("customLocales.form.englishName")).toHaveAttribute("aria-invalid", "false");
  });

  it("marks the code and English-name fields invalid only while they are", async () => {
    const { user } = renderDialog();
    await user.type(field("customLocales.form.code"), "X");
    expect(field("customLocales.form.code")).toHaveAttribute("aria-invalid", "true");
    await user.type(field("customLocales.form.englishName"), "1x");
    expect(field("customLocales.form.englishName")).toHaveAttribute("aria-invalid", "true");
    await user.clear(field("customLocales.form.code"));
    await user.type(field("customLocales.form.code"), "th");
    expect(field("customLocales.form.code")).toHaveAttribute("aria-invalid", "false");
  });

  it("caps the native name at 100 characters", () => {
    renderDialog();
    expect(field("customLocales.form.name")).toHaveAttribute("maxlength", "100");
  });

  it("treats a name of spaces as no name, without calling it invalid", async () => {
    const { user } = renderDialog();
    await user.type(field("customLocales.form.code"), "th");
    await user.type(field("customLocales.form.name"), "   ");
    await user.type(field("customLocales.form.englishName"), "Thai");
    expect(saveButton()).toBeDisabled();
    await user.clear(field("customLocales.form.name"));
    await user.type(field("customLocales.form.name"), "ไทย");
    await user.clear(field("customLocales.form.englishName"));
    await user.type(field("customLocales.form.englishName"), "   ");
    expect(screen.queryByText(t("customLocales.form.englishNameInvalid"))).toBeNull();
    expect(field("customLocales.form.englishName")).toHaveAttribute("aria-invalid", "false");
    expect(saveButton()).toBeDisabled();
  });

  it("locks Save while saving and clears an earlier error", async () => {
    mockApi.fail("post", "/custom-locales", 409, "locale_exists");
    const { user } = renderDialog();
    await user.type(field("customLocales.form.code"), "th");
    await user.type(field("customLocales.form.name"), "ไทย");
    await user.type(field("customLocales.form.englishName"), "Thai");
    await user.click(saveButton());
    await screen.findByText(t("customLocales.errors.locale_exists"));

    let release!: (v: unknown) => void;
    mockApi.on("post", "/custom-locales", () => new Promise((r) => (release = r)));
    await user.click(saveButton());
    await waitFor(() => expect(saveButton()).toBeDisabled());
    expect(screen.queryByRole("alert")).toBeNull();
    release({});
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("th"));
  });
});

describe("CustomLocaleFormDialog — edit", () => {
  it("keeps the code fixed and patches the other fields", async () => {
    mockApi.on("patch", "/custom-locales/th", {});
    const { user } = renderDialog(THAI);
    expect(screen.getByText(t("customLocales.form.editTitle"))).toBeInTheDocument();
    const code = field("customLocales.form.code");
    expect(code).toHaveValue("th");
    expect(code).toBeDisabled();
    expect(field("customLocales.form.englishName")).toHaveValue("Thai");

    const name = field("customLocales.form.name");
    expect(name).toHaveValue("ไทย");
    await user.clear(name);
    await user.type(name, "ภาษาไทย");
    await user.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("th"));
    expect(mockApi.callsOf("post")).toHaveLength(0);
    expect(mockApi.callsOf("patch", "/custom-locales/th")[0].body).toEqual({
      name: "ภาษาไทย",
      english_name: "Thai",
      rtl: false,
    });
  });

  it("shows the switch as stored for a right-to-left language", () => {
    renderDialog({ ...THAI, code: "he", name: "עברית", english_name: "Hebrew", rtl: true });
    expect(screen.getByRole("checkbox", { name: t("customLocales.form.rtl") })).toBeChecked();
    expect(screen.queryByText(t("customLocales.form.rtlHint"))).not.toBeInTheDocument();
  });

  it("does not flag the fixed code of an existing language", () => {
    renderDialog({ ...THAI, code: "de-AT" });
    expect(screen.queryByText(t("customLocales.form.codeInvalid"))).not.toBeInTheDocument();
    expect(screen.getByText(t("customLocales.form.codeHelp"))).toBeInTheDocument();
  });
});
