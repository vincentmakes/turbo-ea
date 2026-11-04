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
  });
});
