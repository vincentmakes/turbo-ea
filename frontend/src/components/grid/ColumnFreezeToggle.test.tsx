import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ListItemButton from "@mui/material/ListItemButton";
import Box from "@mui/material/Box";
import ColumnFreezeToggle from "./ColumnFreezeToggle";

describe("ColumnFreezeToggle", () => {
  it("labels itself by what the click will do", () => {
    const { rerender } = render(<ColumnFreezeToggle frozen={false} onToggle={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Freeze column" })).toBeInTheDocument();

    rerender(<ColumnFreezeToggle frozen onToggle={vi.fn()} />);
    const pressed = screen.getByRole("button", { name: "Unfreeze column" });
    expect(pressed).toHaveAttribute("aria-pressed", "true");
  });

  it("toggles on click and on keyboard activation", () => {
    const onToggle = vi.fn();
    render(<ColumnFreezeToggle frozen={false} onToggle={onToggle} />);
    const pin = screen.getByRole("button", { name: "Freeze column" });

    fireEvent.click(pin);
    fireEvent.keyDown(pin, { key: "Enter" });
    fireEvent.keyDown(pin, { key: " " });
    expect(onToggle).toHaveBeenCalledTimes(3);

    // A key that isn't an activation must not fire it.
    fireEvent.keyDown(pin, { key: "a" });
    expect(onToggle).toHaveBeenCalledTimes(3);
  });

  it("does not also toggle the row it sits next to", () => {
    const onToggle = vi.fn();
    const onRowClick = vi.fn();
    render(
      <Box onClick={onRowClick}>
        <ListItemButton onClick={onRowClick}>Name</ListItemButton>
        <ColumnFreezeToggle frozen={false} onToggle={onToggle} />
      </Box>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Freeze column" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    // The row's visibility handler must not have seen the pin click.
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
