/**
 * PpmRiskTab — the initiative risk register (summary, table, create/edit
 * dialog). Pins the counts, the score colouring, the description truncation
 * and the exact bodies sent to `/ppm/initiatives/{id}/risks` and
 * `/ppm/risks/{id}`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PpmRisk } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import PpmRiskTab from "./PpmRiskTab";

const USERS = [
  { id: "u1", display_name: "Ada Lovelace", email: "ada@example.com" },
  { id: "u2", display_name: "", email: "grace@example.com" },
];

function risk(overrides: Partial<PpmRisk> & { id: string; title: string }): PpmRisk {
  return {
    initiative_id: "i1",
    description: null,
    probability: 3,
    impact: 3,
    risk_score: 9,
    mitigation: null,
    owner_id: null,
    owner_name: null,
    status: "open",
    created_at: "2026-01-01T00:00:00",
    updated_at: "2026-01-01T00:00:00",
    ...overrides,
  };
}

const LONG = "A".repeat(90);

const RISKS: PpmRisk[] = [
  risk({
    id: "r1",
    title: "Vendor lock-in",
    description: "Runbook at https://wiki.example.com/lockin",
    probability: 5,
    impact: 4,
    risk_score: 20,
    mitigation: "Dual-source the platform",
    owner_id: "u1",
    owner_name: "Ada Lovelace",
    status: "open",
  }),
  risk({ id: "r2", title: "Budget overrun", description: LONG, risk_score: 9, status: "mitigating" }),
  risk({ id: "r3", title: "Late delivery", probability: 1, impact: 2, risk_score: 2, status: "accepted" }),
];

const createPath = "/ppm/initiatives/i1/risks";

function renderTab(risks: PpmRisk[] = RISKS) {
  const onRefresh = vi.fn();
  const user = userEvent.setup();
  render(<PpmRiskTab initiativeId="i1" risks={risks} onRefresh={onRefresh} />);
  return { user, onRefresh };
}

const kpi = (caption: string) =>
  (screen.getByText(caption, { selector: ".MuiTypography-caption" }).nextElementSibling as HTMLElement)
    .textContent;
const rowOf = (title: string) => screen.getByText(title).closest("tr") as HTMLElement;

beforeEach(() => {
  mockApi.reset();
  mockApi.on("get", "/users", USERS);
  mockApi.on("post", createPath, {});
  mockApi.on("patch", /^\/ppm\/risks\//, {});
  mockApi.on("delete", /^\/ppm\/risks\//, null);
});

describe("PpmRiskTab — summary and table", () => {
  it("counts all, open and high (score ≥ 15) risks", () => {
    renderTab();
    expect(kpi("Total Risks")).toBe("3");
    expect(kpi("Open")).toBe("1");
    expect(kpi("High Risks")).toBe("1");
  });

  it("renders each risk's numbers, status, owner and mitigation", () => {
    renderTab();
    const row = rowOf("Vendor lock-in");
    expect(within(row).getByText("20")).toBeInTheDocument();
    expect(within(row).getByText("Open")).toBeInTheDocument();
    expect(within(row).getByText("Ada Lovelace")).toBeInTheDocument();
    expect(within(row).getByText("Dual-source the platform")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "https://wiki.example.com/lockin" })).toBeInTheDocument();
    expect(within(rowOf("Budget overrun")).getByText("Mitigating")).toBeInTheDocument();
    expect(within(rowOf("Late delivery")).getByText("Accepted")).toBeInTheDocument();
  });

  it("colours the score chip by band", () => {
    renderTab();
    const chipOf = (title: string, score: string) =>
      within(rowOf(title)).getByText(score, { selector: ".MuiChip-label" }).closest(".MuiChip-root") as HTMLElement;
    expect(chipOf("Vendor lock-in", "20")).toHaveStyle({ backgroundColor: "#d32f2f" });
    expect(chipOf("Budget overrun", "9")).toHaveStyle({ backgroundColor: "#ed6c02" });
    expect(chipOf("Late delivery", "2")).toHaveStyle({ backgroundColor: "#2e7d32" });
  });

  it("truncates a long description and shows dashes for a missing owner or mitigation", () => {
    renderTab();
    const row = rowOf("Budget overrun");
    expect(within(row).getByText(`${"A".repeat(80)}...`)).toBeInTheDocument();
    expect(within(row).getAllByText("—")).toHaveLength(2);
  });

  it("shows the empty state", () => {
    renderTab([]);
    expect(screen.getByText("No risks yet")).toBeInTheDocument();
    expect(kpi("Total Risks")).toBe("0");
  });
});

describe("PpmRiskTab — create, edit, delete", () => {
  it("creates a risk with the entered fields and a live score preview", async () => {
    const { user, onRefresh } = renderTab();
    await user.click(screen.getByRole("button", { name: /Add Risk/ }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Add Risk")).toBeInTheDocument();
    const save = within(dialog).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    await user.type(within(dialog).getByRole("textbox", { name: "Risk Title" }), "Key person leaves");
    await user.type(within(dialog).getByRole("textbox", { name: "Description" }), "Bus factor of one");
    const [probability, impact] = within(dialog).getAllByRole("slider");
    fireEvent.change(probability, { target: { value: 4 } });
    fireEvent.change(impact, { target: { value: 5 } });
    expect(within(dialog).getByText("Risk Score: 20")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("combobox", { name: "Owner" }));
    await user.click(await screen.findByRole("option", { name: "grace@example.com" }));

    // The status Select's label is not linked by `labelId`, so its combobox
    // has no accessible name; it is the one showing the current status.
    await user.click(within(dialog).getByText("Open", { selector: '[role="combobox"]' }));
    await user.click(await screen.findByRole("option", { name: "Mitigated" }));

    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => expect(mockApi.callsOf("post", createPath)).toHaveLength(1));
    expect(mockApi.callsOf("post", createPath)[0].body).toEqual({
      title: "Key person leaves",
      description: "Bus factor of one",
      probability: 4,
      impact: 5,
      mitigation: null,
      owner_id: "u2",
      status: "mitigated",
    });
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("edits a risk with its values pre-filled and can clear the owner", async () => {
    const { user, onRefresh } = renderTab();
    // Let the user list land so the owner autocomplete can show its value.
    await waitFor(() => expect(mockApi.callsOf("get", "/users")).toHaveLength(1));
    await user.click(within(rowOf("Vendor lock-in")).getByRole("button", { name: "edit" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Edit Risk")).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "Risk Title" })).toHaveValue("Vendor lock-in");
    expect(within(dialog).getByRole("textbox", { name: "Mitigation" })).toHaveValue("Dual-source the platform");
    expect(within(dialog).getByText("Risk Score: 20")).toBeInTheDocument();
    const owner = within(dialog).getByRole("combobox", { name: "Owner" });
    await waitFor(() => expect(owner).toHaveValue("Ada Lovelace"));

    // Emptying the input clears a non-freeSolo Autocomplete's value.
    await user.clear(owner);
    await user.clear(within(dialog).getByRole("textbox", { name: "Mitigation" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockApi.callsOf("patch", "/ppm/risks/r1")).toHaveLength(1));
    expect(mockApi.callsOf("patch", "/ppm/risks/r1")[0].body).toEqual({
      title: "Vendor lock-in",
      description: "Runbook at https://wiki.example.com/lockin",
      probability: 5,
      impact: 4,
      mitigation: null,
      owner_id: null,
      status: "open",
    });
    expect(onRefresh).toHaveBeenCalled();
  });

  it("deletes a risk and refreshes the parent", async () => {
    const { user, onRefresh } = renderTab();
    await user.click(within(rowOf("Late delivery")).getByRole("button", { name: "delete" }));
    await waitFor(() => expect(mockApi.callsOf("delete", "/ppm/risks/r3")).toHaveLength(1));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });

  it("cancels the dialog without writing", async () => {
    const { user, onRefresh } = renderTab();
    await user.click(screen.getByRole("button", { name: /Add Risk/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("post")).toHaveLength(0);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("still opens the dialog when the user list cannot be loaded", async () => {
    mockApi.fail("get", "/users", 403);
    const { user } = renderTab();
    await waitFor(() => expect(mockApi.callsOf("get", "/users")).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: /Add Risk/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("combobox", { name: "Owner" }));
    expect(await screen.findByText("No options")).toBeInTheDocument();
  });
});
