import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";

// The dialog has its own tests: here it says what it was given, and can
// report a restore or close.
const dialogs = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));
vi.mock("./DocumentHistoryDialog", () => ({
  default: (props: { onRestored: (d: unknown) => void; onClose: () => void }) => {
    dialogs.props.push(props);
    return (
      <div role="dialog" aria-label="history-dialog">
        <button type="button" onClick={() => props.onRestored({ id: "a1", title: "Restored" })}>
          restore-it
        </button>
        <button type="button" onClick={props.onClose}>
          close-it
        </button>
      </div>
    );
  },
}));

import { renderWithProviders } from "@/test/render";
import DocumentHistoryButton from "./DocumentHistoryButton";

beforeEach(() => {
  dialogs.props.length = 0;
});

describe("DocumentHistoryButton", () => {
  it("opens the History view with what it needs, and closes it", async () => {
    const isDirty = () => true;
    const onRestored = vi.fn();
    const { user } = renderWithProviders(
      <DocumentHistoryButton
        owner={{ kind: "adr", id: "a1" }}
        label="ADR-012 · Adopt Kafka"
        status="draft"
        refreshKey="k1"
        isDirty={isDirty}
        onRestored={onRestored}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    const button = screen.getByRole("button", { name: /History$/ });
    expect(button).toHaveTextContent("History");
    await user.click(button);
    expect(screen.getByRole("dialog", { name: "history-dialog" })).toBeInTheDocument();
    expect(dialogs.props.at(-1)).toMatchObject({
      owner: { kind: "adr", id: "a1" },
      label: "ADR-012 · Adopt Kafka",
      status: "draft",
      refreshKey: "k1",
      isDirty,
    });
    await user.click(screen.getByRole("button", { name: "close-it" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onRestored).not.toHaveBeenCalled();
  });

  it("hands a restored document to the page and says it was restored", async () => {
    const onRestored = vi.fn();
    const { user } = renderWithProviders(
      <DocumentHistoryButton owner={{ kind: "soaw", id: "s1" }} label="Billing" status="draft" onRestored={onRestored} />,
    );
    await user.click(screen.getByRole("button", { name: /History$/ }));
    await user.click(screen.getByRole("button", { name: "restore-it" }));
    expect(onRestored).toHaveBeenCalledWith({ id: "a1", title: "Restored" });
    expect(await screen.findByText("Version restored")).toBeInTheDocument();
  });

  it("is an icon button with the same name when compact", async () => {
    const { user } = renderWithProviders(
      <DocumentHistoryButton owner={{ kind: "adr", id: "a1" }} label="L" status="signed" compact />,
    );
    const button = screen.getByRole("button", { name: "History" });
    expect(button).not.toHaveTextContent(/^History$/);
    await user.click(button);
    await waitFor(() => expect(screen.getByRole("dialog", { name: "history-dialog" })).toBeInTheDocument());
    expect(dialogs.props.at(-1)).toMatchObject({ status: "signed", label: "L" });
  });
});
