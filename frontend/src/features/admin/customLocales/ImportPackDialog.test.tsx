import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { api } from "@/api/client";
import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import type { CustomLocale } from "@/types";
import ImportPackDialog from "./ImportPackDialog";

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`admin:${key}`, opts) as string;
const tc = (key: string) => i18n.t(`common:${key}`) as string;

const HEBREW: CustomLocale = {
  code: "he",
  name: "עברית",
  english_name: "Hebrew",
  rtl: true,
  enabled: true,
  stats: { total: 10, translated: 0, missing: 10, stale: 0 },
  job: null,
};

const STRINGS_PATH = "/custom-locales/he/strings";

function packText(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    format: "turbo-ea-language-pack",
    format_version: 1,
    locale: { code: "he", name: "עברית" },
    strings: {
      metamodel: { "type.Application.label": "יישום" },
      common: { "actions.save": "שמור", "actions.cancel": "ביטול" },
    },
    source_hashes: { common: { "actions.save": "abc123" } },
    ...over,
  });
}

function result(over: Record<string, unknown> = {}) {
  return { applied: 0, unchanged: 0, cleared: 0, rejected: [], unknown: 0, ...over };
}

const onClose = vi.fn();
const onImported = vi.fn();

function renderDialog() {
  return renderWithProviders(
    <ImportPackDialog locale={HEBREW} onClose={onClose} onImported={onImported} />,
  );
}

function pick(text: string, name = "he.json") {
  const input = screen.getByTestId("language-pack-input");
  fireEvent.change(input, { target: { files: [new File([text], name, { type: "application/json" })] } });
}

function importButton() {
  return screen.getByRole("button", { name: tc("actions.import") });
}

beforeEach(() => {
  mockApi.reset();
  onClose.mockReset();
  onImported.mockReset();
  expect(api).toBe(mockApi.api);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ImportPackDialog", () => {
  it("offers nothing to import until a file is picked", () => {
    renderDialog();
    expect(screen.getByText(t("customLocales.import.title", { name: "עברית" }))).toBeInTheDocument();
    expect(importButton()).toBeDisabled();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("opens the file picker from the button", async () => {
    const { user } = renderDialog();
    const input = screen.getByTestId("language-pack-input") as HTMLInputElement;
    const click = vi.spyOn(input, "click");
    await user.click(screen.getByRole("button", { name: new RegExp(`${t("customLocales.import.chooseFile")}$`) }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(input.accept).toBe(".json,application/json");
  });

  it("posts one namespace per request and reports the totals and each rejection", async () => {
    mockApi.on("post", STRINGS_PATH, (_p: string, body: unknown) => {
      const ns = Object.keys((body as { strings: Record<string, unknown> }).strings)[0];
      return ns === "common"
        ? result({ applied: 2, unknown: 1 })
        : result({
            unchanged: 1,
            cleared: 3,
            rejected: [{ namespace: "metamodel", key: "type.Application.label", reason: "source_changed" }],
          });
    });
    const { user } = renderDialog();
    pick(packText());
    expect(
      await screen.findByText(
        t("customLocales.import.summary", { file: "he.json", count: 3, namespaces: 2 }),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/customLocales.import.codeMismatch/)).not.toBeInTheDocument();

    await user.click(importButton());
    const report = await screen.findByTestId("import-report");
    expect(mockApi.callsOf("post", STRINGS_PATH).map((c) => c.body)).toEqual([
      {
        strings: { common: { "actions.save": "שמור", "actions.cancel": "ביטול" } },
        source_hashes: { common: { "actions.save": "abc123" } },
        origin: "import",
      },
      { strings: { metamodel: { "type.Application.label": "יישום" } }, origin: "import" },
    ]);
    expect(
      within(report).getByText(
        t("customLocales.import.result", {
          applied: 2,
          unchanged: 1,
          cleared: 3,
          rejected: 1,
          unknown: 1,
        }),
      ),
    ).toBeInTheDocument();
    expect(
      within(report).getByText(
        `${t("customLocales.namespaces.metamodel")} · type.Application.label`,
      ),
    ).toBeInTheDocument();
    expect(within(report).getByText(t("customLocales.reasons.source_changed"))).toBeInTheDocument();
    expect(within(report).getByRole("alert")).toHaveClass("MuiAlert-standardWarning");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: tc("actions.import") })).not.toBeInTheDocument();
  });

  it("reports a clean import as a success", async () => {
    mockApi.on("post", STRINGS_PATH, result({ applied: 1 }));
    const { user } = renderDialog();
    pick(packText({ strings: { common: { "actions.save": "שמור" } } }));
    await screen.findByText(t("customLocales.import.summary", { file: "he.json", count: 1, namespaces: 1 }));
    await user.click(importButton());
    const report = await screen.findByTestId("import-report");
    expect(within(report).getByRole("alert")).toHaveClass("MuiAlert-standardSuccess");
    expect(screen.queryByText(t("customLocales.import.rejectedTitle"))).not.toBeInTheDocument();
  });

  it("counts a reply's missing or non-numeric totals as zero", async () => {
    mockApi.on("post", STRINGS_PATH, { applied: "2", rejected: "x" });
    const { user } = renderDialog();
    pick(packText({ strings: { common: { "actions.save": "שמור" } } }));
    await screen.findByText(t("customLocales.import.summary", { file: "he.json", count: 1, namespaces: 1 }));
    await user.click(importButton());
    expect(
      await screen.findByText(
        t("customLocales.import.result", { applied: 0, unchanged: 0, cleared: 0, rejected: 0, unknown: 0 }),
      ),
    ).toBeInTheDocument();
  });

  it("asks before importing a pack made for another language", async () => {
    mockApi.on("post", STRINGS_PATH, result());
    const { user } = renderDialog();
    pick(packText({ locale: { code: "ar" } }));
    expect(
      await screen.findByText(t("customLocales.import.codeMismatch", { packCode: "ar", code: "he" })),
    ).toBeInTheDocument();
    expect(importButton()).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: t("customLocales.import.confirmMismatch") }));
    expect(importButton()).toBeEnabled();
    await user.click(importButton());
    await screen.findByTestId("import-report");
    expect(mockApi.callsOf("post", STRINGS_PATH)).toHaveLength(2);
  });

  it.each([
    ["is not JSON", "{oops", "customLocales.import.invalidJson"],
    ["is not a pack", JSON.stringify({ hello: 1 }), "customLocales.import.notAPack"],
    ["has a newer format", packText({ format_version: 9 }), "customLocales.import.unsupportedVersion"],
    ["has no strings", packText({ strings: {} }), "customLocales.import.noStrings"],
  ])("refuses a file that %s", async (_label, text, key) => {
    renderDialog();
    pick(text);
    expect(await screen.findByText(t(key))).toBeInTheDocument();
    expect(importButton()).toBeDisabled();
  });

  it("refuses a file that cannot be read", async () => {
    class FailingReader {
      error = new Error("unreadable");
      onerror: (() => void) | null = null;
      readAsText() {
        this.onerror?.();
      }
    }
    vi.stubGlobal("FileReader", FailingReader);
    renderDialog();
    pick(packText());
    expect(await screen.findByText(t("customLocales.import.invalidJson"))).toBeInTheDocument();
  });

  it("clears an earlier error when a good file is picked", async () => {
    renderDialog();
    pick("{oops");
    await screen.findByText(t("customLocales.import.invalidJson"));
    pick(packText());
    await screen.findByText(t("customLocales.import.summary", { file: "he.json", count: 3, namespaces: 2 }));
    expect(screen.queryByText(t("customLocales.import.invalidJson"))).not.toBeInTheDocument();
    expect(importButton()).toBeEnabled();
  });

  it("goes on with the other namespaces when one request fails, and says which", async () => {
    mockApi.on("post", STRINGS_PATH, (_p: string, body: unknown) => {
      const ns = Object.keys((body as { strings: Record<string, unknown> }).strings)[0];
      if (ns === "common") return Promise.reject(new Error("network down"));
      return result({ applied: 1 });
    });
    const { user } = renderDialog();
    pick(packText());
    await screen.findByText(t("customLocales.import.summary", { file: "he.json", count: 3, namespaces: 2 }));
    await user.click(importButton());
    const report = await screen.findByTestId("import-report");
    expect(mockApi.callsOf("post", STRINGS_PATH)).toHaveLength(2);
    expect(
      within(report).getByText(
        t("customLocales.import.namespaceFailed", { namespace: "common", message: "network down" }),
      ),
    ).toBeInTheDocument();
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it("names a failed namespace by its label and the server's reason", async () => {
    mockApi.fail("post", STRINGS_PATH, 503, "catalog_unavailable");
    const { user } = renderDialog();
    pick(packText({ strings: { metamodel: { "type.Application.label": "יישום" } } }));
    await screen.findByText(t("customLocales.import.summary", { file: "he.json", count: 1, namespaces: 1 }));
    await user.click(importButton());
    expect(
      await screen.findByText(
        t("customLocales.import.namespaceFailed", {
          namespace: t("customLocales.namespaces.metamodel"),
          message: t("customLocales.errors.catalog_unavailable"),
        }),
      ),
    ).toBeInTheDocument();
  });

  it("lists the first hundred rejections and counts the rest", async () => {
    const rejected = Array.from({ length: 102 }, (_, i) => ({
      namespace: "common",
      key: `k${i}`,
      reason: "empty",
    }));
    mockApi.on("post", STRINGS_PATH, result({ rejected }));
    const { user } = renderDialog();
    pick(packText({ strings: { common: { a: "" } } }));
    await screen.findByText(t("customLocales.import.summary", { file: "he.json", count: 1, namespaces: 1 }));
    await user.click(importButton());
    await screen.findByTestId("import-report");
    expect(screen.getByText("common · k99")).toBeInTheDocument();
    expect(screen.queryByText("common · k100")).not.toBeInTheDocument();
    expect(screen.getByText(t("customLocales.import.moreRejected", { count: 2 }))).toBeInTheDocument();
    expect(screen.getAllByText(t("customLocales.reasons.empty"))).toHaveLength(100);
  });

  it("does not count the rest when exactly a hundred are rejected", async () => {
    const rejected = Array.from({ length: 100 }, (_, i) => ({
      namespace: "common",
      key: `k${i}`,
      reason: "brand_new_reason",
    }));
    mockApi.on("post", STRINGS_PATH, result({ rejected }));
    const { user } = renderDialog();
    pick(packText({ strings: { common: { a: "" } } }));
    await screen.findByText(t("customLocales.import.summary", { file: "he.json", count: 1, namespaces: 1 }));
    await user.click(importButton());
    await screen.findByTestId("import-report");
    expect(screen.getAllByText("brand_new_reason")).toHaveLength(100);
    expect(screen.queryByText(/and \d+ more/)).not.toBeInTheDocument();
  });

  it("closes on Close", async () => {
    const { user } = renderDialog();
    await user.click(screen.getByRole("button", { name: tc("actions.close") }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("locks Close while the import runs", async () => {
    let release!: (v: unknown) => void;
    mockApi.on(
      "post",
      STRINGS_PATH,
      () =>
        new Promise((r) => {
          release = r;
        }),
    );
    const { user } = renderDialog();
    pick(packText({ strings: { common: { a: "b" } } }));
    await screen.findByText(t("customLocales.import.summary", { file: "he.json", count: 1, namespaces: 1 }));
    await user.click(importButton());
    await waitFor(() => expect(screen.getByRole("button", { name: tc("actions.close") })).toBeDisabled());
    expect(importButton()).toBeDisabled();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    release(result());
    await screen.findByTestId("import-report");
    expect(screen.getByRole("button", { name: tc("actions.close") })).toBeEnabled();
  });
});
