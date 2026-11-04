import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EolCustomProduct } from "@/types";
import ProposeEolProductDialog from "./ProposeEolProductDialog";

const PRODUCT: EolCustomProduct = {
  id: "p1",
  key: "acme-erp",
  product: "custom:acme-erp",
  title: "Acme ERP",
  description: "is an ERP.",
  link: "https://acme.example",
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

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async () => {}) },
  });
});

describe("ProposeEolProductDialog", () => {
  it("leads with the public warning and waits for a category", () => {
    render(<ProposeEolProductDialog open product={PRODUCT} onClose={() => {}} />);
    expect(screen.getByText(/publishes the product name and its dates/)).toBeInTheDocument();
    expect(screen.getByText(/products\/acme-erp\.md/)).toBeInTheDocument();
    expect(screen.getByText("Choose a category to preview the file.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open on GitHub/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Copy file/ })).toBeDisabled();
  });

  it("previews the file for the chosen category and links GitHub's new-file page", async () => {
    render(<ProposeEolProductDialog open product={PRODUCT} onClose={() => {}} />);
    await chooseCategory("Database");
    const preview = screen.getByTestId("eol-propose-preview");
    expect(preview).toHaveTextContent("category: database");
    expect(preview).toHaveTextContent('releaseCycle: "1"');
    // The stored support `false` (ended) is written as eoas: true.
    expect(preview.textContent).toContain("eoas: true");
    const open = screen.getByRole("link", { name: /Open on GitHub/ });
    const href = open.getAttribute("href")!;
    expect(href).toMatch(
      /^https:\/\/github\.com\/endoflife-date\/endoflife\.date\/new\/master\/products\?filename=acme-erp\.md&value=/,
    );
    expect(decodeURIComponent(href.split("value=")[1])).toBe(preview.textContent);
    expect(open).toHaveAttribute("target", "_blank");
    expect(open).toHaveAttribute("rel", "noopener noreferrer");

    await chooseCategory("Application");
    expect(screen.getByTestId("eol-propose-preview")).toHaveTextContent("category: app");
  });

  it("copies the file to the clipboard", async () => {
    render(<ProposeEolProductDialog open product={PRODUCT} onClose={() => {}} />);
    await chooseCategory("Service");
    await userEvent.click(screen.getByRole("button", { name: /Copy file/ }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      screen.getByTestId("eol-propose-preview").textContent,
    );
    expect(await screen.findByText("File copied to the clipboard.")).toBeInTheDocument();
  });

  it("says so when the browser refuses the copy", async () => {
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("no"));
    render(<ProposeEolProductDialog open product={PRODUCT} onClose={() => {}} />);
    await chooseCategory("Service");
    await userEvent.click(screen.getByRole("button", { name: /Copy file/ }));
    expect(await screen.findByText(/did not allow copying/)).toBeInTheDocument();
  });

  it("drops the GitHub button for a file too long for a URL, keeping Copy", async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      ...PRODUCT.cycles[0],
      id: `c${i}`,
      cycle: `${i}.0`,
      latest: `${i}.0.123456789`,
    }));
    render(
      <ProposeEolProductDialog open product={{ ...PRODUCT, cycles: many }} onClose={() => {}} />,
    );
    await chooseCategory("Operating system");
    expect(screen.queryByRole("link", { name: /Open on GitHub/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Open on GitHub/ })).toBeNull();
    expect(screen.getByText(/too long to open on GitHub directly/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy file/ })).toBeEnabled();
  });

  it("closes", async () => {
    const onClose = vi.fn();
    render(<ProposeEolProductDialog open product={PRODUCT} onClose={onClose} />);
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("renders nothing without a product", () => {
    render(<ProposeEolProductDialog open product={null} onClose={() => {}} />);
    expect(screen.queryByText(/publishes the product/)).toBeNull();
  });
});
