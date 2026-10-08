/**
 * Mass EOL linking admin: the type picker and empty state, a search with its
 * stats and filter, the cycle picker dialog (status chips, no cycles, fetch
 * error) and the apply-links round trip, through the shared api kit.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import type { EolCycle, MassEolResult } from "@/types";
import EolAdmin from "./EolAdmin";

const SEARCH_ITC = "/eol/mass-search?type_key=ITComponent";
const SEARCH_APP = "/eol/mass-search?type_key=Application";

const LINKED: MassEolResult = {
  card_id: "c1",
  card_name: "PostgreSQL",
  card_type: "ITComponent",
  current_eol_product: "postgresql",
  current_eol_cycle: "15",
  candidates: [],
};
const MATCHED: MassEolResult = {
  card_id: "c2",
  card_name: "Ubuntu LTS",
  card_type: "ITComponent",
  candidates: [
    { card_id: "c2", card_name: "Ubuntu LTS", card_type: "ITComponent", eol_product: "ubuntu", score: 0.9 },
    { card_id: "c2", card_name: "Ubuntu LTS", card_type: "ITComponent", eol_product: "ubuntu-core", score: 0.4 },
  ],
};
const UNMATCHED: MassEolResult = {
  card_id: "c3",
  card_name: "Legacy Mainframe",
  card_type: "ITComponent",
  candidates: [],
};
const RESULTS = [LINKED, MATCHED, UNMATCHED];

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const CYCLES: EolCycle[] = [
  { cycle: "24.04", eol: isoDaysFromNow(900), latest: "24.04.1" },
  { cycle: "22.04", eol: isoDaysFromNow(60) },
  { cycle: "18.04", eol: true },
];

function cardOf(name: string): HTMLElement {
  const card = screen.getByText(name).closest(".MuiCard-root");
  if (!(card instanceof HTMLElement)) throw new Error(`no card for ${name}`);
  return card;
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

beforeEach(() => {
  mockApi.reset();
  mockApi.on("post", SEARCH_ITC, RESULTS);
});

describe("EolAdmin search", () => {
  it("shows the empty state for the picked type until a search runs", async () => {
    const user = userEvent.setup();
    render(<EolAdmin />);

    expect(
      screen.getByText('Click "Search EOL Data" to scan your IT Components against endoflife.date'),
    ).toBeInTheDocument();
    await pickOption(user, screen.getByRole("combobox"), /Application/);
    expect(
      screen.getByText('Click "Search EOL Data" to scan your Applications against endoflife.date'),
    ).toBeInTheDocument();

    mockApi.on("post", SEARCH_APP, []);
    await user.click(screen.getByRole("button", { name: /Search EOL Data/ }));
    await waitFor(() => expect(mockApi.callsOf("post", SEARCH_APP)).toHaveLength(1));
  });

  it("lists the results with stats, the current link, candidates and the no-match note", async () => {
    const user = userEvent.setup();
    render(<EolAdmin />);
    await search(user);

    const stats = ["Total", "Already Linked", "Unlinked", "Matches Found"].map(
      (label) => screen.getByText(label).parentElement?.querySelector("h6")?.textContent,
    );
    expect(stats).toEqual(["3", "1", "2", "1"]);

    expect(within(cardOf("PostgreSQL")).getByText("postgresql 15")).toBeInTheDocument();
    const ubuntu = cardOf("Ubuntu LTS");
    expect(within(ubuntu).getByText("Click a match to select version:")).toBeInTheDocument();
    expect(within(ubuntu).getByText("ubuntu")).toBeInTheDocument();
    expect(within(ubuntu).getByText("ubuntu-core")).toBeInTheDocument();
    expect(
      within(cardOf("Legacy Mainframe")).getByText("No matches found on endoflife.date"),
    ).toBeInTheDocument();
  });

  it("filters the results by link state", async () => {
    const user = userEvent.setup();
    render(<EolAdmin />);
    await search(user);

    const [, filter] = screen.getAllByRole("combobox");
    await pickOption(user, filter, "Unlinked (2)");
    expect(screen.queryByText("PostgreSQL")).not.toBeInTheDocument();
    expect(screen.getByText("Ubuntu LTS")).toBeInTheDocument();

    await pickOption(user, filter, "Linked (1)");
    expect(screen.getByText("PostgreSQL")).toBeInTheDocument();
    expect(screen.queryByText("Ubuntu LTS")).not.toBeInTheDocument();

    await pickOption(user, filter, "All (3)");
    expect(screen.getByText("Legacy Mainframe")).toBeInTheDocument();
  });

  it("reports a failed search in a dismissible alert", async () => {
    mockApi.fail("post", SEARCH_ITC);
    const user = userEvent.setup();
    render(<EolAdmin />);

    await user.click(screen.getByRole("button", { name: /Search EOL Data/ }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(`POST ${SEARCH_ITC} failed`);
    await user.click(within(alert).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});

describe("EolAdmin cycle picker", () => {
  it("picks a cycle, shows the pending link, and applies it", async () => {
    mockApi.on("get", "/eol/products/ubuntu", CYCLES);
    mockApi.on("post", "/eol/mass-link", { count: 1, updated: ["c2"] });
    const user = userEvent.setup();
    render(<EolAdmin />);
    await search(user);

    await user.click(within(cardOf("Ubuntu LTS")).getByText("ubuntu"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Select Version for Ubuntu LTS")).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "Confirm" });
    expect(confirm).toBeDisabled();

    await user.click(await within(dialog).findByRole("combobox"));
    const listbox = await screen.findByRole("listbox");
    const supported = within(listbox).getByRole("option", { name: /^24\.04/ });
    expect(within(supported).getByText("Supported")).toBeInTheDocument();
    expect(within(supported).getByText("(latest: 24.04.1)")).toBeInTheDocument();
    expect(
      within(within(listbox).getByRole("option", { name: /22\.04/ })).getByText("Approaching EOL"),
    ).toBeInTheDocument();
    expect(
      within(within(listbox).getByRole("option", { name: /18\.04/ })).getByText("End of Life"),
    ).toBeInTheDocument();
    await user.click(supported);
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());

    await user.click(confirm);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const ubuntu = cardOf("Ubuntu LTS");
    expect(within(ubuntu).getByText(/Will link to/)).toBeInTheDocument();
    expect(within(ubuntu).getByText("ubuntu")).toBeInTheDocument();
    expect(screen.getByText("1 card(s) selected for EOL linking")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Apply Links/ }));
    await waitFor(() => expect(mockApi.callsOf("post", "/eol/mass-link")).toHaveLength(1));
    expect(mockApi.callsOf("post", "/eol/mass-link")[0].body).toEqual([
      { card_id: "c2", eol_product: "ubuntu", eol_cycle: "24.04" },
    ]);
    // The results are re-fetched, then the success message lands.
    await waitFor(() => expect(mockApi.callsOf("post", SEARCH_ITC)).toHaveLength(2));
    expect(await screen.findByText("Successfully linked 1 card(s) to EOL data.")).toBeInTheDocument();
    expect(screen.queryByText("1 card(s) selected for EOL linking")).not.toBeInTheDocument();
  });

  it("removes one pending link from its row and clears all from the action bar", async () => {
    mockApi.on("get", "/eol/products/ubuntu", CYCLES);
    const user = userEvent.setup();
    render(<EolAdmin />);
    await search(user);

    const select = async () => {
      await user.click(within(cardOf("Ubuntu LTS")).getByText("ubuntu"));
      const dialog = await screen.findByRole("dialog");
      await pickOption(user, await within(dialog).findByRole("combobox"), /18\.04/);
      await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    };

    await select();
    await user.click(within(cardOf("Ubuntu LTS")).getByRole("button", { name: "close" }));
    expect(screen.queryByText(/Will link to/)).not.toBeInTheDocument();
    expect(screen.queryByText(/selected for EOL linking/)).not.toBeInTheDocument();

    await select();
    await user.click(screen.getByRole("button", { name: "Clear All" }));
    expect(screen.queryByText(/Will link to/)).not.toBeInTheDocument();
    expect(mockApi.callsOf("post", "/eol/mass-link")).toHaveLength(0);
  });

  it("says so when a product has no cycles, and surfaces a failed cycle fetch", async () => {
    mockApi.on("get", "/eol/products/ubuntu-core", []);
    mockApi.fail("get", "/eol/products/ubuntu");
    const user = userEvent.setup();
    render(<EolAdmin />);
    await search(user);

    await user.click(within(cardOf("Ubuntu LTS")).getByText("ubuntu-core"));
    let dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByText('No release cycles found for "ubuntu-core".'),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(within(cardOf("Ubuntu LTS")).getByText("ubuntu"));
    dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "GET /eol/products/ubuntu failed",
    );
    expect(within(dialog).getByRole("button", { name: "Confirm" })).toBeDisabled();
  });
});

describe("EolAdmin cycle picker, reopened for another product", () => {
  it("does not offer the previous product's cycles when the next product's fetch fails", async () => {
    mockApi.on("get", "/eol/products/ubuntu", CYCLES);
    mockApi.fail("get", "/eol/products/ubuntu-core");
    const user = userEvent.setup();
    render(<EolAdmin />);
    await search(user);

    await user.click(within(cardOf("Ubuntu LTS")).getByText("ubuntu"));
    let dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("combobox")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(within(cardOf("Ubuntu LTS")).getByText("ubuntu-core"));
    dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "GET /eol/products/ubuntu-core failed",
    );
    // Only the error: no select still listing ubuntu's 24.04 / 22.04 / 18.04.
    expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Confirm" })).toBeDisabled();
  });

  it("never renders the no-cycles note before the progress bar, even reopened during the fade-out", async () => {
    const pending: Array<(v: EolCycle[]) => void> = [];
    mockApi.on("get", "/eol/products/ubuntu-core", []);
    mockApi.on("get", "/eol/products/ubuntu", () => new Promise<EolCycle[]>((r) => pending.push(r)));
    const user = userEvent.setup();
    render(<EolAdmin />);
    await search(user);

    // ubuntu-core has no cycles: the note is right there.
    await user.click(within(cardOf("Ubuntu LTS")).getByText("ubuntu-core"));
    let dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/No release cycles found/)).toBeInTheDocument();

    const seen: string[] = [];
    // A node rendered for one commit and removed by the next shows up as a
    // removal; a detached node keeps its text, so both lists are checked.
    const collect = (records: MutationRecord[]) => {
      for (const r of records) {
        r.addedNodes.forEach((n) => seen.push(n.textContent ?? ""));
        r.removedNodes.forEach((n) => seen.push(n.textContent ?? ""));
      }
    };
    // Close with Escape and, while the dialog is still fading out, open the
    // other match from the keyboard.
    await user.keyboard("{Escape}");
    const observer = new MutationObserver(collect);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const ubuntu = within(cardOf("Ubuntu LTS")).getByText("ubuntu").closest<HTMLElement>(
      "[role=button]",
    );
    ubuntu?.focus();
    await user.keyboard("{Enter}");
    dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("progressbar")).toBeInTheDocument();
    collect(observer.takeRecords());
    observer.disconnect();

    expect(seen.some((s) => s.includes('No release cycles found for "ubuntu"'))).toBe(false);
    pending.forEach((resolve) => resolve(CYCLES));
    expect(await within(dialog).findByRole("combobox")).toBeInTheDocument();
  });
});

describe("EolAdmin cycle picker, a slow fetch from an earlier opening", () => {
  function deferredCycles() {
    let resolve!: (v: EolCycle[]) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<EolCycle[]>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  async function reopenWhileFirstIsPending() {
    const first = deferredCycles();
    const second = deferredCycles();
    mockApi.on("get", "/eol/products/ubuntu", () => first.promise);
    mockApi.on("get", "/eol/products/ubuntu-core", () => second.promise);
    const user = userEvent.setup();
    render(<EolAdmin />);
    await search(user);

    await user.click(within(cardOf("Ubuntu LTS")).getByText("ubuntu"));
    let dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(within(cardOf("Ubuntu LTS")).getByText("ubuntu-core"));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("progressbar")).toBeInTheDocument();
    return { dialog, first, second };
  }

  it("neither fills nor settles the picker opened for another product", async () => {
    const { dialog, first, second } = await reopenWhileFirstIsPending();

    first.resolve(CYCLES);
    // Let the late reply settle, then check it changed nothing.
    await new Promise((r) => setTimeout(r, 0));
    expect(within(dialog).getByRole("progressbar")).toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/No release cycles found/)).not.toBeInTheDocument();

    second.resolve([]);
    expect(
      await within(dialog).findByText('No release cycles found for "ubuntu-core".'),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("does not report its failure in the picker opened for another product", async () => {
    const { dialog, first, second } = await reopenWhileFirstIsPending();

    first.reject(new Error("GET /eol/products/ubuntu failed"));
    await new Promise((r) => setTimeout(r, 0));
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("progressbar")).toBeInTheDocument();

    second.resolve(CYCLES);
    expect(await within(dialog).findByRole("combobox")).toBeInTheDocument();
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("EolAdmin cycle picker, closing", () => {
  it("keeps the cycles on screen while the picker fades out", async () => {
    mockApi.on("get", "/eol/products/ubuntu", CYCLES);
    const user = userEvent.setup();
    render(<EolAdmin />);
    await search(user);

    await user.click(within(cardOf("Ubuntu LTS")).getByText("ubuntu"));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("combobox")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    // Mid-exit: still the select, not a fresh progress bar.
    expect(within(dialog).queryByRole("progressbar")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { hidden: true })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
