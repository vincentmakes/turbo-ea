import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import type { EolCustomProduct } from "@/types";
import CustomEolProductDialog, {
  CustomEolCycleDialog,
  EMPTY_CYCLE,
  MilestoneField,
  cyclePayload,
  cycleProblem,
} from "./CustomEolProductDialog";

const SAVED: EolCustomProduct = {
  id: "p1",
  key: "acme-erp",
  product: "custom:acme-erp",
  title: "Acme ERP",
  description: null,
  link: null,
  linked_cards: 0,
  updated_at: null,
  cycles: [],
};

beforeEach(() => mockApi.reset());

async function pick(combobox: HTMLElement, option: string) {
  await userEvent.click(combobox);
  await userEvent.click(await screen.findByRole("option", { name: option }));
}

describe("cycle helpers", () => {
  it("reports the first problem with a cycle", () => {
    expect(cycleProblem(EMPTY_CYCLE)).toBe("eol.custom.errors.cycleRequired");
    expect(cycleProblem({ ...EMPTY_CYCLE, cycle: " 1 " })).toBeNull();
    expect(
      cycleProblem({ ...EMPTY_CYCLE, cycle: "1", releaseDate: "2024-01-02", eol: "2024-01-01" }),
    ).toBe("eol.custom.errors.eolBeforeRelease");
    expect(
      cycleProblem({
        ...EMPTY_CYCLE,
        cycle: "1",
        releaseDate: "2024-01-02",
        support: "2024-01-01",
      }),
    ).toBe("eol.custom.errors.supportBeforeRelease");
    expect(
      cycleProblem({ ...EMPTY_CYCLE, cycle: "1", releaseDate: "2024-01-02", eol: true }),
    ).toBeNull();
    expect(cycleProblem({ ...EMPTY_CYCLE, cycle: "1", eol: "2000-01-01" })).toBeNull();
  });

  it("sends trimmed text and blanks as null", () => {
    expect(
      cyclePayload({ ...EMPTY_CYCLE, cycle: " 2 ", latest: "  ", releaseDate: "", eol: false }),
    ).toEqual({
      cycle: "2",
      releaseDate: null,
      support: null,
      eol: false,
      latest: null,
      latestReleaseDate: null,
    });
  });
});

describe("MilestoneField", () => {
  it.each([
    ["eol", "Already end of life", true],
    ["eol", "No end of life announced", false],
    ["support", "Active support ended", false],
    ["support", "Still supported", true],
  ] as const)("%s: %s stores %s", async (kind, option, stored) => {
    const onChange = vi.fn();
    render(<MilestoneField kind={kind} value={null} onChange={onChange} />);
    await pick(screen.getByRole("combobox"), option);
    expect(onChange).toHaveBeenCalledWith(stored);
  });

  it("shows a date field only in date mode", () => {
    const { rerender } = render(<MilestoneField kind="eol" value={null} onChange={() => {}} />);
    expect(screen.queryByLabelText("Date")).toBeNull();
    rerender(<MilestoneField kind="eol" value="2025-01-01" onChange={() => {}} />);
    expect(screen.getByLabelText("Date")).toBeInTheDocument();
  });
});

describe("CustomEolProductDialog — create", () => {
  it("suggests the key from the name and creates the product with its cycle", async () => {
    mockApi.on("post", "/eol/custom-products", SAVED);
    const onSaved = vi.fn();
    render(
      <CustomEolProductDialog open initialTitle="Acme ERP" onClose={() => {}} onSaved={onSaved} />,
    );
    expect(screen.getByRole("heading", { name: "Create a custom EOL product" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Product name/)).toHaveValue("Acme ERP");
    expect(screen.getByLabelText(/^Key/)).toHaveValue("acme-erp");

    const create = screen.getByRole("button", { name: "Create" });
    // A cycle with no name holds the button back.
    expect(create).toBeDisabled();
    expect(screen.getByText("Every cycle needs a name.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Version \/ Cycle/), "1");
    await userEvent.click(create);

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(SAVED));
    expect(mockApi.callsOf("post")[0].body).toEqual({
      title: "Acme ERP",
      key: "acme-erp",
      link: null,
      description: null,
      cycles: [
        {
          cycle: "1",
          releaseDate: null,
          support: null,
          eol: null,
          latest: null,
          latestReleaseDate: null,
        },
      ],
    });
  });

  it("follows the name until the key is edited by hand", async () => {
    render(<CustomEolProductDialog open onClose={() => {}} onSaved={() => {}} />);
    const name = screen.getByLabelText(/Product name/);
    const key = screen.getByLabelText(/^Key/);
    await userEvent.type(name, "Acme");
    expect(key).toHaveValue("acme");
    await userEvent.clear(key);
    await userEvent.type(key, "mine");
    await userEvent.type(name, " ERP");
    expect(key).toHaveValue("mine");
  });

  it("refuses an invalid key, a bad link and duplicate cycles", async () => {
    render(
      <CustomEolProductDialog open initialTitle="Acme" onClose={() => {}} onSaved={() => {}} />,
    );
    await userEvent.type(screen.getByLabelText(/Version \/ Cycle/), "1");
    const create = screen.getByRole("button", { name: "Create" });
    expect(create).toBeEnabled();

    const key = screen.getByLabelText(/^Key/);
    await userEvent.clear(key);
    await userEvent.type(key, "Bad Key");
    expect(screen.getByText(/Use lower-case letters/)).toBeInTheDocument();
    expect(create).toBeDisabled();
    await userEvent.clear(key);
    await userEvent.type(key, "good");
    expect(create).toBeEnabled();

    await userEvent.type(screen.getByLabelText(/Vendor or release policy link/), "ftp://x");
    expect(screen.getByText(/starting with http/)).toBeInTheDocument();
    expect(create).toBeDisabled();
    await userEvent.clear(screen.getByLabelText(/Vendor or release policy link/));

    await userEvent.click(screen.getByRole("button", { name: /Add another cycle/ }));
    const cycleInputs = screen.getAllByLabelText(/Version \/ Cycle/);
    await userEvent.type(cycleInputs[1], "1");
    expect(screen.getByText("Two cycles have the same name.")).toBeInTheDocument();
    expect(create).toBeDisabled();
    const removes = screen.getAllByRole("button", { name: "Remove cycle" });
    await userEvent.click(removes[1]);
    expect(screen.getAllByLabelText(/Version \/ Cycle/)).toHaveLength(1);
    expect(create).toBeEnabled();
  });

  it("keeps the dialog open with the server's message on failure", async () => {
    mockApi.fail("post", "/eol/custom-products", 409, "taken");
    const onSaved = vi.fn();
    render(
      <CustomEolProductDialog open initialTitle="Acme" onClose={() => {}} onSaved={onSaved} />,
    );
    await userEvent.type(screen.getByLabelText(/Version \/ Cycle/), "1");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("POST /eol/custom-products failed")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Create" })).toBeEnabled();
  });
});

describe("CustomEolProductDialog — edit", () => {
  it("locks the key and patches title, link and description", async () => {
    const product = { ...SAVED, link: "https://acme.example" };
    mockApi.on("patch", "/eol/custom-products/acme-erp", { ...product, title: "Acme Suite" });
    const onSaved = vi.fn();
    render(
      <CustomEolProductDialog open product={product} onClose={() => {}} onSaved={onSaved} />,
    );
    expect(screen.getByRole("heading", { name: "Edit custom EOL product" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Key/)).toBeDisabled();
    expect(screen.queryByText("Release cycles")).toBeNull();
    const name = screen.getByLabelText(/Product name/);
    await userEvent.clear(name);
    await userEvent.type(name, "Acme Suite");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockApi.callsOf("patch")[0].body).toEqual({
      title: "Acme Suite",
      link: "https://acme.example",
      description: null,
    });
  });
});

describe("CustomEolCycleDialog", () => {
  it("adds a cycle to the product", async () => {
    const created = {
      id: "c9",
      cycle: "3",
      releaseDate: null,
      support: null,
      eol: true,
      latest: null,
      latestReleaseDate: null,
      sort_order: 0,
      linked_cards: 0,
      updated_at: null,
    };
    mockApi.on("post", "/eol/custom-products/acme-erp/cycles", created);
    const onSaved = vi.fn();
    render(
      <CustomEolCycleDialog
        open
        productKey="acme-erp"
        productLabel="Acme ERP"
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Add a cycle to Acme ERP")).toBeInTheDocument();
    const add = within(dialog).getByRole("button", { name: "Add cycle" });
    expect(add).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Version \/ Cycle/), "3");
    await pick(within(dialog).getAllByRole("combobox")[1], "Already end of life");
    await userEvent.click(add);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created));
    expect(mockApi.callsOf("post")[0].body).toMatchObject({ cycle: "3", eol: true });
  });
});
