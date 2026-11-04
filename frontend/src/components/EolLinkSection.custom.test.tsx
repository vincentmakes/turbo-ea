/**
 * Custom EOL products inside the card's End of Life section: they appear in
 * the product search with a "Custom" chip, the section offers to create one
 * when endoflife.date has nothing, and a missing cycle can be added from the
 * cycle select — the last two only for `eol.manage`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import {
  CARD_IDS,
  cardById,
  makeCard,
  makeCardType,
  makeUserRef,
} from "@/test/fixtures/metamodel";
import { AuthProvider } from "@/hooks/AuthContext";
import type { Card, EolCustomProduct, User } from "@/types";
import EolLinkSection from "./EolLinkSection";

const UNLINKED = cardById(CARD_IDS.linux); // "Ubuntu LTS", no link
const FUZZY_URL = "/eol/products/fuzzy?search=Ubuntu%20LTS&limit=5";
const ACME_CYCLES_URL = "/eol/products/custom%3Aacme-erp";

const MANAGER = makeUserRef({ email: "eol.manager@test.com", permissions: { "eol.manage": true } });
const EDITOR = makeUserRef({ email: "editor@test.com", permissions: { "inventory.edit": true } });

function renderSection(card: Card, user: User | null = MANAGER) {
  const onSave = vi.fn(async () => {});
  render(
    <AuthProvider user={user} refreshUser={async () => {}}>
      <EolLinkSection card={card} onSave={onSave} initialExpanded />
    </AuthProvider>,
  );
  return { onSave };
}

/** The product Autocomplete is the first combobox, the cycle Select the second. */
async function cycleSelect(): Promise<HTMLElement> {
  await screen.findAllByText("Version / Cycle");
  return screen.getAllByRole("combobox")[1];
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  mockApi.on("get", FUZZY_URL, []);
  mockApi.on("get", ACME_CYCLES_URL, [
    { cycle: "2", releaseDate: "2024-01-01", eol: false },
    { cycle: "1", releaseDate: "2020-01-01", eol: true },
  ]);
});

describe("when endoflife.date has no match", () => {
  it("offers an EOL manager to create a custom product named after the card", async () => {
    renderSection(UNLINKED);
    expect(
      await screen.findByText(/Not on endoflife.date\? Define "Ubuntu LTS" as a custom product/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create custom product" })).toBeInTheDocument();
  });

  it("tells anyone else to ask an EOL manager, with no create button", async () => {
    renderSection(UNLINKED, EDITOR);
    expect(await screen.findByText(/Ask an EOL manager to add "Ubuntu LTS"/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create custom product" })).toBeNull();
  });

  it("still offers it when endoflife.date has only weak look-alikes", async () => {
    mockApi.on("get", FUZZY_URL, [
      { name: "clear-linux", score: 0.69 },
      { name: "custom:other", title: "Other", custom: true, score: 0.95 },
    ]);
    renderSection(UNLINKED);
    expect(await screen.findByText("clear-linux")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create custom product" })).toBeInTheDocument();
  });

  it("does not offer it while endoflife.date has a strong match", async () => {
    mockApi.on("get", FUZZY_URL, [{ name: "ubuntu", score: 0.7 }]);
    renderSection(UNLINKED);
    expect(await screen.findByText("ubuntu")).toBeInTheDocument();
    expect(screen.queryByText(/Not on endoflife.date/)).toBeNull();
  });

  it("creates the product on the fly and links the card to its new cycle", async () => {
    const created: EolCustomProduct = {
      id: "p1",
      key: "ubuntu-lts",
      product: "custom:ubuntu-lts",
      title: "Ubuntu LTS",
      description: null,
      link: null,
      linked_cards: 0,
      updated_at: null,
      cycles: [
        {
          id: "c1",
          cycle: "22.04",
          releaseDate: null,
          support: null,
          eol: "2027-04-01",
          latest: null,
          latestReleaseDate: null,
          sort_order: 0,
          linked_cards: 0,
          updated_at: null,
        },
      ],
    };
    mockApi.on("post", "/eol/custom-products", created);
    mockApi.on("get", "/eol/products/custom%3Aubuntu-lts", [{ cycle: "22.04", eol: "2027-04-01" }]);
    mockApi.on("get", /^\/eol\/products\?search=/, [
      { name: "custom:ubuntu-lts", title: "Ubuntu LTS", custom: true },
    ]);
    const { onSave } = renderSection(UNLINKED);

    await userEvent.click(await screen.findByRole("button", { name: "Create custom product" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/Product name/)).toHaveValue("Ubuntu LTS");
    expect(within(dialog).getByLabelText(/^Key/)).toHaveValue("ubuntu-lts");
    await userEvent.type(within(dialog).getByLabelText(/Version \/ Cycle/), "22.04");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const link = screen.getByRole("button", { name: "Link" });
    await waitFor(() => expect(link).toBeEnabled());
    await userEvent.click(link);
    expect(onSave).toHaveBeenCalledWith({
      attributes: expect.objectContaining({
        eol_product: "custom:ubuntu-lts",
        eol_cycle: "22.04",
      }),
    });
  });
});

describe("searching", () => {
  it("lists a custom product by its title with a Custom chip, and links it", async () => {
    mockApi.on("get", "/eol/products?search=acme", [
      { name: "custom:acme-erp", title: "Acme ERP", custom: true },
    ]);
    const { onSave } = renderSection(UNLINKED, EDITOR);
    await userEvent.type(screen.getAllByRole("combobox")[0], "acme");
    const option = await screen.findByRole("option", { name: /Acme ERP/ });
    expect(within(option).getByText("Custom")).toBeInTheDocument();
    await userEvent.click(option);
    expect(screen.getAllByRole("combobox")[0]).toHaveValue("Acme ERP");

    await userEvent.click(await cycleSelect());
    // Only an EOL manager may add a cycle from here.
    expect(screen.queryByRole("option", { name: /Add cycle/ })).toBeNull();
    await userEvent.click(screen.getByRole("option", { name: /^2/ }));
    await userEvent.click(screen.getByRole("button", { name: "Link" }));
    expect(onSave).toHaveBeenCalledWith({
      attributes: expect.objectContaining({ eol_product: "custom:acme-erp", eol_cycle: "2" }),
    });
    // The cycles came from the custom product's own route, fetched once.
    expect(mockApi.callsOf("get", ACME_CYCLES_URL)).toHaveLength(1);
  });

  it("lets an EOL manager add a missing cycle and selects it", async () => {
    mockApi.on("get", "/eol/products?search=acme", [
      { name: "custom:acme-erp", title: "Acme ERP", custom: true },
    ]);
    mockApi.on("post", "/eol/custom-products/acme-erp/cycles", {
      id: "c3",
      cycle: "3",
      releaseDate: null,
      support: null,
      eol: false,
      latest: null,
      latestReleaseDate: null,
      sort_order: 0,
      linked_cards: 0,
      updated_at: null,
    });
    renderSection(UNLINKED);
    await userEvent.type(screen.getAllByRole("combobox")[0], "acme");
    await userEvent.click(await screen.findByRole("option", { name: /Acme ERP/ }));
    await userEvent.click(await cycleSelect());
    await userEvent.click(screen.getByRole("option", { name: /Add cycle/ }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Add a cycle to Acme ERP")).toBeInTheDocument();
    // The next fetch returns the new cycle too.
    mockApi.on("get", ACME_CYCLES_URL, [
      { cycle: "3", eol: false },
      { cycle: "2", eol: false },
    ]);
    await userEvent.type(within(dialog).getByLabelText(/Version \/ Cycle/), "3");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add cycle" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(mockApi.callsOf("get", ACME_CYCLES_URL)).toHaveLength(2));
    await waitFor(() => expect(screen.getAllByRole("combobox")[1]).toHaveTextContent(/^3/));
  });
});

describe("a card linked to a custom product", () => {
  it("names the product by its key and marks it Custom", async () => {
    renderSection(
      makeCard({
        type: "ITComponent",
        name: "ERP host",
        attributes: { eol_product: "custom:acme-erp", eol_cycle: "1" },
      }),
    );
    expect(await screen.findByText("acme-erp 1")).toBeInTheDocument();
    expect(screen.getByText("Custom")).toBeInTheDocument();
  });
});

describe("which types show the section — the type's End of Life toggle", () => {
  it("shows it on a custom type whose layout turns it on", async () => {
    withMetamodel([
      makeCardType({ key: "Gadget", label: "Gadget", section_config: { eol: { hidden: false } } }),
    ]);
    mockApi.on("get", "/eol/products/fuzzy?search=Gizmo%209&limit=5", []);
    renderSection(makeCard({ type: "Gadget", name: "Gizmo 9" }));
    expect(screen.getByText("End of Life")).toBeInTheDocument();
  });

  it("hides it on a custom type that never turned it on", () => {
    withMetamodel([makeCardType({ key: "Gadget", label: "Gadget" })]);
    const { container } = render(
      <AuthProvider user={MANAGER} refreshUser={async () => {}}>
        <EolLinkSection card={makeCard({ type: "Gadget", name: "Gizmo 9" })} onSave={vi.fn()} />
      </AuthProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("hides it on IT Component once its layout turns it off", () => {
    withMetamodel([
      makeCardType({
        key: "ITComponent",
        label: "IT Component",
        section_config: { eol: { hidden: true } },
      }),
    ]);
    const { container } = render(
      <AuthProvider user={MANAGER} refreshUser={async () => {}}>
        <EolLinkSection card={UNLINKED} onSave={vi.fn()} />
      </AuthProvider>,
    );
    expect(container).toBeEmptyDOMElement();
    expect(mockApi.calls).toHaveLength(0);
  });
});
