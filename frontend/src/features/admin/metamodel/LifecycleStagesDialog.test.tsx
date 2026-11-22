import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  it("allows underscores in a new key and keeps duplicate drafts editable", async () => {
    const user = userEvent.setup();
    render(<LifecycleStagesDialog open cardType={type} onClose={() => {}} onSaved={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Add stage" }));
    const key = screen.getAllByLabelText(/^Key/)[2];
    await user.type(key, "testing");
    expect(key).toBeEnabled();
    await user.type(key, "_new");
    expect(key).toHaveValue("testing_new");
    await user.type(screen.getAllByLabelText(/Label/)[2], "New");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("allows editing and saving a stage imported with an underscore key", async () => {
    const user = userEvent.setup();
    const imported = makeCardType({ ...type, lifecycle_stages: [{ key: "pilot_stage", label: "Pilot", color: "#123456" }] });
    render(<LifecycleStagesDialog open cardType={imported} onClose={() => {}} onSaved={() => {}} />);
    await user.clear(screen.getByLabelText(/Label/));
    await user.type(screen.getByLabelText(/Label/), "Pilot updated");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("enforces stage, key and label limits", () => {
    const full = makeCardType({ ...type, lifecycle_stages: Array.from({ length: 50 }, (_, i) => ({ key: `stage${i}`, label: `Stage ${i}`, color: "#123456" })) });
    render(<LifecycleStagesDialog open cardType={full} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByRole("button", { name: "Add stage" })).toBeDisabled();
    expect(screen.getAllByLabelText(/^Key/)[0]).toHaveAttribute("maxlength", "50");
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    expect(screen.getByRole("button", { name: "Add stage" })).toBeEnabled();
  });

  it("counts supplementary characters as one code point in stage labels", () => {
    const imported = makeCardType({ ...type, lifecycle_stages: [
      { key: "first", label: `${"a".repeat(199)}😀`, color: "#123456" },
      { key: "second", label: "Second", color: "#123456" },
    ] });
    render(<LifecycleStagesDialog open cardType={imported} onClose={() => {}} onSaved={() => {}} />);
    const labels = screen.getAllByLabelText(/Label/);
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    fireEvent.change(labels[1], { target: { value: `${"b".repeat(199)}😀` } });
    expect(labels[1]).toHaveValue(`${"b".repeat(199)}😀`);
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    fireEvent.change(labels[1], { target: { value: `${"b".repeat(200)}😀` } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("locks row controls while saving", async () => {
    mockApi.on("put", "/metamodel/types/Application/lifecycle-stages", () => new Promise(() => {}));
    const user = userEvent.setup();
    render(<LifecycleStagesDialog open cardType={type} onClose={() => {}} onSaved={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getAllByLabelText(/Label/)[0]).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "Delete" })[0]).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add stage" })).toBeDisabled();
  });
  it("preserves saved keys, orders stages and saves new stages", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<LifecycleStagesDialog open cardType={type} onClose={onClose} onSaved={onSaved} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByLabelText(/^Key/)[0]).toBeDisabled();
    await user.click(within(dialog).getAllByRole("button", { name: "Move stage down" })[0]);
    await user.click(within(dialog).getByRole("button", { name: "Add stage" }));
    const keys = within(dialog).getAllByLabelText(/^Key/);
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
