import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OpenThreadsWarning, RejectDocumentDialog, SignDocumentDialog } from "./ReviewDialogs";

describe("OpenThreadsWarning", () => {
  it("counts open threads, singular and plural, and is absent at zero", () => {
    const { rerender, container } = render(<OpenThreadsWarning count={1} />);
    expect(screen.getByTestId("open-threads-warning")).toHaveTextContent("1 open discussion thread on this document.");
    rerender(<OpenThreadsWarning count={4} />);
    expect(screen.getByTestId("open-threads-warning")).toHaveTextContent("4 open discussion threads on this document.");
    rerender(<OpenThreadsWarning count={0} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<OpenThreadsWarning count={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("SignDocumentDialog", () => {
  function renderSign(props: Partial<React.ComponentProps<typeof SignDocumentDialog>> = {}) {
    const onSign = vi.fn();
    const onClose = vi.fn();
    render(
      <SignDocumentDialog open onClose={onClose} onSign={onSign} title="Sign it" description="Desc" {...props} />,
    );
    return { onSign, onClose };
  }

  it("signs with the trimmed note, or an empty one", async () => {
    const { onSign } = renderSign();
    await userEvent.click(screen.getByRole("button", { name: "Sign" }));
    expect(onSign).toHaveBeenLastCalledWith("");
    await userEvent.type(screen.getByLabelText("Note (optional)"), "  All good ");
    await userEvent.click(screen.getByRole("button", { name: "Sign" }));
    expect(onSign).toHaveBeenLastCalledWith("All good");
  });

  it("refuses a note over 2000 characters and is disabled while busy", () => {
    renderSign();
    const field = screen.getByLabelText("Note (optional)");
    fireEvent.change(field, { target: { value: "x".repeat(2001) } });
    expect(screen.getByRole("button", { name: "Sign" })).toBeDisabled();
    expect(screen.getByText("2001 / 2000")).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "x".repeat(2000) } });
    expect(screen.getByRole("button", { name: "Sign" })).toBeEnabled();
  });

  it("is disabled while signing", () => {
    renderSign({ busy: true });
    expect(screen.getByRole("button", { name: "Sign" })).toBeDisabled();
  });

  it("closes on Cancel", async () => {
    const { onClose, onSign } = renderSign();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSign).not.toHaveBeenCalled();
  });
});

describe("RejectDocumentDialog", () => {
  it("needs a reason and sends it trimmed", async () => {
    const onReject = vi.fn();
    render(
      <RejectDocumentDialog
        open
        onClose={vi.fn()}
        onReject={onReject}
        title="Reject it"
        description="Why?"
        label="Reason"
        submitLabel="Reject"
        openThreadCount={2}
      />,
    );
    expect(screen.getByTestId("open-threads-warning")).toBeInTheDocument();
    const reject = screen.getByRole("button", { name: "Reject" });
    expect(reject).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "   " } });
    expect(reject).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "  Too costly  " } });
    expect(screen.getByText("14 / 4000")).toBeInTheDocument();
    await userEvent.click(reject);
    expect(onReject).toHaveBeenCalledWith("Too costly");
  });

  it("is disabled while rejecting", () => {
    render(
      <RejectDocumentDialog
        open
        onClose={vi.fn()}
        onReject={vi.fn()}
        title="Reject it"
        description="Why?"
        label="Reason"
        submitLabel="Reject"
        busy
      />,
    );
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "No" } });
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
  });
});
