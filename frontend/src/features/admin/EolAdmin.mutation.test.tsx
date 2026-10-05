/**
 * Mass EOL linking admin, second pass: the in-flight states (search, cycle
 * fetch, save), the status classification at its boundaries, the stats
 * arithmetic, and the error / success messages being cleared by the next
 * action. The happy paths live in `EolAdmin.test.tsx`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import type { EolCycle, MassEolResult } from "@/types";
import EolAdmin from "./EolAdmin";

const SEARCH_ITC = "/eol/mass-search?type_key=ITComponent";
const LINK = "/eol/mass-link";
const EMPTY_STATE = 'Click "Search EOL Data" to scan your IT Components against endoflife.date';

const LINKED: MassEolResult = {
  card_id: "c1",
  card_name: "PostgreSQL",
  card_type: "ITComponent",
  current_eol_product: "postgresql",
  current_eol_cycle: "15",
  candidates: [],
};
const UBUNTU: MassEolResult = {
  card_id: "c2",
  card_name: "Ubuntu LTS",
  card_type: "ITComponent",
  candidates: [
    { card_id: "c2", card_name: "Ubuntu LTS", card_type: "ITComponent", eol_product: "ubuntu", score: 0.9 },
    { card_id: "c2", card_name: "Ubuntu LTS", card_type: "ITComponent", eol_product: "ubuntu-core", score: 0.4 },
  ],
};
const NODE: MassEolResult = {
  card_id: "c4",
  card_name: "Node runtime",
  card_type: "ITComponent",
  candidates: [
    { card_id: "c4", card_name: "Node runtime", card_type: "ITComponent", eol_product: "nodejs", score: 0.8 },
  ],
};
const UNMATCHED: MassEolResult = {
  card_id: "c3",
  card_name: "Legacy Mainframe",
  card_type: "ITComponent",
  candidates: [],
};
const RESULTS = [LINKED, UBUNTU, NODE, UNMATCHED];

const UBUNTU_CYCLES: EolCycle[] = [{ cycle: "24.04", eol: false }];
const NODE_CYCLES: EolCycle[] = [{ cycle: "20", eol: false }];

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function cardOf(name: string): HTMLElement {
  const card = screen.getByText(name).closest(".MuiCard-root");
  if (!(card instanceof HTMLElement)) throw new Error(`no card for ${name}`);
  return card;
}

function stat(label: string): string | null | undefined {
  return screen.getByText(label).parentElement?.querySelector("h6")?.textContent;
}

async function pickOption(user: UserEvent, combobox: HTMLElement, option: RegExp | string) {
  await user.click(combobox);
  const listbox = await screen.findByRole("listbox");
  await user.click(within(listbox).getByRole("option", { name: option }));
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
}

async function search(user: UserEvent) {
  await user.click(screen.getByRole("button", { name: /Search EOL Data/ }));
  await screen.findByText("Ubuntu LTS");
}

/** Open a candidate's cycle picker and confirm `cycle`. */
async function linkCycle(user: UserEvent, card: string, product: string, cycle: RegExp) {
  await user.click(within(cardOf(card)).getByText(product));
  const dialog = await screen.findByRole("dialog");
  await pickOption(user, await within(dialog).findByRole("combobox"), cycle);
  await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}

/** The labels of the options in the open cycle select, with their status chips. */
async function cycleStatuses(user: UserEvent, dialog: HTMLElement): Promise<string[]> {
  await user.click(await within(dialog).findByRole("combobox"));
  const listbox = await screen.findByRole("listbox");
  return within(listbox)
    .getAllByRole("option")
    .map((o) => o.textContent ?? "");
}

beforeEach(() => {
  mockApi.reset();
  mockApi.on("post", SEARCH_ITC, RESULTS);
});

describe("EolAdmin page", () => {
  it("starts with the type picker and the empty state, and calls nothing", () => {
    render(<EolAdmin />);

    expect(
      screen.getByText(/Automatically find End-of-Life data for your IT Components/),
    ).toBeInTheDocument();
    const type = screen.getByRole("combobox");
    expect(type).toHaveTextContent("IT Component");
    // The field label and its outline notch.
    expect(screen.getAllByText("Type")).toHaveLength(2);
    expect(screen.getByText(EMPTY_STATE)).toBeInTheDocument();
    expect(screen.queryByText("Total")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mockApi.calls).toHaveLength(0);
  });

  it("shows the search in progress, then the stats instead of the empty state", async () => {
    const first = deferred<MassEolResult[]>();
    mockApi.on("post", SEARCH_ITC, () => first.promise);
    const user = userEvent.setup();
    render(<EolAdmin />);

    await user.click(screen.getByRole("button", { name: /Search EOL Data/ }));
    expect(await screen.findByRole("button", { name: /Searching\.\.\./ })).toBeDisabled();
    // The button's spinner and the page's progress bar.
    expect(screen.getAllByRole("progressbar")).toHaveLength(2);
    expect(screen.queryByText(EMPTY_STATE)).not.toBeInTheDocument();

    first.resolve(RESULTS);
    await screen.findByText("Ubuntu LTS");
    expect(screen.getByRole("button", { name: /Search EOL Data/ })).toBeEnabled();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText(EMPTY_STATE)).not.toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();

    // A re-run hides the stats while it is in flight.
    const second = deferred<MassEolResult[]>();
    mockApi.on("post", SEARCH_ITC, () => second.promise);
    await user.click(screen.getByRole("button", { name: /Search EOL Data/ }));
    await waitFor(() => expect(screen.queryByText("Total")).not.toBeInTheDocument());
    second.resolve(RESULTS);
    expect(await screen.findByText("Total")).toBeInTheDocument();
  });

  it("counts only unlinked results that have candidates as matches", async () => {
    const user = userEvent.setup();
    render(<EolAdmin />);
    await search(user);

    expect(["Total", "Already Linked", "Unlinked", "Matches Found"].map(stat)).toEqual([
      "4",
      "1",
      "3",
      "2",
    ]);
    const [, filter] = screen.getAllByRole("combobox");
    expect(filter).toHaveTextContent("All (4)");
    expect(screen.getAllByText("Filter")).toHaveLength(2);
  });

  it("names each candidate's match score", async () => {
    const user = userEvent.setup();
    render(<EolAdmin />);
    await search(user);

    const ubuntu = cardOf("Ubuntu LTS");
    expect(
      within(ubuntu).getByRole("button", { name: "Match score: 90% — Click to select version" }),
    ).toHaveTextContent("ubuntu");
    expect(
      within(ubuntu).getByRole("button", { name: "Match score: 40% — Click to select version" }),
    ).toHaveTextContent("ubuntu-core");
  });

  it("clears an earlier search error when the next search succeeds", async () => {
    mockApi.fail("post", SEARCH_ITC);
    const user = userEvent.setup();
    render(<EolAdmin />);

    await user.click(screen.getByRole("button", { name: /Search EOL Data/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(`POST ${SEARCH_ITC} failed`);

    mockApi.on("post", SEARCH_ITC, RESULTS);
    await search(user);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports a search failure that is not an Error generically", async () => {
    mockApi.on("post", SEARCH_ITC, () => Promise.reject("down"));
    const user = userEvent.setup();
    render(<EolAdmin />);

    await user.click(screen.getByRole("button", { name: /Search EOL Data/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });
});

describe("EolAdmin cycle picker", () => {
  it("fetches cycles only once a match is picked, with a progress bar meanwhile", async () => {
    const cycles = deferred<EolCycle[]>();
    mockApi.on("get", "/eol/products/ubuntu", () => cycles.promise);
    const user = userEvent.setup();
    render(<EolAdmin />);
    await search(user);
    expect(mockApi.callsOf("get")).toHaveLength(0);

    await user.click(within(cardOf("Ubuntu LTS")).getByText("ubuntu"));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Select the version/cycle that matches your deployment."),
    ).toBeInTheDocument();
    expect(await within(dialog).findByRole("progressbar")).toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/No release cycles found/)).not.toBeInTheDocument();

    cycles.resolve(UBUNTU_CYCLES);
    expect(await within(dialog).findByRole("combobox")).toBeInTheDocument();
    expect(within(dialog).queryByRole("progressbar")).not.toBeInTheDocument();
    expect(within(dialog).getAllByText("Version / Cycle")).toHaveLength(2);
    expect(within(dialog).queryByText(/No release cycles found/)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Closing the picker does not fetch again.
    expect(mockApi.callsOf("get")).toHaveLength(1);
    expect(mockApi.callsOf("get")[0].path).toBe("/eol/products/ubuntu");
  });

  it("shows only the error, no select and no empty note, when the first fetch fails", async () => {
    mockApi.on("get", "/eol/products/ubuntu", () => Promise.reject("down"));
    const user = userEvent.setup();
    render(<EolAdmin />);
    await search(user);

    await user.click(within(cardOf("Ubuntu LTS")).getByText("ubuntu"));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Something went wrong");
    expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/No release cycles found/)).not.toBeInTheDocument();
  });

  it("classifies each cycle by its end-of-life value", async () => {
    mockApi.on("get", "/eol/products/ubuntu", [
      { cycle: "26.04", eol: false },
      { cycle: "24.04", eol: "2999-01-01" },
      { cycle: "16.04", eol: "2001-01-01" },
      { cycle: "14.04", eol: true },
    ] satisfies EolCycle[]);
    const user = userEvent.setup();
    render(<EolAdmin />);
    await search(user);

    await user.click(within(cardOf("Ubuntu LTS")).getByText("ubuntu"));
    const dialog = await screen.findByRole("dialog");
    expect(await cycleStatuses(user, dialog)).toEqual([
      "26.04Supported",
      "24.04Supported",
      "16.04End of Life",
      "14.04End of Life",
    ]);
  });

  describe("on the boundary days", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("calls a cycle ending today end of life, and one ending in six months approaching", async () => {
      // Only the clock is faked: timers stay real, so MUI and user-event behave.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2030, 0, 15));
      mockApi.on("get", "/eol/products/ubuntu", [
        { cycle: "today", eol: "2030-01-15" },
        { cycle: "six months", eol: "2030-07-15" },
        { cycle: "later", eol: "2030-07-16" },
      ] satisfies EolCycle[]);
      const user = userEvent.setup();
      render(<EolAdmin />);
      await search(user);

      await user.click(within(cardOf("Ubuntu LTS")).getByText("ubuntu"));
      const dialog = await screen.findByRole("dialog");
      expect(await cycleStatuses(user, dialog)).toEqual([
        "todayEnd of Life",
        "six monthsApproaching EOL",
        "laterSupported",
      ]);
    });
  });
});

describe("EolAdmin pending links", () => {
  beforeEach(() => {
    mockApi.on("get", "/eol/products/ubuntu", UBUNTU_CYCLES);
    mockApi.on("get", "/eol/products/nodejs", NODE_CYCLES);
  });

  it("removes only the row's own pending link", async () => {
    const user = userEvent.setup();
    render(<EolAdmin />);
    await search(user);
    await linkCycle(user, "Ubuntu LTS", "ubuntu", /^24\.04/);
    await linkCycle(user, "Node runtime", "nodejs", /^20/);
    expect(screen.getByText("2 card(s) selected for EOL linking")).toBeInTheDocument();

    await user.click(within(cardOf("Ubuntu LTS")).getByRole("button", { name: "close" }));

    expect(within(cardOf("Ubuntu LTS")).queryByText(/Will link to/)).not.toBeInTheDocument();
    expect(within(cardOf("Node runtime")).getByText(/Will link to/)).toHaveTextContent(
      "Will link to nodejs 20",
    );
    expect(screen.getByText("1 card(s) selected for EOL linking")).toBeInTheDocument();
  });

  it("labels the apply button while saving, and a later search drops the success message", async () => {
    const save = deferred<{ count: number; updated: string[] }>();
    mockApi.on("post", LINK, () => save.promise);
    const user = userEvent.setup();
    render(<EolAdmin />);
    await search(user);
    await linkCycle(user, "Ubuntu LTS", "ubuntu", /^24\.04/);

    await user.click(screen.getByRole("button", { name: /Apply Links/ }));
    expect(await screen.findByRole("button", { name: /Saving\.\.\./ })).toBeDisabled();

    save.resolve({ count: 1, updated: ["c2"] });
    expect(
      await screen.findByText("Successfully linked 1 card(s) to EOL data."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Search EOL Data/ }));
    await waitFor(() => expect(mockApi.callsOf("post", SEARCH_ITC)).toHaveLength(3));
    await waitFor(() =>
      expect(screen.queryByText(/Successfully linked/)).not.toBeInTheDocument(),
    );
  });

  it("reports a failed save, keeps the selection, and clears the error on retry", async () => {
    mockApi.fail("post", LINK);
    const user = userEvent.setup();
    render(<EolAdmin />);
    await search(user);
    await linkCycle(user, "Ubuntu LTS", "ubuntu", /^24\.04/);

    await user.click(screen.getByRole("button", { name: /Apply Links/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(`POST ${LINK} failed`);
    expect(screen.getByText("1 card(s) selected for EOL linking")).toBeInTheDocument();
    const apply = screen.getByRole("button", { name: /Apply Links/ });
    expect(apply).toBeEnabled();
    // The results were not re-fetched.
    expect(mockApi.callsOf("post", SEARCH_ITC)).toHaveLength(1);

    const retry = deferred<{ count: number; updated: string[] }>();
    mockApi.on("post", LINK, () => retry.promise);
    await user.click(apply);
    await waitFor(() => expect(mockApi.callsOf("post", LINK)).toHaveLength(2));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    retry.resolve({ count: 1, updated: ["c2"] });
    expect(
      await screen.findByText("Successfully linked 1 card(s) to EOL data."),
    ).toBeInTheDocument();
  });

  it("reports a save failure that is not an Error generically", async () => {
    mockApi.on("post", LINK, () => Promise.reject("down"));
    const user = userEvent.setup();
    render(<EolAdmin />);
    await search(user);
    await linkCycle(user, "Ubuntu LTS", "ubuntu", /^24\.04/);

    await user.click(screen.getByRole("button", { name: /Apply Links/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });
});
