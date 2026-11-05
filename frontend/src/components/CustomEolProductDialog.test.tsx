import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
const ai = vi.hoisted(() => ({
  status: { enabled: false, configured: false, enabled_types: [] as string[], running_models: [] },
}));
vi.mock("@/hooks/useAiStatus", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useAiStatus")>("@/hooks/useAiStatus");
  return { ...actual, useAiStatus: () => ({ aiStatus: ai.status, aiStatusLoaded: true }) };
});

import { mockApi } from "@/test/apiMock";
import type { EolCustomProduct, EolMilestone } from "@/types";
import CustomEolProductDialog, {
  CustomEolCycleDialog,
  CycleFields,
  EMPTY_CYCLE,
  MilestoneField,
  ProductFields,
  cycleIssues,
  cyclePayload,
  cycleProblem,
  productDraftIssues,
  productPayload,
} from "./CustomEolProductDialog";

const SAVED: EolCustomProduct = {
  id: "p1",
  key: "acme-erp",
  product: "custom:acme-erp",
  title: "Acme ERP",
  description: null,
  link: null,
  eol_category: null,
  release_policy_note: null,
  linked_cards: 0,
  updated_at: null,
  cycles: [],
};

/** A cycle with the end of life endoflife.date requires already answered. */
const ONGOING = { ...EMPTY_CYCLE, eol: false };

beforeEach(() => {
  mockApi.reset();
  ai.status = { enabled: false, configured: false, enabled_types: [], running_models: [] };
});

async function pick(combobox: HTMLElement, option: string) {
  await userEvent.click(combobox);
  await userEvent.click(await screen.findByRole("option", { name: option }));
}

const cycleInputs = () => screen.getAllByLabelText(/Release cycle/) as HTMLInputElement[];

describe("cycle helpers", () => {
  it("reports the first problem with a cycle", () => {
    expect(cycleProblem(EMPTY_CYCLE)).toBe("eol.custom.errors.cycleRequired");
    // endoflife.date requires an end of life on every release.
    expect(cycleProblem({ ...EMPTY_CYCLE, cycle: " 1 " })).toBe("eol.custom.errors.eolRequired");
    expect(cycleProblem({ ...EMPTY_CYCLE, cycle: " 1 ", eol: "" })).toBe(
      "eol.custom.errors.eolRequired",
    );
    expect(cycleProblem({ ...ONGOING, cycle: " 1 " })).toBeNull();
    expect(cycleProblem({ ...EMPTY_CYCLE, cycle: "1", eol: true })).toBeNull();
    expect(
      cycleProblem({ ...EMPTY_CYCLE, cycle: "1", releaseDate: "2024-01-02", eol: "2024-01-01" }),
    ).toBe("eol.custom.errors.eolBeforeRelease");
    expect(
      cycleProblem({
        ...ONGOING,
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

  it("names the field each problem belongs to", () => {
    expect(
      cycleIssues({
        ...EMPTY_CYCLE,
        releaseDate: "2024-01-02",
        eol: "2024-01-01",
        support: "2023-12-31",
      }),
    ).toEqual({
      cycle: "eol.custom.errors.cycleRequired",
      eol: "eol.custom.errors.eolBeforeRelease",
      support: "eol.custom.errors.supportBeforeRelease",
    });
    expect(cycleIssues({ ...EMPTY_CYCLE, cycle: "1" })).toEqual({
      eol: "eol.custom.errors.eolRequired",
    });
    expect(cycleIssues({ ...ONGOING, cycle: "1" })).toEqual({});
  });

  it("checks the product fields", () => {
    expect(productDraftIssues({ title: " ", link: "", description: "" })).toEqual({
      title: "eol.custom.errors.titleRequired",
    });
    expect(productDraftIssues({ title: "A", link: "ftp://x", description: "" })).toEqual({
      link: "eol.custom.errors.linkInvalid",
    });
    expect(productDraftIssues({ title: "A", link: " https://x.example ", description: "" })).toEqual(
      {},
    );
    expect(productPayload({ title: " A ", link: " ", description: "  " })).toEqual({
      title: "A",
      link: null,
      description: null,
    });
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

  it("keeps a latest release date", () => {
    expect(
      cyclePayload({ ...EMPTY_CYCLE, cycle: "1", latest: " 1.2 ", latestReleaseDate: "2024-05-05" }),
    ).toMatchObject({ latest: "1.2", latestReleaseDate: "2024-05-05" });
  });

  it("allows an end on the release day or after it", () => {
    const dated = { ...ONGOING, cycle: "1", releaseDate: "2024-01-02" };
    expect(cycleProblem({ ...dated, eol: "2024-01-02" })).toBeNull();
    expect(cycleProblem({ ...dated, eol: "2025-01-01" })).toBeNull();
    expect(cycleProblem({ ...dated, support: "2024-01-02" })).toBeNull();
    expect(cycleProblem({ ...dated, support: true, eol: false })).toBeNull();
    expect(cycleProblem({ ...EMPTY_CYCLE, cycle: "   " })).toBe("eol.custom.errors.cycleRequired");
  });
});

describe("MilestoneField", () => {
  it.each([
    ["eol", "Already ended", true],
    ["eol", "No end of life announced", false],
    ["support", "Support already ended", false],
    ["support", "Still supported", true],
  ] as const)("%s: %s stores %s", async (kind, option, stored) => {
    const onChange = vi.fn();
    render(<MilestoneField kind={kind} value={null} onChange={onChange} />);
    await pick(screen.getByRole("combobox"), option);
    expect(onChange).toHaveBeenCalledWith(stored);
  });

  it("shows a date field only in date mode, labelled after its kind", () => {
    const { rerender, unmount } = render(
      <MilestoneField kind="eol" value={null} onChange={() => {}} />,
    );
    expect(screen.queryByLabelText("End of life on")).toBeNull();
    rerender(<MilestoneField kind="eol" value="2025-01-01" onChange={() => {}} />);
    expect(screen.getByLabelText("End of life on")).toHaveValue("2025-01-01");
    unmount();
    render(<MilestoneField kind="support" value="2025-01-01" onChange={() => {}} />);
    expect(screen.getByLabelText("Supported until")).toHaveValue("2025-01-01");
    expect(screen.queryByLabelText("End of life on")).toBeNull();
  });

  it("is labelled after its kind", () => {
    const { unmount } = render(<MilestoneField kind="eol" value={null} onChange={() => {}} />);
    expect(screen.getByLabelText("End of life")).toBeInTheDocument();
    expect(screen.queryByLabelText("Active support")).toBeNull();
    unmount();
    render(<MilestoneField kind="support" value={null} onChange={() => {}} />);
    expect(screen.getByLabelText("Active support")).toBeInTheDocument();
  });

  it("switching from a yes/no answer to a date starts with no date", async () => {
    const onChange = vi.fn();
    render(<MilestoneField kind="eol" value={true} onChange={onChange} />);
    await pick(screen.getByRole("combobox"), "On a date…");
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("passes a picked date on, and a cleared one as null", () => {
    const onChange = vi.fn();
    render(<MilestoneField kind="support" value="2025-01-01" onChange={onChange} />);
    const date = screen.getByLabelText("Supported until");
    fireEvent.change(date, { target: { value: "2026-02-03" } });
    expect(onChange).toHaveBeenLastCalledWith("2026-02-03");
    fireEvent.change(date, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("shows a problem under the date", () => {
    render(
      <MilestoneField kind="eol" value="2020-01-01" onChange={() => {}} error="Too early" />,
    );
    expect(screen.getByText("Too early")).toBeInTheDocument();
    expect(screen.getByLabelText("End of life on")).toHaveAttribute("aria-invalid", "true");
  });

  it("required: offers no Unknown, opens on a placeholder, and shows a problem under the select", async () => {
    const onChange = vi.fn();
    render(<MilestoneField kind="eol" required value={null} onChange={onChange} error="Pick one" />);
    const select = screen.getByRole("combobox");
    expect(select).toHaveTextContent("Choose…");
    expect(screen.getByText("Pick one")).toBeInTheDocument();
    await userEvent.click(select);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "On a date…",
      "No end of life announced",
      "Already ended",
    ]);
    await userEvent.click(screen.getByRole("option", { name: "No end of life announced" }));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("required: a problem about the date sits under the date, not the select", () => {
    render(
      <MilestoneField kind="eol" required value="2020-01-01" onChange={() => {}} error="Too early" />,
    );
    expect(screen.getByLabelText("End of life on")).toHaveAccessibleDescription("Too early");
    expect(screen.getByRole("combobox")).toHaveTextContent("On a date…");
  });
});

describe("ProductFields", () => {
  it("renders the draft, reports changes, and flags a bad link", async () => {
    const onChange = vi.fn();
    render(
      <ProductFields
        value={{ title: "Acme", link: "ftp://x", description: "An ERP" }}
        onChange={onChange}
      />,
    );
    expect(screen.getByLabelText(/Product name/)).toHaveValue("Acme");
    expect(screen.getByLabelText(/Description/)).toHaveValue("An ERP");
    expect(screen.getByText(/starting with http/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Product name/), "!");
    expect(onChange).toHaveBeenLastCalledWith({ title: "Acme!", link: "ftp://x", description: "An ERP" });
  });

  it("disabled: every field is read-only and AI is not offered", () => {
    ai.status = { enabled: true, configured: true, enabled_types: [], running_models: [] };
    render(
      <ProductFields value={{ title: "Acme", link: "", description: "" }} onChange={() => {}} disabled />,
    );
    expect(screen.getByLabelText(/Product name/)).toBeDisabled();
    expect(screen.getByLabelText(/Vendor or release policy link/)).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Suggest with AI/ })).toBeNull();
  });
});

describe("MilestoneField — choosing a date (regression: the date field never appeared)", () => {
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
    ["unknown", null],
    ["a yes/no answer", false],
  ] as const)("from %s shows the date field and stores the date picked", async (_, initial) => {
    render(<Stateful initial={initial} />);
    await pick(screen.getByRole("combobox"), "On a date…");
    const date = screen.getByLabelText("End of life on");
    expect(screen.getByRole("combobox")).toHaveTextContent("On a date…");
    fireEvent.change(date, { target: { value: "2027-03-01" } });
    expect(screen.getByRole("status")).toHaveTextContent('"2027-03-01"');
    // Clearing the date keeps the field open for another one.
    fireEvent.change(date, { target: { value: "" } });
    expect(screen.getByRole("status")).toHaveTextContent("null");
    expect(screen.getByLabelText("End of life on")).toBeInTheDocument();
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
    await pick(screen.getByRole("combobox"), "On a date…");
    expect(screen.getByLabelText("End of life on")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "set ended" }));
    await userEvent.click(screen.getByRole("button", { name: "unset" }));
    expect(screen.queryByLabelText("End of life on")).toBeNull();
    expect(screen.getByRole("combobox")).toHaveTextContent("Unknown");
  });

  it("opens in date mode on a stored date, and stays there when it is cleared", () => {
    render(<Stateful initial="2026-01-01" />);
    fireEvent.change(screen.getByLabelText("End of life on"), { target: { value: "" } });
    expect(screen.getByLabelText("End of life on")).toBeInTheDocument();
  });

  it("drops the pending date once another answer is chosen", async () => {
    render(<Stateful initial={null} />);
    await pick(screen.getByRole("combobox"), "On a date…");
    await pick(screen.getByRole("combobox"), "Unknown");
    expect(screen.queryByLabelText("End of life on")).toBeNull();
    await pick(screen.getByRole("combobox"), "On a date…");
    await pick(screen.getByRole("combobox"), "Already ended");
    expect(screen.queryByLabelText("End of life on")).toBeNull();
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
    expect(screen.getByLabelText(/Release cycle/)).toHaveValue("1");
    expect(screen.getByLabelText("Release date")).toHaveValue("2024-01-01");
    expect(screen.getByLabelText("Latest version")).toHaveValue("1.4");
    expect(screen.getByLabelText("Latest release date")).toHaveValue("2024-06-01");
    expect(screen.getByLabelText("Supported until")).toHaveValue("2025-01-01");
    expect(screen.getByLabelText("End of life on")).toHaveValue("2026-01-01");
  });

  it("shows empty fields for missing values", () => {
    render(<CycleFields value={EMPTY_CYCLE} onChange={() => {}} />);
    expect(screen.getByLabelText("Release date")).toHaveValue("");
    expect(screen.getByLabelText("Latest version")).toHaveValue("");
    expect(screen.getByLabelText("Latest release date")).toHaveValue("");
  });

  it("reports each field's change, a cleared date as null", async () => {
    const onChange = vi.fn();
    render(<CycleFields value={FULL} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Release date"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...FULL, releaseDate: null });
    fireEvent.change(screen.getByLabelText("Release date"), { target: { value: "2023-03-03" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...FULL, releaseDate: "2023-03-03" });
    fireEvent.change(screen.getByLabelText("Latest release date"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...FULL, latestReleaseDate: null });
    fireEvent.change(screen.getByLabelText("Latest release date"), {
      target: { value: "2024-07-07" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ ...FULL, latestReleaseDate: "2024-07-07" });
    fireEvent.change(screen.getByLabelText("Latest version"), { target: { value: "1.5" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...FULL, latest: "1.5" });
    await pick(screen.getAllByRole("combobox")[0], "Still supported");
    expect(onChange).toHaveBeenLastCalledWith({ ...FULL, support: true });
    await pick(screen.getAllByRole("combobox")[1], "Already ended");
    expect(onChange).toHaveBeenLastCalledWith({ ...FULL, eol: true });
  });

  it("puts each problem on its field", () => {
    render(
      <CycleFields
        value={FULL}
        onChange={() => {}}
        errors={{ cycle: "Name it", eol: "EOL too early", support: "Support too early" }}
      />,
    );
    expect(screen.getByLabelText(/Release cycle/)).toHaveAccessibleDescription("Name it");
    expect(screen.getByLabelText("End of life on")).toHaveAccessibleDescription("EOL too early");
    expect(screen.getByLabelText("Supported until")).toHaveAccessibleDescription(
      "Support too early",
    );
  });
});

describe("CustomEolProductDialog — create", () => {
  it("creates the product with its cycle; the key is the server's business", async () => {
    mockApi.on("post", "/eol/custom-products", SAVED);
    const onSaved = vi.fn();
    render(
      <CustomEolProductDialog open initialTitle="Acme ERP" onClose={() => {}} onSaved={onSaved} />,
    );
    expect(screen.getByRole("heading", { name: "Create a custom EOL product" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Product name/)).toHaveValue("Acme ERP");
    expect(screen.queryByLabelText(/^Key/)).toBeNull();

    const create = screen.getByRole("button", { name: "Create" });
    // A cycle with no name holds the button back, without a warning before
    // anyone has typed into the row.
    expect(create).toBeDisabled();
    expect(screen.queryByText("Every cycle needs a name.")).toBeNull();
    await userEvent.type(cycleInputs()[0], "1");
    // An end of life is required too: the button waits for it.
    expect(create).toBeDisabled();
    expect(
      screen.getByText("Choose an end of life: a date, none announced, or already ended."),
    ).toBeInTheDocument();
    await pick(screen.getAllByRole("combobox")[1], "No end of life announced");
    await userEvent.click(create);

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(SAVED));
    expect(mockApi.callsOf("post")[0].body).toEqual({
      title: "Acme ERP",
      link: null,
      description: null,
      cycles: [
        {
          cycle: "1",
          releaseDate: null,
          support: null,
          eol: false,
          latest: null,
          latestReleaseDate: null,
        },
      ],
    });
  });

  it("names the missing cycle on its field once the row was edited", async () => {
    render(<CustomEolProductDialog open initialTitle="Acme" onClose={() => {}} onSaved={() => {}} />);
    await userEvent.type(cycleInputs()[0], "1");
    await userEvent.clear(cycleInputs()[0]);
    expect(cycleInputs()[0]).toHaveAccessibleDescription("Every cycle needs a name.");
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("refuses a bad link and duplicate cycles", async () => {
    render(
      <CustomEolProductDialog open initialTitle="Acme" onClose={() => {}} onSaved={() => {}} />,
    );
    await userEvent.type(cycleInputs()[0], "1");
    await pick(screen.getAllByRole("combobox")[1], "Already ended");
    const create = screen.getByRole("button", { name: "Create" });
    expect(create).toBeEnabled();

    await userEvent.type(screen.getByLabelText(/Vendor or release policy link/), "ftp://x");
    expect(screen.getByText(/starting with http/)).toBeInTheDocument();
    expect(create).toBeDisabled();
    await userEvent.clear(screen.getByLabelText(/Vendor or release policy link/));

    await userEvent.click(screen.getByRole("button", { name: /Add another cycle/ }));
    await userEvent.type(cycleInputs()[1], "1");
    await pick(screen.getAllByRole("combobox")[3], "Already ended");
    expect(screen.getByText("Two cycles have the same name.")).toBeInTheDocument();
    expect(create).toBeDisabled();
    const removes = screen.getAllByRole("button", { name: "Remove cycle" });
    await userEvent.click(removes[1]);
    expect(cycleInputs()).toHaveLength(1);
    expect(create).toBeEnabled();
  });

  it("keeps the dialog open with the server's message on failure", async () => {
    mockApi.fail("post", "/eol/custom-products", 409, "taken");
    const onSaved = vi.fn();
    render(
      <CustomEolProductDialog open initialTitle="Acme" onClose={() => {}} onSaved={onSaved} />,
    );
    await userEvent.type(cycleInputs()[0], "1");
    await pick(screen.getAllByRole("combobox")[1], "Already ended");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("POST /eol/custom-products failed")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Create" })).toBeEnabled();
  });
});

describe("CustomEolProductDialog — edit", () => {
  it("patches title, link and description, with no cycles and no key", async () => {
    const product = { ...SAVED, link: "https://acme.example" };
    mockApi.on("patch", "/eol/custom-products/acme-erp", { ...product, title: "Acme Suite" });
    const onSaved = vi.fn();
    render(
      <CustomEolProductDialog open product={product} onClose={() => {}} onSaved={onSaved} />,
    );
    expect(screen.getByRole("heading", { name: "Edit custom EOL product" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Key/)).toBeNull();
    expect(screen.queryByText("Release cycles")).toBeNull();
    expect(screen.queryByText(/For a product endoflife.date does not track/)).toBeNull();
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

describe("CustomEolProductDialog — details", () => {
  it("introduces the create form, hints the link, and cancels", async () => {
    const onClose = vi.fn();
    render(<CustomEolProductDialog open initialTitle="  Acme  " onClose={onClose} onSaved={() => {}} />);
    expect(screen.getByLabelText(/Product name/)).toHaveValue("Acme");
    expect(screen.getByText(/For a product endoflife.date does not track/)).toBeInTheDocument();
    expect(screen.getByText("Release cycles")).toBeInTheDocument();
    expect(screen.getByLabelText(/Vendor or release policy link/)).toHaveAttribute(
      "placeholder",
      "e.g. https://vendor.example/lifecycle",
    );
    // One row: nothing to remove yet.
    expect(screen.queryByRole("button", { name: "Remove cycle" })).toBeNull();
    await userEvent.type(cycleInputs()[0], "1");
    expect(screen.queryByRole("alert")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("needs a name that is more than spaces, and ignores a blank link", async () => {
    render(<CustomEolProductDialog open initialTitle="Acme" onClose={() => {}} onSaved={() => {}} />);
    await userEvent.type(cycleInputs()[0], "1");
    await pick(screen.getAllByRole("combobox")[1], "Already ended");
    await userEvent.type(screen.getByLabelText(/Vendor or release policy link/), "   ");
    expect(screen.queryByText(/starting with http/)).toBeNull();
    const create = screen.getByRole("button", { name: "Create" });
    expect(create).toBeEnabled();
    const name = screen.getByLabelText(/Product name/);
    await userEvent.clear(name);
    await userEvent.type(name, "   ");
    expect(create).toBeDisabled();
  });

  it("flags duplicates by trimmed name, and a blank row on its own field", async () => {
    render(<CustomEolProductDialog open initialTitle="Acme" onClose={() => {}} onSaved={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /Add another cycle/ }));
    // The new row is focused and, untouched, shows no complaint yet.
    expect(cycleInputs()[1]).toHaveFocus();
    expect(screen.queryByText("Every cycle needs a name.")).toBeNull();
    expect(screen.queryByText("Two cycles have the same name.")).toBeNull();
    await userEvent.type(cycleInputs()[0], " 1");
    await userEvent.type(cycleInputs()[1], "1 ");
    expect(screen.getByText("Two cycles have the same name.")).toBeInTheDocument();
  });

  it("puts a date problem on the date, not in a banner", async () => {
    render(<CustomEolProductDialog open initialTitle="Acme" onClose={() => {}} onSaved={() => {}} />);
    await userEvent.type(cycleInputs()[0], "1");
    fireEvent.change(screen.getByLabelText("Release date"), { target: { value: "2024-01-02" } });
    await pick(screen.getAllByRole("combobox")[1], "On a date…");
    fireEvent.change(screen.getByLabelText("End of life on"), { target: { value: "2024-01-01" } });
    expect(screen.getByLabelText("End of life on")).toHaveAccessibleDescription(
      "The end of life cannot be before the release date.",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("keeps each row's own choices when another row is removed", async () => {
    render(<CustomEolProductDialog open initialTitle="Acme" onClose={() => {}} onSaved={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /Add another cycle/ }));
    // Row 1's End of life select is the second combobox (support, eol per row).
    await pick(screen.getAllByRole("combobox")[1], "On a date…");
    expect(screen.getAllByLabelText("End of life on")).toHaveLength(1);
    await userEvent.click(screen.getAllByRole("button", { name: "Remove cycle" })[0]);
    expect(screen.queryByLabelText("End of life on")).toBeNull();
    expect(screen.getAllByRole("combobox")[1]).toHaveTextContent("Choose…");
  });

  it("edits only the cycle typed in, and removes the one asked for", async () => {
    render(<CustomEolProductDialog open initialTitle="Acme" onClose={() => {}} onSaved={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /Add another cycle/ }));
    await userEvent.type(cycleInputs()[0], "a");
    await userEvent.type(cycleInputs()[1], "b");
    expect(cycleInputs().map((i) => i.value)).toEqual(["a", "b"]);
    await userEvent.click(screen.getAllByRole("button", { name: "Remove cycle" })[0]);
    expect(cycleInputs().map((i) => i.value)).toEqual(["b"]);
    expect(screen.queryByRole("button", { name: "Remove cycle" })).toBeNull();
  });

  it("sends trimmed text, holds the button while saving, and clears the last error", async () => {
    let release: (v: EolCustomProduct) => void = () => {};
    mockApi.fail("post", "/eol/custom-products", 409, "taken");
    render(<CustomEolProductDialog open initialTitle=" Acme " onClose={() => {}} onSaved={() => {}} />);
    await userEvent.type(cycleInputs()[0], "1");
    await pick(screen.getAllByRole("combobox")[1], "Already ended");
    await userEvent.type(screen.getByLabelText(/Vendor or release policy link/), " https://acme.example ");
    await userEvent.type(screen.getByLabelText(/Description/), " Our ERP ");
    const create = screen.getByRole("button", { name: "Create" });
    await userEvent.click(create);
    expect(await screen.findByText("POST /eol/custom-products failed")).toBeInTheDocument();

    mockApi.on("post", "/eol/custom-products", () => new Promise<EolCustomProduct>((r) => (release = r)));
    await userEvent.click(create);
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
    await pick(screen.getAllByRole("combobox")[1], "Already ended");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    const alert = await screen.findByText("POST /eol/custom-products failed");
    await userEvent.click(within(alert.closest("[role=alert]") as HTMLElement).getByRole("button"));
    expect(screen.queryByText("POST /eol/custom-products failed")).toBeNull();
  });
});

describe("CustomEolProductDialog — AI description", () => {
  const SUGGESTION = {
    suggestions: { description: { value: "An ERP for widget makers.", confidence: 0.9 } },
    sources: [{ url: "https://acme.example", title: "Acme" }],
    model: "test-model",
    search_provider: "duckduckgo",
  };

  it("offers nothing while AI is off or unconfigured", () => {
    render(<CustomEolProductDialog open initialTitle="Acme" onClose={() => {}} onSaved={() => {}} />);
    expect(screen.queryByRole("button", { name: /Suggest with AI/ })).toBeNull();
    ai.status = { enabled: true, configured: false, enabled_types: [], running_models: [] };
    render(<CustomEolProductDialog open initialTitle="Acme" onClose={() => {}} onSaved={() => {}} />);
    expect(screen.queryByRole("button", { name: /Suggest with AI/ })).toBeNull();
  });

  it("suggests from the name and the link, and fills the description on apply", async () => {
    ai.status = { enabled: true, configured: true, enabled_types: ["Application"], running_models: [] };
    mockApi.on("post", "/ai/suggest-eol-product", SUGGESTION);
    render(<CustomEolProductDialog open initialTitle="A" onClose={() => {}} onSaved={() => {}} />);
    // Two characters of name before the offer.
    expect(screen.queryByRole("button", { name: /Suggest with AI/ })).toBeNull();
    await userEvent.type(screen.getByLabelText(/Product name/), "cme");
    await userEvent.type(screen.getByLabelText(/Vendor or release policy link/), "https://acme.example/x");
    await userEvent.click(screen.getByRole("button", { name: /Suggest with AI/ }));
    expect(mockApi.callsOf("post", "/ai/suggest-eol-product")[0].body).toEqual({
      name: "Acme",
      link: "https://acme.example/x",
    });
    await userEvent.click(await screen.findByRole("button", { name: /Apply description/ }));
    expect(screen.getByLabelText(/Description/)).toHaveValue("An ERP for widget makers.");
    // The offer comes back once the panel is gone.
    expect(screen.getByRole("button", { name: /Suggest with AI/ })).toBeInTheDocument();
  });

  it("shows a failure in the panel and lets it be dismissed; no link sends none", async () => {
    ai.status = { enabled: true, configured: true, enabled_types: [], running_models: [] };
    mockApi.fail("post", "/ai/suggest-eol-product", 502, "down");
    render(<CustomEolProductDialog open initialTitle="Acme" onClose={() => {}} onSaved={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /Suggest with AI/ }));
    expect(mockApi.callsOf("post", "/ai/suggest-eol-product")[0].body).toEqual({ name: "Acme" });
    expect(await screen.findByText("POST /ai/suggest-eol-product failed")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("POST /ai/suggest-eol-product failed")).toBeNull();
    expect(screen.getByRole("button", { name: /Suggest with AI/ })).toBeInTheDocument();
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
    await userEvent.type(within(dialog).getByLabelText(/Release cycle/), "3");
    await pick(within(dialog).getAllByRole("combobox")[1], "Already ended");
    await userEvent.click(add);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created));
    expect(mockApi.callsOf("post")[0].body).toMatchObject({ cycle: "3", eol: true });
  });

  function renderCycleDialog(onClose = vi.fn()) {
    render(
      <CustomEolCycleDialog open productKey="acme erp" productLabel="Acme ERP" onClose={onClose} onSaved={() => {}} />,
    );
    return within(screen.getByRole("dialog"));
  }

  it("puts a problem on its field once the cycle was edited", async () => {
    const dialog = renderCycleDialog();
    expect(dialog.getByRole("button", { name: "Add cycle" })).toBeDisabled();
    expect(dialog.queryByText("Every cycle needs a name.")).toBeNull();
    fireEvent.change(dialog.getByLabelText("Release date"), { target: { value: "2024-01-02" } });
    expect(dialog.getByLabelText(/Release cycle/)).toHaveAccessibleDescription(
      "Every cycle needs a name.",
    );
    await pick(dialog.getAllByRole("combobox")[1], "On a date…");
    fireEvent.change(dialog.getByLabelText("End of life on"), { target: { value: "2024-01-01" } });
    expect(dialog.getByLabelText("End of life on")).toHaveAccessibleDescription(
      "The end of life cannot be before the release date.",
    );
    await userEvent.type(dialog.getByLabelText(/Release cycle/), "1");
    expect(dialog.getByRole("button", { name: "Add cycle" })).toBeDisabled();
    fireEvent.change(dialog.getByLabelText("End of life on"), { target: { value: "2025-01-01" } });
    expect(dialog.getByRole("button", { name: "Add cycle" })).toBeEnabled();
  });

  it("shows the server's error, keeps the dialog usable, and lets the error go", async () => {
    mockApi.fail("post", "/eol/custom-products/acme%20erp/cycles", 422, "bad");
    const onClose = vi.fn();
    const dialog = renderCycleDialog(onClose);
    await userEvent.type(dialog.getByLabelText(/Release cycle/), "3");
    await pick(dialog.getAllByRole("combobox")[1], "Already ended");
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
    await userEvent.type(dialog.getByLabelText(/Release cycle/), "3");
    await pick(dialog.getAllByRole("combobox")[1], "Already ended");
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
