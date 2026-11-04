/**
 * Settings → EOL: the two tabs (bulk linking, custom products), and custom
 * products inside the bulk linking — offered by title, linked by `custom:`
 * key, never printed as the raw link.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("./CustomEolProductsGrid", () => ({
  default: () => <div data-testid="custom-eol-grid" />,
}));

import { mockApi } from "@/test/apiMock";
import type { MassEolResult } from "@/types";
import EolAdmin from "./EolAdmin";

const SEARCH_ITC = "/eol/mass-search?type_key=ITComponent";

const RESULTS: MassEolResult[] = [
  {
    card_id: "c1",
    card_name: "Acme ERP host",
    card_type: "ITComponent",
    candidates: [
      {
        card_id: "c1",
        card_name: "Acme ERP host",
        card_type: "ITComponent",
        eol_product: "custom:acme-erp",
        title: "Acme ERP",
        custom: true,
        score: 0.95,
      },
    ],
  },
  {
    card_id: "c2",
    card_name: "Old ERP host",
    card_type: "ITComponent",
    current_eol_product: "custom:acme-erp",
    current_eol_cycle: "1",
    candidates: [],
  },
];

beforeEach(() => {
  mockApi.reset();
  mockApi.on("post", SEARCH_ITC, RESULTS);
  mockApi.on("get", "/eol/products/custom%3Aacme-erp", [{ cycle: "2", eol: false }]);
  mockApi.on("post", "/eol/mass-link", { updated: ["c1"], count: 1 });
});

describe("EolAdmin tabs", () => {
  it("opens on bulk linking and switches to the custom products grid", async () => {
    render(<EolAdmin />);
    expect(screen.getByRole("tab", { name: /Link cards to endoflife.date/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByTestId("custom-eol-grid")).toBeNull();
    await userEvent.click(screen.getByRole("tab", { name: /Custom products/ }));
    expect(screen.getByTestId("custom-eol-grid")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Search EOL Data/ })).toBeNull();
  });
});

describe("custom products in bulk linking", () => {
  it("offers a custom candidate by title and links it by key", async () => {
    render(<EolAdmin />);
    await userEvent.click(screen.getByRole("button", { name: /Search EOL Data/ }));
    // The already-linked card shows the key, not the raw link.
    expect(await screen.findByText(/acme-erp 1/)).toBeInTheDocument();
    expect(screen.queryByText(/custom:acme-erp/)).toBeNull();

    // The Tooltip names the chip after the match score, so find it by its text.
    await userEvent.click(screen.getByText("Acme ERP"));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("combobox"));
    await userEvent.click(await screen.findByRole("option", { name: /^2/ }));
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    expect(await screen.findByText(/Acme ERP/, { selector: "strong" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Apply Links/i }));
    await waitFor(() => expect(mockApi.callsOf("post", "/eol/mass-link")).toHaveLength(1));
    expect(mockApi.callsOf("post", "/eol/mass-link")[0].body).toEqual([
      { card_id: "c1", eol_product: "custom:acme-erp", eol_cycle: "2" },
    ]);
  });

  it("names a custom product with no cycles by its title", async () => {
    mockApi.on("get", "/eol/products/custom%3Aacme-erp", []);
    render(<EolAdmin />);
    await userEvent.click(screen.getByRole("button", { name: /Search EOL Data/ }));
    await userEvent.click(await screen.findByText("Acme ERP"));
    expect(await screen.findByText(/No release cycles found for "Acme ERP"/)).toBeInTheDocument();
  });
});
