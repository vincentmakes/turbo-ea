import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/components/ColorPicker", () => ({
  default: ({ value }: { value: string }) => <span>{value}</span>,
}));

import { mockApi } from "@/test/apiMock";
import { makeCardType } from "@/test/fixtures/metamodel";
import LifecycleStagesDialog from "./LifecycleStagesDialog";

const type = makeCardType({
  key: "Application",
  lifecycle_stages: [
    { key: "testing", label: "Testing", color: "#123456" },
    { key: "running", label: "Running", color: "#654321" },
  ],
});

beforeEach(() => {
  mockApi.reset();
  mockApi.on("put", "/metamodel/types/Application/lifecycle-stages", {});
});

describe("LifecycleStagesDialog", () => {
  it("preserves saved keys, orders stages and saves new stages", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<LifecycleStagesDialog open cardType={type} onClose={onClose} onSaved={onSaved} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByLabelText("Key")[0]).toBeDisabled();
    await user.click(within(dialog).getAllByRole("button", { name: "Move stage down" })[0]);
    await user.click(within(dialog).getByRole("button", { name: "Add stage" }));
    const keys = within(dialog).getAllByLabelText("Key");
    await user.type(keys[2], "sunset");
    const labels = within(dialog).getAllByLabelText(/Label/);
    await user.type(labels[2], "Sunset");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockApi.callsOf("put", "/metamodel/types/Application/lifecycle-stages")).toHaveLength(1));
    expect(mockApi.callsOf("put", "/metamodel/types/Application/lifecycle-stages")[0].body).toEqual({
      stages: [
        { key: "running", label: "Running", color: "#654321" },
        { key: "testing", label: "Testing", color: "#123456" },
        { key: "sunset", label: "Sunset", color: "#1976d2" },
      ],
    });
    expect(onSaved).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows a conflict when a removed stage is still assigned", async () => {
    mockApi.fail("put", "/metamodel/types/Application/lifecycle-stages", 409, "stage_in_use");
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<LifecycleStagesDialog open cardType={type} onClose={() => {}} onSaved={onSaved} />);
    await user.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("still used by cards");
    expect(onSaved).not.toHaveBeenCalled();
  });
});
