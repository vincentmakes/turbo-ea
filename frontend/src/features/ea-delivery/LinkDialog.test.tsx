import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LinkDialog from "./LinkDialog";

vi.mock("@/api/client", () => ({ api: { get: vi.fn() } }));

type Props = Parameters<typeof LinkDialog>[0];

function setup(overrides: Partial<Props> = {}) {
  const props: Props = {
    open: true,
    href: "",
    editing: false,
    askText: false,
    onCancel: vi.fn(),
    onApply: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  };
  const utils = render(<LinkDialog {...props} />);
  return { ...utils, props, user: userEvent.setup() };
}

const url = () => screen.getByTestId("link-url") as HTMLInputElement;
const apply = () => screen.getByRole("button", { name: "Apply" });
const INVALID = "Enter a web address (https://…) or an e-mail address";

let open: ReturnType<typeof vi.fn>;
beforeEach(() => {
  open = vi.fn();
  vi.stubGlobal("open", open);
});
afterEach(() => vi.unstubAllGlobals());

describe("LinkDialog", () => {
  it("renders nothing while closed", () => {
    setup({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks for an address only, focused, Apply disabled while it is empty", async () => {
    const { user, props } = setup();
    expect(screen.getByRole("dialog", { name: "Link" })).toBeInTheDocument();
    expect(url()).toHaveFocus();
    expect(url()).toHaveAttribute("placeholder", "https://");
    expect(screen.getByLabelText("Address")).toBe(url());
    expect(screen.queryByTestId("link-text")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove link" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open in new tab" })).not.toBeInTheDocument();
    expect(apply()).toBeDisabled();
    await user.type(url(), "   ");
    expect(apply()).toBeDisabled();
    await user.keyboard("{Enter}");
    expect(props.onApply).not.toHaveBeenCalled();
    expect(screen.queryByText(INVALID)).not.toBeInTheDocument();
  });

  it("applies the normalised address on Apply and on Enter, without text", async () => {
    const { user, props } = setup();
    await user.type(url(), " example.com/x ");
    expect(apply()).toBeEnabled();
    await user.click(apply());
    expect(props.onApply).toHaveBeenLastCalledWith({ href: "https://example.com/x" });
    await user.clear(url());
    await user.type(url(), "ann@x.io{Enter}");
    expect(props.onApply).toHaveBeenLastCalledWith({ href: "mailto:ann@x.io" });
    expect(props.onApply).toHaveBeenCalledTimes(2);
  });

  it("refuses an address it cannot store, inline, until the field changes", async () => {
    const { user, props } = setup();
    await user.type(url(), "javascript:alert(1){Enter}");
    expect(screen.getByText(INVALID)).toBeInTheDocument();
    expect(url()).toHaveAttribute("aria-invalid", "true");
    await user.click(apply());
    expect(props.onApply).not.toHaveBeenCalled();
    await user.type(url(), "x");
    expect(screen.queryByText(INVALID)).not.toBeInTheDocument();
    expect(url()).toHaveAttribute("aria-invalid", "false");
  });

  it("asks for the text when told to, the address standing in when it is left blank", async () => {
    const { user, props } = setup({ askText: true });
    expect(screen.getByLabelText("Text to show")).toBe(screen.getByTestId("link-text"));
    await user.type(url(), "x.io{Enter}");
    expect(props.onApply).toHaveBeenLastCalledWith({ href: "https://x.io", text: "https://x.io" });
    await user.type(screen.getByTestId("link-text"), "   ");
    await user.click(apply());
    expect(props.onApply).toHaveBeenLastCalledWith({ href: "https://x.io", text: "https://x.io" });
    await user.clear(screen.getByTestId("link-text"));
    await user.type(screen.getByTestId("link-text"), " Our site ");
    await user.click(apply());
    expect(props.onApply).toHaveBeenLastCalledWith({ href: "https://x.io", text: " Our site " });
  });

  it("offers Remove and Open for an existing link, prefilled", async () => {
    const { user, props } = setup({ editing: true, href: "https://x.io/a" });
    expect(url()).toHaveValue("https://x.io/a");
    await user.click(screen.getByRole("button", { name: "Open in new tab" }));
    expect(open).toHaveBeenLastCalledWith("https://x.io/a", "_blank", "noopener,noreferrer");
    // The dialog stays open: opening the page is not applying it.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.clear(url());
    expect(screen.getByRole("button", { name: "Open in new tab" })).toBeDisabled();
    await user.type(url(), "y.io");
    await user.click(screen.getByRole("button", { name: "Open in new tab" }));
    expect(open).toHaveBeenLastCalledWith("https://y.io", "_blank", "noopener,noreferrer");
    await user.click(screen.getByRole("button", { name: "Remove link" }));
    expect(props.onRemove).toHaveBeenCalledTimes(1);
    expect(props.onApply).not.toHaveBeenCalled();
  });

  it("opens nothing for an address it refuses", async () => {
    const { user } = setup({ editing: true, href: "https://x.io" });
    await user.clear(url());
    await user.type(url(), "ftp://x.io");
    await user.click(screen.getByRole("button", { name: "Open in new tab" }));
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByText(INVALID)).toBeInTheDocument();
  });

  it("cancels on Cancel and on Escape", async () => {
    const { user, props } = setup();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    await user.keyboard("{Escape}");
    expect(props.onCancel).toHaveBeenCalledTimes(2);
    expect(props.onApply).not.toHaveBeenCalled();
  });

  it("starts from the props on each opening", async () => {
    const { user, props, rerender } = setup({ href: "https://a.io" });
    await user.clear(url());
    await user.type(url(), "typed");
    rerender(<LinkDialog {...props} open={false} />);
    rerender(<LinkDialog {...props} open href="https://b.io" />);
    expect(await screen.findByTestId("link-url")).toHaveValue("https://b.io");
  });
});
