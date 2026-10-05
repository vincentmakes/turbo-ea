/**
 * The End-of-Life section on card detail and the picker dialog the create
 * flow opens. Both sit on the same `EolPicker`: a fuzzy auto-search on the
 * card's name (600 ms debounce), a manual product search (300 ms debounce)
 * and a cycle select loaded from `GET /eol/products/{product}`.
 *
 * Real timers throughout: the debounces are short, and `findBy*` waits.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import { CARD_IDS, cardById, makeCard } from "@/test/fixtures/metamodel";
import { toIsoDate } from "@/lib/dates";
import type { Card, EolCycle } from "@/types";
import EolLinkSection, { EolLinkDialog } from "./EolLinkSection";

const LINKED = cardById(CARD_IDS.postgres); // eol_product postgresql, eol_cycle 16
const UNLINKED = cardById(CARD_IDS.linux); // "Ubuntu LTS", no link
const FUZZY_URL = "/eol/products/fuzzy?search=Ubuntu%20LTS&limit=5";

/** A local calendar date `months` from today — the shape endoflife.date returns. */
const future = (months: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return toIsoDate(d);
};

const CYCLES: EolCycle[] = [
  {
    cycle: "16",
    releaseDate: "2023-09-14",
    eol: future(48),
    latest: "16.4",
    latestReleaseDate: "2024-08-08",
    lts: true,
    support: future(24),
    codename: "Sixteen",
    link: "https://www.postgresql.org/docs/release/16.4/",
  },
  { cycle: "12", eol: true, support: false },
];

/** The cycle Select has no accessible name (no labelId): it is the second
 *  combobox, after the product Autocomplete, once its label is on screen (the
 *  outlined variant prints the label twice — the label and the border notch). */
async function cycleSelect(scope: HTMLElement | typeof screen = screen): Promise<HTMLElement> {
  const q = scope === screen ? screen : within(scope as HTMLElement);
  await q.findAllByText("Version / Cycle");
  return q.getAllByRole("combobox")[1];
}

function renderSection(card: Card, props: Partial<{ initialExpanded: boolean }> = {}) {
  const onSave = vi.fn(async () => {});
  const utils = render(<EolLinkSection card={card} onSave={onSave} {...props} />);
  return { ...utils, onSave };
}

beforeEach(() => {
  mockApi.reset();
  mockApi.on("get", "/eol/products/postgresql", CYCLES);
});

describe("EolLinkSection — linked card", () => {
  it("renders nothing for a type that cannot carry EOL data", () => {
    const { container } = renderSection(makeCard({ type: "Provider", name: "Acme" }));
    expect(container).toBeEmptyDOMElement();
    expect(mockApi.callsOf("get")).toHaveLength(0);
  });

  it("shows the linked product, the status chip and the cycle details", async () => {
    renderSection(LINKED);
    expect(screen.getByText("End of Life")).toBeInTheDocument();
    expect(await screen.findByText("postgresql 16")).toBeInTheDocument();
    expect(screen.getByText("Linked to")).toBeInTheDocument();
    // Header chip + status badge both read "Supported". They come from the
    // cycles request, which lands after the product name the card already holds.
    await waitFor(() => expect(screen.getAllByText("Supported")).toHaveLength(2));
    expect(screen.getByText("2023-09-14")).toBeInTheDocument();
    expect(screen.getByText("16.4")).toBeInTheDocument();
    expect(screen.getByText("Sixteen")).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Release notes/ })).toHaveAttribute(
      "href",
      "https://www.postgresql.org/docs/release/16.4/",
    );
  });

  it("marks a cycle whose eol flag is true as End of Life", async () => {
    renderSection(makeCard({ ...LINKED, attributes: { eol_product: "postgresql", eol_cycle: "12" } }));
    await screen.findByText("postgresql 12");
    // Title, header chip, status badge and the row label. The last three come
    // from the cycles request, which lands after the product the card holds.
    await waitFor(() => expect(screen.getAllByText("End of Life")).toHaveLength(4));
    expect(screen.getByText("Yes (EOL)")).toBeInTheDocument();
    expect(screen.getByText("No")).toBeInTheDocument();
  });

  it("warns when the eol date is within six months, and when only security fixes remain", async () => {
    mockApi.on("get", "/eol/products/postgresql", [
      { cycle: "16", eol: future(3), support: future(1) },
    ]);
    const { rerender } = renderSection(LINKED);
    expect(await screen.findAllByText("Approaching EOL")).toHaveLength(2);

    mockApi.on("get", "/eol/products/postgresql", [{ cycle: "16", eol: future(48), support: false }]);
    rerender(<EolLinkSection card={{ ...LINKED, id: "other" }} onSave={vi.fn()} />);
    // Same product/cycle → no refetch; click Refresh to pull the new data.
    const user = userEvent.setup();
    await user.click(screen.getByTitle("Refresh EOL data"));
    expect(await screen.findAllByText("Security fixes only")).toHaveLength(2);
  });

  it("warns when the stored cycle is unknown to the product", async () => {
    mockApi.on("get", "/eol/products/postgresql", [{ cycle: "15" }]);
    renderSection(LINKED);
    expect(await screen.findByRole("alert")).toHaveTextContent('Cycle "16" not found for postgresql');
  });

  it("surfaces a failed cycle fetch and lets the user dismiss it", async () => {
    mockApi.fail("get", "/eol/products/postgresql", 502, "upstream");
    const user = userEvent.setup();
    renderSection(LINKED);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("GET /eol/products/postgresql failed");
    await user.click(within(alert).getByRole("button", { name: /close/i }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("unlinks by saving the attributes without the two EOL keys", async () => {
    const user = userEvent.setup();
    const { onSave } = renderSection(LINKED);
    await screen.findByText("postgresql 16");
    await user.click(screen.getByTitle("Unlink EOL data"));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ attributes: { version: "16" } }));
  });

  it("switches to the picker on Change and back on Cancel", async () => {
    const user = userEvent.setup();
    renderSection(LINKED);
    await screen.findByText("postgresql 16");
    await user.click(screen.getByTitle("Change linked product"));
    const search = screen.getByLabelText("Search product on endoflife.date");
    expect(search).toHaveValue("postgresql");
    expect(screen.queryByText("Linked to")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("Linked to")).toBeInTheDocument();
  });

  it("honours an explicit collapsed default", () => {
    renderSection(LINKED, { initialExpanded: false });
    expect(screen.getByRole("button", { name: /End of Life/ })).toHaveAttribute("aria-expanded", "false");
  });
});

describe("EolLinkSection — unlinked card", () => {
  beforeEach(() => {
    mockApi.on("get", FUZZY_URL, [
      { name: "ubuntu", score: 0.9 },
      { name: "ubuntu-core", score: 0.4 },
    ]);
    mockApi.on("get", "/eol/products/ubuntu", [
      { cycle: "24.04", latest: "24.04.1", eol: future(40) },
      { cycle: "22.04", eol: future(20) },
    ]);
    mockApi.on("get", "/eol/products?search=ubuntu", [{ name: "ubuntu" }]);
  });

  it("auto-searches on the card name and links the chosen suggestion and cycle", async () => {
    const user = userEvent.setup();
    const { onSave } = renderSection(UNLINKED);
    expect(screen.getByText(/Link this IT component to a product/)).toBeInTheDocument();
    // Nothing linked → collapsed by default; open it to reach the picker.
    const summary = screen.getByRole("button", { name: /End of Life/ });
    expect(summary).toHaveAttribute("aria-expanded", "false");
    await user.click(summary);

    expect(await screen.findByText("Suggested matches from endoflife.date:", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(mockApi.callsOf("get", FUZZY_URL)).toHaveLength(1);
    const link = screen.getByRole("button", { name: "Link" });
    expect(link).toBeDisabled();

    await user.click(screen.getByText("ubuntu"));
    // Picking a suggestion loads the product's cycles.
    await user.click(await cycleSelect());
    const option = await screen.findByRole("option", { name: /24\.04/ });
    expect(option).toHaveTextContent("latest: 24.04.1");
    expect(option).toHaveTextContent("Supported");
    await user.click(option);
    expect(link).toBeEnabled();

    await user.click(link);
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        attributes: { version: "24.04", eol_product: "ubuntu", eol_cycle: "24.04" },
      }),
    );
  });

  it("says so when the auto-search finds nothing", async () => {
    mockApi.on("get", FUZZY_URL, []);
    renderSection(UNLINKED);
    expect(await screen.findByText(/No EOL matches found/, {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it("skips the auto-search for a one-character name", async () => {
    mockApi.on("get", "/eol/products/fuzzy*", []);
    renderSection(makeCard({ type: "Application", name: "X" }));
    expect(screen.getByText(/Link this application to a product/)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 800));
    expect(mockApi.callsOf("get")).toHaveLength(0);
  });

  it("searches manually with a debounce and reports a product without cycles", async () => {
    mockApi.on("get", "/eol/products?search=redis", [{ name: "redis" }, { name: "redis-stack" }]);
    mockApi.on("get", "/eol/products/redis", []);
    mockApi.on("get", "/eol/products/fuzzy*", []);
    // No pause between keystrokes: on a loaded runner a real one can outlast
    // the 300 ms debounce and let an intermediate value through.
    const user = userEvent.setup({ delay: null });
    renderSection(makeCard({ type: "ITComponent", name: "Cache" }), { initialExpanded: true });

    const search = screen.getByLabelText("Search product on endoflife.date");
    await user.type(search, "redis");
    // One request for the settled value, none for the intermediate ones.
    const option = await screen.findByRole("option", { name: "redis" }, { timeout: 3000 });
    expect(mockApi.callsOf("get", /^\/eol\/products\?search=/)).toHaveLength(1);
    expect(screen.getByRole("option", { name: "redis-stack" })).toBeInTheDocument();

    await user.click(option);
    expect(await screen.findByText('No release cycles found for "redis".')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link" })).toBeDisabled();
  });
});

describe("EolLinkDialog", () => {
  it("links the picked product and cycle, then closes", async () => {
    mockApi.on("get", "/eol/products/fuzzy*", []);
    const user = userEvent.setup();
    const onLink = vi.fn();
    const onClose = vi.fn();
    render(<EolLinkDialog open onClose={onClose} onLink={onLink} initialProduct="postgresql" />);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Link End-of-Life Data")).toBeInTheDocument();
    // The initial product is pre-selected, so its cycles load straight away.
    await user.click(await cycleSelect(dialog));
    await user.click(await screen.findByRole("option", { name: /^16/ }));
    await user.click(within(dialog).getByRole("button", { name: "Link" }));
    expect(onLink).toHaveBeenCalledWith("postgresql", "16");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cancels without linking", async () => {
    mockApi.on("get", "/eol/products/fuzzy*", []);
    const user = userEvent.setup();
    const onLink = vi.fn();
    const onClose = vi.fn();
    render(<EolLinkDialog open onClose={onClose} onLink={onLink} cardName="Postgres" />);
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onLink).not.toHaveBeenCalled();
  });
});
