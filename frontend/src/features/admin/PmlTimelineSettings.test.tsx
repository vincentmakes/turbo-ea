import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockApi } from "@/test/apiMock";
import PmlTimelineSettings from "./PmlTimelineSettings";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
const state = vi.hoisted(() => ({
  invalidate: vi.fn(),
  permissions: { "admin.metamodel": true } as Record<string, boolean>,
  fields: [
    { key: "startDate", label: "Start Date", type: "date" },
    { key: "endDate", label: "End Date", type: "date" },
    { key: "actualStart", label: "Actual Start", type: "date" },
    { key: "actualEnd", label: "Actual End", type: "date" },
    { key: "ActualEnd", label: "Aruba End", type: "date" },
    { key: "locked", label: "Locked", type: "date", readonly: true },
  ],
}));
vi.mock("@/hooks/AuthContext", () => ({
  useOptionalAuthUser: () => ({ permissions: state.permissions }),
}));
vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    types: [{ key: "Initiative", fields_schema: [{ section: "Timeline", fields: state.fields }] }],
    loading: false,
    invalidateCache: state.invalidate,
  }),
}));

describe("PmlTimelineSettings", () => {
  beforeEach(() => {
    mockApi.reset();
    if (!state.fields.some((field) => field.key === "actualEnd"))
      state.fields.push({ key: "actualEnd", label: "Actual End", type: "date" });
    if (!state.fields.some((field) => field.key === "actualStart"))
      state.fields.push({ key: "actualStart", label: "Actual Start", type: "date" });
    state.invalidate.mockReset();
    state.permissions = { "admin.metamodel": true };
    mockApi.on("get", "/settings/pml/timeline", {
      actual_start_key: "actualStart",
      actual_end_key: "actualEnd",
    });
    mockApi.on("put", "/settings/pml/timeline", (_path, body) => body);
  });

  it("shows built-in actual fields and saves a case-sensitive custom field", async () => {
    const user = userEvent.setup();
    render(<PmlTimelineSettings />);
    const end = await screen.findByRole("combobox", { name: /actual end/i });
    expect(end).toHaveTextContent("Actual End");
    await user.click(end);
    expect(screen.queryByRole("option", { name: "Start Date" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Locked" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Actual Start" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await user.click(screen.getByRole("option", { name: "Aruba End" }));
    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(mockApi.callsOf("put", "/settings/pml/timeline")[0].body).toEqual({
        actual_start_key: "actualStart",
        actual_end_key: "ActualEnd",
        create_defaults: [],
      }),
    );
  });

  it("creates only a missing actual end when permitted", async () => {
    const user = userEvent.setup();
    state.fields = state.fields.filter((field) => field.key !== "actualEnd");
    mockApi.on("get", "/settings/pml/timeline", {
      actual_start_key: "actualStart",
      actual_end_key: null,
    });
    mockApi.on("put", "/settings/pml/timeline", {
      actual_start_key: "actualStart",
      actual_end_key: "actualEnd",
    });
    render(<PmlTimelineSettings />);
    await user.click(await screen.findByRole("button", { name: /create actual end/i }));
    await waitFor(() =>
      expect(mockApi.callsOf("put", "/settings/pml/timeline")[0].body).toEqual({
        actual_start_key: "actualStart",
        actual_end_key: null,
        create_defaults: ["end"],
      }),
    );
    await waitFor(() => expect(state.invalidate).toHaveBeenCalledOnce());
  });

  it("creates a missing default that the server still reports as mapped", async () => {
    const user = userEvent.setup();
    state.fields = state.fields.filter((field) => field.key !== "actualEnd");
    mockApi.on("put", "/settings/pml/timeline", {
      actual_start_key: "actualStart",
      actual_end_key: "actualEnd",
    });
    render(<PmlTimelineSettings />);
    const end = await screen.findByRole("combobox", { name: /actual end/i });
    expect(end).not.toHaveTextContent("actualEnd");
    await user.click(screen.getByRole("button", { name: /create actual end/i }));
    await waitFor(() =>
      expect(mockApi.callsOf("put", "/settings/pml/timeline")[0].body).toEqual({
        actual_start_key: "actualStart",
        actual_end_key: null,
        create_defaults: ["end"],
      }),
    );
  });

  it("creates one default when both saved mappings point to absent fields", async () => {
    const user = userEvent.setup();
    state.fields = state.fields.filter(
      (field) => !["actualStart", "actualEnd"].includes(field.key),
    );
    render(<PmlTimelineSettings />);
    await user.click(await screen.findByRole("button", { name: /create actual end/i }));
    await waitFor(() =>
      expect(mockApi.callsOf("put", "/settings/pml/timeline")[0].body).toEqual({
        actual_start_key: null,
        actual_end_key: null,
        create_defaults: ["end"],
      }),
    );
  });

  it("does not offer to create a built-in field that already exists", async () => {
    mockApi.on("get", "/settings/pml/timeline", {
      actual_start_key: "actualStart",
      actual_end_key: null,
    });
    render(<PmlTimelineSettings />);
    await screen.findByRole("combobox", { name: /actual end/i });
    expect(screen.queryByRole("button", { name: /create actual end/i })).not.toBeInTheDocument();
  });
  it("hides field creation without metamodel permission", async () => {
    state.permissions = {};
    mockApi.on("get", "/settings/pml/timeline", {
      actual_start_key: "actualStart",
      actual_end_key: null,
    });
    render(<PmlTimelineSettings />);
    await screen.findByRole("combobox", { name: /actual end/i });
    expect(screen.queryByRole("button", { name: /create actual end/i })).not.toBeInTheDocument();
  });
});
