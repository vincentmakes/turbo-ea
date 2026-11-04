import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import type { EolCustomProduct, EolMilestone } from "@/types";
import CustomEolProductDialog, {
  CustomEolCycleDialog,
  CycleFields,
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

describe("cycle helpers — boundaries", () => {
  const dated = { ...EMPTY_CYCLE, cycle: "1", releaseDate: "2024-01-02" };

  it("allows an end on the release day or after it", () => {
    expect(cycleProblem({ ...dated, eol: "2024-01-02" })).toBeNull();
    expect(cycleProblem({ ...dated, eol: "2025-01-01" })).toBeNull();
    expect(cycleProblem({ ...dated, support: "2024-01-02" })).toBeNull();
    expect(cycleProblem({ ...dated, support: "2025-01-01" })).toBeNull();
    expect(cycleProblem({ ...dated, support: true, eol: false })).toBeNull();
  });

  it("counts a blank name as no name", () => {
    expect(cycleProblem({ ...EMPTY_CYCLE, cycle: "   " })).toBe("eol.custom.errors.cycleRequired");
  });

  it("keeps a latest release date", () => {
    expect(
      cyclePayload({ ...EMPTY_CYCLE, cycle: "1", latest: " 1.2 ", latestReleaseDate: "2024-05-05" }),
    ).toMatchObject({ latest: "1.2", latestReleaseDate: "2024-05-05" });
  });
});

describe("MilestoneField — labels and dates", () => {
  it("is labelled after its kind", () => {
    const { unmount } = render(<MilestoneField kind="eol" value={null} onChange={() => {}} />);
    expect(screen.getByLabelText("End of Life")).toBeInTheDocument();
    expect(screen.queryByLabelText("Active Support")).toBeNull();
    unmount();
    render(<MilestoneField kind="support" value={null} onChange={() => {}} />);
    expect(screen.getByLabelText("Active Support")).toBeInTheDocument();
    expect(screen.queryByLabelText("End of Life")).toBeNull();
  });

  it("switching from a yes/no answer to a date starts with no date", async () => {
    const onChange = vi.fn();
    render(<MilestoneField kind="eol" value={true} onChange={onChange} />);
    await pick(screen.getByRole("combobox"), "Date");
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("passes a picked date on, and a cleared one as null", () => {
    const onChange = vi.fn();
    render(<MilestoneField kind="support" value="2025-01-01" onChange={onChange} />);
    const date = screen.getByLabelText("Date");
    expect(date).toHaveValue("2025-01-01");
    fireEvent.change(date, { target: { value: "2026-02-03" } });
    expect(onChange).toHaveBeenLastCalledWith("2026-02-03");
    fireEvent.change(date, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});

describe("MilestoneField — choosing Date (regression: the date field never appeared)", () => {
  function Stateful({ initial }: { initial: EolMilestone }) {
    const [value, setValue] = useState<EolMilestone>(initial);
    return (
      <>
        <MilestoneField kind="eol" value={value} onChange={setValue} />
        <output>{JSON.stringify(value)}</output>
      </>
    );
  }

  it.each([
    ["not set", null],
    ["a yes/no answer", false],
  ] as const)("from %s shows the date field and stores the date picked", async (_, initial) => {
    render(<Stateful initial={initial} />);
    await pick(screen.getByRole("combobox"), "Date");
    const date = screen.getByLabelText("Date");
    expect(screen.getByRole("combobox")).toHaveTextContent("Date");
    fireEvent.change(date, { target: { value: "2027-03-01" } });
    expect(screen.getByRole("status")).toHaveTextContent('"2027-03-01"');
    // Clearing the date keeps the field open for another one.
    fireEvent.change(date, { target: { value: "" } });
    expect(screen.getByRole("status")).toHaveTextContent("null");
    expect(screen.getByLabelText("Date")).toBeInTheDocument();
  });

  it("drops a pending date when a yes/no answer arrives from outside", async () => {
    function Controlled() {
      const [value, setValue] = useState<EolMilestone>(null);
      return (
        <>
          <MilestoneField kind="eol" value={value} onChange={setValue} />
          <button onClick={() => setValue(true)}>set ended</button>
          <button onClick={() => setValue(null)}>unset</button>
        </>
      );
    }
    render(<Controlled />);
    await pick(screen.getByRole("combobox"), "Date");
    expect(screen.getByLabelText("Date")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "set ended" }));
    await userEvent.click(screen.getByRole("button", { name: "unset" }));
    expect(screen.queryByLabelText("Date")).toBeNull();
    expect(screen.getByRole("combobox")).toHaveTextContent("Not set");
  });

  it("opens in date mode on a stored date, and stays there when it is cleared", () => {
    render(<Stateful initial="2026-01-01" />);
    const date = screen.getByLabelText("Date");
    fireEvent.change(date, { target: { value: "" } });
    expect(screen.getByLabelText("Date")).toBeInTheDocument();
  });

  it("drops the pending date once another answer is chosen", async () => {
    render(<Stateful initial={null} />);
    await pick(screen.getByRole("combobox"), "Date");
    await pick(screen.getByRole("combobox"), "Not set");
    expect(screen.queryByLabelText("Date")).toBeNull();
    await pick(screen.getByRole("combobox"), "Date");
    await pick(screen.getByRole("combobox"), "Already end of life");
    expect(screen.queryByLabelText("Date")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("true");
  });
});

describe("CycleFields", () => {
  const FULL = {
    cycle: "1",
    releaseDate: "2024-01-01",
    support: "2025-01-01",
    eol: "2026-01-01",
    latest: "1.4",
    latestReleaseDate: "2024-06-01",
  };

  it("shows every value it is given", () => {
    render(<CycleFields value={FULL} onChange={() => {}} />);
    expect(screen.getByLabelText(/Version \/ Cycle/)).toHaveValue("1");
    expect(screen.getByLabelText("Release Date")).toHaveValue("2024-01-01");
    expect(screen.getByLabelText("Latest Version")).toHaveValue("1.4");
    expect(screen.getByLabelText("Latest Release")).toHaveValue("2024-06-01");
    expect(screen.getAllByLabelText("Date").map((d) => (d as HTMLInputElement).value)).toEqual([
      "2025-01-01",
      "2026-01-01",
    ]);
  });

  it("shows empty fields for missing values", () => {
    render(<CycleFields value={EMPTY_CYCLE} onChange={() => {}} />);
    expect(screen.getByLabelText("Release Date")).toHaveValue("");
    expect(screen.getByLabelText("Latest Version")).toHaveValue("");
    expect(screen.getByLabelText("Latest Release")).toHaveValue("");
  });

  it("reports each field's change, a cleared date as null", async () => {
    const onChange = vi.fn();
    render(<CycleFields value={FULL} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Release Date"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...FULL, releaseDate: null });
    fireEvent.change(screen.getByLabelText("Release Date"), { target: { value: "2023-03-03" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...FULL, releaseDate: "2023-03-03" });
    fireEvent.change(screen.getByLabelText("Latest Release"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...FULL, latestReleaseDate: null });
    fireEvent.change(screen.getByLabelText("Latest Release"), { target: { value: "2024-07-07" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...FULL, latestReleaseDate: "2024-07-07" });
    fireEvent.change(screen.getByLabelText("Latest Version"), { target: { value: "1.5" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...FULL, latest: "1.5" });
    await pick(screen.getAllByRole("combobox")[0], "Still supported");
    expect(onChange).toHaveBeenLastCalledWith({ ...FULL, support: true });
    await pick(screen.getAllByRole("combobox")[1], "Already end of life");
    expect(onChange).toHaveBeenLastCalledWith({ ...FULL, eol: true });
  });
});

describe("CustomEolProductDialog — details", () => {
  const cycleInputs = () => screen.getAllByLabelText(/Version \/ Cycle/) as HTMLInputElement[];

  it("introduces the create form, explains the key and cancels", async () => {
    const onClose = vi.fn();
    render(<CustomEolProductDialog open initialTitle="  Acme  " onClose={onClose} onSaved={() => {}} />);
    expect(screen.getByLabelText(/Product name/)).toHaveValue("Acme");
    expect(screen.getByText(/For a product endoflife.date does not track/)).toBeInTheDocument();
    expect(screen.getByText("Release cycles")).toBeInTheDocument();
    expect(screen.getByText(/Identifies the product in card links/)).toBeInTheDocument();
    // A valid draft shows no warning.
    await userEvent.type(cycleInputs()[0], "1");
    expect(screen.queryByRole("alert")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("explains the locked key and drops the intro when editing", () => {
    render(<CustomEolProductDialog open product={SAVED} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByText("The key cannot be changed: cards store it.")).toBeInTheDocument();
    expect(screen.queryByText(/For a product endoflife.date does not track/)).toBeNull();
  });

  it("does not call an empty key invalid, but cannot create without one", async () => {
    render(<CustomEolProductDialog open initialTitle="Acme" onClose={() => {}} onSaved={() => {}} />);
    await userEvent.type(cycleInputs()[0], "1");
    await userEvent.clear(screen.getByLabelText(/^Key/));
    expect(screen.queryByText(/Use lower-case letters/)).toBeNull();
    expect(screen.getByText(/Identifies the product in card links/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("needs a name that is more than spaces, and ignores a blank link", async () => {
    render(<CustomEolProductDialog open initialTitle="Acme" onClose={() => {}} onSaved={() => {}} />);
    await userEvent.type(cycleInputs()[0], "1");
    await userEvent.type(screen.getByLabelText(/Vendor or release policy link/), "   ");
    expect(screen.queryByText(/starting with http/)).toBeNull();
    const create = screen.getByRole("button", { name: "Create" });
    expect(create).toBeEnabled();
    const name = screen.getByLabelText(/Product name/);
    await userEvent.clear(name);
    await userEvent.type(name, "   ");
    expect(create).toBeDisabled();
  });

  it("names the missing cycle rather than calling two blank ones duplicates", async () => {
    render(<CustomEolProductDialog open initialTitle="Acme" onClose={() => {}} onSaved={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /Add another cycle/ }));
    expect(screen.getByText("Every cycle needs a name.")).toBeInTheDocument();
    expect(screen.queryByText("Two cycles have the same name.")).toBeNull();
    // Names are compared trimmed.
    await userEvent.type(cycleInputs()[0], " 1");
    await userEvent.type(cycleInputs()[1], "1 ");
    expect(screen.getByText("Two cycles have the same name.")).toBeInTheDocument();
  });

  it("keeps each row's own choices when another row is removed", async () => {
    render(<CustomEolProductDialog open initialTitle="Acme" onClose={() => {}} onSaved={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /Add another cycle/ }));
    // Row 1's End of Life select is the fourth combobox (support, eol per row).
    await pick(screen.getAllByRole("combobox")[1], "Date");
    expect(screen.getAllByLabelText("Date")).toHaveLength(1);
    await userEvent.click(screen.getAllByRole("button", { name: "Remove cycle" })[0]);
    expect(screen.queryByLabelText("Date")).toBeNull();
    expect(screen.getAllByRole("combobox")[1]).toHaveTextContent("Not set");
  });

  it("edits only the cycle typed in, and removes the one asked for", async () => {
    render(<CustomEolProductDialog open initialTitle="Acme" onClose={() => {}} onSaved={() => {}} />);
    const removes = () => screen.getAllByRole("button", { name: "Remove cycle" });
    expect(removes()[0]).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /Add another cycle/ }));
    await userEvent.type(cycleInputs()[0], "a");
    await userEvent.type(cycleInputs()[1], "b");
    expect(cycleInputs().map((i) => i.value)).toEqual(["a", "b"]);
    expect(removes()[0]).toBeEnabled();
    await userEvent.click(removes()[0]);
    expect(cycleInputs().map((i) => i.value)).toEqual(["b"]);
  });

  it("sends trimmed text, holds the button while saving, and clears the last error", async () => {
    let release: (v: EolCustomProduct) => void = () => {};
    mockApi.fail("post", "/eol/custom-products", 409, "taken");
    render(<CustomEolProductDialog open initialTitle=" Acme " onClose={() => {}} onSaved={() => {}} />);
    await userEvent.type(cycleInputs()[0], "1");
    await userEvent.type(screen.getByLabelText(/Vendor or release policy link/), " https://acme.example ");
    await userEvent.type(screen.getByLabelText(/Description/), " Our ERP ");
    const create = screen.getByRole("button", { name: "Create" });
    await userEvent.click(create);
    expect(await screen.findByText("POST /eol/custom-products failed")).toBeInTheDocument();

    mockApi.on("post", "/eol/custom-products", () => new Promise<EolCustomProduct>((r) => (release = r)));
    await userEvent.click(create);
    // The old error goes as the new attempt starts, and the button waits.
    await waitFor(() => expect(screen.queryByText("POST /eol/custom-products failed")).toBeNull());
    expect(create).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    release(SAVED);
    expect(mockApi.callsOf("post").at(-1)!.body).toMatchObject({
      title: "Acme",
      link: "https://acme.example",
      description: "Our ERP",
    });
  });

  it("lets a save error be dismissed", async () => {
    mockApi.fail("post", "/eol/custom-products", 409, "taken");
    render(<CustomEolProductDialog open initialTitle="Acme" onClose={() => {}} onSaved={() => {}} />);
    await userEvent.type(cycleInputs()[0], "1");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    const alert = await screen.findByText("POST /eol/custom-products failed");
    await userEvent.click(within(alert.closest("[role=alert]") as HTMLElement).getByRole("button"));
    expect(screen.queryByText("POST /eol/custom-products failed")).toBeNull();
  });
});

describe("CustomEolCycleDialog — details", () => {
  function renderCycleDialog(onClose = vi.fn()) {
    render(
      <CustomEolCycleDialog open productKey="acme erp" productLabel="Acme ERP" onClose={onClose} onSaved={() => {}} />,
    );
    return within(screen.getByRole("dialog"));
  }

  it("warns about an end before the release only once the cycle has a name", async () => {
    const dialog = renderCycleDialog();
    expect(dialog.queryByRole("alert")).toBeNull();
    fireEvent.change(dialog.getByLabelText("Release Date"), { target: { value: "2024-01-02" } });
    await pick(dialog.getAllByRole("combobox")[1], "Date");
    fireEvent.change(dialog.getAllByLabelText("Date").at(-1)!, { target: { value: "2024-01-01" } });
    expect(dialog.queryByRole("alert")).toBeNull();
    await userEvent.type(dialog.getByLabelText(/Version \/ Cycle/), "1");
    expect(dialog.getByRole("alert")).toHaveTextContent(
      "The end of life cannot be before the release date.",
    );
    expect(dialog.getByRole("button", { name: "Add cycle" })).toBeDisabled();
  });

  it("shows the server's error, keeps the dialog usable, and lets the error go", async () => {
    mockApi.fail("post", "/eol/custom-products/acme%20erp/cycles", 422, "bad");
    const onClose = vi.fn();
    const dialog = renderCycleDialog(onClose);
    await userEvent.type(dialog.getByLabelText(/Version \/ Cycle/), "3");
    const add = dialog.getByRole("button", { name: "Add cycle" });
    await userEvent.click(add);
    const alert = await dialog.findByRole("alert");
    expect(alert).toHaveTextContent("POST /eol/custom-products/acme%20erp/cycles failed");
    expect(add).toBeEnabled();
    await userEvent.click(within(alert).getByRole("button"));
    expect(dialog.queryByRole("alert")).toBeNull();
    await userEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("holds both buttons while saving and clears the last error", async () => {
    mockApi.fail("post", "/eol/custom-products/acme%20erp/cycles", 422, "bad");
    const dialog = renderCycleDialog();
    await userEvent.type(dialog.getByLabelText(/Version \/ Cycle/), "3");
    const add = dialog.getByRole("button", { name: "Add cycle" });
    await userEvent.click(add);
    await dialog.findByRole("alert");
    mockApi.on("post", "/eol/custom-products/acme%20erp/cycles", () => new Promise(() => {}));
    await userEvent.click(add);
    await waitFor(() => expect(dialog.queryByRole("alert")).toBeNull());
    expect(add).toBeDisabled();
    expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});
