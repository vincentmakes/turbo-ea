import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { api } from "@/api/client";
import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import type { CustomLocale, CustomLocaleString } from "@/types";
import ReviewStringsDialog from "./ReviewStringsDialog";

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`admin:${key}`, opts) as string;

const HEBREW: CustomLocale = {
  code: "he",
  name: "עברית",
  english_name: "Hebrew",
  rtl: true,
  enabled: true,
  stats: { total: 14, translated: 6, missing: 8, stale: 0 },
  job: null,
};

const SAVED: CustomLocaleString = {
  namespace: "common",
  key: "actions.save",
  source: "Save",
  value: "שמור",
  status: "translated",
  origin: "manual",
};
const TYPE_LABEL: CustomLocaleString = {
  namespace: "metamodel",
  key: "type.Application.label",
  source: "Application",
  value: null,
  status: "missing",
  origin: null,
};
const STALE: CustomLocaleString = {
  namespace: "common",
  key: "actions.cancel",
  source: "Cancel",
  value: "בטל",
  status: "stale",
  origin: "ai",
};

const STRINGS = /^\/custom-locales\/he\/strings\?/;
const METAMODEL_LABEL = () => t("customLocales.namespaces.metamodel");

const onClose = vi.fn();
const onChanged = vi.fn();

function stringReads() {
  return mockApi.callsOf("get", STRINGS).map((c) => new URLSearchParams(c.path.split("?")[1]));
}

function lastRead() {
  const reads = stringReads();
  return Object.fromEntries(reads[reads.length - 1].entries());
}

function serve(items: CustomLocaleString[], total = items.length) {
  mockApi.on("get", STRINGS, { total, items });
}

function renderDialog() {
  return renderWithProviders(
    <ReviewStringsDialog locale={HEBREW} onClose={onClose} onChanged={onChanged} />,
  );
}

function rowOf(text: string): HTMLElement {
  const row = screen.getByText(text).closest("tr");
  if (!row) throw new Error(`no row for ${text}`);
  return row as HTMLElement;
}

beforeEach(() => {
  mockApi.reset();
  onClose.mockReset();
  onChanged.mockReset();
  expect(api).toBe(mockApi.api);
  mockApi.on("get", "/custom-locales/he", {
    ...HEBREW,
    namespaces: [
      { namespace: "common", total: 10, translated: 5, missing: 5, stale: 0 },
      { namespace: "metamodel", total: 4, translated: 1, missing: 3, stale: 0 },
    ],
  });
});

describe("ReviewStringsDialog", () => {
  it("lists the strings still to do, English beside the translation", async () => {
    serve([SAVED, TYPE_LABEL, STALE]);
    renderDialog();
    expect(await screen.findByText("שמור")).toBeInTheDocument();
    expect(lastRead()).toEqual({ status: "untranslated", limit: "25", offset: "0" });

    expect(within(rowOf("Save")).getByText("common · actions.save")).toBeInTheDocument();
    expect(within(rowOf("Save")).getByText(t("customLocales.status.translated"))).toBeInTheDocument();
    const typeRow = rowOf("Application");
    expect(within(typeRow).getByText(`${METAMODEL_LABEL()} · type.Application.label`)).toBeInTheDocument();
    expect(within(typeRow).getByText(t("customLocales.review.noTranslation"))).toBeInTheDocument();
    expect(within(typeRow).getByText(t("customLocales.status.missing"))).toBeInTheDocument();
    // Nothing to clear on a string that has no translation.
    expect(within(typeRow).queryByRole("button", { name: t("customLocales.review.clear") })).toBeNull();
    expect(within(rowOf("Cancel")).getByText(t("customLocales.status.stale"))).toBeInTheDocument();
    expect(screen.getByText(t("customLocales.review.displayedRows", { from: 1, to: 3, total: 3 })))
      .toBeInTheDocument();
  });

  it("offers each namespace with its progress, the database labels by name", async () => {
    serve([SAVED]);
    const { user } = renderDialog();
    await screen.findByText("שמור");
    await user.click(screen.getByRole("combobox", { name: new RegExp(`^${t("customLocales.review.namespace")}`) }));
    const list = await screen.findByRole("listbox");
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual([
      t("customLocales.review.allNamespaces"),
      "common (5/10)",
      `${METAMODEL_LABEL()} (1/4)`,
    ]);
    await user.click(within(list).getByRole("option", { name: `${METAMODEL_LABEL()} (1/4)` }));
    await waitFor(() => expect(lastRead().namespace).toBe("metamodel"));
    expect(lastRead().offset).toBe("0");
  });

  it("filters by status", async () => {
    serve([SAVED]);
    const { user } = renderDialog();
    await screen.findByText("שמור");
    await user.click(screen.getByRole("combobox", { name: new RegExp(`^${t("customLocales.review.status")}`) }));
    const list = await screen.findByRole("listbox");
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual([
      t("customLocales.review.filter.untranslated"),
      t("customLocales.review.filter.missing"),
      t("customLocales.review.filter.stale"),
      t("customLocales.review.filter.translated"),
      t("customLocales.review.filter.all"),
    ]);
    await user.click(within(list).getByRole("option", { name: t("customLocales.review.filter.translated") }));
    await waitFor(() => expect(lastRead().status).toBe("translated"));
  });

  it("searches on the server once typing settles, trimmed", async () => {
    serve([SAVED]);
    renderDialog();
    await screen.findByText("שמור");
    // One change event: the debounce settles once, whatever the machine's speed.
    fireEvent.change(screen.getByRole("textbox", { name: t("customLocales.review.search") }), {
      target: { value: " Sav " },
    });
    // Not before the debounce settles.
    expect(stringReads().some((p) => p.has("search"))).toBe(false);
    await waitFor(() => expect(lastRead().search).toBe("Sav"));
    expect(stringReads().filter((p) => p.has("search"))).toHaveLength(1);
  });

  it("pages through the server's results", async () => {
    serve([SAVED], 60);
    const { user } = renderDialog();
    await screen.findByText(t("customLocales.review.displayedRows", { from: 1, to: 25, total: 60 }));
    await user.click(screen.getByRole("button", { name: t("customLocales.review.nextPage") }));
    await waitFor(() => expect(lastRead().offset).toBe("25"));
    expect(screen.getByRole("button", { name: t("customLocales.review.previousPage") })).toBeEnabled();

    await user.click(screen.getByRole("combobox", { name: new RegExp(`^${t("customLocales.review.rowsPerPage")}`) }));
    await user.click(await screen.findByRole("option", { name: "50" }));
    await waitFor(() => expect(lastRead()).toMatchObject({ limit: "50", offset: "0" }));
  });

  it("goes back to the first page when a filter changes", async () => {
    serve([SAVED], 60);
    const { user } = renderDialog();
    await screen.findByText(t("customLocales.review.displayedRows", { from: 1, to: 25, total: 60 }));
    await user.click(screen.getByRole("button", { name: t("customLocales.review.nextPage") }));
    await waitFor(() => expect(lastRead().offset).toBe("25"));
    await user.type(screen.getByRole("textbox", { name: t("customLocales.review.search") }), "x");
    await waitFor(() => expect(lastRead()).toMatchObject({ search: "x", offset: "0" }));
  });

  it("saves a corrected database label as a manual edit and reloads", async () => {
    serve([TYPE_LABEL]);
    mockApi.on("post", "/custom-locales/he/strings", {
      applied: 1,
      unchanged: 0,
      cleared: 0,
      rejected: [],
      unknown: 0,
    });
    const { user } = renderDialog();
    await screen.findByText("Application");
    const readsBefore = stringReads().length;
    await user.click(within(rowOf("Application")).getByRole("button", { name: /Edit/ }));
    const input = screen.getByRole("textbox", { name: t("customLocales.review.translation") });
    await user.type(input, "יישום");
    await user.click(screen.getByRole("button", { name: /Save/ }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith("metamodel"));
    expect(mockApi.callsOf("post", "/custom-locales/he/strings")[0].body).toEqual({
      strings: { metamodel: { "type.Application.label": "יישום" } },
      origin: "manual",
    });
    await waitFor(() => expect(stringReads().length).toBe(readsBefore + 1));
    expect(screen.queryByRole("textbox", { name: t("customLocales.review.translation") })).toBeNull();
  });

  it("starts an edit of an untranslated string empty, with the English as a hint", async () => {
    serve([TYPE_LABEL]);
    const { user } = renderDialog();
    await screen.findByText("Application");
    await user.click(within(rowOf("Application")).getByRole("button", { name: /Edit/ }));
    const input = screen.getByRole("textbox", { name: t("customLocales.review.translation") });
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("placeholder", "Application");
    // Saving it unchanged would store English: not offered.
    expect(screen.getByRole("button", { name: /Save/ })).toBeDisabled();
  });

  it("shows and edits a right-to-left translation in its own direction and language", async () => {
    serve([SAVED, TYPE_LABEL]);
    const { user } = renderDialog();
    const shown = await screen.findByText("שמור");
    expect(shown).toHaveAttribute("dir", "rtl");
    expect(shown).toHaveAttribute("lang", "he");
    // The English stand-in for a missing string is not in the language.
    const placeholder = within(rowOf("Application")).getByText(t("customLocales.review.noTranslation"));
    expect(placeholder).not.toHaveAttribute("dir");
    expect(placeholder).not.toHaveAttribute("lang");
    await user.click(within(rowOf("Save")).getByRole("button", { name: /Edit/ }));
    const input = screen.getByRole("textbox", { name: t("customLocales.review.translation") });
    expect(input).toHaveAttribute("dir", "rtl");
    expect(input).toHaveAttribute("lang", "he");
  });

  it("uses left to right for a left-to-right language", async () => {
    mockApi.on("get", "/custom-locales/hi", { ...HEBREW, code: "hi", namespaces: [] });
    mockApi.on("get", /^\/custom-locales\/hi\/strings\?/, { total: 1, items: [{ ...SAVED, value: "सहेजें" }] });
    renderWithProviders(
      <ReviewStringsDialog
        locale={{ ...HEBREW, code: "hi", rtl: false }}
        onClose={onClose}
        onChanged={onChanged}
      />,
    );
    const shown = await screen.findByText("सहेजें");
    expect(shown).toHaveAttribute("dir", "ltr");
    expect(shown).toHaveAttribute("lang", "hi");
  });

  it("steps back a page when the last row of the last page is translated away", async () => {
    let total = 26;
    mockApi.on("get", STRINGS, () => ({ total, items: total === 26 ? [SAVED] : [STALE] }));
    const { user } = renderDialog();
    await screen.findByText(t("customLocales.review.displayedRows", { from: 1, to: 25, total: 26 }));
    await user.click(screen.getByRole("button", { name: t("customLocales.review.nextPage") }));
    await waitFor(() => expect(lastRead().offset).toBe("25"));
    total = 25;
    mockApi.on("post", "/custom-locales/he/strings", {
      applied: 0, unchanged: 0, cleared: 1, rejected: [], unknown: 0,
    });
    await user.click(await screen.findByRole("button", { name: t("customLocales.review.clear") }));
    await waitFor(() => expect(lastRead().offset).toBe("0"));
    expect(await screen.findByText("בטל")).toBeInTheDocument();
    expect(screen.queryByText(t("customLocales.review.empty"))).toBeNull();
  });

  it("starts an edit from the current translation", async () => {
    serve([SAVED]);
    const { user } = renderDialog();
    await screen.findByText("שמור");
    await user.click(within(rowOf("Save")).getByRole("button", { name: /Edit/ }));
    expect(screen.getByRole("textbox", { name: t("customLocales.review.translation") })).toHaveValue("שמור");
  });

  it("will not save an empty translation", async () => {
    serve([SAVED]);
    const { user } = renderDialog();
    await screen.findByText("שמור");
    await user.click(within(rowOf("Save")).getByRole("button", { name: /Edit/ }));
    await user.clear(screen.getByRole("textbox", { name: t("customLocales.review.translation") }));
    expect(screen.getByRole("button", { name: /Save/ })).toBeDisabled();
  });

  it("keeps the edit open and says why the server refused it", async () => {
    serve([SAVED]);
    mockApi.on("post", "/custom-locales/he/strings", {
      applied: 0,
      unchanged: 0,
      cleared: 0,
      rejected: [{ namespace: "common", key: "actions.save", reason: "markup_not_in_source" }],
      unknown: 0,
    });
    const { user } = renderDialog();
    await screen.findByText("שמור");
    await user.click(within(rowOf("Save")).getByRole("button", { name: /Edit/ }));
    const input = screen.getByRole("textbox", { name: t("customLocales.review.translation") });
    await user.type(input, "<b>");
    await user.click(screen.getByRole("button", { name: /Save/ }));
    expect(
      await screen.findByText(
        t("customLocales.review.rejected", { reason: t("customLocales.reasons.markup_not_in_source") }),
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: t("customLocales.review.translation") })).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("reports a failed save", async () => {
    serve([SAVED]);
    mockApi.fail("post", "/custom-locales/he/strings", 500);
    const { user } = renderDialog();
    await screen.findByText("שמור");
    await user.click(within(rowOf("Save")).getByRole("button", { name: /Edit/ }));
    await user.click(screen.getByRole("button", { name: /Save/ }));
    expect(await screen.findByText(t("customLocales.review.saveFailed"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save/ })).toBeEnabled();
  });

  it("clears a translation", async () => {
    serve([SAVED]);
    mockApi.on("post", "/custom-locales/he/strings", {
      applied: 0,
      unchanged: 0,
      cleared: 1,
      rejected: [],
      unknown: 0,
    });
    const { user } = renderDialog();
    await screen.findByText("שמור");
    await user.click(within(rowOf("Save")).getByRole("button", { name: t("customLocales.review.clear") }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith("common"));
    expect(mockApi.callsOf("post", "/custom-locales/he/strings")[0].body).toEqual({
      strings: { common: { "actions.save": null } },
      origin: "manual",
    });
  });

  it("drops an edit on Cancel without saving", async () => {
    serve([SAVED]);
    const { user } = renderDialog();
    await screen.findByText("שמור");
    await user.click(within(rowOf("Save")).getByRole("button", { name: /Edit/ }));
    await user.click(within(rowOf("Save")).getByRole("button", { name: /Cancel/ }));
    expect(screen.queryByRole("textbox", { name: t("customLocales.review.translation") })).toBeNull();
    expect(mockApi.callsOf("post")).toHaveLength(0);
  });

  it("edits one row at a time", async () => {
    serve([SAVED, STALE]);
    const { user } = renderDialog();
    await screen.findByText("שמור");
    await user.click(within(rowOf("Save")).getByRole("button", { name: /Edit/ }));
    expect(within(rowOf("Cancel")).queryByRole("textbox")).toBeNull();
    expect(within(rowOf("Cancel")).getByRole("button", { name: /Edit/ })).toBeInTheDocument();
  });

  it("says when nothing matches", async () => {
    serve([]);
    renderDialog();
    expect(await screen.findByText(t("customLocales.review.empty"))).toBeInTheDocument();
  });

  it("says when the strings cannot be loaded", async () => {
    mockApi.fail("get", STRINGS, 500);
    renderDialog();
    expect(await screen.findByText(t("customLocales.review.loadFailed"))).toBeInTheDocument();
    expect(screen.queryByText(t("customLocales.review.empty"))).toBeNull();
  });

  it("closes on Close", async () => {
    serve([]);
    const { user } = renderDialog();
    await user.click(screen.getByRole("button", { name: i18n.t("common:actions.close") as string }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
