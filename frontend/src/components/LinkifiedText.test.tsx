import { fireEvent, render, screen } from "@testing-library/react";
import Typography from "@mui/material/Typography";
import { describe, expect, it, vi } from "vitest";

import LinkifiedText from "./LinkifiedText";

describe("LinkifiedText", () => {
  it("renders plain text with no anchor", () => {
    const { container } = render(<LinkifiedText text="just words, e.g. these." />);
    expect(container.querySelector("a")).toBeNull();
    expect(container).toHaveTextContent("just words, e.g. these.");
  });

  it("renders nothing for an empty value", () => {
    const { container } = render(
      <div>
        <LinkifiedText text={null} />
        <LinkifiedText text={undefined} />
        <LinkifiedText text="" />
      </div>,
    );
    expect(container.querySelector("div")).toBeEmptyDOMElement();
  });

  it("turns an address into a new-tab link and keeps the rest as text", () => {
    render(<LinkifiedText text="see https://turbo-ea.org/docs. Then more" />);
    const link = screen.getByRole("link", { name: "https://turbo-ea.org/docs" });
    expect(link).toHaveAttribute("href", "https://turbo-ea.org/docs");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
    expect(screen.getByText(/Then more/)).toBeInTheDocument();
  });

  it("never emits a javascript: href or raw HTML", () => {
    const { container } = render(
      <LinkifiedText text="javascript:alert(1) <img src=x onerror=alert(1)>" />,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("keeps the text as direct children of the host so getByText still matches", () => {
    render(
      <Typography data-testid="host" sx={{ whiteSpace: "pre-wrap" }}>
        <LinkifiedText text={"Billing, CRM, ERP\nhttps://a.io"} />
      </Typography>,
    );
    expect(screen.getByText(/Billing, CRM, ERP/)).toBe(screen.getByTestId("host"));
    expect(screen.getByTestId("host")).toHaveStyle({ whiteSpace: "pre-wrap" });
  });

  it("does not let a click on the link reach a clickable host", () => {
    const onHostClick = vi.fn();
    render(
      <div onClick={onHostClick}>
        <LinkifiedText text="open https://a.io now" />
      </div>,
    );
    fireEvent.click(screen.getByRole("link"));
    expect(onHostClick).not.toHaveBeenCalled();
  });

  it("swallows the second click of a double-click so only one tab opens", () => {
    render(<LinkifiedText text="https://a.io" />);
    const link = screen.getByRole("link");
    const single = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 });
    const second = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 2 });
    link.dispatchEvent(single);
    link.dispatchEvent(second);
    expect(single.defaultPrevented).toBe(false);
    expect(second.defaultPrevented).toBe(true);
  });

  it("forwards extra link props", () => {
    render(<LinkifiedText text="https://a.io" linkProps={{ color: "inherit", title: "hint" }} />);
    expect(screen.getByRole("link")).toHaveAttribute("title", "hint");
  });
});
