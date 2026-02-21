import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MaterialSymbol from "./MaterialSymbol";

describe("MaterialSymbol", () => {
  it("renders the icon name as text", () => {
    render(<MaterialSymbol icon="settings" />);
    expect(screen.getByText("settings")).toBeInTheDocument();
  });

  it("applies default size of 24", () => {
    render(<MaterialSymbol icon="home" />);
    const el = screen.getByText("home");
    expect(el.style.fontSize).toBe("24px");
  });

  it("applies custom size", () => {
    render(<MaterialSymbol icon="home" size={16} />);
    const el = screen.getByText("home");
    expect(el.style.fontSize).toBe("16px");
  });

  it("applies custom color", () => {
    render(<MaterialSymbol icon="star" color="red" />);
    const el = screen.getByText("star");
    expect(el.style.color).toBe("red");
  });

  it("includes material-symbols-outlined class", () => {
    render(<MaterialSymbol icon="check" />);
    const el = screen.getByText("check");
    expect(el.classList.contains("material-symbols-outlined")).toBe(true);
  });

  it("appends custom className", () => {
    render(<MaterialSymbol icon="check" className="custom" />);
    const el = screen.getByText("check");
    expect(el.classList.contains("custom")).toBe(true);
  });
});
