import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

const spies = vi.hoisted(() => ({
  refreshBootstrap: vi.fn(async () => {}),
  invalidateMetamodel: vi.fn(async () => {}),
  refreshCustomLocale: vi.fn(async () => true),
  setAppLanguage: vi.fn(async () => "en"),
  forgetLoadedLocale: vi.fn(),
  downloadJson: vi.fn(),
}));

vi.mock("@/api/bootstrap", () => ({ refreshBootstrap: spies.refreshBootstrap }));
vi.mock("@/hooks/useMetamodel", () => ({ invalidateCache: spies.invalidateMetamodel }));
vi.mock("@/i18n/customLocales", () => ({
  refreshCustomLocale: spies.refreshCustomLocale,
  setAppLanguage: spies.setAppLanguage,
  forgetLoadedLocale: spies.forgetLoadedLocale,
}));
vi.mock("./customLocaleUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./customLocaleUtils")>()),
  downloadJson: spies.downloadJson,
}));

// The dialogs have their own tests; here they are markers that call back.
vi.mock("./CustomLocaleFormDialog", () => ({
  default: ({
    locale,
    onClose,
    onSaved,
  }: {
    locale: { code: string } | null;
    onClose: () => void;
    onSaved: (code: string) => void;
  }) => (
    <div data-testid="form-dialog" data-locale={locale?.code ?? "new"}>
      <button onClick={() => onSaved("nl")}>stub-saved</button>
      <button onClick={onClose}>stub-close</button>
    </div>
  ),
}));
vi.mock("./ImportPackDialog", () => ({
  default: ({ locale, onImported, onClose }: { locale: { code: string }; onImported: () => void; onClose: () => void }) => (
    <div data-testid="import-dialog" data-locale={locale.code}>
      <button onClick={onImported}>stub-imported</button>
      <button onClick={onClose}>stub-close</button>
    </div>
  ),
}));
vi.mock("./TranslateDialog", () => ({
  POLL_INTERVAL_MS: 3000,
  default: ({
    locale,
    onStarted,
    onFinished,
    onClose,
  }: {
    locale: { code: string };
    onStarted?: () => void;
    onFinished: () => void;
    onClose: () => void;
  }) => (
    <div data-testid="translate-dialog" data-locale={locale.code}>
      <button onClick={onStarted}>stub-started</button>
      <button onClick={onFinished}>stub-finished</button>
      <button onClick={onClose}>stub-close</button>
    </div>
  ),
}));
vi.mock("./ReviewStringsDialog", () => ({
  default: ({
    locale,
    onChanged,
    onClose,
  }: {
    locale: { code: string };
    onChanged: (ns: string) => void;
    onClose: () => void;
  }) => (
    <div data-testid="review-dialog" data-locale={locale.code}>
      <button onClick={() => onChanged("common")}>stub-changed-ui</button>
      <button onClick={() => onChanged("metamodel")}>stub-changed-labels</button>
      <button onClick={onClose}>stub-close</button>
    </div>
  ),
}));

import { api } from "@/api/client";
import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import type { CustomLocale } from "@/types";
import CustomLocalesSection from "./CustomLocalesSection";

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`admin:${key}`, opts) as string;
const tc = (key: string) => i18n.t(`common:${key}`) as string;

const HEBREW: CustomLocale = {
  code: "he",
  name: "עברית",
  english_name: "Hebrew",
  rtl: true,
  enabled: true,
  stats: { total: 200, translated: 150, missing: 30, stale: 20 },
  job: null,
};
const HINDI: CustomLocale = {
  code: "hi",
  name: "हिन्दी",
  english_name: "Hindi",
  rtl: false,
  enabled: false,
  stats: { total: 200, translated: 200, missing: 0, stale: 0 },
  job: { status: "running", mode: "all", total: 10, done: 2, failed: 0 },
};

function listReads() {
  return mockApi.callsOf("get", "/custom-locales").length;
}

/** Hindi with no job: lists that poll nothing, so a re-read is the code's own. */
const HINDI_IDLE: CustomLocale = { ...HINDI, job: null };

async function renderSection(list: CustomLocale[] = [HEBREW, HINDI_IDLE]) {
  mockApi.on("get", "/custom-locales", list);
  const result = renderWithProviders(<CustomLocalesSection />);
  if (list.length) await screen.findByText(list[0].name);
  return result;
}

function row(code: string) {
  return within(screen.getByTestId(`custom-locale-${code}`));
}

beforeEach(() => {
  mockApi.reset();
  for (const spy of Object.values(spies)) spy.mockClear();
  spies.invalidateMetamodel.mockImplementation(async () => {});
  expect(api).toBe(mockApi.api);
});

afterEach(async () => {
  vi.useRealTimers();
  if (i18n.language !== "en") await i18n.changeLanguage("en");
});

describe("CustomLocalesSection — list", () => {
  it("shows each language with its progress, open counts and state", async () => {
    await renderSection([HEBREW, HINDI]);
    expect(screen.getByRole("heading", { name: t("customLocales.title") })).toBeInTheDocument();

    const he = row("he");
    expect(he.getByText(`he · Hebrew · ${t("customLocales.rtlShort")}`)).toBeInTheDocument();
    expect(he.getByText(t("customLocales.progress", { translated: 150, total: 200 }))).toBeInTheDocument();
    expect(he.getByRole("progressbar", { name: t("customLocales.progressLabel", { name: "עברית" }) }))
      .toHaveAttribute("aria-valuenow", "75");
    expect(he.getByText(t("customLocales.missingCount", { count: 30 }))).toBeInTheDocument();
    expect(he.getByText(t("customLocales.staleCount", { count: 20 }))).toBeInTheDocument();
    expect(he.queryByText(/^Translating/)).toBeNull();
    expect(he.getByRole("checkbox", { name: t("customLocales.enabledLabel", { name: "עברית" }) })).toBeChecked();

    const hi = row("hi");
    expect(hi.getByText("hi · Hindi")).toBeInTheDocument();
    expect(hi.queryByText(t("customLocales.missingCount", { count: 0 }))).toBeNull();
    expect(hi.queryByText(t("customLocales.staleCount", { count: 0 }))).toBeNull();
    // 2 of 10 strings done.
    expect(hi.getByText(t("customLocales.jobStatus.runningPercent", { percent: 20 }))).toBeInTheDocument();
    expect(hi.getByRole("checkbox", { name: t("customLocales.enabledLabel", { name: "हिन्दी" }) })).not.toBeChecked();
    expect(mockApi.callsOf("get", "/custom-locales")).toHaveLength(1);
    expect(screen.queryByText(t("customLocales.empty"))).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a bare loading bar, and no rows, until the first read lands — and never again after", async () => {
    let release!: (v: unknown) => void;
    mockApi.on("get", "/custom-locales", () => new Promise((r) => (release = r)));
    renderWithProviders(<CustomLocalesSection />);
    const bare = () => screen.queryAllByRole("progressbar").filter((el) => !el.getAttribute("aria-label"));
    await waitFor(() => expect(bare()).toHaveLength(1));
    expect(screen.queryByTestId(/^custom-locale-/)).toBeNull();
    expect(screen.queryByText(t("customLocales.empty"))).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();

    release([HEBREW]);
    await screen.findByText(HEBREW.name);
    expect(bare()).toHaveLength(0);

    // A re-read keeps the list on screen without the bar.
    let again!: (v: unknown) => void;
    mockApi.on("get", "/custom-locales", () => new Promise((r) => (again = r)));
    mockApi.on("patch", "/custom-locales/he", {});
    fireEvent.click(row("he").getByRole("checkbox"));
    await waitFor(() => expect(listReads()).toBe(2));
    expect(bare()).toHaveLength(0);
    expect(row("he").getByText(HEBREW.name)).toBeInTheDocument();
    again([HEBREW]);
  });

  it("shows a running job's share on its chip", async () => {
    await renderSection([
      { ...HEBREW, job: { status: "running", mode: "all", total: 7488, done: 3150, failed: 0 } },
    ]);
    expect(row("he").getByText("Translating… 42%")).toBeInTheDocument();
  });

  it("shows 100% once every string is done but the job has not reported its end", async () => {
    await renderSection([
      { ...HEBREW, job: { status: "running", mode: "all", total: 7488, done: 7488, failed: 0 } },
    ]);
    expect(row("he").getByText("Translating… 100%")).toBeInTheDocument();
  });

  it("shows no number on the chip before the job has counted its strings", async () => {
    await renderSection([
      { ...HEBREW, job: { status: "running", mode: "all", total: 0, done: 0, failed: 0 } },
    ]);
    const chip = row("he").getByText(t("customLocales.jobStatus.running"));
    expect(chip).toHaveTextContent(/^Translating…$/);
    expect(row("he").queryByText(/%/)).toBeNull();
  });

  it("shows no chip for a job that is not running", async () => {
    await renderSection([
      { ...HEBREW, job: { status: "completed", mode: "all", total: 10, done: 10, failed: 0 } },
    ]);
    expect(row("he").queryByText(/^Translating/)).toBeNull();
  });

  it("groups the translated counts the way the interface language does", async () => {
    await renderSection([
      { ...HEBREW, stats: { total: 7488, translated: 3150, missing: 4338, stale: 0 } },
    ]);
    expect(row("he").getByText("3,150 of 7,488 strings translated")).toBeInTheDocument();
  });

  it("says when there are no custom languages", async () => {
    await renderSection([]);
    expect(await screen.findByText(t("customLocales.empty"))).toBeInTheDocument();
  });

  it("says when the list cannot be loaded", async () => {
    mockApi.fail("get", "/custom-locales", 500);
    renderWithProviders(<CustomLocalesSection />);
    expect(await screen.findByText(t("customLocales.errors.loadFailed"))).toBeInTheDocument();
    expect(screen.queryByText(t("customLocales.empty"))).toBeNull();
  });

  it("shows a language without stats when the server has no English catalogue", async () => {
    const { user } = await renderSection([{ ...HEBREW, stats: null }]);
    const he = row("he");
    expect(he.getByText(t("customLocales.errors.catalog_unavailable"))).toBeInTheDocument();
    expect(he.queryByRole("progressbar")).toBeNull();
    expect(he.queryByText(/missing/)).toBeNull();
    expect(he.getByRole("button", { name: t("customLocales.actions.export") })).toBeDisabled();
    expect(he.getByRole("button", { name: t("customLocales.actions.review") })).toBeDisabled();
    expect(he.getByRole("button", { name: t("customLocales.actions.translate") })).toBeDisabled();
    // Import, edit, enable and delete still work.
    expect(he.getByRole("button", { name: t("customLocales.actions.import") })).toBeEnabled();
    expect(he.getByRole("checkbox")).toBeEnabled();
    await user.click(he.getByRole("button", { name: tc("actions.edit") }));
    expect(screen.getByTestId("form-dialog")).toHaveAttribute("data-locale", "he");
  });

  it("keeps the actions of a language that has stats", async () => {
    await renderSection([HEBREW]);
    const he = row("he");
    expect(he.queryByText(t("customLocales.errors.catalog_unavailable"))).toBeNull();
    expect(he.getByRole("button", { name: t("customLocales.actions.export") })).toBeEnabled();
    expect(he.getByRole("button", { name: t("customLocales.actions.review") })).toBeEnabled();
    expect(he.getByRole("button", { name: t("customLocales.actions.translate") })).toBeEnabled();
  });
});

describe("CustomLocalesSection — enable", () => {
  it("toggles a language and re-reads the list and the menu", async () => {
    const { user } = await renderSection();
    mockApi.on("patch", "/custom-locales/hi", {});
    await user.click(row("hi").getByRole("checkbox"));
    await waitFor(() => expect(listReads()).toBe(2));
    expect(mockApi.callsOf("patch", "/custom-locales/hi")[0].body).toEqual({ enabled: true });
    // Bootstrap carries the enabled list behind the language menu.
    expect(spies.refreshBootstrap).toHaveBeenCalledTimes(1);
    expect(spies.refreshCustomLocale).not.toHaveBeenCalled();
    expect(spies.invalidateMetamodel).not.toHaveBeenCalled();
  });

  it("turns an enabled language off", async () => {
    const { user } = await renderSection();
    mockApi.on("patch", "/custom-locales/he", {});
    await user.click(row("he").getByRole("checkbox"));
    await waitFor(() => expect(mockApi.callsOf("patch", "/custom-locales/he")).toHaveLength(1));
    expect(mockApi.callsOf("patch", "/custom-locales/he")[0].body).toEqual({ enabled: false });
  });

  it("reports a failed toggle and lets the alert be dismissed", async () => {
    const { user } = await renderSection();
    mockApi.fail("patch", "/custom-locales/he", 500);
    await user.click(row("he").getByRole("checkbox"));
    const alert = await screen.findByText(t("customLocales.errors.saveFailed"));
    expect(spies.refreshBootstrap).not.toHaveBeenCalled();
    await user.click(within(alert.closest(".MuiAlert-root") as HTMLElement).getByRole("button"));
    expect(screen.queryByText(t("customLocales.errors.saveFailed"))).toBeNull();
  });
});

describe("CustomLocalesSection — export", () => {
  it("offers the four packs, the share one explained, and downloads the chosen one", async () => {
    const pack = { format: "turbo-ea-language-pack", strings: {} };
    mockApi.on("get", "/custom-locales/he/export?mode=share", pack);
    const { user } = await renderSection();
    await user.click(row("he").getByRole("button", { name: t("customLocales.actions.export") }));
    const menu = await screen.findByRole("menu");
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual([
      t("customLocales.export.missing"),
      t("customLocales.export.all"),
      t("customLocales.export.current"),
      t("customLocales.export.share") + t("customLocales.export.shareHint"),
    ]);
    await user.click(items[3]);
    await waitFor(() => expect(spies.downloadJson).toHaveBeenCalledWith("turbo-ea-he-share.json", pack));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("exports the strings still to translate for the language picked", async () => {
    mockApi.on("get", "/custom-locales/hi/export?mode=missing", { strings: {} });
    const { user } = await renderSection();
    await user.click(row("hi").getByRole("button", { name: t("customLocales.actions.export") }));
    await user.click(await screen.findByRole("menuitem", { name: t("customLocales.export.missing") }));
    await waitFor(() =>
      expect(spies.downloadJson).toHaveBeenCalledWith("turbo-ea-hi-missing.json", { strings: {} }),
    );
  });

  it("reports a failed export", async () => {
    mockApi.fail("get", "/custom-locales/he/export?mode=all", 500);
    const { user } = await renderSection();
    await user.click(row("he").getByRole("button", { name: t("customLocales.actions.export") }));
    await user.click(await screen.findByRole("menuitem", { name: t("customLocales.export.all") }));
    expect(await screen.findByText(t("customLocales.errors.exportFailed"))).toBeInTheDocument();
    expect(spies.downloadJson).not.toHaveBeenCalled();
  });
});

describe("CustomLocalesSection — delete", () => {
  it("asks first, then deletes and forgets the language", async () => {
    mockApi.on("delete", "/custom-locales/he", {});
    const { user } = await renderSection();
    await user.click(row("he").getByRole("button", { name: tc("actions.delete") }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(t("customLocales.delete.confirm", { name: "עברית" }))).toBeInTheDocument();
    expect(mockApi.callsOf("delete")).toHaveLength(0);

    await user.click(within(dialog).getByRole("button", { name: tc("actions.delete") }));
    await waitFor(() => expect(mockApi.callsOf("delete", "/custom-locales/he")).toHaveLength(1));
    expect(spies.forgetLoadedLocale).toHaveBeenCalledWith("he");
    expect(spies.setAppLanguage).not.toHaveBeenCalled();
    expect(spies.refreshBootstrap).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(listReads()).toBe(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("switches to English when the deleted language is the active one", async () => {
    mockApi.on("delete", "/custom-locales/he", {});
    await act(() => i18n.changeLanguage("he"));
    const { user } = await renderSection();
    await user.click(row("he").getByRole("button", { name: tc("actions.delete") }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: tc("actions.delete") }));
    await waitFor(() => expect(spies.setAppLanguage).toHaveBeenCalledWith("en"));
  });

  it("keeps the language when Cancel is chosen", async () => {
    const { user } = await renderSection();
    await user.click(row("he").getByRole("button", { name: tc("actions.delete") }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: tc("actions.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockApi.callsOf("delete")).toHaveLength(0);
  });

  it("reports a failed delete", async () => {
    mockApi.fail("delete", "/custom-locales/he", 500);
    const { user } = await renderSection();
    await user.click(row("he").getByRole("button", { name: tc("actions.delete") }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: tc("actions.delete") }));
    expect(await screen.findByText(t("customLocales.errors.deleteFailed"))).toBeInTheDocument();
    expect(spies.forgetLoadedLocale).not.toHaveBeenCalled();
    // The confirmation closes so the error can be read and acted on.
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("CustomLocalesSection — dialogs", () => {
  it("opens the add dialog and, after a save, refreshes the list, the menu and the language", async () => {
    const { user } = await renderSection();
    await user.click(screen.getByRole("button", { name: new RegExp(`${t("customLocales.add")}$`) }));
    expect(screen.getByTestId("form-dialog")).toHaveAttribute("data-locale", "new");
    await user.click(screen.getByText("stub-saved"));
    expect(screen.queryByTestId("form-dialog")).toBeNull();
    await waitFor(() => expect(listReads()).toBe(2));
    expect(spies.refreshBootstrap).toHaveBeenCalledTimes(1);
    expect(spies.refreshCustomLocale).toHaveBeenCalledWith("nl");
    expect(spies.invalidateMetamodel).not.toHaveBeenCalled();
  });

  it("opens the edit dialog for the row", async () => {
    const { user } = await renderSection();
    await user.click(row("hi").getByRole("button", { name: tc("actions.edit") }));
    expect(screen.getByTestId("form-dialog")).toHaveAttribute("data-locale", "hi");
    await user.click(screen.getByText("stub-close"));
    expect(screen.queryByTestId("form-dialog")).toBeNull();
    expect(listReads()).toBe(1);
  });

  it("after an import refreshes the language and the database labels", async () => {
    const { user } = await renderSection();
    await user.click(row("he").getByRole("button", { name: t("customLocales.actions.import") }));
    expect(screen.getByTestId("import-dialog")).toHaveAttribute("data-locale", "he");
    await user.click(screen.getByText("stub-imported"));
    expect(spies.refreshCustomLocale).toHaveBeenCalledWith("he");
    expect(spies.invalidateMetamodel).toHaveBeenCalledTimes(1);
    expect(spies.refreshBootstrap).toHaveBeenCalledTimes(1);
    // The dialog stays open to show its report.
    expect(screen.getByTestId("import-dialog")).toBeInTheDocument();
    await waitFor(() => expect(listReads()).toBe(2));
  });

  it("after an AI run refreshes the language and the database labels", async () => {
    const { user } = await renderSection();
    await user.click(row("hi").getByRole("button", { name: t("customLocales.actions.translate") }));
    expect(screen.getByTestId("translate-dialog")).toHaveAttribute("data-locale", "hi");
    await user.click(screen.getByText("stub-finished"));
    expect(spies.refreshCustomLocale).toHaveBeenCalledWith("hi");
    expect(spies.invalidateMetamodel).toHaveBeenCalledTimes(1);
    expect(spies.refreshBootstrap).toHaveBeenCalledTimes(1);
    await user.click(screen.getByText("stub-close"));
    expect(screen.queryByTestId("translate-dialog")).toBeNull();
  });

  it("refreshes the database labels only after a manual edit of one", async () => {
    const { user } = await renderSection();
    await user.click(row("he").getByRole("button", { name: t("customLocales.actions.review") }));
    expect(screen.getByTestId("review-dialog")).toHaveAttribute("data-locale", "he");

    await user.click(screen.getByText("stub-changed-ui"));
    expect(spies.refreshCustomLocale).toHaveBeenCalledWith("he");
    expect(spies.invalidateMetamodel).not.toHaveBeenCalled();
    expect(spies.refreshBootstrap).toHaveBeenCalledTimes(1);

    await user.click(screen.getByText("stub-changed-labels"));
    expect(spies.invalidateMetamodel).toHaveBeenCalledTimes(1);
    expect(spies.refreshBootstrap).toHaveBeenCalledTimes(2);
  });
});

describe("CustomLocalesSection — following a running job", () => {
  const RUNNING: CustomLocale = {
    ...HEBREW,
    job: { status: "running", mode: "missing", total: 10, done: 1, failed: 0 },
  };
  const DONE: CustomLocale = {
    ...HEBREW,
    job: { status: "completed", mode: "missing", total: 10, done: 10, failed: 0 },
  };

  it("polls the list while a job runs and refreshes everything once it finished", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let reads = 0;
    mockApi.on("get", "/custom-locales", () => {
      reads += 1;
      return reads < 3 ? [RUNNING] : [DONE];
    });
    renderWithProviders(<CustomLocalesSection />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(reads).toBe(1);
    expect(row("he").getByText(t("customLocales.jobStatus.runningPercent", { percent: 10 }))).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2999);
    });
    expect(reads).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(reads).toBe(2);
    expect(spies.refreshCustomLocale).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(reads).toBe(3);
    expect(row("he").queryByText(/^Translating/)).toBeNull();
    expect(spies.refreshCustomLocale).toHaveBeenCalledWith("he");
    expect(spies.invalidateMetamodel).toHaveBeenCalledTimes(1);
    expect(spies.refreshBootstrap).toHaveBeenCalledTimes(1);

    // Nothing runs any more: no more reads.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(reads).toBe(3);
  });

  it("does not poll when no job runs", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    mockApi.on("get", "/custom-locales", [DONE]);
    renderWithProviders(<CustomLocalesSection />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(listReads()).toBe(1);
    expect(spies.refreshCustomLocale).not.toHaveBeenCalled();
  });

  it("re-reads the list when the AI dialog started a job", async () => {
    const { user } = await renderSection();
    await user.click(row("he").getByRole("button", { name: t("customLocales.actions.translate") }));
    await user.click(screen.getByText("stub-started"));
    await waitFor(() => expect(listReads()).toBe(2));
  });

  it("refreshes once, not twice, when the dialog reports a job the list also saw running", async () => {
    let reads = 0;
    mockApi.on("get", "/custom-locales", () => {
      reads += 1;
      return reads === 1 ? [RUNNING] : [DONE];
    });
    const { user } = renderWithProviders(<CustomLocalesSection />);
    await screen.findByText(HEBREW.name);
    await user.click(row("he").getByRole("button", { name: t("customLocales.actions.translate") }));
    await user.click(screen.getByText("stub-finished"));
    await waitFor(() => expect(reads).toBe(2));
    await waitFor(() => expect(row("he").queryByText(/^Translating/)).toBeNull());
    expect(spies.invalidateMetamodel).toHaveBeenCalledTimes(1);
    expect(spies.refreshBootstrap).toHaveBeenCalledTimes(1);
  });

  it("swallows a failed metamodel refresh", async () => {
    spies.invalidateMetamodel.mockImplementation(async () => {
      throw new Error("down");
    });
    const { user } = await renderSection();
    await user.click(row("he").getByRole("button", { name: t("customLocales.actions.import") }));
    await user.click(screen.getByText("stub-imported"));
    await waitFor(() => expect(spies.invalidateMetamodel).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("import-dialog")).toBeInTheDocument();
  });
});

describe("CustomLocalesSection — errors clear on the next action", () => {
  /** Any error alert, hidden behind an open dialog or not. */
  const anyAlert = () => document.querySelector(".MuiAlert-root");

  async function failToggle(user: Awaited<ReturnType<typeof renderSection>>["user"]) {
    mockApi.fail("patch", "/custom-locales/he", 500);
    await user.click(row("he").getByRole("checkbox"));
    await screen.findByText(t("customLocales.errors.saveFailed"));
  }

  it("clears a failed toggle's error when the next toggle works", async () => {
    const { user } = await renderSection();
    await failToggle(user);
    mockApi.on("patch", "/custom-locales/he", {});
    await user.click(row("he").getByRole("checkbox"));
    await waitFor(() => expect(anyAlert()).toBeNull());
  });

  it("clears it when an export starts", async () => {
    const { user } = await renderSection();
    await failToggle(user);
    let release!: (v: unknown) => void;
    mockApi.on("get", "/custom-locales/he/export?mode=all", () => new Promise((r) => (release = r)));
    await user.click(row("he").getByRole("button", { name: t("customLocales.actions.export") }));
    await user.click(await screen.findByRole("menuitem", { name: t("customLocales.export.all") }));
    await waitFor(() => expect(anyAlert()).toBeNull());
    release({});
  });

  it("clears it when a delete starts", async () => {
    const { user } = await renderSection();
    await failToggle(user);
    let release!: (v: unknown) => void;
    mockApi.on("delete", "/custom-locales/he", () => new Promise((r) => (release = r)));
    await user.click(row("he").getByRole("button", { name: tc("actions.delete") }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: tc("actions.delete") }),
    );
    await waitFor(() => expect(anyAlert()).toBeNull());
    release({});
  });

  it("closes the export menu on Escape", async () => {
    const { user } = await renderSection();
    await user.click(row("he").getByRole("button", { name: t("customLocales.actions.export") }));
    await screen.findByRole("menu");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(mockApi.callsOf("get", /export/)).toHaveLength(0);
  });
});

describe("CustomLocalesSection — one poll timer at a time", () => {
  it("drops the pending poll when the list is re-read for another reason", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const RUNNING: CustomLocale = {
      ...HEBREW,
      job: { status: "running", mode: "missing", total: 10, done: 1, failed: 0 },
    };
    mockApi.on("get", "/custom-locales", [RUNNING]);
    mockApi.on("patch", "/custom-locales/he", {});
    renderWithProviders(<CustomLocalesSection />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(listReads()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    // A toggle re-reads the list at t = 1 s; the poll is re-armed from there.
    fireEvent.click(row("he").getByRole("checkbox"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(listReads()).toBe(2);
    // The poll armed at t = 0 would have fired at 3 s: it must be gone.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(listReads()).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(listReads()).toBe(3);
  });
});
