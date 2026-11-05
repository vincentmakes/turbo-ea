import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import type { EolCustomProduct } from "@/types";
import SwitchToUpstreamDialog, { initialCycleMap } from "./SwitchToUpstreamDialog";

const cycle = (id: string, name: string, linked: number) => ({
  id,
  cycle: name,
  releaseDate: null,
  support: null,
  eol: null,
  latest: null,
  latestReleaseDate: null,
  sort_order: 0,
  linked_cards: linked,
  updated_at: null,
});

const PRODUCT: EolCustomProduct = {
  id: "p1",
  key: "acme-erp",
  product: "custom:acme-erp",
  title: "Acme ERP",
  description: null,
  link: null,
  linked_cards: 5,
  updated_at: null,
  cycles: [cycle("c2", "2", 3), cycle("c1", "1", 2)],
};

beforeEach(() => {
  mockApi.reset();
  mockApi.on("get", "/eol/products/acme", [{ cycle: "2" }, { cycle: "3" }]);
});

describe("initialCycleMap", () => {
  it("maps same-name cycles and keeps the rest", () => {
    expect(initialCycleMap(["2", "1"], [{ cycle: "2" }, { cycle: "3" }])).toEqual({
      "2": "2",
      "1": null,
    });
  });
});

describe("SwitchToUpstreamDialog", () => {
  it("prefills the hinted product, maps cycles and relinks", async () => {
    mockApi.on("post", "/eol/custom-products/acme-erp/switch", {
      relinked: 3,
      kept: 2,
      deleted: false,
    });
    const onSwitched = vi.fn();
    render(
      <SwitchToUpstreamDialog
        open
        product={PRODUCT}
        initialTarget="acme"
        onClose={() => {}}
        onSwitched={onSwitched}
      />,
    );
    // Cycle "2" maps itself; "1" has no twin upstream and is kept.
    expect(await screen.findByText("3 cards will be linked to acme.")).toBeInTheDocument();
    const map1 = screen.getByRole("combobox", { name: "endoflife.date cycle for 1" });
    expect(map1).toHaveTextContent("Keep on the custom product");

    await userEvent.click(map1);
    await userEvent.click(await screen.findByRole("option", { name: "3" }));
    expect(await screen.findByText("5 cards will be linked to acme.")).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText(/Delete the custom product/));
    await userEvent.click(screen.getByRole("button", { name: "Switch" }));
    await waitFor(() =>
      expect(onSwitched).toHaveBeenCalledWith({ relinked: 3, kept: 2, deleted: false }),
    );
    expect(mockApi.callsOf("post")[0].body).toEqual({
      target_product: "acme",
      cycle_map: { "2": "2", "1": "3" },
      delete_when_unused: false,
    });
  });

  it("searches endoflife.date only, ignoring custom products", async () => {
    mockApi.on("get", "/eol/products?search=acm", [
      { name: "custom:acme-erp", title: "Acme ERP", custom: true },
      { name: "acme" },
    ]);
    render(
      <SwitchToUpstreamDialog open product={PRODUCT} onClose={() => {}} onSwitched={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Switch" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/endoflife.date product/), "acm");
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["acme"]);
    await userEvent.click(options[0]);
    expect(await screen.findByText("3 cards will be linked to acme.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch" })).toBeEnabled();
  });

  it("shows the server's refusal and stays open", async () => {
    mockApi.fail("post", "/eol/custom-products/acme-erp/switch", 422, "no such cycle");
    const onSwitched = vi.fn();
    render(
      <SwitchToUpstreamDialog
        open
        product={PRODUCT}
        initialTarget="acme"
        onClose={() => {}}
        onSwitched={onSwitched}
      />,
    );
    await screen.findByText(/will be linked to acme/);
    await userEvent.click(screen.getByRole("button", { name: "Switch" }));
    const dialog = screen.getByRole("dialog");
    expect(
      await within(dialog).findByText("POST /eol/custom-products/acme-erp/switch failed"),
    ).toBeInTheDocument();
    expect(onSwitched).not.toHaveBeenCalled();
  });

  it("reports a target endoflife.date does not know", async () => {
    mockApi.fail("get", "/eol/products/nope", 404, "Product 'nope' not found");
    render(
      <SwitchToUpstreamDialog
        open
        product={PRODUCT}
        initialTarget="nope"
        onClose={() => {}}
        onSwitched={() => {}}
      />,
    );
    expect(await screen.findByText("GET /eol/products/nope failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch" })).toBeDisabled();
    // The error says it all: no "no cycles" line under it.
    expect(screen.queryByText(/lists no release cycles yet/)).toBeNull();
  });
});

describe("SwitchToUpstreamDialog — details", () => {
  function open(props: Partial<React.ComponentProps<typeof SwitchToUpstreamDialog>> = {}) {
    const onClose = vi.fn();
    const onSwitched = vi.fn();
    render(
      <SwitchToUpstreamDialog
        open
        product={PRODUCT}
        onClose={onClose}
        onSwitched={onSwitched}
        {...props}
      />,
    );
    return { onClose, onSwitched };
  }

  it("explains itself, keeps the delete option on, and cancels", async () => {
    const { onClose } = open({ initialTarget: "acme" });
    expect(screen.getByText("Switch Acme ERP to endoflife.date")).toBeInTheDocument();
    expect(screen.getByText(/Once endoflife.date tracks this product/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Delete the custom product/)).toBeChecked();
    expect(await screen.findByText("Your cycle")).toBeInTheDocument();
    expect(screen.getByText("endoflife.date cycle")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Linked cards" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("starts with an empty search and suggests the product to type", () => {
    open();
    const input = screen.getByLabelText(/endoflife.date product/);
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("placeholder", "e.g. postgresql");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText(/will be linked to/)).toBeNull();
  });

  it("searches from two letters on, trimmed, and shows nothing when the search fails", async () => {
    mockApi.fail("get", "/eol/products?search=ac", 500);
    open();
    const input = screen.getByLabelText(/endoflife.date product/);
    await userEvent.type(input, " a");
    await new Promise((r) => setTimeout(r, 400));
    expect(mockApi.callsOf("get").filter((c) => c.path.startsWith("/eol/products?"))).toHaveLength(0);
    await userEvent.type(input, "c");
    await waitFor(() => expect(mockApi.callsOf("get", "/eol/products?search=ac")).toHaveLength(1));
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("maps a cycle back to keep", async () => {
    mockApi.on("post", "/eol/custom-products/acme-erp/switch", { relinked: 0, kept: 5, deleted: false });
    open({ initialTarget: "acme" });
    const map2 = await screen.findByRole("combobox", { name: "endoflife.date cycle for 2" });
    await userEvent.click(map2);
    await userEvent.click(await screen.findByRole("option", { name: "Keep on the custom product" }));
    expect(await screen.findByText("0 cards will be linked to acme.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Switch" }));
    await waitFor(() => expect(mockApi.callsOf("post")).toHaveLength(1));
    expect(mockApi.callsOf("post")[0].body).toMatchObject({ cycle_map: { "2": null, "1": null } });
  });

  it("shows progress while the cycles load, and no table for a product without any", async () => {
    let release: (v: unknown) => void = () => {};
    mockApi.on("get", "/eol/products/acme", () => new Promise((r) => (release = r)));
    open({ initialTarget: "acme" });
    expect(await screen.findByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText(/lists no release cycles yet/)).toBeNull();
    release([]);
    await waitFor(() => expect(screen.queryByRole("progressbar")).toBeNull());
    expect(screen.queryByRole("table")).toBeNull();
    expect(
      screen.getByText(
        "This endoflife.date product lists no release cycles yet, so there is nothing to switch the cards to.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/will be linked to/)).toBeNull();
    expect(screen.getByRole("button", { name: "Switch" })).toBeDisabled();
  });

  it("holds the buttons while switching, clears the last error, and lets an error go", async () => {
    mockApi.fail("post", "/eol/custom-products/acme-erp/switch", 422);
    open({ initialTarget: "acme" });
    await screen.findByText(/will be linked to acme/);
    const switchButton = screen.getByRole("button", { name: "Switch" });
    await userEvent.click(switchButton);
    const alert = await screen.findByText("POST /eol/custom-products/acme-erp/switch failed");
    expect(switchButton).toBeEnabled();
    await userEvent.click(within(alert.closest("[role=alert]") as HTMLElement).getByRole("button"));
    expect(screen.queryByText(/switch failed/)).toBeNull();

    await userEvent.click(switchButton);
    await screen.findByText("POST /eol/custom-products/acme-erp/switch failed");
    mockApi.on("post", "/eol/custom-products/acme-erp/switch", () => new Promise(() => {}));
    await userEvent.click(switchButton);
    await waitFor(() => expect(screen.queryByText(/switch failed/)).toBeNull());
    expect(switchButton).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("renders nothing while closed or without a product", () => {
    const { rerender } = render(
      <SwitchToUpstreamDialog open={false} product={PRODUCT} onClose={() => {}} onSwitched={() => {}} />,
    );
    expect(screen.queryByText(/Switch Acme ERP/)).toBeNull();
    rerender(<SwitchToUpstreamDialog open product={null} onClose={() => {}} onSwitched={() => {}} />);
    expect(screen.queryByText(/to endoflife.date/)).toBeNull();
    expect(mockApi.calls).toHaveLength(0);
  });
});
