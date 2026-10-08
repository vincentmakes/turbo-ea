/**
 * The finer EOL behaviour the main suite does not pin: every status the
 * cycle data can produce (including the exact day boundaries), every details
 * row, the loading/error states of the three requests, and the picker's
 * handling of superseded responses (#882).
 *
 * Requests whose timing matters are answered by `holdGets`, which hands the
 * test one pending promise per call to settle explicitly — never a sleep.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi, type RouteMatcher } from "@/test/apiMock";
import { CARD_IDS, cardById, makeCard } from "@/test/fixtures/metamodel";
import { toIsoDate } from "@/lib/dates";
import { STATUS_COLORS } from "@/theme/tokens";
import i18n from "@/i18n";
import type { Card, EolCycle } from "@/types";
import EolLinkSection, { EolLinkDialog } from "./EolLinkSection";

const LINKED = cardById(CARD_IDS.postgres); // postgresql / 16, name "PostgreSQL"
const UNLINKED = cardById(CARD_IDS.linux); // "Ubuntu LTS", no link
const FUZZY = "/eol/products/fuzzy*";
const FUZZY_URL = "/eol/products/fuzzy?search=Ubuntu%20LTS&limit=5";
const SEARCH = "/eol/products?search=*";
/** Headroom for a wait that sits behind the picker's 300/600 ms debounces. */
const DEBOUNCED = 3000;
// Typing that a test counts requests for runs with `delay: null`: a real pause
// between keystrokes can outlast the debounce on a loaded runner.

const future = (months: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return toIsoDate(d);
};

interface Deferred {
  promise: Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

function deferred(): Deferred {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Answer each matching GET with its own pending promise, in call order. */
function holdGets(matcher: RouteMatcher): Deferred[] {
  const pending: Deferred[] = [];
  mockApi.on("get", matcher, () => {
    const d = deferred();
    pending.push(d);
    return d.promise;
  });
  return pending;
}

async function settle(d: Deferred, value: unknown) {
  await act(async () => {
    d.resolve(value);
  });
}

/** The options object the component passed with its n-th GET matching `re`. */
function getOpts(re: RegExp, n: number): { signal?: AbortSignal } {
  const calls = mockApi.api.get.mock.calls.filter(([p]) => re.test(p as string));
  return calls[n][1] as { signal?: AbortSignal };
}

function renderSection(card: Card, props: Partial<{ initialExpanded: boolean }> = {}) {
  const onSave = vi.fn(async () => {});
  const utils = render(<EolLinkSection card={card} onSave={onSave} {...props} />);
  return { ...utils, onSave };
}

/** Render the linked card with one cycle and wait for its details to land. */
async function renderLinkedWith(cycle: Partial<EolCycle>) {
  mockApi.on("get", "/eol/products/postgresql", [{ cycle: "16", ...cycle }]);
  const utils = renderSection(LINKED);
  await screen.findByText("Active Support");
  return utils;
}

// By role: once the options popup is open, its listbox shares the label.
const searchBox = () =>
  screen.getByRole("combobox", { name: "Search product on endoflife.date" });

/** The chip on a details row, found by the row's label. */
const rowChip = (label: string) => {
  const labels = screen.getAllByText(label);
  return labels[labels.length - 1].nextElementSibling as HTMLElement;
};

beforeEach(() => {
  mockApi.reset();
  mockApi.on("get", SEARCH, []);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("EOL status and details", () => {
  it("reports a past EOL date as End of Life and shows both dates", async () => {
    await renderLinkedWith({ eol: "2020-03-01", support: "2019-03-01", lts: null });
    // Title, header chip, status badge and the "End of Life" row label.
    expect(screen.getAllByText("End of Life")).toHaveLength(4);
    expect(screen.getByText("cancel")).toBeInTheDocument();
    expect(screen.getByText("2020-03-01")).toBeInTheDocument();
    expect(screen.getByText("2019-03-01")).toBeInTheDocument();
    // Rows for data the cycle does not carry stay out (lts is explicitly null).
    for (const label of ["Release Date", "Latest Version", "Latest Release", "LTS", "Codename"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it("marks a cycle whose eol flag is true as End of Life", async () => {
    await renderLinkedWith({ eol: true, support: false });
    expect(screen.getAllByText("End of Life")).toHaveLength(4);
    expect(screen.getByText("cancel")).toBeInTheDocument();
    expect(rowChip("End of Life")).toHaveTextContent("Yes (EOL)");
    expect(rowChip("End of Life")).toHaveStyle({ color: STATUS_COLORS.error });
    // support=false means active support has ended: "No", in the ended colour.
    expect(rowChip("Active Support")).toHaveTextContent(/^No$/);
    expect(rowChip("Active Support")).toHaveStyle({ color: STATUS_COLORS.error });
  });

  it("treats an eol flag of false as supported", async () => {
    await renderLinkedWith({ eol: false, support: true });
    expect(screen.getAllByText("Supported")).toHaveLength(2);
    expect(screen.getByText("check_circle")).toBeInTheDocument();
    expect(rowChip("End of Life")).toHaveTextContent(/^No$/);
    expect(rowChip("End of Life")).toHaveStyle({ color: STATUS_COLORS.success });
    // support=true means still supported — never read with EOL semantics.
    expect(rowChip("Active Support")).toHaveTextContent(/^Yes$/);
    expect(rowChip("Active Support")).toHaveStyle({ color: STATUS_COLORS.success });
    expect(screen.queryByText("Yes (EOL)")).not.toBeInTheDocument();
    expect(screen.queryByText("Security fixes only")).not.toBeInTheDocument();
  });

  it("colours the active-support date by whether support is still running", async () => {
    await renderLinkedWith({ eol: future(48), support: future(24) });
    expect(rowChip("Active Support")).toHaveStyle({ color: STATUS_COLORS.success });
  });

  it("renders every details row the cycle carries", async () => {
    const eol = future(48);
    const support = future(24);
    await renderLinkedWith({
      releaseDate: "2023-09-14",
      latest: "16.4",
      latestReleaseDate: "2024-08-08",
      eol,
      support,
      lts: false,
      codename: "Sixteen",
    });
    expect(screen.getAllByText("Supported")).toHaveLength(2);
    const rows: [string, string][] = [
      ["Release Date", "2023-09-14"],
      ["Latest Version", "16.4"],
      ["Latest Release", "2024-08-08"],
      ["Active Support", support],
      ["LTS", "No"],
      ["Codename", "Sixteen"],
    ];
    for (const [label, value] of rows) {
      const labelEl = screen.getByText(label);
      expect(labelEl.nextElementSibling).toHaveTextContent(value);
    }
    // The "End of Life" row is the last of the title, chips and row label.
    const eolTexts = screen.getAllByText("End of Life");
    const eolLabel = eolTexts[eolTexts.length - 1];
    expect(eolLabel.nextElementSibling).toHaveTextContent(eol);
  });

  it("shows Unknown for missing dates and an LTS note verbatim", async () => {
    await renderLinkedWith({ lts: "until 2030" });
    expect(screen.getAllByText("Unknown")).toHaveLength(2);
    expect(screen.getByText("LTS").nextElementSibling).toHaveTextContent("until 2030");
    expect(screen.getAllByText("Supported")).toHaveLength(2);
  });

  it("omits the LTS row when lts is absent", async () => {
    await renderLinkedWith({ eol: future(48) });
    expect(screen.queryByText("LTS")).not.toBeInTheDocument();
  });

  it("flags a lapsed support date as security fixes only", async () => {
    await renderLinkedWith({ eol: future(48), support: "2020-01-01" });
    expect(screen.getAllByText("Security fixes only")).toHaveLength(2);
    expect(screen.getByText("shield")).toBeInTheDocument();
  });

  it("flags an EOL date within six months with a warning icon", async () => {
    await renderLinkedWith({ eol: future(3), support: future(1) });
    expect(screen.getAllByText("Approaching EOL")).toHaveLength(2);
    expect(screen.getByText("warning")).toBeInTheDocument();
  });

  describe("on the boundary days", () => {
    // Local midnight: a `YYYY-MM-DD` date equal to today compares equal to now.
    const today = new Date(2026, 0, 15);

    it.each([
      ["an EOL date of today is End of Life", { eol: "2026-01-15" }, "End of Life", 4],
      ["an EOL date exactly six months out is approaching", { eol: "2026-07-15" }, "Approaching EOL", 2],
      ["support ending today is security fixes only", { eol: "2028-01-15", support: "2026-01-15" }, "Security fixes only", 2],
    ])("%s", async (_name, cycle, label, count) => {
      vi.useFakeTimers({ toFake: ["Date"], now: today });
      await renderLinkedWith(cycle);
      expect(screen.getAllByText(label)).toHaveLength(count);
    });
  });
});

describe("EolLinkSection — fetching the linked cycle", () => {
  it("shows progress while the cycle loads and no alert once it has", async () => {
    const held = holdGets("/eol/products/postgresql");
    renderSection(LINKED);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await settle(held[0], [{ cycle: "16", eol: future(48) }]);
    expect(await screen.findByText("Active Support")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("falls back to a generic message for a non-Error failure", async () => {
    mockApi.on("get", "/eol/products/postgresql", () => Promise.reject("socket hang up"));
    renderSection(LINKED);
    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to fetch EOL data");
  });

  it("treats a product without a cycle as not linked", async () => {
    mockApi.on("get", "/eol/products/postgresql", [{ cycle: "16", eol: future(48) }]);
    renderSection(makeCard({ ...LINKED, attributes: { eol_product: "postgresql" } }), {
      initialExpanded: true,
    });
    // The picker opens on the stored product and loads its cycles itself.
    await screen.findAllByText("Version / Cycle");
    expect(screen.queryByText("Linked to")).not.toBeInTheDocument();
    expect(screen.getByText(/Link this IT component to a product/)).toBeInTheDocument();
    expect(searchBox()).toHaveValue("postgresql");
    // Only the picker asked for the cycles; the section did not look up a cycle.
    expect(mockApi.callsOf("get", "/eol/products/postgresql")).toHaveLength(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("refetches when the card is re-linked to another product", async () => {
    mockApi.on("get", "/eol/products/redis", [{ cycle: "7", eol: true, support: false }]);
    const { rerender, onSave } = await renderLinkedWith({ eol: future(48) });
    rerender(
      <EolLinkSection
        card={{ ...LINKED, attributes: { eol_product: "redis", eol_cycle: "7" } }}
        onSave={onSave}
      />,
    );
    expect(await screen.findByText("Yes (EOL)")).toBeInTheDocument();
    expect(screen.getByText("redis 7")).toBeInTheDocument();
    expect(mockApi.callsOf("get", "/eol/products/redis")).toHaveLength(1);
  });

  it("clears the previous product's details while another linked product loads", async () => {
    const { rerender, onSave } = await renderLinkedWith({ eol: future(48), support: true });
    expect(screen.getAllByText("Supported")).toHaveLength(2);

    const held = holdGets("/eol/products/redis");
    rerender(
      <EolLinkSection
        card={{ ...LINKED, attributes: { eol_product: "redis", eol_cycle: "7" } }}
        onSave={onSave}
      />,
    );
    expect(screen.getByText("redis 7")).toBeInTheDocument();
    // Nothing from postgresql 16 may sit under the redis 7 header.
    expect(screen.queryByText("Supported")).not.toBeInTheDocument();
    expect(screen.queryByText("Active Support")).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    await settle(held[0], [{ cycle: "7", eol: true, support: false }]);
    expect(await screen.findByText("Yes (EOL)")).toBeInTheDocument();
  });

  it("keeps the shown details while the same product is refreshed", async () => {
    const user = userEvent.setup();
    await renderLinkedWith({ eol: future(48), support: true });
    const held = holdGets("/eol/products/postgresql");
    await user.click(screen.getByTitle("Refresh EOL data"));
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getAllByText("Supported")).toHaveLength(2);
    await settle(held[0], [{ cycle: "16", eol: future(48), support: false }]);
    expect(await screen.findAllByText("Security fixes only")).toHaveLength(2);
  });

  it("forgets the cycle details once the card is unlinked", async () => {
    mockApi.on("get", FUZZY, []);
    const { rerender, onSave } = await renderLinkedWith({ eol: future(48) });
    rerender(<EolLinkSection card={{ ...LINKED, attributes: { version: "16" } }} onSave={onSave} />);
    expect(screen.queryByText("Active Support")).not.toBeInTheDocument();

    // Re-linking shows nothing stale while the fresh cycle is still loading.
    const held = holdGets("/eol/products/postgresql");
    rerender(<EolLinkSection card={LINKED} onSave={onSave} />);
    expect(screen.queryByText("Supported")).not.toBeInTheDocument();
    expect(screen.queryByText("Active Support")).not.toBeInTheDocument();
    await settle(held[0], [{ cycle: "16", eol: future(48) }]);
    expect(await screen.findByText("Active Support")).toBeInTheDocument();
  });

  it("returns to the linked view after linking a new cycle through Change", async () => {
    const user = userEvent.setup();
    const { onSave } = await renderLinkedWith({ eol: future(48) });
    mockApi.on("get", "/eol/products/postgresql", [
      { cycle: "16", eol: future(48) },
      { cycle: "12", eol: true },
    ]);
    await user.click(screen.getByTitle("Change linked product"));
    await screen.findAllByText("Version / Cycle");
    await user.click(screen.getAllByRole("combobox")[1]);
    await user.click(await screen.findByRole("option", { name: /^12/ }));
    await user.click(screen.getByRole("button", { name: "Link" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        attributes: { version: "16", eol_product: "postgresql", eol_cycle: "12" },
      }),
    );
    expect(await screen.findByText("Linked to")).toBeInTheDocument();
  });

  it("clears the shown details after unlinking", async () => {
    const user = userEvent.setup();
    const { onSave } = await renderLinkedWith({ eol: future(48) });
    await user.click(screen.getByTitle("Unlink EOL data"));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText("Active Support")).not.toBeInTheDocument());
    expect(screen.queryByText("Supported")).not.toBeInTheDocument();
  });
});

/** Run `fn` with the UI in `lng`, restoring the previous language afterwards. */
async function inLanguage(lng: string, fn: () => Promise<void>) {
  const previous = i18n.language;
  await act(async () => {
    await i18n.changeLanguage(lng);
  });
  try {
    await fn();
  } finally {
    await act(async () => {
      await i18n.changeLanguage(previous);
    });
  }
}

describe("EolLinkSection — superseded and failed requests", () => {
  const REDIS = { ...LINKED, attributes: { eol_product: "redis", eol_cycle: "7" } };

  it("ignores a late reply for the product the card was linked to before", async () => {
    const pg = holdGets("/eol/products/postgresql");
    const redis = holdGets("/eol/products/redis");
    const { rerender, onSave } = renderSection(LINKED);
    rerender(<EolLinkSection card={REDIS} onSave={onSave} />);
    // The superseded request is aborted…
    expect(getOpts(/\/eol\/products\/postgresql/, 0).signal?.aborted).toBe(true);

    await settle(redis[0], [{ cycle: "7", eol: true, support: false }]);
    expect(await screen.findByText("Yes (EOL)")).toBeInTheDocument();
    // …and its reply, landing last, changes nothing.
    await settle(pg[0], [{ cycle: "16", eol: future(48), support: true }]);
    expect(screen.getByText("Yes (EOL)")).toBeInTheDocument();
    expect(screen.queryByText("Supported")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("ignores a late failure for the product the card was linked to before", async () => {
    const pg = holdGets("/eol/products/postgresql");
    const redis = holdGets("/eol/products/redis");
    const { rerender, onSave } = renderSection(LINKED);
    rerender(<EolLinkSection card={REDIS} onSave={onSave} />);
    await settle(redis[0], [{ cycle: "7", eol: true, support: false }]);
    expect(await screen.findByText("Yes (EOL)")).toBeInTheDocument();
    await act(async () => {
      pg[0].reject(new Error("GET /eol/products/postgresql failed"));
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("names a missing cycle in the UI language", async () => {
    mockApi.on("get", "/eol/products/postgresql", [{ cycle: "15" }]);
    await inLanguage("de", async () => {
      renderSection(LINKED);
      expect(await screen.findByRole("alert")).toHaveTextContent(
        'Zyklus "16" für postgresql nicht gefunden',
      );
    });
  });

  it("names a failure without a message in the UI language", async () => {
    mockApi.on("get", "/eol/products/postgresql", () => Promise.reject("socket hang up"));
    await inLanguage("de", async () => {
      renderSection(LINKED);
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "EOL-Daten konnten nicht abgerufen werden",
      );
    });
  });

  it("keeps the picker open with the error when saving a new link fails", async () => {
    mockApi.on("get", "/eol/products/postgresql", [
      { cycle: "16", eol: future(48) },
      { cycle: "12", eol: true },
    ]);
    const user = userEvent.setup();
    const onSave = vi.fn(async () => {
      throw new Error("PATCH /cards/x failed");
    });
    render(<EolLinkSection card={LINKED} onSave={onSave} />);
    await screen.findByText("Active Support");
    await user.click(screen.getByTitle("Change linked product"));
    await screen.findAllByText("Version / Cycle");
    await user.click(screen.getAllByRole("combobox")[1]);
    await user.click(await screen.findByRole("option", { name: /^12/ }));
    await user.click(screen.getByRole("button", { name: "Link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("PATCH /cards/x failed");
    expect(onSave).toHaveBeenCalledTimes(1);
    // Still in the picker, so the user can retry or cancel.
    expect(screen.getByRole("button", { name: "Link" })).toBeInTheDocument();
    expect(screen.queryByText("Linked to")).not.toBeInTheDocument();

    // Cancelling the change drops the error with it.
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("Linked to")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the details with the error when unlinking fails", async () => {
    const user = userEvent.setup();
    mockApi.on("get", "/eol/products/postgresql", [{ cycle: "16", eol: future(48) }]);
    const onSave = vi.fn(() => Promise.reject("nope"));
    render(<EolLinkSection card={LINKED} onSave={onSave} />);
    await screen.findByText("Active Support");
    await user.click(screen.getByTitle("Unlink EOL data"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.getByText("Active Support")).toBeInTheDocument();
    expect(screen.getByText("Linked to")).toBeInTheDocument();
  });
});

describe("EolLinkSection — the save error and the progress bar", () => {
  const REDIS = { ...LINKED, attributes: { eol_product: "redis", eol_cycle: "7" } };

  /** Change the linked card to cycle 12 through the picker and press Link. */
  async function relinkTo12(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByTitle("Change linked product"));
    await screen.findAllByText("Version / Cycle");
    await user.click(screen.getAllByRole("combobox")[1]);
    await user.click(await screen.findByRole("option", { name: /^12/ }));
    await user.click(screen.getByRole("button", { name: "Link" }));
  }

  it("names a failed link that carries no message, and clears it once a retry saves", async () => {
    mockApi.on("get", "/eol/products/postgresql", [
      { cycle: "16", eol: future(48) },
      { cycle: "12", eol: true },
    ]);
    const user = userEvent.setup();
    const onSave = vi.fn(() => Promise.reject("nope"));
    render(<EolLinkSection card={LINKED} onSave={onSave} />);
    await screen.findByText("Active Support");
    await relinkTo12(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");

    onSave.mockImplementation(() => Promise.resolve());
    await user.click(screen.getByRole("button", { name: "Link" }));
    expect(await screen.findByText("Linked to")).toBeInTheDocument();
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("spaces a failed unlink's error, closes it, and clears it once an unlink saves", async () => {
    const user = userEvent.setup();
    mockApi.on("get", "/eol/products/postgresql", [{ cycle: "16", eol: future(48) }]);
    const onSave = vi.fn(() => Promise.reject(new Error("PATCH /cards/x failed")));
    render(<EolLinkSection card={LINKED} onSave={onSave} />);
    await screen.findByText("Active Support");

    await user.click(screen.getByTitle("Unlink EOL data"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("PATCH /cards/x failed");
    expect(alert).toHaveStyle({ marginBottom: "16px" });
    await user.click(within(alert).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(screen.getByTitle("Unlink EOL data"));
    expect(await screen.findByRole("alert")).toHaveTextContent("PATCH /cards/x failed");

    onSave.mockImplementation(() => Promise.resolve());
    await user.click(screen.getByTitle("Unlink EOL data"));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.queryByText("Active Support")).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the progress bar while the current product loads, whatever the superseded one does", async () => {
    const pg = holdGets("/eol/products/postgresql");
    const redis = holdGets("/eol/products/redis");
    const { rerender, onSave } = renderSection(LINKED);
    rerender(<EolLinkSection card={REDIS} onSave={onSave} />);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    // The superseded product's reply lands while redis is still loading.
    await settle(pg[0], [{ cycle: "16", eol: future(48), support: true }]);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    await settle(redis[0], [{ cycle: "7", eol: true, support: false }]);
    expect(await screen.findByText("Yes (EOL)")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});

describe("EolLinkSection — the picker on an unlinked card", () => {
  beforeEach(() => {
    mockApi.on("get", FUZZY, [
      { name: "ubuntu", score: 0.9 },
      { name: "ubuntu-core", score: 0.4 },
    ]);
  });

  it("resets on Cancel, every time it is cancelled", async () => {
    mockApi.fail("get", "/eol/products/ubuntu", 502, "upstream");
    const user = userEvent.setup();
    renderSection(UNLINKED, { initialExpanded: true });

    for (let round = 1; round <= 2; round++) {
      await user.click(await screen.findByText("ubuntu"));
      expect(await screen.findByRole("alert")).toHaveTextContent("GET /eol/products/ubuntu failed");
      // A failed lookup is not reported as "no cycles".
      expect(screen.queryByText(/No release cycles found/)).not.toBeInTheDocument();
      expect(searchBox()).toHaveValue("ubuntu");

      await user.click(screen.getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
      expect(searchBox()).toHaveValue("");
      expect(screen.getByRole("button", { name: "Link" })).toBeDisabled();
    }
  });

  it("loads the picked suggestion's cycles with a progress bar and Link held back", async () => {
    const held = holdGets("/eol/products/ubuntu");
    const user = userEvent.setup();
    renderSection(UNLINKED, { initialExpanded: true });

    await user.click(await screen.findByText("ubuntu"));
    expect(searchBox()).toHaveValue("ubuntu");
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText("Version / Cycle")).not.toBeInTheDocument();
    expect(screen.queryByText(/No release cycles found/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link" })).toBeDisabled();
    // Picking a product ends the auto-search: neither its result nor its
    // progress is shown any more.
    expect(screen.queryByText("Suggested matches from endoflife.date:")).not.toBeInTheDocument();
    expect(screen.queryByText(/No EOL matches found/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Searching endoflife\.date/)).not.toBeInTheDocument();

    await settle(held[0], [{ cycle: "24.04", eol: future(40) }]);
    expect(await screen.findAllByText("Version / Cycle")).toHaveLength(2);
    expect(screen.queryByText(/No release cycles found/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link" })).toBeDisabled();
  });
});

describe("EolPicker — the auto-search on the card name", () => {
  it("searches the trimmed name, shows progress, then the suggestions", async () => {
    const held = holdGets(FUZZY);
    renderSection(makeCard({ type: "ITComponent", name: "  Ubuntu LTS  " }), {
      initialExpanded: true,
    });
    expect(mockApi.callsOf("get", /fuzzy/).map((c) => c.path)).toEqual([FUZZY_URL]);
    expect(getOpts(/fuzzy/, 0).signal).toBeInstanceOf(AbortSignal);
    expect(screen.getByText('Searching endoflife.date for "Ubuntu LTS"...')).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    await settle(held[0], [
      { name: "ubuntu", score: 0.9 },
      { name: "ubuntu-core", score: 0.4 },
    ]);
    expect(await screen.findByText("Suggested matches from endoflife.date:")).toBeInTheDocument();
    expect(screen.getByText("ubuntu-core")).toBeInTheDocument();
    expect(screen.queryByText(/Searching endoflife\.date/)).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText(/No EOL matches found/)).not.toBeInTheDocument();
  });

  it("reports no matches when the auto-search fails", async () => {
    mockApi.fail("get", FUZZY, 503, "down");
    renderSection(UNLINKED, { initialExpanded: true });
    expect(await screen.findByText(/No EOL matches found/)).toBeInTheDocument();
    expect(screen.queryByText("Suggested matches from endoflife.date:")).not.toBeInTheDocument();
  });

  it("reports no matches, and no suggestion header, for an empty result", async () => {
    mockApi.on("get", FUZZY, []);
    renderSection(UNLINKED, { initialExpanded: true });
    expect(await screen.findByText(/No EOL matches found/)).toBeInTheDocument();
    expect(screen.queryByText("Suggested matches from endoflife.date:")).not.toBeInTheDocument();
  });

  it("searches a two-character name", () => {
    mockApi.on("get", FUZZY, []);
    renderSection(makeCard({ type: "Application", name: "Go" }), { initialExpanded: true });
    expect(mockApi.callsOf("get", "/eol/products/fuzzy?search=Go&limit=5")).toHaveLength(1);
  });

  it("stays idle for a one-character name", () => {
    mockApi.on("get", FUZZY, []);
    renderSection(makeCard({ type: "Application", name: "X" }), { initialExpanded: true });
    expect(mockApi.callsOf("get", /fuzzy/)).toHaveLength(0);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText(/No EOL matches found/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Searching endoflife\.date/)).not.toBeInTheDocument();
  });

  it("does not re-run while the user types another product, only when it matches the name", async () => {
    mockApi.on("get", FUZZY, [{ name: "ubuntu", score: 0.9 }]);
    const user = userEvent.setup();
    renderSection(UNLINKED, { initialExpanded: true });
    await screen.findByText("Suggested matches from endoflife.date:");
    expect(mockApi.callsOf("get", /fuzzy/)).toHaveLength(1);

    await user.type(searchBox(), "re");
    // Two characters are enough for the manual search …
    await waitFor(() => expect(mockApi.callsOf("get", "/eol/products?search=re")).toHaveLength(1), {
      timeout: DEBOUNCED,
    });
    // … and typing something else leaves the auto-search alone.
    expect(mockApi.callsOf("get", /fuzzy/)).toHaveLength(1);

    // Emptying the box re-runs it; so does typing the card's own name.
    await user.clear(searchBox());
    await waitFor(() => expect(mockApi.callsOf("get", /fuzzy/)).toHaveLength(2));
    await user.type(searchBox(), "Ubuntu LTS");
    await waitFor(() => expect(mockApi.callsOf("get", /fuzzy/)).toHaveLength(3));
  });

  describe("when the card is renamed mid-search", () => {
    async function renameWhileSearching() {
      const held = holdGets(FUZZY);
      const onSave = vi.fn(async () => {});
      const { rerender } = render(<EolLinkSection card={UNLINKED} onSave={onSave} initialExpanded />);
      rerender(
        <EolLinkSection card={{ ...UNLINKED, name: "Debian Linux" }} onSave={onSave} initialExpanded />,
      );
      // The renamed search goes out after the 600 ms debounce.
      await waitFor(() => expect(held).toHaveLength(2), { timeout: DEBOUNCED });
      return held;
    }

    it("aborts the first search and keeps showing progress when it lands late", async () => {
      const held = await renameWhileSearching();
      expect(getOpts(/fuzzy/, 0).signal?.aborted).toBe(true);
      await settle(held[0], [{ name: "stale", score: 0.9 }]);
      expect(screen.getByText('Searching endoflife.date for "Debian Linux"...')).toBeInTheDocument();
      expect(screen.queryByText("stale")).not.toBeInTheDocument();

      await settle(held[1], [{ name: "debian", score: 0.9 }]);
      expect(await screen.findByText("debian")).toBeInTheDocument();
      expect(screen.queryByText(/Searching endoflife\.date/)).not.toBeInTheDocument();
    });

    it.each([
      ["succeeds", (d: Deferred) => d.resolve([{ name: "stale", score: 0.9 }])],
      ["fails", (d: Deferred) => d.reject(new Error("late failure"))],
    ])("ignores a superseded search that %s after the current one", async (_n, finish) => {
      const held = await renameWhileSearching();
      await settle(held[1], [{ name: "debian", score: 0.9 }]);
      expect(await screen.findByText("debian")).toBeInTheDocument();

      await act(async () => {
        finish(held[0]);
      });
      expect(screen.getByText("debian")).toBeInTheDocument();
      expect(screen.queryByText("stale")).not.toBeInTheDocument();
      expect(screen.queryByText(/No EOL matches found/)).not.toBeInTheDocument();
    });

    it("hides the previous result while the renamed search runs", async () => {
      const held = holdGets(FUZZY);
      const onSave = vi.fn(async () => {});
      const { rerender } = render(<EolLinkSection card={UNLINKED} onSave={onSave} initialExpanded />);
      await settle(held[0], [{ name: "ubuntu", score: 0.9 }]);
      expect(await screen.findByText("ubuntu")).toBeInTheDocument();

      rerender(
        <EolLinkSection card={{ ...UNLINKED, name: "Debian Linux" }} onSave={onSave} initialExpanded />,
      );
      await waitFor(() => expect(held).toHaveLength(2), { timeout: DEBOUNCED });
      expect(
        await screen.findByText('Searching endoflife.date for "Debian Linux"...'),
      ).toBeInTheDocument();
      expect(screen.queryByText("Suggested matches from endoflife.date:")).not.toBeInTheDocument();
      expect(screen.queryByText("ubuntu")).not.toBeInTheDocument();
    });

    it("hides a previous empty result while the renamed search runs", async () => {
      const held = holdGets(FUZZY);
      const onSave = vi.fn(async () => {});
      const { rerender } = render(<EolLinkSection card={UNLINKED} onSave={onSave} initialExpanded />);
      await settle(held[0], []);
      expect(await screen.findByText(/No EOL matches found/)).toBeInTheDocument();

      rerender(
        <EolLinkSection card={{ ...UNLINKED, name: "Debian Linux" }} onSave={onSave} initialExpanded />,
      );
      await waitFor(() => expect(held).toHaveLength(2), { timeout: DEBOUNCED });
      expect(
        await screen.findByText('Searching endoflife.date for "Debian Linux"...'),
      ).toBeInTheDocument();
      expect(screen.queryByText(/No EOL matches found/)).not.toBeInTheDocument();
    });
  });
});

describe("EolPicker — the manual product search", () => {
  function renderDialog(props: Partial<React.ComponentProps<typeof EolLinkDialog>> = {}) {
    const onLink = vi.fn();
    const onClose = vi.fn();
    render(<EolLinkDialog open onClose={onClose} onLink={onLink} {...props} />);
    return { onLink, onClose };
  }

  it("opens idle without a card name or product", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(/Search for a product on endoflife\.date and select the version/),
    ).toBeInTheDocument();
    expect(searchBox()).toHaveAttribute("placeholder", "e.g. python, nodejs, postgresql...");
    expect(mockApi.calls).toHaveLength(0);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/No EOL matches found/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No release cycles found/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Link" })).toBeDisabled();
  });

  it("looks the pre-selected product up straight away and holds Link while its cycles load", async () => {
    holdGets(SEARCH); // the search spinner stays up for the whole test
    const cycles = holdGets("/eol/products/postgresql");
    renderDialog({ initialProduct: "postgresql" });
    expect(mockApi.callsOf("get", "/eol/products?search=postgresql")).toHaveLength(1);
    expect(getOpts(/\?search=/, 0).signal).toBeInstanceOf(AbortSignal);
    // The search spinner plus the cycles bar.
    expect(screen.getAllByRole("progressbar")).toHaveLength(2);
    expect(screen.queryByText("Version / Cycle")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link" })).toBeDisabled();

    await settle(cycles[0], [{ cycle: "16", eol: future(48) }]);
    // The label and the outline's notch both carry the text.
    expect(await screen.findAllByText("Version / Cycle")).toHaveLength(2);
    expect(screen.getAllByRole("progressbar")).toHaveLength(1);
    expect(screen.queryByText(/No release cycles found/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link" })).toBeDisabled();
  });

  it("shows no cycle select for a product without cycles", async () => {
    mockApi.on("get", "/eol/products/redis", []);
    renderDialog({ initialProduct: "redis" });
    expect(await screen.findByText('No release cycles found for "redis".')).toBeInTheDocument();
    expect(screen.queryByText("Version / Cycle")).not.toBeInTheDocument();
  });

  it("drops the selected product as soon as the search text changes", async () => {
    mockApi.on("get", "/eol/products/postgresql", [{ cycle: "16", eol: future(48) }]);
    const user = userEvent.setup();
    renderDialog({ initialProduct: "postgresql" });
    await screen.findAllByText("Version / Cycle");

    await user.type(searchBox(), "x");
    expect(searchBox()).toHaveValue("postgresqlx");
    await waitFor(() => expect(screen.queryByText("Version / Cycle")).not.toBeInTheDocument());
    expect(screen.queryByText(/No release cycles found/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link" })).toBeDisabled();
  });

  it("spins while a search is in flight", async () => {
    const held = holdGets(SEARCH);
    const user = userEvent.setup({ delay: null });
    renderDialog();
    await user.type(searchBox(), "redis");
    await waitFor(() => expect(held).toHaveLength(1), { timeout: DEBOUNCED });
    // The request is out; the spinner lands with the next commit.
    expect(await screen.findByRole("progressbar")).toBeInTheDocument();

    await settle(held[0], [{ name: "redis" }, { name: "redis-stack" }]);
    expect(await screen.findByRole("option", { name: "redis-stack" })).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("clears the options when a search fails", async () => {
    mockApi.on("get", "/eol/products?search=re", [{ name: "redis" }]);
    mockApi.fail("get", "/eol/products?search=red", 502);
    const user = userEvent.setup({ delay: null });
    renderDialog();
    await user.type(searchBox(), "re");
    expect(
      await screen.findByRole("option", { name: "redis" }, { timeout: DEBOUNCED }),
    ).toBeInTheDocument();

    await user.type(searchBox(), "d");
    await waitFor(
      () => expect(mockApi.callsOf("get", "/eol/products?search=red")).toHaveLength(1),
      { timeout: DEBOUNCED },
    );
    await waitFor(() => expect(screen.queryByRole("option")).not.toBeInTheDocument());
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  describe("with an older search still in flight", () => {
    async function typeTwice() {
      const held = holdGets(SEARCH);
      const user = userEvent.setup({ delay: null });
      renderDialog();
      await user.type(searchBox(), "redis");
      await waitFor(() => expect(held).toHaveLength(1), { timeout: DEBOUNCED });
      await user.type(searchBox(), "-x");
      await waitFor(() => expect(held).toHaveLength(2), { timeout: DEBOUNCED });
      return held;
    }

    it("aborts it and keeps spinning when it lands first", async () => {
      const held = await typeTwice();
      expect(getOpts(/\?search=/, 0).signal?.aborted).toBe(true);
      await settle(held[0], [{ name: "redis" }]);
      expect(screen.getByRole("progressbar")).toBeInTheDocument();

      await settle(held[1], [{ name: "redis-x" }]);
      expect(await screen.findByRole("option", { name: "redis-x" })).toBeInTheDocument();
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });

    it.each([
      ["succeeds", (d: Deferred) => d.resolve([{ name: "redis" }])],
      ["fails", (d: Deferred) => d.reject(new Error("late failure"))],
    ])("keeps the current options when it %s late", async (_n, finish) => {
      const held = await typeTwice();
      await settle(held[1], [{ name: "redis-x" }]);
      expect(await screen.findByRole("option", { name: "redis-x" })).toBeInTheDocument();

      await act(async () => {
        finish(held[0]);
      });
      expect(screen.getByRole("option", { name: "redis-x" })).toBeInTheDocument();
    });
  });
});
