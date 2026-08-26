import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import ExtensionLogo from "./ExtensionLogo";

describe("ExtensionLogo", () => {
  it("renders the catalogue logo when there is no installed bundle", () => {
    const { container } = render(
      <ExtensionLogo extKey="a-ext" name="Alpha Ext" catalogLogoUrl="https://store/a.png" />,
    );
    expect(container.querySelector("img")).toHaveAttribute("src", "https://store/a.png");
  });

  it("prefers the installed bundle's logo over the catalogue's", () => {
    // The bundle is the artwork of the version this instance actually runs,
    // and the only one that resolves with the store unreachable.
    const { container } = render(
      <ExtensionLogo
        extKey="a-ext"
        name="Alpha Ext"
        bundleLogoUrl="/api/v1/ext-assets/a-ext/1.0.0/logo.png"
        catalogLogoUrl="https://store/a.png"
      />,
    );
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "/api/v1/ext-assets/a-ext/1.0.0/logo.png",
    );
  });

  it("falls through to the catalogue logo when the bundle one 404s", () => {
    // A cursor over the candidates, not a boolean: mid-uninstall or on a
    // wiped volume the bundle URL 404s while the catalogue's still resolves.
    const { container } = render(
      <ExtensionLogo
        extKey="a-ext"
        name="Alpha Ext"
        bundleLogoUrl="/api/v1/ext-assets/a-ext/1.0.0/logo.png"
        catalogLogoUrl="https://store/a.png"
      />,
    );
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toHaveAttribute("src", "https://store/a.png");
  });

  it("falls back to initials when every candidate fails", () => {
    const { container } = render(
      <ExtensionLogo extKey="a-ext" name="Alpha Ext" catalogLogoUrl="https://store/a.png" />,
    );
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("AE")).toBeInTheDocument();
  });

  it("falls back to initials when the extension ships no artwork at all", () => {
    render(<ExtensionLogo extKey="a-ext" name="Alpha Ext" />);
    expect(screen.getByText("AE")).toBeInTheDocument();
  });

  it("gives the same key the same colour every time", () => {
    // Hashed on the key, not the name, so a vendor rename does not reshuffle
    // the tile — and the tile, drawer and Installed row always agree.
    const { container: first } = render(<ExtensionLogo extKey="a-ext" name="Alpha Ext" />);
    const { container: second } = render(<ExtensionLogo extKey="a-ext" name="Renamed" />);
    const bg = (el: HTMLElement) => getComputedStyle(el.firstElementChild!).backgroundColor;
    expect(bg(first)).toBe(bg(second));
  });
});
