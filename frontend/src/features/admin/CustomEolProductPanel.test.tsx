import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
vi.mock("@/hooks/useAiStatus", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useAiStatus")>("@/hooks/useAiStatus");
  return {
    ...actual,
    useAiStatus: () => ({
      aiStatus: { enabled: false, configured: false, enabled_types: [], running_models: [] },
      aiStatusLoaded: true,
    }),
  };
});

import { mockApi } from "@/test/apiMock";
import { hookState } from "@/test/hooks";
import { EOL_STATUS_COLORS } from "@/lib/eol";
import type { EolCustomCycle, EolCustomProduct } from "@/types";
import CustomEolProductPanel, { type CustomEolProductPanelProps } from "./CustomEolProductPanel";

const C1: EolCustomCycle = {
  id: "c1",
  cycle: "1",
  releaseDate: "2020-01-01",
  support: false,
  eol: true,
  latest: "1.9",
  latestReleaseDate: null,
  sort_order: 0,
  linked_cards: 2,
  updated_at: null,
};
const C2: EolCustomCycle = {
  id: "c2",
  cycle: "2",
  releaseDate: "2024-03-01",
  support: "2099-01-01",
  eol: "2099-06-30",
  latest: null,
  latestReleaseDate: null,
  sort_order: 1,
  linked_cards: 0,
  updated_at: null,
};
/** Saved before End of life was required. */
const LEGACY: EolCustomCycle = {
  ...C2,
  id: "c3",
  cycle: "3",
  releaseDate: null,
  support: true,
  eol: null,
  linked_cards: 1,
  sort_order: 2,
};

const PRODUCT: EolCustomProduct = {
  id: "p1",
  key: "acme-erp",
  product: "custom:acme-erp",
  title: "Acme ERP",
  description: "is an ERP.",
  link: "https://acme.example",
  eol_category: null,
  release_policy_note: null,
  linked_cards: 3,
  updated_at: null,
  cycles: [C1, C2, LEGACY],
};
const UNUSED: EolCustomProduct = { ...PRODUCT, linked_cards: 0, cycles: [C2] };

function renderPanel(overrides: Partial<CustomEolProductPanelProps> = {}) {
  const props: CustomEolProductPanelProps = {
    product: PRODUCT,
    canManage: true,
    onClose: vi.fn(),
    onChanged: vi.fn(),
    onRequestSwitch: vi.fn(),
    onDeleted: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
  const view = render(<CustomEolProductPanel {...props} />);
  return { ...props, ...view };
}

const row = (id: string) => screen.getByTestId(`eol-cycle-${id}`);
const editor = () => screen.getByTestId("eol-cycle-editor");

async function pick(combobox: HTMLElement, option: string) {
  await userEvent.click(combobox);
  await userEvent.click(await screen.findByRole("option", { name: option }));
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  // A format other than the stored ISO dates proves dates go through the hook.
  hookState.dateFormat = "DD/MM/YYYY";
});

describe("CustomEolProductPanel — frame", () => {
  it("renders nothing without a product", () => {
    renderPanel({ product: null });
    expect(screen.queryByRole("presentation")).toBeNull();
    expect(screen.queryByText("Acme ERP")).toBeNull();
  });

  it("shows the title, the Custom chip and the two tabs", () => {
    renderPanel();
    expect(screen.getByRole("heading", { name: "Acme ERP" })).toBeInTheDocument();
    expect(screen.getByText("Custom")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Contribute to endoflife.date" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.queryByText("On endoflife.date")).toBeNull();
    expect(screen.queryByText(/You can view this product/)).toBeNull();
  });

  it("offers the switch from the upstream chip to a manager", async () => {
    const { onRequestSwitch } = renderPanel({ upstreamMatch: { name: "postgresql", score: 0.9 } });
    const chip = screen.getByRole("button", { name: /On endoflife.date/ });
    await userEvent.hover(chip);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      'endoflife.date now tracks a product called "postgresql". Switch',
    );
    await userEvent.click(chip);
    expect(onRequestSwitch).toHaveBeenCalledWith("postgresql");
  });

  it("shows a reader the upstream chip without the switch", async () => {
    const { onRequestSwitch } = renderPanel({
      canManage: false,
      upstreamMatch: { name: "postgresql", score: 0.9 },
    });
    expect(screen.queryByRole("button", { name: /On endoflife.date/ })).toBeNull();
    const chip = screen.getByText("On endoflife.date");
    await userEvent.hover(chip);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("An EOL manager can switch");
    await userEvent.click(chip);
    expect(onRequestSwitch).not.toHaveBeenCalled();
  });

  it("closes from the close button and on Escape", async () => {
    const { onClose } = renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("switches to the Contribute tab", async () => {
    renderPanel();
    await userEvent.click(screen.getByRole("tab", { name: "Contribute to endoflife.date" }));
    expect(screen.getByRole("tab", { name: "Contribute to endoflife.date" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("button", { name: /Copy file/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add cycle/ })).toBeNull();
  });
});

describe("CustomEolProductPanel — reader", () => {
  it("is read-only: disabled fields, no Save / Add / Edit / Delete, Contribute reachable", async () => {
    renderPanel({ canManage: false });
    expect(screen.getByText(/You can view this product/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Product name" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Add cycle/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Edit cycle/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete cycle/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete product/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Switch to endoflife.date/ })).toBeNull();
    await userEvent.click(screen.getByRole("tab", { name: "Contribute to endoflife.date" }));
    expect(screen.getByRole("button", { name: /Copy file/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});

describe("CustomEolProductPanel — product fields", () => {
  it("saves the product fields and reports the change", async () => {
    mockApi.on("patch", "/eol/custom-products/acme-erp", {});
    const { onChanged } = renderPanel();
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    const title = screen.getByRole("textbox", { name: "Product name" });
    await userEvent.clear(title);
    expect(save).toBeDisabled(); // a title is required
    await userEvent.type(title, " Acme ERP Cloud ");
    await userEvent.clear(screen.getByRole("textbox", { name: "Vendor or release policy link" }));
    await userEvent.click(save);
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(mockApi.callsOf("patch")).toEqual([
      {
        method: "patch",
        path: "/eol/custom-products/acme-erp",
        body: { title: "Acme ERP Cloud", link: null, description: "is an ERP." },
      },
    ]);
  });

  it("encodes the key in the path", async () => {
    mockApi.on("patch", "/eol/custom-products/a%2Fb", {});
    renderPanel({ product: { ...PRODUCT, key: "a/b" } });
    await userEvent.type(screen.getByRole("textbox", { name: "Product name" }), "!");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockApi.callsOf("patch")).toHaveLength(1));
    expect(mockApi.callsOf("patch")[0].path).toBe("/eol/custom-products/a%2Fb");
  });

  it("keeps a failed save inline", async () => {
    mockApi.fail("patch", "/eol/custom-products/acme-erp", 409, "taken");
    const { onChanged, onError } = renderPanel();
    await userEvent.type(screen.getByRole("textbox", { name: "Product name" }), "!");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("PATCH /eol/custom-products/acme-erp failed")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("Cancel puts the saved values back", async () => {
    renderPanel();
    const title = screen.getByRole("textbox", { name: "Product name" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel).toBeDisabled();
    await userEvent.type(title, " draft");
    expect(title).toHaveValue("Acme ERP draft");
    await userEvent.click(cancel);
    expect(title).toHaveValue("Acme ERP");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("keeps a draft across a reload of the product", async () => {
    const view = renderPanel();
    await userEvent.type(screen.getByRole("textbox", { name: "Product name" }), " draft");
    view.rerender(
      <CustomEolProductPanel
        {...view}
        product={{ ...PRODUCT, linked_cards: 0 }}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Product name" })).toHaveValue("Acme ERP draft");
  });
});

describe("CustomEolProductPanel — cycles", () => {
  it("lists the cycles with status, dates, versions and linked cards", () => {
    renderPanel();
    expect(screen.getByText("Release cycles")).toBeInTheDocument();
    const ids = screen.getAllByTestId(/^eol-cycle-c/).map((el) => el.dataset.testid);
    expect(ids).toEqual(["eol-cycle-c1", "eol-cycle-c2", "eol-cycle-c3"]);

    const ended = within(row("c1"));
    expect(ended.getByText("1")).toBeInTheDocument();
    expect(ended.getByText("End of Life").closest(".MuiChip-root")).toHaveStyle({
      backgroundColor: EOL_STATUS_COLORS.eol,
    });
    expect(
      within(row("c2")).getByText("Supported").closest(".MuiChip-root"),
    ).toHaveStyle({ backgroundColor: EOL_STATUS_COLORS.supported });
    expect(row("c1")).toHaveTextContent("Release date: 01/01/2020");
    expect(row("c1")).toHaveTextContent("Latest version: 1.9");
    expect(row("c1")).toHaveTextContent("Active support: Support already ended");
    expect(row("c1")).toHaveTextContent("End of life: Already ended");
    expect(row("c1")).toHaveTextContent("2 linked cards");

    expect(within(row("c2")).getByText("Supported")).toBeInTheDocument();
    expect(row("c2")).toHaveTextContent("Release date: 01/03/2024");
    expect(row("c2")).toHaveTextContent("Active support: 01/01/2099");
    expect(row("c2")).toHaveTextContent("End of life: 30/06/2099");
    expect(row("c2")).toHaveTextContent("Latest version: —");
    expect(row("c2")).toHaveTextContent("0 linked cards");
    expect(row("c2")).not.toHaveTextContent("no end-of-life value");

    expect(within(row("c3")).getByText("Unknown", { selector: ".MuiChip-label" })).toBeInTheDocument();
    expect(row("c3")).toHaveTextContent("Release date: —");
    expect(row("c3")).toHaveTextContent("Active support: Still supported");
    expect(row("c3")).toHaveTextContent("End of life: Unknown");
    expect(row("c3")).toHaveTextContent("1 linked card");
    expect(within(row("c3")).getByRole("alert")).toHaveTextContent(
      "This cycle has no end-of-life value",
    );
  });

  it("says when there is no cycle yet", () => {
    renderPanel({ product: { ...PRODUCT, cycles: [] } });
    expect(screen.getByText("No cycle yet")).toHaveStyle({ fontStyle: "italic" });
  });

  it("edits a cycle and sends the whole cycle", async () => {
    mockApi.on("patch", "/eol/custom-products/acme-erp/cycles/c2", {});
    const { onChanged } = renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Edit cycle 2" }));
    const ed = within(editor());
    expect(ed.getByRole("textbox", { name: /Release cycle/ })).toHaveValue("2");
    await userEvent.type(ed.getByRole("textbox", { name: "Latest version" }), " 2.5 ");
    await userEvent.click(ed.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(mockApi.callsOf("patch")).toEqual([
      {
        method: "patch",
        path: "/eol/custom-products/acme-erp/cycles/c2",
        body: {
          cycle: "2",
          releaseDate: "2024-03-01",
          support: "2099-01-01",
          eol: "2099-06-30",
          latest: "2.5",
          latestReleaseDate: null,
        },
      },
    ]);
    expect(screen.queryByTestId("eol-cycle-editor")).toBeNull();
    expect(row("c2")).toBeInTheDocument();
  });

  it("keeps a refused cycle edit inline", async () => {
    mockApi.fail("patch", "/eol/custom-products/acme-erp/cycles/c2", 422, "bad");
    const { onChanged, onError } = renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Edit cycle 2" }));
    await userEvent.click(within(editor()).getByRole("button", { name: "Save" }));
    expect(
      await within(editor()).findByText("PATCH /eol/custom-products/acme-erp/cycles/c2 failed"),
    ).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(within(editor()).getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("cancels a cycle edit", async () => {
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Edit cycle 2" }));
    await userEvent.click(within(editor()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("eol-cycle-editor")).toBeNull();
    expect(row("c2")).toBeInTheDocument();
    expect(mockApi.callsOf("patch")).toHaveLength(0);
  });

  it("asks for an end of life when a legacy cycle is edited", async () => {
    mockApi.on("patch", "/eol/custom-products/acme-erp/cycles/c3", {});
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Edit cycle 3" }));
    const ed = within(editor());
    expect(ed.getByText(/Choose an end of life/)).toBeInTheDocument();
    expect(ed.getByRole("button", { name: "Save" })).toBeDisabled();
    await pick(ed.getByRole("combobox", { name: "End of life" }), "Already ended");
    await userEvent.click(ed.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockApi.callsOf("patch")).toHaveLength(1));
    expect(mockApi.callsOf("patch")[0].body).toMatchObject({ cycle: "3", eol: true, support: true });
  });

  it("adds a cycle once an end of life is chosen", async () => {
    mockApi.on("post", "/eol/custom-products/acme-erp/cycles", {});
    const { onChanged } = renderPanel();
    await userEvent.click(screen.getByRole("button", { name: /Add cycle/ }));
    expect(screen.queryByRole("button", { name: /Add cycle/ })).toBeNull();
    const ed = within(editor());
    const save = ed.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await userEvent.type(ed.getByRole("textbox", { name: /Release cycle/ }), " 4 ");
    expect(save).toBeDisabled();
    await pick(ed.getByRole("combobox", { name: "End of life" }), "No end of life announced");
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(mockApi.callsOf("post")).toEqual([
      {
        method: "post",
        path: "/eol/custom-products/acme-erp/cycles",
        body: {
          cycle: "4",
          releaseDate: null,
          support: null,
          eol: false,
          latest: null,
          latestReleaseDate: null,
        },
      },
    ]);
    expect(screen.queryByTestId("eol-cycle-editor")).toBeNull();
    expect(screen.getByRole("button", { name: /Add cycle/ })).toBeInTheDocument();
  });

  it("keeps a refused new cycle inline and can cancel it", async () => {
    mockApi.fail("post", "/eol/custom-products/acme-erp/cycles", 409, "dup");
    const { onChanged } = renderPanel({ product: { ...PRODUCT, cycles: [] } });
    expect(screen.getByText("No cycle yet")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Add cycle/ }));
    expect(screen.queryByText("No cycle yet")).toBeNull();
    const ed = within(editor());
    await userEvent.type(ed.getByRole("textbox", { name: /Release cycle/ }), "1");
    await pick(ed.getByRole("combobox", { name: "End of life" }), "Already ended");
    await userEvent.click(ed.getByRole("button", { name: "Save" }));
    expect(
      await ed.findByText("POST /eol/custom-products/acme-erp/cycles failed"),
    ).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
    await userEvent.click(ed.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("eol-cycle-editor")).toBeNull();
  });

  it("blocks deleting a linked cycle and says why", async () => {
    renderPanel();
    const del = screen.getByRole("button", { name: "Delete cycle 1" });
    expect(del).toBeDisabled();
    await userEvent.hover(del.parentElement!);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "2 cards still link this cycle, so it cannot be deleted.",
    );
  });

  it("deletes an unlinked cycle after confirmation", async () => {
    mockApi.on("delete", "/eol/custom-products/acme-erp/cycles/c2", {});
    const { onChanged, onError } = renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Delete cycle 2" }));
    const dialog = screen.getByRole("dialog", { name: "Delete cycle 2?" });
    expect(dialog).toHaveTextContent("The cycle will be deleted.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(mockApi.callsOf("delete").map((c) => c.path)).toEqual([
      "/eol/custom-products/acme-erp/cycles/c2",
    ]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("does not delete when the confirmation is cancelled", async () => {
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Delete cycle 2" }));
    const dialog = screen.getByRole("dialog", { name: "Delete cycle 2?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Delete cycle 2?" })).toBeNull());
    expect(mockApi.callsOf("delete")).toHaveLength(0);
  });

  it("maps a refused cycle delete to the linked-cards message", async () => {
    mockApi.fail("delete", "/eol/custom-products/acme-erp/cycles/c2", 409, {
      code: "cards_linked",
      count: 3,
    });
    const { onError, onChanged } = renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Delete cycle 2" }));
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "Delete cycle 2?" })).getByRole("button", {
        name: "Delete",
      }),
    );
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        "Cards still link this cycle (3 that you can see). Rename the cycle, or link them to another cycle, first.",
      ),
    );
    // The counts on screen were stale: the grid reloads.
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("passes any other delete failure through", async () => {
    mockApi.fail("delete", "/eol/custom-products/acme-erp/cycles/c2", 500, "boom");
    const { onError } = renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Delete cycle 2" }));
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "Delete cycle 2?" })).getByRole("button", {
        name: "Delete",
      }),
    );
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith("DELETE /eol/custom-products/acme-erp/cycles/c2 failed"),
    );
  });
});

describe("CustomEolProductPanel — footer", () => {
  it("asks the grid to switch, with the upstream match when there is one", async () => {
    const first = renderPanel();
    await userEvent.click(screen.getByRole("button", { name: /Switch to endoflife.date product/ }));
    expect(first.onRequestSwitch).toHaveBeenCalledWith(null);
    first.unmount();

    const second = renderPanel({ upstreamMatch: { name: "postgresql", score: 0.8 } });
    await userEvent.click(screen.getByRole("button", { name: /Switch to endoflife.date product/ }));
    expect(second.onRequestSwitch).toHaveBeenCalledWith("postgresql");
  });

  it("blocks deleting a linked product and says why", async () => {
    renderPanel();
    const del = screen.getByRole("button", { name: /Delete product/ });
    expect(del).toBeDisabled();
    await userEvent.hover(del.parentElement!);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "3 cards still link this product, so it cannot be deleted.",
    );
  });

  it("deletes an unlinked product after confirmation", async () => {
    mockApi.on("delete", "/eol/custom-products/acme-erp", {});
    const { onDeleted, onError } = renderPanel({ product: UNUSED });
    await userEvent.click(screen.getByRole("button", { name: /Delete product/ }));
    const dialog = screen.getByRole("dialog", { name: "Delete Acme ERP?" });
    expect(dialog).toHaveTextContent("The product and all its cycles will be deleted.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(mockApi.callsOf("delete").map((c) => c.path)).toEqual(["/eol/custom-products/acme-erp"]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("does not delete the product when the confirmation is cancelled", async () => {
    const { onDeleted } = renderPanel({ product: UNUSED });
    await userEvent.click(screen.getByRole("button", { name: /Delete product/ }));
    const dialog = screen.getByRole("dialog", { name: "Delete Acme ERP?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Delete Acme ERP?" })).toBeNull());
    expect(mockApi.callsOf("delete")).toHaveLength(0);
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("maps a refused product delete to the linked-cards message", async () => {
    mockApi.fail("delete", "/eol/custom-products/acme-erp", 409, { code: "cards_linked", count: 1 });
    const { onDeleted, onError, onChanged } = renderPanel({ product: UNUSED });
    await userEvent.click(screen.getByRole("button", { name: /Delete product/ }));
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "Delete Acme ERP?" })).getByRole("button", {
        name: "Delete",
      }),
    );
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        "1 card still links this product. Unlink it, or switch the product to endoflife.date, first.",
      ),
    );
    expect(onDeleted).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});
