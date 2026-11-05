import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import { STATUS_COLORS } from "@/theme/tokens";
import type { EolCustomProduct } from "@/types";
import CustomEolContributeTab from "./CustomEolContributeTab";

const PRODUCT: EolCustomProduct = {
  id: "p1",
  key: "acme-erp",
  product: "custom:acme-erp",
  title: "Acme ERP",
  description: "is an ERP.",
  link: "https://acme.example",
  eol_category: null,
  release_policy_note: null,
  linked_cards: 0,
  updated_at: null,
  cycles: [
    {
      id: "c1",
      cycle: "1",
      releaseDate: "2020-01-01",
      support: false,
      eol: true,
      latest: "1.9",
      latestReleaseDate: null,
      sort_order: 0,
      linked_cards: 0,
      updated_at: null,
    },
  ],
};

async function chooseCategory(name: string) {
  await userEvent.click(screen.getByRole("combobox", { name: "endoflife.date category" }));
  await userEvent.click(await screen.findByRole("option", { name }));
}

function renderTab(
  product: EolCustomProduct = PRODUCT,
  extra: Partial<{ canManage: boolean; onChanged: () => void; onError: (m: string) => void }> = {},
) {
  const props = { canManage: true, onChanged: vi.fn(), onError: vi.fn(), ...extra };
  render(<CustomEolContributeTab product={product} {...props} />);
  return props;
}

const check = (id: string) => screen.getByTestId(`eol-check-${id}`);

beforeEach(() => {
  mockApi.reset();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async () => {}) },
  });
});

describe("CustomEolContributeTab", () => {
  it("leads with the public warning, names the file and waits for a category", () => {
    renderTab();
    expect(screen.getByText(/publishes the product name and its dates/)).toBeInTheDocument();
    expect(screen.getByText(/\(products\/acme-erp\.md\)/)).toBeInTheDocument();
    expect(screen.getByText("Choose a category to preview the file.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "endoflife.date category" })).toHaveTextContent(
      "Choose…",
    );
    expect(screen.queryByTestId("eol-contribute-preview")).toBeNull();
    expect(screen.getByRole("button", { name: /Open on GitHub/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Copy file/ })).toBeDisabled();
  });

  it("previews the file for the chosen category and links GitHub's new-file page", async () => {
    renderTab();
    await chooseCategory("Database");
    const preview = screen.getByTestId("eol-contribute-preview");
    expect(preview).toHaveTextContent("category: database");
    expect(preview).toHaveTextContent('releaseCycle: "1"');
    expect(preview.textContent).toContain("eoas: true");
    // No note yet: the placeholder paragraph stands in for it.
    expect(preview.textContent).toContain("Summarise the release policy here");
    const open = screen.getByRole("link", { name: /Open on GitHub/ });
    const href = open.getAttribute("href")!;
    expect(href).toMatch(
      /^https:\/\/github\.com\/endoflife-date\/endoflife\.date\/new\/master\/products\?filename=acme-erp\.md&value=/,
    );
    expect(decodeURIComponent(href.split("value=")[1])).toBe(preview.textContent);
    expect(open).toHaveAttribute("target", "_blank");
    expect(open).toHaveAttribute("rel", "noopener noreferrer");

    await chooseCategory("Application");
    expect(screen.getByTestId("eol-contribute-preview")).toHaveTextContent("category: app");
  });

  it("puts the typed release policy summary into the preview", async () => {
    renderTab();
    await chooseCategory("Service");
    await userEvent.type(
      screen.getByRole("textbox", { name: "Release policy summary" }),
      "Each release gets 3 years.",
    );
    const preview = screen.getByTestId("eol-contribute-preview");
    expect(preview.textContent).toContain("Each release gets 3 years.");
    expect(preview.textContent).not.toContain("Summarise the release policy here");
  });

  it("copies the file to the clipboard", async () => {
    renderTab();
    await chooseCategory("Service");
    await userEvent.click(screen.getByRole("button", { name: /Copy file/ }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      screen.getByTestId("eol-contribute-preview").textContent,
    );
    expect(await screen.findByText("File copied to the clipboard.")).toBeInTheDocument();
  });

  it("says so when the browser refuses the copy", async () => {
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("no"));
    renderTab();
    await chooseCategory("Service");
    await userEvent.click(screen.getByRole("button", { name: /Copy file/ }));
    expect(await screen.findByText(/did not allow copying/)).toBeInTheDocument();
    expect(screen.queryByText("File copied to the clipboard.")).toBeNull();
  });

  it("drops the GitHub button for a file too long for a URL, keeping Copy", async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      ...PRODUCT.cycles[0],
      id: `c${i}`,
      cycle: `${i}.0`,
      latest: `${i}.0.123456789`,
    }));
    renderTab({ ...PRODUCT, cycles: many });
    await chooseCategory("Operating system");
    expect(screen.queryByRole("link", { name: /Open on GitHub/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Open on GitHub/ })).toBeNull();
    expect(screen.getByText(/too long to open on GitHub directly/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy file/ })).toBeEnabled();
  });

  it("lists the pull-request steps and links the contribution guide", () => {
    renderTab();
    expect(screen.getByText("Opening the pull request")).toBeInTheDocument();
    const steps = screen.getAllByRole("listitem").filter((li) => li.tagName === "LI" && !li.dataset.ok);
    expect(steps.map((s) => s.textContent)).toEqual([
      expect.stringMatching(/^Open the file on GitHub/),
      expect.stringMatching(/^Review the file/),
      expect.stringMatching(/^Open the pull request/),
    ]);
    const guide = screen.getByRole("link", { name: "Read the contribution guide" });
    expect(guide).toHaveAttribute(
      "href",
      "https://github.com/endoflife-date/endoflife.date/blob/master/CONTRIBUTING.md",
    );
    expect(guide).toHaveAttribute("target", "_blank");
  });

  it("flags what a product still lacks, with a hint per item", () => {
    renderTab({
      ...PRODUCT,
      link: null,
      description: "  ",
      cycles: [{ ...PRODUCT.cycles[0], releaseDate: null, eol: null }],
    });
    expect(screen.getByTestId("eol-contribute-readiness")).toHaveTextContent("Not ready yet");
    expect(screen.getByTestId("eol-contribute-readiness")).not.toHaveClass("MuiChip-colorSuccess");
    expect(check("cycles")).toHaveAttribute("data-ok", "true");
    expect(check("cycles")).not.toHaveTextContent("Add a cycle in Details.");
    expect(check("eol")).toHaveAttribute("data-ok", "false");
    expect(check("eol")).toHaveTextContent("choose an end of life");
    expect(check("release")).toHaveAttribute("data-ok", "false");
    expect(check("release")).toHaveTextContent("set its release date");
    expect(check("link")).toHaveAttribute("data-ok", "false");
    expect(check("link")).toHaveTextContent("Set the link in Details");
    expect(check("category")).toHaveAttribute("data-ok", "false");
    expect(check("category")).toHaveTextContent("Choose it below.");
    expect(check("description")).toHaveAttribute("data-ok", "false");
    expect(check("description")).toHaveTextContent("Write it in Details");
    expect(within(check("eol")).getByText("cancel")).toHaveStyle({ color: STATUS_COLORS.error });
    expect(within(check("cycles")).getByText("check_circle")).toHaveStyle({ color: STATUS_COLORS.success });
  });

  it("flags a product without cycles", () => {
    renderTab({ ...PRODUCT, cycles: [] });
    expect(check("cycles")).toHaveAttribute("data-ok", "false");
    expect(check("cycles")).toHaveTextContent("Add a cycle in Details.");
  });

  it("shows Ready once everything is there, the saved category included", () => {
    renderTab({ ...PRODUCT, eol_category: "database", release_policy_note: "Two years each." });
    expect(screen.getByTestId("eol-contribute-readiness")).toHaveTextContent("Ready to propose");
    expect(screen.getByTestId("eol-contribute-readiness")).toHaveClass("MuiChip-colorSuccess");
    for (const id of ["cycles", "eol", "release", "link", "category", "description"]) {
      expect(check(id)).toHaveAttribute("data-ok", "true");
    }
    expect(screen.queryByText("Choose it below.")).toBeNull();
    // The saved category and note pre-fill the fields and the preview.
    expect(screen.getByRole("combobox", { name: "endoflife.date category" })).toHaveTextContent(
      "Database",
    );
    expect(screen.getByRole("textbox", { name: "Release policy summary" })).toHaveValue(
      "Two years each.",
    );
    const preview = screen.getByTestId("eol-contribute-preview");
    expect(preview).toHaveTextContent("category: database");
    expect(preview.textContent).toContain("Two years each.");
  });

  it("turns Ready on when the missing category is chosen", async () => {
    renderTab();
    expect(screen.getByTestId("eol-contribute-readiness")).toHaveTextContent("Not ready yet");
    await chooseCategory("Framework");
    expect(screen.getByTestId("eol-contribute-readiness")).toHaveTextContent("Ready to propose");
  });

  it("saves the category and the note on the product", async () => {
    mockApi.on("patch", "/eol/custom-products/acme-erp", {});
    const { onChanged, onError } = renderTab();
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await chooseCategory("Database");
    await userEvent.type(
      screen.getByRole("textbox", { name: "Release policy summary" }),
      "  Two years.  ",
    );
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(mockApi.callsOf("patch")).toEqual([
      {
        method: "patch",
        path: "/eol/custom-products/acme-erp",
        body: { eol_category: "database", release_policy_note: "Two years." },
      },
    ]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("clears both fields with nulls", async () => {
    mockApi.on("patch", "/eol/custom-products/acme-erp", {});
    renderTab({ ...PRODUCT, eol_category: null, release_policy_note: "Old." });
    await userEvent.clear(screen.getByRole("textbox", { name: "Release policy summary" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockApi.callsOf("patch")).toHaveLength(1));
    expect(mockApi.callsOf("patch")[0].body).toEqual({
      eol_category: null,
      release_policy_note: null,
    });
  });

  it("reports a failed save through onError and keeps the draft", async () => {
    mockApi.fail("patch", "/eol/custom-products/acme-erp", 422, "bad");
    const { onChanged, onError } = renderTab();
    await chooseCategory("Database");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith("PATCH /eol/custom-products/acme-erp failed"),
    );
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("Cancel puts the saved values back", async () => {
    renderTab({ ...PRODUCT, eol_category: "os", release_policy_note: "Kept." });
    const note = screen.getByRole("textbox", { name: "Release policy summary" });
    await userEvent.type(note, " More.");
    await chooseCategory("Database");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(note).toHaveValue("Kept.");
    expect(screen.getByRole("combobox", { name: "endoflife.date category" })).toHaveTextContent(
      "Operating system",
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("lets a reader preview and copy, but not save", async () => {
    renderTab(PRODUCT, { canManage: false });
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    await chooseCategory("Service");
    await userEvent.click(screen.getByRole("button", { name: /Copy file/ }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      screen.getByTestId("eol-contribute-preview").textContent,
    );
    expect(screen.getByRole("link", { name: /Open on GitHub/ })).toBeInTheDocument();
  });
});
